import {join} from 'node:path';
import {inspectSkill, installSkill} from '../skill-install.mjs';

export async function probe(ctx, entry) {
  const target = join(ctx.workbenchRoot, entry.dest);
  const inspection = await inspectSkill({skillId: entry.skillId, sourceVersion: ctx.packageVersion, bundleHash: ctx.bundleHash, sourceCommit: ctx.sourceCommit, target, allowDowngrade: ctx.allowDowngrade});
  if (inspection.action === 'installed') return {state: 'missing', detail: {to: ctx.packageVersion}};
  if (inspection.action === 'unchanged') return {state: 'current', detail: {version: inspection.version}};
  if (inspection.action === 'upgraded' || inspection.action === 'migrated') return {state: 'stale', detail: {from: inspection.from, to: inspection.to}};
  if (inspection.action === 'downgraded') return {state: 'ahead', detail: {from: inspection.from, to: inspection.to}};
  return {state: 'locally-modified', detail: {reason: inspection.reason}};
}

export async function apply(ctx, entry) {
  const target = join(ctx.workbenchRoot, entry.dest);
  const [result] = await installSkill({skillId: entry.skillId, source: entry.source, sourceVersion: ctx.packageVersion, bundleHash: ctx.bundleHash, sourceCommit: ctx.sourceCommit, project: ctx.workbenchRoot, pathFor: () => target, names: ['workbench'], allowDowngrade: ctx.allowDowngrade});
  return {action: result.action, detail: result};
}
