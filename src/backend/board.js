'use strict'

const sodium = require('sodium-universal')
const b4a = require('b4a')

const BOARD_NAME_RE = /^[a-z0-9_-]{2,32}$/
const TOPIC_BYTES = 32
const BOARD_TOPIC_PREFIX = 'p2pbuilders:board:v1:'
const ROSTER_TOPIC_STR = 'p2pbuilders:roster:v1'

function validateBoardName (name) {
  if (typeof name !== 'string') throw new Error('board name must be a string')
  if (!BOARD_NAME_RE.test(name)) {
    throw new Error('board name must match /^[a-z0-9_-]{2,32}$/')
  }
}

function hashTopic (str) {
  const out = b4a.alloc(TOPIC_BYTES)
  sodium.crypto_generichash(out, b4a.from(str))
  return out
}

function boardTopic (name) {
  validateBoardName(name)
  return hashTopic(BOARD_TOPIC_PREFIX + name)
}

const rosterTopic = hashTopic(ROSTER_TOPIC_STR)

module.exports = {
  BOARD_NAME_RE,
  TOPIC_BYTES,
  validateBoardName,
  boardTopic,
  rosterTopic,
  hashTopic
}
