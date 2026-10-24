import Foundation

/// The genius and the rookie. Raw values are Python's ids; each voice must match Python's `CAST`.
enum DuoCharacter: String, CaseIterable, Identifiable, Sendable {
    case genius
    case rookie

    var id: Self { self }
    var title: String { self == .genius ? "Genius" : "Rookie" }
    var voice: String { self == .genius ? "Angel_F01" : "Devil_01" }
}
