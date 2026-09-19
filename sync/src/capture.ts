import { createHash } from "node:crypto";
import { readFile, writeFile, rename, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
export type Watermark = {version:1; lineHashes:string[]; acceptedBatch:string; acceptedBy:string; acceptedAt:string};
export type Batch = {version:1; id:string; base:string[]; lineHashes:string[]; pending:{line:number;text:string}[]; notes:string[]};
export const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
export function prepare(text:string,state?:Watermark):Batch {
  const lines=text.replace(/^\uFEFF/,"").replaceAll("\r\n","\n").replaceAll("\r","\n").replace(/\n+$/,"").split("\n");
  const hashes=lines.map(digest);
  const base=state?.lineHashes??[];
  if(state && (state.version!==1 || !Array.isArray(base))) throw new Error("Invalid watermark");
  if(base.length>hashes.length || base.some((hash,i)=>hash!==hashes[i]))
    throw new Error("Export prefix changed or overlaps differently; review against prior accepted export before resetting state");
  return {version:1,id:digest(hashes.join("\n")),base,lineHashes:hashes,
    pending:lines.slice(base.length).map((text,i)=>({line:base.length+i+1,text})),
    notes:["Input remains an untrusted private transcript. Infer decisions only during human-reviewed extraction.",
      "Attachments, images, stickers, and unsupported export content are not extracted; surface them as omissions.",
      "Source line numbers refer to this normalized export, not stable message identifiers."]};
}
export function accept(batch:Batch,source:string,current:Watermark|undefined,acceptedBy:string):Watermark {
  if(!acceptedBy.trim()) throw new Error("Name the human accepting this extraction outcome");
  const fresh=prepare(source,current);
  if(batch.version!==1 || batch.id!==fresh.id || JSON.stringify(batch.lineHashes)!==JSON.stringify(fresh.lineHashes) ||
      JSON.stringify(batch.base)!==JSON.stringify(fresh.base)) throw new Error("Stale or changed extraction batch; prepare again");
  return {version:1,lineHashes:fresh.lineHashes,acceptedBatch:fresh.id,acceptedBy,acceptedAt:new Date().toISOString()};
}
export async function privatePath(path:string,sharedRoot:string):Promise<string> {
  const target=resolve(path);
  let physical:string;
  try { physical=await realpath(target); }
  catch(e) {if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e; physical=resolve(await realpath(dirname(target)),target.split(/[\\/]/).at(-1)!);}
  const root=await realpath(sharedRoot);
  const rel=relative(root,physical);
  if(!rel || (!rel.startsWith(".."+(process.platform==="win32"?"\\":"/")) && rel!==".." && !isAbsolute(rel)))
    throw new Error("Raw exports, batches, and watermarks must be outside the shared repository");
  return physical;
}
export async function readState(path:string):Promise<Watermark|undefined> {
  try{return JSON.parse(await readFile(path,"utf8"));}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw e;}
}
export async function atomicState(path:string,state:Watermark) {
  const temp=path+"."+process.pid+".tmp";
  await writeFile(temp,JSON.stringify(state,null,2)+"\n",{flag:"wx",mode:0o600});
  await rename(temp,path);
}
