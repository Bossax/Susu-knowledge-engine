import {cp,mkdir,access,readFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Project installation only. Refuse to overwrite an existing installation.
const names=process.argv.slice(2);
if(!names.length||names.some(x=>!['codex','claude'].includes(x)))throw new Error('Usage: node install.mjs codex claude');
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await readFile(join(source,'SKILL.md'));
const project=resolve(process.cwd());
await readFile(join(project,'AGENTS.md'));
const targets=[...new Set(names)].map(name=>({name,path:name==='codex'
  ?join(project,'.agents','skills','oversoul')
  :join(project,'.claude','skills','oversoul')}));
for(const target of targets){
  try{await access(target.path);throw new Error('Existing installation preserved: '+target.path);}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const target of targets){
  await mkdir(dirname(target.path),{recursive:true});
  await cp(source,target.path,{recursive:true,errorOnExist:true,force:false});
  console.log(JSON.stringify({installed:target.name,scope:'project',project,path:target.path}));
}
