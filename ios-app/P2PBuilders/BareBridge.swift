import Foundation
import BareKit

// BareBridge wires three things together:
//   1. A BareWorklet running our bundled JS backend (bare-pack output)
//   2. A BareIPC for talking to that worklet
//   3. A WKWebView on the other side — frames we receive from the webview
//      get written to IPC; frames we read from IPC get dispatched back to
//      the webview via a callback (usually `window.__bareRx(chunk)`).
//
// Wire format: line-delimited JSON (our backend's harness.js handles this).
//
// Lifecycle — call startWorklet(...) once, then sendToWorklet(...) for each
// outgoing frame. Incoming frames are delivered via onFrameFromWorklet.

final class BareBridge {
  private var worklet: BareWorklet?
  private var ipc: BareIPC?
  private var readBuffer = Data()
  private let readQueue = DispatchQueue(label: "com.p2pbuilders.bare.read")

  // Called with each inbound frame (as a UTF-8 string, already de-framed
  // from the newline-delimited stream). Set this before starting the worklet.
  var onFrameFromWorklet: ((String) -> Void)?

  // Load the bundled backend source and start the worklet + IPC.
  // Throws if the bundle resource is missing.
  func startWorklet(bundleResource: String = "backend.bundle", bundleExtension: String = "mjs") throws {
    guard let url = Bundle.main.url(forResource: bundleResource, withExtension: bundleExtension) else {
      throw NSError(
        domain: "BareBridge",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Missing bundled resource \(bundleResource).\(bundleExtension)"]
      )
    }
    let source = try String(contentsOf: url, encoding: .utf8)

    let worklet = BareWorklet()
    try worklet.start(name: "p2pbuilders", source: source, arguments: [])
    self.worklet = worklet

    // Auto-wired by bare-kit after worklet.start()
    let ipc = BareIPC(worklet: worklet)
    self.ipc = ipc

    // Kick off the read loop.
    readLoop()
  }

  // Push bytes from the webview to the Bare worklet. We append a newline so
  // the JSON-RPC framer on the JS side sees a complete frame per call.
  func sendToWorklet(_ jsonFrame: String) {
    guard let ipc = ipc else { return }
    var line = jsonFrame
    if !line.hasSuffix("\n") { line += "\n" }
    if let data = line.data(using: .utf8) {
      ipc.write(data) { _ in /* errors surface via read loop teardown */ }
    }
  }

  func shutdown() {
    worklet?.terminate()
    worklet = nil
    ipc = nil
  }

  // MARK: - Private

  private func readLoop() {
    guard let ipc = ipc else { return }
    ipc.read { [weak self] data, error in
      guard let self = self else { return }
      if let error = error {
        NSLog("[BareBridge] read error: %@", error.localizedDescription)
        return
      }
      if let data = data, !data.isEmpty {
        self.readQueue.sync {
          self.readBuffer.append(data)
          self.drainFrames()
        }
      }
      // Re-arm.
      self.readLoop()
    }
  }

  // Extract complete newline-delimited frames from the buffer, emit each as
  // a string to the webview-facing callback.
  private func drainFrames() {
    while let nlRange = readBuffer.range(of: Data([0x0A])) {
      let frameData = readBuffer.subdata(in: 0..<nlRange.lowerBound)
      readBuffer.removeSubrange(0..<nlRange.upperBound)
      guard let line = String(data: frameData, encoding: .utf8), !line.isEmpty else { continue }
      let cb = onFrameFromWorklet
      DispatchQueue.main.async { cb?(line) }
    }
  }
}
