# Bonsai AI Platform — assessment and enhancement plan

Assessment date: 29 September 2026. Scope: the current AI Platform checkout, its running local interface and read-only API, saved run history, and the external Bonsai CLI/agent implementation it calls. This is a development plan; application behavior was not changed.

## Recommendation

Develop Bonsai into a local creative production workspace: create a specialist, assign a task, watch its progress, inspect the output, and send an approved result to the next tool. Keep agent creation simple while making execution, project isolation, and verification explicit underneath.

The first release should combine a customizable agent creator with one reliable real workflow. Adding avatars alone will not solve the execution failures; attempting every media type and both game engines at once will make failures harder to diagnose.

## Current state and evidence

| Area | Observed state | Implication |
| --- | --- | --- |
| Application | Node HTTP server, plain browser JavaScript/CSS, no declared third-party dependencies; version 0.1.0 | Small enough to evolve incrementally without an immediate framework rewrite |
| Live service | GET /api/state returned 200; command center rendered | Dashboard is available; this does not establish tool readiness |
| Agents | Eight seeded agent records with names, Unicode icons, roles, stations, capabilities and status | Registry is display-only; no create/edit/archive agent endpoint or UI |
| Pipelines | One saved pipeline and one completed run | advanceRun uses 900 ms timers rather than executing inspection tools; completed status is demo evidence, not a verified Blender/Unity inspection |
| Pipeline creation | Name and description produce two fixed steps | No editable steps, input/output mappings, selection/run control for arbitrary pipelines, or branching |
| Blender | Copies a .blend file, launches Blender, calls the external CLI, then a reviewer; permits one automatic corrective cycle | Real execution path exists, but no accepted job is recorded in this snapshot |
| Saved Blender history | Six jobs: five failed, one needs_human_review | Failures include Python launch issues, malformed tool arguments, and response limits; retries are included within these jobs |
| External bridge | C:\AI\Bonsai2\desktop\BonsaiAgentCli.py delegates to BonsaiAgent.py | Core orchestration/policy dependencies exist outside this repository |
| Unity | External bridge contains a conditional read-only Unity MCP allowlist | Some inspection plumbing exists; game editing and end-to-end Unity validation were not verified |
| ComfyUI / Unreal | No platform adapters found | Media generation and Unreal game polishing need new integration work |
| Verification | Both JavaScript files pass syntax checks; node --test reports zero tests | No automated regression coverage. npm was unavailable on PATH; the equivalent test command was run directly |

The CLI, its Python executable and configured Blender executable exist. The dashboard's “bridge configured” label checks file existence, not model responsiveness, editor identity, or tool health. No generation, model repair, engine edit, or model inference was started for this assessment.

## Problems to address first

1. **Truthful completion and readiness.** Label the timer pipeline as a demonstration until replaced. Never mark an inspection complete without tool results and required evidence. Separate configured, reachable, ready, busy, and failed connection states.
2. **Bind every job to the correct editor and file.** startModelJob waits eight seconds, then assumes the shared Blender connection is ready. Verify process/session identity and active file against the job's working copy before every write. Serialize access to a shared editor. Fail closed on a mismatch.
3. **Enforce reviewer permissions.** BonsaiAgent.py registers CORE_BLENDER_TOOLS, including execute_blender_code, for reviewer runs as well as workers. Reviewer restrictions are currently prompt-based. Give reviewers structured inspection/render tools without arbitrary code or save access. Copy protection also needs enforcement beyond a prompt.
4. **Recover durable work.** In-memory timers and asynchronous jobs have no startup reconciliation, persisted queue, cancellation, or resource ownership. A restart can leave a run marked active with nothing executing. resetAgents also resets all agents rather than just the completed job's participants.
5. **Protect history and validate requests.** JSON is overwritten synchronously; loadState silently falls back to initial state after any read/parse failure. Preserve corrupt files, add migrations/backups and transactional storage. Add request schemas, bounded bodies, consistent async error handling, correct status codes, and path containment checks.
6. **Clarify UI behavior.** The map assumes eight fixed stations; new agents would not naturally appear. The main run action selects the first pipeline. Full rerendering every 1.5 seconds can disrupt open report details; changing the target profile overwrites the assignment text. Replace these assumptions before adding customization.
7. **Correct documentation.** README safety statements describe inspection-only behavior while the separate Blender job path allows repair/save to a copy. Explain actual modes and their boundaries accurately.

## Agent creation experience

Put **+ Create agent** beside **New task**, visible from both Home and Agents.

1. **Choose a specialty:** Image Artist, Video Creator, 3D Generator, Voice Artist, Music Composer, Blender Model Polisher, Unity Developer, Unreal Developer, Reviewer, or Custom.
2. **Personalize:** name, emoji or built-in icon, accent color, optional uploaded PNG/WebP avatar, and a one-sentence description. Show a live card preview.
3. **Describe its job:** editable default instructions, expected deliverables and quality requirements. Templates provide useful defaults; advanced model/tool settings stay collapsed.
4. **Connect tools and project:** choose an installed connection, permitted project/output folder, and workflow preset. If a dependency is unavailable, allow saving a draft with a clear setup action.
5. **Test and save:** run an inexpensive connection/inspection test, then an optional small sample task. Distinguish a configured agent from one that has passed a real task.

