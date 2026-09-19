import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeObservation,normalizeFile} from '../src/normalize.ts';
import {states} from '../src/model.ts';
import type {Config} from '../src/model.ts';
const config:Config={repository:'example/team',branch:'main',notion:{workspaceId:'workspace',version:'v',threads:'threads',tasks:'tasks',activity:'activity',dashboardBlock:'block'}};
const observation=()=>({version:1,snapshot:{version:1,capturedAt:new Date().toISOString(),workspace:{id:'workspace',name:'Team'},targets:{threads:'threads',tasks:'tasks',activity:'activity',dashboardBlock:'block'},coverage:{workThreads:true,tasks:true},warnings:[],dashboard:{blockId:'block',type:'paragraph'},schemas:{workThread:{dataSourceId:'threads',properties:{Name:'title',ID:'text',URL:'url',Project:'multi_select',Tags:'multi_select',created_by:'people',Duration:'date'}},task:{dataSourceId:'tasks',properties:{Name:'title',ID:'text',Status:'status',Owner:'person',Deadline:'date',Thread:'relation'},statusOptions:[...states],relationTargets:{Thread:'threads'}},activity:{dataSourceId:'activity',properties:{Name:'title',ID:'text',Kind:'select',URL:'url',Revision:'text',Fingerprint:'text'}}},workThreads:[{pageId:'p1',id:'THREAD-one',name:'Thread',project:['Umbrella'],tags:[]}],tasks:[{pageId:'p2',id:'TASK-one',name:'Task',status:'In Progress',threadPageIds:['p1'],deadline:'2026-10-01',lastEdited:'2026-09-09T01:00:00Z'}]}});
test('normalizes schema aliases and preserves populated observation',()=>{
  const input=observation();const s=normalizeObservation(input,config);
  assert.equal(s.schemas.task.properties.Owner,'people');assert.equal(s.schemas.task.properties.ID,'rich_text');
  assert.deepEqual(s.tasks,input.snapshot.tasks);assert.equal(input.snapshot.schemas.task.properties.Owner,'person');
});
test('rejects ambiguous, incomplete, wrong-workspace and unsupported observations',()=>{
  const mutations=[(x:any)=>x.snapshot.tasks.push(x.snapshot.tasks[0]),(x:any)=>delete x.snapshot.tasks[0].lastEdited,(x:any)=>x.snapshot.tasks[0].threadPageIds=['missing'],(x:any)=>x.snapshot.coverage.tasks=false,(x:any)=>x.snapshot.workspace.id='wrong',(x:any)=>x.snapshot.warnings.push('truncated'),(x:any)=>x.snapshot.schemas.task.properties.Owner='unknown',(x:any)=>x.snapshot.capturedAt='2020-01-01',(x:any)=>x.version=2];
  for(const mutate of mutations){const x=observation();mutate(x);assert.throws(()=>normalizeObservation(x,config));}
});
test('failed refresh invalidates prior snapshot and prevents arbitrary output',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oversoul-normalize-'));await mkdir(join(root,'private'));
  const input=join(root,'private','observation.json'),out=join(root,'private','notion-snapshot.json');
  await writeFile(input,JSON.stringify(observation()));await normalizeFile(root,input,out,config);
  assert.equal(JSON.parse(await readFile(out,'utf8')).tasks.length,1);
  await writeFile(input,'{}');await assert.rejects(normalizeFile(root,input,out,config));
  assert.match(await readFile(out,'utf8'),/failed/);await assert.rejects(normalizeFile(root,input,join(root,'tracked.json'),config),/Output/);
});
