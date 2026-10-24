#if DEBUG
/// A request the Audience reference runtime rendered, with its ONNX Runtime answer
/// (tests/fixtures/audience/answers.json), for `--verify-audience`.
enum AudienceSample {
    static let cards = ["Genius. role: genius; appearance: white robe, feathered wings and a golden halo", "Rookie. role: rookie; appearance: red skin, little horns and a pointy tail"]
    static let line = "\"What do you think?\" Before: \"Rookie, tempt me.\""
    static let current = 20
    static let people: [[Float]] = [
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0],
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
    ]
    static let features: [Float] = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0]
    static let person = [0.977099962035007, 0.9256241868180822]
    static let unclear = 0.0004936837813012564
    static let group = 0.6611823061825451
}
#endif
