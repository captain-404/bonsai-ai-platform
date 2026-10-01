// Usage: node tools/verify-presets.js [http://127.0.0.1:8188]
// Checks every preset in presets/ against the running ComfyUI and prints what is missing. Exit code 1 if anything is.
const { loadPresets } = require('../lib/presets');
const { checkPreset } = require('../lib/preset-check');
(async () => {
  const base = (process.argv[2] || process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
  let info;
  try { info = await (await fetch(`${base}/object_info`, { signal: AbortSignal.timeout(30000) })).json(); }
  catch (error) { console.error(`Could not reach ComfyUI at ${base}: ${error.message}`); process.exit(2); }
  let bad = 0;
  for (const preset of loadPresets()) {
    const problems = checkPreset(preset, info);
    console.log(`${problems.length ? 'PROBLEM' : 'ok     '}  ${preset.id}`);
    for (const line of problems) console.log(`          - ${line}`);
    bad += problems.length;
  }
  process.exit(bad ? 1 : 0);
})();
