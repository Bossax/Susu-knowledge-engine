import type {Config, State, Task} from "./model.ts";
import {states, validDate} from "./model.ts";

type SourceSchema={dataSourceId:string;properties:Record<string,string>;statusOptions?:string[];relationTargets?:Record<string,string>};
export type NotionSnapshot={
  version:1; capturedAt:string; workspace:{id:string;name:string};
  targets:{threads:string;tasks:string;activity:string;dashboardBlock:string};
  coverage:{workThreads:boolean;tasks:boolean};
  schemas:{workThread:SourceSchema;task:SourceSchema;activity:SourceSchema};
  dashboard:{blockId:string;type:string}; warnings:string[];
  workThreads:{pageId:string;id:string;name:string;project:string[];tags:string[]}[];
  tasks:{pageId:string;id:string;name:string;status:State;deadline?:string;threadPageIds:string[];lastEdited:string}[];
};

const id=(value:string)=>value.replaceAll("-","").toLowerCase();
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const strings=(value:unknown)=>Array.isArray(value)&&value.every(x=>typeof x==="string");
const expected={
  workThread:{Name:"title",ID:"rich_text",URL:"url",Project:"multi_select",Tags:"multi_select",created_by:"people",Duration:"date"},
  task:{Name:"title",ID:"rich_text",Status:"status",Owner:"people",Deadline:"date",Thread:"relation"},
  activity:{Name:"title",ID:"rich_text",Kind:"select",URL:"url",Revision:"rich_text",Fingerprint:"rich_text"}
} as const;

function rowProblems(s:NotionSnapshot):string[]{
  const problems:string[]=[];
  if(!Array.isArray(s.workThreads)||!Array.isArray(s.tasks))return ["Snapshot row arrays are missing"];
  const threadIds=new Set<string>();const threadPages=new Set<string>();
  for(const thread of s.workThreads){
    if(!record(thread)||typeof thread.pageId!=="string"||!thread.pageId||typeof thread.name!=="string"||
        !/^THREAD-[a-zA-Z0-9-]+$/.test(thread.id)||!strings(thread.project)||!strings(thread.tags)){
      problems.push("Invalid Work Thread row in MCP snapshot");continue;
    }
    if(threadIds.has(thread.id)||threadPages.has(thread.pageId))problems.push("Duplicate Work Thread ID or page in MCP snapshot");
    threadIds.add(thread.id);threadPages.add(thread.pageId);
  }
  const taskIds=new Set<string>();const taskPages=new Set<string>();
  for(const task of s.tasks){
    if(!record(task)||typeof task.pageId!=="string"||!task.pageId||typeof task.name!=="string"||
        !/^TASK-[a-zA-Z0-9-]+$/.test(task.id)||!states.includes(task.status)||
        !strings(task.threadPageIds)||task.threadPageIds.length>1||!validDate(task.lastEdited)||
        (task.deadline!==undefined&&!validDate(task.deadline))){
      problems.push("Invalid Task row in MCP snapshot");continue;
    }
    if(taskIds.has(task.id)||taskPages.has(task.pageId))problems.push("Duplicate Task ID or page in MCP snapshot");
    if(task.threadPageIds.length&&!threadPages.has(task.threadPageIds[0]))problems.push("Task relation does not resolve to a valid Work Thread row");
    taskIds.add(task.id);taskPages.add(task.pageId);
  }
  return problems;
}

