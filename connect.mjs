import {readFile, writeFile, mkdir, realpath, readdir, stat, symlink, rename, rm} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep, join, dirname, basename} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

// Always resolve sibling files (templates/, an adjacent oversoul/) against this module's own
// location, never process.argv[1] — the latter is the caller's file when connect() is imported
// as a module (as the tests do), not this file.
const HERE = dirname(fileURLToPath(import.meta.url));

// Human-invoked bootstrap tool. Deliberately not a protocol.json capability: it writes outside
// the knowledge-base repository (into an arbitrary workbench directory), so no agent-invoked
// path should ever reach it without explicit per-invocation human instruction.

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000}).trim();
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workbench';
const pathExists = async (p) => { try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

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
// nested under this directory) — whichever layout exists next to this file wins.
async function resolveOversoulPath(override) {
  if (override) return override;
  const nested = join(HERE, 'oversoul');
  if (await pathExists(join(nested, 'SKILL.md'))) return nested;
  const sibling = join(HERE, '..', 'oversoul');
  if (await pathExists(join(sibling, 'SKILL.md'))) return sibling;
  throw new Error('Could not locate the oversoul package next to connect.mjs (looked in ./oversoul and ../oversoul)');
}

function parseVersion(skillMdText) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMdText)?.[1];
  return /^\s{2}version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(frontmatter ?? '')?.[1];
}

async function collectTree(root) {
  const out = new Set();
  async function walk(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name);
      out.add(relative(root, full).split(sep).join('/'));
      if (entry.isDirectory()) await walk(full);
    }
  }
  if (await pathExists(root)) await walk(root);
  return out;
}

async function writeJsonAtomic(path, obj) {
  const tmp = path + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await rename(tmp, path);
}

/**
 * Builds a two-phase plan (checks, then mutations). Every step is recorded once during the
 * check phase; `link`/`update` only perform the mutations named `create`/`update`/`downgraded`
 * etc. when `yes` is true and nothing was blocked. Steps whose real outcome can only be known by
 * invoking a subprocess (skill install, self-verify) are recorded as `pending` in the plan and
 * replaced with their real outcome once actually run.
 */
