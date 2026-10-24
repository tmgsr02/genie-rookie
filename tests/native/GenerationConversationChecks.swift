import Foundation

private struct CheckFailure: Error { let message: String }
private func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
    if !value() { throw CheckFailure(message: message) }
}

@main
struct GenerationConversationChecks {
    static func main() throws {
        var schedule = GenerationConversationSchedule()
        schedule.start(jobID: "rain", now: 0)
        try check(schedule.next(now: 4, eligible: true) == nil, "Leave room for a user reply")
        let first = schedule.next(now: 5, eligible: true)!
        try check(first.jobID == "rain" && first.phase == "waiting", "Speak about the current job")
        try check(schedule.next(now: 30, eligible: true) == nil, "Only one request at a time")
        schedule.userInteracted(now: 6)
        try check(!schedule.complete(first, now: 7), "User input invalidates an in-flight exchange")
        try check(schedule.next(now: 20, eligible: false) == nil, "Never request while the user or character is speaking")
        try check(schedule.next(now: 24, eligible: true) == nil, "Quiet pause starts after speech")
        let next = schedule.next(now: 25, eligible: true)!
        try check(schedule.complete(next, now: 26), "Current response can play")
        schedule.start(jobID: "clouds", now: 27)
        try check(!schedule.complete(next, now: 28), "A new job invalidates old responses")
        let replaced = schedule.next(now: 32, eligible: true)!
        schedule.stop()
        try check(!schedule.complete(replaced, now: 33), "Ready or cancelled jobs stop banter")
        try check(schedule.next(now: 100, eligible: true) == nil, "No target means no banter")

        schedule.start(jobID: "rain", now: 0)
        for round in 0..<8 {
            let time = Double(round * 20 + 5)
            let ticket = schedule.next(now: time, eligible: true)!
            try check(schedule.complete(ticket, now: time + 1), "Bounded exchange should play")
        }
        try check(schedule.next(now: 1000, eligible: true) == nil, "Bound automatic cost")
        schedule.fail(jobID: "rain", now: 1000)
        let failure = schedule.next(now: 1005, eligible: true)!
        try check(failure.phase == "failed", "Failure recovery still plays after banter cap")
        try check(schedule.complete(failure, now: 1006), "Speak recovery once")
        try check(schedule.next(now: 2000, eligible: true) == nil, "Do not repeat failure")
        schedule.fail(jobID: "other", now: 2000)
        schedule.userInteracted(now: 2001)
        try check(schedule.next(now: 3000, eligible: true) == nil, "User follow-up supersedes automatic recovery")
        print("GENERATION_CONVERSATION_CHECKS_PASSED")
    }
}
