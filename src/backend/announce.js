'use strict'

const cenc = require('compact-encoding')
const b4a = require('b4a')

const PROTOCOL = 'p2pbuilders/announce/v1'
const PUBKEY_BYTES = 32
const MAX_KEYS_PER_ANNOUNCE = 256

const pubkeyArray = cenc.array(cenc.fixed(PUBKEY_BYTES))

// Wire up the announce channel on an existing protomux muxer.
// Options:
//   selfPubkey      — our own user pubkey (so we don't echo it back)
//   getKnownKeys()  — returns Buffer[] of pubkeys we'd like to gossip
//   onKey(pubkey)   — callback for each new pubkey the peer announces
function setupAnnounce (muxer, { selfPubkey, getKnownKeys, onKey }) {
  let keysMsg
  const channel = muxer.createChannel({
    protocol: PROTOCOL,
    onopen () {
      const keys = getKnownKeys().slice(0, MAX_KEYS_PER_ANNOUNCE)
      keysMsg.send(keys)
    }
  })
  if (!channel) return null // peer doesn't support the protocol
  keysMsg = channel.addMessage({
    encoding: pubkeyArray,
    onmessage (keys) {
      for (const k of keys) {
        if (k.length !== PUBKEY_BYTES) continue
        if (b4a.equals(k, selfPubkey)) continue
        try { onKey(k) } catch { /* ignore per-key errors */ }
      }
    }
  })
  channel.open()
  return channel
}

module.exports = { setupAnnounce, PROTOCOL, MAX_KEYS_PER_ANNOUNCE }
