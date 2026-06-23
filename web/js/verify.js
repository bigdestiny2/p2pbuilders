// verify.js — record authenticity. The ONLY thing that makes a record
// trustworthy is a valid Ed25519 signature from the key it claims as author.
// The transport (which outbox relayed it) carries no authority — so an attacker
// who relays a victim-labelled outbox full of fabricated records gains nothing:
// every fabricated record fails this check and is dropped by the merge.
//
//   verifyRecord -> 'ok'           signature valid, signer === claimed author
//                   'bad'          forged / tampered / wrong signer / unsigned (secure mode)
//                   'unverifiable' no crypto backend at all (cooperative dev only)

import { canonical, ownerOf } from './canon.js'
import { verify as edVerify, isSecure, ready as cryptoReady } from './crypto.js'

const HEX64 = /^[0-9a-f]{64}$/i
const NS = 'peerit'

function signedMessage (type, data) {
  // Matches what identity.sign signs: pear.app.<driveKey>:<namespace>:<payload>.
  // _ns is pinned to the constant and _dk is validated as 64-hex by the caller,
  // so neither can contain a ':' that would shift the field boundaries.
  return `pear.app.${data._dk}:${NS}:` + canonical(type, data)
}

export async function verifyRecord (type, data) {
  if (!data || !data._k) return 'unverifiable'
  // The signer must BE the claimed author — no signing as someone else.
  if (data._k !== ownerOf(type, data)) return 'bad'
  await cryptoReady()
  if (!isSecure()) return 'unverifiable' // no platform crypto -> cooperative dev
  if (!data._sig) return 'bad'           // secure mode: unsigned is untrusted
  // Domain pinning: reject anything not signed in peerit's own context, and any
  // malformed driveKey/pubkey that could make the signed envelope ambiguous.
  if (data._ns !== NS) return 'bad'
  if (!HEX64.test(data._dk || '') || !HEX64.test(data._k)) return 'bad'
  return (await edVerify(data._k, signedMessage(type, data), data._sig)) ? 'ok' : 'bad'
}
