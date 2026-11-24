// ============================================================
// home.js — ホーム画面
//   ・「ピンを打つ」ボタンを押したら、現在地を取って保存する
//   ・最近のピンを3件表示する
// ============================================================

import { getBestPosition, formatCoord } from '../geo.js';
import { saveAll, getPinsNewestFirst } from '../db.js';
import { newId, toIsoLocal, formatDateTime } from '../util.js';

// これより誤差が大きいときは「精度が低い」と知らせる（メートル）
const LOW_ACCURACY_M = 30;

const button = document.getElementById('pin-button');
const statusEl = document.getElementById('home-status');
const detailEl = document.getElementById('home-detail');
const recentSection = document.getElementById('recent');
const recentList = document.getElementById('recent-list');

const BUTTON_LABEL = 'ピンを<br>打つ';

// ---------- ピンを打つ ----------

async function onPinButton() {
  // 押した瞬間の時刻を先に控える（GPSを待っている間に時間が進むため）
  const pressedAt = toIsoLocal(new Date());

  // 測位中は、二重に押せないようにする
  button.disabled = true;
  button.textContent = '測位中';
  statusEl.textContent = '位置を調べています…';
  statusEl.classList.remove('is-warning');
  detailEl.textContent = '';

  try {
    const position = await getBestPosition({
      onProgress: (p) => {
        statusEl.textContent = '位置を調べています… 精度 ±' + Math.round(p.accuracyM) + 'm';
      },
    });

    // 保存するデータを作る
    const pin = {
      id: newId(),
      name: 'ピン ' + formatDateTime(pressedAt),
      lat: position.lat,
      lon: position.lon,
      accuracyM: Math.round(position.accuracyM),
      memo: '',
      createdAt: pressedAt,
      updatedAt: pressedAt,
    };

    // ピンと一緒に、空の釣果を1件作っておく（中身はあとで入力する）
    const emptyCatch = {
      id: newId(),
      pinId: pin.id,
      caughtAt: pressedAt,
      species: '',
      sizeCm: null,
      count: null,
      depthM: null,
      tana: '',
      rig: '',
      memo: '',
      hasPhoto: false,
      updatedAt: pressedAt,
    };

    await saveAll([
      { store: 'pins', value: pin },
      { store: 'catches', value: emptyCatch },
    ]);

    // 結果を表示する
    if (pin.accuracyM > LOW_ACCURACY_M) {
      statusEl.textContent = '保存しました（精度が低いです ±' + pin.accuracyM + 'm）';
      statusEl.classList.add('is-warning');
    } else {
      statusEl.textContent = '保存しました（精度 ±' + pin.accuracyM + 'm）';
    }
    detailEl.textContent = formatCoord(pin.lat, pin.lon);

    await showRecentPins();
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.classList.add('is-warning');
  } finally {
    button.disabled = false;
    button.innerHTML = BUTTON_LABEL;
  }
}

// ---------- 最近のピン ----------

export async function showRecentPins() {
  const pins = (await getPinsNewestFirst()).slice(0, 3);

  recentSection.hidden = (pins.length === 0);
  recentList.textContent = '';

  for (const pin of pins) {
    const item = document.createElement('li');

    const name = document.createElement('div');
    name.className = 'pin-name';
    name.textContent = pin.name;

    const coord = document.createElement('div');
    coord.className = 'pin-coord';
    coord.textContent = formatCoord(pin.lat, pin.lon) + '（±' + pin.accuracyM + 'm）';

    item.append(name, coord);
    recentList.append(item);
  }
}

// ---------- 最初の準備（app.js から1回だけ呼ばれる） ----------

export function initHome() {
  button.addEventListener('click', onPinButton);
  showRecentPins();
}
