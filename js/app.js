// ============================================================
// app.js — アプリが開いたときに最初に動くファイル
//   1. 画面の切り替え（ホーム / 一覧 / 設定）
//   2. Service Worker の登録（オフラインで動かすための準備）
//   3. 設定画面の「アプリの状態」の表示
// ============================================================

import { initHome } from './screens/home.js';

// ---------- 1. 画面の切り替え ----------
// URLの末尾の「#home」「#list」などを見て、対応する画面だけを表示する。
// 下のタブは <a href="#list"> というただのリンクなので、
// 押すとURLが変わり、それをきっかけに画面が切り替わる。

const SCREENS = ['home', 'list', 'settings'];

function showScreen() {
  // 「#list」→「list」。何もなければホーム
  let name = location.hash.replace('#', '');
  if (!SCREENS.includes(name)) {
    name = 'home';
  }

  // 該当する画面だけ表示し、他は隠す
  for (const screen of SCREENS) {
    document.getElementById('screen-' + screen).hidden = (screen !== name);
  }

  // 下のタブの「いまここ」の印を付け替える
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.screen === name) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  }

  // 画面を切り替えたら一番上に戻す
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', showScreen);
showScreen();

// ---------- 各画面の準備 ----------

initHome();

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
