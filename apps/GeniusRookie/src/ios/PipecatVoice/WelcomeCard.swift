import SwiftUI

/// An opaque introduction: the live workshop stays entirely behind this screen.
struct WelcomeCard: View {
    let palette: StagePalette
    let holdsToTalk: Bool
    let dismiss: () -> Void

    private static let key = "welcome-seen"

    static func seen(defaults: UserDefaults = .standard) -> Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--welcome") { return false }
        #endif
        return defaults.bool(forKey: key)
    }

    static func markSeen(defaults: UserDefaults = .standard) { defaults.set(true, forKey: key) }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 8)
                    Image("WorkshopWelcome")
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 540)
                        .accessibilityHidden(true)
                    VStack(spacing: 16) {
                        Text("Genie & Rookie")
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                            .multilineTextAlignment(.center)
                            .accessibilityAddTraits(.isHeader)
                        Text("Ask anything you’re curious about. Explore it together, and help Rookie discover something new.")
                            .font(.body)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(WorkshopStyle.ink.opacity(0.8))
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: 300)
                    }
                    Spacer(minLength: 8)
                    Button(action: dismiss) {
                        HStack(spacing: 10) {
                            Text("Let’s investigate")
                            Image(systemName: "arrow.right")
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(WorkshopPrimaryButtonStyle())
                    .frame(maxWidth: 350)
                    .padding(.bottom, 24)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
                .frame(minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .foregroundStyle(WorkshopStyle.ink)
        .background(WorkshopStyle.paper.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .onAppear { AccessibilityNotification.ScreenChanged(nil).post() }
    }
}

/// Shared colors keep the native chrome and the embedded bench in the same workshop.
enum WorkshopStyle {
    static let paper = Color(red: 247 / 255, green: 242 / 255, blue: 232 / 255)
    static let ink = Color(red: 38 / 255, green: 56 / 255, blue: 73 / 255)
    static let teal = Color(red: 53 / 255, green: 127 / 255, blue: 121 / 255)
    static let blue = Color(red: 97 / 255, green: 124 / 255, blue: 196 / 255)
}

private struct WorkshopPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(WorkshopStyle.teal.opacity(configuration.isPressed ? 0.8 : 1),
                        in: RoundedRectangle(cornerRadius: 18))
    }
}
