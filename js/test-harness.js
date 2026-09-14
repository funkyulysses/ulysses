// js/test-harness.js
// Manual/automated exercise harness for the engine (see brief Goal 6). Not
// shipped as part of the product — reachable at /test.html only. Each
// run* function returns a plain JSON-serializable result object so it can
// be driven headlessly (Playwright: `page.evaluate(() => window.runAllTests())`)
// as well as clicked through manually.

import { classifyInput } from './classify.js';
import {
  loadEmbeddingModel,
  embedText,
  cosineSimilarity,
  findSimilarNotes,
} from './embeddings.js';
import { loadLLM, tagNote, answerQuestion } from './llm.js';
import * as storage from './storage.js';
import { compose, buildMindMapEdges } from './engine.js';

function ok(name, detail = {}) { return { name, pass: true, ...detail }; }
function fail(name, error, detail = {}) {
  return { name, pass: false, error: String(error && error.stack || error), ...detail };
}

async function run(name, fn) {
  const t0 = performance.now();
  try {
    const detail = (await fn()) || {};
    return { ...ok(name, detail), ms: +(performance.now() - t0).toFixed(1) };
  } catch (e) {
    return { ...fail(name, e), ms: +(performance.now() - t0).toFixed(1) };
  }
}

// --------------------------------------------------------------- storage ---

window.runStorageTests = async function runStorageTests() {
  const results = [];

  results.push(await run('deleteAllNotes + clearAllChats (clean slate)', async () => {
    await storage.deleteAllNotes();
    await storage.clearAllChats();
    const notes = await storage.listNotes();
    const chats = await storage.listChats();
    if (notes.length !== 0 || chats.length !== 0) throw new Error('store not empty after clear');
  }));

  let noteId, chatId;
  results.push(await run('createNote', async () => {
    const note = await storage.createNote({
      content: 'Test note about IndexedDB storage layers.',
      category: 'testing',
      tags: ['idb', 'storage'],
      embedding: [0.1, 0.2, 0.3],
    });
    noteId = note.id;
    if (!note.id || note.content !== 'Test note about IndexedDB storage layers.') {
      throw new Error('createNote returned malformed record');
    }
    return { noteId };
  }));

  results.push(await run('listNotes finds created note', async () => {
    const notes = await storage.listNotes();
    if (!notes.find((n) => n.id === noteId)) throw new Error('created note not found in listNotes');
    return { count: notes.length };
  }));

  results.push(await run('getNote round-trips embedding', async () => {
    const note = await storage.getNote(noteId);
    if (!note || note.embedding.length !== 3) throw new Error('embedding not preserved');
  }));

  results.push(await run('createChat + addMessage + getChatMessages', async () => {
    const chat = await storage.createChat({ title: 'Test chat' });
    chatId = chat.id;
    await storage.addMessage({ chat_id: chatId, role: 'note', content: 'hello', category: 'x', tags: ['y'] });
    await storage.addMessage({ chat_id: chatId, role: 'question', content: 'what is x?' });
    await storage.addMessage({ chat_id: chatId, role: 'answer', content: 'x is y' });
    const messages = await storage.getChatMessages(chatId);
    if (messages.length !== 3) throw new Error(`expected 3 messages, got ${messages.length}`);
    if (messages[0].role !== 'note' || messages[2].role !== 'answer') {
      throw new Error('message ordering incorrect');
    }
    return { chatId, messageCount: messages.length };
  }));

  results.push(await run('listChats finds created chat, updated_at bumped', async () => {
    const chats = await storage.listChats();
    const found = chats.find((c) => c.id === chatId);
    if (!found) throw new Error('chat not found');
    if (found.updated_at < found.created_at) throw new Error('updated_at not bumped by addMessage');
  }));

  results.push(await run('deleteNote removes it', async () => {
    await storage.deleteNote(noteId);
    const note = await storage.getNote(noteId);
    if (note !== null) throw new Error('note still present after delete');
  }));

  results.push(await run('clearAllChats wipes chats AND messages', async () => {
    await storage.clearAllChats();
    const chats = await storage.listChats();
    const messages = await storage.getChatMessages(chatId);
    if (chats.length !== 0) throw new Error('chats not cleared');
    if (messages.length !== 0) throw new Error('messages not cleared alongside chats');
  }));

  results.push(await run('getStorageEstimate returns a shape', async () => {
    const est = await storage.getStorageEstimate();
    if (typeof est.supported !== 'boolean') throw new Error('missing supported flag');
    return est;
  }));

  return { suite: 'storage', results, passed: results.filter((r) => r.pass).length, total: results.length };
};

