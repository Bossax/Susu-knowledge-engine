import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathExists} from '../fs.mjs';
import {parseVersion, compare} from '../skill-version.mjs';
import {installSkill} from '../skill-install.mjs';

// A whole package directory (the skill), kept current by the existing version-aware, atomic
// installer. probe() is read-only and mirrors installSkill's own decision without writing
// anything, so `status` can report the same answer `apply` would act on.
export async function probe(ctx, entry) {
  const sourceVersion = parseVersion(await readFile(join(entry.source, 'SKILL.md'), 'utf8'));
  const destSkillMd = join(ctx.workbenchRoot, entry.dest, 'SKILL.md');
  if (!await pathExists(destSkillMd)) return {state: 'missing', detail: {to: sourceVersion}};
  let installedVersion;
  try { installedVersion = parseVersion(await readFile(destSkillMd, 'utf8')); } catch { /* fallthrough */ }
  if (!installedVersion) return {state: 'locally-modified', detail: {reason: 'Existing SKILL.md version is unreadable'}};
  const cmp = compare(sourceVersion, installedVersion);
  if (cmp === 0) return {state: 'current', detail: {version: installedVersion}};
  if (cmp > 0) return {state: 'stale', detail: {from: installedVersion, to: sourceVersion}};
  return {state: 'ahead', detail: {from: installedVersion, to: sourceVersion, reason: 'Installed version is newer than source; pass --allow-downgrade to force'}};
}

export async function apply(ctx, entry, probed) {
  const target = join(ctx.workbenchRoot, entry.dest);
  const results = await installSkill({
    skillId: entry.id.replace(/[^a-z0-9-]/gi, '-'),
    source: entry.source,
    project: ctx.workbenchRoot,
    pathFor: () => target,
    names: ['x'],
    allowDowngrade: ctx.allowDowngrade,
  });
  const r = results[0];
  return {action: r.action, detail: r};
}
