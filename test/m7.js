'use strict'

// M7: hiverelay — a long-running peer that holds others' cores.
//
// Scenario:
//   1. A relay starts, joins 'general' board.
//   2. User A comes online, posts, and discovers the relay.
//      Relay auto-tracks A's core (via announce protocol).
//   3. A goes offline.
//   4. User B comes online, joins 'general'.
//   5. Relay replicates A's core to B — A's post is visible without A being online.

const assert = require('assert/strict')
const b4a = require('b4a')
const createTestnet = require('hyperdht/testnet')
const { Node } = require('../src/backend/node')
const { startRelay } = require('../src/relay/server')
const { decodeOp } = require('../src/backend/ops')
const fs = require('fs'), os = require('os'), path = require('path')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

function mkdir () { return fs.mkdtempSync(path.join(os.tmpdir(), 'p2pbuilders-m7-')) }

async function waitFor (pred, { timeoutMs = 15000, intervalMs = 50 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

test('relay seeds offline author to late-arriving peer', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const relayDir = mkdir()
  const relay = await startRelay({ dir: relayDir, boards: ['general'], bootstrap, announcePubkey: false })

  const a = await Node.openTemp({ swarm: { bootstrap } })
  await a.joinBoard('general')

  // wait for the relay to see A
  await waitFor(() => a.swarm.peerCount >= 1)
  await a.post('general', 'while-online', 'this should survive me')

  // wait for relay to learn A's pubkey via announce protocol
  await waitFor(async () => relay.node.userCore(a.pubkey) != null)
  const aCoreOnRelay = relay.node.userCore(a.pubkey)
  await waitFor(() => aCoreOnRelay.length > 0, { timeoutMs: 10000 })
  assert.equal(aCoreOnRelay.length, 1, 'relay has A\'s post')

  // A goes offline
  const aPubkey = b4a.from(a.pubkey)
  await a.close()

  // B comes online, joins same board
  const b = await Node.openTemp({ swarm: { bootstrap } })
  await b.joinBoard('general')

  // B learns about A's pubkey via the relay's announce
  await waitFor(() => b.userCore(aPubkey) != null, { timeoutMs: 20000 })
  const aCoreOnB = b.userCore(aPubkey)
  await waitFor(() => aCoreOnB.length > 0, { timeoutMs: 20000 })
  assert.equal(aCoreOnB.length, 1, 'B received A\'s post via the relay')

  const op = decodeOp(await aCoreOnB.get(0))
  assert.equal(op.payload.title, 'while-online')

  await b.close()
  await relay.close()
  await testnet.destroy()
  fs.rmSync(relayDir, { recursive: true, force: true })
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
