# Bonsai 0.3 implementation status

Implemented 29 September 2026 against BONSAI_ENHANCEMENT_PLAN.md.

## Available now

- Agent Studio: create, edit, duplicate, archive/restore, search, custom names, icons, five accent colors, and locally resized PNG/WebP avatars.
- Optional local model override on each agent; otherwise it uses the connection default.
- Fourteen specialty templates; stable IDs and versioned configuration snapshots on tasks.
- Persistent FIFO task queue, one active task at a time, cancellation, separate retry records, interrupted-task recovery, and manual output acceptance.
- Tool-free local model adapter. Agent instructions are applied to real model requests; text results are saved as downloadable artifacts.
- ComfyUI API workflow import with prompt mapping, required-node preflight, submission, history polling, artifact retrieval, checksums and media previews. Submissions with uncertain outcomes require queue inspection before retry.
- Fixed Blender inspection and loose-geometry cleanup in isolated background processes with auto-execution disabled. Inspectors cannot request cleanup. Shared/linked/deformation-sensitive meshes are skipped. Source checksum preservation and independent reopen checks precede output review.
- Unity/Unreal project metadata inspection, with explicit limits in the UI.
- Project registry: engine/version detection, project identity validation, duplicate-root rejection, optional editor path and matching Unity Hub editor discovery.
- Ordered agent workflows with 1–8 steps, text/Blender-copy handoff, preserved run definitions, stop controls and review gates. A real starter workflow, Brief → polished draft, is included.
- Output library with image/video/audio previews and file downloads; 3D files are downloadable, not yet interactively previewed.
- Connection checks and local endpoint settings, request validation, same-origin write token, loopback binding and static/artifact path containment.
- Atomic state replacement, last-good backup, pre-migration backup, process ownership lock and fail-closed corrupt-state handling.
- Original runs, Blender reports and working copies preserved. Timer pipelines are labelled legacy demonstrations and their old execution endpoints are retired.

## Verification

- 19 automated tests pass (including MCP dispatch, specialist migration and conversation history): agent lifecycle and identity; invalid JSON; mutation token/origin; corrupt-state preservation; restart migration; writer locking; queue and cancellation; inspector write restrictions; disabled demo endpoints; ComfyUI protocol; failed adapter outcomes; workflow handoff/review gates; project registration.
- Real Blender fixture: four vertices reduced to three by removing one isolated vertex; surface triangle count remained one; original checksum unchanged; saved copy reopened and matched.
- Browser check on isolated data: created Moss QA with custom leaf icon and lavender color, then queued a real local-model task. The model returned three names and the task succeeded with a saved report.
- Browser workflow check: created and ran a two-agent Forest concept handoff. Both local-model steps succeeded; the second received the first step's text and returned the name Mossy with an explanation.
- Live ComfyUI MCP submitted a 64×64 model-free image workflow, waited for completion and downloaded the PNG. This verifies the execution/collection path, not AI media quality or 3D generation.
- Live local-model tool loop selected the Catmurai Unity editor and queried project identity/version. Browser Q&A returned a real answer. All three MCP connections report ready.

## Remaining work from the full roadmap

- SQLite migration and non-synchronized runtime storage. Version 0.2 intentionally keeps backward-compatible JSON storage with atomic replacement and backups; this is a single-machine application, not a multi-user database.
- Automatic reconciliation with external ComfyUI jobs after a process restart, GPU/VRAM-aware scheduling and streamed per-node progress.
- Tested generation presets for each installed media model, richer parameter mapping and input uploads, automated media validation, listening/visual review workflows and interactive 3D preview.
- Workflow editing/version history, branching dependencies, arbitrary media handoff/upload mapping and bounded reviewer loops. Ordered creation, execution and text/Blender-copy handoff are implemented.
- Broader Blender actions: LODs, materials, exports, rig-safe optimization, retopology and rendered before/after comparisons. Current cleanup only removes loose geometry.
- Automatic project-copy isolation and independent compile/build/play validation. Full-access Unity/Unreal MCP dispatch is now implemented; end-to-end full-game production remains unvalidated.
- Scoped project memory and transferable template bundles; project registration and per-agent model overrides are implemented.

Do not label these remaining capabilities implemented based on the existence of a specialty template. Templates describe intended use; the UI's adapter descriptions define current capabilities.

## Added 30 September 2026

Mosaic, Pixel and Atlas are seeded once without replacing user edits. Full-access MCP tool discovery and execution is bounded and journaled. Normal Q&A has saved conversations and explicit model errors. Official ComfyUI MCP is installed in an isolated runtime; the missing Pinokio launcher was repaired to use the existing D: installation. ComfyUI, Unity and Unreal are live-connected. Heavy model generation, 3D weights/workflows, complete game builds and autonomous quality verification are not certified by connection tests.

Local inference is serialized across Q&A and text/MCP tasks. `tools/start-model.ps1` starts the configured Bonsai model with one inference slot; the previous four-slot configuration hit context errors during concurrent checks. Unreal tools are indexed before agent work and search exposes exact callable schemas. Live Unreal MCP returned the SurvivalArena level and its actors.

Final live platform check: Mosaic task `e5892a8c-1ca8-4cdb-9b6d-3c389ea9d487` completed its ComfyUI workflow and fetched `01668e16_000.png`, with workflow JSON, report and complete tool journal registered in the output library. Status is needs_review by design. No diffusion weights were used in this 64x64 test. Two earlier context-error test records remain preserved. Q&A follow-up context and restart persistence were checked in the browser.
