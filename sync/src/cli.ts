import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { inventory } from "./repository.ts";
import { priority, reconcile } from "./model.ts";
import type { Config } from "./model.ts";
import { Notion, readAutomationTasks } from "./notion.ts";
import { publish, dashboard } from "./publish.ts";
import { inspectSnapshot, readSnapshot } from "./snapshot.ts";
import { prepare, accept, privatePath, readState, atomicState } from "./capture.ts";
import type { Batch } from "./capture.ts";
import {normalizeFile} from "./normalize.ts";

const [command="help",...args]=process.argv.slice(2);
const option=(key:string,fallback:string)=>{const i=args.indexOf(key); return i<0?fallback:args[i+1]??fallback;};
const root=resolve(option("--root","."));
const output=(value:unknown)=>console.log(JSON.stringify(value,null,2));
function gitBranchStatus(cwd:string){
  try{
    const git=(...a:string[])=>execFileSync("git",["-C",cwd,...a],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:10000}).trim();
    const ref=git("branch","--show-current");
    const [behind,ahead]=git("rev-list","--left-right","--count","@{upstream}...HEAD").split(/\s+/).map(Number);
    const dirty=!!git("status","--porcelain");
    return {ref,ahead,behind,dirty};
  }catch{return null;}
}
async function resolveConfig(rootPath: string, explicitOption?: string): Promise<Config> {
  if (explicitOption) {
    return JSON.parse(await readFile(resolve(explicitOption), "utf8")) as Config;
  }
  const projectJson = resolve(rootPath, ".shrimp", "project.json");
  try {
    return JSON.parse(await readFile(projectJson, "utf8")) as Config;
  } catch {}
  return JSON.parse(await readFile(resolve(rootPath, "config.json"), "utf8")) as Config;
}
try{
  if(command==="help") {
    console.log("npm run kb -- list | doctor | compare | publish | dashboard [--root DIR] [--config FILE] [--snapshot FILE]\nAgent reads: doctor/compare consume an MCP snapshot (default private/notion-snapshot.json).\nCapture: capture-prepare or capture-accept --export FILE --state FILE --batch FILE [--accepted-by HUMAN]\nAutomated writes: GitHub Actions only, NOTION_WRITE_TOKEN.");
  }else if(command==="normalize-snapshot"){
    const input=option("--input","");if(!input)throw new Error("Missing --input observation JSON");
    const config=await resolveConfig(root, option("--config","")||undefined);
    if(!config.notion.workspaceId)throw new Error("Configure expected Notion workspaceId before normalization");
    output(await normalizeFile(root,resolve(input),resolve(option("--output",resolve(root,"private/notion-snapshot.json"))),config));
  }else if(command==="capture-prepare" || command==="capture-accept"){
    const required=(key:string)=>{const value=option(key,"");if(!value)throw new Error("Missing "+key);return value;};
    const sourcePath=await privatePath(required("--export"),root);
    const statePath=await privatePath(required("--state"),root);
    const batchPath=await privatePath(required("--batch"),root);
    if(new Set([sourcePath,statePath,batchPath].map(x=>process.platform==="win32"?x.toLowerCase():x)).size!==3) throw new Error("Use separate export, state, and batch files");
    const source=await readFile(sourcePath,"utf8");
    const state=await readState(statePath);
    if(command==="capture-prepare"){
      const batch=prepare(source,state);
      await writeFile(batchPath,JSON.stringify(batch,null,2)+"\n",{flag:"wx",mode:0o600});
      output({batch:batch.id,pendingLines:batch.pending.length,notes:batch.notes});
    }else{
      const lock=statePath+".lock";
      await writeFile(lock,String(process.pid),{flag:"wx",mode:0o600});
      try {
        const batch=JSON.parse(await readFile(batchPath,"utf8")) as Batch;
        const current=await readState(statePath);
        const next=accept(batch,await readFile(sourcePath,"utf8"),current,required("--accepted-by"));
        await atomicState(statePath,next);output({accepted:next.acceptedBatch,lines:next.lineHashes.length});
      } finally {await unlink(lock);}
    }
  }else{
    if(!["list","doctor","health","compare","publish","dashboard"].includes(command)) throw new Error("Unknown command");
    const data=await inventory(root);
    if(command==="list"){output(data);if(data.warnings.length)process.exitCode=2;}
    else{
      const config=await resolveConfig(root, option("--config","")||undefined);
      if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) || config.repository==="OWNER/REPO" || config.branch!=="main")
        throw new Error("Configure actual repository coordinates and main branch");
      if(Object.values(config.notion).some(x=>!x || /_ID$/.test(x))) throw new Error("Complete Notion setup identifiers");
      const writing=command==="publish"||command==="dashboard";
      if(writing && (process.env.GITHUB_ACTIONS!=="true" || process.env.GITHUB_REF!=="refs/heads/main" ||
          process.env.GITHUB_REPOSITORY!==config.repository)) throw new Error("Notion writes run only in the configured shared repository's main-branch Actions");
      if(command==="doctor" || command==="health"){
        const snapshot=JSON.parse(await readFile(resolve(option("--snapshot","private/notion-snapshot.json")),"utf8"));
        const result=inspectSnapshot(snapshot,config);output(result);if(result.problems.length)process.exitCode=2;
      }else if(command==="publish"){
        const api=new Notion(process.env.NOTION_WRITE_TOKEN??"",config.notion.version);
        const ref=process.env.GITHUB_SHA??"";
        if(!/^[a-f0-9]{40}$/.test(ref)) throw new Error("Missing GitHub revision");
        const report=await publish(api,config,data,ref); output(report);
        if(report.errors.length || report.warnings.length) process.exitCode=2;
      }else if(command==="compare"){
        const snapshot=JSON.parse(await readFile(resolve(option("--snapshot","private/notion-snapshot.json")),"utf8"));
        const {tasks}=readSnapshot(snapshot,config);
        const ranking=priority(data.threads,tasks);
        const result={refreshed:new Date().toISOString(),priority:ranking,reconciliation:reconcile(data.events,tasks),
          branch:gitBranchStatus(root),
          warnings:data.warnings,overdueStandalone:tasks.filter(t=>!t.thread && t.status!=="Done" && t.deadline && Date.parse(t.deadline)<Date.now()),
          dormantWithOpenTasks:data.threads.filter(t=>t.status==="dormant" && tasks.some(task=>task.thread===t.id&&task.status!=="Done")).map(t=>t.id),
          tasks};
        output(result);
      }else{
        const api=new Notion(process.env.NOTION_WRITE_TOKEN??"",config.notion.version);
        const tasks=await readAutomationTasks(api,config);const ranking=priority(data.threads,tasks);
        const overdue=tasks.filter(t=>!t.thread&&t.status!=="Done"&&t.deadline&&Date.parse(t.deadline)<Date.now());
        const refreshed=new Date().toISOString();
        const lines=ranking.slots.map((x,i)=>(i+1)+". "+(x?x.thread.title+" ["+x.thread.id+"] "+(x.deadline??"deadline-free"):"(empty)"));
        await dashboard(api,config,"Refreshed "+refreshed+"\n"+lines.join("\n")+"\nTies: "+(ranking.ties.join(", ")||"none")+
          "\nOverdue standalone tasks: "+overdue.length+"\nRun compare for divergence details.");
        output({refreshed,priority:ranking,overdueStandalone:overdue});
      }
    }
  }
}catch(e){output({status:"unverified",error:(e as Error).message});process.exitCode=1;}
