// ============================================================
// pinmap.js — ホーム画面の「ピンの地図」
//
// 2つの表示を切り替える。
//   日本全体 : 日本の輪郭の上に、ピンのある場所を印で示す。
//              近いピンは1つの印にまとめ、件数を書く。印を押すと「海域」に切り替わる
//   海域     : 押した印のピンだけを拡大して、位置関係を示す（北が上、縮尺つき）。
//              「現在地を表示」を押すと、自分の位置と、いちばん近いピンが分かる
//
// 地図の画像は使わず、輪郭のデータ（japan.js）から自分で描く。
// だから圏外でも動き、ピンの位置がどこかに送られることもない。
// ============================================================

import { JAPAN_OUTLINE } from './japan.js';
import { getPinsNewestFirst } from './db.js';
import { getBestPosition, distanceM, formatDistance } from './geo.js';
import { getSetting } from './settings-store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// 地図の中の座標の大きさ。画面上の実際の大きさとは別で、0〜1000 の方眼紙だと思えばよい
const SIZE = 1000;
// 緯度1度あたりの距離（メートル）
const METERS_PER_DEG = 111320;

// 日本全体を表示するときの範囲（九州〜北海道）。
// 沖縄まで入れると本州が小さくなりすぎるので、ふだんは入れない。
// この範囲の外にピンがあれば、そこまで自動で広げる（沖縄で打てば沖縄まで映る）
const JAPAN_BOUNDS = { lonMin: 128.5, lonMax: 146.0, latMin: 30.5, latMax: 45.7 };
// 日本全体の表示で、これより近い印は1つにまとめる（方眼紙の目盛りで）
const CLUSTER_UNITS = 70;
// 海域の表示で、これより狭くは拡大しない（メートル）。ピンが1つだけのときのため
const MIN_AREA_M = 300;
// 海域の表示で、表示範囲がこれより広いときだけ陸地を描く（メートル）。
// 輪郭はおおまかなので、狭い範囲で描くと実際とずれて、かえって紛らわしい
const LAND_MIN_WIDTH_M = 30000;

const titleEl = document.getElementById('pinmap-title');
const svg = document.getElementById('pinmap-svg');
const noteEl = document.getElementById('pinmap-note');
const areaBox = document.getElementById('pinmap-area');
const listEl = document.getElementById('pinmap-list');
const locateButton = document.getElementById('pinmap-locate');
const statusEl = document.getElementById('pinmap-status');
const backButton = document.getElementById('pinmap-back');

// ---------- いまの状態 ----------

let pins = [];          // すべてのピン（新しい順）
let mode = 'japan';     // 'japan'（日本全体）か 'area'（海域）
let areaPinIds = [];    // 海域の表示に出すピンのID
let myPosition = null;  // 現在地（「現在地を表示」を押したときだけ入る）

// ---------- 道具 ----------

// SVGの部品を1つ作る
function el(name, attrs = {}, text = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  if (text !== '') node.textContent = text;
  return node;
}

// 点の集まりが収まる範囲を返す
function boundsOf(points) {
  return {
    lonMin: Math.min(...points.map((p) => p.lon)),
    lonMax: Math.max(...points.map((p) => p.lon)),
    latMin: Math.min(...points.map((p) => p.lat)),
    latMax: Math.max(...points.map((p) => p.lat)),
  };
}

// 緯度経度を、方眼紙の上の位置に変換する道具を作る。
//   bounds     表示したい範囲
//   pad        端の余白（0.1 なら、上下左右に1割ずつ）
//   minSpanDeg これより狭い範囲は、この広さまで広げて表示する
// 北が上、東が右。緯度が高いほど経度1度の距離は短くなるので、その分を cos で補正する。
function makeProjection(bounds, pad, minSpanDeg = 0) {
  const lonCenter = (bounds.lonMin + bounds.lonMax) / 2;
  const latCenter = (bounds.latMin + bounds.latMax) / 2;
  const kx = Math.cos(latCenter * Math.PI / 180);

  const width = (bounds.lonMax - bounds.lonMin) * kx;
  const height = bounds.latMax - bounds.latMin;
  const span = Math.max(width, height, minSpanDeg);
  // 緯度1度を、方眼紙の目盛りいくつ分で描くか
  const scale = SIZE * (1 - 2 * pad) / span;

  return {
    project: (lon, lat) => [
      SIZE / 2 + (lon - lonCenter) * kx * scale,
      SIZE / 2 - (lat - latCenter) * scale,
    ],
    // 方眼紙の1目盛りが何メートルか
    metersPerUnit: METERS_PER_DEG / scale,
  };
}

