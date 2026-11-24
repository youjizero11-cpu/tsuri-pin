// ============================================================
// pin.js — ピンの詳細画面
//   ・ピンの場所（緯度経度・精度）
//   ・そのピンでの釣果の履歴
//   ・「釣果を追加」ボタン
// ============================================================

import { get, getCatchesOfPin } from '../db.js';
import { formatCoord } from '../geo.js';
import { formatDateTime } from '../util.js';

const titleEl = document.getElementById('pin-title');
const coordEl = document.getElementById('pin-coord');
const addLink = document.getElementById('pin-add-catch');
const catchList = document.getElementById('pin-catch-list');
const emptyEl = document.getElementById('pin-catch-empty');

// 釣果1件を、1行の説明にする（例: 「マダイ 42cm 2匹 写真あり」）
function summarize(record) {
  const parts = [record.species || '（魚種未入力）'];
  if (record.sizeCm !== null) parts.push(record.sizeCm + 'cm');
  if (record.count !== null) parts.push(record.count + '匹');
  if (record.hasPhoto) parts.push('写真あり');
  return parts.join(' ');
}

// 画面を開く（app.js から呼ばれる）
export async function showPin(pinId) {
  const pin = await get('pins', pinId);
  if (!pin) {
    location.hash = '#home';
    return;
  }

  titleEl.textContent = pin.name;
  coordEl.textContent = formatCoord(pin.lat, pin.lon) + '（±' + pin.accuracyM + 'm）';
  addLink.href = '#newcatch/' + pin.id;

  const catches = await getCatchesOfPin(pin.id);
  emptyEl.hidden = (catches.length > 0);
  catchList.textContent = '';

  for (const record of catches) {
    // 行全体をリンクにして、どこを押しても編集画面が開くようにする
    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = '#catch/' + record.id;

    const date = document.createElement('div');
    date.className = 'row-sub';
    date.textContent = formatDateTime(record.caughtAt);

    const summary = document.createElement('div');
    summary.className = 'row-main';
    summary.textContent = summarize(record);

    link.append(summary, date);

    const item = document.createElement('li');
    item.append(link);
    catchList.append(item);
  }
}
