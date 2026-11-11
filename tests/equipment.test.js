const test = require('node:test');
const assert = require('node:assert/strict');
const { ATTRIBUTES, ALL_SLOTS, getSlot, newDraft, validateDraft, normalizeEquipment } = require('../miniprogram/domain/equipment');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const { calculate, equipmentImpact } = require('../miniprogram/domain/calculator');
const { createProfileRepository, STORAGE_KEY } = require('../miniprogram/services/profileRepository');
const base = { minAttack: 10, maxAttack: 20, defense: 30, magicAttack: 52, hit: 40,
  magicDefense: 50, strength: 20, constitution: 10, agility: 10, wisdom: 100, dexterity: 10, spirit: 10 };

function item(slot, values, souls, effects) {
  const draft = newDraft(slot);
  draft.sections[0].fields = Object.entries(values || {}).map(([key, value]) => ({
    key, label: ATTRIBUTES.find((a) => a.key === key).label, value: String(value),
  }));
  draft.souls = Object.entries(souls || {}).map(([key, value]) => ({ key, value: String(value) }));
  Object.assign(draft.effects, effects);
  return validateDraft(draft);
}

test('all non-badges including artifact and shield support spirit/transform; costume limited to five slots', () => {
  for (const slot of ALL_SLOTS) {
    const config = getSlot(slot.key);
    const keys = newDraft(slot.key).sections.map((s) => s.key);
    assert.equal(keys.includes('spirit'), !config.badge, slot.key);
    assert.equal(keys.includes('spiritTransform'), !config.badge, slot.key);
    assert.equal(keys.includes('appearance'), ['helmet', 'face', 'robe', 'backpack', 'weapon'].includes(slot.key), slot.key);
  }
  assert.equal(getSlot('shield', 'mage'), null);
  assert.equal(getSlot('unknown'), null);
});

test('only chosen active fields are required, explicit zeros valid, malformed numbers prevent saving', () => {
  const draft = newDraft('ring');
  assert.equal(validateDraft(draft), null);
  draft.sections[0].fields = [{ key: 'wisdom', value: '' }];
  assert.equal(validateDraft(draft), null);
  for (const value of ['-2', 'NaN', '1e3', '1.2.3']) {
    draft.sections[0].fields[0].value = value;
    assert.equal(validateDraft(draft), null, value);
  }
  draft.sections[0].fields[0].value = '0';
  assert.equal(validateDraft(draft).sections.body.values.wisdom, 0);
  draft.sections.find((s) => s.key === 'spirit').enabled = true;
  assert.equal(validateDraft(draft), null);
});

test('face bazhe excludes transform while retaining spirit and costume', () => {
  const draft = newDraft('face');
  for (const section of draft.sections) {
    section.enabled = true;
    section.fields = [{ key: 'wisdom', value: '20' }];
  }
  draft.effects.bazhe10 = true;
  const saved = validateDraft(draft);
  assert.equal(saved.sections.spiritTransform.enabled, false);
  assert.deepEqual(saved.sections.spiritTransform.values, {});
  assert.equal(saved.sections.spirit.enabled, true);
  assert.equal(saved.sections.appearance.enabled, true);
  assert.equal(normalizeEquipment('face', saved).effects.bazhe10, true);
});

test('necklace dragon and its transform attributes can coexist', () => {
  const draft = newDraft('necklace');
  draft.effects.dragon = true;
  const section = draft.sections.find((s) => s.key === 'spiritTransform');
  section.enabled = true; section.fields = [{ key: 'magicAttack', value: '100' }];
  assert.equal(validateDraft(draft).sections.spiritTransform.values.magicAttack, 100);
});

test('badge and artifact do not carry unsupported soul or effects into calculation', () => {
  const draft = newDraft('badge1');
  draft.sections[0].fields = [{ key: 'wisdom', value: '20' }];
  draft.effects = { dragon: true, bazhe10: true };
  draft.souls = [{ key: 'magicAttack', value: '99' }];
  const saved = validateDraft(draft);
  assert.deepEqual(saved.effects, { dragon: false, bazhe10: false, darkMight: false });
  assert.deepEqual(saved.souls, {});
  assert.equal(getSlot('artifact').hasSoul, false);
});

test('bare profile preserved and max HP/MP derived without extra input', () => {
  const result = calculate(base, {}, 'mage');
  for (const field of STAT_FIELDS) assert.equal(result[field.key], base[field.key], field.key);
  assert.equal(result.hp, 90); assert.equal(result.mp, 99);
});

test('an item soul increases existing equipment contribution even with no direct stats on that item', () => {
  const equipped = { weapon: item('weapon', { wisdom: 20, magicAttack: 100 }) };
  const ring = item('ring', {}, { magicAttack: 10 });
  const impact = equipmentImpact(base, equipped, 'ring', ring, 'mage');
  const magic = impact.find((r) => r.key === 'magicAttack');
  assert.equal(magic.before, 162); assert.equal(magic.after, 178); assert.equal(magic.delta, 16);
});

