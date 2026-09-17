import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists} from '../fs.mjs';

// A marker-delimited block appended to a TOML file (the Codex MCP entry). Containment-based,
// same spirit as json-merge but for a format without a real parser here.
export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const text = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  if (text.includes(entry.marker)) return {state: 'current'};
  return {state: 'missing'};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const existed = await pathExists(dest);
  const existingText = existed ? await readFile(dest, 'utf8') : '';
  const sep = existingText && !existingText.endsWith('\n') ? '\n' : '';
  await mkdir(dirname(dest), {recursive: true});
  await writeFile(dest, existingText + sep + entry.block);
  return {action: existed ? 'updated' : 'created'};
}
