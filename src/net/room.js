import { Peer } from 'peerjs';

/**
 * Zeropoint Room Network Layer
 * -----------------------------
 * A serverless peer discovery + messaging layer.
 *
 * Strategy:
 *   1. Every client gets a random Peer ID.
 *   2. For each "room" (= place) we have a deterministic directory peer ID
 *      `zpnt-<roomId>-hub-<shard>` where <shard> cycles through 0..N.
 *      The first client to join a shard *becomes* the hub for it (i.e.
 *      it registers with that id). Later clients connect to the hub and
 *      are introduced to all other peers.
 *   3. If the hub ID is already taken, we simply connect to it.
 *      If nobody answers a shard within 2s, we take over that shard.
 *   4. All peer-to-peer traffic (position, chat, emote, presence) is
 *      broadcast over a simple mesh once peers are connected.
 *
 * This uses PeerJS's free public broker (0.peerjs.com) which handles
 * WebRTC signaling only — no message content passes through it.
 *
 * In addition, a BroadcastChannel is used so that multiple tabs in the
 * SAME browser immediately see each other (useful for demo & dev).
 */

const SHARD_COUNT = 4;        // max 4 independent hubs per place
const HUB_TIMEOUT_MS = 2500;
const HEARTBEAT_MS = 4000;
const STALE_MS = 12000;

function hubId(roomId, shard) {
  return `zpnt-${roomId}-hub-${shard}`;
}

export class ZeroRoom extends EventTarget {
  constructor({ roomId, self }) {
    super();
    this.roomId = roomId;
    this.self = self; // { id, name, color }
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.knownPeers = new Map();  // peerId -> { id, name, color, lastSeen }
    this.isHub = false;
    this.hubShard = null;
    this._heartbeatTimer = null;

    this.bc = (typeof BroadcastChannel !== 'undefined')
      ? new BroadcastChannel(`zeropoint:${roomId}`)
      : null;
    if (this.bc) {
      this.bc.onmessage = (ev) => this._onBroadcast(ev.data);
    }
  }

  async start() {
    await this._initPeer();
    await this._joinRoom();
    this._startHeartbeat();
    if (this.bc) {
      this._broadcast({ t: 'hello', peer: this._selfPayload() });
    }
  }

  stop() {
    clearInterval(this._heartbeatTimer);
    if (this.bc) {
      this._broadcast({ t: 'bye', id: this.self.id });
      this.bc.close();
    }
    this.connections.forEach((c) => { try { c.close(); } catch {} });
    this.connections.clear();
    if (this.peer) { try { this.peer.destroy(); } catch {} }
    this.peer = null;
  }

