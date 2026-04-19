'use strict'

const b4a = require('b4a')
const Hyperbee = require('hyperbee')
const cenc = require('compact-encoding')
const { TYPE, TYPE_NAME, REQUIRES_POW, decodeOp, makeOpId, parseOpId, OP_ID_BYTES } = require('./ops')
const pow = require('./pow')
const reputation = require('./reputation')

const INDEX_CORE_NAME = 'p2pbuilders/index'

// Default indexer policy (SPEC §6.1)
const DEFAULT_POLICY = {
  posts: { perHour: 10 },
  comments: { perHour: 60 },
  votes: { perHour: 600 },
  minPowBits: { ...pow.DEFAULT_BITS }, // floor per op type
  enforcePow: true,
  enforceRateLimit: true
}

const MS_PER_HOUR = 3600 * 1000

const TS_PAD = 15 // enough for ms timestamps through year 33658
const tsKey = (ts) => String(ts).padStart(TS_PAD, '0')
const hex = (buf) => b4a.toString(buf, 'hex')
const fromHex = (s) => b4a.from(s, 'hex')

const voteEnc = cenc.int8
const opMetaEnc = {
  preencode (state, m) {
    cenc.uint8.preencode(state, m.type)
    cenc.fixed(32).preencode(state, m.author)
    cenc.uint64.preencode(state, m.ts)
    cenc.string.preencode(state, m.board || '')
    cenc.fixed(40).preencode(state, m.parent || b4a.alloc(40))
    cenc.fixed(40).preencode(state, m.target || b4a.alloc(40))
  },
  encode (state, m) {
    cenc.uint8.encode(state, m.type)
    cenc.fixed(32).encode(state, m.author)
    cenc.uint64.encode(state, m.ts)
    cenc.string.encode(state, m.board || '')
    cenc.fixed(40).encode(state, m.parent || b4a.alloc(40))
    cenc.fixed(40).encode(state, m.target || b4a.alloc(40))
  },
  decode (state) {
    return {
      type: cenc.uint8.decode(state),
      author: cenc.fixed(32).decode(state),
      ts: cenc.uint64.decode(state),
      board: cenc.string.decode(state),
      parent: cenc.fixed(40).decode(state),
      target: cenc.fixed(40).decode(state)
    }
  }
}

// Index entry helpers
function postNewKey (boardName, ts, opId) { return `post/${boardName}/new/${tsKey(ts)}/${hex(opId)}` }
function commentKey (parentOpId, ts, opId) { return `comment/${hex(parentOpId)}/${tsKey(ts)}/${hex(opId)}` }
function voteKey (targetOpId, voter) { return `vote/${hex(targetOpId)}/${hex(voter)}` }
function userPostKey (author, ts, opId) { return `user/${hex(author)}/posts/${tsKey(ts)}/${hex(opId)}` }
function boardKey (name) { return `board/${name}` }
function seenKey (pubkey) { return `_seen/${hex(pubkey)}` }
function opMetaKey (opId) { return `_opmeta/${hex(opId)}` }
function overlayKey (opId) { return `overlay/${hex(opId)}` }
function tombKey (opId) { return `tomb/${hex(opId)}` }
function profileKey (pubkey) { return `profile/${hex(pubkey)}` }

const overlayEnc = {
  preencode (state, o) {
    cenc.string.preencode(state, o.body || '')
    cenc.string.preencode(state, o.title || '')
    cenc.uint64.preencode(state, o.ts)
  },
  encode (state, o) {
    cenc.string.encode(state, o.body || '')
    cenc.string.encode(state, o.title || '')
    cenc.uint64.encode(state, o.ts)
  },
  decode (state) {
    return {
      body: cenc.string.decode(state),
      title: cenc.string.decode(state),
      ts: Number(cenc.uint64.decode(state))
    }
  }
}

