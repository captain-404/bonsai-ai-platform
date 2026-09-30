const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const ROOT = path.resolve(__dirname, '..');
function configurations(settings = {}) {
  const scripts = path.join(ROOT, '.runtime', 'comfy-mcp', 'Scripts');
  return {
    comfy: { command: path.join(scripts, 'comfy-mcp.exe'), args: [], env: { COMFY_BIN: path.join(scripts, 'comfy.exe'), COMFY_LOCAL_URL: settings.comfyUrl || 'http://127.0.0.1:8188', COMFY_PROJECT: ROOT } },
    unity: { command: process.execPath, args: [process.env.BONSAI_UNITY_MCP || path.resolve(ROOT, '..', 'Youtube channel D. Bug', 'tools', 'unity-mcp-server', 'src', 'index.js')], env: { UNITY_MCP_COMPACT_TOOLS: '1', UNITY_BRIDGE_PORT: '7890', UNITY_HUB_PATH: 'C:\\Program Files\\Unity Hub\\Unity Hub.exe' } },
    unreal: { url: `${settings.unrealUrl || 'http://127.0.0.1:8000'}/mcp` }
  };
}
async function connect(kind, settings = {}, signal) {
  const config = configurations(settings)[kind];
  if (!config) throw new Error('Unknown MCP connection.');
  if (!config.url && !fs.existsSync(config.command)) throw new Error(`${kind} MCP is not installed: ${config.command}`);
  const client = new Client({ name: 'bonsai-platform', version: '0.3.0' }, { capabilities: {} });
  const transport = config.url ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { redirect: 'error' } }) : new StdioClientTransport({ ...config, cwd: ROOT, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  const close = async () => { signal?.removeEventListener('abort', abort); await client.close().catch(() => {}); };
  const abort = () => { void close(); };
  signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, { timeout: 20000, signal });
    const tools = []; const routes = new Map(); let cursor;
    do { const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 20000, signal }); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
    const session = { tools, instructions: client.getInstructions() || '', close,
      async call(name, args = {}) {
        if (!tools.some(t => t.name === name)) throw new Error(`Unknown MCP tool: ${name}`);
        signal?.throwIfAborted();
        const route = routes.get(name);
        const result = await client.callTool(route ? { name: 'call_tool', arguments: { ...route, arguments: args } } : { name, arguments: args }, undefined, { timeout: 240000, signal });
        if (kind === 'unreal' && name === 'describe_toolset') {
          for (const block of result.content || []) {
            if (block.type !== 'text') continue;
            let catalog; try { catalog = JSON.parse(block.text); } catch { continue; }
            if (!Array.isArray(catalog.tools)) continue;
            for (const tool of catalog.tools) {
              if (!tools.some(t => t.name === tool.name)) tools.push(tool);
              routes.set(tool.name, { toolset_name: catalog.name, tool_name: tool.name.slice(catalog.name.length + 1) });
            }
            // Full schemas stay available through get_tool_schema without flooding the model context.
            block.text = JSON.stringify({ toolset: catalog.name, tools: catalog.tools.map(t => ({ name: t.name, description: (t.description || '').slice(0,180) })), next: 'These tools are now available to search_tools and get_tool_schema. Execute using their full names.' });
          }
        }
        if (kind === 'unreal' && name === 'list_toolsets') for (const block of result.content || []) if (block.type === 'text') block.text = block.text.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(0,220)).join('\n');
        return result;
      }
    };
    if (kind === 'unreal') {
      const catalog = await session.call('list_toolsets');
      const names = (catalog.content || []).filter(c => c.type === 'text').flatMap(c => [...c.text.matchAll(/^- ([^:]+):/gm)].map(m => m[1]));
      // Make native toolsets searchable without spending model turns on nested discovery.
      for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i,i+4).map(toolset_name => session.call('describe_toolset', { toolset_name })));
    }
    return session;
  } catch (e) { await close(); throw new Error(`${kind} MCP: ${e.message}${stderr ? ` (${stderr.slice(-500)})` : ''}`); }
}
async function checkMcp(settings) {
  const pairs = await Promise.all(['comfy', 'unity', 'unreal'].map(async kind => {
    let session;
    try {
      session = await connect(kind, settings);
      let detail = `${session.tools.length} tools available with full access.`;
      let status = 'ready';
      if (kind === 'comfy') {
        const response = await fetch(`${settings.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3500), redirect: 'error' });
        if (!response.ok) throw new Error(`ComfyUI returned ${response.status}`);
      }
      if (kind === 'unity') {
        const result = await session.call('unity_list_instances', {});
        const content = JSON.stringify(result);
        // A running MCP process alone does not mean an editor is connected.
        if (result.isError || !/"port"\s*:|\\"port\\"\s*:/.test(content)) { status = 'editor_offline'; detail += ' No Unity editor instance detected.'; }
      }
      return [kind === 'comfy' ? 'comfyMcp' : kind, { status, detail, access: 'full', toolCount: session.tools.length }];
    } catch (error) { return [kind === 'comfy' ? 'comfyMcp' : kind, { status: 'offline', detail: error.message, access: 'full' }]; }
    finally { await session?.close(); }
  }));
  return Object.fromEntries(pairs);
}
module.exports = { connect, checkMcp, configurations };