export async function connect(opts) {
  const {
    repoCwd = process.cwd(),
    workbench,
    name,
    dir,
    branch,
    worktreePath,
    clients = ['claude', 'codex', 'copilot'],
    yes = false,
    skipMcp = false,
    skipContract = false,
    updateContract = false,
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
  const templatesDir = join(HERE, 'templates');

  const steps = [];
  const warnings = [];
  let blocked = false;
  const record = (step, action, detail) => { const entry = {step, action, detail}; steps.push(entry); return entry; };

  if (git(primaryRoot, 'status', '--porcelain')) {
    warnings.push('Primary clone has uncommitted changes; worktree add does not touch them, but confirm origin/main is what you expect before relying on it.');
  }

  // --- worktree ---
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

  // --- branch ---
  let branchConflict = false;
  try { git(primaryRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${resolvedBranch}`); branchConflict = worktreeAction.action !== 'unchanged'; } catch { /* branch does not exist yet */ }
  if (branchConflict) {
    blocked = true;
    record('branch', 'blocked', `Branch "${resolvedBranch}" already exists but is not the branch of the resolved worktree`);
  } else {
    record('branch', worktreeAction.action === 'unchanged' ? 'unchanged' : 'create', resolvedBranch);
  }

  // --- link ---
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

  // --- registry ---
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

  // --- .gitignore ---
  const gitignorePath = join(workbenchRoot, '.gitignore');
  const requiredIgnoreLines = [`/${resolvedDir}/`, '/.linked-repos.json', '.claude/skills/oversoul/', '.agents/'];
  let gitignoreAction = null;
  if (await pathExists(join(workbenchRoot, '.git'))) {
    const existingText = await pathExists(gitignorePath) ? await readFile(gitignorePath, 'utf8') : '';
    const existingLines = new Set(existingText.split(/\r?\n/).map(l => l.trim()));
    const missing = requiredIgnoreLines.filter(l => !existingLines.has(l));
    gitignoreAction = missing.length
      ? record('gitignore', 'update', {path: gitignorePath, adding: missing})
      : record('gitignore', 'unchanged', gitignorePath);
  }

  // --- contract (AGENTS.md) ---
  const sourceSkillVersion = parseVersion(await readFile(join(oversoulPath, 'SKILL.md'), 'utf8'));
  const beginRe = /<!-- oversoul:linked-repository:begin[^>]*-->[\s\S]*?<!-- oversoul:linked-repository:end -->/;
  let contractAction = null;
  let renderedBlock = null;
  if (!skipContract) {
    const templateText = await readFile(join(templatesDir, 'linked-repository.md'), 'utf8');
    const body = templateText
      .replaceAll('{{TARGET}}', resolvedName)
      .replaceAll('{{DIR}}', resolvedDir)
      .replaceAll('{{BRANCH}}', resolvedBranch)
      .replaceAll('{{REGISTRY}}', '.linked-repos.json')
      .trim();
    renderedBlock = `<!-- oversoul:linked-repository:begin v=${sourceSkillVersion} target=${resolvedName} -->\n${body}\n<!-- oversoul:linked-repository:end -->`;
    const agentsPath = join(workbenchRoot, 'AGENTS.md');
    const agentsText = await pathExists(agentsPath) ? await readFile(agentsPath, 'utf8') : '';
    const match = beginRe.exec(agentsText);
    if (match) {
      if (match[0] === renderedBlock) contractAction = record('contract', 'unchanged', agentsPath);
      else if (!updateContract) { blocked = true; contractAction = record('contract', 'blocked', `${agentsPath} has a differing linked-repository block; pass updateContract to replace it`); }
      else contractAction = record('contract', 'update', agentsPath);
    } else {
      contractAction = record('contract', agentsText ? 'append' : 'create', agentsPath);
    }
  } else {
    contractAction = record('contract', 'skipped', 'AGENTS.md');
  }

  // --- CLAUDE.md ---
  let claudeMdAction = null;
  if (clients.includes('claude')) {
    const claudeMdPath = join(workbenchRoot, 'CLAUDE.md');
    claudeMdAction = await pathExists(claudeMdPath) ? record('claude-md', 'unchanged', claudeMdPath) : record('claude-md', 'create', claudeMdPath);
  }

  // --- MCP wiring ---
  const notionDecl = {type: 'http', url: 'https://mcp.notion.com/mcp'};
  const mcpActions = [];
  async function planJsonMcp(path, keyPath, stepName) {
    const existed = await pathExists(path);
    const obj = existed ? JSON.parse(await readFile(path, 'utf8')) : {};
    let cursor = obj;
    for (const k of keyPath.slice(0, -1)) cursor = (cursor[k] ??= {});
    const lastKey = keyPath[keyPath.length - 1];
    const existingValue = cursor[lastKey];
    if (existingValue !== undefined) {
      return JSON.stringify(existingValue) === JSON.stringify(notionDecl)
        ? record(stepName, 'unchanged', path)
        : record(stepName, 'preserved', {path, reason: 'A different notion entry already exists; not overwritten', existing: existingValue});
    }
    return record(stepName, existed ? 'update' : 'create', path);
  }
  async function planCodexMcp() {
    const path = join(workbenchRoot, '.codex', 'config.toml');
    const existed = await pathExists(path);
    const text = existed ? await readFile(path, 'utf8') : '';
    return text.includes('[mcp_servers.notion]')
      ? record('mcp:.codex/config.toml', 'unchanged', path)
      : record('mcp:.codex/config.toml', existed ? 'update' : 'create', path);
  }
  if (skipMcp) {
    mcpActions.push(record('mcp', 'skipped', 'all clients'));
  } else {
    if (clients.includes('claude')) mcpActions.push(await planJsonMcp(join(workbenchRoot, '.mcp.json'), ['mcpServers', 'notion'], 'mcp:.mcp.json'));
    if (clients.includes('copilot')) mcpActions.push(await planJsonMcp(join(workbenchRoot, '.vscode', 'mcp.json'), ['servers', 'notion'], 'mcp:.vscode/mcp.json'));
    if (clients.includes('codex')) mcpActions.push(await planCodexMcp());
  }

  // --- skill install / self-verify: outcome only knowable by actually running them ---
  record('install', yes ? 'pending' : 'planned', {clients, allowDowngrade});
  record('self-verify', yes ? 'pending' : 'planned', resolvedName);

  if (!yes) {
    return {status: 'planned', target: resolvedName, workbench: workbenchRoot, worktree: resolvedWorktree, link: linkPath, branch: resolvedBranch, steps, warnings};
  }
  if (blocked) {
    return {status: 'blocked', target: resolvedName, workbench: workbenchRoot, steps, warnings};
  }

  // --- Phase B: mutate ---
  const fetch = fetchRemote ?? ((root) => git(root, 'fetch', '--no-tags', 'origin'));
  if (worktreeAction.action === 'create') {
    fetch(primaryRoot);
    git(primaryRoot, 'worktree', 'add', '-b', resolvedBranch, resolvedWorktree, 'origin/main');
    git(resolvedWorktree, 'branch', '--set-upstream-to', 'origin/main');
  }
  if (linkAction.action === 'create') {
    await mkdir(dirname(linkPath), {recursive: true});
    await symlink(resolve(resolvedWorktree), linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  }
  if (registryAction.action === 'create') {
    registry.targets[resolvedName] = desiredEntry;
    await writeJsonAtomic(registryPath, registry);
  }
  if (gitignoreAction && gitignoreAction.action === 'update') {
    const existingText = await pathExists(gitignorePath) ? await readFile(gitignorePath, 'utf8') : '';
    const sep2 = existingText && !existingText.endsWith('\n') ? '\n' : '';
    const block = `${sep2}# Linked knowledge-base worktree (added by connect)\n${gitignoreAction.detail.adding.join('\n')}\n`;
    await writeFile(gitignorePath, existingText + block);
  }

  // Skill install: real outcome comes from the installer itself.
  const installIndex = steps.findIndex(s => s.step === 'install');
  const installArgs = [...clients];
  if (allowDowngrade) installArgs.push('--allow-downgrade');
  installArgs.push('--scaffold-agents');
  const installResult = spawnSync(process.execPath, [join(oversoulPath, 'scripts', 'install.mjs'), ...installArgs], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
  const installOutcomes = (installResult.stdout || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {raw: l}; } });
  steps[installIndex] = {step: 'install', action: installResult.status === 0 ? 'complete' : 'blocked', detail: {exitCode: installResult.status, outcomes: installOutcomes, stderr: installResult.stderr || undefined}};
  if (installResult.status !== 0) blocked = true;

  if (contractAction && ['create', 'append', 'update'].includes(contractAction.action)) {
    // install.mjs may have just scaffolded AGENTS.md (or something else could have touched it);
    // re-check against the file's actual current content rather than trusting the pre-install
    // snapshot, so this write is correct regardless of what happened in between.
    const agentsPath = join(workbenchRoot, 'AGENTS.md');
    const agentsText = await pathExists(agentsPath) ? await readFile(agentsPath, 'utf8') : '';
    const freshMatch = beginRe.exec(agentsText);
    if (freshMatch && freshMatch[0] === renderedBlock) {
      contractAction.action = 'unchanged';
    } else if (freshMatch) {
      await writeFile(agentsPath, agentsText.replace(beginRe, renderedBlock));
    } else {
      const sep2 = agentsText && !agentsText.endsWith('\n\n') ? (agentsText.endsWith('\n') ? '\n' : '\n\n') : '';
      await writeFile(agentsPath, agentsText + sep2 + renderedBlock + '\n');
    }
  }
  if (claudeMdAction && claudeMdAction.action === 'create') {
    await writeFile(join(workbenchRoot, 'CLAUDE.md'), '@./AGENTS.md\n');
  }
  for (const action of mcpActions) {
    if (!['create', 'update'].includes(action.action)) continue;
    if (action.step === 'mcp:.codex/config.toml') {
      const path = action.detail;
      const existingText = await pathExists(path) ? await readFile(path, 'utf8') : '';
      const block = `${existingText && !existingText.endsWith('\n') ? '\n' : ''}[mcp_servers.notion]\nurl = "https://mcp.notion.com/mcp"\n`;
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, existingText + block);
    } else {
      const path = action.detail;
      const existed = await pathExists(path);
      const obj = existed ? JSON.parse(await readFile(path, 'utf8')) : {};
      const keyPath = action.step === 'mcp:.mcp.json' ? ['mcpServers', 'notion'] : ['servers', 'notion'];
      let cursor = obj;
      for (const k of keyPath.slice(0, -1)) cursor = (cursor[k] ??= {});
      cursor[keyPath[keyPath.length - 1]] = notionDecl;
      await mkdir(dirname(path), {recursive: true});
      await writeJsonAtomic(path, obj);
    }
  }

  // Self-verify: run the just-installed client's own inspect against the target.
  const verifyIndex = steps.findIndex(s => s.step === 'self-verify');
  const clientLinkedRepo = (await pathExists(join(workbenchRoot, '.claude', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')))
    ? join(workbenchRoot, '.claude', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')
    : (await pathExists(join(workbenchRoot, '.agents', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')))
      ? join(workbenchRoot, '.agents', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')
      : null;
  if (clientLinkedRepo) {
    const verifyResult = spawnSync(process.execPath, [clientLinkedRepo, 'inspect', '--target', resolvedName], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
    let parsed; try { parsed = JSON.parse(verifyResult.stdout); } catch { parsed = {raw: verifyResult.stdout}; }
    steps[verifyIndex] = {step: 'self-verify', action: verifyResult.status === 0 ? 'ready' : (verifyResult.status === 2 ? 'blocked' : 'unverified'), detail: parsed};
  } else {
    steps[verifyIndex] = {step: 'self-verify', action: 'skipped', detail: 'No installed client to verify with'};
  }

  return {status: blocked ? 'blocked' : 'connected', target: resolvedName, workbench: workbenchRoot, worktree: resolvedWorktree, link: linkPath, branch: resolvedBranch, steps, warnings};
}

export {parseVersion};

async function statusOrVerify(command, opts) {
  const {repoCwd = process.cwd(), workbench, name} = opts;
  const workbenchRoot = await realpath(resolve(workbench));
  const registryPath = join(workbenchRoot, '.linked-repos.json');
  if (!await pathExists(registryPath)) return {status: 'unregistered', workbench: workbenchRoot};
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const names = Object.keys(registry.targets ?? {});
  const target = name ?? (names.length === 1 ? names[0] : undefined);
  if (!target || !registry.targets[target]) return {status: 'unregistered', workbench: workbenchRoot, available: names};
  const clientLinkedRepo = (await pathExists(join(workbenchRoot, '.claude', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')))
    ? join(workbenchRoot, '.claude', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')
    : (await pathExists(join(workbenchRoot, '.agents', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')))
      ? join(workbenchRoot, '.agents', 'skills', 'oversoul', 'scripts', 'linked-repo.mjs')
      : null;
  if (!clientLinkedRepo) return {status: 'no-client-installed', workbench: workbenchRoot, target, registered: registry.targets[target]};
  const result = spawnSync(process.execPath, [clientLinkedRepo, 'inspect', '--target', target], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
  let parsed; try { parsed = JSON.parse(result.stdout); } catch { parsed = {raw: result.stdout}; }
  return {status: command === 'verify' ? (result.status === 0 ? 'ready' : (result.status === 2 ? 'blocked' : 'unverified')) : 'reported', exitCode: result.status, target, detail: parsed};
}

export const status = (opts) => statusOrVerify('status', opts);
export const verify = (opts) => statusOrVerify('verify', opts);

export async function update(opts) {
  const {workbench, clients = ['claude', 'codex', 'copilot'], allowDowngrade = false, yes = false, oversoulPath: oversoulOverride} = opts;
  const workbenchRoot = await realpath(resolve(workbench));
  const oversoulPath = await resolveOversoulPath(oversoulOverride);
  if (!yes) return {status: 'planned', workbench: workbenchRoot, clients, note: 'Pass yes to actually run the installer.'};
  const args = [...clients];
  if (allowDowngrade) args.push('--allow-downgrade');
  const result = spawnSync(process.execPath, [join(oversoulPath, 'scripts', 'install.mjs'), ...args], {cwd: workbenchRoot, encoding: 'utf8', timeout: 60000});
  const outcomes = (result.stdout || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {raw: l}; } });
  return {status: result.status === 0 ? 'complete' : 'blocked', exitCode: result.status, outcomes, stderr: result.stderr || undefined};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (!['status', 'link', 'update', 'verify'].includes(command)) throw new Error('Use status, link, update, or verify');
    const flags = new Map();
    const listFlags = new Set(['--clients']);
    const boolFlags = new Set(['--yes', '--skip-mcp', '--skip-contract', '--update-contract', '--allow-downgrade']);
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
      yes: flags.get('--yes') === true,
      skipMcp: flags.get('--skip-mcp') === true,
      skipContract: flags.get('--skip-contract') === true,
      updateContract: flags.get('--update-contract') === true,
      allowDowngrade: flags.get('--allow-downgrade') === true,
    };
    if (!opts.workbench) throw new Error('--workbench is required');
    const result = command === 'link' ? await connect(opts) : command === 'status' ? await status(opts) : command === 'verify' ? await verify(opts) : await update(opts);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked' || result.status === 'unverified' || result.status === 'unregistered') process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({status: 'invalid', error: e.message}));
    process.exitCode = 1;
  }
}
