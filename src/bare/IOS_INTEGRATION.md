# iOS integration — bare-kit-pear ↔ p2pbuilders

This document describes how to wire the p2pbuilders Bare backend into an iOS
app using [bare-kit](https://github.com/holepunchto/bare-kit) (or your
`bare-kit-pear` fork). Everything below is derived from holepunchto/bare-kit's
public API + `node_modules/bare-ipc`.

## 1. Bundle the JS

The app loads `src/bare/ios-entry.js` which in turn requires the full backend.
You need to bundle:
```
src/bare/ios-entry.js
src/bare/harness.js
src/backend/**/*.js          (everything)
node_modules/**              (hypercore, corestore, hyperswarm, b4a, compact-encoding,
                              sodium-universal, hyperbee, @hyperswarm/dht-relay,
                              bare-fs, bare-path, bare-os, bare-env, bare-ipc, bare-pipe,
                              bare-stream, …)
```

Two ways to bundle for the iOS build:

**(a) ship the whole tree as-is** and let bare-kit's module resolver walk it —
simplest, biggest binary.

**(b) pre-bundle with `bare-pack`** (the Bare-native bundler analogous to esbuild):
```
npx bare-pack src/bare/ios-entry.js > bundle.js
```
then ship the single `bundle.js`. Faster startup, smaller install.

## 2. Start the worklet

```swift
import BareKit

let worklet = BareWorklet()
try worklet.start(
    name: "p2pbuilders",
    source: bundleSourceString,   // contents of ios-entry.js or bundle.js
    arguments: []
)

// Attach the IPC channel. bare-kit auto-wires this to the global BareKit.IPC
// on the JS side when the worklet runs.
let ipc = BareIPC(worklet: worklet)
```

## 3. Speak JSON-RPC over the pipe

The JS backend treats the IPC stream as line-delimited JSON-RPC. Frame protocol:

```
request:  {"id": <int>, "method": "<name>", "params": { ... }}\n
response: {"id": <int>, "result": ...}\n
          {"id": <int>, "error": "<message>"}\n
event:    {"event": "ready", "pubkey": "<hex64>", "dir": "<path>"}\n
```

The first frame you'll see (unsolicited) is the `ready` event — our backend
emits it when the node + indexer are booted.

### Swift call example

```swift
// Send:
let request = #"{"id":1,"method":"listPosts","params":{"sort":"hot"}}"# + "\n"
try ipc.write(data: request.data(using: .utf8)!)

// Read (async):
ipc.read { data, _ in
    guard let data = data, let line = String(data: data, encoding: .utf8) else { return }
    // Parse JSON, dispatch on "id" or "event"
}
```

## 4. Methods the backend exposes

All of these are available via the pipe:

| Method                | Params                                                                   | Returns                                                |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `me`                  | —                                                                        | `{ pubkey, length }`                                   |
| `listBoards`          | —                                                                        | `[name, …]`                                            |
| `getBoard`            | `{ name }`                                                               | `{ name, description, minPowBits, creator, ts }`       |
| `listPosts`           | `{ board?: string, sort?: 'hot'|'new'|'top', limit?: number }`           | `[post, …]`                                            |
| `getPost`             | `{ opId: hex }`                                                          | `post`                                                 |
| `listComments`        | `{ parentOpId: hex }`                                                    | `[comment, …]` (direct replies only)                   |
| `listCommentTree`     | `{ rootOpId: hex, maxDepth?: number, maxNodes?: number }`                | `[comment, …]` (all descendants, flat, with `parent`)  |
| `createPost`          | `{ title, body?, link?, board? }`                                        | `{ opId, powMs, powBits }`                             |
| `createComment`       | `{ parentOpId, body }`                                                   | `{ opId, powMs, powBits }`                             |
| `vote`                | `{ targetOpId, dir: -1 | 0 | 1 }`                                        | `{ ok: true }`                                         |
| `editOp`              | `{ opId, body, title? }`                                                 | `{ ok: true }`                                         |
| `deleteOp`            | `{ opId }`                                                               | `{ ok: true }`                                         |
| `setProfile`          | `{ nick, bio?, avatar? }`                                                | `{ ok: true }`                                         |
| `getProfile`          | `{ pubkey }`                                                             | `{ pubkey, nick, bio, avatar, ts } \| null`            |
| `exportPrimaryKey`    | —                                                                        | `{ hex: string }` — for identity backup                |
| `trackUser`           | `{ pubkey }`                                                             | `{ ok: true }`                                         |
| `getStats`            | —                                                                        | `{ pubkey, length, swarm, peerCount, … }`              |

`post` shape: `{ opId, author, authorNick, ts, title, body, link, board, up, down, score, commentCount, edited }`
`comment` shape: `{ opId, parent, author, authorNick, ts, body, up, down, score, edited }`

## 5. Suspend / resume

When the iOS app backgrounds:
```swift
worklet.suspend()   // JS side: Bare.on('suspend')
// ... later ...
worklet.resume()    // JS side: Bare.on('resume')
```
Our `ios-entry.js` already calls `pipe.unref()` on suspend and `pipe.ref()` on
resume so the Bare event loop doesn't keep the pipe hot while backgrounded.

## 6. Minimal round-trip test

1. Swift: start worklet, attach IPC.
2. Swift: read one line, parse it → expect `{"event":"ready","pubkey":"…"}`.
3. Swift: `ipc.write("{\"id\":1,\"method\":\"me\",\"params\":{}}\n")`.
4. Swift: read one line → `{"id":1,"result":{"pubkey":"…","length":0}}`.

If that round-trip works you can drive the whole UI from Swift.

## 7. Known gotchas

- **Storage path.** By default the backend writes to `$TMPDIR/p2pbuilders-ios/`.
  On iOS you almost certainly want a persistent path. Pass it via
  environment variable `P2PBUILDERS_DIR` before starting the worklet, OR
  append it to `arguments:` (it's read from `Bare.argv[2]`).
- **Networking.** Hyperswarm uses UDP; bare-kit-pear must provide raw UDP on
  iOS (which is why you built the SDK in the first place). If UDP is blocked
  on carrier networks, the app falls back to no peers; the DHT relay
  endpoint on a hiverelay would be the mitigation.
- **Sodium.** `sodium-universal` needs the Bare-compatible `sodium-native`
  addon. This should already be handled by the bare-kit build, but double-check
  that native addons are included in the `.framework`.
