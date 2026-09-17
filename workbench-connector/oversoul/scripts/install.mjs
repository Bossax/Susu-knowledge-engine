import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSkill, exists} from '../../_shared/skill-install.mjs';

// Project installation only. Thin oversoul-specific wrapper over the shared
// workbench-adapters installer (../../_shared/skill-install.mjs) — version compare, atomic
// replace, and multi-target logic live there so other workbench-adapters skills can reuse them.
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
const project = resolve(process.cwd());
const agentsPath = join(project, 'AGENTS.md');
if (!await exists(agentsPath)) {
  if (!scaffoldAgents) throw new Error('Missing AGENTS.md at project root; pass --scaffold-agents to create a minimal one');
  await writeFile(agentsPath, await readFile(join(source, 'templates', 'agents-scaffold.md'), 'utf8'));
  console.log(JSON.stringify({action: 'scaffolded', file: 'AGENTS.md', path: agentsPath}));
}

// codex and copilot share one install path.
const pathFor = name => name === 'claude' ? join(project, '.claude', 'skills', 'oversoul') : join(project, '.agents', 'skills', 'oversoul');

async function afterInstall(names, source, project) {
  if (!names.includes('copilot')) return [];
  const promptPath = join(project, '.github', 'prompts', 'oversoul.prompt.md');
  const promptSource = await readFile(join(source, 'integrations', 'oversoul.prompt.md'), 'utf8');
  const rewritten = promptSource.replaceAll('workbench-adapters/oversoul/SKILL.md', '.agents/skills/oversoul/SKILL.md');
  const already = await exists(promptPath) ? await readFile(promptPath, 'utf8') : null;
  if (already === rewritten) return [{action: 'unchanged', clients: ['copilot'], path: promptPath}];
  await mkdir(dirname(promptPath), {recursive: true});
  await writeFile(promptPath, rewritten);
  return [{action: already === null ? 'installed' : 'updated', clients: ['copilot'], path: promptPath}];
}

const results = await installSkill({skillId: 'oversoul', source, project, pathFor, names, allowDowngrade, afterInstall});
for (const r of results) console.log(JSON.stringify(r));
if (results.some(r => r.failed)) process.exitCode = 2;
