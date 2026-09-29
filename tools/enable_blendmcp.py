import bpy
import traceback
from pathlib import Path

log = Path(r"C:\Users\Paran\OneDrive\Documents\ChatGPT\AI Platform\data\blendmcp-startup.log")
try:
    bpy.ops.preferences.addon_enable(module="blendmcp_addon")
    result = bpy.ops.blendermcp.start_server()
    message = f"BlendMCP start result={result}, running={bpy.context.scene.blendermcp_server_running}, port={bpy.context.scene.blendermcp_port}"
except Exception:
    message = traceback.format_exc()
print(message)
log.write_text(message, encoding="utf-8")