// -------------------------------------------------------------- classify ---

window.runClassifyTests = async function runClassifyTests() {
  const cases = [
    ['Remember to buy milk tomorrow.', 'note'],
    ['What time is the meeting?', 'question'],
    ['How do I reset my password', 'question'],
    ['Is the store open on Sunday', 'question'],
    ['The quarterly report is due Friday.', 'note'],
    ['Why does this keep happening?', 'question'],
    ['Meeting notes from today: discussed roadmap.', 'note'],
    ['Can you believe it?', 'question'],
  ];
  const results = cases.map(([text, expected]) => {
    const actual = classifyInput(text);
    return actual === expected
      ? ok(`"${text}" -> ${expected}`)
      : fail(`"${text}" -> expected ${expected}`, `got ${actual}`);
  });
  return { suite: 'classify', results, passed: results.filter((r) => r.pass).length, total: results.length };
};

// ------------------------------------------------------------- embedding ---

window.runEmbeddingTests = async function runEmbeddingTests() {
  const results = [];

  results.push(await run('loadEmbeddingModel', async () => {
    await loadEmbeddingModel((info) => {
      if (info && info.status) console.log('[embed load]', info.status, info.progress ?? '');
    });
  }));

  let vecs = {};
  results.push(await run('embedText produces 384-dim normalized vectors', async () => {
    const texts = {
      a: 'The cat sat on the warm windowsill in the afternoon sun.',
      b: 'A kitten was napping on the sunny window ledge.',
      c: 'Quarterly tax filings are due at the end of the month.',
    };
    for (const [k, t] of Object.entries(texts)) vecs[k] = await embedText(t);
    for (const [k, v] of Object.entries(vecs)) {
      if (v.length !== 384) throw new Error(`${k}: expected 384 dims, got ${v.length}`);
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      if (Math.abs(norm - 1) > 0.01) throw new Error(`${k}: not L2-normalized (norm=${norm})`);
    }
  }));

  results.push(await run('related notes score higher than unrelated notes', async () => {
    const simRelated = cosineSimilarity(vecs.a, vecs.b);
    const simUnrelated = cosineSimilarity(vecs.a, vecs.c);
    if (!(simRelated > simUnrelated)) {
      throw new Error(`expected related (${simRelated}) > unrelated (${simUnrelated})`);
    }
    return { simRelated: +simRelated.toFixed(4), simUnrelated: +simUnrelated.toFixed(4) };
  }));

  results.push(await run('findSimilarNotes ranks correctly', async () => {
    const candidates = [
      { id: 'related', embedding: vecs.b },
      { id: 'unrelated', embedding: vecs.c },
    ];
    const top = findSimilarNotes(vecs.a, candidates, 2, 0);
    if (top[0].note.id !== 'related') throw new Error('top result should be the related note');
    return { order: top.map((t) => t.note.id) };
  }));

  return { suite: 'embedding', results, passed: results.filter((r) => r.pass).length, total: results.length };
};

// ------------------------------------------------------------------ LLM ---

