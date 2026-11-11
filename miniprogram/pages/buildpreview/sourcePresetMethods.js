const { ATTRIBUTES } = require('../../domain/equipment');
const { TRANSFORM_OPTIONS, RING_OPTIONS, resolveSectionPreset } = require('../../domain/equipmentSourcePresets');
const { setBazheTier } = require('../../domain/equipmentEffects');

const sourcePresetData = {
  transformOptions: TRANSFORM_OPTIONS, transformIndex: 0, transformLabel: '无灵变',
  ringOptions: RING_OPTIONS, ringIndex: 0, ringLabel: '无戒指灵', ringPresetReady: false,
  ringTrueSoul: false, ringBranches: [], ringBranch: '', ringMovement: 0,
};

function sourcePresetView(draft) {
  const inspect = (key, definitions, legacyLabel) => {
    const section = draft.sections.find((item) => item.key === key);
    const options = definitions.slice();
    const legacy = section && !section.selection && section.fields.length;
    if (legacy) options.push({ key: 'legacy', label: legacyLabel });
    const selected = section && section.enabled
      ? (section.selection ? section.selection.key : legacy ? 'legacy' : 'none') : 'none';
    const index = Math.max(0, options.findIndex((item) => item.key === selected));
    const resolved = section && section.enabled && section.selection
      ? resolveSectionPreset(draft.slot, key, section.selection) : null;
    return { options, index, label: options[index].label, resolved };
  };
  const transform = inspect('spiritTransform', TRANSFORM_OPTIONS, '原有灵变（保留）');
  const ring = inspect('spirit', RING_OPTIONS, '原有戒指灵（保留）');
  return {
    transformOptions: transform.options, transformIndex: transform.index, transformLabel: transform.label,
    ringOptions: ring.options, ringIndex: ring.index, ringLabel: ring.label,
    ringPresetReady: Boolean(draft.slot === 'ring' && ring.resolved && ring.resolved.selection.key !== 'none'),
    ringTrueSoul: Boolean(ring.resolved && ring.resolved.selection.trueSoul),
    ringBranches: ring.resolved ? ring.resolved.branches : [],
    ringBranch: ring.resolved ? ring.resolved.selection.branch || '' : '',
    ringMovement: ring.resolved ? ring.resolved.movement : 0,
  };
}

const sourcePresetMethods = {
  applySourcePreset(sectionKey, selection) {
    const draft = this.equipmentDraft;
    if (!draft || this.data.equipmentSaving || this.data.recognizing) return;
    const section = draft.sections.find((item) => item.key === sectionKey);
    const preset = section && resolveSectionPreset(draft.slot, sectionKey, selection);
    if (!preset) return;
    section.selection = preset.selection;
    section.enabled = preset.selection.key !== 'none';
    section.fields = ATTRIBUTES.filter((field) => Object.prototype.hasOwnProperty.call(preset.values, field.key))
      .map((field) => ({ key: field.key, label: field.label, value: String(preset.values[field.key]) }));
    if (sectionKey === 'spiritTransform' && section.enabled) setBazheTier(draft.effects, 'none');
    if (this.ocrAssignments) delete this.ocrAssignments[sectionKey];
    this.updateEquipmentEditor();
  },
  chooseSourcePreset(event) {
    if (!this.equipmentDraft || this.data.equipmentSaving || this.data.recognizing) return;
    const key = event.currentTarget.dataset.section;
    if (key !== 'spiritTransform' && !(this.equipmentDraft.slot === 'ring' && key === 'spirit')) return;
    const options = key === 'spiritTransform' ? this.data.transformOptions : this.data.ringOptions;
    const option = options[Number(event.detail.value)];
    const section = this.equipmentDraft.sections.find((item) => item.key === key);
    if (!option || !section) return;
    if (option.key === 'legacy') {
      if (section.selection || !section.fields.length) return;
      section.enabled = true;
      if (key === 'spiritTransform') setBazheTier(this.equipmentDraft.effects, 'none');
      this.updateEquipmentEditor();
      return;
    }
    const selection = { key: option.key };
    if (key === 'spirit' && option.key !== 'none') {
      selection.trueSoul = Boolean(section.selection && section.selection.trueSoul);
      const defaults = resolveSectionPreset('ring', key, selection);
      if (defaults && section.selection && defaults.branches.some((branch) => branch.key === section.selection.branch)) {
        selection.branch = section.selection.branch;
      }
    }
    this.applySourcePreset(key, selection);
  },
  toggleRingTrueSoul(event) {
    if (!this.data.ringPresetReady || !this.equipmentDraft || this.equipmentDraft.slot !== 'ring') return;
    const section = this.equipmentDraft.sections.find((item) => item.key === 'spirit');
    this.applySourcePreset('spirit', Object.assign({}, section.selection, { trueSoul: Boolean(event.detail.value) }));
  },
  chooseRingBranch(event) {
    if (!this.data.ringPresetReady || !this.equipmentDraft || this.equipmentDraft.slot !== 'ring') return;
    const section = this.equipmentDraft.sections.find((item) => item.key === 'spirit');
    this.applySourcePreset('spirit', Object.assign({}, section.selection, { branch: event.detail.value }));
  },
};

module.exports = { sourcePresetData, sourcePresetView, sourcePresetMethods };
