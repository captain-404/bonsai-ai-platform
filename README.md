# Bonsai AI Platform

A local creative workspace for personalized agents, persistent tasks, and reviewable outputs.

## Start

Install dependencies with `pnpm install`, then double-click `Start-BonsaiAIPlatform.cmd`, or run `node server.js` (Node 20+).
Open http://127.0.0.1:4176. Stop an older server before starting another copy.

## Configuration

Machine-specific paths (Blender, Unity MCP server, Unity Hub/editors, default Unity and Unreal projects) and the port live in `bonsai.config.json`. Copy `bonsai.config.example.json` to `bonsai.config.json` and edit it; the file is git-ignored. Environment variables (`PORT`, `BLENDER_EXE`, `BONSAI_UNITY_MCP`, `BONSAI_UNITY_BRIDGE_PORT`, `BONSAI_UNITY_HUB`, `BONSAI_UNITY_EDITOR_ROOT`, `BONSAI_CONFIG`) override the file. Without a file, the previous defaults apply. The launcher uses `NODE_RUNTIME`, then `node` on PATH, then Pinokio's Node.

## Create an agent

Choose **Create agent**, select a specialty, then set its name, icon or image, color and instructions. Save it and select **Assign task**. Agents can be edited, duplicated, archived and restored. A task keeps the agent configuration it started with, even if the agent is later renamed. Advanced defaults include an optional local model override.

- **Custom assistant / Task planner:** use the local model to produce text. These tasks have no tool or filesystem access.
- **Image / Video / 3D / Voice / Music:** use an imported ComfyUI workflow. Import a tested API-format JSON graph under Workflows and map its prompt node/input. Models and custom nodes must already exist in ComfyUI. Other parameters remain as exported in the graph.
- **Model polisher:** inspect a .blend copy or remove loose vertices/edges from eligible meshes. This does not perform arbitrary natural-language edits, retopology, rigging, decimation or export. Rigged, linked, shared or modified meshes are skipped for cleanup.
- **Model inspector:** inspection only, enforced in the runner. A reviewer cannot request cleanup.
- **Unity / Unreal project scout:** inspect project metadata. These scouts remain metadata-only; use the MCP developer specialists below for editor work.

## Connections

Use Connections to set the local model address/name and ComfyUI address, then check connectivity. Only local HTTP services are supported. Defaults are model port 8080 with model `bonsai2`, and ComfyUI port 8188.

Blender defaults to `D:\blender.exe`; set `BLENDER_EXE` before starting the server to override it. Each model job uses a separate background process, fixed scripts and a task-local .blend copy. Auto-execution is disabled. A changed copy is reopened in another process and measured before being offered for visual review.

## Tasks and outputs

Under **Workflows**, create a sequence of up to eight agents. Each step can use the original brief, the preceding text result, or a preceding saved Blender copy. Outputs requiring review pause the sequence; accepting them releases the next step. The included **Brief → polished draft** workflow runs real local-model tasks. Workflow runs stop safely after a server restart; automatic replay and arbitrary media uploads between steps are not implemented.

Under **Projects**, register an existing Unity or Unreal project. Bonsai identifies its version and finds a matching Unity Hub editor when available. An editor path is configuration, not proof of a live editor connection. The Inspect project action creates a metadata inspection task.

Tasks run serially to reduce resource conflicts. The task list supports cancellation and retries of stopped local tasks. ComfyUI cancellation removes only an owned queued prompt; if it is already executing, Bonsai waits for it to finish without interrupting shared work. Uncertain or interrupted ComfyUI submissions must be checked in ComfyUI before creating a replacement task.

Text results and generated artifacts appear in Output library. Image, video and audio outputs have previews; 3D files can be downloaded. Media and modified model outputs require user review. Saved checksums establish file identity, not visual quality or engine readiness.

## Persistence and migration

Existing agents and six historical Blender jobs are preserved when opening the existing data directory. Legacy timer pipeline runs are labelled demonstrations and cannot be executed as real work. The old arbitrary-code Bonsai Blender bridge is no longer called.

Data remains in `data/` by default. Set `BONSAI_DATA_DIR` to choose another runtime folder. Prefer a local folder outside cloud synchronization for sustained use. State writes use a temporary file, flush and atomic replacement, plus a previous-state backup; the first migration creates a separate pre-v2 backup. Invalid state stops startup without replacing the original. One process may own a data directory at a time. Restarted unfinished tasks become interrupted rather than silently repeating side effects.

This remains a single-machine application. SQLite migration and external-job reconciliation are tracked in IMPLEMENTATION_STATUS.md.

## Verification

- `node --test`: isolated API, storage, queue, permission and ComfyUI-protocol tests. No production model files are used.
- `node tools/smoke.js`: real Blender test using a disposable generated mesh in `data/verification/blender-smoke`. Verifies cleanup, source preservation and saved-file reopen.

See BONSAI_ENHANCEMENT_PLAN.md for the full roadmap and IMPLEMENTATION_STATUS.md for delivered features, verification evidence and remaining work.

