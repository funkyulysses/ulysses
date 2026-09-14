// js/classify.js
// Cheap, deterministic heuristic for routing composer input: is this a note
// to file away, or a question to answer against existing notes? Mirrors the
// heuristic from the old Flask app (no model call needed for this step).

const QUESTION_WORDS = [
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'whose',
  'is', 'are', 'was', 'were', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'will', 'may', 'might',
];

/**
 * @param {string} text
 * @returns {'question'|'note'}
 */
export function classifyInput(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'note';

  if (trimmed.endsWith('?')) return 'question';

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, '');
  if (firstWord && QUESTION_WORDS.includes(firstWord)) return 'question';

  return 'note';
}
