'use strict'

// M1 integration test — runs with plain `node test/m1.js`.
// No networking, no Pear/Bare runtime. Just identity + ops + PoW + local core.

const assert = require('assert/strict')
const b4a = require('b4a')
const { Node } = require('../src/backend/node')
const { TYPE, parseOpId, encodeOp, decodeOp, makeOpId } = require('../src/backend/ops')
const pow = require('../src/backend/pow')

const tests = []
function test (name, fn) { tests.push({ name, fn }) }

test('identity is stable: same primary key → same pubkey', async () => {
  const a = await Node.openTemp()
  const pk = a.primaryKey
  const pubkey1 = b4a.from(a.pubkey)
  await a.close()

  const b = await Node.openTemp({ primaryKey: pk })
  const pubkey2 = b4a.from(b.pubkey)
  await b.close()

  assert.equal(b4a.toString(pubkey1, 'hex'), b4a.toString(pubkey2, 'hex'))
})

test('post appends, mints PoW, round-trips through encode/decode', async () => {
  const node = await Node.openTemp()
  const t0 = Date.now()
  const { op, opId, seq } = await node.post('general', 'hello p2pbuilders', 'first post ever')
  const t1 = Date.now()

  assert.equal(op.type, TYPE.POST)
  assert.equal(op.payload.board, 'general')
  assert.equal(op.payload.title, 'hello p2pbuilders')
  assert.equal(op.payload.body, 'first post ever')
  assert.equal(op.payload.link, null)
  assert.ok(op.pow, 'post must carry PoW')
  assert.ok(op.pow.bits >= pow.DEFAULT_BITS.post)
  assert.equal(op.pow.nonce.length, 8)

  assert.equal(seq, 0)
  const parsed = parseOpId(opId)
  assert.equal(b4a.toString(parsed.pubkey, 'hex'), b4a.toString(node.pubkey, 'hex'))
  assert.equal(parsed.seq, 0)

  // round-trip via core read
  const readBack = await node.getOp(0)
  assert.equal(readBack.payload.title, 'hello p2pbuilders')
  assert.ok(b4a.equals(readBack.pow.nonce, op.pow.nonce))

  console.log(`    post minted in ${t1 - t0}ms at ${op.pow.bits} bits`)
  await node.close()
})

test('comment threads by parent opId', async () => {
  const node = await Node.openTemp()
  const postRes = await node.post('general', 't', 'b')
  const commentRes = await node.comment(postRes.opId, 'nice post')

  const c = await node.getOp(commentRes.seq)
  assert.equal(c.type, TYPE.COMMENT)
  assert.ok(b4a.equals(c.payload.parent, postRes.opId))
  assert.equal(c.payload.body, 'nice post')
  assert.ok(c.pow, 'comment must carry PoW')
  await node.close()
})

test('vote has no PoW, dir constrained to -1/0/+1', async () => {
  const node = await Node.openTemp()
  const { opId } = await node.post('general', 't', 'b')

  const up = await node.vote(opId, 1)
  const upOp = await node.getOp(up.seq)
  assert.equal(upOp.type, TYPE.VOTE)
  assert.equal(upOp.payload.dir, 1)
  assert.equal(upOp.pow, null, 'vote must not carry PoW')

  await assert.rejects(() => node.vote(opId, 2), /dir must be/)
  await node.close()
})

test('PoW verify accepts valid, rejects tampered op', async () => {
  const node = await Node.openTemp()
  const { op } = await node.post('general', 'x', 'y')

  assert.equal(pow.verify(op, op.pow.bits), true, 'fresh PoW verifies')

  // tamper body — hash changes, PoW fails
  const tampered = { ...op, payload: { ...op.payload, body: 'different' } }
  assert.equal(pow.verify(tampered, op.pow.bits), false, 'tampered op fails verify')

  // tamper nonce
  const badNonce = b4a.from(op.pow.nonce)
  badNonce[0] ^= 0xff
  const tampered2 = { ...op, pow: { ...op.pow, nonce: badNonce } }
  assert.equal(pow.verify(tampered2, op.pow.bits), false, 'bad nonce fails verify')
  await node.close()
})

test('encodeOp / decodeOp round-trip exact', async () => {
  const node = await Node.openTemp()
  const { op } = await node.post('general', 'title', 'body', { link: 'https://example.com' })
  const buf = encodeOp(op)
  const back = decodeOp(buf)
  assert.equal(back.v, op.v)
  assert.equal(back.type, op.type)
  assert.equal(back.ts, op.ts)
  assert.deepEqual(back.payload, op.payload)
  assert.ok(b4a.equals(back.pow.nonce, op.pow.nonce))
  assert.equal(back.pow.bits, op.pow.bits)
  await node.close()
})

test('opId parse <-> makeOpId is consistent', () => {
  const pk = b4a.alloc(32)
  for (let i = 0; i < 32; i++) pk[i] = i
  const id = makeOpId(pk, 42)
  const parsed = parseOpId(id)
  assert.equal(b4a.toString(parsed.pubkey, 'hex'), b4a.toString(pk, 'hex'))
  assert.equal(parsed.seq, 42)
})

test('leadingZeroBits counts correctly', () => {
  assert.equal(pow.leadingZeroBits(b4a.from([0xff])), 0)
  assert.equal(pow.leadingZeroBits(b4a.from([0x7f])), 1)
  assert.equal(pow.leadingZeroBits(b4a.from([0x01])), 7)
  assert.equal(pow.leadingZeroBits(b4a.from([0x00, 0xff])), 8)
  assert.equal(pow.leadingZeroBits(b4a.from([0x00, 0x00, 0x40])), 17)
  assert.equal(pow.leadingZeroBits(b4a.from([0x00, 0x00, 0x00])), 24)
})

test('iterate ops', async () => {
  const node = await Node.openTemp()
  await node.post('general', 'a', '1')
  await node.post('general', 'b', '2')
  await node.post('general', 'c', '3')

  const collected = []
  for await (const entry of node.ops()) collected.push(entry)
  assert.equal(collected.length, 3)
  assert.equal(collected[0].op.payload.title, 'a')
  assert.equal(collected[2].op.payload.title, 'c')
  assert.equal(collected[2].seq, 2)
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
