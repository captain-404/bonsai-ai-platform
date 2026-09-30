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
const PUBLIC = path.resolve(__dirname, '..', 'public');
async function readBody(req) {
  let body = ''; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 2000000) fail('Request exceeds 2 MB.', 413); body += chunk; }
  let result; try { result = JSON.parse(body || '{}'); } catch { fail('Invalid JSON body.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('Request must be an object.');
  return result;
}
function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.md': 'text/plain', '.json': 'application/json' };
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
function createApp(options = {}) {
  const data = path.resolve(options.data || process.env.BONSAI_DATA_DIR || path.resolve(__dirname, '..', 'data'));
  const store = openStore(data); const { state, event } = store;
  const runner = createRunner(store, data, options.adapters);
  const flows = createFlows(store, runner);
  const chat = require('./chat').createChat(store, options.completion);
  const token = randomBytes(24).toString('hex');
  let connections = null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) fail('Invalid host.', 403);
      const url = new URL(req.url, `http://${host}`);
      if (req.method !== 'GET') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) fail('Cross-origin requests are not allowed.', 403);
        if (req.headers['x-bonsai-token'] !== token) fail('Reload Bonsai before making changes.', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Use JSON requests.', 415);
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
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(cancel|retry|accept)$/);
      if (req.method === 'POST' && jobMatch) {
        const job = state.jobs.find(j => j.id === jobMatch[1]); if (!job) fail('Task not found.', 404);
        await readBody(req);
        if (jobMatch[2] === 'cancel') return send(res, 200, runner.cancel(job.id));
        if (jobMatch[2] === 'accept') {
          if (job.status !== 'needs_review') fail('Only outputs awaiting review can be accepted.', 409);
          job.status = 'accepted'; job.acceptedAt = new Date().toISOString(); event('review', 'User accepted the outputs.', job.id); flows.settled(job); return send(res, 200, job);
        }
        if (job.flowRunId) fail('Restart the workflow with a reviewed brief instead of retrying an individual step.', 409);
        if (!['failed', 'cancelled', 'interrupted'].includes(job.status)) fail('Only stopped tasks can be retried.', 409);
        if (job.externalId || job.submissionStarted) fail('External tool execution was attempted. Review the tool journal and editor or generation state before creating a new task.', 409);
        return send(res, 202, runner.submit({ ...job, retryOf: job.id }));
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
        return streamFile(req, res, file);
      }
      fail('Not found.', 404);
    } catch (error) { if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.message }); else res.destroy(); }
  });
  server.on('close', () => { runner.stop(); store.close(); });
  return { server, store, runner };
}
module.exports = { createApp };
