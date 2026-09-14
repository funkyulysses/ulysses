// js/storage.js
// IndexedDB storage layer. Replaces the old Flask/SQLite persistence.
// Three object stores: notes, chats, messages. All functions are small,
// async, and return plain JS objects/arrays (never IDB-specific types),
// mirroring the shape of the old Flask JSON API so the UI layer ports
// over with minimal changes.

import { openDB } from 'idb';
import { IDB_DB_NAME, IDB_DB_VERSION } from './config.js';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(IDB_DB_NAME, IDB_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('notes')) {
          const notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('chats')) {
          const chats = db.createObjectStore('chats', { keyPath: 'id' });
          chats.createIndex('updated_at', 'updated_at');
        }
        if (!db.objectStoreNames.contains('messages')) {
          const messages = db.createObjectStore('messages', { keyPath: 'id' });
          messages.createIndex('chat_id', 'chat_id');
          messages.createIndex('created_at', 'created_at');
        }
      },
    });
  }
  return dbPromise;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowISO() {
  return new Date().toISOString();
}

// created_at alone (millisecond ISO strings) can collide when several
// records are written in quick succession (e.g. the note+message pair from
// one compose() call), and Array.sort ties then fall back to IndexedDB's
// arbitrary retrieval order rather than true insertion order. `seq` is a
// monotonically increasing tiebreaker used wherever strict ordering matters.
let seqCounter = 0;
function nextSeq() {
  return Date.now() * 1000 + (seqCounter++ % 1000);
}

// ---------------------------------------------------------------- notes ---

/**
 * @param {{content: string, category?: string, tags?: string[], embedding?: number[]|Float32Array}} data
 * @returns {Promise<object>} the created note record
 */
export async function createNote(data) {
  const db = await getDB();
  const note = {
    id: newId(),
    content: data.content,
    category: data.category ?? null,
    tags: data.tags ?? [],
    // Stored as a plain array (structured-clone friendly, JSON-exportable).
    embedding: data.embedding ? Array.from(data.embedding) : null,
    created_at: nowISO(),
    seq: nextSeq(),
  };
  await db.put('notes', note);
  return note;
}

/** @returns {Promise<object[]>} all notes, newest first */
export async function listNotes() {
  const db = await getDB();
  const all = await db.getAllFromIndex('notes', 'created_at');
  return all.sort((a, b) => b.seq - a.seq);
}

export async function getNote(id) {
  const db = await getDB();
  return (await db.get('notes', id)) ?? null;
}

export async function deleteNote(id) {
  const db = await getDB();
  await db.delete('notes', id);
  return true;
}

export async function deleteAllNotes() {
  const db = await getDB();
  await db.clear('notes');
  return true;
}

// ---------------------------------------------------------------- chats ---

/** @param {{title?: string}} [data] */
export async function createChat(data = {}) {
  const db = await getDB();
  const ts = nowISO();
  const chat = {
    id: newId(),
    title: data.title ?? 'New chat',
    created_at: ts,
    updated_at: ts,
  };
  await db.put('chats', chat);
  return chat;
}

/** @returns {Promise<object[]>} all chats, most recently updated first */
export async function listChats() {
  const db = await getDB();
  const all = await db.getAllFromIndex('chats', 'updated_at');
  return all.reverse();
}

export async function getChat(id) {
  const db = await getDB();
  return (await db.get('chats', id)) ?? null;
}

async function touchChat(db, chatId) {
  const chat = await db.get('chats', chatId);
  if (chat) {
    chat.updated_at = nowISO();
    await db.put('chats', chat);
  }
}

export async function deleteChat(id) {
  const db = await getDB();
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  await tx.objectStore('chats').delete(id);
  const msgIndex = tx.objectStore('messages').index('chat_id');
  let cursor = await msgIndex.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  return true;
}

/** The "reset memory" action: wipes every chat and every message. */
export async function clearAllChats() {
  const db = await getDB();
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  await tx.objectStore('chats').clear();
  await tx.objectStore('messages').clear();
  await tx.done;
  return true;
}

// ------------------------------------------------------------- messages ---

/**
 * @param {{chat_id: string, role: 'note'|'question'|'answer', content: string,
 *           category?: string, tags?: string[]}} data
 */
export async function addMessage(data) {
  const db = await getDB();
  const message = {
    id: newId(),
    chat_id: data.chat_id,
    role: data.role,
    content: data.content,
    category: data.category ?? null,
    tags: data.tags ?? [],
    created_at: nowISO(),
    seq: nextSeq(),
  };
  await db.put('messages', message);
  await touchChat(db, data.chat_id);
  return message;
}

/** @returns {Promise<object[]>} messages for a chat, oldest first */
export async function getChatMessages(chatId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('messages', 'chat_id', IDBKeyRange.only(chatId));
  return all.sort((a, b) => a.seq - b.seq);
}

// ------------------------------------------------------------- storage ---

/**
 * Best-effort storage usage estimate for the Settings panel.
 * Falls back to nulls where the StorageManager API is unavailable
 * (e.g. Safari private mode, or an older browser).
 */
export async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return {
        usageBytes: usage ?? null,
        quotaBytes: quota ?? null,
        usageMB: usage != null ? +(usage / (1024 * 1024)).toFixed(2) : null,
        quotaMB: quota != null ? +(quota / (1024 * 1024)).toFixed(2) : null,
        supported: true,
      };
    } catch {
      // fall through to unsupported shape below
    }
  }
  return { usageBytes: null, quotaBytes: null, usageMB: null, quotaMB: null, supported: false };
}
