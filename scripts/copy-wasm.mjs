// Copies wllama's prebuilt WASM binary out of node_modules and into
// public/wasm/ so Vite serves it as a plain static asset at a stable path
// ("/wasm/wllama.wasm"). Run automatically via the "postinstall" npm hook.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const src = path.join(root, 'node_modules/@wllama/wllama/esm/wasm/wllama.wasm');
const destDir = path.join(root, 'public/wasm');
const dest = path.join(destDir, 'wllama.wasm');

if (!existsSync(src)) {
  console.warn('[copy-wasm] source wasm not found at', src, '- skipping (did npm install run?)');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('[copy-wasm] copied wllama.wasm ->', dest);
