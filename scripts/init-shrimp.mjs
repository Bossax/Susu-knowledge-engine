import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {pathExists, writeJsonAtomic} from '../workbench-connector/shared/fs.mjs';
import {applyRelease} from './update-shrimp.mjs';

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBSTANCE = ['work', 'knowledge', 'proposals', 'decisions', 'tasks', 'archive'];
const SYNC_ENTRY = '.shrimp/system/sync/cli.mjs';
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Every value ending in _ID is refused by the sync CLI, so an unconfigured instance fails loudly on
// its first publish instead of writing to the wrong Notion workspace.
const NOTION_DEFAULTS = {
  version: '2022-06-28',
  workspaceId: 'WORKSPACE_ID',
  threads: 'THREADS_DB_ID',
  tasks: 'TASKS_DB_ID',
  activity: 'ACTIVITY_DB_ID',
  dashboardBlock: 'DASHBOARD_BLOCK_ID',
};

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

function protocolManifest(repository) {
  const capability = (context, command, documents, description) => ({
    context,
    ...(description ? {description} : {}),
    argv: [SYNC_ENTRY, command],
    options: [],
    documents,
  });
  return {
    version: 1,
    repository,
    runtime: {nodeMajor: 24, nodeMinMinor: 11},
    instructions: ['AGENTS.md', 'README.md'],
    capabilities: {
      list: capability('interactive', 'list', ['README.md'], 'List tracked Work Threads, Tasks, and sync items'),
      health: capability('interactive', 'health', ['README.md'], 'Verify Notion connection, credentials, and repository health'),
      compare: capability('interactive', 'compare', ['README.md'], 'Compare local records against Notion before syncing'),
      publish: capability('actions', 'publish', ['README.md']),
      dashboard: capability('actions', 'dashboard', ['README.md']),
    },
  };
}

async function template(name, values) {
  const text = await readFile(join(ENGINE_ROOT, 'templates', 'shrimp', name), 'utf8');
  return Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value), text);
}

/**
 * Scaffolds a brand-new Shrimp repository and installs an engine release into it, so an
 * administrator gets a working instance from one command rather than assembling the tree by hand.
 *
 * Unlike `applyRelease`, this does write git history: the target is a new repository with nothing to
 * endanger, and leaving it uncommitted would hand back a tree the administrator cannot review as a
 * diff. The resulting commit is reported so it can be inspected or reset.
 */
