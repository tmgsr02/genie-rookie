import Foundation
import CoreFoundation
import Observation
import WebKit

/// Only the public progress contract reaches the view, never authoring messages.
struct ExplainerProgress: Equatable {
    enum Phase: String {
        case preparing, authoring, checking, publishing

        var title: String {
            switch self {
            case .preparing: "Getting your explanation ready…"
            case .authoring: "Creating your explanation…"
            case .checking: "Checking that it works…"
            case .publishing: "Opening your explanation…"
            }
        }
    }

    let phase: Phase
    let elapsedMilliseconds: Int

    init?(_ value: Any?) {
        guard let json = value as? [String: Any],
              let name = json["phase"] as? String, let phase = Phase(rawValue: name),
              let number = json["elapsed_ms"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              let elapsed = json["elapsed_ms"] as? Int, elapsed >= 0 else { return nil }
        self.phase = phase
        elapsedMilliseconds = elapsed
    }

    var elapsedTitle: String {
        let seconds = elapsedMilliseconds / 1000
        return seconds < 60 ? "\(seconds)s elapsed" : "\(seconds / 60)m \(seconds % 60)s elapsed"
    }
}

struct ExplainerPackage {
    let sceneID: String
    let version: Int
    let title: String
    let provenance: String
    let entry: String
    let files: [String: String]
    let manifest: [String: Any]

    init(_ json: [String: Any]) throws {
        guard let id = json["scene_id"] as? String, ExplainerRuntime.validID(id),
              let version = json["scene_version"] as? Int, version > 0,
              let entry = json["entry"] as? String, entry == "index.html",
              let files = json["files"] as? [String: String], files[entry] != nil,
              files.count <= 64, files.values.reduce(0, { $0 + $1.utf8.count }) <= 3_000_000,
              files.keys.allSatisfy({ path in
                  !path.contains("..") && path.range(of: "^[A-Za-z0-9][A-Za-z0-9_./-]{0,119}$", options: .regularExpression) != nil &&
                  (path == "index.html" || ["js", "css", "svg", "json"].contains((path as NSString).pathExtension))
              }),
              let manifest = json["manifest"] as? [String: Any],
              let title = manifest["title"] as? String,
              manifest["controls"] is [[String: Any]], manifest["state_schema"] is [String: Any],
              let validation = json["validation"] as? [String: Any], validation["passed"] as? Bool == true,
              let provenance = json["provenance"] as? String, ["authored", "configured", "cache"].contains(provenance) else {
            throw VoiceError(message: "This explanation did not pass its checks.")
        }
        sceneID = id; self.version = version; self.entry = entry; self.files = files
        self.title = title; self.manifest = manifest; self.provenance = provenance
    }
}

@MainActor @Observable
final class ExplainerController {
    let client = ExplainerClient()
    private(set) var activeScene: ExplainerRuntime?
    private(set) var pendingScene: ExplainerRuntime?
    private(set) var phase = "idle"
    private(set) var progress: ExplainerProgress?
    private(set) var notice: String?
    private(set) var diagnostic: String?
    private(set) var jobID: String?
    private(set) var planning = false
    private(set) var lastDialogue: [[String: String]] = []
    var onDialogue: (([String: Any]) -> Void)?
    var onInvalidate: (() -> Void)?
    var canConverse: (() -> Bool)?
    private var conversationSchedule = GenerationConversationSchedule()
    private var conversationTask: Task<Void, Never>?
    private var localRecovery = false
    private var conversationClock: TimeInterval { ProcessInfo.processInfo.systemUptime }

    private static let recoveryDialogue: [[String: String]] = [
        ["speaker": "rookie", "text": "Our picture didn’t quite come together. I’m still curious, though!"],
        ["speaker": "genius", "text": "Me too. We can talk it through in words, or try making the picture again. What would you like?"],
    ]

    /// Called as soon as the human takes the floor, before transcription or HTTP completes.
    func userInteracted() {
        conversationSchedule.userInteracted(now: conversationClock)
        restartConversationTask()
    }

