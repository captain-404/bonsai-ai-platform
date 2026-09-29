const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'platform-state.json');
const PORT = Number(process.env.PORT || 4176);
const BONSAI_CLI = process.env.BONSAI_AGENT_CLI || 'C:\\AI\\Bonsai2\\desktop\\BonsaiAgentCli.py';
const BONSAI_PYTHON = process.env.BONSAI_AGENT_PYTHON || 'C:\\AI\\Bonsai2\\desktop\\.venv\\Scripts\\python.exe';
const BLENDER_EXE = process.env.BLENDER_EXE || 'D:\\blender.exe';
const PRODUCTION_PROFILES = {
  unity_mobile_prop: { label: 'Unity mobile prop', budgets: 'LOD0 ≤ 15k, LOD1 ≤ 6k, LOD2 ≤ 2k triangles; ≤ 2 materials; 2K textures', focus: 'aggressive triangle, material, and texture efficiency' },
  unity_pc_prop: { label: 'Unity PC/console prop', budgets: 'LOD0 ≤ 65k, LOD1 ≤ 25k, LOD2 ≤ 8k triangles; ≤ 4 materials; 4K textures', focus: 'clean LOD progression and engine-friendly materials' },
  unreal_pc_prop: { label: 'Unreal PC prop', budgets: 'LOD0 ≤ 100k, LOD1 ≤ 40k, LOD2 ≤ 12k triangles; ≤ 4 materials', focus: 'silhouette preservation and LOD/collision readiness' },
  hero_asset: { label: 'Hero/cinematic asset', budgets: 'Preserve silhouette and detail; optimize hidden or redundant geometry only', focus: 'quality-first cleanup with no blind reduction' },
  animated_character: { label: 'Animated character', budgets: 'Target-budget dependent; preserve rig, weights, seams, and deformation areas', focus: 'deformation safety, material discipline, and export readiness' }
};

fs.mkdirSync(DATA, { recursive: true });

