import {readFile, writeFile, rename, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Small filesystem helpers shared across workbench-adapters. Merged from what connect.mjs and
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

export async function sha256File(path) {
  try { return sha256(await readFile(path)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
