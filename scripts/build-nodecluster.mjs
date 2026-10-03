#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/nodecluster.runtime.js'],
  outfile: 'public/nodecluster.js',
  bundle: false,
  minify: true,
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '/*! NodeChart NodeCluster runtime · © 2026 AndrexTheDev · See LICENSE.md */' },
});

console.log('Built minified public/nodecluster.js from scripts/nodecluster.runtime.js');
