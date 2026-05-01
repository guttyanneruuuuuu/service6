/**
 * Lightweight content moderation for Pinly.
 *
 * Strategy:
 *   - Reject clearly harmful posts (violence, severe slurs, explicit personal info, spam patterns).
 *   - Warn users on borderline content but allow them to confirm.
 *   - Avoid false-positives on common conversational speech.
 *
 * Fully client-side. A production deployment should also use a server-side
 * ML moderation pipeline (e.g. OpenAI moderation, Perspective API).
 *
 * NOTE: All inputs are normalized (lower-cased, NFKC) before pattern matching
 * to defeat trivial bypass attempts using full-width or alt-case characters.
 */

// ----- Severe (immediate reject) -----
const SEVERE_PATTERNS = [
  /(死ね|殺す|消えろ|殺害|自殺しろ|首吊れ|爆破予告|テロ予告|爆破して|放火)/i,
  /\bkill\s+(you|him|her|them|yourself)\b/i,
  /(レイプ|強姦|児童ポルノ|児ポ|性的虐待)/i,
  /(の家|の住所|の自宅).*(教え|住んで|住所|晒|さらせ)/i,
  /(晒し上げ|個人特定|身バレ).*(する|しろ|やる)/i,
];

// ----- Warning (prompt user) -----
const WARNING_PATTERNS = [
  /(ふざけんな|うざい|きもい|きしょい|うっとうしい)/i,
  /(差別|蔑視|ヘイト)/i,
  /(エロ|ポルノ|18禁|アダルト|セックス|ヌード)/i,
  /(投資|仮想通貨|ビットコイン|暗号資産).*(儲|稼|必勝|無料配布)/i,
  /(LINE\s*ID|追加してね|DMで|フォロバ100|プロフ見て|プロフ確認)/i,
  /(\$|¥|円).{0,8}(送金|振込|稼げ|儲か)/i,
];

// ----- Personal info (immediate reject) -----
const PERSONAL_INFO_PATTERNS = [
  // Phone-like with hyphens (3-4-4 / 2-4-4 etc.) — but not pure dates
  /\b0[\d]{1,4}[\s-][\d]{1,4}[\s-][\d]{3,4}\b/,
  // Mobile JP without separators
  /\b0[789]0\d{8}\b/,
  // Email
  /[a-z0-9._+-]+@[a-z0-9-]+\.[a-z0-9.-]+/i,
  // Postal code 〒xxx-xxxx
  /〒\s*\d{3}-\d{4}/,
  // Long digit sequence (CC-like)
  /\b\d{14,19}\b/,
];

// ----- Spam heuristics -----
function isMostlyRepeated(text) {
  const t = text.replace(/\s+/g, '');
  if (t.length < 6) return false;
  const counts = {};
  for (const ch of t) counts[ch] = (counts[ch] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  return max / t.length > 0.65;
}

function looksLikeUrlSpam(text) {
  const urls = (text.match(/https?:\/\/\S+/gi) || []).length;
  return urls >= 1 || /bit\.ly|t\.co|tinyurl|goo\.gl|is\.gd|ow\.ly/i.test(text);
}

/** Normalize for matching: NFKC + lower-case, strip zero-width chars. */
function normalize(text) {
  if (!text) return '';
  let t = String(text);
  try { t = t.normalize('NFKC'); } catch {}
  // strip zero-width characters often used to obfuscate
  t = t.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
  return t.toLowerCase();
}

/**
 * Returns a verdict object.
 *   - status: 'approved' | 'warning' | 'rejected'
 *   - reasons: string[] (machine-readable)
 *   - message: human-friendly reason
 */
export function getModerationVerdict(rawText) {
  const reasons = [];

  if (rawText == null || typeof rawText !== 'string') {
    return { status: 'rejected', reasons: ['empty'], message: '本文を入力してください。' };
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) return { status: 'rejected', reasons: ['empty'], message: '本文を入力してください。' };
  if (trimmed.length > 50) return { status: 'rejected', reasons: ['too_long'], message: '50字以内で入力してください。' };

  // Reject control characters (allow basic whitespace/newlines).
  // U+0000-U+001F except \t \n \r are control. Also disallow \u2028/\u2029 line separators.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/.test(trimmed)) {
    return { status: 'rejected', reasons: ['control_chars'], message: '🚫 利用できない制御文字が含まれています。' };
  }

  const t = normalize(trimmed);

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
  if (PERSONAL_INFO_PATTERNS.some((p) => p.test(t))) {
    return {
      status: 'rejected',
      reasons: ['personal_info'],
      message: '🚫 電話番号・メール・住所などの個人情報は投稿できません。',
    };
  }

  // URL spam -> reject
  if (looksLikeUrlSpam(t)) {
    return {
      status: 'rejected',
      reasons: ['url_spam'],
      message: '🚫 URL や短縮URL を含む投稿はできません。',
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
  const t = normalize(text);
  return PERSONAL_INFO_PATTERNS.some((p) => p.test(t));
}

/**
 * HTML escape. Used when we ever interpolate user text into innerHTML.
 * The app prefers `textContent` whenever possible; this is a defense-in-depth
 * for cases where HTML-construction is unavoidable.
 */
export function sanitizeText(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/* Backward-compat exports. */
export function analyzeText(text) {
  const v = getModerationVerdict(text);
  if (v.status === 'rejected') return 1;
  if (v.status === 'warning')  return 0.5;
  return 0;
}