    private func startConversation(jobID: String, failed: Bool = false, local: Bool = false) {
        localRecovery = local
        if failed { conversationSchedule.fail(jobID: jobID, now: conversationClock) }
        else { conversationSchedule.start(jobID: jobID, now: conversationClock) }
        restartConversationTask()
    }

    private func stopConversation() {
        conversationSchedule.stop()
        conversationTask?.cancel(); conversationTask = nil
    }

    private func restartConversationTask() {
        conversationTask?.cancel(); conversationTask = nil
        guard conversationSchedule.hasTarget else { return }
        let current = generation
        conversationTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, generation == current, conversationSchedule.hasTarget {
                do { try await Task.sleep(for: .milliseconds(500)) }
                catch { return }
                let eligible = !planning && pendingScene == nil && canConverse?() == true
                guard let ticket = conversationSchedule.next(now: conversationClock, eligible: eligible) else { continue }
                var response: [String: Any] = [:]
                do {
                    if localRecovery {
                        response = ["dialogue": Self.recoveryDialogue]
                        if let basis = activeScene?.basis { response["basis"] = basis }
                    } else {
                        response = try await client.call("generation-dialogue", body: [
                            "request_id": UUID().uuidString, "job_id": ticket.jobID,
                            "phase": ticket.phase, "heard": presentedHistory,
                        ])
                    }
                } catch is CancellationError { return }
                catch {
                    // Optional conversation cannot replace the visual's status with a network error.
                    if ticket.phase == "failed" {
                        response = ["dialogue": Self.recoveryDialogue]
                        if let basis = activeScene?.basis { response["basis"] = basis }
                    }
                }
                guard !Task.isCancelled, generation == current else { return }
                guard conversationSchedule.complete(ticket, now: conversationClock),
                      !planning, pendingScene == nil, canConverse?() == true else { continue }
                guard !(response["dialogue"] as? [[String: Any]] ?? []).isEmpty else { continue }
                response["automatic_generation_dialogue"] = true
                rememberDialogue(response)
                onDialogue?(response)
            }
        }
    }
    private var poll: Task<Void, Never>?
    private var pendingTimeout: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var reconnection: Task<Void, Never>?
    private var generation = UUID()
    private var seenJobs = Set<String>()
    private var cursor = 0
    private var invalidatedBasis: String?
    private var smokeControlSent = false
    private var presentedHistory: [[String: String]] = []
    private var narrationBuffer = ExplainerNarrationBuffer()

    init() {
        client.onSessionExpired = { [weak self] in self?.reconnectExpiredSession() }
    }

    private func reconnectExpiredSession() {
        reset()
        onInvalidate?()
        notice = "Reconnecting to your tutor…"
        let current = generation
        reconnection = Task {
            do {
                try await client.ensureSession()
                guard generation == current else { return }
                if !planning { notice = "Your tutor reconnected. Please ask your question again." }
            } catch is CancellationError { }
            catch {
                guard generation == current else { return }
                diagnostic = error.localizedDescription
                notice = "Your tutor couldn’t reconnect yet. Try your question again in a moment."
            }
        }
    }

    func recordPresented(_ response: [String: Any]) {
        let lines = response["dialogue"] as? [[String: String]] ?? []
        for line in lines {
            guard let speaker = line["speaker"], ["genius", "rookie"].contains(speaker), let text = line["text"] else { continue }
            presentedHistory.append(["speaker": speaker, "text": String(text.prefix(700))])
        }
        presentedHistory = Array(presentedHistory.suffix(12))
    }

    var busy: Bool { planning || ["requested", "generating", "validating", "revising"].contains(phase) }
    var phaseTitle: String {
        if let progress, busy { return progress.phase.title }
        return switch phase {
        case "requested": "Finding a way to explore…"
        case "generating": "Building your explanation…"
        case "validating": "Checking that it works…"
        case "revising": "Trying a new way to show it…"
        case "ready": "Your explanation is ready"
        case "cancelled": "We can try something else."
        case "failed": "That explanation needs another try."
        default: planning ? "Thinking about your question…" : ""
        }
    }

