import {readFile, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
const inside=(root,path)=>{const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
export function identity(remote){
  const m=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote);
  if(!m) throw new Error('Expected an explicit GitHub SSH or HTTPS repository identity');
  return m[1].toLowerCase();
}
async function document(root,path){
  if(typeof path!=='string'||isAbsolute(path)||!inside(root,resolve(root,path)))throw new Error('Protocol path escapes repository');
  const physical=await realpath(resolve(root,path));
  if(!inside(root,physical))throw new Error('Protocol symlink escapes repository');
  await readFile(physical);return physical;
}
export async function manifest(root,expected){
  const m=JSON.parse(await readFile(await document(root,'protocol.json'),'utf8'));
  if(m.version!==1)throw new Error('Unsupported protocol manifest version; update Oversoul');
  if(m.repository.toLowerCase()!==identity(expected))throw new Error('Protocol repository identity mismatch');
  if(m.runtime?.nodeMajor!==24||m.runtime?.nodeMinMinor!==11)throw new Error('Unsupported protocol runtime requirement');
  if(!Array.isArray(m.instructions)||!m.instructions.includes('AGENTS.md')||!m.capabilities)throw new Error('Invalid protocol instructions/capabilities');
  const instructions=await Promise.all(m.instructions.map(p=>document(root,p)));
  for(const c of Object.values(m.capabilities)){
    if(!['interactive','actions'].includes(c.context)||!Array.isArray(c.argv)||!c.argv.length||c.argv.some(a=>typeof a!=='string')||!Array.isArray(c.documents))throw new Error('Invalid capability');
    c.resolvedDocuments=await Promise.all(c.documents.map(p=>document(root,p)));
    // Only a Node entrypoint within the verified repository; never a shell command.
    c.entrypoint=await document(root,c.argv[0]);
  }
  return {...m,instructionPaths:instructions};
}
export async function inspect(workbench,target,fetch=true,fetchRemote=(root)=>git(root,'fetch','--no-tags','origin')){
  const registry=JSON.parse(await readFile(resolve(workbench,'.linked-repos.json'),'utf8'));
  if(registry.version!==1||!registry.targets)throw new Error('Unsupported target registry');
  const names=Object.keys(registry.targets);
  target=target??(names.length===1?names[0]:undefined);
  if(!target||!registry.targets[target])throw new Error('Select a configured target: '+names.join(', '));
  const cfg=registry.targets[target];
  if(typeof cfg.path!=='string'||isAbsolute(cfg.path)||!inside(resolve(workbench),resolve(workbench,cfg.path)))throw new Error('Link must be inside workbench');
  const root=await realpath(resolve(workbench,cfg.path));
  if(await realpath(git(root,'rev-parse','--show-toplevel'))!==root)throw new Error('Link must resolve to worktree root');
  const registered=git(root,'worktree','list','--porcelain').split('\n').filter(x=>x.startsWith('worktree '));
  if(!(await Promise.all(registered.map(x=>realpath(x.slice(9))))).includes(root))throw new Error('Unregistered worktree');
  const common=await realpath(resolve(root,git(root,'rev-parse','--git-common-dir')));
  const own=await realpath(resolve(root,git(root,'rev-parse','--git-dir')));
  if(common===own)throw new Error('Use a dedicated linked worktree, not the primary checkout');
  const remote=git(root,'remote','get-url','origin');
  if(identity(remote)!==identity(cfg.remote))throw new Error('Remote identity mismatch');
  const diagnostics=[];
  if(fetch){try{fetchRemote(root);}catch{diagnostics.push('Fetch failed; remote state is unverified');}}
  const branch=git(root,'branch','--show-current');
  if(!branch)diagnostics.push('Detached HEAD');
  if(branch!==cfg.branch)diagnostics.push('Branch differs from registration');
  let upstream='';try{upstream=git(root,'rev-parse','--abbrev-ref','@{upstream}');}catch{diagnostics.push('Missing upstream');}
  if(upstream!==cfg.upstream||!upstream.startsWith('origin/'))diagnostics.push('Upstream differs from registration');
  const changes=git(root,'status','--porcelain');if(changes)diagnostics.push('Dirty worktree');
  let ahead=null,behind=null;
  if(upstream){[ahead,behind]=git(root,'rev-list','--left-right','--count','HEAD...@{upstream}').split(/\s+/).map(Number);if(ahead)diagnostics.push(behind?'Divergent branch':'Branch ahead of upstream');}
  let protocol=null;try{protocol=await manifest(root,cfg.remote);}catch(e){diagnostics.push(e.message);}
  return {target,root,remote,branch,upstream,revision:git(root,'rev-parse','HEAD'),ahead,behind,changes,diagnostics,protocol,ready:!diagnostics.length&&behind===0};
}
export async function operate(workbench,command,target,capability,args=[],fetchRemote){
  if(!['inspect','prepare','run'].includes(command))throw new Error('Use inspect, prepare, or run');
  let state=await inspect(workbench,target,true,fetchRemote);
  if(command==='inspect')return state;
  if(command==='prepare'&&!state.diagnostics.length&&state.behind>0){
    const check=await inspect(workbench,target,false);
    if(check.revision!==state.revision||check.diagnostics.length)throw new Error('Worktree changed during preparation');
    git(state.root,'merge','--ff-only','@{upstream}');state=await inspect(workbench,target,false);
  }
  if(!state.ready)return {...state,status:'blocked'};
  if(command==='prepare')return {...state,status:'prepared'};
  const c=state.protocol.capabilities[capability];
  if(!c||c.context!=='interactive')throw new Error('Capability unavailable for interactive execution');
  const optionNames=args.filter((_,i)=>i%2===0);
  if(!Array.isArray(c.options)||args.length%2||new Set(optionNames).size!==optionNames.length||args.some((v,i)=>typeof v!=='string'||(i%2===0?!c.options.includes(v):v.startsWith('--'))))throw new Error('Unsupported capability arguments');
  const current=await inspect(workbench,target,false);
  if(!current.ready||current.revision!==state.revision||JSON.stringify(current.protocol)!==JSON.stringify(state.protocol))throw new Error('Worktree changed before execution');
  const result=spawnSync(process.execPath,[c.entrypoint,...c.argv.slice(1),...args],{cwd:state.root,encoding:'utf8',timeout:60000,env:process.env});
  return {target:state.target,revision:state.revision,status:result.status===0?'complete':'unverified',exitCode:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor<11)throw new Error('Use Node 24.11+ within Node 24 LTS');
    const [command,...args]=process.argv.slice(2);const cut=args.indexOf('--');const flags=cut<0?args:args.slice(0,cut);const rest=cut<0?[]:args.slice(cut+1);
    if(flags.length%2||flags.some((v,i)=>i%2===0&&!['--target','--capability'].includes(v)))throw new Error('Unknown client arguments');
    const get=k=>flags.includes(k)?flags[flags.indexOf(k)+1]:undefined;
    const result=await operate(process.cwd(),command,get('--target'),get('--capability'),rest);
    console.log(JSON.stringify(result,null,2));if(result.status==='blocked'||result.status==='unverified'||(command==='inspect'&&!result.ready))process.exitCode=2;
  }catch(e){console.log(JSON.stringify({status:'unverified',error:e.message}));process.exitCode=1;}
}
