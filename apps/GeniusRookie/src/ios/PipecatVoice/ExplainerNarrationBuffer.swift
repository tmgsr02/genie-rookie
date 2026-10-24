import Foundation

/// Event polling may deliver narration before the POST acknowledging its scene returns.
/// Keep one exact-state reply until that acknowledgement, never carry it across revisions.
struct ExplainerNarrationBuffer {
    private var pending: [String: Any]?

    mutating func receive(_ event: [String: Any], sceneID: String, version: Int,
                          revision: Int, acknowledged: Bool) -> [String: Any]? {
        guard Self.matches(event, sceneID: sceneID, version: version, revision: revision) else { return nil }
        if acknowledged { pending = nil; return event }
        pending = event
        return nil
    }

    mutating func acknowledge(sceneID: String, version: Int, revision: Int) -> [String: Any]? {
        defer { pending = nil }
        guard let pending, Self.matches(pending, sceneID: sceneID, version: version, revision: revision) else { return nil }
        return pending
    }

    mutating func reset() { pending = nil }

    private static func matches(_ event: [String: Any], sceneID: String, version: Int, revision: Int) -> Bool {
        guard let basis = event["basis"] as? [String: Any] else { return false }
        return basis["scene_id"] as? String == sceneID &&
            basis["scene_version"] as? Int == version && basis["state_revision"] as? Int == revision
    }
}
