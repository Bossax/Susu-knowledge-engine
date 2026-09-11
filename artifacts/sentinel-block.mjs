import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathExists, sha256} from '../fs.mjs';
import {classifyByHash, classifyByKnownHashes} from './compare.mjs';

const BEGIN_RE = /<!-- oversoul:linked-repository:begin[^>]*-->[\s\S]*?<!-- oversoul:linked-repository:end -->/;

function render(entry, ctx) {
  let body = entry.templateText;
  for (const [k, v] of Object.entries(ctx.vars)) body = body.replaceAll(`{{${k}}}`, v);
  body = body.trim();
  return `<!-- oversoul:linked-repository:begin v=${ctx.skillVersion} target=${ctx.vars.TARGET} -->\n${body}\n<!-- oversoul:linked-repository:end -->`;
}

export async function probe(ctx, entry) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  const expected = render(entry, ctx);
  const expectedHash = sha256(expected);
  const agentsText = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  const match = BEGIN_RE.exec(agentsText);
  const actual = match ? match[0] : null;
  const actualHash = actual == null ? null : sha256(actual);
  const base = ctx.baseFor(entry.id);
  const result = base
    ? classifyByHash({expected: expectedHash, actual: actualHash, base})
    : classifyByKnownHashes({expected: expectedHash, actual: actualHash, knownHashes: entry.knownHashes});
  return {...result, rendered: expected, hash: expectedHash, agentsTextExisted: agentsText !== ''};
}

export async function apply(ctx, entry, probed) {
  const dest = join(ctx.workbenchRoot, entry.dest);
  // Re-read fresh: another artifact earlier in this same apply run (the skill install) may have
  // just touched AGENTS.md, so trust current disk state over the pre-apply probe snapshot.
  const agentsText = await pathExists(dest) ? await readFile(dest, 'utf8') : '';
  const freshMatch = BEGIN_RE.exec(agentsText);
  if (freshMatch && freshMatch[0] === probed.rendered) return {action: 'unchanged', hash: probed.hash};
  if (freshMatch) {
    await writeFile(dest, agentsText.replace(BEGIN_RE, probed.rendered));
    return {action: 'updated', hash: probed.hash};
  }
  const sep = agentsText && !agentsText.endsWith('\n\n') ? (agentsText.endsWith('\n') ? '\n' : '\n\n') : '';
  await writeFile(dest, agentsText + sep + probed.rendered + '\n');
  return {action: agentsText ? 'appended' : 'created', hash: probed.hash};
}

export {BEGIN_RE};
