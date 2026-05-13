import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/index.js',
  banner: { js: '#!/usr/bin/env node' },
});

chmodSync('dist/index.js', '755');
console.log('Built dist/index.js');
