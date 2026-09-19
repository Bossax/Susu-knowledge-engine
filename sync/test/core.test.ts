import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priority, reconcile, states } from "../src/model.ts";
import type { Thread, Task, TaskEvent, Config, Inventory } from "../src/model.ts";
import { inventory, frontmatter } from "../src/repository.ts";
import { Notion, rich, plain, readAutomationTasks } from "../src/notion.ts";
import { publish } from "../src/publish.ts";
import {inspectSnapshot, readSnapshot} from "../src/snapshot.ts";
import type {NotionSnapshot} from "../src/snapshot.ts";
import { prepare, accept, privatePath, atomicState, readState } from "../src/capture.ts";

const thread=(id:string,status:Thread["status"]="active"):Thread=>({id,title:id,status,path:"work/x/README.md",tags:[]});
const task=(id:string,thread?:string,deadline?:string):Task=>({id,pageId:id,title:id,status:"In Progress",thread,deadline,edited:"2026-09-08T01:00:00.000Z"});
const event:TaskEvent={taskId:"TASK-one",state:"Done",author:"Human",createdOn:"2026-09-08",recordedBy:"Codex",expectedStatus:"In Progress",expectedEdited:"2026-09-08T01:00:00.000Z",evidence:["DEC-0001"]};
const config:Config={repository:"example/team",branch:"main",notion:{version:"2025-09-03",threads:"threads",tasks:"tasks",activity:"activity",dashboardBlock:"block"}};
const snapshot=():NotionSnapshot=>({version:1,capturedAt:new Date().toISOString(),workspace:{id:"workspace",name:"Team"},
  targets:{threads:"threads",tasks:"tasks",activity:"activity",dashboardBlock:"block"},
  coverage:{workThreads:true,tasks:true},warnings:[],
  schemas:{
    workThread:{dataSourceId:"threads",properties:{Name:"title",ID:"rich_text",URL:"url",Project:"multi_select",Tags:"multi_select",created_by:"people",Duration:"date"}},
    task:{dataSourceId:"tasks",properties:{Name:"title",ID:"rich_text",Status:"status",Owner:"people",Deadline:"date",Thread:"relation"},statusOptions:[...states],relationTargets:{Thread:"threads"}},
    activity:{dataSourceId:"activity",properties:{Name:"title",ID:"rich_text",Kind:"select",URL:"url",Revision:"rich_text",Fingerprint:"rich_text"}}},
  dashboard:{blockId:"block",type:"paragraph"},
  workThreads:[{pageId:"thread-page",id:"THREAD-alpha",name:"Alpha",project:[],tags:[]}],
  tasks:[{pageId:"task-page",id:"TASK-one",name:"Task",status:"In Progress",threadPageIds:["thread-page"],lastEdited:event.expectedEdited}]});

test("priority preserves deadline-free slot, excludes dormant and completed tasks, breaks ties",()=>{
  const threads=[thread("THREAD-b"),thread("THREAD-a"),thread("THREAD-free"),thread("THREAD-sleep","dormant")];
  const tasks=[task("1","THREAD-b","2026-09-09"),task("2","THREAD-a","2026-09-09"),task("3","THREAD-free"),task("4","THREAD-sleep","2020-01-01"),{...task("5","THREAD-free","2020-01-01"),status:"Done" as const}];
  const p=priority(threads,tasks);
  assert.deepEqual(p.slots.map(x=>x?.thread.id),["THREAD-a","THREAD-b","THREAD-free"]);
  assert.deepEqual(p.ties,["THREAD-a","THREAD-b"]);
  assert.deepEqual(priority([],tasks).slots,[null,null,null]);
  tasks[0].deadline="2026-09-08";
  assert.equal(priority(threads,tasks).slots[0]?.thread.id,"THREAD-b");
});
test("reconciliation uses observed snapshots, never authored time",()=>{
  const t=task("TASK-one");
  assert.equal(reconcile([event],[t])[0].state,"pending");
  assert.equal(reconcile([event],[{...t,edited:"2026-09-09T00:00:00Z"}])[0].state,"unverified");
  assert.equal(reconcile([event],[])[0].state,"unverified");
  assert.equal(reconcile([event],[{...t,status:"Done"}])[0].state,"aligned");
});
test("reconciliation surfaces Notion tasks with no task-events file as untracked",()=>{
  const t=task("TASK-one");
  assert.equal(reconcile([],[t])[0].state,"untracked");
  assert.equal(reconcile([event],[t,task("TASK-two")]).find(r=>r.task==="TASK-two")?.state,"untracked");
});
test("repository inventory rejects duplicate IDs and accepts flexible knowledge folders",async()=>{
  const root=await mkdtemp(join(tmpdir(),"kb-inventory-"));
  await mkdir(join(root,"proposals"));
  const content="---\nid: PROP-0001\ntags: []\n---\n# Example\n";
  await writeFile(join(root,"proposals","a.md"),content);
  await writeFile(join(root,"proposals","b.md"),content);
  await mkdir(join(root,"knowledge","new","flexible"),{recursive:true});
  const out=await inventory(root);
  assert.equal(out.artifacts.length,0);assert.match(out.warnings[0],/Duplicate/);
  assert.throws(()=>frontmatter("---\nid: a\nid: b\n---\n"),/Invalid YAML/);
});
test("Notion pagination follows cursors",async()=>{
  let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));
    if(calls===1){assert.equal(body.start_cursor,undefined);return Response.json({results:[{id:"one"}],has_more:true,next_cursor:"next"});}
    assert.equal(body.start_cursor,"next");return Response.json({results:[{id:"two"}],has_more:false});
  };
  const api=new Notion("test","2025-09-03",fetcher);
  assert.equal((await api.query("source")).length,2);
});
test("missing access and HTTP errors are explicit and redact credentials",async()=>{
  assert.throws(()=>new Notion("","v"),/missing credential/);
  const api=new Notion("SECRET","v",async()=>new Response("SECRET",{status:403}));
  await assert.rejects(api.query("x"),e=>e instanceof Error && !e.message.includes("SECRET") && e.message.includes("403"));
});

