// js/app.js
// Real UI wiring for Ulysses — no demo/fake data. Imports the actual engine
// surface from js/engine.js and the note-vs-question heuristic straight from
// js/classify.js (pure logic, safe to reuse directly for instant UI feedback
// without waiting on compose()'s round trip).

import {
  initEngine, compose, buildMindMapEdges,
  createNote, listNotes, getNote, deleteNote, deleteAllNotes,
  createChat, listChats, getChat, deleteChat, clearAllChats,
  addMessage, getChatMessages, getStorageEstimate,
} from './engine.js';
import { classifyInput } from './classify.js';
import { MindMap, categoryColor } from './ui/mindmap.js';

// ------------------------------------------------------------- constants ---
const ONBOARD_KEY = 'ulysses:onboarded';
const THEME_KEY = 'ulysses:theme';

// ----------------------------------------------------------------- state ---
const state = {
  currentChatId: null,
  chats: [],
  notes: [],
  notesFilterText: '',
  notesFilterCategory: 'all',
  engineStatus: 'loading', // 'loading' | 'ready' | 'error'
  engineError: null,
};

// ------------------------------------------------------------------- dom ---
const $ = (id) => document.getElementById(id);

const sidebar = $('sidebar');
const collapseBtn = $('collapse-btn');
const showSidebarBtn = $('show-sidebar-btn');
const tabChats = $('tab-chats');
const tabNotes = $('tab-notes');
const tabMap = $('tab-map');
const chatHistoryEl = $('chat-history');
const notesPanelEl = $('notes-panel');
const notesToolbar = document.querySelector('.notes-toolbar');
const notesSearchInput = $('notes-search-input');
const filterChipsEl = $('filter-chips');
const notesCountBadge = $('notes-count-badge');
const newChatBtn = $('new-chat-btn');
const composerInput = $('composer-input');
const sendBtn = $('send-btn');
const micBtn = $('mic-btn');
const chatCol = $('chat-col');
const chatScroll = $('chat-scroll');
const emptyChatHint = $('empty-chat-hint');
const modelDot = $('model-dot');
const modelChipText = $('model-chip-text');

const settingsBtn = $('settings-btn');
const settingsBackdrop = $('settings-backdrop');
const settingsClose = $('settings-close');
const settingsLLMStatus = $('settings-llm-status');
const settingsEmbedStatus = $('settings-embed-status');
const settingsStorageUsed = $('settings-storage-used');
const settingsStorageQuota = $('settings-storage-quota');
const settingsNotesCount = $('settings-notes-count');
const themeButtons = document.querySelectorAll('#theme-segmented button');
const resetMemoryBtn = $('reset-memory-btn');
const deleteNotesBtn = $('delete-notes-btn');

const welcomeScreen = $('welcome-screen');
const loadingScreen = $('loading-screen');
const welcomeCta = $('welcome-cta');
const progressFill = $('progress-fill');
const progressPct = $('progress-pct');
const progressDetail = $('progress-detail');
const loadingTitle = $('loading-title');
const loadingSub = $('loading-sub');
const loadingSteps = document.querySelectorAll('.loading-step');
const loadingRetryBtn = $('loading-retry-btn');

const mindmapOverlay = $('mindmap-overlay');
const mindmapCanvas = $('mindmap-canvas');
const mindmapClose = $('mindmap-close');
const mindmapLegend = $('mindmap-legend');
const mindmapEmpty = $('mindmap-empty');
const mindmapPreview = $('mindmap-preview');

// --------------------------------------------------------------- helpers ---
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function dayBucket(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(bytes > 1024 * 1024 * 100 ? 0 : 1) + ' MB';
}

