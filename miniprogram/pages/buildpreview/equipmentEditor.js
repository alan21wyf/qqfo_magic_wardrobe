const { ATTRIBUTES, SOULS, BODY_REFERENCE_FIELDS, getSlot, allowedAttributes, newDraft, validateDraft, decorateDraft } = require('../../domain/equipment');
const { calculate, equipmentImpact } = require('../../domain/calculator');
const { statRows, BADGES } = require('../../domain/profile');
const { parseEquipmentOcr, fieldsFromValues } = require('../../domain/equipmentOcr');
const { recognizeEquipmentImage } = require('../../services/equipmentRecognition');
const { modeData, modeMethods } = require('./equipmentModes');
const { presetData, presetMethods } = require('./equipmentPresets');
const { sourcePresetData, sourcePresetView, sourcePresetMethods } = require('./sourcePresetMethods');
const { UPLOAD_IMAGE_GUIDANCE, getEquipmentExample } = require('../../domain/equipmentExamples');
const { DRAGON_TIERS, FACE_OPTIONS, getDragonTier, getBazheTier,
  setDragonTier, setBazheTier } = require('../../domain/equipmentEffects');

const equipmentData = Object.assign({
  equipmentOpen: false, equipmentTitle: '', equipmentName: '', equipmentConfig: {},
  equipmentSections: [], equipmentSouls: [], availableSouls: [], equipmentEffects: {}, bodyReferenceRows: [],
  faceMode: 'none', weaponMode: 'none', equipmentCanSave: false, equipmentSaving: false, equipmentError: '',
  dragonOptions: DRAGON_TIERS, dragonIndex: 0, dragonDescription: '',
  faceOptions: FACE_OPTIONS, faceIndex: 0, bazheDescription: '',
  equipmentSaved: false, equipmentHasChanges: false, equipmentImpactRows: [],
  equipmentAllImpactRows: [], quickImpacts: [], showAllImpacts: false, equipmentHelpOpen: false,
  recognizing: false, recognitionReview: false, recognitionNote: '', equipmentImage: '',
  uploadImageGuidance: UPLOAD_IMAGE_GUIDANCE,
  ocrPending: [], ocrSourceOptions: [], equipmentFieldTarget: '', equipmentKeyboardHeight: 0,
  vitalRows: [{ key: 'hp', label: '最大生命', value: 0 }, { key: 'mp', label: '最大法力', value: 0 }],
  extraStats: [], equippedCount: 0, calculationError: '',
  badges: BADGES.map((badge) => Object.assign({}, badge, { filled: false })),
}, modeData, presetData, sourcePresetData);

