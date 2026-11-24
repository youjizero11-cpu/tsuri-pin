// ============================================================
// app.js — アプリが開いたときに最初に動くファイル
//   1. 画面の切り替え（ホーム / 一覧 / 設定）
//   2. Service Worker の登録（オフラインで動かすための準備）
//   3. 設定画面の「アプリの状態」の表示
// ============================================================

import { initHome, showHome } from './screens/home.js';
import { initCatch, showCatch, showNewCatch } from './screens/catch.js';
import { initPin, showPin } from './screens/pin.js';
import { initList, showList } from './screens/list.js';
import { initNav, showNav, hideNav } from './screens/nav.js';
import { initSettings, showSettings } from './screens/settings.js';
import { loadSettings } from './settings-store.js';

// ---------- 1. 画面の切り替え ----------
// URLの末尾の「#home」「#pin/abc123」などを見て、対応する画面だけを表示する。
// 「/」の後ろは、どのピン・どの釣果かを表すID。
// 下のタブは <a href="#list"> というただのリンクなので、
// 押すとURLが変わり、それをきっかけに画面が切り替わる。
//
// 行き先の一覧:
//   screen  表示する画面（index.html の id="screen-〇〇"）
//   tab     下のタブのどれを「いまここ」にするか
//   show    画面を出す前に呼ぶ関数（中身を最新にする）
//   hide    画面を離れるときに呼ぶ関数（GPSを止めるなどの後片付け）

const ROUTES = {
  home:     { screen: 'home',     tab: 'home',     show: () => showHome() },
  list:     { screen: 'list',     tab: 'list',     show: () => showList() },
  settings: { screen: 'settings', tab: 'settings', show: () => showSettings() },
  // ピンを打った直後の、かんたん入力
  after:    { screen: 'catch',    tab: 'home',     show: (id) => showCatch(id, { quick: true }) },
  // 釣果の編集
  catch:    { screen: 'catch',    tab: 'list',     show: (id) => showCatch(id) },
  // 釣果の追加（id はピンのID）
  newcatch: { screen: 'catch',    tab: 'list',     show: (id) => showNewCatch(id) },
  // ピンの詳細
  pin:      { screen: 'pin',      tab: 'list',     show: (id) => showPin(id) },
  // ピンへ戻るナビ（id はピンのID）
  nav:      { screen: 'nav',      tab: 'list',     show: (id) => showNav(id), hide: () => hideNav() },
};

// いま表示している行き先
let currentRoute = null;

async function showScreen() {
  // 「#pin/abc123」→ name は「pin」、id は「abc123」
  const [name, id] = location.hash.replace('#', '').split('/');
  const route = ROUTES[name] || ROUTES.home;

  // 前の画面の後片付けをする
  if (currentRoute && currentRoute.hide) {
    currentRoute.hide();
  }
  currentRoute = route;

  // 先に中身を用意する（古い内容が一瞬見えるのを防ぐ）
  if (route.show) {
    await route.show(id);
  }

  // 該当する画面だけ表示し、他は隠す
  for (const screen of document.querySelectorAll('.screen')) {
    screen.hidden = (screen.id !== 'screen-' + route.screen);
  }

  // 下のタブの「いまここ」の印を付け替える
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.screen === route.tab) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  }

  // 画面を切り替えたら一番上に戻す
  window.scrollTo(0, 0);
}

// ---------- 各画面の準備 ----------

initHome();
initCatch();
initPin();
initList();
initNav();
initSettings();

window.addEventListener('hashchange', showScreen);
// 設定（距離の単位など）を読み込んでから、最初の画面を出す
loadSettings().then(showScreen);

// ---------- データを勝手に消されないよう、ブラウザに頼む ----------
// 端末の空き容量が減ると、ブラウザが保存データを消すことがある。
// 「このアプリのデータは残して」と頼んでおく（聞いてもらえるかは端末しだい）。

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

