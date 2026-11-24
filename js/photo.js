// ============================================================
// photo.js — 写真を小さくする
//
// スマホのカメラの写真は1枚で数MBある。そのまま保存すると
// すぐに容量がいっぱいになるので、保存する前に縮小する。
//   ・長い方の辺を 1280px までに
//   ・JPEG形式、品質 0.8
// これで1枚あたり 200〜400KB ほどになる。
// ============================================================

// 画像ファイルを読み込んで <img> にする
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('写真を読み込めませんでした。'));
    img.src = url;
  });
}

// 写真ファイルを縮小して、保存用のデータ（Blob）を返す
export async function resizePhoto(file, maxSide = 1280, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);

    // 縮小する倍率（もともと小さい写真は、そのままの大きさ）
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    // canvas（お絵かき用の板）に小さく描いて、JPEGとして取り出す
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('写真を縮小できませんでした。')),
        'image/jpeg',
        quality
      );
    });
  } finally {
    // 読み込みに使った一時的なURLを片付ける
    URL.revokeObjectURL(url);
  }
}
