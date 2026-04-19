'use strict'

const Hyperswarm = require('hyperswarm')

// Wraps Hyperswarm, pipes every connection into the corestore replicator.
// If onConnection is provided, it's invoked per connection with { conn, stream, muxer }
// so callers can attach additional protomux channels (e.g. announce).
class SwarmHub {
  constructor (store, { bootstrap, keyPair, onConnection } = {}) {
    this.store = store
    this.swarm = new Hyperswarm({ bootstrap, keyPair })
    this.swarm.on('connection', (conn) => {
      const stream = this.store.replicate(conn)
      const muxer = stream.noiseStream.userData
      if (onConnection) {
        try { onConnection({ conn, stream, muxer }) } catch (err) {
          this.swarm.emit('error', err)
        }
      }
    })
    this._discoveries = new Map() // hex(topic) -> discovery handle
  }

  async joinBoard (topic, { server = true, client = true } = {}) {
    const key = topic.toString('hex')
    let discovery = this._discoveries.get(key)
    if (!discovery) {
      discovery = this.swarm.join(topic, { server, client })
      this._discoveries.set(key, discovery)
    }
    await discovery.flushed()
    return discovery
  }

  async leaveBoard (topic) {
    const key = topic.toString('hex')
    const discovery = this._discoveries.get(key)
    if (!discovery) return
    this._discoveries.delete(key)
    await this.swarm.leave(topic)
  }

  // Explicitly connect to a known relay peer by DHT pubkey.
  joinPeer (pubkey) { this.swarm.joinPeer(pubkey) }

  // Wait until we have at least n connected peers.
  async waitForPeers (n = 1, { timeoutMs = 10000 } = {}) {
    if (this.swarm.connections.size >= n) return
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.swarm.off('connection', onConn)
        reject(new Error(`timeout waiting for ${n} peer(s)`))
      }, timeoutMs)
      const onConn = () => {
        if (this.swarm.connections.size >= n) {
          clearTimeout(timer)
          this.swarm.off('connection', onConn)
          resolve()
        }
      }
      this.swarm.on('connection', onConn)
    })
  }

  get peerCount () { return this.swarm.connections.size }

  async destroy () {
    await this.swarm.destroy()
  }
}

// Test helper: wire two corestores together with an in-memory duplex pair.
// Returns a { close } handle.
function connectDirect (storeA, storeB) {
  const streamA = storeA.replicate(true)  // A is initiator
  const streamB = storeB.replicate(false)
  streamA.pipe(streamB).pipe(streamA)
  return {
    close () {
      streamA.destroy()
      streamB.destroy()
    }
  }
}

module.exports = { SwarmHub, connectDirect }
