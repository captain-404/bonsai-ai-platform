// Checks a preset's graph against what a running ComfyUI reports at /object_info: every node type exists and every model or option value
// the graph picks (checkpoints, diffusion models, VAEs, LoRAs...) is in that node's list. Catches a renamed node or a missing model file
// in seconds, before a 10-minute run does.
function checkPreset(preset, objectInfo) {
  const problems = [];
  for (const [id, node] of Object.entries(preset.graph)) {
    const info = objectInfo[node.class_type];
    if (!info) { problems.push(`node ${id}: ComfyUI has no node type ${node.class_type}`); continue; }
    const inputs = { ...(info.input?.required || {}), ...(info.input?.optional || {}) };
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue; // a link to another node
      if (!Object.hasOwn(inputs, name)) { if (!name.includes('.')) problems.push(`node ${id} (${node.class_type}): no input called ${name}`); continue; }
      const options = inputs[name]?.[0];
      if (Array.isArray(options) && typeof value === 'string' && value !== '' && !options.includes(value) && !(preset.inputs || []).some(i => i.node === id && i.input === name)) {
        const label = /ckpt|lora|vae|unet|clip|model|removal/i.test(name) ? 'file ' : 'option ';
        problems.push(`node ${id} (${node.class_type}): ${label}${JSON.stringify(value)} is not available for ${name}`);
      }
    }
  }
  // Settings must point at real nodes and inputs.
  for (const param of preset.params || []) for (const t of param.targets || []) if (!preset.graph[t.node] || !Object.hasOwn(preset.graph[t.node].inputs, t.input)) problems.push(`setting ${param.key}: ${t.node}.${t.input} does not exist in the graph`);
  return problems;
}
module.exports = { checkPreset };
