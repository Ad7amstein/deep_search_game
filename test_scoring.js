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

// The Searcher's inbox must show the plan in the Planner's pick order.
const { Store } = window.__DSC;
const team = Store.createSession({
  teams: [{ name: 'T', requestId: 'req_egypt_argentina' }], maxPlayers: 4, durationMinutes: 5
}).teams[0];
team.stages.planner.selection = ['p_bias', 'p_topic', 'p_crosscheck'];

const inbox = Engine.inboxFor(team, 'searcher');
assert.ok(inbox.ordered, 'a plan handoff is flagged ordered');
assert.deepStrictEqual(inbox.items.map((i) => i.id), team.stages.planner.selection, 'pick order kept');
assert.ok(!Engine.inboxFor(team, 'validator').ordered, 'a source handoff is not ordered');

// Derived keys come from the stage before, not from the request.
team.stages.planner.selection = ['p_experts', 'p_legal', 'p_bias'];
assert.deepStrictEqual(Engine.correctIdsFor(team, 'searcher').sort(),
  ['s_book', 's_court', 's_expert', 's_standards'], 'plan steps imply their source kinds');

team.stages.searcher.selection = ['s_paper', 's_company'];
assert.deepStrictEqual(Engine.correctIdsFor(team, 'validator').sort(),
  ['v_method', 'v_neutral', 'v_peer'], 'sources imply the checks they warrant');

// Playing each stage perfectly must leave the next one workable, all the way down.
const cards = DataLoader.data.settings.cardsPerStage;
for (const req of DataLoader.data.researchRequests) {
  team.stages.planner.selection = req.correctPlan;
  const sources = Engine.correctIdsFor(team, 'searcher');
  team.stages.searcher.selection = sources;
  const checks = Engine.correctIdsFor(team, 'validator');
  assert.ok(sources.length >= 4 && sources.length < cards, `${req.id}: ${sources.length} sources`);
  assert.ok(checks.length >= 4 && checks.length < cards, `${req.id}: ${checks.length} checks`);
}

// Every non-trap option must be reachable, or it is a permanent wrong answer.
for (const [from, pool] of [['plannerSteps', 'sources'], ['sources', 'validationCriteria']]) {
  const reachable = new Set(DataLoader.data[from].flatMap((o) => o.implies || []));
  const orphans = DataLoader.data[pool].filter((o) => !o.trap && !reachable.has(o.id)).map((o) => o.id);
  assert.deepStrictEqual(orphans, [], `unreachable ${pool}`);
}

// A handoff that implies nothing leaves nothing to get right.
team.stages.planner.selection = ['p_topic', 'p_bias'];
assert.deepStrictEqual(Engine.correctIdsFor(team, 'searcher'), [], 'no sources implied');
assert.strictEqual(Scoring.scoreStage('searcher', ['s_news'], []).score, 0, 'empty key scores 0, not NaN');

console.log('ok');
