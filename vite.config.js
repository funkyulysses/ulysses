import { defineConfig } from 'vite';

// wllama can use multi-threaded WASM (faster inference) when the page is
// cross-origin isolated, which requires these two response headers. Without
// them it still works fine — it just auto-falls-back to single-threaded WASM.
// Setting them for both `dev` and `preview` costs nothing and is worth it on
// real hardware (including the iPhone target), so we set them everywhere.
const crossOriginIsolationHeaders = {
  name: 'cross-origin-isolation-headers',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

export default defineConfig({
  // Relative asset paths so the build works from any subpath — GitHub Pages
  // project sites serve from https://<user>.github.io/<repo>/, not root.
  base: './',
  plugins: [crossOriginIsolationHeaders],
  optimizeDeps: {
    exclude: ['@wllama/wllama', '@huggingface/transformers'],
  },
});
