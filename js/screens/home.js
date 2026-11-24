// ============================================================
// home.js — ホーム画面
//   ・「ピンを打つ」ボタンを押したら、現在地を取って保存する
//   ・近くに既存のピンがあれば、そこに追加するかを聞く
//   ・最近のピンを3件表示する
// ============================================================

import { getBestPosition, formatCoord, distanceM } from '../geo.js';
import { saveAll, getAll, getPinsNewestFirst } from '../db.js';
import { newId, toIsoLocal, formatDateTime } from '../util.js';
import { createEmptyCatch } from './catch.js';
import { getSetting } from '../settings-store.js';
import { initPinMap, showPinMap } from '../pinmap.js';

// 何も押さなかったとき、自動で「追加」を選ぶまでの秒数
const AUTO_ADD_SECONDS = 5;

const button = document.getElementById('pin-button');
const statusEl = document.getElementById('home-status');
const recentSection = document.getElementById('recent');
const recentList = document.getElementById('recent-list');

const nearbyPanel = document.getElementById('nearby');
const nearbyAddButton = document.getElementById('nearby-add');
const nearbyNewButton = document.getElementById('nearby-new');
const nearbyNote = document.getElementById('nearby-note');

const BUTTON_LABEL = 'ピンを<br>打つ';

// ---------- 近くのピンを探す ----------

// いちばん近いピンと、そこまでの距離を返す。
// 設定の距離（初期値50m）より遠ければ null。設定が0なら、いつも null（聞かない）
async function findNearbyPin(lat, lon) {
  const nearbyM = getSetting('nearbyM');
  if (nearbyM === 0) return null;

  let nearest = null;
  for (const pin of await getAll('pins')) {
    const distance = distanceM(lat, lon, pin.lat, pin.lon);
    if (distance <= nearbyM && (!nearest || distance < nearest.distance)) {
      nearest = { pin, distance };
    }
  }
  return nearest;
}

// 「このピンに追加 / 新しいピン」を聞く。答えは 'add' か 'new'。
// 5秒何も押さなければ 'add' にする（海上で手が離せないときのため）。
function askAddOrNew(nearby) {
  return new Promise((resolve) => {
    let secondsLeft = AUTO_ADD_SECONDS;

    nearbyAddButton.textContent =
      '「' + nearby.pin.name + '」に追加（' + Math.round(nearby.distance) + 'm先）';

    function showCountdown() {
      nearbyNote.textContent = secondsLeft + '秒後に自動で追加します';
    }

    function finish(answer) {
      clearInterval(timer);
      nearbyPanel.hidden = true;
      button.hidden = false;
      nearbyAddButton.onclick = null;
      nearbyNewButton.onclick = null;
      resolve(answer);
    }

    const timer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        finish('add');
      } else {
        showCountdown();
      }
    }, 1000);

    nearbyAddButton.onclick = () => finish('add');
    nearbyNewButton.onclick = () => finish('new');

    // 大きな丸ボタンを隠して、その場所に選択肢を出す
    showCountdown();
    button.hidden = true;
    nearbyPanel.hidden = false;
  });
}

// ---------- ピンを打つ ----------

async function onPinButton() {
  // 押した瞬間の時刻を先に控える（GPSを待っている間に時間が進むため）
  const pressedAt = toIsoLocal(new Date());

  // 測位中は、二重に押せないようにする
  button.disabled = true;
  button.textContent = '測位中';
  statusEl.textContent = '位置を調べています…';
  statusEl.classList.remove('is-warning');

  try {
    const position = await getBestPosition({
      onProgress: (p) => {
        statusEl.textContent = '位置を調べています… 精度 ±' + Math.round(p.accuracyM) + 'm';
      },
    });

    // 近くに既存のピンがあれば、そこに追加するかを聞く
    let targetPin = null;
    const nearby = await findNearbyPin(position.lat, position.lon);
    if (nearby) {
      statusEl.textContent = '近くにピンがあります';
      const answer = await askAddOrNew(nearby);
      if (answer === 'add') {
        targetPin = nearby.pin;
      }
    }

    const entries = [];

    // 追加先がなければ、新しいピンを作る
    if (!targetPin) {
      targetPin = {
        id: newId(),
        name: 'ピン ' + formatDateTime(pressedAt),
        lat: position.lat,
        lon: position.lon,
        accuracyM: Math.round(position.accuracyM),
        memo: '',
        createdAt: pressedAt,
        updatedAt: pressedAt,
      };
      entries.push({ store: 'pins', value: targetPin });
    }

    // 空の釣果を1件作る（中身は次の画面か、あとで入力する）
    const newCatch = createEmptyCatch(targetPin.id, pressedAt);
    entries.push({ store: 'catches', value: newCatch });

    try {
      await saveAll(entries);
    } catch (error) {
      console.error(error);
      throw new Error('保存できませんでした。端末の空き容量を確認して、もう一度押してください。');
    }

    // 保存できたので、かんたん入力の画面へ進む
    statusEl.textContent = '';
    location.hash = '#after/' + newCatch.id;
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.classList.add('is-warning');
  } finally {
    button.disabled = false;
    button.innerHTML = BUTTON_LABEL;
  }
}

// ---------- 最近のピン ----------

async function showRecentPins() {
  const pins = (await getPinsNewestFirst()).slice(0, 3);

  recentSection.hidden = (pins.length === 0);
  recentList.textContent = '';

  for (const pin of pins) {
    // 行全体をリンクにして、押すとピンの詳細が開くようにする
    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = '#pin/' + pin.id;

    const name = document.createElement('div');
    name.className = 'row-main';
    name.textContent = pin.name;

    const coord = document.createElement('div');
    coord.className = 'row-sub';
    coord.textContent = formatCoord(pin.lat, pin.lon, getSetting('coordFormat')) + '（±' + pin.accuracyM + 'm）';

    link.append(name, coord);

    const item = document.createElement('li');
    item.append(link);
    recentList.append(item);
  }
}

// ---------- app.js から呼ばれるもの ----------

// 最初に1回だけ
export function initHome() {
  button.addEventListener('click', onPinButton);
  initPinMap();

  // 「HONDEXの海図を開く」。圏外では開けないので、リンクを止めて理由を伝える
  const depthStatus = document.getElementById('depth-status');
  document.getElementById('depth-link').addEventListener('click', (event) => {
    if (navigator.onLine) {
      depthStatus.textContent = '';
    } else {
      event.preventDefault();
      depthStatus.textContent = '圏外です。電波のある場所で使えます。';
    }
  });
}

// ホーム画面を表示するたび
export function showHome() {
  return Promise.all([showRecentPins(), showPinMap()]);
}
