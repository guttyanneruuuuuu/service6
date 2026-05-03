/**
 * Pinly Authentication module
 * ===========================
 *
 * Wraps Supabase Auth so the rest of the app talks to a single, predictable
 * surface. Provides three login modes — in priority order:
 *
 *   1. Email "magic link" (OTP)         — strongest identity, persists across devices
 *   2. Anonymous Supabase auth          — gets a real `auth.uid()` for RLS
 *      (no PII stored, just a UUID)
 *   3. Local-only device id (`u_xxxx`)  — fully offline fallback, no server identity
 *
 * Design goals
 * ------------
 *  - **Security first**: real users are tied to `auth.uid()`. RLS lets each
 *    user only modify their own pins. We never trust client-claimed authors.
 *  - **Privacy first**: anonymous mode is the default. We never collect names,
 *    profiles, or contacts. Email is opt-in and used only for sign-in OTPs.
 *  - **Offline first**: the app stays usable even when Supabase is down — we
 *    fall back to the local device id `u_xxxx`.
 *  - **No secrets in JS**: only the *publishable* anon key is exposed
 *    (Supabase explicitly designs this key for browser use). All write
 *    authorization is enforced server-side by RLS.
 *
 * Public API
 * ----------
 *   const auth = new PinlyAuth(supabaseClient);
 *   await auth.init();
 *   auth.user        // { id, email?, isAnonymous, isLocalOnly }
 *   auth.onChange(cb)
 *   await auth.signInAnonymously()
 *   await auth.signInWithEmail(email)   // sends magic link
 *   await auth.signOut()
 */

const LS_LOCAL_ID = 'pinly.self.v1';
const LS_PROFILE = 'pinly.profile.v1';
const ID_RE = /^u_[a-zA-Z0-9_-]{4,32}$/;

/* eslint-disable no-empty */

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

/** Generate a stable random local-only id, shaped to fit the RLS regex. */
function generateLocalId() {
  const rand = (crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14));
  return 'u_' + rand;
}

/** Load (or create) the local-only device id. Used as the offline fallback. */
function loadOrCreateLocalId() {
  let parsed = null;
  try { parsed = JSON.parse(safeGet(LS_LOCAL_ID) || 'null'); } catch {}
  if (parsed && typeof parsed.id === 'string' && ID_RE.test(parsed.id)) {
    return parsed.id;
  }
  const id = generateLocalId();
  safeSet(LS_LOCAL_ID, JSON.stringify({ id, joinedAt: Date.now() }));
  return id;
}

/** Display-friendly trimmed email, never the full one in UI by default. */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at < 1) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = name.length <= 2 ? name[0] : (name[0] + '***' + name.slice(-1));
  return `${visible}@${domain}`;
}

