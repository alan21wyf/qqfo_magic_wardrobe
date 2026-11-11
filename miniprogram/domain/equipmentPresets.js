const { ATTRIBUTES, BODY_REFERENCE_FIELDS, getSlot, newDraft, validateDraft } = require('./equipment');

const PRESET_NOTICE = '目前只提供飞升后（60级以后）的装备预设选项，飞升前的装备属性请手动输入';
const PRESET_LEVELS = Array.from({ length: 14 }, (_, index) => 60 + index * 6);

const stat = (key, value, label) => ({ key, value, label });
const effect = (text) => ({ text });

// Keep white intrinsic and purple refinement rows in screenshot order. Only
// numeric rows contribute to the body totals; proc descriptions are display-only.
// The helmet/backpack's fixed +2000 HP is included per the player's correction.
const MAGE_102 = {
  helmet: {
    intrinsic: [stat('magicResistance', 487, '魔抗')],
    refinement: [stat('wisdom', 152), stat('hp', 2280), stat('damage', 197),
      effect('攻击时概率使自己一段时间内法术暴击率上升33%'),
      effect('攻击时概率令自己的法力回复+289'), stat('hp', 2000, '血量增加')],
  },
  gloves: {
    intrinsic: [stat('hit', 1583), stat('damageResistance', 137)],
    refinement: [stat('magicAttack', 455), stat('wisdom', 152), stat('constitution', 152),
      effect('攻击时概率使自己一段时间内最终不良状态抗性降低35%'),
      effect('攻击时概率使对方护甲降低25%'), effect('攻击时概率令自己的HP回复+440')],
  },
  robe: {
    intrinsic: [stat('defense', 170), stat('magicResistance', 300), stat('armor', 235)],
    refinement: [stat('hp', 2280), stat('armor', 237, '护甲值'), stat('wisdom', 152),
      effect('攻击时一定概率使自己一段时间内完全闪避，持续时间13秒'),
      effect('攻击时概率使对方物理攻击力降低25%'), effect('概率反射攻击伤害50%')],
  },
  boots: {
    intrinsic: [stat('defense', 102), stat('magicResistance', 263), stat('armor', 137)],
    refinement: [stat('wisdom', 152), stat('agility', 152), stat('constitution', 152),
      effect('攻击时概率令敌法力值下降573'),
      effect('攻击时概率使对方一段时间内最终不良状态抗性降低35%'), stat('movementSpeedPercent', 35)],
  },
  weapon: {
    intrinsic: [stat('magicAttack', 678), stat('attackSpeed', 1200)],
    refinement: [stat('magicAttack', 455), stat('damage', 197), stat('wisdom', 152),
      effect('攻击时概率使自己一段时间内法术攻击上升25%'),
      effect('攻击时6%概率无视对方防御'), stat('spellCritPercent', 2)],
  },
  face: {
    intrinsic: [stat('defense', 68), stat('hp', 1052), stat('armor', 91)],
    refinement: [stat('wisdom', 152), stat('constitution', 152), stat('agility', 152),
      effect('攻击时概率使对方魔抗降低25%'),
      effect('攻击时概率使自己一段时间内不良状态抗性上升35%'), effect('攻击时概率令敌法力值下降573')],
  },
  necklace: {
    intrinsic: [stat('magicAttack', 150), stat('magicResistance', 341, '魔抗')],
    refinement: [stat('armor', 237, '护甲值'), stat('magicResistance', 195, '魔抗'), stat('wisdom', 152),
      effect('攻击时概率额外产生2000的魔法伤害'), effect('攻击时概率加额外速度8%'), effect('概率反射攻击伤害50%')],
  },
  backpack: {
    intrinsic: [stat('maxCarry', 565), stat('damageResistance', 91), stat('magicResistance', 188)],
    refinement: [stat('wisdom', 152), stat('constitution', 152), stat('agility', 152),
      effect('攻击时概率令自己的法力回复+289'), effect('攻击时概率使对方魔抗降低25%'), stat('hp', 2000, '血量增加')],
  },
  ring: {
    intrinsic: [stat('magicAttack', 99), stat('magicResistance', 146, '魔抗')],
    refinement: [stat('hp', 2280), stat('magicAttack', 455), stat('wisdom', 152),
      effect('攻击时概率使自己一段时间内法术暴击率上升33%'),
      effect('攻击时概率额外产生2000的魔法伤害'), stat('spellCritPercent', 2)],
  },
};

