import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {identity,inspect as inspectReal,operate as operateReal,manifest,GATE_LEASE_FILE} from '../scripts/linked-repo.mjs';
const transports=new Map();
const inspect=(wb)=>inspectReal(wb,undefined,true,transports.get(wb));
const operate=(wb,command,target,capability)=>operateReal(wb,command,target,capability,[],transports.get(wb));
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const exists=async(p)=>{try{await stat(p);return true;}catch{return false;}};
async function fixture(){
  // realpath first: on macOS, mkdtemp(tmpdir()) yields /var/folders/... while a child process's
  // own realpath'd process.cwd() reports /private/var/folders/...; without this the two never
  // compare equal even though they are the same directory.
  const root=await realpath(await mkdtemp(join(tmpdir(),'oversoul-test-')));const primary=join(root,'primary'),remote=join(root,'remote.git'),wb=join(root,'wb'),wt=join(root,'wt');
  await mkdir(primary);await mkdir(wb);git(root,'init','--bare',remote);git(primary,'init','-b','main');
  git(primary,'config','user.name','Test');git(primary,'config','user.email','test@example.invalid');git(primary,'config','commit.gpgsign','false');
  await writeFile(join(primary,'AGENTS.md'),'Test protocol');await writeFile(join(primary,'entry.mjs'),'console.log(process.cwd())');
  await writeFile(join(primary,'protocol.json'),JSON.stringify({version:1,repository:'example/team',runtime:{nodeMajor:24,nodeMinMinor:11},instructions:['AGENTS.md'],capabilities:{inventory:{context:'interactive',argv:['entry.mjs'],options:[],documents:['AGENTS.md']},publish:{context:'actions',argv:['entry.mjs'],options:[],documents:[]}}}));
  git(primary,'add','.');git(primary,'commit','-m','fixture');git(primary,'remote','add','origin',remote);git(primary,'push','-u','origin','main');
  git(primary,'worktree','add','-b','workbench',wt,'main');git(wt,'branch','--set-upstream-to','origin/main');
  // Fetch locally while retaining a verifiable GitHub URL in the remote configuration.
  git(primary,'remote','set-url','origin','https://github.com/example/team.git');
  transports.set(wb,(cwd)=>git(cwd,'fetch','--no-tags',remote,'refs/heads/main:refs/remotes/origin/main'));
  await symlink(wt,join(wb,'Team'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(wb,'.linked-repos.json'),JSON.stringify({version:1,targets:{Team:{path:'Team',remote:'https://github.com/example/team.git',branch:'workbench',upstream:'origin/main'}}}));
  return {root,primary,remote,wb,wt};
}
test('SSH and HTTPS identity canonicalization',()=>assert.equal(identity('git@github.com:Bossax/Soniferous-Shrimp.git'),identity('https://github.com/Bossax/Soniferous-Shrimp')));
test('preflight, safe fast-forward, run, dirty preservation, ahead and divergence',async()=>{
  const f=await fixture();
  const initial=await inspect(f.wb);assert.equal(initial.ready,true,JSON.stringify(initial));
  assert.equal(await exists(join(f.wb,GATE_LEASE_FILE)),true);
  const run=await operate(f.wb,'run','Team','inventory');assert.equal(run.status,'complete');assert.equal(run.stdout.trim(),f.wt);
  await assert.rejects(operate(f.wb,'run','Team','publish'),/unavailable/);
  await writeFile(join(f.primary,'new.txt'),'remote');git(f.primary,'add','.');git(f.primary,'commit','-m','remote');git(f.primary,'push',f.remote,'main');
  assert.equal((await inspect(f.wb)).behind,1);assert.equal((await operate(f.wb,'prepare')).status,'prepared');
  assert.equal(await exists(join(f.wb,GATE_LEASE_FILE)),true);
  await writeFile(join(f.wt,'new.txt'),'local');const head=git(f.wt,'rev-parse','HEAD');
  assert.equal((await operate(f.wb,'prepare')).status,'blocked');assert.equal(await readFile(join(f.wt,'new.txt'),'utf8'),'local');assert.equal(git(f.wt,'rev-parse','HEAD'),head);
  assert.equal(await exists(join(f.wb,GATE_LEASE_FILE)),false);
  git(f.wt,'add','.');git(f.wt,'commit','-m','local');assert.match((await inspect(f.wb)).diagnostics.join(),/ahead/);
  await writeFile(join(f.primary,'remote.txt'),'other');git(f.primary,'add','.');git(f.primary,'commit','-m','other');git(f.primary,'push',f.remote,'main');
  assert.match((await inspect(f.wb)).diagnostics.join(),/Divergent/);
  git(f.wt,'checkout','--detach');assert.match((await inspect(f.wb)).diagnostics.join(),/Detached/);
});
test('missing upstream, failed fetch, wrong identity and manifest escape are blocked',async()=>{
  const f=await fixture();git(f.wt,'branch','--unset-upstream');assert.match((await inspect(f.wb)).diagnostics.join(),/Missing upstream/);
  git(f.wt,'branch','--set-upstream-to','origin/main');
  transports.set(f.wb,()=>{throw new Error('offline');});
  assert.match((await inspect(f.wb)).diagnostics.join(),/Fetch failed/);
  git(f.primary,'remote','set-url','origin','https://github.com/other/team.git');await assert.rejects(inspect(f.wb),/identity mismatch/);
  const p=JSON.parse(await readFile(join(f.wt,'protocol.json'),'utf8'));p.instructions.push('../outside.md');await writeFile(join(f.wt,'protocol.json'),JSON.stringify(p));
  await assert.rejects(manifest(f.wt,'https://github.com/example/team'),/escapes/);
  p.version=99;await writeFile(join(f.wt,'protocol.json'),JSON.stringify(p));await assert.rejects(manifest(f.wt,'https://github.com/example/team'),/Unsupported/);
});
test('broken link, missing protocol document and argument injection cannot execute',async()=>{
  const f=await fixture();
  await assert.rejects(operateReal(f.wb,'run','Team','inventory',['--root','elsewhere'],transports.get(f.wb)),/Unsupported capability arguments/);
  const p=JSON.parse(await readFile(join(f.wt,'protocol.json'),'utf8'));p.instructions.push('missing.md');
  await writeFile(join(f.wt,'protocol.json'),JSON.stringify(p));await assert.rejects(manifest(f.wt,'https://github.com/example/team'),/ENOENT/);
  await writeFile(join(f.wb,'.linked-repos.json'),JSON.stringify({version:1,targets:{Team:{path:'missing',remote:'https://github.com/example/team',branch:'workbench',upstream:'origin/main'}}}));
  await assert.rejects(inspect(f.wb),/ENOENT/);
});
test('a registry path nested under a subdirectory resolves like a top-level one',async()=>{
  const f=await fixture();
  await mkdir(join(f.wb,'links'),{recursive:true});
  await symlink(f.wt,join(f.wb,'links','Team'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(f.wb,'.linked-repos.json'),JSON.stringify({version:1,targets:{Team:{path:'links/Team',remote:'https://github.com/example/team.git',branch:'workbench',upstream:'origin/main'}}}));
  const result=await inspect(f.wb);
  assert.equal(result.ready,true,JSON.stringify(result));
});
test('a case-differing registry path still resolves on a case-insensitive filesystem',async(t)=>{
  const probe=await mkdtemp(join(tmpdir(),'oversoul-case-'));
  await writeFile(join(probe,'A'),'x');
  let caseInsensitive=true;
  try{await stat(join(probe,'a'));}catch{caseInsensitive=false;}
  if(!caseInsensitive){t.skip('Filesystem is case-sensitive; nothing to verify here.');return;}
  const f=await fixture();
  const registry=JSON.parse(await readFile(join(f.wb,'.linked-repos.json'),'utf8'));
  registry.targets.Team.path='team';
  await writeFile(join(f.wb,'.linked-repos.json'),JSON.stringify(registry));
  const result=await inspect(f.wb);
  assert.equal(result.ready,true,JSON.stringify(result));
});
