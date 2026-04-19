'use strict'

// M10: end-to-end smoke test for the Bare harness (shared by Pear desktop
// worker and bare-kit-pear iOS). Verifies our backend boots and speaks
// RPC under the real Bare runtime.
//
// Spawns `bare src/bare/harness.js` as a subprocess, captures its stdout,
// and asserts the expected milestones appear.

const assert = require('assert/strict')
const { spawn } = require('child_process')
const path = require('path')

const BARE = path.join(__dirname, '..', 'node_modules', 'bare', 'bin', 'bare')
const HARNESS = path.join(__dirname, '..', 'src', 'bare', 'harness.js')

function runBareHarness ({ timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(BARE, [HARNESS], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (b) => { stdout += b.toString() })
    proc.stderr.on('data', (b) => { stderr += b.toString() })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`bare harness timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, timeoutMs)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`bare exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      resolve({ stdout, stderr })
    })
  })
}

;(async () => {
  try {
    const { stdout } = await runBareHarness()
    assert.match(stdout, /\[bare\] starting in/)
    assert.match(stdout, /\[bare\] pubkey: [0-9a-f]{64}/)
    assert.match(stdout, /\[bare\] posted opId: [0-9a-f]{16}/)
    assert.match(stdout, /\[bare\] listPosts returned 1 post/)
    assert.match(stdout, /\[bare\] first title: hello from bare/)
    assert.match(stdout, /\[bare\] ok/)
    console.log('  ✓ backend boots under standalone Bare and answers RPC')
    console.log('\n1/1 passed')
    process.exit(0)
  } catch (err) {
    console.log('  ✗ backend boots under standalone Bare')
    console.log(`    ${err.message}`)
    console.log('\n0/1 passed')
    process.exit(1)
  }
})()
