const test = require('node:test');
const assert = require('node:assert/strict');
const { ATTRIBUTES, ALL_SLOTS, getSlot, allowedAttributes, newDraft, validateDraft, normalizeEquipment } = require('../miniprogram/domain/equipment');
const { calculate } = require('../miniprogram/domain/calculator');
const { parseEquipmentOcr } = require('../miniprogram/domain/equipmentOcr');
const { createProfileRepository } = require('../miniprogram/services/profileRepository');
let definition;
global.Page = (value) => { definition = value; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;

const base = { minAttack: 60, maxAttack: 80, defense: 20, magicAttack: 107, hit: 30,
  magicDefense: 25, strength: 100, wisdom: 200, constitution: 10, agility: 20, spirit: 30, dexterity: 40 };
function item(slot, values, effects) {
  const draft = newDraft(slot);
  draft.sections[0].fields = Object.entries(values || {}).map(([key, value]) => ({ key, value: String(value) }));
  Object.assign(draft.effects, effects);
  const result = validateDraft(draft);
  assert.ok(result);
  return result;
}
function fixture(records) {
  let saved = { schemaVersion: 1, profiles: structuredClone(records || { swordsman: { baseStats: base } }) };
  const storage = {
    getStorageSync() { return structuredClone(saved); },
    setStorageSync(key, value) { saved = structuredClone(value); },
  };
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data), profiles: structuredClone(saved.profiles),
    repository: createProfileRepository(storage),
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); },
  });
  page.data.loading = false;
  page.showProfession('swordsman');
  return { page, repository: page.repository, state: () => structuredClone(saved) };
}
const event = (data, value) => ({ currentTarget: { dataset: data }, detail: { value } });
async function withWx(api, action) {
  const previous = global.wx;
  global.wx = Object.assign({ showToast() {} }, api);
  try { return await action(); } finally { global.wx = previous; }
}

test('attribute selectors prioritize four requested fields and strictly scope spirit/transform', () => {
  assert.deepEqual(ATTRIBUTES.slice(0, 4).map((x) => x.key), ['strength', 'wisdom', 'constitution', 'hp']);
  assert.deepEqual(allowedAttributes('necklace', 'spirit').map((x) => x.key),
    ['strength', 'wisdom', 'constitution', 'agility', 'spirit', 'dexterity',
      'attack', 'magicAttack', 'defense', 'magicDefense', 'damageResistance', 'magicResistance']);
  assert.deepEqual(allowedAttributes('ring', 'spirit').map((x) => x.key),
    ['strength', 'wisdom', 'constitution', 'hp', 'agility', 'spirit', 'dexterity',
      'attack', 'magicAttack', 'defense', 'magicDefense', 'damageResistance', 'magicResistance']);
  assert.deepEqual(allowedAttributes('ring', 'spiritTransform').map((x) => x.key), ['hp', 'attack', 'magicAttack', 'mp']);
  const draft = newDraft('boots');
  draft.sections[0].fields = [{ key: 'wisdom', value: '1' }];
  const spirit = draft.sections.find((s) => s.key === 'spirit');
  spirit.enabled = true; spirit.fields = [{ key: 'defense', value: '100' }];
  assert.ok(validateDraft(draft));
  spirit.fields = [{ key: 'hp', value: '100' }];
  assert.equal(validateDraft(draft), null);
});

test('every non-badge spirit accepts six core and six combat fields, with life only on rings', () => {
  const values = { strength: 1, wisdom: 2, constitution: 3, agility: 4, spirit: 5, dexterity: 6,
    magicAttack: 7, attack: 8, defense: 9, magicDefense: 10, damageResistance: 11, magicResistance: 12 };
  for (const { key } of ALL_SLOTS.filter((s) => getSlot(s.key).hasSpirit)) {
    const draft = newDraft(key);
    const spirit = draft.sections.find((s) => s.key === 'spirit');
    spirit.enabled = true;
    spirit.fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
    assert.deepEqual(validateDraft(draft).sections.spirit.values, values, key);
    spirit.fields.push({ key: 'hp', value: '100' });
    if (key === 'ring') assert.equal(validateDraft(draft).sections.spirit.values.hp, 100);
    else assert.equal(validateDraft(draft), null, key);
  }
  assert.equal(newDraft('badge1').sections.some((s) => s.key === 'spirit'), false);
});