    func plan(text: String, requestID: String = UUID().uuidString, heard: [[String: String]]? = nil) async throws -> [String: Any] {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, question.count <= 4000 else { throw VoiceError(message: "Try a shorter question.") }
        if let activeScene, activeScene.acknowledgedRevision != activeScene.revision {
            notice = "Your experiment is reconnecting. Try your question again in a moment."
            throw VoiceError(message: "Your experiment is reconnecting. Try your question again in a moment.")
        }
        userInteracted()
        let current = generation
        planning = true; notice = nil; progress = nil
        defer { if generation == current { planning = false } }
        do {
            var body: [String: Any] = ["request_id": requestID, "text": question]
            let context = heard ?? presentedHistory
            if !context.isEmpty { body["heard"] = Array(context.suffix(12)) }
            presentedHistory = Array((context + [["speaker": "child", "text": String(question.prefix(700))]]).suffix(12))
            let response = try await client.call("turns", body: body)
            try Task.checkCancellation()
            guard generation == current else { throw CancellationError() }
            if let id = response["job_id"] as? String {
                if let previous = jobID, previous != id { seenJobs.insert(previous) }
                if jobID != id { startConversation(jobID: id) }
                jobID = id; progress = nil; phase = activeScene == nil ? "requested" : "revising"
            }
            if let commands = response["commands"] as? [[String: Any]] { for command in commands { try Task.checkCancellation(); try await activeScene?.apply(command) } }
            startPolling()
            rememberDialogue(response)
            return response
        } catch {
            if !(error is CancellationError) { showFailure(error) }
            throw error
        }
    }

    func submit(_ text: String) {
        Task {
            do {
                let response = try await plan(text: text)
                onDialogue?(response)
            }
            catch { }
        }
    }

    func saveConnection(endpoint: String, token: String) throws {
        let changed = client.endpoint != endpoint.trimmingCharacters(in: .whitespacesAndNewlines) || client.bootstrapToken != token
        try client.save(endpoint: endpoint, token: token)
        if changed { reset() }
    }

    func control(name: String, input: [String: Any]) {
        guard let scene = activeScene, scene.revision == scene.acknowledgedRevision else { return }
        Task {
            do {
                let result = try await client.call("tools", body: ["request_id": UUID().uuidString, "name": "control_explainer", "arguments": ["scene_id": scene.package.sceneID, "scene_version": scene.package.version, "expected_state_revision": scene.revision, "name": name, "input": input]])
                guard activeScene === scene else { return }
                for command in result["commands"] as? [[String: Any]] ?? [] { try await scene.apply(command) }
            } catch is CancellationError { }
            catch { diagnostic = error.localizedDescription; notice = "That change didn’t reach your experiment. Please try again." }
        }
    }

    #if DEBUG
    private func runSmokeControl() {
        guard !smokeControlSent else { return }
        let args = ProcessInfo.processInfo.arguments
        guard let nameIndex = args.firstIndex(of: "--explainer-smoke-control"), args.indices.contains(nameIndex + 1),
              let inputIndex = args.firstIndex(of: "--explainer-smoke-input"), args.indices.contains(inputIndex + 1),
              let data = args[inputIndex + 1].data(using: .utf8),
              let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        smokeControlSent = true
        control(name: args[nameIndex + 1], input: input)
    }
    #endif

    func reset() {
        stopConversation()
        narrationBuffer.reset()
        reconnection?.cancel(); reconnection = nil
        generation = UUID(); poll?.cancel(); poll = nil; pendingTimeout?.cancel(); eventTask?.cancel()
        activeScene = nil; pendingScene = nil; client.reset(); cursor = 0; jobID = nil
        phase = "idle"; progress = nil; planning = false; notice = nil; lastDialogue = []; seenJobs = []; presentedHistory = []; invalidatedBasis = nil
    }

