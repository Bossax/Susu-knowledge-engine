import {cp, mkdir, readFile, writeFile, rm, rename} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {pathExists} from './fs.mjs';

const RELEASE_FILE = 'engine.json';

function compare(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

async function installedIdentity(target) {
  try {
    const skill = await readFile(join(target, 'SKILL.md'), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1];
    const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter ?? '')?.[1];
    if (!name) return null;
    try {
      const version = JSON.parse(await readFile(join(target, RELEASE_FILE), 'utf8')).engineRelease;
      return /^\d+\.\d+\.\d+$/.test(version) ? {name, version} : null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const legacyVersion = /^\s+version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(frontmatter)?.[1];
      return legacyVersion ? {name, legacyVersion} : null;
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function inspectSkill({skillId, sourceVersion, target, allowDowngrade = false}) {
  if (!await pathExists(target)) return {action: 'installed', sourceVersion};
  const installed = await installedIdentity(target);
  if (!installed) return {action: 'blocked', reason: 'Existing installation has unreadable skill or engine release metadata; move it aside before installing', failed: true};
  if (installed.name !== skillId) return {action: 'blocked', reason: `Expected skill ${skillId}, found ${installed.name}; move it aside before installing`, failed: true};
  if (installed.legacyVersion) return {action: 'migrated', from: installed.legacyVersion, to: sourceVersion};
  const comparison = compare(sourceVersion, installed.version);
  if (comparison === 0) return {action: 'unchanged', version: installed.version};
  if (comparison < 0 && !allowDowngrade) return {action: 'blocked', installed: installed.version, source: sourceVersion, reason: 'Installed engine release is newer than source; pass --allow-downgrade to force', failed: true};
  return {action: comparison > 0 ? 'upgraded' : 'downgraded', from: installed.version, to: sourceVersion};
}

async function writeRelease(target, engineRelease) {
  await writeFile(join(target, RELEASE_FILE), JSON.stringify({engineRelease}, null, 2) + '\n');
}

export async function installSkill({skillId, source, sourceVersion, project, pathFor, names, allowDowngrade, afterInstall, renamePath = rename}) {
  if (!/^\d+\.\d+\.\d+$/.test(sourceVersion)) throw new Error('Invalid source engine release');
  const byPath = new Map();
  for (const name of new Set(names)) {
    const path = pathFor(name);
    byPath.set(path, [...(byPath.get(path) ?? []), name]);
  }

  const results = [];
  for (const [target, clients] of byPath) {
    const inspection = await inspectSkill({skillId, sourceVersion, target, allowDowngrade});
    if (inspection.action === 'blocked' || inspection.action === 'unchanged') {
      results.push({...inspection, clients, path: target});
      continue;
    }
    if (inspection.action === 'installed') {
      await mkdir(dirname(target), {recursive: true});
      await cp(source, target, {recursive: true, errorOnExist: true, force: false});
      await writeRelease(target, sourceVersion);
      results.push({action: 'installed', clients, version: sourceVersion, path: target});
      continue;
    }
    const suffix = `${process.pid}-${Date.now()}`;
    const staged = `${target}.${skillId}-tmp-${suffix}`;
    const displaced = `${target}.${skillId}-old-${suffix}`;
    await rm(staged, {recursive: true, force: true});
    await cp(source, staged, {recursive: true, errorOnExist: true, force: false});
    await writeRelease(staged, sourceVersion);
    await renamePath(target, displaced);
    try {
      await renamePath(staged, target);
    } catch (error) {
      try {
        await renamePath(displaced, target);
        await rm(staged, {recursive: true, force: true});
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Replacement failed; prior installation remains at ${displaced}`);
      }
      throw error;
    }
    await rm(displaced, {recursive: true, force: true});
    results.push({...inspection, clients, path: target});
  }

  if (afterInstall) results.push(...(await afterInstall(names, source, project) ?? []));
  return results;
}