const profileEnc = {
  preencode (state, p) {
    cenc.string.preencode(state, p.nick || '')
    cenc.string.preencode(state, p.bio || '')
    cenc.string.preencode(state, p.avatar || '')
    cenc.uint64.preencode(state, p.ts)
  },
  encode (state, p) {
    cenc.string.encode(state, p.nick || '')
    cenc.string.encode(state, p.bio || '')
    cenc.string.encode(state, p.avatar || '')
    cenc.uint64.encode(state, p.ts)
  },
  decode (state) {
    return {
      nick: cenc.string.decode(state),
      bio: cenc.string.decode(state),
      avatar: cenc.string.decode(state),
      ts: Number(cenc.uint64.decode(state))
    }
  }
}

class Indexer {
  constructor (node, { name = INDEX_CORE_NAME, policy, admin = null } = {}) {
    this.node = node
    this.name = name
    this.bee = null
    this.policy = { ...DEFAULT_POLICY, ...(policy || {}) }
    // admin: optional 32-byte pubkey buffer. If set, this identity can
    // tombstone anyone's posts/comments (not just their own).
    this.admin = admin ? (b4a.isBuffer(admin) ? admin : b4a.from(admin, 'hex')) : null
    this._cores = new Map() // hex(pubkey) -> { core, unsubscribe }
    this._pending = Promise.resolve()
    this._closing = false
    this._blocked = new Set() // local blocklist: hex(pubkey)
    // Per-author cached stats for rate limits and reputation.
    this._stats = new Map() // hex(pubkey) -> { firstTs, posts:[], comments:[], votes:[], received: number }
  }

  block (pubkey) { this._blocked.add(hex(pubkey)) }
  unblock (pubkey) { this._blocked.delete(hex(pubkey)) }
  isBlocked (pubkey) { return this._blocked.has(hex(pubkey)) }

  async ready () {
    const core = this.node.store.get({ name: this.name })
    await core.ready()
    this.bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
    await this.bee.ready()
    // Start indexing own core + any already-tracked cores.
    await this.addCore(this.node.core)
    for (const remote of this.node._tracked.values()) await this.addCore(remote)
    // Keep up with newly-tracked cores.
    this.node.on('track', async (pubkey) => {
      const remote = this.node.userCore(pubkey)
      if (remote) await this.addCore(remote)
    })
  }

  async close () {
    this._closing = true
    for (const { unsubscribe } of this._cores.values()) unsubscribe()
    await this._pending
    if (this.bee) await this.bee.close()
  }

  async addCore (core) {
    const key = hex(core.key)
    if (this._cores.has(key)) return
    const onChange = () => { this._queueIndex(core) }
    core.on('append', onChange)
    core.on('truncate', onChange)
    core.on('download', onChange)
    this._cores.set(key, {
      core,
      unsubscribe: () => {
        core.off('append', onChange)
        core.off('truncate', onChange)
        core.off('download', onChange)
      }
    })
    await this._queueIndex(core)
  }

  _queueIndex (core) {
    this._pending = this._pending.then(() => this._indexCore(core)).catch(() => {})
    return this._pending
  }

  async _indexCore (core) {
    if (this._closing) return
    const seenBuf = await this.bee.get(seenKey(core.key))
    const start = seenBuf ? readUint32(seenBuf.value) : 0
    const end = core.length
    if (start >= end) return

    // Make sure every block from start..end is locally available before indexing.
    // For our own core these are always local. For remote cores, download first.
    if (core.writable === false || core.peers?.length) {
      try { await core.download({ start, end }).done() } catch { /* proceed best-effort */ }
    }

    const batch = this.bee.batch()
    let indexed = start
    for (let seq = start; seq < end; seq++) {
      let raw
      try { raw = await core.get(seq) } catch { break }
      if (!raw) break
      let op
      try { op = decodeOp(raw) } catch { indexed = seq + 1; continue }
      const opId = makeOpId(core.key, seq)
      if (this._gate(op, core.key)) {
        await this._applyOp(batch, op, opId, core.key)
      }
      indexed = seq + 1
    }
    if (indexed > start) await batch.put(seenKey(core.key), writeUint32(indexed))
    await batch.flush()
  }

