const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config');

test('config: defaults, file overrides and environment precedence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-config-'));
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ port: 5000, blenderExe: 'X:\\b.exe', projects: { unity: 'X:\\u' } }));
  const c = loadConfig({ BONSAI_CONFIG: file, BLENDER_EXE: 'Y:\\b.exe' });
  assert.equal(c.port, 5000);
  assert.equal(c.blenderExe, 'Y:\\b.exe');
  assert.equal(c.projects.unity, 'X:\\u');
  assert.ok(c.projects.unreal, 'unspecified project keys keep their defaults');
  assert.equal(loadConfig({ BONSAI_CONFIG: path.join(dir, 'missing.json') }).port, 4176);
});

test('config: invalid files and ports fail clearly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-config-'));
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{nope');
  assert.throws(() => loadConfig({ BONSAI_CONFIG: bad }), /Invalid config/);
  assert.throws(() => loadConfig({ BONSAI_CONFIG: path.join(dir, 'none.json'), PORT: '99999' }), /port/);
});
