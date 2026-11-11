const { validateStats, normalizeManaCalibration } = require('./profile');
const { getSlot, normalizeEquipment, getSpiritBonus } = require('./equipment');
const { getDragonTier, getBazheTier } = require('./equipmentEffects');

const CORE = ['strength', 'constitution', 'agility', 'wisdom', 'spirit', 'dexterity'];
const RESULT_FIELDS = [
  ['hp', '最大生命'], ['mp', '最大法力'],
  ['minAttack', '最小攻击'], ['defense', '防御'], ['maxAttack', '最大攻击'],
  ['hit', '命中'], ['magicAttack', '魔攻'], ['magicDefense', '魔防'],
  ['strength', '力量'], ['constitution', '体质'], ['agility', '敏捷'],
  ['wisdom', '智慧'], ['dexterity', '灵巧'], ['spirit', '精神'],
  ['damageResistance', '伤害抗性（装备）'], ['magicResistance', '魔法抗性（装备）'], ['armor', '护甲（装备）'],
].map(([key, label]) => ({ key, label }));

function round(value) {
  // Decimal game multipliers can produce 126.49999999999999 instead of 126.5.
  // Snap only a machine-precision distance to the nearest half before rounding.
  const nearestHalf = Math.round(value * 2) / 2;
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(value)) * 2);
  const adjusted = Math.abs(value - nearestHalf) <= tolerance ? nearestHalf : value;
  const result = Math.round(adjusted);
  if (!Number.isSafeInteger(result)) throw new Error('CALCULATION_OVERFLOW');
  return result;
}

function floor(value) {
  // Percentage products can lie just below an exact integer in binary floats.
  // Snap only machine-precision integer boundaries; 57.5 still truncates to 57.
  const nearest = Math.round(value);
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(value)) * 2);
  const result = Math.floor(Math.abs(value - nearest) <= tolerance ? nearest : value);
  if (!Number.isSafeInteger(result)) throw new Error('CALCULATION_OVERFLOW');
  return result;
}

function calculate(baseValues, equipment, profession, manaCalibration) {
  const base = validateStats(baseValues);
  if (!base) return null;
  const direct = {};
  const soul = { magicAttack: 0, physicalAttack: 0, hp: 0 };
  let dragonPercent = 0;
  let bazhePercent = 0;
  let bazheHp = 0;
  let darkMight = false;
  Object.keys(equipment || {}).forEach((slot) => {
    if (!getSlot(slot, profession)) return;
    if (equipment[slot] && equipment[slot].equipped === false) return;
    const item = normalizeEquipment(slot, equipment[slot]);
    if (!item) return;
    const dragon = getDragonTier(item.effects);
    const bazhe = getBazheTier(item.effects);
    dragonPercent = Math.max(dragonPercent, dragon.percent);
    bazhePercent = Math.max(bazhePercent, bazhe.percent);
    bazheHp = Math.max(bazheHp, bazhe.hp);
    darkMight = darkMight || item.effects.darkMight;
    Object.keys(item.sections).forEach((key) => {
      const section = item.sections[key];
      if (!section.enabled) return;
      Object.keys(section.values).forEach((stat) => {
        direct[stat] = (direct[stat] || 0) + section.values[stat];
      });
      const bonus = key === 'spirit' && getSpiritBonus(slot, section.values);
      if (bonus) direct.hp = (direct.hp || 0) + bonus.hp;
    });
    Object.keys(soul).forEach((key) => { soul[key] += item.souls[key] || 0; });
  });
  const result = {};
  if (darkMight) {
    direct.strength = (direct.strength || 0) + 460;
    direct.wisdom = (direct.wisdom || 0) + 460;
  }
  const multiplier = 1 + dragonPercent / 100 + (darkMight ? 0.30 : 0);
  // Aggregate percentage layers first, then use one integer core value for
  // both display and conversions. Do not round each source's percentage apart.
  const raw = {};
  CORE.forEach((key) => {
    const boosted = key !== 'dexterity';
    const nakedBonus = boosted ? base[key] * bazhePercent / 100 : 0;
    raw[key] = (base[key] + nakedBonus + (direct[key] || 0)) * (boosted ? multiplier : 1);
    result[key] = floor(raw[key]);
  });
  const half = (key) => floor(result[key] / 2);
  ['minAttack', 'maxAttack'].forEach((key) => {
    const residual = base[key] - floor(base.strength / 2);
    result[key] = round(residual + ((direct[key] || 0) + (direct.attack || 0) + half('strength'))
      * (1 + soul.physicalAttack / 100));
  });
  const magicResidual = base.magicAttack - floor(base.wisdom / 2);
  result.magicAttack = round(magicResidual + ((direct.magicAttack || 0) + half('wisdom'))
    * (1 + soul.magicAttack / 100));
  result.defense = round(base.defense + (direct.defense || 0) + half('agility') - floor(base.agility / 2));
  result.hit = round(base.hit + (direct.hit || 0) + half('dexterity') - floor(base.dexterity / 2));
  result.magicDefense = round(base.magicDefense + (direct.magicDefense || 0)
    + half('spirit') - floor(base.spirit / 2));
  // The single-necklace game sample converts integer effective constitution
  // into life: 1872 * 9 = 16848, rather than 1872.2 * 9 rounded to 16850.
  result.hp = round((result.constitution * 9 + (direct.hp || 0)
    + bazheHp * multiplier) * (1 + soul.hp / 100));
  const measuredMana = normalizeManaCalibration(manaCalibration, base);
  // Calibrated MP uses the same integer spirit as the core panel. The measured
  // 1338 -> 1538 spirit contributes 200 * 9.9 MP above the naked 13268 baseline.
  // Keep that baseline per profile rather than hard-coding a residual constant.
  result.mp = measuredMana
    ? round(measuredMana.mp + (result.spirit - floor(base.spirit)) * 9.9 + (direct.mp || 0))
    : round(result.spirit * 9.9 + (direct.mp || 0));
  result.damageResistance = round(direct.damageResistance || 0);
  result.magicResistance = round(direct.magicResistance || 0);
  result.armor = round(direct.armor || 0);
  return result;
}

function equipmentImpact(base, equipped, slot, candidate, profession, manaCalibration) {
  const without = Object.assign({}, equipped);
  delete without[slot];
  const withItem = Object.assign({}, without, { [slot]: candidate });
  const before = calculate(base, without, profession, manaCalibration);
  const after = calculate(base, withItem, profession, manaCalibration);
  if (!before || !after) return null;
  return RESULT_FIELDS.map((field) => ({
    key: field.key, label: field.label,
    before: before[field.key], after: after[field.key],
    delta: after[field.key] - before[field.key],
    sign: after[field.key] > before[field.key] ? '+' : '',
  }));
}

module.exports = { RESULT_FIELDS, calculate, equipmentImpact };
