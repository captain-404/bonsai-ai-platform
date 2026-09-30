const { templates, accents } = require('./catalog');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, label, max = 1000, required = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  value = value.trim();
  if ((required && !value) || value.length > max) fail(`${label} must contain ${required ? '1' : '0'}–${max} characters.`);
  return value;
}
function localUrl(value) {
  let u; try { u = new URL(value); } catch { fail('Enter a valid local HTTP address.'); }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') fail('Connections must use a local HTTP address, for example http://127.0.0.1:8188.');
  return u.origin;
}
function agentInput(body, existing) {
  const template = templates.find(t => t.id === body.templateId);
  if (!template) fail('Choose a supported specialty.');
  const avatar = body.avatar || '';
  if (typeof avatar !== 'string' || avatar.length > 180000) fail('Avatar must be a PNG or WebP smaller than 130 KB.');
  if (avatar) {
    const match = avatar.match(/^data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) fail('Avatar must be a PNG or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (match[1] === 'png' ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' : bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') fail('Invalid avatar image.');
  }
  if (!accents.includes(body.accent)) fail('Choose a supported color.');
  return { name: text(body.name, 'Name', 60, true), role: text(body.role || template.name, 'Description', 180), icon: text(body.icon || template.icon, 'Icon', 20, true), avatar, accent: body.accent, templateId: template.id, instructions: text(body.instructions || template.instructions, 'Instructions', 6000, true), model: text(body.model || '', 'Model override', 500), workflowId: text(body.workflowId || '', 'Workflow', 100), projectPath: text(body.projectPath || '', 'Project folder', 1000), version: (existing?.version || 0) + 1, updatedAt: new Date().toISOString() };
}
function workflowInput(body) {
  const graph = body.graph;
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Object.keys(graph).length || Object.keys(graph).length > 300) fail('Import an API-format ComfyUI workflow with 1–300 nodes.');
  for (const [id, node] of Object.entries(graph)) {
    if (!/^\d+$/.test(id) || !node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object') fail('Workflow must be exported in ComfyUI API format.');
  }
  const promptNode = text(body.promptNode, 'Prompt node', 30, true);
  const promptInput = text(body.promptInput || 'text', 'Prompt input', 60, true);
  if (!Object.hasOwn(graph, promptNode) || !Object.hasOwn(graph[promptNode].inputs, promptInput) || typeof graph[promptNode].inputs[promptInput] !== 'string') fail('Prompt mapping must reference an existing text input.');
  const media = ['image', 'video', 'audio', 'model'];
  if (!media.includes(body.media)) fail('Choose an output type.');
  return { name: text(body.name, 'Workflow name', 100, true), graph, promptNode, promptInput, media: body.media };
}
module.exports = { fail, text, localUrl, agentInput, workflowInput };
