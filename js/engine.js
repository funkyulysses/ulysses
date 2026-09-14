// js/engine.js
// The end-to-end pipeline t009's UI calls into. No DOM code here — this
// module is pure logic + calls into storage.js / llm.js / embeddings.js.
//
//   compose(text) -> classify note vs question
//     note path:     tag(text) -> embed(text) -> createNote + addMessage
//     question path: embed(text) -> retrieve top-k similar notes
//                     -> answer(text, notes) -> addMessage (no note written)

import { classifyInput } from './classify.js';
import { loadLLM, tagNote, answerQuestion, clearCachedModel } from './llm.js';
import { loadEmbeddingModel, embedText, findSimilarNotes, findLinkedNotes, clearCachedEmbeddingModel } from './embeddings.js';
import * as storage from './storage.js';
import { RETRIEVAL_TOP_K, RETRIEVAL_MIN_SIMILARITY, MINDMAP_SIMILARITY_THRESHOLD, SMALL_COLLECTION_MAX } from './config.js';

/**
 * Load both models. Call once at app boot; t009 drives its install/progress
 * screen off the two progress callbacks.
 * @param {{ onLLMProgress?: (info:{loaded:number,total:number})=>void,
 *           onEmbeddingProgress?: (info:{status:string,progress?:number})=>void }} [callbacks]
 */
export async function initEngine({ onLLMProgress, onEmbeddingProgress } = {}) {
  // Sequential, not Promise.all. Loading both models concurrently means both
  // wllama's WASM instance AND Transformers.js's ONNX WASM runtime are
  // compiling/allocating at the same time — on a memory-constrained mobile
  // Safari tab, that peak concurrent usage is a real risk even if the
  // steady-state total afterward would have been the same. Loading one
  // fully, then the other, trades a bit of wall-clock time for a materially
  // lower peak — worth it here.
  await loadLLM(onLLMProgress);
  await loadEmbeddingModel(onEmbeddingProgress);
  return true;
}

/**
 * Main entry point for the composer. Classifies the input, then routes to
 * the note-tagging path or the retrieval+answer path.
 *
 * @param {string} text
 * @param {string} chatId
 * @returns {Promise<
 *   { type: 'note', note: object, message: object } |
 *   { type: 'question', message: object, sources: Array<{id: string, score: number}> }
 * >}
 */
export async function compose(text, chatId) {
  const kind = classifyInput(text);

  if (kind === 'note') {
    return handleNote(text, chatId);
  }
  return handleQuestion(text, chatId);
}

async function handleNote(text, chatId) {
  const [{ category, tags }, embedding] = await Promise.all([
    tagNote(text),
    embedText(text),
  ]);

  const note = await storage.createNote({ content: text, category, tags, embedding });
  const message = await storage.addMessage({
    chat_id: chatId,
    role: 'note',
    content: text,
    category,
    tags,
  });

  return { type: 'note', note, message };
}

// Small instruct models (0.5B very much included) are unreliable at
// counting, even when every note is right there in the context — this is a
// model-capability ceiling, not a retrieval problem, so the fix is to not
// ask the model at all for this narrow, extremely common question shape.
// Deterministic, instant, always correct.
const NOTE_COUNT_PATTERN = /how many notes|number of notes|count (of |my )?notes/i;

function isNoteCountQuestion(text) {
  return NOTE_COUNT_PATTERN.test(text);
}

async function handleQuestion(text, chatId) {
  const allNotes = await storage.listNotes();

  if (isNoteCountQuestion(text)) {
    const n = allNotes.length;
    const answer = n === 0 ? "You don't have any notes yet." : `You have ${n} note${n === 1 ? '' : 's'}.`;
    await storage.addMessage({ chat_id: chatId, role: 'question', content: text });
    const message = await storage.addMessage({ chat_id: chatId, role: 'answer', content: answer });
    return { type: 'question', message, sources: [] };
  }

  // Small collections: skip similarity filtering entirely and use every
  // note as context. Pure embedding similarity cannot answer meta-questions
  // about the collection itself ("how many notes do I have?", "what does my
  // only note say?") — there's no note *content* that "matches" a question
  // like that, so similarity search always comes back empty and the answer
  // short-circuits to "I don't know" even when the answer is trivial. Cheap
  // to include everything below SMALL_COLLECTION_MAX; only fall back to
  // similarity-ranked top-k once there are enough notes that dumping all of
  // them would blow the context budget or dilute retrieval quality.
  let retrievedNotes;
  let top;
  if (allNotes.length <= SMALL_COLLECTION_MAX) {
    retrievedNotes = allNotes;
    top = allNotes.map((note) => ({ note, score: null }));
  } else {
    const queryEmbedding = await embedText(text);
    top = findSimilarNotes(queryEmbedding, allNotes, RETRIEVAL_TOP_K, RETRIEVAL_MIN_SIMILARITY);
    retrievedNotes = top.map((t) => t.note);
  }

  await storage.addMessage({ chat_id: chatId, role: 'question', content: text });

  const answer = await answerQuestion(text, retrievedNotes);
  const message = await storage.addMessage({ chat_id: chatId, role: 'answer', content: answer });

  const sources = top.map((t) => ({ id: t.note.id, score: t.score }));
  return { type: 'question', message, sources };
}

/**
 * Mind-map edges for every note currently stored: pairs whose cosine
 * similarity exceeds the configured threshold.
 * @param {number} [threshold]
 * @returns {Promise<Array<{a: string, b: string, score: number}>>}
 */
export async function buildMindMapEdges(threshold = MINDMAP_SIMILARITY_THRESHOLD) {
  const notes = await storage.listNotes();
  const edges = [];
  const seen = new Set();

  for (const note of notes) {
    const links = findLinkedNotes(note, notes, threshold);
    for (const link of links) {
      const key = [note.id, link.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: note.id, b: link.id, score: link.score });
    }
  }
  return edges;
}

/**
 * Wipes every cached model file (both the LLM and the embedding model).
 * Distinct from the notes/chats storage functions below — this clears the
 * one-time model download, not user data, and only matters when storage
 * has grown unexpectedly (usually from a download interrupted by a crash
 * leaving a corrupted partial file). Caller should reload the page after
 * this resolves so a fresh, clean download starts from zero.
 */
export async function clearCachedModels() {
  await Promise.all([clearCachedModel(), clearCachedEmbeddingModel()]);
}

// Re-export storage functions so t009 has one module to import for the
// whole engine surface (compose/init/mindmap + full CRUD).
export const {
  createNote,
  listNotes,
  getNote,
  deleteNote,
  deleteAllNotes,
  createChat,
  listChats,
  getChat,
  deleteChat,
  clearAllChats,
  addMessage,
  getChatMessages,
  getStorageEstimate,
} = storage;