const initialState = () => ({
  agents: [
    { id: 'conductor', name: 'Conductor', role: 'Routes work and applies policy', icon: '◈', station: 'Dispatch', capabilities: ['plan', 'route', 'approve'], status: 'idle', accent: 'violet' },
    { id: 'bonsai', name: 'Bonsai', role: 'General local assistant', icon: '✦', station: 'Garden desk', capabilities: ['chat', 'summarize', 'research'], status: 'idle', accent: 'green' },
    { id: 'blender-worker', name: 'Meshwright', role: 'Blender model repair agent', icon: '⬡', station: 'Model bay', capabilities: ['inspect_scene', 'mesh_cleanup', 'repair_active_copy'], status: 'idle', accent: 'orange' },
    { id: 'blender-reviewer', name: 'Viewport Critic', role: 'Independent Blender model reviewer', icon: '◌', station: 'Review dais', capabilities: ['inspect_scene', 'topology_review', 'reassign_worker'], status: 'idle', accent: 'pink' },
    { id: 'blender-optimizer', name: 'Polyforge', role: 'Production optimization agent', icon: '◇', station: 'Optimization forge', capabilities: ['budget_analysis', 'lod_cleanup', 'material_efficiency'], status: 'idle', accent: 'orange' },
    { id: 'production-reviewer', name: 'Release Sentinel', role: 'Production-readiness reviewer', icon: '◉', station: 'Release gate', capabilities: ['profile_validation', 'engine_readiness', 'reassign_optimizer'], status: 'idle', accent: 'pink' },
    { id: 'unity', name: 'Build Scout', role: 'Unity project inspection', icon: '▣', station: 'Engine terminal', capabilities: ['inspect_project', 'inspect_editor', 'validate_import'], status: 'idle', accent: 'blue' },
    { id: 'qa', name: 'Verifier', role: 'Evidence and release checks', icon: '✓', station: 'Quality lab', capabilities: ['validate', 'report', 'archive_evidence'], status: 'idle', accent: 'pink' }
  ],
  pipelines: [
    {
      id: 'asset-inspection',
      name: 'Blender → Unity asset inspection',
      description: 'A non-destructive handoff review. Editing and exports require approval.',
      steps: [
        { id: 'brief', name: 'Capture asset brief', agentId: 'conductor', kind: 'automatic', safety: 'read-only' },
        { id: 'blender-inspect', name: 'Inspect Blender scene', agentId: 'blender-worker', kind: 'automatic', safety: 'read-only' },
        { id: 'approval', name: 'Approve any repair or export', agentId: 'conductor', kind: 'approval', safety: 'approval-required' },
        { id: 'unity-inspect', name: 'Inspect Unity target', agentId: 'unity', kind: 'automatic', safety: 'read-only' },
        { id: 'report', name: 'Produce evidence report', agentId: 'qa', kind: 'automatic', safety: 'read-only' }
      ]
    }
  ],
  runs: [],
  modelJobs: [],
  events: [{ id: randomUUID(), time: new Date().toISOString(), type: 'system', message: 'Platform initialized. All write-capable work requires approval.' }]
});

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return initialState(); }
}
let state = loadState();
function normalizeState() {
  state.modelJobs ||= [];
  const oldWorker = state.agents.find((agent) => agent.id === 'blender');
  if (oldWorker) Object.assign(oldWorker, { id: 'blender-worker', name: 'Meshwright', role: 'Blender model repair agent', station: 'Model bay', capabilities: ['inspect_scene', 'mesh_cleanup', 'repair_active_copy'] });
  if (!state.agents.some((agent) => agent.id === 'blender-reviewer')) state.agents.splice(3, 0, { id: 'blender-reviewer', name: 'Viewport Critic', role: 'Independent Blender model reviewer', icon: '◌', station: 'Review dais', capabilities: ['inspect_scene', 'topology_review', 'reassign_worker'], status: 'idle', accent: 'pink' });
  if (!state.agents.some((agent) => agent.id === 'blender-optimizer')) state.agents.splice(4, 0, { id: 'blender-optimizer', name: 'Polyforge', role: 'Production optimization agent', icon: '◇', station: 'Optimization forge', capabilities: ['budget_analysis', 'lod_cleanup', 'material_efficiency'], status: 'idle', accent: 'orange' });
  if (!state.agents.some((agent) => agent.id === 'production-reviewer')) state.agents.splice(5, 0, { id: 'production-reviewer', name: 'Release Sentinel', role: 'Production-readiness reviewer', icon: '◉', station: 'Release gate', capabilities: ['profile_validation', 'engine_readiness', 'reassign_optimizer'], status: 'idle', accent: 'pink' });
}
normalizeState();
function persist() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function event(type, message, runId) {
  const item = { id: randomUUID(), time: new Date().toISOString(), type, message, runId };
  state.events.unshift(item); state.events = state.events.slice(0, 100); persist(); return item;
}
function setAgent(agentId, status) {
  const agent = state.agents.find((item) => item.id === agentId);
  if (agent) agent.status = status;
}
function resetAgents() { state.agents.forEach((agent) => { agent.status = 'idle'; }); }
function serializableState() { return { ...state, productionProfiles: PRODUCTION_PROFILES, bonsai: { cliConfigured: fs.existsSync(BONSAI_CLI) && fs.existsSync(BONSAI_PYTHON), cliPath: BONSAI_CLI } }; }

function runPipeline(pipelineId) {
  const pipeline = state.pipelines.find((item) => item.id === pipelineId);
  if (!pipeline) return null;
  if (state.runs.some((run) => run.pipelineId === pipelineId && ['running', 'waiting_approval'].includes(run.status))) return { error: 'This pipeline already has an active run.' };
  const run = { id: randomUUID(), pipelineId, pipelineName: pipeline.name, status: 'running', startedAt: new Date().toISOString(), currentStep: 0, steps: pipeline.steps.map((step) => ({ ...step, status: 'queued' })) };
  state.runs.unshift(run); event('run', `Started “${pipeline.name}”.`, run.id); persist(); advanceRun(run.id); return run;
}

