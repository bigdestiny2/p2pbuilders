'use strict'

const { fs, path } = require('./_rt')
const sodium = require('sodium-universal')
const b4a = require('b4a')

const PRIMARY_KEY_BYTES = 32
const USER_CORE_NAME = 'p2pbuilders/user'

function generatePrimaryKey () {
  const key = b4a.alloc(PRIMARY_KEY_BYTES)
  sodium.randombytes_buf(key)
  return key
}

function loadOrCreatePrimaryKey (dir) {
  // Store the identity key in a sibling directory — NOT the corestore dir —
  // so corestore's own filesystem layout can't interfere.
  const keyDir = path.join(dir, '..', 'p2pbuilders-identity')
  const file = path.join(keyDir, 'key.bin')
  const legacy = path.join(dir, '.p2pbuilders.key')
  const legacyOlder = path.join(dir, 'primary.key')
  try {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file)
      if (buf.length === PRIMARY_KEY_BYTES) return buf
    }
  } catch {}
  // Migrate from earlier filenames if present.
  for (const leg of [legacy, legacyOlder]) {
    try {
      if (fs.existsSync(leg)) {
        const buf = fs.readFileSync(leg)
        if (buf.length === PRIMARY_KEY_BYTES) {
          fs.mkdirSync(keyDir, { recursive: true })
          fs.writeFileSync(file, buf, { mode: 0o600 })
          try { fs.unlinkSync(leg) } catch {}
          return buf
        }
      }
    } catch {}
  }
  fs.mkdirSync(keyDir, { recursive: true })
  const key = generatePrimaryKey()
  fs.writeFileSync(file, key, { mode: 0o600 })
  return key
}

module.exports = {
  PRIMARY_KEY_BYTES,
  USER_CORE_NAME,
  generatePrimaryKey,
  loadOrCreatePrimaryKey
}
