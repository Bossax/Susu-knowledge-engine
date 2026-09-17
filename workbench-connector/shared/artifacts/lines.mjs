import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathExists} from '../fs.mjs';

// Required lines appended to a file (.gitignore). Currency is containment of every required
// line, never equality -- a human's other lines are never touched, and nothing is ever removed.
export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  if (entry.requires === 'workbench-is-git-repo' && !await pathExists(join(ctx.workbenchRoot, '.git'))) {
    return {state: 'current', detail: {reason: 'Workbench is not a git repository; nothing to ignore'}};
  }
  const existingText = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  const existingLines = new Set(existingText.split(/\r?\n/).map(l => l.trim()));
  const missing = entry.lines.filter(l => !existingLines.has(l));
  return missing.length ? {state: 'missing', detail: {missing}} : {state: 'current', detail: {present: entry.lines.length}};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const existingText = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  const sep = existingText && !existingText.endsWith('\n') ? '\n' : '';
  const block = `${sep}${entry.header}\n${probed.detail.missing.join('\n')}\n`;
  await writeFile(dest, existingText + block);
  return {action: existingText ? 'updated' : 'created', detail: {adding: probed.detail.missing}};
}