  // Returns true if op should be indexed, false if it should be dropped.
  // Mutates _stats as a side-effect to drive rate-limit accounting.
  _gate (op, author) {
    // 1. Local blocklist
    if (this.isBlocked(author)) return false

    // 2. PoW gate
    if (this.policy.enforcePow && REQUIRES_POW.has(op.type)) {
      const minBits = this.policy.minPowBits[TYPE_NAME[op.type]] || 0
      if (!op.pow || op.pow.bits < minBits) return false
      if (!pow.verify(op, minBits)) return false
    }

    // 3. Rate limits — tracked via _stats; use the op's ts as the event time
    //    (SPEC allows ts to be author-claimed; we still enforce per-hour window.)
    const stats = this._getStats(author)
    const nowTs = Number(op.ts)
    if (stats.firstTs === 0 || nowTs < stats.firstTs) stats.firstTs = nowTs

    const buckets = {
      [TYPE.POST]: { arr: stats.posts, limit: this.policy.posts.perHour },
      [TYPE.COMMENT]: { arr: stats.comments, limit: this.policy.comments.perHour },
      [TYPE.VOTE]: { arr: stats.votes, limit: this.policy.votes.perHour }
    }
    const bucket = buckets[op.type]
    if (bucket && this.policy.enforceRateLimit) {
      // Evict timestamps older than 1h from nowTs
      const cutoff = nowTs - MS_PER_HOUR
      while (bucket.arr.length && bucket.arr[0] < cutoff) bucket.arr.shift()
      if (bucket.arr.length >= bucket.limit) return false
      bucket.arr.push(nowTs)
    }

    return true
  }

  _getStats (author) {
    const key = hex(author)
    let s = this._stats.get(key)
    if (!s) {
      s = { firstTs: 0, posts: [], comments: [], votes: [], received: 0 }
      this._stats.set(key, s)
    }
    return s
  }

  // Reputation + weighted vote helpers
  repOf (pubkey, { now = Date.now() } = {}) {
    const s = this._getStats(pubkey)
    const ageDays = s.firstTs > 0 ? (now - s.firstTs) / 86400000 : 0
    return reputation.computeRep(ageDays, s.received)
  }

  weightOf (pubkey, { now = Date.now() } = {}) {
    const s = this._getStats(pubkey)
    const ageDays = s.firstTs > 0 ? (now - s.firstTs) / 86400000 : 0
    return reputation.computeWeight(ageDays, s.received)
  }

  // Returns { up, down, score, weightedScore } — weighted uses reputation.
  async getWeightedVoteTotals (targetOpId, { now = Date.now() } = {}) {
    let up = 0; let down = 0
    let weighted = 0
    const prefix = `vote/${hex(targetOpId)}/`
    const range = { gte: prefix, lt: prefix + '\uFFFF' }
    for await (const { key, value } of this.bee.createReadStream(range)) {
      const voterHex = key.slice(prefix.length)
      const voter = fromHex(voterHex)
      if (this.isBlocked(voter)) continue
      const dir = cenc.decode(voteEnc, value)
      if (dir > 0) up++
      else if (dir < 0) down++
      const w = this.weightOf(voter, { now })
      weighted += dir * w
    }
    return { up, down, score: up - down, weightedScore: weighted }
  }

