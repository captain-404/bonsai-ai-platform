const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { templates } = require('./catalog');
const { fail, text } = require('./validation');
const { execute } = require('./adapters');
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Resolves uploaded images and validates per-task settings against what the workflow exposes.
function comfyInputs(workflow, body, data) {
  const inputs = {}, params = {};
  for (const def of workflow?.inputs || []) {
    const given = body.inputs?.[def.id], id = String(typeof given === 'object' && given ? given.uploadId : given || '');
    if (def.optional && !id) continue;
    if (!UPLOAD_ID.test(id)) fail(`Choose an image for “${def.label}”.`);
    const file = ['png', 'jpg', 'webp'].map(ext => path.join(data, 'uploads', `${id}.${ext}`)).find(f => fs.existsSync(f));
    if (!file) fail(`The uploaded image for “${def.label}” was not found. Upload it again.`, 404);
    inputs[def.id] = { uploadId: id, file };
  }
  for (const def of workflow?.params || []) {
    let value = body.params?.[def.key] ?? def.default;
    if (value === '' || value === null || value === undefined) { params[def.key] = ''; continue; }
    if (def.type === 'select') { value = String(value); if (!def.options.includes(value)) fail(`${def.label}: choose one of ${def.options.join(', ')}.`); }
    else if (def.type === 'int' || def.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value) || (def.type === 'int' && !Number.isInteger(value))) fail(`${def.label} must be a ${def.type === 'int' ? 'whole ' : ''}number.`);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) fail(`${def.label} must be between ${def.min ?? '−∞'} and ${def.max ?? '∞'}.`);
    } else value = text(String(value), def.label, 500);
    params[def.key] = value;
  }
  return { inputs, params };
}
function createRunner(store, data, adapters = execute) {
  const { state, save, event } = store;
  let current = null, controller = null, stopping = false, onSettled = () => {};
  function submit(body, internal = {}) {
    const agent = state.agents.find(a => a.id === body.agentId && !a.archived);
    if (!agent) fail('Select an active agent.', 404);
    const adapter = templates.find(t => t.id === agent.templateId)?.adapter;
    if (!adapter) fail('Agent specialty is unavailable.');
    const prompt = text(body.prompt, 'Task', 8000, true);
    const workflow = adapter === 'comfy' ? state.workflows.find(w => w.id === (body.workflowId || agent.workflowId)) : undefined;
    if (adapter === 'comfy' && !workflow) fail('Import and select a ComfyUI workflow first.');
    const { inputs, params } = comfyInputs(workflow, body, data);
    const sourcePath = text(body.sourcePath || '', 'Source file', 1000);
    const projectPath = text(body.projectPath || agent.projectPath || '', 'Project folder', 1000);
    let action = body.action || 'inspect';
    if (!['inspect', 'cleanup', 'gameprep'].includes(action)) fail('Choose inspection, loose-geometry cleanup or game prep.');
    if (agent.templateId === 'reviewer') action = 'inspect';
    const targetTriangles = Number(body.targetTriangles ?? 60000);
    if (action === 'gameprep' && (!Number.isInteger(targetTriangles) || targetTriangles < 1000 || targetTriangles > 500000)) fail('Triangle target must be a whole number from 1,000 to 500,000.');
    if (adapter === 'blender' && (!path.isAbsolute(sourcePath) || path.extname(sourcePath).toLowerCase() !== (action === 'gameprep' ? '.glb' : '.blend') || !fs.existsSync(sourcePath))) fail(action === 'gameprep' ? 'Choose an existing absolute .glb path.' : 'Choose an existing absolute .blend path.');
    if (adapter === 'project' && (!path.isAbsolute(projectPath) || !fs.existsSync(projectPath))) fail('Choose an existing absolute project folder.');
    const job = { id: randomUUID(), agentId: agent.id, agent: structuredClone(agent), adapter, prompt, sourcePath, projectPath, action, targetTriangles, inputs, params, workflow: workflow ? structuredClone(workflow) : undefined, settings: structuredClone(state.settings), status: 'queued', createdAt: new Date().toISOString(), artifacts: [], attempts: [], retryOf: body.retryOf || null, redoOf: body.redoOf || null, redoNote: body.redoNote ? text(body.redoNote, 'Note', 2000) : undefined, basePrompt: body.basePrompt ? text(body.basePrompt, 'Task', 8000) : undefined, reseed: Number.isInteger(body.reseed) && body.reseed >= 0 ? body.reseed : undefined, flowRunId: internal.flowRunId || null };
    if (agent.model) job.settings.model = agent.model;
    state.jobs.unshift(job); event('task', `Queued task for ${agent.name}.`, job.id); setImmediate(pump); return job;
  }
  async function pump() {
    if (current || stopping) return;
    const job = state.jobs.slice().reverse().find(j => j.status === 'queued');
    if (!job) return;
    current = job; controller = new AbortController();
    job.status = 'running'; job.startedAt = new Date().toISOString();
    const attempt = { startedAt: job.startedAt, status: 'running' }; job.attempts.push(attempt);
    const agent = state.agents.find(a => a.id === job.agentId); if (agent) agent.status = 'working';
    save();
    const dir = path.join(data, 'tasks', job.id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const adapter = adapters[job.adapter] || (job.adapter === 'mcp' ? require('./mcp-agent').runMcp : null);
      if (!adapter) throw new Error('Task adapter unavailable.');
      await adapter(job, { dir, signal: controller.signal, progress(message) { if (job.progress !== message) { job.progress = message; save(); } } });
      job.status = job.cancelRequested ? 'cancelled' : job.reviewRequired ? 'needs_review' : 'succeeded';
    } catch (error) {
      job.status = stopping ? 'interrupted' : job.cancelRequested ? 'cancelled' : 'failed';
      job.error = error.name === 'AbortError' ? 'Task stopped. Review partial outputs before retrying.' : error.message;
    } finally {
      // The saved workflow copy only needs its graph while the task runs; settings and hand-off stay for the page.
      if (!['interrupted'].includes(job.status) && job.workflow?.graph) delete job.workflow.graph;
      job.completedAt = new Date().toISOString(); attempt.status = job.status; attempt.completedAt = job.completedAt;
      if (agent) agent.status = 'idle';
      event(job.status === 'failed' ? 'error' : 'task', `${job.agent.name}: ${job.status.replaceAll('_', ' ')}.`, job.id);
      current = null; controller = null;
      if (!stopping) { try { onSettled(job); } catch (error) { event('error', `Workflow handoff failed: ${error.message}`, job.id); } }
      setImmediate(pump);
    }
  }
  function cancel(id) {
    const job = state.jobs.find(j => j.id === id);
    if (!job) fail('Task not found.', 404);
    if (!['queued', 'running', 'cancelling'].includes(job.status)) fail('This task is already stopped.', 409);
    job.cancelRequested = true;
    if (job.status === 'queued') job.status = 'cancelled';
    else { job.status = 'cancelling'; if (job.adapter !== 'comfy' || !job.externalId) controller?.abort(); }
    event('task', 'Cancellation requested.', job.id);
    if (job.status === 'cancelled') onSettled(job);
    return job;
  }
  // Picks a ComfyUI job up again after a restart: the work already on the GPU is reused, never submitted twice.
  function resume(id) {
    const job = state.jobs.find(j => j.id === id);
    if (!job) fail('Task not found.', 404);
    if (job.adapter !== 'comfy' || !job.externalId || job.status !== 'interrupted') fail('Only interrupted ComfyUI tasks can be reattached.', 409);
    job.status = 'queued'; job.resume = true; delete job.error; delete job.completedAt; job.cancelRequested = false;
    event('task', 'Reattaching to the ComfyUI job.', job.id); setImmediate(pump); return job;
  }
  return { submit, cancel, resume, setSettled(callback) { onSettled = callback; }, stop() { stopping = true; controller?.abort(); }, get active() { return current; } };
}
module.exports = { createRunner };
