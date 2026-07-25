/* Smoke test for ordered-stage scoring. Run: node test_scoring.js */
'use strict';
const assert = require('assert');

global.window = globalThis;
global.document = { addEventListener() {} };
global.localStorage = {
  _m: {},
  getItem(k) { return k in this._m ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};

require('./script.js');
const { DataLoader, Engine, Scoring } = window.__DSC;
DataLoader.ingest(require('./game-data.json'));

assert.ok(Engine.isOrdered('planner'), 'planner is order-scored');
assert.ok(Engine.isOrdered('reporter'), 'reporter is order-scored');
assert.ok(!Engine.isOrdered('searcher'), 'searcher is not order-scored');

const key = DataLoader.request('req_egypt_argentina').correctPlan;
const right = Scoring.scoreStage('planner', key.slice(), key);
const scrambled = Scoring.scoreStage('planner', key.slice().reverse(), key);

assert.strictEqual(right.orderAccuracy, 1, 'perfect order scores 1');
assert.ok(scrambled.orderAccuracy < 1, 'reversed order scores worse');
assert.ok(scrambled.score < right.score, 'wrong order costs points');
assert.ok(scrambled.score >= right.score * 0.75, 'order caps the loss at 25%');

console.log('ok');
