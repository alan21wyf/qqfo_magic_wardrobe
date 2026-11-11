const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeManaCalibration } = require('../miniprogram/domain/profile');
const { newDraft, validateDraft } = require('../miniprogram/domain/equipment');
const { calculate, equipmentImpact } = require('../miniprogram/domain/calculator');
const { createProfileRepository, STORAGE_KEY } = require('../miniprogram/services/profileRepository');

const bare = { minAttack: 25, maxAttack: 25, defense: 181, magicAttack: 1427, hit: 25,
  magicDefense: 671, strength: 50, constitution: 1387, agility: 362, wisdom: 2850, dexterity: 50, spirit: 1338 };
const calibration = { spirit: 1338, mp: 13268 };
function item(slot, values = {}, effects = {}) {
  const draft = newDraft(slot);
  draft.sections[0].fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
  Object.assign(draft.effects, effects);
  return validateDraft(draft);
}
const dragon = () => item('necklace', {}, { dragonTier: 'divine' });

test('calibration uses each naked MP baseline and adds whole spirit, direct mana and complete-config impact', () => {
  const equipment = { necklace: dragon() };
  assert.equal(calculate(bare, {}, 'mage', calibration).mp, 13268);
  assert.equal(calculate(bare, equipment, 'mage', calibration).mp, 15248);
  assert.equal(calculate(bare, equipment, 'mage', { spirit: 1338, mp: 20000 }).mp, 21980);
  assert.equal(equipmentImpact(bare, {}, 'necklace', equipment.necklace, 'mage', calibration)
    .find((row) => row.key === 'mp').delta, 1980);
  equipment.ring = item('ring', { spirit: 260, mp: 25 });
  assert.equal(calculate(bare, equipment, 'mage', calibration).mp, 18233);
  equipment.ring.equipped = false;
  assert.equal(calculate(bare, equipment, 'mage', calibration).mp, 15248);
});

test('whole-spirit truncation handles floating integer boundaries and calibration rejects stale baselines', () => {
  const base = { ...bare, spirit: 100 };
  assert.equal(calculate(base, { necklace: dragon() }, 'mage', { spirit: 100, mp: 990 }).mp, 1139);
  assert.equal(calculate(bare, { necklace: dragon() }, 'mage').mp, 15226); // R(1538 integer spirit * 9.9), without a baseline
  assert.equal(calculate(bare, { necklace: dragon() }, 'mage', { spirit: 100, mp: 990 }).mp, 15226);
  for (const value of [null, {}, { spirit: 1338, mp: -1 }, { spirit: 1338, mp: 'abc' },
    { spirit: 1338, mp: 1.5 }, { spirit: 100, mp: 13268 }]) {
    assert.equal(normalizeManaCalibration(value, bare), null);
  }
  assert.deepEqual(normalizeManaCalibration({ spirit: 1338, mp: 0 }, bare), { spirit: 1338, mp: 0 });
});

function storageFixture() {
  let saved = { schemaVersion: 1, profiles: {
    mage: { baseStats: bare, equipment: { necklace: dragon() }, custom: 'keep' },
    healer: { baseStats: { ...bare, spirit: 100 }, manaCalibration: { spirit: 100, mp: 1234 } },
  } };
  let writes = 0;
  const storage = { getStorageSync: () => structuredClone(saved), setStorageSync(key, value) {
    assert.equal(key, STORAGE_KEY); writes++; saved = structuredClone(value);
  } };
  return { storage, repository: createProfileRepository(storage), saved: () => structuredClone(saved), writes: () => writes };
}

test('repository stores measured mana per profession, preserves it through equipment operations and clears stale values', async () => {
  const f = storageFixture(); const other = f.saved().profiles.healer;
  await f.repository.save('mage', bare, 13268);
  assert.deepEqual((await f.repository.load()).profiles.mage.manaCalibration, calibration);
  assert.equal(f.saved().profiles.mage.custom, 'keep');
  await f.repository.setEquipmentActive('mage', 'necklace', false);
  await f.repository.applyEquipmentPreset('mage', 102);
  await f.repository.clearEquipment('mage');
  assert.deepEqual(f.saved().profiles.mage.manaCalibration, calibration);
  assert.deepEqual(f.saved().profiles.healer, other);
  await f.repository.save('mage', { ...bare, wisdom: 3000 });
  assert.deepEqual(f.saved().profiles.mage.manaCalibration, calibration);
  await f.repository.save('mage', { ...bare, spirit: 1339 });
  assert.equal(f.saved().profiles.mage.manaCalibration, undefined);
  await f.repository.save('mage', bare, 13268);
  await f.repository.save('mage', bare, null);
  assert.equal(f.saved().profiles.mage.manaCalibration, undefined);
});

