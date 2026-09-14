# Ulysses — client-side AI engine

Fully offline, on-device successor to the "second-brain" Flask app. No
server, no shared API key, no cloud calls. Every AI operation — note
tagging, grounded Q&A, mind-map similarity — runs entirely in the browser
via WebAssembly.

This repo currently contains **only the engine** (`js/`). The UI/PWA shell
is a separate, parallel piece of work — see `js/engine.js` for the full
function surface it calls into.

## Stack

- **[wllama](https://github.com/ngxson/wllama)** (`@wllama/wllama`) — WASM
  port of llama.cpp, running **Qwen2.5-1.5B-Instruct** (GGUF, Q4_K_M, from
  the official `Qwen/Qwen2.5-1.5B-Instruct-GGUF` repo on Hugging Face) for
  note tagging and grounded Q&A. Pure CPU/WASM path (`n_gpu_layers: 0`) —
  WebGPU is deliberately not relied on, per the iPhone 15 (A16, no WebGPU
  guarantee) target device.
- **[Transformers.js](https://github.com/huggingface/transformers.js)**
  (`@huggingface/transformers`) — running **all-MiniLM-L6-v2** (quantized
  ONNX) for 384-dim sentence embeddings, powering both QA retrieval and
  mind-map similarity edges.
- **IndexedDB** (via the tiny `idb` helper library) for all storage:
  `notes`, `chats`, `messages`.
- **Vite**, used only as a static-asset dev server / bundler — this stays a
  zero-backend static site. Vite was worth adding over plain `<script type="module">`
  because wllama and Transformers.js both ship WASM/worker assets that are
  much easier to serve correctly (right MIME types, `import.meta.url`
  resolution, COOP/COEP headers for multi-threaded WASM) through a bundler
  than by hand. `npm run build` produces a fully static `dist/` — still no
  server required at runtime.

## Layout

```
index.html          placeholder shell (t009 builds the real UI)
test.html           manual/automated engine test harness (not shipped UI)
js/
  config.js         model sources, thresholds — the one file to tune
  storage.js         IndexedDB layer: notes/chats/messages CRUD
  classify.js         note-vs-question heuristic
  llm.js              wllama wrapper: loadLLM, tagNote, answerQuestion
  embeddings.js        Transformers.js wrapper: embed, cosine similarity,
                       retrieval, mind-map linking
  engine.js            the wired-together pipeline (compose, initEngine,
                       buildMindMapEdges) + storage re-exports — this is
                       the module t009 imports
  test-harness.js      implementation behind test.html
  __tests__/            vitest unit tests for pure logic (classify, cosine
                       similarity math) — no model/browser needed
scripts/
  copy-wasm.mjs        postinstall: copies wllama's .wasm into public/wasm/
```

## Engine API (what t009 calls)

```js
import {
  initEngine, compose, buildMindMapEdges,
  createNote, listNotes, getNote, deleteNote, deleteAllNotes,
  createChat, listChats, getChat, deleteChat, clearAllChats,
  addMessage, getChatMessages, getStorageEstimate,
} from './js/engine.js';

// Once at app boot — drives the install/progress screen:
await initEngine({
  onLLMProgress: ({ loaded, total }) => { /* update progress bar */ },
  onEmbeddingProgress: (info) => { /* info.status: 'progress'|'done'|'ready'|... */ },
});

const chat = await createChat({ title: 'My notes' });

// Composer entry point — classifies + routes automatically:
const result = await compose('Remember to buy milk', chat.id);
// -> { type: 'note', note, message }
const result2 = await compose('What did I need to buy?', chat.id);
// -> { type: 'question', message, sources: [{id, score}, ...] }

const edges = await buildMindMapEdges(); // [{a, b, score}, ...]
```

## Getting started

```bash
npm install     # also copies wllama's wasm into public/wasm/ (postinstall)
npm run dev      # http://localhost:5173 — open /test.html to exercise the engine
npm run build    # static dist/ — deploy anywhere, still zero backend
npm test         # vitest — fast unit tests (classify + similarity math)
```

## Testing — what was actually run, and where

See the task report for full detail. Summary:

- **Unit tests** (`npm test`, 20/20 passing): `classify.js` heuristic,
  `cosineSimilarity` / `findSimilarNotes` / `findLinkedNotes` math. Run in
  plain Node via vitest — no browser or model needed.
- **Live browser tests** (`test.html`, driven headlessly via Playwright +
  Chromium during development, 32/32 passing): IndexedDB CRUD, real
  MiniLM embedding inference (verified related notes score higher than
  unrelated ones), real Qwen2.5-1.5B-Instruct download + inference (tagging
  and grounded Q&A with genuine model output, not mocked), full
  `compose()` pipeline, and model-caching (second load ~1.4s vs ~34s cold,
  confirmed no re-download).
- **Not tested**: real iPhone hardware. Everything above ran in a desktop
  headless Chromium sandbox. iOS Safari's WASM/OPFS/Cache-Storage behavior,
  memory limits, and real-world inference speed on an A16 chip are
  unverified — see the task report for what specifically to check on-device.
