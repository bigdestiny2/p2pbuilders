# P2PBuilders — iOS app shell

Minimal iOS app that embeds the p2pbuilders Bare backend (via bare-kit-pear)
alongside a WKWebView showing the frontend. Designed to run in the iOS
Simulator first; same target should work on device after codesigning.

## Architecture

```
┌──────────────────── iOS app process ────────────────────┐
│                                                         │
│  ┌─────────────────┐       ┌──────────────────────┐     │
│  │   WKWebView     │       │  BareWorklet         │     │
│  │                 │       │  (bare-kit-pear)     │     │
│  │  index.html     │       │                      │     │
│  │   ├ app.js      │       │   backend.bundle.mjs │     │
│  │   └ transport.js│       │    └ ios-entry.js    │     │
│  │                 │       │        ↓ loads       │     │
│  │                 │       │     harness.js       │     │
│  │                 │       │        ↓             │     │
│  │                 │       │     Node / Indexer / │     │
│  │                 │       │     Hyperswarm / ... │     │
│  └──────┬──────────┘       └────┬─────────────────┘     │
│         │                       │                       │
│         │  webkit.bare          │  BareIPC              │
│         │  postMessage          │                       │
│         │         ┌─────────────┴───────────┐           │
│         └────────→│       BareBridge        │           │
│                   │   (ViewController.swift) │          │
│                   │  newline-delimited JSON │           │
│                   │        RPC              │           │
│                   └─────────────────────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The frontend, backend, and RPC protocol are all unchanged from the Node /
Pear versions. This app is just a host.

## Prereqs

Install these once:

```bash
brew install xcodegen xcbeautify
xcode-select --install
```

Also make sure the monorepo's Node deps are installed:

```bash
cd ..          # project root
npm install
```

## First-time setup

### 1. Generate the Xcode project

```bash
cd ios-app
xcodegen
open P2PBuilders.xcodeproj
```

### 2. Add bare-kit-pear as a Swift Package dependency

In Xcode:

1. File → Add Package Dependencies…
2. Paste the bare-kit-pear URL: `https://github.com/bigdestiny2/bare-kit-pear`
3. Choose a version rule (branch `main` works)
4. Select the `BareKit` library product and add it to the `P2PBuilders` target.

If the module name isn't literally `BareKit`, change the `import BareKit`
line in `BareBridge.swift` to match.

### 3. Prepare frontend + backend bundles

From the project root:

```bash
./ios-app/scripts/prepare-resources.sh
```

This copies `public/*` into `ios-app/P2PBuilders/Resources/` and runs
`bare-pack` to produce `backend.bundle.mjs`.

Re-run whenever you change frontend files or anything under `src/bare` or
`src/backend`.

### 4. Build + run in the simulator

From the project root:

```bash
./ios-app/scripts/build-sim.sh
```

This: prepares resources, builds the app, finds (or boots) a simulator,
installs, and launches. When it finishes you should see the orange
p2pbuilders header on the iOS simulator window.

Alternatively, click Run in Xcode.

## What to expect on first launch

1. Welcome screen (first-launch onboarding)
2. Enter a nickname, tap "get started"
3. Front page — empty at first; submit a post
4. PoW pill animates while the backend mints (~80ms on simulator)
5. Thread view with upvote / reply / edit / delete

The backend joins Hyperswarm on the `front` board topic, so if another
peer is posting right now you should start seeing their posts after a
few seconds.

## Troubleshooting

- **Blank webview, no errors in Xcode:** the `Resources/` folder wasn't
  copied into the .app bundle. Re-run `prepare-resources.sh`, then rebuild.
- **`Missing bundled resource backend.bundle.mjs`:** run
  `prepare-resources.sh` before building.
- **`no such module 'BareKit'`:** bare-kit-pear Swift Package isn't
  linked. Redo step 2.
- **Backend starts but UI never connects (`ios-bare: disconnected`):**
  Check Xcode console for `[BareBridge] read error` lines. Likely cause
  is a bundling issue — the bundled JS references a native addon that
  wasn't shipped in bare-kit-pear. See the next section.
- **Native addons missing (sodium, hyperdht UDP):** bare-kit-pear must
  include the Bare addons our backend uses. Check bare-kit-pear's
  `Package.swift` or `Podfile.lock` for `bare-sodium`, `bare-hyperdht`,
  etc.
- **UDP blocked / no peers:** check Settings → peer count. If zero,
  your network probably doesn't allow UDP; fall back to a hosted
  DHT-relay (see project root `src/relay/server.js` for self-hosting
  or pair with a hiverelay).

## File layout

```
ios-app/
├── README.md                     ← this file
├── project.yml                   ← XcodeGen spec
├── P2PBuilders/
│   ├── AppDelegate.swift
│   ├── SceneDelegate.swift
│   ├── ViewController.swift      ← WKWebView + script message handler
│   ├── BareBridge.swift          ← BareKit.IPC ↔ newline-JSON frames
│   ├── Info.plist
│   ├── Assets.xcassets/
│   └── Resources/                ← populated by prepare-resources.sh
│       ├── index.html
│       ├── app.js
│       ├── styles.css
│       ├── transport.js
│       └── backend.bundle.mjs    ← bare-pack output
└── scripts/
    ├── prepare-resources.sh
    └── build-sim.sh
```