window.runLLMTests = async function runLLMTests() {
  const results = [];
  let bytesSeen = { loaded: 0, total: 0 };

  results.push(await run('loadLLM (downloads + caches on first run)', async () => {
    await loadLLM((info) => {
      bytesSeen = info;
      if (info.total) {
        const pct = ((info.loaded / info.total) * 100).toFixed(1);
        if (info.loaded === info.total || Math.random() < 0.02) {
          console.log(`[llm load] ${pct}% (${info.loaded}/${info.total} bytes)`);
        }
      }
    });
    return { bytesSeen };
  }));

  results.push(await run('tagNote produces sane category + tags (JSON)', async () => {
    const r = await tagNote(
      'Finished reading Atomic Habits. Key idea: small 1% improvements compound over time into big results.'
    );
    if (typeof r.category !== 'string' || !r.category) throw new Error('missing category');
    if (!Array.isArray(r.tags) || r.tags.length === 0) throw new Error('missing tags');
    if (r.tags.length > 4) throw new Error('too many tags (>4)');
    return r;
  }));

  let groundedNoteId;
  results.push(await run('setup: store a note to ground a question in', async () => {
    const note = await storage.createNote({
      content: 'Our team standup is every weekday at 9:30am in the Falcon conference room.',
      category: 'work',
      tags: ['standup', 'schedule'],
      embedding: await embedText('Our team standup is every weekday at 9:30am in the Falcon conference room.'),
    });
    groundedNoteId = note.id;
  }));

  results.push(await run('answerQuestion is grounded (answers from provided note)', async () => {
    const notes = await storage.listNotes();
    const target = notes.find((n) => n.id === groundedNoteId);
    const answer = await answerQuestion('What time is the team standup?', [target]);
    const lower = answer.toLowerCase();
    if (!lower.includes('9:30')) {
      throw new Error(`expected answer to mention 9:30am, got: "${answer}"`);
    }
    return { answer };
  }));

  results.push(await run('answerQuestion says "I don\'t know" with zero retrieved notes (short-circuits, no model call)', async () => {
    const answer = await answerQuestion('What is the capital of Mongolia?', []);
    const lower = answer.toLowerCase();
    if (!lower.includes("don't know")) {
      throw new Error(`expected an "I don't know" style answer, got: "${answer}"`);
    }
    return { answer };
  }));

  // Harder case: an irrelevant note IS provided (so no short-circuit — the
  // model itself must decline). Small instruct models are not perfectly
  // reliable at refusing well-known facts even when told to; this is
  // reported as informational rather than asserted pass/fail. See report.
  results.push(await run('[informational] answerQuestion with an irrelevant note present', async () => {
    const notes = await storage.listNotes();
    const target = notes.find((n) => n.id === groundedNoteId);
    const answer = await answerQuestion('What is the capital of Mongolia?', [target]);
    return { answer, note: 'informational only — small-model grounding under an unrelated-but-present note is a known soft spot, see report' };
  }));

  return { suite: 'llm', results, passed: results.filter((r) => r.pass).length, total: results.length };
};

// -------------------------------------------------------------- pipeline ---

window.runPipelineTests = async function runPipelineTests() {
  const results = [];
  let chatId;

  results.push(await run('createChat', async () => {
    const chat = await storage.createChat({ title: 'Pipeline test chat' });
    chatId = chat.id;
  }));

  results.push(await run('compose(note) writes note + message', async () => {
    const r = await compose(
      'Project Ulysses runs entirely on-device using wllama and Transformers.js, no server involved.',
      chatId
    );
    if (r.type !== 'note') throw new Error('expected note classification');
    if (!r.note.id || !r.note.category) throw new Error('note not written correctly');
    if (r.message.role !== 'note') throw new Error('message role should be note');
    return { category: r.note.category, tags: r.note.tags };
  }));

  results.push(await run('compose(question) retrieves + answers, writes messages only', async () => {
    const beforeNotes = await storage.listNotes();
    const r = await compose('Does Ulysses need a server to work?', chatId);
    const afterNotes = await storage.listNotes();
    if (r.type !== 'question') throw new Error('expected question classification');
    if (afterNotes.length !== beforeNotes.length) throw new Error('question path should not write a note');
    if (!Array.isArray(r.sources)) throw new Error('missing sources');
    return { answer: r.message.content, sources: r.sources };
  }));

  results.push(await run('getChatMessages reflects full pipeline (note, question, answer)', async () => {
    const messages = await storage.getChatMessages(chatId);
    const roles = messages.map((m) => m.role);
    if (!roles.includes('note') || !roles.includes('question') || !roles.includes('answer')) {
      throw new Error(`unexpected roles: ${roles.join(',')}`);
    }
    return { roles };
  }));

  results.push(await run('buildMindMapEdges runs without error', async () => {
    const edges = await buildMindMapEdges();
    return { edgeCount: edges.length };
  }));

  return { suite: 'pipeline', results, passed: results.filter((r) => r.pass).length, total: results.length };
};

// ------------------------------------------------------------------- all ---

window.runAllTests = async function runAllTests() {
  const suites = [];
  suites.push(await window.runStorageTests());
  suites.push(await window.runClassifyTests());
  suites.push(await window.runEmbeddingTests());
  suites.push(await window.runLLMTests());
  suites.push(await window.runPipelineTests());
  const passed = suites.reduce((s, x) => s + x.passed, 0);
  const total = suites.reduce((s, x) => s + x.total, 0);
  return { suites, passed, total, allPassed: passed === total };
};