test('invalid mana is never written and write failure keeps the previous calibration', async () => {
  const f = storageFixture(); await f.repository.save('mage', bare, 13268);
  const before = f.saved(), writes = f.writes();
  for (const value of ['abc', -1, 1.5, '', NaN]) {
    await assert.rejects(f.repository.save('mage', bare, value), /INVALID_MANA_CALIBRATION/);
  }
  assert.equal(f.writes(), writes); assert.deepEqual(f.saved(), before);
  f.storage.setStorageSync = () => { throw new Error('STORAGE_FULL'); };
  await assert.rejects(f.repository.save('mage', bare, 20000), /STORAGE_FULL/);
  assert.deepEqual(f.saved(), before);
});

let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;
function pageFixture() {
  const f = storageFixture();
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), repository: f.repository,
    profiles: f.saved().profiles, setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); } });
  page.data.loading = false; page.showProfession('mage');
  return { ...f, page };
}
const event = (value, key) => ({ detail: { value }, currentTarget: { dataset: { key } } });
const mana = page => page.data.vitalRows.find(row => row.key === 'mp').value;

test('optional measured mana only takes effect after confirmation and restores across reopen/reload/professions', async () => {
  const { page, writes, repository } = pageFixture(); const previous = global.wx;
  global.wx = { showToast() {} };
  try {
    assert.equal(mana(page), 15226);
    page.openBaseDialog(); assert.equal(page.data.fields.length, 12);
    page.onMeasuredMpInput(event('13268')); assert.equal(page.data.canConfirm, true);
    assert.equal(mana(page), 15226); assert.equal(writes(), 0);
    page.closeBaseDialog(); page.openBaseDialog();
    assert.equal(page.data.measuredMpDraft, '');
    page.onMeasuredMpInput(event('13268')); await page.confirmBase();
    assert.equal(mana(page), 15248); assert.equal(writes(), 1);
    page.openBaseDialog(); assert.equal(page.data.measuredMpDraft, '13268'); page.closeBaseDialog();
    page.profiles = (await repository.load()).profiles; page.showProfession('mage');
    assert.equal(mana(page), 15248);
    page.showProfession('healer'); assert.equal(mana(page), 1234);
    page.showProfession('mage'); assert.equal(mana(page), 15248);
    page.selectEquipment(event(undefined, 'necklace'));
    const delta = page.data.equipmentAllImpactRows.find(row => row.key === 'mp');
    assert.equal(delta.after, 15248); assert.equal(delta.before, 13268); assert.equal(delta.delta, 1980);
  } finally { global.wx = previous; }
});

test('mana input is optional, validates integers, clears when naked spirit changes, and keeps keyboard scrolling', () => {
  const { page } = pageFixture(); page.openBaseDialog();
  for (const value of ['abc', '-1', '1.5', '1e3']) {
    page.onMeasuredMpInput(event(value)); assert.equal(page.data.measuredMpInvalid, true);
    assert.equal(page.data.canConfirm, false);
  }
  for (const value of ['', ' ', '0', '13268']) {
    page.onMeasuredMpInput(event(value)); assert.equal(page.data.canConfirm, true);
  }
  page.onFieldFocus(event(undefined, 'measuredMp')); page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.fieldScrollTarget, 'field-row-measuredMp');
  page.onFieldInput(event('3000', 'wisdom')); assert.equal(page.data.measuredMpDraft, '13268');
  page.onFieldInput(event('1339', 'spirit')); assert.equal(page.data.measuredMpDraft, '');
  assert.equal(page.data.canConfirm, true);
});

test('failed mana confirmation keeps its editable value and prevents duplicate saves', async () => {
  const { page } = pageFixture(); page.openBaseDialog(); page.onMeasuredMpInput(event('13268'));
  let calls = 0, fail;
  page.repository = { save(profession, stats, mp) {
    assert.equal(mp, 13268); calls++; return new Promise((_, reject) => { fail = reject; });
  } };
  const request = page.confirmBase(); await page.confirmBase();
  assert.equal(calls, 1); fail(new Error('full')); await request;
  assert.equal(page.data.measuredMpDraft, '13268'); assert.equal(page.data.dialogOpen, true);
  assert.equal(mana(page), 15226); assert.equal(page.profiles.mage.manaCalibration, undefined);
});