export async function initShrimp({target, packagePath, yes = false, name, repository, notion = {}}) {
  if (!target) throw new Error('--target is required');
  const root = resolve(target);
  const existing = await pathExists(root) ? await readdir(root) : null;
  const steps = [
    {step: 'target', action: existing === null ? 'create' : 'use-empty', path: root},
    {step: 'git', action: 'init'},
    {step: '.shrimp/system', action: 'install', detail: 'connector, sync runtime, engine.json, release.json'},
    {step: '.shrimp/project.json', action: 'create'},
    {step: '.shrimp/system/protocol.json', action: 'create'},
    {step: '.github/workflows/notion.yml', action: 'create'},
    {step: 'README.md', action: 'create'},
    {step: 'AGENTS.md', action: 'create'},
    {step: 'substance folders', action: 'create', detail: SUBSTANCE},
    {step: 'git commit', action: 'create'},
  ];
  const summary = {target: root, repository, name, steps};

  if (existing?.length) {
    return {status: 'blocked', ...summary, reason: 'Target directory is not empty; init-shrimp only creates new instances'};
  }
  if (!yes) return {status: 'planned', ...summary, hint: 'Re-run with --yes to create the instance'};

  if (!repository || !REPOSITORY_PATTERN.test(repository) || repository === 'OWNER/REPO') {
    throw new Error('--repository must be the instance\'s own OWNER/REPO coordinates');
  }
  const instanceName = name || repository.split('/')[1];

  if (!packagePath) {
    execFileSync(process.execPath, [join(ENGINE_ROOT, 'scripts', 'pack.mjs')], {cwd: ENGINE_ROOT, stdio: 'pipe'});
    packagePath = join(ENGINE_ROOT, 'dist', 'candidate.tar.gz');
  }

  await mkdir(root, {recursive: true});
  git(root, 'init', '-q', '-b', 'main');

  // The payload lands before anything else is written: applyRelease refuses to run when
  // `.shrimp/system` is dirty, and an untracked protocol.json there would block it.
  const release = await applyRelease({shrimp: root, packagePath, yes: true});
  if (release.status !== 'complete') return {status: release.status, ...summary, release};

  await writeJsonAtomic(join(root, '.shrimp', 'project.json'), {
    repository,
    branch: 'main',
    notion: {...NOTION_DEFAULTS, ...notion},
  });
  await writeJsonAtomic(join(root, '.shrimp', 'system', 'protocol.json'), protocolManifest(repository));

  await mkdir(join(root, '.github', 'workflows'), {recursive: true});
  await cp(join(ENGINE_ROOT, 'sync', 'templates', 'notion.yml'), join(root, '.github', 'workflows', 'notion.yml'));

  const values = {NAME: instanceName, REPOSITORY: repository};
  await writeFile(join(root, 'README.md'), await template('README.md', values));
  await writeFile(join(root, 'AGENTS.md'), await template('AGENTS.md', values));

  for (const folder of SUBSTANCE) {
    await mkdir(join(root, folder), {recursive: true});
    await writeFile(join(root, folder, '.gitkeep'), '');
  }

  try {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', `Scaffold ${instanceName} from engine release ${release.engineRelease}`);
  } catch (e) {
    return {
      status: 'blocked',
      ...summary,
      reason: 'Files are written but the commit failed; configure git user.name and user.email, then commit by hand',
      error: (e.stderr || e.message).toString().trim(),
    };
  }

  return {
    status: 'complete',
    ...summary,
    engineRelease: release.engineRelease,
    protocol: release.protocol,
    sourceCommit: release.sourceCommit,
    bundleHash: release.bundleHash,
    commit: git(root, 'rev-parse', 'HEAD'),
    hint: 'Fill the _ID placeholders in .shrimp/project.json, then add the GitHub remote and push',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const rest = process.argv.slice(2);
    const flags = new Map();
    const boolFlags = new Set(['--yes']);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (!a.startsWith('--')) throw new Error('Unknown argument: ' + a);
      if (boolFlags.has(a)) { flags.set(a, true); continue; }
      flags.set(a, rest[++i]);
    }

    const notionFlags = {
      version: '--notion-version',
      workspaceId: '--notion-workspace',
      threads: '--notion-threads',
      tasks: '--notion-tasks',
      activity: '--notion-activity',
      dashboardBlock: '--notion-dashboard',
    };
    let name = flags.get('--name');
    let repository = flags.get('--repository');
    const notion = {};
    for (const [key, flag] of Object.entries(notionFlags)) if (flags.has(flag)) notion[key] = flags.get(flag);

    // Prompt only for what a terminal user has not already answered on the command line; without a
    // TTY the flags are the whole interface, which is what keeps this scriptable and testable.
    if (process.stdin.isTTY && flags.get('--yes') === true) {
      const {createInterface} = await import('node:readline/promises');
      const rl = createInterface({input: process.stdin, output: process.stdout});
      try {
        const ask = async (label, fallback) => (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
        repository = repository ?? await ask('Repository (OWNER/REPO)');
        name = name ?? await ask('Instance name', repository?.split('/')[1]);
        for (const [key, flag] of Object.entries(notionFlags)) {
          if (!flags.has(flag)) notion[key] = await ask(`Notion ${key}`, NOTION_DEFAULTS[key]);
        }
      } finally {
        rl.close();
      }
    }

    const result = await initShrimp({
      target: flags.get('--target'),
      packagePath: flags.get('--package'),
      yes: flags.get('--yes') === true,
      name,
      repository,
      notion,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({status: 'invalid', error: e.message}));
    process.exitCode = 1;
  }
}
