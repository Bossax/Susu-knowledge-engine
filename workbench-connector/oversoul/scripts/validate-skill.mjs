import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillText = await readFile(resolve(root, 'SKILL.md'), 'utf8');
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillText)?.[1];
const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter ?? '')?.[1];
const description = /^description:\s*(\S.*)$/m.exec(frontmatter ?? '')?.[1];
const engineRelease = JSON.parse(await readFile(resolve(root, '..', '..', 'engine.json'), 'utf8')).engineRelease;

if (name !== 'oversoul' || name.length > 64 || !description) throw new Error('Invalid skill frontmatter');
if (!/^\d+\.\d+\.\d+$/.test(engineRelease)) throw new Error('Invalid engineRelease in engine.json');
if (/TODO|\[INSERT/.test(skillText)) throw new Error('Unfinished scaffold text present');
await readFile(resolve(root, 'scripts/linked-repo.mjs'));
console.log(`Oversoul frontmatter, engine release ${engineRelease}, and client reference validated.`);
