const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
}

function validVideoId(id) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id);
}

function decodeJsString(text) {
  try {
    return JSON.parse('"' + text.replace(/\\\//g, '/') + '"');
  } catch {
    return text
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function extractTitleFromHtml(html) {
  // Prefer the last <script class="ds:0"> block, matching the structure described by the user.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const candidates = scripts.filter(m => /(?:^|\s)class\s*=\s*["']ds:0["']/i.test(m[1] || ''));
  const blocks = candidates.length ? candidates.map(m => m[2]) : scripts.map(m => m[2]);

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!/AF_initDataCallback/.test(block) && !/key:\s*["']ds:0["']/.test(block)) continue;

    // Example target:
    // data:[[null,"(video title)",.....
    const m = block.match(/data\s*:\s*\[\[\s*null\s*,\s*"((?:\\.|[^"\\])*)"/s);
    if (m) {
      const title = decodeJsString(m[1]).trim();
      if (title) return title;
    }

    // A slightly more tolerant fallback for single-quoted data values.
    const m2 = block.match(/data\s*:\s*\[\[\s*null\s*,\s*'((?:\\.|[^'\\])*)'/s);
    if (m2) {
      const title = m2[1]
        .replace(/\\'/g, "'")
        .replace(/\\n/g, '\n')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .trim();
      if (title) return title;
    }
  }

  // Final fallback: title tag, useful if Google changes its internal ds:0 layout.
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const title = titleTag[1].replace(/\s+/g, ' ').trim();
    if (title && !/^Google Classroom/i.test(title)) return title;
  }

  return null;
}

async function fetchClassroomTitle(id) {
  const target = `https://classroom.google.com/u/0/n/pck?v=${encodeURIComponent(id)}`;
  const response = await fetch(target, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Referer': 'https://classroom.google.com/'
    },
    signal: AbortSignal.timeout(12000)
  });

  const html = await response.text();
  const title = extractTitleFromHtml(html);
  return {
    ok: response.ok,
    status: response.status,
    title,
    finalUrl: response.url
  };
}

async function proxyThumbnail(id, res) {
  const target = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
      },
      signal: AbortSignal.timeout(15000)
    });

    const data = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok || !data.length) {
      send(res, 404, 'Thumbnail not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    send(res, 200, data, {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
    });
  } catch (error) {
    send(res, 502, 'Thumbnail proxy error', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

function serveStatic(reqPath, res) {
  let relative = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  if (relative.includes('..') || relative.includes('\\')) {
    send(res, 400, 'Bad request');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, 'Not found');
      return;
    }
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/title') {
      const id = url.searchParams.get('id') || '';
      if (!validVideoId(id)) {
        json(res, 400, { error: 'Invalid video ID.' });
        return;
      }

      try {
        const result = await fetchClassroomTitle(id);
        json(res, 200, {
          id,
          title: result.title,
          sourceStatus: result.status,
          sourceUrl: result.finalUrl
        }, {
          'Cache-Control': 'public, max-age=300'
        });
      } catch (error) {
        json(res, 200, {
          id,
          title: null,
          error: 'タイトル取得に失敗しました。Google Classroom側でログインが必要な場合があります。'
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/proxy/thumb') {
      const id = url.searchParams.get('id') || '';
      if (!validVideoId(id)) {
        send(res, 400, 'Invalid video ID');
        return;
      }
      await proxyThumbnail(id, res);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(url.pathname, res);
      return;
    }

    send(res, 405, 'Method Not Allowed', { Allow: 'GET' });
  } catch (error) {
    send(res, 500, 'Internal server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Video list server listening on port ${PORT}`);
});
