'use strict'

// Runtime shim: swap fs/path/os/env between Bare and Node via the package.json
// subpath imports map. bare-pack can statically resolve a single branch per
// target this way, unlike a typeof Bare ternary.
//
// If you add a new Node built-in here, also add it to "imports" in package.json.

const inBare = typeof Bare !== 'undefined'

module.exports = {
  inBare,
  fs: require('#fs'),
  path: require('#path'),
  os: require('#os'),
  env: require('#env'),
  exit: inBare ? (code = 0) => Bare.exit(code) : (code = 0) => process.exit(code)
}
