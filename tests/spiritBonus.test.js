const test = require('node:test');
const assert = require('node:assert/strict');
const { STAT_FIELDS } = require('../miniprogram/domain/profile');
const { newDraft, validateDraft, decorateDraft, getSpiritBonus } = require('../miniprogram/domain/equipment');
const { calculate, equipmentImpact } = require('../miniprogram/domain/calculator');
const { createProfileRepository } = require('../miniprogram/services/profileRepository');

const base = Object.fromEntries(STAT_FIELDS.map((field) => [field.key, 100]));
const values = { wisdom: 285, constitution: 285, magicAttack: 285, magicDefense: 285 };
const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });
function item(slot, spiritValues = values) {
  const draft = newDraft(slot);
  const section = draft.sections.find((source) => source.key === 'spirit');
  section.enabled = true;
  section.fields = Object.entries(spiritValues).map(([key, value]) => ({ key, value: String(value) }));
  return validateDraft(draft);
}

test('spirit reward requires every recorded attribute at least 285, including the exact threshold', () => {
  assert.deepEqual(getSpiritBonus('helmet', values), { hp: 3000, movementSpeedPercent: 1 });
  assert.deepEqual(getSpiritBonus('boots', values), { hp: 3000, movementSpeedPercent: 2 });
  assert.deepEqual(getSpiritBonus('weapon', { strength: 300, constitution: 400 }),
    { hp: 3000, movementSpeedPercent: 1 });
  for (const input of [{}, null, { ...values, wisdom: 284.99 }, { ...values, magicDefense: '' },
    { ...values, magicDefense: 'bad' }, { ...values, magicDefense: 0 }, { ...values, magicDefense: Infinity }]) {
    assert.equal(getSpiritBonus('helmet', input), null);
  }
  assert.equal(getSpiritBonus('badge1', values), null);
  assert.equal(getSpiritBonus('unknown', values), null);
});

test('reward is a direct life source before life soul, applied once per active spirit and never to body or transform', () => {
  const helmet = item('helmet');
  helmet.souls.hp = 20;
  const total = calculate(base, { helmet }, 'mage');
  assert.equal(total.hp, (385 * 9 + 3000) * 1.2);
  assert.equal(equipmentImpact(base, {}, 'helmet', helmet, 'mage').find((row) => row.key === 'hp').delta,
    total.hp - 900);
  assert.equal(calculate(base, { helmet, boots: item('boots') }, 'mage').hp,
    (670 * 9 + 6000) * 1.2);
  helmet.sections.spirit.enabled = false;
  helmet.sections.body.values = { wisdom: 285, constitution: 285 };
  helmet.sections.spiritTransform = { enabled: true, selection: { key: 'gold-life' }, values: {} };
  assert.equal(calculate(base, { helmet }, 'mage').hp, (385 * 9 + 2500) * 1.2);
  helmet.equipped = false;
  assert.equal(calculate(base, { helmet }, 'mage').hp, 900);
});

test('fixed ring presets do not qualify based on their attack branch or a forged display value', () => {
  for (const key of ['3-magic-spirit', '7-magic-spirit', '9-magic-spirit', 'gold-magic-spirit']) {
    const draft = newDraft('ring');
    const section = draft.sections.find((source) => source.key === 'spirit');
    section.enabled = true;
    section.selection = { key, trueSoul: true };
    section.fields = [{ key: 'magicAttack', value: '999' }];
    assert.equal(decorateDraft(draft).find((source) => source.key === 'spirit').spiritBonus, null);
    const ring = validateDraft(draft);
    assert.equal(getSpiritBonus('ring', ring.sections.spirit.values), null);
  }
});

test('save/reload and repeated calculation derive reward without writing it into raw spirit attributes', async () => {
  let saved;
  const repository = createProfileRepository({
    getStorageSync() { return saved && structuredClone(saved); },
    setStorageSync(key, value) { saved = structuredClone(value); },
  });
  await repository.save('mage', base);
  await repository.saveEquipment('mage', 'boots', item('boots'));
  let record = (await repository.load()).profiles.mage;
  assert.deepEqual(record.equipment.boots.sections.spirit.values, values);
  const expected = 385 * 9 + 3000;
  for (let index = 0; index < 3; index++) {
    assert.equal(calculate(record.baseStats, record.equipment, 'mage').hp, expected);
    await repository.saveEquipment('mage', 'boots', record.equipment.boots);
    record = (await repository.load()).profiles.mage;
    assert.deepEqual(record.equipment.boots.sections.spirit.values, values);
  }
  record = await repository.setEquipmentActive('mage', 'boots', false);
  assert.equal(calculate(base, record.equipment, 'mage').hp, 900);
  record = await repository.setEquipmentActive('mage', 'boots', true);
  assert.equal(calculate(base, record.equipment, 'mage').hp, expected);
});

let definition;
global.Page = (page) => { definition = page; };
require('../miniprogram/pages/buildpreview/index');
delete global.Page;

test('manual editor gains and loses reward immediately at the threshold; empty fields and source-off remove it', () => {
  const page = Object.assign({}, definition, { data: structuredClone(definition.data),
    profiles: { mage: { baseStats: base } },
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); } });
  page.data.loading = false;
  page.showProfession('mage');
  page.selectEquipment(event({ key: 'boots' }));
  page.equipmentDraft.sections.find((source) => source.key === 'body').fields = [{ key: 'hp', value: '0' }];
  const section = page.equipmentDraft.sections.find((source) => source.key === 'spirit');
  section.enabled = true;
  section.fields = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));
  page.updateEquipmentEditor();
  const displayed = () => page.data.equipmentSections.find((source) => source.key === 'spirit');
  const lifeAfter = () => page.data.equipmentAllImpactRows.find((row) => row.key === 'hp').after;
  assert.equal(displayed().spiritBonus.movementSpeedPercent, 2);
  assert.equal(lifeAfter(), 6465);
  page.onEquipmentField(event({ section: 'spirit', key: 'magicAttack' }, '284'));
  assert.equal(displayed().spiritBonus, null);
  assert.equal(lifeAfter(), 3465);
  page.onEquipmentField(event({ section: 'spirit', key: 'magicAttack' }, '285'));
  assert.equal(lifeAfter(), 6465);
  page.onEquipmentField(event({ section: 'spirit', key: 'magicDefense' }, ''));
  assert.equal(displayed().spiritBonus, null);
  assert.equal(page.data.equipmentCanSave, false);
  page.onEquipmentField(event({ section: 'spirit', key: 'magicDefense' }, '285'));
  page.toggleEquipmentSection(event({ section: 'spirit' }, false));
  assert.equal(displayed().spiritBonus, null);
  assert.equal(lifeAfter(), 900);
});
