'use strict'

const sodium = require('sodium-universal')
const b4a = require('b4a')
const { encodePreimage, NONCE_BYTES } = require('./ops')

const HASH_BYTES = 32

const DEFAULT_BITS = {
  comment: 16,
  post: 18,
  board_create: 22
}

function blake2b (input, out) {
  out = out || b4a.alloc(HASH_BYTES)
  sodium.crypto_generichash(out, input)
  return out
}

function leadingZeroBits (buf) {
  let bits = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b === 0) { bits += 8; continue }
    // count leading zeros in this byte
    for (let m = 0x80; m; m >>>= 1) {
      if (b & m) return bits
      bits++
    }
    return bits
  }
  return bits
}

function digestPreimage (op) {
  return blake2b(encodePreimage(op))
}

function hashWithNonce (digest, nonce, out) {
  const buf = b4a.alloc(digest.length + nonce.length)
  buf.set(digest, 0)
  buf.set(nonce, digest.length)
  return blake2b(buf, out)
}

function writeNonce (nonce, counter) {
  // 8-byte big-endian counter, room to grow
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.length)
  view.setBigUint64(0, BigInt(counter), false)
}

function mint (op, bits, { maxAttempts = 1e9 } = {}) {
  const digest = digestPreimage(op)
  const nonce = b4a.alloc(NONCE_BYTES)
  const hashOut = b4a.alloc(HASH_BYTES)
  for (let counter = 0; counter < maxAttempts; counter++) {
    writeNonce(nonce, counter)
    hashWithNonce(digest, nonce, hashOut)
    if (leadingZeroBits(hashOut) >= bits) {
      return { bits, nonce: b4a.from(nonce) }
    }
  }
  throw new Error(`pow mint exceeded ${maxAttempts} attempts`)
}

function verify (op, bits) {
  if (!op.pow) return false
  if (op.pow.bits < bits) return false
  const digest = digestPreimage(op)
  const hash = hashWithNonce(digest, op.pow.nonce)
  return leadingZeroBits(hash) >= op.pow.bits
}

module.exports = {
  DEFAULT_BITS,
  HASH_BYTES,
  leadingZeroBits,
  digestPreimage,
  mint,
  verify
}
