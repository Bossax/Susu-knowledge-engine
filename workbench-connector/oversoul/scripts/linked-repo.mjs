import {readFile, writeFile, mkdir, rm, rename, cp, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, join, dirname} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

// This file ships standalone inside the installed skill (.claude/skills/oversoul/scripts/) --
// shared/ is never installed alongside it, so it cannot import from there and reimplements the
// few small pieces it needs (see compareVersions, replaceTree below), matching the git/inside/
// isReallyDirty helpers just below which already follow this same rule.
const DEFAULT_OWN_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
const inside=(root,path)=>{const rel=relative(root,path);return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
// `git status --porcelain` also flags files whose only "change" is CRLF/LF normalization noise
// (autocrlf), with zero real content at risk. Untracked files are always real; for tracked files,
// fall back to a content-level diff against HEAD -- an empty diff means nothing is actually dirty.
function isReallyDirty(root,statusPorcelain){
  if(statusPorcelain.split('\n').some(line=>line.startsWith('??')))return true;
  try{return !!git(root,'diff','--stat','HEAD');}
  catch{return true;}
}
// Classifies a failed `git fetch` from its real stderr/message so the recovery action differs by
// cause (network vs auth vs remote vs corruption) instead of one opaque "fetch failed" string that
// makes a sandboxed network boundary look identical to an actual Git/remote failure.
function classifyFetchError(error){
  const text=String(error?.stderr||error?.message||error).trim();
  const low=text.toLowerCase();
  if(/repository not found|does not appear to be a git repository/.test(low))
    return {category:'repository',action:'Confirm the remote URL and that the repository still exists and you still have access.'};
  if(/permission denied|authentication failed|could not read username|could not read password|support for password authentication was removed|\b403\b/.test(low))
    return {category:'authentication',action:'Refresh Git credentials (SSH agent, PAT, or credential helper) and retry.'};
  if(/could not resolve host|network is unreachable|connection timed out|connection refused|could not connect|the remote end hung up unexpectedly|ssl certificate problem/.test(low))
    return {category:'network',action:'Check network connectivity/VPN/proxy and retry.'};
  if(/bad object|loose object|is corrupt|object file .* is empty|not our ref/.test(low))
    return {category:'repository-corruption',action:'Run `git fsck` in the worktree/object store; consider re-cloning if confirmed.'};
  return {category:'unknown',action:'Re-run `git fetch` manually and report the exact output.'};
}
export const GATE_LEASE_FILE='.agents/oversoul-gate.json';
export const GATE_LEASE_TTL_MS=2*60*60*1000; // 2 hours
export async function openGate(workbench,state){
  const dir=join(workbench,'.agents');await mkdir(dir,{recursive:true});
  const lease={target:state.target,root:state.root,revision:state.revision,openedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+GATE_LEASE_TTL_MS).toISOString()};
  await writeFile(join(workbench,GATE_LEASE_FILE),JSON.stringify(lease,null,2),'utf8');
  return lease;
}
export async function closeGate(workbench,target){
  try{
    const file=join(workbench,GATE_LEASE_FILE);
    const lease=JSON.parse(await readFile(file,'utf8'));
    if(!target||lease.target===target) await rm(file,{force:true});
  }catch{}
}
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
function compareVersions(a,b){
  const pa=a.split('.').map(Number),pb=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(pa[i]!==pb[i]) return pa[i]-pb[i];
  return 0;
}
async function readSkillName(dir){
  try{
    const skill=await readFile(join(dir,'SKILL.md'),'utf8');
    const frontmatter=/^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1];
    return /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter??'')?.[1]??null;
  }catch{return null;}
}
// Duplicated from shared/fs.mjs's replaceTree (see the note at DEFAULT_OWN_ROOT above): stage a
// sibling, swap it in, and on failure restore the prior installation rather than leave a half
// swap. This is the one place this file replaces its own containing directory, so it keeps the
// same rollback shape skill-install.mjs already uses and already has a regression test for.
export async function replaceTree(target,staged,renamePath=rename){
  const displaced=`${target}.old-${process.pid}-${Date.now()}`;
  await renamePath(target,displaced);
  try{await renamePath(staged,target);}
  catch(error){
    try{await renamePath(displaced,target);await rm(staged,{recursive:true,force:true});}
    catch(restoreError){throw new AggregateError([error,restoreError],`Replacement failed; prior installation remains at ${displaced}`);}
    throw error;
  }
  await rm(displaced,{recursive:true,force:true});
}
// Reads Shrimp's approved release and aligns the locally-installed Oversoul skill to it when
// Shrimp is ahead. No `.shrimp/release.json` (today's real Shrimp) is a no-op, not a block --
// this must not close the gate on a Shrimp that hasn't adopted release tracking yet. A locally
// newer installation is never downgraded. Integrity comes from `root` already being an inspected,
// fetched Git worktree by the time this runs.
// Each successful align stamps the local engine.json with the bundle hash it aligned to, so a
// later gate check can tell "same engineRelease string, different actual bytes" apart from a
// genuine match -- compareVersions alone cannot see that. A local engine.json with no recorded
// hash yet (never aligned through this path, e.g. a plain dev-checkout install) has nothing to
// compare, so it is left unverified rather than flagged -- there is no false claim to make either way.
async function alignEngine(root,ownRoot){
  let release;
  try{release=JSON.parse(await readFile(join(root,'.shrimp','release.json'),'utf8'));}
  catch{return {action:'not-tracked'};}
  const approved=release.engineRelease;
  const localEngine=JSON.parse(await readFile(join(ownRoot,'engine.json'),'utf8'));
  const installed=localEngine.engineRelease;
  const cmp=compareVersions(approved,installed);
  if(cmp===0){
    if(localEngine.bundleHash&&release.bundleHash&&localEngine.bundleHash!==release.bundleHash)
      return {action:'failed',installed,approved,reason:`Locally installed bundle hash (${localEngine.bundleHash}) does not match Shrimp's approved release (${release.bundleHash}); reinstall from the approved package`};
    return {action:'current',installed,approved,bundleHash:release.bundleHash};
  }
  if(cmp<0)return {action:'ahead',installed,approved};
  const source=join(root,'.shrimp','system','connector','oversoul');
  if(await readSkillName(source)!=='oversoul')return {action:'failed',installed,approved,reason:"Shrimp's approved connector package is missing or invalid"};
  const staged=`${ownRoot}.tmp-${process.pid}-${Date.now()}`;
  try{
    await cp(source,staged,{recursive:true,errorOnExist:true,force:false});
    await writeFile(join(staged,'engine.json'),JSON.stringify({engineRelease:approved,bundleHash:release.bundleHash},null,2)+'\n');
    await replaceTree(ownRoot,staged);
    return {action:'aligned',from:installed,to:approved,bundleHash:release.bundleHash};
  }catch(error){
    await rm(staged,{recursive:true,force:true});
    return {action:'failed',installed,approved,reason:error.message};
  }
}
export async function inspect(workbench,target,fetch=true,fetchRemote=(root)=>git(root,'fetch','--no-tags','origin'),ownRoot=DEFAULT_OWN_ROOT){
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
  // `diagnostics` is hard and gate-closing: engine incompatibility, broken repository identity, an
  // invalid worktree link, or an unverified package (FR-10b.6). `drift` is content drift -- dirty,
  // ahead, behind, divergent, or an unfetched remote -- which may still be read, reviewed, tested,
  // edited, and prepared for a human-approved local commit (FR-2.8); it never closes the gate.
  const diagnostics=[];
  const drift=[];
  if(fetch){try{fetchRemote(root);}catch(error){
    const{category,action}=classifyFetchError(error);
    drift.push(`Fetch failed (${category}): ${String(error?.stderr||error?.message||error).trim()} — ${action}`);
  }}
  const branch=git(root,'branch','--show-current');
  if(!branch)drift.push('Detached HEAD');
  if(branch!==cfg.branch)drift.push('Branch differs from registration');
  let upstream='';try{upstream=git(root,'rev-parse','--abbrev-ref','@{upstream}');}catch{drift.push('Missing upstream');}
  if(upstream!==cfg.upstream||!upstream.startsWith('origin/'))drift.push('Upstream differs from registration');
  const changes=git(root,'status','--porcelain');if(changes&&isReallyDirty(root,changes))drift.push('Dirty worktree');
  let ahead=null,behind=null;
  if(upstream){[ahead,behind]=git(root,'rev-list','--left-right','--count','HEAD...@{upstream}').split(/\s+/).map(Number);if(ahead&&behind)drift.push('Divergent branch');}
  let protocol=null;try{protocol=await manifest(root,cfg.remote);}catch(e){diagnostics.push(e.message);}
  const engineAlignment=await alignEngine(root,ownRoot);
  if(engineAlignment.action==='failed')diagnostics.push('Engine alignment failed: '+engineAlignment.reason);
  const state={target,root,remote,branch,upstream,revision:git(root,'rev-parse','HEAD'),ahead,behind,changes,diagnostics,drift,protocol,engineAlignment,ready:!diagnostics.length};
  if(state.ready) await openGate(workbench,state);
  else await closeGate(workbench,state.target);
  return state;
}
export async function operate(workbench,command,target,capability,args=[],fetchRemote,ownRoot=DEFAULT_OWN_ROOT){
  if(!['inspect','prepare','run','commit'].includes(command))throw new Error('Use inspect, prepare, run, or commit');
  let state=await inspect(workbench,target,true,fetchRemote,ownRoot);
  if(command==='inspect'){
    if(state.ready) await openGate(workbench,state);
    else await closeGate(workbench,state.target);
    return state;
  }
  if(command==='prepare'&&!state.diagnostics.length&&!state.drift.length&&state.behind>0){
    const check=await inspect(workbench,target,false,undefined,ownRoot);
    if(check.revision!==state.revision||check.diagnostics.length||check.drift.length)throw new Error('Worktree changed during preparation');
    git(state.root,'merge','--ff-only','@{upstream}');state=await inspect(workbench,target,false,undefined,ownRoot);
  }
  if(!state.ready){
    await closeGate(workbench,state.target);
    return {...state,status:'blocked'};
  }
  if(command==='prepare'){
    await openGate(workbench,state);
    return {...state,status:'prepared'};
  }
  if(command==='commit'){
    // The explicit, non-empty message argument is the approval signal (mirrors the existing
    // Notion-mutation contract: approval immediately before the call, not persisted across calls).
    // SKILL.md requires the agent to show the exact diff/status and get approval for that specific
    // message before ever calling this. Stages the whole dirty tree (git add -A) -- no partial-path
    // staging in v1; add when a real workflow needs committing only some of several dirty files.
    if(args.length!==1||typeof args[0]!=='string'||!args[0].trim())throw new Error('Commit requires exactly one non-empty message argument');
    if(!state.drift.some(d=>d.startsWith('Dirty worktree')))return {...state,status:'clean'};
    const current=await inspect(workbench,target,false,undefined,ownRoot);
    if(!current.ready||current.revision!==state.revision)throw new Error('Worktree changed before commit');
    git(state.root,'add','-A');
    git(state.root,'commit','-m',args[0]);
    const after=await inspect(workbench,target,false,undefined,ownRoot);
    await openGate(workbench,after);
    return {...after,status:'committed'};
  }
  const c=state.protocol.capabilities[capability];
  if(!c)throw new Error('Capability unavailable for interactive execution');
  // Deliberate placeholder guard: 'actions'-context capabilities (publish, remote mutation) have no
  // implementation in this client. Nothing calls them today; this rejection is intentional scope,
  // not an oversight, until a real publish workflow is designed (Phase 3+).
  if(c.context!=='interactive')throw new Error("'actions'-context capabilities (publish, remote mutation) are not implemented by this client; they require explicit human action outside Oversoul");
  const optionNames=args.filter((_,i)=>i%2===0);
  if(!Array.isArray(c.options)||args.length%2||new Set(optionNames).size!==optionNames.length||args.some((v,i)=>typeof v!=='string'||(i%2===0?!c.options.includes(v):v.startsWith('--'))))throw new Error('Unsupported capability arguments');
  const current=await inspect(workbench,target,false,undefined,ownRoot);
  if(!current.ready||current.revision!==state.revision||JSON.stringify(current.protocol)!==JSON.stringify(state.protocol))throw new Error('Worktree changed before execution');
  const result=spawnSync(process.execPath,[c.entrypoint,...c.argv.slice(1),...args],{cwd:state.root,encoding:'utf8',timeout:60000,env:process.env});
  return {target:state.target,revision:state.revision,status:result.status===0?'complete':'unverified',exitCode:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message};
}
// argv[1] needs realpath'ing before this comparison: import.meta.url is always the real path, so
// invoking this through the linked-repository junction directly (rather than an installed
// .agents/skills/oversoul/ copy) otherwise never matches and the CLI silently no-ops.
const invokedPath=process.argv[1]?await realpath(resolve(process.argv[1])).catch(()=>resolve(process.argv[1])):null;
if(invokedPath&&import.meta.url===pathToFileURL(invokedPath).href){
  try{
    const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor<11)throw new Error('Use Node 24.11+ within Node 24 LTS');
    const [command,...args]=process.argv.slice(2);const cut=args.indexOf('--');const flags=cut<0?args:args.slice(0,cut);const rest=cut<0?[]:args.slice(cut+1);
    if(flags.length%2||flags.some((v,i)=>i%2===0&&!['--target','--capability'].includes(v)))throw new Error('Unknown client arguments');
    const get=k=>flags.includes(k)?flags[flags.indexOf(k)+1]:undefined;
    const result=await operate(process.cwd(),command,get('--target'),get('--capability'),rest);
    console.log(JSON.stringify(result,null,2));if(result.status==='blocked'||result.status==='unverified'||(command==='inspect'&&!result.ready))process.exitCode=2;
  }catch(e){console.log(JSON.stringify({status:'unverified',error:e.message}));process.exitCode=1;}
}
