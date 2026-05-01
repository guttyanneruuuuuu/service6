/**
 * Simple content moderation for Pinly
 * 
 * This module provides basic text analysis to detect potentially harmful content.
 * It uses pattern matching and keyword detection.
 */

// List of prohibited keywords and patterns
const PROHIBITED_PATTERNS = [
  // Hate speech and discrimination
  /差別|偏見|嫌い|クズ|ゴミ|死ね|消えろ|殺す/gi,
  
  // Personal attacks
  /お前|てめえ|バカ|アホ|馬鹿|阿呆/gi,
  
  // Spam indicators
  /\$|¥|€|ビットコイン|仮想通貨|投資|儲ける|稼ぐ/gi,
  
  // Explicit content
  /エロ|ポルノ|18禁|アダルト/gi,
];

// Keywords that might indicate personal information
const PERSONAL_INFO_PATTERNS = [
  /\d{3}-\d{4}-\d{4}/, // Phone number
  /\d{3}-\d{2}-\d{4}/, // SSN-like
  /[\w\.-]+@[\w\.-]+\.\w+/, // Email
  /〒\d{3}-\d{4}/, // Postal code
];

/**
 * Analyze text for potentially harmful content
 * Returns a score from 0 (safe) to 1 (harmful)
 */
export function analyzeText(text) {
  if (!text || typeof text !== 'string') return 0;
  
  let score = 0;
  
  // Check for prohibited patterns
  for (const pattern of PROHIBITED_PATTERNS) {
    if (pattern.test(text)) {
      score += 0.3;
    }
  }
  
  // Check for personal information
  for (const pattern of PERSONAL_INFO_PATTERNS) {
    if (pattern.test(text)) {
      score += 0.2;
    }
  }
  
  // Check for excessive repetition (spam indicator)
  const words = text.split(/\s+/);
  if (words.length > 0) {
    const uniqueWords = new Set(words);
    const repetitionRatio = 1 - (uniqueWords.size / words.length);
    if (repetitionRatio > 0.7) {
      score += 0.2;
    }
  }
  
  // Check for excessive punctuation
  const punctuationCount = (text.match(/[!?！？]/g) || []).length;
  if (punctuationCount > text.length * 0.2) {
    score += 0.1;
  }
  
  // Normalize score to 0-1 range
  return Math.min(score, 1);
}

/**
 * Get moderation verdict
 */
export function getModerationVerdict(text) {
  const score = analyzeText(text);
  
  if (score < 0.3) {
    return { status: 'approved', score, message: '' };
  } else if (score < 0.6) {
    return { 
      status: 'warning', 
      score, 
      message: '⚠️ この投稿は不適切な可能性があります。内容を確認してください。' 
    };
  } else {
    return { 
      status: 'rejected', 
      score, 
      message: '❌ この投稿は不適切なコンテンツを含んでいるため、投稿できません。' 
    };
  }
}

/**
 * Sanitize text for display
 */
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Remove potentially harmful HTML/script
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check if text contains personal information
 */
export function containsPersonalInfo(text) {
  if (!text || typeof text !== 'string') return false;
  
  for (const pattern of PERSONAL_INFO_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}
