// crypto.js — real Ed25519, the authenticity backbone of the gossip network.
//
// A record is trusted ONLY because it carries a valid Ed25519 signature from its
// author's key — never because of which outbox relayed it. This module provides
// that signing/verification over whatever platform crypto is available:
//
//   1. WebCrypto SubtleCrypto Ed25519 (PearBrowser / modern browsers, and Node 20+)
//   2. node:crypto Ed25519 (test runner / older Node)
//   3. none  -> cooperative dev fallback (clearly marked insecure; see gossip.js)
//
// Keys are handled as a 32-byte seed (hex) so DevIdentity can persist them.
// All ops are async (Subtle is async); callers await.

const PKCS8_PREFIX = '302e020100300506032b657004220420' // Ed25519 PKCS8 header for a 32B seed
const SPKI_PREFIX = '302a300506032b6570032100'           // Ed25519 SPKI header for a 32B pubkey

const toHex = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0'); return s }
const fromHex = (h) => { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a }
const concat = (a, b) => { const u = new Uint8Array(a.length + b.length); u.set(a, 0); u.set(b, a.length); return u }
const utf8 = (s) => new TextEncoder().encode(s)

let backend = null // 'subtle' | 'node' | 'none'
let nodeCrypto = null
let _ready = null

async function detect () {
  // Prefer SubtleCrypto Ed25519.
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle
    if (subtle) {
      const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
      const msg = utf8('peerit-selftest')
      const sig = await subtle.sign({ name: 'Ed25519' }, kp.privateKey, msg)
      const okk = await subtle.verify({ name: 'Ed25519' }, kp.publicKey, sig, msg)
      if (okk) { backend = 'subtle'; return }
    }
  } catch {}
  // Fall back to node:crypto.
  try {
    const mod = await import('node:crypto')
    nodeCrypto = mod.default || mod
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519')
    const sig = nodeCrypto.sign(null, utf8('peerit-selftest'), privateKey)
    if (nodeCrypto.verify(null, utf8('peerit-selftest'), publicKey, sig)) { backend = 'node'; return }
  } catch {}
  backend = 'none'
}

export function ready () { if (!_ready) _ready = detect(); return _ready }
export function isSecure () { return backend === 'subtle' || backend === 'node' }
export function backendName () { return backend }

// --- node helpers ---
function nodePriv (seedHex) { return nodeCrypto.createPrivateKey({ key: Buffer.from(PKCS8_PREFIX + seedHex, 'hex'), format: 'der', type: 'pkcs8' }) }
function nodePub (pubHex) { return nodeCrypto.createPublicKey({ key: Buffer.from(SPKI_PREFIX + pubHex, 'hex'), format: 'der', type: 'spki' }) }

// --- subtle helpers ---
async function subtlePriv (seedHex) {
  return globalThis.crypto.subtle.importKey('pkcs8', fromHex(PKCS8_PREFIX + seedHex), { name: 'Ed25519' }, false, ['sign'])
}
async function subtlePub (pubHex) {
  return globalThis.crypto.subtle.importKey('raw', fromHex(pubHex), { name: 'Ed25519' }, false, ['verify'])
}

// Generate a keypair. Returns { seedHex (private, 32B), pubHex (public, 32B) }.
export async function genKeyPair () {
  await ready()
  if (backend === 'subtle') {
    const kp = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', kp.privateKey))
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', kp.publicKey))
    return { seedHex: toHex(pkcs8.slice(-32)), pubHex: toHex(raw) }
  }
  if (backend === 'node') {
    const { privateKey } = nodeCrypto.generateKeyPairSync('ed25519')
    const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' })
    const seedHex = toHex(new Uint8Array(pkcs8).slice(-32))
    const spki = nodeCrypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
    return { seedHex, pubHex: toHex(new Uint8Array(spki).slice(-32)) }
  }
  // insecure cooperative fallback — random ids, no real keys
  const rnd = () => { let s = ''; for (let i = 0; i < 64; i++) s += Math.floor(Math.random() * 16).toString(16); return s }
  return { seedHex: rnd(), pubHex: rnd() }
}

// Sign a string message with a seed. Returns hex signature ('' in fallback).
export async function sign (seedHex, message) {
  await ready()
  if (backend === 'subtle') return toHex(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, await subtlePriv(seedHex), utf8(message)))
  if (backend === 'node') return toHex(nodeCrypto.sign(null, utf8(message), nodePriv(seedHex)))
  return '' // fallback: no signature
}

// Verify a hex signature of a string message against a public key. async -> bool.
export async function verify (pubHex, message, sigHex) {
  await ready()
  if (!sigHex || !pubHex) return false
  try {
    if (backend === 'subtle') return await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await subtlePub(pubHex), fromHex(sigHex), utf8(message))
    if (backend === 'node') return nodeCrypto.verify(null, utf8(message), nodePub(pubHex), Buffer.from(sigHex, 'hex'))
  } catch { return false }
  return false
}
