function tiers(rows) {
  return rows.map(([key, name, percent, hp = 0]) => ({
    key, name, percent, hp, label: percent ? name + '（' + percent + '%）' : name,
  }));
}

const DRAGON_TIERS = tiers([
  ['none', '无', 0], ['qianlong', '潜龙出海', 2], ['jianlong', '见龙在田', 4],
  ['baiwei', '神龙摆尾', 6], ['dragon', '龙啸九天', 9], ['divine', '龙啸九天*神', 15],
]);
const BAZHE_TIERS = tiers([
  ['none', '无', 0], ['jiaolong', '蛟龙云起', 2], ['longteng', '龙腾虎跃', 4],
  ['zhanlong', '战龙狂舞', 6], ['bazhe', '霸者神龙', 8], ['bazhe10', '霸者神龙+10', 10, 1000],
]);
const FACE_OPTIONS = [BAZHE_TIERS[0], { key: 'spiritTransform', label: '灵变', name: '灵变' }]
  .concat(BAZHE_TIERS.slice(1));

function selectedTier(effects, field, options, legacyFlag, legacyTier) {
  const value = effects && Object.prototype.hasOwnProperty.call(effects, field)
    ? effects[field] : (effects && effects[legacyFlag] ? legacyTier : 'none');
  return options.find((tier) => tier.key === value) || null;
}
function getDragonTier(effects) {
  return selectedTier(effects, 'dragonTier', DRAGON_TIERS, 'dragon', 'divine');
}
function getBazheTier(effects) {
  return selectedTier(effects, 'bazheTier', BAZHE_TIERS, 'bazhe10', 'bazhe10');
}
function setDragonTier(effects, key) {
  if (!DRAGON_TIERS.some((tier) => tier.key === key)) return false;
  effects.dragonTier = key;
  effects.dragon = key === 'divine';
  return true;
}
function setBazheTier(effects, key) {
  if (!BAZHE_TIERS.some((tier) => tier.key === key)) return false;
  effects.bazheTier = key;
  effects.bazhe10 = key === 'bazhe10';
  return true;
}
function detectDragonTier(line) {
  if (/龙啸九天[·*＊.(（]*神/.test(line)) return DRAGON_TIERS.find((tier) => tier.key === 'divine');
  return DRAGON_TIERS.slice(1, -1).find((tier) => line.includes(tier.name)) || null;
}
function detectBazheTier(line) {
  if (/霸者神龙\+?(?:10|十)/.test(line)) return BAZHE_TIERS.find((tier) => tier.key === 'bazhe10');
  return BAZHE_TIERS.slice(1, -1).find((tier) => line.includes(tier.name)) || null;
}

module.exports = { DRAGON_TIERS, BAZHE_TIERS, FACE_OPTIONS, getDragonTier, getBazheTier,
  setDragonTier, setBazheTier, detectDragonTier, detectBazheTier };
