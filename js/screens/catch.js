// ============================================================
// catch.js — 釣果の入力画面
//
// 同じ画面を3つの場面で使う。
//   1. ピンを打った直後（かんたん入力）: 魚種・匹数・写真だけ見せる
//   2. 釣果の編集: 全項目を見せる。削除もできる
//   3. 釣果の追加: 全項目を見せる。保存するまでデータは作らない
// ============================================================

import { get, saveAll, getSpeciesList } from '../db.js';
import { resizePhoto } from '../photo.js';
import { formatCoord, LOW_ACCURACY_M } from '../geo.js';
import { newId, toIsoLocal } from '../util.js';

// ---------- 画面の部品 ----------

const titleEl = document.getElementById('catch-title');
const messageEl = document.getElementById('catch-message');
const subEl = document.getElementById('catch-sub');

const photoPreview = document.getElementById('catch-photo-preview');
const photoStatus = document.getElementById('catch-photo-status');
const photoCamera = document.getElementById('catch-photo-camera');
const photoLibrary = document.getElementById('catch-photo-library');
const photoRemove = document.getElementById('catch-photo-remove');

const speciesInput = document.getElementById('catch-species');
const speciesOptions = document.getElementById('species-options');
const countInput = document.getElementById('catch-count');
const detailsEl = document.getElementById('catch-details');
const sizeInput = document.getElementById('catch-size');
const depthInput = document.getElementById('catch-depth');
const tanaInput = document.getElementById('catch-tana');
const rigInput = document.getElementById('catch-rig');
const memoInput = document.getElementById('catch-memo');
const dateInput = document.getElementById('catch-date');

const saveButton = document.getElementById('catch-save');
const moreButton = document.getElementById('catch-more');
const cancelButton = document.getElementById('catch-cancel');
const deleteButton = document.getElementById('catch-delete');

// ---------- いま編集しているもの ----------

let current = null;       // 編集中の釣果
let quickMode = false;    // かんたん入力か
let photoBlob = null;     // 画面に出ている写真（なければ null）
let photoChanged = false; // 写真を変えたか（変えたときだけ保存し直す）
let photoUrl = null;      // 写真を表示するための一時的なURL

// ---------- 中身が空の釣果を作る ----------

export function createEmptyCatch(pinId, caughtAt) {
  return {
    id: newId(),
    pinId: pinId,
    caughtAt: caughtAt,
    species: '',
    sizeCm: null,
    count: null,
    depthM: null,
    tana: '',
    rig: '',
    memo: '',
    hasPhoto: false,
    updatedAt: caughtAt,
  };
}

// ---------- 画面を開く（app.js から呼ばれる） ----------

// 保存済みの釣果を開く。quick: true なら、ピンを打った直後のかんたん入力
export async function showCatch(catchId, { quick = false } = {}) {
  const record = await get('catches', catchId);
  if (!record) {
    location.hash = '#home';
    return;
  }
  const photo = record.hasPhoto ? await get('photos', catchId) : null;
  await open(record, { quick, isNew: false, photo: photo ? photo.blob : null });
}

// 新しい釣果を、いまの時刻で開く（保存を押すまでデータは作らない）
export async function showNewCatch(pinId) {
  const record = createEmptyCatch(pinId, toIsoLocal(new Date()));
  await open(record, { quick: false, isNew: true, photo: null });
}

async function open(record, { quick, isNew, photo }) {
  const pin = await get('pins', record.pinId);
  if (!pin) {
    location.hash = '#home';
    return;
  }

  current = record;
  quickMode = quick;
  photoBlob = photo;
  photoChanged = false;

  // --- 見出し ---
  messageEl.classList.remove('is-warning');
  if (quick) {
    titleEl.textContent = '釣果を入力';
    if (record.caughtAt === pin.createdAt) {
      // 新しいピンを打った直後
      if (pin.accuracyM > LOW_ACCURACY_M) {
        messageEl.textContent = 'ピンを保存しました（精度が低いです ±' + pin.accuracyM + 'm）';
        messageEl.classList.add('is-warning');
      } else {
        messageEl.textContent = 'ピンを保存しました（精度 ±' + pin.accuracyM + 'm）';
      }
    } else {
      // 近くのピンに追加した直後
      messageEl.textContent = '「' + pin.name + '」に追加しました';
    }
    subEl.textContent = formatCoord(pin.lat, pin.lon);
  } else {
    titleEl.textContent = isNew ? '釣果を追加' : '釣果の編集';
    messageEl.textContent = '';
    subEl.textContent = pin.name;
  }
  messageEl.hidden = !quick;

  // --- 入力欄に値を入れる ---
  speciesInput.value = record.species;
  countInput.value = record.count ?? '';
  sizeInput.value = record.sizeCm ?? '';
  depthInput.value = record.depthM ?? '';
  tanaInput.value = record.tana;
  rigInput.value = record.rig;
  memoInput.value = record.memo;
  // 日時の入力欄は「2026-11-24T06:12」の形（秒と +09:00 を除いた先頭16文字）
  dateInput.value = record.caughtAt.slice(0, 16);

  // --- 魚種の入力候補 ---
  speciesOptions.textContent = '';
  for (const name of await getSpeciesList()) {
    const option = document.createElement('option');
    option.value = name;
    speciesOptions.append(option);
  }

  // --- 場面に合わせて、見せるものを切り替える ---
  detailsEl.hidden = quick;
  moreButton.hidden = !quick;
  deleteButton.hidden = quick || isNew;
  cancelButton.textContent = quick ? 'あとで入力' : '戻る';

  showPhoto();
  photoStatus.textContent = '';
}

