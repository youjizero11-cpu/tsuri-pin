// ============================================================
// sw.js — Service Worker（オフラインで動かすための係）
//
// やっていること:
//   1. 初めて開いたとき、アプリのファイル一式を端末に保存する（install）
//   2. 版が上がったら、古い保存分を捨てる（activate）
//   3. ファイルが必要になったら、まず保存分から渡す（fetch）
//
// ★ アプリのファイルを変更して公開するときは、必ず下の VERSION を上げる。
//    上げないと、使う人の端末には古いファイルが残り続ける。
// ★ ファイルを追加したら、下の FILES にも追加する。
// ============================================================

const VERSION = 'v13';
const CACHE_NAME = 'tsuri-pin-' + VERSION;

// 端末に保存するファイルの一覧
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/geo.js',
  './js/photo.js',
  './js/settings-store.js',
  './js/japan.js',
  './js/pinmap.js',
  './js/export.js',
  './js/screens/settings.js',
  './js/compass.js',
  './js/screens/nav.js',
  './js/screens/home.js',
  './js/screens/catch.js',
  './js/screens/pin.js',
  './js/screens/list.js',
  './js/screens/plan.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// 1. インストール: ファイル一式を保存する
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' は「ブラウザが覚えている古い分を使わず、必ず取り直す」指定。
      // これが無いと、版を上げたのに古いファイルが保存されることがある。
      .then((cache) => cache.addAll(
        FILES.map((file) => new Request(file, { cache: 'reload' }))
      ))
      // 新しい版を待たせず、すぐ有効にする
      .then(() => self.skipWaiting())
  );
});

// 2. 有効化: 古い版の保存分を捨てる
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('tsuri-pin-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      // いま開いている画面にも、すぐこの係を付ける
      .then(() => self.clients.claim())
  );
});

// 3. ファイルの要求: 保存分があればそれを渡す。なければインターネットへ取りに行く
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  // よそのサイトのファイル（国土地理院の地図の画像など）には手を出さず、
  // ブラウザにそのまま取りに行かせる
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    // ignoreSearch: URLの「?〜」の部分が違っても同じファイルとして扱う
    caches.match(event.request, { ignoreSearch: true })
      .then((cached) => cached || fetch(event.request))
  );
});
