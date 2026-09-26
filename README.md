# Render 用 動画リスト

動画IDをCookieに保存するシンプルな動画リストです。

## 主な機能

- 動画IDだけを入力して登録
- ブラウザCookieに動画ID一覧を保存
- Render側 `/proxy/thumb` 経由で `i.ytimg.com/vi/(ID)/maxresdefault.jpg` を表示
- Render側 `/api/title` が Google Classroom の `https://classroom.google.com/u/0/n/pck?v=(ID)` を取得して、`ds:0` の `data:[[null,"タイトル",...` を解析
- 動画カードをクリックすると Classroom のページを新しいタブで開く
- 動画題名で検索
- 動画を1件ずつ削除
- 黒基調のレスポンシブUI

## Renderへの配置

このフォルダをGitHubリポジトリに入れて、RenderでWeb Serviceとしてデプロイできます。
`render.yaml` も同梱しています。

Renderの無料Web Serviceでは、ビルド時に `npm install --omit=dev`、起動時に `node server.js` が実行されます。

## 注意点

Google Classroom の対象ページがログイン必須の場合、RenderサーバーからはユーザーのGoogleログインCookieを共有できません。その場合、`/api/title` はページを取得できても題名を抽出できず、カードには動画IDが表示されます。

この実装はユーザーのGoogle認証情報やCookieをRenderへ送信する処理は入れていません。

Cookie保存はブラウザ単位です。別のブラウザや端末とはリストが共有されません。
