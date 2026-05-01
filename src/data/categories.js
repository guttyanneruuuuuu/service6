/**
 * Pin categories. Each category has a color, emoji and label.
 * Used for filtering, marker color, and compose UI.
 */

export const CATEGORIES = [
  { id: 'all',  label: 'すべて',     emoji: '📍', color: '#ff2e6d' },
  { id: 'food', label: 'グルメ',     emoji: '🍜', color: '#ff8c42' },
  { id: 'spot', label: '穴場',       emoji: '✨', color: '#7ce7ff' },
  { id: 'warn', label: '注意',       emoji: '⚠️', color: '#ffd166' },
  { id: 'life', label: '生活',       emoji: '🛋️', color: '#b794ff' },
  { id: 'fun',  label: 'おもしろ',   emoji: '😂', color: '#5dffae' },
  { id: 'misc', label: 'その他',     emoji: '💬', color: '#ff7cb0' },
];

export const CATS_FOR_COMPOSE = CATEGORIES.filter((c) => c.id !== 'all');

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}
