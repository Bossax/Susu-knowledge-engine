import {cp, mkdir, readFile, rm, rename, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {parseVersion, compare} from './skill-version.mjs';

// Generic project installer for a workbench-adapters skill. Version-aware: upgrades forward,
// refuses to downgrade or to overwrite an unreadable installation without an explicit flag.
// Extracted from oversoul's installer so any future workbench-adapters/<skill> can reuse the same
// atomic, multi-target, version-compared install logic instead of hand-copying files per client.
export async function exists(p) {
  try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

// options:
//   skillId       - short id used only for the staging suffix, e.g. 'oversoul'
//   source        - absolute path to the skill's master directory (contains SKILL.md)
//   pathFor(name) - maps a client name to its absolute install target directory
//   names         - requested client names (already validated by the caller)
//   allowDowngrade
//   afterInstall(names, source, project) - optional, run once after all targets are handled
export async function installSkill({skillId, source, project, pathFor, names, allowDowngrade, afterInstall}) {
  const sourceVersion = parseVersion(await readFile(join(source, 'SKILL.md'), 'utf8'));
  if (!sourceVersion) throw new Error('Unparseable source SKILL.md version');

  const byPath = new Map();
  for (const name of new Set(names)) {
    const path = pathFor(name);
    byPath.set(path, [...(byPath.get(path) ?? []), name]);
  }

  const results = [];
  for (const [target, clients] of byPath) {
    if (!await exists(target)) {
      await mkdir(dirname(target), {recursive: true});
      await cp(source, target, {recursive: true, errorOnExist: true, force: false});
      results.push({action: 'installed', clients, version: sourceVersion, path: target});
      continue;
    }
    let installedVersion;
    try { installedVersion = parseVersion(await readFile(join(target, 'SKILL.md'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!installedVersion) {
      results.push({action: 'blocked', clients, path: target, reason: 'Existing installation has an unreadable SKILL.md version; move it aside before installing', failed: true});
      continue;
    }
    const cmp = compare(sourceVersion, installedVersion);
    if (cmp === 0) {
      results.push({action: 'unchanged', clients, version: installedVersion, path: target});
      continue;
    }
    if (cmp < 0 && !allowDowngrade) {
      results.push({action: 'blocked', clients, path: target, installed: installedVersion, source: sourceVersion, reason: 'Installed version is newer than source; pass --allow-downgrade to force', failed: true});
      continue;
    }
    // Atomic replace: stage a fresh copy, swap it in, keep the displaced copy as a backup
    // until the swap has succeeded, then remove it. This also drops any file present in the
    // old installation but absent from source — there is nothing left to prune afterward.
    const tmp = target + '.' + skillId + '-tmp';
    const old = target + '.' + skillId + '-old';
    await rm(tmp, {recursive: true, force: true});
    await rm(old, {recursive: true, force: true});
    await cp(source, tmp, {recursive: true, errorOnExist: true, force: false});
    await rename(target, old);
    await rename(tmp, target);
    await rm(old, {recursive: true, force: true});
    results.push({action: cmp > 0 ? 'upgraded' : 'downgraded', clients, from: installedVersion, to: sourceVersion, path: target});
  }

  if (afterInstall) results.push(...(await afterInstall(names, source, project) ?? []));
  return results;
}
