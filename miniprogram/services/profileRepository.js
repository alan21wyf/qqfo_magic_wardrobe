const { isProfession, validateStats } = require('../domain/profile');
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
      }
    });
    return { schemaVersion: SCHEMA_VERSION, profiles };
  }

  return {
    async load() { return load(); },
    async save(profession, values) {
      const baseStats = validateStats(values);
      if (!isProfession(profession) || !baseStats) throw new Error('INVALID_PROFILE');
      // Merge against current storage, preserving other professions and future
      // fields on the same record instead of overwriting the entire document.
      const saved = load();
      const raw = storage.getStorageSync(STORAGE_KEY);
      const previous = raw && raw.profiles && raw.profiles[profession];
      saved.profiles[profession] = Object.assign({}, previous, {
        baseStats, updatedAt: new Date().toISOString(),
      });
      const allProfiles = Object.assign({}, raw && raw.profiles, saved.profiles);
      storage.setStorageSync(STORAGE_KEY, {
        schemaVersion: SCHEMA_VERSION, profiles: allProfiles,
      });
      return saved.profiles[profession];
    },
  };
}

module.exports = { createProfileRepository, STORAGE_KEY };
