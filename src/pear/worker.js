'use strict'

// Pear Bare worker: runs the p2pbuilders backend and speaks line-delimited JSON-RPC
// to the GUI webview over Pear's Pipe.
//
// Launched from src/pear/gui.js via Pear.Worker.run('./src/pear/worker.js').
// The GUI does: pipe.write(JSON.stringify({id, method, params}) + '\n')
// We respond:   pipe.write(JSON.stringify({id, result}) + '\n')

const { path } = require('../backend/_rt')
const { Node } = require('../backend/node')
const { Indexer } = require('../backend/indexer')
const { createRPC } = require('../backend/rpc')

// Pear exposes global `Pear` when this module runs as a worker.
/* global Pear */

async function main () {
  // Pear.config.storage is the app's per-install storage directory.
  const dir = path.join(Pear.config.storage, 'p2pbuilders')
  const node = await Node.openDisk(dir, { swarm: {} })
  const indexer = new Indexer(node)
  await indexer.ready()
  const rpc = createRPC({ node, indexer })

  // Grab the worker's side of the pipe to the GUI.
  const pipe = Pear.worker.pipe()

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

  pipe.on('close', async () => {
    try { await indexer.close() } catch {}
    try { await node.close() } catch {}
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('p2pbuilders worker fatal:', err)
  process.exit(1)
})
