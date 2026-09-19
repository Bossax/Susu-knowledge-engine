import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const script=resolve(dirname(fileURLToPath(import.meta.url)),'..','scripts','update-shrimp.mjs');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:'pipe'}).trim();

async function exists(p){try{await stat(p);return true;}catch{return false;}}

// Builds a candidate package without going through pack.mjs, so these tests do not depend on the
// engine's real HEAD and can mint any release number they need.
async function makePackage(root,{engineRelease,marker='connector payload'}){
  const dir=join(root,'package-'+engineRelease);
  const stage=join(dir,'stage');
  await mkdir(join(stage,'workbench-connector','oversoul'),{recursive:true});
  // The real package carries all three sibling sub-packages, and bootstrap/ resolves both its
  // oversoul sibling and `../../engine.json` by relative path once vendored -- so the fixture
  // mirrors that shape rather than oversoul alone, which would not catch a payload that drops them.
  await mkdir(join(stage,'workbench-connector','bootstrap'),{recursive:true});
  await mkdir(join(stage,'workbench-connector','shared'),{recursive:true});
  await writeFile(join(stage,'workbench-connector','bootstrap','connect.mjs'),`// bootstrap ${engineRelease}\n`);
  await writeFile(join(stage,'workbench-connector','shared','fs.mjs'),`// shared ${engineRelease}\n`);
  await writeFile(join(stage,'engine.json'),JSON.stringify({engineRelease,protocol:1},null,2)+'\n');
  await writeFile(join(stage,'workbench-connector','oversoul','SKILL.md'),`---\nname: oversoul\n---\n${marker} ${engineRelease}\n`);
  const tarball=join(dir,'candidate.tar.gz');
  execFileSync('tar',['-c','-z','-f',tarball,'-C',stage,'workbench-connector','engine.json']);
  const bundleHash='sha256:'+createHash('sha256').update(await readFile(tarball)).digest('hex');
  await writeFile(join(dir,'manifest.json'),JSON.stringify({engineRelease,protocol:1,commit:'0'.repeat(40),bundleHash},null,2)+'\n');
  return {dir,tarball,bundleHash};
}

async function makeShrimp(root,{substance=false}={}){
  const shrimp=await realpath(await mkdtemp(join(root,'shrimp-')));
  git(shrimp,'init','-q','-b','main');
  git(shrimp,'config','user.name','Test');
  git(shrimp,'config','user.email','test@example.com');
  git(shrimp,'config','commit.gpgsign','false');
  await mkdir(join(shrimp,'.shrimp'),{recursive:true});
  await writeFile(join(shrimp,'.shrimp','project.json'),JSON.stringify({instance:'test',administrator:'bossa'},null,2)+'\n');
  if(substance) for(const folder of ['work','knowledge','proposals','decisions','tasks','archive']){
    await mkdir(join(shrimp,folder),{recursive:true});
    await writeFile(join(shrimp,folder,'entry.md'),`substance in ${folder}\n`);
  }
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','initial');
  return shrimp;
}

const run=(shrimp,pkg,...args)=>spawnSync(process.execPath,[script,'--shrimp',shrimp,'--package',pkg.tarball,...args],{encoding:'utf8'});
const parse=r=>JSON.parse(r.stdout);
const step=(result,name)=>result.steps.find(s=>s.step===name);

test('an unverified engine package is refused with nothing written',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const pkg=await makePackage(root,{engineRelease:'0.1.0'});
  const manifestPath=join(pkg.dir,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  await writeFile(manifestPath,JSON.stringify({...manifest,bundleHash:'sha256:'+'0'.repeat(64)},null,2));

  const r=run(shrimp,pkg,'--yes');
  assert.equal(r.status,1,r.stdout);
  assert.equal(parse(r).status,'invalid');
  assert.match(parse(r).error,/failed verification/);
  assert.equal(await exists(join(shrimp,'.shrimp','system')),false);
  assert.equal(await exists(join(shrimp,'.shrimp','release.json')),false);
});

test('a dry run reports the plan and writes nothing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const pkg=await makePackage(root,{engineRelease:'0.1.0'});

  const r=run(shrimp,pkg);
  assert.equal(r.status,0,r.stdout);
  const result=parse(r);
  assert.equal(result.status,'planned');
  assert.equal(step(result,'.shrimp/system/connector').action,'missing');
  assert.equal(step(result,'.shrimp/release.json').action,'missing');
  assert.equal(await exists(join(shrimp,'.shrimp','system')),false);
});

test('a fresh shrimp and an already-connected shrimp take the same apply path',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const a=await makePackage(root,{engineRelease:'0.1.0'});
  const b=await makePackage(root,{engineRelease:'0.2.0'});
  const commitsBefore=git(shrimp,'rev-list','--count','HEAD');
  const skill=join(shrimp,'.shrimp','system','connector','oversoul','SKILL.md');

  let r=run(shrimp,a,'--yes');
  assert.equal(r.status,0,r.stdout);
  assert.equal(parse(r).status,'complete');
  assert.equal(step(parse(r),'.shrimp/system/connector').action,'missing');
  assert.match(await readFile(skill,'utf8'),/connector payload 0\.1\.0/);
  assert.equal(JSON.parse(await readFile(join(shrimp,'.shrimp','release.json'),'utf8')).engineRelease,'0.1.0');

  // The administrator reviews and commits before adopting the next release.
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','adopt 0.1.0');

  r=run(shrimp,b,'--yes');
  assert.equal(r.status,0,r.stdout);
  assert.equal(step(parse(r),'.shrimp/system/connector').action,'stale');
  assert.match(await readFile(skill,'utf8'),/connector payload 0\.2\.0/);
  const record=JSON.parse(await readFile(join(shrimp,'.shrimp','release.json'),'utf8'));
  assert.equal(record.engineRelease,'0.2.0');
  assert.equal(record.bundleHash,b.bundleHash);
  assert.equal(record.version,1);

  // The tool mutates the working tree and leaves committing to the human.
  assert.equal(git(shrimp,'rev-list','--count','HEAD'),String(Number(commitsBefore)+1));
  assert.notEqual(git(shrimp,'status','--porcelain'),'');
});

