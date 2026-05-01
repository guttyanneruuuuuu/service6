/**
 * Rate limiting for Pinly.
 *
 * Persisted in localStorage so refreshes don't reset cooldowns.
 * Applies to the local user's posts and reports.
 *
 * NOTE: This is client-side only — a determined attacker can clear storage
 * to bypass it. For a production deployment we recommend pairing this with
 * server-side rate limiting (e.g. Supabase Edge Function + Postgres RLS).
 */

const KEY_POSTS   = 'pinly.ratelimit.v2';
const KEY_REPORTS = 'pinly.ratelimit.reports.v1';

const RULES = {
  // 1 post per 10s (anti double-tap / anti spam)
  global:       { max: 1,  windowSec: 10 },
  // 10 posts / hour per device
  user:         { max: 10, windowSec: 3600 },
  // 3 posts / hour within 50m
  sameLocation: { max: 3,  windowSec: 3600, radiusMeters: 50 },
  // 20 reports / hour per device (anti report-bombing)
  reports:      { max: 20, windowSec: 3600 },
};

function safeLoad(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { posts: [] };
    const data = JSON.parse(raw);
    return data && Array.isArray(data.posts) ? data : { posts: [] };
  } catch {
    return { posts: [] };
  }
}

function safeSave(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function prune(data, now, maxAge) {
  data.posts = (data.posts || []).filter((p) => now - p.ts < maxAge);
  return data;
}

function distanceMeters(a, b) {
  if (
    !Number.isFinite(a.lat) || !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) || !Number.isFinite(b.lng)
  ) return Infinity;
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function fmtRetry(sec) {
  const s = Math.max(1, Math.ceil(sec));
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.ceil(s / 60)}分`;
  return `${Math.ceil(s / 3600)}時間`;
}

export function checkRateLimit(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(RULES.global.windowSec, RULES.user.windowSec, RULES.sameLocation.windowSec);
  const data = prune(safeLoad(KEY_POSTS), now, maxAge);

  // Global cooldown
  const recentGlobal = data.posts.filter((p) => now - p.ts < RULES.global.windowSec);
  if (recentGlobal.length >= RULES.global.max) {
    const wait = RULES.global.windowSec - (now - recentGlobal[recentGlobal.length - 1].ts);
    return {
      allowed: false,
      reason: `投稿が早すぎます。あと${fmtRetry(wait)}お待ちください。`,
      retryAfter: wait,
    };
  }

  // Per user
  const recentUser = data.posts.filter((p) => p.userId === userId && now - p.ts < RULES.user.windowSec);
  if (recentUser.length >= RULES.user.max) {
    const wait = RULES.user.windowSec - (now - recentUser[0].ts);
    return {
      allowed: false,
      reason: `1時間あたりの投稿上限(${RULES.user.max}件)に達しました。あと${fmtRetry(wait)}お待ちください。`,
      retryAfter: wait,
    };
  }

  // Same location
  const recentLoc = data.posts.filter((p) => {
    if (now - p.ts >= RULES.sameLocation.windowSec) return false;
    const d = distanceMeters({ lat, lng }, p);
    return d < RULES.sameLocation.radiusMeters;
  });
  if (recentLoc.length >= RULES.sameLocation.max) {
    const wait = RULES.sameLocation.windowSec - (now - recentLoc[0].ts);
    return {
      allowed: false,
      reason: `同じ場所への連続投稿が多すぎます。あと${fmtRetry(wait)}お待ちください。`,
      retryAfter: wait,
    };
  }

  return { allowed: true };
}

export function recordPost(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(RULES.global.windowSec, RULES.user.windowSec, RULES.sameLocation.windowSec);
  const data = prune(safeLoad(KEY_POSTS), now, maxAge);
  data.posts.push({ lat, lng, userId, ts: now });
  // Cap stored history to last 200 entries to bound storage usage.
  if (data.posts.length > 200) data.posts = data.posts.slice(-200);
  safeSave(KEY_POSTS, data);
}

/* ---------- Reports ---------- */

export function checkReportRateLimit() {
  const now = Math.floor(Date.now() / 1000);
  const data = prune(safeLoad(KEY_REPORTS), now, RULES.reports.windowSec);
  const recent = data.posts.filter((p) => now - p.ts < RULES.reports.windowSec);
  if (recent.length >= RULES.reports.max) {
    const wait = RULES.reports.windowSec - (now - recent[0].ts);
    return {
      allowed: false,
      reason: `短時間に多くの報告が行われました。あと${fmtRetry(wait)}お待ちください。`,
      retryAfter: wait,
    };
  }
  return { allowed: true };
}

export function recordReport(pinId) {
  const now = Math.floor(Date.now() / 1000);
  const data = prune(safeLoad(KEY_REPORTS), now, RULES.reports.windowSec);
  data.posts.push({ pinId: String(pinId).slice(0, 64), ts: now });
  if (data.posts.length > 100) data.posts = data.posts.slice(-100);
  safeSave(KEY_REPORTS, data);
}

export function clearRateLimit() {
  try {
    localStorage.removeItem(KEY_POSTS);
    localStorage.removeItem(KEY_REPORTS);
  } catch {}
}
