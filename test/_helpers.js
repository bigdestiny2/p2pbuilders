'use strict'

// Swarm options for tests running against a local hyperdht testnet.
// firewalled:false + loopback binding skip firewall detection and holepunching,
// which don't work in sandboxed/containerized CI environments — server-side
// connections would otherwise never complete and the tests flake.
function localSwarm (bootstrap) {
  return { bootstrap, firewalled: false, host: '127.0.0.1' }
}

module.exports = { localSwarm }
