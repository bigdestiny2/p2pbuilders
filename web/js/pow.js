// pow.js — proof-of-work spam gate (hashcash). The terminal app uses blake2b;
// the browser port uses SHA-256 (SubtleCrypto, available everywhere). To submit
// a post/comment/board you must find a nonce whose SHA-256(content|nonce) has at
// least N leading zero bits — cheap once, expensive to spam. The pow {bits,nonce}
// is part of the signed record, and is re-verified by every peer on ingest (via
// the gossip `validate` hook), so unworked posts never enter the network.

// Minimum difficulty per record type. Tuned for the browser (SubtleCrypto is
// slower per hash than native blake2b, so these are lower than the terminal app's
// 18/16/22). Empirically a few hundred ms to a couple seconds.
export const MIN_BITS = { post: 16, comment: 14, board: 18 }

// The bytes hashed for PoW: each op's IMMUTABLE identity (unique cid + author +
// createdAt), not its mutable body. So creating an op costs work, editing/deleting
// it reuses that work, and one op's proof can't be reused for another (unique cid).
// The signature separately covers the whole record (incl. pow), so pow can't be
// swapped or altered after the fact.
export function powTarget (type, data) {
  switch (type) {
    case 'post': return `post|${data.board}|${data.cid}|${data.author}|${data.createdAt}`
    case 'comment': return `comment|${data.postCid}|${data.cid}|${data.author}|${data.createdAt}`
    case 'board': return `board|${data.name}|${data.creator}|${data.createdAt}`
    default: return type + '|' + (data.author || '')
  }
}

function leadingZeroBits (u8) {
  let n = 0
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i]
    if (b === 0) { n += 8; continue }
    n += Math.clz32(b) - 24
    break
  }
  return n
}

async function sha256 (str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return new Uint8Array(buf)
}

// Mint a proof for `data`. Returns { bits, nonce }. Yields to the event loop
// periodically and reports progress so the UI stays responsive.
export async function mint (type, data, bits, opts = {}) {
  const target = powTarget(type, data)
  let nonce = 0
  for (;;) {
    const h = await sha256(target + '|' + nonce)
    if (leadingZeroBits(h) >= bits) return { bits, nonce }
    nonce++
    if ((nonce & 1023) === 0) {
      if (opts.onProgress) opts.onProgress(nonce)
      if (opts.signal && opts.signal.aborted) throw new Error('proof-of-work cancelled')
      await new Promise(r => setTimeout(r, 0))
    }
  }
}

// Verify a record carries valid PoW of at least minBits.
export async function verify (type, data, minBits) {
  const pow = data && data.pow
  if (!pow || typeof pow.bits !== 'number' || typeof pow.nonce !== 'number') return false
  if (pow.bits < minBits) return false
  const h = await sha256(powTarget(type, data) + '|' + pow.nonce)
  return leadingZeroBits(h) >= pow.bits
}

// Build the gossip `validate` gate: posts/comments/boards must carry valid PoW;
// votes/profiles/follows/blocks/blocklists are exempt (rate/reputation-gated).
export function makeValidator (minBits = MIN_BITS) {
  return async (type, val) => {
    if (type === 'post') return verify(type, val, minBits.post)
    if (type === 'comment') return verify(type, val, minBits.comment)
    if (type === 'board') return verify(type, val, minBits.board)
    return true
  }
}

export { leadingZeroBits }
