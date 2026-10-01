const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanup } = require('../lib/maintenance');

test('cleanup removes only old finished tasks and unused uploads', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-clean-'));
  const id = n => `00000000-0000-0000-0000-00000000000${n}`, old = new Date(Date.now() - 40 * 86400000).toISOString(), fresh = new Date().toISOString();
  const mk = (n, status, when, extra = {}) => { fs.mkdirSync(path.join(data, 'tasks', id(n)), { recursive: true }); fs.writeFileSync(path.join(data, 'tasks', id(n), 'f.bin'), Buffer.alloc(1000)); return { id: id(n), status, completedAt: when, createdAt: when, artifacts: [], inputs: {}, workflow: { graph: { 1: {} } }, ...extra }; };
  const jobs = [mk(1, 'failed', old), mk(2, 'failed', fresh), mk(3, 'needs_review', old), mk(4, 'accepted', old), mk(5, 'running', old), mk(6, 'declined', old, { completedAt: undefined, declinedAt: old }), mk(7, 'failed', old, { flowRunId: 'r' }), mk(8, 'succeeded', fresh, { inputs: { a: { uploadId: 'keepme' } } })];
  fs.mkdirSync(path.join(data, 'uploads'));
  for (const [name, age] of [['keepme.png', 40], ['orphan.png', 40], ['recent.png', 0]]) { const f = path.join(data, 'uploads', name); fs.writeFileSync(f, Buffer.alloc(500)); const t = new Date(Date.now() - age * 86400000); fs.utimesSync(f, t, t); }
  const store = { state: { jobs }, events: [], event(...a) { this.events.push(a); }, save() { this.saved = true; } };

  const preview = cleanup(store, data, { days: 30, dryRun: true });
  assert.equal(preview.jobs, 2); assert.equal(preview.uploads, 1); assert.equal(preview.bytes, 2500);
  assert.equal(store.state.jobs.length, 8); assert.ok(fs.existsSync(path.join(data, 'tasks', id(1))), 'a preview deletes nothing');

  const done = cleanup(store, data, { days: 30 });
  assert.deepEqual(store.state.jobs.map(j => j.id), [2, 3, 4, 5, 7, 8].map(id));
  assert.ok(!fs.existsSync(path.join(data, 'tasks', id(1))) && fs.existsSync(path.join(data, 'tasks', id(3))));
  assert.deepEqual(fs.readdirSync(path.join(data, 'uploads')).sort(), ['keepme.png', 'recent.png']);
  assert.equal(done.jobs, 2);
  assert.equal(store.state.jobs.find(j => j.id === id(2)).workflow.graph, undefined, 'finished tasks drop their saved graph');
  assert.ok(store.state.jobs.find(j => j.id === id(5)).workflow.graph, 'running tasks keep it');

  assert.equal(cleanup(store, data, { days: 30, includeAccepted: true }).jobs, 1);
  assert.throws(() => cleanup(store, data, { days: -1 }));
});
