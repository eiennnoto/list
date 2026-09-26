const COOKIE_NAME = 'videoList';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const state = {
  ids: loadIds(),
  titles: new Map(),
  search: ''
};

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const form = document.getElementById('add-form');
const input = document.getElementById('video-id');
const message = document.getElementById('form-message');
const search = document.getElementById('search');
const clearSearch = document.getElementById('clear-search');
const template = document.getElementById('card-template');

function loadIds() {
  const match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return Array.isArray(parsed) ? [...new Set(parsed.filter(validId))] : [];
  } catch {
    return [];
  }
}

function saveIds() {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state.ids))}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

function validId(id) {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id);
}

function classroomUrl(id) {
  return `https://classroom.google.com/u/0/n/pck?v=${encodeURIComponent(id)}`;
}

function thumbUrl(id) {
  return `/proxy/thumb?id=${encodeURIComponent(id)}`;
}

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `form-message ${type}`;
}

function filteredIds() {
  const q = state.search.trim().toLocaleLowerCase();
  if (!q) return state.ids;
  return state.ids.filter(id => (state.titles.get(id) || '').toLocaleLowerCase().includes(q));
}

function render() {
  listEl.innerHTML = '';
  countEl.textContent = state.ids.length;

  const ids = filteredIds();
  emptyEl.style.display = ids.length ? 'none' : 'block';

  if (!state.ids.length) {
    emptyEl.innerHTML = `
      <div class="empty-icon">＋</div>
      <h2>まだ動画がありません</h2>
      <p>上の入力欄から動画IDを登録してください。</p>
    `;
    return;
  }

  if (!ids.length) {
    emptyEl.innerHTML = `
      <div class="empty-icon">⌕</div>
      <h2>検索結果がありません</h2>
      <p>別の題名で検索してみてください。</p>
    `;
    return;
  }

  for (const id of ids) renderCard(id);
}

function renderCard(id) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.video-card');
  const thumbLink = fragment.querySelector('.thumb-link');
  const thumb = fragment.querySelector('.thumb');
  const fallback = fragment.querySelector('.thumb-fallback');
  const title = fragment.querySelector('.video-title');
  const idEl = fragment.querySelector('.video-id');
  const dot = fragment.querySelector('.status-dot');
  const status = fragment.querySelector('.status-text');
  const deleteButton = fragment.querySelector('.delete-button');

  const url = classroomUrl(id);
  thumbLink.href = url;
  title.href = url;
  idEl.textContent = id;
  thumb.alt = state.titles.get(id) ? `${state.titles.get(id)} のサムネイル` : `動画 ${id}`;
  thumb.src = thumbUrl(id);

  const knownTitle = state.titles.get(id);
  if (knownTitle) {
    title.textContent = knownTitle;
    dot.classList.add('ready');
    status.textContent = '題名取得済み';
  } else {
    title.textContent = '題名を取得中…';
    status.textContent = '題名を取得中…';
    fetchTitle(id, card, title, dot, status);
  }

  thumb.addEventListener('error', () => {
    thumb.style.display = 'none';
    fallback.style.display = 'flex';
  }, { once: true });

  deleteButton.addEventListener('click', () => {
    state.ids = state.ids.filter(x => x !== id);
    state.titles.delete(id);
    saveIds();
    render();
    setMessage('動画をリストから削除しました。', 'success');
  });

  listEl.appendChild(fragment);
}

async function fetchTitle(id, card, titleEl, dotEl, statusEl) {
  try {
    const response = await fetch(`/api/title?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });
    const data = await response.json();

    if (!state.ids.includes(id)) return;

    if (data.title) {
      state.titles.set(id, data.title);
      titleEl.textContent = data.title;
      titleEl.title = data.title;
      dotEl.classList.add('ready');
      statusEl.textContent = '題名取得済み';
      const q = state.search.trim().toLocaleLowerCase();
      if (q && !data.title.toLocaleLowerCase().includes(q)) {
        card.style.display = 'none';
      }
    } else {
      titleEl.textContent = `動画 ${id}`;
      dotEl.classList.add('error');
      statusEl.textContent = '題名を取得できませんでした';
    }
  } catch {
    if (!state.ids.includes(id)) return;
    titleEl.textContent = `動画 ${id}`;
    dotEl.classList.add('error');
    statusEl.textContent = 'タイトル取得エラー';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = input.value.trim();

  if (!validId(id)) {
    setMessage('動画IDの形式を確認してください。', 'error');
    input.focus();
    return;
  }

  if (state.ids.includes(id)) {
    setMessage('その動画はすでに登録されています。', 'error');
    input.select();
    return;
  }

  state.ids.push(id);
  saveIds();
  input.value = '';
  setMessage('動画をリストに登録しました。', 'success');
  render();
});

search.addEventListener('input', () => {
  state.search = search.value;
  render();
});

clearSearch.addEventListener('click', () => {
  search.value = '';
  state.search = '';
  render();
  search.focus();
});

render();
