// js/embeddings.js
// Transformers.js wrapper around all-MiniLM-L6-v2 for sentence embeddings.
// One embedding function powers two features:
//   (a) retrieval for grounded Q&A (Goal 2/5)
//   (b) mind-map similarity edges (Goal 3)

import { pipeline, env } from '@huggingface/transformers';
import { EMBEDDING_MODEL, MINDMAP_SIMILARITY_THRESHOLD } from './config.js';

// Never try to resolve models from a same-origin /models path — always go
// to the Hugging Face hub (and let the browser Cache Storage API cache the
// ONNX weights after the first load, same caching model wllama uses).
env.allowLocalModels = false;

let extractorPromise = null;

/**
 * Lazily creates (once) and returns the feature-extraction pipeline.
 * @param {(info: {status: string, progress?: number}) => void} [onProgress]
 */
function getExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL.name, {
      progress_callback: onProgress,
    });
  }
  return extractorPromise;
}

/**
 * Preload the embedding model (call this at app boot alongside the LLM load
 * so both progress bars can be driven from one screen).
 */
export async function loadEmbeddingModel(onProgress) {
  await getExtractor(onProgress);
  return true;
}

/**
 * @param {string} text
 * @returns {Promise<number[]>} a 384-dim, L2-normalized embedding vector
 */
export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts) {
  const extractor = await getExtractor();
  const results = [];
  for (const t of texts) {
    const output = await extractor(t, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

/** @param {number[]|Float32Array} a @param {number[]|Float32Array} b */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Given a query embedding and a list of candidate notes (each with an
 * `embedding` field), return the top-k most similar notes.
 * @param {number[]} queryEmbedding
 * @param {Array<{embedding: number[]}>} notes
 * @param {number} topK
 * @param {number} [minSimilarity=0] drop candidates below this score
 */
export function findSimilarNotes(queryEmbedding, notes, topK, minSimilarity = 0) {
  const scored = notes
    .filter((n) => Array.isArray(n.embedding) && n.embedding.length > 0)
    .map((n) => ({ note: n, score: cosineSimilarity(queryEmbedding, n.embedding) }))
    .filter((x) => x.score >= minSimilarity)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Mind-map edges: for one note against a candidate pool, return every note
 * whose similarity exceeds the configured threshold.
 * @param {{id: string, embedding: number[]}} note
 * @param {Array<{id: string, embedding: number[]}>} candidatePool
 * @param {number} [threshold]
 */
export function findLinkedNotes(note, candidatePool, threshold = MINDMAP_SIMILARITY_THRESHOLD) {
  if (!Array.isArray(note.embedding)) return [];
  return candidatePool
    .filter((c) => c.id !== note.id && Array.isArray(c.embedding))
    .map((c) => ({ id: c.id, score: cosineSimilarity(note.embedding, c.embedding) }))
    .filter((x) => x.score > threshold)
    .sort((a, b) => b.score - a.score);
}
