'use strict'

// Reputation formula per SPEC §6.2:
//   rep(key)        = log2(1 + max(ageDays, 1/24)) * sqrt(1 + receivedUpvotes)
//   voteWeight(key) = clamp(rep(key) / 50, 0.02, 1.0)

const FLOOR = 0.02
const CAP = 1.0
const CAP_DENOM = 50

function computeRep (ageDays, receivedUpvotes) {
  const safeAge = Math.max(ageDays, 1 / 24)
  return Math.log2(1 + safeAge) * Math.sqrt(1 + Math.max(0, receivedUpvotes))
}

function computeWeight (ageDays, receivedUpvotes) {
  const r = computeRep(ageDays, receivedUpvotes)
  return Math.max(FLOOR, Math.min(CAP, r / CAP_DENOM))
}

module.exports = { computeRep, computeWeight, FLOOR, CAP, CAP_DENOM }
