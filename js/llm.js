// js/llm.js
// wllama (WASM llama.cpp) wrapper around Qwen2.5-1.5B-Instruct (GGUF, Q4_K_M).
// Two capabilities: tag a note (category + tags as JSON) and answer a
// question grounded in retrieved notes.
//
// Model bytes are fetched once from Hugging Face and cached by wllama's own
// storage backend (Origin Private File System — OPFS — by default, falling
// back automatically where OPFS is unavailable). A second `loadModel()` call
// in a later page load reads from that cache and does not re-download.

import { Wllama } from '@wllama/wllama';
import { LLM_MODEL } from './config.js';

const WASM_PATHS = {
  // Relative (not "/wasm/...") so it resolves correctly under a subpath
  // deployment like GitHub Pages project sites (https://user.github.io/repo/),
  // not just at domain root. Served as a static asset by Vite; see
  // scripts/copy-wasm.mjs (runs on `npm install` via postinstall) for how it
  // gets into public/wasm.
  default: 'wasm/wllama.wasm',
};

let wllama = null;
let loadPromise = null;

function makeWllama() {
  return new Wllama(WASM_PATHS, {
    // Silence llama.cpp's very verbose native debug log; keep warnings/errors.
    logger: {
      debug: () => {},
      log: (...a) => console.log('[wllama]', ...a),
      warn: (...a) => console.warn('[wllama]', ...a),
      error: (...a) => console.error('[wllama]', ...a),
    },
  });
}

/**
 * Loads Qwen2.5-1.5B-Instruct (idempotent — safe to call multiple times;
 * subsequent calls reuse the in-flight or already-completed load).
 *
 * @param {(info: {loaded: number, total: number}) => void} [onProgress]
 *   bytes downloaded / total — drives t009's install screen progress bar.
 *   Not invoked at all when the model is already cached (nothing to download).
 */
export function loadLLM(onProgress) {
  if (loadPromise) return loadPromise;

  wllama = makeWllama();
  loadPromise = wllama
    .loadModelFromHF(
      { repo: LLM_MODEL.repo, file: LLM_MODEL.file },
      {
        progressCallback: onProgress,
        n_ctx: LLM_MODEL.contextSize,
        // Force pure-WASM CPU inference. iPhone 15 (base, A16) has no
        // WebGPU guarantee in-browser, so we deliberately don't rely on it
        // for this task — see brief. WebGPU can be a later fast-follow.
        n_gpu_layers: 0,
      }
    )
    .then(() => wllama);

  return loadPromise;
}

/** @returns {boolean} whether the model has finished loading in this session */
export function isLLMLoaded() {
  return wllama !== null && loadPromise !== null;
}

function extractJSONObject(text) {
  // Models sometimes wrap JSON in prose or code fences despite instructions;
  // grab the first {...} block defensively.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model output: ' + text);
  return JSON.parse(match[0]);
}

/**
 * Tag a note: given raw note text, return { category, tags[] }.
 * Reuses the same prompt contract as the old Flask app.
 * @param {string} noteText
 * @returns {Promise<{category: string, tags: string[]}>}
 */
export async function tagNote(noteText) {
  if (!wllama) await loadLLM();

  const messages = [
    {
      role: 'system',
      content:
        'You are a note-tagging assistant. Given a note, respond with ONLY a ' +
        'JSON object of the form {"category": string, "tags": string[]}. ' +
        'category is ONE short word or phrase describing the note\'s topic. ' +
        'tags is an array of up to 4 short, lowercase, single-or-two-word ' +
        'keywords relevant to the note. Do not include any text other than ' +
        'the JSON object — no explanation, no markdown fences.',
    },
    { role: 'user', content: noteText },
  ];

  const response = await wllama.createChatCompletion({
    messages,
    max_tokens: 128,
    temperature: 0.2,
    top_p: 0.9,
  });

  const raw = response.choices[0].message.content.trim();
  const parsed = extractJSONObject(raw);

  const category = typeof parsed.category === 'string' ? parsed.category.trim() : 'uncategorized';
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t) => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return { category, tags };
}

/**
 * Answer a question, grounded ONLY in the given retrieved notes. Instructed
 * to say "I don't know" rather than fabricate when the notes don't cover it.
 * @param {string} question
 * @param {Array<{content: string}>} retrievedNotes
 * @returns {Promise<string>} the answer text
 */
export const NO_ANSWER_TEXT = "I don't know based on your notes.";

export async function answerQuestion(question, retrievedNotes) {
  // Short-circuit rather than asking the model at all: with zero retrieved
  // notes there is nothing to ground an answer in, and small instruct models
  // (Qwen2.5-1.5B included) will readily fall back on their own parametric
  // knowledge despite being told not to — measured directly in testing (see
  // report). Not calling the model here is strictly more correct AND faster.
  if (!retrievedNotes || retrievedNotes.length === 0) {
    return NO_ANSWER_TEXT;
  }

  if (!wllama) await loadLLM();

  const context = retrievedNotes.map((n, i) => `[Note ${i + 1}] ${n.content}`).join('\n\n');

  const messages = [
    {
      role: 'system',
      content:
        'You are a grounded question-answering assistant for a personal notes app. ' +
        'You will be given some of the user\'s own notes, then a question. ' +
        `Answer using ONLY facts stated in the notes below. If the notes do not ` +
        `answer the question, you MUST respond with exactly this sentence and ` +
        `nothing else: "${NO_ANSWER_TEXT}" ` +
        'Never use knowledge you have from training — treat the notes as the ' +
        'only source of truth that exists, even for questions you otherwise ' +
        'know the answer to. Do not explain your reasoning, just answer.\n\n' +
        `Notes:\n${context}`,
    },
    { role: 'user', content: question },
  ];

  const response = await wllama.createChatCompletion({
    messages,
    max_tokens: 300,
    temperature: 0.3,
    top_p: 0.9,
  });

  return response.choices[0].message.content.trim();
}
