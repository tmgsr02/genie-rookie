import SwiftUI

/// Same material, alignment and expression geometry as the animated stage; no substitute mascot.
struct WorkshopPortrait: View {
    let character: DuoCharacter
    var body: some View {
        Canvas { context, size in
            StageRenderer.portrait(character, in: &context, size: size)
        }
        .aspectRatio(1, contentMode: .fit)
        .clipped()
        .accessibilityLabel(character.title)
    }
}
