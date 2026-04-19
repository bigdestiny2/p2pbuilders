import UIKit
import WebKit

// ViewController hosts a WKWebView and wires it to the Bare worklet via
// BareBridge. Flow:
//
//   frontend calls `window.webkit.messageHandlers.bare.postMessage(json)`
//       ↓  (WKScriptMessageHandler)
//   ViewController.userContentController(_:didReceive:)
//       ↓
//   BareBridge.sendToWorklet(json) → BareIPC.write
//
//   BareIPC.read → BareBridge.onFrameFromWorklet
//       ↓
//   webView.evaluateJavaScript("window.__bareRx(\(safeString))")
//       ↓
//   transport.js WebKit bridge resolves the pending RPC promise
//
// The webview loads index.html from the app bundle's Resources/ directory.

final class ViewController: UIViewController, WKScriptMessageHandler {
  private var webView: WKWebView!
  private let bridge = BareBridge()

  override func viewDidLoad() {
    super.viewDidLoad()
    setupWebView()
    startBackend()
  }

  private func setupWebView() {
    let contentController = WKUserContentController()
    contentController.add(self, name: "bare")

    let config = WKWebViewConfiguration()
    config.userContentController = contentController
    config.preferences.javaScriptCanOpenWindowsAutomatically = false

    let wv = WKWebView(frame: view.bounds, configuration: config)
    wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Useful during bring-up — remove/gate for release.
    if #available(iOS 16.4, *) {
      wv.isInspectable = true
    }
    view.addSubview(wv)
    self.webView = wv

    // Load index.html from the bundle's Resources directory.
    guard let resourcesUrl = Bundle.main.resourceURL else {
      NSLog("[ViewController] Bundle.main.resourceURL missing")
      return
    }
    let htmlUrl = resourcesUrl.appendingPathComponent("Resources/index.html")
    let baseUrl = resourcesUrl.appendingPathComponent("Resources")
    wv.loadFileURL(htmlUrl, allowingReadAccessTo: baseUrl)
  }

  private func startBackend() {
    bridge.onFrameFromWorklet = { [weak self] line in
      self?.deliverToWebView(line)
    }
    do {
      try bridge.startWorklet()
    } catch {
      NSLog("[ViewController] failed to start backend worklet: %@", String(describing: error))
    }
  }

  // MARK: - WKScriptMessageHandler

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "bare" else { return }
    guard let body = message.body as? String else { return }
    bridge.sendToWorklet(body)
  }

  // MARK: - Helpers

  private func deliverToWebView(_ line: String) {
    // Safely encode the line as a JSON string literal for injection.
    guard let data = try? JSONSerialization.data(withJSONObject: line, options: [.fragmentsAllowed]),
          let escaped = String(data: data, encoding: .utf8) else { return }
    let js = "window.__bareRx(\(escaped))"
    webView.evaluateJavaScript(js, completionHandler: nil)
  }

  deinit {
    bridge.shutdown()
  }
}
