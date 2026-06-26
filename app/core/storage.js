// storage.js — the storage abstraction. The app talks to an "adapter"; the
// adapter decides WHERE data lives. Two implementations:
//   LocalAdapter    — in-memory + localStorage. Used for the lab, tests, and
//                     offline fallback. Synchronous under the hood, async API.
//   FirebaseAdapter — (wired separately) Firestore realtime. Same interface.
// Keeping one async interface means the app never changes when we flip clouds.
import { newDb } from './model.js';

const KEY = 'tmv1';

export class LocalAdapter {
  constructor({ key = KEY, seed = null } = {}) {
    this.key = key;
    this._mem = seed ? clone(seed) : null;
    this._subs = new Set();
  }
  get _hasLS() {
    return typeof localStorage !== 'undefined';
  }
  async load() {
    if (this._hasLS) {
      const raw = localStorage.getItem(this.key);
      if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
    }
    if (this._mem) return clone(this._mem);
    const fresh = newDb();
    await this.save(fresh);
    return fresh;
  }
  async save(db) {
    this._mem = clone(db);
    if (this._hasLS) localStorage.setItem(this.key, JSON.stringify(db));
    this._subs.forEach(cb => { try { cb(clone(db)); } catch {} });
    return true;
  }
  subscribe(cb) { this._subs.add(cb); return () => this._subs.delete(cb); }
  async clear() {
    this._mem = null;
    if (this._hasLS) localStorage.removeItem(this.key);
  }
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Placeholder so imports resolve before the real Firestore wiring lands.
// Throws clearly if used before implementation.
export class FirebaseAdapter {
  constructor() { /* config injected when wired */ }
  async load() { throw new Error('FirebaseAdapter not wired yet — using LocalAdapter for now'); }
  async save() { throw new Error('FirebaseAdapter not wired yet'); }
  subscribe() { throw new Error('FirebaseAdapter not wired yet'); }
}
