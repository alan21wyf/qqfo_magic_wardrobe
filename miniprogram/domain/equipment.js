const { LEFT_SLOTS, RIGHT_SLOTS, BADGES, parseNumericValue } = require('./profile');
const { getDragonTier, getBazheTier } = require('./equipmentEffects');
const { isPresetSection, resolveSectionPreset } = require('./equipmentSourcePresets');

const ATTRIBUTES = [
  ['strength', '力量'], ['wisdom', '智慧'], ['constitution', '体质'], ['hp', '最大生命'],
  ['agility', '敏捷'], ['spirit', '精神'], ['dexterity', '灵巧'],
  ['attack', '攻击'], ['minAttack', '最小攻击'], ['maxAttack', '最大攻击'],
  ['magicAttack', '魔法攻击'], ['defense', '防御'], ['hit', '命中'],
  ['magicDefense', '魔法防御'], ['mp', '最大法力'],
  ['damageResistance', '伤害抗性'], ['magicResistance', '魔法抗性'], ['armor', '护甲'],
].map(([key, label]) => ({ key, label }));
const SOULS = [
  { key: 'hp', label: '生命加成', unit: '%' },
  { key: 'magicAttack', label: '魔攻加成', unit: '%' },
  { key: 'physicalAttack', label: '物攻加成', unit: '%' },
];
const CORE_KEYS = ['strength', 'wisdom', 'constitution', 'agility', 'spirit', 'dexterity'];
// Screenshot body values without a verified panel conversion remain separate.
const BODY_REFERENCE_FIELDS = [
  { key: 'damage', label: '伤害', unit: '' },
  { key: 'attackSpeed', label: '攻击速度', unit: '' },
  { key: 'maxCarry', label: '最大负重', unit: '' },
  { key: 'movementSpeedPercent', label: '移动速度', unit: '%' },
  { key: 'spellCritPercent', label: '法术攻击暴击率', unit: '%' },
];

function allowedAttributes(slot, section) {
  let keys;
  if (section === 'spirit') keys = CORE_KEYS.concat(
    ['magicAttack', 'attack', 'defense', 'magicDefense', 'damageResistance', 'magicResistance'],
    slot === 'ring' ? ['hp'] : []);
  if (section === 'spiritTransform') keys = ['attack', 'magicAttack', 'hp', 'mp'];
  return ATTRIBUTES.filter((a) => !keys || keys.includes(a.key));
}
const APPEARANCE_SLOTS = ['helmet', 'face', 'robe', 'backpack', 'weapon'];
const SECTION_DEFINITIONS = [
  { key: 'body', label: '装备本体' }, { key: 'spirit', label: '灵' },
  { key: 'spiritTransform', label: '灵变' }, { key: 'appearance', label: '变装' },
];
const ALL_SLOTS = LEFT_SLOTS.concat(RIGHT_SLOTS, [
  { key: 'shield', label: '盾牌' }, { key: 'artifact', label: '法宝' },
], BADGES);

function getSlot(key, profession) {
  const slot = ALL_SLOTS.find((s) => s.key === key);
  if (!slot || (key === 'shield' && profession && profession !== 'swordsman')) return null;
  const badge = /^badge[1-6]$/.test(key);
  return Object.assign({}, slot, {
    badge, hasSpirit: !badge, hasAppearance: APPEARANCE_SLOTS.includes(key),
    hasSoul: !badge && key !== 'artifact',
    hasDragon: key === 'necklace', hasBazhe: key === 'face', hasDarkMight: key === 'weapon',
  });
}

function definitions(slot) {
  const config = getSlot(slot);
  if (!config) return [];
  return SECTION_DEFINITIONS.filter((s) => s.key === 'body'
    || (s.key === 'appearance' ? config.hasAppearance : config.hasSpirit));
}

function getSpiritBonus(slot, values) {
  const config = getSlot(slot);
  const fields = Object.values(values || {});
  if (!config || !config.hasSpirit || !fields.length || !fields.every((value) => {
    const number = parseNumericValue(value);
    return number !== null && number >= 285;
  })) return null;
  return { hp: 3000, movementSpeedPercent: slot === 'boots' ? 2 : 1 };
}

function newDraft(slot, saved) {
  const item = saved || {};
  const config = getSlot(slot);
  const effects = {
    dragon: Boolean(item.effects && item.effects.dragon && config && config.hasDragon),
    bazhe10: Boolean(item.effects && item.effects.bazhe10 && config && config.hasBazhe),
    darkMight: Boolean(item.effects && item.effects.darkMight && config && config.hasDarkMight),
  };
  // Missing tier fields retain the original boolean format until a player changes the selection.
  if (config && config.hasDragon && item.effects && Object.prototype.hasOwnProperty.call(item.effects, 'dragonTier')) {
    effects.dragonTier = item.effects.dragonTier;
  }
  if (config && config.hasBazhe && item.effects && Object.prototype.hasOwnProperty.call(item.effects, 'bazheTier')) {
    effects.bazheTier = item.effects.bazheTier;
  }
  return {
    slot, name: item.name || '', equipped: item.equipped !== false,
    bodyReference: Object.assign({}, item.bodyReference),
    sections: definitions(slot).map((s) => {
      const source = item.sections && item.sections[s.key];
      const selection = source && source.selection;
      const preset = selection === undefined ? null : resolveSectionPreset(slot, s.key, selection);
      const values = preset ? preset.values : (source && source.values) || {};
      return {
        key: s.key, label: s.label, enabled: s.key === 'body' || Boolean(source && source.enabled),
        fields: ATTRIBUTES.filter((a) => Object.prototype.hasOwnProperty.call(values, a.key))
          .map((a) => ({ key: a.key, label: a.label, value: String(values[a.key]),
            legacy: !allowedAttributes(slot, s.key).some((allowed) => allowed.key === a.key) })),
        ...(selection === undefined ? {} : { selection: Object.assign({}, selection) }),
      };
    }),
    souls: config && config.hasSoul ? SOULS.filter((s) => item.souls
      && Object.prototype.hasOwnProperty.call(item.souls, s.key))
      .map((s) => Object.assign({}, s, { value: String(item.souls[s.key]) })) : [],
    effects,
  };
}

