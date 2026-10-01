const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { fail } = require('./validation');
const { imageInfo, panelCrops, resolveLayout } = require('./images');
const ROOT = path.resolve(__dirname, '..');
const BLENDER = require('./config').blenderExe;

async function json(url, options = {}, timeout = 10000) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Connection returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const content = await response.text();
  return content ? JSON.parse(content) : null;
}
async function health(settings) {
  const result = await Promise.allSettled([
    json(`${settings.modelUrl}/v1/models`, {}, 3500), json(`${settings.comfyUrl}/system_stats`, {}, 3500)
  ]);
  return {
    model: { status: result[0].status === 'fulfilled' ? 'ready' : 'offline', detail: result[0].status === 'fulfilled' ? 'Local model endpoint responded.' : result[0].reason.message, models: result[0].value?.data?.map(m => m.id) || [] },
    comfy: { status: result[1].status === 'fulfilled' ? 'ready' : 'offline', detail: result[1].status === 'fulfilled' ? 'ComfyUI responded. Workflow dependencies are checked before each run.' : result[1].reason.message },
    blender: { status: fs.existsSync(BLENDER) ? 'configured' : 'missing', detail: fs.existsSync(BLENDER) ? 'Executable found. Each task runs in its own background process.' : `Set BLENDER_EXE. Not found: ${BLENDER}` },
    unity: { status: 'inspection_only', detail: 'Project metadata inspection available. Editor mutations and play/build checks are not yet connected.' },
    unreal: { status: 'inspection_only', detail: 'Project metadata inspection available. Editor mutations and play/build checks are not yet connected.' }
  };
}
function registerArtifact(job, file, kind, label) {
  const bytes = fs.readFileSync(file);
  if (!bytes.length) throw new Error(`Output is empty: ${label}`);
  const artifact = { id: crypto.randomUUID(), file, name: path.basename(file), kind, label, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  job.artifacts.push(artifact); return artifact;
}
function report(job, dir, content, name = 'report.md') {
  const file = path.join(dir, name); fs.writeFileSync(file, content); registerArtifact(job, file, 'text', name); job.output = content;
}
async function runText(job, ctx) {
  ctx.progress('Local model is preparing the response.');
  const content = await require('./chat').complete(job.settings, [{ role: 'system', content: `You are ${job.agent.name}. ${job.agent.instructions}\nYou have no tools or filesystem access. Do not claim to inspect or change files. Return the requested text deliverable.` }, { role: 'user', content: job.prompt }], {}, ctx.signal);
  report(job, ctx.dir, content);
  if (content.includes('[Response reached its length limit.')) { job.reviewRequired = true; job.validation = 'Response reached its token limit. Review the partial draft.'; }
  else job.validation = 'Text response received and saved. Factual/creative quality needs your review.';
}

function runProcess(exe, args, signal, logFile) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logFile);
    const child = spawn(exe, args, { windowsHide: true, signal, timeout: 240000 });
    let tail = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); tail = (tail + chunk).slice(-3000); });
    child.once('error', error => { log.end(); reject(error); });
    child.once('close', code => { log.end(); code === 0 ? resolve(tail) : reject(new Error(`Blender stopped (${code}). ${tail.slice(-1200)}`)); });
  });
}
// Reduces a generated GLB to a game-friendly triangle count in a separate Blender process, then measures the saved file again independently.
async function runGamePrep(job, ctx) {
  const source = job.sourcePath, target = job.targetTriangles || 60000;
  if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.glb' || !fs.statSync(source).isFile()) fail('Choose an existing absolute .glb file path.');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), beforeHash = hash(source);
  const input = path.join(ctx.dir, 'input.glb'), output = path.join(ctx.dir, 'game-ready.glb'), requestFile = path.join(ctx.dir, 'request.json'), resultFile = path.join(ctx.dir, 'gameprep.json'), reviewFile = path.join(ctx.dir, 'review.json');
  fs.copyFileSync(source, input);
  const script = path.join(ROOT, 'tools', 'blender_gameprep.py'), args = ['--background', '--factory-startup', '--disable-autoexec', '--python', script, '--', requestFile];
  fs.writeFileSync(requestFile, JSON.stringify({ mode: 'prep', inputPath: input, outputPath: output, resultPath: resultFile, targetTriangles: target }));
  ctx.progress(`Reducing the model to about ${target.toLocaleString('en-US')} triangles in a separate copy.`);
  await runProcess(BLENDER, args, ctx.signal, path.join(ctx.dir, 'blender.log'));
  if (hash(source) !== beforeHash) throw new Error('Source checksum changed during the task. Stop and inspect the original.');
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (!result.ok || !fs.existsSync(output)) throw new Error('Blender did not return a game-ready file.');
  ctx.progress('Reopening the saved file for an independent check.');
  fs.writeFileSync(requestFile, JSON.stringify({ mode: 'measure', inputPath: output, resultPath: reviewFile }));
  await runProcess(BLENDER, args, ctx.signal, path.join(ctx.dir, 'review.log'));
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8')), now = review.after, was = result.before, problems = [];
  if (now.triangles > target * 1.02 && was.triangles > target) problems.push(`still ${now.triangles} triangles, above the ${target} target`);
  if (now.uvLayers < 1) problems.push('the UV layout was lost');
  if (was.images > 0 && now.images < 1) problems.push('the texture was lost');
  if (now.size.some((v, i) => Math.abs(v - was.size[i]) > Math.max(0.03 * was.size[i], 0.001))) problems.push(`the shape shrank or grew too much (size ${was.size.join(' × ')} became ${now.size.join(' × ')}); try a higher triangle target`);
  if (problems.length) throw new Error(`Game prep failed its check: ${problems.join('; ')}.`);
  job.evidence = { before: was, after: now, target }; registerArtifact(job, resultFile, 'text', 'Game prep measurements');
  registerArtifact(job, output, 'model', 'Game-ready GLB'); job.reviewRequired = true;
  job.validation = `Source checksum unchanged; ${was.triangles.toLocaleString('en-US')} to ${now.triangles.toLocaleString('en-US')} triangles, UVs and texture kept, size within 3%. Re-bake, rig and engine checks are still needed.`;
  report(job, ctx.dir, `# ${job.agent.name}\n\n${job.validation}\n\n\`\`\`json\n${JSON.stringify({ before: was, after: now }, null, 2)}\n\`\`\``);
}
async function runBlender(job, ctx) {
  if (!fs.existsSync(BLENDER)) throw new Error('Blender executable is missing. Set BLENDER_EXE before starting Bonsai.');
  if (job.action === 'gameprep') return runGamePrep(job, ctx);
  const source = job.sourcePath;
  if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.blend' || !fs.statSync(source).isFile()) fail('Choose an existing absolute .blend file path.');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const beforeHash = hash(source);
  const working = path.join(ctx.dir, 'working.blend');
  fs.copyFileSync(source, working);
  const requestFile = path.join(ctx.dir, 'request.json');
  const resultFile = path.join(ctx.dir, 'inspection.json');
  fs.writeFileSync(requestFile, JSON.stringify({ workingPath: working, resultPath: resultFile, action: job.action }));
  ctx.progress(job.action === 'cleanup' ? 'Inspecting and removing only loose vertices/edges from unrigged meshes in a separate copy.' : 'Inspecting geometry in a separate Blender process.');
  await runProcess(BLENDER, ['--background', '--factory-startup', '--disable-autoexec', working, '--python', path.join(ROOT, 'tools', 'blender_task.py'), '--', requestFile], ctx.signal, path.join(ctx.dir, 'blender.log'));
  if (hash(source) !== beforeHash) throw new Error('Source checksum changed during the task. Stop and inspect the original.');
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (!result.ok || path.resolve(result.workingPath) !== working) throw new Error('Blender did not return valid working-copy evidence.');
  job.evidence = result; registerArtifact(job, resultFile, 'text', 'Geometry measurements');
  if (result.changed) {
    // A second fresh Blender process reads the saved result without any edit operation.
    const reviewFile = path.join(ctx.dir, 'review.json');
    fs.writeFileSync(requestFile, JSON.stringify({ workingPath: working, resultPath: reviewFile, action: 'inspect' }));
    ctx.progress('Reopening the saved copy for an independent geometry check.');
    await runProcess(BLENDER, ['--background', '--factory-startup', '--disable-autoexec', working, '--python', path.join(ROOT, 'tools', 'blender_task.py'), '--', requestFile], ctx.signal, path.join(ctx.dir, 'review.log'));
    const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    if (!review.ok || JSON.stringify(review.after) !== JSON.stringify(result.after)) throw new Error('Reopened geometry does not match the saved measurements.');
    registerArtifact(job, reviewFile, 'text', 'Independent reimport check');
    job.reviewRequired = true;
  }
  registerArtifact(job, working, 'model', result.changed ? 'Polished Blender copy' : 'Inspected Blender copy');
  job.validation = result.changed ? 'Source checksum unchanged; saved copy reopened and measured. Visual and engine checks still required.' : 'Source checksum unchanged; geometry inspection complete. No modification made.';
  report(job, ctx.dir, `# ${job.agent.name}\n\n${job.validation}\n\n${result.notes.join('\n\n')}\n\n\`\`\`json\n${JSON.stringify(result.after, null, 2)}\n\`\`\``);
}
async function runProject(job, ctx) {
  const folder = job.projectPath;
  if (!path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) fail('Choose an existing absolute project folder.');
  ctx.progress('Reading project metadata. No editor changes will be made.');
  let evidence;
  if (job.agent.templateId === 'unity') {
    const version = fs.readFileSync(path.join(folder, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'Packages', 'manifest.json'), 'utf8'));
    evidence = { project: folder, engine: 'Unity', version, packages: manifest.dependencies || {} };
  } else {
    const files = fs.readdirSync(folder).filter(f => f.endsWith('.uproject'));
    if (files.length !== 1) fail('Select a folder containing exactly one .uproject file.');
    const project = JSON.parse(fs.readFileSync(path.join(folder, files[0]), 'utf8'));
    evidence = { project: folder, engine: 'Unreal', file: files[0], engineAssociation: project.EngineAssociation, modules: project.Modules || [], plugins: project.Plugins || [] };
  }
  job.evidence = evidence; job.validation = 'Project metadata read. Editor import, compilation, gameplay and rendering have not been tested.';
  report(job, ctx.dir, `# Project inspection\n\n${job.validation}\n\nRequested focus: ${job.prompt}\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n\nNext: connect the matching editor version, establish a baseline, and validate a bounded change on a project copy.`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runComfy(job, ctx) {
  const base = job.settings.comfyUrl;
  const workflow = job.workflow;
  const nodes = await json(`${base}/object_info`, {}, 20000);
  const missing = [...new Set(Object.values(workflow.graph).map(n => n.class_type))].filter(type => !Object.hasOwn(nodes, type));
  if (missing.length) throw new Error(`Missing ComfyUI nodes: ${missing.join(', ')}`);
  const graph = structuredClone(workflow.graph);
  if (workflow.promptNode && graph[workflow.promptNode]) graph[workflow.promptNode].inputs[workflow.promptInput] = job.prompt;
  const name = job.prompt.split('\n')[0].replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'asset';
  job.evidence = { ...(job.evidence || {}), assetName: name };
  const subject = String(job.params?.subject || '').trim() || job.prompt.split('\n')[0].trim();
  for (const item of (workflow.promptTemplates || []).filter(t => graph[t.node])) graph[item.node].inputs[item.input] = item.template.replaceAll('{subject}', subject).replaceAll('{prompt}', name.replace(/_+/g, ' '));
  for (const def of workflow.inputs || []) {
    const upload = job.inputs?.[def.id];
    if (!upload && def.optional) { for (const n of def.whenMissing?.drop || []) delete graph[n]; continue; }
    if (!upload) throw new Error(`No image was chosen for ${def.label}.`);
    if (def.optional) { for (const t of def.whenGiven?.set || []) graph[t.node].inputs[t.input] = t.value; for (const n of def.whenGiven?.drop || []) delete graph[n]; }
    const bytes = fs.readFileSync(upload.file), info = imageInfo(bytes);
    if (!info) throw new Error(`${def.label}: the uploaded file is not a readable PNG, JPEG or WebP image.`);
    const form = new FormData();
    form.append('image', new Blob([bytes]), `bonsai_${job.id.slice(0, 8)}_${def.id}${path.extname(upload.file)}`);
    form.append('type', 'input'); form.append('overwrite', 'true');
    ctx.progress(`Uploading ${def.label} to ComfyUI.`);
    const sent = await json(`${base}/upload/image`, { method: 'POST', body: form, signal: ctx.signal }, 120000);
    graph[def.node].inputs[def.input] = sent.subfolder ? `${sent.subfolder}/${sent.name}` : sent.name;
    if (def.kind === 'sheet') {
      const layout = job.params?.layout || 'auto', crops = panelCrops(info.width, info.height, def.panels.length, layout, job.params?.trim);
      def.panels.forEach((node, i) => { graph[node].inputs.crop_region = crops[i]; });
      job.evidence[def.id] = { width: info.width, height: info.height, layout: resolveLayout(layout, info.width, info.height, crops.length), panels: crops.length, panelSize: `${crops[0].width}x${crops[0].height}` };
    }
  }
  for (const def of workflow.params || []) {
    const value = job.params?.[def.key];
    if (value === '' || value === undefined) continue;
    for (const t of def.targets) if (graph[t.node]) graph[t.node].inputs[t.input] = value;
  }
  for (const item of (workflow.namePrefixes || []).filter(n => graph[n.node])) graph[item.node].inputs[item.input] = item.template.replace('{name}', name);
  // "Redo with a new seed": randomise every seed input unless the workflow exposes its own seed setting.
  if (job.reseed !== undefined && !(workflow.params || []).some(p => p.key === 'seed')) {
    for (const node of Object.values(graph)) for (const key of ['seed', 'noise_seed']) if (typeof node.inputs[key] === 'number') node.inputs[key] = job.reseed;
  }
  // After a Bonsai restart a job that ComfyUI still knows about is picked up again instead of being submitted twice.
  let resumed = false;
  if (job.resume && job.externalId) {
    delete job.resume;
    const known = await json(`${base}/history/${encodeURIComponent(job.externalId)}`, {}, 10000).catch(() => ({})), queue = await json(`${base}/queue`, {}, 10000).catch(() => ({}));
    resumed = Boolean(known[job.externalId]) || [...(queue.queue_running || []), ...(queue.queue_pending || [])].some(entry => entry[1] === job.externalId);
    ctx.progress(resumed ? 'Reattached to the ComfyUI job that was already running.' : 'ComfyUI no longer has the earlier job; submitting it again.');
  }
  if (!resumed) {
    job.submissionStarted = true;
    ctx.progress('Submitting the workflow. ComfyUI will validate models and inputs.');
    const submitted = await json(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: job.id }), signal: ctx.signal }, 30000);
    if (!submitted.prompt_id || (submitted.node_errors && Object.keys(submitted.node_errors).length)) throw new Error(`Workflow validation failed: ${JSON.stringify(submitted).slice(0, 1000)}`);
    job.externalId = submitted.prompt_id; ctx.progress('ComfyUI job queued. Waiting for outputs.');
  }
  let item; const startedWait = Date.now();
  for (let i = 0; i < 1800; i++) {
    const history = await json(`${base}/history/${encodeURIComponent(job.externalId)}`, {}, 10000);
    item = history[job.externalId];
    if (item?.status?.status_str === 'error') throw new Error(`ComfyUI execution failed: ${JSON.stringify(item.status.messages).slice(0, 1000)}`);
    if (item?.status?.completed) break;
    if (job.cancelRequested) {
      // Delete only our queued prompt. Running work is allowed to finish rather than interrupt a shared GPU process.
      const queue = await json(`${base}/queue`);
      if ((queue.queue_pending || []).some(entry => entry[1] === job.externalId)) {
        await json(`${base}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [job.externalId] }) });
        return;
      }
      ctx.progress('Cancellation requested. Waiting for owned ComfyUI execution to finish; shared jobs will not be interrupted.');
    }
    if (i % 5 === 4) {
      // Every ~10 s say whether ComfyUI is working on this job or it is waiting, and for how long.
      try {
        const queue = await json(`${base}/queue`, {}, 5000), waiting = (queue.queue_pending || []).findIndex(entry => entry[1] === job.externalId);
        const minutes = Math.floor((Date.now() - startedWait) / 60000), seconds = Math.floor((Date.now() - startedWait) / 1000) % 60, elapsed = `${minutes}:${String(seconds).padStart(2, '0')}`;
        ctx.progress(waiting >= 0 ? `Waiting in ComfyUI's queue (position ${waiting + 1}) · ${elapsed}` : `ComfyUI is generating · ${elapsed} elapsed`);
      } catch { /* progress is best effort */ }
    }
    await sleep(2000);
  }
  if (!item?.status?.completed) throw new Error('ComfyUI exceeded the one-hour wait limit. Inspect its queue before retrying.');
  if (job.cancelRequested) return;
  const files = Object.values(item.outputs || {}).flatMap(output => Object.values(output).flatMap(value => Array.isArray(value) ? value.filter(v => v && typeof v.filename === 'string') : []));
  if (!files.length) throw new Error('Workflow completed but exposed no downloadable files. Use a compatible save/output node.');
  // Preview nodes also report their temporary images; keep only the saved files when a workflow has some.
  const saved = files.filter(file => file.type !== 'temp');
  if (saved.length) files.splice(0, files.length, ...saved);
  for (const [index, file] of files.entries()) {
    if (index > 30) break;
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
    const response = await fetch(`${base}/view?${params}`, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Output download failed (${response.status}).`);
    const extension = path.extname(file.filename).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.wav', '.mp3', '.flac', '.ogg', '.glb', '.obj', '.stl', '.ply'].includes(extension)) continue;
    const output = path.join(ctx.dir, `output-${index}${extension}`);
    const handle = fs.openSync(output, 'w'); let total = 0;
    try {
      for await (const chunk of response.body) {
        total += chunk.length; if (total > 1024 * 1024 * 1024) throw new Error('Output exceeds the 1 GB per-file limit.');
        fs.writeSync(handle, chunk);
      }
    } finally { fs.closeSync(handle); }
    registerArtifact(job, output, workflow.media, file.filename);
  }
  if (!job.artifacts.length) throw new Error('No supported output files were received.');
  job.reviewRequired = true; job.validation = 'Files downloaded with checksums. Playback, visual quality and content need review before acceptance.';
  job.output = `${job.artifacts.length} output(s) ready for review.`;
}
module.exports = { health, registerArtifact, json, execute: { text: runText, blender: runBlender, project: runProject, comfy: runComfy } };
