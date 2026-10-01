const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./validation');
const DAY = 86400000, TERMINAL = ['failed', 'cancelled', 'interrupted', 'declined'], KEPT_BY_DEFAULT = ['accepted', 'succeeded'];
function folderSize(dir) { let total = 0; try { for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) total += fs.statSync(path.join(e.parentPath || e.path, e.name)).size; } catch { /* folder already gone */ } return total; }
// Old finished tasks (their generated files and saved settings) and unused uploads. Anything waiting for review, queued or running is never touched.
function cleanup(store, data, options = {}) {
  const days = Number(options.days);
  if (!Number.isFinite(days) || days < 0 || days > 3650) fail('Choose how many days of history to keep (0–3650).');
  const cutoff = Date.now() - days * DAY, statuses = options.includeAccepted ? [...TERMINAL, ...KEPT_BY_DEFAULT] : TERMINAL;
  const finished = job => Date.parse(job.completedAt || job.declinedAt || job.createdAt) || 0;
  const doomed = store.state.jobs.filter(job => statuses.includes(job.status) && !job.flowRunId && finished(job) < cutoff);
  const root = path.resolve(data, 'tasks'), result = { jobs: doomed.length, bytes: 0, uploads: 0, dryRun: Boolean(options.dryRun) };
  for (const job of doomed) {
    const dir = path.resolve(root, job.id);
    if (!/^[0-9a-f-]{36}$/.test(job.id) || path.dirname(dir) !== root) continue;
    result.bytes += folderSize(dir);
    if (!options.dryRun) fs.rmSync(dir, { recursive: true, force: true });
  }
  const doomedIds = new Set(doomed.map(job => job.id));
  const keep = store.state.jobs.filter(job => !doomedIds.has(job.id));
  const used = new Set(keep.flatMap(job => Object.values(job.inputs || {}).map(input => input.uploadId)));
  const uploads = path.join(data, 'uploads');
  for (const name of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
    const file = path.join(uploads, name), id = name.replace(/\.[^.]+$/, '');
    if (used.has(id) || Date.now() - fs.statSync(file).mtimeMs < DAY) continue; // a fresh upload may still be in an open form
    result.uploads++; result.bytes += fs.statSync(file).size;
    if (!options.dryRun) fs.rmSync(file, { force: true });
  }
  if (!options.dryRun) {
    store.state.jobs = keep;
    for (const job of keep) if (!['queued', 'running', 'cancelling', 'interrupted'].includes(job.status) && job.workflow?.graph) delete job.workflow.graph;
    store.event('maintenance', `Cleared ${result.jobs} old task${result.jobs === 1 ? '' : 's'} and ${result.uploads} unused upload${result.uploads === 1 ? '' : 's'} (${(result.bytes / 1048576).toFixed(1)} MB).`);
    store.save();
  }
  return result;
}
module.exports = { cleanup };
