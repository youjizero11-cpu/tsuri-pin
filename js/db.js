// ============================================================
// db.js — 端末の中のデータベース（IndexedDB）の読み書き
//
// データベースの中には4つの「箱」がある。
//   pins     ピン（場所）
//   catches  釣果（どのピンのものかを pinId で持つ）
//   photos   写真（どの釣果のものかを catchId で持つ）
//   settings 設定
//
// IndexedDB はもともと書き方が少し古くて読みにくいので、
// このファイルで「await で使える形」に包んでいる。
// 他のファイルは、ここの関数だけを使えばよい。
// ============================================================

const DB_NAME = 'tsuri-pin';
const DB_VERSION = 1;

let dbPromise = null;

// データベースを開く（最初の1回だけ開き、あとは使い回す）
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // 初めて開いたとき（または版を上げたとき）に、箱を作る
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('pins', { keyPath: 'id' });
        const catches = db.createObjectStore('catches', { keyPath: 'id' });
        // 「このピンの釣果を全部」を素早く取り出すための索引
        catches.createIndex('pinId', 'pinId');
        db.createObjectStore('photos', { keyPath: 'catchId' });
        db.createObjectStore('settings', { keyPath: 'key' });
      };

      request.onsuccess = () => {
        const db = request.result;
        // 別のタブなどがデータベースを作り直そうとしたら、こちらは一度閉じて道をあける。
        // （閉じないと、相手がずっと待たされて動かなくなる）
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// いくつかのデータを、まとめて保存・削除する。
//   entries   保存するもの。[{ store: 'pins', value: {...} }, ...] の形
//   deletions 削除するもの。[{ store: 'photos', key: '...' }, ...] の形（省略できる）
// 「全部成功」か「全部失敗」のどちらかになる（一部だけ反映されることはない）。
export async function saveAll(entries, deletions = []) {
  const db = await openDb();
  const storeNames = [...new Set([...entries, ...deletions].map((e) => e.store))];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    for (const entry of entries) {
      // put は「同じidがあれば上書き、なければ追加」
      tx.objectStore(entry.store).put(entry.value);
    }
    for (const deletion of deletions) {
      tx.objectStore(deletion.store).delete(deletion.key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 1件だけ取り出す（なければ undefined）
export async function get(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// あるピンの釣果を、新しい順に取り出す
export async function getCatchesOfPin(pinId) {
  const db = await openDb();
  const catches = await new Promise((resolve, reject) => {
    const request = db.transaction('catches', 'readonly')
      .objectStore('catches').index('pinId').getAll(pinId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  catches.sort((a, b) => new Date(b.caughtAt) - new Date(a.caughtAt));
  return catches;
}

// これまでに入力したことのある魚種の一覧（入力候補に使う）
export async function getSpeciesList() {
  const catches = await getAll('catches');
  const names = catches.map((c) => c.species).filter((name) => name !== '');
  return [...new Set(names)].sort();
}

// 箱の中身を全部取り出す
export async function getAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ピンを新しい順に取り出す
export async function getPinsNewestFirst() {
  const pins = await getAll('pins');
  pins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return pins;
}
