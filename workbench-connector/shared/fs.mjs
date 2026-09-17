import {writeFile, rename, rm, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Small filesystem helpers shared across the Workbench connector. Merged from what connect.mjs and
// skill-install.mjs each defined separately.

export async function pathExists(p) {
  try { await stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function writeJsonAtomic(path, obj) {
  const tmp = path + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await rename(tmp, path);
}

export function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text).digest('hex');
}

// Swaps an already-staged sibling directory into place. The caller stages, so each consumer keeps
// its own preparation; only the rollback lives here. The one dangerous window is between the two
// renames, where the target is momentarily absent and the prior tree sits beside it under its
// displaced name -- a crash there is visible and recoverable rather than a half-merged tree.
export async function replaceTree({target, staged, renamePath = rename}) {
  const displaced = `${target}.old-${process.pid}-${Date.now()}`;
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
}
