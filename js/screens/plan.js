// ============================================================
// plan.js — 「行きたい場所」を先に登録する画面
//
// その場にいなくても、ピンを作れるようにする。場所の決め方は2つ。
//   1. 地図を指で動かして、真ん中の十字を行きたい場所に合わせる
//   2. 緯度・経度の数字を入力する
// 「この場所をピンにする」を押すと、「予定のピン」として保存する。
// 保存したあとは、ふつうのピンと同じように「ここへ戻る（ナビ）」が使える。
//
// 地図は国土地理院の「地理院タイル」を使う。
// 地図は小さな正方形の画像（タイル）に分かれていて、見えている範囲の分だけ
// インターネットから取ってきて並べる。だから、この画面の地図は電波のある場所でしか出ない。
// （数字の入力と保存は、圏外でもできる）
// ============================================================

import { saveAll, getPinsNewestFirst } from '../db.js';
import { getBestPosition, formatCoord, parseCoord } from '../geo.js';
import { getSetting } from '../settings-store.js';
import { newId, toIsoLocal, formatDateTime } from '../util.js';

// タイル1枚の大きさ（ピクセル）
const TILE = 256;
// 拡大の度合い。数字が1つ増えると、2倍に拡大される。地理院タイル（標準地図）は 5〜18
const MIN_ZOOM = 5;
const MAX_ZOOM = 18;
// タイルの置き場所。{z} が拡大の度合い、{x} {y} がタイルの番号。
// 「地図」（標準地図）と「写真」（空から撮った写真）を切り替えられる
const LAYERS = {
  map: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    credit: '地図：国土地理院',
  },
  photo: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    credit: '写真：国土地理院ほか',
  },
};
// ピンが1つも無いときの最初の表示（日本の真ん中あたり）
const START = { lat: 36.5, lon: 137.5, zoom: 5 };
// ピンがあるとき、いちばん新しいピンのまわりを、この拡大で表示する
const START_ZOOM_NEAR_PIN = 11;

const box = document.getElementById('plan-map');
const tilesEl = document.getElementById('plan-tiles');
const coordEl = document.getElementById('plan-coord');
const offlineEl = document.getElementById('plan-offline');
const zoomInButton = document.getElementById('plan-zoom-in');
const zoomOutButton = document.getElementById('plan-zoom-out');
const locateButton = document.getElementById('plan-locate');
const input = document.getElementById('plan-input');
const goButton = document.getElementById('plan-go');
const saveButton = document.getElementById('plan-save');
const statusEl = document.getElementById('plan-status');
const creditEl = document.getElementById('plan-credit');
const layerButtons = {
  map: document.getElementById('plan-layer-map'),
  photo: document.getElementById('plan-layer-photo'),
};

// ---------- いまの状態 ----------

// 地図の真ん中（十字の位置）と、拡大の度合い
let center = { lat: START.lat, lon: START.lon };
let zoom = START.zoom;
// いま出しているのは 'map'（地図）か 'photo'（写真）か。画面を開き直しても覚えておく
let layer = 'map';
// いま並べているタイル。「種類/拡大/x/y」→ 画像の部品
const tiles = new Map();

// ---------- 緯度経度と、地図の上の位置の変換 ----------
// 地球全体を1枚の正方形の地図にしたとき（メルカトル図法）の、
// 左上からの位置（ピクセル）に変換する。拡大するほど、地図全体が大きくなる。

function worldSize() {
  return TILE * 2 ** zoom;
}

function toWorld(lat, lon) {
  const size = worldSize();
  const rad = lat * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * size,
  };
}

function toLatLon(x, y) {
  const size = worldSize();
  const n = Math.PI * (1 - 2 * y / size);
  return {
    lat: Math.atan(Math.sinh(n)) * 180 / Math.PI,
    lon: x / size * 360 - 180,
  };
}

// ---------- 地図を描く ----------

function render() {
  const width = box.clientWidth;
  const height = box.clientHeight;
  const c = toWorld(center.lat, center.lon);
  // 画面の左上が、地図全体のどこに当たるか
  const left = c.x - width / 2;
  const top = c.y - height / 2;

  // 見えている範囲に必要なタイルを並べる
  const needed = new Set();
  const maxIndex = 2 ** zoom - 1;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (tx < 0 || ty < 0 || tx > maxIndex || ty > maxIndex) continue;
      const key = layer + '/' + zoom + '/' + tx + '/' + ty;
      needed.add(key);

      let img = tiles.get(key);
      if (!img) {
        img = document.createElement('img');
        img.className = 'plan-tile';
        img.alt = '';
        img.draggable = false;
        // 沖合など、地図の画像が無い場所もある。そのときは何も出さない（白いまま）
        img.onerror = () => { img.style.visibility = 'hidden'; };
        img.src = LAYERS[layer].url.replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty);
        tiles.set(key, img);
        tilesEl.append(img);
      }
      img.style.transform =
        'translate(' + Math.round(tx * TILE - left) + 'px,' + Math.round(ty * TILE - top) + 'px)';
    }
  }

  // 見えなくなったタイルは片付ける
  for (const [key, img] of tiles) {
    if (!needed.has(key)) {
      img.remove();
      tiles.delete(key);
    }
  }

  coordEl.textContent = formatCoord(center.lat, center.lon, getSetting('coordFormat'));
  zoomInButton.disabled = (zoom >= MAX_ZOOM);
  zoomOutButton.disabled = (zoom <= MIN_ZOOM);

  // 「地図／写真」のボタン。いま出しているほうを濃い色にする
  creditEl.textContent = LAYERS[layer].credit;
  for (const [name, button] of Object.entries(layerButtons)) {
    button.classList.toggle('button-sub', name !== layer);
    button.setAttribute('aria-pressed', String(name === layer));
  }
}

