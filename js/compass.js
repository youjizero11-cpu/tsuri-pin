// ============================================================
// compass.js — スマホのコンパス（どちらを向いているか）
//
// iPhone と Android で、向きの取り方が違う。
//   iPhone : 許可が必要。許可はボタンを押した直後にしか求められない。
//            向きは webkitCompassHeading（北から時計回りの角度）で届く
//   Android: 許可は不要。向きは alpha（北から反時計回りの角度）で届くので、
//            360 から引いて時計回りに直す
// ============================================================

// この端末は、コンパスを使う前に許可を求める必要があるか（iPhoneなら true）
export function compassNeedsPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
         typeof DeviceOrientationEvent.requestPermission === 'function';
}

// コンパスの許可を求める。許可されたら true。
// ★ 必ずボタンを押した処理の中から呼ぶこと（そうしないと iPhone が断る）
export async function requestCompassPermission() {
  try {
    const answer = await DeviceOrientationEvent.requestPermission();
    return answer === 'granted';
  } catch (error) {
    return false;
  }
}

// 画面が横向きに回っているときの角度（縦向きなら 0）
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  // 古い iPhone 用
  return typeof window.orientation === 'number' ? window.orientation : 0;
}

// コンパスを動かし始める。
// 向きが変わるたびに onHeading(角度) が呼ばれる。角度は「画面の上が向いている方角」で、
// 北が0度、東が90度（時計回り）。
// 返ってくる関数を呼ぶと止まる。
export function startCompass(onHeading) {
  function handle(event) {
    let heading = null;

    if (typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)) {
      // iPhone
      heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === 'number') {
      // Android
      heading = 360 - event.alpha;
    }

    if (heading === null) return;
    onHeading((heading + screenAngle() + 360) % 360);
  }

  // Android は「deviceorientationabsolute」、iPhone は「deviceorientation」
  const eventName = 'ondeviceorientationabsolute' in window
    ? 'deviceorientationabsolute'
    : 'deviceorientation';

  window.addEventListener(eventName, handle);
  return () => window.removeEventListener(eventName, handle);
}
