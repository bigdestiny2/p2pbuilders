// sync.js — the data transport. Two interchangeable backends behind one API:
//
//   BridgeSync — real PearBrowser. Wraps window.pear.sync (Autobase+Hyperbee
//                shared group). All peers replicate the same materialized view.
//
//   DevSync    — plain browser / Node. localStorage-backed store that REIMPLEMENTS
//                the bridge's generic reducer byte-for-byte, with BroadcastChannel
//                live updates so multiple tabs behave like multiple peers sharing
//                one world. Lets us build & verify the whole app without PearBrowser.
//
// Both expose the same async surface used by data.js:
//   ready(), append({type,data}), get(key), list(prefix,{limit}),
//   range(opts), count(prefix), status(), onChange(fn), mode
//
// The view key for an op is `type.replace(':','!') + '!' + data.id`, matching
// pearbrowser-desktop/backend/pear-bridge.js _defaultApply generic fallback.

import { createGossip } from './gossip.js'

export const APP_ID = 'p2pbuilders'

// ---- shared reducer (mirrors the bridge generic fallback) -------------------
function applyOp (view, op) {
  if (!op || typeof op !== 'object' || !op.type) return
  if (op.data && op.data.id != null) {
    const key = op.type.replace(':', '!') + '!' + op.data.id
    view[key] = op.data
  }
}

function rangeFromView (view, opts) {
  let entries = Object.keys(view).sort()
  const { gte, gt, lte, lt } = opts
  if (gte != null) entries = entries.filter(k => k >= gte)
  if (gt != null) entries = entries.filter(k => k > gt)
  if (lte != null) entries = entries.filter(k => k <= lte)
  if (lt != null) entries = entries.filter(k => k < lt)
  if (opts.reverse) entries.reverse()
  const limit = clampLimit(opts.limit)
  const out = []
  for (const k of entries) {
    if (out.length >= limit) break
    out.push({ key: k, value: view[k] })
  }
  return out
}

function clampLimit (n) {
  n = Number(n) || 100
  if (n < 1) n = 100
  if (n > 1000) n = 1000
  return n
}

// ---- DevSync ----------------------------------------------------------------
class DevSync {
  constructor (storage, channelName) {
    this.mode = 'dev'
    this.storage = storage
    this.VIEW_KEY = 'p2pb:view'
    this.META_KEY = 'p2pb:meta'
    this._listeners = new Set()
    this._channel = null
    this._channelName = channelName || 'peerit'
  }

  async ready () {
    if (!this._read(this.VIEW_KEY)) this._write(this.VIEW_KEY, {})
    if (!this._read(this.META_KEY)) this._write(this.META_KEY, { createdAt: Date.now(), len: 0 })
    // Live updates across tabs.
    if (typeof BroadcastChannel !== 'undefined') {
      this._channel = new BroadcastChannel(this._channelName)
      this._channel.onmessage = (e) => { if (e && e.data === 'changed') this._emit() }
    }
    if (typeof addEventListener !== 'undefined') {
      addEventListener('storage', (e) => { if (e && e.key === this.VIEW_KEY) this._emit() })
    }
    return this
  }

  _read (k) {
    try { const s = this.storage.getItem(k); return s ? JSON.parse(s) : null } catch { return null }
  }
  _write (k, v) { this.storage.setItem(k, JSON.stringify(v)) }

  _view () { return this._read(this.VIEW_KEY) || {} }

  async append (op) {
    const view = this._view()
    applyOp(view, { type: op.type, data: op.data })
    this._write(this.VIEW_KEY, view)
    const meta = this._read(this.META_KEY) || { len: 0 }
    meta.len = (meta.len || 0) + 1
    this._write(this.META_KEY, meta)
    this._broadcast()
    return { ok: true }
  }

  async get (key) {
    const view = this._view()
    return Object.prototype.hasOwnProperty.call(view, key) ? view[key] : null
  }

  async list (prefix, opts = {}) {
    const view = this._view()
    return rangeFromView(view, prefix
      ? { gte: prefix, lt: prefix + '\xff', limit: opts.limit }
      : { limit: opts.limit })
  }

  async range (opts = {}) { return rangeFromView(this._view(), opts) }

  async count (prefix) {
    const view = this._view()
    if (!prefix) return Object.keys(view).length
    let n = 0
    for (const k of Object.keys(view)) if (k >= prefix && k < prefix + '\xff') n++
    return n
  }

