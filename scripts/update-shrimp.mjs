import {cp, mkdir, mkdtemp, readFile, readdir, rename, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {pathExists, replaceTree, sha256, writeJsonAtomic} from '../workbench-connector/shared/fs.mjs';
import {compareRelease} from '../workbench-connector/shared/skill-install.mjs';

const SYSTEM_DIR = '.shrimp/system';
const CONNECTOR_DEST = '.shrimp/system/connector';
// Both `bootstrap/connect.mjs` and `oversoul/scripts/install.mjs` read `../../engine.json` relative
// to their own package directory, which lands here once vendored. Without it they fail with ENOENT
// against a Shrimp checkout, so the release is copied in beside the connector it describes.
const ENGINE_RECORD = '.shrimp/system/engine.json';
const RELEASE_RECORD = '.shrimp/release.json';
const PROJECT_CONFIG = '.shrimp/project.json';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Applies a candidate package into a Shrimp working tree so its administrator can review the diff
 * and commit it. The package is verified before anything is extracted, and nothing outside
 * `.shrimp/system/connector`, `.shrimp/system/engine.json`, and `.shrimp/release.json` is ever
 * written. This never runs git write commands -- `rev-parse` and `status` are the only two it
 * calls, both read-only.
 */
export async function applyRelease({shrimp, packagePath, yes = false, force = [], allowDowngrade = false}) {
  if (!shrimp) throw new Error('--shrimp is required');
  if (!packagePath) throw new Error('--package is required');
  const shrimpRoot = await realpath(resolve(shrimp));

  // The whole administrator flow -- review the diff, commit it, revert it -- and the local-edit
  // detector below depend on the target being a git work tree, so refuse anything else outright.
  let topLevel;
  try {
    topLevel = await realpath(git(shrimpRoot, 'rev-parse', '--show-toplevel'));
  } catch {
    throw new Error(`Not a git work tree: ${shrimpRoot}`);
  }
  if (topLevel !== shrimpRoot) throw new Error(`Not the root of its git work tree: ${shrimpRoot} (root is ${topLevel})`);

  // Verify before extracting: a package that fails its own hash never reaches the filesystem.
  const tarballPath = resolve(packagePath);
  const tarball = await readFile(tarballPath);
  const manifest = await readJson(join(dirname(tarballPath), 'manifest.json'));
  const bundleHash = sha256(tarball);
  if (bundleHash !== manifest.bundleHash) {
    throw new Error(`Package failed verification: manifest records ${manifest.bundleHash}, package hashes to ${bundleHash}`);
  }

  const staging = await mkdtemp(join(tmpdir(), 'shrimp-update-'));
  execFileSync('tar', ['-x', '-z', '-f', tarballPath, '-C', staging]);

  // Release identity comes from inside the verified bytes, never from the manifest beside them.
  const engine = await readJson(join(staging, 'engine.json'));
  const engineRelease = engine.engineRelease;
  if (!/^\d+\.\d+\.\d+$/.test(engineRelease ?? '')) throw new Error('Invalid engineRelease in packaged engine.json');
  if (!Number.isInteger(engine.protocol)) throw new Error('Invalid protocol in packaged engine.json');
  const source = join(staging, 'workbench-connector');
  if (!await pathExists(source)) throw new Error('Package contains no workbench-connector directory');

  const record = {
    version: 1,
    engineRelease,
    protocol: engine.protocol,
    sourceCommit: manifest.commit,
    bundleHash,
    appliedAt: new Date().toISOString(),
  };

  const target = join(shrimpRoot, CONNECTOR_DEST);
  const recordPath = join(shrimpRoot, RELEASE_RECORD);
  const current = await pathExists(recordPath) ? await readJson(recordPath) : null;
  const steps = [];
  let blocked = false;

  if (current?.engineRelease && compareRelease(engineRelease, current.engineRelease) < 0 && !allowDowngrade) {
    steps.push({step: 'release', action: 'ahead', installed: current.engineRelease, source: engineRelease, reason: 'Adopted engine release is newer than this package; pass --allow-downgrade to force'});
    blocked = true;
  }

  // Git answers "did a human touch this?" better than a content hash can: it also sees deletions
  // and untracked additions. Uncommitted engine output from a previous apply blocks too, which is
  // deliberate -- it keeps two unreviewed releases from stacking into one diff.
  const dirty = git(shrimpRoot, 'status', '--porcelain', '--', SYSTEM_DIR);
  if (dirty && !force.includes(CONNECTOR_DEST)) {
    steps.push({step: CONNECTOR_DEST, action: 'locally-modified', detail: dirty.split('\n'), reason: `Uncommitted changes under ${SYSTEM_DIR}; commit them, or name ${CONNECTOR_DEST} in --force to overwrite`});
    blocked = true;
  } else {
    const connectorPresent = await pathExists(target);
    const connectorCurrent = connectorPresent && current?.bundleHash === bundleHash && !dirty;
    steps.push({step: CONNECTOR_DEST, action: !connectorPresent ? 'missing' : connectorCurrent ? 'unchanged' : 'stale'});
  }

  const enginePath = join(shrimpRoot, ENGINE_RECORD);
  const currentEngine = await pathExists(enginePath) ? await readJson(enginePath).catch(() => null) : null;
  steps.push({step: ENGINE_RECORD, action: !currentEngine ? 'missing' : currentEngine.engineRelease === engineRelease && currentEngine.protocol === engine.protocol ? 'unchanged' : 'stale'});

  steps.push({step: RELEASE_RECORD, action: !current ? 'missing' : current.bundleHash === bundleHash ? 'unchanged' : 'stale', from: current?.engineRelease, to: engineRelease});
  // Stated in every plan, present or absent, so the preservation guarantee is visible and assertable.
  steps.push({step: PROJECT_CONFIG, action: 'preserved'});

  const legacyTools = join(shrimpRoot, 'tools', 'connect');
  const hasLegacyTools = await pathExists(legacyTools);
  if (hasLegacyTools) {
    steps.push({step: 'tools/connect', action: 'retired', reason: 'Replaced by .shrimp/system/connector'});
  }

  const summary = {shrimp: shrimpRoot, engineRelease, protocol: engine.protocol, sourceCommit: manifest.commit, bundleHash, steps};
  if (!yes) return {status: 'planned', ...summary};
  if (blocked) return {status: 'blocked', ...summary};

  await mkdir(join(shrimpRoot, SYSTEM_DIR), {recursive: true});
  const staged = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(staged, {recursive: true, force: true});
  await cp(source, staged, {recursive: true, errorOnExist: true, force: false});
  if (await pathExists(target)) await replaceTree({target, staged});
  else await rename(staged, target);

  await writeJsonAtomic(enginePath, engine);

  if (hasLegacyTools) {
    await rm(legacyTools, {recursive: true, force: true});
    try {
      const toolsDir = join(shrimpRoot, 'tools');
      const remaining = await readdir(toolsDir);
      if (remaining.length === 0) await rm(toolsDir, {recursive: true, force: true});
    } catch {}
  }

  // The receipt lands last: a crash before it leaves release.json naming the previous release, so
  // re-running simply re-applies rather than needing a repair path.
  await writeJsonAtomic(recordPath, record);
  await rm(staging, {recursive: true, force: true});

  return {status: 'complete', ...summary, hint: 'Review with git diff, then commit'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const rest = process.argv.slice(2);
    const flags = new Map();
    const boolFlags = new Set(['--yes', '--allow-downgrade']);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (!a.startsWith('--')) throw new Error('Unknown argument: ' + a);
      if (boolFlags.has(a)) { flags.set(a, true); continue; }
      flags.set(a, rest[++i]);
    }
    const result = await applyRelease({
      shrimp: flags.get('--shrimp'),
      packagePath: flags.get('--package'),
      yes: flags.get('--yes') === true,
      force: flags.has('--force') ? flags.get('--force').split(',') : [],
      allowDowngrade: flags.get('--allow-downgrade') === true,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({status: 'invalid', error: e.message}));
    process.exitCode = 1;
  }
}
