import type {Config, State, Task} from "./model.ts";
import {states, validDate} from "./model.ts";

export type Page = {id:string; last_edited_time:string; properties: Record<string, any>};
export const rich = (s:string) => ({rich_text:[{text:{content:s}}]});
export const title = (s:string) => ({title:[{text:{content:s}}]});
export function plain(p:any):string {
  const parts = p?.rich_text ?? p?.title ?? [];
  return parts.map((x:any)=>x.plain_text ?? x.text?.content ?? "").join("");
}
export class Notion {
  token: string; version: string; fetcher: typeof fetch;
  constructor(token:string, version:string, fetcher:typeof fetch = fetch) {
    if (!token) throw new Error("Notion access unverified: missing credential");
    this.token=token; this.version=version; this.fetcher=fetcher;
  }
  async request(path:string, method="GET", body?:unknown):Promise<any> {
    for(let attempt=0; attempt<4; attempt++){
      const r=await this.fetcher("https://api.notion.com/v1/"+path,{
        method,headers:{Authorization:"Bearer "+this.token,"Notion-Version":this.version,"Content-Type":"application/json"},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)
      });
      if(r.ok) return r.json();
      // Only retry explicit throttling or server failures of reads. A create may have
      // succeeded before an ambiguous failure; re-query its identity on the next run.
      const safe = method === "GET" || path.endsWith("/query");
      if((r.status===429 || (safe && r.status>=500)) && attempt<3){
        const seconds = Number(r.headers.get("retry-after")??2**attempt);
        await new Promise(resolve=>setTimeout(resolve,Math.min(30000,Math.max(1000,seconds*1000)))); continue;
      }
      throw new Error("Notion HTTP "+r.status+" at "+path.split("/")[0]+"; replay after checking publication receipts");
    }
    throw new Error("Notion retry limit");
  }
  async query(source:string, filter?:unknown):Promise<Page[]> {
    const results:Page[]=[]; let cursor:string|undefined; const seen=new Set<string>();
    do {
      const page=await this.request("data_sources/"+encodeURIComponent(source)+"/query","POST",{page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})});
      results.push(...page.results);
      cursor=page.has_more?page.next_cursor:undefined;
      if(page.has_more && (!cursor || seen.has(cursor))) throw new Error("Invalid Notion pagination");
      if(cursor) seen.add(cursor);
    } while(cursor);
    return results;
  }
  async find(source:string,id:string) {
    return this.query(source,{property:"ID",rich_text:{equals:id}});
  }
  // Full resync: repository content is the source of truth for a mirrored page body,
  // so each publish replaces prior blocks rather than diffing them.
  async replacePageBody(pageId:string, blocks:unknown[]) {
    let cursor:string|undefined;
    do {
      const page=await this.request("blocks/"+pageId+"/children?page_size=100"+(cursor?"&start_cursor="+cursor:""));
      for(const child of page.results) await this.request("blocks/"+child.id,"DELETE");
      cursor=page.has_more?page.next_cursor:undefined;
    } while(cursor);
    for(let i=0;i<blocks.length;i+=100)
      await this.request("blocks/"+pageId+"/children","PATCH",{children:blocks.slice(i,i+100)});
  }
}

// GitHub Actions uses this reader to calculate the unattended Dashboard refresh.
// Interactive agents never receive its credential and use MCP snapshots instead.
export async function readAutomationTasks(api:Notion,config:Config):Promise<Task[]> {
  const [pages,threadPages]=await Promise.all([api.query(config.notion.tasks),api.query(config.notion.threads)]);
  const threadByPage=new Map<string,string>();const seenThreadIds=new Set<string>();
  for(const page of threadPages){
    const stable=plain(page.properties.ID);
    if(!/^THREAD-[a-zA-Z0-9-]+$/.test(stable)||seenThreadIds.has(stable))throw new Error("Invalid or duplicate Work Thread ID");
    seenThreadIds.add(stable);threadByPage.set(page.id,stable);
  }
  const tasks=pages.map(page=>{
    const status=page.properties.Status?.status?.name;const stable=plain(page.properties.ID);
    if(!/^TASK-[a-zA-Z0-9-]+$/.test(stable)||!states.includes(status))throw new Error("Invalid Task ID or status");
    const relation=page.properties.Thread?.relation;
    if(!Array.isArray(relation)||relation.length>1||page.properties.Thread?.has_more)throw new Error("Invalid Task.Thread relation");
    const thread=relation.length?threadByPage.get(relation[0]?.id):undefined;
    if(relation.length&&!thread)throw new Error("Unresolved Task.Thread relation");
    const deadline=page.properties.Deadline?.date?.start;
    if(deadline!==undefined&&!validDate(deadline))throw new Error("Invalid Task deadline");
    return {id:stable,pageId:page.id,title:plain(page.properties.Name),status:status as State,thread,deadline,
      edited:page.last_edited_time};
  });
  if(new Set(tasks.map(t=>t.id)).size!==tasks.length)throw new Error("Duplicate Task IDs");
  return tasks;
}