// ---------- 写真 ----------

function showPhoto() {
  // 前に表示していた写真のURLを片付ける
  if (photoUrl) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = null;
  }

  if (photoBlob) {
    photoUrl = URL.createObjectURL(photoBlob);
    photoPreview.src = photoUrl;
  } else {
    photoPreview.removeAttribute('src');
  }
  photoPreview.hidden = !photoBlob;
  photoRemove.hidden = !photoBlob;
}

async function onPhotoChosen(event) {
  const file = event.target.files[0];
  // 同じ写真をもう一度選べるように、入力欄を空に戻す
  event.target.value = '';
  if (!file) return;

  photoStatus.textContent = '写真を縮小しています…';
  try {
    photoBlob = await resizePhoto(file);
    photoChanged = true;
    showPhoto();
    photoStatus.textContent = '';
  } catch (error) {
    photoStatus.textContent = error.message;
  }
}

function onPhotoRemove() {
  photoBlob = null;
  photoChanged = true;
  showPhoto();
}

// ---------- 保存・削除・戻る ----------

// 入力欄の文字を数値にする（空なら null）
function toNumberOrNull(text) {
  if (text.trim() === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

// この画面を閉じたあとの行き先
function goBack() {
  location.hash = quickMode ? '#home' : '#pin/' + current.pinId;
}

async function onSave() {
  current.species = speciesInput.value.trim();
  current.count = toNumberOrNull(countInput.value);
  current.sizeCm = toNumberOrNull(sizeInput.value);
  current.depthM = toNumberOrNull(depthInput.value);
  current.tana = tanaInput.value.trim();
  current.rig = rigInput.value.trim();
  current.memo = memoInput.value.trim();
  // 日時を変えたときだけ書き換える（変えていなければ、秒まで元のまま残す）
  if (dateInput.value && dateInput.value !== current.caughtAt.slice(0, 16)) {
    current.caughtAt = toIsoLocal(new Date(dateInput.value));
  }
  current.hasPhoto = Boolean(photoBlob);
  current.updatedAt = toIsoLocal(new Date());

  const entries = [{ store: 'catches', value: current }];
  const deletions = [];
  if (photoChanged) {
    if (photoBlob) {
      entries.push({ store: 'photos', value: { catchId: current.id, blob: photoBlob } });
    } else {
      deletions.push({ store: 'photos', key: current.id });
    }
  }

  try {
    await saveAll(entries, deletions);
    goBack();
  } catch (error) {
    console.error(error);
    photoStatus.textContent = '保存できませんでした。端末の空き容量を確認してください。';
  }
}

async function onDelete() {
  if (!confirm('この釣果を削除しますか？\n写真も一緒に消えます。')) return;

  await saveAll([], [
    { store: 'catches', key: current.id },
    { store: 'photos', key: current.id },
  ]);
  goBack();
}

// ---------- 最初の準備（app.js から1回だけ呼ばれる） ----------

export function initCatch() {
  photoCamera.addEventListener('change', onPhotoChosen);
  photoLibrary.addEventListener('change', onPhotoChosen);
  photoRemove.addEventListener('click', onPhotoRemove);

  saveButton.addEventListener('click', onSave);
  cancelButton.addEventListener('click', goBack);
  deleteButton.addEventListener('click', onDelete);

  // 「くわしく入力」を押したら、残りの項目を出す
  moreButton.addEventListener('click', () => {
    detailsEl.hidden = false;
    moreButton.hidden = true;
  });
}
