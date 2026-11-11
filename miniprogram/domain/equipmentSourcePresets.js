const TRANSFORM_PRESETS = [
  ['900', 80, 100, 800], ['1000', 80, 100, 1000], ['270', 130, 150, 1200],
  ['gold', 220, 250, 2500], ['285', 180, 200, 2000],
].flatMap(([tier, attack, magicAttack, life]) => {
  const name = tier === 'gold' ? '黄金' : tier;
  return [
    { key: tier + '-attack', label: name + '攻击灵变', values: { attack, magicAttack } },
    { key: tier + '-life', label: name + '生命灵变', values: { hp: life, mp: life } },
  ];
});
const TRANSFORM_OPTIONS = [{ key: 'none', label: '无灵变' }].concat(TRANSFORM_PRESETS);
const RING_TIERS = [
  { key: '3', name: '3', amount: 80, hp: 300, movement: 2 },
  { key: '7', name: '7', amount: 200, hp: 0, movement: 5,
    branches: [{ key: 'blood', label: '嗜血' }, { key: 'holy', label: '圣灵' }],
    normalAttack: 80, trueAttack: 120, normalHp: 1000, trueHp: 1200 },
  { key: '9', name: '9', amount: 260, hp: 0, movement: 7,
    branches: [{ key: 'demon', label: '恶魔' }, { key: 'angel', label: '天使' }],
    normalAttack: 130, trueAttack: 180, normalHp: 1500, trueHp: 1800 },
  { key: 'gold', name: '黄金', amount: 260, hp: 0, movement: 8,
    branches: [{ key: 'demon', label: '恶魔' }, { key: 'angel', label: '天使' }],
    normalAttack: 220, trueAttack: 220, normalHp: 2500, trueHp: 2500 },
];
const RING_TYPES = [
  { key: 'physical-dex', name: '物理', suffix: '巧', attack: 'attack', core: 'strength', extra: 'dexterity' },
  { key: 'physical-agi', name: '物理', suffix: '敏', attack: 'attack', core: 'strength', extra: 'agility' },
  { key: 'magic-spirit', name: '法系', suffix: '精', attack: 'magicAttack', core: 'wisdom', extra: 'spirit' },
  { key: 'magic-agi', name: '法系', suffix: '敏', attack: 'magicAttack', core: 'wisdom', extra: 'agility' },
];
const RING_PRESETS = RING_TIERS.flatMap((tier) => RING_TYPES.map((type) => ({
  key: tier.key + '-' + type.key, label: type.name + tier.name + type.suffix, tier, type,
})));
const RING_OPTIONS = [{ key: 'none', label: '无戒指灵' }].concat(RING_PRESETS);

function isPresetSection(slot, section) {
  return section === 'spiritTransform' || (slot === 'ring' && section === 'spirit');
}

function resolveSectionPreset(slot, section, selection) {
  if (!isPresetSection(slot, section) || !selection || typeof selection.key !== 'string') return null;
  if (selection.key === 'none') return { selection: { key: 'none' }, values: {}, label: section === 'spirit' ? '无戒指灵' : '无灵变', movement: 0, branches: [] };
  if (section === 'spiritTransform') {
    const preset = TRANSFORM_PRESETS.find((item) => item.key === selection.key);
    return preset ? { selection: { key: preset.key }, values: Object.assign({}, preset.values),
      label: preset.label, movement: 0, branches: [] } : null;
  }
  const preset = RING_PRESETS.find((item) => item.key === selection.key);
  if (!preset || (selection.trueSoul !== undefined && typeof selection.trueSoul !== 'boolean')) return null;
  const { tier, type } = preset;
  const trueSoul = selection.trueSoul === true;
  const branches = tier.branches || [];
  const branch = selection.branch === undefined ? branches[0] && branches[0].key : selection.branch;
  if (branches.length ? !branches.some((item) => item.key === branch) : branch !== undefined) return null;
  const normalized = { key: preset.key, trueSoul };
  const values = { [type.attack]: tier.amount, [type.core]: tier.amount,
    constitution: tier.amount, [type.extra]: tier.amount };
  if (tier.hp) values.hp = tier.hp;
  if (branches.length) {
    normalized.branch = branch;
    if (branch === branches[0].key) values[type.attack] += trueSoul ? tier.trueAttack : tier.normalAttack;
    else values.hp = (values.hp || 0) + (trueSoul ? tier.trueHp : tier.normalHp);
  }
  return { selection: normalized, values, label: preset.label,
    movement: trueSoul ? tier.movement : 0, branches };
}

module.exports = {
  TRANSFORM_PRESETS, TRANSFORM_OPTIONS, RING_PRESETS, RING_OPTIONS,
  isPresetSection, resolveSectionPreset,
};
