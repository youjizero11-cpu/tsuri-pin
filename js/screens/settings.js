// ============================================================
// settings.js — 設定・データの画面
//   ・表示の設定（距離の単位、座標の形式、近くのピンを聞く距離）
//   ・CSV / バックアップ（JSON）の書き出し
//   ・バックアップの読み込み
//   ・保存しているデータの件数と、使っている容量
// ============================================================

import { getAll, get, saveAll } from '../db.js';
import { formatDateTime, toIsoLocal } from '../util.js';
import { getSetting, setSetting } from '../settings-store.js';
import {
  buildCsv, buildJson, readBackup, importBackup,
  canShareFile, shareFile, downloadFile,
} from '../export.js';

const distanceSelect = document.getElementById('set-distance');
const coordSelect = document.getElementById('set-coord');
const nearbySelect = document.getElementById('set-nearby');
const setStatus = document.getElementById('set-status');

const csvButton = document.getElementById('export-csv');
const jsonButton = document.getElementById('export-json');
const photosCheck = document.getElementById('export-photos');
const sendButton = document.getElementById('export-send');
const exportStatus = document.getElementById('export-status');

const importInput = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');

const dataEl = document.getElementById('info-data');
const storageEl = document.getElementById('info-storage');
const backupEl = document.getElementById('info-backup');

// 作ったけれど、まだ渡せていないファイル（「保存・共有する」ボタン用）
let pendingFile = null;

// ---------- 保存しているデータの件数と容量 ----------

async function showDataInfo() {
  const [pins, catches] = await Promise.all([getAll('pins'), getAll('catches')]);
  const photoCount = catches.filter((c) => c.hasPhoto).length;
  dataEl.textContent = 'ピン' + pins.length + '件・釣果' + catches.length + '件・写真' + photoCount + '枚';

  // 最後にバックアップを書き出した日時
  const lastBackup = await get('settings', 'lastBackupAt');
  backupEl.textContent = lastBackup ? formatDateTime(lastBackup.value) : 'まだありません';

  // 端末がこのアプリのために使っている容量（おおよその値）
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      storageEl.textContent = '約' + (usage / 1024 / 1024).toFixed(1) + ' MB';
    } catch (error) {
      storageEl.textContent = '不明';
    }
  } else {
    storageEl.textContent = '不明';
  }
}

// ---------- 画面を開く（app.js から呼ばれる） ----------

export async function showSettings() {
  distanceSelect.value = getSetting('distanceUnit');
  coordSelect.value = getSetting('coordFormat');
  nearbySelect.value = String(getSetting('nearbyM'));

  setStatus.textContent = '';
  exportStatus.textContent = '';
  importStatus.textContent = '';
  importStatus.classList.remove('is-warning');
  sendButton.hidden = true;
  pendingFile = null;

  await showDataInfo();
}

// ---------- 表示の設定 ----------

// 選び直したら、その場で保存する（保存ボタンは無い）
async function onSettingChange(key, value) {
  try {
    await setSetting(key, value);
    setStatus.textContent = '設定を保存しました。';
  } catch (error) {
    console.error(error);
    setStatus.textContent = '設定を保存できませんでした。';
  }
}

// ---------- 書き出し ----------

// 作ったファイルを渡す。
// 共有メニューが使える端末ではそれを開き、使えなければダウンロードする。
async function deliver(file) {
  if (!canShareFile(file)) {
    downloadFile(file);
    exportStatus.textContent = file.name + ' をダウンロードしました。';
    await rememberBackup(file);
    return;
  }

  try {
    await shareFile(file);
    exportStatus.textContent = file.name + ' を渡しました。';
    sendButton.hidden = true;
    pendingFile = null;
    await rememberBackup(file);
  } catch (error) {
    if (error.name === 'AbortError') {
      // 共有メニューを閉じただけ
      exportStatus.textContent = 'キャンセルしました。';
    } else if (error.name === 'NotAllowedError') {
      // ファイルを作るのに時間がかかると、端末が「ボタンを押した直後ではない」と
      // 判断して共有メニューを開かせてくれない。もう一度押してもらう。
      pendingFile = file;
      sendButton.hidden = false;
      exportStatus.textContent = 'ファイルの準備ができました。上の「保存・共有する」を押してください。';
    } else {
      downloadFile(file);
      exportStatus.textContent = file.name + ' をダウンロードしました。';
      await rememberBackup(file);
    }
  }
}

// バックアップ（JSON）を渡せたら、その日時を覚えておく。
// 設定画面の「最後のバックアップ」に出して、しばらく取っていないことに気づけるようにする。
async function rememberBackup(file) {
  if (!file.name.endsWith('.json')) return;
  try {
    await saveAll([{ store: 'settings', value: { key: 'lastBackupAt', value: toIsoLocal(new Date()) } }]);
    await showDataInfo();
  } catch (error) {
    console.error(error);
  }
}

async function onExport(build) {
  sendButton.hidden = true;
  pendingFile = null;
  exportStatus.textContent = 'ファイルを作っています…';
  csvButton.disabled = true;
  jsonButton.disabled = true;

  try {
    await deliver(await build());
  } catch (error) {
    console.error(error);
    exportStatus.textContent = '書き出せませんでした。写真を含めずに試してください。';
  } finally {
    csvButton.disabled = false;
    jsonButton.disabled = false;
  }
}

// ---------- 読み込み ----------

async function onImportChosen(event) {
  const file = event.target.files[0];
  // 同じファイルをもう一度選べるように、入力欄を空に戻す
  event.target.value = '';
  if (!file) return;

  importStatus.classList.remove('is-warning');
  importStatus.textContent = 'ファイルを確かめています…';

  try {
    const backup = await readBackup(file);

    const message =
      'ピン' + backup.pins.length + '件・釣果' + backup.catches.length + '件を取り込みます。\n' +
      (backup.photosIncluded ? '写真も含まれています。\n' : '写真は含まれていません。\n') +
      'この端末に同じものがあるときは、あとで更新された方を残します。\n' +
      'いまのデータが消えることはありません。';
    if (!confirm(message)) {
      importStatus.textContent = 'キャンセルしました。';
      return;
    }

    const result = await importBackup(backup);
    importStatus.textContent =
      '取り込みました（追加 ' + result.added + '件・更新 ' + result.updated +
      '件・そのまま ' + result.kept + '件）';
    await showDataInfo();
  } catch (error) {
    console.error(error);
    importStatus.textContent = error.message || '読み込めませんでした。';
    importStatus.classList.add('is-warning');
  }
}

// ---------- 最初の準備（app.js から1回だけ呼ばれる） ----------

export function initSettings() {
  distanceSelect.addEventListener('change', () => onSettingChange('distanceUnit', distanceSelect.value));
  coordSelect.addEventListener('change', () => onSettingChange('coordFormat', coordSelect.value));
  nearbySelect.addEventListener('change', () => onSettingChange('nearbyM', Number(nearbySelect.value)));

  csvButton.addEventListener('click', () => onExport(() => buildCsv()));
  jsonButton.addEventListener('click', () => onExport(() => buildJson({ withPhotos: photosCheck.checked })));

  // 準備済みのファイルを渡す（押した直後なので、共有メニューを開ける）
  sendButton.addEventListener('click', () => {
    if (pendingFile) deliver(pendingFile);
  });

  importInput.addEventListener('change', onImportChosen);
}
