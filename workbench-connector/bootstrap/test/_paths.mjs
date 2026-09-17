import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Mirrors connect.mjs's own resolveOversoulPath: in the development tree, oversoul is a sibling
// of connector/ (two levels up from test/); once vendored, connector/'s own folder name is
// flattened away so oversoul ends up directly under the connector root (one level up from
// test/). Test fixtures need the real package regardless of which tree they're running in.
export function resolveRealOversoul(testDir) {
  const flattened = join(testDir, '..', 'oversoul');
  if (existsSync(join(flattened, 'SKILL.md'))) return flattened;
  return join(testDir, '..', '..', 'oversoul');
}