Support edit, duplicate, archive/restore, search, tags, favorite agents, and template import/export. Agent names must be presentation fields: changing a name or icon must never break a workflow. Use stable IDs; preserve an agent configuration snapshot on each run. Validate and resize avatar uploads, limit file size, and avoid executable image formats.

An agent is a reusable configuration, not a permanently running process. It combines purpose, model/provider, allowed tools, project scope, defaults, and output requirements. Several agents may share one local model; queue their actual resource usage.

Example: “Moss” with a leaf icon uses an Image Artist template, a selected ComfyUI preset, a chosen output folder and a review checklist. The user assigns “make three forest concepts,” sees previews, and chooses one for a later video or 3D task.

## Product structure

| Screen | Main purpose |
| --- | --- |
| Home | Create agent, assign task, resume blocked work, recent outputs; optional Garden District overview |
| Agents | Personalized specialist cards, capabilities, readiness, edit/duplicate/archive |
| Tasks | Queue, live progress, cancel/retry, reports, errors, approvals and full history |
| Workflows | Start with ordered steps and input/output mapping; add a visual graph after the runner is stable |
| Library | Image/video/audio playback, 3D preview, versions, comparisons, source workflow, validation and handoff |
| Connections | Model, ComfyUI, Blender, Unity and Unreal health, versions, selected instances and setup diagnostics |
| Projects | Project root, engine/version, source/output locations, budgets and project-specific instructions |

Use structured forms and sensible defaults for common tasks. Preserve natural-language assignment as an input, but translate it into reviewable parameters and constrained actions. Routine work inside a previously authorized working area should not repeatedly ask for approval; integration into a source project should show the concrete changed files and validation first.

## Architecture

Keep the current local web application initially. Extract server.js into agent, job, workflow, artifact, connection, policy and persistence modules; split the browser code along those same screens. A frontend framework can be considered later if UI complexity warrants it.

Use SQLite for transactional metadata, with backups and a one-time import of platform-state.json that preserves IDs, timestamps, reports and original data. Keep large media files outside the database and reference them with checksums. Place the active database outside cloud-synchronized storage; keep source code and exported backups separately. Do not move existing project data until the migration has been verified.

Core records: Agent, AgentVersion, Connection, Project, WorkflowVersion, Run, StepAttempt, Artifact, ValidationResult and Approval. Persist selected engine versions, model/workflow identifiers, parameters, seeds, tool versions and input/output hashes for reproducibility.

Use a durable worker queue with explicit states: queued, preparing, running, reviewing, awaiting_user, succeeded, failed, cancelled and interrupted. Record each retry as an attempt. On restart, reconcile external job IDs and processes; do not blindly repeat edits or submit duplicate generations. Add bounded retries, timeouts, cancellation acknowledgement, and leases/locks for each editor, project and GPU.

Stream job updates to the browser; keep a read-only snapshot endpoint for reconnects. A job response should return quickly with an ID while work continues separately. Preserve structured evidence even if the model fails to write a final answer.

Each tool adapter should expose health/capabilities, validate-input, submit/execute, status, cancel and collect-artifacts operations. Resolve permissions server-side from the saved configuration; never grant tools simply because model output requests them. Retain loopback binding and add local session authentication plus Host/Origin validation for write endpoints.

## Media generation through ComfyUI

Build one ComfyUI adapter, then add tested workflow presets for individual media types. Use API-format workflow definitions with a small exposed parameter form: prompt, source files, dimensions, duration, seed and quality preset. Agents select and fill approved workflows; arbitrary generated graphs are an advanced future feature.

