import {readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathExists, sha256} from '../fs.mjs';

// A file that should not exist at all (copilot-instructions.md, superseded by the AGENTS.md
// contract block). Known, previously-published content is safe to remove automatically; anything
// else is a human's own file and is reported, never deleted.
export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  if (!await pathExists(dest)) return {state: 'current'};
  const actualHash = sha256(await readFile(dest, 'utf8'));
  if ((entry.knownHashes ?? []).some(h => h.hash === actualHash)) return {state: 'remove', detail: {reason: entry.reason}};
  return {state: 'locally-modified', detail: {reason: `${entry.dest} exists with content not recognized as a previously published version; not removed automatically`}};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  await rm(dest, {force: true});
  return {action: 'removed'};
}
