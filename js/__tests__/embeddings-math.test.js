// Pure-math unit tests for the embedding-similarity logic — no model
// download involved (that part is exercised live via test.html, see the
// project report for those results).
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findSimilarNotes, findLinkedNotes } from '../embeddings.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('handles a zero vector without dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('findSimilarNotes', () => {
  const query = [1, 0];
  const notes = [
    { id: 'a', embedding: [1, 0] },       // sim 1
    { id: 'b', embedding: [0.7, 0.7] },   // sim ~0.7
    { id: 'c', embedding: [0, 1] },       // sim 0
  ];

  it('ranks by similarity, highest first', () => {
    const top = findSimilarNotes(query, notes, 3, 0);
    expect(top.map((t) => t.note.id)).toEqual(['a', 'b', 'c']);
  });

  it('respects topK', () => {
    const top = findSimilarNotes(query, notes, 1, 0);
    expect(top).toHaveLength(1);
    expect(top[0].note.id).toBe('a');
  });

  it('respects minSimilarity', () => {
    const top = findSimilarNotes(query, notes, 3, 0.5);
    expect(top.map((t) => t.note.id)).toEqual(['a', 'b']);
  });

  it('skips notes with no embedding', () => {
    const top = findSimilarNotes(query, [...notes, { id: 'd' }], 10, 0);
    expect(top.find((t) => t.note.id === 'd')).toBeUndefined();
  });
});

describe('findLinkedNotes', () => {
  const pool = [
    { id: 'x', embedding: [1, 0] },
    { id: 'y', embedding: [0.9, 0.1] }, // very similar to x
    { id: 'z', embedding: [0, 1] },     // orthogonal to x
  ];

  it('links notes above the threshold and excludes self', () => {
    const links = findLinkedNotes(pool[0], pool, 0.5);
    expect(links.map((l) => l.id)).toEqual(['y']);
  });

  it('returns nothing when threshold is not cleared', () => {
    const links = findLinkedNotes(pool[0], pool, 0.999);
    expect(links).toEqual([]);
  });
});
