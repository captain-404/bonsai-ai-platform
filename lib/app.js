const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { openStore } = require('./store');
const { createRunner } = require('./jobs');
const { templates, accents } = require('./catalog');
const { fail, text, localUrl, agentInput, workflowInput } = require('./validation');
const { health } = require('./adapters');
const { createFlows } = require('./flows');
const { inspectProject } = require('./projects');
const config = require('./config');
const { createFactory } = require('./factory');
const { loadPresets } = require('./presets');
const { cleanup } = require('./maintenance');
const { imageInfo } = require('./images');
const PUBLIC = path.resolve(__dirname, '..', 'public');
async function readBody(req) {
  let body = ''; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 2000000) fail('Request exceeds 2 MB.', 413); body += chunk; }
  let result; try { result = JSON.parse(body || '{}'); } catch { fail('Invalid JSON body.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Request must be an object.');
  return result;
}
function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.md': 'text/plain', '.json': 'application/json', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };
function streamFile(req, res, file, download = false) {
  const size = fs.statSync(file).size;
  const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m) { res.writeHead(416); return res.end(); }
    start = Number(m[1]); end = m[2] ? Number(m[2]) : end;
    if (start > end || end >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (!size) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}
// Mounting under a prefix (e.g. inside the Li$$vi hub at /bonsai): the UI files use root-relative URLs, so they are rewritten when served.
function normalizeBase(value) {
  if (!value || value === '/') return '';
  const base = `/${String(value).replace(/^\/+|\/+$/g, '')}`;
  if (!/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(base)) throw new Error('Invalid mount path.');
  return base;
}
function rebase(source, base) { return source.replace(/(["'`])\/(?=api\/|app\.|crops\.|theme\.|features\.|chat\.|vendor\/)/g, `$1${base}/`).replace(/href="\/"/g, `href="${base}/"`).replace('href="/#agents" hidden', 'href="/#agents"'); }
function sendText(res, body, type) { const buf = Buffer.from(body); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': buf.length, 'Cache-Control': 'no-store' }); res.end(buf); }
// Deletes a task's generated files (only inside its own folder under data/tasks) and marks it declined.
function discardFactory(data, state) {
  return function discard(job, reason) {
    if (!/^[0-9a-f-]{36}$/.test(job.id)) fail('Invalid task id.', 400);
    const root = path.resolve(data, 'tasks'), dir = path.resolve(root, job.id);
    if (path.dirname(dir) !== root) fail('Task folder is outside storage.', 403);
    let removed = 0; try { removed = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).length; } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
    job.declinedFiles = job.artifacts.map(a => a.label || a.name);
    job.artifacts = []; job.status = 'declined'; job.declinedAt = new Date().toISOString(); job.validation = `${reason} Generated results were deleted.`;
    return removed;
  };
}
function createApp(options = {}) {
  const base = normalizeBase(options.base);
  const data = path.resolve(options.data || process.env.BONSAI_DATA_DIR || path.resolve(__dirname, '..', 'data'));
  const store = openStore(data); const { state, event } = store;
  const runner = createRunner(store, data, options.adapters);
  const discard = discardFactory(data, state);
  const flows = createFlows(store, runner);
  const factory = createFactory({ factoryDir: path.resolve(options.factoryDir || config.factoryDir), hubConfig: options.hubConfig || config.hubConfig, tasksDir: path.join(data, 'tasks') });
  const chat = require('./chat').createChat(store, options.completion, () => runner?.active?.adapter === 'comfy');
  // True when the saved copy of a preset differs from the preset file shipped with this version.
  const presetOutdated = id => {
    const saved = state.workflows.find(w => w.presetId === id), preset = loadPresets().find(item => item.id === id);
    if (!saved || !preset) return false;
    const strip = w => JSON.stringify(w, (k, v) => ['id', 'createdAt', 'updatedAt'].includes(k) ? undefined : v);
    return strip(saved) !== strip(workflowInput({ ...preset, presetId: id }));
  };
  const token = randomBytes(24).toString('hex');
  let connections = null;
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self'; object-src 'none'; frame-ancestors ${base ? "'self'" : "'none'"}; base-uri 'none'; form-action 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`);
    try {
      if (base) {
        const [pathPart, query = ''] = req.url.split('?');
        if (pathPart === base) { res.writeHead(302, { Location: `${base}/` }); return res.end(); }
        if (!pathPart.startsWith(`${base}/`)) fail('Not found.', 404);
        req.url = pathPart.slice(base.length) + (query ? `?${query}` : '');
      }
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) fail('Invalid host.', 403);
      const url = new URL(req.url, `http://${host}`);
      if (req.method !== 'GET') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) fail('Cross-origin requests are not allowed.', 403);
        if (req.headers['x-bonsai-token'] !== token) fail('Reload Bonsai before making changes.', 403);
        const isUpload = url.pathname === '/api/uploads' && /^image\/(png|jpeg|webp)$/.test(req.headers['content-type'] || '');
        if (!isUpload && !req.headers['content-type']?.startsWith('application/json')) fail('Use JSON requests.', 415);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { ...state, token, templates, accents, connections, version: '0.3.0', pid: process.pid });
      if (req.method === 'POST' && url.pathname === '/api/connections/check') { const results = await Promise.all([health(state.settings),require('./mcp').checkMcp(state.settings)]); connections = {...results[0],...results[1]}; return send(res, 200, connections); }
      if (req.method === 'POST' && url.pathname === '/api/chats') { await readBody(req); return send(res,201,chat.create()); }
      const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (req.method === 'POST' && chatMatch) return send(res,200,await chat.send(chatMatch[1],await readBody(req)));
      if (req.method === 'PUT' && url.pathname === '/api/settings') {
        const body = await readBody(req);
        state.settings = { ...state.settings, modelUrl: localUrl(body.modelUrl), comfyUrl: localUrl(body.comfyUrl), unrealUrl: localUrl(body.unrealUrl || state.settings.unrealUrl), model: text(body.model, 'Model name', 500, true) };
        connections = null; event('settings', 'Connection settings updated.'); return send(res, 200, state.settings);
      }
      if (req.method === 'POST' && url.pathname === '/api/agents') {
        const agent = { id: randomUUID(), ...agentInput(await readBody(req)), createdAt: new Date().toISOString(), archived: false, status: 'idle' };
        if (agent.workflowId && !state.workflows.some(w => w.id === agent.workflowId)) fail('Workflow not found.');
        state.agents.push(agent); event('agent', `Created ${agent.name}.`); return send(res, 201, agent);
      }
      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)(?:\/(archive|restore|duplicate))?$/);
      if (agentMatch && ['PUT', 'POST'].includes(req.method)) {
        const agent = state.agents.find(a => a.id === agentMatch[1]); if (!agent) fail('Agent not found.', 404);
        const body = await readBody(req);
        if (req.method === 'PUT' && !agentMatch[2]) {
          const input = agentInput(body, agent);
          if (input.workflowId && !state.workflows.some(w => w.id === input.workflowId)) fail('Workflow not found.');
          Object.assign(agent, input);
        } else if (agentMatch[2] === 'duplicate') {
          const copy = { ...structuredClone(agent), id: randomUUID(), name: `${agent.name.slice(0, 53)} copy`, version: 1, archived: false, status: 'idle' };
          state.agents.push(copy); event('agent', `Duplicated ${agent.name}.`); return send(res, 201, copy);
        } else if (['archive', 'restore'].includes(agentMatch[2])) {
          if (state.jobs.some(j => j.agentId === agent.id && ['queued', 'running', 'cancelling'].includes(j.status))) fail('Wait for this agent’s tasks to stop before archiving.', 409);
          agent.archived = agentMatch[2] === 'archive';
        } else fail('Unknown agent action.', 404);
        event('agent', `Updated ${agent.name}.`); return send(res, 200, agent);
      }
      if (req.method === 'POST' && url.pathname === '/api/workflows') {
        const workflow = { id: randomUUID(), ...workflowInput(await readBody(req)), createdAt: new Date().toISOString() };
        state.workflows.push(workflow); event('workflow', `Imported ${workflow.name}.`); return send(res, 201, workflow);
      }
      if (req.method === 'GET' && url.pathname === '/api/presets') return send(res, 200, loadPresets().map(({ id, name, description, media, requires, agentTemplate, agentName }) => ({ id, name, description, media, requires, agentTemplate, agentName, installed: state.workflows.some(w => w.presetId === id), outdated: presetOutdated(id) })));
      if (req.method === 'POST' && url.pathname === '/api/workflows/preset') {
        const body = await readBody(req), preset = loadPresets().find(item => item.id === body.id);
        if (!preset) fail('Preset not found.', 404);
        const existing = state.workflows.find(w => w.presetId === preset.id);
        if (existing && body.update) {
          const fresh = workflowInput({ ...preset, presetId: preset.id });
          for (const key of Object.keys(existing)) if (!['id', 'createdAt'].includes(key)) delete existing[key];
          Object.assign(existing, fresh); existing.updatedAt = new Date().toISOString();
          event('workflow', `Updated ${existing.name} from its preset.`); store.save(); return send(res, 200, existing);
        }
        if (existing) return send(res, 200, existing);
        const workflow = { id: randomUUID(), ...workflowInput({ ...preset, presetId: preset.id }), createdAt: new Date().toISOString() };
        state.workflows.push(workflow); event('workflow', `Added preset ${workflow.name}.`); return send(res, 201, workflow);
      }
      if (req.method === 'POST' && url.pathname === '/api/uploads') {
        const type = req.headers['content-type'], chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 120 * 1024 * 1024) fail('Image exceeds 120 MB.', 413); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks), info = imageInfo(bytes);
        if (!info || `image/${info.type}` !== type) fail('The file is not a valid PNG, JPEG or WebP image.', 415);
        if (info.width > 32768 || info.height > 32768) fail('Image dimensions are too large.', 413);
        const id = randomUUID(), dir = path.join(data, 'uploads'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.${info.type === 'jpeg' ? 'jpg' : info.type}`), bytes);
        return send(res, 201, { id, width: info.width, height: info.height, bytes: bytes.length, type: info.type });
      }
      if (req.method === 'POST' && url.pathname === '/api/projects') {
        const project = inspectProject(await readBody(req));
        if (state.projects.some(p => p.path.toLowerCase() === project.path.toLowerCase())) fail('This project is already registered.', 409);
        state.projects.push(project); event('project', `Registered ${project.name} (${project.engine} ${project.version}).`); return send(res, 201, project);
      }
      if (req.method === 'POST' && url.pathname === '/api/flows') {
        const flow = flows.definition(await readBody(req)); state.flows.push(flow); event('workflow', `Created ${flow.name}.`); return send(res, 201, flow);
      }
      const flowMatch = url.pathname.match(/^\/api\/flows\/([^/]+)\/run$/);
      if (req.method === 'POST' && flowMatch) return send(res, 202, flows.start(flowMatch[1], await readBody(req)));
      const flowRunMatch = url.pathname.match(/^\/api\/flow-runs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && flowRunMatch) { await readBody(req); return send(res, 200, flows.cancel(flowRunMatch[1])); }
      if (req.method === 'POST' && url.pathname === '/api/jobs') return send(res, 202, runner.submit(await readBody(req)));
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(cancel|retry|resume|accept|decline|redo)$/);
      if (req.method === 'POST' && jobMatch) {
        const job = state.jobs.find(j => j.id === jobMatch[1]); if (!job) fail('Task not found.', 404);
        const body = await readBody(req);
        if (jobMatch[2] === 'cancel') return send(res, 200, runner.cancel(job.id));
        if (jobMatch[2] === 'resume') return send(res, 202, runner.resume(job.id));
        if (jobMatch[2] === 'accept') {
          if (job.status !== 'needs_review') fail('Only outputs awaiting review can be accepted.', 409);
          job.status = 'accepted'; job.acceptedAt = new Date().toISOString(); event('review', 'User accepted the outputs.', job.id); flows.settled(job); return send(res, 200, job);
        }
        if (jobMatch[2] === 'decline' || jobMatch[2] === 'redo') {
          if (job.status !== 'needs_review') fail('Only outputs awaiting review can be declined or redone.', 409);
          if (job.flowRunId) fail('This task belongs to an agent workflow. Cancel or restart the workflow instead.', 409);
        }
        if (jobMatch[2] === 'decline') {
          const reason = text(body.reason || '', 'Reason', 1000);
          const removed = discard(job, reason ? `Declined: ${reason}` : 'Declined.');
          event('review', `Declined the outputs${reason ? `: ${reason}` : ''}. Deleted ${removed} file${removed === 1 ? '' : 's'}.`, job.id); return send(res, 200, job);
        }
        if (jobMatch[2] === 'redo') {
          const note = text(body.note || '', 'Note', 2000);
          const promptBased = job.workflow ? !!job.workflow.promptNode : true;
          const base = job.basePrompt || job.prompt;
          const params = { ...(job.params || {}), ...(body.params && typeof body.params === 'object' ? body.params : {}) };
          const next = { agentId: job.agentId, prompt: note && promptBased ? `${base}\n\nRevision request: ${note}` : base, basePrompt: base, redoOf: job.id, redoNote: note || undefined, workflowId: job.workflow?.id, inputs: job.inputs, params, sourcePath: job.sourcePath, projectPath: job.projectPath, action: job.action };
          if (body.newSeed !== false) { const seed = Math.floor(Math.random() * 2 ** 31); if (job.workflow?.params?.some(p => p.key === 'seed')) params.seed = seed; else next.reseed = seed; }
          const created = runner.submit(next);
          if (body.deleteOld !== false) discard(job, note ? `Redone: ${note}` : 'Redone.'); else job.redoneAs = created.id;
          job.redoneAs = created.id; event('review', `Redo requested${note ? `: ${note}` : ''}.`, created.id); return send(res, 202, created);
        }
        if (job.flowRunId) fail('Restart the workflow with a reviewed brief instead of retrying an individual step.', 409);
        if (!['failed', 'cancelled', 'interrupted'].includes(job.status)) fail('Only stopped tasks can be retried.', 409);
        if (job.externalId || job.submissionStarted) fail('External tool execution was attempted. Review the tool journal and editor or generation state before creating a new task.', 409);
        return send(res, 202, runner.submit({ ...job, retryOf: job.id }));
      }
      if (req.method === 'POST' && url.pathname === '/api/maintenance/cleanup') { const body = await readBody(req); return send(res, 200, cleanup(store, data, { days: body.days, includeAccepted: body.includeAccepted === true, dryRun: body.dryRun === true })); }
      if (req.method === 'GET' && url.pathname === '/api/factory') return send(res, 200, factory.info());
      const exportMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/export$/);
      if (req.method === 'POST' && exportMatch) {
        const body = await readBody(req);
        const job = state.jobs.find(j => j.artifacts.some(a => a.id === exportMatch[1])); if (!job) fail('Artifact not found.', 404);
        const artifact = job.artifacts.find(a => a.id === exportMatch[1]);
        const result = factory.exportArtifact(job, artifact, body);
        if (!result.alreadyThere) { (artifact.exports ||= []).push({ path: result.path, category: result.category, character: result.character, at: new Date().toISOString() }); event('review', `Sent ${artifact.name} to the Factory (${result.category}).`, job.id); store.save(); }
        return send(res, 200, result);
      }
      const pathMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/source-path$/);
      if (req.method === 'GET' && pathMatch) {
        // Lets the page fill in the source file of a game-prep task from a generated GLB. Only accepted 3D results qualify.
        const job = state.jobs.find(j => j.artifacts.some(a => a.id === pathMatch[1])); if (!job) fail('Artifact not found.', 404);
        const artifact = job.artifacts.find(a => a.id === pathMatch[1]);
        if (!['accepted', 'succeeded'].includes(job.status)) fail('Accept the model first, then send it on.', 409);
        if (path.extname(artifact.file).toLowerCase() !== '.glb') fail('Game prep reads GLB models.', 415);
        return send(res, 200, { path: artifact.file, name: artifact.name });
      }
      const sheetMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/use-as-input$/);
      if (req.method === 'POST' && sheetMatch) {
        // Copies a generated image into the upload store so it can be the image input of another task.
        const job = state.jobs.find(j => j.artifacts.some(a => a.id === sheetMatch[1])); if (!job) fail('Artifact not found.', 404);
        const artifact = job.artifacts.find(a => a.id === sheetMatch[1]);
        if (!['accepted', 'succeeded'].includes(job.status)) fail('Accept the sheet first, then send it on.', 409);
        if (!artifact.file || !fs.existsSync(artifact.file)) fail('The file is no longer available.', 404);
        const bytes = fs.readFileSync(artifact.file), info = imageInfo(bytes);
        if (!info) fail('Only PNG, JPEG or WebP images can be sent on.', 415);
        const id = randomUUID(), dir = path.join(data, 'uploads'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.${info.type === 'jpeg' ? 'jpg' : info.type}`), bytes);
        event('review', `Sent ${artifact.name} on as an input for the next agent.`, job.id);
        return send(res, 201, { id, width: info.width, height: info.height, name: artifact.label || artifact.name, assetName: job.evidence?.assetName || '' });
      }
      const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)$/);
      if (req.method === 'GET' && artifactMatch) {
        const artifact = state.jobs.flatMap(j => j.artifacts).find(a => a.id === artifactMatch[1]);
        if (!artifact || !fs.existsSync(artifact.file)) fail('Artifact not found.', 404);
        const relative = path.relative(path.join(data, 'tasks'), fs.realpathSync(artifact.file));
        if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Artifact is outside task storage.', 403);
        return streamFile(req, res, artifact.file, url.searchParams.has('download'));
      }
      if (url.pathname.startsWith('/api/blender/') || url.pathname.startsWith('/api/pipelines') || url.pathname.startsWith('/api/runs/') || url.pathname.endsWith('/ask')) fail('Legacy execution retired. Create a task with an Agent Studio specialist.', 410);
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const filename = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
        const file = path.resolve(PUBLIC, filename); const relative = path.relative(PUBLIC, file);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail('Not found.', 404);
        if (base && /\.(html|js)$/.test(file) && !relative.startsWith('vendor')) return sendText(res, rebase(fs.readFileSync(file, 'utf8'), base), types[path.extname(file)]);
        return streamFile(req, res, file);
      }
      fail('Not found.', 404);
    } catch (error) { if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.message }); else res.destroy(); }
  };
  const server = http.createServer(handler);
  let closed = false;
  const close = () => { if (closed) return; closed = true; runner.stop(); store.close(); };
  server.on('close', close);
  return { server, handler, close, store, runner, base };
}
module.exports = { createApp };
