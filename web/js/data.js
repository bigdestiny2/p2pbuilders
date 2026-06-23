// data.js — the p2pbuilders domain API. Turns intents (submit, comment, vote,
// follow, block, create board…) into PoW-gated, signed ops on the gossip layer,
// and reads the merged view back into typed records with reputation-weighted
// tallies. Reuses peerit's sync/gossip/crypto engine; the schema + PoW +
// reputation are p2pbuilders-specific.

import { keys, id as mkid, TYPE, DEFAULT_BOARD, isValidBoard, normalizeBoard, resolveBlocked } from './model.js'
import { canonical } from './canon.js'
import { mint, MIN_BITS } from './pow.js'
import { weight as repWeight, weightedTally } from './reputation.js'
import { uid } from './util.js'

const DAY = 86400000

export class Data {
  constructor (sync, identity, opts = {}) {
    this.sync = sync
    this.id = identity
    this.minBits = opts.minBits || MIN_BITS
    this._profileCache = new Map()
    this._repIndex = null // { at, earliest:Map, received:Map }
  }

  me () { return this.id.me() }

  async _sign (type, data) {
    const s = await this.id.sign(canonical(type, data))
    return { _sig: s.signature, _k: s.publicKey, _dk: s.driveKey, _ns: s.namespace, _alg: s.algorithm }
  }

  // Mint PoW for an op then sign it (PoW first so it's covered by the signature).
  async _powSign (type, data, onProgress) {
    data.pow = await mint(type, data, this.minBits[type] || 0, { onProgress })
    Object.assign(data, await this._sign(type, data))
    return data
  }

  // ---- Boards ---------------------------------------------------------------
  async createBoard ({ name, description, onProgress }) {
    name = normalizeBoard(name)
    if (!isValidBoard(name)) throw new Error('Board name must be 2–24 chars: a–z, 0–9, _')
    if (await this.getBoard(name)) throw new Error('b/' + name + ' already exists')
    const me = this.me()
    const data = { id: mkid.board(name), name, description: (description || '').slice(0, 300), creator: me.pubkey, createdAt: Date.now() }
    await this._powSign(TYPE.BOARD, data, onProgress)
    await this.sync.append({ type: TYPE.BOARD, data })
    return data
  }
  async getBoard (name) { return this.sync.get(keys.board(name)) }
  async listBoards () {
    const rows = await this.sync.list(keys.boardPrefix(), { limit: 1000 })
    const list = rows.map(r => r.value).filter(Boolean)
    if (!list.find(b => b.name === DEFAULT_BOARD)) list.unshift({ name: DEFAULT_BOARD, description: 'The front page', synthetic: true })
    return list
  }