test("task relations resolve Work Thread pages to stable thread IDs",async()=>{
  const taskPage:any={id:"task-page",last_edited_time:"2026-09-08T01:00:00Z",properties:{
    Name:{title:[{plain_text:"Task"}]},ID:rich("TASK-one"),Status:{status:{name:"In Progress"}},
    Thread:{relation:[{id:"thread-page"}],has_more:false},Deadline:{date:null}}};
  const threadPage={id:"thread-page",last_edited_time:"2026-09-08T00:00:00Z",properties:{ID:rich("THREAD-alpha")}};
  const api=new Notion("test","v",async(url)=>Response.json({
    results:String(url).includes("/tasks/")?[taskPage]:[threadPage],has_more:false}));
  assert.equal((await readAutomationTasks(api,config))[0].thread,"THREAD-alpha");
  taskPage.properties.Thread={relation:[{id:"thread-page"},{id:"other"}],has_more:false};
  await assert.rejects(readAutomationTasks(api,config),/Invalid Task.Thread/);
  taskPage.properties.Thread={relation:[{id:"thread-page"}],has_more:false};taskPage.properties.Deadline={date:{start:"not-a-date"}};
  await assert.rejects(readAutomationTasks(api,config),/Invalid Task deadline/);
});

test("explicit rate limits retry reads",async()=>{
  let calls=0;
  const api=new Notion("test","v",async()=>++calls===1?new Response("",{status:429,headers:{"retry-after":"0"}}):Response.json({results:[],has_more:false}));
  assert.deepEqual(await api.query("source"),[]);assert.equal(calls,2);
});