test('spirit OCR previews, saves and toggles six combat fields with separate resistance totals', async () => {
  const { page, state } = fixture();
  page.selectEquipment(event({ key: 'boots' }));
  page.applyRecognizedEquipment(parseEquipmentOcr([
    '防御3', '魔法防御5', '伤害抗性7', '魔法抗性11', '护甲13', '靴灵：',
    '力量2', '智慧4', '体质6', '敏捷8', '精神10', '灵巧12',
    '魔法攻击100', '攻击80', '防御20', '魔法防御30', '伤害抗性值40', '魔法抗性50',
  ].join('\n'), 'boots'));
  assert.equal(page.data.ocrPending.length, 0);
  assert.equal(page.data.equipmentCanSave, true);
  const expected = { minAttack: 141, maxAttack: 161, magicAttack: 209,
    defense: 47, magicDefense: 65, damageResistance: 47, magicResistance: 61, armor: 13 };
  for (const [key, value] of Object.entries(expected)) {
    const row = page.data.equipmentAllImpactRows.find((r) => r.key === key);
    assert.equal(row.after, value, key);
    if (key === 'damageResistance') assert.equal(row.delta, 47);
  }
  await withWx({}, async () => {
    await page.confirmEquipment();
    assert.equal(state().profiles.swordsman.equipment.boots.sections.spirit.values.damageResistance, 40);
    const restored = fixture(state().profiles).page;
    assert.equal(restored.data.extraStats.find((s) => s.key === 'damageResistance').value, 47);
    assert.equal(restored.data.extraStats.find((s) => s.key === 'magicResistance').value, 61);
    page.data.equipmentMode = 'takeoff';
    await page.selectEquipment(event({ key: 'boots' }));
    assert.equal(page.data.extraStats.find((s) => s.key === 'damageResistance').value, 0);
    await page.selectEquipment(event({ key: 'boots' }));
    assert.equal(page.data.extraStats.find((s) => s.key === 'damageResistance').value, 47);
    assert.equal(page.data.extraStats.find((s) => s.key === 'armor').value, 13);
  });
});

test('saved spirit attack and defense values become regular editable fields without changing stats', () => {
  const old = {
    version: 1, name: '旧项灵', sections: {
      body: { enabled: true, values: { wisdom: 10 } },
      spirit: { enabled: true, values: { magicAttack: 274, magicDefense: 270 } },
    }, effects: {}, souls: {},
  };
  const draft = newDraft('necklace', old);
  assert.equal(draft.sections.find((s) => s.key === 'spirit').fields.every((f) => f.legacy === false), true);
  const normalized = normalizeEquipment('necklace', old);
  assert.equal(normalized.sections.spirit.values.magicAttack, 274);
  assert.equal(calculate(base, { necklace: old }, 'swordsman').magicDefense, 295);
});

test('dark might adds fixed stats once then five 30% bonuses, dragon combines to 45%', () => {
  const weapon = item('weapon', {}, { darkMight: true });
  const equipment = { weapon, badge1: item('badge1', { wisdom: 100 }) };
  const result = calculate(base, equipment, 'swordsman');
  assert.equal(result.strength, 728);
  assert.equal(result.wisdom, 988);
  assert.equal(result.constitution, 13);
  assert.equal(result.spirit, 39);
  assert.equal(result.dexterity, 40);
  equipment.necklace = item('necklace', {}, { dragon: true });
  const combined = calculate(base, equipment, 'swordsman');
  assert.equal(combined.strength, 812);
  assert.equal(combined.wisdom, 1102);
  assert.equal(combined.agility, 29);
  assert.equal(combined.spirit, 43); // F(30 * 1.45), consistent with the integer core panel
  assert.equal(combined.dexterity, 40);
  equipment.weapon.equipped = false;
  const without = calculate(base, equipment, 'swordsman');
  assert.equal(without.strength, 115);
  assert.equal(without.wisdom, 345);
});

