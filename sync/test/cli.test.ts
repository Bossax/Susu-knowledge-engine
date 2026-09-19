import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root=fileURLToPath(new URL("../",import.meta.url));
const run=(args:string[])=>spawnSync(process.execPath,[join(root,"src","cli.ts"),...args],{cwd:root,encoding:"utf8"});
const snapshot=(capturedAt:string)=>({version:1,capturedAt,workspace:{id:"workspace",name:"Team"},
  targets:{threads:"threads",tasks:"tasks",activity:"activity",dashboardBlock:"block"},
  coverage:{workThreads:true,tasks:true},warnings:[],
  schemas:{workThread:{dataSourceId:"threads",properties:{Name:"title",ID:"rich_text",URL:"url",Project:"multi_select",Tags:"multi_select",created_by:"people",Duration:"date"}},
    task:{dataSourceId:"tasks",properties:{Name:"title",ID:"rich_text",Status:"status",Owner:"people",Deadline:"date",Thread:"relation"},statusOptions:["Backlog","Not Started","In Progress","Blocked","Done"],relationTargets:{Thread:"threads"}},
    activity:{dataSourceId:"activity",properties:{Name:"title",ID:"rich_text",Kind:"select",URL:"url",Revision:"rich_text",Fingerprint:"rich_text"}}},
  dashboard:{blockId:"block",type:"paragraph"},workThreads:[],tasks:[]});
test("capture CLI keeps raw text private, accepts reviewed batch, detects replay",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"kb-cli-"));const shared=join(dir,"shared");await mkdir(shared);
  const source=join(dir,"export.txt"),state=join(dir,"watermark.json"),batch=join(dir,"batch.json");
  await writeFile(source,"2026/09/08\n09:00\tHuman\tPRIVATE TRANSCRIPT");
  const args=["--root",shared,"--export",source,"--state",state,"--batch",batch];
  const p=run(["capture-prepare",...args]);assert.equal(p.status,0,p.stderr+p.stdout);
  assert(!p.stdout.includes("PRIVATE TRANSCRIPT"));
  assert((await readFile(batch,"utf8")).includes("PRIVATE TRANSCRIPT"));
  const a=run(["capture-accept",...args,"--accepted-by","Human"]);assert.equal(a.status,0,a.stdout);
  const repeat=run(["capture-prepare","--root",shared,"--export",source,"--state",state,"--batch",join(dir,"batch2.json")]);
  assert.equal(JSON.parse(repeat.stdout).pendingLines,0);
  const overwrite=run(["capture-prepare",...args]);assert.notEqual(overwrite.status,0);
});
test("Actions workflow is disabled by default and does not introduce CI triggers",async()=>{
  const yaml=parse(await readFile(join(root,"templates","notion.yml"),"utf8"));
  assert.deepEqual(yaml.on.push.branches,["main"]);
  assert.equal(yaml.on.pull_request,undefined);
  assert.equal(yaml.jobs.publish.if,"vars.NOTION_ENABLED == 'true'");
  assert.equal(yaml.permissions.contents,"read");
});
test("local publishing rejects even a supplied local write credential",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"kb-write-guard-"));const config=join(dir,"config.json");
  await writeFile(config,JSON.stringify({repository:"example/team",branch:"main",notion:{version:"2025-09-03",threads:"a",tasks:"b",activity:"c",dashboardBlock:"d"}}));
  const p=spawnSync(process.execPath,[join(root,"src","cli.ts"),"publish","--config",config],{cwd:root,encoding:"utf8",env:{...process.env,GITHUB_ACTIONS:"false",NOTION_WRITE_TOKEN:"PRIVATE TOKEN"}});
  assert.notEqual(p.status,0);assert.match(p.stdout,/only in the configured/);assert(!p.stdout.includes("PRIVATE TOKEN"));
});
test("agent compare uses a validated MCP snapshot without a Notion token",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"kb-mcp-"));const config=join(dir,"config.json"),observation=join(dir,"snapshot.json");
  await writeFile(config,JSON.stringify({repository:"example/team",branch:"main",notion:{version:"2025-09-03",threads:"threads",tasks:"tasks",activity:"activity",dashboardBlock:"block"}}));
  await writeFile(observation,JSON.stringify(snapshot(new Date().toISOString())));
  const env={...process.env};delete env.NOTION_READ_TOKEN;delete env.NOTION_WRITE_TOKEN;
  const p=spawnSync(process.execPath,[join(root,"src","cli.ts"),"compare","--config",config,"--snapshot",observation],{cwd:root,encoding:"utf8",env});
  assert.equal(p.status,0,p.stdout+p.stderr);assert.deepEqual(JSON.parse(p.stdout).priority.slots,[null,null,null]);
});
