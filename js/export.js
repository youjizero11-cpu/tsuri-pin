// ============================================================
// export.js — データの書き出しと読み込み
//
//   CSV  表計算ソフト（Excelなど）で見るためのもの。写真は入らない
//   JSON バックアップ用。全部のデータが入る。あとで読み込んで元に戻せる
//
// どちらも端末の中でファイルを作るだけで、どこにも送信しない。
// ============================================================

import { getAll, get, saveAll } from './db.js';
import { getAllSettings } from './settings-store.js';
import { toIsoLocal } from './util.js';

// バックアップの形式の版。将来、中身の形を変えたら上げる
const FORMAT_VERSION = 1;

// ファイル名に付ける今日の日付（例: 2026-11-24）
function today() {
  return toIsoLocal(new Date()).slice(0, 10);
}

// ---------- CSV ----------

// 1つの値を、CSVに書ける形にする。
// カンマ・改行・「"」が入っているときは、全体を「"」で囲む決まり。
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replaceAll('"', '""') + '"';
  }
  return text;
}

// 「2026-11-24T06:12:33+09:00」→「2026-11-24 06:12」
function csvDate(iso) {
  return iso.slice(0, 16).replace('T', ' ');
}

// CSVファイルを作る。釣果1件が1行。釣果のないピンは、場所だけの行にする
export async function buildCsv() {
  const pins = await getAll('pins');
  const catches = await getAll('catches');
  const pinById = new Map(pins.map((pin) => [pin.id, pin]));

  // 新しい釣果が上に来るように並べる
  catches.sort((a, b) => new Date(b.caughtAt) - new Date(a.caughtAt));

  const rows = [[
    '釣れた日時', 'ピン名', '緯度', '経度', '精度m',
    '魚種', 'サイズcm', '匹数', '水深m', 'タナ', '仕掛け/エサ', 'メモ', 'ピンのメモ',
  ]];

  const pinsWithCatch = new Set();
  for (const record of catches) {
    const pin = pinById.get(record.pinId);
    if (!pin) continue;
    pinsWithCatch.add(pin.id);
    rows.push([
      csvDate(record.caughtAt), pin.name, pin.lat, pin.lon, pin.accuracyM,
      record.species, record.sizeCm, record.count, record.depthM,
      record.tana, record.rig, record.memo, pin.memo,
    ]);
  }
  for (const pin of pins) {
    if (pinsWithCatch.has(pin.id)) continue;
    rows.push(['', pin.name, pin.lat, pin.lon, pin.accuracyM, '', '', '', '', '', '', '', pin.memo]);
  }

  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

  // 先頭の ﻿ は「BOM」という目印。これが無いと、Excelで日本語が文字化けする
  return new File(['﻿' + text], 'tsuri-pin_' + today() + '.csv', { type: 'text/csv' });
}

// ---------- JSON（バックアップ） ----------

// 写真（画像データ）を、文字列に変換する。JSONには文字しか入れられないため
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 文字列に変換された写真を、画像データに戻す。おかしなデータなら null
function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: match[1] });
  } catch (error) {
    return null;
  }
}

// バックアップのファイルを作る。withPhotos が true なら写真も入れる
export async function buildJson({ withPhotos }) {
  const data = {
    app: 'tsuri-pin',
    formatVersion: FORMAT_VERSION,
    exportedAt: toIsoLocal(new Date()),
    photosIncluded: withPhotos,
    settings: getAllSettings(),
    pins: await getAll('pins'),
    catches: await getAll('catches'),
    photos: [],
  };

  if (withPhotos) {
    for (const photo of await getAll('photos')) {
      data.photos.push({ catchId: photo.catchId, dataUrl: await blobToDataUrl(photo.blob) });
    }
  }

  return new File([JSON.stringify(data)], 'tsuri-pin_' + today() + '.json', { type: 'application/json' });
}

// ---------- 読み込み ----------

// 読み込んだ値を、決まった型にそろえる小さな道具
const toText = (value) => (typeof value === 'string' ? value : '');
const toNumberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const isDateText = (value) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

// ファイルの中のピン1件を確かめて、必要な項目だけ取り出す。おかしければ null
function cleanPin(raw) {
  if (!raw || typeof raw.id !== 'string' || raw.id === '') return null;
  const lat = toNumberOrNull(raw.lat);
  const lon = toNumberOrNull(raw.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!isDateText(raw.createdAt)) return null;
  return {
    id: raw.id,
    name: toText(raw.name) || 'ピン',
    lat,
    lon,
    accuracyM: toNumberOrNull(raw.accuracyM) ?? 0,
    memo: toText(raw.memo),
    createdAt: raw.createdAt,
    updatedAt: isDateText(raw.updatedAt) ? raw.updatedAt : raw.createdAt,
  };
}