    func cancel() {
        guard pendingScene == nil, let id = jobID else { return }
        stopConversation()
        seenJobs.insert(id); pendingScene = nil; pendingTimeout?.cancel(); phase = "cancelled"; jobID = nil; progress = nil
        Task {
            do { _ = try await client.call("tools", body: ["request_id": UUID().uuidString, "name": "cancel_generation", "arguments": ["job_id": id]]) }
            catch { diagnostic = error.localizedDescription }
        }
    }

    private func startPolling() {
        guard poll == nil else { return }
        let current = generation
        poll = Task { [weak self] in
            guard let self else { return }
            defer { if generation == current { poll = nil } }
            while !Task.isCancelled, generation == current {
                do {
                    let response = try await client.call("events?after=\(cursor)")
                    guard !Task.isCancelled, generation == current else { return }
                    for event in response["events"] as? [[String: Any]] ?? [] { await receive(event) }
                    cursor = response["cursor"] as? Int ?? cursor
                    try await Task.sleep(for: .milliseconds(500))
                } catch is CancellationError { return }
                catch { diagnostic = error.localizedDescription; try? await Task.sleep(for: .seconds(3)) }
            }
        }
    }

    private func receive(_ event: [String: Any]) async {
        if event["type"] as? String == "dialogue" {
            #if DEBUG
            print("EXPLAINER_DIALOGUE: lines=\((event["dialogue"] as? [[String: Any]] ?? []).count)")
            #endif
            let scenes = [pendingScene, activeScene].compactMap { $0 }
            for scene in scenes {
                if let ready = narrationBuffer.receive(event, sceneID: scene.package.sceneID,
                    version: scene.package.version, revision: scene.revision,
                    acknowledged: scene === activeScene && scene.acknowledgedRevision == scene.revision) {
                    rememberDialogue(ready); onDialogue?(ready)
                    break
                }
            }
            return
        }
        let id = event["job_id"] as? String
        if let id, seenJobs.contains(id) || (jobID != nil && id != jobID) { return }
        let status = event["status"] as? String ?? event["type"] as? String ?? ""
        if ["requested", "generating", "validating", "revising"].contains(status), let id, id == jobID {
            // Missing or future fields fall back to the legacy status label.
            progress = ExplainerProgress(event["progress"])
        }
        if ["ready", "failed", "cancelled"].contains(status) { progress = nil }
        if ["requested", "generating", "validating", "revising", "cancelled", "failed"].contains(status) { phase = status }
        if ["ready", "failed", "cancelled"].contains(status) { stopConversation() }
        if status == "failed", let id { startConversation(jobID: id, failed: true) }
        if ["failed", "cancelled"].contains(status) {
            if let id { seenJobs.insert(id) }
            jobID = nil
        }
        if status == "failed" {
            notice = activeScene == nil ? "The picture needs another try. We can still talk it through." : "We couldn’t finish that explanation. Your last experiment is still here."
            diagnostic = event["error"] as? String
            #if DEBUG
            print("EXPLAINER_FAILED: \(diagnostic ?? "unknown")")
            #endif
        }
        if status == "ready", let id {
            let current = generation
            do {
                let result = try await client.call("jobs/\(id)")
                guard generation == current, !seenJobs.contains(id), jobID == id else { return }
                guard let json = result["package"] as? [String: Any] else { throw VoiceError(message: "The explanation package is missing.") }
                try stage(ExplainerPackage(json))
                seenJobs.insert(id)
            } catch {
                guard generation == current, !seenJobs.contains(id), jobID == id else { return }
                showFailure(error)
            }
        }
    }

    private func stage(_ package: ExplainerPackage) throws {
        guard let sessionID = client.sessionID else { throw CancellationError() }
        if let activeScene, activeScene.package.sceneID == package.sceneID, package.version <= activeScene.package.version { return }
        let scene = ExplainerRuntime(package: package, sessionID: sessionID, owner: self)
        pendingScene = scene
        phase = "validating"
        pendingTimeout?.cancel()
        pendingTimeout = Task { [weak self, weak scene] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self, let scene, pendingScene === scene else { return }
            pendingScene = nil; showFailure(VoiceError(message: "The explanation did not become ready."))
        }
        scene.load()
    }

