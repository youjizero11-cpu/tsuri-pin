// ============================================================
// list.js — ピン一覧
//   ・ピンを、最後に釣れた日時の新しい順に並べる
//   ・魚種を選ぶと、その魚が釣れたピンだけに絞り込む
// ============================================================

import { getAll, getSpeciesList } from '../db.js';
import { formatDateTime } from '../util.js';

const filterSelect = document.getElementById('list-filter');
const rowsEl = document.getElementById('list-rows');
const emptyEl = document.getElementById('list-empty');
const cardEl = document.getElementById('list-card');

// いま選んでいる魚種（'' は「すべて」）。画面を行き来しても覚えておく
let selectedSpecies = '';

// 画面を開く（app.js から呼ばれる）
export async function showList() {
  const pins = await getAll('pins');
  const catches = await getAll('catches');

  // --- ピンごとに、釣果をまとめる ---
  // summaries は「ピンのID → まとめ」の対応表
  const summaries = new Map();
  for (const pin of pins) {
    summaries.set(pin.id, {
      pin: pin,
      latestAt: pin.createdAt, // 最後に釣れた日時（釣果がなければピンを打った日時）
      species: new Set(),      // このピンで釣れた魚種（重複なし）
      catchCount: 0,
    });
  }
  for (const record of catches) {
    const summary = summaries.get(record.pinId);
    if (!summary) continue;
    summary.catchCount += 1;
    if (record.species) summary.species.add(record.species);
    if (new Date(record.caughtAt) > new Date(summary.latestAt)) {
      summary.latestAt = record.caughtAt;
    }
  }

  // --- 絞り込みの選択肢を作り直す ---
  const speciesList = await getSpeciesList();
  // 選んでいた魚種の記録がすべて消えていたら「すべて」に戻す
  if (!speciesList.includes(selectedSpecies)) {
    selectedSpecies = '';
  }
  filterSelect.textContent = '';
  filterSelect.append(new Option('すべての魚種', ''));
  for (const name of speciesList) {
    filterSelect.append(new Option(name, name));
  }
  filterSelect.value = selectedSpecies;

  // --- 絞り込んで、新しい順に並べる ---
  const rows = [...summaries.values()]
    .filter((s) => selectedSpecies === '' || s.species.has(selectedSpecies))
    .sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));

  // --- 表示する ---
  rowsEl.textContent = '';
  cardEl.hidden = (rows.length === 0);
  emptyEl.hidden = (rows.length > 0);
  emptyEl.textContent = (pins.length === 0)
    ? 'まだピンがありません。'
    : 'この魚種のピンはありません。';

  for (const summary of rows) {
    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = '#pin/' + summary.pin.id;

    const name = document.createElement('div');
    name.className = 'row-main';
    name.textContent = summary.pin.name;

    // 例: 「マダイ、アジ（釣果3件）」
    const fish = document.createElement('div');
    fish.className = 'row-sub';
    const speciesText = summary.species.size > 0
      ? [...summary.species].join('、')
      : '魚種未入力';
    fish.textContent = speciesText + '（釣果' + summary.catchCount + '件）';

    const date = document.createElement('div');
    date.className = 'row-sub';
    date.textContent = '最後の記録 ' + formatDateTime(summary.latestAt);

    link.append(name, fish, date);

    const item = document.createElement('li');
    item.append(link);
    rowsEl.append(item);
  }
}

// 最初の準備（app.js から1回だけ呼ばれる）
export function initList() {
  filterSelect.addEventListener('change', () => {
    selectedSpecies = filterSelect.value;
    showList();
  });
}
