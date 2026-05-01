/**
 * Pin categories. Each category has a color, emoji and label.
 * Used for filtering, marker color, and compose UI.
 */

export const CATEGORIES = [
  { id: 'all',  label: 'すべて',     emoji: '📍', color: '#ff6b9d' },
  { id: 'food', label: 'グルメ',     emoji: '🍜', color: '#ff8c42' },
  { id: 'spot', label: '穴場',       emoji: '✨', color: '#4dd0e1' },
  { id: 'warn', label: '注意',       emoji: '⚠️', color: '#ffb84d' },
  { id: 'life', label: '生活',       emoji: '🛋️', color: '#b794ff' },
  { id: 'fun',  label: 'おもしろ',   emoji: '😂', color: '#66bb6a' },
  { id: 'misc', label: 'その他',     emoji: '💬', color: '#90a4ae' },
];

export const CATS_FOR_COMPOSE = CATEGORIES.filter((c) => c.id !== 'all');

const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id) {
  return CAT_BY_ID.get(id) || CATEGORIES[0];
}

/** Suggest a category from text. Returns existing cat if none match. */
export function suggestCategory(text, fallback = 'misc') {
  const t = (text || '').toLowerCase();
  if (!t) return fallback;
  if (/食|飲|ランチ|ディナー|旨|美味|うま|まず|カレー|ラーメン|寿司|カフェ|cafe|蕎麦|ソバ|うどん|焼肉|餃子|定食|居酒屋|スイーツ/.test(t)) return 'food';
  if (/注意|危|工事|事故|渋滞|遅延|閉鎖|混雑|警察|火事|地震|警報/.test(t)) return 'warn';
  if (/遊|楽|ライブ|イベント|祭り|フェス|展示|展覧/.test(t)) return 'fun';
  if (/綺麗|景色|スポット|公園|花|桜|穴場|景観|夜景|ビュー|view|spot/.test(t)) return 'spot';
  if (/便利|スーパー|病院|生活|薬局|コンビニ|郵便|ATM|銀行|役所/.test(t)) return 'life';
  return fallback;
}