test('weapon custom appearance and dark might replace each other rather than double count', () => {
  const { page } = fixture();
  page.selectEquipment(event({ key: 'weapon' }));
  const costume = page.equipmentDraft.sections.find((s) => s.key === 'appearance');
  costume.enabled = true; costume.fields = [{ key: 'strength', value: '999' }];
  page.updateEquipmentEditor();
  page.chooseWeaponMode(event({}, 'darkMight'));
  assert.equal(page.data.weaponMode, 'darkMight');
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'strength').after, 728);
  page.chooseWeaponMode(event({}, 'custom'));
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'strength').after, 250);
  assert.equal(page.equipmentDraft.effects.darkMight, false);
});

test('dark might OCR creates one fixed effect without duplicating its +460 fields or percent numbers', () => {
  const parsed = parseEquipmentOcr('变装：中国威武极暗黑之杖\n力量+460\n智慧+460\n力量+30%\n敏捷+30%\n智慧+30%\n体质+30%\n精神+30%', 'weapon');
  assert.equal(parsed.effects.darkMight, true);
  assert.deepEqual(parsed.sections.appearance, {});
  assert.deepEqual(parsed.sections.body, {});
  const { page } = fixture();
  page.selectEquipment(event({ key: 'weapon' }));
  page.applyRecognizedEquipment(parsed);
  assert.equal(page.data.equipmentCanSave, true);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'wisdom').after, 858);
});

test('uploading an image containing only dark might is accepted and immediately previews its effect', async () => {
  const { page } = fixture();
  page.selectEquipment(event({ key: 'weapon' }));
  let receive;
  await withWx({
    chooseImage(options) { options.success({ tempFilePaths: ['/weapon.png'] }); },
    createOffscreenCanvas() {
      return {
        getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8Array(16) }; } }; },
        createImage() {
          const image = { width: 2, height: 2 };
          Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.onload()); } });
          return image;
        },
      };
    },
    createVKSession() {
      return {
        on(eventName, callback) { receive = callback; }, start(callback) { callback(null); },
        runOCR() { queueMicrotask(() => receive([{ text: '变装：中国威武极暗黑之杖\n力量+460\n智慧+460\n力量+30%' }])); },
        stop() {}, destroy() {},
      };
    },
  }, async () => {
    await page.uploadEquipmentImage();
    assert.equal(page.data.recognizing, false);
    assert.equal(page.data.recognitionReview, true);
    assert.equal(page.data.weaponMode, 'darkMight');
    assert.equal(page.data.equipmentCanSave, true);
    assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'strength').after, 728);
  });
});

test('re-recognizing a generic costume replaces its values instead of accumulating duplicates', () => {
  const { page } = fixture();
  page.selectEquipment(event({ key: 'helmet' }));
  const parsed = parseEquipmentOcr('智慧10\n变装：未定来源\n魔法攻击100', 'helmet');
  function applyAndAssign() {
    page.applyRecognizedEquipment(parsed);
    const group = page.data.ocrPending[0];
    const index = group.sources.findIndex((s) => s.key === 'appearance');
    page.assignOcrSource(event({ id: group.id }, String(index)));
  }
  applyAndAssign();
  const first = page.data.equipmentAllImpactRows.find((r) => r.key === 'magicAttack').after;
  applyAndAssign();
  assert.equal(page.equipmentDraft.sections.find((s) => s.key === 'appearance').fields[0].value, '100');
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'magicAttack').after, first);
});

