'use strict'

// M4: local Hyperbee indexer.

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { Indexer } = require('../src/backend/indexer')
const { connectDirect } = require('../src/backend/swarm')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

async function indexed (node) {
  const idx = new Indexer(node)
  await idx.ready()
  return idx
}

// tiny helper to wait until a predicate on the indexer becomes true
async function waitFor (predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

test('listPosts: own posts appear newest-first', async () => {
  const node = await Node.openTemp()
  const idx = await indexed(node)

  const p1 = await node.post('general', 'first', 'a', { ts: 1000 })
  const p2 = await node.post('general', 'second', 'b', { ts: 2000 })
  const p3 = await node.post('other', 'elsewhere', 'c', { ts: 1500 })

  await waitFor(async () => {
    const list = []
    for await (const p of idx.listPosts('general')) list.push(p)
    return list.length === 2
  })

  const list = []
  for await (const p of idx.listPosts('general')) list.push(p)
  assert.equal(list.length, 2)
  assert.equal(list[0].ts, 2000)
  assert.equal(list[1].ts, 1000)
  assert.ok(b4a.equals(list[0].opId, p2.opId))
  assert.ok(b4a.equals(list[1].opId, p1.opId))

  // other board
  const other = []
  for await (const p of idx.listPosts('other')) other.push(p)
  assert.equal(other.length, 1)
  assert.ok(b4a.equals(other[0].opId, p3.opId))

  await idx.close()
  await node.close()
})

test('listComments: ordered by ts under parent', async () => {
  const node = await Node.openTemp()
  const idx = await indexed(node)

  const post = await node.post('general', 't', 'b', { ts: 1000 })
  const c1 = await node.comment(post.opId, 'first comment', { ts: 1100 })
  const c2 = await node.comment(post.opId, 'second comment', { ts: 1200 })

  await waitFor(async () => {
    const list = []
    for await (const c of idx.listComments(post.opId)) list.push(c)
    return list.length === 2
  })

  const list = []
  for await (const c of idx.listComments(post.opId)) list.push(c)
  assert.equal(list.length, 2)
  assert.ok(b4a.equals(list[0].opId, c1.opId))
  assert.ok(b4a.equals(list[1].opId, c2.opId))

  await idx.close()
  await node.close()
})

test('getVoteTotals: up/down tally', async () => {
  const a = await Node.openTemp()
  const b = await Node.openTemp()
  const conn = connectDirect(a.store, b.store)

  const idxA = await indexed(a)

  const post = await a.post('general', 't', 'b')
  await a.vote(post.opId, 1)              // self-upvote

  // B follows A, then upvotes then downvotes (final = -1 but we count raw votes)
  await b.trackUser(a.pubkey)
  const remote = b.userCore(a.pubkey)
  await remote.update({ wait: true })

  await b.vote(post.opId, 1)

  // A also needs to see B's votes
  await a.trackUser(b.pubkey)
  const bRemote = a.userCore(b.pubkey)
  await bRemote.update({ wait: true })

  await waitFor(async () => {
    const t = await idxA.getVoteTotals(post.opId)
    return t.up >= 2
  })

  const totals = await idxA.getVoteTotals(post.opId)
  assert.equal(totals.up, 2, 'A + B upvotes')
  assert.equal(totals.down, 0)

  conn.close()
  await idxA.close()
  await a.close()
  await b.close()
})

test('scoreBoard: ranks by net vote count', async () => {
  const node = await Node.openTemp()
  const other = await Node.openTemp()
  const conn = connectDirect(node.store, other.store)

  const idx = await indexed(node)

  const p1 = await node.post('general', 'p1', '.', { ts: 1000 })
  const p2 = await node.post('general', 'p2', '.', { ts: 2000 })
  const p3 = await node.post('general', 'p3', '.', { ts: 3000 })

  await other.trackUser(node.pubkey)
  const remote = other.userCore(node.pubkey)
  await remote.update({ wait: true })

  await other.vote(p2.opId, 1)
  await other.vote(p2.opId, 1) // duplicate vote from same key overwrites — but counted once in index

  // p1 gets one vote from self-node
  await node.vote(p1.opId, 1)

  await node.trackUser(other.pubkey)
  const otherRemote = node.userCore(other.pubkey)
  await otherRemote.update({ wait: true })
  await otherRemote.download({ start: 0, end: otherRemote.length }).done()

  // Wait until the indexer has seen BOTH votes (on p1 and p2)
  await waitFor(async () => {
    const p1Votes = await idx.getVoteTotals(p1.opId)
    const p2Votes = await idx.getVoteTotals(p2.opId)
    return p1Votes.up >= 1 && p2Votes.up >= 1
  })

  const ranked = await idx.scoreBoard('general', { sort: 'top', weighted: false })
  assert.equal(ranked.length, 3)
  // p2 has 1 vote (from other, duplicate overwrote), p1 has 1 vote (from node)
  // tiebreak by ts desc → p2 (ts=2000) before p1 (ts=1000)
  assert.ok(b4a.equals(ranked[0].opId, p2.opId), 'p2 first')
  assert.ok(b4a.equals(ranked[1].opId, p1.opId))
  assert.ok(b4a.equals(ranked[2].opId, p3.opId))

  conn.close()
  await idx.close()
  await node.close()
  await other.close()
})

test('getBoard + listBoards: board_create indexed', async () => {
  const node = await Node.openTemp()
  const idx = await indexed(node)

  await node.createBoard('newboard', 'a shiny new board', { minPowBits: 20 })

  await waitFor(async () => (await idx.getBoard('newboard')) != null)

  const b = await idx.getBoard('newboard')
  assert.equal(b.description, 'a shiny new board')
  assert.equal(b.minPowBits, 20)
  assert.ok(b4a.equals(b.creator, node.pubkey))

  const boards = []
  for await (const name of idx.listBoards()) boards.push(name)
  assert.deepEqual(boards, ['newboard'])

  await idx.close()
  await node.close()
})

test('first board_create wins (squatting policy)', async () => {
  const node = await Node.openTemp()
  const idx = await indexed(node)

  await node.createBoard('squat', 'original', { minPowBits: 18 }, )
  await waitFor(async () => (await idx.getBoard('squat')) != null)
  await node.createBoard('squat', 'imposter', { minPowBits: 22 })

  // race: wait a tick for 2nd op to be indexed
  await new Promise(r => setTimeout(r, 100))
  const b = await idx.getBoard('squat')
  assert.equal(b.description, 'original', 'second registration ignored')

  await idx.close()
  await node.close()
})

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