const equipmentMethods = Object.assign({
  showEquipmentSummary() {
    const profile = this.profiles[this.data.profession];
    const equipped = (profile && profile.equipment) || {};
    let stats;
    try { stats = profile && calculate(profile.baseStats, equipped, this.data.profession, profile.manaCalibration); }
    catch (_) { this.setData({ calculationError: '暂时无法计算，请核对装备数值' }); return; }
    const filled = (slot) => Boolean(equipped[slot] && validateDraft(newDraft(slot, equipped[slot])));
    const inactive = (slot) => Boolean(filled(slot) && equipped[slot].equipped === false);
    this.setData({
      combatRows: statRows(stats, 0, 6), coreRows: statRows(stats, 6, 12),
      vitalRows: [{ key: 'hp', label: '最大生命', value: stats ? stats.hp : 0 },
        { key: 'mp', label: '最大法力', value: stats ? stats.mp : 0 }],
      extraStats: [{ key: 'damageResistance', label: '装备伤害抗性', value: stats ? stats.damageResistance : 0 },
        { key: 'magicResistance', label: '装备魔法抗性', value: stats ? stats.magicResistance : 0 },
        { key: 'armor', label: '装备护甲', value: stats ? stats.armor : 0 }],
      leftSlots: this.data.leftSlots.map((s) => Object.assign({}, s, { filled: filled(s.key), inactive: inactive(s.key) })),
      rightSlots: this.data.rightSlots.map((s) => Object.assign({}, s, { filled: filled(s.key), inactive: inactive(s.key) })),
      badges: equipmentData.badges.map((s) => Object.assign({}, s, { filled: filled(s.key), inactive: inactive(s.key) })),
      artifactFilled: filled('artifact'), artifactInactive: inactive('artifact'),
      equippedCount: Object.keys(equipped).filter((s) => getSlot(s, this.data.profession) && filled(s) && !inactive(s)).length,
      recordedCount: Object.keys(equipped).filter((s) => getSlot(s, this.data.profession) && filled(s)).length,
      calculationError: '',
    });
  },

  selectEquipment(event) {
    if (!this.data.ready || this.data.loading || this.data.loadError
      || this.data.dialogOpen || this.data.equipmentOpen || this.data.equipmentBusy || this.data.clearConfirmationOpen || this.data.presetOpen) return;
    const slot = event.currentTarget.dataset.key;
    const config = getSlot(slot, this.data.profession);
    if (!config) return;
    if (this.data.equipmentMode === 'takeoff') return this.toggleEquipmentSlot(slot);
    if (this.data.equipmentMode !== 'edit') return;
    const record = this.profiles[this.data.profession];
    const saved = record.equipment && record.equipment[slot];
    this.editorGeneration = (this.editorGeneration || 0) + 1;
    this.equipmentDraft = newDraft(slot, saved);
    this.equipmentDraft.equipped = true;
    this.ocrAssignments = null;
    this.setData({
      equipmentOpen: true, equipmentTitle: config.label + '属性', equipmentConfig: config,
      equipmentSaved: Boolean(saved), equipmentError: '', recognizing: false,
      recognitionReview: false, recognitionNote: '', equipmentImage: '', ocrPending: [],
      equipmentHelpOpen: false, showAllImpacts: false, equipmentFieldTarget: '', equipmentKeyboardHeight: 0,
      ocrSourceOptions: this.equipmentDraft.sections.map((s) => ({ key: s.key, label: s.label })),
    });
    this.updateEquipmentEditor();
  },

  updateEquipmentEditor(extra) {
    if (!this.equipmentDraft || !this.data.equipmentOpen) return;
    const draft = this.equipmentDraft;
    const pending = extra && extra.ocrPending !== undefined ? extra.ocrPending : this.data.ocrPending;
    const recognizing = extra && extra.recognizing !== undefined ? extra.recognizing : this.data.recognizing;
    const item = validateDraft(draft);
    let rows = [];
    let error = '';
    if (item) {
      try {
        const profile = this.profiles[this.data.profession];
        rows = equipmentImpact(profile.baseStats, profile.equipment || {}, draft.slot, item, this.data.profession,
          profile.manaCalibration) || [];
      } catch (_) { error = '数值过大，暂时无法计算，请检查输入'; }
    }
    const changed = rows.filter((r) => r.delta !== 0);
    const quick = ['magicAttack', 'hp', 'mp'].map((key) => changed.find((r) => r.key === key)).filter(Boolean);
    const dragon = getDragonTier(draft.effects) || DRAGON_TIERS[0];
    const bazhe = getBazheTier(draft.effects);
    const faceMode = bazhe && bazhe.percent ? bazhe.key
      : (draft.sections.some((s) => s.key === 'spiritTransform' && s.enabled) ? 'spiritTransform' : 'none');
    this.setData(Object.assign({
      equipmentName: draft.name,
      bodyReferenceRows: BODY_REFERENCE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(draft.bodyReference || {}, field.key))
        .map((field) => Object.assign({}, field, { value: draft.bodyReference[field.key] })),
      equipmentSections: decorateDraft(draft), equipmentSouls: draft.souls,
      availableSouls: SOULS.filter((s) => !draft.souls.some((f) => f.key === s.key)),
      equipmentEffects: draft.effects,
      dragonIndex: DRAGON_TIERS.findIndex((tier) => tier.key === dragon.key),
      dragonDescription: dragon.percent
        ? '力量、智慧、敏捷、体质、精神的整套数值 +' + dragon.percent + '%'
        : '选择需要的龙啸系列变装',
      faceMode, faceIndex: FACE_OPTIONS.findIndex((option) => option.key === faceMode),
      bazheDescription: bazhe && bazhe.percent
        ? '五项裸装属性 +' + bazhe.percent + '%' + (bazhe.hp ? '，最大生命 +' + bazhe.hp : '')
        : '',
      weaponMode: draft.effects.darkMight ? 'darkMight'
        : (draft.sections.some((s) => s.key === 'appearance' && s.enabled) ? 'custom' : 'none'),
      equipmentCanSave: Boolean(item && !pending.length && !recognizing && !error),
      equipmentImpactRows: changed, equipmentAllImpactRows: rows,
      quickImpacts: quick.length ? quick : changed.slice(0, 3),
      equipmentHasChanges: Boolean(changed.length), equipmentError: error,
    }, sourcePresetView(draft), extra || {}));
  },

  onEquipmentName(event) {
    this.equipmentDraft.name = event.detail.value;
    this.setData({ equipmentName: event.detail.value });
  },
  toggleEquipmentSection(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const section = this.equipmentDraft.sections.find((s) => s.key === event.currentTarget.dataset.section);
    if (!section || section.key === 'body') return;
    section.enabled = event.detail.value;
    if (section.key === 'spiritTransform' && section.enabled) setBazheTier(this.equipmentDraft.effects, 'none');
    if (section.key === 'appearance' && section.enabled) this.equipmentDraft.effects.darkMight = false;
    this.updateEquipmentEditor();
  },
  chooseFaceMode(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const option = FACE_OPTIONS[Number(event.detail.value)];
    if (!option || !this.data.equipmentConfig.hasBazhe) return;
    const mode = option.key;
    setBazheTier(this.equipmentDraft.effects, mode === 'spiritTransform' ? 'none' : mode);
    this.equipmentDraft.sections.find((s) => s.key === 'spiritTransform').enabled = mode === 'spiritTransform';
    this.updateEquipmentEditor();
  },
  chooseDragonTier(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const tier = DRAGON_TIERS[Number(event.detail.value)];
    if (!tier || !this.data.equipmentConfig.hasDragon) return;
    setDragonTier(this.equipmentDraft.effects, tier.key);
    this.updateEquipmentEditor();
  },
  chooseWeaponMode(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const mode = event.detail.value;
    this.equipmentDraft.effects.darkMight = mode === 'darkMight';
    const section = this.equipmentDraft.sections.find((s) => s.key === 'appearance');
    section.enabled = mode === 'custom';
    if (mode === 'custom') {
      for (const key of ['strength', 'wisdom']) {
        const field = section.fields.find((item) => item.key === key);
        if (field) field.value = '150';
        else section.fields.push({ key, label: ATTRIBUTES.find((item) => item.key === key).label, value: '150' });
      }
    }
    this.updateEquipmentEditor();
  },
  addEquipmentField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const key = event.currentTarget.dataset.section;
    const decorated = this.data.equipmentSections.find((s) => s.key === key);
    const attribute = decorated && decorated.available[Number(event.detail.value)];
    if (!attribute) return;
    this.equipmentDraft.sections.find((s) => s.key === key).fields.push({
      key: attribute.key, label: attribute.label, value: '',
    });
    this.updateEquipmentEditor({ equipmentFieldTarget: 'equip-' + key + '-' + attribute.key });
  },
  removeEquipmentField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const data = event.currentTarget.dataset;
    const section = this.equipmentDraft.sections.find((s) => s.key === data.section);
    section.fields = section.fields.filter((f) => f.key !== data.key);
    if (this.ocrAssignments && this.ocrAssignments[data.section]) delete this.ocrAssignments[data.section][data.key];
    this.updateEquipmentEditor();
  },
  onEquipmentField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const data = event.currentTarget.dataset;
    const section = this.equipmentDraft.sections.find((s) => s.key === data.section);
    const field = section && section.fields.find((f) => f.key === data.key);
    if (!field) return;
    field.value = event.detail.value;
    if (this.ocrAssignments) {
      this.ocrAssignments[data.section] = this.ocrAssignments[data.section] || {};
      this.ocrAssignments[data.section][data.key] = Number(event.detail.value) || 0;
    }
    this.updateEquipmentEditor();
  },
  addSoulField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const field = this.data.availableSouls[Number(event.detail.value)];
    if (!field) return;
    this.equipmentDraft.souls.push(Object.assign({}, field, { value: '' }));
    this.updateEquipmentEditor();
  },
  onSoulField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    const field = this.equipmentDraft.souls.find((s) => s.key === event.currentTarget.dataset.key);
    if (!field) return;
    field.value = event.detail.value;
    this.updateEquipmentEditor();
  },
  removeSoulField(event) {
    if (this.data.equipmentSaving || this.data.recognizing) return;
    this.equipmentDraft.souls = this.equipmentDraft.souls.filter((s) => s.key !== event.currentTarget.dataset.key);
    this.updateEquipmentEditor();
  },
  toggleAllImpacts() { this.setData({ showAllImpacts: !this.data.showAllImpacts }); },
  onEquipmentKeyboard(event) {
    this.setData({ equipmentKeyboardHeight: Math.max(0, Number(event.detail.height) || 0) });
  },
  onEquipmentFocus(event) {
    this.setData({ equipmentFieldTarget: event.currentTarget.dataset.target });
  },
  openEquipmentHelp() {
    if (!this.equipmentDraft || !this.data.equipmentOpen || this.data.equipmentSaving || this.openingEquipmentHelp) return;
    const example = getEquipmentExample(this.equipmentDraft.slot);
    if (!example) { this.setData({ equipmentHelpOpen: true }); return; }
    this.openingEquipmentHelp = true;
    const failed = () => {
      this.openingEquipmentHelp = false;
      if (!this.unloaded) wx.showToast({ title: '示例图打开失败，请重试', icon: 'none' });
    };
    try {
      wx.navigateTo({ url: example.page + '?slot=' + example.slot, fail: failed,
        complete: () => { this.openingEquipmentHelp = false; } });
    } catch (_) { failed(); }
  },
  closeEquipmentHelp() { this.setData({ equipmentHelpOpen: false }); },
  previewEquipmentImage() {
    if (this.data.equipmentImage) wx.previewImage({ urls: [this.data.equipmentImage] });
  },
  cancelEquipmentRecognition() {
    this.editorGeneration = (this.editorGeneration || 0) + 1;
    if (this.recognitionJob) this.recognitionJob.cancel();
    this.recognitionJob = null;
  },
  closeEquipmentDialog() {
    if (this.data.equipmentSaving) return;
    this.cancelEquipmentRecognition();
    this.equipmentDraft = null;
    this.setData({ equipmentOpen: false, equipmentHelpOpen: false, recognizing: false,
      equipmentKeyboardHeight: 0, equipmentError: '', ocrPending: [] });
  },

  async saveEquipment(remove) {
    if (!this.data.equipmentOpen || this.data.equipmentSaving || this.data.recognizing) return;
    if (!remove && !this.data.equipmentCanSave) return;
    const profession = this.data.profession;
    const slot = this.equipmentDraft.slot;
    const item = remove ? null : validateDraft(this.equipmentDraft);
    if (!remove && !item) return;
    this.setData({ equipmentSaving: true, equipmentError: '' });
    try {
      const record = remove ? await this.repository.setEquipmentActive(profession, slot, false)
        : await this.repository.saveEquipment(profession, slot, item);
      this.profiles[profession] = record;
      if (this.unloaded) return;
      this.setData({ equipmentOpen: false, equipmentKeyboardHeight: 0 });
      this.equipmentDraft = null;
      this.cancelEquipmentRecognition();
      this.showProfession(profession);
      wx.showToast({ title: remove ? '已取下，数据保留' : '装备已保存', icon: 'success' });
    } catch (_) {
      if (!this.unloaded) this.setData({ equipmentError: '保存未成功，请重试。录入内容仍在。' });
    } finally { if (!this.unloaded) this.setData({ equipmentSaving: false }); }
  },
  confirmEquipment() { return this.saveEquipment(false); },
  removeEquipment() { return this.saveEquipment(true); },

  applyRecognizedEquipment(parsed) {
    const draft = this.equipmentDraft;
    if (!draft) return;
    this.ocrAssignments = {};
    draft.sections.forEach((s) => { this.ocrAssignments[s.key] = Object.assign({}, parsed.sections[s.key]); });
    if (!draft.name) draft.name = parsed.name;
    draft.sections.forEach((section) => {
      const values = parsed.sections[section.key] || {};
      const fields = fieldsFromValues(values);
      if (!fields.length) return;
      delete section.selection; // OCR values remain a preserved, source-labelled legacy group.
      section.enabled = true;
      if (section.key === 'spiritTransform') setBazheTier(draft.effects, 'none');
      section.fields = section.fields.filter((f) => !fields.some((n) => n.key === f.key)).concat(fields);
    });
    Object.keys(parsed.souls).forEach((key) => {
      draft.souls = draft.souls.filter((s) => s.key !== key);
      draft.souls.push(Object.assign({}, SOULS.find((s) => s.key === key), { value: String(parsed.souls[key]) }));
    });
    const dragon = getDragonTier(parsed.effects);
    const bazhe = getBazheTier(parsed.effects);
    if (dragon && dragon.percent) setDragonTier(draft.effects, dragon.key);
    if (bazhe && bazhe.percent) {
      setBazheTier(draft.effects, bazhe.key);
      draft.sections.find((s) => s.key === 'spiritTransform').enabled = false;
    }
    if (parsed.effects.darkMight) {
      draft.effects.darkMight = true;
      draft.sections.find((s) => s.key === 'appearance').enabled = false;
    }
    const pending = parsed.pending.map((group) => Object.assign({}, group, {
      sources: draft.sections.filter((s) => Object.keys(group.values)
        .every((key) => allowedAttributes(draft.slot, s.key).some((a) => a.key === key)))
        .map((s) => ({ key: s.key, label: s.label })),
      previewLabel: fieldsFromValues(group.values).map((f) => f.label + ' ' + f.value).join('，'),
    }));
    this.updateEquipmentEditor({
      recognizing: false, recognitionReview: true, ocrPending: pending,
      equipmentFieldTarget: parsed.pending.length ? '' : 'equipment-impact',
      recognitionNote: parsed.warnings.join('；') || (parsed.pending.length
        ? '部分变装来源需要选择，已识别数值保留在下方'
        : '识别结果已回填，可修改后确认'),
    });
  },
  assignOcrSource(event) {
    const group = this.data.ocrPending.find((g) => g.id === event.currentTarget.dataset.id);
    const source = group && group.sources[Number(event.detail.value)];
    if (!group || !source) return;
    const section = this.equipmentDraft.sections.find((s) => s.key === source.key);
    delete section.selection;
    if (group.fromSection) {
      const oldSource = this.equipmentDraft.sections.find((s) => s.key === group.fromSection);
      oldSource.fields = oldSource.fields.filter((f) => !Object.prototype.hasOwnProperty.call(group.values, f.key));
      if (oldSource.key !== 'body' && !oldSource.fields.length) oldSource.enabled = false;
    }
    this.ocrAssignments = this.ocrAssignments || {};
    this.ocrAssignments[source.key] = this.ocrAssignments[source.key] || {};
    Object.keys(group.values).forEach((key) => {
      const existing = section.fields.find((f) => f.key === key);
      const sum = (this.ocrAssignments[source.key][key] || 0) + group.values[key];
      this.ocrAssignments[source.key][key] = sum;
      if (existing) existing.value = String(sum);
      else section.fields.push(Object.assign({}, ATTRIBUTES.find((a) => a.key === key), { value: String(sum) }));
    });
    section.enabled = true;
    if (source.key === 'spiritTransform') setBazheTier(this.equipmentDraft.effects, 'none');
    if (source.key === 'appearance') this.equipmentDraft.effects.darkMight = false;
    this.updateEquipmentEditor({ ocrPending: this.data.ocrPending.filter((g) => g.id !== group.id) });
  },
  async uploadEquipmentImage() {
    if (!this.data.equipmentOpen || this.data.equipmentSaving || this.data.recognizing) return;
    const generation = this.editorGeneration;
    const isCurrent = () => !this.unloaded && this.data.equipmentOpen && generation === this.editorGeneration;
    this.updateEquipmentEditor({ recognizing: true, equipmentError: '', recognitionNote: '请选择清晰的完整装备截图' });
    try {
      const path = await new Promise((resolve, reject) => {
        wx.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album', 'camera'],
          success: (r) => resolve(r.tempFilePaths[0]), fail: reject });
      });
      if (!isCurrent()) return;
      this.setData({ equipmentImage: path, recognitionNote: '正在识别装备词条…' });
      this.recognitionJob = recognizeEquipmentImage(wx, path);
      const anchors = await this.recognitionJob.result;
      if (!isCurrent()) return;
      this.recognitionJob = null;
      const parsed = parseEquipmentOcr(anchors, this.equipmentDraft.slot);
      const count = Object.values(parsed.sections).reduce((n, values) => n + Object.keys(values).length, 0)
        + parsed.pending.length + Object.keys(parsed.souls).length
        + Number(getDragonTier(parsed.effects).percent > 0) + Number(getBazheTier(parsed.effects).percent > 0)
        + Number(parsed.effects.darkMight);
      if (!count) throw new Error('未识别到装备属性，请换图或手动填写');
      this.applyRecognizedEquipment(parsed);
    } catch (error) {
      if (!isCurrent()) return;
      this.recognitionJob = null;
      const cancelled = /cancel|CANCELLED/.test(error.errMsg || error.message || '');
      this.updateEquipmentEditor({ recognizing: false,
        equipmentError: cancelled ? '' : (error.message || '识别未完成，请重试或手动填写'),
        recognitionNote: cancelled ? '' : '已填内容保留，可继续手动录入' });
    }
  },
}, modeMethods, presetMethods, sourcePresetMethods);

module.exports = { equipmentData, equipmentMethods };