// ---------- 2. Service Worker の登録 ----------
// Service Worker は、アプリのファイルを端末に保存して、
// 圏外でも開けるようにする係（中身は sw.js）。
//
// パソコンで開発している間（localhost）は登録しない。
// 登録すると古いファイルが出続けて、直した内容が画面に反映されず混乱するため。
// パソコンでオフライン動作を試したいときは、URLの末尾に ?sw=1 を付ける。

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const useServiceWorker =
  'serviceWorker' in navigator &&
  (!isLocal || new URLSearchParams(location.search).has('sw'));

// 登録した Service Worker の情報（更新の確認に使う）
let swRegistration = null;

if (useServiceWorker) {
  // 新しい版に入れ替わったら、画面を自動で読み込み直して新しいファイルを使う。
  // （初めて開いたときは入れ替わりではないので、読み込み直さない）
  const hadOldVersion = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadOldVersion) {
      location.reload();
    }
  });

  navigator.serviceWorker.register('./sw.js')
    .then((registration) => {
      swRegistration = registration;
      return navigator.serviceWorker.ready;
    })
    .then(showAppInfo)
    .catch((error) => {
      console.error('Service Worker の登録に失敗しました', error);
      showAppInfo();
    });

  // アプリを開き直さなくても、画面に戻ってきたときに新しい版がないか確認する。
  // （スマホでは、アプリを閉じたつもりでも裏で開いたままのことが多いため）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && swRegistration) {
      swRegistration.update().catch(() => {});
    }
  });
}

// ---------- 設定画面の「最新版を確認」ボタン ----------

const updateButton = document.getElementById('update-button');
const updateStatus = document.getElementById('update-status');

updateButton.addEventListener('click', async () => {
  if (!swRegistration) {
    updateStatus.textContent = 'いまは確認できません。アプリを開き直してから試してください。';
    return;
  }
  if (!navigator.onLine) {
    updateStatus.textContent = '圏外です。電波のある場所で試してください。';
    return;
  }

  updateStatus.textContent = '確認しています…';
  try {
    await swRegistration.update();
    // 新しい版があれば、取り込みが始まっている（installing / waiting に入る）。
    // 取り込みが終わると、上の controllerchange で画面が自動で読み込み直される。
    if (swRegistration.installing || swRegistration.waiting) {
      updateStatus.textContent = '新しい版を取り込んでいます。そのままお待ちください…';
    } else {
      updateStatus.textContent = '最新の版です。';
    }
  } catch (error) {
    updateStatus.textContent = '確認できませんでした。電波の良い場所でもう一度試してください。';
  }
});

// ---------- 3. 設定画面の「アプリの状態」 ----------

async function showAppInfo() {
  const versionEl = document.getElementById('info-version');
  const offlineEl = document.getElementById('info-offline');

  // sw.js が作った保存場所（キャッシュ）の名前は「tsuri-pin-v1」のような形。
  // その名前から版を読み取る。保存場所があれば、オフラインの準備ができている。
  let cacheName = null;
  if ('caches' in window) {
    const names = await caches.keys();
    cacheName = names.find((n) => n.startsWith('tsuri-pin-')) || null;
  }

  if (cacheName) {
    versionEl.textContent = cacheName.replace('tsuri-pin-', '');
    offlineEl.textContent = '完了（圏外でも開けます）';
  } else if (!useServiceWorker && isLocal) {
    versionEl.textContent = '開発中';
    offlineEl.textContent = 'オフ（パソコンでの開発モード）';
  } else {
    versionEl.textContent = '不明';
    offlineEl.textContent = '未完了（電波のある場所で開き直してください）';
  }
}

function showNetwork() {
  document.getElementById('info-network').textContent =
    navigator.onLine ? 'つながっています' : '圏外';
}

window.addEventListener('online', showNetwork);
window.addEventListener('offline', showNetwork);

showNetwork();
showAppInfo();