function scrollChatToBottom() {
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function pillsHTML(category, tags) {
  const cat = category ? `<span class="pill category">${escapeHTML(category)}</span>` : '';
  const tagPills = (tags || []).map((t) => `<span class="pill">${escapeHTML(t)}</span>`).join('');
  return cat + tagPills;
}

// ---------------------------------------------------------- theme toggle ---
function applyTheme(choice) {
  document.documentElement.removeAttribute('data-theme');
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  }
  themeButtons.forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === choice));
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'system';
  applyTheme(saved);
  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.themeChoice;
      localStorage.setItem(THEME_KEY, choice);
      applyTheme(choice);
    });
  });
}

// --------------------------------------------------------------- sidebar ---
collapseBtn.addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  showSidebarBtn.hidden = false;
});
showSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  showSidebarBtn.hidden = true;
});

function setActiveTab(tab) {
  tabChats.classList.toggle('active', tab === 'chats');
  tabNotes.classList.toggle('active', tab === 'notes');
  chatHistoryEl.classList.toggle('hidden', tab !== 'chats');
  notesPanelEl.classList.toggle('active', tab === 'notes');
  notesToolbar.classList.toggle('active', tab === 'notes');
  if (tab === 'notes') renderNotesPanel();
}
tabChats.addEventListener('click', () => setActiveTab('chats'));
tabNotes.addEventListener('click', () => setActiveTab('notes'));
tabMap.addEventListener('click', () => openMindMap());

// ------------------------------------------------------------ chat history --
async function refreshChatHistory() {
  state.chats = await listChats();
  renderChatHistory();
}

function renderChatHistory() {
  chatHistoryEl.innerHTML = '';
  if (state.chats.length === 0) {
    chatHistoryEl.innerHTML = '<div class="empty-state">No chats yet — send a message to start one.</div>';
    return;
  }
  let lastBucket = null;
  for (const chat of state.chats) {
    const bucket = dayBucket(chat.updated_at);
    if (bucket !== lastBucket) {
      const label = document.createElement('div');
      label.className = 'history-group-label';
      label.textContent = bucket;
      chatHistoryEl.appendChild(label);
      lastBucket = bucket;
    }
    const btn = document.createElement('button');
    btn.className = 'history-item' + (chat.id === state.currentChatId ? ' active' : '');
    btn.textContent = chat.title || 'New chat';
    btn.addEventListener('click', () => selectChat(chat.id));
    chatHistoryEl.appendChild(btn);
  }
}

async function selectChat(id) {
  state.currentChatId = id;
  renderChatHistory();
  const messages = await getChatMessages(id);
  renderMessages(messages);
}

function renderMessages(messages) {
  chatCol.innerHTML = '';
  if (messages.length === 0) {
    chatCol.appendChild(emptyChatHintNode());
    return;
  }
  let lastBucket = null;
  for (const msg of messages) {
    const bucket = dayBucket(msg.created_at);
    if (bucket !== lastBucket) {
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.textContent = bucket;
      chatCol.appendChild(div);
      lastBucket = bucket;
    }
    chatCol.appendChild(renderMessageNode(msg));
  }
  scrollChatToBottom();
}

function emptyChatHintNode() {
  const div = document.createElement('div');
  div.className = 'empty-chat-hint';
  div.textContent = 'Speak or type a thought to file it away, or ask a question to get an answer grounded only in your notes.';
  return div;
}

function renderMessageNode(msg) {
  const div = document.createElement('div');
  if (msg.role === 'note') {
    div.className = 'msg msg-note glass';
    div.innerHTML = `${escapeHTML(msg.content)}<div class="tags">${pillsHTML(msg.category, msg.tags)}</div>`;
  } else if (msg.role === 'question') {
    div.className = 'msg msg-question';
    div.textContent = msg.content;
  } else {
    div.className = 'msg msg-answer glass';
    div.innerHTML = `<span class="answer-label">From your notes</span>${escapeHTML(msg.content)}`;
  }
  return div;
}

// ------------------------------------------------------------- composer ---
function autosize() {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + 'px';
}
composerInput.addEventListener('input', () => {
  autosize();
  sendBtn.classList.toggle('ready', composerInput.value.trim().length > 0);
});
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

