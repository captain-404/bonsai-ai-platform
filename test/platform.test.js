const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../server');
const { openStore, migrate } = require('../lib/store');
const { execute } = require('../lib/adapters');
const { localUrl } = require('../lib/validation');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-test-'));
const agent = { name: 'Moss', templateId: 'assistant', icon: '🌱', accent: 'green', instructions: 'Write a short answer.' };
async function fixture(t, adapters) {
  const data = temp(), app = createApp({ data, adapters });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.server.closeAllConnections(); app.server.close(resolve); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/state`)).json();
  const request = async (url, method = 'GET', body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': snapshot.token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  return { ...app, data, request, base, token: snapshot.token };
}
async function until(fn) { for (let i = 0; i < 100; i++) { const r = fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out'); }
test('agent create, rename, duplicate, archive, restore and saved identity', async t => {
  const f = await fixture(t); const made = await f.request('/api/agents', 'POST', agent); assert.equal(made.status, 201);
  const id = made.data.id;
  assert.equal((await f.request(`/api/agents/${id}`, 'PUT', { ...agent, name: 'Fern' })).data.id, id);
  assert.equal((await f.request(`/api/agents/${id}/duplicate`, 'POST', {})).data.name, 'Fern copy');
  assert.equal((await f.request(`/api/agents/${id}/archive`, 'POST', {})).data.archived, true);
  assert.equal((await f.request(`/api/agents/${id}/restore`, 'POST', {})).data.archived, false);
  const saved = JSON.parse(fs.readFileSync(path.join(f.data, 'platform-state.json')));
  assert.equal(saved.agents.find(a => a.id === id).version, 2);
});
test('invalid input and malformed JSON cannot crash the server', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/agents', 'POST', { ...agent, name: '' })).status, 400);
  const r = await fetch(f.base + '/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': f.token }, body: '{broken' });
  assert.equal(r.status, 400); assert.equal((await f.request('/api/state')).status, 200);
});
test('mutations require same-origin token and reject remote connections', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/agents', 'POST', agent, { 'X-Bonsai-Token': '' })).status, 403);
  assert.equal((await f.request('/api/agents', 'POST', agent, { Origin: 'https://untrusted.example' })).status, 403);
  assert.throws(() => localUrl('http://example.com')); assert.throws(() => localUrl('http://localhost/path'));
});
test('corrupt storage is preserved and never reset', () => {
  const dir = temp(), file = path.join(dir, 'platform-state.json'); fs.writeFileSync(file, 'broken-state');
  assert.throws(() => openStore(dir)); assert.equal(fs.readFileSync(file, 'utf8'), 'broken-state');
  assert.equal(fs.existsSync(path.join(dir, 'platform.lock')), false);
});
test('restart migrates legacy demos and marks unfinished work interrupted', () => {
  const dir = temp(), file = path.join(dir, 'platform-state.json');
  fs.writeFileSync(file, JSON.stringify({ agents: [], pipelines: [{ id: 'demo' }], runs: [{ status: 'completed' }], modelJobs: [{ status: 'working', workerReports: ['keep'] }], jobs: [{ status: 'running' }], events: [] }));
  const store = openStore(dir); assert.equal(store.state.runs[0].status, 'demo_completed'); assert.equal(store.state.jobs[0].status, 'interrupted'); assert.deepEqual(store.state.modelJobs[0].workerReports, ['keep']); store.close();
  assert.ok(fs.readdirSync(dir).some(f => f.includes('before-v2')));
});
test('data ownership prevents two app writers', () => {
  const dir = temp(), store = openStore(dir); assert.throws(() => openStore(dir), /already in use/); store.close();
});
test('legacy Blender reviewers migrate to inspection-only templates', () => {
  const state = migrate({ agents: [{ id: 'blender-reviewer' }, { id: 'conductor' }], pipelines: [], runs: [], events: [] });
  assert.equal(state.agents[0].templateId, 'reviewer'); assert.equal(state.agents[1].templateId, 'planner');
});
test('job snapshots survive agent edits; queue runs serially; cancellation stops queued work', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { text: async job => { await wait; job.output = 'saved'; } });
  const a = (await f.request('/api/agents', 'POST', agent)).data;
  const first = (await f.request('/api/jobs', 'POST', { agentId: a.id, prompt: 'first' })).data;
  await until(() => f.runner.active);
  const second = (await f.request('/api/jobs', 'POST', { agentId: a.id, prompt: 'second' })).data;
  assert.equal((await f.request(`/api/agents/${a.id}/archive`, 'POST', {})).status, 409);
  await f.request(`/api/agents/${a.id}`, 'PUT', { ...agent, name: 'Renamed' });
  assert.equal(f.store.state.jobs.find(j => j.id === first.id).agent.name, 'Moss');
  await f.request(`/api/jobs/${second.id}/cancel`, 'POST', {});
  release(); await until(() => !f.runner.active);
  assert.equal(f.store.state.jobs.find(j => j.id === second.id).status, 'cancelled');
});
test('reviewer tasks enforce inspection even if cleanup is requested', async t => {
  const f = await fixture(t, { blender: async job => { assert.equal(job.action, 'inspect'); } });
  const source = path.join(f.data, 'dummy.blend'); fs.writeFileSync(source, 'fixture');
  const a = (await f.request('/api/agents', 'POST', { ...agent, templateId: 'reviewer' })).data;
  const r = await f.request('/api/jobs', 'POST', { agentId: a.id, prompt: 'Inspect', sourcePath: source, action: 'cleanup' });
  assert.equal(r.data.action, 'inspect'); await until(() => f.store.state.jobs[0].status === 'succeeded');
});
test('legacy execution is disabled and workflow mappings are validated', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/pipelines/run', 'POST', {})).status, 410);
  assert.equal((await f.request('/api/workflows', 'POST', { name: 'bad', graph: { nodes: [] }, media: 'image' })).status, 400);
});
test('ComfyUI protocol: map prompt, download result, record external ID and require review', async t => {
  let submitted;
  const mock = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/object_info') return res.end(JSON.stringify({ CLIPTextEncode: {} }));
    if (req.url === '/prompt') { let raw = ''; for await (const c of req) raw += c; submitted = JSON.parse(raw); return res.end(JSON.stringify({ prompt_id: 'owned', node_errors: {} })); }
    if (req.url === '/history/owned') return res.end(JSON.stringify({ owned: { status: { completed: true, status_str: 'success' }, outputs: { '1': { images: [{ filename: 'fixture.png', type: 'output' }] } } } }));
    if (req.url.startsWith('/view?')) { res.setHeader('Content-Type', 'image/png'); return res.end(Buffer.from('89504e470d0a1a0a', 'hex')); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve)); t.after(() => { mock.closeAllConnections(); mock.close(); });
  const job = { id: 'test', prompt: 'a forest', artifacts: [], settings: { comfyUrl: `http://127.0.0.1:${mock.address().port}` }, workflow: { graph: { '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }, promptNode: '1', promptInput: 'text', media: 'image' } };
  await execute.comfy(job, { dir: temp(), signal: new AbortController().signal, progress() {} });
  assert.equal(submitted.prompt['1'].inputs.text, 'a forest'); assert.equal(job.externalId, 'owned'); assert.equal(job.artifacts.length, 1); assert.equal(job.reviewRequired, true);
});
test('failed adapters cannot claim success', async t => {
  const f = await fixture(t, { text: async () => { throw new Error('No output'); } });
  const a = (await f.request('/api/agents', 'POST', agent)).data;
  await f.request('/api/jobs', 'POST', { agentId: a.id, prompt: 'task' });
  await until(() => f.store.state.jobs[0].status === 'failed'); assert.equal(f.store.state.jobs[0].error, 'No output');
});
test('agent workflows pass text forward and complete real adapter steps', async t => {
  const prompts = [];
  const f = await fixture(t, { text: async job => { prompts.push(job.prompt); job.output = 'A forest robot concept'; } });
  const a = (await f.request('/api/agents', 'POST', agent)).data;
  const flow = (await f.request('/api/flows', 'POST', { name: 'Brief to draft', steps: [{ agentId: a.id, instruction: 'Plan' }, { agentId: a.id, instruction: 'Write', input: 'previous_text' }] })).data;
  assert.ok(flow.id);
  const run = await f.request(`/api/flows/${flow.id}/run`, 'POST', { brief: 'Create a robot.' }); assert.equal(run.status, 202);
  await until(() => f.store.state.flowRuns[0].status === 'succeeded');
  assert.equal(prompts.length, 2); assert.match(prompts[1], /A forest robot concept/); assert.equal(f.store.state.flowRuns[0].currentStep, 2);
});
test('workflow pauses for review and acceptance releases only the next step', async t => {
  let calls = 0;
  const f = await fixture(t, { text: async job => { job.output = 'Draft'; if (++calls === 1) job.reviewRequired = true; } });
  const a = (await f.request('/api/agents', 'POST', agent)).data;
  const flow = (await f.request('/api/flows', 'POST', { name: 'Reviewed chain', steps: [{ agentId: a.id }, { agentId: a.id, input: 'previous_text' }] })).data;
  await f.request(`/api/flows/${flow.id}/run`, 'POST', { brief: 'Write' });
  await until(() => f.store.state.flowRuns[0].status === 'waiting_review'); assert.equal(calls, 1);
  const first = f.store.state.jobs[0]; await f.request(`/api/jobs/${first.id}/accept`, 'POST', {});
  await until(() => f.store.state.flowRuns[0].status === 'succeeded'); assert.equal(calls, 2);
  assert.equal((await f.request(`/api/jobs/${first.id}/accept`, 'POST', {})).status, 409);
});
test('project registry detects engine identity and rejects duplicate roots', async t => {
  const f = await fixture(t); const project = path.join(f.data, 'UnrealFixture');fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'Fixture.uproject'), JSON.stringify({ EngineAssociation: '5.8', Modules: [] }));
  const result = await f.request('/api/projects', 'POST', { path: project });
  assert.equal(result.status, 201); assert.equal(result.data.engine, 'unreal'); assert.equal(result.data.version, '5.8');
  assert.deepEqual(result.data.capabilities, ['metadata_inspection']);
  assert.equal((await f.request('/api/projects', 'POST', { path: project })).status, 409);
});
