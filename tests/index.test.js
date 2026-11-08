const test = require('node:test');
const assert = require('node:assert/strict');
let definition;
global.Page = (page) => { definition = page; };
require('../miniprogram/pages/index/index');
delete global.Page;

test('rapid entry taps open only one route, and returning unlocks navigation', () => {
  const page = Object.assign({}, definition, {
    data: { opening: false },
    setData(values) { Object.assign(this.data, values); },
  });
  let calls = 0;
  const previousWx = global.wx;
  global.wx = { navigateTo() { calls += 1; } };
  try {
    for (let index = 0; index < 10; index += 1) page.openBuildPreview();
    assert.equal(calls, 1);
    page.onShow();
    page.openBuildPreview();
    assert.equal(calls, 2);
  } finally { global.wx = previousWx; }
});