newChatBtn.addEventListener('click', async () => {
  const chat = await createChat({ title: 'New chat' });
  state.currentChatId = chat.id;
  state.chats.unshift(chat);
  renderChatHistory();
  chatCol.innerHTML = '';
  chatCol.appendChild(emptyChatHintNode());
  setActiveTab('chats');
  composerInput.focus();
});

sendBtn.addEventListener('click', () => sendMessage());

async function sendMessage() {
  const text = composerInput.value.trim();
  if (!text || state.engineStatus !== 'ready') return;

  composerInput.value = '';
  autosize();
  sendBtn.classList.remove('ready');

  if (!state.currentChatId) {
    const chat = await createChat({ title: text.slice(0, 40) });
    state.currentChatId = chat.id;
    state.chats.unshift(chat);
  }

  if (chatCol.querySelector('.empty-chat-hint')) chatCol.innerHTML = '';

  const kind = classifyInput(text);
  let pendingEl;

  if (kind === 'question') {
    const qEl = document.createElement('div');
    qEl.className = 'msg msg-question';
    qEl.textContent = text;
    chatCol.appendChild(qEl);
    pendingEl = document.createElement('div');
    pendingEl.className = 'msg msg-answer glass';
    pendingEl.innerHTML = '<span class="answer-label">From your notes</span><span class="thinking"><span></span><span></span><span></span></span>';
    chatCol.appendChild(pendingEl);
    scrollChatToBottom();
  } else {
    pendingEl = document.createElement('div');
    pendingEl.className = 'msg msg-note glass';
    pendingEl.innerHTML = `${escapeHTML(text)}<div class="tags"><span class="thinking"><span></span><span></span><span></span></span></div>`;
    chatCol.appendChild(pendingEl);
    scrollChatToBottom();
  }

  try {
    const result = await compose(text, state.currentChatId);
    if (result.type === 'question') {
      pendingEl.innerHTML = `<span class="answer-label">From your notes</span>${escapeHTML(result.message.content)}`;
    } else {
      pendingEl.innerHTML = `${escapeHTML(text)}<div class="tags">${pillsHTML(result.note.category, result.note.tags)}</div>`;
      state.notes.unshift(result.note);
      updateNotesCountBadge();
      rebuildFilterChips();
    }
    scrollChatToBottom();
    await refreshChatHistory();
  } catch (err) {
    console.error('compose() failed', err);
    if (kind === 'question') {
      pendingEl.innerHTML = '<span class="answer-label">From your notes</span>Something went wrong answering that — please try again.';
    } else {
      pendingEl.innerHTML = `${escapeHTML(text)}<div class="tags"><span class="pill" style="color:var(--danger)">tagging failed</span></div>`;
    }
  }
}

// ---------------------------------------------------------------- voice ---
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false, recognizer = null;
if (SpeechRecognitionCtor) {
  recognizer = new SpeechRecognitionCtor();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = 'en-US';
  recognizer.onresult = (event) => {
    let t = '';
    for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
    composerInput.value = t;
    autosize();
    sendBtn.classList.toggle('ready', t.trim().length > 0);
  };
  recognizer.onend = () => { recognizing = false; micBtn.classList.remove('listening'); };
  micBtn.addEventListener('click', () => {
    if (state.engineStatus !== 'ready') return;
    if (recognizing) { recognizer.stop(); return; }
    recognizing = true;
    micBtn.classList.add('listening');
    composerInput.value = '';
    recognizer.start();
  });
} else {
  micBtn.disabled = true;
  micBtn.title = 'Voice input not supported in this browser';
}

// ---------------------------------------------------------------- notes ---
async function refreshNotes() {
  state.notes = await listNotes();
  updateNotesCountBadge();
  rebuildFilterChips();
}

function updateNotesCountBadge() {
  notesCountBadge.textContent = String(state.notes.length);
}

