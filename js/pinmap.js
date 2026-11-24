// ============================================================
// pinmap.js — ホーム画面の「ピンの地図」
//
// 2つの表示を切り替える。
//   日本全体 : 日本の輪郭の上に、ピンのある場所を印で示す。
//              近いピンは1つの印にまとめ、件数を書く。印を押すと「海域」に切り替わる
//   海域     : 押した印のピンだけを拡大して、位置関係を示す（北が上、縮尺つき）。
//              「現在地を表示」を押すと、自分の位置と、いちばん近いピンが分かる。
//              「Googleマップで見る」を押すと、本物の地図でその海域を開く
//
// 地図の画像は使わず、輪郭のデータ（japan.js）から自分で描く。
// だから圏外でも動く。ピンの位置が外に送られるのは、
// 「Googleマップで見る」を自分で押したときだけ。
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
// 沖縄まで入れると本州が小さくなりすぎるので、沖縄・奄美は左上の枠に分けて描く。
// どちらの範囲にも入らないピン（小笠原など）があれば、そこまで自動で広げる
const JAPAN_BOUNDS = { lonMin: 128.5, lonMax: 146.0, latMin: 30.5, latMax: 45.7 };
// 左上の枠に描く範囲（沖縄・奄美）
const OKINAWA_BOUNDS = { lonMin: 122.8, lonMax: 130.2, latMin: 24.0, latMax: 28.8 };
// その枠を置く場所と大きさ（方眼紙の目盛りで）。日本海の、何も無いところに置く
const OKINAWA_BOX = { x: 20, y: 20, size: 330 };
// 日本全体の表示で、これより近い印は1つにまとめる（方眼紙の目盛りで）
const CLUSTER_UNITS = 70;
// 海域の表示で、これより狭くは拡大しない（メートル）。ピンが1つだけのときのため
const MIN_AREA_M = 300;
// 海域の表示がこれより狭いとき（メートル）、左上に広域図を出す
const INSET_BELOW_M = 100000;
// 広域図に描く範囲の幅（メートル）
const INSET_WIDTH_M = 250000;
// 海域の表示の背景に使う、国土地理院の地図（地理院タイル・標準地図）。
// {z} が拡大の度合い、{x} {y} がタイル（小さな地図の画像）の番号
const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const TILE_PX = 256;
const TILE_MIN_ZOOM = 5;
const TILE_MAX_ZOOM = 18;
// Googleマップで開くときの、画面の幅の目安（ピクセル）。拡大の度合いを決めるのに使う
const GOOGLE_MAP_SCREEN_PX = 400;

const titleEl = document.getElementById('pinmap-title');
const svg = document.getElementById('pinmap-svg');
const noteEl = document.getElementById('pinmap-note');
const areaBox = document.getElementById('pinmap-area');
const listEl = document.getElementById('pinmap-list');
const locateButton = document.getElementById('pinmap-locate');
const statusEl = document.getElementById('pinmap-status');
const backButton = document.getElementById('pinmap-back');
const googleLink = document.getElementById('pinmap-google');
const googleStatus = document.getElementById('pinmap-google-status');

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

