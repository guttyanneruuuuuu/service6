/**
 * Rate limiting for Pinly
 * 
 * Prevents spam and abuse by limiting the number of posts
 * from the same location or user within a time window.
 */

const RATE_LIMIT_STORAGE_KEY = 'pinly.ratelimit.v1';

// Configuration
const RATE_LIMITS = {
  // Same location: max 3 posts per hour
  sameLocation: {
    maxPosts: 3,
    windowSeconds: 3600,
    radiusMeters: 50,
  },
  
  // Same user: max 10 posts per hour
  sameUser: {
    maxPosts: 10,
    windowSeconds: 3600,
  },
  
  // Global: max 1 post per 30 seconds (prevent rapid-fire)
  global: {
    maxPosts: 1,
    windowSeconds: 30,
  },
};

/**
 * Get rate limit history from localStorage
 */
function getRateLimitHistory() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { posts: [] };
  } catch {
    return { posts: [] };
  }
}

/**
 * Save rate limit history to localStorage
 */
function saveRateLimitHistory(history) {
  try {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(history));
  } catch {
    console.warn('Failed to save rate limit history');
  }
}

/**
 * Clean up old entries from history
 */
function cleanupHistory(history, now) {
  const maxAge = Math.max(
    RATE_LIMITS.sameLocation.windowSeconds,
    RATE_LIMITS.sameUser.windowSeconds,
    RATE_LIMITS.global.windowSeconds
  );
  
  history.posts = history.posts.filter(post => now - post.ts < maxAge);
  return history;
}

/**
 * Calculate distance between two coordinates (simplified)
 */
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Check if user can post
 * Returns { allowed: boolean, reason: string }
 */
export function checkRateLimit(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  let history = getRateLimitHistory();
  
  // Clean up old entries
  history = cleanupHistory(history, now);
  
  // Check global rate limit
  const recentGlobal = history.posts.filter(
    p => now - p.ts < RATE_LIMITS.global.windowSeconds
  );
  if (recentGlobal.length >= RATE_LIMITS.global.maxPosts) {
    return {
      allowed: false,
      reason: '投稿が多すぎます。しばらく待ってから投稿してください。',
      retryAfter: RATE_LIMITS.global.windowSeconds - (now - recentGlobal[0].ts),
    };
  }
  
  // Check same user rate limit
  const recentUser = history.posts.filter(
    p => p.userId === userId && now - p.ts < RATE_LIMITS.sameUser.windowSeconds
  );
  if (recentUser.length >= RATE_LIMITS.sameUser.maxPosts) {
    return {
      allowed: false,
      reason: 'あなたの投稿が多すぎます。しばらく待ってから投稿してください。',
      retryAfter: RATE_LIMITS.sameUser.windowSeconds - (now - recentUser[0].ts),
    };
  }
  
  // Check same location rate limit
  const recentLocation = history.posts.filter(p => {
    const distance = getDistance(lat, lng, p.lat, p.lng);
    return distance < RATE_LIMITS.sameLocation.radiusMeters &&
      now - p.ts < RATE_LIMITS.sameLocation.windowSeconds;
  });
  if (recentLocation.length >= RATE_LIMITS.sameLocation.maxPosts) {
    return {
      allowed: false,
      reason: 'この場所への投稿が多すぎます。しばらく待ってから投稿してください。',
      retryAfter: RATE_LIMITS.sameLocation.windowSeconds - (now - recentLocation[0].ts),
    };
  }
  
  // All checks passed
  return { allowed: true };
}

/**
 * Record a post for rate limiting
 */
export function recordPost(lat, lng, userId) {
  const now = Math.floor(Date.now() / 1000);
  let history = getRateLimitHistory();
  
  history.posts.push({
    lat,
    lng,
    userId,
    ts: now,
  });
  
  // Clean up old entries
  history = cleanupHistory(history, now);
  
  saveRateLimitHistory(history);
}

/**
 * Get remaining time before user can post again (in seconds)
 */
export function getRemainingWaitTime(lat, lng, userId) {
  const check = checkRateLimit(lat, lng, userId);
  return check.retryAfter || 0;
}
