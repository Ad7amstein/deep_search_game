/* Smoke test for the online-sync layer. Run: node test_sync.js
   Verifies that a session survives a Firebase round-trip, which strips
   nulls and empty arrays/objects, once Store.normalize has run. */
'use strict';
const assert = require('assert');

// Minimal browser shims so script.js can load in node.
global.window = globalThis;
global.document = { addEventListener() {} };
global.localStorage = {
  _m: {},
  getItem(k) { return k in this._m ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};

require('./script.js');
const { Utils, Store, Net, DataLoader } = window.__DSC;

DataLoader.ingest(require('./game-data.json'));

assert.strictEqual(Net.enabled, false, 'Net must stay disabled without config');
assert.match(Utils.sessionCode(), /^[A-Z2-9]{5}$/, 'session code shape');
assert.strictEqual(Net.cleanCode('  ab-c12 '), 'ABC12', 'code cleaning');

const session = Store.createSession({
  maxPlayers: 4,
  durationMinutes: 5,
  teams: [{ name: 'Team A', requestId: DataLoader.data.researchRequests[0].id }]
});
assert.ok(session.code, 'session gets a code');

// Simulate what Firebase RTDB does to stored JSON: drop nulls and empty containers.
function fbStrip(value) {
  if (Array.isArray(value)) {
    const out = value.map(fbStrip).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const s = fbStrip(v);
      if (s !== undefined) out[k] = s;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}

const roundTripped = fbStrip(JSON.parse(JSON.stringify(session)));
assert.strictEqual(roundTripped.teams[0].players, undefined, 'strip really removes empty arrays');

const restored = Store.normalize(roundTripped);
const team = restored.teams[0];
assert.ok(Array.isArray(team.players), 'players array restored');
DataLoader.roleIds().forEach((roleId) => {
  const stage = team.stages[roleId];
  assert.ok(stage, 'stage exists: ' + roleId);
  assert.ok(Array.isArray(stage.selection), 'selection array restored: ' + roleId);
  assert.ok(!stage.submittedAt, 'stage not submitted: ' + roleId);
  assert.strictEqual(stage.score, 0, 'score defaulted: ' + roleId);
});

// A mutator written against the full shape must work on a normalized session.
Store.write(restored);
Store.update((s) => {
  s.teams[0].players.push({ id: 'p_test', name: 'Nour', role: null, joinedAt: Date.now() });
});
assert.strictEqual(Store.session.teams[0].players.length, 1, 'join works after round-trip');

// Results stay hidden until the admin releases them.
const { Identity, App } = window.__DSC;
Identity.save({ id: 'p_test', name: 'Nour', teamId: 'team_0', role: 'planner' });
Store.update((s) => {
  DataLoader.roleIds().forEach((rid) => { s.teams[0].stages[rid].submittedAt = Date.now(); });
  s.status = 'ended';
  s.endedAt = Date.now();
});
assert.strictEqual(App.resolvePlayerScreen(), 'briefing', 'results hidden before release');
Store.update((s) => { s.resultsReleasedAt = Date.now(); });
assert.strictEqual(App.resolvePlayerScreen(), 'results', 'results visible after release');

console.log('test_sync.js: all checks passed');
