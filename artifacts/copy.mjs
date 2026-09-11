import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists, sha256} from '../fs.mjs';
import {classifyByHash, classifyByKnownHashes} from './compare.mjs';

// A single source file copied to one or more destinations (e.g. the guardrail script, which
// needs an identical copy under .claude/ and .agents/). Each destination gets its own base in the
// state file, keyed `${id}::${dest}`, so the two copies can't silently drift apart.
function destList(entry) { return Array.isArray(entry.dest) ? entry.dest : [entry.dest]; }

export async function probe(ctx, entry) {
  const expected = await readFile(entry.source, 'utf8');
  const expectedHash = sha256(expected);
  const perDest = [];
  for (const dest of destList(entry)) {
    const full = join(ctx.workbenchRoot, dest);
    const actual = await pathExists(full) ? await readFile(full, 'utf8') : null;
    const actualHash = actual == null ? null : sha256(actual);
    const base = ctx.baseFor(`${entry.id}::${dest}`);
    const result = base
      ? classifyByHash({expected: expectedHash, actual: actualHash, base})
      : classifyByKnownHashes({expected: expectedHash, actual: actualHash, knownHashes: entry.knownHashes});
    perDest.push({dest, ...result});
  }
  const order = ['conflict', 'blocked', 'locally-modified', 'stale', 'missing', 'current'];
  const worst = perDest.reduce((a, b) => order.indexOf(b.state) < order.indexOf(a.state) ? b : a);
  return {state: worst.state, perDest, rendered: expected, hash: expectedHash};
}

export async function apply(ctx, entry, probed) {
  const written = [];
  for (const dest of destList(entry)) {
    const full = join(ctx.workbenchRoot, dest);
    await mkdir(dirname(full), {recursive: true});
    await writeFile(full, probed.rendered);
    written.push(dest);
  }
  return {action: 'restored', detail: {written}, hash: probed.hash, multiKey: destList(entry).map(d => `${entry.id}::${d}`)};
}