  /* ---------------- Peer setup ---------------- */
  _initPeer() {
    return new Promise((resolve, reject) => {
      // Use PeerJS public broker
      const peer = new Peer(this.self.id, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });
      const to = setTimeout(() => {
        // still resolve — we'll fall back to BroadcastChannel-only
        resolve();
      }, 6000);
      peer.on('open', () => {
        clearTimeout(to);
        this.peer = peer;
        peer.on('connection', (conn) => this._wireIncoming(conn));
        resolve();
      });
      peer.on('error', (err) => {
        // e.g. id-taken — treated as "not hub"
        // or network error — we continue with what we have
        clearTimeout(to);
        if (!this.peer) resolve();
      });
    });
  }

  async _joinRoom() {
    if (!this.peer) return;

    // Try to find a hub. If we find one, connect. If none answers, claim
    // the first free shard ourselves and become the hub.
    let hubConn = null;
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      const id = hubId(this.roomId, shard);
      if (id === this.self.id) continue; // shouldn't happen
      const conn = await this._tryConnect(id);
      if (conn) {
        hubConn = conn;
        break;
      }
    }

    if (hubConn) {
      this._wireOutgoing(hubConn);
    } else {
      // Become a hub on shard 0 (destroy existing peer, recreate with hub id)
      await this._becomeHub(0);
    }
  }

  _tryConnect(targetId) {
    return new Promise((resolve) => {
      if (!this.peer) return resolve(null);
      let settled = false;
      const conn = this.peer.connect(targetId, { reliable: true, metadata: { from: this.self.id } });
      const to = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { conn.close(); } catch {}
          resolve(null);
        }
      }, HUB_TIMEOUT_MS);
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        resolve(conn);
      });
      conn.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        resolve(null);
      });
    });
  }

  async _becomeHub(shard) {
    // Destroy current peer and recreate with deterministic hub id
    try { this.peer.destroy(); } catch {}
    this.peer = null;

    await new Promise((resolve) => {
      const peer = new Peer(hubId(this.roomId, shard), {
        debug: 0,
        config: {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        },
      });
      const to = setTimeout(resolve, 4000);
      peer.on('open', () => {
        clearTimeout(to);
        this.peer = peer;
        this.isHub = true;
        this.hubShard = shard;
        this.self.id = peer.id; // update self id
        peer.on('connection', (conn) => this._wireIncoming(conn));
        resolve();
      });
      peer.on('error', () => {
        // Hub id taken (race). Try next shard as non-hub.
        clearTimeout(to);
        resolve();
      });
    });

    if (!this.isHub) {
      // Some other peer grabbed the hub while we were trying. Connect as peer.
      const conn = await this._tryConnect(hubId(this.roomId, shard));
      if (conn) this._wireOutgoing(conn);
    }
  }

  /* ---------------- connection wiring ---------------- */
  _wireIncoming(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      // Send roster (our known peers) so new joiner learns who's here
      this._send(conn, { t: 'hello', peer: this._selfPayload() });
      const roster = [];
      this.knownPeers.forEach((p) => roster.push(p));
      if (roster.length) this._send(conn, { t: 'roster', peers: roster });
    });
    conn.on('data', (data) => this._onMessage(conn.peer, data));
    conn.on('close', () => this._onPeerDisconnect(conn.peer));
    conn.on('error', () => this._onPeerDisconnect(conn.peer));
  }

  _wireOutgoing(conn) {
    this.connections.set(conn.peer, conn);
    this._send(conn, { t: 'hello', peer: this._selfPayload() });
    conn.on('data', (data) => this._onMessage(conn.peer, data));
    conn.on('close', () => this._onPeerDisconnect(conn.peer));
    conn.on('error', () => this._onPeerDisconnect(conn.peer));
  }

  _onPeerDisconnect(peerId) {
    this.connections.delete(peerId);
    const known = this.knownPeers.get(peerId);
    if (known) {
      this.knownPeers.delete(peerId);
      this._emit('peer-leave', { id: peerId });
    }
  }

  _onMessage(fromId, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello': {
        const p = msg.peer;
        if (p && p.id !== this.self.id) {
          this.knownPeers.set(p.id, { ...p, lastSeen: Date.now() });
          this._emit('peer-join', p);
          // If we're the hub, introduce this peer to everyone else
          if (this.isHub) this._relayExcept(fromId, { t: 'introduce', peer: p });
        }
        break;
      }
      case 'roster': {
        if (Array.isArray(msg.peers)) {
          msg.peers.forEach((p) => {
            if (p.id === this.self.id) return;
            if (!this.knownPeers.has(p.id)) {
              this.knownPeers.set(p.id, { ...p, lastSeen: Date.now() });
              this._emit('peer-join', p);
              // Attempt direct connection in background
              this._connectDirect(p.id);
            }
          });
        }
        break;
      }
      case 'introduce': {
        const p = msg.peer;
        if (p && p.id !== this.self.id && !this.connections.has(p.id)) {
          this._connectDirect(p.id);
        }
        break;
      }
      case 'pos':
      case 'chat':
      case 'emote':
      case 'ping': {
        const peer = this.knownPeers.get(fromId);
        if (peer) peer.lastSeen = Date.now();
        this._emit(msg.t, { id: fromId, ...msg });
        if (this.isHub) this._relayExcept(fromId, msg);
        break;
      }
    }
  }

  _connectDirect(peerId) {
    if (!this.peer || this.connections.has(peerId) || peerId === this.self.id) return;
    const conn = this.peer.connect(peerId, { reliable: true, metadata: { from: this.self.id } });
    let opened = false;
    conn.on('open', () => { opened = true; this._wireOutgoing(conn); });
    setTimeout(() => { if (!opened) { try { conn.close(); } catch {} } }, 4000);
  }

  _relayExcept(exceptId, msg) {
    this.connections.forEach((conn, id) => {
      if (id === exceptId) return;
      this._send(conn, msg);
    });
  }

  _send(conn, msg) {
    try { conn.send(msg); } catch {}
  }

  /* ---------------- public send ---------------- */
  sendPosition(x, z, yaw) {
    const msg = { t: 'pos', x, z, yaw };
    this.connections.forEach((c) => this._send(c, msg));
    this._broadcast({ ...msg, from: this.self.id });
  }
  sendChat(text) {
    const msg = { t: 'chat', text: (text || '').slice(0, 140) };
    this.connections.forEach((c) => this._send(c, msg));
    this._broadcast({ ...msg, from: this.self.id });
  }
  sendEmote(emote) {
    const msg = { t: 'emote', e: emote };
    this.connections.forEach((c) => this._send(c, msg));
    this._broadcast({ ...msg, from: this.self.id });
  }

  /* ---------------- broadcast channel (same browser) ---------------- */
  _broadcast(payload) {
    if (!this.bc) return;
    try { this.bc.postMessage(payload); } catch {}
  }
  _onBroadcast(data) {
    if (!data || data.from === this.self.id) return;
    switch (data.t) {
      case 'hello': {
        const p = data.peer;
        if (!p || p.id === this.self.id) return;
        if (!this.knownPeers.has(p.id)) {
          this.knownPeers.set(p.id, { ...p, lastSeen: Date.now() });
          this._emit('peer-join', p);
        }
        // Respond so they learn about us (same tab context)
        this._broadcast({ t: 'welcome', peer: this._selfPayload(), to: p.id });
        break;
      }
      case 'welcome': {
        if (data.to !== this.self.id) return;
        const p = data.peer;
        if (!p || p.id === this.self.id) return;
        if (!this.knownPeers.has(p.id)) {
          this.knownPeers.set(p.id, { ...p, lastSeen: Date.now() });
          this._emit('peer-join', p);
        }
        break;
      }
      case 'bye': {
        this._onPeerDisconnect(data.id);
        break;
      }
      case 'pos':
      case 'chat':
      case 'emote': {
        const fromId = data.from;
        if (!fromId || fromId === this.self.id) return;
        if (!this.knownPeers.has(fromId)) return; // need hello first
        this.knownPeers.get(fromId).lastSeen = Date.now();
        this._emit(data.t, { id: fromId, ...data });
        break;
      }
    }
  }

  /* ---------------- heartbeat + cleanup ---------------- */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      // Prune stale peers
      const now = Date.now();
      this.knownPeers.forEach((p, id) => {
        if (now - p.lastSeen > STALE_MS) {
          this.knownPeers.delete(id);
          this._emit('peer-leave', { id });
        }
      });
      // Keep-alive
      this.connections.forEach((c) => this._send(c, { t: 'ping' }));
      if (this.bc) this._broadcast({ t: 'hello', peer: this._selfPayload() });
    }, HEARTBEAT_MS);
  }

  /* ---------------- utility ---------------- */
  _selfPayload() {
    return { id: this.self.id, name: this.self.name, color: this.self.color };
  }
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  get peerCount() {
    return this.knownPeers.size;
  }
}
