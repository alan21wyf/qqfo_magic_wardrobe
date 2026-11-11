const { PRESET_NOTICE, presetLevelOptions, getEquipmentPreset, getPresetPreview } = require('../../domain/equipmentPresets');

const presetData = {
  presetOpen: false, presetError: '', presetNotice: PRESET_NOTICE,
  presetLevels: presetLevelOptions('mage'), presetStage: 'levels', presetSelectedLevel: 0,
  presetItems: [], presetDetail: null,
};

const presetMethods = {
  openEquipmentPresets() {
    if (this.data.profession !== 'mage' || !this.data.ready || this.data.loading || this.data.loadError
      || this.data.equipmentBusy || this.data.clearConfirmationOpen || this.data.dialogOpen
      || this.data.equipmentOpen || this.data.presetOpen) return;
    this.dismissTakeoffHint();
    this.setData({ presetOpen: true, presetError: '', presetStage: 'levels', presetSelectedLevel: 0,
      presetItems: [], presetDetail: null });
  },
  closeEquipmentPresets() {
    if (this.data.equipmentBusy) return;
    this.setData({ presetOpen: false, presetError: '', presetStage: 'levels', presetSelectedLevel: 0,
      presetItems: [], presetDetail: null });
  },
  chooseEquipmentPreset(event) {
    if (!this.data.presetOpen || this.data.presetStage !== 'levels' || this.data.equipmentBusy || !this.data.ready) return;
    const profession = this.data.profession;
    const level = Number(event.currentTarget.dataset.level);
    if (!getEquipmentPreset(profession, level)) return;
    this.setData({ presetStage: 'confirm', presetSelectedLevel: level,
      presetItems: getPresetPreview(profession, level), presetDetail: null, presetError: '' });
  },
  backToPresetLevels() {
    if (!this.data.presetOpen || this.data.equipmentBusy || this.data.presetDetail) return;
    this.setData({ presetStage: 'levels', presetSelectedLevel: 0, presetItems: [], presetError: '' });
  },
  openPresetEquipment(event) {
    if (!this.data.presetOpen || this.data.presetStage !== 'confirm' || this.data.equipmentBusy) return;
    const item = this.data.presetItems.find((candidate) => candidate.slot === event.currentTarget.dataset.slot);
    if (item) this.setData({ presetDetail: item });
  },
  closePresetEquipment() { this.setData({ presetDetail: null }); },
  async confirmEquipmentPreset() {
    if (!this.data.presetOpen || this.data.presetStage !== 'confirm' || this.data.presetDetail
      || this.data.equipmentBusy || !this.data.ready) return;
    const profession = this.data.profession;
    const level = this.data.presetSelectedLevel;
    if (!getEquipmentPreset(profession, level)) return;
    this.setData({ equipmentBusy: true, presetError: '' });
    try {
      const record = await this.repository.applyEquipmentPreset(profession, level);
      this.profiles[profession] = record;
      if (this.unloaded) return;
      this.setData({ presetOpen: false, equipmentMode: 'edit', presetStage: 'levels',
        presetSelectedLevel: 0, presetItems: [], presetDetail: null });
      this.showEquipmentSummary();
      wx.showToast({ title: level + '级装备本体已载入', icon: 'none' });
    } catch (_) {
      if (!this.unloaded) this.setData({ presetError: '载入未成功，请重试。原有装备已保留。' });
    } finally {
      if (!this.unloaded) this.setData({ equipmentBusy: false });
    }
  },
};

module.exports = { presetData, presetMethods };
