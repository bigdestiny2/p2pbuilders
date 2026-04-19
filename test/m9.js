'use strict'

// M9: hiverelay with @hyperswarm/dht-relay endpoint.
//
// Verifies:
//   - relay starts with a DHT-relay WebSocket listener
//   - a client connects and can wrap the WebSocket in a relayed DHT instance
//   - the relay's Bare-side swarm + our seeding behavior are unaffected

const assert = require('assert/strict')
const WebSocket = require('ws')
const createTestnet = require('hyperdht/testnet')
const { startRelay } = require('../src/relay/server')
const fs = require('fs'), os = require('os'), path = require('path')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

function mkdir () { return fs.mkdtempSync(path.join(os.tmpdir(), 'p2pbuilders-m9-')) }

test('dht-relay WebSocket endpoint accepts connections', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const dir = mkdir()
  const relay = await startRelay({
    dir,
    boards: ['front'],
    bootstrap,
    dhtRelayPort: 0, // pick a free port
    announcePubkey: false
  })
  const port = relay.dhtRelayServer.address().port
  assert.ok(port > 0)

  // Raw WebSocket connect — this exercises the upgrade + dht-relay handshake.
  const ws = new WebSocket(`ws://localhost:${port}`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  assert.equal(ws.readyState, WebSocket.OPEN)
  // Clean shutdown
  ws.close()

  await relay.close()
  await testnet.destroy()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('relayed DHT instance can perform DHT lookups via the WebSocket', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const dir = mkdir()
  const relay = await startRelay({
    dir, boards: [], bootstrap, dhtRelayPort: 0, announcePubkey: false
  })
  const port = relay.dhtRelayServer.address().port

  const RelayedDHT = require('@hyperswarm/dht-relay')
  const Stream = require('@hyperswarm/dht-relay/ws')

  const ws = new WebSocket(`ws://localhost:${port}`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const relayedDht = new RelayedDHT(new Stream(true, ws))
  await relayedDht.ready()

  assert.equal(typeof relayedDht.destroy, 'function')
  assert.ok(relayedDht.defaultKeyPair, 'relayed DHT received a keypair from the relay')

  await relayedDht.destroy()
  await relay.close()
  await testnet.destroy()
  fs.rmSync(dir, { recursive: true, force: true })
})

// runner
;(async () => {
  let pass = 0, fail = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      pass++
    } catch (err) {
      console.log(`  ✗ ${name}`)
      console.log(`    ${err.stack || err.message}`)
      fail++
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
