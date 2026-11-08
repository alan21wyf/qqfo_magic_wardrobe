const {
  PROFESSIONS, LEFT_SLOTS, RIGHT_SLOTS, isProfession,
  createDraft, draftToStats, parseNumericValue, statRows,
} = require('../../domain/profile');
const { createProfileRepository } = require('../../services/profileRepository');

Page({
  data: {
    professions: PROFESSIONS,
    profession: 'swordsman',
    professionLabel: '剑客',
    leftSlots: LEFT_SLOTS,
    rightSlots: RIGHT_SLOTS.concat({ key: 'shield', label: '盾牌' }),
    badges: [1, 2, 3, 4, 5, 6],
    combatRows: statRows(null, 0, 6),
    coreRows: statRows(null, 6, 12),
    ready: false,
    loading: true,
    loadError: false,
    dialogOpen: false,
    fields: [],
    filledCount: 0,
    canConfirm: false,
    saving: false,
    saveError: '',
    keyboardHeight: 0,
    fieldScrollTarget: '',
    invalidCount: 0,
  },

  onLoad() {
    this.repository = createProfileRepository(wx);
    this.profiles = {};
    this.loadProfiles();
  },

  async loadProfiles() {
    if (this.loadingProfiles) return;
    this.loadingProfiles = true;
    this.setData({ loading: true, loadError: false });
    try {
      const saved = await this.repository.load();
      this.profiles = saved.profiles;
      if (!this.unloaded) this.showProfession(this.data.profession);
    } catch (error) {
      if (!this.unloaded) this.setData({ loadError: true });
    } finally {
      this.loadingProfiles = false;
      if (!this.unloaded) this.setData({ loading: false });
    }
  },

  onUnload() { this.unloaded = true; },

  showProfession(profession) {
    const profile = this.profiles[profession];
    const stats = profile && profile.baseStats;
    this.setData({
      profession,
      professionLabel: PROFESSIONS.find((item) => item.key === profession).label,
      rightSlots: profession === 'swordsman'
        ? RIGHT_SLOTS.concat({ key: 'shield', label: '盾牌' }) : RIGHT_SLOTS,
      ready: Boolean(stats),
      combatRows: statRows(stats, 0, 6),
      coreRows: statRows(stats, 6, 12),
    });
  },

  selectProfession(event) {
    const profession = event.currentTarget.dataset.key;
    if (this.data.dialogOpen || this.data.loading || !isProfession(profession)
      || profession === this.data.profession) return;
    this.showProfession(profession);
  },

  openBaseDialog() {
    if (this.data.dialogOpen || this.data.loading || this.data.loadError) return;
    const profile = this.profiles[this.data.profession];
    const fields = createDraft(profile && profile.baseStats);
    this.setData({
      dialogOpen: true, fields, saveError: '', keyboardHeight: 0,
      fieldScrollTarget: '', invalidCount: 0,
      filledCount: profile ? fields.length : 0,
      canConfirm: Boolean(profile),
    });
  },

  onFieldInput(event) {
    if (this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    const fields = this.data.fields.map((field) => (
      field.key === key ? Object.assign({}, field, { value: event.detail.value }) : field
    ));
    const filledCount = fields.filter((field) => String(field.value).trim() !== '').length;
    const invalidCount = fields.filter((field) => (
      String(field.value).trim() !== '' && parseNumericValue(field.value) === null
    )).length;
    // Only form state is sent while typing; the confirmed preview stays untouched.
    this.setData({ fields, filledCount, invalidCount, canConfirm: Boolean(draftToStats(fields)), saveError: '' });
  },

  onKeyboardChange(event) {
    if (!this.data.dialogOpen) return;
    const keyboardHeight = Math.max(0, Number(event.detail.height) || 0);
    this.setData({ keyboardHeight }, () => {
      if (keyboardHeight && this.focusedField) {
        this.setData({ fieldScrollTarget: 'field-row-' + this.focusedField });
      }
    });
  },

  onFieldFocus(event) {
    this.focusedField = event.currentTarget.dataset.key;
    if (this.data.keyboardHeight) {
      this.setData({ fieldScrollTarget: 'field-row-' + this.focusedField });
    }
  },

  closeBaseDialog() {
    if (this.data.saving) return;
    this.setData({ dialogOpen: false, fields: [], saveError: '', keyboardHeight: 0 });
  },

  async confirmBase() {
    if (!this.data.dialogOpen || this.data.saving || !this.data.canConfirm) return;
    const stats = draftToStats(this.data.fields);
    if (!stats) return;
    const profession = this.data.profession;
    this.setData({ saving: true, saveError: '' });
    try {
      const profile = await this.repository.save(profession, stats);
      this.profiles[profession] = profile;
      if (this.unloaded) return;
      this.showProfession(profession);
      this.setData({ dialogOpen: false, fields: [], keyboardHeight: 0 });
      wx.showToast({ title: '裸装属性已保存', icon: 'success' });
    } catch (error) {
      if (!this.unloaded) this.setData({ saveError: '保存未成功，请重试。输入的内容仍在。' });
    } finally {
      if (!this.unloaded) this.setData({ saving: false });
    }
  },

  selectEquipment(event) {
    if (!this.data.ready || this.data.loading || this.data.loadError) return;
    wx.showToast({ title: event.currentTarget.dataset.label + '属性录入即将开放', icon: 'none' });
  },

  stopTouchMove() {},
});