  async _applyOp (batch, op, opId, author) {
    const value = opId
    switch (op.type) {
      case TYPE.POST: {
        const { board } = op.payload
        await batch.put(postNewKey(board, op.ts, opId), value)
        await batch.put(userPostKey(author, op.ts, opId), value)
        await batch.put(opMetaKey(opId), encodeMeta({ type: op.type, author, ts: op.ts, board }))
        break
      }
      case TYPE.COMMENT: {
        const { parent } = op.payload
        await batch.put(commentKey(parent, op.ts, opId), value)
        await batch.put(opMetaKey(opId), encodeMeta({ type: op.type, author, ts: op.ts, parent }))
        break
      }
      case TYPE.VOTE: {
        const { target, dir } = op.payload
        // replace previous vote by same voter on same target
        const prev = await this.bee.get(voteKey(target, author))
        const prevDir = prev ? cenc.decode(voteEnc, prev.value) : 0
        await batch.put(voteKey(target, author), cenc.encode(voteEnc, dir))
        // update target-author's received-upvote stats
        try {
          const { pubkey: targetAuthor } = parseOpId(target)
          const s = this._getStats(targetAuthor)
          s.received += (dir > 0 ? 1 : 0) - (prevDir > 0 ? 1 : 0)
          if (s.received < 0) s.received = 0
        } catch { /* target not a valid opId */ }
        break
      }
      case TYPE.EDIT: {
        const { target, body, title } = op.payload
        // Authorization: only the original author may edit.
        const { pubkey: targetAuthor } = parseOpId(target)
        if (!b4a.equals(targetAuthor, author)) break
        // Keep latest edit only (ts-compared, newer wins).
        const existing = await this.bee.get(overlayKey(target))
        const prevTs = existing ? cenc.decode(overlayEnc, existing.value).ts : 0
        if (Number(op.ts) >= prevTs) {
          await batch.put(overlayKey(target),
            cenc.encode(overlayEnc, { body, title: title || '', ts: Number(op.ts) }))
        }
        break
      }
      case TYPE.TOMBSTONE: {
        const { target } = op.payload
        const { pubkey: targetAuthor } = parseOpId(target)
        const isAuthor = b4a.equals(targetAuthor, author)
        const isAdmin = this.admin && b4a.equals(this.admin, author)
        if (!isAuthor && !isAdmin) break
        await batch.put(tombKey(target), b4a.from([1]))
        break
      }
      case TYPE.PROFILE: {
        const existing = await this.bee.get(profileKey(author))
        const prevTs = existing ? cenc.decode(profileEnc, existing.value).ts : 0
        if (Number(op.ts) >= prevTs) {
          await batch.put(profileKey(author),
            cenc.encode(profileEnc, {
              nick: op.payload.nick,
              bio: op.payload.bio || '',
              avatar: op.payload.avatar || '',
              ts: Number(op.ts)
            }))
        }
        break
      }
      case TYPE.BOARD_CREATE: {
        const { name } = op.payload
        const exists = await this.bee.get(boardKey(name))
        if (!exists) await batch.put(boardKey(name), cenc.encode({
          preencode (s, o) {
            cenc.uint8.preencode(s, o.minPowBits)
            cenc.string.preencode(s, o.description)
            cenc.fixed(32).preencode(s, o.creator)
            cenc.uint64.preencode(s, o.ts)
          },
          encode (s, o) {
            cenc.uint8.encode(s, o.minPowBits)
            cenc.string.encode(s, o.description)
            cenc.fixed(32).encode(s, o.creator)
            cenc.uint64.encode(s, o.ts)
          }
        }, { minPowBits: op.payload.minPowBits, description: op.payload.description, creator: author, ts: op.ts }))
        break
      }
      default:
        break // follow/block/profile/blocklist_publish: not indexed at this layer in v0.1
    }
  }

  // -------- queries --------

  // Yields { opId, author, seq, ts } newest-first (reverse=true default) or oldest-first.
  async * listPosts (board, { sort = 'new', limit = 50, reverse = true, includeTombstoned = false } = {}) {
    const prefix = `post/${board}/new/`
    const range = { gte: prefix, lt: prefix + '\uFFFF', reverse, limit }
    for await (const { key, value } of this.bee.createReadStream(range)) {
      const opId = value
      const { pubkey, seq } = parseOpId(opId)
      if (this.isBlocked(pubkey)) continue
      if (!includeTombstoned && await this.isTombstoned(opId)) continue
      yield {
        opId,
        author: pubkey,
        seq,
        ts: Number(key.slice(prefix.length, prefix.length + TS_PAD))
      }
    }
  }

