import {createHash} from 'node:crypto';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {resolve, relative, join, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Detects drift between a maintained source package and a vendored release copy of it.
// Read-only; never writes to either tree. Deliberately takes the source path as an argument
// rather than a hard-coded default, so this tool has no idea it will one day compare against a
// different, central source (see the forward-compat note in the requirements amendment).
async function collectFiles(root) {
  const out = new Map();
  async function walk(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) { await walk(full); continue; }
      out.set(rel, createHash('sha256').update(await readFile(full)).digest('hex'));
    }
  }
  await walk(root);
  return out;
}

export async function verifySync(sourcePath, vendoredPath) {
  const [source, vendored] = await Promise.all([collectFiles(resolve(sourcePath)), collectFiles(resolve(vendoredPath))]);
  const added = [...vendored.keys()].filter(f => !source.has(f)).sort();
  const removed = [...source.keys()].filter(f => !vendored.has(f)).sort();
  const changed = [...source.keys()].filter(f => vendored.has(f) && vendored.get(f) !== source.get(f)).sort();
  return {inSync: !added.length && !removed.length && !changed.length, added, removed, changed};
}

// See connect.mjs for why argv[1] needs realpath'ing before this comparison: import.meta.url is
// always the real path, so invoking this through a junction/symlink otherwise never matches.
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => resolve(process.argv[1])) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    const [sourcePath, vendoredPath] = process.argv.slice(2);
    if (!sourcePath || !vendoredPath) throw new Error('Usage: node verify-sync.mjs SOURCE_PATH VENDORED_PATH');
    const result = await verifySync(sourcePath, vendoredPath);
    console.log(JSON.stringify(result, null, 2));
    if (!result.inSync) process.exitCode = 2;
  } catch (e) {
    console.log(JSON.stringify({error: e.message}));
    process.exitCode = 1;
  }
}
