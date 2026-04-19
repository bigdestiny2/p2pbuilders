'use strict'

// P2PBuilders hiverelay — a long-running peer that seeds user cores AND (optionally)
// exposes a DHT-relay WebSocket endpoint so browser clients can tunnel through.
//
// Usage:
//   P2PBUILDERS_DIR=./.relay \
//   P2PBUILDERS_BOARDS=front,meta \
//   P2PBUILDERS_DHT_RELAY_PORT=8443 \
//     node src/relay/server.js
//
// Two cooperating services run in one process:
//   1. Pinning node     — joins board topics, auto-tracks announced pubkeys,
//                         keeps cores replicated 24/7 (blind seeding).
//   2. DHT relay (WS)   — wraps the shared HyperDHT instance with
//                         @hyperswarm/dht-relay so WebSocket clients (browsers,
//                         iOS apps) can make DHT queries they can't do directly
//                         (browsers have no UDP). The relay only sees framed
//                         DHT messages; hypercore replication between peers is
//                         end-to-end encrypted through it.

const { path, os } = require('../backend/_rt')
const b4a = require('b4a')
const { Node } = require('../backend/node')

let dhtRelayModule = null
try {
  dhtRelayModule = require('@hyperswarm/dht-relay')
} catch { /* optional: relay still works without the WS endpoint */ }

async function startRelay ({
  dir,
  boards = [],
  bootstrap,
  dhtRelayPort,
  announcePubkey = true
} = {}) {
  if (!dir) throw new Error('dir required')
  const node = await Node.openDisk(dir, {
    swarm: bootstrap ? { bootstrap } : {}
  })
  for (const name of boards) await node.joinBoard(name)

  let dhtRelayServer = null
  if (dhtRelayPort != null && dhtRelayModule) {
    dhtRelayServer = await startDhtRelayEndpoint({
      dht: node.swarm.swarm.dht,
      port: dhtRelayPort
    })
  }

  const summary = {
    pubkey: b4a.toString(node.pubkey, 'hex'),
    dir,
    boards,
    dhtRelayPort: dhtRelayServer ? dhtRelayPort : null
  }
  if (announcePubkey) {
    console.log('p2pbuilders-hiverelay online')
    console.log(`  pubkey:    ${summary.pubkey}`)
    console.log(`  dir:       ${summary.dir}`)
    console.log(`  boards:    ${boards.join(', ') || '(none configured)'}`)
    console.log(`  dht-relay: ${summary.dhtRelayPort ? `ws://0.0.0.0:${summary.dhtRelayPort}` : '(disabled)'}`)
  }

  return {
    node,
    summary,
    dhtRelayServer,
    async close () {
      if (dhtRelayServer) await new Promise((r) => dhtRelayServer.close(r))
      await node.close()
    }
  }
}

async function startDhtRelayEndpoint ({ dht, port }) {
  if (!dhtRelayModule) throw new Error('@hyperswarm/dht-relay not installed')
  const { WebSocketServer } = require('ws')
  const { relay } = dhtRelayModule
  const Stream = require('@hyperswarm/dht-relay/ws')
  const wss = new WebSocketServer({ port })
  await new Promise((resolve) => wss.once('listening', resolve))
  wss.on('connection', (socket) => {
    try {
      relay(dht, new Stream(false, socket))
    } catch (err) {
      try { socket.close() } catch {}
      console.error('[dht-relay] connection failed:', err.message)
    }
  })
  return wss
}

module.exports = { startRelay, startDhtRelayEndpoint }

if (require.main === module) {
  const dir = process.env.P2PBUILDERS_DIR || path.join(os.homedir(), '.p2pbuilders-relay')
  const boards = (process.env.P2PBUILDERS_BOARDS || 'front').split(',').map(s => s.trim()).filter(Boolean)
  const bootstrap = process.env.P2PBUILDERS_BOOTSTRAP ? JSON.parse(process.env.P2PBUILDERS_BOOTSTRAP) : undefined
  const dhtRelayPort = process.env.P2PBUILDERS_DHT_RELAY_PORT
    ? Number(process.env.P2PBUILDERS_DHT_RELAY_PORT)
    : null
  startRelay({ dir, boards, bootstrap, dhtRelayPort })
    .catch(err => { console.error(err); process.exit(1) })
}