function getEquipmentPreset(profession, level) {
  if (profession !== 'mage' || Number(level) !== 102) return null;
  // Build calculation totals from these same display sources to avoid drift.
  const preset = JSON.parse(JSON.stringify(MAGE_102));
  Object.keys(preset).forEach((slot) => {
    const item = preset[slot];
    item.values = {};
    item.reference = {};
    item.intrinsic.concat(item.refinement).forEach((row) => {
      if (!row.key) return;
      const target = ATTRIBUTES.some((field) => field.key === row.key) ? item.values : item.reference;
      target[row.key] = (target[row.key] || 0) + row.value;
    });
  });
  return preset;
}

function getPresetPreview(profession, level) {
  const preset = getEquipmentPreset(profession, level);
  if (!preset) return [];
  const fields = ATTRIBUTES.concat(BODY_REFERENCE_FIELDS);
  const rows = (items, refined) => items.map((row, index) => {
    const field = fields.find((attribute) => attribute.key === row.key);
    const text = row.text || (row.label || field.label) + ' ' + (refined ? '+' : '')
      + row.value + (field.unit || '');
    return { id: index, key: row.key || '', value: row.value === undefined ? null : row.value, text };
  });
  return Object.keys(preset).map((slot) => ({
    slot, label: getSlot(slot).label, name: level + '级术士·' + getSlot(slot).label,
    icon: '/images/wardrobe/' + slot + '.jpg',
    intrinsicRows: rows(preset[slot].intrinsic, false),
    refinementRows: rows(preset[slot].refinement, true),
  }));
}

function presetLevelOptions(profession) {
  return PRESET_LEVELS.map((level) => ({ level, available: Boolean(getEquipmentPreset(profession, level)) }));
}

function applyPresetBodies(profession, level, previousEquipment) {
  const preset = getEquipmentPreset(profession, level);
  if (!preset) throw new Error('PRESET_NOT_AVAILABLE');
  const equipment = Object.assign({}, previousEquipment);
  Object.keys(preset).forEach((slot) => {
    const body = preset[slot];
    const previous = equipment[slot];
    const draft = newDraft(slot, previous);
    draft.name = '102级术士·' + getSlot(slot).label;
    // A preset equips all nine pieces. It never enables optional sources.
    draft.equipped = true;
    draft.sections.find((section) => section.key === 'body').fields = Object.keys(body.values)
      .map((key) => ({ key, value: String(body.values[key]) }));
    draft.bodyReference = body.reference || {};
    const normalized = validateDraft(draft);
    if (!normalized) throw new Error('INVALID_EQUIPMENT_PRESET');
    // Preserve manual source/effect records verbatim, including disabled values.
    // Normalization still validates/calculates them when the editor opens.
    if (previous) {
      Object.keys(normalized.sections).forEach((key) => {
        if (key !== 'body' && previous.sections && previous.sections[key]) {
          normalized.sections[key] = JSON.parse(JSON.stringify(previous.sections[key]));
        }
      });
      normalized.souls = JSON.parse(JSON.stringify(previous.souls || {}));
      normalized.effects = JSON.parse(JSON.stringify(previous.effects || normalized.effects));
    }
    equipment[slot] = Object.assign({}, previous, normalized);
  });
  return equipment;
}

module.exports = { PRESET_NOTICE, PRESET_LEVELS, getEquipmentPreset, getPresetPreview, presetLevelOptions, applyPresetBodies };
