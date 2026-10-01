const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPresets } = require('../lib/presets');
const { checkPreset } = require('../lib/preset-check');

// A stand-in for ComfyUI's /object_info listing the node types and model files the presets use.
function fakeObjectInfo(presets, files) {
  const info = {};
  for (const p of presets) for (const node of Object.values(p.graph)) {
    const entry = info[node.class_type] ||= { input: { required: {} } };
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      if (typeof value === 'string' && /\.(safetensors|ckpt)$/.test(value)) entry.input.required[name] = [files];
      else (entry.input.required[name] ||= [[]])[0].push(String(value)); // any value another preset uses counts as an available option
    }
  }
  return info;
}

test('every shipped preset passes against a ComfyUI that has its models', () => {
  const presets = loadPresets(), files = [...new Set(presets.flatMap(p => Object.values(p.graph).flatMap(n => Object.values(n.inputs).filter(v => typeof v === 'string' && /\.(safetensors|ckpt)$/.test(v)))))];
  const info = fakeObjectInfo(presets, files);
  for (const preset of presets) assert.deepEqual(checkPreset(preset, info), [], preset.id);
});

test('a missing model file, a renamed node and a broken setting target are reported', () => {
  const preset = structuredClone(loadPresets().find(p => p.id === 'front-view')), info = fakeObjectInfo([preset], ['flux1-schnell-fp8.safetensors']);
  assert.deepEqual(checkPreset(preset, info), []);
  info.CheckpointLoaderSimple.input.required.ckpt_name = [['other.safetensors']];
  delete info.VAEDecode; preset.params[0].targets[0].node = '999';
  const problems = checkPreset(preset, info).join('\n');
  assert.match(problems, /flux1-schnell-fp8\.safetensors" is not available/); assert.match(problems, /no node type VAEDecode/); assert.match(problems, /setting seed: 999\.seed/);
});
