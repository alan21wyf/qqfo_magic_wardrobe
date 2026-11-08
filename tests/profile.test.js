const test = require('node:test');
const assert = require('node:assert/strict');
const { STAT_FIELDS, validateStats, createDraft, draftToStats, parseNumericValue } = require('../miniprogram/domain/profile');
const { createProfileRepository, STORAGE_KEY } = require('../miniprogram/services/profileRepository');
const zeroStats = Object.fromEntries(STAT_FIELDS.map((field) => [field.key, 0]));

function memoryStorage(seed) {
  const values = { [STORAGE_KEY]: seed };
  return {
    getStorageSync(key) { return structuredClone(values[key]); },
    setStorageSync(key, value) { values[key] = structuredClone(value); },
  };
}

test('blank, partial, nonnumeric forms stay invalid while twelve explicit zeros are valid', () => {
  const fields = createDraft();
  assert.equal(draftToStats(fields), null);
  fields.forEach((field) => { field.value = '0'; });
  assert.deepEqual(draftToStats(fields), zeroStats);
  for (const value of ['', '  ', 'abc', '1e3', '-1', 'Infinity', '1.2.3', NaN, null]) {
    fields[11].value = value;
    assert.equal(draftToStats(fields), null, String(value));
  }
  assert.equal(parseNumericValue('1.25'), 1.25);
});

test('twelve distinct values keep field identity across form, validation and storage', async () => {
  const values = Object.fromEntries(STAT_FIELDS.map((field, index) => [field.key, index * 91]));
  const repository = createProfileRepository(memoryStorage());
  await repository.save('swordsman', draftToStats(createDraft(values)));
  assert.deepEqual((await repository.load()).profiles.swordsman.baseStats, values);
  assert.equal(validateStats({ ...values, strength: '' }), null);
});

test('profession profiles are independent and updates preserve other saved fields', async () => {
  const storage = memoryStorage({ schemaVersion: 1, profiles: {
    swordsman: { baseStats: zeroStats, equipment: { weapon: { attack: 4 } } },
  } });
  const repository = createProfileRepository(storage);
  await repository.save('mage', { ...zeroStats, wisdom: 200 });
  await repository.save('swordsman', { ...zeroStats, strength: 100 });
  const saved = storage.getStorageSync(STORAGE_KEY);
  assert.equal(saved.profiles.mage.baseStats.wisdom, 200);
  assert.equal(saved.profiles.swordsman.baseStats.strength, 100);
  assert.deepEqual(saved.profiles.swordsman.equipment, { weapon: { attack: 4 } });
});

test('malformed old records do not unlock equipment and unknown versions cannot be overwritten', async () => {
  const repository = createProfileRepository(memoryStorage({ schemaVersion: 1, profiles: {
    mage: { baseStats: { strength: 0 } },
  } }));
  assert.deepEqual((await repository.load()).profiles, {});
  const storage = memoryStorage({ schemaVersion: 9, profiles: { mage: { important: true } } });
  const futureRepository = createProfileRepository(storage);
  await assert.rejects(futureRepository.save('mage', zeroStats), /UNSUPPORTED_PROFILE_VERSION/);
  assert.equal(storage.getStorageSync(STORAGE_KEY).schemaVersion, 9);
});
