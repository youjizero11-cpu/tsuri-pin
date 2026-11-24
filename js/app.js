// ============================================================
// app.js — アプリが開いたときに最初に動くファイル
//   1. 画面の切り替え（ホーム / 一覧 / 設定）
//   2. Service Worker の登録（オフラインで動かすための準備）
//   3. 設定画面の「アプリの状態」の表示
// ============================================================

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

// ---------- ホーム: ピンを打つボタン（段階2で中身を作る） ----------

const homeStatus = document.getElementById('home-status');

document.getElementById('pin-button').addEventListener('click', () => {
  homeStatus.textContent = 'ボタンは押せています。位置の保存は段階2で作ります。';
});

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

if (useServiceWorker) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(showAppInfo)
    .catch((error) => {
      console.error('Service Worker の登録に失敗しました', error);
      showAppInfo();
    });
}

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
