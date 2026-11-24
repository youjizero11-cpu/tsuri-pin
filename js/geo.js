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
