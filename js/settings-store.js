// ============================================================
// settings-store.js — 設定を覚えておく係
//
// 設定はデータベースの「settings」の箱に入っている。
// 画面を出すたびにデータベースを読むと遅いので、
// アプリを開いたときに1回読んで、このファイルの中に持っておく。
//
//   loadSettings()        アプリを開いたときに1回呼ぶ
//   getSetting('キー')    いまの値を返す（待たずにすぐ返る）
//   setSetting('キー', 値) 値を変えて、データベースにも保存する
// ============================================================

import { getAll, saveAll } from './db.js';

// 設定の初期値と、選べる値
//   distanceUnit 距離の単位。'm'（m / km）か 'nm'（海里）
//   coordFormat  座標の形式。'dm'（度分）か 'dd'（10進）
//   nearbyM      「近くのピンに追加しますか」と聞く距離（メートル）。0 なら聞かない
const DEFAULTS = {
  distanceUnit: 'm',
  coordFormat: 'dm',
  nearbyM: 50,
};

const CHOICES = {
  distanceUnit: ['m', 'nm'],
  coordFormat: ['dm', 'dd'],
  nearbyM: [0, 20, 50, 100, 200],
};

let current = { ...DEFAULTS };

// データベースから設定を読み込む。読めなくても、初期値のまま動かす
export async function loadSettings() {
  current = { ...DEFAULTS };
  try {
    for (const row of await getAll('settings')) {
      // 知らないキーや、選択肢にない値は無視する
      if (row.key in CHOICES && CHOICES[row.key].includes(row.value)) {
        current[row.key] = row.value;
      }
    }
  } catch (error) {
    console.error('設定を読み込めませんでした', error);
  }
}

export function getSetting(key) {
  return current[key];
}

export function getAllSettings() {
  return { ...current };
}

export async function setSetting(key, value) {
  if (!(key in CHOICES) || !CHOICES[key].includes(value)) {
    throw new Error('設定できない値です: ' + key);
  }
  current[key] = value;
  await saveAll([{ store: 'settings', value: { key, value } }]);
}
