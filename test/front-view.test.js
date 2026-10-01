const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const preset = require('../presets/front-view.json');

test('front-view preset: self-contained graph, installs, hands off to the single-image 3D preset', async t => {
  for (const [id, node] of Object.entries(preset.graph)) for (const [key, value] of Object.entries(node.inputs)) if (Array.isArray(value)) assert.ok(preset.graph[value[0]], `node ${id}.${key} points at a missing node`);
  assert.deepEqual(preset.inputs, []); assert.equal(preset.graph[preset.promptNode].class_type, 'CLIPTextEncode');
  assert.ok(Object.values(preset.graph).every(n => !['FluxKontextImageScale', 'ReferenceLatent', 'UNETLoader'].includes(n.class_type)), 'no Kontext model needed');
  const app = createApp({ data: fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-front-')) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { app.server.closeAllConnections(); app.server.close(r); }));
  const base = `http://127.0.0.1:${app.server.address().port}`, { token } = await (await fetch(`${base}/api/state`)).json();
  const res = await fetch(`${base}/api/workflows/preset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': token }, body: JSON.stringify({ id: 'front-view' }) });
  const wf = await res.json();
  assert.equal(res.status, 201); assert.equal(wf.handoff.presetId, 'pixal3d-single'); assert.equal(wf.params.find(p => p.key === 'steps').default, 4);
  const list = await (await fetch(`${base}/api/presets`)).json();
  assert.ok(list.some(p => p.id === 'pixal3d-single') && list.find(p => p.id === 'front-view').installed);
});
