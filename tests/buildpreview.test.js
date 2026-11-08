const test = require('node:test');
const assert = require('node:assert/strict');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
let definition;
global.Page = (page) => { definition = page; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;

function pageFixture() {
  return Object.assign({}, definition, {
    data: structuredClone(definition.data), profiles: {},
    setData(values, callback) {
      Object.assign(this.data, values);
      if (callback) callback();
    },
  });
}

test('shield disappears for other professions and zero profiles survive switching', () => {
  const page = pageFixture();
  const stats = Object.fromEntries(STAT_FIELDS.map((field) => [field.key, 0]));
  page.profiles.swordsman = { baseStats: stats };
  page.showProfession('swordsman');
  assert.equal(page.data.ready, true);
  assert.equal(page.data.rightSlots.length, 5);
  for (const profession of ['healer', 'mage', 'warrior', 'assassin']) {
    page.showProfession(profession);
    assert.equal(page.data.ready, false);
    assert.equal(page.data.rightSlots.some((slot) => slot.key === 'shield'), false);
  }
  page.showProfession('swordsman');
  assert.equal(page.data.ready, true);
});

test('cancelled editing never mutates confirmed data and reopening uses saved values', () => {
  const page = pageFixture();
  const stats = Object.fromEntries(STAT_FIELDS.map((field) => [field.key, 0]));
  page.data.loading = false;
  page.profiles.swordsman = { baseStats: stats };
  page.openBaseDialog();
  page.onFieldInput({ currentTarget: { dataset: { key: 'strength' } }, detail: { value: '900' } });
  page.closeBaseDialog();
  page.openBaseDialog();
  assert.equal(page.data.fields.find((field) => field.key === 'strength').value, '0');
  assert.equal(stats.strength, 0);
});

test('double confirmation saves once, and storage errors keep the editable draft', async () => {
  const page = pageFixture();
  page.data.loading = false;
  page.openBaseDialog();
  for (const field of STAT_FIELDS) {
    page.onFieldInput({ currentTarget: { dataset: { key: field.key } }, detail: { value: '0' } });
  }
  let rejectSave;
  let calls = 0;
  page.repository = { save() {
    calls += 1;
    return new Promise((resolve, reject) => { rejectSave = reject; });
  } };
  const first = page.confirmBase();
  await page.confirmBase();
  assert.equal(calls, 1);
  rejectSave(new Error('full storage'));
  await first;
  assert.equal(page.data.dialogOpen, true);
  assert.equal(page.data.fields.length, 12);
  assert.equal(page.data.ready, false);
  assert.equal(page.data.saving, false);
  assert.ok(page.data.saveError);
});

test('successful confirmation unlocks all-zero stats and reload restores the confirmed profession', async () => {
  const page = pageFixture();
  page.data.loading = false;
  page.openBaseDialog();
  for (const field of STAT_FIELDS) {
    page.onFieldInput({ currentTarget: { dataset: { key: field.key } }, detail: { value: '0' } });
  }
  const profile = { baseStats: Object.fromEntries(STAT_FIELDS.map((field) => [field.key, 0])) };
  page.repository = { async save() { return profile; } };
  const previousWx = global.wx;
  global.wx = { showToast() {} };
  try { await page.confirmBase(); } finally { global.wx = previousWx; }
  assert.equal(page.data.dialogOpen, false);
  assert.equal(page.data.ready, true);
  const reloaded = pageFixture();
  reloaded.repository = { async load() { return { profiles: { swordsman: profile } }; } };
  await reloaded.loadProfiles();
  assert.equal(reloaded.data.ready, true);
  assert.equal(reloaded.data.combatRows[0].cells[0].value, 0);
});

test('read failure disables data entry until a successful retry', async () => {
  const page = pageFixture();
  page.repository = { async load() { throw new Error('unavailable storage'); } };
  await page.loadProfiles();
  page.openBaseDialog();
  assert.equal(page.data.dialogOpen, false);
  assert.equal(page.data.loadError, true);
  page.repository = { async load() { return { profiles: {} }; } };
  await page.loadProfiles();
  page.openBaseDialog();
  assert.equal(page.data.loadError, false);
  assert.equal(page.data.dialogOpen, true);
  assert.equal(page.data.canConfirm, false);
});

test('keyboard height resizes the form and scrolls the focused field into view', () => {
  const page = pageFixture();
  page.data.loading = false;
  page.openBaseDialog();
  page.onFieldFocus({ currentTarget: { dataset: { key: 'spirit' } } });
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.keyboardHeight, 300);
  assert.equal(page.data.fieldScrollTarget, 'field-row-spirit');
  page.closeBaseDialog();
  page.onKeyboardChange({ detail: { height: 300 } });
  assert.equal(page.data.keyboardHeight, 0);
});
