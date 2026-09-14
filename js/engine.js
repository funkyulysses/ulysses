// js/engine.js
// The end-to-end pipeline t009's UI calls into. No DOM code here — this
// module is pure logic + calls into storage.js / llm.js / embeddings.js.
//
//   compose(text) -> classify note vs question
//     note path:     tag(text) -> embed(text) -> createNote + addMessage
//     question path: embed(text) -> retrieve top-k similar notes
//                     -> answer(text, notes) -> addMessage (no note written)

import { classifyInput } from './classify.js';
import { loadLLM, tagNote, answerQuestion } from './llm.js';
import { loadEmbeddingModel, embedText, findSimilarNotes, findLinkedNotes } from './embeddings.js';
import * as storage from './storage.js';
import { RETRIEVAL_TOP_K, RETRIEVAL_MIN_SIMILARITY, MINDMAP_SIMILARITY_THRESHOLD } from './config.js';

/**
 * Load both models. Call once at app boot; t009 drives its install/progress
 * screen off the two progress callbacks.
 * @param {{ onLLMProgress?: (info:{loaded:number,total:number})=>void,
 *           onEmbeddingProgress?: (info:{status:string,progress?:number})=>void }} [callbacks]
 */
export async function initEngine({ onLLMProgress, onEmbeddingProgress } = {}) {
  await Promise.all([
    loadLLM(onLLMProgress),
    loadEmbeddingModel(onEmbeddingProgress),
  ]);
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

async function handleQuestion(text, chatId) {
  const queryEmbedding = await embedText(text);
  const allNotes = await storage.listNotes();
  const top = findSimilarNotes(queryEmbedding, allNotes, RETRIEVAL_TOP_K, RETRIEVAL_MIN_SIMILARITY);
  const retrievedNotes = top.map((t) => t.note);

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