function validateDraft(draft) {
  const config = draft && getSlot(draft.slot);
  if (!config) return null;
  const result = { version: 1, name: String(draft.name || '').trim().slice(0, 40),
    equipped: draft.equipped !== false,
    sections: {}, souls: {}, effects: { dragon: false, bazhe10: false, darkMight: false } };
  if (draft.bodyReference && Object.keys(draft.bodyReference).length) {
    result.bodyReference = {};
    for (const field of BODY_REFERENCE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(draft.bodyReference, field.key)) continue;
      const value = parseNumericValue(draft.bodyReference[field.key]);
      if (value === null) return null;
      result.bodyReference[field.key] = value;
    }
  }
  const dragon = getDragonTier(config.hasDragon ? draft.effects : {});
  const bazhe = getBazheTier(config.hasBazhe ? draft.effects : {});
  if (!dragon || !bazhe) return null;
  result.effects.dragon = dragon.key === 'divine';
  result.effects.bazhe10 = bazhe.key === 'bazhe10';
  if (config.hasDragon && Object.prototype.hasOwnProperty.call(draft.effects || {}, 'dragonTier')) {
    result.effects.dragonTier = dragon.key;
  }
  if (config.hasBazhe && Object.prototype.hasOwnProperty.call(draft.effects || {}, 'bazheTier')) {
    result.effects.bazheTier = bazhe.key;
  }
  result.effects.darkMight = config.hasDarkMight && Boolean(draft.effects && draft.effects.darkMight);
  let count = Number(dragon.percent > 0) + Number(bazhe.percent > 0) + Number(result.effects.darkMight);
  for (const definition of definitions(draft.slot)) {
    const section = (draft.sections || []).find((s) => s.key === definition.key);
    if (!section) return null;
    let preset;
    if (section.selection !== undefined) {
      preset = resolveSectionPreset(draft.slot, definition.key, section.selection);
      if (!preset) return null;
    }
    const enabled = definition.key === 'body' || (Boolean(section.enabled) && (!preset || preset.selection.key !== 'none'));
    const active = enabled && !(definition.key === 'spiritTransform' && bazhe.percent > 0)
      && !(definition.key === 'appearance' && result.effects.darkMight);
    const values = {};
    if (active) {
      const fields = preset ? Object.keys(preset.values).map((key) => ({ key, value: preset.values[key] })) : section.fields;
      if (definition.key !== 'body' && !fields.length) return null;
      for (const field of fields) {
        const value = parseNumericValue(field.value);
        if (!ATTRIBUTES.some((a) => a.key === field.key) || value === null
          || Object.prototype.hasOwnProperty.call(values, field.key)) return null;
        if (!allowedAttributes(draft.slot, definition.key).some((a) => a.key === field.key)
          && !field.legacy) return null;
        values[field.key] = value;
        count += 1;
      }
    }
    result.sections[definition.key] = { enabled: active, values };
    if (preset) result.sections[definition.key].selection = preset.selection;
  }
  if (config.hasSoul) {
    for (const field of draft.souls || []) {
      const value = parseNumericValue(field.value);
      if (!SOULS.some((s) => s.key === field.key) || value === null
        || Object.prototype.hasOwnProperty.call(result.souls, field.key)) return null;
      result.souls[field.key] = value;
      count += 1;
    }
  }
  return count ? result : null;
}

function normalizeEquipment(slot, item) {
  if (!item || item.version !== 1) return null;
  return validateDraft(newDraft(slot, item));
}

function decorateDraft(draft) {
  const bazhe = getBazheTier(draft.effects);
  return draft.sections.map((s) => {
    const preset = s.selection && resolveSectionPreset(draft.slot, s.key, s.selection);
    const values = preset ? preset.values : Object.fromEntries(s.fields.map((field) => [field.key, field.value]));
    return Object.assign({}, s, {
      disabledByBazhe: s.key === 'spiritTransform' && Boolean(bazhe && bazhe.percent),
      disabledByDarkMight: s.key === 'appearance' && draft.effects.darkMight,
      usesPreset: isPresetSection(draft.slot, s.key),
      spiritBonus: s.key === 'spirit' && s.enabled ? getSpiritBonus(draft.slot, values) : null,
      available: allowedAttributes(draft.slot, s.key).filter((a) => !s.fields.some((f) => f.key === a.key)),
    });
  });
}

module.exports = {
  ATTRIBUTES, SOULS, ALL_SLOTS, BODY_REFERENCE_FIELDS, getSlot, definitions, allowedAttributes, newDraft,
  validateDraft, normalizeEquipment, decorateDraft, getSpiritBonus,
};
