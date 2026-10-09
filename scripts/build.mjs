// Bundles client-src/vault.mjs for the browser (public/js/vault.bundle.js) and for Node tests.
import { build } from 'esbuild';
const common = { entryPoints: ['client-src/vault.mjs'], bundle: true, logLevel: 'warning', legalComments: 'linked' };
await build({ ...common, outfile: 'public/js/vault.bundle.js', platform: 'browser', format: 'iife', globalName: 'NomenVault', minify: true, target: ['es2020'], define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' } });
await build({ ...common, outfile: 'scripts/.vault.node.mjs', platform: 'node', format: 'esm', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
console.log('built');