test('restricted OCR values remain available and moving a legacy field never counts it twice', () => {
  const old = { version: 1, sections: {
    body: { enabled: true, values: { magicAttack: 150 } },
    spirit: { enabled: true, values: { wisdom: 20, hp: 274 } },
  }, effects: {}, souls: {} };
  const { page } = fixture({ swordsman: { baseStats: base, equipment: { necklace: old } } });
  page.selectEquipment(event({ key: 'necklace' }));
  page.applyRecognizedEquipment(parseEquipmentOcr('魔法攻击150\n项灵：\n智慧20\n最大生命274', 'necklace'));
  const group = page.data.ocrPending.find((g) => g.fromSection === 'spirit');
  assert.ok(group);
  assert.deepEqual(group.sources.map((s) => s.key), ['body', 'spiritTransform']);
  const bodyIndex = group.sources.findIndex((s) => s.key === 'body');
  page.assignOcrSource(event({ id: group.id }, String(bodyIndex)));
  assert.equal(page.equipmentDraft.sections[0].fields.find((f) => f.key === 'hp').value, '274');
  assert.equal(page.equipmentDraft.sections.find((s) => s.key === 'spirit').fields.some((f) => f.key === 'hp'), false);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'magicAttack').after, 267);
  assert.equal(page.data.equipmentAllImpactRows.find((r) => r.key === 'hp').after, 364);
});

test('takeoff hint stays five seconds then fades for half a second, switching modes cancels timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page } = fixture();
  assert.equal(page.data.equipmentMode, 'edit');
  page.setEquipmentMode(event({ mode: 'takeoff' }));
  assert.equal(page.data.takeoffHintVisible, true);
  t.mock.timers.tick(4999);
  assert.equal(page.data.takeoffHintFading, false);
  t.mock.timers.tick(1);
  assert.equal(page.data.takeoffHintFading, true);
  t.mock.timers.tick(500);
  assert.equal(page.data.takeoffHintVisible, false);
  page.setEquipmentMode(event({ mode: 'takeoff' }));
  page.setEquipmentMode(event({ mode: 'edit' }));
  t.mock.timers.tick(6000);
  assert.equal(page.data.takeoffHintVisible, false);
  page.onUnload();
});

test('taking off retains all sources and metadata while excluding stats, soul and global effects', async () => {
  const weapon = Object.assign(item('weapon', { magicAttack: 100 }, { darkMight: true }), { custom: 'preserve' });
  const { repository, state } = fixture({ swordsman: { baseStats: base, equipment: { weapon } } });
  await repository.setEquipmentActive('swordsman', 'weapon', false);
  const saved = state().profiles.swordsman.equipment.weapon;
  assert.equal(saved.custom, 'preserve');
  assert.deepEqual(saved.sections, weapon.sections);
  assert.equal(saved.equipped, false);
  const stats = calculate(base, { weapon: saved }, 'swordsman');
  assert.equal(stats.magicAttack, base.magicAttack);
  assert.equal(stats.strength, base.strength);
  await repository.setEquipmentActive('swordsman', 'weapon', true);
  assert.equal(state().profiles.swordsman.equipment.weapon.equipped, true);
});

test('clicking gear in takeoff mode updates totals, and editing it can equip it again', async () => {
  const ring = item('ring', { wisdom: 20 });
  const { page, state } = fixture({ swordsman: { baseStats: base, equipment: { ring } } });
  await withWx({}, async () => {
    try {
      page.setEquipmentMode(event({ mode: 'takeoff' }));
      await page.selectEquipment(event({ key: 'ring' }));
      assert.equal(page.data.equipmentOpen, false);
      assert.equal(page.data.recordedCount, 1);
      assert.equal(page.data.equippedCount, 0);
      assert.equal(state().profiles.swordsman.equipment.ring.equipped, false);
      page.setEquipmentMode(event({ mode: 'edit' }));
      page.selectEquipment(event({ key: 'ring' }));
      assert.equal(page.equipmentDraft.equipped, true);
      assert.equal(page.equipmentDraft.sections[0].fields[0].value, '20');
      await page.confirmEquipment();
      assert.equal(page.data.equippedCount, 1);
      assert.equal(state().profiles.swordsman.equipment.ring.equipped, true);
    } finally { page.clearEquipmentModeTimers(); }
  });
});

