// ============================================================
// nav.js — ピンへ戻るナビ
//   ・ピンまでの距離を大きく表示する
//   ・ピンの方角を矢印で示す
//   ・画面を開いている間だけGPSとコンパスを動かす（閉じたら止める）
//
// 矢印の向きを決めるには「いま自分がどちらを向いているか」が必要。
// その基準は2つあり、ボタンで切り替えられる。
//   コンパス       : スマホの向き。止まっていても使える。船の金属やエンジンの近くで狂うことがある
//   進行方向（GPS）: 船が進んでいる向き。動いている間しか使えないが、金属の影響を受けない
// ============================================================

import { get } from '../db.js';
import { distanceM, bearingDeg, directionName, formatDistance } from '../geo.js';
import { compassNeedsPermission, requestCompassPermission, startCompass } from '../compass.js';

// これより遅いときは、GPSの進行方向を信用しない（秒速0.6m ≒ 時速2km）
const MIN_SPEED_MPS = 0.6;
// 「到着」とみなす距離の下限（メートル）。GPSの誤差がこれより小さくても、ここまで近づけば到着
const MIN_ARRIVAL_M = 5;

const nameEl = document.getElementById('nav-name');
const distanceEl = document.getElementById('nav-distance');
const arrivedEl = document.getElementById('nav-arrived');
const arrowBox = document.getElementById('nav-arrow-box');
const arrowEl = document.getElementById('nav-arrow');
const arrowHint = document.getElementById('nav-arrow-hint');
const bearingEl = document.getElementById('nav-bearing');
const accuracyEl = document.getElementById('nav-accuracy');
const basisEl = document.getElementById('nav-basis');
const permitButton = document.getElementById('nav-permit');
const modeButton = document.getElementById('nav-mode');
const endLink = document.getElementById('nav-end');
const screenNote = document.getElementById('nav-screen-note');

// ---------- いまの状態 ----------

let pin = null;             // 目的のピン
let position = null;        // 最新の現在地 { lat, lon, accuracyM, course, speed }
let compassHeading = null;  // コンパスの向き（まだ分からなければ null）
let mode = 'compass';       // 矢印の基準: 'compass' か 'gps'
let gpsError = '';          // GPSのエラーメッセージ

let active = false;         // ナビ画面を開いているか
let watchId = null;         // GPSを止めるための番号
let stopCompass = null;     // コンパスを止めるための関数
let wakeLock = null;        // 画面を消さないための鍵
let shownRotation = 0;      // いま矢印を何度回して表示しているか

// ---------- 表示を更新する ----------

// 船が動いているときだけ、GPSの進行方向を返す（それ以外は null）
function gpsCourse() {
  if (!position) return null;
  if (typeof position.speed !== 'number' || position.speed < MIN_SPEED_MPS) return null;
  if (typeof position.course !== 'number' || Number.isNaN(position.course)) return null;
  return position.course;
}

function render() {
  if (!position) {
    distanceEl.textContent = '— m';
    arrivedEl.hidden = true;
    arrowBox.hidden = true;
    arrowHint.hidden = false;
    arrowHint.textContent = gpsError || '位置を調べています…';
    bearingEl.textContent = '';
    accuracyEl.textContent = '';
    basisEl.textContent = '';
    return;
  }

  const distance = distanceM(position.lat, position.lon, pin.lat, pin.lon);
  const bearing = bearingDeg(position.lat, position.lon, pin.lat, pin.lon);

  distanceEl.textContent = formatDistance(distance);
  accuracyEl.textContent = 'GPSの精度 ±' + Math.round(position.accuracyM) + 'm';
  bearingEl.textContent = 'ピンの方角　' + directionName(bearing) + '（北から' + Math.round(bearing) + '°）';

  // 誤差の範囲まで近づいたら「到着」
  arrivedEl.hidden = distance > Math.max(position.accuracyM, MIN_ARRIVAL_M);

  // --- いま自分が向いている方角を決める ---
  const course = gpsCourse();
  let heading = null;
  if (mode === 'compass' && compassHeading !== null) {
    heading = compassHeading;
    basisEl.textContent = '矢印の基準：コンパス（スマホの向き）';
  } else if (course !== null) {
    heading = course;
    basisEl.textContent = '矢印の基準：進行方向（GPS）';
  } else if (mode === 'gps') {
    basisEl.textContent = '矢印の基準：進行方向（GPS）';
  } else {
    basisEl.textContent = '矢印の基準：コンパス';
  }

  // --- 矢印 ---
  if (heading === null) {
    // 向きが分からないので、矢印は出さずに理由を伝える
    arrowBox.hidden = true;
    arrowHint.hidden = false;
    if (mode === 'gps') {
      arrowHint.textContent = '船が動くと矢印が出ます。それまでは下の方角を見てください。';
    } else if (!permitButton.hidden) {
      arrowHint.textContent = '下の「コンパスを使う」を押すと矢印が出ます。';
    } else {
      arrowHint.textContent = 'コンパスの向きが取れません。下の方角を見るか、船が動くのを待ってください。';
    }
  } else {
    arrowBox.hidden = false;
    arrowHint.hidden = true;

    // 矢印を回す角度 ＝ ピンの方角 − 自分の向き
    const target = (bearing - heading + 360) % 360;
    // 359度→1度のとき、ぐるっと逆回りしないよう、近い方へ回す
    const diff = ((target - shownRotation) % 360 + 540) % 360 - 180;
    shownRotation += diff;
    arrowEl.style.transform = 'rotate(' + shownRotation + 'deg)';
  }

  modeButton.textContent = (mode === 'compass')
    ? '進行方向（GPS）基準に切り替え'
    : 'コンパス基準に切り替え';
}