  async isTombstoned (opId) {
    return (await this.bee.get(tombKey(opId))) != null
  }

  async getOverlay (opId) {
    const node = await this.bee.get(overlayKey(opId))
    return node ? cenc.decode(overlayEnc, node.value) : null
  }

  async getProfile (pubkey) {
    const node = await this.bee.get(profileKey(pubkey))
    return node ? cenc.decode(profileEnc, node.value) : null
  }

  // Ranks posts by weighted vote sum; returns { opId, author, seq, ts, score, weightedScore, up, down, hot }.
  async scoreBoard (board, { limit = 50, sort = 'hot', weighted = true } = {}) {
    const posts = []
    for await (const entry of this.listPosts(board, { limit: 10000, reverse: false })) {
      if (this.isBlocked(entry.author)) continue
      posts.push(entry)
    }
    const scored = []
    const now = Date.now()
    for (const p of posts) {
      const t = await this.getWeightedVoteTotals(p.opId, { now })
      const hoursOld = Math.max(0, (now - p.ts) / 3600000)
      // HN-style hot formula (SPEC §9.1). weightedScore may be negative.
      const sPart = Math.max(0, t.weightedScore) + 1
      const hot = Math.pow(sPart, 0.8) / Math.pow(hoursOld + 2, 1.8)
      scored.push({ ...p, ...t, hot })
    }
    scored.sort((a, b) => {
      if (sort === 'hot') return b.hot - a.hot || b.ts - a.ts
      if (weighted) return b.weightedScore - a.weightedScore || b.ts - a.ts
      return b.score - a.score || b.ts - a.ts
    })
    return scored.slice(0, limit)
  }

  async * listComments (parentOpId, { limit = 500, reverse = false, includeTombstoned = false } = {}) {
    const prefix = `comment/${hex(parentOpId)}/`
    const range = { gte: prefix, lt: prefix + '\uFFFF', reverse, limit }
    for await (const { key, value } of this.bee.createReadStream(range)) {
      const opId = value
      const { pubkey, seq } = parseOpId(opId)
      if (this.isBlocked(pubkey)) continue
      if (!includeTombstoned && await this.isTombstoned(opId)) continue
      yield {
        opId,
        author: pubkey,
        seq,
        parent: parentOpId,
        ts: Number(key.slice(prefix.length, prefix.length + TS_PAD))
      }
    }
  }

  async getVoteTotals (targetOpId) {
    let up = 0
    let down = 0
    const prefix = `vote/${hex(targetOpId)}/`
    const range = { gte: prefix, lt: prefix + '\uFFFF' }
    for await (const { value } of this.bee.createReadStream(range)) {
      const dir = cenc.decode(voteEnc, value)
      if (dir > 0) up++
      else if (dir < 0) down++
    }
    return { up, down, score: up - down }
  }

  async getBoard (name) {
    const node = await this.bee.get(boardKey(name))
    if (!node) return null
    const dec = cenc.decode({
      decode (s) {
        return {
          minPowBits: cenc.uint8.decode(s),
          description: cenc.string.decode(s),
          creator: cenc.fixed(32).decode(s),
          ts: Number(cenc.uint64.decode(s))
        }
      }
    }, node.value)
    return dec
  }

  async * listBoards () {
    for await (const { key } of this.bee.createReadStream({ gte: 'board/', lt: 'board/\uFFFF' })) {
      yield key.slice('board/'.length)
    }
  }
}

function encodeMeta (m) { return cenc.encode(opMetaEnc, m) }
function readUint32 (buf) { return buf.readUInt32BE ? buf.readUInt32BE(0) : new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, false) }
function writeUint32 (n) { const b = b4a.alloc(4); new DataView(b.buffer, b.byteOffset, 4).setUint32(0, n, false); return b }

module.exports = { Indexer, INDEX_CORE_NAME }