test('takeoff mode toggles every kind of slot back on and restores its full calculated panel', async () => {
  const panel = (page) => structuredClone({ combat: page.data.combatRows, core: page.data.coreRows,
    vital: page.data.vitalRows, extra: page.data.extraStats });
  for (const slot of ['ring', 'necklace', 'weapon', 'face', 'badge1', 'artifact', 'shield']) {
    const equipment = item(slot, { wisdom: 20, hp: 100, magicAttack: 50 }, {
      dragon: slot === 'necklace', darkMight: slot === 'weapon', bazhe10: slot === 'face',
    });
    if (slot === 'ring') equipment.souls = { magicAttack: 23, hp: 10 };
    equipment.custom = 'preserve original metadata';
    const otherProfession = { baseStats: base, equipment: { ring: item('ring', { wisdom: 40 }) } };
    const { page, state } = fixture({ swordsman: { baseStats: base, equipment: { [slot]: equipment } }, mage: otherProfession });
    const equippedPanel = panel(page);
    page.data.equipmentMode = 'takeoff';
    await withWx({}, async () => {
      await page.selectEquipment(event({ key: slot }));
      assert.equal(state().profiles.swordsman.equipment[slot].equipped, false, slot);
      assert.equal(page.data.equippedCount, 0, slot);
      assert.notDeepEqual(panel(page), equippedPanel, slot);
      await page.selectEquipment(event({ key: slot }));
      assert.equal(state().profiles.swordsman.equipment[slot].equipped, true, slot);
      assert.equal(page.data.equippedCount, 1, slot);
      assert.equal(page.data.recordedCount, 1, slot);
      assert.equal(page.data.equipmentOpen, false, slot);
      assert.equal(page.data.equipmentMode, 'takeoff', slot);
      assert.deepEqual(panel(page), equippedPanel, slot);
      assert.deepEqual(state().profiles.swordsman.equipment[slot], { ...equipment, equipped: true }, slot);
      assert.deepEqual(state().profiles.mage, otherProfession, slot);
      const restored = fixture(state().profiles).page;
      assert.deepEqual(panel(restored), equippedPanel, slot);
      if (slot === 'artifact') assert.equal(page.data.artifactInactive, false);
      else assert.equal(page.data.leftSlots.concat(page.data.rightSlots, page.data.badges)
        .find((s) => s.key === slot).inactive, false, slot);
    });
  }
});

test('saved inactive gear can be re-equipped directly after returning to the page', async () => {
  const ring = item('ring', { wisdom: 20 }); ring.equipped = false;
  const { page, state } = fixture({ swordsman: { baseStats: base, equipment: { ring } } });
  page.data.equipmentMode = 'takeoff';
  await withWx({}, async () => {
    await page.selectEquipment(event({ key: 'ring' }));
    assert.equal(state().profiles.swordsman.equipment.ring.equipped, true);
    const wisdom = page.data.coreRows.flatMap((r) => r.cells).find((cell) => cell.key === 'wisdom');
    assert.equal(wisdom.value, base.wisdom + 20);
    assert.equal(page.data.equippedCount, 1);
  });
});

