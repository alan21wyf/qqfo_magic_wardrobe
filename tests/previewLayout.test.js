const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewLayout, readWindowInfo } = require('../miniprogram/domain/previewLayout');

function windowInfo(width, height, bottom = 0) {
  return { windowWidth: width, windowHeight: height, screenWidth: width, screenHeight: height + 88,
    statusBarHeight: 44, safeArea: { left: 0, right: width, bottom: height + 88 - bottom } };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`); }

test('phone and tablet layouts fit the window including the bottom safe area', () => {
  for (const dimensions of [[320, 480], [375, 603], [390, 750, 34], [430, 839, 34],
    [430, 950, 34], [844, 302, 21], [768, 900, 20]]) {
    const layout = createPreviewLayout(windowInfo(...dimensions));
    const m = layout.metrics;
    close(m.fixedHeight + m.gearHeight + m.paddingY * 2 + m.safeBottom, dimensions[1]);
    assert.ok(m.gearHeight > 0 && m.slotHeight > 0 && m.slotIcon > 0);
    assert.ok(m.modeHeight * 3 + m.modeGap * 2 + 8 <= m.gearHeight);
    const slotFont = Number(layout.style.match(/--slot-font:([\d.]+)/)[1]);
    assert.ok(m.slotIcon + slotFont * 1.2 + 6 <= m.slotHeight + 0.02);
  }
});

test('normal portrait keeps full width panels and grows comfortably on taller screens', () => {
  const normal = createPreviewLayout(windowInfo(390, 750, 34));
  const tall = createPreviewLayout(windowInfo(430, 950, 34));
  assert.equal(normal.wideStats, false);
  assert.equal(normal.stackedStats, false);
  assert.ok(normal.metrics.labelFont >= 14);
  assert.ok(tall.metrics.gearHeight > 300);
  assert.ok(tall.metrics.slotIcon > normal.metrics.slotIcon);
  assert.ok(tall.metrics.valueFont > normal.metrics.valueFont);
});

test('short screens pair the panels; landscape gives gear its own column', () => {
  const short = createPreviewLayout(windowInfo(320, 480));
  assert.equal(short.wideStats, true);
  assert.equal(short.stackedStats, true);
  assert.equal(short.landscape, false);
  const landscape = createPreviewLayout(windowInfo(844, 302, 21));
  assert.equal(landscape.landscape, true);
  assert.equal(landscape.stackedStats, true);
  assert.ok(landscape.metrics.slotIcon >= 20);
  const m = landscape.metrics;
  close(m.sizes.profession + m.sizes.status + m.sizes.badges + m.sizes.vitals
    + m.statsHeight + m.sizes.footer + m.sizes.extra + m.sizes.gap * 6, m.usableHeight);
});

test('safe area is applied once without subtracting the navigation or status bar twice', () => {
  const info = windowInfo(390, 750, 34);
  const m = createPreviewLayout(info).metrics;
  assert.equal(m.safeBottom, 34);
  close(m.usableHeight, 750 - 34 - 2 * m.paddingY);
  assert.deepEqual(createPreviewLayout({ ...info, statusBarHeight: 24 }), createPreviewLayout(info));
  assert.equal(createPreviewLayout({ ...info, safeArea: null }).metrics.safeBottom, 0);
  assert.equal(createPreviewLayout({ ...info, safeArea: { bottom: null } }).metrics.safeBottom, 0);
});

test('model names do not affect geometry and wide screens account for centered safe edges', () => {
  const info = windowInfo(390, 750, 34);
  assert.deepEqual(createPreviewLayout({ ...info, model: 'iPhone' }), createPreviewLayout({ ...info, model: 'Android' }));
  const centered = createPreviewLayout({ ...windowInfo(844, 302, 21), safeArea: { left: 44, right: 800, bottom: 369 } });
  assert.equal(centered.metrics.safeLeft, 0);
  assert.equal(centered.metrics.safeRight, 0);
  const edge = createPreviewLayout({ ...windowInfo(600, 340), safeArea: { left: 30, right: 580 } });
  assert.equal(edge.metrics.safeLeft, 30);
  assert.equal(edge.metrics.safeRight, 20);
});

test('window API prefers getWindowInfo and falls back for older or unavailable clients', () => {
  const info = windowInfo(375, 603);
  assert.equal(readWindowInfo({ getWindowInfo: () => info, getSystemInfoSync() { throw Error('unexpected fallback'); } }), info);
  assert.equal(readWindowInfo({ getWindowInfo() { throw Error('unavailable'); }, getSystemInfoSync: () => info }), info);
  assert.equal(readWindowInfo({ getWindowInfo: () => ({}), getSystemInfoSync: () => info }), info);
  assert.deepEqual(readWindowInfo({}), {});
  const fallback = createPreviewLayout({ windowWidth: -1, windowHeight: NaN });
  assert.equal(fallback.metrics.width, 375);
  assert.equal(fallback.metrics.height, 700);
});

test('page resize and foreground refresh only layout, preserving equipment and profession', () => {
  let definition;
  global.Page = (value) => { definition = value; };
  require('../miniprogram/pages/buildpreview/index');
  delete global.Page;
  let info = windowInfo(390, 750, 34);
  const previous = global.wx;
  global.wx = { getWindowInfo: () => info };
  try {
    const records = { swordsman: { equipment: { ring: { equipped: false } } } };
    let writes = 0;
    const page = Object.assign({}, definition, { data: structuredClone(definition.data), profiles: records,
      setData(value) { writes++; Object.assign(this.data, value); } });
    page.onShow();
    assert.equal(page.data.layoutLandscape, false);
    page.onShow();
    assert.equal(writes, 1);
    info = windowInfo(844, 302, 21);
    page.onResize({ size: { windowWidth: 844, windowHeight: 302 } });
    assert.equal(page.data.layoutLandscape, true);
    assert.equal(page.viewportLayout.safeBottom, 21);
    assert.equal(page.profiles, records);
    assert.equal(page.data.profession, 'swordsman');
    page.unloaded = true;
    page.onShow();
    assert.equal(writes, 2);
  } finally { if (previous === undefined) delete global.wx; else global.wx = previous; }
});
