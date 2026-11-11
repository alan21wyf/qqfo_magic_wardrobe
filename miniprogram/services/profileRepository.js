const { isProfession, validateStats, normalizeManaCalibration } = require('../domain/profile');
const { getSlot, normalizeEquipment } = require('../domain/equipment');
const { applyPresetBodies } = require('../domain/equipmentPresets');
const STORAGE_KEY = 'fantasyWardrobe.profiles';
const SCHEMA_VERSION = 1;

// The page uses this asynchronous repository contract. A future cloud adapter
// can implement the same load/save methods without moving storage code into UI.
function createProfileRepository(storage) {
  function load() {
    const saved = storage.getStorageSync(STORAGE_KEY);
    if (!saved) return { schemaVersion: SCHEMA_VERSION, profiles: {} };
    if (saved.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('UNSUPPORTED_PROFILE_VERSION');
    }
    const profiles = {};
    const records = saved.profiles || {};
    Object.keys(records).forEach((profession) => {
      const record = records[profession];
      const stats = validateStats(record && record.baseStats);
      if (isProfession(profession) && stats) {
        profiles[profession] = Object.assign({}, record, { baseStats: stats });
        const calibration = normalizeManaCalibration(record.manaCalibration, stats);
        if (calibration) profiles[profession].manaCalibration = calibration;
        else delete profiles[profession].manaCalibration;
      }
    });
    return { schemaVersion: SCHEMA_VERSION, profiles };
  }

  function writeRecord(profession, record, saved) {
    const raw = storage.getStorageSync(STORAGE_KEY);
    storage.setStorageSync(STORAGE_KEY, {
      schemaVersion: SCHEMA_VERSION,
      profiles: Object.assign({}, raw && raw.profiles, saved.profiles, { [profession]: record }),
    });
    return record;
  }

  return {
    async load() { return load(); },
    async save(profession, values, measuredMp) {
      const baseStats = validateStats(values);
      if (!isProfession(profession) || !baseStats) throw new Error('INVALID_PROFILE');
      // Merge against current storage, preserving other professions and future
      // fields on the same record instead of overwriting the entire document.
      const saved = load();
      const raw = storage.getStorageSync(STORAGE_KEY);
      const previous = raw && raw.profiles && raw.profiles[profession];
      const calibration = measuredMp === undefined
        ? normalizeManaCalibration(previous && previous.manaCalibration, baseStats)
        : measuredMp === null ? null : normalizeManaCalibration({ mp: measuredMp, spirit: baseStats.spirit }, baseStats);
      if (measuredMp !== undefined && measuredMp !== null && !calibration) throw new Error('INVALID_MANA_CALIBRATION');
      saved.profiles[profession] = Object.assign({}, previous, {
        baseStats, updatedAt: new Date().toISOString(),
      });
      if (calibration) saved.profiles[profession].manaCalibration = calibration;
      else delete saved.profiles[profession].manaCalibration;
      const allProfiles = Object.assign({}, raw && raw.profiles, saved.profiles);
      storage.setStorageSync(STORAGE_KEY, {
        schemaVersion: SCHEMA_VERSION, profiles: allProfiles,
      });
      return saved.profiles[profession];
    },
    async saveEquipment(profession, slot, item) {
      if (!isProfession(profession) || !getSlot(slot, profession)) throw new Error('INVALID_SLOT');
      const normalized = item === null ? null : normalizeEquipment(slot, item);
      if (item !== null && !normalized) throw new Error('INVALID_EQUIPMENT');
      const saved = load();
      const record = saved.profiles[profession];
      if (!record) throw new Error('BASE_STATS_REQUIRED');
      const equipment = Object.assign({}, record.equipment);
      if (normalized) equipment[slot] = normalized;
      else delete equipment[slot];
      const updated = Object.assign({}, record, { equipment, updatedAt: new Date().toISOString() });
      return writeRecord(profession, updated, saved);
    },
    async applyEquipmentPreset(profession, level) {
      if (!isProfession(profession)) throw new Error('INVALID_PROFILE');
      const saved = load();
      const record = saved.profiles[profession];
      if (!record) throw new Error('BASE_STATS_REQUIRED');
      const equipment = applyPresetBodies(profession, level, record.equipment);
      return writeRecord(profession, Object.assign({}, record, {
        equipment, updatedAt: new Date().toISOString(),
      }), saved);
    },
    async setEquipmentActive(profession, slot, active) {
      if (!isProfession(profession) || !getSlot(slot, profession)) throw new Error('INVALID_SLOT');
      const saved = load();
      const record = saved.profiles[profession];
      const previous = record && record.equipment && record.equipment[slot];
      if (!previous || !normalizeEquipment(slot, previous)) throw new Error('EQUIPMENT_NOT_FOUND');
      const equipment = Object.assign({}, record.equipment, {
        [slot]: Object.assign({}, previous, { equipped: Boolean(active) }),
      });
      return writeRecord(profession, Object.assign({}, record, {
        equipment, updatedAt: new Date().toISOString(),
      }), saved);
    },
    async clearEquipment(profession) {
      if (!isProfession(profession)) throw new Error('INVALID_PROFILE');
      const saved = load();
      const record = saved.profiles[profession];
      if (!record) throw new Error('BASE_STATS_REQUIRED');
      return writeRecord(profession, Object.assign({}, record, {
        equipment: {}, updatedAt: new Date().toISOString(),
      }), saved);
    },
  };
}

module.exports = { createProfileRepository, STORAGE_KEY };
