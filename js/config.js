// js/config.js
// Central configuration for the Ulysses client-side AI engine.
// Change model sources / thresholds here only.

/** Chat + tagging model: Qwen2.5-1.5B-Instruct, GGUF, Q4_K_M quantization.
 *  Hosted by the official Qwen org on Hugging Face. wllama streams this
 *  straight from the CDN and caches the bytes itself (Cache Storage API)
 *  so it is only fetched once per browser profile. */
export const LLM_MODEL = {
  repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  // Context window to allocate. Qwen2.5-1.5B supports up to 32768, but on an
  // A16 iPhone in pure WASM we keep this modest to bound memory + first-token
  // latency. 2048 still comfortably fits a system prompt + RETRIEVAL_TOP_K
  // notes + a question, and directly halves KV-cache memory vs. 4096 (KV
  // cache size scales linearly with context length) — this matters a lot on
  // a memory-constrained mobile Safari tab. See js/llm.js for KV-cache
  // quantization, the other big lever on the same problem.
  contextSize: 2048,
};

/** Embedding model: all-MiniLM-L6-v2, ONNX, quantized (Transformers.js default). */
export const EMBEDDING_MODEL = {
  name: 'Xenova/all-MiniLM-L6-v2',
  dims: 384,
};

/** Cosine similarity threshold above which two notes are linked in the mind map. */
export const MINDMAP_SIMILARITY_THRESHOLD = 0.5;

/** How many notes to retrieve as context for grounded Q&A. */
export const RETRIEVAL_TOP_K = 5;

/** Minimum similarity a retrieved note must clear to be worth including in a
 *  QA prompt at all (keeps totally unrelated notes out of the context window). */
export const RETRIEVAL_MIN_SIMILARITY = 0.2;

export const IDB_DB_NAME = 'ulysses';
export const IDB_DB_VERSION = 1;
