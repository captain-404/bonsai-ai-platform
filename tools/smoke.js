const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { execute } = require('../lib/adapters');
async function main() {
  const dir = path.resolve('data', 'verification', 'blender-smoke'); fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'fixture.blend');
  const result = spawnSync(require('../lib/config').blenderExe, ['--background', '--factory-startup', '--disable-autoexec', '--python', path.resolve('tools/create_test_model.py'), '--', source], { windowsHide: true, timeout: 60000, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  const outputs = path.join(dir, 'outputs'); fs.mkdirSync(outputs, { recursive: true });
  const job = { agent: { name: 'Fixture inspector' }, action: 'cleanup', sourcePath: source, artifacts: [] };
  await execute.blender(job, { dir: outputs, signal: new AbortController().signal, progress: console.log });
  if (job.evidence.before[0].vertices !== 4 || job.evidence.after[0].vertices !== 3 || !job.reviewRequired) throw new Error('Cleanup verification failed.');
  console.log(JSON.stringify({ result: 'BLENDER_SMOKE_PASS', validation: job.validation, before: job.evidence.before[0], after: job.evidence.after[0], artifacts: job.artifacts.map(a => a.name) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
