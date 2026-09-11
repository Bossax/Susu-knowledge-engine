import {existsSync} from 'node:fs';
import {readFile, mkdir, realpath, readdir, symlink} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, join, dirname, basename} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {buildArtifacts} from './manifest.mjs';

// Always resolve sibling files (templates/, payload/, an adjacent oversoul/) against this
// module's own location, never process.argv[1] -- the latter is the caller's file when connect()
// is imported as a module (as the tests do), not this file.
const HERE = dirname(fileURLToPath(import.meta.url));

// _shared sits one level up from connector/ in the development tree (workbench-adapters/_shared)
// but directly alongside connect.mjs once vendored -- vendoring flattens connector/'s own folder
// away while oversoul/ and _shared/ keep theirs, so connect.mjs ends up one level shallower than
// it started relative to _shared specifically. A static relative import can't pick between the
// two, so this resolves at load time instead, the same way resolveOversoulPath already does for
// the oversoul package.
const SHARED_ROOT = existsSync(join(HERE, '_shared')) ? join(HERE, '_shared') : join(HERE, '..', '_shared');
const sharedImport = (p) => import(pathToFileURL(join(SHARED_ROOT, p)).href);
const {pathExists, writeJsonAtomic} = await sharedImport('fs.mjs');
const {parseVersion} = await sharedImport('skill-version.mjs');
const {probeArtifact, applyArtifact, isBlocking, needsWrite} = await sharedImport('artifacts/index.mjs');
const {readState, writeState, baseFor} = await sharedImport('artifact-state.mjs');

// Human-invoked bootstrap tool. Deliberately not a protocol.json capability: it writes outside
// the knowledge-base repository (into an arbitrary workbench directory), so no agent-invoked
// path should ever reach it without explicit per-invocation human instruction.

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}).trim();
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workbench';

// Resolve GitHub owner/repo identity the same way the client does, without depending on it
// (the vendored oversoul copy's exact nesting differs between the workbench and a shared repo).
function identity(remote) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote);
  if (!m) throw new Error('Expected an explicit GitHub SSH or HTTPS repository identity');
  return m[1].toLowerCase();
}

async function resolvePrimaryRoot(repoCwd) {
  const commonDir = git(repoCwd, 'rev-parse', '--git-common-dir');
  return realpath(dirname(resolve(repoCwd, commonDir)));
}

// The same connect.mjs file works unmodified from the workbench development tree (oversoul is a
// sibling of this directory) and from a vendored release inside a shared repository (oversoul is
// nested under this directory) -- whichever layout exists next to this file wins.
async function resolveOversoulPath(override) {
  if (override) return override;
  const nested = join(HERE, 'oversoul');
  if (await pathExists(join(nested, 'SKILL.md'))) return nested;
  const sibling = join(HERE, '..', 'oversoul');
  if (await pathExists(join(sibling, 'SKILL.md'))) return sibling;
  throw new Error('Could not locate the oversoul package next to connect.mjs (looked in ./oversoul and ../oversoul)');
}

const DEFAULT_CONNECT_CLIENTS = ['claude', 'codex', 'copilot'];
// status/apply default to the full candidate set: the whole point of this mechanism is to
// surface drift, including a client that was wired up some other way than `link` (e.g. a
// hand-added Antigravity MCP entry) and now has nobody checking it.
const DEFAULT_REPORT_CLIENTS = ['claude', 'codex', 'copilot', 'antigravity'];

function applicableClients(entry, clients) {
  if (!entry.clients) return true;
  return entry.clients.some(c => clients.includes(c));
}

// Builds the per-workbench context every artifact handler reads: where things are, which
// template text to render, and a bound lookup into whatever state was last recorded.
async function buildCtx({workbenchRoot, oversoulPath, target, clients, allowDowngrade}) {
  const connectorRoot = HERE;
  const templatesDir = join(connectorRoot, 'templates');
  const payloadDir = join(connectorRoot, 'payload');
  const skillMdText = await readFile(join(oversoulPath, 'SKILL.md'), 'utf8');
  const skillVersion = parseVersion(skillMdText);
  const contractTemplateText = await readFile(join(templatesDir, 'linked-repository.md'), 'utf8');
  const promptTemplatePath = join(oversoulPath, 'integrations', 'oversoul.prompt.md');

  const artifacts = buildArtifacts({oversoulPath, payloadDir, contractTemplateText, promptTemplatePath});
  const vars = {TARGET: target?.name ?? '', DIR: target?.dir ?? '', BRANCH: target?.branch ?? '', REGISTRY: '.linked-repos.json'};
  for (const entry of artifacts) {
    if (entry.kind === 'lines') entry.lines = entry.lines.map(l => l.replaceAll('{{DIR}}', vars.DIR).replaceAll('{{REGISTRY}}', vars.REGISTRY));
  }

  const state = await readState(workbenchRoot);
  return {
    workbenchRoot, clients, allowDowngrade, vars, skillVersion, packageVersion: skillVersion,
    baseFor: (id) => baseFor(state, id),
    artifacts,
  };
}