// 日本の輪郭を描く
function drawLand(projection) {
  let d = '';
  for (const ring of JAPAN_OUTLINE) {
    ring.forEach(([lon, lat], index) => {
      const [x, y] = projection.project(lon, lat);
      d += (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    d += 'Z';
  }
  svg.append(el('path', { class: 'map-land', d }));
}

// 押せる印を1つ描く。label は印の中の文字、onTap は押したときの処理
function drawMarker(x, y, label, onTap) {
  const group = el('g', { class: 'map-marker' });
  // 見えない大きな丸。指で押しやすいよう、当たり判定を広げる
  group.append(el('circle', { class: 'map-tap', cx: x, cy: y, r: 70 }));
  group.append(el('circle', { class: 'map-pin', cx: x, cy: y, r: 36 }));
  if (label !== '') {
    group.append(el('text', { class: 'map-pin-text', x, y }, label));
  }
  group.addEventListener('click', onTap);
  svg.append(group);
}

// ---------- 日本全体の表示 ----------

function renderJapan() {
  // ふつうは日本の範囲。日本の外にピンがあれば、そこまで広げる
  const projection = makeProjection(
    boundsOf([
      { lon: JAPAN_BOUNDS.lonMin, lat: JAPAN_BOUNDS.latMin },
      { lon: JAPAN_BOUNDS.lonMax, lat: JAPAN_BOUNDS.latMax },
      ...pins,
    ]),
    0.04
  );
  drawLand(projection);

  // --- 近いピンを1つの印にまとめる ---
  const clusters = [];
  for (const pin of pins) {
    const [x, y] = projection.project(pin.lon, pin.lat);
    const near = clusters.find((c) => Math.hypot(c.x - x, c.y - y) <= CLUSTER_UNITS);
    if (near) {
      near.pins.push(pin);
    } else {
      clusters.push({ x, y, pins: [pin] });
    }
  }

  for (const cluster of clusters) {
    // 2件以上まとまっているときだけ、件数を書く
    const label = cluster.pins.length > 1 ? String(cluster.pins.length) : '';
    drawMarker(cluster.x, cluster.y, label, () => {
      mode = 'area';
      areaPinIds = cluster.pins.map((pin) => pin.id);
      myPosition = null;
      statusEl.textContent = '';
      render();
    });
  }

  titleEl.textContent = 'ピンの地図';
  noteEl.textContent = (pins.length === 0)
    ? 'ピンを打つと、ここに印が出ます。'
    : '印を押すと、その海域を拡大します。印の数字は、まとめたピンの件数です。';
  areaBox.hidden = true;
}

// ---------- 海域の表示 ----------

// 縮尺の棒に使う、きりのよい長さを選ぶ（例: 最大 730m なら 500m）。
// 返す値: { meters: 長さ, label: 表示する文字 }
function niceLength(maxMeters) {
  // 海里の設定で、ある程度広い範囲なら、海里できりのよい数字にする
  const useNm = getSetting('distanceUnit') === 'nm' && maxMeters >= 185.2;
  const base = useNm ? 1852 : 1;

  const max = maxMeters / base;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [5, 2, 1].find((n) => n * power <= max) * power;
  // 0.30000000000000004 のような端数を消す
  const value = Number(step.toPrecision(1));

  if (useNm) return { meters: value * 1852, label: value + ' NM' };
  if (value >= 1000) return { meters: value, label: (value / 1000) + ' km' };
  return { meters: value, label: value + ' m' };
}

function renderArea() {
  const areaPins = pins.filter((pin) => areaPinIds.includes(pin.id));
  const points = myPosition ? [...areaPins, myPosition] : areaPins;

  const projection = makeProjection(boundsOf(points), 0.18, MIN_AREA_M / METERS_PER_DEG);
  const widthM = SIZE * projection.metersPerUnit;

  const showLand = widthM >= LAND_MIN_WIDTH_M;
  if (showLand) drawLand(projection);

  // --- 北の印（右上） ---
  svg.append(el('path', { class: 'map-north', d: 'M930 40 L960 110 L930 95 L900 110 Z' }));
  svg.append(el('text', { class: 'map-label', x: 930, y: 160, 'text-anchor': 'middle' }, '北'));

  // --- 縮尺の棒（左下） ---
  const bar = niceLength(300 * projection.metersPerUnit);
  const barUnits = bar.meters / projection.metersPerUnit;
  svg.append(el('path', {
    class: 'map-scale',
    d: 'M40 930 V960 H' + (40 + barUnits).toFixed(1) + ' V930',
  }));
  svg.append(el('text', { class: 'map-label', x: 40, y: 915 }, bar.label));

  // --- 現在地（ひし形） ---
  if (myPosition) {
    const [x, y] = projection.project(myPosition.lon, myPosition.lat);
    svg.append(el('path', {
      class: 'map-me',
      d: 'M' + x + ' ' + (y - 40) + ' L' + (x + 40) + ' ' + y +
         ' L' + x + ' ' + (y + 40) + ' L' + (x - 40) + ' ' + y + ' Z',
    }));
  }

  // --- ピン（番号つき）。番号1が上に重なるよう、後ろから描く ---
  areaPins.map((pin, index) => ({ pin, number: index + 1 })).reverse().forEach(({ pin, number }) => {
    const [x, y] = projection.project(pin.lon, pin.lat);
    drawMarker(x, y, String(number), () => {
      location.hash = '#pin/' + pin.id;
    });
  });

  // --- 地図の下の一覧（番号は地図と同じ） ---
  listEl.textContent = '';
  areaPins.forEach((pin, index) => {
    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = '#pin/' + pin.id;

    const name = document.createElement('div');
    name.className = 'row-main';
    name.textContent = (index + 1) + '　' + pin.name;
    link.append(name);

    // 現在地が分かっていれば、そこからの距離も出す
    if (myPosition) {
      const distance = document.createElement('div');
      distance.className = 'row-sub';
      distance.textContent = '現在地から ' + formatDistance(
        distanceM(myPosition.lat, myPosition.lon, pin.lat, pin.lon),
        getSetting('distanceUnit')
      );
      link.append(distance);
    }

    const item = document.createElement('li');
    item.append(link);
    listEl.append(item);
  });

  titleEl.textContent = 'この海域のピン（' + areaPins.length + '件）';
  noteEl.textContent =
    '北が上です。丸の番号は下の一覧と同じです。' +
    (myPosition ? 'ひし形が現在地です。' : '') +
    (showLand ? '陸地の形はおおまかです。' : 'この縮尺では陸地は描きません。');
  areaBox.hidden = false;
}

// ---------- 描き直す ----------

function render() {
  svg.textContent = '';

  // 海域に出すピンが全部消えていたら、日本全体に戻す
  if (mode === 'area' && !pins.some((pin) => areaPinIds.includes(pin.id))) {
    mode = 'japan';
  }

  if (mode === 'area') {
    renderArea();
  } else {
    renderJapan();
  }
}

// ---------- 現在地を表示 ----------

async function onLocate() {
  locateButton.disabled = true;
  statusEl.textContent = '位置を調べています…';

  try {
    const position = await getBestPosition({
      onProgress: (p) => {
        statusEl.textContent = '位置を調べています… 精度 ±' + Math.round(p.accuracyM) + 'm';
      },
    });
    myPosition = { lat: position.lat, lon: position.lon };

    // いちばん近いピンを探して知らせる
    const areaPins = pins.filter((pin) => areaPinIds.includes(pin.id));
    let nearest = null;
    for (const pin of areaPins) {
      const distance = distanceM(position.lat, position.lon, pin.lat, pin.lon);
      if (!nearest || distance < nearest.distance) {
        nearest = { pin, distance };
      }
    }
    statusEl.textContent = nearest
      ? 'いちばん近いピン：' + nearest.pin.name + '（' +
        formatDistance(nearest.distance, getSetting('distanceUnit')) + '）'
      : '';

    // 画面を離れている間に終わった場合は、描き直さない
    if (mode === 'area') render();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    locateButton.disabled = false;
  }
}

// ---------- home.js から呼ばれるもの ----------

// 最初に1回だけ
export function initPinMap() {
  locateButton.addEventListener('click', onLocate);
  backButton.addEventListener('click', () => {
    mode = 'japan';
    myPosition = null;
    statusEl.textContent = '';
    render();
  });
}

// ホーム画面を表示するたび
export async function showPinMap() {
  pins = await getPinsNewestFirst();
  // 現在地は古くなっているかもしれないので、いったん消す
  myPosition = null;
  statusEl.textContent = '';
  render();
}
