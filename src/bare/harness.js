'use strict'

// Bare entry point for p2pbuilders — runs the full backend under the Bare runtime.
// Used by:
//   1. `bare src/bare/harness.js` for a quick smoke test under standalone Bare.
//   2. bare-kit-pear on iOS — the SDK loads this file, hands us a pipe, and we
//      answer the same JSON-RPC protocol that the Pear worker and the
//      WebSocket transport speak.
//
// Protocol: newline-delimited JSON frames.
//    request:  {"id": <n>, "method": "<name>", "params": {...}}
//    response: {"id": <n>, "result": ...}  |  {"id": <n>, "error": "<msg>"}
//
// The caller provides a Duplex-shaped object (or uses the built-in smoke-test
// pipe). Everything else is identical to the Node backend.

const { path } = require('../backend/_rt')
const { Node } = require('../backend/node')
const { Indexer } = require('../backend/indexer')
const { createRPC } = require('../backend/rpc')

async function start ({ dir, swarm = {}, pipe, onReady } = {}) {
  if (!dir) throw new Error('dir is required')
  const node = await Node.openDisk(dir, { swarm })
  const indexer = new Indexer(node)
  await indexer.ready()
  const rpc = createRPC({ node, indexer })

  if (pipe) attachPipe(pipe, rpc)

  if (onReady) {
    onReady({
      pubkey: require('b4a').toString(node.pubkey, 'hex'),
      dir,
      indexer,
      node,
      rpc
    })
  }

  return {
    node,
    indexer,
    rpc,
    async close () {
      try { await indexer.close() } catch {}
      try { await node.close() } catch {}
    }
  }
}

function attachPipe (pipe, rpc) {
  let buf = ''
  pipe.on('data', async (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const { id, method, params } = msg
      try {
        const result = await rpc.dispatch(method, params)
        pipe.write(JSON.stringify({ id, result }) + '\n')
      } catch (err) {
        pipe.write(JSON.stringify({ id, error: err.message || String(err) }) + '\n')
      }
    }
  })
}

module.exports = { start, attachPipe }

// When run directly under Bare (for local smoke-testing), spin up a node,
// post "hello world", and print the result. No pipe — just proves the whole
// backend boots in Bare.
if (require.main === module) {
  (async () => {
    const { os } = require('../backend/_rt')
    const dir = path.join(os.tmpdir(), `p2pbuilders-bare-${Date.now()}`)
    console.log(`[bare] starting in ${dir}`)
    const app = await start({ dir, swarm: null })
    console.log(`[bare] pubkey: ${require('b4a').toString(app.node.pubkey, 'hex')}`)
    const { opId } = await app.node.post('front', 'hello from bare', 'this is a smoke-test post')
    console.log(`[bare] posted opId: ${require('b4a').toString(opId, 'hex').slice(0, 16)}…`)
    await new Promise(r => setTimeout(r, 200)) // let indexer catch up
    const posts = await app.rpc.dispatch('listPosts', { board: 'front', sort: 'new' })
    console.log(`[bare] listPosts returned ${posts.length} post(s)`)
    console.log(`[bare] first title: ${posts[0]?.title}`)
    await app.close()
    console.log('[bare] ok')
  })().catch((err) => {
    console.error('[bare] fatal:', err)
    process.exit(1)
  })
}