function fakeNotion() {
  const pages:any[]=[{id:"page-one",source:"tasks",last_edited_time:event.expectedEdited,properties:{ID:rich("TASK-one"),Status:{status:{name:"In Progress"}}}}];
  let patches=0;
  const api=new Notion("test","v",async(url,init)=>{
    const path=new URL(String(url)).pathname.replace("/v1/","");
    const body=init?.body?JSON.parse(String(init.body)):null;
    if(path.endsWith("/query")){
      const source=path.split("/")[1];const id=body.filter?.rich_text?.equals;
      return Response.json({results:pages.filter(p=>p.source===source&&(!id||plain(p.properties.ID)===id)),has_more:false});
    }
    const p=pages.find(p=>p.id===path.split("/")[1]);
    if(init?.method==="PATCH"){
      patches++;p.properties={...p.properties,...body.properties};p.last_edited_time="2026-09-08T02:00:00.000Z";
    }
    return Response.json(p);
  });
  return {api,pages,patches:()=>patches};
}
const data=(events:TaskEvent[]):Inventory=>({threads:[],artifacts:[],events,warnings:[]});
test("publication applies explicit status once and replay is idempotent",async()=>{
  const f=fakeNotion();
  const a=await publish(f.api,config,data([event]),"abc");
  assert.deepEqual(a.errors,[]);assert.equal(f.patches(),1);
  await publish(f.api,config,data([event]),"abc");
  assert.equal(f.patches(),1);assert.equal(f.pages.length,1);
});
test("Work Thread project publishes to a multi-select property",async()=>{
  let created:any;
  const api=new Notion("test","v",async(url,init)=>{
    const path=new URL(String(url)).pathname.replace("/v1/","");
    if(path.endsWith("/query"))return Response.json({results:[],has_more:false});
    created=JSON.parse(String(init?.body));return Response.json({id:"thread-page",properties:created.properties});
  });
  const item={...thread("THREAD-alpha"),project:"project:alpha"};
  const result=await publish(api,config,{threads:[item],artifacts:[],events:[],warnings:[]},"abc");
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(created.properties.Project,{multi_select:[{name:"project:alpha"}]});
});
test("an already-applied task is skipped without another write",async()=>{
  const f=fakeNotion();
  f.pages[0].properties.Status={status:{name:"Done"}};
  const result=await publish(f.api,config,data([event]),"abc");
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.skipped,[event.taskId]);
  assert.equal(f.patches(),0);
});
test("publication tolerates same-minute last_edited_time drift but not a real minute change",async()=>{
  const f=fakeNotion();f.pages[0].last_edited_time="2026-09-08T01:00:45Z";
  assert.deepEqual((await publish(f.api,config,data([event]),"abc")).errors,[]);assert.equal(f.patches(),1);
  const g=fakeNotion();g.pages[0].last_edited_time="2026-09-08T01:01:00Z";
  assert.equal((await publish(g.api,config,data([event]),"abc")).errors.length,1);assert.equal(g.patches(),0);
});
test("publication refuses stale snapshots; duplicate taskId entries are each evaluated independently",async()=>{
  const f=fakeNotion();f.pages[0].last_edited_time="2026-09-08T03:00:00Z";
  assert.equal((await publish(f.api,config,data([event]),"abc")).errors.length,1);assert.equal(f.patches(),0);
  const g=fakeNotion();
  const result=await publish(g.api,config,data([event,{...event}]),"abc");
  assert.deepEqual(result.errors,[]);
  assert.equal(g.patches(),1);
  assert.deepEqual(result.published,[event.taskId]);assert.deepEqual(result.skipped,[event.taskId]);
});
test("capture accepts only unchanged reviewed batches and never silently resets overlap",()=>{
  const raw="2026/09/08\n09:00\tA\tAgree?\n09:01\tB\tMaybe";
  const b=prepare(raw);assert.equal(b.pending.length,3);
  const state=accept(b,raw,undefined,"Human");
  assert.equal(prepare(raw,state).pending.length,0);
  assert.equal(prepare(raw+"\n09:02\tA\tLet's decide later",state).pending.length,1);
  assert.throws(()=>prepare("different"+raw,state),/prefix/);
  assert.throws(()=>accept(b,raw+"\nnew",undefined,"Human"),/Stale/);
  assert.throws(()=>accept(b,raw,undefined,""),/human/);
  assert.equal(prepare(raw.replaceAll("\n","\r\n"),state).pending.length,0);
});
test("private output rejects shared paths and watermark round-trips atomically",async()=>{
  const root=await mkdtemp(join(tmpdir(),"kb-capture-"));
  const shared=join(root,"shared");await mkdir(shared);
  await assert.rejects(privatePath(join(shared,"export.txt"),shared),/outside/);
  const statePath=await privatePath(join(root,"state.json"),shared);
  const b=prepare("hello");const state=accept(b,"hello",undefined,"Human");
  await atomicState(statePath,state);assert.deepEqual(await readState(statePath),state);
  assert.equal(await readFile(statePath,"utf8").then(x=>x.includes("hello")),false);
});

test("a modified event after a prior publish is reported rather than reapplied",async()=>{
  const f=fakeNotion();await publish(f.api,config,data([event]),"abc");
  const result=await publish(f.api,config,data([{...event,state:"Not Started"}]),"def");
  assert.match(result.errors[0],/changed since observation/);assert.equal(f.patches(),1);
});
test("MCP snapshot validates schemas and resolves relations deterministically",()=>{
  const value=snapshot();assert.deepEqual(inspectSnapshot(value,config).problems,[]);
  const result=readSnapshot(value,config);
  assert.equal(result.tasks[0].thread,"THREAD-alpha");
  const duplicate=snapshot();duplicate.tasks.push({...duplicate.tasks[0],pageId:"another-task-page"});
  assert(inspectSnapshot(duplicate,config).problems.includes("Duplicate Task ID or page in MCP snapshot"));
});
test("MCP snapshot rejects stale, incomplete, and mismatched observations",()=>{
  const stale=snapshot();stale.capturedAt="2026-09-08T00:00:00Z";
  assert(inspectSnapshot(stale,config,Date.parse("2026-09-08T00:16:00Z")).problems.some(x=>x.includes("older")));
  const incomplete=snapshot();incomplete.coverage.tasks=false;
  assert.throws(()=>readSnapshot(incomplete,config),/coverage/);
  const mismatched=snapshot();mismatched.targets.tasks="other";
  assert.throws(()=>readSnapshot(mismatched,config),/targets/);
});
test("MCP snapshot requires exact relation targets",()=>{
  const relation=snapshot();relation.schemas.task.relationTargets={Thread:"other"};
  assert(inspectSnapshot(relation,config).problems.includes("Task.Thread relation should target Work Thread"));
});
test("endless pagination stops instead of returning partial success",async()=>{
  const api=new Notion("test","v",async()=>Response.json({results:[],has_more:true,next_cursor:"same"}));
  await assert.rejects(api.query("x"),/pagination/);
});
test("malformed input is isolated from valid independent artifacts",async()=>{
  const root=await mkdtemp(join(tmpdir(),"kb-malformed-"));await mkdir(join(root,"decisions"));
  await writeFile(join(root,"decisions","bad.md"),"not frontmatter");
  await writeFile(join(root,"decisions","good.md"),"---\nid: DEC-0001\ntags: []\n---\n# Good\n");
  const result=await inventory(root);assert.equal(result.artifacts.length,1);assert.equal(result.warnings.length,1);
});
