'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { WebSocketServer } = require('ws')

const { Node } = require('./node')
const { Indexer } = require('./indexer')
const { createRPC } = require('./rpc')

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

function serveStatic (req, res) {
  let urlPath = req.url.split('?')[0]
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html'
  // SPA fallback: any route that's not a static file → index.html
  const filePath = path.join(PUBLIC_DIR, urlPath)
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end() }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (urlPath.includes('.')) { res.writeHead(404); return res.end('not found') }
      return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html'))
        .on('open', () => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }))
        .pipe(res)
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  })
}

async function start ({ dir, port = 8787, swarm } = {}) {
  if (!dir) throw new Error('dir is required')
  const node = await Node.openDisk(dir, { swarm })
  const indexer = new Indexer(node)
  await indexer.ready()
  const rpc = createRPC({ node, indexer })

  const server = http.createServer(serveStatic)
  const wss = new WebSocketServer({ server, path: '/rpc' })

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      const { id, method, params } = msg
      try {
        const result = await rpc.dispatch(method, params)
        ws.send(JSON.stringify({ id, result }))
      } catch (err) {
        ws.send(JSON.stringify({ id, error: err.message || String(err) }))
      }
    })
  })

  await new Promise((resolve) => server.listen(port, resolve))
  const url = `http://localhost:${port}/`
  console.log(`p2pbuilders backend listening`)
  console.log(`  url:    ${url}`)
  console.log(`  pubkey: ${require('b4a').toString(node.pubkey, 'hex')}`)
  return { server, wss, node, indexer, rpc, close: async () => {
    wss.close()
    server.close()
    await indexer.close()
    await node.close()
  } }
}

module.exports = { start }

// CLI entry
if (require.main === module) {
  const dir = process.env.P2PBUILDERS_DIR || path.join(require('os').homedir(), '.p2pbuilders')
  const port = Number(process.env.P2PBUILDERS_PORT || 8787)
  const bootstrap = process.env.P2PBUILDERS_BOOTSTRAP
    ? JSON.parse(process.env.P2PBUILDERS_BOOTSTRAP)
    : undefined
  const swarm = process.env.P2PBUILDERS_NO_SWARM
    ? null
    : (bootstrap ? { bootstrap } : {})
  start({ dir, port, swarm })
    .catch(err => { console.error(err); process.exit(1) })
}
