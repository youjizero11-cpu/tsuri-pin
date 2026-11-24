// ============================================================
// geo.js — 位置情報（GPS）に関すること
//   ・現在地を、できるだけ良い精度で取る
//   ・緯度経度を、画面に出す形にする
// ============================================================

// 現在地を取る。
//
// GPSは、動かし始めた直後は誤差が大きく、数秒かけて良くなっていく。
// そこで、しばらく受け取り続けて「いちばん誤差の小さい値」を採用する。
//
//   ・誤差が goodEnoughM（10m）以下の値が来たら、そこで終わり
//   ・1つでも取れていれば、improveMs（10秒）で打ち切る
//   ・1つも取れていない間は、firstFixMs（30秒）まで待つ
//     （圏外で久しぶりにGPSを使うと、最初の1回に時間がかかるため）
//
// 終わったら必ずGPSを止める（電池の節約）。
//
// 返す値: { lat, lon, accuracyM }
// onProgress: 途中経過を画面に出したいときに渡す関数
export function getBestPosition({
  goodEnoughM = 10,
  improveMs = 10000,
  firstFixMs = 30000,
  onProgress = () => {},
} = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('この端末では位置情報が使えません。'));
      return;
    }

    let best = null;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(improveTimer);
      clearTimeout(firstFixTimer);
      if (best) {
        resolve(best);
      } else {
        reject(new Error('位置が取れませんでした。空が見える場所で、もう一度押してください。'));
      }
    }

    const watchId = navigator.geolocation.watchPosition(
      // 位置が届くたびに呼ばれる
      (position) => {
        const current = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        };
        if (!best || current.accuracyM < best.accuracyM) {
          best = current;
          onProgress(best);
        }
        if (best.accuracyM <= goodEnoughM) {
          finish();
        }
      },
      // エラーのときに呼ばれる
      (error) => {
        // 許可されていない場合は、待っても取れないのですぐ終わる
        if (error.code === error.PERMISSION_DENIED) {
          best = null;
          finished = true;
          navigator.geolocation.clearWatch(watchId);
          clearTimeout(improveTimer);
          clearTimeout(firstFixTimer);
          reject(new Error('位置情報が許可されていません。端末の設定で、このアプリの位置情報を許可してください。'));
        }
        // それ以外（一時的に取れない等）は、時間切れまで待ち続ける
      },
      {
        enableHighAccuracy: true, // GPSを使った高精度モード
        maximumAge: 0,            // 古い位置を使い回さない
      }
    );

    // 10秒たった時点で1つでも取れていれば終わる
    const improveTimer = setTimeout(() => {
      if (best) finish();
    }, improveMs);

    // 30秒たったら、取れていなくても終わる
    const firstFixTimer = setTimeout(finish, firstFixMs);
  });
}

// これより誤差が大きいときは「精度が低い」と知らせる（メートル）
export const LOW_ACCURACY_M = 30;

// ---------- 2点間の距離 ----------

// 2つの緯度経度のあいだの距離をメートルで返す。
// 地球を球とみなして計算する「ハーバーサインの公式」。通信は使わない。
export function distanceM(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// ---------- 2点間の方位 ----------

// 地点1から見て、地点2がどの方角にあるかを返す。
// 北が0度、東が90度、南が180度、西が270度（時計回り）。
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const toDeg = (rad) => rad * 180 / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 角度を8方位の名前にする（例: 45 → 「北東」）
export function directionName(deg) {
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return names[Math.round(deg / 45) % 8];
}

// 1海里は1852メートル
const METERS_PER_NM = 1852;

// 距離を画面に出す形にする
//   unit 'm' : 「350 m」「2.4 km」
//   unit 'nm': 「1.3 NM」（海里）。0.1海里より近ければ「150 m」
export function formatDistance(meters, unit = 'm') {
  if (unit === 'nm') {
    const nm = meters / METERS_PER_NM;
    if (nm >= 0.1) {
      return (nm < 100 ? nm.toFixed(1) : Math.round(nm)) + ' NM';
    }
    return Math.round(meters) + ' m';
  }

  if (meters < 1000) {
    return Math.round(meters) + ' m';
  }
  const km = meters / 1000;
  return (km < 100 ? km.toFixed(1) : Math.round(km)) + ' km';
}

// ---------- 緯度経度の表示 ----------

// 1つの値を「34°12.345′N」の形（度分）にする
function toDegMin(value, positiveMark, negativeMark) {
  // 分の1000分の1の単位で四捨五入してから、度と分に分ける
  // （先に分けると「59.9996分」が「60.000分」と表示されてしまう）
  const total = Math.round(Math.abs(value) * 60 * 1000);
  const deg = Math.floor(total / 60000);
  const min = (total - deg * 60000) / 1000;
  const mark = value >= 0 ? positiveMark : negativeMark;
  return deg + '°' + min.toFixed(3).padStart(6, '0') + '′' + mark;
}

// 緯度経度を画面に出す形にする
//   format 'dm': 34°12.345′N 135°07.407′E（度分。船のGPS機器で一般的）
//   format 'dd': 34.20575, 135.12345（10進。Googleマップと同じ）
export function formatCoord(lat, lon, format = 'dm') {
  if (format === 'dd') {
    return lat.toFixed(5) + ', ' + lon.toFixed(5);
  }
  return toDegMin(lat, 'N', 'S') + ' ' + toDegMin(lon, 'E', 'W');
}

// ピンの場所を画面に出す形にする。後ろに、位置の確かさを付ける。
//   ふつうのピン : 34°12.345′N 135°07.407′E（±5m）   … GPSで測った位置
//   予定のピン   : 34°12.345′N 135°07.407′E（予定の場所） … 地図や数字で決めた位置
export function formatPinCoord(pin, format = 'dm') {
  const tail = pin.planned ? '（予定の場所）' : '（±' + pin.accuracyM + 'm）';
  return formatCoord(pin.lat, pin.lon, format) + tail;
}

// 入力された文字から、緯度と経度を読み取る。読み取れなければ null。
// 次の2つの書き方に対応する（記号や空白は多少違っていてもよい）
//   10進  : 33.6586, 130.2368          （Googleマップでコピーした形）
//   度分  : 33°39.512′N 130°14.208′E   （このアプリや船のGPS機器の形）
// 返す値: { lat, lon }
export function parseCoord(text) {
  // 全角の数字や記号を半角にそろえる
  const normalized = String(text)
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/、/g, ',');
  // 文字の中から数字だけを順に取り出す
  const numbers = (normalized.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

  let lat;
  let lon;
  if (numbers.length === 2) {
    [lat, lon] = numbers;
  } else if (numbers.length === 4) {
    // 度と分。分は 60 で割って度に直す
    const [latDeg, latMin, lonDeg, lonMin] = numbers;
    if (latMin >= 60 || lonMin >= 60 || latMin < 0 || lonMin < 0) return null;
    lat = Math.abs(latDeg) + latMin / 60;
    lon = Math.abs(lonDeg) + lonMin / 60;
    // 南緯（S）・西経（W）ならマイナスにする
    if (/S/i.test(normalized) || latDeg < 0) lat = -lat;
    if (/W/i.test(normalized) || lonDeg < 0) lon = -lon;
  } else {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
