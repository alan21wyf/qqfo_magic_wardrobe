// Stable keys are shared by forms, saved profiles and future OCR field mapping.
const STAT_FIELDS = [
  { key: 'minAttack', label: '最小攻击' },
  { key: 'maxAttack', label: '最大攻击' },
  { key: 'defense', label: '防御' },
  { key: 'magicAttack', label: '魔攻' },
  { key: 'hit', label: '命中' },
  { key: 'magicDefense', label: '魔防' },
  { key: 'strength', label: '力量' },
  { key: 'constitution', label: '体质' },
  { key: 'agility', label: '敏捷' },
  { key: 'wisdom', label: '智慧' },
  { key: 'dexterity', label: '灵巧' },
  { key: 'spirit', label: '精神' },
];

const PROFESSIONS = [
  { key: 'healer', label: '药师' },
  { key: 'mage', label: '术士' },
  { key: 'warrior', label: '战士' },
  { key: 'assassin', label: '刺客' },
  { key: 'swordsman', label: '剑客' },
];

const LEFT_SLOTS = [
  { key: 'helmet', label: '头盔' },
  { key: 'gloves', label: '手套' },
  { key: 'robe', label: '衣服' },
  { key: 'boots', label: '鞋子' },
  { key: 'weapon', label: '武器' },
];
const RIGHT_SLOTS = [
  { key: 'face', label: '面饰' },
  { key: 'necklace', label: '项链' },
  { key: 'backpack', label: '背包' },
  { key: 'ring', label: '戒指' },
];

function isProfession(key) {
  return PROFESSIONS.some((item) => item.key === key);
}

// Empty strings remain empty. Zero is a complete value, including all-zero profiles.
function parseNumericValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function validateStats(values) {
  const stats = {};
  for (const field of STAT_FIELDS) {
    const value = parseNumericValue(values && values[field.key]);
    if (value === null) return null;
    stats[field.key] = value;
  }
  return stats;
}

function createDraft(stats) {
  return STAT_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: stats ? String(stats[field.key]) : '',
  }));
}

function draftToStats(fields) {
  const values = {};
  fields.forEach((field) => { values[field.key] = field.value; });
  return validateStats(values);
}

function statRows(stats, start, end) {
  const fields = STAT_FIELDS.slice(start, end).map((field) => ({
    key: field.key,
    label: field.label,
    value: stats ? stats[field.key] : 0,
  }));
  const rows = [];
  for (let index = 0; index < fields.length; index += 2) {
    rows.push({ key: fields[index].key, cells: fields.slice(index, index + 2) });
  }
  return rows;
}

module.exports = {
  STAT_FIELDS, PROFESSIONS, LEFT_SLOTS, RIGHT_SLOTS,
  isProfession, parseNumericValue, validateStats, createDraft, draftToStats, statRows,
};
