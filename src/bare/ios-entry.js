'use strict'

// Entry point for bare-kit-pear (and holepunchto/bare-kit) on iOS.
//
// bare-kit exposes a GLOBAL `BareKit.IPC` object inside every worklet. It's a
// Duplex-shaped pipe auto-wired to the native host via `bare_ipc_init()` —
// no require, no argv, no manual setup needed.
//
// Native pattern on the Swift side (bare-kit's holepunchto/bare-ios example):
//   1. [BareWorklet start:source:arguments:] loads this file.
//   2. bare_ipc_init(&ipc, &worklet) wires up the native ↔ JS pipe.
//   3. Swift uses [ipc read] / [ipc write:data] to speak to us.
//
// JS-side usage:
//   BareKit.IPC.on('data', chunk => ...)
//   BareKit.IPC.write(bytes)
//
// We plug that straight into harness.start({pipe}) so the exact same
// line-delimited JSON-RPC protocol as the Pear worker and the WebSocket
// transport works here too.

/* global BareKit, Bare */

const { path, os, env, exit } = require('../backend/_rt')
const { start } = require('./harness')

function resolvePipe () {
  // Primary: bare-kit's global IPC (iOS, Android, desktop bare-kit hosts)
  if (typeof BareKit !== 'undefined' && BareKit.IPC) return BareKit.IPC

  // Secondary: some SDK builds expose it under Bare.IPC instead
  if (typeof Bare !== 'undefined' && Bare.IPC && typeof Bare.IPC.on === 'function') {
    return Bare.IPC
  }

  // Fallback: running under plain `bare` with no host — no pipe available.
  return null
}

function resolveStorageDir () {
  // bare-kit hosts typically pass a per-app storage path via env or argv.
  // Fallbacks let this run under standalone `bare` for smoke-testing.
  return (
    env.P2PBUILDERS_DIR ||
    (typeof Bare !== 'undefined' && Bare.argv && Bare.argv[2]) ||
    path.join(os.tmpdir(), 'p2pbuilders-ios')
  )
}

;(async () => {
  const pipe = resolvePipe()
  const dir = resolveStorageDir()

  const app = await start({
    dir,
    swarm: {}, // default hyperswarm; bare-kit provides UDP on iOS
    pipe,
    onReady ({ pubkey }) {
      const greeting = JSON.stringify({ event: 'ready', pubkey, dir }) + '\n'
      if (pipe) {
        pipe.write(greeting)
      } else {
        console.log(`[p2pbuilders-ios] ready  pubkey=${pubkey}  dir=${dir}`)
        console.log('[p2pbuilders-ios] no BareKit.IPC found; running headless.')
      }
    }
  })

  // Graceful shutdown when the host detaches the pipe.
  if (pipe && typeof pipe.on === 'function') {
    pipe.on('end', () => app.close())
    pipe.on('close', () => app.close())
  }

  // Bare-kit suspend/resume lifecycle hints (keeps the IPC refcount sensible).
  if (typeof Bare !== 'undefined' && Bare.on) {
    if (pipe && typeof pipe.ref === 'function') {
      Bare.on('suspend', () => { try { pipe.unref() } catch {} })
      Bare.on('resume', () => { try { pipe.ref() } catch {} })
    }
  }
})().catch((err) => {
  console.error('[p2pbuilders-ios] fatal:', err && err.stack ? err.stack : err.message)
  exit(1)
})
