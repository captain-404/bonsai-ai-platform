const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { templates } = require('./catalog');

function migrate(state) {
  for (const key of ['agents', 'pipelines', 'runs', 'events']) {
    if (!Array.isArray(state[key])) throw new Error(`Invalid state: ${key} must be an array. Original file preserved.`);
  }
  state.modelJobs ||= []; state.jobs ||= []; state.workflows ||= []; state.flows ||= []; state.flowRuns ||= []; state.projects ||= [];
  state.settings ||= { modelUrl: 'http://127.0.0.1:8080', model: 'bonsai2', comfyUrl: 'http://127.0.0.1:8188' };
  state.chats ||= [];
  state.settings.unrealUrl ||= 'http://127.0.0.1:8000';
  if (!state.mcpSpecialistsAdded) {
    for (const [id, name, accent, projectPath] of [['comfy-mcp','Mosaic','pink',''],['unity-mcp','Pixel','green','D:\\YoutubeChannel\\catmurai\\unity'],['unreal-mcp','Atlas','blue','D:\\YoutubeChannel\\catmurai-unreal']]) {
      if (!state.agents.some(a => a.id === id)) state.agents.push({ id, name, templateId: id, accent, projectPath });
    }
    state.mcpSpecialistsAdded = true;
  }
  state.version = 2;
  for (const a of state.agents) {
    a.templateId ||= a.id.includes('review') || a.id === 'qa' ? 'reviewer' : a.id.includes('blender') ? 'blender' : a.id === 'unity' ? 'unity' : a.id === 'conductor' ? 'planner' : 'assistant';
    // Repair the first v2 seed mapping without overriding a user-edited specialist.
    if (a.id === 'blender-reviewer' && a.templateId === 'blender' && a.version === 1) a.templateId = 'reviewer';
    if (a.id === 'conductor' && a.templateId === 'assistant' && a.version === 1) a.templateId = 'planner';
    const t = templates.find(t => t.id === a.templateId) || templates.find(t => t.id === 'assistant');
    a.instructions ||= t.instructions; a.role ||= t.name; a.icon ||= t.icon;
    a.accent ||= 'green'; a.version ||= 1; a.archived ||= false; a.status = 'idle';
  }
  for (const p of state.pipelines) p.mode = 'demo';
  for (const r of state.runs) {
    r.mode = 'demo';
    if (r.status === 'completed') r.status = 'demo_completed';
    if (['running', 'waiting_approval'].includes(r.status)) r.status = 'interrupted';
  }
  for (const j of [...state.jobs, ...state.modelJobs]) {
    if (['queued', 'running', 'preparing', 'working', 'reviewing', 'reworking', 'opening_blender', 'cancelling'].includes(j.status)) {
      j.status = 'interrupted'; j.error = 'Service restarted. Review any existing output before retrying; work was not automatically repeated.';
    }
  }
  for (const run of state.flowRuns) {
    if (['running', 'waiting_review'].includes(run.status)) {
      run.status = 'interrupted'; run.error = 'Service restarted. Review the completed steps before starting a new workflow.';
    }
  }
  if (!state.starterFlowAdded) {
    const planner = state.agents.find(a => a.templateId === 'planner' && !a.archived);
    const writer = state.agents.find(a => a.templateId === 'assistant' && !a.archived);
    if (planner && writer) state.flows.push({ id: randomUUID(), name: 'Brief → polished draft', createdAt: new Date().toISOString(), steps: [
      { id: randomUUID(), agentId: planner.id, name: 'Shape the brief', instruction: 'Turn the brief into a concise outline. Identify the intended audience and the key points. Do not claim to use tools.', input: 'brief', action: 'inspect' },
      { id: randomUUID(), agentId: writer.id, name: 'Write the draft', instruction: 'Use the outline to write a concise finished draft that answers the original brief. Do not claim to use tools.', input: 'previous_text', action: 'inspect' }
    ] });
    state.starterFlowAdded = true;
  }
  return state;
}

function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'platform-state.json');
  const lock = path.join(dir, 'platform.lock');
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, 'utf8'));
    let live = true;
    try { process.kill(owner, 0); } catch (error) { if (error.code === 'ESRCH') live = false; }
    if (live) throw new Error('This data directory is already in use. Stop its Bonsai server first.');
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  let state;
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      state = JSON.parse(raw);
      if (state.version !== 2) fs.writeFileSync(`${file}.before-v2-${Date.now()}.bak`, raw, { flag: 'wx' });
    } else {
      state = { agents: templates.filter(t => ['assistant','planner'].includes(t.id)).map(t => ({ id: randomUUID(), name: t.id === 'assistant' ? 'Bonsai' : 'Conductor', templateId: t.id })), pipelines: [], runs: [], events: [] };
    }
    migrate(state);
  } catch (error) { fs.unlinkSync(lock); throw error; }
  function save() {
    const temp = `${file}.tmp`;
    const fd = fs.openSync(temp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
  }
  function event(type, message, jobId) {
    state.events.unshift({ id: randomUUID(), time: new Date().toISOString(), type, message, jobId });
    state.events = state.events.slice(0, 1000); save();
  }
  save();
  return { state, save, event, close() { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); } };
}
module.exports = { openStore, migrate };
