// Bundles the operator tools into single files for the image (`tools/`), since the standalone server carries no TypeScript and no source: `node
// tools/encrypt-data.mjs`. Run by the Dockerfile's build stage after `next build`; the native database clients stay outside the bundle, where the standalone
// server's own `node_modules` has them.
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('tools', { recursive: true });
await build({
  entryPoints: { 'encrypt-data': 'scripts/encrypt-data.ts' },
  outdir: 'tools',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@libsql/client', 'libsql', 'pg', 'pg-native'],
  banner: {
    // `bundle` turns some of the app's `require`s into this, which an ES module does not have.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
