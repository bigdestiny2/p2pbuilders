'use strict'

// M3: peer key-exchange via the announce protomux channel.
// Two nodes that join the same board should auto-discover each other's pubkey
// without any manual trackUser() call.

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const createTestnet = require('hyperdht/testnet')
const { decodeOp } = require('../src/backend/ops')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

test('swarm+announce: B auto-tracks A after joining same board', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const a = await Node.openTemp({ swarm: { bootstrap } })
  const b = await Node.openTemp({ swarm: { bootstrap } })

  await a.post('general', 'auto-discovery test', 'body')

  await a.joinBoard('general')
  await b.joinBoard('general')

  // Wait for B to receive an announce for A's pubkey.
  await waitForEvent(b, 'track', (pubkey) => b4a.equals(pubkey, a.pubkey), 15000)

  const remote = b.userCore(a.pubkey)
  assert.ok(remote, 'B has tracked A')
  await remote.update({ wait: true })
  assert.equal(remote.length, 1)
  const op = decodeOp(await remote.get(0))
  assert.equal(op.payload.title, 'auto-discovery test')

  await a.close()
  await b.close()
  await testnet.destroy()
})

test('swarm+announce: transitive discovery (C learns A via B)', async () => {
  const testnet = await createTestnet(3, { teardown: () => {} })
  const bootstrap = testnet.bootstrap

  const a = await Node.openTemp({ swarm: { bootstrap } })
  const b = await Node.openTemp({ swarm: { bootstrap } })
  const c = await Node.openTemp({ swarm: { bootstrap } })

  await a.post('general', 'hello', 'from A')

  // B tracks A first, A and B on 'general' board.
  await a.joinBoard('general')
  await b.joinBoard('general')
  await waitForEvent(b, 'track', (pk) => b4a.equals(pk, a.pubkey), 15000)

  // C joins a DIFFERENT board from A, but same as B (call it 'meta').
  // B also joins 'meta'. Via B, C should learn about A's pubkey.
  await b.joinBoard('meta')
  await c.joinBoard('meta')

  await waitForEvent(c, 'track', (pk) => b4a.equals(pk, a.pubkey), 15000)

  const aCoreOnC = c.userCore(a.pubkey)
  assert.ok(aCoreOnC, 'C discovered A via B')

  await a.close()
  await b.close()
  await c.close()
  await testnet.destroy()
})

// ---------------------------------------------------------------------------

function waitForEvent (emitter, event, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler)
      reject(new Error(`timeout waiting for ${event}`))
    }, timeoutMs)
    const handler = (arg) => {
      if (predicate(arg)) {
        clearTimeout(timer)
        emitter.off(event, handler)
        resolve(arg)
      }
    }
    emitter.on(event, handler)
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
