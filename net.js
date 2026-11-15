// Fly Hunt multiplayer transport: WebRTC data channels via PeerJS (free public broker, star topology, host relays)
import { Peer } from 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';

const PREFIX = 'flyhunt-hh26-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const makeCode = (n = 5) => Array.from({ length: n }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
export const cleanCode = (s) => (s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
const ICE = { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };

export class Net {
  constructor(h) { this.h = h; this.peer = null; this.conns = new Map(); this.hostConn = null; this.isHost = false; this.code = null; this.closed = false; }

  // ---- host ----
  host(code) {
    return new Promise((resolve, reject) => {
      let opened = false;
      const p = new Peer(PREFIX + code, { debug: 1, ...ICE });
      this.peer = p; this.isHost = true; this.code = code;
      p.on('open', () => { opened = true; resolve(code); });
      p.on('error', (e) => { if (!opened) { p.destroy(); reject(e); } else this.h.onError && this.h.onError(e); });
      p.on('disconnected', () => { if (!p.destroyed && !this.closed) setTimeout(() => { try { p.reconnect(); } catch (e) {} }, 1000); });
      p.on('connection', (c) => {
        this.attempts = (this.attempts || 0) + 1;
        c.on('open', () => { this.conns.set(c.peer, c); this.h.onConn && this.h.onConn(c.peer); });
        c.on('data', (d) => this.h.onData && this.h.onData(d, c.peer));
        c.on('close', () => { if (this.conns.get(c.peer) === c) { this.conns.delete(c.peer); this.h.onClose && this.h.onClose(c.peer); } });
        c.on('error', () => {});
      });
    });
  }
  sendTo(pid, msg) { const c = this.conns.get(pid); if (c && c.open) try { c.send(msg); } catch (e) {} }
  broadcast(msg, except) { for (const [pid, c] of this.conns) if (pid !== except && c.open) try { c.send(msg); } catch (e) {} }

  // ---- client ----
  join(code) {
    this.code = code; this.isHost = false;
    return new Promise((resolve, reject) => {
      const start = () => this._connect().then(resolve, reject);
      if (this.peer && !this.peer.destroyed) { if (this.peer.disconnected) this.peer.reconnect(); start(); return; }
      const p = new Peer({ debug: 1, ...ICE }); this.peer = p;
      p.on('open', start);
      p.on('error', (e) => { if (this._pending) { const r = this._pending; this._pending = null; r(e); } else this.h.onError && this.h.onError(e); });
      p.on('disconnected', () => { if (!p.destroyed && !this.closed) setTimeout(() => { try { p.reconnect(); } catch (e) {} }, 1000); });
    });
  }
  _connect() {
    return new Promise((resolve, reject) => {
      const c = this.peer.connect(PREFIX + this.code, { reliable: true });
      let done = false;
      const fail = (e) => { if (done) return; done = true; this._pending = null; try { c.close(); } catch (x) {} reject(e || new Error('timeout')); };
      this._pending = fail;
      const to = setTimeout(() => fail(new Error('timeout')), 12000);
      c.on('open', () => { if (done) return; done = true; clearTimeout(to); this._pending = null; this.hostConn = c; resolve(); });
      c.on('data', (d) => this.h.onData && this.h.onData(d, 'host'));
      c.on('close', () => { if (this.hostConn === c) { this.hostConn = null; if (!this.closed) this.h.onHostClose && this.h.onHostClose(); } });
      c.on('error', () => {});
    });
  }
  reconnect() { return this.join(this.code); }
  send(msg) { if (this.hostConn && this.hostConn.open) try { this.hostConn.send(msg); } catch (e) {} }
  get connected() { return this.isHost ? !!(this.peer && this.peer.open) : !!(this.hostConn && this.hostConn.open); }

  close() { this.closed = true; try { for (const c of this.conns.values()) c.close(); if (this.hostConn) this.hostConn.close(); this.peer && this.peer.destroy(); } catch (e) {} }
}

// Same-browser transport (two tabs) for testing the game protocol without WebRTC: add &net=local to the URL.
export class LocalNet {
  constructor(h) { this.h = h; this.id = Math.random().toString(36).slice(2, 10); this.conns = new Map(); this.isHost = false; this.code = null; this.closed = false; this.hostOk = false;
    addEventListener('pagehide', () => this.close()); }
  _open(code) { this.code = code; if (this.ch) this.ch.close(); this.ch = new BroadcastChannel('flyhunt-local-' + code); this.ch.onmessage = (e) => this._on(e.data); }
  _post(m) { if (this.ch) this.ch.postMessage({ ...m, from: this.id }); }
  host(code) { this.isHost = true; this._open(code); return Promise.resolve(code); }
  join(code) { this.isHost = false; this._open(code); return new Promise((res, rej) => { this._acc = res; this._post({ type: 'conn' }); setTimeout(() => { if (this._acc) { this._acc = null; rej(new Error('timeout')); } }, 3000); }); }
  reconnect() { return this.join(this.code); }
  _on(m) {
    if (this.closed) return;
    if (this.isHost) {
      if (m.type === 'conn') { this.conns.set(m.from, true); this._post({ type: 'accept', to: m.from }); this.h.onConn && this.h.onConn(m.from); }
      else if (m.type === 'data' && m.to === 'host' && this.conns.has(m.from)) this.h.onData && this.h.onData(m.d, m.from);
      else if (m.type === 'close' && this.conns.has(m.from)) { this.conns.delete(m.from); this.h.onClose && this.h.onClose(m.from); }
    } else {
      if (m.type === 'accept' && m.to === this.id && this._acc) { this.hostId = m.from; this.hostOk = true; const r = this._acc; this._acc = null; r(); }
      else if (m.type === 'data' && m.from === this.hostId && (m.to === '*' || m.to === this.id)) this.h.onData && this.h.onData(m.d, 'host');
      else if (m.type === 'close' && m.from === this.hostId) { this.hostOk = false; this.h.onHostClose && this.h.onHostClose(); }
    }
  }
  sendTo(pid, d) { this._post({ type: 'data', to: pid, d }); }
  broadcast(d, except) { if (!except) this._post({ type: 'data', to: '*', d }); else for (const pid of this.conns.keys()) if (pid !== except) this._post({ type: 'data', to: pid, d }); }
  send(d) { if (this.hostOk) this._post({ type: 'data', to: 'host', d }); }
  get connected() { return this.isHost ? true : this.hostOk; }
  close() { if (this.closed) return; this._post({ type: 'close' }); this.closed = true; if (this.ch) this.ch.close(); }
}
