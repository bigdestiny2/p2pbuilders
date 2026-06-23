// canon.js — canonical serialization, owner binding, key binding, and sticky-name
// classification. Shared by the signer (data.js), verifier (verify.js), gossip
// merge (gossip.js), and proof-of-work (pow.js). One definition so a signature
// covers exactly the bytes that get checked.

import { TYPE, keys } from './model.js'

// The pubkey that must have authored a record of this type (signer must match).
export function ownerOf (type, data) {
  return type === TYPE.BOARD ? data.creator : data.author
}

// Sticky-name key (first-creator-wins) for named records — boards. null = not sticky.
export function stickyKey (type, data) {
  return type === TYPE.BOARD ? data.name : null
}

// The Hyperbee key a record MUST occupy, recomputed from its own fields.
export function expectedKey (type, data) {
  switch (type) {
    case TYPE.BOARD: return data.name != null ? keys.board(data.name) : null
    case TYPE.POST: return data.board != null && data.cid != null ? keys.post(data.board, data.cid) : null
    case TYPE.COMMENT: return data.postCid != null && data.cid != null ? keys.comment(data.postCid, data.cid) : null
    case TYPE.VOTE: return data.targetCid != null && data.author != null ? keys.vote(data.targetCid, data.author) : null
    case TYPE.PROFILE: return data.author != null ? keys.profile(data.author) : null
    case TYPE.FOLLOW: return data.author != null && data.target != null ? keys.follow(data.author, data.target) : null
    case TYPE.BLOCK: return data.author != null && data.target != null ? keys.block(data.author, data.target) : null
    case TYPE.BLOCKLIST: return data.author != null ? keys.blocklist(data.author) : null
    default: return null
  }
}

const SIG_FIELDS = new Set(['_sig', '_k', '_dk', '_ns', '_alg'])

// Deterministic, key-sorted JSON of a value, omitting signature metadata and any
// extra keys requested (used by PoW to hash content WITHOUT the pow field).
export function stableStringify (v, omit) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v)
  if (Array.isArray(v)) return '[' + v.map(x => stableStringify(x, omit)).join(',') + ']'
  const ks = Object.keys(v).filter(k => !SIG_FIELDS.has(k) && !(omit && omit.has(k))).sort()
  return '{' + ks.map(k => JSON.stringify(k) + ':' + stableStringify(v[k], omit)).join(',') + '}'
}

// Covers EVERY content field automatically (incl. the pow field), so any tamper
// invalidates the signature.
export function canonical (type, data) {
  return type + '|' + stableStringify(data)
}

export function typeFromKey (key) { return String(key).split('!')[0] }

export function recordTs (data) {
  return (data && (data.editedAt || data.updatedAt || data.ts || data.createdAt)) || 0
}
