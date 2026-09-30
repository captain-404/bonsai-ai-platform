const { randomUUID } = require('node:crypto');
const { fail, text } = require('./validation');
const { templates } = require('./catalog');
function createFlows(store, runner) {
  const { state, event, save } = store;
  function definition(body) {
    if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 8) fail('A workflow needs 1–8 steps.');
    const steps = body.steps.map((step, index) => {
      const agent = state.agents.find(a => a.id === step.agentId && !a.archived);
      if (!agent) fail(`Step ${index + 1}: select an active agent.`);
      const input = step.input || 'brief';
      if (!['brief', 'previous_text', 'previous_model'].includes(input) || (index === 0 && input !== 'brief')) fail('The first step uses the brief. Later steps may use previous text or a previous Blender copy.');
      const adapter = templates.find(t => t.id === agent.templateId).adapter;
      if (input === 'previous_model' && adapter !== 'blender') fail('Previous model input is supported only by Blender specialists.');
      if (adapter === 'comfy' && !state.workflows.some(w => w.id === (step.workflowId || agent.workflowId))) fail(`Step ${index + 1}: choose a ComfyUI workflow on the agent first.`);
      return { id: randomUUID(), agentId: agent.id, name: text(step.name || agent.name, 'Step name', 100, true), instruction: text(step.instruction || 'Complete your assigned role for this brief.', 'Step instructions', 2000, true), input, action: step.action === 'cleanup' ? 'cleanup' : 'inspect' };
    });
    return { id: randomUUID(), name: text(body.name, 'Workflow name', 100, true), steps, createdAt: new Date().toISOString() };
  }
  function advance(run) {
    if (run.status !== 'running') return;
    if (run.currentStep >= run.flow.steps.length) { run.status = 'succeeded'; run.completedAt = new Date().toISOString(); event('workflow', `Workflow completed: ${run.flow.name}.`, run.id); return; }
    const step = run.flow.steps[run.currentStep];
    const previous = state.jobs.find(j => j.id === run.jobIds.at(-1));
    let prompt = `${step.instruction}\n\nUser brief:\n${run.brief}`, sourcePath = run.sourcePath;
    if (step.input === 'previous_text') {
      if (!previous?.output) throw new Error(`Step ${step.name} needs a text result from the previous step.`);
      prompt += `\n\nPrevious result (reference material):\n${previous.output.slice(0, 3000)}`;
    }
    if (step.input === 'previous_model') {
      const artifact = previous?.artifacts.find(a => a.name.endsWith('.blend'));
      if (!artifact) throw new Error(`Step ${step.name} needs a saved .blend output. Use a cleanup task that produces a copy.`);
      sourcePath = artifact.file;
    }
    const job = runner.submit({ agentId: step.agentId, prompt, sourcePath, projectPath: run.projectPath, action: step.action }, { flowRunId: run.id });
    run.jobIds.push(job.id); save();
  }
  function settled(job) {
    if (!job.flowRunId) return;
    const run = state.flowRuns.find(r => r.id === job.flowRunId);
    if (!run || !['running', 'waiting_review'].includes(run.status)) return;
    if (job.status === 'needs_review') { run.status = 'waiting_review'; event('workflow', `Review required before the next step in ${run.flow.name}.`, run.id); return; }
    if (!['succeeded', 'accepted'].includes(job.status)) { run.status = job.status === 'cancelled' ? 'cancelled' : 'failed'; run.error = job.error || `Step stopped: ${job.status}`; save(); return; }
    run.currentStep += 1; run.status = 'running';
    try { advance(run); } catch (error) { run.status = 'failed'; run.error = error.message; event('error', error.message, run.id); }
  }
  function start(id, body) {
    const flow = state.flows.find(f => f.id === id); if (!flow) fail('Workflow not found.', 404);
    const run = { id: randomUUID(), flow: structuredClone(flow), brief: text(body.brief, 'Brief', 2500, true), sourcePath: text(body.sourcePath || '', 'Source path', 1000), projectPath: text(body.projectPath || '', 'Project path', 1000), status: 'running', currentStep: 0, jobIds: [], createdAt: new Date().toISOString() };
    state.flowRuns.unshift(run);
    try { advance(run); } catch (error) { run.status = 'failed'; run.error = error.message; save(); throw error; }
    event('workflow', `Started ${flow.name}.`, run.id); return run;
  }
  function cancel(id) {
    const run = state.flowRuns.find(r => r.id === id); if (!run) fail('Workflow run not found.', 404);
    if (!['running', 'waiting_review'].includes(run.status)) fail('Workflow is already stopped.', 409);
    run.status = 'cancelled';
    const job = state.jobs.find(j => j.id === run.jobIds.at(-1));
    if (job && ['queued', 'running', 'cancelling'].includes(job.status)) runner.cancel(job.id);
    event('workflow', `Cancelled ${run.flow.name}.`, run.id); return run;
  }
  runner.setSettled(settled);
  return { definition, start, cancel, settled };
}
module.exports = { createFlows };