  async status () {
    const meta = this._read(this.META_KEY) || {}
    return { appId: APP_ID, mode: 'dev', inviteKey: 'dev-local', writerCount: 1, viewLength: meta.len || 0 }
  }

  onChange (fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  _emit () { for (const fn of this._listeners) { try { fn() } catch (e) { console.error(e) } } }
  _broadcast () { this._emit(); if (this._channel) try { this._channel.postMessage('changed') } catch {} }
}

// ---- BridgeSync (real PearBrowser) ------------------------------------------
class BridgeSync {
  constructor (pearSync, storage) {
    this.mode = 'bridge'
    this.sync = pearSync
    this.storage = storage
    this._listeners = new Set()
    this._poll = null
    this._lastLen = -1
  }

  async ready () {
    // Shared-group MVP: join a well-known origin group if we have its key,
    // otherwise create one (this device becomes the origin writer) and remember
    // the key locally so we rejoin the same world next launch. The created key
    // is surfaced in Settings so it can be baked into a published build.
    let key = null
    try { key = this.storage && this.storage.getItem('p2pb:groupKey') } catch {}
    key = key || (typeof GLOBAL_GROUP_KEY === 'string' ? GLOBAL_GROUP_KEY : null)
    try {
      if (key) {
        const r = await this.sync.join(APP_ID, key)
        this.writerPublicKey = r.writerPublicKey
        this.inviteKey = r.inviteKey
      } else {
        const r = await this.sync.create(APP_ID)
        this.writerPublicKey = r.writerPublicKey
        this.inviteKey = r.inviteKey
        try { this.storage && this.storage.setItem('p2pb:groupKey', r.inviteKey) } catch {}
      }
    } catch (err) {
      // join failed (bad/absent group) -> fall back to creating our own.
      const r = await this.sync.create(APP_ID)
      this.writerPublicKey = r.writerPublicKey
      this.inviteKey = r.inviteKey
      try { this.storage && this.storage.setItem('p2pb:groupKey', r.inviteKey) } catch {}
    }
    // The bridge has no push channel; poll the view length to detect peer writes.
    this._startPolling()
    return this
  }

  _startPolling () {
    if (this._poll) return
    this._poll = setInterval(async () => {
      try {
        const s = await this.sync.status(APP_ID)
        const len = s && s.viewLength
        if (len !== this._lastLen) { this._lastLen = len; this._emit() }
      } catch {}
    }, 4000)
  }

  async append (op) {
    return this.sync.append(APP_ID, { type: op.type, data: op.data, timestamp: new Date().toISOString() })
  }
  async get (key) { return this.sync.get(APP_ID, key) }
  async list (prefix, opts = {}) { return this.sync.list(APP_ID, prefix, opts) }
  async range (opts = {}) { return this.sync.range(APP_ID, opts) }
  async count (prefix) { const r = await this.sync.count(APP_ID, prefix); return typeof r === 'object' ? r.count : r }
  async status () { const s = await this.sync.status(APP_ID); return { ...s, mode: 'bridge', inviteKey: this.inviteKey } }
  onChange (fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  _emit () { for (const fn of this._listeners) { try { fn() } catch (e) { console.error(e) } } }
}

// Placeholder for a baked-in origin group key (set when publishing a shared world).
const GLOBAL_GROUP_KEY = null

// Factory: pick the backend for the current environment.
//   default  -> gossip multi-writer (per-user outbox + aggregation) — see gossip.js
//   mode:'shared' -> single shared group (BridgeSync / DevSync). Kept for the
//                    simple case and the original tests.
export function createSync (opts = {}) {
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : memoryStorage())
  const pear = opts.pear || (typeof window !== 'undefined' ? window.pear : null)
  if ((opts.mode || 'gossip') === 'gossip') {
    return createGossip({ storage, pear, getMe: opts.getMe, identity: opts.identity, channelName: opts.channelName, forceDev: opts.forceDev, bus: opts.bus, validate: opts.validate })
  }
  if (pear && pear.sync && !opts.forceDev) return new BridgeSync(pear.sync, storage)
  return new DevSync(storage, opts.channelName)
}

// In-memory localStorage shim (Node tests / SSR safety).
export function memoryStorage () {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  }
}

export { DevSync, BridgeSync, applyOp }
