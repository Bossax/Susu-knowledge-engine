import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspect as inspectReal,replaceTree} from '../../workbench-connector/oversoul/scripts/linked-repo.mjs';

const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const exists=async(p)=>{try{await stat(p);return true;}catch{return false;}};

// Same shape as test/oversoul/client.test.mjs's fixture, trimmed to what alignment needs: a
// registered, fetchable Shrimp worktree and a stand-in "own" install root outside it.
async function fixture(ownRelease){
  const root=await realpath(await mkdtemp(join(tmpdir(),'oversoul-align-')));
  const primary=join(root,'primary'),remote=join(root,'remote.git'),wb=join(root,'wb'),wt=join(root,'wt'),own=join(root,'own');
  await mkdir(primary);await mkdir(wb);await mkdir(own,{recursive:true});
  git(root,'init','--bare',remote);git(primary,'init','-b','main');
  git(primary,'config','user.name','Test');git(primary,'config','user.email','test@example.invalid');git(primary,'config','commit.gpgsign','false');
  await writeFile(join(primary,'AGENTS.md'),'Test protocol');await writeFile(join(primary,'entry.mjs'),'console.log(process.cwd())');
  await writeFile(join(primary,'protocol.json'),JSON.stringify({version:1,repository:'example/team',runtime:{nodeMajor:24,nodeMinMinor:11},instructions:['AGENTS.md'],capabilities:{}}));
  git(primary,'add','.');git(primary,'commit','-m','fixture');git(primary,'remote','add','origin',remote);git(primary,'push','-u','origin','main');
  git(primary,'worktree','add','-b','workbench',wt,'main');git(wt,'branch','--set-upstream-to','origin/main');
  git(primary,'remote','set-url','origin','https://github.com/example/team.git');
  await symlink(wt,join(wb,'Team'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(wb,'.linked-repos.json'),JSON.stringify({version:1,targets:{Team:{path:'Team',remote:'https://github.com/example/team.git',branch:'workbench',upstream:'origin/main'}}}));
  await writeFile(join(own,'engine.json'),JSON.stringify({engineRelease:ownRelease},null,2)+'\n');
  const fetchRemote=(cwd)=>git(cwd,'fetch','--no-tags',remote,'refs/heads/main:refs/remotes/origin/main');
  const inspect=()=>inspectReal(wb,undefined,true,fetchRemote,own);
  return {root,wt,own,inspect};
}

// Commits so alignment's own writes don't themselves trip "Dirty worktree" -- that diagnostic is
// about Shrimp's tracked content, unrelated to whether the local Oversoul copy is current.
async function adoptRelease(wt,engineRelease,{withConnector=true}={}){
  await mkdir(join(wt,'.shrimp'),{recursive:true});
  await writeFile(join(wt,'.shrimp','release.json'),JSON.stringify({version:1,engineRelease,protocol:1,sourceCommit:'0'.repeat(40),bundleHash:'sha256:'+'0'.repeat(64),appliedAt:new Date().toISOString()},null,2)+'\n');
  if(withConnector){
    const connector=join(wt,'.shrimp','system','connector','oversoul');
    await mkdir(connector,{recursive:true});
    await writeFile(join(connector,'SKILL.md'),`---\nname: oversoul\n---\nconnector payload ${engineRelease}\n`);
  }
  git(wt,'add','.shrimp');git(wt,'commit','-q','-m','adopt '+engineRelease);
}

test('no .shrimp/release.json leaves the gate exactly as before',async()=>{
  const f=await fixture('0.1.0');
  const result=await f.inspect();
  assert.deepEqual(result.engineAlignment,{action:'not-tracked'});
  assert.equal(result.ready,true,JSON.stringify(result));
});

test('a matching approved release requires no alignment',async()=>{
  const f=await fixture('0.1.0');
  await adoptRelease(f.wt,'0.1.0');
  const result=await f.inspect();
  assert.deepEqual(result.engineAlignment,{action:'current',installed:'0.1.0',approved:'0.1.0'});
  assert.equal(result.ready,true,JSON.stringify(result));
});

test('a newer approved release replaces the installed oversoul skill in place',async()=>{
  const f=await fixture('0.1.0');
  await writeFile(join(f.own,'STALE.md'),'leftover from the old release');
  await adoptRelease(f.wt,'0.2.0');
  const result=await f.inspect();
  assert.equal(result.engineAlignment.action,'aligned');
  assert.equal(result.engineAlignment.from,'0.1.0');
  assert.equal(result.engineAlignment.to,'0.2.0');
  assert.equal(result.ready,true,JSON.stringify(result));
  assert.equal(JSON.parse(await readFile(join(f.own,'engine.json'),'utf8')).engineRelease,'0.2.0');
  assert.match(await readFile(join(f.own,'SKILL.md'),'utf8'),/connector payload 0\.2\.0/);
  assert.equal(await exists(join(f.own,'STALE.md')),false,'the whole tree is replaced, not merged');

  const again=await f.inspect();
  assert.deepEqual(again.engineAlignment,{action:'current',installed:'0.2.0',approved:'0.2.0'});
});

test('a locally newer installation is never downgraded',async()=>{
  const f=await fixture('0.2.0');
  await writeFile(join(f.own,'CURRENT.md'),'the newer local copy');
  await adoptRelease(f.wt,'0.1.0');
  const result=await f.inspect();
  assert.deepEqual(result.engineAlignment,{action:'ahead',installed:'0.2.0',approved:'0.1.0'});
  assert.equal(result.ready,true,JSON.stringify(result));
  assert.equal(await exists(join(f.own,'CURRENT.md')),true,'no swap should have been attempted');
});

test('a missing or invalid approved connector package blocks the gate',async()=>{
  const f=await fixture('0.1.0');
  await adoptRelease(f.wt,'0.2.0',{withConnector:false});
  const result=await f.inspect();
  assert.equal(result.engineAlignment.action,'failed');
  assert.match(result.diagnostics.join(),/Engine alignment failed/);
  assert.equal(result.ready,false,JSON.stringify(result));
  assert.equal(JSON.parse(await readFile(join(f.own,'engine.json'),'utf8')).engineRelease,'0.1.0','a failed identity check must not touch the installed copy');
});

test('a failed alignment swap restores the prior installation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-swap-'));
  const target=join(root,'installed');await mkdir(target);await writeFile(join(target,'marker.txt'),'old');
  const staged=join(root,'staged');await mkdir(staged);await writeFile(join(staged,'marker.txt'),'new');
  let moves=0;
  const failSecondMove=async(from,to)=>{moves++;if(moves===2)throw new Error('simulated replacement failure');await rename(from,to);};
  await assert.rejects(replaceTree(target,staged,failSecondMove),/simulated replacement failure/);
  assert.equal(await readFile(join(target,'marker.txt'),'utf8'),'old');
});
