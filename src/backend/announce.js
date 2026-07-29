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
//   onOpen(handle)  — channel is live; handle.sendKeys() can push later updates
//   onClose(handle) — channel closed; drop the handle
// Returns a handle with sendKeys(keys) for announcing keys learned after the
// initial exchange (transitive gossip), or null if the peer lacks the protocol.
function setupAnnounce (muxer, { selfPubkey, getKnownKeys, onKey, onOpen, onClose }) {
  let keysMsg
  let handle
  const channel = muxer.createChannel({
    protocol: PROTOCOL,
    onopen () {
      const keys = getKnownKeys().slice(0, MAX_KEYS_PER_ANNOUNCE)
      keysMsg.send(keys)
      if (onOpen) onOpen(handle)
    },
    onclose () {
      if (onClose) onClose(handle)
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
  handle = {
    channel,
    sendKeys (keys) {
      if (!keys.length) return
      keysMsg.send(keys.slice(0, MAX_KEYS_PER_ANNOUNCE))
    }
  }
  channel.open()
  return handle
}

module.exports = { setupAnnounce, PROTOCOL, MAX_KEYS_PER_ANNOUNCE }