    func receiveRuntime(_ event: [String: Any], from scene: ExplainerRuntime) {
        guard scene === activeScene || scene === pendingScene else { return }
        let kind = event["kind"] as? String ?? ""
        if kind == "runtime_error" {
            if scene === pendingScene { pendingScene = nil; pendingTimeout?.cancel() }
            showFailure(VoiceError(message: "The explanation stopped responding.")); return
        }
        let candidateReady = kind == "ready" && scene === pendingScene
        guard candidateReady || scene === activeScene else { return }
        if !candidateReady, ["action_applied", "state_changed"].contains(kind) { invalidateNarration(for: scene) }
        let current = generation
        let previous = eventTask
        // Deliver in order and retry the same event id: a lost acknowledgement must not
        // let the planner describe state older than the child's visible experiment.
        eventTask = Task { [weak self, weak scene] in
            await previous?.value
            guard let self, let scene else { return }
            while !Task.isCancelled, generation == current,
                  scene === activeScene || scene === pendingScene {
                do {
                    let response = try await client.call("scene-events", body: event)
                    guard generation == current, scene === activeScene || scene === pendingScene else { return }
                    if candidateReady {
                        guard pendingScene === scene else { return }
                        activeScene = scene; pendingScene = nil; pendingTimeout?.cancel()
                        phase = "ready"; jobID = nil; progress = nil
                        #if DEBUG
                        print("EXPLAINER_READY: \(scene.package.sceneID) version=\(scene.package.version) source=\(scene.package.provenance)")
                        #endif
                        invalidateNarration(for: scene)
                    }
                    scene.acknowledge(event["state_revision"] as? Int ?? -1)
                    #if DEBUG
                    if candidateReady { runSmokeControl() }
                    if kind == "action_applied" { print("EXPLAINER_ACTION_ACK: revision=\(scene.acknowledgedRevision)") }
                    #endif
                    notice = nil
                    guard (event["state_revision"] as? Int) == scene.revision else { return }
                    if !(response["dialogue"] as? [[String: Any]] ?? []).isEmpty {
                        rememberDialogue(response); onDialogue?(response)
                        narrationBuffer.reset()
                    } else if let queued = narrationBuffer.acknowledge(sceneID: scene.package.sceneID,
                        version: scene.package.version, revision: scene.revision) {
                        rememberDialogue(queued); onDialogue?(queued)
                    }
                    return
                } catch is CancellationError { return }
                catch {
                    diagnostic = error.localizedDescription
                    notice = "Reconnecting to your tutor. Your experiment is safe here."
                    try? await Task.sleep(for: .seconds(3))
                }
            }
        }
    }

    private func invalidateNarration(for scene: ExplainerRuntime) {
        let key = "\(scene.package.sceneID):\(scene.package.version):\(scene.revision)"
        guard invalidatedBasis != key else { return }
        invalidatedBasis = key; lastDialogue = []
        onInvalidate?()
    }

    private func rememberDialogue(_ response: [String: Any]) {
        lastDialogue = (response["dialogue"] as? [[String: Any]] ?? []).compactMap { line in
            guard let text = line["text"] as? String, let speaker = line["speaker"] as? String else { return nil }
            return ["speaker": speaker, "text": text]
        }
    }

    private func showFailure(_ error: Error) {
        #if DEBUG
        print("EXPLAINER_FAILED: \(error.localizedDescription)")
        #endif
        startConversation(jobID: jobID ?? UUID().uuidString, failed: true, local: true)
        diagnostic = error.localizedDescription; phase = "failed"; progress = nil
        if let jobID { seenJobs.insert(jobID) }
        jobID = nil
        notice = client.configured ? "We couldn’t finish that explanation. You can try again." : "Ask a grown-up to connect your tutor in Settings, then ask anything you’re curious about."
    }
}
