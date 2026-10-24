import Foundation
import Observation
import SwiftUI
import WebKit

/// Only this bridge has native privileges. Package code receives JSON and a private resource origin.
@MainActor @Observable
final class ExplainerRuntime: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKURLSchemeHandler, WKUIDelegate {
    let package: ExplainerPackage
    let sessionID: String
    private(set) var revision = -1
    private(set) var acknowledgedRevision = -1
    var paused: Bool { state["paused"] as? Bool ?? false }
    var supportsPause: Bool { (package.manifest["controls"] as? [[String: Any]])?.contains(where: { $0["name"] as? String == "pause" }) == true }
    private(set) var state: [String: Any] = [:]
    private(set) var webView: WKWebView!
    private weak var owner: ExplainerController?
    private var eventIDs = Set<String>()
    private var eventOrder: [String] = []
    private var commandIDs = Set<String>()
    private var initialNavigation = true

    init(package: ExplainerPackage, sessionID: String, owner: ExplainerController) {
        self.package = package; self.sessionID = sessionID; self.owner = owner
        super.init()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.allowsInlineMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.setURLSchemeHandler(WeakExplainerSchemeHandler(self), forURLScheme: "explainer")
        config.userContentController.add(WeakExplainerMessageHandler(self), name: "explainer")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 247/255, green: 242/255, blue: 232/255, alpha: 1)
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        webView.isInspectable = false
    }

    var basis: [String: Any] { ["scene_id": package.sceneID, "scene_version": package.version, "state_revision": revision] }

    func acknowledge(_ revision: Int) { acknowledgedRevision = max(acknowledgedRevision, revision) }

    func togglePause() {
        owner?.control(name: "pause", input: ["paused": !paused])
    }

    func load() {
        guard let url = URL(string: "explainer://scene/\(package.entry)") else { return }
        webView.load(URLRequest(url: url))
    }

    func apply(_ command: [String: Any]) async throws {
        try Task.checkCancellation()
        guard command["session_id"] as? String == sessionID,
              command["scene_id"] as? String == package.sceneID,
              command["scene_version"] as? Int == package.version,
              command["expected_state_revision"] as? Int == revision,
              let id = command["request_id"] as? String, Self.validID(id), !commandIDs.contains(id), commandIDs.count < 1000,
              let name = command["name"] as? String,
              let control = (package.manifest["controls"] as? [[String: Any]])?.first(where: { $0["name"] as? String == name }),
              let schema = control["input_schema"] as? [String: Any],
              let input = command["input"], Self.matches(input, schema: schema) else {
            throw VoiceError(message: "That control no longer matches the experiment. Please try again.")
        }
        commandIDs.insert(id)
        _ = try await webView.callAsyncJavaScript("return window.explainerCommand(command)", arguments: ["command": command], in: nil, contentWorld: .page)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "explainer",
              let event = message.body as? [String: Any], JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event), data.count <= 64_000,
              event["session_id"] as? String == sessionID,
              event["scene_id"] as? String == package.sceneID,
              event["scene_version"] as? Int == package.version,
              let id = event["event_id"] as? String, Self.validID(id), !eventIDs.contains(id),
              event["request_id"] == nil || (event["request_id"] as? String).map(Self.validID) == true,
              let kind = event["kind"] as? String,
              ["ready", "action_applied", "action_rejected", "state_changed", "interaction_completed", "runtime_error"].contains(kind),
              let next = event["state_revision"] as? Int, next >= 0,
              let state = event["state"] as? [String: Any],
              let stateData = try? JSONSerialization.data(withJSONObject: state), stateData.count <= 32768,
              let schema = package.manifest["state_schema"] as? [String: Any], Self.matches(state, schema: schema) else { return }
        if kind == "ready" { guard revision == -1 else { return } }
        else if kind == "action_applied" { guard next > revision else { return } }
        else if kind == "state_changed" {
            guard next >= revision else { return }
            if next == revision {
                guard NSDictionary(dictionary: self.state).isEqual(to: state) else { return }
            }
        }
        else { guard next == revision else { return } }
        eventIDs.insert(id); eventOrder.append(id)
        if eventOrder.count > 2000 { eventIDs.remove(eventOrder.removeFirst()) }
        revision = next; self.state = state
        owner?.receiveRuntime(event, from: self)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let bootstrap: [String: Any] = ["session_id": sessionID, "scene_id": package.sceneID, "scene_version": package.version]
        Task {
            do { _ = try await webView.callAsyncJavaScript("return window.explainerBootstrap(config)", arguments: ["config": bootstrap], in: nil, contentWorld: .page) }
            catch { reportError() }
        }
    }

    private func reportError() {
        owner?.receiveRuntime(["kind": "runtime_error"], from: self)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reportError() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { reportError() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { reportError() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let allowed = initialNavigation && navigationAction.targetFrame?.isMainFrame == true && url?.scheme == "explainer" && url?.host == "scene" && url?.path == "/\(package.entry)"
        if allowed { initialNavigation = false }
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) { completionHandler(nil) }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "scene", url.query == nil,
              let source = package.files[String(url.path.dropFirst())] else {
            urlSchemeTask.didFailWithError(URLError(.resourceUnavailable)); return
        }
        let mime: String
        switch url.pathExtension {
        case "html": mime = "text/html"
        case "js": mime = "text/javascript"
        case "css": mime = "text/css"
        case "svg": mime = "image/svg+xml"
        case "json": mime = "application/json"
        default: urlSchemeTask.didFailWithError(URLError(.unsupportedURL)); return
        }
        var content = source
        if mime == "text/html" {
            // Prefixing a policy keeps it ahead of every generated script. No remote resources,
            // navigation, forms, frames, media, workers, or native API other than our JSON handler.
            let policy = "default-src 'none'; script-src explainer:; style-src explainer: 'unsafe-inline'; img-src explainer: data:; font-src explainer:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
            content = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" + source
        }
        let data = Data(content.utf8)
        urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { }

    nonisolated static func validID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil
    }

    /// Defensive native validation complements the full server/runtime JSON Schema validator.
    static func matches(_ value: Any, schema: [String: Any], depth: Int = 0) -> Bool {
        guard depth < 24 else { return false }
        if let allowed = schema["enum"] as? [Any] {
            guard allowed.contains(where: { String(describing: $0) == String(describing: value) }) else { return false }
        }
        switch schema["type"] as? String {
        case "object":
            guard let object = value as? [String: Any] else { return false }
            let properties = schema["properties"] as? [String: [String: Any]] ?? [:]
            for key in schema["required"] as? [String] ?? [] { if object[key] == nil { return false } }
            for (key, child) in object {
                if let property = properties[key] { if !matches(child, schema: property, depth: depth + 1) { return false } }
                else if schema["additionalProperties"] as? Bool == false { return false }
            }
        case "array":
            guard let array = value as? [Any], array.count <= (schema["maxItems"] as? Int ?? 10000), array.count >= (schema["minItems"] as? Int ?? 0) else { return false }
            if let item = schema["items"] as? [String: Any], !array.allSatisfy({ matches($0, schema: item, depth: depth + 1) }) { return false }
        case "string":
            guard let text = value as? String, text.count <= (schema["maxLength"] as? Int ?? 100000), text.count >= (schema["minLength"] as? Int ?? 0) else { return false }
        case "number", "integer":
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
            let n = number.doubleValue
            guard n.isFinite, n >= (schema["minimum"] as? Double ?? -.infinity), n <= (schema["maximum"] as? Double ?? .infinity) else { return false }
            if schema["type"] as? String == "integer", n.rounded() != n { return false }
        case "boolean":
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
        case "null": return value is NSNull
        default: break
        }
        return true
    }
}