// ---------- 画面を消さないようにする ----------

async function keepScreenOn() {
  if (!('wakeLock' in navigator)) {
    screenNote.textContent = 'この端末では画面が自動で消えることがあります。端末の設定で自動ロックを長めにしてください。';
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    screenNote.textContent = 'ナビ中は画面が消えません。';
  } catch (error) {
    screenNote.textContent = '画面が自動で消えることがあります（省電力モードなど）。';
  }
}

// ---------- 画面を開く・閉じる（app.js から呼ばれる） ----------

export async function showNav(pinId) {
  pin = await get('pins', pinId);
  if (!pin) {
    location.hash = '#list';
    return;
  }

  active = true;
  position = null;
  compassHeading = null;
  gpsError = '';
  mode = 'compass';

  nameEl.textContent = pin.name;
  endLink.href = '#pin/' + pin.id;
  // iPhoneは、許可のボタンを押してもらう必要がある
  permitButton.hidden = !compassNeedsPermission();

  render();

  // --- GPSを連続で取り始める ---
  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        position = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracyM: p.coords.accuracy,
          course: p.coords.heading, // 進んでいる方角（止まっていると null）
          speed: p.coords.speed,    // 速さ（メートル毎秒）
        };
        gpsError = '';
        render();
      },
      (error) => {
        gpsError = (error.code === error.PERMISSION_DENIED)
          ? '位置情報が許可されていません。端末の設定で許可してください。'
          : '位置が取れません。空が見える場所で待ってください。';
        render();
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
  } else {
    gpsError = 'この端末では位置情報が使えません。';
    render();
  }

  // --- コンパスを動かし始める ---
  // （iPhoneで許可がまだのときは、何も届かないだけ。許可されれば届き始める）
  stopCompass = startCompass((heading) => {
    compassHeading = heading;
    // 向きが届いた＝許可済みなので、許可ボタンは隠す
    permitButton.hidden = true;
    render();
  });

  keepScreenOn();
}

export function hideNav() {
  active = false;

  // GPS・コンパス・画面の点灯を、すべて止める（電池の節約）
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (stopCompass) {
    stopCompass();
    stopCompass = null;
  }
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// ---------- 最初の準備（app.js から1回だけ呼ばれる） ----------

export function initNav() {
  // iPhone: コンパスの許可を求める
  permitButton.addEventListener('click', async () => {
    const granted = await requestCompassPermission();
    permitButton.hidden = true;
    if (!granted) {
      // 許可されなかったら、コンパスなしで使える「進行方向」基準に切り替える
      mode = 'gps';
    }
    render();
  });

  // 矢印の基準を切り替える
  modeButton.addEventListener('click', () => {
    mode = (mode === 'compass') ? 'gps' : 'compass';
    render();
  });

  // 別のアプリから戻ってきたら、画面の点灯をかけ直す
  // （画面が隠れると、点灯の指定は自動で外れるため）
  document.addEventListener('visibilitychange', () => {
    if (active && document.visibilityState === 'visible') {
      keepScreenOn();
    }
  });
}
