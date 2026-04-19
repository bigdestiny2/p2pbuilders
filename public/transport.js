// Transport auto-detection for p2pbuilders.
//
// - In a Pear desktop app, global `Pear` + a worker pipe is available.
// - In a regular browser (dev mode, iOS Safari, etc.), we fall back to the
//   local WebSocket RPC endpoint.
//
// Both transports expose the same surface: { call(method, params), onStatus(fn) }.
// The JSON-RPC framing is identical on both sides.

export function createTransport () {
  // iOS WKWebView with our native bridge (BareBridge.swift posts messages
  // under the "bare" handler name and calls window.__bareRx for responses).
  if (typeof globalThis.webkit !== 'undefined' &&
      globalThis.webkit?.messageHandlers?.bare) {
    return createWebKitBridgeTransport()
  }
  // In Pear desktop GUI: spawn our Bare worker and talk over its pipe.
  if (typeof globalThis.Pear !== 'undefined' && globalThis.Pear?.Worker?.run) {
    const pipe = globalThis.Pear.Worker.run('./src/pear/worker.js')
    return createPearTransport(pipe)
  }
  // Fallback: browser dev mode — localhost WebSocket.
  return createWebSocketTransport()
}

// ----- iOS WebKit bridge transport (WKWebView <-> native BareKit.IPC) -----
//
// Native side (Swift):
//   - WKUserContentController registers a script-message handler named "bare"
//   - On receiving a message, writes the bytes to BareKit.IPC
//   - On BareKit.IPC data, evaluates `window.__bareRx(<json-string>)` in the webview
//
// The wire format is the same line-delimited JSON-RPC the rest of the
// stack uses, minus the trailing newline (each postMessage = one frame).

function createWebKitBridgeTransport () {
  let nextId = 1
  const pending = new Map()
  let onStatus = () => {}
  const bridge = globalThis.webkit.messageHandlers.bare

  // Native drops each frame (or concatenated frames) into window.__bareRx.
  let pendingChunk = ''
  globalThis.__bareRx = (chunk) => {
    if (!chunk) return
    pendingChunk += String(chunk)
    // Accept either single-JSON-per-call (no newline) or newline-delimited.
    const parts = pendingChunk.split('\n')
    pendingChunk = parts.pop() // leave the trailing partial
    for (const raw of parts) {
      if (!raw) continue
      handleFrame(raw)
    }
    // If the last part is a complete JSON on its own (no newline), try it.
    if (pendingChunk) {
      try {
        JSON.parse(pendingChunk)
        handleFrame(pendingChunk)
        pendingChunk = ''
      } catch { /* keep buffering */ }
    }
  }

  function handleFrame (raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.event) return // informational events (e.g. "ready") — no id
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }

  queueMicrotask(() => onStatus('connected'))

  function call (method, params) {
    const id = nextId++
    bridge.postMessage(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  return {
    kind: 'ios-bare',
    call,
    onStatus: (fn) => { onStatus = fn }
  }
}

// ----- WebSocket transport (browser dev mode) -----

function createWebSocketTransport () {
  let ws = null
  let nextId = 1
  const pending = new Map()
  const queue = []
  let onStatus = () => {}

  function connect () {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/rpc`)
    ws.onopen = () => {
      onStatus('connected')
      while (queue.length) ws.send(queue.shift())
    }
    ws.onmessage = (ev) => handleLine(ev.data)
    ws.onclose = () => { onStatus('disconnected'); setTimeout(connect, 1000) }
    ws.onerror = () => onStatus('error')
  }

  function handleLine (data) {
    let msg
    try { msg = JSON.parse(data) } catch { return }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }

  function call (method, params) {
    const id = nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload)
      else queue.push(payload)
    })
  }

  connect()
  return {
    kind: 'websocket',
    call,
    onStatus: (fn) => { onStatus = fn }
  }
}

// ----- Pear transport (desktop app, worker pipe) -----
//
// Pear.pipe is a duplex stream between the webview and the Bare worker.
// We use line-delimited JSON frames to match the WebSocket protocol.

function createPearTransport (pipe) {
  let nextId = 1
  const pending = new Map()
  let onStatus = () => {}
  let buf = ''

  pipe.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const p = pending.get(msg.id)
      if (!p) continue
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    }
  })
  pipe.on('close', () => onStatus('disconnected'))
  onStatus = (fn) => { onStatus = fn }
  queueMicrotask(() => onStatus('connected'))

  function call (method, params) {
    const id = nextId++
    pipe.write(JSON.stringify({ id, method, params }) + '\n')
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  return {
    kind: 'pear',
    call,
    onStatus: (fn) => { onStatus = fn }
  }
}