function rebuildFilterChips() {
  const categories = Array.from(new Set(state.notes.map((n) => n.category).filter(Boolean))).sort();
  const active = state.notesFilterCategory;
  filterChipsEl.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (active === 'all' ? ' active' : '');
  allChip.dataset.filter = 'all';
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => setNotesFilterCategory('all'));
  filterChipsEl.appendChild(allChip);
  for (const cat of categories) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (active === cat ? ' active' : '');
    chip.dataset.filter = cat;
    chip.textContent = cat;
    chip.addEventListener('click', () => setNotesFilterCategory(cat));
    filterChipsEl.appendChild(chip);
  }
}

function setNotesFilterCategory(cat) {
  state.notesFilterCategory = cat;
  rebuildFilterChips();
  renderNotesPanel();
}

notesSearchInput.addEventListener('input', () => {
  state.notesFilterText = notesSearchInput.value.trim().toLowerCase();
  renderNotesPanel();
});

function renderNotesPanel() {
  const { notesFilterText, notesFilterCategory } = state;
  const filtered = state.notes.filter((n) => {
    const matchesText = !notesFilterText || n.content.toLowerCase().includes(notesFilterText);
    const matchesCat = notesFilterCategory === 'all' || n.category === notesFilterCategory;
    return matchesText && matchesCat;
  });

  notesPanelEl.innerHTML = '';
  if (filtered.length === 0) {
    notesPanelEl.innerHTML = `<div class="empty-state">${state.notes.length === 0 ? 'No notes yet — say something to file your first one.' : 'No notes match your search.'}</div>`;
    return;
  }
  for (const note of filtered) {
    const btn = document.createElement('button');
    btn.className = 'note-row';
    btn.dataset.id = note.id;
    btn.innerHTML = `
      <div class="note-row-text">${escapeHTML(note.content)}</div>
      <div class="note-row-meta">${pillsHTML(note.category, note.tags)}<span class="note-row-time">${formatRelativeTime(note.created_at)}</span></div>
    `;
    notesPanelEl.appendChild(btn);
  }
}

