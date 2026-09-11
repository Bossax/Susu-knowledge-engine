import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathExists, sha256} from '../fs.mjs';
import {classifyByHash, classifyByKnownHashes} from './compare.mjs';

async function render(entry) {
  let text = await readFile(entry.template, 'utf8');
  for (const [from, to] of entry.substitutions ?? []) text = text.replaceAll(from, to);
  return text;
}

export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const expected = await render(entry);
  const expectedHash = sha256(expected);
  const actual = await pathExists(dest) ? await readFile(dest, 'utf8') : null;
  const actualHash = actual == null ? null : sha256(actual);
  const base = ctx.baseFor(entry.id);
  const result = base
    ? classifyByHash({expected: expectedHash, actual: actualHash, base})
    : classifyByKnownHashes({expected: expectedHash, actual: actualHash, knownHashes: entry.knownHashes});
  return {...result, rendered: expected, hash: expectedHash};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  await mkdir(dirname(dest), {recursive: true});
  const already = await pathExists(dest) ? await readFile(dest, 'utf8') : null;
  const action = already === null ? 'created' : 'updated';
  await writeFile(dest, probed.rendered);
  return {action, hash: probed.hash};
}
