import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const text=await readFile(resolve(root,'SKILL.md'),'utf8');
const match=/^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---/.exec(text);
if(!match||match[1]!=='oversoul'||match[1].length>64||!match[2].trim()||/TODO|\[INSERT/.test(text))throw new Error('Invalid skill frontmatter or unfinished scaffold');
await readFile(resolve(root,'scripts/linked-repo.mjs'));
console.log('Oversoul simple YAML frontmatter, name, description, and client reference validated.');
