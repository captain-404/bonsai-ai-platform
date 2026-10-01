const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../server');

function png(width, height) {
  const b = Buffer.alloc(64);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}
async function until(fn) { for (let i = 0; i < 300; i++) { const r = fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out'); }

test('an interrupted ComfyUI task reattaches to the job ComfyUI still has, without submitting it twice', async t => {
  let submits = 0, known = true;
  const comfy = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), send = (value, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type }); res.end(Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
    if (url.pathname === '/object_info') return send({ SaveImage: {}, EmptyImage: {}, CLIPTextEncode: {} });
    if (url.pathname === '/prompt') { submits++; req.resume(); return send({ prompt_id: `p${submits}`, node_errors: {} }); }
    if (url.pathname === '/queue') return send({ queue_running: [], queue_pending: [] });
    const hist = url.pathname.match(/^\/history\/(p\d+)$/);
    if (hist) return send(known || hist[1] !== 'p1' ? { [hist[1]]: { status: { completed: true, status_str: 'success' }, outputs: { 1: { images: [{ filename: 'a_00001_.png', subfolder: '', type: 'output' }] } } } } : {});
    if (url.pathname === '/view') return send(png(64, 64), 'image/png');
    res.writeHead(404); res.end();
  });
  await new Promise(r => comfy.listen(0, '127.0.0.1', r));
  const app = createApp({ data: fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-resume-')) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { comfy.closeAllConnections(); comfy.close(); app.server.closeAllConnections(); app.server.close(r); }));
  const base = `http://127.0.0.1:${app.server.address().port}`, { token } = await (await fetch(`${base}/api/state`)).json();
  const call = async (url, method, body) => { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': token }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, data: await res.json().catch(() => null) }; };
  await call('/api/settings', 'PUT', { modelUrl: 'http://127.0.0.1:1', comfyUrl: `http://127.0.0.1:${comfy.address().port}`, unrealUrl: 'http://127.0.0.1:1', model: 'x' });
  const wf = (await call('/api/workflows', 'POST', { name: 'Tiny', media: 'image', promptNode: '3', promptInput: 'text', graph: { 3: { class_type: 'CLIPTextEncode', inputs: { text: '' } }, 1: { class_type: 'SaveImage', inputs: { filename_prefix: 'a', images: ['2', 0] } }, 2: { class_type: 'EmptyImage', inputs: { width: 8, height: 8, batch_size: 1, color: 0 } } } })).data;
  const agent = (await call('/api/agents', 'POST', { name: 'Tiny', templateId: 'sheet', icon: 'x', accent: 'blue', workflowId: wf.id })).data;
  const job = (await call('/api/jobs', 'POST', { agentId: agent.id, prompt: 'x' })).data;
  const done = await until(() => app.store.state.jobs.find(j => j.id === job.id && !['queued', 'running'].includes(j.status)));
  assert.equal(done.status, 'needs_review', done.error); assert.equal(submits, 1);

  // Simulate a restart that cut the task short while ComfyUI kept the job.
  assert.equal(done.workflow.graph, undefined, 'settled tasks drop their saved graph');
  Object.assign(done, { status: 'interrupted', error: 'Service restarted.', artifacts: [], reviewRequired: false }); done.workflow.graph = wf.graph; // a real interruption happens mid-run, while the graph is still saved
  assert.equal((await call(`/api/jobs/${job.id}/retry`, 'POST', {})).status, 409);
  assert.equal((await call(`/api/jobs/${job.id}/resume`, 'POST', {})).status, 202);
  const again = await until(() => app.store.state.jobs.find(j => j.id === job.id && !['queued', 'running'].includes(j.status)));
  assert.equal(again.status, 'needs_review', again.error); assert.equal(again.artifacts.length, 1); assert.equal(submits, 1, 'must not be submitted twice');

  // If ComfyUI forgot the job (its own restart), it is submitted again.
  known = false; Object.assign(again, { status: 'interrupted', artifacts: [], reviewRequired: false }); again.workflow.graph = wf.graph;
  assert.equal((await call(`/api/jobs/${job.id}/resume`, 'POST', {})).status, 202);
  const third = await until(() => app.store.state.jobs.find(j => j.id === job.id && !['queued', 'running'].includes(j.status)));
  assert.equal(third.status, 'needs_review', third.error); assert.equal(submits, 2);

  // Other tasks cannot be reattached.
  assert.equal((await call(`/api/jobs/${job.id}/resume`, 'POST', {})).status, 409);
});
