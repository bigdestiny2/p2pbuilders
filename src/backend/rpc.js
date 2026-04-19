'use strict'

const b4a = require('b4a')
const { decodeOp, makeOpId, parseOpId } = require('./ops')
const pow = require('./pow')

const DEFAULT_BOARD = 'front'

// Converts a Buffer/Uint8Array into hex string. null → null.
const hex = (b) => (b ? b4a.toString(b, 'hex') : null)
const fromHex = (s) => (s ? b4a.from(s, 'hex') : null)

// Create an RPC dispatcher bound to a Node + Indexer.
function createRPC ({ node, indexer }) {
  async function enrichPost ({ opId, author, seq, ts }) {
    const core = node.userCore(author)
    if (!core) return null
    let op
    try { op = decodeOp(await core.get(seq)) } catch { return null }
    const { up, down, score } = await indexer.getVoteTotals(opId)
    const overlay = await indexer.getOverlay(opId)
    const profile = await indexer.getProfile(author)
    const commentCount = await countComments(opId)
    return {
      opId: hex(opId),
      author: hex(author),
      authorNick: profile?.nick || null,
      seq,
      ts,
      title: (overlay?.title) || op.payload.title,
      body: (overlay?.body) ?? op.payload.body,
      edited: !!overlay,
      link: op.payload.link,
      board: op.payload.board,
      up,
      down,
      score,
      commentCount
    }
  }

  async function countComments (parentOpId) {
    let n = 0
    for await (const _ of indexer.listComments(parentOpId, { limit: 10000 })) n++
    return n
  }

  async function enrichComment ({ opId, author, seq, ts, parent }) {
    const core = node.userCore(author)
    if (!core) return null
    let op
    try { op = decodeOp(await core.get(seq)) } catch { return null }
    const { up, down, score } = await indexer.getVoteTotals(opId)
    const overlay = await indexer.getOverlay(opId)
    const profile = await indexer.getProfile(author)
    return {
      opId: hex(opId),
      parent: hex(parent),
      author: hex(author),
      authorNick: profile?.nick || null,
      seq,
      ts,
      body: overlay?.body ?? op.payload.body,
      edited: !!overlay,
      up, down, score
    }
  }

  const methods = {
    async me () {
      return { pubkey: hex(node.pubkey), length: node.length }
    },

    async listBoards () {
      const out = []
      for await (const name of indexer.listBoards()) out.push(name)
      return out
    },

    async getBoard ({ name }) {
      const b = await indexer.getBoard(name)
      if (!b) return null
      return {
        name,
        description: b.description,
        minPowBits: b.minPowBits,
        creator: hex(b.creator),
        ts: b.ts
      }
    },

    async createBoard ({ name, description, minPowBits }) {
      const { opId } = await node.createBoard(name, description, { minPowBits })
      return { opId: hex(opId) }
    },

    async listPosts ({ board = DEFAULT_BOARD, sort = 'hot', limit = 50 }) {
      const posts = []
      if (sort === 'hot' || sort === 'top') {
        const ranked = await indexer.scoreBoard(board, { limit, sort })
        for (const r of ranked) {
          const p = await enrichPost(r)
          if (p) { p.hot = r.hot; posts.push(p) }
        }
      } else {
        for await (const entry of indexer.listPosts(board, { limit })) {
          const p = await enrichPost(entry)
          if (p) posts.push(p)
        }
      }
      return posts
    },

    async getPost ({ opId }) {
      const raw = fromHex(opId)
      const { pubkey, seq } = parseOpId(raw)
      const core = node.userCore(pubkey)
      if (!core) return null
      let op
      try { op = decodeOp(await core.get(seq)) } catch { return null }
      const { up, down, score } = await indexer.getVoteTotals(raw)
      const overlay = await indexer.getOverlay(raw)
      const profile = await indexer.getProfile(pubkey)
      const tombstoned = await indexer.isTombstoned(raw)
      return {
        opId,
        author: hex(pubkey),
        authorNick: profile?.nick || null,
        seq,
        ts: Number(op.ts),
        title: overlay?.title || op.payload.title,
        body: overlay?.body ?? op.payload.body,
        edited: !!overlay,
        tombstoned,
        link: op.payload.link,
        board: op.payload.board,
        up, down, score
      }
    },

    async listComments ({ parentOpId }) {
      const parent = fromHex(parentOpId)
      const out = []
      for await (const entry of indexer.listComments(parent)) {
        const c = await enrichComment(entry)
        if (c) out.push(c)
      }
      return out
    },

    // Returns all comments in a thread (direct + nested descendants), flat,
    // each with a `parent` pointer. Client rebuilds the tree from parents.
    async listCommentTree ({ rootOpId, maxDepth = 20, maxNodes = 1000 }) {
      const out = []
      const seen = new Set()
      const queue = [{ id: fromHex(rootOpId), depth: 0 }]
      while (queue.length && out.length < maxNodes) {
        const { id, depth } = queue.shift()
        if (depth >= maxDepth) continue
        for await (const entry of indexer.listComments(id)) {
          const key = hex(entry.opId)
          if (seen.has(key)) continue
          seen.add(key)
          const c = await enrichComment(entry)
          if (!c) continue
          out.push(c)
          queue.push({ id: entry.opId, depth: depth + 1 })
          if (out.length >= maxNodes) break
        }
      }
      return out
    },

    async createPost ({ board = DEFAULT_BOARD, title, body, link }) {
      // Auto-register the default board on first post, so the UI doesn't need
      // to expose a board-management flow.
      if (board === DEFAULT_BOARD) {
        const existing = await indexer.getBoard(board)
        if (!existing) {
          try {
            await node.createBoard(board, 'p2pbuilders front page', { minPowBits: pow.DEFAULT_BITS.post })
          } catch { /* ignore if someone raced us */ }
        }
      }
      const t0 = Date.now()
      const { opId, op } = await node.post(board, title, body, { link })
      return { opId: hex(opId), powMs: Date.now() - t0, powBits: op.pow?.bits || 0 }
    },

    async createComment ({ parentOpId, body }) {
      const parent = fromHex(parentOpId)
      const t0 = Date.now()
      const { opId, op } = await node.comment(parent, body)
      return { opId: hex(opId), powMs: Date.now() - t0, powBits: op.pow?.bits || 0 }
    },

    async vote ({ targetOpId, dir }) {
      const target = fromHex(targetOpId)
      await node.vote(target, dir)
      return { ok: true }
    },

    async getVoteTotals ({ opId }) {
      return indexer.getVoteTotals(fromHex(opId))
    },

    async trackUser ({ pubkey }) {
      await node.trackUser(fromHex(pubkey))
      return { ok: true }
    },

    async editOp ({ opId, body, title }) {
      await node.edit(fromHex(opId), body, { title: title || null })
      return { ok: true }
    },

    async deleteOp ({ opId }) {
      await node.tombstone(fromHex(opId))
      return { ok: true }
    },

    async setProfile ({ nick, bio, avatar }) {
      await node.setProfile({ nick, bio, avatar })
      return { ok: true }
    },

    async getProfile ({ pubkey }) {
      const p = await indexer.getProfile(fromHex(pubkey))
      if (!p) return null
      return {
        pubkey,
        nick: p.nick || null,
        bio: p.bio || null,
        avatar: p.avatar || null,
        ts: p.ts
      }
    },

    // Reveal the 32-byte identity primary key as hex. This is the secret that
    // controls the user's core — losing it means losing the identity, sharing
    // it means giving someone else the ability to write under your pubkey.
    async exportPrimaryKey () {
      return { hex: hex(node.primaryKey) }
    },

    // Read-only diagnostic snapshot for the settings page.
    async getStats () {
      let boardCount = 0
      for await (const _ of indexer.listBoards()) boardCount++
      const peerCount = node.swarm ? node.swarm.peerCount : 0
      const trackedCount = node._tracked ? node._tracked.size : 0
      return {
        pubkey: hex(node.pubkey),
        length: node.length,
        storage: node._cleanup ? null : 'disk', // best-effort
        swarm: node.swarm ? 'attached' : 'offline',
        peerCount,
        trackedUsers: trackedCount,
        boards: boardCount,
        policy: {
          minPowBits: indexer.policy.minPowBits,
          posts: indexer.policy.posts,
          comments: indexer.policy.comments,
          votes: indexer.policy.votes,
          enforcePow: indexer.policy.enforcePow,
          enforceRateLimit: indexer.policy.enforceRateLimit
        }
      }
    }
  }

  async function dispatch (method, params) {
    const fn = methods[method]
    if (!fn) throw new Error(`unknown method: ${method}`)
    return fn(params || {})
  }

  return { dispatch, methods }
}

module.exports = { createRPC }
