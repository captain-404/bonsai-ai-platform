const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pendingInput=null;let presets=[];let state, view = 'home', avatar = '', polling = false, factory = { characters: [] };
const exportable = { image: ['png','jpg','jpeg','webp','gif'], video: ['mp4','webm','mov','mkv'], audio: ['wav','mp3','flac','ogg'], model: ['glb','gltf','fbx','obj','blend'] };
const labels = {home:'Overview',agents:'Agent Studio',tasks:'Tasks',library:'Output library',workflows:'Workflows',connections:'Connections',history:'History'};
const field = (form, name) => form.elements.namedItem(name);
const pretty = value => String(value || '').replaceAll('_',' ');
async function api(url, method='GET', body) {
  const res = await fetch(url,{method,headers:{'Content-Type':'application/json',...(state?.token ? {'X-Bonsai-Token':state.token} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {})});
  const data = await res.json(); if(!res.ok) throw new Error(data.error || 'Request failed.'); return data;
}
function notify(message) { $('#notice').textContent=message; $('#notice').hidden=false; }
function icon(a) { return `<div class="avatar ${esc(a.accent)}">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : esc(a.icon)}</div>`; }
function template(a) { return state.templates.find(t=>t.id===a.templateId); }
function readiness(a) {
  if(a.archived) return 'Archived';
  const t=template(a); if(t?.adapter==='comfy'&&!state.workflows.some(w=>w.id===a.workflowId)) return 'Choose a workflow';
  if(t?.adapter==='project') return 'Metadata inspection';
  if(t?.adapter==='blender') return 'Fixed model operations';
  const key=t?.adapter==='mcp'?(a.templateId==='comfy-mcp'?'comfyMcp':a.templateId.split('-')[0]):t?.adapter==='text'?'model':'comfy'; const status=state.connections?.[key]?.status; return status==='ready'?'Connected':status==='offline'?'Connection offline':'Connection unchecked';
}
function agentCard(a) { return `<article class="card"><div class="card-top">${icon(a)}<div><h3>${esc(a.name)}</h3><span class="badge">${esc(template(a)?.name)}</span></div></div><p class="description">${esc(a.role)}</p><span class="badge">${esc(a.status==='working'?'Working':readiness(a))}</span><div class="actions">${!a.archived?`<button class="primary" data-action="assign" data-id="${a.id}">Assign task</button>`:''}<button data-action="edit-agent" data-id="${a.id}">Edit</button><button data-action="duplicate" data-id="${a.id}">Duplicate</button><button data-action="${a.archived?'restore':'archive'}" data-id="${a.id}">${a.archived?'Restore':'Archive'}</button></div></article>`; }
const empty = message => `<div class="empty">${message}</div>`;
function taskCard(j) { return `<article class="task-card"><div class="task-head"><div><h3>${esc(j.agent.name)}</h3><span class="meta">${esc(new Date(j.createdAt).toLocaleString())} · configuration v${j.agent.version}</span></div><span class="badge ${esc(j.status)}">${esc(pretty(j.status))}</span></div><p class="brief">${esc(j.prompt)}</p><p class="muted">${esc(j.error || j.validation || j.progress || 'Waiting in the queue.')}</p>${j.externalId?`<p class="meta">ComfyUI prompt: ${esc(j.externalId)}</p>`:''}${j.output?`<details data-key="${j.id}"><summary>Read result</summary><pre>${esc(j.output)}</pre></details>`:''}<div class="actions">${['queued','running'].includes(j.status)?`<button data-action="cancel" data-id="${j.id}">Cancel task</button>`:''}${j.status==='interrupted'&&j.adapter==='comfy'&&j.externalId?`<button class="primary" data-action="resume" data-id="${j.id}">Reattach to ComfyUI</button>`:''}${['failed','interrupted','cancelled'].includes(j.status)&&!j.externalId&&!j.submissionStarted&&!j.flowRunId?`<button data-action="retry" data-id="${j.id}">Retry as new task</button>`:''}${j.status==='needs_review'?`<button data-view="library">Review outputs</button><button data-action="accept" data-id="${j.id}">I reviewed these · Accept</button>${j.flowRunId?'':`<button data-action="open-redo" data-id="${j.id}">↻ Redo…</button><button class="danger" data-action="open-decline" data-id="${j.id}">✕ Decline</button>`}`:''}${j.artifacts.map(a=>`<a href="/api/artifacts/${a.id}?download">${esc(a.label)}</a>`).join(' ')}</div></article>`; }
function artifactCard(a,j) { const url=`/api/artifacts/${a.id}`; const ext=a.name.split('.').pop(); let preview='';
  if(['png','jpg','jpeg','webp','gif'].includes(ext)) preview=`<img class="artifact-preview" src="${url}" alt="${esc(a.label)}" loading="lazy">`;
  if(['glb','gltf'].includes(ext)) preview=`<div class="model-preview" data-model="${a.id}"><button data-action="preview-3d" data-id="${a.id}">▶ Preview 3D model</button><small class="muted">Loads the full file (${a.bytes>=1048576?(a.bytes/1048576).toFixed(0)+' MB':Math.max(1,Math.round(a.bytes/1024))+' KB'}). Drag to rotate, scroll to zoom.</small></div>`;
  if(['mp4','webm'].includes(ext)) preview=`<video class="artifact-preview" src="${url}" controls preload="metadata"></video>`;
  if(['wav','mp3','flac','ogg'].includes(ext)) preview=`<audio class="artifact-preview" src="${url}" controls preload="metadata"></audio>`;
  return `<article class="card"><span class="badge">${esc(j.agent.name)} · ${esc(pretty(j.status))}</span><h3>${esc(a.label)}</h3>${preview}<p>${esc(a.kind)} · ${(a.bytes/1024).toFixed(1)} KB</p>${a.kind==='text'?`<details data-key="artifact-${a.id}"><summary>Preview report</summary><pre>${esc(j.output || 'Download the measurements below.')}</pre></details>`:''}<p class="muted">${esc(j.validation || '')}</p>${factoryBox(a,j,ext)}${handoffBox(a,j)}${prepBox(a,j)}<a href="${url}?download">Download ${esc(a.name)} ↓</a></article>`;
}
function jobGroup(j) {
  const first=(j.prompt||'').split('\n')[0].slice(0,80);
  return `<section class="job-group"><div class="job-head"><h3>${esc(j.agent.name)} · ${esc(first)}</h3><span class="badge ${esc(j.status)}">${esc(pretty(j.status))}</span><span class="meta">${esc(new Date(j.createdAt).toLocaleString())}${j.redoOf?' · redo':''}</span></div>${j.redoNote?`<p class="muted">Redo note: ${esc(j.redoNote)}</p>`:''}<div class="cards">${j.artifacts.map(a=>artifactCard(a,j)).join('')}</div>${j.status==='needs_review'?reviewBar(j):''}</section>`;
}
function reviewBar(j) {
  return `<div class="review-bar"><span class="muted">Review these results:</span><button class="primary" data-action="accept" data-id="${esc(j.id)}">✓ Accept</button>${j.flowRunId?'':`<button data-action="open-redo" data-id="${esc(j.id)}">↻ Redo…</button><button class="danger" data-action="open-decline" data-id="${esc(j.id)}">✕ Decline &amp; delete</button>`}</div>`;
}
function openReview(kind,id) {
  const j=state.jobs.find(j=>j.id===id); if(!j) return; const f=$('#reviewForm'); f.dataset.kind=kind; f.dataset.id=id;
  const head=(eyebrow,title)=>`<div class="dialog-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><button type="button" data-close="reviewDialog" aria-label="Close">×</button></div>`;
  const comfy=j.adapter==='comfy', promptBased=!j.workflow||!!j.workflow.promptNode;
  if(kind==='decline') {
    const mb=j.artifacts.reduce((n,a)=>n+a.bytes,0)/1048576;
    f.innerHTML=head('DECLINE','Delete these results?')+`<p>This permanently deletes ${j.artifacts.length} file${j.artifacts.length===1?'':'s'} (${mb.toFixed(1)} MB) that ${esc(j.agent.name)} generated. Copies already sent to the Factory are not touched, and ComfyUI keeps its own output folder.</p><label>What was wrong? <small>optional, saved with the task</small><textarea name="note" rows="3" maxlength="1000"></textarea></label><p class="form-error" role="alert"></p><div class="dialog-footer"><button type="button" data-close="reviewDialog">Keep them</button><button class="primary danger">Delete results</button></div>`;
  } else {
    const params=(j.workflow?.params||[]).filter(p=>p.key!=='seed').map(p=>paramField({...p,default:j.params?.[p.key]??p.default})).join('');
    f.innerHTML=head('REDO','Try again')+`<label>What was wrong? <small>optional</small><textarea name="note" rows="3" maxlength="2000" placeholder="For example: toes merged together, cape too short"></textarea></label><p class="hint">${promptBased?'Your note is added to the task text for the next attempt.':'This workflow has no text prompt, so the note is saved with the new task for reference. A new seed and different settings are what change the result.'}</p>${comfy?'<label class="inline"><input type="checkbox" name="newSeed" checked> Use a new random seed</label>':''}${params}<label class="inline"><input type="checkbox" name="deleteOld" checked> Delete the previous results</label><p class="form-error" role="alert"></p><div class="dialog-footer"><button type="button" data-close="reviewDialog">Cancel</button><button class="primary">Redo →</button></div>`;
  }
  $('#reviewDialog').showModal();
}
function prepBox(a,j) {
  if(a.kind!=='model'||!/\.glb$/i.test(a.name)||!['accepted','succeeded'].includes(j.status)||j.action==='gameprep') return '';
  return `<div class="factory-send"><button type="button" data-action="gameprep" data-id="${esc(a.id)}">Game prep →</button></div>`;
}
function handoffBox(a,j) {
  const h=j.workflow?.handoff; if(!h||!(a.label||a.name||'').includes(h.match||'')) return '';
  if(j.status==='needs_review') return `<p class="muted">Accept the task below, then continue with “${esc(h.label)}”.</p>`;
  if(!['accepted','succeeded'].includes(j.status)) return '';
  return `<div class="factory-send"><button type="button" class="primary" data-action="handoff" data-id="${esc(a.id)}" data-job="${esc(j.id)}">${esc(h.label)}</button></div>`;
}
function factoryBox(a,j,ext) {
  if(!Object.values(exportable).some(list=>list.includes(ext.toLowerCase()))) return '';
  const sent=(a.exports||[]).map(x=>`<p class="muted">In Factory: ${esc(x.path)}</p>`).join('');
  if(j.status==='needs_review') return `${sent}<p class="muted">Accept the task below to send this to the Factory.</p>`;
  if(!['accepted','succeeded'].includes(j.status)) return sent;
  if(!factory.exists) return `${sent}<p class="muted">Factory folder not found (${esc(factory.dir||'not set')}). Set factoryDir in bonsai.config.json.</p>`;
  const options=['<option value="">No character</option>',...factory.characters.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`)].join('');
  return `${sent}<div class="factory-send"><label>Character <select data-export-char="${esc(a.id)}">${options}</select></label> <button type="button" data-action="export" data-id="${esc(a.id)}">Send to Factory</button></div>`;
}
function replace(id,html) { const el=$(id); if(el.dataset.rendered===html) return; const open=[...el.querySelectorAll('details[open]')].map(d=>d.dataset.key); el.innerHTML=html;el.dataset.rendered=html; el.querySelectorAll('details').forEach(d=>{if(open.includes(d.dataset.key))d.open=true;}); }
function render() {
  $('#version').textContent=`Bonsai ${state.version}`;
  if(typeof renderExtensions === 'function') renderExtensions();
  if(view==='home') {
    replace('#stats',`<div class="stat"><strong>${state.agents.filter(a=>!a.archived).length}</strong><span>Specialists in your team</span></div><div class="stat"><strong>${state.jobs.filter(j=>['queued','running','cancelling'].includes(j.status)).length}</strong><span>Tasks in progress</span></div><div class="stat"><strong>${state.jobs.reduce((n,j)=>n+j.artifacts.length,0)}</strong><span>Saved outputs</span></div>`);
    replace('#homeAgents',state.agents.filter(a=>!a.archived).sort((a,b)=>Number(template(b)?.adapter==='mcp')-Number(template(a)?.adapter==='mcp')).slice(0,4).map(agentCard).join('')||empty('Create your first specialist.'));
    replace('#recentTasks',state.jobs.slice(0,3).map(taskCard).join('')||empty('Your next idea starts with a task. Choose a specialist above.'));
  }
  if(view==='agents') { const q=$('#agentSearch').value.toLowerCase(); replace('#agentList',state.agents.filter(a=>(!a.archived||$('#showArchived').checked)&&`${a.name} ${a.role}`.toLowerCase().includes(q)).sort((a,b)=>Number(template(b)?.adapter==='mcp')-Number(template(a)?.adapter==='mcp')).map(agentCard).join('')||empty('No specialists match. Create one or change your search.')); }
  if(view==='tasks') replace('#taskList',state.jobs.map(taskCard).join('')||empty('No tasks yet. Create a task to get started.'));
  if(view==='library') replace('#artifactList',state.jobs.filter(j=>j.artifacts.length).map(jobGroup).join('')||empty('Finished task outputs will appear here.'));
  if(view==='workflows') replace('#presetList',presets.map(p=>`<article class="card"><span class="badge">${esc(p.media)}</span><h3>${esc(p.name)}</h3><p class="muted">${esc(p.description)}</p><p class="muted">Needs: ${esc((p.requires?.models||[]).join(', '))}</p><div class="actions">${p.installed?`<span class="badge accepted">Added</span>${p.outdated?`<button class="primary" data-action="update-preset" data-id="${p.id}">Update available</button>`:''}<button data-action="preset-agent" data-id="${p.id}">Create agent</button>`:`<button class="primary" data-action="add-preset" data-id="${p.id}">Add to Bonsai</button>`}</div></article>`).join('')||empty('No ready-made workflows in this version.'));
  if(view==='workflows') replace('#workflowList',state.workflows.map(w=>`<article class="card"><span class="badge">${esc(w.media)}</span><h3>${esc(w.name)}</h3><p>${Object.keys(w.graph).length} nodes · ${w.inputs?.length?`${w.inputs.length} image input${w.inputs.length>1?'s':''}, ${(w.params||[]).length} settings`:`prompt input ${esc(w.promptNode)} / ${esc(w.promptInput)}`}</p><p class="muted">Dependencies checked when queued.</p></article>`).join('')||empty('Import your first tested ComfyUI workflow.'));
  if(view==='connections') replace('#connectionList',Object.entries(state.connections || {model:{status:'unchecked',detail:'Check the local model service.'},comfy:{status:'unchecked',detail:'Check your ComfyUI installation.'},blender:{status:'unchecked',detail:'Check the Blender executable.'},unity:{status:'unchecked',detail:'Check the full-access MCP connection.'},unreal:{status:'unchecked',detail:'Check the full-access MCP connection.'}}).map(([name,c])=>`<article class="card"><h3>${esc(name==='model'?'Local model':name==='comfy'?'ComfyUI':name==='comfyMcp'?'ComfyUI MCP':name[0].toUpperCase()+name.slice(1))}</h3><span class="badge">${esc(pretty(c.status))}</span><p>${esc(c.detail)}</p></article>`).join(''));
  if(view==='history') {
    replace('#legacyHistory',[...state.runs.map(r=>`<article class="task-card"><h3>${esc(r.pipelineName)}</h3><span class="badge">Legacy demonstration · ${esc(pretty(r.status))}</span><p class="muted">Timer simulation only. This is not evidence of tool execution.</p></article>`),...state.modelJobs.map(j=>`<article class="task-card"><h3>Earlier Blender job · ${esc(j.id)}</h3><span class="badge">${esc(pretty(j.status))}</span><p class="muted">${esc(j.error||j.instruction||'Historical job preserved.')}</p><details data-key="legacy-${j.id}"><summary>Original reports and working copy</summary><pre>${esc(JSON.stringify({workingPath:j.workingPath,workerReports:j.workerReports,reviews:j.reviews},null,2))}</pre></details></article>`)].join('')||empty('No legacy jobs.'));
    replace('#activityList',state.events.map(e=>`<div class="activity"><small>${esc(new Date(e.time).toLocaleString())}</small>${esc(e.message)}</div>`).join(''));
  }
}
function navigate(next) { view=next; document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view); document.querySelectorAll('nav [data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('#viewLabel').textContent=labels[view];if(view==='connections'){const f=$('#settingsForm');Object.entries(state.settings).forEach(([k,v])=>field(f,k).value=v);}render(); }
async function refresh() { state=await api('/api/state');render(); }
let viewerLoading=null;
function loadModelViewer() {
  if(window.customElements&&customElements.get('model-viewer'))return Promise.resolve();
  return viewerLoading||=new Promise((resolve,reject)=>{const s=document.createElement('script');s.type='module';s.src='/vendor/model-viewer.min.js';s.onload=resolve;s.onerror=()=>{viewerLoading=null;s.remove();reject(new Error('load failed'));};document.head.appendChild(s);});
}
async function loadPresets() { try { presets=await api('/api/presets'); render(); } catch { /* optional feature */ } }
async function uploadImage(file) {
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  const res=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':file.type,'X-Bonsai-Token':state.token},body:file});
  const data=await res.json(); if(!res.ok) throw new Error(data.error||'Upload failed.'); return data;
}
async function handoffTo(b,job,h,target,agent) {
  const up=await api(`/api/artifacts/${encodeURIComponent(b.dataset.id)}/use-as-input`,'POST',{});
  const inputId=(target.inputs||[])[0]?.id; newTask(agent.id);
  pendingInput={inputId,id:up.id,name:up.name,url:`/api/artifacts/${encodeURIComponent(b.dataset.id)}`};
  field($('#taskForm'),'prompt').value=up.assetName||'';renderComfyInputs();
  for(const [k,v] of Object.entries(h.params||{})){const el=$('#taskForm').querySelector(`[name="param:${k}"]`);if(el)el.value=v;}
  updateSheetPreview();
}
function paramField(p) {
  const name=`param:${esc(p.key)}`, value=p.default===''||p.default==null?'':esc(p.default);
  if(p.type==='select') return `<label>${esc(p.label)}<select name="${name}">${p.options.map(o=>`<option value="${esc(o)}"${String(p.default)===o?' selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  if(p.type==='int'||p.type==='number') return `<label>${esc(p.label)}<input type="number" name="${name}" value="${value}" step="${p.type==='int'?1:'any'}"${p.min!==undefined?` min="${p.min}"`:''}${p.max!==undefined?` max="${p.max}"`:''}></label>`;
  return `<label>${esc(p.label)}<input name="${name}" value="${value}"></label>`;
}
function renderComfyInputs() {
  const f=$('#taskForm'), on=!$('#comfyFields').hidden, w=on?state.workflows.find(w=>w.id===field(f,'workflowId').value):null, custom=!!(w?.inputs?.length);
  $('#taskPromptLabel').firstChild.nodeValue=custom&&!w.promptNode?'Asset name (used for the output file names)':'What would you like to make or inspect?';
  $('#comfyNote').hidden=custom;
  field(f,'prompt').placeholder=custom&&!w.promptNode?'For example: Catmurai_hero':'Describe the result you want…';
  $('#comfyInputs').innerHTML=w?(w.description?`<p class="hint">${esc(w.description)}</p>`:'')+(w.inputs||[]).map(i=>{const held=pendingInput&&pendingInput.inputId===i.id;return `<label>${esc(i.label)}${held?`<span class="muted"> · using ${esc(pendingInput.name)} from the previous step. Pick a file only to replace it.</span>`:''}<input type="file" name="input:${esc(i.id)}" accept="image/png,image/jpeg,image/webp"${held||i.optional?'':' required'}></label>${i.kind==='sheet'?`<div class="sheet-preview" data-sheet="${esc(i.id)}" data-panels="${i.panels.length}" hidden></div>`:''}`;}).join('')+(w.params||[]).map(paramField).join(''):'';
}
const VIEW_NAMES=['Front','Left','Back','Right'];
// Draws the crop boxes over the chosen sheet so a wrong split is visible before any GPU time is spent.
function updateSheetPreview() {
  const box=document.querySelector('.sheet-preview'); if(!box) return;
  const f=$('#taskForm'), file=$('#comfyInputs input[type=file]')?.files[0]; if(!file&&!pendingInput){box.hidden=true;return;}
  const url=file?URL.createObjectURL(file):pendingInput.url, img=new Image();
  img.onload=()=>{
    const layout=f.querySelector('[name="param:layout"]')?.value||'auto', trim=f.querySelector('[name="param:trim"]')?.value||0, n=Number(box.dataset.panels)||4;
    let crops,kind; try{kind=SheetCrops.resolveLayout(layout,img.width,img.height,n);crops=SheetCrops.panelCrops(img.width,img.height,n,layout,trim);}catch(e){box.hidden=false;box.innerHTML=`<p class="form-error">${esc(e.message)}</p>`;file&&URL.revokeObjectURL(url);return;}
    box.hidden=false;
    box.innerHTML=`<div class="sheet-stage"><img src="${url}" alt="Uploaded sheet">${crops.map((c,i)=>`<div class="sheet-box" style="left:${c.x/img.width*100}%;top:${c.y/img.height*100}%;width:${c.width/img.width*100}%;height:${c.height/img.height*100}%"><span>${i+1} ${VIEW_NAMES[i]||''}</span></div>`).join('')}</div><p class="hint">Split as ${kind==='grid'?'a 2×2 grid':kind==='row'?'a row':'a column'}, ${img.width}×${img.height}. Each box should hold one view of the object, in the order front, left, back, right.</p>`;
  };
  img.onerror=()=>{box.hidden=true;file&&URL.revokeObjectURL(url);};
  img.src=url;
}
async function loadFactory() { try { factory=await api('/api/factory'); render(); } catch { /* optional feature */ } }
function workflowOptions() { return '<option value="">Choose a workflow…</option>'+state.workflows.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join(''); }
function previewAgent() { const f=$('#agentForm');$('#agentPreview').innerHTML=icon({icon:field(f,'icon').value,accent:field(f,'accent').value,avatar})+`<div><h3>${esc(field(f,'name').value||'Your specialist')}</h3><span class="muted">${esc(field(f,'role').value||'Ready for a purpose')}</span></div>`; const t=state.templates.find(t=>t.id===field(f,'templateId').value);$('#specialtyHelp').textContent=adapterHelp(t?.adapter); }
function adapterHelp(adapter) {return {mcp:'Uses the full connected MCP tool set to create and edit. Review the task journal and outputs. Engine tasks require the intended project to be open.',text:'Writes text using your local model. It cannot access files or run tools.',comfy:'Uses an imported ComfyUI workflow. Save an agent now and connect its workflow later.',blender:'Runs fixed operations on a separate Blender copy. Model inspectors cannot perform cleanup.',project:'Reads project metadata only. Editor changes, builds and playtesting are not connected yet.'}[adapter]||'';}
function editAgent(id) { const f=$('#agentForm');f.reset();f.querySelector('.form-error').textContent='';const a=state.agents.find(a=>a.id===id);$('#templateSelect').innerHTML=state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');$('#agentWorkflow').innerHTML=workflowOptions();avatar=a?.avatar||'';const values=a||{name:'',icon:'✦',accent:'green',templateId:'assistant',instructions:state.templates.find(t=>t.id==='assistant').instructions,role:'',workflowId:'',projectPath:'',id:''};['id','name','icon','accent','templateId','instructions','role','workflowId','projectPath','model'].forEach(k=>field(f,k).value=values[k]||'');$('#agentTitle').textContent=a?'Edit specialist':'Create a specialist';previewAgent();$('#agentDialog').showModal(); }
function taskFields() { const f=$('#taskForm'),a=state.agents.find(a=>a.id===field(f,'agentId').value),t=a&&template(a);$('#taskHelp').textContent=adapterHelp(t?.adapter);$('#blenderFields').hidden=t?.adapter!=='blender';$('#projectFields').hidden=!['project','mcp'].includes(t?.adapter);$('#comfyFields').hidden=t?.adapter!=='comfy';field(f,'action').disabled=a?.templateId==='reviewer';if(a?.templateId==='reviewer')field(f,'action').value='inspect';field(f,'projectPath').value=a?.projectPath||'';field(f,'workflowId').value=a?.workflowId||'';renderComfyInputs(); }
function newTask(id) {pendingInput=null;const f=$('#taskForm');f.reset();f.querySelector('.form-error').textContent='';$('#taskAgent').innerHTML=state.agents.filter(a=>!a.archived).map(a=>`<option value="${a.id}">${esc(a.name)} · ${esc(template(a)?.name)}</option>`).join('');$('#taskWorkflow').innerHTML=workflowOptions();if(id)field(f,'agentId').value=id;taskFields();$('#taskDialog').showModal();}
async function submitForm(event,action) {event.preventDefault();const f=event.currentTarget,b=f.querySelector('button.primary');b.disabled=true;const error=f.querySelector('.form-error');try{await action(f);await refresh();}catch(e){if(error)error.textContent=e.message;else notify(e.message);}finally{b.disabled=false;}}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;try{
  if(b.dataset.close){$('#'+b.dataset.close).close();return;}if(b.dataset.view){navigate(b.dataset.view);return;}
  const a=b.dataset.action,id=b.dataset.id;if(!a||['create-flow','run-flow','cancel-flow','add-project','inspect-project','remove-step'].includes(a))return;
  if(a==='new-agent'||a==='edit-agent')return editAgent(id);
  if(a==='new-task'||a==='assign')return newTask(id);
  if(a==='preview-3d'){const box=b.closest('.model-preview');box.innerHTML='<p class="muted">Loading model…</p>';try{await loadModelViewer();box.innerHTML=`<model-viewer src="/api/artifacts/${encodeURIComponent(id)}" camera-controls auto-rotate shadow-intensity="0.8" exposure="1.1" touch-action="pan-y" interaction-prompt="none"></model-viewer>`;}catch(e){box.innerHTML='<p class="form-error">Could not load the 3D viewer.</p>';}return;}
  if(a==='handoff'){
    const job=state.jobs.find(j=>j.id===b.dataset.job),h=job?.workflow?.handoff; if(!h) return;
    b.disabled=true;
    try{
      let target=state.workflows.find(w=>w.presetId===h.presetId);
      if(!target){target=await api('/api/workflows/preset','POST',{id:h.presetId});await refresh();await loadPresets();}
      let agent=state.agents.find(x=>!x.archived&&x.workflowId===target.id);
      if(!agent){
        const p=presets.find(p=>p.id===h.presetId),t=state.templates.find(t=>t.id===p?.agentTemplate);
        if(!t){notify('Could not set up the next agent. Use the Workflows page, “Create agent”.');b.disabled=false;return;}
        agent=await api('/api/agents','POST',{name:p.agentName||t.name,templateId:t.id,instructions:t.instructions,icon:t.icon,role:t.name,accent:state.agents[0]?.accent||'violet',workflowId:target.id});
        await refresh();notify(`Set up ${agent.name} for you.`);
      }
      await handoffTo(b,job,h,target,agent);
    }catch(e){b.disabled=false;notify(e.message);}
    return;
  }
  if(a==='gameprep'){
    const agent=state.agents.find(x=>!x.archived&&x.templateId==='blender');
    if(!agent){notify('Create a Model polisher agent first (Agents page), then send the model on.');return;}
    const src=await api(`/api/artifacts/${encodeURIComponent(id)}/source-path`);
    newTask(agent.id);const f=$('#taskForm');field(f,'sourcePath').value=src.path;field(f,'action').value='gameprep';field(f,'prompt').value=`Game prep for ${src.name}`;return;
  }
  if(a==='update-preset'){await api('/api/workflows/preset','POST',{id:b.dataset.id,update:true});await refresh();await loadPresets();notify('Updated. Your agents keep their workflow.');return;}
  if(a==='open-redo'||a==='open-decline'){openReview(a==='open-redo'?'redo':'decline',id);return;}
  if(a==='add-preset'){await api('/api/workflows/preset','POST',{id:b.dataset.id});await refresh();await loadPresets();notify('Added. Use “Create agent” on the card to give it a specialist.');return;}
  if(a==='preset-agent'){const p=presets.find(p=>p.id===b.dataset.id),w=state.workflows.find(w=>w.presetId===b.dataset.id);editAgent();const f=$('#agentForm'),t=state.templates.find(t=>t.id===p.agentTemplate);if(t){field(f,'templateId').value=t.id;field(f,'instructions').value=t.instructions;field(f,'icon').value=t.icon;field(f,'role').value=t.name;}field(f,'name').value=p.agentName||'';if(w)field(f,'workflowId').value=w.id;previewAgent();return;}
  if(a==='import-workflow'){const f=$('#workflowForm');f.reset();f.querySelector('.form-error').textContent='';$('#workflowDialog').showModal();return;}
  b.disabled=true;
  if(a==='export'){const character=document.querySelector(`[data-export-char="${id}"]`)?.value||'';const r=await api(`/api/artifacts/${id}/export`,'POST',{character});notify(r.alreadyThere?`Already in the Factory: ${r.path}`:`Copied to ${r.path}${r.matchNote?` — ${r.matchNote}`:''}`);}
  if(['archive','restore','duplicate'].includes(a))await api(`/api/agents/${id}/${a}`,'POST',{});
  if(['cancel','retry','resume','accept'].includes(a))await api(`/api/jobs/${id}/${a}`,'POST',{});
  if(a==='check-connections'){await api('/api/connections/check','POST',{});notify('Connection checks complete.');}
  await refresh();
}catch(e){notify(e.message);}finally{b.disabled=false;}});
$('#agentForm').addEventListener('submit',event=>submitForm(event,async f=>{const body=Object.fromEntries(new FormData(f));body.avatar=avatar;const id=body.id;delete body.id;await api(id?`/api/agents/${id}`:'/api/agents',id?'PUT':'POST',body);$('#agentDialog').close();navigate('agents');}));
$('#agentForm').addEventListener('input',previewAgent);
$('#templateSelect').addEventListener('change',()=>{const f=$('#agentForm'),t=state.templates.find(t=>t.id===field(f,'templateId').value);field(f,'instructions').value=t.instructions;field(f,'role').value=t.name;field(f,'icon').value=t.icon;previewAgent();});
$('#avatarUpload').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(!['image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a PNG/WebP smaller than 5 MB.');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d');c.drawImage(bitmap,0,0,128,128);bitmap.close();avatar=canvas.toDataURL('image/webp',.85);previewAgent();}catch(e){$('#agentForm .form-error').textContent=e.message;}});
$('#clearAvatar').addEventListener('click',()=>{avatar='';$('#avatarUpload').value='';previewAgent();});
$('#reviewForm').addEventListener('submit',event=>submitForm(event,async f=>{
  const kind=f.dataset.kind,id=f.dataset.id,data=new FormData(f);
  if(kind==='decline'){await api(`/api/jobs/${id}/decline`,'POST',{reason:data.get('note')||''});$('#reviewDialog').close();return;}
  const params={};for(const [k,v] of data)if(k.startsWith('param:')&&v!=='')params[k.slice(6)]=v;
  await api(`/api/jobs/${id}/redo`,'POST',{note:data.get('note')||'',newSeed:data.has('newSeed')||f.querySelector('[name=newSeed]')===null,deleteOld:data.has('deleteOld'),params});
  $('#reviewDialog').close();navigate('tasks');
}));
$('#comfyInputs').addEventListener('change',updateSheetPreview);$('#comfyInputs').addEventListener('input',event=>{if(event.target.name==='param:trim')updateSheetPreview();});$('#taskAgent').addEventListener('change',taskFields);$('#taskWorkflow').addEventListener('change',renderComfyInputs);
$('#taskForm').addEventListener('submit',event=>submitForm(event,async f=>{const body={inputs:{},params:{}};for(const [k,v] of new FormData(f)){if(v instanceof File){if(k.startsWith('input:')){if(!v.size&&pendingInput&&pendingInput.inputId===k.slice(6))body.inputs[k.slice(6)]=pendingInput.id;else if(v.size)body.inputs[k.slice(6)]=(await uploadImage(v)).id;}}else if(k.startsWith('param:'))body.params[k.slice(6)]=v;else body[k]=v;}await api('/api/jobs','POST',body);$('#taskDialog').close();navigate('tasks');}));
$('#workflowForm').addEventListener('submit',event=>submitForm(event,async f=>{const body=Object.fromEntries(new FormData(f)),file=field(f,'file').files[0];if(file.size>1500000)throw new Error('Workflow JSON must be smaller than 1.5 MB.');body.graph=JSON.parse(await file.text());delete body.file;await api('/api/workflows','POST',body);$('#workflowDialog').close();navigate('workflows');}));
$('#settingsForm').addEventListener('submit',event=>submitForm(event,async f=>{await api('/api/settings','PUT',Object.fromEntries(new FormData(f)));notify('Connections saved. Run a connection check to verify them.');}));
$('#agentSearch').addEventListener('input',render);$('#showArchived').addEventListener('change',render);
refresh().then(loadFactory).then(loadPresets).catch(e=>notify(`Bonsai could not load: ${e.message}`));
setInterval(async()=>{if(polling||document.hidden||document.querySelector('dialog[open]'))return;polling=true;try{await refresh();}catch(e){notify(`Connection interrupted: ${e.message}`);}finally{polling=false;}},3000);

$('#cleanupForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,body={days:Number(field(f,'days').value),includeAccepted:field(f,'includeAccepted').checked};
  try{const plan=await api('/api/maintenance/cleanup','POST',{...body,dryRun:true});
    if(!plan.jobs&&!plan.uploads){notify('Nothing to clear.');return;}
    if(!confirm(`Delete ${plan.jobs} finished task${plan.jobs===1?'':'s'} and ${plan.uploads} unused upload${plan.uploads===1?'':'s'} (${(plan.bytes/1048576).toFixed(1)} MB)? Tasks waiting for review are kept. This cannot be undone.`))return;
    const done=await api('/api/maintenance/cleanup','POST',body);await refresh();notify(`Cleared ${done.jobs} task${done.jobs===1?'':'s'}, freed ${(done.bytes/1048576).toFixed(1)} MB.`);
  }catch(err){notify(err.message);}});