test('failed wear toggles preserve gear and totals, and ignore repeat taps while saving', async () => {
  for (const equipped of [true, false]) {
    const ring = item('ring', { wisdom: 20 }); ring.equipped = equipped;
    const { page, state } = fixture({ swordsman: { baseStats: base, equipment: { ring } } });
    const before = structuredClone(page.data);
    const saved = state();
    let fail, calls = 0;
    page.repository.setEquipmentActive = (profession, slot, active) => {
      calls++;
      assert.equal(active, !equipped);
      return new Promise((resolve, reject) => { fail = reject; });
    };
    page.data.equipmentMode = 'takeoff';
    await withWx({}, async () => {
      const pending = page.selectEquipment(event({ key: 'ring' }));
      assert.equal(page.data.equipmentBusy, true);
      await page.selectEquipment(event({ key: 'ring' }));
      assert.equal(calls, 1);
      fail(new Error('storage full'));
      await pending;
      assert.equal(page.data.equipmentBusy, false);
      assert.deepEqual(state(), saved);
      assert.deepEqual(page.profiles.swordsman, saved.profiles.swordsman);
      assert.deepEqual(page.data.coreRows, before.coreRows);
      assert.equal(page.data.equippedCount, before.equippedCount);
      await page.selectEquipment(event({ key: 'helmet' }));
      assert.equal(calls, 1);
      assert.deepEqual(state(), saved);
    });
  }
});

test('clear cancellation writes nothing and restores the selected mode', async () => {
  const { page, state } = fixture({ swordsman: { baseStats: base, equipment: { ring: item('ring', { wisdom: 20 }) } } });
  let modal;
  const original = state();
  await withWx({ showModal(options) { modal = options; } }, async () => {
    const pending = page.setEquipmentMode(event({ mode: 'clear' }));
    assert.equal(modal.content, '是否清除所有录入装备');
    assert.equal(page.data.clearConfirmationOpen, true);
    modal.success({ confirm: false, cancel: true });
    await pending;
    assert.deepEqual(state(), original);
    assert.equal(page.data.equipmentMode, 'edit');
  });
});

test('confirmed clear resets this profession to bare stats while preserving other professions', async () => {
  const ring = item('ring', { wisdom: 20 }); ring.equipped = false;
  const records = {
    swordsman: { baseStats: base, equipment: { ring, weapon: item('weapon', {}, { darkMight: true }) }, custom: 'keep' },
    mage: { baseStats: base, equipment: { ring: item('ring', { wisdom: 40 }) }, custom: 'other' },
  };
  const { page, state } = fixture(records);
  await withWx({ showModal(options) { options.success({ confirm: true }); } }, async () => {
    await page.setEquipmentMode(event({ mode: 'clear' }));
    assert.deepEqual(state().profiles.swordsman.equipment, {});
    assert.deepEqual(state().profiles.swordsman.baseStats, base);
    assert.equal(state().profiles.swordsman.custom, 'keep');
    assert.deepEqual(state().profiles.mage, records.mage);
    const displayed = page.data.combatRows.concat(page.data.coreRows).flatMap((r) => r.cells);
    for (const cell of displayed) assert.equal(cell.value, base[cell.key], cell.key);
    assert.equal(page.data.equippedCount, 0);
    assert.equal(page.data.recordedCount, 0);
    assert.equal(page.data.equipmentMode, 'edit');
  });
});

test('failed clear preserves gear; repeated clear taps cannot submit a second operation', async () => {
  const { page } = fixture({ swordsman: { baseStats: base, equipment: { ring: item('ring', { wisdom: 20 }) } } });
  const original = structuredClone(page.profiles.swordsman);
  let modal, reject, calls = 0;
  page.repository.clearEquipment = () => { calls++; return new Promise((resolve, fail) => { reject = fail; }); };
  await withWx({ showModal(options) { modal = options; } }, async () => {
    const pending = page.setEquipmentMode(event({ mode: 'clear' }));
    await page.setEquipmentMode(event({ mode: 'clear' }));
    modal.success({ confirm: true });
    await Promise.resolve();
    await page.setEquipmentMode(event({ mode: 'clear' }));
    assert.equal(calls, 1);
    reject(new Error('storage full'));
    await pending;
    assert.deepEqual(page.profiles.swordsman, original);
    assert.equal(page.data.equipmentBusy, false);
    assert.equal(page.data.clearConfirmationOpen, false);
    assert.equal(page.data.equipmentMode, 'edit');
  });
});