function advanceRun(runId) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run || run.status !== 'running') return;
  const step = run.steps[run.currentStep];
  if (!step) {
    run.status = 'completed'; run.completedAt = new Date().toISOString(); resetAgents(); event('success', `Completed “${run.pipelineName}”. Evidence is available in the activity log.`, run.id); persist(); return;
  }
  if (step.kind === 'approval') {
    step.status = 'waiting_approval'; run.status = 'waiting_approval'; setAgent(step.agentId, 'waiting'); event('approval', `Approval needed: ${step.name}. No editing or export has occurred.`, run.id); persist(); return;
  }
  step.status = 'running'; setAgent(step.agentId, 'working'); event('step', `${state.agents.find((a) => a.id === step.agentId)?.name || 'Agent'} is running: ${step.name}.`, run.id); persist();
  setTimeout(() => {
    step.status = 'completed'; setAgent(step.agentId, 'idle'); run.currentStep += 1; event('step', `Completed: ${step.name} (read-only evidence recorded).`, run.id); persist(); advanceRun(run.id);
  }, 900);
}

function approveRun(runId) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run || run.status !== 'waiting_approval') return null;
  const step = run.steps[run.currentStep]; step.status = 'approved'; setAgent(step.agentId, 'idle'); run.currentStep += 1; run.status = 'running'; event('approval', `Approval recorded for “${step.name}”. This demo keeps the workflow inspection-only.`, run.id); persist(); advanceRun(run.id); return run;
}

function askBonsai(prompt) {
  if (!fs.existsSync(BONSAI_CLI)) return Promise.resolve({ ok: false, error: `Bonsai Agent CLI was not found at ${BONSAI_CLI}. Set BONSAI_AGENT_CLI to enable the bridge.` });
  if (!fs.existsSync(BONSAI_PYTHON)) return Promise.resolve({ ok: false, error: `Bonsai Agent Python environment was not found at ${BONSAI_PYTHON}. Set BONSAI_AGENT_PYTHON to enable the bridge.` });
  return new Promise((resolve) => {
    const child = spawn(BONSAI_PYTHON, [BONSAI_CLI], { windowsHide: true, timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let output = ''; let error = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; });
    child.stdin.write(JSON.stringify({ prompt })); child.stdin.end();
    child.on('error', (cause) => resolve({ ok: false, error: cause.message }));
    child.on('close', (code, signal) => {
      const marker = 'BONSAI_AGENT_RESULT=';
      const line = output.split(/\r?\n/).find((item) => item.startsWith(marker));
      if (!line) {
        if (signal || child.killed) return resolve({ ok: false, error: 'Bonsai Agent timed out before completing its response. The Blender job was stopped without saving additional changes.' });
        const diagnostic = error.trim().split(/\r?\n/).filter(Boolean).at(-1);
        return resolve({ ok: false, error: diagnostic ? `Bonsai Agent ended before returning a result: ${diagnostic}` : `Bonsai Agent ended before returning a result (exit code ${code ?? 'unknown'}).` });
      }
      try {
        const result = JSON.parse(line.slice(marker.length));
        return resolve(result.ok ? { ok: true, output: result.reply || 'Bonsai completed the request.', trace: result.trace || [], evidence: result.evidence || [], debugId: result.debug_id || null } : { ok: false, error: result.message || 'Bonsai did not complete the request.', trace: result.trace || [], evidence: result.evidence || [], debugId: result.debug_id || null });
      } catch (parseError) { return resolve({ ok: false, error: `Could not parse Bonsai response: ${parseError.message}` }); }
    });
  });
}

function safeModelPath(input) {
  const candidate = path.resolve(String(input || ''));
  if (!candidate.toLowerCase().endsWith('.blend')) throw new Error('Choose an editable .blend file. The worker makes a separate copy before opening Blender.');
  if (!fs.existsSync(candidate)) throw new Error(`Model file was not found: ${candidate}`);
  return candidate;
}

