import {readFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists, writeJsonAtomic} from '../fs.mjs';

// One key merged into a JSON file (the Notion MCP entry, per client). Never touches anything
// else in the file. A differing existing value at the same key is `preserved`, never clobbered --
// the same invariant the connector already enforced for this one case, generalized.
function countTopKey(text, key) {
  return (text.match(new RegExp(`"${key}"\\s*:`, 'g')) ?? []).length;
}

export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  if (!await pathExists(dest)) return {state: 'missing'};
  const text = await readFile(dest, 'utf8');
  if (entry.onDuplicateKey === 'block') {
    const count = countTopKey(text, entry.keyPath[0]);
    if (count > 1) return {state: 'blocked', detail: {reason: `${entry.dest} has "${entry.keyPath[0]}" written ${count} times; only the last one is read. Fix by hand.`}};
  }
  const obj = JSON.parse(text);
  let cursor = obj;
  for (const k of entry.keyPath.slice(0, -1)) cursor = cursor?.[k];
  const existing = cursor?.[entry.keyPath[entry.keyPath.length - 1]];
  if (existing === undefined) return {state: 'missing'};
  if (JSON.stringify(existing) === JSON.stringify(entry.value)) return {state: 'current'};
  return {state: 'preserved', detail: {reason: 'A different entry already exists; not overwritten', existing}};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const existed = await pathExists(dest);
  const obj = existed ? JSON.parse(await readFile(dest, 'utf8')) : {};
  let cursor = obj;
  for (const k of entry.keyPath.slice(0, -1)) cursor = (cursor[k] ??= {});
  cursor[entry.keyPath[entry.keyPath.length - 1]] = entry.value;
  await mkdir(dirname(dest), {recursive: true});
  await writeJsonAtomic(dest, obj);
  return {action: existed ? 'updated' : 'created'};
}