  // ---- Posts ----------------------------------------------------------------
  async submitPost ({ board, title, url, text, onProgress }) {
    board = normalizeBoard(board || DEFAULT_BOARD) || DEFAULT_BOARD
    if (!title || !title.trim()) throw new Error('A title is required')
    if (board !== DEFAULT_BOARD && !(await this.getBoard(board))) throw new Error('b/' + board + " doesn't exist")
    const me = this.me()
    const cid = uid()
    const data = {
      id: mkid.post(board, cid), cid, board, title: title.trim().slice(0, 300),
      url: (url || '').trim().slice(0, 2000), text: (text || '').slice(0, 20000),
      author: me.pubkey, createdAt: Date.now(), editedAt: 0, deleted: false
    }
    await this._powSign(TYPE.POST, data, onProgress)
    await this.sync.append({ type: TYPE.POST, data })
    return data
  }
  async getPost (board, cid) { return this.sync.get(keys.post(board, cid)) }
  async listPostsIn (board) {
    const rows = await this.sync.list(keys.postsIn(board), { limit: 1000 })
    return rows.map(r => r.value).filter(Boolean)
  }
  async listAllPosts (boards) {
    let names = boards
    if (!names) names = (await this.listBoards()).map(b => b.name)
    const lists = await Promise.all([...new Set(names)].map(b => this.listPostsIn(b).catch(() => [])))
    return lists.flat()
  }
  async editPost (board, cid, patch) {
    const p = await this.getPost(board, cid)
    if (!p) throw new Error('Post not found')
    if (p.author !== this.me().pubkey) throw new Error('You can only edit your own post')
    const data = { ...p, title: patch.title != null ? patch.title.slice(0, 300) : p.title, text: patch.text != null ? patch.text.slice(0, 20000) : p.text, editedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.POST, data)) // pow identity unchanged (cid/author/createdAt) -> no re-mint
    await this.sync.append({ type: TYPE.POST, data })
    return data
  }
  async deletePost (board, cid) {
    const p = await this.getPost(board, cid)
    if (!p) return
    if (p.author !== this.me().pubkey) throw new Error('You can only delete your own post')
    const data = { ...p, deleted: true, title: p.title, url: '', text: '', editedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.POST, data))
    await this.sync.append({ type: TYPE.POST, data })
  }

  // ---- Comments -------------------------------------------------------------
  async addComment ({ postCid, board, parentCid, body, onProgress }) {
    if (!body || !body.trim()) throw new Error('Comment cannot be empty')
    const me = this.me()
    const cid = uid()
    const data = {
      id: mkid.comment(postCid, cid), cid, postCid, board: board || DEFAULT_BOARD,
      parentCid: parentCid || null, body: body.trim().slice(0, 10000),
      author: me.pubkey, createdAt: Date.now(), editedAt: 0, deleted: false
    }
    await this._powSign(TYPE.COMMENT, data, onProgress)
    await this.sync.append({ type: TYPE.COMMENT, data })
    return data
  }
  async listComments (postCid) {
    const rows = await this.sync.list(keys.commentsOn(postCid), { limit: 1000 })
    return rows.map(r => r.value).filter(Boolean)
  }
  async editComment (postCid, cid, body) {
    const c = await this.sync.get(keys.comment(postCid, cid))
    if (!c) throw new Error('Comment not found')
    if (c.author !== this.me().pubkey) throw new Error('You can only edit your own comment')
    const data = { ...c, body: String(body || '').slice(0, 10000), editedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.COMMENT, data))
    await this.sync.append({ type: TYPE.COMMENT, data })
    return data
  }
  async deleteComment (postCid, cid) {
    const c = await this.sync.get(keys.comment(postCid, cid))
    if (!c) return
    if (c.author !== this.me().pubkey) throw new Error('You can only delete your own comment')
    const data = { ...c, deleted: true, body: '', editedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.COMMENT, data))
    await this.sync.append({ type: TYPE.COMMENT, data })
  }

  // ---- Votes ----------------------------------------------------------------
  async vote (targetCid, targetType, value) {
    const me = this.me()
    value = value === 1 ? 1 : value === -1 ? -1 : 0
    const data = { id: mkid.vote(targetCid, me.pubkey), targetCid, targetType, dir: value, author: me.pubkey, ts: Date.now() }
    Object.assign(data, await this._sign(TYPE.VOTE, data))
    await this.sync.append({ type: TYPE.VOTE, data })
    this._repIndex = null
    return data
  }
  async rawVotes (targetCid) {
    const rows = await this.sync.list(keys.votesFor(targetCid), { limit: 1000 })
    return rows.map(r => r.value).filter(Boolean)
  }

  // ---- Reputation -----------------------------------------------------------
  // One pass over all posts/comments + all votes -> per-pubkey { earliest, received }.
  // Cached briefly; rebuilt after a vote or on TTL.
  async _reputation () {
    if (this._repIndex && Date.now() - this._repIndex.at < 5000) return this._repIndex
    const earliest = new Map() // pub -> earliest activity ms
    const received = new Map() // pub -> upvotes received
    const cidAuthor = new Map() // cid -> author
    const seen = (pub, ts) => { const e = earliest.get(pub); if (e == null || ts < e) earliest.set(pub, ts) }
    const posts = await this.listAllPosts()
    for (const p of posts) { cidAuthor.set(p.cid, p.author); seen(p.author, p.createdAt) }
    await Promise.all(posts.map(async p => {
      for (const c of await this.listComments(p.cid)) { cidAuthor.set(c.cid, c.author); seen(c.author, c.createdAt) }
    }))
    const allVotes = await this.sync.list(keys.voteAll(), { limit: 1000 })
    for (const { value: v } of allVotes) {
      if (v && v.dir === 1) { const a = cidAuthor.get(v.targetCid); if (a) received.set(a, (received.get(a) || 0) + 1) }
    }
    this._repIndex = { at: Date.now(), earliest, received }
    return this._repIndex
  }

  async weightInputsFor (pub, idx) {
    idx = idx || await this._reputation()
    const earliest = idx.earliest.get(pub)
    const ageDays = earliest ? Math.max(0, (Date.now() - earliest) / DAY) : 0
    return [ageDays, idx.received.get(pub) || 0]
  }

  // Attach reputation-weighted tally to each record: .tally {up,down,score(raw),
  // weighted, myVote} and .score = weighted (for ranking).
  async withTallies (records) {
    const idx = await this._reputation()
    const me = this.me().pubkey
    const weightOf = (pub) => {
      const e = idx.earliest.get(pub)
      const ageDays = e ? Math.max(0, (Date.now() - e) / DAY) : 0
      return [ageDays, idx.received.get(pub) || 0]
    }
    return Promise.all(records.map(async r => {
      const votes = await this.rawVotes(r.cid)
      const t = weightedTally(votes, weightOf, me)
      return { ...r, tally: t, score: t.weighted }
    }))
  }

  async tallyFor (targetCid) {
    const idx = await this._reputation()
    const me = this.me().pubkey
    const weightOf = (pub) => { const e = idx.earliest.get(pub); return [e ? Math.max(0, (Date.now() - e) / DAY) : 0, idx.received.get(pub) || 0] }
    return weightedTally(await this.rawVotes(targetCid), weightOf, me)
  }

  // ---- Profiles -------------------------------------------------------------
  async setProfile ({ nick, bio }) {
    const me = this.me()
    const prev = await this.getProfile(me.pubkey)
    const data = {
      id: mkid.profile(me.pubkey), author: me.pubkey,
      nick: (nick != null ? nick : (prev && prev.nick) || '').slice(0, 24),
      bio: (bio != null ? bio : (prev && prev.bio) || '').slice(0, 300),
      createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now()
    }
    Object.assign(data, await this._sign(TYPE.PROFILE, data))
    await this.sync.append({ type: TYPE.PROFILE, data })
    this._profileCache.set(me.pubkey, { rec: data, at: Date.now() })
    return data
  }
  async getProfile (pub) {
    const c = this._profileCache.get(pub)
    if (c && Date.now() - c.at < 15000) return c.rec
    const rec = await this.sync.get(keys.profile(pub))
    this._profileCache.set(pub, { rec, at: Date.now() })
    return rec
  }
  async nickOf (pub) {
    if (!pub) return 'unknown'
    const p = await this.getProfile(pub)
    return (p && p.nick) ? p.nick : 'anon-' + pub.slice(0, 6)
  }
  invalidateProfile (pub) { this._profileCache.delete(pub) }

  // ---- Follow / block / blocklist ------------------------------------------
  async follow (target, on = true) {
    const me = this.me()
    const data = { id: mkid.follow(me.pubkey, target), author: me.pubkey, target, active: on, createdAt: Date.now(), updatedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.FOLLOW, data))
    await this.sync.append({ type: TYPE.FOLLOW, data })
    return data
  }
  unfollow (target) { return this.follow(target, false) }
  async following (pub) {
    const rows = await this.sync.list(keys.followsBy(pub), { limit: 1000 })
    return rows.map(r => r.value).filter(v => v && v.active).map(v => v.target)
  }

  async block (target, isPublic = false, on = true) {
    const me = this.me()
    const data = { id: mkid.block(me.pubkey, target), author: me.pubkey, target, public: !!isPublic, active: on, createdAt: Date.now(), updatedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.BLOCK, data))
    await this.sync.append({ type: TYPE.BLOCK, data })
    return data
  }
  unblock (target) { return this.block(target, false, false) }

  async publishBlocklist (list) {
    const me = this.me()
    const prev = await this.sync.get(keys.blocklist(me.pubkey))
    const data = { id: mkid.blocklist(me.pubkey), author: me.pubkey, list: (list || []).slice(0, 1000), version: ((prev && prev.version) || 0) + 1, updatedAt: Date.now() }
    Object.assign(data, await this._sign(TYPE.BLOCKLIST, data))
    await this.sync.append({ type: TYPE.BLOCKLIST, data })
    return data
  }
  async getBlocklist (author) { return this.sync.get(keys.blocklist(author)) }
  async listBlocklists () {
    const rows = await this.sync.list(keys.blocklistPrefix(), { limit: 1000 })
    return rows.map(r => r.value).filter(Boolean)
  }
  // Effective blocked set = local blocks + subscribed published blocklists.
  async blockedSet (localBlocks, subscribed) {
    return resolveBlocked(localBlocks, subscribed, await this.listBlocklists())
  }

  // ---- user activity (profile page) ----------------------------------------
  async userActivity (pub) {
    const posts = []
    const comments = []
    for (const p of await this.listAllPosts()) {
      if (p.author === pub && !p.deleted) posts.push(p)
      for (const c of await this.listComments(p.cid)) {
        if (c.author === pub && !c.deleted) comments.push({ ...c, postTitle: p.title, board: p.board })
      }
    }
    return { posts, comments }
  }

  async status () { return this.sync.status() }
}

export function createData (sync, identity, opts) { return new Data(sync, identity, opts) }
