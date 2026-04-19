'use strict'

// M6: antispam layers — PoW gate, rate limits, blocklist, weighted votes.

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { Indexer } = require('../src/backend/indexer')
const { connectDirect } = require('../src/backend/swarm')
const pow = require('../src/backend/pow')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

async function waitFor (pred, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

test('PoW gate: op with bits below min is dropped', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  // First: a valid post at default bits
  const good = await node.post('general', 'good', 'body')
  // Then: a low-PoW post (bits=0 → nearly instant mint but won't meet the 18-bit min)
  const bad = await node.post('general', 'bad', 'spam', { bits: 0 })

  await waitFor(async () => {
    const list = []
    for await (const p of idx.listPosts('general')) list.push(p)
    return list.length >= 1
  })

  await new Promise(r => setTimeout(r, 150)) // let bad op also attempt to index

  const list = []
  for await (const p of idx.listPosts('general')) list.push(p)
  assert.equal(list.length, 1, 'only the good post indexed')
  assert.ok(b4a.equals(list[0].opId, good.opId))

  await idx.close()
  await node.close()
})

test('rate limit: 11th post within an hour is dropped (limit=10)', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  const baseTs = 1700000000000
  const results = []
  for (let i = 0; i < 11; i++) {
    const r = await node.post('general', `p${i}`, 'b', { ts: baseTs + i * 1000 })
    results.push(r)
  }

  await waitFor(async () => {
    const list = []
    for await (const p of idx.listPosts('general', { limit: 100 })) list.push(p)
    return list.length >= 10
  })

  await new Promise(r => setTimeout(r, 200))
  const list = []
  for await (const p of idx.listPosts('general', { limit: 100 })) list.push(p)
  assert.equal(list.length, 10, 'only 10 of 11 indexed')

  await idx.close()
  await node.close()
})

test('rate limit: posts spaced >1h apart all pass', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  const H = 3600 * 1000
  const base = 1700000000000
  for (let i = 0; i < 12; i++) {
    await node.post('general', `p${i}`, 'b', { ts: base + i * H + 1000 })
  }

  await waitFor(async () => {
    const list = []
    for await (const p of idx.listPosts('general', { limit: 100 })) list.push(p)
    return list.length === 12
  })

  await idx.close()
  await node.close()
})

test('local blocklist: blocked author hidden from lists + vote totals', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()
  const conn = connectDirect(a.store, b.store)
  const idxA = new Indexer(a)
  await idxA.ready()

  // A's post, then B tracks A and votes
  const post = await a.post('general', 'visible', 'body')
  await b.trackUser(a.pubkey)
  await b.userCore(a.pubkey).update({ wait: true })
  await b.vote(post.opId, 1)

  // A tracks B so A's indexer sees B's vote
  await a.trackUser(b.pubkey)
  const bRemote = a.userCore(b.pubkey)
  await bRemote.update({ wait: true })
  await bRemote.download({ start: 0, end: bRemote.length }).done()

  await waitFor(async () => (await idxA.getVoteTotals(post.opId)).up === 1)

  // Now A blocks B → B's vote should no longer count in weighted totals
  idxA.block(b.pubkey)
  const weighted = await idxA.getWeightedVoteTotals(post.opId)
  assert.equal(weighted.weightedScore, 0, 'blocked voter excluded from weighted score')

  // B's own posts (if any) also hidden
  await b.post('general', 'blocked-post', 'x')
  await new Promise(r => setTimeout(r, 300))
  const list = []
  for await (const p of idxA.listPosts('general')) list.push(p)
  const titles = []
  for (const p of list) {
    const op = require('../src/backend/ops').decodeOp(await a.userCore(p.author).get(p.seq))
    titles.push(op.payload.title)
  }
  assert.ok(!titles.includes('blocked-post'), 'blocked author post hidden')

  conn.close()
  await idxA.close()
  await a.close()
  await b.close()
})

test('weighted vote: new-key voter has weight 0.02 (floor)', async () => {
  const node = await Node.openTemp()
  const idx = new Indexer(node)
  await idx.ready()

  const post = await node.post('general', 't', 'b')
  await node.vote(post.opId, 1) // self-vote from a fresh key

  await waitFor(async () => (await idx.getVoteTotals(post.opId)).up === 1)

  const weighted = await idx.getWeightedVoteTotals(post.opId)
  assert.equal(weighted.up, 1)
  // Fresh key: weight floored at 0.02
  assert.ok(weighted.weightedScore >= 0.02 - 1e-9 && weighted.weightedScore <= 0.05,
    `new-key weight near floor, got ${weighted.weightedScore}`)

  await idx.close()
  await node.close()
})

test('reputation formula exposed directly', async () => {
  const rep = require('../src/backend/reputation')
  assert.equal(rep.computeWeight(0, 0) >= 0.02, true)
  assert.equal(rep.computeWeight(365, 1000) <= 1.0, true)
  // Spec simulation anchor: 30d + 10 upvotes ≈ 0.329
  const w = rep.computeWeight(30, 10)
  assert.ok(w > 0.31 && w < 0.35, `30d/10upv weight ≈ 0.329, got ${w.toFixed(3)}`)
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
