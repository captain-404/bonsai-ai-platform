const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { createChat } = require('../lib/chat');
const { runMcp } = require('../lib/mcp-agent');
test('specialists seed once and preserve user edits through restart', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-mcp-'));let s=openStore(dir);
  assert.equal(s.state.agents.filter(a=>a.templateId.endsWith('-mcp')).length,3);
  s.state.agents.find(a=>a.id==='unity-mcp').name='My Unity';s.save();s.close();s=openStore(dir);
  assert.equal(s.state.agents.find(a=>a.id==='unity-mcp').name,'My Unity');assert.equal(s.state.agents.length,5);s.close();
});
test('chat retains history, isolates sessions and records model failure',async()=>{
  const state={chats:[],settings:{}};let seen;const store={state,save(){}};
  const chat=createChat(store,async(s,m)=>{seen=m;if(m.at(-1).content==='fail')throw Error('offline');return 'Hello';});
  const a=chat.create(),b=chat.create();await chat.send(a.id,{message:'First'});await chat.send(a.id,{message:'Follow up'});
  assert.deepEqual(seen.slice(1).map(m=>m.content),['First','Hello','Follow up']);assert.equal(b.messages.length,0);
  await assert.rejects(chat.send(a.id,{message:'fail'}),/offline/);assert.equal(a.messages.at(-1).error,'offline');
});
test('MCP execution discovers schema, dispatches write tools and saves evidence',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-tools-'));let turn=0,closed=false;const called=[];
  const call=(name,args)=>({role:'assistant',content:'',tool_calls:[{id:String(turn),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const answers=[call('get_tool_schema',{name:'edit_scene'}),call('execute_mcp_tool',{name:'edit_scene',arguments:{name:'Cube'}}),{role:'assistant',content:'Created Cube.'}];
  const job={agent:{templateId:'unity-mcp',name:'Pixel',instructions:'Develop games'},settings:{},prompt:'Create Cube',artifacts:[]};
  await runMcp(job,{dir,signal:new AbortController().signal,progress(){}},{connect:async()=>({instructions:'',tools:[{name:'edit_scene',inputSchema:{type:'object'}}],call:async(n,a)=>{called.push([n,a]);return {content:[{type:'text',text:'Created Cube'}]};},close:async()=>{closed=true;}}),complete:async()=>answers[turn++]});
  assert.deepEqual(called,[['edit_scene',{name:'Cube'}]]);assert.ok(closed);assert.ok(job.submissionStarted);assert.ok(job.reviewRequired);assert.equal(job.artifacts.length,2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'tool-journal.json'))).at(-1).status,'returned');
});
test('search exposes exact native schemas and excludes reasoning from follow-up context',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-native-'));let round=0,called=false;
  const job={agent:{templateId:'unity-mcp',name:'Pixel',instructions:'Inspect'},settings:{},prompt:'Read scene',artifacts:[]};
  const native={name:'scene_read',description:'Read scene',inputSchema:{type:'object',properties:{},additionalProperties:false}};
  await runMcp(job,{dir,signal:new AbortController().signal,progress(){}},{connect:async()=>({instructions:'',tools:[native],call:async name=>{assert.equal(name,'scene_read');called=true;return {content:[{type:'text',text:'Scene A'}]};},close:async()=>{}}),complete:async(s,m,extra)=>{
    assert.ok(m.every(x=>!x.reasoning_content));
    if(round++===0)return {role:'assistant',reasoning_content:'private reasoning',tool_calls:[{id:'1',function:{name:'search_tools',arguments:'{"query":"scene"}'}}]};
    if(round===2){assert.deepEqual(extra.tools.find(t=>t.function.name==='mcp_0').function.parameters,native.inputSchema);return {role:'assistant',tool_calls:[{id:'2',function:{name:'mcp_0',arguments:'{}'}}]};}
    return {role:'assistant',content:'Scene A'};
  }});assert.ok(called);
});
