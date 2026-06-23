// reputation.js — vote weighting. A vote's influence scales with the VOTER's
// reputation, so a brand-new key can vote but barely moves the needle, while an
// established contributor (older + upvoted) carries more weight. This blunts
// (does not eliminate) Sybil ballot-stuffing — see README. Pure function; the
// data layer supplies ageDays + receivedUpvotes (and caches them).
//
//   weight = clamp( log2(1 + ageDays) * sqrt(1 + receivedUpvotes) / 50, 0.02, 1 )
//     ~0.02 floor  : a fresh key still counts, just barely
//     ~0.33        : ~30 days old + 10 upvotes received
//     ~0.93        : ~90 days old + 50 upvotes received

export function weight (ageDays, receivedUpvotes) {
  const a = Math.max(0, ageDays || 0)
  const r = Math.max(0, receivedUpvotes || 0)
  const w = Math.log2(1 + a) * Math.sqrt(1 + r) / 50
  return Math.max(0.02, Math.min(1, w))
}

// Weighted tally of a target's votes. `votes` = [{ author, dir }]; weightOf(pub)
// returns that voter's reputation weight. Returns { up, down, score, weighted, myVote }.
export function weightedTally (votes, weightOf, me) {
  const last = new Map()
  for (const v of votes || []) last.set(v.author, v.dir)
  let up = 0, down = 0, weighted = 0, myVote = 0
  for (const [author, dir] of last) {
    if (dir === 1) up++
    else if (dir === -1) down++
    if (me && author === me) myVote = dir
    weighted += (dir || 0) * weight(...(weightOf(author) || [0, 0]))
  }
  return { up, down, score: up - down, weighted, myVote, total: up + down }
}
