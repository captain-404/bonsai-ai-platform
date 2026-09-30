const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fail, text } = require('./validation');
const config = require('./config');
function inspectProject(body) {
  const folder = text(body.path, 'Project folder', 1000, true);
  if (!path.isAbsolute(folder) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) fail('Choose an existing absolute project folder.');
  const root = fs.realpathSync(folder);
  let engine, version, descriptor;
  const unityVersion = path.join(root, 'ProjectSettings', 'ProjectVersion.txt');
  if (fs.existsSync(unityVersion)) {
    engine = 'unity'; version = fs.readFileSync(unityVersion, 'utf8').match(/^m_EditorVersion:\s*(.+)$/m)?.[1]?.trim();
    if (!version || !fs.existsSync(path.join(root, 'Assets')) || !fs.existsSync(path.join(root, 'Packages', 'manifest.json'))) fail('Incomplete Unity project. Expected Assets, Packages and ProjectSettings.');
    descriptor = unityVersion;
  } else {
    const descriptors = fs.readdirSync(root).filter(f => f.endsWith('.uproject'));
    if (descriptors.length !== 1) fail('Choose a Unity project or a folder containing exactly one Unreal .uproject.');
    descriptor = path.join(root, descriptors[0]); const data = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    engine = 'unreal'; version = String(data.EngineAssociation || 'Unspecified');
  }
  const editorPath = text(body.editorPath || '', 'Editor executable', 1000);
  if (editorPath && (!path.isAbsolute(editorPath) || !fs.existsSync(editorPath) || !fs.statSync(editorPath).isFile() || (engine === 'unity' ? path.basename(editorPath).toLowerCase() !== 'unity.exe' : !['unrealeditor.exe', 'unrealeditor-cmd.exe'].includes(path.basename(editorPath).toLowerCase())))) fail('Select the matching Unity.exe or UnrealEditor executable.');
  let suggestedEditor = '';
  if (engine === 'unity') { const candidate = path.join(config.unityEditorRoot, version, 'Editor', 'Unity.exe'); if (fs.existsSync(candidate)) suggestedEditor = candidate; }
  return { id: randomUUID(), name: text(body.name || path.basename(root), 'Project name', 100, true), path: root, engine, version, descriptor, editorPath: editorPath || suggestedEditor, editorStatus: editorPath || suggestedEditor ? 'configured_not_connected' : 'not_configured', capabilities: ['metadata_inspection'], createdAt: new Date().toISOString() };
}
module.exports = { inspectProject };