// --- provisioning: one-shot registration, not an artifact (see manifest.mjs for why) ---

async function planProvisioning({primaryRoot, workbenchRoot, resolvedWorktree, resolvedBranch, linkPath, resolvedName, resolvedDir, originUrl}) {
  const steps = [];
  let blocked = false;
  const record = (step, action, detail) => { const entry = {step, action, detail}; steps.push(entry); return entry; };

  let worktreeAction;
  if (await pathExists(resolvedWorktree)) {
    const registered = git(primaryRoot, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
    const realResolved = await realpath(resolvedWorktree);
    const registeredReal = await Promise.all(registered.map(l => realpath(l.slice(9)).catch(() => null)));
    if (registeredReal.includes(realResolved)) {
      const currentBranch = git(resolvedWorktree, 'branch', '--show-current');
      worktreeAction = currentBranch === resolvedBranch
        ? record('worktree', 'unchanged', resolvedWorktree)
        : (blocked = true, record('worktree', 'blocked', `Existing worktree at ${resolvedWorktree} is on branch "${currentBranch}", not "${resolvedBranch}"`));
    } else if ((await readdir(resolvedWorktree)).length) {
      blocked = true;
      worktreeAction = record('worktree', 'blocked', `${resolvedWorktree} exists and is not a registered worktree of this repository`);
    } else {
      worktreeAction = record('worktree', 'create', resolvedWorktree);
    }
  } else {
    worktreeAction = record('worktree', 'create', resolvedWorktree);
  }

  let branchConflict = false;
  try { git(primaryRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${resolvedBranch}`); branchConflict = worktreeAction.action !== 'unchanged'; } catch { /* branch does not exist yet */ }
  if (branchConflict) {
    blocked = true;
    record('branch', 'blocked', `Branch "${resolvedBranch}" already exists but is not the branch of the resolved worktree`);
  } else {
    record('branch', worktreeAction.action === 'unchanged' ? 'unchanged' : 'create', resolvedBranch);
  }

  let linkAction;
  if (await pathExists(linkPath)) {
    let linkTarget = null;
    try { linkTarget = await realpath(linkPath); } catch { /* broken link */ }
    const worktreeReal = await pathExists(resolvedWorktree) ? await realpath(resolvedWorktree) : null;
    if (linkTarget && worktreeReal && linkTarget === worktreeReal) {
      linkAction = record('link', 'unchanged', linkPath);
    } else {
      blocked = true;
      linkAction = record('link', 'blocked', `${linkPath} exists and does not resolve to ${resolvedWorktree}`);
    }
  } else {
    linkAction = record('link', 'create', linkPath);
  }

  const registryPath = join(workbenchRoot, '.linked-repos.json');
  let registry = {version: 1, targets: {}};
  if (await pathExists(registryPath)) {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
    if (registry.version !== 1 || !registry.targets) throw new Error('Unsupported target registry at ' + registryPath);
  }
  const desiredEntry = {path: resolvedDir, remote: originUrl, branch: resolvedBranch, upstream: 'origin/main'};
  const existingEntry = registry.targets[resolvedName];
  let registryAction;
  if (existingEntry) {
    const same = ['path', 'remote', 'branch', 'upstream'].every(k => existingEntry[k] === desiredEntry[k]);
    registryAction = same
      ? record('registry', 'unchanged', resolvedName)
      : (blocked = true, record('registry', 'blocked', {name: resolvedName, existing: existingEntry, desired: desiredEntry}));
  } else {
    registryAction = record('registry', 'create', resolvedName);
  }

  return {steps, blocked, worktreeAction, linkAction, registryAction, registry, registryPath, desiredEntry};
}

async function mutateProvisioning(plan, {primaryRoot, workbenchRoot, resolvedWorktree, resolvedBranch, linkPath, resolvedName, fetchRemote}) {
  const fetch = fetchRemote ?? ((root) => git(root, 'fetch', '--no-tags', 'origin'));
  if (plan.worktreeAction.action === 'create') {
    fetch(primaryRoot);
    git(primaryRoot, 'worktree', 'add', '-b', resolvedBranch, resolvedWorktree, 'origin/main');
    git(resolvedWorktree, 'branch', '--set-upstream-to', 'origin/main');
  }
  if (plan.linkAction.action === 'create') {
    await mkdir(dirname(linkPath), {recursive: true});
    await symlink(resolve(resolvedWorktree), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  }
  if (plan.registryAction.action === 'create') {
    plan.registry.targets[resolvedName] = plan.desiredEntry;
    await writeJsonAtomic(plan.registryPath, plan.registry);
  }
}

// --- the manifest walk shared by link/apply ---

async function planArtifacts(ctx) {
  const applicable = ctx.artifacts.filter(e => applicableClients(e, ctx.clients));
  const probed = [];
  for (const entry of applicable) probed.push({entry, result: await probeArtifact(ctx, entry)});
  const blocked = probed.some(({entry, result}) => isBlocking(result, entry, {allowDowngrade: ctx.allowDowngrade}) && !(ctx.force ?? []).includes(entry.id));
  return {probed, blocked};
}

async function mutateArtifacts(ctx, probed) {
  const stateUpdates = {};
  const steps = [];
  for (const {entry, result} of probed) {
    if (!needsWrite(result)) { steps.push({step: result.id, kind: result.kind, dest: result.dest, action: result.state === 'current' ? 'unchanged' : result.state, detail: result.detail}); continue; }
    const applied = await applyArtifact(ctx, entry, result);
    steps.push({step: result.id, kind: result.kind, dest: result.dest, action: applied.action, detail: applied.detail ?? result.detail});
    if (applied.hash) {
      if (applied.multiKey) for (const k of applied.multiKey) stateUpdates[k] = applied.hash;
      else stateUpdates[entry.id] = applied.hash;
    }
  }
  if (Object.keys(stateUpdates).length) await writeState(ctx.workbenchRoot, ctx.packageVersion, stateUpdates);
  return steps;
}

function plannedArtifactSteps(probed) {
  return probed.map(({result}) => ({step: result.id, kind: result.kind, dest: result.dest, action: result.state === 'current' ? 'unchanged' : result.state, detail: result.detail}));
}

// --- self-verify: run the just-installed client's own inspect against the target ---

async function findClientLinkedRepo(workbenchRoot) {
  for (const p of [join(workbenchRoot, '.claude', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs'), join(workbenchRoot, '.agents', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')]) {
    if (await pathExists(p)) return p;
  }
  return null;
}

/**
 * Connects a new workbench: provisions the worktree/junction/registry entry, then applies the
 * full artifact manifest in the same plan-then-mutate pass. Two phases: every check runs first
 * (Phase A), and nothing is written unless `yes` is true and nothing was blocked (Phase B).
 */
export async function connect(opts) {
  const {
    repoCwd = process.cwd(),
    workbench,
    name,
    dir,
    branch,
    worktreePath,
    clients = DEFAULT_CONNECT_CLIENTS,
    yes = false,
    force = [],
    allowDowngrade = false,
    fetchRemote,
    oversoulPath: oversoulOverride,
  } = opts;
  if (!workbench) throw new Error('workbench is required');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 11) throw new Error('Use Node 24.11+ within Node 24 LTS');

  const primaryRoot = await resolvePrimaryRoot(repoCwd);
  const originUrl = git(primaryRoot, 'remote', 'get-url', 'origin');
  identity(originUrl);

  const workbenchRoot = await realpath(resolve(workbench));
  if (workbenchRoot === primaryRoot || inside(primaryRoot, workbenchRoot) || inside(workbenchRoot, primaryRoot)) {
    throw new Error('Refusing: the workbench and knowledge-base repository paths overlap');
  }

  const resolvedName = name || basename(primaryRoot);
  const resolvedDir = dir || resolvedName;
  const resolvedBranch = branch || `workbench/${sanitize(basename(workbenchRoot))}`;
  const resolvedWorktree = worktreePath || join(dirname(primaryRoot), `${basename(primaryRoot)}-worktrees`, sanitize(basename(workbenchRoot)));
  const linkPath = join(workbenchRoot, resolvedDir);
  const oversoulPath = await resolveOversoulPath(oversoulOverride);

  const warnings = [];
  if (git(primaryRoot, 'status', '--porcelain')) {
    warnings.push('Primary clone has uncommitted changes; worktree add does not touch them, but confirm origin/main is what you expect before relying on it.');
  }

  const provisioningPlan = await planProvisioning({primaryRoot, workbenchRoot, resolvedWorktree, resolvedBranch, linkPath, resolvedName, resolvedDir, originUrl});

  const ctx = await buildCtx({workbenchRoot, oversoulPath, target: {name: resolvedName, dir: resolvedDir, branch: resolvedBranch}, clients, allowDowngrade});
  ctx.force = force;
  const artifactPlan = await planArtifacts(ctx);

  const blocked = provisioningPlan.blocked || artifactPlan.blocked;
  const steps = [...provisioningPlan.steps, ...plannedArtifactSteps(artifactPlan.probed), {step: 'self-verify', action: 'planned', detail: resolvedName}];

  if (!yes) {
    return {status: 'planned', target: resolvedName, workbench: workbenchRoot, worktree: resolvedWorktree, link: linkPath, branch: resolvedBranch, steps, warnings};
  }
  if (blocked) {
    return {status: 'blocked', target: resolvedName, workbench: workbenchRoot, steps, warnings};
  }

  await mutateProvisioning(provisioningPlan, {primaryRoot, workbenchRoot, resolvedWorktree, resolvedBranch, linkPath, resolvedName, fetchRemote});
  const artifactSteps = await mutateArtifacts(ctx, artifactPlan.probed);

  const verifyLinkedRepo = await findClientLinkedRepo(workbenchRoot);
  let selfVerify;
  if (verifyLinkedRepo) {
    const verifyResult = spawnSync(process.execPath, [verifyLinkedRepo, 'inspect', '--target', resolvedName], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
    let parsed; try { parsed = JSON.parse(verifyResult.stdout); } catch { parsed = {raw: verifyResult.stdout}; }
    selfVerify = {step: 'self-verify', action: verifyResult.status === 0 ? 'ready' : (verifyResult.status === 2 ? 'blocked' : 'unverified'), detail: parsed};
  } else {
    selfVerify = {step: 'self-verify', action: 'skipped', detail: 'No installed client to verify with'};
  }

  return {status: 'connected', target: resolvedName, workbench: workbenchRoot, worktree: resolvedWorktree, link: linkPath, branch: resolvedBranch, steps: [...provisioningPlan.steps, ...artifactSteps, selfVerify], warnings};
}

// --- read-only reporting ---

async function loadRegisteredTarget(workbenchRoot, name) {
  const registryPath = join(workbenchRoot, '.linked-repos.json');
  if (!await pathExists(registryPath)) return {registered: false};
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const names = Object.keys(registry.targets ?? {});
  const target = name ?? (names.length === 1 ? names[0] : undefined);
  if (!target || !registry.targets[target]) return {registered: false, available: names};
  return {registered: true, target, entry: registry.targets[target]};
}

async function probeProvisioningReadOnly(workbenchRoot, resolved) {
  if (!resolved.registered) return [{step: 'registry', action: 'missing', detail: 'Not yet registered'}];
  const {entry} = resolved;
  const linkPath = join(workbenchRoot, entry.path);
  const steps = [];
  steps.push({step: 'registry', action: 'current', detail: resolved.target});
  const linkOk = await pathExists(linkPath) && await realpath(linkPath).then(() => true).catch(() => false);
  steps.push({step: 'link', action: linkOk ? 'current' : 'missing', detail: linkPath});
  return steps;
}

/**
 * Reports every artifact's state plus provisioning, touching nothing. `status` is the command
 * that answers "am I current" -- the thing neither `link`/`update` nor `verify` could answer
 * before this mechanism existed.
 */
export async function status(opts) {
  const {workbench, name, clients = DEFAULT_REPORT_CLIENTS, oversoulPath: oversoulOverride} = opts;
  const workbenchRoot = await realpath(resolve(workbench));
  const resolved = await loadRegisteredTarget(workbenchRoot, name);
  if (!resolved.registered) return {status: 'unregistered', workbench: workbenchRoot, available: resolved.available};

  const oversoulPath = await resolveOversoulPath(oversoulOverride);
  const provisioning = await probeProvisioningReadOnly(workbenchRoot, resolved);
  const ctx = await buildCtx({workbenchRoot, oversoulPath, target: {name: resolved.target, dir: resolved.entry.path, branch: resolved.entry.branch}, clients});
  const {probed} = await planArtifacts(ctx);
  const artifacts = plannedArtifactSteps(probed);

  const summary = {};
  for (const a of artifacts) summary[a.action] = (summary[a.action] ?? 0) + 1;

  return {status: 'reported', target: resolved.target, workbench: workbenchRoot, package: ctx.packageVersion, provisioning, artifacts, summary};
}

/**
 * Brings every artifact that `status` would report as not current up to date -- installing a new
 * client and updating an already-connected workbench are the same operation from here on.
 * `force` names specific artifact ids allowed to overwrite a locally-modified/blocked state;
 * without it, any such artifact stops the whole run with nothing written, same as a dry run.
 */
export async function apply(opts) {
  const {workbench, name, clients = DEFAULT_REPORT_CLIENTS, yes = false, force = [], allowDowngrade = false, oversoulPath: oversoulOverride} = opts;
  const workbenchRoot = await realpath(resolve(workbench));
  const resolved = await loadRegisteredTarget(workbenchRoot, name);
  if (!resolved.registered) return {status: 'unregistered', workbench: workbenchRoot, available: resolved.available};

  const oversoulPath = await resolveOversoulPath(oversoulOverride);
  const ctx = await buildCtx({workbenchRoot, oversoulPath, target: {name: resolved.target, dir: resolved.entry.path, branch: resolved.entry.branch}, clients, allowDowngrade});
  ctx.force = force;
  const {probed, blocked} = await planArtifacts(ctx);

  if (!yes) return {status: 'planned', target: resolved.target, workbench: workbenchRoot, steps: plannedArtifactSteps(probed)};
  if (blocked) return {status: 'blocked', target: resolved.target, workbench: workbenchRoot, steps: plannedArtifactSteps(probed)};

  const steps = await mutateArtifacts(ctx, probed);
  return {status: 'complete', target: resolved.target, workbench: workbenchRoot, steps};
}

/**
 * `status` plus the existing Shrimp-side sync check, kept as two separate fields: a workbench's
 * own tooling being current is a different question from the linked repository being in sync.
 */
export async function verify(opts) {
  const {workbench, name} = opts;
  const workbenchRoot = await realpath(resolve(workbench));
  const s = await status({workbench, name});
  const clientLinkedRepo = await findClientLinkedRepo(workbenchRoot);
  if (!clientLinkedRepo) return {status: 'no-client-installed', workbench: workbenchRoot, artifacts: s};
  const resolved = await loadRegisteredTarget(workbenchRoot, name);
  const result = spawnSync(process.execPath, [clientLinkedRepo, 'inspect', '--target', resolved.target], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
  let parsed; try { parsed = JSON.parse(result.stdout); } catch { parsed = {raw: result.stdout}; }
  const artifactsCurrent = s.status === 'reported' && s.artifacts.every(a => ['unchanged', 'preserved'].includes(a.action));
  const status_ = result.status === 0 ? (artifactsCurrent ? 'ready' : 'stale') : (result.status === 2 ? 'blocked' : 'unverified');
  return {status: status_, exitCode: result.status, target: resolved.target, linkedRepo: parsed, artifacts: s};
}

export {parseVersion};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (!['status', 'link', 'apply', 'verify'].includes(command)) throw new Error('Use status, link, apply, or verify');
    const flags = new Map();
    const listFlags = new Set(['--clients', '--force']);
    const boolFlags = new Set(['--yes', '--allow-downgrade', '--json']);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (!a.startsWith('--')) throw new Error('Unknown argument: ' + a);
      if (boolFlags.has(a)) { flags.set(a, true); continue; }
      flags.set(a, rest[++i]);
    }
    const opts = {
      workbench: flags.get('--workbench'),
      name: flags.get('--name'),
      dir: flags.get('--dir'),
      branch: flags.get('--branch'),
      worktreePath: flags.get('--worktree'),
      clients: flags.has('--clients') ? flags.get('--clients').split(',') : undefined,
      force: flags.has('--force') ? flags.get('--force').split(',') : undefined,
      yes: flags.get('--yes') === true,
      allowDowngrade: flags.get('--allow-downgrade') === true,
    };
    if (!opts.workbench) throw new Error('--workbench is required');
    const result = command === 'link' ? await connect(opts) : command === 'status' ? await status(opts) : command === 'verify' ? await verify(opts) : await apply(opts);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked' || result.status === 'unverified' || result.status === 'unregistered' || result.status === 'stale') process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({status: 'invalid', error: e.message}));
    process.exitCode = 1;
  }
}