// 釣果1件も同じように確かめる
function cleanCatch(raw) {
  if (!raw || typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.pinId !== 'string' || !isDateText(raw.caughtAt)) return null;
  return {
    id: raw.id,
    pinId: raw.pinId,
    caughtAt: raw.caughtAt,
    species: toText(raw.species),
    sizeCm: toNumberOrNull(raw.sizeCm),
    count: toNumberOrNull(raw.count),
    depthM: toNumberOrNull(raw.depthM),
    tana: toText(raw.tana),
    rig: toText(raw.rig),
    memo: toText(raw.memo),
    hasPhoto: raw.hasPhoto === true,
    updatedAt: isDateText(raw.updatedAt) ? raw.updatedAt : raw.caughtAt,
  };
}

// バックアップのファイルを読んで、中身を確かめる（この時点ではまだ保存しない）。
// 返す値: { pins, catches, photos（釣果ID → 写真の文字列）, photosIncluded }
export async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    throw new Error('ファイルを読めませんでした。このアプリで書き出したJSONファイルを選んでください。');
  }

  if (!data || data.app !== 'tsuri-pin' || !Array.isArray(data.pins) || !Array.isArray(data.catches)) {
    throw new Error('このアプリのバックアップではないようです。');
  }
  if (data.formatVersion !== FORMAT_VERSION) {
    throw new Error('新しい版のアプリで書き出されたファイルです。先に「最新版を確認」を押してください。');
  }

  const photos = new Map();
  if (Array.isArray(data.photos)) {
    for (const photo of data.photos) {
      if (photo && typeof photo.catchId === 'string') {
        photos.set(photo.catchId, photo.dataUrl);
      }
    }
  }

  return {
    pins: data.pins.map(cleanPin).filter(Boolean),
    catches: data.catches.map(cleanCatch).filter(Boolean),
    photos,
    photosIncluded: data.photosIncluded === true,
  };
}

// 読み込んだ中身を、いまのデータに合流させる。
//   ・この端末に無いものは追加する
//   ・同じIDのものがあれば、あとで更新された方を残す
// 返す値: { added, updated, kept }（追加・更新・そのままの件数）
export async function importBackup(backup) {
  const localPins = new Map((await getAll('pins')).map((pin) => [pin.id, pin]));
  const localCatches = new Map((await getAll('catches')).map((c) => [c.id, c]));

  const entries = [];
  const deletions = [];
  const result = { added: 0, updated: 0, kept: 0 };

  // 追加なら 'added'、ファイルの方が新しければ 'updated'、それ以外は 'kept'
  function decide(local, incoming) {
    if (!local) return 'added';
    return new Date(incoming.updatedAt) > new Date(local.updatedAt) ? 'updated' : 'kept';
  }

  for (const pin of backup.pins) {
    const action = decide(localPins.get(pin.id), pin);
    result[action] += 1;
    if (action !== 'kept') {
      entries.push({ store: 'pins', value: pin });
    }
  }

  // 釣果は、対応するピンがあるものだけ取り込む
  const knownPinIds = new Set([...localPins.keys(), ...backup.pins.map((pin) => pin.id)]);

  for (const record of backup.catches) {
    if (!knownPinIds.has(record.pinId)) continue;

    const local = localCatches.get(record.id);
    const action = decide(local, record);
    result[action] += 1;
    if (action === 'kept') continue;

    // --- 写真 ---
    if (record.hasPhoto) {
      const blob = dataUrlToBlob(backup.photos.get(record.id));
      if (blob) {
        entries.push({ store: 'photos', value: { catchId: record.id, blob } });
      } else {
        // ファイルに写真が入っていない。この端末に写真があればそれを残す
        const localPhoto = local && local.hasPhoto ? await get('photos', record.id) : null;
        record.hasPhoto = Boolean(localPhoto);
      }
    } else {
      deletions.push({ store: 'photos', key: record.id });
    }

    entries.push({ store: 'catches', value: record });
  }

  if (entries.length > 0 || deletions.length > 0) {
    await saveAll(entries, deletions);
  }
  return result;
}

// ---------- ファイルを渡す ----------

// 共有メニュー（LINE・メール・ファイルに保存など）でこのファイルを渡せるか
export function canShareFile(file) {
  return Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
}

// 共有メニューを開く
export function shareFile(file) {
  return navigator.share({ files: [file], title: file.name });
}

// ダウンロードする（共有メニューが使えない端末やパソコン用）
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // すぐ片付けるとダウンロードが失敗することがあるので、少し待ってから片付ける
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
