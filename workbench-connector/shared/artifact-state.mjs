import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathExists, writeJsonAtomic} from './fs.mjs';

// Records what apply() last wrote for each artifact, scoped to the region the tool owns (a whole
// file for whole-file kinds, a rendered region for everything else). This is what lets a
// three-way compare (expected now / actual on disk / what we wrote last time) tell "the package
// moved" apart from "a human edited this" -- a distinction a version stamp alone cannot make,
// since most artifacts (a .gitignore line, a JSON key) cannot carry one.
export const STATE_PATH = '.agents/oversoul-artifacts.json';

export async function readState(workbenchRoot) {
  const path = join(workbenchRoot, STATE_PATH);
  if (!await pathExists(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeState(workbenchRoot, packageVersion, entries) {
  const path = join(workbenchRoot, STATE_PATH);
  const existing = await readState(workbenchRoot) ?? {version: 1, package: packageVersion, writtenAt: null, artifacts: {}};
  const artifacts = {...existing.artifacts};
  for (const [id, hash] of Object.entries(entries)) {
    if (hash === null) { delete artifacts[id]; continue; }
    artifacts[id] = {hash, packageVersion};
  }
  const out = {version: 1, package: packageVersion, writtenAt: new Date().toISOString(), artifacts};
  await writeJsonAtomic(path, out);
  return out;
}

export function baseFor(state, id) {
  return state?.artifacts?.[id] ?? null;
}
