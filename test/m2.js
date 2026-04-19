'use strict'

// M2 integration tests: replication between two nodes.
//
// Two scenarios:
//   1. direct-stream replication (fast, deterministic, no DHT)
//   2. Hyperswarm over a local DHT testnet (real, slower)

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { connectDirect } = require('../src/backend/swarm')
const { boardTopic } = require('../src/backend/board')
const createTestnet = require('hyperdht/testnet')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

// ---------------------------------------------------------------------------
// Direct-stream tests (no swarm)
// ---------------------------------------------------------------------------

test('direct: B replicates A\'s posts after trackUser', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()

  const { opId: postId } = await a.post('general', 'hello from A', 'replicated?')
  await a.comment(postId, 'and a follow-up comment')

  const conn = connectDirect(a.store, b.store)

  const remote = await b.trackUser(a.pubkey)
  await remote.update({ wait: true })

  assert.equal(remote.length, 2, 'B sees 2 ops from A')

  const collected = []
  for await (const entry of b.userOps(a.pubkey)) collected.push(entry)

  assert.equal(collected.length, 2)
  assert.equal(collected[0].op.payload.title, 'hello from A')
  assert.equal(collected[1].op.payload.body, 'and a follow-up comment')

  conn.close()
  await a.close()
  await b.close()
})

test('direct: live update — new post after connection propagates', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()

  const conn = connectDirect(a.store, b.store)
  const remote = await b.trackUser(a.pubkey)
  await remote.ready()

  // A posts AFTER connection is established
  await a.post('general', 'live post', 'body')

  // wait for live update to arrive
  await waitFor(() => remote.length >= 1, 5000)
  assert.equal(remote.length, 1)

  const op = require('../src/backend/ops').decodeOp(await remote.get(0))
  assert.equal(op.payload.title, 'live post')

  conn.close()
  await a.close()
  await b.close()
})

test('direct: remote pubkey round-trips via opId', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()
  const { opId } = await a.post('general', 't', 'b')

  const conn = connectDirect(a.store, b.store)
  const remote = await b.trackUser(a.pubkey)
  await remote.update({ wait: true })

  for await (const entry of b.userOps(a.pubkey)) {
    assert.ok(b4a.equals(entry.opId, opId))
    break
  }
  conn.close()
  await a.close()
  await b.close()
})

// ---------------------------------------------------------------------------
// Hyperswarm testnet tests
// ---------------------------------------------------------------------------

test('swarm: two nodes joining same board connect + replicate', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const a = await Node.openTemp({ swarm: { bootstrap } })
  const b = await Node.openTemp({ swarm: { bootstrap } })

  await a.post('general', 'swarm-test', 'over the wire')

  // Both join the same board topic.
  await a.joinBoard('general')
  await b.joinBoard('general')

  // Wait for them to find each other.
  await b.swarm.waitForPeers(1, { timeoutMs: 15000 })

  // B now follows A's core.
  const remote = await b.trackUser(a.pubkey)
  await remote.update({ wait: true })

  assert.equal(remote.length, 1, 'A\'s post is visible on B')
  const op = require('../src/backend/ops').decodeOp(await remote.get(0))
  assert.equal(op.payload.title, 'swarm-test')

  await a.close()
  await b.close()
  await testnet.destroy()
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function waitFor (predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

// runner
;(async () => {
  let pass = 0; let fail = 0
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
