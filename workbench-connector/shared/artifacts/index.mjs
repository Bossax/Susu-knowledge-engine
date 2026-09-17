import * as tree from './tree.mjs';
import * as render from './render.mjs';
import * as copy from './copy.mjs';
import * as file from './file.mjs';
import * as lines from './lines.mjs';
import * as jsonMerge from './json-merge.mjs';
import * as jsonArrayEntry from './json-array-entry.mjs';
import * as tomlBlock from './toml-block.mjs';
import * as sentinelBlock from './sentinel-block.mjs';
import * as absent from './absent.mjs';

const HANDLERS = {
  tree, render, copy, file, lines,
  'json-merge': jsonMerge,
  'json-array-entry': jsonArrayEntry,
  'toml-block': tomlBlock,
  'sentinel-block': sentinelBlock,
  absent,
};

export function applicable(entry, clients) {
  if (!entry.clients) return true;
  return entry.clients.some(c => clients.includes(c));
}

export async function probeArtifact(ctx, entry) {
  const handler = HANDLERS[entry.kind];
  if (!handler) throw new Error('Unknown artifact kind: ' + entry.kind);
  const result = await handler.probe(ctx, entry);
  return {id: entry.id, kind: entry.kind, dest: entry.dest, ...result};
}

export async function probeArtifacts(ctx, artifacts, clients) {
  const out = [];
  for (const entry of artifacts) {
    if (!applicable(entry, clients)) continue;
    out.push(await probeArtifact(ctx, entry));
  }
  return out;
}

// States that stop the whole apply run unless the artifact is named with --force (or, for
// `ahead`, --allow-downgrade), or the entry explicitly opts to just preserve and move on.
const BLOCKING_STATES = new Set(['locally-modified', 'conflict', 'blocked', 'ahead']);

export function isBlocking(probed, entry, {allowDowngrade = false} = {}) {
  if (!BLOCKING_STATES.has(probed.state)) return false;
  if (probed.state === 'ahead') return !allowDowngrade;
  if (probed.state === 'locally-modified' && entry.onLocallyModified === 'preserve') return false;
  return true;
}

// Whether apply() has anything to do at all for this artifact, independent of whether it's
// allowed to (that's isBlocking's job).
export function needsWrite(probed) {
  return ['missing', 'stale', 'remove', 'locally-modified', 'conflict', 'blocked', 'ahead'].includes(probed.state);
}

export async function applyArtifact(ctx, entry, probed) {
  const handler = HANDLERS[entry.kind];
  return handler.apply(ctx, entry, probed);
}

export {BEGIN_RE} from './sentinel-block.mjs';