export function snapshotProblems(value:unknown,config:Config,now=Date.now()):string[]{
  const s=value as NotionSnapshot;const problems:string[]=[];
  if(!record(s)||s.version!==1)return ["Snapshot must use version 1"];
  if(!record(s.workspace)||typeof s.workspace.id!=="string"||!s.workspace.id||typeof s.workspace.name!=="string"||!s.workspace.name)
    problems.push("Snapshot workspace identity is missing");
  if(config.notion.workspaceId && (!record(s.workspace)||typeof s.workspace.id!=="string"||id(s.workspace.id)!==id(config.notion.workspaceId)))
    problems.push("Snapshot workspace identity does not match config.json");
  if(!validDate(s.capturedAt))problems.push("Snapshot capturedAt is invalid");
  else {const age=now-Date.parse(s.capturedAt);if(age>15*60_000)problems.push("Snapshot is older than 15 minutes");if(age < -5*60_000)problems.push("Snapshot capturedAt is in the future");}
  if(!record(s.targets)||id(s.targets.threads??"")!==id(config.notion.threads)||id(s.targets.tasks??"")!==id(config.notion.tasks)||
      id(s.targets.activity??"")!==id(config.notion.activity)||id(s.targets.dashboardBlock??"")!==id(config.notion.dashboardBlock))
    problems.push("Snapshot targets do not match config.json");
  if(!record(s.coverage)||s.coverage.workThreads!==true||s.coverage.tasks!==true)
    problems.push("Work Thread or Task query coverage is incomplete");
  if(!strings(s.warnings))problems.push("Snapshot warnings must be an array of strings");
  else problems.push(...s.warnings.map(x=>"MCP capture warning: "+x));
  if(!record(s.schemas))problems.push("Snapshot schemas are missing");
  else for(const [key,schemaExpected] of Object.entries(expected)){
    const schema=s.schemas[key as keyof typeof expected];
    if(!record(schema)||!record(schema.properties)){problems.push(key+" schema is missing");continue;}
    const configured=key==="workThread"?config.notion.threads:key==="task"?config.notion.tasks:config.notion.activity;
    if(id(schema.dataSourceId??"")!==id(configured))problems.push(key+" schema target does not match config.json");
    for(const [name,type] of Object.entries(schemaExpected))if(schema.properties[name]!==type)problems.push(key+"."+name+" should be "+type);
  }
  const taskSchema=s.schemas?.task;
  if(record(taskSchema)){
    if(!states.every(state=>taskSchema.statusOptions?.includes(state)))for(const state of states)if(!taskSchema.statusOptions?.includes(state))problems.push("Missing task state: "+state);
    if(id(taskSchema.relationTargets?.Thread??"")!==id(config.notion.threads))problems.push("Task.Thread relation should target Work Thread");
  }
  if(!record(s.dashboard)||id(s.dashboard.blockId??"")!==id(config.notion.dashboardBlock)||s.dashboard.type!=="paragraph")
    problems.push("Dashboard block must be the configured dedicated paragraph");
  problems.push(...rowProblems(s));
  return [...new Set(problems)];
}

export function inspectSnapshot(value:unknown,config:Config,now=Date.now()){
  const problems=snapshotProblems(value,config,now);
  const s=value as {capturedAt?:string};
  const expiresAt=typeof s?.capturedAt==="string"&&validDate(s.capturedAt)?new Date(Date.parse(s.capturedAt)+15*60_000).toISOString():undefined;
  return {status:problems.length?"unverified":"ready",expiresAt,problems};
}

export function readSnapshot(value:unknown,config:Config,now=Date.now()){
  const problems=snapshotProblems(value,config,now);
  if(problems.length)throw new Error(problems.join("; "));
  const s=value as NotionSnapshot;
  const threadByPage=new Map<string,string>();const threadIds=new Set<string>();
  for(const t of s.workThreads){
    if(!record(t)||!/^THREAD-[a-zA-Z0-9-]+$/.test(t.id)||typeof t.pageId!=="string"||threadIds.has(t.id)||threadByPage.has(t.pageId)||
        !strings(t.project)||!strings(t.tags))throw new Error("Invalid or duplicate Work Thread row in MCP snapshot");
    threadIds.add(t.id);threadByPage.set(t.pageId,t.id);
  }
  const taskIds=new Set<string>();const tasks:Task[]=[];
  for(const t of s.tasks){
    if(!record(t)||!/^TASK-[a-zA-Z0-9-]+$/.test(t.id)||taskIds.has(t.id)||typeof t.pageId!=="string"||typeof t.name!=="string"||
        !states.includes(t.status)||!strings(t.threadPageIds)||t.threadPageIds.length>1||!validDate(t.lastEdited)||
        (t.deadline!==undefined&&!validDate(t.deadline)))throw new Error("Invalid or duplicate Task row in MCP snapshot");
    const thread=t.threadPageIds.length?threadByPage.get(t.threadPageIds[0]):undefined;
    if(t.threadPageIds.length&&!thread)throw new Error("Task relation does not resolve to a valid Work Thread row");
    taskIds.add(t.id);tasks.push({id:t.id,pageId:t.pageId,title:t.name,status:t.status,thread,deadline:t.deadline,edited:t.lastEdited});
  }
  return {snapshot:s,tasks};
}
