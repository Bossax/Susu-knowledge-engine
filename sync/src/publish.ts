import { Notion, rich, title } from "./notion.ts";
import { markdownToBlocks } from "./markdown.ts";
import type { Config, Inventory } from "./model.ts";

// Name-to-Notion-user-ID mapping for task/thread author attribution
const PEOPLE: Record<string,string> = {
  "Bossa": "f55c587b-e15e-4d64-a62a-05e2cee76b0c",
  "Wasurat Soontronchai": "6ebc19c0-6839-4ae7-9124-a517cd8f3969"
};

function resolvePerson(name: string | undefined): {people:[{id:string}]} | undefined {
  if (!name || !PEOPLE[name]) return undefined;
  return {people: [{id: PEOPLE[name]}]};
}

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Notion's REST API truncates last_edited_time to whole minutes; MCP tools used to build an
// observation have been seen reporting finer (second-level) precision for the same page from
// some other internal source. Compare at minute granularity -- Notion's actual precision --
// rather than exact string/millisecond equality, or every MCP-sourced observation not landed
// exactly on the minute boundary reads as a false "Task changed since observation" conflict.
function sameMoment(a: string, b: string): boolean {
  const da = Date.parse(a), db = Date.parse(b);
  return Number.isFinite(da) && Number.isFinite(db) && Math.floor(da / 60000) === Math.floor(db / 60000);
}
export function repoUrl(config:Config,path:string,ref=config.branch) {
  return "https://github.com/"+config.repository+"/blob/"+encodeURIComponent(ref)+"/"+path.split("/").map(encodeURIComponent).join("/");
}
async function upsert(api:Notion, source:string,id:string,properties:Record<string,unknown>) {
  const matches=await api.find(source,id);
  if(matches.length>1) throw new Error("Duplicate Notion identity: "+id);
  if(matches.length) return api.request("pages/"+matches[0].id,"PATCH",{properties});
  return api.request("pages","POST",{parent:{type:"data_source_id",data_source_id:source},properties});
}
async function syncBody(api:Notion, pageId:string, body:string|undefined): Promise<boolean> {
  if(!body) return false;
  const {blocks,truncated}=markdownToBlocks(body);
  await api.replacePageBody(pageId,blocks);
  return truncated;
}
export async function publish(api:Notion, config:Config, data:Inventory, ref:string) {
  const report:{published:string[];skipped:string[];errors:string[];warnings:string[]}={published:[],skipped:[],errors:[],warnings:[...data.warnings]};
  for(const t of data.threads) {
    try{
      const props: Record<string,unknown> = {ID:rich(t.id),Name:title(t.title),
        URL:{url:repoUrl(config,t.path)},Project:{multi_select:t.project?[{name:t.project}]:[]},Tags:{multi_select:t.tags.map(name=>({name}))}};
      if(t.createdBy) {
        const creator = resolvePerson(t.createdBy);
        if(creator) props.created_by = creator;
      }
      if(t.createdOn) {
        props.Duration = {date:{start:t.createdOn,end:addDaysToDate(t.createdOn,5)}};
      }
      const page=await upsert(api,config.notion.threads,t.id,props);
      if(await syncBody(api,page.id,t.body)) report.warnings.push(t.id+": body exceeded 300 Notion blocks and was truncated");
      report.published.push(t.id);
    }catch(e){report.errors.push(t.id+": "+(e as Error).message);}
  }
  for(const a of data.artifacts) {
    try{
      const page=await upsert(api,config.notion.activity,a.id,{ID:rich(a.id),Name:title(a.title),Kind:{select:{name:a.kind}},
        URL:{url:repoUrl(config,a.path)},Revision:rich(ref)});
      if(await syncBody(api,page.id,a.body)) report.warnings.push(a.id+": body exceeded 300 Notion blocks and was truncated");
      report.published.push(a.id);
    }catch(e){report.errors.push(a.id+": "+(e as Error).message);}
  }
  for(const event of data.events) {
    try {
      const pages=await api.find(config.notion.tasks,event.taskId);
      if(pages.length!==1) throw new Error("Missing or duplicate task");
      const page=await api.request("pages/"+pages[0].id);
      const status=page.properties.Status?.status?.name;
      if(status===event.state) { report.skipped.push(event.taskId); continue; }
      if(!sameMoment(page.last_edited_time,event.expectedEdited) || status!==event.expectedStatus)
        throw new Error("Task changed since observation; refresh and record the corrected state");
      const patchProps: Record<string,unknown> = {Status:{status:{name:event.state}}};
      const owner = resolvePerson(event.author);
      if(owner) patchProps.Owner = owner;
      const updated=await api.request("pages/"+page.id,"PATCH",{properties:patchProps});
      // Notion has no conditional update. Detect observable races and leave an explicit report.
      const verified=await api.request("pages/"+page.id);
      if(verified.last_edited_time!==updated.last_edited_time ||
         verified.properties.Status?.status?.name!==event.state)
        throw new Error("Concurrent edit observed after write; inspect task before replay");
      report.published.push(event.taskId);
    }catch(e){report.errors.push(event.taskId+": "+(e as Error).message);}
  }
  return report;
}
export async function dashboard(api:Notion, config:Config, summary:string) {
  // The configured paragraph belongs only to this publisher; other dashboard blocks are untouched.
  return api.request("blocks/"+encodeURIComponent(config.notion.dashboardBlock),"PATCH",{
    paragraph:{rich_text:[{type:"text",text:{content:summary.slice(0,1900)}}]}
  });
}
