import Foundation
import Observation
import WebKit

/// Narrow, local-only scene bridge. The webpage owns physics; Python owns lesson progression.
@MainActor @Observable
final class LessonSceneBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private(set) var session = UUID().uuidString
    private(set) var summary = "A little weight can balance a big one."
    private(set) var phase = "wonder"
    private(set) var sceneVersion = -1
    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored var sceneURL: URL?
    @ObservationIgnored var onEvent: (([String: Any]) -> Void)?
    @ObservationIgnored private var seen = Set<String>()
    @ObservationIgnored private var booted = false
    @ObservationIgnored private var smokeStarted = false
    @ObservationIgnored private var pendingState: [String: Any]?

    func restart() {
        session = UUID().uuidString; sceneVersion = -1; seen.removeAll(); phase = "wonder"
        onEvent?(["type": "lesson_event", "kind": "reset", "lesson_session": session])
        bootstrap()
    }

    func runtimeReady() {
        sceneVersion = -1; seen.removeAll()
        onEvent?(["type": "lesson_event", "kind": "reset", "lesson_session": session])
        if booted { bootstrap(); runSmokeIfRequested() }
    }

    private func bootstrap() {
        Task { _ = try? await webView?.callAsyncJavaScript("window.lessonBootstrap(session)", arguments: ["session": session], in: nil, contentWorld: .page) }
    }

    func receive(_ payload: [String: Any]) {
        guard payload["lesson_session"] as? String == session,
              let next = payload["phase"] as? String,
              ["wonder", "predict", "experiment", "observe", "explain", "transfer", "finish"].contains(next),
              let prompt = payload["prompt"] as? String else { return }
        phase = next; summary = prompt
        pendingState = payload
        if booted { deliver(payload) }
        if next == "finish", let minimal = payload["summary"] as? [String: Bool] {
            // Minimal progress only. No predictions, explanations, raw transcripts or audio.
            UserDefaults.standard.set(minimal, forKey: "genius-rookie.lesson.balance_01.summary")
        }
    }

    func apply(_ command: [String: Any]) {
        guard command["session"] as? String == session,
              command["expected_scene_version"] as? Int == sceneVersion,
              ["move_weight", "set_weight", "reset_experiment", "highlight_part", "pause_scene"].contains(command["type"] as? String ?? "") else { return }
        Task { _ = try? await webView?.callAsyncJavaScript("window.applySceneCommand(command)", arguments: ["command": command], in: nil, contentWorld: .page) }
    }

    private func deliver(_ payload: [String: Any]) {
        Task { _ = try? await webView?.callAsyncJavaScript("window.lessonUpdate(state)", arguments: ["state": payload], in: nil, contentWorld: .page) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--lesson-smoke") {
            NSLog("GENIUS_SCENE_MESSAGE kind=%@ url=%@", (message.body as? [String: Any])?["kind"] as? String ?? "?", message.frameInfo.request.url?.path ?? "nil")
        }
        #endif
        guard message.name == "lesson", message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, url.isFileURL,
              url.standardizedFileURL == sceneURL?.standardizedFileURL,
              let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        if kind == "ready" {
            booted = true; bootstrap()
            runSmokeIfRequested()
            if let pendingState { deliver(pendingState) }
            return
        }
        guard body["lesson_session"] as? String == session,
              let id = body["event_id"] as? String, id.count <= 100, !seen.contains(id), seen.count < 4096,
              ["scene_result", "continue", "prediction", "explanation"].contains(kind) else { return }
        if kind == "scene_result" {
            guard let r = body["result"] as? [String: Any], r["status"] as? String == "applied",
                  let version = r["scene_version"] as? Int, version > sceneVersion,
                  let values = r["values"] as? [String: Any],
                  ["balanced", "left_down", "right_down"].contains(r["outcome"] as? String ?? ""),
                  ["left_count", "left_distance", "right_count", "right_distance"].allSatisfy({
                      guard let n = values[$0] as? Int else { return false }; return (1...4).contains(n)
                  }) else { return }
            sceneVersion = version
        }
        seen.insert(id)
        var event = body; event["type"] = "lesson_event"
        onEvent?(event)
    }

    private func runSmokeIfRequested() {
        #if DEBUG
        guard (ProcessInfo.processInfo.arguments.contains("--lesson-smoke") || ProcessInfo.processInfo.arguments.contains("--lesson-review")), !smokeStarted else { return }
        smokeStarted = true
        NSLog("GENIUS_LESSON_SMOKE started")
        Task { @MainActor in
            @MainActor func waitFor(_ expected: String) async throws {
                for _ in 0..<100 {
                    if self.phase == expected && self.sceneVersion >= 0 && self.pendingState != nil { return }
                    try await Task.sleep(for: .milliseconds(100))
                }
                throw NSError(domain: "LessonSmoke", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected \(expected), got \(self.phase) v\(self.sceneVersion)"])
            }
            @MainActor func js(_ code: String) async throws {
                guard let web = self.webView else { throw NSError(domain: "LessonSmoke", code: 2) }
                _ = try await web.callAsyncJavaScript(code, arguments: [:], in: nil, contentWorld: .page)
            }
            do {
                try await waitFor("wonder")
                try await js("event('continue')")
                try await waitFor("predict")
                try await js("event('prediction', {choice:'unsure'})")
                try await waitFor("experiment")
                if ProcessInfo.processInfo.arguments.contains("--lesson-review") {
                    NSLog("GENIUS_LESSON_REVIEW ready: real lesson in experiment phase")
                    return
                }
                try await js("act('move_weight', {entity_id:'right_carrier',value:2})")
                try await Task.sleep(for: .milliseconds(150))
                try await js("act('move_weight', {entity_id:'right_carrier',value:3})")
                try await waitFor("observe")
                try await js("event('continue')")
                try await waitFor("explain")
                try await js("event('explanation', {choice:'distance_and_weight'})")
                try await waitFor("transfer")
                try await Task.sleep(for: .milliseconds(200))
                try await js("act('move_weight', {entity_id:'right_carrier',value:4})")
                try await waitFor("finish")
                NSLog("GENIUS_LESSON_SMOKE PASS: WKWebView → native → Python prediction, experiment, explain, transfer; scene version \(self.sceneVersion)")
            } catch { NSLog("GENIUS_LESSON_SMOKE FAIL: \(error)") }
        }
        #endif
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(navigationAction.navigationType == .other && url?.isFileURL == true && url?.standardizedFileURL == sceneURL?.standardizedFileURL ? .allow : .cancel)
    }
}
