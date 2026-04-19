'use strict'

const b4a = require('b4a')
const { EventEmitter } = require('#events')
const { openDiskNode, openTempNode } = require('./store')
const { SwarmHub } = require('./swarm')
const { setupAnnounce } = require('./announce')
const board = require('./board')
const ops = require('./ops')
const pow = require('./pow')

const { TYPE, REQUIRES_POW, SCHEMA_VERSION, makeOpId, encodeOp, decodeOp } = ops

const DEFAULT_POW_BITS_BY_TYPE = {
  [TYPE.POST]: pow.DEFAULT_BITS.post,
  [TYPE.COMMENT]: pow.DEFAULT_BITS.comment,
  [TYPE.BOARD_CREATE]: pow.DEFAULT_BITS.board_create
}

class Node extends EventEmitter {
  constructor ({ store, core, primaryKey, cleanup }) {
    super()
    this.store = store
    this.core = core
    this.primaryKey = primaryKey
    this._cleanup = cleanup
    this.swarm = null
    this._tracked = new Map() // hex(pubkey) -> remote Hypercore
  }

  static async openDisk (dir, opts) {
    const node = new Node(await openDiskNode(dir))
    if (opts?.swarm) await node.attachSwarm(opts.swarm)
    return node
  }

  static async openTemp (opts = {}) {
    const node = new Node(await openTempNode(opts))
    if (opts.swarm) await node.attachSwarm(opts.swarm)
    return node
  }

  get pubkey () { return this.core.key }
  get length () { return this.core.length }

  async attachSwarm ({ bootstrap, keyPair, autoTrack = true, relays = [] } = {}) {
    if (this.swarm) throw new Error('swarm already attached')
    const onConnection = ({ muxer }) => {
      setupAnnounce(muxer, {
        selfPubkey: this.pubkey,
        getKnownKeys: () => this._knownKeys(),
        onKey: (pubkey) => {
          if (autoTrack) this.trackUser(pubkey).catch(err => this.emit('error', err))
          this.emit('announce', pubkey)
        }
      })
    }
    this.swarm = new SwarmHub(this.store, { bootstrap, keyPair, onConnection })
    for (const pk of relays) this.swarm.joinPeer(pk)
    return this.swarm
  }

  _knownKeys () {
    const keys = [b4a.from(this.pubkey)]
    for (const core of this._tracked.values()) keys.push(b4a.from(core.key))
    return keys
  }

  async joinBoard (name) {
    if (!this.swarm) throw new Error('no swarm attached')
    return this.swarm.joinBoard(board.boardTopic(name))
  }

  async leaveBoard (name) {
    if (!this.swarm) throw new Error('no swarm attached')
    return this.swarm.leaveBoard(board.boardTopic(name))
  }

  // Runtime-level "start replicating this pubkey's core into my store."
  // Distinct from the `follow` op which is the on-chain intent.
  async trackUser (pubkey) {
    const key = b4a.toString(pubkey, 'hex')
    const existing = this._tracked.get(key)
    if (existing) return existing
    const remote = this.store.get({ key: pubkey })
    await remote.ready()
    this._tracked.set(key, remote)
    // Start an open-ended download — this marks the replicator as "downloading",
    // which triggers Corestore's ondownloading → attach to all existing muxers,
    // and continues to pull future data.
    remote.download({ start: 0, end: -1 })
    // findingPeers keeps update()/get() from giving up before a peer attaches.
    // We leave the token hanging open (session lifetime) — Hypercore allows it;
    // it costs a small counter. close() takes care of teardown.
    const done = remote.findingPeers()
    remote.on('close', done)
    this.emit('track', pubkey)
    return remote
  }

  userCore (pubkey) {
    if (b4a.equals(pubkey, this.pubkey)) return this.core
    return this._tracked.get(b4a.toString(pubkey, 'hex')) || null
  }

  async close () {
    if (this.swarm) await this.swarm.destroy()
    for (const core of this._tracked.values()) await core.close()
    await this.core.close()
    await this.store.close()
    if (this._cleanup) this._cleanup()
  }

  // --- low-level: append a raw op object, minting PoW if required ---
  async append (type, payload, { bits, ts } = {}) {
    const op = {
      v: SCHEMA_VERSION,
      type,
      ts: ts ?? Date.now(),
      payload,
      pow: null
    }
    if (REQUIRES_POW.has(type)) {
      const powBits = bits ?? DEFAULT_POW_BITS_BY_TYPE[type]
      op.pow = pow.mint(op, powBits)
    }
    const seq = this.core.length
    const buf = encodeOp(op)
    await this.core.append(buf)
    return { op, opId: makeOpId(this.pubkey, seq), seq }
  }

  // --- high-level ops ---
  async post (board, title, body, { link, bits, ts } = {}) {
    return this.append(TYPE.POST, { board, title, body, link: link || null }, { bits, ts })
  }

  async comment (parent, body, { bits, ts } = {}) {
    return this.append(TYPE.COMMENT, { parent, body }, { bits, ts })
  }

  async vote (target, dir, { ts } = {}) {
    if (dir !== 1 && dir !== -1 && dir !== 0) throw new Error('dir must be -1, 0, or +1')
    return this.append(TYPE.VOTE, { target, dir }, { ts })
  }

  async edit (target, body, { title, ts } = {}) {
    return this.append(TYPE.EDIT, { target, body, title: title || null }, { ts })
  }

  async tombstone (target, { ts } = {}) {
    return this.append(TYPE.TOMBSTONE, { target }, { ts })
  }

  async follow (target, { ts } = {}) { return this.append(TYPE.FOLLOW, { target }, { ts }) }
  async block (target, { public: pub = false, ts } = {}) {
    return this.append(TYPE.BLOCK, { target, public: pub }, { ts })
  }
  async setProfile ({ nick, bio, avatar, ts } = {}) {
    return this.append(TYPE.PROFILE, { nick, bio: bio || null, avatar: avatar || null }, { ts })
  }
  async createBoard (name, description, { minPowBits = pow.DEFAULT_BITS.post, ts } = {}) {
    return this.append(TYPE.BOARD_CREATE, { name, description, minPowBits }, { ts })
  }
  async publishBlocklist (list, version, { ts } = {}) {
    return this.append(TYPE.BLOCKLIST_PUBLISH, { list, version }, { ts })
  }

  // --- reading ---
  async getOp (seq) {
    const buf = await this.core.get(seq)
    return decodeOp(buf)
  }

  async * ops ({ start = 0, end } = {}) {
    const last = end ?? this.core.length
    for (let i = start; i < last; i++) {
      yield { seq: i, opId: makeOpId(this.pubkey, i), op: await this.getOp(i) }
    }
  }

  // Read ops from a tracked remote user's core. Caller should await updates first.
  async * userOps (pubkey, { start = 0, end } = {}) {
    const core = this.userCore(pubkey)
    if (!core) throw new Error('user not tracked; call trackUser() first')
    const last = end ?? core.length
    for (let i = start; i < last; i++) {
      const buf = await core.get(i)
      yield { seq: i, opId: makeOpId(pubkey, i), op: decodeOp(buf) }
    }
  }
}

module.exports = { Node, DEFAULT_POW_BITS_BY_TYPE }
