import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
    shims: true,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
    dts: true,
    shims: true,
  },
]);