function highlightNoteRow(id) {
  setActiveTab('notes');
  state.notesFilterText = '';
  state.notesFilterCategory = 'all';
  notesSearchInput.value = '';
  rebuildFilterChips();
  renderNotesPanel();
  requestAnimationFrame(() => {
    const row = notesPanelEl.querySelector(`.note-row[data-id="${id}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.style.background = 'var(--glass-fill-strong)';
      setTimeout(() => { row.style.background = ''; }, 1200);
    }
  });
}

// ------------------------------------------------------------- settings ---
settingsBtn.addEventListener('click', async () => {
  settingsBackdrop.classList.add('open');
  await refreshSettingsPanel();
});
settingsClose.addEventListener('click', () => settingsBackdrop.classList.remove('open'));
settingsBackdrop.addEventListener('click', (e) => {
  if (e.target === settingsBackdrop) settingsBackdrop.classList.remove('open');
});

async function refreshSettingsPanel() {
  if (state.engineStatus === 'ready') {
    settingsLLMStatus.textContent = 'Qwen2.5-1.5B ✓';
    settingsLLMStatus.className = 'settings-row-value ok';
    settingsEmbedStatus.textContent = 'MiniLM-L6 ✓';
    settingsEmbedStatus.className = 'settings-row-value ok';
  } else if (state.engineStatus === 'error') {
    settingsLLMStatus.textContent = 'Failed to load';
    settingsLLMStatus.className = 'settings-row-value err';
    settingsEmbedStatus.textContent = 'Failed to load';
    settingsEmbedStatus.className = 'settings-row-value err';
  } else {
    settingsLLMStatus.textContent = 'Loading…';
    settingsLLMStatus.className = 'settings-row-value';
    settingsEmbedStatus.textContent = 'Loading…';
    settingsEmbedStatus.className = 'settings-row-value';
  }

  settingsNotesCount.textContent = String(state.notes.length);

  const est = await getStorageEstimate();
  if (est.supported) {
    settingsStorageUsed.textContent = mb(est.usageBytes);
    settingsStorageQuota.textContent = mb(est.quotaBytes);
  } else {
    settingsStorageUsed.textContent = 'unavailable';
    settingsStorageQuota.textContent = 'unavailable';
  }
}

resetMemoryBtn.addEventListener('click', async () => {
  if (!confirm('Reset memory? This clears all chat history. Your notes are not affected.')) return;
  resetMemoryBtn.disabled = true;
  try {
    await clearAllChats();
    state.chats = [];
    state.currentChatId = null;
    renderChatHistory();
    chatCol.innerHTML = '';
    chatCol.appendChild(emptyChatHintNode());
    settingsBackdrop.classList.remove('open');
  } finally {
    resetMemoryBtn.disabled = false;
  }
});

deleteNotesBtn.addEventListener('click', async () => {
  if (!confirm('Delete all notes? This permanently erases your archive and cannot be undone.')) return;
  deleteNotesBtn.disabled = true;
  try {
    await deleteAllNotes();
    state.notes = [];
    updateNotesCountBadge();
    rebuildFilterChips();
    renderNotesPanel();
    settingsBackdrop.classList.remove('open');
  } finally {
    deleteNotesBtn.disabled = false;
  }
});

// ------------------------------------------------------------- mind map ---
let mindmap = null;

async function openMindMap() {
  mindmapOverlay.classList.remove('hidden');
  mindmapPreview.classList.add('hidden');
  const notes = await listNotes();
  const edges = await buildMindMapEdges();

  mindmapEmpty.classList.toggle('hidden', notes.length > 0);
  mindmapLegend.innerHTML = '';
  const categories = Array.from(new Set(notes.map((n) => n.category).filter(Boolean))).sort();
  for (const cat of categories) {
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    chip.innerHTML = `<span class="legend-dot" style="background:${categoryColor(cat)}"></span>${escapeHTML(cat)}`;
    mindmapLegend.appendChild(chip);
  }

  if (!mindmap) {
    mindmap = new MindMap(mindmapCanvas, { onNodeClick: showNodePreview });
  }
  mindmap.setData(notes, edges);

  window.addEventListener('resize', onMindMapResize);
}

function onMindMapResize() {
  if (mindmap && !mindmapOverlay.classList.contains('hidden')) mindmap.resize();
}

function showNodePreview(noteId) {
  const note = mindmap.nodes.find((n) => n.id === noteId);
  if (!note) return;
  getNote(noteId).then((full) => {
    if (!full) return;
    mindmapPreview.classList.remove('hidden');
    mindmapPreview.innerHTML = `
      <div>${pillsHTML(full.category, full.tags)}</div>
      <p style="margin:.5rem 0;">${escapeHTML(full.content)}</p>
      <button class="danger-btn" style="border-color:var(--accent);color:var(--accent);" id="mindmap-open-note">Open in Notes →</button>
    `;
    $('mindmap-open-note').addEventListener('click', () => {
      closeMindMap();
      highlightNoteRow(full.id);
    });
  });
}

function closeMindMap() {
  mindmapOverlay.classList.add('hidden');
  window.removeEventListener('resize', onMindMapResize);
}
mindmapClose.addEventListener('click', closeMindMap);

// --------------------------------------------------------- engine status ---
function setModelChip(mode) {
  modelDot.classList.remove('loading', 'error');
  if (mode === 'loading') {
    modelDot.classList.add('loading');
    modelChipText.textContent = 'Loading model…';
  } else if (mode === 'error') {
    modelDot.classList.add('error');
    modelChipText.textContent = 'Model failed — tap to retry';
  } else {
    modelChipText.textContent = 'Qwen2.5-1.5B · on-device';
  }
}
modelChipText.parentElement.addEventListener('click', () => {
  if (state.engineStatus === 'error') location.reload();
});

function setComposerEnabled(enabled) {
  composerInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  micBtn.disabled = !enabled || !SpeechRecognitionCtor;
  composerInput.placeholder = enabled
    ? 'Speak or type a thought, or ask your brain...'
    : (state.engineStatus === 'error' ? 'Model failed to load — reload to retry' : 'Loading the on-device model…');
}

// ------------------------------------------------------------- app boot ---
async function loadAppData() {
  await Promise.all([refreshChatHistory(), refreshNotes()]);
  if (state.chats.length > 0) {
    await selectChat(state.chats[0].id);
  } else {
    chatCol.innerHTML = '';
    chatCol.appendChild(emptyChatHintNode());
  }
}

async function loadEngineSilently() {
  state.engineStatus = 'loading';
  setModelChip('loading');
  setComposerEnabled(false);
  try {
    await initEngine({});
    state.engineStatus = 'ready';
    setModelChip('ready');
    setComposerEnabled(true);
  } catch (err) {
    console.error('initEngine failed', err);
    state.engineStatus = 'error';
    state.engineError = err;
    setModelChip('error');
    setComposerEnabled(false);
  }
}

function showApp() {
  welcomeScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
}

function updateLoadingProgress({ llmLoaded, llmTotal, embedPct, llmDone, embedDone }) {
  const llmPct = llmTotal > 0 ? (llmLoaded / llmTotal) * 100 : (llmDone ? 100 : 0);
  const overall = Math.min(100, llmPct * 0.85 + embedPct * 0.15);
  progressFill.style.width = overall + '%';
  progressPct.textContent = Math.floor(overall) + '%';
  progressDetail.textContent = llmTotal > 0 ? `${mb(llmLoaded)} / ${mb(llmTotal)}` : (llmDone ? 'Preparing…' : 'Starting…');

  const stepIdx = !llmDone ? 0 : !embedDone ? 1 : 2;
  loadingSteps.forEach((s, i) => {
    s.classList.toggle('done', i < stepIdx || (i === 2 && llmDone && embedDone));
    s.classList.toggle('active', i === stepIdx);
  });
}

async function runOnboarding() {
  welcomeScreen.classList.add('hidden');
  loadingScreen.classList.remove('hidden');
  loadingRetryBtn.classList.add('hidden');
  loadingSub.classList.remove('err');
  loadingSub.textContent = 'Downloading the on-device model once — this stays cached on your device from here on.';
  progressFill.classList.remove('err');

  const progress = { llmLoaded: 0, llmTotal: 0, embedPct: 0, llmDone: false, embedDone: false };

  try {
    await initEngine({
      onLLMProgress: ({ loaded, total }) => {
        progress.llmLoaded = loaded;
        progress.llmTotal = total;
        progress.llmDone = total > 0 && loaded >= total;
        updateLoadingProgress(progress);
      },
      onEmbeddingProgress: (info) => {
        if (typeof info.progress === 'number') progress.embedPct = info.progress;
        if (info.status === 'done' || info.status === 'ready') progress.embedDone = true;
        updateLoadingProgress(progress);
      },
    });

    progress.llmDone = true;
    progress.embedDone = true;
    updateLoadingProgress(progress);

    localStorage.setItem(ONBOARD_KEY, '1');
    state.engineStatus = 'ready';
    setModelChip('ready');
    setComposerEnabled(true);
    await loadAppData();
    setTimeout(showApp, 400);
  } catch (err) {
    console.error('onboarding initEngine failed', err);
    loadingSub.textContent = 'Couldn’t download the model — check your internet connection and try again.';
    loadingSub.classList.add('err');
    progressFill.classList.add('err');
    loadingRetryBtn.classList.remove('hidden');
  }
}

welcomeCta.addEventListener('click', runOnboarding);
loadingRetryBtn.addEventListener('click', () => location.reload());

async function boot() {
  initTheme();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }

  const onboarded = localStorage.getItem(ONBOARD_KEY) === '1';
  if (!onboarded) {
    // Welcome screen is visible by default in the markup; wait for the CTA.
    return;
  }

  // Returning visit: skip Welcome/Loading entirely, show the app immediately,
  // and load the (already-cached) models quietly in the background.
  showApp();
  await loadAppData();
  loadEngineSilently();
}

boot();
