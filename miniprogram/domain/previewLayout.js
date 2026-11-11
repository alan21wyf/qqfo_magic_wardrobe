// Layout uses usable window geometry, not phone-model name lists.
// API reference: wx.getWindowInfo (getSystemInfoSync fallback on older clients).
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
function readWindowInfo(api) {
  for (const method of ['getWindowInfo', 'getSystemInfoSync']) {
    try {
      if (api && typeof api[method] === 'function') {
        const info = api[method]();
        if (info && Number(info.windowWidth) > 0 && Number(info.windowHeight) > 0) return info;
      }
    } catch (_) { /* use the next compatible API */ }
  }
  return {};
}
function createPreviewLayout(info, options) {
  info = info || {};
  const width = positive(info.windowWidth, 375);
  const height = positive(info.windowHeight, 700);
  const screenWidth = positive(info.screenWidth, width);
  const screenHeight = positive(info.screenHeight, height);
  const safe = info.safeArea || {};
  const safeBottom = clamp(typeof safe.bottom === 'number' && Number.isFinite(safe.bottom)
    ? screenHeight - safe.bottom : 0, 0, Math.min(80, height * 0.25));
  const rootWidth = Math.min(width, 680);
  const outsideMargin = (width - rootWidth) / 2;
  const safeLeft = clamp((Number(safe.left) || 0) - outsideMargin, 0, rootWidth * 0.15);
  const safeRight = clamp(typeof safe.right === 'number' && Number.isFinite(safe.right)
    ? screenWidth - safe.right - outsideMargin : 0, 0, rootWidth * 0.15);
  const paddingY = clamp(height * 0.012, 6, 12);
  const paddingX = clamp(rootWidth * 0.035, 10, 20);
  const contentWidth = Math.max(120, rootWidth - paddingX * 2 - safeLeft - safeRight);
  const usableHeight = Math.max(120, height - safeBottom - paddingY * 2);
  const requestedModes = options && options.modeCount;
  const modeCount = Number.isInteger(requestedModes) && requestedModes >= 3 && requestedModes <= 6 ? requestedModes : 3;

  const landscape = contentWidth >= 500 && width > height;
  let wideStats = contentWidth >= 500 || usableHeight < 500;
  let stackedStats = landscape || (wideStats && contentWidth < 500);
  const sizes = {
    profession: clamp(usableHeight * 0.06, 30, 44),
    status: clamp(usableHeight * 0.025, 12, 18),
    badges: clamp(usableHeight * 0.075, 36, 56),
    vitals: clamp(usableHeight * 0.05, 26, 38),
    footer: clamp(usableHeight * 0.065, 34, 48),
    extra: clamp(usableHeight * 0.022, 12, 16),
    row: clamp(usableHeight * 0.043, 21, 34),
    gap: clamp(usableHeight * 0.009, 3, 7),
    panelPadding: clamp(contentWidth * 0.009, 2, 4),
  };
  if (stackedStats) sizes.row = Math.max(26, sizes.row);
  function statsHeight() {
    const frame = sizes.panelPadding * 2 + 2;
    return wideStats ? sizes.row * 3 + frame : sizes.row * 6 + frame * 2 + sizes.gap;
  }
  function fixedHeight() {
    return sizes.profession + sizes.status + sizes.badges + sizes.vitals
      + sizes.footer + sizes.extra + statsHeight() + sizes.gap * 7;
  }
  let gearHeight;
  if (landscape) {
    // Header spans both columns. Gear occupies the left; remaining blocks stack on the right.
    const frame = sizes.panelPadding * 2 + 2;
    const fixed = sizes.profession + sizes.status + sizes.badges + sizes.vitals
      + sizes.footer + sizes.extra + sizes.gap * 6;
    sizes.row = Math.max(16, (usableHeight - fixed - frame) / 3);
    gearHeight = usableHeight - sizes.profession - sizes.status - sizes.gap * 2;
  } else {
    const minimumGear = Math.max(clamp(usableHeight * 0.28, 108, 160), modeCount * 20 + (modeCount - 1) * 2 + 10);
    if (!wideStats && usableHeight - fixedHeight() < minimumGear) {
      wideStats = true;
      stackedStats = contentWidth < 500;
      if (stackedStats) sizes.row = Math.max(26, sizes.row);
    }
    if (usableHeight - fixedHeight() < minimumGear) {
      const borders = wideStats ? 2 : 4;
      const scale = clamp((usableHeight - minimumGear - borders) / (fixedHeight() - borders), 0.25, 1);
      Object.keys(sizes).forEach((key) => { sizes[key] *= scale; });
    }
    gearHeight = usableHeight - fixedHeight();
  }
  const slotGap = clamp(sizes.gap * 0.7, 1, 5);
  const slotHeight = (gearHeight - slotGap * 4) / 5;
  const slotWidth = clamp(contentWidth * 0.18, 48, 82);
  const slotFont = Math.min(clamp(contentWidth / 28, 10, 15), Math.max(8, slotHeight * 0.28));
  const slotIcon = Math.max(6, Math.min(slotWidth - 10, slotHeight - slotFont * 1.2 - 6));
  const modeGap = Math.min(clamp(sizes.gap + 4, 5, 12),
    Math.max(2, (gearHeight - 10 - modeCount * 32) / (modeCount - 1)));
  const modeHeight = Math.min(clamp(contentWidth * 0.115, 32, 48),
    (gearHeight - modeGap * (modeCount - 1) - 10) / modeCount);
  const statsTextWidth = wideStats ? contentWidth / 2 : contentWidth;
  const labelFont = stackedStats
    ? Math.min(11, sizes.row * 0.32)
    : Math.min(clamp(statsTextWidth / 25, 10, 16), (sizes.row - 4) * 0.75);
  const valueFont = stackedStats
    ? Math.min(15, sizes.row * 0.40)
    : Math.min(clamp(statsTextWidth / 22, 12, 19), (sizes.row - 4) * 0.82);
  const badgeLabelFont = Math.min(9, sizes.badges * .22);
  const badgeIcon = Math.max(8, Math.min(sizes.badges - badgeLabelFont * 1.3 - 8,
    (contentWidth - sizes.gap * 6) / 7 - 4));
  const gearWidth = landscape ? (contentWidth - sizes.gap) * .42 : contentWidth;
  const portraitWidth = gearWidth - slotWidth * 2 - sizes.gap * 2 - 2;
  const modeWidth = Math.min(176, (portraitWidth - 8) * .9);
  const px = {
    'window-height': height,
    'padding-top': paddingY, 'padding-bottom': paddingY + safeBottom,
    'padding-left': paddingX + safeLeft, 'padding-right': paddingX + safeRight,
    'block-gap': sizes.gap, 'profession-height': sizes.profession, 'status-height': sizes.status,
    'badges-height': sizes.badges, 'vitals-height': sizes.vitals,
    'row-height': sizes.row, 'panel-padding': sizes.panelPadding,
    'footer-height': sizes.footer, 'extra-height': sizes.extra,
    'slot-width': slotWidth, 'slot-gap': slotGap, 'slot-icon': slotIcon,
    'slot-font': slotFont, 'slot-line': slotFont * 1.2,
    'label-font': labelFont, 'value-font': valueFont,
    'badge-icon': badgeIcon, 'badge-label-font': badgeLabelFont, 'mode-height': modeHeight, 'mode-gap': modeGap,
    'mode-font': Math.min(clamp(contentWidth * 0.04, 11, 16), Math.max(10, modeHeight * .43), (modeWidth - 10) / 6),
    'profession-font': Math.min(clamp(contentWidth * 0.04, 12, 16), sizes.profession * 0.4),
    'status-font': Math.min(clamp(contentWidth * 0.031, 10, 13), sizes.status * 0.7),
    'vital-font': Math.min(clamp(contentWidth * 0.036, 11, 15), sizes.vitals * 0.38),
    'vital-value-font': Math.min(clamp(contentWidth * 0.046, 13, 19), sizes.vitals * 0.5),
    'base-font': Math.min(clamp(contentWidth * 0.04, 12, 16), sizes.footer * 0.36),
    'extra-font': Math.min(clamp(contentWidth * 0.03, 9, 12), sizes.extra * 0.8),
    'artifact-width': clamp(contentWidth * 0.25, 76, 110),
    'artifact-icon': Math.max(10, Math.min(slotIcon, sizes.footer - 8)),
    'hint-top': paddingY + sizes.profession + sizes.status + sizes.gap * 2,
  };
  return {
    style: Object.keys(px).map((key) => '--' + key + ':' + Number(px[key].toFixed(2)) + 'px').join(';'),
    wideStats, stackedStats, landscape,
    metrics: { width, height, rootWidth, safeBottom, safeLeft, safeRight, paddingY,
      contentWidth, usableHeight, fixedHeight: usableHeight - gearHeight, statsHeight: statsHeight(),
      gearHeight, slotHeight, slotIcon,
      modeCount, modeHeight, modeGap, labelFont, valueFont, sizes },
  };
}
module.exports = { createPreviewLayout, readWindowInfo };
