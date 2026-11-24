// ============================================================
// util.js — あちこちで使う小さな道具
// ============================================================

// 重複しないIDを作る（例: "3f2a1c9e-...."）
export function newId() {
  return crypto.randomUUID();
}

// 数字を2桁にそろえる（7 → "07"）
function pad2(n) {
  return String(n).padStart(2, '0');
}

// 日時を保存用の文字列にする（例: "2026-11-24T06:12:33+09:00"）
// 最後の +09:00 は「日本時間」という意味。これがあると、どの国の時刻か迷わない。
export function toIsoLocal(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()) +
    sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60)
  );
}

// 画面に出す用の短い日時（例: "11/24 06:12"）
export function formatDateTime(isoString) {
  const d = new Date(isoString);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
