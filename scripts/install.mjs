import {cp, mkdir, readFile, writeFile, rm, rename, stat} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseVersion, compare} from './skill-version.mjs';

// Project installation only. Version-aware: upgrades forward, refuses to downgrade or to
// overwrite an unreadable installation without an explicit flag.
async function exists(p) {
  try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const names = argv.filter(a => !a.startsWith('--'));
const scaffoldAgents = flags.has('--scaffold-agents');
const allowDowngrade = flags.has('--allow-downgrade');
const known = new Set(['codex', 'claude', 'copilot']);
if (!names.length || names.some(x => !known.has(x))) {
  throw new Error('Usage: node install.mjs codex claude copilot [--scaffold-agents] [--allow-downgrade]');
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceVersion = parseVersion(await readFile(join(source, 'SKILL.md'), 'utf8'));
if (!sourceVersion) throw new Error('Unparseable source SKILL.md version');

const project = resolve(process.cwd());
const agentsPath = join(project, 'AGENTS.md');
if (!await exists(agentsPath)) {
  if (!scaffoldAgents) throw new Error('Missing AGENTS.md at project root; pass --scaffold-agents to create a minimal one');
  await writeFile(agentsPath, await readFile(join(source, 'templates', 'agents-scaffold.md'), 'utf8'));
  console.log(JSON.stringify({action: 'scaffolded', file: 'AGENTS.md', path: agentsPath}));
}

// codex and copilot share one install path; group requested clients by their target directory.
const pathFor = name => name === 'claude' ? join(project, '.claude', 'skills', 'oversoul') : join(project, '.agents', 'skills', 'oversoul');
const byPath = new Map();
for (const name of new Set(names)) {
  const path = pathFor(name);
  byPath.set(path, [...(byPath.get(path) ?? []), name]);
}

for (const [target, clients] of byPath) {
  if (!await exists(target)) {
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {recursive: true, errorOnExist: true, force: false});
    console.log(JSON.stringify({action: 'installed', clients, version: sourceVersion, path: target}));
    continue;
  }
  let installedVersion;
  try { installedVersion = parseVersion(await readFile(join(target, 'SKILL.md'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!installedVersion) {
    console.log(JSON.stringify({action: 'blocked', clients, path: target, reason: 'Existing installation has an unreadable SKILL.md version; move it aside before installing'}));
    process.exitCode = 2;
    continue;
  }
  const cmp = compare(sourceVersion, installedVersion);
  if (cmp === 0) {
    console.log(JSON.stringify({action: 'unchanged', clients, version: installedVersion, path: target}));
    continue;
  }
  if (cmp < 0 && !allowDowngrade) {
    console.log(JSON.stringify({action: 'blocked', clients, path: target, installed: installedVersion, source: sourceVersion, reason: 'Installed version is newer than source; pass --allow-downgrade to force'}));
    process.exitCode = 2;
    continue;
  }
  // Atomic replace: stage a fresh copy, swap it in, keep the displaced copy as a backup
  // until the swap has succeeded, then remove it. This also drops any file present in the
  // old installation but absent from source — there is nothing left to prune afterward.
  const tmp = target + '.oversoul-tmp';
  const old = target + '.oversoul-old';
  await rm(tmp, {recursive: true, force: true});
  await rm(old, {recursive: true, force: true});
  await cp(source, tmp, {recursive: true, errorOnExist: true, force: false});
  await rename(target, old);
  await rename(tmp, target);
  await rm(old, {recursive: true, force: true});
  console.log(JSON.stringify({action: cmp > 0 ? 'upgraded' : 'downgraded', clients, from: installedVersion, to: sourceVersion, path: target}));
}

if (names.includes('copilot')) {
  const promptPath = join(project, '.github', 'prompts', 'oversoul.prompt.md');
  const promptSource = await readFile(join(source, 'integrations', 'oversoul.prompt.md'), 'utf8');
  const rewritten = promptSource.replaceAll('workbench-adapters/oversoul/SKILL.md', '.agents/skills/oversoul/SKILL.md');
  const already = await exists(promptPath) ? await readFile(promptPath, 'utf8') : null;
  if (already === rewritten) {
    console.log(JSON.stringify({action: 'unchanged', clients: ['copilot'], path: promptPath}));
  } else {
    await mkdir(dirname(promptPath), {recursive: true});
    await writeFile(promptPath, rewritten);
    console.log(JSON.stringify({action: already === null ? 'installed' : 'updated', clients: ['copilot'], path: promptPath}));
  }
}
