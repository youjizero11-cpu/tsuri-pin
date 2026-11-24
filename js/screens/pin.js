// ============================================================
// pin.js — ピンの詳細画面
//   ・ピンの場所（緯度経度・精度）
//   ・そのピンでの釣果の履歴、「釣果を追加」
//   ・名前とメモの編集
//   ・「地図で開く」（Googleマップ）
//   ・ピンの削除
// ============================================================

import { get, saveAll, getCatchesOfPin } from '../db.js';
import { formatPinCoord } from '../geo.js';
import { getSetting } from '../settings-store.js';
import { formatDateTime, toIsoLocal } from '../util.js';

const titleEl = document.getElementById('pin-title');
const coordEl = document.getElementById('pin-coord');
const addLink = document.getElementById('pin-add-catch');
const navLink = document.getElementById('pin-nav');
const catchList = document.getElementById('pin-catch-list');
const emptyEl = document.getElementById('pin-catch-empty');

const nameInput = document.getElementById('pin-name');
const memoInput = document.getElementById('pin-memo');
const saveButton = document.getElementById('pin-save');
const saveStatus = document.getElementById('pin-save-status');

const mapLink = document.getElementById('pin-map');
const mapStatus = document.getElementById('pin-map-status');
const deleteButton = document.getElementById('pin-delete');

// いま開いているピン
let current = null;

// 釣果1件を、1行の説明にする（例: 「マダイ 42cm 2匹 写真あり」）
function summarize(record) {
  const parts = [record.species || '（魚種未入力）'];
  if (record.sizeCm !== null) parts.push(record.sizeCm + 'cm');
  if (record.count !== null) parts.push(record.count + '匹');
  if (record.hasPhoto) parts.push('写真あり');
  return parts.join(' ');
}

// ---------- 画面を開く（app.js から呼ばれる） ----------

export async function showPin(pinId) {
  const pin = await get('pins', pinId);
  if (!pin) {
    location.hash = '#list';
    return;
  }
  current = pin;

  titleEl.textContent = pin.name;
  coordEl.textContent = formatPinCoord(pin, getSetting('coordFormat'));
  addLink.href = '#newcatch/' + pin.id;
  navLink.href = '#nav/' + pin.id;

  nameInput.value = pin.name;
  memoInput.value = pin.memo;
  saveStatus.textContent = '';
  mapStatus.textContent = '';

  // Googleマップでこの位置を開くURL。押したときだけ、位置がGoogleに送られる
  mapLink.href = 'https://www.google.com/maps/search/?api=1&query=' + pin.lat + ',' + pin.lon;

  // --- 釣果の履歴 ---
  const catches = await getCatchesOfPin(pin.id);
  emptyEl.hidden = (catches.length > 0);
  catchList.textContent = '';

  for (const record of catches) {
    // 行全体をリンクにして、どこを押しても編集画面が開くようにする
    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = '#catch/' + record.id;

    const summary = document.createElement('div');
    summary.className = 'row-main';
    summary.textContent = summarize(record);

    const date = document.createElement('div');
    date.className = 'row-sub';
    date.textContent = formatDateTime(record.caughtAt);

    link.append(summary, date);

    const item = document.createElement('li');
    item.append(link);
    catchList.append(item);
  }
}

// ---------- 名前とメモの保存 ----------

async function onSave() {
  // 名前を空にされたら、元の名前のままにする
  current.name = nameInput.value.trim() || current.name;
  current.memo = memoInput.value.trim();
  current.updatedAt = toIsoLocal(new Date());

  try {
    await saveAll([{ store: 'pins', value: current }]);
  } catch (error) {
    console.error(error);
    saveStatus.textContent = '保存できませんでした。端末の空き容量を確認してください。';
    return;
  }

  nameInput.value = current.name;
  titleEl.textContent = current.name;
  saveStatus.textContent = '保存しました。';
}

// ---------- 地図で開く ----------

function onMapClick(event) {
  // 圏外では地図を開けないので、リンクを止めて理由を伝える
  if (!navigator.onLine) {
    event.preventDefault();
    mapStatus.textContent = '圏外です。電波のある場所で使えます。';
  }
}

// ---------- ピンの削除 ----------

async function onDelete() {
  const catches = await getCatchesOfPin(current.id);

  const message =
    '「' + current.name + '」を削除しますか？\n' +
    'このピンの釣果' + catches.length + '件と写真も一緒に消えます。\n' +
    '元に戻せません。';
  if (!confirm(message)) return;

  // ピン本体と、ひもづく釣果・写真をまとめて消す
  const deletions = [{ store: 'pins', key: current.id }];
  for (const record of catches) {
    deletions.push({ store: 'catches', key: record.id });
    deletions.push({ store: 'photos', key: record.id });
  }
  try {
    await saveAll([], deletions);
  } catch (error) {
    console.error(error);
    alert('削除できませんでした。アプリを開き直して、もう一度試してください。');
    return;
  }

  location.hash = '#list';
}

// ---------- 最初の準備（app.js から1回だけ呼ばれる） ----------

export function initPin() {
  saveButton.addEventListener('click', onSave);
  mapLink.addEventListener('click', onMapClick);
  deleteButton.addEventListener('click', onDelete);
}
