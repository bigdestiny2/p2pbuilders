'use strict'

const cenc = require('compact-encoding')
const b4a = require('b4a')

const SCHEMA_VERSION = 1

const TYPE = {
  POST: 1,
  COMMENT: 2,
  VOTE: 3,
  EDIT: 4,
  TOMBSTONE: 5,
  FOLLOW: 6,
  BLOCK: 7,
  PROFILE: 8,
  BOARD_CREATE: 9,
  BLOCKLIST_PUBLISH: 10
}

const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k.toLowerCase()]))

const REQUIRES_POW = new Set([TYPE.POST, TYPE.COMMENT, TYPE.BOARD_CREATE])

const OP_ID_BYTES = 40 // 32-byte pubkey + 8-byte seq

function makeOpId (pubkey, seq) {
  if (pubkey.length !== 32) throw new Error('pubkey must be 32 bytes')
  const out = b4a.alloc(OP_ID_BYTES)
  out.set(pubkey, 0)
  const view = new DataView(out.buffer, out.byteOffset + 32, 8)
  view.setBigUint64(0, BigInt(seq), false) // big-endian
  return out
}

function parseOpId (opId) {
  if (opId.length !== OP_ID_BYTES) throw new Error('opId must be 40 bytes')
  const view = new DataView(opId.buffer, opId.byteOffset + 32, 8)
  return { pubkey: opId.subarray(0, 32), seq: Number(view.getBigUint64(0, false)) }
}

// --- payload encoders per type ---

const optionalString = {
  preencode (state, s) {
    cenc.bool.preencode(state, !!s)
    if (s) cenc.string.preencode(state, s)
  },
  encode (state, s) {
    cenc.bool.encode(state, !!s)
    if (s) cenc.string.encode(state, s)
  },
  decode (state) {
    return cenc.bool.decode(state) ? cenc.string.decode(state) : null
  }
}

const opIdEnc = cenc.fixed(OP_ID_BYTES)
const pubkeyEnc = cenc.fixed(32)

const payloadEncoders = {
  [TYPE.POST]: {
    preencode (state, p) {
      cenc.string.preencode(state, p.board)
      cenc.string.preencode(state, p.title)
      cenc.string.preencode(state, p.body)
      optionalString.preencode(state, p.link)
    },
    encode (state, p) {
      cenc.string.encode(state, p.board)
      cenc.string.encode(state, p.title)
      cenc.string.encode(state, p.body)
      optionalString.encode(state, p.link)
    },
    decode (state) {
      return {
        board: cenc.string.decode(state),
        title: cenc.string.decode(state),
        body: cenc.string.decode(state),
        link: optionalString.decode(state)
      }
    }
  },
  [TYPE.COMMENT]: {
    preencode (state, p) { opIdEnc.preencode(state, p.parent); cenc.string.preencode(state, p.body) },
    encode (state, p) { opIdEnc.encode(state, p.parent); cenc.string.encode(state, p.body) },
    decode (state) { return { parent: opIdEnc.decode(state), body: cenc.string.decode(state) } }
  },
  [TYPE.VOTE]: {
    preencode (state, p) { opIdEnc.preencode(state, p.target); cenc.int8.preencode(state, p.dir) },
    encode (state, p) { opIdEnc.encode(state, p.target); cenc.int8.encode(state, p.dir) },
    decode (state) { return { target: opIdEnc.decode(state), dir: cenc.int8.decode(state) } }
  },
  [TYPE.EDIT]: {
    preencode (state, p) {
      opIdEnc.preencode(state, p.target)
      cenc.string.preencode(state, p.body)
      optionalString.preencode(state, p.title)
    },
    encode (state, p) {
      opIdEnc.encode(state, p.target)
      cenc.string.encode(state, p.body)
      optionalString.encode(state, p.title)
    },
    decode (state) {
      return {
        target: opIdEnc.decode(state),
        body: cenc.string.decode(state),
        title: optionalString.decode(state)
      }
    }
  },
  [TYPE.TOMBSTONE]: {
    preencode (state, p) { opIdEnc.preencode(state, p.target) },
    encode (state, p) { opIdEnc.encode(state, p.target) },
    decode (state) { return { target: opIdEnc.decode(state) } }
  },
  [TYPE.FOLLOW]: {
    preencode (state, p) { pubkeyEnc.preencode(state, p.target) },
    encode (state, p) { pubkeyEnc.encode(state, p.target) },
    decode (state) { return { target: pubkeyEnc.decode(state) } }
  },
  [TYPE.BLOCK]: {
    preencode (state, p) { pubkeyEnc.preencode(state, p.target); cenc.bool.preencode(state, !!p.public) },
    encode (state, p) { pubkeyEnc.encode(state, p.target); cenc.bool.encode(state, !!p.public) },
    decode (state) { return { target: pubkeyEnc.decode(state), public: cenc.bool.decode(state) } }
  },
  [TYPE.PROFILE]: {
    preencode (state, p) {
      cenc.string.preencode(state, p.nick)
      optionalString.preencode(state, p.bio)
      optionalString.preencode(state, p.avatar)
    },
    encode (state, p) {
      cenc.string.encode(state, p.nick)
      optionalString.encode(state, p.bio)
      optionalString.encode(state, p.avatar)
    },
    decode (state) {
      return {
        nick: cenc.string.decode(state),
        bio: optionalString.decode(state),
        avatar: optionalString.decode(state)
      }
    }
  },
  [TYPE.BOARD_CREATE]: {
    preencode (state, p) {
      cenc.string.preencode(state, p.name)
      cenc.string.preencode(state, p.description)
      cenc.uint8.preencode(state, p.minPowBits)
    },
    encode (state, p) {
      cenc.string.encode(state, p.name)
      cenc.string.encode(state, p.description)
      cenc.uint8.encode(state, p.minPowBits)
    },
    decode (state) {
      return {
        name: cenc.string.decode(state),
        description: cenc.string.decode(state),
        minPowBits: cenc.uint8.decode(state)
      }
    }
  },
  [TYPE.BLOCKLIST_PUBLISH]: {
    preencode (state, p) {
      cenc.uint32.preencode(state, p.version)
      cenc.uint32.preencode(state, p.list.length)
      for (const k of p.list) pubkeyEnc.preencode(state, k)
    },
    encode (state, p) {
      cenc.uint32.encode(state, p.version)
      cenc.uint32.encode(state, p.list.length)
      for (const k of p.list) pubkeyEnc.encode(state, k)
    },
    decode (state) {
      const version = cenc.uint32.decode(state)
      const n = cenc.uint32.decode(state)
      const list = []
      for (let i = 0; i < n; i++) list.push(pubkeyEnc.decode(state))
      return { version, list }
    }
  }
}

