const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, view = 'home', avatar = '', polling = false;
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
function taskCard(j) { return `<article class="task-card"><div class="task-head"><div><h3>${esc(j.agent.name)}</h3><span class="meta">${esc(new Date(j.createdAt).toLocaleString())} · configuration v${j.agent.version}</span></div><span class="badge ${esc(j.status)}">${esc(pretty(j.status))}</span></div><p class="brief">${esc(j.prompt)}</p><p class="muted">${esc(j.error || j.validation || j.progress || 'Waiting in the queue.')}</p>${j.externalId?`<p class="meta">ComfyUI prompt: ${esc(j.externalId)}</p>`:''}${j.output?`<details data-key="${j.id}"><summary>Read result</summary><pre>${esc(j.output)}</pre></details>`:''}<div class="actions">${['queued','running'].includes(j.status)?`<button data-action="cancel" data-id="${j.id}">Cancel task</button>`:''}${['failed','interrupted','cancelled'].includes(j.status)&&!j.externalId&&!j.submissionStarted&&!j.flowRunId?`<button data-action="retry" data-id="${j.id}">Retry as new task</button>`:''}${j.status==='needs_review'?`<button data-view="library">Review outputs</button><button data-action="accept" data-id="${j.id}">I reviewed these · Accept</button>`:''}${j.artifacts.map(a=>`<a href="/api/artifacts/${a.id}?download">${esc(a.label)}</a>`).join(' ')}</div></article>`; }
function artifactCard(a,j) { const url=`/api/artifacts/${a.id}`; const ext=a.name.split('.').pop(); let preview='';
  if(['png','jpg','jpeg','webp','gif'].includes(ext)) preview=`<img class="artifact-preview" src="${url}" alt="${esc(a.label)}" loading="lazy">`;
  if(['mp4','webm'].includes(ext)) preview=`<video class="artifact-preview" src="${url}" controls preload="metadata"></video>`;
  if(['wav','mp3','flac','ogg'].includes(ext)) preview=`<audio class="artifact-preview" src="${url}" controls preload="metadata"></audio>`;
  return `<article class="card"><span class="badge">${esc(j.agent.name)} · ${esc(pretty(j.status))}</span><h3>${esc(a.label)}</h3>${preview}<p>${esc(a.kind)} · ${(a.bytes/1024).toFixed(1)} KB</p>${a.kind==='text'?`<details data-key="artifact-${a.id}"><summary>Preview report</summary><pre>${esc(j.output || 'Download the measurements below.')}</pre></details>`:''}<p class="muted">${esc(j.validation || '')}</p><a href="${url}?download">Download ${esc(a.name)} ↓</a></article>`;
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
  if(view==='library') replace('#artifactList',state.jobs.flatMap(j=>j.artifacts.map(a=>artifactCard(a,j))).join('')||empty('Finished task outputs will appear here.'));
  if(view==='workflows') replace('#workflowList',state.workflows.map(w=>`<article class="card"><span class="badge">${esc(w.media)}</span><h3>${esc(w.name)}</h3><p>${Object.keys(w.graph).length} nodes · prompt input ${esc(w.promptNode)} / ${esc(w.promptInput)}</p><p class="muted">Dependencies checked when queued.</p></article>`).join('')||empty('Import your first tested ComfyUI workflow.'));
  if(view==='connections') replace('#connectionList',Object.entries(state.connections || {model:{status:'unchecked',detail:'Check the local model service.'},comfy:{status:'unchecked',detail:'Check your ComfyUI installation.'},blender:{status:'unchecked',detail:'Check the Blender executable.'},unity:{status:'unchecked',detail:'Check the full-access MCP connection.'},unreal:{status:'unchecked',detail:'Check the full-access MCP connection.'}}).map(([name,c])=>`<article class="card"><h3>${esc(name==='model'?'Local model':name==='comfy'?'ComfyUI':name==='comfyMcp'?'ComfyUI MCP':name[0].toUpperCase()+name.slice(1))}</h3><span class="badge">${esc(pretty(c.status))}</span><p>${esc(c.detail)}</p></article>`).join(''));
  if(view==='history') {
    replace('#legacyHistory',[...state.runs.map(r=>`<article class="task-card"><h3>${esc(r.pipelineName)}</h3><span class="badge">Legacy demonstration · ${esc(pretty(r.status))}</span><p class="muted">Timer simulation only. This is not evidence of tool execution.</p></article>`),...state.modelJobs.map(j=>`<article class="task-card"><h3>Earlier Blender job · ${esc(j.id)}</h3><span class="badge">${esc(pretty(j.status))}</span><p class="muted">${esc(j.error||j.instruction||'Historical job preserved.')}</p><details data-key="legacy-${j.id}"><summary>Original reports and working copy</summary><pre>${esc(JSON.stringify({workingPath:j.workingPath,workerReports:j.workerReports,reviews:j.reviews},null,2))}</pre></details></article>`)].join('')||empty('No legacy jobs.'));
    replace('#activityList',state.events.map(e=>`<div class="activity"><small>${esc(new Date(e.time).toLocaleString())}</small>${esc(e.message)}</div>`).join(''));
  }
}
function navigate(next) { view=next; document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view); document.querySelectorAll('nav [data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('#viewLabel').textContent=labels[view];if(view==='connections'){const f=$('#settingsForm');Object.entries(state.settings).forEach(([k,v])=>field(f,k).value=v);}render(); }
async function refresh() { state=await api('/api/state');render(); }
function workflowOptions() { return '<option value="">Choose a workflow…</option>'+state.workflows.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join(''); }
function previewAgent() { const f=$('#agentForm');$('#agentPreview').innerHTML=icon({icon:field(f,'icon').value,accent:field(f,'accent').value,avatar})+`<div><h3>${esc(field(f,'name').value||'Your specialist')}</h3><span class="muted">${esc(field(f,'role').value||'Ready for a purpose')}</span></div>`; const t=state.templates.find(t=>t.id===field(f,'templateId').value);$('#specialtyHelp').textContent=adapterHelp(t?.adapter); }
function adapterHelp(adapter) {return {mcp:'Uses the full connected MCP tool set to create and edit. Review the task journal and outputs. Engine tasks require the intended project to be open.',text:'Writes text using your local model. It cannot access files or run tools.',comfy:'Uses an imported ComfyUI workflow. Save an agent now and connect its workflow later.',blender:'Runs fixed operations on a separate Blender copy. Model inspectors cannot perform cleanup.',project:'Reads project metadata only. Editor changes, builds and playtesting are not connected yet.'}[adapter]||'';}
function editAgent(id) { const f=$('#agentForm');f.reset();f.querySelector('.form-error').textContent='';const a=state.agents.find(a=>a.id===id);$('#templateSelect').innerHTML=state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');$('#agentWorkflow').innerHTML=workflowOptions();avatar=a?.avatar||'';const values=a||{name:'',icon:'✦',accent:'green',templateId:'assistant',instructions:state.templates.find(t=>t.id==='assistant').instructions,role:'',workflowId:'',projectPath:'',id:''};['id','name','icon','accent','templateId','instructions','role','workflowId','projectPath','model'].forEach(k=>field(f,k).value=values[k]||'');$('#agentTitle').textContent=a?'Edit specialist':'Create a specialist';previewAgent();$('#agentDialog').showModal(); }
function taskFields() { const f=$('#taskForm'),a=state.agents.find(a=>a.id===field(f,'agentId').value),t=a&&template(a);$('#taskHelp').textContent=adapterHelp(t?.adapter);$('#blenderFields').hidden=t?.adapter!=='blender';$('#projectFields').hidden=!['project','mcp'].includes(t?.adapter);$('#comfyFields').hidden=t?.adapter!=='comfy';field(f,'action').disabled=a?.templateId==='reviewer';if(a?.templateId==='reviewer')field(f,'action').value='inspect';field(f,'projectPath').value=a?.projectPath||'';field(f,'workflowId').value=a?.workflowId||''; }
function newTask(id) {const f=$('#taskForm');f.reset();f.querySelector('.form-error').textContent='';$('#taskAgent').innerHTML=state.agents.filter(a=>!a.archived).map(a=>`<option value="${a.id}">${esc(a.name)} · ${esc(template(a)?.name)}</option>`).join('');$('#taskWorkflow').innerHTML=workflowOptions();if(id)field(f,'agentId').value=id;taskFields();$('#taskDialog').showModal();}
async function submitForm(event,action) {event.preventDefault();const f=event.currentTarget,b=f.querySelector('button.primary');b.disabled=true;const error=f.querySelector('.form-error');try{await action(f);await refresh();}catch(e){if(error)error.textContent=e.message;else notify(e.message);}finally{b.disabled=false;}}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;try{
  if(b.dataset.close){$('#'+b.dataset.close).close();return;}if(b.dataset.view){navigate(b.dataset.view);return;}
  const a=b.dataset.action,id=b.dataset.id;if(!a||['create-flow','run-flow','cancel-flow','add-project','inspect-project','remove-step'].includes(a))return;
  if(a==='new-agent'||a==='edit-agent')return editAgent(id);
  if(a==='new-task'||a==='assign')return newTask(id);
  if(a==='import-workflow'){const f=$('#workflowForm');f.reset();f.querySelector('.form-error').textContent='';$('#workflowDialog').showModal();return;}
  b.disabled=true;
  if(['archive','restore','duplicate'].includes(a))await api(`/api/agents/${id}/${a}`,'POST',{});
  if(['cancel','retry','accept'].includes(a))await api(`/api/jobs/${id}/${a}`,'POST',{});
  if(a==='check-connections'){await api('/api/connections/check','POST',{});notify('Connection checks complete.');}
  await refresh();
}catch(e){notify(e.message);}finally{b.disabled=false;}});
$('#agentForm').addEventListener('submit',event=>submitForm(event,async f=>{const body=Object.fromEntries(new FormData(f));body.avatar=avatar;const id=body.id;delete body.id;await api(id?`/api/agents/${id}`:'/api/agents',id?'PUT':'POST',body);$('#agentDialog').close();navigate('agents');}));
$('#agentForm').addEventListener('input',previewAgent);
$('#templateSelect').addEventListener('change',()=>{const f=$('#agentForm'),t=state.templates.find(t=>t.id===field(f,'templateId').value);field(f,'instructions').value=t.instructions;field(f,'role').value=t.name;field(f,'icon').value=t.icon;previewAgent();});
$('#avatarUpload').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(!['image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a PNG/WebP smaller than 5 MB.');const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d');c.drawImage(bitmap,0,0,128,128);bitmap.close();avatar=canvas.toDataURL('image/webp',.85);previewAgent();}catch(e){$('#agentForm .form-error').textContent=e.message;}});
$('#clearAvatar').addEventListener('click',()=>{avatar='';$('#avatarUpload').value='';previewAgent();});
$('#taskAgent').addEventListener('change',taskFields);
$('#taskForm').addEventListener('submit',event=>submitForm(event,async f=>{await api('/api/jobs','POST',Object.fromEntries(new FormData(f)));$('#taskDialog').close();navigate('tasks');}));
$('#workflowForm').addEventListener('submit',event=>submitForm(event,async f=>{const body=Object.fromEntries(new FormData(f)),file=field(f,'file').files[0];if(file.size>1500000)throw new Error('Workflow JSON must be smaller than 1.5 MB.');body.graph=JSON.parse(await file.text());delete body.file;await api('/api/workflows','POST',body);$('#workflowDialog').close();navigate('workflows');}));
$('#settingsForm').addEventListener('submit',event=>submitForm(event,async f=>{await api('/api/settings','PUT',Object.fromEntries(new FormData(f)));notify('Connections saved. Run a connection check to verify them.');}));
$('#agentSearch').addEventListener('input',render);$('#showArchived').addEventListener('change',render);
refresh().catch(e=>notify(`Bonsai could not load: ${e.message}`));
setInterval(async()=>{if(polling||document.hidden||document.querySelector('dialog[open]'))return;polling=true;try{await refresh();}catch(e){notify(`Connection interrupted: ${e.message}`);}finally{polling=false;}},3000);