// Regression: the connector reached Shrimp but `engine.json` did not, so both
// `bootstrap/connect.mjs` and `oversoul/scripts/install.mjs` -- which read `../../engine.json`
// relative to their own package directory -- failed with ENOENT against a real Shrimp checkout.
test('an apply lands every sub-package and the engine record beside them',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const pkg=await makePackage(root,{engineRelease:'0.1.0'});

  let r=run(shrimp,pkg);
  assert.equal(step(parse(r),'.shrimp/system/engine.json').action,'missing');
  assert.equal(await exists(join(shrimp,'.shrimp','system','engine.json')),false);

  r=run(shrimp,pkg,'--yes');
  assert.equal(r.status,0,r.stdout);
  assert.equal(parse(r).status,'complete');

  const connector=join(shrimp,'.shrimp','system','connector');
  for(const p of [['oversoul','SKILL.md'],['bootstrap','connect.mjs'],['shared','fs.mjs']]){
    assert.equal(await exists(join(connector,...p)),true,`missing ${p.join('/')}`);
  }

  // `../../engine.json` from either package directory has to resolve to this exact path.
  const engineRecord=join(connector,'oversoul','..','..','engine.json');
  assert.equal(await exists(engineRecord),true);
  const engine=JSON.parse(await readFile(engineRecord,'utf8'));
  assert.equal(engine.engineRelease,'0.1.0');
  assert.equal(engine.protocol,1);

  // Re-applying the same package reports it as already current rather than always rewriting.
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','adopt 0.1.0');
  r=run(shrimp,pkg);
  assert.equal(step(parse(r),'.shrimp/system/engine.json').action,'unchanged');
});

test('an update preserves project.json and every substance folder',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root,{substance:true});
  const pkg=await makePackage(root,{engineRelease:'0.1.0'});
  const before=Object.fromEntries(await Promise.all(
    ['.shrimp/project.json','work/entry.md','knowledge/entry.md','proposals/entry.md','decisions/entry.md','tasks/entry.md','archive/entry.md']
      .map(async p=>[p,await readFile(join(shrimp,p),'utf8')])));

  const r=run(shrimp,pkg,'--yes');
  assert.equal(r.status,0,r.stdout);
  assert.equal(step(parse(r),'.shrimp/project.json').action,'preserved');
  for(const [p,content] of Object.entries(before)) assert.equal(await readFile(join(shrimp,p),'utf8'),content,p+' must be untouched');
});

test('a human edit under .shrimp/system is reported and blocks the update until that path is named',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const a=await makePackage(root,{engineRelease:'0.1.0'});
  const b=await makePackage(root,{engineRelease:'0.2.0'});
  run(shrimp,a,'--yes');
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','adopt 0.1.0');
  const skill=join(shrimp,'.shrimp','system','connector','oversoul','SKILL.md');
  await writeFile(skill,'hand edited by the administrator\n');

  let r=run(shrimp,b,'--yes');
  assert.equal(r.status,2,r.stdout);
  const result=parse(r);
  assert.equal(result.status,'blocked');
  assert.equal(step(result,'.shrimp/system/connector').action,'locally-modified');
  assert.equal(await readFile(skill,'utf8'),'hand edited by the administrator\n');

  r=run(shrimp,b,'--yes','--force','.shrimp/system/connector');
  assert.equal(r.status,0,r.stdout);
  assert.match(await readFile(skill,'utf8'),/connector payload 0\.2\.0/);
});

test('an older engine release is refused unless the downgrade is explicitly allowed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const a=await makePackage(root,{engineRelease:'0.1.0'});
  const b=await makePackage(root,{engineRelease:'0.2.0'});
  run(shrimp,b,'--yes');
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','adopt 0.2.0');
  const recordPath=join(shrimp,'.shrimp','release.json');

  let r=run(shrimp,a,'--yes');
  assert.equal(r.status,2,r.stdout);
  assert.equal(step(parse(r),'release').action,'ahead');
  assert.equal(JSON.parse(await readFile(recordPath,'utf8')).engineRelease,'0.2.0');

  r=run(shrimp,a,'--yes','--allow-downgrade');
  assert.equal(r.status,0,r.stdout);
  assert.equal(JSON.parse(await readFile(recordPath,'utf8')).engineRelease,'0.1.0');
});

test('legacy tools/connect is retired and cleaned up during update',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shrimp-update-test-'));
  const shrimp=await makeShrimp(root);
  const legacy=join(shrimp,'tools','connect');
  await mkdir(legacy,{recursive:true});
  await writeFile(join(legacy,'old.mjs'),'legacy code\n');
  git(shrimp,'add','-A');
  git(shrimp,'commit','-q','-m','add legacy connector');

  const pkg=await makePackage(root,{engineRelease:'0.1.0'});
  const plan=parse(run(shrimp,pkg));
  assert.equal(step(plan,'tools/connect').action,'retired');

  const r=run(shrimp,pkg,'--yes');
  assert.equal(r.status,0,r.stdout);
  assert.equal(await exists(legacy),false);
  assert.equal(await exists(join(shrimp,'tools')),false);
});