// 「地図」と「写真」を切り替える
function setLayer(newLayer) {
  if (newLayer === layer) return;
  layer = newLayer;
  render();
}

// 地図を、画面上のピクセルで動かす（指で引っぱった分だけ）
function panBy(dx, dy) {
  const c = toWorld(center.lat, center.lon);
  const size = worldSize();
  // 上下は、地図の端より先へ行かないようにする
  const y = Math.min(size - 1, Math.max(1, c.y - dy));
  center = toLatLon(c.x - dx, y);
  render();
}

function setZoom(newZoom) {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  if (clamped === zoom) return;
  zoom = clamped;
  render();
}

// ---------- 指での操作 ----------
// 1本指で引っぱると動く。2本指を広げる・つまむと、拡大・縮小する。

// いま地図に触れている指。「指の番号 → 位置」
const pointers = new Map();
// 2本指のとき、拡大・縮小の基準にする指の間の距離
let pinchBase = null;

function pinchDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(event) {
  box.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pinchBase = (pointers.size === 2) ? pinchDistance() : null;
}

function onPointerMove(event) {
  const last = pointers.get(event.pointerId);
  if (!last) return;
  const now = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, now);

  if (pointers.size === 1) {
    panBy(now.x - last.x, now.y - last.y);
  } else if (pointers.size === 2 && pinchBase) {
    // 指の間が1.5倍に広がったら1段階拡大、3分の2に縮んだら1段階縮小
    const ratio = pinchDistance() / pinchBase;
    if (ratio > 1.5) {
      setZoom(zoom + 1);
      pinchBase = pinchDistance();
    } else if (ratio < 1 / 1.5) {
      setZoom(zoom - 1);
      pinchBase = pinchDistance();
    }
  }
}

function onPointerUp(event) {
  pointers.delete(event.pointerId);
  pinchBase = null;
}

// ---------- ボタン ----------

// 「現在地へ移動」
async function onLocate() {
  locateButton.disabled = true;
  statusEl.textContent = '位置を調べています…';
  try {
    const position = await getBestPosition();
    center = { lat: position.lat, lon: position.lon };
    zoom = Math.max(zoom, 14);
    statusEl.textContent = '';
    render();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    locateButton.disabled = false;
  }
}

// 「この数字の場所へ移動」
function onGo() {
  const result = parseCoord(input.value);
  if (!result) {
    statusEl.textContent =
      '緯度と経度を読み取れませんでした。「33.6586, 130.2368」か「33°39.512′N 130°14.208′E」の形で入力してください。';
    return;
  }
  center = result;
  zoom = Math.max(zoom, 13);
  statusEl.textContent = '十字をその場所に合わせました。よければ「この場所をピンにする」を押してください。';
  render();
}

// 「この場所をピンにする」
async function onSave() {
  const now = toIsoLocal(new Date());
  const pin = {
    id: newId(),
    name: '予定 ' + formatDateTime(now),
    // 小数第6位まで（約10cm刻み）に丸める。それより細かい桁に意味は無い
    lat: Number(center.lat.toFixed(6)),
    lon: Number(center.lon.toFixed(6)),
    // GPSで測った位置ではないので、精度は持たない。代わりに「予定」の印を付ける
    accuracyM: 0,
    planned: true,
    memo: '',
    createdAt: now,
    updatedAt: now,
  };

  saveButton.disabled = true;
  try {
    await saveAll([{ store: 'pins', value: pin }]);
  } catch (error) {
    console.error(error);
    statusEl.textContent = '保存できませんでした。端末の空き容量を確認して、もう一度押してください。';
    return;
  } finally {
    saveButton.disabled = false;
  }

  // 保存できたので、ピンの詳細へ進む（名前やメモを付けられる）
  location.hash = '#pin/' + pin.id;
}

function showOffline() {
  offlineEl.hidden = navigator.onLine;
}

// ---------- app.js から呼ばれるもの ----------

// 最初に1回だけ
export function initPlan() {
  box.addEventListener('pointerdown', onPointerDown);
  box.addEventListener('pointermove', onPointerMove);
  box.addEventListener('pointerup', onPointerUp);
  box.addEventListener('pointercancel', onPointerUp);

  zoomInButton.addEventListener('click', () => setZoom(zoom + 1));
  zoomOutButton.addEventListener('click', () => setZoom(zoom - 1));
  locateButton.addEventListener('click', onLocate);
  layerButtons.map.addEventListener('click', () => setLayer('map'));
  layerButtons.photo.addEventListener('click', () => setLayer('photo'));
  goButton.addEventListener('click', onGo);
  saveButton.addEventListener('click', onSave);

  window.addEventListener('online', showOffline);
  window.addEventListener('offline', showOffline);
  // 画面の向きや大きさが変わったら、描き直す
  window.addEventListener('resize', () => {
    if (box.clientWidth > 0) render();
  });
}

// 画面を開くたび。いちばん新しいピンのまわりから始める
export async function showPlan() {
  const pins = await getPinsNewestFirst();
  if (pins.length > 0) {
    center = { lat: pins[0].lat, lon: pins[0].lon };
    zoom = START_ZOOM_NEAR_PIN;
  } else {
    center = { lat: START.lat, lon: START.lon };
    zoom = START.zoom;
  }
  input.value = '';
  statusEl.textContent = '';
  pointers.clear();
  showOffline();

  // この時点では画面がまだ隠れていて、地図の大きさが分からない。
  // 画面が出たあと（次の描画のタイミング）に描く
  requestAnimationFrame(() => requestAnimationFrame(render));
}