test('dragon recalculates badge and all existing gear, and removing it removes the global effect', () => {
  const equipped = { badge1: item('badge1', { wisdom: 100 }) };
  const necklace = item('necklace', {}, {}, { dragon: true });
  const impact = equipmentImpact(base, equipped, 'necklace', necklace, 'mage');
  assert.equal(impact.find((r) => r.key === 'wisdom').before, 200);
  assert.equal(impact.find((r) => r.key === 'wisdom').after, 230);
  assert.equal(impact.find((r) => r.key === 'magicAttack').delta, 15);
  assert.equal(calculate(base, equipped, 'mage').wisdom, 200);
});

test('magic resistance and armor remain separate from defense and magic defense', () => {
  const result = calculate(base, { boots: item('boots', { magicResistance: 263, armor: 137 }) }, 'mage');
  assert.equal(result.magicDefense, 50);
  assert.equal(result.defense, 30);
  assert.equal(result.magicResistance, 263);
  assert.equal(result.armor, 137);
});

test('bazhe uses naked five stats only, excludes dexterity, and its HP enters dragon and life soul', () => {
  const equipped = {
    face: item('face', {}, {}, { bazhe10: true }),
    necklace: item('necklace', {}, {}, { dragon: true }),
    ring: item('ring', { hp: 100 }, { hp: 20 }),
  };
  const result = calculate(base, equipped, 'mage');
  assert.equal(result.dexterity, 10);
  assert.equal(result.constitution, 12);
  assert.equal(result.hp, 1630); // F(12.65) * 9, then direct life and 20% soul
  assert.deepEqual(calculate(base, equipped, 'mage'), result);
});

test('stored shield cannot affect a profession without a shield slot', () => {
  const shield = item('shield', { magicAttack: 1000 });
  assert.equal(calculate(base, { shield }, 'mage').magicAttack, 52);
  assert.equal(calculate(base, { shield }, 'swordsman').magicAttack, 1052);
});

test('single-necklace complete integer-stage vector matches observed HP/MP and checks every panel field', () => {
  const naked = { minAttack: 25, maxAttack: 25, defense: 181, magicAttack: 1427,
    hit: 25, magicDefense: 671, strength: 50, constitution: 1387, agility: 362,
    wisdom: 2850, dexterity: 50, spirit: 1338 };
  const draft = newDraft('necklace');
  const source = (name, values) => {
    const section = draft.sections.find((s) => s.key === name);
    section.enabled = true;
    section.fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
  };
  source('body', { magicAttack: 150, magicResistance: 536, armor: 237, wisdom: 152 });
  source('spirit', { constitution: 241, magicAttack: 274, magicDefense: 270, wisdom: 235 });
  source('spiritTransform', { attack: 80, magicAttack: 100 });
  draft.effects.dragonTier = 'divine';
  draft.souls = [{ key: 'magicAttack', value: '6' }];
  const necklace = validateDraft(draft);
  const calibration = { spirit: 1338, mp: 13268 };
  const result = calculate(naked, { necklace }, 'mage', calibration);
  // HP/MP are player-observed. The other fields are arithmetic expectations of
  // the unified integer stages, awaiting the full equipped in-game panel.
  assert.deepEqual(result, {
    strength: 57, constitution: 1872, agility: 416, wisdom: 3722, spirit: 1538, dexterity: 50,
    minAttack: 108, maxAttack: 108, magicAttack: 2530, defense: 208, hit: 25, magicDefense: 1041,
    hp: 16848, mp: 15248, damageResistance: 0, magicResistance: 536, armor: 237,
  });
  const impact = equipmentImpact(naked, {}, 'necklace', necklace, 'mage', calibration);
  assert.deepEqual(Object.fromEntries(impact.map((row) => [row.key, row.delta])), {
    hp: 4365, mp: 1980, minAttack: 83, maxAttack: 83, magicAttack: 1103, defense: 27,
    hit: 0, magicDefense: 370, strength: 7, constitution: 485, agility: 54, wisdom: 872,
    dexterity: 0, spirit: 200, damageResistance: 0, magicResistance: 536, armor: 237,
  });

  // Check all displayed fields and every equipment-preview row, not just HP/MP.
  let definition;
  global.Page = value => { definition = value; };
  require('../miniprogram/pages/buildpreview/index');
  delete global.Page;
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: { mage: { baseStats: naked, equipment: { necklace }, manaCalibration: calibration } },
    setData(values) { Object.assign(this.data, values); } });
  page.data.loading = false;
  page.showProfession('mage');
  const displayed = page.data.combatRows.concat(page.data.coreRows).flatMap(row => row.cells)
    .concat(page.data.vitalRows, page.data.extraStats);
  assert.equal(displayed.length, 17);
  assert.deepEqual(Object.fromEntries(displayed.map(row => [row.key, row.value])), result);
  page.selectEquipment({ currentTarget: { dataset: { key: 'necklace' } } });
  assert.equal(page.data.equipmentAllImpactRows.length, 17);
  assert.deepEqual(Object.fromEntries(page.data.equipmentAllImpactRows.map(row => [row.key, row.after])), result);
  necklace.equipped = false;
  assert.equal(calculate(naked, { necklace }, 'mage', calibration).hp, 12483);
  assert.equal(calculate(naked, { necklace }, 'mage', calibration).mp, 13268);
});

