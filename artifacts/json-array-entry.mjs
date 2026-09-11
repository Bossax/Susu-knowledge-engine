import {readFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists, writeJsonAtomic} from '../fs.mjs';

// One entry merged into a JSON array (the guardrail hook inside .claude/settings.json's
// hooks.PreToolUse). Other entries in the array, and the rest of the file, are never touched.
function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[/^\d+$/.test(k) ? Number(k) : k], obj);
}

function findMatch(array, identifyBy) {
  return (array ?? []).find(item => getPath(item, identifyBy.path) === identifyBy.equals);
}

export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  if (!await pathExists(dest)) return {state: 'missing'};
  const obj = JSON.parse(await readFile(dest, 'utf8'));
  let cursor = obj;
  for (const k of entry.keyPath) cursor = cursor?.[k];
  const existing = findMatch(cursor, entry.identifyBy);
  if (existing === undefined) return {state: 'missing'};
  if (JSON.stringify(existing) === JSON.stringify(entry.value)) return {state: 'current'};
  return {state: 'preserved', detail: {reason: 'A hook with this command already exists with different settings; not overwritten', existing}};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const existed = await pathExists(dest);
  const obj = existed ? JSON.parse(await readFile(dest, 'utf8')) : {};
  let cursor = obj;
  for (const k of entry.keyPath.slice(0, -1)) cursor = (cursor[k] ??= {});
  const lastKey = entry.keyPath[entry.keyPath.length - 1];
  cursor[lastKey] = Array.isArray(cursor[lastKey]) ? cursor[lastKey] : [];
  cursor[lastKey].push(entry.value);
  await mkdir(dirname(dest), {recursive: true});
  await writeJsonAtomic(dest, obj);
  return {action: existed ? 'updated' : 'created'};
}
