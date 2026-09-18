import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const engineRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function exists(p){try{await stat(p);return true;}catch{return false;}}

test('candidate package installs into a disposable project, then reinstalls as a no-op update',async()=>{
  execFileSync(process.execPath,[join(engineRoot,'scripts','pack.mjs')],{cwd:engineRoot});
  const manifest=JSON.parse(await readFile(join(engineRoot,'dist','manifest.json'),'utf8'));
  assert.match(manifest.bundleHash,/^sha256:[0-9a-f]{64}$/);

  const root=await mkdtemp(join(tmpdir(),'pack-acceptance-'));
  const extracted=join(root,'extracted');
  await mkdir(extracted,{recursive:true});
  execFileSync('tar',['-x','-z','-f',join(engineRoot,'dist','candidate.tar.gz'),'-C',extracted]);
  assert.equal(await exists(join(extracted,'engine.json')),true,'the package must carry the release that names it');
  const source=join(extracted,'workbench-connector','oversoul');

  const project=join(root,'project');
  await mkdir(project,{recursive:true});
  await writeFile(join(project,'AGENTS.md'),'Test workbench');

  const run=args=>spawnSync(process.execPath,[join(source,'scripts','install.mjs'),...args],{cwd:project,encoding:'utf8'});

  let r=run(['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"installed"/);
  assert.equal(await exists(join(project,'.claude','skills','oversoul','SKILL.md')),true);

  r=run(['claude']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/"action":"unchanged"/);
  assert.equal(await readFile(join(project,'AGENTS.md'),'utf8'),'Test workbench');
});
