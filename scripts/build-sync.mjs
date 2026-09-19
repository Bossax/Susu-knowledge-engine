import * as esbuild from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist/sync', { recursive: true });
await esbuild.build({
  entryPoints: ['sync/src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'sync/cli.mjs',
  banner: {
    js: `#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
`,
  },
});
console.log('Built sync/cli.mjs');