// --- op encoder ---

// Wire format:
//   uint8  v
//   uint8  type
//   uint64 ts
//   <payload>
//   uint8  powFlag (0 or 1)
//   [uint8 bits, fixed8 nonce] if powFlag=1

const NONCE_BYTES = 8
const nonceEnc = cenc.fixed(NONCE_BYTES)

const op = {
  preencode (state, o) {
    cenc.uint8.preencode(state, o.v)
    cenc.uint8.preencode(state, o.type)
    cenc.uint64.preencode(state, o.ts)
    payloadEncoders[o.type].preencode(state, o.payload)
    cenc.uint8.preencode(state, o.pow ? 1 : 0)
    if (o.pow) {
      cenc.uint8.preencode(state, o.pow.bits)
      nonceEnc.preencode(state, o.pow.nonce)
    }
  },
  encode (state, o) {
    cenc.uint8.encode(state, o.v)
    cenc.uint8.encode(state, o.type)
    cenc.uint64.encode(state, o.ts)
    payloadEncoders[o.type].encode(state, o.payload)
    cenc.uint8.encode(state, o.pow ? 1 : 0)
    if (o.pow) {
      cenc.uint8.encode(state, o.pow.bits)
      nonceEnc.encode(state, o.pow.nonce)
    }
  },
  decode (state) {
    const v = cenc.uint8.decode(state)
    const type = cenc.uint8.decode(state)
    const ts = cenc.uint64.decode(state)
    const payload = payloadEncoders[type].decode(state)
    const flag = cenc.uint8.decode(state)
    let pow = null
    if (flag === 1) {
      pow = { bits: cenc.uint8.decode(state), nonce: nonceEnc.decode(state) }
    }
    return { v, type, ts, payload, pow }
  }
}

// Preimage = everything EXCEPT the pow field.
// Used to compute the PoW hash. Nonce is appended to this buffer to hash.
const preimage = {
  preencode (state, o) {
    cenc.uint8.preencode(state, o.v)
    cenc.uint8.preencode(state, o.type)
    cenc.uint64.preencode(state, o.ts)
    payloadEncoders[o.type].preencode(state, o.payload)
  },
  encode (state, o) {
    cenc.uint8.encode(state, o.v)
    cenc.uint8.encode(state, o.type)
    cenc.uint64.encode(state, o.ts)
    payloadEncoders[o.type].encode(state, o.payload)
  }
}

function encodeOp (o) { return cenc.encode(op, o) }
function decodeOp (buf) { return cenc.decode(op, buf) }
function encodePreimage (o) { return cenc.encode(preimage, o) }

module.exports = {
  SCHEMA_VERSION,
  TYPE,
  TYPE_NAME,
  REQUIRES_POW,
  OP_ID_BYTES,
  NONCE_BYTES,
  makeOpId,
  parseOpId,
  encodeOp,
  decodeOp,
  encodePreimage
}
