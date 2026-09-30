const templates = [
  ['comfy-mcp', 'ComfyUI creator', '🎨', 'mcp', 'Discover installed models and nodes, build or adapt workflows, generate images, video, audio and 3D assets. Check dependencies before generation. Wait for completion and fetch outputs. Explain missing models honestly.'],
  ['unity-mcp', 'Unity game developer', '🎮', 'mcp', 'Create complete playable games or enhance existing Unity projects. Inspect and select the target editor first. Implement gameplay, scenes, UI, assets and polish in small verified steps. Check compilation, play mode and builds. Report what is playable and what remains.'],
  ['unreal-mcp', 'Unreal game developer', '💠', 'mcp', 'Create complete playable games or enhance existing Unreal projects. Verify the target project first. Develop gameplay, levels, Blueprints, assets, lighting and polish. Validate compilation, play sessions and packaging when available. Preserve existing work and report remaining issues.'],
  ['assistant', 'Custom assistant', '✦', 'text', 'Answer the task clearly. Produce a useful, concise result.'],
  ['planner', 'Task planner', '◈', 'text', 'Turn the brief into concrete tasks, dependencies and acceptance checks.'],
  ['image', 'Image artist', '🎨', 'comfy', 'Create images using the selected ComfyUI workflow.'],
  ['video', 'Video creator', '🎬', 'comfy', 'Generate a video using the selected ComfyUI workflow.'],
  ['model', '3D generator', '🧊', 'comfy', 'Generate a 3D asset using the selected ComfyUI workflow.'],
  ['voice', 'Voice artist', '🎙️', 'comfy', 'Generate speech using the selected ComfyUI workflow.'],
  ['music', 'Music composer', '🎵', 'comfy', 'Generate music using the selected ComfyUI workflow.'],
  ['blender', 'Model polisher', '⬡', 'blender', 'Inspect a protected model copy or clean loose mesh geometry.'],
  ['reviewer', 'Model inspector', '◉', 'blender', 'Independently inspect model geometry without changing it.'],
  ['unity', 'Unity project scout', '▣', 'project', 'Inspect Unity project metadata and identify next validation steps.'],
  ['unreal', 'Unreal project scout', '◇', 'project', 'Inspect Unreal project metadata and identify next validation steps.']
].map(([id, name, icon, adapter, instructions]) => ({ id, name, icon, adapter, instructions }));
const accents = ['green', 'blue', 'violet', 'orange', 'pink'];
module.exports = { templates, accents };
