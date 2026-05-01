/**
 * Rate limiting for Pinly.
 *
 * Persisted in localStorage so refreshes don't reset cooldowns.
 * Only applies to the local user's submissions.
 */

const KEY = 'pinly.ratelimit.v2';

const RULES = {
  // 1 post per 10s
  global:       { max: 1,  windowSec: 10 },
  // 10 posts / hour per device
  user:         { max: 10, windowSec: 3600 },
  // 3 posts / hour within 50m
  sameLocation: { max: 3,  windowSec: 3600, radiusMeters: 50 },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { posts: [] };
    const data = JSON.parse(raw);
    return data && Array.isArray(data.posts) ? data : { posts: [] };
  } catch {
    return { posts: [] };
  }
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

function prune(data, now) {
  const maxAge = Math.max(RULES.global.windowSec, RULES.user.windowSec, RULES.sameLocation.windowSec);
  data.posts = (data.posts || []).filter((p) => now - p.ts < maxAge);
  return data;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function fmtRetry(sec) {
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}分`;
  return `${Math.ceil(sec / 3600)}時間`;
}

export function checkRateLimit(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = prune(load(), now);

  // Global cooldown
  const recentGlobal = data.posts.filter((p) => now - p.ts < RULES.global.windowSec);
  if (recentGlobal.length >= RULES.global.max) {
    const wait = RULES.global.windowSec - (now - recentGlobal[recentGlobal.length - 1].ts);
    return {
      allowed: false,
      reason: `投稿が早すぎます。あと${fmtRetry(Math.max(1, wait))}お待ちください。`,
      retryAfter: wait,
    };
  }

  // Per user
  const recentUser = data.posts.filter((p) => p.userId === userId && now - p.ts < RULES.user.windowSec);
  if (recentUser.length >= RULES.user.max) {
    const wait = RULES.user.windowSec - (now - recentUser[0].ts);
    return {
      allowed: false,
      reason: `1時間あたりの投稿上限(${RULES.user.max}件)に達しました。あと${fmtRetry(Math.max(1, wait))}お待ちください。`,
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
      reason: `同じ場所への連続投稿が多すぎます。あと${fmtRetry(Math.max(1, wait))}お待ちください。`,
      retryAfter: wait,
    };
  }

  return { allowed: true };
}

export function recordPost(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  const data = prune(load(), now);
  data.posts.push({ lat, lng, userId, ts: now });
  save(data);
}

export function clearRateLimit() {
  try { localStorage.removeItem(KEY); } catch {}
}
