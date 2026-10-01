const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Needs Python with the bpy module (Blender as a library); skipped where it is not installed.
const hasBpy = spawnSync('python3', ['-c', 'import bpy']).status === 0;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-prep-'));
const wrapper = path.join(work, 'fake-blender.sh');
fs.writeFileSync(wrapper, `#!/bin/sh
# Stands in for blender.exe: runs the fixed script with bpy. bpy may crash when the interpreter exits, after the result is written.
SCRIPT=""; REQ=""
while [ $# -gt 0 ]; do case "$1" in --python) SCRIPT="$2"; shift;; --) REQ="$2"; shift;; esac; shift; done
python3 -c "import sys, runpy; sys.argv=['x','--','$REQ']; runpy.run_path('$SCRIPT')"
exit 0
`, { mode: 0o755 });
process.env.BLENDER_EXE = wrapper;
const { createApp } = require('../server');

test('game prep: GLB reduced to the triangle target, checked again, original untouched', { skip: !hasBpy }, async t => {
  const glb = path.join(work, 'high.glb');
  const make = spawnSync('python3', ['-c', `
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6)
img = bpy.data.images.new('t', 8, 8); img.pixels = [0.5, 0.2, 0.2, 1] * 64
m = bpy.data.materials.new('m'); m.use_nodes = True
n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img
m.node_tree.links.new(n.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
bpy.context.object.data.materials.append(m)
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(glb)}, export_format='GLB')
`]);
  assert.ok(fs.existsSync(glb), make.stderr.toString().slice(-500));
  const original = fs.readFileSync(glb);

  const app = createApp({ data: fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-prep-data-')) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { app.server.closeAllConnections(); app.server.close(r); }));
  const base = `http://127.0.0.1:${app.server.address().port}`, { token } = await (await fetch(`${base}/api/state`)).json();
  const call = async (url, method, body) => { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Bonsai-Token': token }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, data: await res.json().catch(() => null) }; };
  const agent = (await call('/api/agents', 'POST', { name: 'Polisher', templateId: 'blender', icon: 'x', accent: 'blue' })).data;

  assert.equal((await call('/api/jobs', 'POST', { agentId: agent.id, prompt: 'x', sourcePath: glb, action: 'gameprep', targetTriangles: 10 })).status, 400);
  assert.equal((await call('/api/jobs', 'POST', { agentId: agent.id, prompt: 'x', sourcePath: path.join(work, 'x.blend'), action: 'gameprep' })).status, 400);

  const job = (await call('/api/jobs', 'POST', { agentId: agent.id, prompt: 'x', sourcePath: glb, action: 'gameprep', targetTriangles: 20000 })).data;
  let done; for (let i = 0; i < 600 && !done; i++) { done = app.store.state.jobs.find(j => j.id === job.id && !['queued', 'running'].includes(j.status)); if (!done) await new Promise(r => setTimeout(r, 100)); }
  assert.equal(done.status, 'needs_review', done.error);
  assert.ok(done.evidence.before.triangles > 10000); assert.ok(done.evidence.after.triangles <= 20400 && done.evidence.after.triangles > 15000, `after ${done.evidence.after.triangles}`);
  assert.ok(done.artifacts.some(a => a.label === 'Game-ready GLB' && a.kind === 'model'));
  assert.deepEqual(fs.readFileSync(glb), original);

  // The page can send an accepted GLB on to game prep; unreviewed ones are refused.
  const model = done.artifacts.find(a => a.label === 'Game-ready GLB');
  assert.equal((await call(`/api/artifacts/${model.id}/source-path`, 'GET')).status, 409);
  assert.equal((await call(`/api/jobs/${job.id}/accept`, 'POST', {})).status, 200);
  const found = await call(`/api/artifacts/${model.id}/source-path`, 'GET'); assert.equal(found.status, 200); assert.match(found.data.path, /game-ready\.glb$/);
});
