import Foundation

/// Timing and ownership for optional conversation; the visual job runs independently.
struct GenerationConversationSchedule {
    struct Ticket: Equatable {
        let jobID: String
        let phase: String
        fileprivate let epoch: UUID
    }

    private var jobID: String?
    private var phase = "waiting"
    private var epoch = UUID()
    private var inFlight: Ticket?
    private var idleSince: TimeInterval = 0
    private var nextRequest: TimeInterval = 0
    private var rounds = 0
    var hasTarget: Bool { jobID != nil }

    mutating func start(jobID: String, now: TimeInterval) {
        self = Self()
        self.jobID = jobID
        idleSince = now
    }

    mutating func fail(jobID: String, now: TimeInterval) {
        start(jobID: jobID, now: now)
        phase = "failed"
    }

    mutating func stop() { self = Self() }

    mutating func userInteracted(now: TimeInterval) {
        if phase == "failed" { stop(); return }
        epoch = UUID()
        inFlight = nil
        idleSince = now
    }

    mutating func next(now: TimeInterval, eligible: Bool) -> Ticket? {
        guard eligible else { idleSince = now; return nil }
        guard let jobID, inFlight == nil, rounds < 8,
              now - idleSince >= 5, now >= nextRequest else { return nil }
        let ticket = Ticket(jobID: jobID, phase: phase, epoch: epoch)
        inFlight = ticket
        rounds += 1
        nextRequest = now + 12
        return ticket
    }

    mutating func complete(_ ticket: Ticket, now: TimeInterval) -> Bool {
        guard ticket == inFlight, ticket.epoch == epoch, ticket.jobID == jobID else { return false }
        inFlight = nil
        idleSince = now
        if phase == "failed" { stop() }
        return true
    }
}