private final class WeakExplainerSchemeHandler: NSObject, WKURLSchemeHandler {
    weak var target: ExplainerRuntime?
    init(_ target: ExplainerRuntime) { self.target = target }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let target else { urlSchemeTask.didFailWithError(URLError(.cancelled)); return }
        target.webView(webView, start: urlSchemeTask)
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { target?.webView(webView, stop: urlSchemeTask) }
}

private final class WeakExplainerMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: ExplainerRuntime?
    init(_ target: ExplainerRuntime) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(userContentController, didReceive: message) }
}

struct ExplainerWebSurface: UIViewRepresentable {
    let controller: ExplainerController
    func makeUIView(context: Context) -> UIView { UIView() }
    func updateUIView(_ view: UIView, context: Context) {
        let scenes = [controller.activeScene, controller.pendingScene].compactMap { $0 }
        let webs = scenes.compactMap(\.webView)
        for child in view.subviews where !webs.contains(where: { $0 === child }) { child.removeFromSuperview() }
        for scene in scenes {
            guard let web = scene.webView else { continue }
            if web.superview !== view {
                web.removeFromSuperview(); view.addSubview(web)
                web.translatesAutoresizingMaskIntoConstraints = false
                NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor), web.topAnchor.constraint(equalTo: view.topAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
            }
            web.alpha = scene === controller.activeScene ? 1 : 0
            web.isUserInteractionEnabled = scene === controller.activeScene
            web.accessibilityElementsHidden = scene !== controller.activeScene
        }
    }
}
