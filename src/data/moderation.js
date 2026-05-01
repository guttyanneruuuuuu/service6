/**
 * Lightweight content moderation for Pinly.
 *
 * Goals:
 *   - Block clearly harmful posts (violence, slurs, explicit personal info).
 *   - Warn users on borderline content but allow them to confirm.
 *   - Avoid false-positives on common conversational speech ("お腹すいた" など).
 *
 * Fully client-side. Real production should use server-side ML moderation.
 */

// Severe (immediate reject)
const SEVERE_PATTERNS = [
  /(死ね|殺す|消えろ|殺害|自殺しろ|首吊れ|爆破|テロ)/i,
  /\b(kill\s+(you|him|her|them))\b/i,
  /(レイプ|強姦|児童ポルノ|児ポ)/i,
  /(〇〇さん死|の家|の住所).*(教え|住んで|住所)/i,
];

// Warning level (prompt user)
const WARNING_PATTERNS = [
  /(クソ|くそ|ふざけ|うざ|きも|きしょ)/i,
  /(差別|蔑視|ヘイト)/i,
  /(エロ|ポルノ|18禁|アダルト|セックス)/i,
  /(投資|仮想通貨|ビットコイン|暗号資産).*(儲|稼|必勝|無料)/i,
  /(LINE\s*ID|追加してね|DMで|フォロバ100)/i,
  /(\$|¥|円).{0,8}(送金|振込|稼げ|儲)/i,
];

// Personal information detection
const PERSONAL_INFO_PATTERNS = [
  /\b\d{2,4}-\d{2,4}-\d{3,4}\b/, // phone-like
  /\b0[78]0[\s-]?\d{4}[\s-]?\d{4}\b/, // mobile JP
  /[\w.+-]+@[\w-]+\.[\w.-]+/i, // email
  /〒?\s*\d{3}-\d{4}/, // postal code
  /\b\d{16}\b/, // long digit sequences (cc-like)
];

// Spam heuristic helpers
function isMostlyRepeated(text) {
  const t = text.replace(/\s+/g, '');
  if (t.length < 6) return false;
  // single character repeated >= 60%
  const counts = {};
  for (const ch of t) counts[ch] = (counts[ch] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  return max / t.length > 0.6;
}

function looksLikeUrlSpam(text) {
  const urls = (text.match(/https?:\/\/\S+/gi) || []).length;
  return urls >= 2 || /bit\.ly|t\.co|tinyurl|goo\.gl/i.test(text);
}

/**
 * Returns a verdict object.
 *   - status: 'approved' | 'warning' | 'rejected'
 *   - reasons: string[] (machine-readable)
 *   - message: human-friendly reason
 */
export function getModerationVerdict(text) {
  const reasons = [];
  if (!text || typeof text !== 'string') {
    return { status: 'rejected', reasons: ['empty'], message: '本文を入力してください。' };
  }
  const t = text.trim();
  if (t.length === 0) return { status: 'rejected', reasons: ['empty'], message: '本文を入力してください。' };
  if (t.length > 50) return { status: 'rejected', reasons: ['too_long'], message: '50字以内で入力してください。' };

  // Severe -> reject
  for (const p of SEVERE_PATTERNS) {
    if (p.test(t)) {
      return {
        status: 'rejected',
        reasons: ['severe'],
        message: '🚫 暴力的・脅迫的な内容は投稿できません。',
      };
    }
  }

  // Personal info -> reject
  if (containsPersonalInfo(t)) {
    return {
      status: 'rejected',
      reasons: ['personal_info'],
      message: '🚫 電話番号・メールアドレス・住所などの個人情報は投稿できません。',
    };
  }

  // URL spam -> reject
  if (looksLikeUrlSpam(t)) {
    return {
      status: 'rejected',
      reasons: ['url_spam'],
      message: '🚫 短縮URL や複数のURL を含む投稿はできません。',
    };
  }

  // Repeat spam -> reject
  if (isMostlyRepeated(t)) {
    return {
      status: 'rejected',
      reasons: ['repeat_spam'],
      message: '🚫 同じ文字の繰り返しは投稿できません。',
    };
  }

  // Warning patterns -> warn
  for (const p of WARNING_PATTERNS) {
    if (p.test(t)) {
      reasons.push('warn');
      return {
        status: 'warning',
        reasons,
        message: '⚠️ 不適切な可能性のある言葉が含まれています。本当に投稿しますか？',
      };
    }
  }

  return { status: 'approved', reasons: [], message: '' };
}

export function containsPersonalInfo(text) {
  if (!text) return false;
  return PERSONAL_INFO_PATTERNS.some((p) => p.test(text));
}

/**
 * HTML escape. main.js uses this when rendering arbitrary user text.
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/* Backward-compat exports (kept for potential external use). */
export function analyzeText(text) {
  const v = getModerationVerdict(text);
  if (v.status === 'rejected') return 1;
  if (v.status === 'warning')  return 0.5;
  return 0;
}