test('core percentages and half conversions truncate, while final soul output still rounds', () => {
  const necklace = item('necklace', {}, {}, { dragon: true });
  const result = calculate(Object.assign({}, base, { wisdom: 110 }), { necklace }, 'mage');
  assert.equal(result.wisdom, 126); // F(110 × 1.15), no rounding up at .5
  const odd = calculate(Object.assign({}, base, { strength: 51, wisdom: 101 }), {
    ring: item('ring', { strength: 2, wisdom: 2 }, { magicAttack: 3 }),
  }, 'mage');
  assert.equal(odd.minAttack, 11); // bare residual 10 - F(51 / 2), then F(53 / 2)
  assert.equal(odd.magicAttack, 55); // 2 residual + R(F(103 / 2) * 1.03) = 55
  const exact = calculate(Object.assign({}, base, { wisdom: 100 }), { necklace }, 'mage');
  assert.equal(exact.wisdom, 115); // protect 114.99999999999999 at integer boundary
});

test('supplied necklace and glove sources keep defense and magic defense separate across the combined build', () => {
  const naked = { minAttack: 25, maxAttack: 25, defense: 181, magicAttack: 1427,
    hit: 25, magicDefense: 671, strength: 50, constitution: 1387, agility: 362,
    wisdom: 2850, dexterity: 50, spirit: 1338 };
  function fromSources(slot, body, spirit, souls, effects) {
    const draft = newDraft(slot);
    for (const [key, values] of Object.entries({ body, spirit,
      spiritTransform: { attack: 80, magicAttack: 100 } })) {
      const section = draft.sections.find((source) => source.key === key);
      section.enabled = true;
      section.fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
    }
    draft.souls = Object.entries(souls).map(([key, value]) => ({ key, value: String(value) }));
    Object.assign(draft.effects, effects);
    return validateDraft(draft);
  }
  const necklace = fromSources('necklace',
    { magicAttack: 150, magicResistance: 536, armor: 237, wisdom: 152 },
    { constitution: 241, magicAttack: 274, magicDefense: 270, wisdom: 235 },
    { magicAttack: 6 }, { dragonTier: 'divine' });
  const gloves = fromSources('gloves',
    { magicAttack: 455, wisdom: 152, constitution: 152, hit: 1583, damageResistance: 137 },
    { magicDefense: 233, constitution: 248, wisdom: 270, magicAttack: 263 },
    { magicAttack: 4 }, {});
  const equipped = { necklace, gloves };
  // This configuration uses the supplied item values. The later cropped panel
  // contains 208/1274, but its complete worn-item list was not supplied.
  const result = calculate(naked, equipped, 'mage');
  assert.equal(result.defense, 208);
  assert.equal(result.magicDefense, 1274);
  assert.equal(result.agility, 416);
  assert.equal(result.spirit, 1538);
  assert.equal(result.magicResistance, 536);
  assert.equal(result.armor, 237);
  assert.equal(result.damageResistance, 137);
  const impact = equipmentImpact(naked, { necklace }, 'gloves', gloves, 'mage');
  assert.equal(impact.find((row) => row.key === 'defense').delta, 0);
  assert.equal(impact.find((row) => row.key === 'magicDefense').delta, 233);
  gloves.equipped = false;
  const removed = calculate(naked, equipped, 'mage');
  assert.equal(removed.defense, 208);
  assert.equal(removed.magicDefense, 1041);
  assert.equal(removed.damageResistance, 0);
  necklace.equipped = false;
  const bare = calculate(naked, equipped, 'mage');
  assert.equal(bare.defense, 181);
  assert.equal(bare.magicDefense, 671);
});

test('saving and unequipping one slot preserve base, another profession and other slots', async () => {
  let saved = { schemaVersion: 1, profiles: {
    mage: { baseStats: base, equipment: { weapon: item('weapon', { magicAttack: 100 }) }, custom: 'keep' },
    healer: { baseStats: base, custom: 'other' },
  } };
  const repository = createProfileRepository({
    getStorageSync(key) { assert.equal(key, STORAGE_KEY); return structuredClone(saved); },
    setStorageSync(key, value) { saved = structuredClone(value); },
  });
  await repository.saveEquipment('mage', 'ring', item('ring', { wisdom: 20 }));
  assert.equal(saved.profiles.mage.equipment.ring.sections.body.values.wisdom, 20);
  assert.equal(saved.profiles.mage.equipment.weapon.sections.body.values.magicAttack, 100);
  assert.equal(saved.profiles.healer.custom, 'other');
  assert.deepEqual(saved.profiles.mage.baseStats, base);
  await repository.saveEquipment('mage', 'ring', null);
  assert.equal(saved.profiles.mage.equipment.ring, undefined);
  assert.equal(saved.profiles.mage.custom, 'keep');
  await assert.rejects(repository.saveEquipment('mage', 'shield', null), /INVALID_SLOT/);
});
