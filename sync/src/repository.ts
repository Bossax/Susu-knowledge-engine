import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import { validateEvent } from "./model.ts";
import type { Inventory, TaskEvent } from "./model.ts";

async function walk(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, {withFileTypes:true}); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
export function frontmatter(text: string): Record<string, unknown> {
  const match = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("Missing frontmatter");
  const doc = parseDocument(match[1], {uniqueKeys:true});
  if (doc.errors.length) throw new Error("Invalid YAML frontmatter");
  const value = doc.toJS({maxAliasCount:20});
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Frontmatter must be a mapping");
  return value;
}
export function bodyAfterFrontmatter(text: string): string {
  const match = text.replace(/^\uFEFF/, "").match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return (match ? text.slice(match[0].length) : text).trim();
}
export async function inventory(root: string): Promise<Inventory> {
  const out: Inventory = {threads:[],artifacts:[],events:[],warnings:[]};
  for (const tier of ["work","proposals","decisions","task-events"]) {
    for (const file of await walk(join(root,tier))) {
      const path = relative(root,file).replaceAll("\\","/");
      if (tier === "work" ? !/^work\/[^/]+\/README\.md$/.test(path) : !file.endsWith(tier === "task-events" ? ".json" : ".md")) continue;
      try {
        const text = await readFile(file,"utf8");
        if (tier === "task-events") {
          const event = JSON.parse(text) as TaskEvent; validateEvent(event);
          if(path !== "task-events/"+event.taskId+".json") throw new Error("Event filename must match its task ID directly under task-events");
          out.events.push(event); continue;
        }
        const m = frontmatter(text);
        if (typeof m.id !== "string" || !Array.isArray(m.tags) || m.tags.some(t=>typeof t !== "string")) throw new Error("Expected id and tags list");
        const title = String(m.title ?? text.match(/^# (.+)$/m)?.[1] ?? m.id);
        if (tier === "work") {
          const status = text.match(/^Status:\s*(active|dormant|done)\b/m)?.[1];
          if (!/^THREAD-[a-zA-Z0-9-]+$/.test(m.id) || !status) throw new Error("Expected THREAD ID and Status resumption line");
          out.threads.push({id:m.id,title,status:status as "active"|"dormant"|"done",path,tags:m.tags as string[],project:typeof m.project === "string" ? m.project : undefined,body:bodyAfterFrontmatter(text),createdBy:typeof m.created_by === "string" ? m.created_by : undefined,createdOn:typeof m.created_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.created_on) ? m.created_on : undefined});
        } else {
          if (!(tier === "proposals" ? /^PROP-\d{4,}$/ : /^DEC-\d{4,}$/).test(m.id)) throw new Error("Invalid artifact ID");
          out.artifacts.push({id:m.id,title,kind:tier === "proposals" ? "proposal":"decision",path,body:bodyAfterFrontmatter(text)});
        }
      } catch (e) { out.warnings.push(path + ": " + (e as Error).message); }
    }
  }
  for (const key of ["threads","artifacts"] as const) {
    const counts = new Map<string,number>();
    for (const x of out[key]) counts.set(x.id,(counts.get(x.id)??0)+1);
    const dupes = new Set([...counts].filter(([,n])=>n>1).map(([id])=>id));
    for (const id of dupes) out.warnings.push("Duplicate identity excluded: "+id);
    // Exclude every duplicate, rather than picking a winner.
    out[key] = out[key].filter(x=>!dupes.has(x.id)) as never;
  }
  return out;
}
