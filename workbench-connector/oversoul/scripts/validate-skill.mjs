import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseVersion} from './skill-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillText = await readFile(resolve(root, 'SKILL.md'), 'utf8');
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillText)?.[1];
const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter ?? '')?.[1];
const description = /^description:\s*(\S.*)$/m.exec(frontmatter ?? '')?.[1];
const version = parseVersion(skillText);
const bodyVersion = /^Version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(skillText)?.[1];
const readmeText = await readFile(resolve(root, 'README.md'), 'utf8');
const readmeVersion = /Current version:\s*\*\*(\d+\.\d+\.\d+)\*\*/.exec(readmeText)?.[1];

if (name !== 'oversoul' || name.length > 64 || !description || !version) {
  throw new Error('Invalid skill frontmatter or unparseable version');
}
if (/TODO|\[INSERT/.test(skillText)) throw new Error('Unfinished scaffold text present');
// Version is checked for consistency across files rather than hard-coded, so it does not
// need editing on every release; a mismatch usually means one file was bumped and another forgotten.
if (bodyVersion !== version) throw new Error(`SKILL.md body "Version:" line (${bodyVersion}) does not match frontmatter version (${version})`);
if (readmeVersion !== version) throw new Error(`README.md "Current version" (${readmeVersion}) does not match frontmatter version (${version})`);
await readFile(resolve(root, 'scripts/linked-repo.mjs'));
console.log(`Oversoul YAML frontmatter, version ${version} (consistent across SKILL.md and README.md), name, description, and client reference validated.`);
