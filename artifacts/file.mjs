import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists} from '../fs.mjs';

// A whole small file (CLAUDE.md) whose currency is "does it contain the required line," not
// exact equality -- a human is free to add anything else to this file.
export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  if (!await pathExists(dest)) return {state: 'missing'};
  const text = await readFile(dest, 'utf8');
  if (text.includes(entry.contains)) return {state: 'current'};
  return {state: 'locally-modified', detail: {reason: `${entry.dest} does not contain the required reference`}};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  await mkdir(dirname(dest), {recursive: true});
  if (probed.state === 'missing') {
    await writeFile(dest, entry.content);
    return {action: 'created'};
  }
  // locally-modified, forced: append rather than clobber, since the rest of the file is a human's.
  const existing = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(dest, existing + sep + entry.content);
  return {action: 'updated'};
}
