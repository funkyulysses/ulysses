import { describe, it, expect } from 'vitest';
import { classifyInput } from '../classify.js';

describe('classifyInput', () => {
  const cases = [
    ['Remember to buy milk tomorrow.', 'note'],
    ['What time is the meeting?', 'question'],
    ['How do I reset my password', 'question'],
    ['Is the store open on Sunday', 'question'],
    ['The quarterly report is due Friday.', 'note'],
    ['Why does this keep happening?', 'question'],
    ['Meeting notes from today: discussed roadmap.', 'note'],
    ['Can you believe it?', 'question'],
    ['', 'note'],
    ['   ', 'note'],
  ];

  for (const [text, expected] of cases) {
    it(`"${text}" -> ${expected}`, () => {
      expect(classifyInput(text)).toBe(expected);
    });
  }
});