function modelJobPrompt(job, reassignment) {
  const task = reassignment || job.instruction;
  if (job.mode === 'production_optimize') return `[BLENDER_JOB] You are Polyforge, a Blender production optimization agent. Work ONLY on the active protected copy at ${job.workingPath}; never modify ${job.sourcePath}. Target profile: ${job.profile.label}. Acceptance targets: ${job.profile.budgets}. Focus: ${job.profile.focus}. First inspect the active scene and measure only the relevant mesh, LOD, transform, UV, and material facts. Then make the smallest evidence-based optimization that keeps silhouette, UVs, materials, animation/rigging data, and scene intent intact. ${task}. You may save only the active working copy after a verified improvement. Never blindly decimate, remove UVs, merge materials, alter a rig, export, download, or touch unrelated objects. Use at most eight Blender tool calls. Keep each execute_blender_code argument below 4,000 characters; do not use NumPy, exhaustive nested loops, viewport operators, or API discovery. If a tool is rejected, stop using tools and report NO CHANGE. If the profile is already met, report NO CHANGE. End with exactly: STATUS: CHANGED or NO CHANGE; FINDINGS: measured evidence; SAVED: YES or NO.`;
  return `[BLENDER_JOB] You are Meshwright, the Blender model repair agent. The user explicitly authorized repair work ONLY on the active working copy at ${job.workingPath}. The original source at ${job.sourcePath} must not be changed. First inspect the active scene and target model. Then make the smallest evidence-based repair that addresses this task: ${task}. Preserve materials, UVs, and silhouette unless the task directly requires a change. You may save the active working copy after the repair. Do not export, delete source assets, download anything, or change unrelated objects. Keep this run fast: use at most eight Blender tool calls; do not use NumPy, exhaustive per-vertex/per-face nested loops, viewport operators, or API discovery. Use Blender 5.2 properties such as mesh.vertices, mesh.polygons, object.select_get(), and node.bl_idname. If no safe defect is found, report NO CHANGE rather than inventing a repair. End with a concise list of exactly what you inspected, changed, and saved.`;
}
function reviewerPrompt(job) {
  if (job.mode === 'production_optimize') return `[BLENDER_REVIEW] You are Release Sentinel, an independent production-readiness reviewer. Inspect the active protected copy at ${job.workingPath} after Polyforge's pass. Do NOT edit, save, export, or run arbitrary code. Evaluate the target profile ${job.profile.label}: ${job.profile.budgets}; focus: ${job.profile.focus}. Verify topology, triangle/LOD budgets, transforms, materials, UVs, visible silhouette preservation, and any rigging safety implied by the profile. Use at most four tool calls. After inspection, stop using tools and answer in at most 120 words using exactly these three lines: VERDICT: ACCEPT or REASSIGN; FINDINGS: concise measured evidence; REASSIGNMENT: one specific corrective instruction, or NONE.`;
  return `[BLENDER_REVIEW] You are Viewport Critic, an independent Blender model reviewer. Inspect the active working copy at ${job.workingPath} after Meshwright's repair. Do NOT edit, save, export, or run arbitrary code. Use at most four tool calls. After inspection, stop using tools and answer in at most 120 words using exactly these three lines: VERDICT: ACCEPT or REASSIGN; FINDINGS: short evidence-based findings; REASSIGNMENT: specific next repair instruction, or NONE if accepted. Task: ${job.instruction}.`;
}
function parseReview(text) {
  const verdict = /VERDICT:\s*REASSIGN/i.test(text) ? 'reassign' : /VERDICT:\s*ACCEPT/i.test(text) ? 'accepted' : 'needs_review';
  const assignment = (text.match(/REASSIGNMENT:\s*([\s\S]*?)(?:\n\S+:|$)/i)?.[1] || '').trim();
  return { verdict, assignment: assignment && assignment.toUpperCase() !== 'NONE' ? assignment : null };
}
function launchBlender(workingPath) {
  if (!fs.existsSync(BLENDER_EXE)) throw new Error(`Blender was not found at ${BLENDER_EXE}. Set BLENDER_EXE to your Blender executable.`);
  const companionStartup = path.join(ROOT, 'tools', 'enable_blendmcp.py');
  return spawn(BLENDER_EXE, [workingPath, '--python', companionStartup], { detached: true, stdio: 'ignore', windowsHide: false });
}
async function runReviewer(jobId) {
  const job = state.modelJobs.find((item) => item.id === jobId); if (!job) return;
  job.status = 'reviewing'; setAgent(job.reviewerAgentId, 'working'); event('review', `${state.agents.find((agent) => agent.id === job.reviewerAgentId)?.name || 'Reviewer'} is independently reviewing the working copy.`, job.id); persist();
  const review = await askBonsai(reviewerPrompt(job));
  setAgent(job.reviewerAgentId, 'idle'); job.reviews.push({ at: new Date().toISOString(), ...review });
  if (!review.ok) { job.status = 'failed'; job.error = review.error; event('error', `Reviewer failed: ${review.error}`, job.id); persist(); return; }
  const decision = parseReview(review.output); job.reviewDecision = decision;
  if (decision.verdict === 'reassign' && job.cycle < job.maxCycles && decision.assignment) {
    job.cycle += 1; event('reassign', `Reviewer re-assigned ${state.agents.find((agent) => agent.id === job.workerAgentId)?.name || 'worker'}: ${decision.assignment}`, job.id); persist(); return runWorker(job.id, decision.assignment);
  }
  job.status = decision.verdict === 'accepted' ? 'accepted' : 'needs_human_review'; job.completedAt = new Date().toISOString(); resetAgents(); event(job.status === 'accepted' ? 'success' : 'approval', job.status === 'accepted' ? 'Reviewer accepted the repaired working copy.' : 'Reviewer requested more work than the automatic limit allows; human review is required.', job.id); persist();
}
async function runWorker(jobId, reassignment) {
  const job = state.modelJobs.find((item) => item.id === jobId); if (!job) return;
  const workerName = state.agents.find((agent) => agent.id === job.workerAgentId)?.name || 'Worker'; job.status = reassignment ? 'reworking' : 'working'; setAgent(job.workerAgentId, 'working'); event('worker', reassignment ? `${workerName} is addressing the reviewer re-assignment.` : `${workerName} is inspecting the working copy.`, job.id); persist();
  const work = await askBonsai(modelJobPrompt(job, reassignment));
  setAgent(job.workerAgentId, 'idle'); job.workerReports.push({ at: new Date().toISOString(), reassignment: reassignment || null, ...work });
  if (!work.ok) { job.status = 'failed'; job.error = work.error; event('error', `${workerName} failed: ${work.error}`, job.id); persist(); return; }
  event('worker', `${workerName} completed its pass; handing the copy to the reviewer.`, job.id); persist(); return runReviewer(job.id);
}
function startModelJob(body) {
  const sourcePath = safeModelPath(body.sourcePath); const instruction = String(body.instruction || 'Inspect and correct the most important visible detail issue.').trim(); const mode = body.mode === 'production_optimize' ? 'production_optimize' : 'repair'; const profile = PRODUCTION_PROFILES[body.profileId] || PRODUCTION_PROFILES.unity_pc_prop;
  const id = `model-${randomUUID().slice(0, 8)}`; const outputDir = path.join(DATA, 'model-runs', id); fs.mkdirSync(outputDir, { recursive: true });
  const workingPath = path.join(outputDir, `${path.parse(sourcePath).name}-working.blend`); fs.copyFileSync(sourcePath, workingPath);
  const job = { id, sourcePath, workingPath, instruction, mode, profile, workerAgentId: mode === 'production_optimize' ? 'blender-optimizer' : 'blender-worker', reviewerAgentId: mode === 'production_optimize' ? 'production-reviewer' : 'blender-reviewer', status: 'opening_blender', createdAt: new Date().toISOString(), cycle: 0, maxCycles: 1, workerReports: [], reviews: [] };
  state.modelJobs.unshift(job); event('job', `Created a protected working copy for Blender agents: ${path.basename(workingPath)}`, id); persist();
  try { launchBlender(workingPath); event('job', 'Opened the working copy in Blender. Waiting for the MCP companion to become available.', id); persist(); setTimeout(() => { runWorker(id).catch((error) => { job.status = 'failed'; job.error = error.message; event('error', `Job failed: ${error.message}`, id); persist(); }); }, 8000); } catch (error) { job.status = 'failed'; job.error = error.message; event('error', `Could not open Blender: ${error.message}`, id); persist(); }
  return job;
}

