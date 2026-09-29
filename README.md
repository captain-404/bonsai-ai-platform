# Bonsai AI Platform

A local-first agent operations room for visualizing specialist agents, assembling reusable pipelines, and recording approvals and evidence.

## Run

Double-click `Start-BonsaiAIPlatform.cmd`, or run it from PowerShell:

```powershell
.\Start-BonsaiAIPlatform.cmd
```

It launches the local service and opens `http://127.0.0.1:4176`. If Node is already on your PATH, `node server.js` also works.

The default **Blender → Unity asset inspection** pipeline is intentionally non-destructive. It pauses at the approval step and records activity before proceeding. The Bonsai bridge invokes the existing CLI only when `C:\AI\Bonsai2\desktop\BonsaiAgentCli.py` exists; set `BONSAI_AGENT_CLI` if it lives elsewhere.

## Two-agent Blender jobs

Use **Assign Blender job** in the Command Center. It copies the selected `.blend` source into `data/model-runs/<job-id>/`, opens only that copy in Blender, then runs the agents in this order:

1. **Meshwright** inspects and repairs the active working copy.
2. **Viewport Critic** independently inspects it without editing.
3. If the reviewer returns `REASSIGN`, one bounded corrective pass returns to Meshwright. A second unresolved re-assignment stops for human review.

The original source is never opened for saving by the agent prompts. The active Blender session needs the existing BlendMCP companion enabled, and the Bonsai local model must be running.

## Safety model

- Agent capability names are visible in the registry.
- Pipeline events are persisted in `data/platform-state.json`.
- Approval steps block downstream work.
- The included workflow produces inspection evidence only; it does not edit Blender files, export assets, alter Unity projects, or auto-run code.
