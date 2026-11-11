const {
  PROFESSIONS, LEFT_SLOTS, RIGHT_SLOTS, isProfession,
  createDraft, draftToStats, parseNumericValue, statRows, normalizeManaCalibration,
} = require('../../domain/profile');
const { createProfileRepository } = require('../../services/profileRepository');
const { equipmentData, equipmentMethods } = require('./equipmentEditor');
const { createPreviewLayout, readWindowInfo } = require('../../domain/previewLayout');

Page(Object.assign({
  data: Object.assign({
    professions: PROFESSIONS,
    profession: 'swordsman',
    professionLabel: '剑客',
    leftSlots: LEFT_SLOTS,
    rightSlots: RIGHT_SLOTS.concat({ key: 'shield', label: '盾牌' }),
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
    measuredMpDraft: '', measuredMpInvalid: false,
    layoutStyle: '',
    layoutWide: false,
    layoutStacked: false,
    layoutLandscape: false,
  }, equipmentData),

  onLoad() {
    this.updateViewportLayout();
    this.repository = createProfileRepository(wx);
    this.profiles = {};
    this.loadProfiles();
  },

  onShow() { this.updateViewportLayout(); },

  onResize(event) { this.updateViewportLayout(event && event.size); },

  updateViewportLayout(size) {
    if (this.unloaded) return;
    const api = typeof wx === 'undefined' ? {} : wx;
    this.viewportInfo = Object.assign({}, this.viewportInfo, readWindowInfo(api), size || {});
    const layout = createPreviewLayout(this.viewportInfo, { modeCount: this.data.profession === 'mage' ? 6 : 5 });
    this.viewportLayout = layout.metrics;
    if (this.data.layoutStyle !== layout.style || this.data.layoutWide !== layout.wideStats
      || this.data.layoutStacked !== layout.stackedStats || this.data.layoutLandscape !== layout.landscape) this.setData({
      layoutStyle: layout.style, layoutWide: layout.wideStats, layoutStacked: layout.stackedStats,
      layoutLandscape: layout.landscape,
    });
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

  onUnload() { this.unloaded = true; this.cancelEquipmentRecognition(); this.clearEquipmentModeTimers(); },

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
    this.showEquipmentSummary();
    this.updateViewportLayout();
  },

  selectProfession(event) {
    const profession = event.currentTarget.dataset.key;
    if (this.data.dialogOpen || this.data.equipmentOpen || this.data.equipmentBusy || this.data.clearConfirmationOpen || this.data.presetOpen || this.data.loading || !isProfession(profession)
      || profession === this.data.profession) return;
    this.showProfession(profession);
  },

  openBaseDialog() {
    if (this.data.dialogOpen || this.data.equipmentOpen || this.data.equipmentBusy || this.data.clearConfirmationOpen || this.data.presetOpen || this.data.loading || this.data.loadError) return;
    const profile = this.profiles[this.data.profession];
    const fields = createDraft(profile && profile.baseStats);
    const calibration = profile && normalizeManaCalibration(profile.manaCalibration, profile.baseStats);
    this.setData({
      dialogOpen: true, fields, saveError: '', keyboardHeight: 0,
      fieldScrollTarget: '', invalidCount: 0,
      filledCount: profile ? fields.length : 0,
      canConfirm: Boolean(profile),
      measuredMpDraft: calibration ? String(calibration.mp) : '', measuredMpInvalid: false,
    });
  },

  onFieldInput(event) {
    if (this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    const previous = this.data.fields.find((field) => field.key === key);
    const spiritChanged = key === 'spirit' && previous
      && parseNumericValue(previous.value) !== parseNumericValue(event.detail.value);
    const measuredMpDraft = spiritChanged ? '' : this.data.measuredMpDraft;
    const measuredMp = parseNumericValue(measuredMpDraft);
    const measuredMpInvalid = String(measuredMpDraft).trim() !== '' && !Number.isSafeInteger(measuredMp);
    const fields = this.data.fields.map((field) => (
      field.key === key ? Object.assign({}, field, { value: event.detail.value }) : field
    ));
    const filledCount = fields.filter((field) => String(field.value).trim() !== '').length;
    const invalidCount = fields.filter((field) => (
      String(field.value).trim() !== '' && parseNumericValue(field.value) === null
    )).length;
    // Only form state is sent while typing; the confirmed preview stays untouched.
    this.setData({ fields, filledCount, invalidCount, measuredMpDraft, measuredMpInvalid,
      canConfirm: Boolean(draftToStats(fields)) && !measuredMpInvalid, saveError: '' });
  },

  onMeasuredMpInput(event) {
    if (this.data.saving) return;
    const measuredMpDraft = event.detail.value;
    const mp = parseNumericValue(measuredMpDraft);
    const measuredMpInvalid = String(measuredMpDraft).trim() !== '' && !Number.isSafeInteger(mp);
    this.setData({ measuredMpDraft, measuredMpInvalid,
      canConfirm: Boolean(draftToStats(this.data.fields)) && !measuredMpInvalid, saveError: '' });
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
    this.setData({ dialogOpen: false, fields: [], saveError: '', keyboardHeight: 0,
      measuredMpDraft: '', measuredMpInvalid: false });
  },

  async confirmBase() {
    if (!this.data.dialogOpen || this.data.saving || !this.data.canConfirm) return;
    const stats = draftToStats(this.data.fields);
    if (!stats) return;
    const mpBlank = String(this.data.measuredMpDraft).trim() === '';
    const measuredMp = mpBlank ? null : parseNumericValue(this.data.measuredMpDraft);
    if (!mpBlank && !Number.isSafeInteger(measuredMp)) return;
    const profession = this.data.profession;
    this.setData({ saving: true, saveError: '' });
    try {
      const profile = await this.repository.save(profession, stats, measuredMp);
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

  stopTouchMove() {},
}, equipmentMethods));
