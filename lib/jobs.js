const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { templates } = require('./catalog');
const { fail, text } = require('./validation');
const { execute } = require('./adapters');
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
    const sourcePath = text(body.sourcePath || '', 'Source file', 1000);
    const projectPath = text(body.projectPath || agent.projectPath || '', 'Project folder', 1000);
    let action = body.action || 'inspect';
    if (!['inspect', 'cleanup'].includes(action)) fail('Choose inspection or loose-geometry cleanup.');
    if (agent.templateId === 'reviewer') action = 'inspect';
    if (adapter === 'blender' && (!path.isAbsolute(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.blend' || !fs.existsSync(sourcePath))) fail('Choose an existing absolute .blend path.');
    if (adapter === 'project' && (!path.isAbsolute(projectPath) || !fs.existsSync(projectPath))) fail('Choose an existing absolute project folder.');
    const job = { id: randomUUID(), agentId: agent.id, agent: structuredClone(agent), adapter, prompt, sourcePath, projectPath, action, workflow: workflow ? structuredClone(workflow) : undefined, settings: structuredClone(state.settings), status: 'queued', createdAt: new Date().toISOString(), artifacts: [], attempts: [], retryOf: body.retryOf || null, flowRunId: internal.flowRunId || null };
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
  return { submit, cancel, setSettled(callback) { onSettled = callback; }, stop() { stopping = true; controller?.abort(); }, get active() { return current; } };
}
module.exports = { createRunner };