/** Lightweight email shape check. We never log the actual value. */
function isPlausibleEmail(s) {
  if (typeof s !== 'string') return false;
  const e = s.trim();
  if (e.length < 5 || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export class PinlyAuth extends EventTarget {
  /** @param {import('@supabase/supabase-js').SupabaseClient | null} client */
  constructor(client) {
    super();
    this.client = client || null;
    /** @type {{id:string,email?:string,isAnonymous:boolean,isLocalOnly:boolean,displayName:string}} */
    this.user = {
      id: loadOrCreateLocalId(),
      email: undefined,
      isAnonymous: true,
      isLocalOnly: true,
      displayName: '匿名さん',
    };
    this._unsubAuth = null;
  }

  /** Bootstrap. Restores existing Supabase session if any; otherwise stays in
   *  local-only mode until the user explicitly signs in. */
  async init() {
    if (!this.client) return this.user;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) {
        console.warn('[PinlyAuth] getSession error:', error.message);
      }
      const session = data && data.session;
      if (session && session.user) {
        this._applySession(session);
      }
      const sub = this.client.auth.onAuthStateChange((event, sess) => {
        if (sess && sess.user) this._applySession(sess);
        else this._applyLocalOnly();
        this._emitChange(event);
      });
      this._unsubAuth = sub && sub.data && sub.data.subscription;
    } catch (err) {
      console.warn('[PinlyAuth] init failed:', err);
    }
    return this.user;
  }

  _applySession(session) {
    const u = session.user;
    const email = (u.email && typeof u.email === 'string') ? u.email : undefined;
    // Supabase anonymous sessions have is_anonymous: true
    const isAnon = !!u.is_anonymous;
    const profile = this._readProfile();
    this.user = {
      id: u.id,                           // real auth.uid() — used for RLS
      email,
      isAnonymous: isAnon,
      isLocalOnly: false,
      displayName: profile.displayName || (isAnon ? '匿名さん' : (email ? maskEmail(email) : 'あなた')),
    };
  }

  _applyLocalOnly() {
    this.user = {
      id: loadOrCreateLocalId(),
      email: undefined,
      isAnonymous: true,
      isLocalOnly: true,
      displayName: this._readProfile().displayName || '匿名さん',
    };
  }

  /* ---------- profile (display name only — no PII) ---------- */
  _readProfile() {
    try {
      const raw = JSON.parse(safeGet(LS_PROFILE) || '{}');
      if (raw && typeof raw === 'object') return raw;
    } catch {}
    return {};
  }
  setDisplayName(name) {
    const safe = String(name || '').trim().slice(0, 24);
    if (!safe) return;
    const profile = this._readProfile();
    profile.displayName = safe;
    safeSet(LS_PROFILE, JSON.stringify(profile));
    this.user.displayName = safe;
    this._emitChange('profile_updated');
  }

  /* ---------- sign in flows ---------- */

  /** Sign in anonymously via Supabase. Gets a real `auth.uid()` so RLS works
   *  but we never collect any PII. */
  async signInAnonymously() {
    if (!this.client) {
      // No backend — just keep local-only mode.
      this._applyLocalOnly();
      this._emitChange('signed_in_local');
      return this.user;
    }
    try {
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw error;
      if (data && data.session) this._applySession(data.session);
      this._emitChange('signed_in_anonymous');
      return this.user;
    } catch (err) {
      console.warn('[PinlyAuth] anonymous sign-in failed:', err && err.message);
      // Stay local-only on failure (graceful degradation)
      this._applyLocalOnly();
      this._emitChange('signed_in_local');
      throw err;
    }
  }

  /** Send a magic-link email to sign in.
   *  Returns { ok: boolean, message: string }. We don't log the email value. */
  async signInWithEmail(email) {
    if (!this.client) {
      return { ok: false, message: 'サーバに接続できないためメール認証は使えません。' };
    }
    if (!isPlausibleEmail(email)) {
      return { ok: false, message: 'メールアドレスの形式が正しくありません。' };
    }
    try {
      const redirectTo = (typeof location !== 'undefined') ? location.href.split('?')[0] : undefined;
      const { error } = await this.client.auth.signInWithOtp({
        email: String(email).trim(),
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      return { ok: true, message: 'メールを送信しました。受信箱のリンクをクリックしてサインインを完了してください。' };
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'メール送信に失敗しました。';
      return { ok: false, message: msg };
    }
  }

  async signOut() {
    if (this.client) {
      try { await this.client.auth.signOut(); } catch {}
    }
    this._applyLocalOnly();
    this._emitChange('signed_out');
  }

  /* ---------- events ---------- */

  /** Subscribe to user changes. Returns an unsubscribe fn. */
  onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (e) => cb(this.user, e.detail || {});
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }
  _emitChange(event) {
    this.dispatchEvent(new CustomEvent('change', { detail: { event } }));
  }

  destroy() {
    if (this._unsubAuth) {
      try { this._unsubAuth.unsubscribe(); } catch {}
      this._unsubAuth = null;
    }
  }
}
