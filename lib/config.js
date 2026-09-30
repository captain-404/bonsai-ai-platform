// Machine-specific settings live here instead of being hardcoded across the code.
// Precedence: environment variable > bonsai.config.json > built-in default.
// Copy bonsai.config.example.json to bonsai.config.json (git-ignored) to customize.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const defaults = {
  port: 4176,
  blenderExe: 'D:\\blender.exe',
  unityMcpPath: path.resolve(ROOT, '..', 'Youtube channel D. Bug', 'tools', 'unity-mcp-server', 'src', 'index.js'),
  unityBridgePort: '7890',
  unityHubPath: 'C:\\Program Files\\Unity Hub\\Unity Hub.exe',
  unityEditorRoot: 'C:\\Program Files\\Unity\\Hub\\Editor',
  projects: { unity: 'D:\\YoutubeChannel\\catmurai\\unity', unreal: 'D:\\YoutubeChannel\\catmurai-unreal' }
};
const env = {
  port: 'PORT', blenderExe: 'BLENDER_EXE', unityMcpPath: 'BONSAI_UNITY_MCP', unityBridgePort: 'BONSAI_UNITY_BRIDGE_PORT',
  unityHubPath: 'BONSAI_UNITY_HUB', unityEditorRoot: 'BONSAI_UNITY_EDITOR_ROOT'
};

function loadFile(file) {
  if (!fs.existsSync(file)) return {};
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Invalid config ${file}: ${e.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid config ${file}: expected a JSON object.`);
  return value;
}

function loadConfig(source = process.env) {
  const file = source.BONSAI_CONFIG ? path.resolve(source.BONSAI_CONFIG) : path.join(ROOT, 'bonsai.config.json');
  const fromFile = loadFile(file);
  const config = { ...defaults, ...fromFile, projects: { ...defaults.projects, ...(fromFile.projects || {}) } };
  for (const [key, name] of Object.entries(env)) if (source[name]) config[key] = source[name];
  config.port = Number(config.port);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Config port must be an integer from 1 to 65535.');
  config.unityBridgePort = String(config.unityBridgePort);
  config.configFile = file;
  return config;
}

// Loaded once; a bad config file fails at startup with a clear message rather than mid-task.
module.exports = loadConfig();
module.exports.loadConfig = loadConfig;