function readBody(request) { return new Promise((resolve, reject) => { let body = ''; request.on('data', (chunk) => { body += chunk; if (body.length > 500000) request.destroy(); }); request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body.')); } }); }); }
function send(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(payload)); }
function serveFile(response, file) { const safe = path.normalize(file).startsWith(PUBLIC); if (!safe || !fs.existsSync(file)) { response.writeHead(404); response.end('Not found'); return; } const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html'; response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); fs.createReadStream(file).pipe(response); }

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, serializableState());
  if (request.method === 'POST' && url.pathname === '/api/pipelines/run') { const body = await readBody(request); const result = runPipeline(body.pipelineId); return result?.error ? send(response, 409, result) : send(response, 201, result || { error: 'Pipeline not found.' }); }
  if (request.method === 'POST' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/approve')) { const run = approveRun(url.pathname.split('/')[3]); return run ? send(response, 200, run) : send(response, 404, { error: 'Waiting run not found.' }); }
  if (request.method === 'POST' && url.pathname === '/api/agents/bonsai/ask') { const body = await readBody(request); const prompt = String(body.prompt || '').trim(); if (!prompt) return send(response, 400, { error: 'A prompt is required.' }); event('chat', 'Bonsai bridge request started.'); const result = await askBonsai(prompt); event(result.ok ? 'chat' : 'error', result.ok ? 'Bonsai bridge response received.' : `Bonsai bridge failed: ${result.error}`); return send(response, result.ok ? 200 : 502, result); }
  if (request.method === 'POST' && url.pathname === '/api/blender/jobs') { try { const body = await readBody(request); return send(response, 201, startModelJob(body)); } catch (error) { return send(response, 400, { error: error.message }); } }
  if (request.method === 'POST' && url.pathname.startsWith('/api/blender/jobs/') && url.pathname.endsWith('/retry')) {
    const job = state.modelJobs.find((item) => item.id === url.pathname.split('/')[4]);
    if (!job) return send(response, 404, { error: 'Model job not found.' });
    if (!['failed', 'needs_human_review'].includes(job.status)) return send(response, 409, { error: 'Only a stopped model job can be resumed.' });
    job.status = 'opening_blender'; delete job.error; event('job', 'Reopening this job’s protected working copy in Blender before resuming.', job.id); persist();
    try {
      launchBlender(job.workingPath);
      event('job', 'Opened the correct protected working copy. Waiting for its MCP companion to become available.', job.id); persist();
      setTimeout(() => { runWorker(job.id).catch((error) => { job.status = 'failed'; job.error = error.message; event('error', `Job failed: ${error.message}`, job.id); persist(); }); }, 8000);
    } catch (error) { job.status = 'failed'; job.error = error.message; event('error', `Could not open the protected working copy: ${error.message}`, job.id); persist(); }
    return send(response, 202, job);
  }
  if (request.method === 'POST' && url.pathname === '/api/pipelines') { const body = await readBody(request); const name = String(body.name || '').trim(); if (!name) return send(response, 400, { error: 'Pipeline name is required.' }); const pipeline = { id: `pipeline-${randomUUID().slice(0, 8)}`, name, description: String(body.description || 'Custom review pipeline.'), steps: [{ id: 'plan', name: 'Plan work', agentId: 'conductor', kind: 'automatic', safety: 'read-only' }, { id: 'review', name: 'Review evidence', agentId: 'qa', kind: 'automatic', safety: 'read-only' }] }; state.pipelines.push(pipeline); event('system', `Created pipeline “${name}”.`); persist(); return send(response, 201, pipeline); }
  if (request.method === 'GET' && url.pathname === '/') return serveFile(response, path.join(PUBLIC, 'index.html'));
  if (request.method === 'GET') return serveFile(response, path.join(PUBLIC, url.pathname));
  return send(response, 404, { error: 'Not found.' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Bonsai AI Platform running at http://127.0.0.1:${PORT}`));
