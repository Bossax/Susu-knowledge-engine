import {readFile, writeFile, mkdir, realpath, rename, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Config} from './model.ts';
import {inspectSnapshot} from './snapshot.ts';
import type {NotionSnapshot} from './snapshot.ts';

const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const aliases:Record<string,string>={text:'rich_text',person:'people'};
const known=new Set(['title','rich_text','url','multi_select','status','people','date','relation','select']);

/** Versioned structured observation, not a parser for arbitrary MCP prose. */
export function normalizeObservation(input:unknown,config:Config):NotionSnapshot {
  if(!object(input)||input.version!==1||!object(input.snapshot))throw new Error('Observation requires version: 1 and snapshot object');
  const s=structuredClone(input.snapshot);
  if(!object(s.schemas))throw new Error('Observation schemas are missing');
  for(const name of ['workThread','task','activity']){
    const schema=s.schemas[name];
    if(!object(schema)||!object(schema.properties))throw new Error('Missing '+name+' schema');
    for(const [key,value] of Object.entries(schema.properties)){
      if(typeof value!=='string')throw new Error('Schema property types must be strings');
      const type=aliases[value]??value;
      if(!known.has(type))throw new Error('Unsupported property representation: '+name+'.'+key+' '+value);
      schema.properties[key]=type;
    }
  }
  // Rows deliberately use the documented canonical fields. Identity, relation,
  // people and timestamp extraction is explicit in the observation contract.
  // No values, completion markers, timestamps or duplicate removals are inferred.
  const result=inspectSnapshot(s,config);
  if(result.problems.length)throw new Error(result.problems.join('; '));
  return s as NotionSnapshot;
}

export async function normalizeFile(root:string,input:string,output:string,config:Config){
  const actualRoot=await realpath(root);
  const privateDir=resolve(actualRoot,'private');
  await mkdir(privateDir,{recursive:true});
  if(await realpath(privateDir)!==privateDir)throw new Error('Private snapshot directory must not be a symlink');
  const target=resolve(output);
  if(target!==resolve(privateDir,'notion-snapshot.json'))throw new Error('Output must be private/notion-snapshot.json in this repository');
  if(resolve(input)===target)throw new Error('Input and output must be different files');
  // Invalidate the previous observation before attempting conversion so a failed
  // refresh cannot accidentally reuse an older, still-within-TTL snapshot.
  const invalid=JSON.stringify({version:1,warnings:['Normalization in progress or failed; recapture required']})+'\n';
  const atomic=async(text:string)=>{
    const temp=resolve(dirname(target),'.snapshot-'+randomUUID()+'.tmp');
    try{await writeFile(temp,text,{flag:'wx',mode:0o600});await rename(temp,target);}
    finally{await rm(temp,{force:true});}
  };
  await atomic(invalid);
  const snapshot=normalizeObservation(JSON.parse(await readFile(input,'utf8')),config);
  await atomic(JSON.stringify(snapshot,null,2)+'\n');
  return {status:'ready',output:target,capturedAt:snapshot.capturedAt};
}
