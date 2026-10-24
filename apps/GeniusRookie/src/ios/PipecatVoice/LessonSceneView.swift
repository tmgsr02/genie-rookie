import SwiftUI
import WebKit

struct LessonSceneView: UIViewRepresentable {
    let bridge: LessonSceneBridge
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.add(bridge, name: "lesson")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = bridge
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.98, green: 0.97, blue: 0.94, alpha: 1)
        web.scrollView.bounces = false
        bridge.webView = web
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "LessonScene") {
            bridge.sceneURL = url
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: ()) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "lesson")
        uiView.navigationDelegate = nil
    }
}