The official server supports submission through /prompt, progress over /ws, queue/history inspection and node discovery through /object_info. Use the returned prompt_id for reconciliation and artifact provenance. Validate required custom nodes and models before submitting; do not assume every ComfyUI installation supports video, 3D, speech or music. [ComfyUI server API](https://docs.comfy.org/development/comfyui-server/comms_routes)

Start with one image preset and prove the whole lifecycle. Then introduce short video, voice/music and 3D presets individually, based on installed models and measured hardware limits. Add a GPU scheduler so local inference, generation, rendering and editors do not compete uncontrolled. Estimate resource needs from measurements; use small previews before expensive full runs. Cancellation must only affect Bonsai-owned work: ComfyUI's current-work interruption needs ownership checks, especially on a shared instance.

| Output | Required evidence before success |
| --- | --- |
| Images | Decodable file, requested dimensions, preview and prompt/workflow provenance |
| Video | Playable file, expected duration/frame rate, sampled frames, motion and audio-sync review where applicable |
| Voice | Playable audio, expected content, pronunciation check, duration and clipping check |
| Music | Playable audio, duration, clipping/loudness checks and listening review |
| 3D | Successful reimport, material/texture integrity, topology/bounds checks and rendered views; rig/animation checks only when required |

Keep a generic job/artifact contract so specialized tools can be added when a modality is better supported outside ComfyUI.

## Model and game polishing

**Blender:** replace improvised long Python snippets for routine operations with small tested actions: inspect mesh, check UVs/materials, compute budgets, create LODs, render comparison views, export and reimport. Snapshot before edits and use independent measured checks plus visual review. Protect rigs, weights, shape keys, silhouette and materials according to the asset's brief. Reviewer acceptance alone is insufficient proof of a valid export.

**Unity:** reuse the existing read-only bridge after verifying its target-project identity and compatible companion. Add narrowly scoped editor actions for import settings, materials, prefabs, LODs, colliders and scene adjustments. Use Editor APIs or a verified bridge for mutations. Batch editor methods can support repeatable import/build checks. [Unity command-line reference](https://docs.unity3d.com/6000.0/Documentation/Manual/EditorCommandLineArguments.html)

**Unreal:** create a separate adapter with explicit project, engine version and editor session selection. Use verified project-specific editor automation for imports, materials, LODs, collision and scene changes. Python automation is editor-side; gameplay/runtime checks require separate play/build validation. [Unreal editor Python](https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python)

For either engine, “polish my game” must become a bounded task with a baseline and measurable outcome: repair material import, fix a named UI problem, improve a scene's lighting, or reduce frame time in a specified scenario. Work in a project copy or isolated version-control checkout, preserve a rollback point, and present a change summary with before/after captures. Validate compilation, import, relevant tests, a build where appropriate, and actual rendering/play behavior. Source checks or an empty error log alone do not prove a playable result.

Add deeper gameplay coding, animation retargeting and performance optimization only after safe asset and scene tasks are repeatable. Keep project requirements and engine differences explicit; avoid treating a Unity budget label as proof of Unity import readiness.

## Delivery sequence and release gates

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0 — Execution foundation | Honest demo labels, health checks, error handling, durable job/attempt records, editor/file locking, enforced reviewer tools | Restart and failed-tool tests preserve state; wrong-session writes are rejected; no false success |
| 1 — Agent Studio | Create/edit/duplicate/archive agents; names, icons, colors, templates, project/tool scope; dynamic cards | A user creates and runs a specialist without editing code; rename/restart preserve links and history; unavailable connectors show draft state |
| 2 — First media workflow | ComfyUI image adapter, one validated preset, queue/cancel/reconnect, artifact previews | Prompt to viewable image works; missing model/node fails clearly; reconnect does not duplicate generation |
| 3 — 3D polishing | Reliable Blender actions, working-copy isolation, independent validation, export/reimport | One fixture asset is safely improved and exported with source unchanged, measurable checks and before/after views |
| 4 — Engine handoff | Unity first or Unreal first according to the selected pilot project, then the second adapter | Import and one bounded scene/asset polish task pass engine validation and visual/runtime review; rollback demonstrated |
| 5 — More media and reusable chains | Individually validated video, voice, music and 3D-generation presets; workflow step mapping | Each modality produces a playable/viewable artifact; a chained run resumes without duplicating completed work |
| 6 — Game polish workflows | Project-aware coding, optimization and animation tasks with controlled reviewer loops | Representative game task passes compilation, play/build checks and agreed quality/performance targets |

Phases 2 and 3 can be reordered if model polishing is the immediate priority. Phase 0 is a prerequisite for unattended execution. Agent UI work can begin early, but should ship with real readiness and job states.

## First implementation backlog

1. Add isolated test fixtures and configurable data/runtime paths; never test against the current six jobs or source models.
2. Separate demo workflows from real tasks and correct capability/readiness labels.
3. Extract the agent registry with stable IDs, validation and configuration versions; remove hard-coded name/station dependencies.
4. Build the agent creation/edit form with built-in icons, emoji, colors and templates; add validated image avatars next.
5. Extract the job runner, add persistence/recovery, editor ownership and cancellable attempts.
6. Tighten the external bridge contract so reviewer and worker tool permissions are actually different; add structured result schemas.
7. Deliver one reliable Blender inspection/repair/review fixture and one tiny ComfyUI image workflow before expanding integrations.

Meaningful regression coverage should include: agent rename preserving workflow references; invalid requests not crashing the service; corrupt state preservation; restart during a run; simultaneous jobs targeting one editor; reviewer write denial; cancellation and duplicate-submission prevention; artifact validation rejecting missing/broken outputs. Use connector contract tests plus small real-tool acceptance runs.

## Decisions to resolve during implementation

- Confirm installed ComfyUI location, nodes, models and GPU limits before selecting generation presets.
- Select one Unity or Unreal pilot project and its exact editor version for the first engine integration.
- Decide whether the external Bonsai runtime becomes a versioned package dependency or a separately maintained service; do not silently copy or modify it.
- Benchmark the local model on short structured planning/tool tasks. Allow model/provider selection per agent later, with cloud use explicitly configured rather than silently substituting it.

The release target is concrete: a user can create a named, visually personalized specialist, assign a task, receive a verified artifact, and hand it to another specialist without manually managing scripts or losing control of project changes.
