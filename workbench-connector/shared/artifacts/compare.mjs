// The three-way compare every non-containment kind uses: what's expected now, what's actually on
// disk, and what we last wrote (the base, from the state file). A version stamp alone cannot make
// this call -- most artifacts can't carry one, and a stamp is not evidence of contents, so
// "v=1.11.2" stays put while a human rewrites the body underneath it. This is the fix for that.
export function classifyByHash({expected, actual, base}) {
  if (actual == null) return {state: 'missing'};
  if (actual === expected) return {state: 'current'};
  if (!base) return {state: 'locally-modified', basis: 'no-state-and-unrecognised-content'};
  const actualMatchesBase = actual === base.hash;
  const baseMatchesExpected = base.hash === expected;
  if (actualMatchesBase && !baseMatchesExpected) return {state: 'stale', from: base.packageVersion};
  if (!actualMatchesBase && baseMatchesExpected) return {state: 'locally-modified'};
  return {state: 'conflict'};
}

// Adoption fallback for a workbench with no state file at all: match actual content against a
// list of hashes published by earlier releases, so a pre-manifest workbench gets a real "stale"
// verdict with a real version, never "unknown".
export function classifyByKnownHashes({expected, actual, knownHashes = []}) {
  if (actual == null) return {state: 'missing'};
  if (actual === expected) return {state: 'current'};
  const hit = knownHashes.find(h => h.hash === actual);
  if (hit) return {state: 'stale', from: hit.version};
  return {state: 'locally-modified', basis: 'no-state-and-unrecognised-content'};
}
