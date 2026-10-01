const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../server');
const kontext = require('../presets/kontext-turnaround.json');
const pixal = require('../presets/pixal3d-multiview.json');

function png(width, height) {
  const b = Buffer.alloc(64);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}
async function until(fn) { for (let i = 0; i < 300; i++) { const r = fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out'); }

test('the graph of the sheet preset only uses nodes and inputs that are wired consistently', () => {
  for (const [id, node] of Object.entries(kontext.graph)) for (const [key, value] of Object.entries(node.inputs)) {
    if (Array.isArray(value)) assert.ok(kontext.graph[value[0]], `node ${id}.${key} points at a missing node ${value[0]}`);
  }
  assert.equal(kontext.promptTemplates.length, 4);
  assert.ok(kontext.promptTemplates.every(t => t.template.includes('{subject}') && kontext.graph[t.node].class_type === 'CLIPTextEncode'));
});

test('sheet agent: reference picture to 2x2 sheet, accept, then hand the sheet to the 3D agent', async t => {
  const seen = { prompts: [] };
  const comfy = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c);
    const send = (value, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type }); res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    if (url.pathname === '/object_info') return send(Object.fromEntries([...Object.values(kontext.graph), ...Object.values(pixal.graph)].map(n => [n.class_type, {}])));
    if (url.pathname === '/upload/image') return send({ name: `up${seen.prompts.length}.png`, subfolder: '', type: 'input' });
    if (url.pathname === '/prompt') { const g = JSON.parse(Buffer.concat(chunks)).prompt; seen.prompts.push(g); return send({ prompt_id: `p${seen.prompts.length}`, node_errors: {} }); }
    const hist = url.pathname.match(/^\/history\/p(\d+)$/);
    if (hist) return send({ [`p${hist[1]}`]: { status: { completed: true, status_str: 'success' }, outputs: hist[1] === '1' ? { 53: { images: [{ filename: 'Boots_sheet_00001_.png', subfolder: 'sheets', type: 'output' }] }, 15: { images: [{ filename: 'left_00001_.png', subfolder: 'sheets/Boots_views', type: 'output' }] } } : { 372: { '3d': [{ filename: 'Boots_00001_.glb', subfolder: '3d', type: 'output' }] } } } });
    if (url.pathname === '/view') return send(url.searchParams.get('filename').endsWith('.glb') ? Buffer.from('glTF-test') : png(2048, 2048), url.searchParams.get('filename').endsWith('.glb') ? 'model/gltf-binary' : 'image/png');
    res.writeHead(404); res.end();
  });
  await new Promise(r => comfy.listen(0, '127.0.0.1', r));
  const app = createApp({ data: fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-sheet-')) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { comfy.closeAllConnections(); comfy.close(); app.server.closeAllConnections(); app.server.close(r); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const { token } = await (await fetch(`${base}/api/state`)).json();
  const call = async (url, method, body, headers = {}) => { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': token, ...headers }, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) }); return { status: res.status, data: await res.json().catch(() => null) }; };
  await call('/api/settings', 'PUT', { modelUrl: 'http://127.0.0.1:1', comfyUrl: `http://127.0.0.1:${comfy.address().port}`, unrealUrl: 'http://127.0.0.1:1', model: 'x' });

  const wf = (await call('/api/workflows/preset', 'POST', { id: 'kontext-turnaround' })).data;
  assert.equal(wf.handoff.presetId, 'pixal3d-single'); assert.equal(wf.handoff.match, '_front_'); assert.equal(wf.promptTemplates.length, 4); assert.equal(wf.inputs.length, 1); assert.equal(wf.inputs[0].optional, true);
  const wf3d = (await call('/api/workflows/preset', 'POST', { id: 'pixal3d-multiview' })).data;
  const single = (await call('/api/workflows/preset', 'POST', { id: 'pixal3d-single' })).data;
  assert.ok(single.id); assert.equal(single.inputs[0].node, '122'); assert.equal(single.inputs[0].kind, 'image'); assert.equal(single.params.find(p => p.key === 'resolution').targets[0].node, '94');
  // A stale saved copy is flagged and refreshed in place, keeping its id.
  const stale = app.store.state.workflows.find(w => w.id === single.id); stale.description = 'old'; stale.params.pop();
  assert.equal((await call('/api/presets', 'GET')).data.find(p => p.id === 'pixal3d-single').outdated, true);
  assert.equal((await call('/api/workflows/preset', 'POST', { id: 'pixal3d-single' })).data.params.length, 1);
  const refreshed = (await call('/api/workflows/preset', 'POST', { id: 'pixal3d-single', update: true })).data;
  assert.equal(refreshed.id, single.id); assert.equal(refreshed.params.length, 2); assert.notEqual(refreshed.description, 'old');
  assert.equal((await call('/api/presets', 'GET')).data.find(p => p.id === 'pixal3d-single').outdated, false);
  const sheetAgent = (await call('/api/agents', 'POST', { name: 'Prism', templateId: 'sheet', icon: '🎞️', accent: 'blue', workflowId: wf.id })).data;
  const agent3d = (await call('/api/agents', 'POST', { name: 'Voxel', templateId: 'model3d', icon: '🧊', accent: 'violet', workflowId: wf3d.id })).data;

  const job = (await call('/api/jobs', 'POST', { agentId: sheetAgent.id, prompt: 'a single black leather samurai boot', params: { seed: '5', steps: '12' } })).data;
  const done = await until(() => app.store.state.jobs.find(j => j.id === job.id && !['queued', 'running'].includes(j.status)));
  assert.equal(done.status, 'needs_review', done.error);
  const g = seen.prompts[0];
  assert.match(g[61].inputs.text, /^a single black leather samurai boot, front view/);
  assert.equal(g[62].inputs.seed, 5); assert.equal(g[62].inputs.steps, 4);
  assert.equal(g[4].inputs.image[0], '63'); assert.equal(g[3], undefined);
  assert.match(g[10].inputs.text, /This picture shows a single black leather samurai boot\. Show this exact same object in a left side view/);
  assert.match(g[20].inputs.text, /back view/); assert.match(g[30].inputs.text, /right side view/);
  assert.deepEqual([13, 23, 33].map(n => [g[n].inputs.seed, g[n].inputs.steps]), [[5, 12], [5, 12], [5, 12]]);
  assert.equal(g[53].inputs.filename_prefix, 'sheets/a_single_black_leather_samurai_boot_sheet');
  const sheet = done.artifacts.find(a => a.label.includes('_sheet_'));
  assert.ok(sheet);

  // The hand-off only works after the sheet is accepted.
  assert.equal((await call(`/api/artifacts/${sheet.id}/use-as-input`, 'POST', {})).status, 409);
  assert.equal((await call(`/api/jobs/${job.id}/accept`, 'POST', {})).status, 200);
  const passed = await call(`/api/artifacts/${sheet.id}/use-as-input`, 'POST', {});
  assert.equal(passed.status, 201); assert.equal(passed.data.width, 2048); assert.equal(passed.data.assetName, 'a_single_black_leather_samurai_boot');

  const job3d = (await call('/api/jobs', 'POST', { agentId: agent3d.id, prompt: passed.data.assetName, inputs: { sheet: passed.data.id }, params: { layout: 'grid', trim: '0' } })).data;
  const done3d = await until(() => app.store.state.jobs.find(j => j.id === job3d.id && !['queued', 'running'].includes(j.status)));
  assert.equal(done3d.status, 'needs_review', done3d.error);
  assert.equal(done3d.evidence.sheet.layout, 'grid');
  assert.deepEqual(seen.prompts[1][345].inputs.crop_region, { x: 1024, y: 1024, width: 1024, height: 1024 });

  // With the user's own front picture, the drawing nodes are dropped and only the side views are generated.
  const ref = await call('/api/uploads', 'POST', png(1024, 1536), { 'Content-Type': 'image/png' });
  const own = (await call('/api/jobs', 'POST', { agentId: sheetAgent.id, prompt: 'my own boot', inputs: { reference: ref.data.id } })).data;
  const ownDone = await until(() => app.store.state.jobs.find(j => j.id === own.id && !['queued', 'running'].includes(j.status)));
  assert.equal(ownDone.status, 'needs_review', ownDone.error);
  const og = seen.prompts[seen.prompts.length - 1];
  assert.deepEqual(og[4].inputs.image, ['3', 0]); assert.match(og[3].inputs.image, /^up\d+\.png$/);
  assert.ok([60, 61, 62, 63, 64].every(n => og[n] === undefined));
  assert.match(og[10].inputs.text, /This picture shows my own boot\. Show this exact same object in a left side view/);
});
