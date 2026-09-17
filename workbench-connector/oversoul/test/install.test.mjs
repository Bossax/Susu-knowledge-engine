import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sharedRoot=resolve(packageRoot,'..','_shared');

async function exists(p){try{await stat(p);return true;}catch{return false;}}

// Mirror the real workbench-adapters/{oversoul,_shared} sibling layout under each temp root,
// since install.mjs imports the shared installer via a relative '../../_shared/...' path.
async function makeSource(root,version){
  if(!await exists(join(root,'_shared'))) await cp(sharedRoot,join(root,'_shared'),{recursive:true});
  const src=join(root,'source-'+version);
  await cp(packageRoot,src,{recursive:true});
  let skill=await readFile(join(src,'SKILL.md'),'utf8');
  skill=skill.replace(/version:\s*\d+\.\d+\.\d+/,'version: '+version).replace(/^Version:\s*\d+\.\d+\.\d+/m,'Version: '+version);
  await writeFile(join(src,'SKILL.md'),skill);
  let readme=await readFile(join(src,'README.md'),'utf8');
  readme=readme.replace(/Current version:\s*\*\*\d+\.\d+\.\d+\*\*/,'Current version: **'+version+'**');
  await writeFile(join(src,'README.md'),readme);
  return src;
}

function runInstall(source,project,args){
  return spawnSync(process.execPath,[join(source,'scripts','install.mjs'),...args],{cwd:project,encoding:'utf8'});
}

async function newProject(root){
  const project=join(root,'project');
  await mkdir(project,{recursive:true});
  await writeFile(join(project,'AGENTS.md'),'Test workbench');
  return project;
}

test('fresh install, no-op reinstall, forward upgrade, and downgrade refusal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-install-'));
  const project=await newProject(root);
  const v1=await makeSource(root,'0.1.0'),v2=await makeSource(root,'0.2.0');

  let r=runInstall(v1,project,['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"installed"/);
  assert.equal(await exists(join(project,'.claude','skills','oversoul','SKILL.md')),true);

  r=runInstall(v1,project,['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"unchanged"/);

  r=runInstall(v2,project,['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"upgraded"/);
  assert.match(await readFile(join(project,'.claude','skills','oversoul','SKILL.md'),'utf8'),/version:\s*0\.2\.0/);

  r=runInstall(v1,project,['claude']);
  assert.notEqual(r.status,0);
  assert.match(r.stdout,/"action":"blocked"/);
  assert.match(await readFile(join(project,'.claude','skills','oversoul','SKILL.md'),'utf8'),/version:\s*0\.2\.0/);

  r=runInstall(v1,project,['claude','--allow-downgrade']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"downgraded"/);
  assert.match(await readFile(join(project,'.claude','skills','oversoul','SKILL.md'),'utf8'),/version:\s*0\.1\.0/);
});

test('upgrade removes a file no longer present in the source package',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-install-'));
  const project=await newProject(root);
  const v1=await makeSource(root,'0.1.0');
  await writeFile(join(v1,'RETIRED.md'),'stale file present only in v1');
  const v2=await makeSource(root,'0.2.0');

  runInstall(v1,project,['claude']);
  assert.equal(await exists(join(project,'.claude','skills','oversoul','RETIRED.md')),true);
  const r=runInstall(v2,project,['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.equal(await exists(join(project,'.claude','skills','oversoul','RETIRED.md')),false);
});

test('an unreadable installed SKILL.md blocks without being overwritten',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-install-'));
  const project=await newProject(root);
  const v1=await makeSource(root,'0.1.0');
  runInstall(v1,project,['claude']);
  const skillPath=join(project,'.claude','skills','oversoul','SKILL.md');
  await writeFile(skillPath,'not valid frontmatter');
  const r=runInstall(v1,project,['claude']);
  assert.notEqual(r.status,0);
  assert.match(r.stdout,/"action":"blocked"/);
  assert.equal(await readFile(skillPath,'utf8'),'not valid frontmatter');
});

test('missing AGENTS.md refuses install unless scaffolded',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-install-'));
  const project=join(root,'project');
  await mkdir(project,{recursive:true});
  const v1=await makeSource(root,'0.1.0');

  let r=runInstall(v1,project,['claude']);
  assert.notEqual(r.status,0);
  assert.equal(await exists(join(project,'AGENTS.md')),false);

  r=runInstall(v1,project,['claude','--scaffold-agents']);
  assert.equal(r.status,0,r.stderr);
  assert.equal(await exists(join(project,'AGENTS.md')),true);
  assert.equal(await exists(join(project,'.claude','skills','oversoul','SKILL.md')),true);
});

test('copilot target shares the codex install path and writes a path-rewritten prompt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-install-'));
  const project=await newProject(root);
  const v1=await makeSource(root,'0.1.0');

  const r=runInstall(v1,project,['codex','copilot']);
  assert.equal(r.status,0,r.stderr);
  assert.equal(await exists(join(project,'.agents','skills','oversoul','SKILL.md')),true);
  const prompt=await readFile(join(project,'.github','prompts','oversoul.prompt.md'),'utf8');
  assert.match(prompt,/\.agents\/skills\/oversoul\/SKILL\.md/);
  assert.doesNotMatch(prompt,/workbench-adapters/);
});