// 海域の表示で使う変換の道具。makeProjection と同じ使い方だが、
// 国土地理院の地図（メルカトル図法）とぴったり重なる計算にしてある。
//   minWidthM  これより狭い範囲は、この幅（メートル）まで広げて表示する
// 中では、地球全体を 0〜1 の正方形にした位置（左上が 0,0）を使う。
function makeMapProjection(bounds, pad, minWidthM) {
  const toX = (lon) => (lon + 180) / 360;
  const toY = (lat) => {
    const rad = lat * Math.PI / 180;
    return (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2;
  };

  const centerX = (toX(bounds.lonMin) + toX(bounds.lonMax)) / 2;
  const centerY = (toY(bounds.latMin) + toY(bounds.latMax)) / 2;
  const latCenter = (bounds.latMin + bounds.latMax) / 2;
  // この緯度で、地球を東西にひと回りした長さ（メートル）
  const aroundM = 360 * METERS_PER_DEG * Math.cos(latCenter * Math.PI / 180);

  const needed = Math.max(
    toX(bounds.lonMax) - toX(bounds.lonMin),
    toY(bounds.latMin) - toY(bounds.latMax),
    minWidthM / aroundM
  );
  // 画面に映る幅（0〜1 の正方形での長さ）
  const span = needed / (1 - 2 * pad);
  const scale = SIZE / span;

  return {
    project: (lon, lat) => [
      SIZE / 2 + (toX(lon) - centerX) * scale,
      SIZE / 2 + (toY(lat) - centerY) * scale,
    ],
    metersPerUnit: aroundM * span / SIZE,
    // 地図の画像を並べるときに使う
    centerX, centerY, span,
  };
}

// 国土地理院の地図の画像（タイル）を、海域の表示の背景に並べる
function drawTiles(projection) {
  const { centerX, centerY, span } = projection;
  // タイル1枚が、画面上でおよそ256ピクセルになる拡大の度合いを選ぶ
  const screenPx = svg.clientWidth || 340;
  const ideal = Math.log2(screenPx / (TILE_PX * span));
  const zoom = Math.min(TILE_MAX_ZOOM, Math.max(TILE_MIN_ZOOM, Math.round(ideal)));
  const count = 2 ** zoom;               // この拡大での、タイルの枚数（縦・横それぞれ）
  const size = SIZE / (span * count);    // タイル1枚の大きさ（方眼紙の目盛りで）

  const group = el('g', { class: 'map-tiles' });
  const first = (c) => Math.max(0, Math.floor((c - span / 2) * count));
  const last = (c) => Math.min(count - 1, Math.floor((c + span / 2) * count));
  for (let tx = first(centerX); tx <= last(centerX); tx++) {
    for (let ty = first(centerY); ty <= last(centerY); ty++) {
      const image = el('image', {
        href: TILE_URL.replace('{z}', zoom).replace('{x}', tx).replace('{y}', ty),
        x: (SIZE / 2 + (tx / count - centerX) * SIZE / span).toFixed(2),
        y: (SIZE / 2 + (ty / count - centerY) * SIZE / span).toFixed(2),
        // すき間が見えないよう、ほんの少し大きめに描く
        width: (size + 0.5).toFixed(2),
        height: (size + 0.5).toFixed(2),
        preserveAspectRatio: 'none',
      });
      // 沖合など、画像が無い場所は何も出さない（下の輪郭が見える）
      image.addEventListener('error', () => image.remove());
      group.append(image);
    }
  }
  svg.append(group);
}

// 日本の輪郭を描く。
// rough が true のときは、うすい色と点線で描く（拡大すると形のずれが目立つので、
// 「おおよその形」だと見て分かるようにする）
// target は描く先（省略すると地図の本体）
function drawLand(projection, rough = false, target = svg) {
  let d = '';
  for (const ring of JAPAN_OUTLINE) {
    ring.forEach(([lon, lat], index) => {
      const [x, y] = projection.project(lon, lat);
      d += (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    d += 'Z';
  }
  target.append(el('path', { class: rough ? 'map-land map-land-rough' : 'map-land', d }));
}

// 押せる印を1つ描く。label は印の中の文字、onTap は押したときの処理
// planned が true なら、予定のピンの色（紺）で描く
function drawMarker(x, y, label, onTap, planned = false) {
  const group = el('g', { class: 'map-marker' });
  // 見えない大きな丸。指で押しやすいよう、当たり判定を広げる
  group.append(el('circle', { class: 'map-tap', cx: x, cy: y, r: 70 }));
  group.append(el('circle', {
    class: planned ? 'map-pin map-pin-planned' : 'map-pin', cx: x, cy: y, r: 36,
  }));
  if (label !== '') {
    group.append(el('text', { class: 'map-pin-text', x, y }, label));
  }
  group.addEventListener('click', onTap);
  svg.append(group);
}

// 予定のピンが1つでもあれば、色の意味を説明する文を返す
function plannedNote() {
  return pins.some((pin) => pin.planned) ? '紺色の印は、行く前に登録した予定の場所です。' : '';
}

// ---------- 日本全体の表示 ----------

// ピンが沖縄・奄美の範囲にあるか
function isInOkinawa(pin) {
  return pin.lon >= OKINAWA_BOUNDS.lonMin && pin.lon <= OKINAWA_BOUNDS.lonMax &&
         pin.lat >= OKINAWA_BOUNDS.latMin && pin.lat <= OKINAWA_BOUNDS.latMax;
}

function renderJapan() {
  // ふつうは日本の範囲。日本の外にピンがあれば、そこまで広げる
  // （沖縄・奄美のピンは左上の枠に描くので、ここでは数えない）
  const projection = makeProjection(
    boundsOf([
      { lon: JAPAN_BOUNDS.lonMin, lat: JAPAN_BOUNDS.latMin },
      { lon: JAPAN_BOUNDS.lonMax, lat: JAPAN_BOUNDS.latMax },
      ...pins.filter((pin) => !isInOkinawa(pin)),
    ]),
    0.04
  );
  drawLand(projection);

  // --- 沖縄・奄美の枠（左上） ---
  // 紙の日本地図と同じやり方。本来の位置に描くと本州が小さくなるので、
  // 空いている左上に、枠で囲んで描く
  const okinawaProjection = makeProjection(OKINAWA_BOUNDS, 0.06);
  const box = el('svg', {
    class: 'map-inset', x: OKINAWA_BOX.x, y: OKINAWA_BOX.y,
    width: OKINAWA_BOX.size, height: OKINAWA_BOX.size, viewBox: '0 0 1000 1000',
  });
  box.append(el('rect', { class: 'map-inset-sea', x: 0, y: 0, width: 1000, height: 1000 }));
  drawLand(okinawaProjection, false, box);
  box.append(el('rect', { class: 'map-inset-frame', x: 0, y: 0, width: 1000, height: 1000 }));
  svg.append(box);
  svg.append(el('text', {
    class: 'map-label map-label-small',
    x: OKINAWA_BOX.x + 12, y: OKINAWA_BOX.y + OKINAWA_BOX.size - 14,
  }, '沖縄・奄美'));

  // ピンを、地図の上の位置に変換する（沖縄・奄美のピンは枠の中の位置に）
  const place = (pin) => {
    if (!isInOkinawa(pin)) return projection.project(pin.lon, pin.lat);
    const [x, y] = okinawaProjection.project(pin.lon, pin.lat);
    const ratio = OKINAWA_BOX.size / SIZE;
    return [OKINAWA_BOX.x + x * ratio, OKINAWA_BOX.y + y * ratio];
  };

  // --- 近いピンを1つの印にまとめる ---
  const clusters = [];
  for (const pin of pins) {
    const [x, y] = place(pin);
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
    // まとめた中身が全部「予定のピン」のときだけ、紺色にする
    }, cluster.pins.every((pin) => pin.planned));
  }

  titleEl.textContent = 'ピンの地図';
  noteEl.textContent = (pins.length === 0)
    ? 'ピンを打つと、ここに印が出ます。'
    : '印を押すと、その海域を拡大します。印の数字は、まとめたピンの件数です。' + plannedNote();
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

  const projection = makeMapProjection(boundsOf(points), 0.18, MIN_AREA_M);
  const widthM = SIZE * projection.metersPerUnit;

  // 陸地を、うすい色で描く。どのあたりの海かを知るための目安。
  // 輪郭はおおまかで、数kmずれることがある（ピンがせまい範囲に集まっていると、
  // 陸地が画面に入らず、白いままのこともある）
  drawLand(projection, true);

  // --- 本物の地図（国土地理院）を重ねる ---
  // 電波のあるときだけ。圏外のとき、画像が取れなかったときは、上の輪郭がそのまま見える
  const useTiles = navigator.onLine;
  if (useTiles) {
    drawTiles(projection);
    svg.append(el('text', {
      class: 'map-label map-label-small', x: 980, y: 985, 'text-anchor': 'end',
    }, '地図：国土地理院'));
  }

  // --- 広域図（左上の小さな地図） ---
  // 拡大していると陸地が画面に入らないので、まわり約250kmを小さく描いて、
  // 「どのあたりの海か」が分かるようにする。オレンジの点が、この海域の場所。
  // 本物の地図が出ているときは、地名で場所が分かるので出さない
  if (!useTiles && widthM < INSET_BELOW_M) {
    const center = boundsOf(areaPins);
    const centerLon = (center.lonMin + center.lonMax) / 2;
    const centerLat = (center.latMin + center.latMax) / 2;
    const insetProjection = makeProjection(
      { lonMin: centerLon, lonMax: centerLon, latMin: centerLat, latMax: centerLat },
      0,
      INSET_WIDTH_M / METERS_PER_DEG
    );
    // 入れ子のSVG。中は 0〜1000 の方眼紙で、はみ出した分は自動で切り取られる
    const inset = el('svg', {
      class: 'map-inset', x: 20, y: 20, width: 300, height: 300, viewBox: '0 0 1000 1000',
    });
    inset.append(el('rect', { class: 'map-inset-sea', x: 0, y: 0, width: 1000, height: 1000 }));
    drawLand(insetProjection, false, inset);
    inset.append(el('circle', { class: 'map-inset-dot', cx: 500, cy: 500, r: 45 }));
    inset.append(el('rect', { class: 'map-inset-frame', x: 0, y: 0, width: 1000, height: 1000 }));
    svg.append(inset);
  }

  // --- 「Googleマップで見る」の行き先 ---
  // ピンが1つなら、その位置に印を付けて開く。
  // 2つ以上なら、この海域の真ん中を、同じくらいの広さで開く（印は付かない）
  if (areaPins.length === 1) {
    googleLink.href = 'https://www.google.com/maps/search/?api=1&query=' +
      areaPins[0].lat + ',' + areaPins[0].lon;
  } else {
    const box = boundsOf(areaPins);
    const lat = (box.latMin + box.latMax) / 2;
    const lon = (box.lonMin + box.lonMax) / 2;
    // Googleマップの拡大の度合い（数字が大きいほど拡大）。
    // 画面の幅に、この海域がちょうど収まるくらいの値を計算する
    const zoom = Math.log2(
      GOOGLE_MAP_SCREEN_PX * 156543 * Math.cos(lat * Math.PI / 180) / widthM
    );
    googleLink.href = 'https://www.google.com/maps/@?api=1&map_action=map&center=' +
      lat.toFixed(6) + ',' + lon.toFixed(6) +
      '&zoom=' + Math.min(18, Math.max(3, Math.floor(zoom)));
  }
  googleStatus.textContent = '';

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
    }, pin.planned);
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
    (useTiles
      ? '地図は国土地理院のものです（圏外では、おおよその輪郭だけになります）。'
      : (widthM < INSET_BELOW_M ? '左上の小さな地図は、まわり約250kmです（オレンジの点がこの海域）。' : '') +
        '灰色は陸地のおおよその形で、数kmずれることがあります。') +
    plannedNote();
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
  // 電波がつながった・切れたとき、海域の表示を描き直す（地図と輪郭を切り替える）
  const onNetworkChange = () => {
    if (mode === 'area') render();
  };
  window.addEventListener('online', onNetworkChange);
  window.addEventListener('offline', onNetworkChange);
  googleLink.addEventListener('click', (event) => {
    // 圏外では地図を開けないので、リンクを止めて理由を伝える
    if (!navigator.onLine) {
      event.preventDefault();
      googleStatus.textContent = '圏外です。電波のある場所で使えます。';
    }
  });
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