## MCP specialists and chat (0.3)

- **Mosaic 🎨**: official ComfyUI MCP 0.10.0 with comfy-cli 1.21.0. Discovers models/nodes, saves API graphs, runs workflows, retrieves output files. Generation depends on installed weights and nodes; 3D generation has not yet been validated.
- **Pixel 🎮**: Unity MCP with all advertised tools, including script editing, C# execution, scene edits, play/build and advanced tool discovery. Default project: `D:\YoutubeChannel\catmurai\unity`.
- **Atlas 💠**: Unreal native MCP with full toolset discovery/execution at `http://127.0.0.1:8000/mcp`. Default project: `D:\YoutubeChannel\catmurai-unreal`.
- **Chat**: persistent separate conversations using the local model, without tool access.

All names, icons, instructions and project defaults remain editable. Engine editors must be open with their MCP bridges enabled. Tools execute with the local server account permissions; this is full project access, not an isolated project copy. The agent is instructed to verify the active project before edits. Tool journals and saved task outputs are downloadable. Stop does not roll back edits or guarantee cancellation of an external render/build. Automatic retries are disabled after an external call has started. Tasks have a 24-round / 40-call budget; larger games require multiple focused tasks.

The MCP runtime is ignored under `.runtime/comfy-mcp`. To recreate it on Windows, create a Python 3.10+ venv there and install `comfy-mcp==0.10.0 comfy-cli==1.21.0`. Run its `comfy.exe set-default` pointing to your ComfyUI app directory. This machine uses `D:\AI-Lab\Apps\api\comfy.git\app`; Pinokio owns startup through `C:\AI-Lab\Apps\api\comfy.git\start.js`. Unity MCP defaults to the existing sibling workspace server; override with `BONSAI_UNITY_MCP`. Unreal address is editable in Connections.

Connection checks verified 39 ComfyUI tools, 80 Unity tools (plus advanced discovery), and 824 Unreal tools indexed through its 3 discovery/dispatch entry points. These counts are entry points, not restrictions. Heavy generation and editors share the GPU with the local language model; GPU-aware scheduling remains future work.

Local inference is serialized across Q&A and text/MCP tasks. `tools/start-model.ps1` starts the configured Bonsai model with one inference slot; the previous four-slot configuration hit context errors during concurrent checks. Unreal tools are indexed before agent work and search exposes exact callable schemas. Live Unreal MCP returned the SurvivalArena level and its actors.

## Presets: the ready-made workflows
Files in `presets/` appear on the Workflows page. Add one with **Add to Bonsai**, then **Create agent** on the same card. When a preset file changes in a new version, its card shows **Update available**; the button refreshes the saved copy in place and your agents keep it.

| Preset | What it does |
| --- | --- |
| Front view · Flux schnell | Text to one front-view picture, under a minute. Hands off to the single-image 3D preset. |
| Turnaround sheet · Flux Kontext | Text (or your own front picture) to a 2×2 sheet. Needs the Kontext model file. |
| 3D asset · Pixal3D single image | One front picture to a textured GLB. Back and sides are guessed. |
| 3D asset · Pixal3D multiview | A 4-view sheet to a textured GLB. |

The hand-off button on an accepted result ("Make 3D model →") adds the next preset and creates its agent when they are missing. A GLB that is accepted also gets **Game prep →**, which opens the Model polisher with the file filled in and reduces it to a triangle target (default 60,000) in a separate Blender copy; the saved file is reopened and measured again before it is offered for review. Game prep keeps the existing UVs and texture; it does not re-bake.

### Writing a preset
A preset is one JSON file: `id`, `name`, `media` (`image` / `model` / ...), `description`, `requires` (model files, shown on the card), the ComfyUI API-format `graph`, and optional parts:

- `inputs`: pictures the task form asks for (`kind: "image"` or `"sheet"`; `optional: true` with `whenGiven` / `whenMissing` to change or drop nodes).
- `params`: settings on the form; each lists `targets` (`node` and `input` to overwrite). `local: true` marks one that the adapter handles itself.
- `promptNode` / `promptTemplates`: where the task text goes; `{subject}` and `{prompt}` are replaced.
- `namePrefixes`: output file name prefixes, `{name}` is the asset name.
- `handoff`: `{ label, presetId, match, params }`, the button shown on results whose label contains `match`.
- `agentTemplate` / `agentName`: the specialist the card creates.

Run `npm run verify:presets` (ComfyUI running) to check every preset's node types and model files against your ComfyUI before spending a long run on it. `npm test` covers the graph wiring and the task flow without ComfyUI.

## Working while ComfyUI is busy
Chat waits while ComfyUI is generating, because the local model and ComfyUI share one GPU. A running ComfyUI task shows its queue position and elapsed time; if Bonsai restarts mid-task, **Reattach to ComfyUI** on the interrupted task picks up the job ComfyUI kept instead of submitting it again. **Clear old tasks…** at the bottom of the Tasks page frees disk space from old finished tasks and unused uploads; tasks waiting for review are never touched.

