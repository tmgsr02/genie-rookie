import SwiftUI

/// Draws a `StageFrame` into a Canvas: the recessive half, its face, the dominant region with
/// its rim, the contact shadow and the dominant face. Paths are built in face units and mapped
/// through each head transform; ink keeps an even weight under squash. Pure: the same frame,
/// metrics and palette always draw the same picture.
enum StageRenderer {
    static func draw(_ frame: StageFrame, metrics: StageMetrics, palette: StagePalette, glow: StageGlow?,
                     in context: inout GraphicsContext, size: CGSize) {
        if let fade = frame.crossFade {
            drawPicture(fade.from, metrics: metrics, palette: palette, glow: glow, in: &context, size: size)
            context.drawLayer { layer in
                layer.opacity = fade.progress
                drawPicture(frame.picture, metrics: metrics, palette: palette, glow: glow, in: &layer, size: size)
            }
        } else {
            drawPicture(frame.picture, metrics: metrics, palette: palette, glow: glow, in: &context, size: size)
        }
    }

    // MARK: Halves

    static func drawPicture(_ picture: StagePicture, metrics m: StageMetrics, palette: StagePalette, glow: StageGlow?,
                            in context: inout GraphicsContext, size: CGSize) {
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.969, green: 0.949, blue: 0.910)))
        for c in DuoCharacter.allCases {
            var pose = picture.faces[c]
            // Reserve a full two-line caption below the artwork, including during speech.
            let base = min(size.width * 0.57 / 512, max(1, size.height - 56) / 480)
            let characterScale = c == .genius ? 1.0 : 0.86
            pose.anchor = Vec2(size.width * (c == .genius ? 0.26 : 0.74),
                               size.height - 56 - 280 * base * characterScale)
            pose.pivot = .zero
            pose.scale = base * characterScale
            // Keep the inherited springs, but suit their travel to two standing characters.
            pose.sy = 1 + (pose.sy - 1) * 0.16
            pose.sx = 1 + (pose.sx - 1) * 0.16
            pose.tilt *= 0.45
            pose.pin = nil
            pose.squeeze *= 0.15
            drawFace(pose, palette: palette, glow: glow, in: &context, size: size)
        }
    }

    /// A portrait uses the exact same textured body and aligned facial renderer as the stage.
    static func portrait(_ character: DuoCharacter, in context: inout GraphicsContext, size: CGSize) {
        let scale = min(size.width, size.height) / 350
        var pose = FacePose(anchor: Vec2(size.width / 2, size.height * 0.42), pivot: .zero,
                            scale: scale, sx: 1, sy: 1, tilt: 0, pin: nil, blink: 0, peek: 0, talkOpen: 0)
        pose.character = character
        pose.features = ExpressionLibrary.targets(.happy, for: character)
        drawFace(pose, palette: StagePalette(contrast: .standard, reduceTransparency: false), glow: nil,
                 in: &context, size: size)
    }

    /// The dominant rim's stroke widths (fu).
    private static let rimWidths = (genius: [24.0, 12], rookie: [20.0])
    /// The soft edge's stroke widths (fu): each reaches half its width into its half, so the
    /// glow and the shade feather out over 24 fu.
    static let seamGlowWidths = [48.0, 40, 32, 24, 16, 8]

    /// `c`'s side of the seam's soft edge, clipped to its half and faded by the picture's rest
    /// edge, drawn under any face so it never tints one.
    private static func restEdge(_ c: DuoCharacter, _ seam: Path, region: Path, picture: StagePicture,
                                 metrics m: StageMetrics, palette: StagePalette, in context: inout GraphicsContext) {
        let strength = picture.restEdge
        guard strength > 0.001 else { return }
        var layer = context
        layer.clip(to: region)
        for (stroke, width) in zip(palette.colors.seamGlow[c], seamGlowWidths) {
            layer.stroke(seam, with: .color(palette.color(stroke.alpha(stroke.a * strength))), lineWidth: width * m.scale)
        }
    }
    /// The contact shadow's strokes: a soft falloff about 40 fu deep, faint at the seam itself.
    private static let shadowStrokes = (widths: [10.0, 20, 32, 46, 62, 80],
                                        alphas: [0.045, 0.04, 0.035, 0.028, 0.02, 0.012])

    /// The seam through its samples, from 20 pt beyond the left edge to 20 pt beyond the right
    /// (`StageFrame.forEachSeamSegment`).
    static func seamCurve(_ samples: [Double], metrics m: StageMetrics, size: CGSize) -> Path {
        var path = Path()
        StageFrame.forEachSeamSegment(of: samples, metrics: m, width: size.width) { start, c1, c2, end in
            if path.isEmpty { path.move(to: cg(start)) }
            path.addCurve(to: cg(end), control1: cg(c1), control2: cg(c2))
        }
        return path
    }

    /// The seam closed off along the top (`edgeY` < 0) or the bottom.
    private static func region(_ seam: Path, edgeY: Double, size: CGSize) -> Path {
        var path = seam
        let right = size.width + 20
        path.addLine(to: CGPoint(x: right, y: edgeY))
        path.addLine(to: CGPoint(x: -20, y: edgeY))
        path.closeSubpath()
        return path
    }

    /// A half's shading: an elliptical radial about its face, sized by the stage's width (see
    /// `StageColors.geniusHalf` and `rookieHalf`).
    private static func fillHalf(_ c: DuoCharacter, _ path: Path, picture: StagePicture, metrics m: StageMetrics,
                                 size: CGSize, palette: StagePalette, in context: inout GraphicsContext) {
        let width = max(m.width, size.width)
        let centre = picture.faces[c].point(Vec2(0, c == .genius ? -120 : -50))
        let radii = c == .genius ? (x: 1.0 * width, y: 1.05 * width) : (x: 1.04 * width, y: 0.85 * width)
        // Drawn as a circle in a space squashed to the ellipse's proportions.
        let squash = CGAffineTransform(translationX: -centre.x, y: -centre.y)
            .concatenating(CGAffineTransform(scaleX: 1, y: radii.x / radii.y))
        var layer = context
        layer.translateBy(x: centre.x, y: centre.y)
        layer.scaleBy(x: 1, y: radii.y / radii.x)
        let stops = c == .genius ? palette.colors.geniusHalf : palette.colors.rookieHalf
        layer.fill(path.applying(squash), with: .radialGradient(palette.gradient(stops), center: .zero, startRadius: 0,
                                                                  endRadius: radii.x))
    }

    // MARK: Faces

    static func drawFace(_ rig: FacePose, palette: StagePalette, glow: StageGlow?, in context: inout GraphicsContext,
                         size: CGSize) {
        let pose = rig.drawn
        // Not yet popped in at the launch intro.
        guard pose.scale > 0 else { return }
        var layer = context
        if case .floor(let y) = pose.pin {
            layer.clip(to: Path(CGRect(x: -100, y: -1000, width: size.width + 200, height: y + 1000)))
        }
        let face = FaceDrawing(pose: pose, palette: palette)
        face.workshopBody(in: &layer)
        face.eyes(in: &layer)
        face.workshopAccessories(in: &layer)
        face.brows(in: &layer)
        face.mouth(in: &layer)
    }

    static func cg(_ v: Vec2) -> CGPoint { CGPoint(x: v.x, y: v.y) }

    /// A face-unit path in stage points through `transform`.
    static func path(_ curve: CurvePath, _ transform: CGAffineTransform) -> Path {
        var path = Path()
        for element in curve.elements {
            switch element {
            case .move(let p): path.move(to: cg(p).applying(transform))
            case .line(let p): path.addLine(to: cg(p).applying(transform))
            case .quad(let c, let p): path.addQuadCurve(to: cg(p).applying(transform), control: cg(c).applying(transform))
            case .cubic(let a, let b, let p):
                path.addCurve(to: cg(p).applying(transform), control1: cg(a).applying(transform),
                              control2: cg(b).applying(transform))
            case .close: path.closeSubpath()
            }
        }
        return path
    }

    /// The genius's wing outline (screen left) in face units.
    static let wingOutline = path(WingShape.outline(), .identity)

    static let hornOutline = path(HornShape.outline(), .identity)
    /// The horn's shine as nested bands (`HornShape.shine`), each filled at `hornShineAlpha`: the
    /// brightest part builds to about 0.78 of the shine colour.
    static let hornShine = HornShape.shine(layers: 16).map { path($0, .identity) }
    static let hornShineAlpha = 0.09

    /// A character's mouth (`GeniusMouthShape`, `RookieMouthShape`) through `transform`: the ink
    /// shape, the tongue clipped inside it, an ink edge that rounds the corners and rims the
    /// tongue, then the rookie's fang, white inside a bold ink outline that joins the mouth's ink.
    /// `ink` is points per fu for strokes.
    static func drawMouth(_ m: MouthParams, character c: DuoCharacter, transform: CGAffineTransform, ink: Double,
                          palette: StagePalette, in context: inout GraphicsContext) {
        let genius = c == .genius
        let inkColor = palette.ink(for: c)
        let shape = path(genius ? GeniusMouthShape.outline(m) : RookieMouthShape.outline(m), transform)
        context.fill(shape, with: .color(inkColor))
        if let tongue = genius ? GeniusMouthShape.tongue(m) : RookieMouthShape.tongue(m) {
            var inside = context
            inside.clip(to: shape)
            inside.fill(path(tongue, transform), with: .color(palette.color(palette.colors.tongue[c])))
        }
        context.stroke(shape, with: .color(inkColor),
                       style: StrokeStyle(lineWidth: (genius ? GeniusGeometry.mouthEdge : RookieGeometry.mouthEdge) * ink,
                                          lineJoin: .round))

    }
}

/// One face's drawing: the head transform and helpers for each part.
private struct FaceDrawing {
    let pose: FacePose
    let palette: StagePalette
    let c: DuoCharacter
    let f: FaceTargets
    let head: CGAffineTransform
    /// Points per fu for ink: s·√(sx·sy).
    let ink: Double
    let q: Double

    init(pose: FacePose, palette: StagePalette) {
        self.pose = pose
        self.palette = palette
        c = pose.character
        var features = pose.features
        for sigma in [-1.0, 1.0] {
            features.eyes[sigma].sclera = 1
            features.eyes[sigma].iris = 0.56
            features.eyes[sigma].size *= c == .genius ? 1.12 : 1.40
            features.eyes[sigma].inward = 0
            features.eyes[sigma].lidAngle *= 0.25
            features.eyes[sigma].lidTop *= 0.35
            features.eyes[sigma].lidInk = 0
            features.eyes[sigma].sparkle = 0
            features.eyes[sigma].highlight2 = 0
            features.eyes[sigma].highlight *= 0.7
        }
        f = features
        head = CGAffineTransform(translationX: pose.anchor.x, y: pose.anchor.y).rotated(by: pose.tilt)
            .scaledBy(x: pose.scale * pose.sx, y: pose.scale * pose.sy)
            .translatedBy(x: -pose.pivot.x, y: -pose.pivot.y)
        ink = pose.scale * (pose.sx * pose.sy).squareRoot() * palette.colors.inkStrokeScale
        q = pose.squeeze
    }

    private var colors: StageColors { palette.colors }
    private var inkColor: Color { palette.ink(for: c) }

    /// The head transform with a part's counter-scale about `center` (fu).
    private func part(_ kind: FacePart, about center: Vec2) -> CGAffineTransform {
        let factor = pow(pose.sy, -kind.counterScale(c))
        let local = CGAffineTransform(translationX: center.x, y: center.y).scaledBy(x: 1, y: factor)
            .translatedBy(x: -center.x, y: -center.y)
        return local.concatenating(head)
    }

    private func stage(_ p: Vec2) -> Vec2 {
        let point = StageRenderer.cg(p).applying(head)
        return Vec2(point.x, point.y)
    }

    private func path(_ curve: CurvePath, _ transform: CGAffineTransform) -> Path { StageRenderer.path(curve, transform) }

    // Generated body plates contain no eyes, brows or mouth. All expressive features remain native.
    func workshopBody(in context: inout GraphicsContext) {
        var layer = context
        layer.concatenate(head)
        let asset = c == .genius ? "GeniusBody" : "RookieBody"
        layer.draw(Image(asset), in: CGRect(x: -256, y: -223, width: 512, height: 512))
    }

    func workshopAccessories(in context: inout GraphicsContext) {
        guard c == .genius else { return }
        let color = Color(red: 0.16, green: 0.18, blue: 0.25)
        for sigma in Self.sides {
            let x = 65 * sigma + 6 * pose.turn.x
            let lens = Path(ellipseIn: CGRect(x: x - 39, y: -41 + 4 * pose.turn.y, width: 78, height: 82)).applying(head)
            context.stroke(lens, with: .color(color), lineWidth: 3.2 * ink)
            var arm = Path()
            arm.move(to: CGPoint(x: x + sigma * 39, y: -5))
            arm.addLine(to: CGPoint(x: sigma * 118, y: -13))
            context.stroke(arm.applying(head), with: .color(color), style: StrokeStyle(lineWidth: 3 * ink, lineCap: .round))
        }
        var bridge = Path()
        bridge.move(to: CGPoint(x: -26 + 6 * pose.turn.x, y: -3))
        bridge.addQuadCurve(to: CGPoint(x: 26 + 6 * pose.turn.x, y: -3), control: CGPoint(x: 6 * pose.turn.x, y: -16))
        context.stroke(bridge.applying(head), with: .color(color), lineWidth: 3 * ink)
    }

    // MARK: Eyes

    /// Screen left (σ −1) and screen right (σ +1).
    static let sides = [-1.0, 1]
    static let geniusDashes = [GeniusGeometry.upperDash, GeniusGeometry.lowerDash]

    func eyes(in context: inout GraphicsContext) {
        for sigma in Self.sides { eye(sigma, in: &context) }
    }

    private func eye(_ sigma: Double, in context: inout GraphicsContext) {
        let p = f.eyes[sigma]
        let base = EyeShape.radii(c) * p.size
        let gaze = Vec2(RigMath.clamp(f.gaze.x, -1, 1), RigMath.clamp(f.gaze.y, -1, 1))
        var e = p.open * (1 - max(pose.blink, p.closed)) * pose.reopen
        if sigma > 0, pose.peek > 0 { e = max(e, pose.peek) }
        let openAlpha = RigMath.smoothstep(0.10, 0.22, e)
        let sclera = RigMath.clamp(p.sclera, 0, 1)
        // How far the eye white has come in: the highlights cross-fade with it. The white and the
        // ink outline are opaque, and the outline reaches its full width first, so a bead turning
        // into an eye white (or back) grows an outline, then a white ring widening out from under
        // it, never a translucent ring around the bead.
        let scleraAlpha = RigMath.smoothstep(0.0, 0.3, sclera)
        let outlineWidth = RigMath.smoothstep(0.0, 0.15, sclera)
        // Only the last hairline of white, as the ring closes up, fades.
        let whiteAlpha = RigMath.smoothstep(0.0, 0.04, sclera)
        let center = (c == .genius ? GeniusGeometry.eyeCenter : RookieGeometry.eyeCenter).sided(sigma)
            + Vec2(6 * pose.turn.x, 4 * pose.turn.y)
        let transform = part(.eyes, about: center)
        let lowerLid = p.lowerLid + (c == .rookie ? 0.06 * q * pose.press : 0)

        if openAlpha > 0.001 {
            // The open eye: a bead (sclera 0) or a sclera with an ink iris.
            let beadShift = Vec2(gaze.x * 5, gaze.y * 4) * (1 - sclera)
            let o = center + beadShift
            let rx = base.x * (1 - 0.08 * abs(gaze.x) * (1 - sclera))
            let ry = max(base.y * e, 0.01)
            let outline = path(.ellipse(center: o, rx: rx, ry: ry), transform)
            let lidY = -ry + 2 * ry * RigMath.clamp(p.lidTop, 0, 0.95)
            let lidRotation = -sigma * p.lidAngle * Double.pi / 180
            let ri = p.iris * base.x
            let irisRadii = Vec2(RigMath.mix(rx, ri, sclera), RigMath.mix(ry, 1.1 * ri, sclera))
            var irisOffset = Vec2(gaze.x * (base.x - ri), gaze.y * (base.y - ri)) * (0.85 * sclera)
            if c == .rookie { irisOffset.y += 0.12 * ri * sclera }
            if p.inward > 0 {
                // The pupil leans toward the nose and up, giving way as the gaze turns sideways.
                let lean = p.inward * (1 - 0.8 * abs(gaze.x)) * sclera
                irisOffset = irisOffset + Vec2(-sigma * RookieGeometry.pupilInward.x * (base.x - ri),
                                               -RookieGeometry.pupilInward.y * (base.y - ri)) * lean
            }
            let irisCenter = o + irisOffset
            let lowerLidY = ry - 2 * ry * RigMath.clamp(lowerLid, 0, 0.9)
            // The lids clip the open eye; a clipped copy of the context needs no offscreen layer.
            // Only a partly open eye (a blink's in-between frames) is drawn as a faded layer.
            func drawOpen(_ layer: inout GraphicsContext) {
                if p.lidTop > 0.001 {
                    var lid = CurvePath()
                    lid.move(to: o + Vec2(-3 * rx, lidY).rotated(by: lidRotation))
                    lid.line(to: o + Vec2(3 * rx, lidY).rotated(by: lidRotation))
                    lid.line(to: o + Vec2(3 * rx, lidY + 8 * ry).rotated(by: lidRotation))
                    lid.line(to: o + Vec2(-3 * rx, lidY + 8 * ry).rotated(by: lidRotation))
                    lid.close()
                    layer.clip(to: path(lid, transform))
                }
                if lowerLid > 0.001 {
                    layer.clip(to: Path(CGRect(x: o.x - 3 * rx, y: o.y - 8 * ry, width: 6 * rx, height: 8 * ry + lowerLidY))
                        .applying(transform))
                }
                if sclera > 0.001 {
                    layer.fill(outline, with: .color(palette.color(colors.sclera[c]).opacity(whiteAlpha)))
                    if c == .rookie {
                        // The lid's soft shade over the top of his eye white, fading out by
                        // halfway down what shows of it.
                        let down = Vec2(0, 1).rotated(by: lidRotation)
                        let top = o + Vec2(0, lidY).rotated(by: lidRotation)
                        let shade = colors.rookieScleraShade
                        let fade = Gradient(stops: [
                            .init(color: palette.color(shade.alpha(shade.a * scleraAlpha)), location: 0),
                            .init(color: palette.color(shade.alpha(shade.a * scleraAlpha * 0.45)), location: 0.4),
                            .init(color: palette.color(shade.alpha(0)), location: 1),
                        ])
                        layer.fill(outline, with: .linearGradient(fade, startPoint: StageRenderer.cg(top).applying(transform),
                                                                  endPoint: StageRenderer.cg(top + down * (0.5 * (ry - lidY)))
                                                                      .applying(transform)))
                    }
                }
                // The iris: the whole bead at sclera 0, shrinking to iris·rx with sclera.
                var iris = layer
                if sclera > 0.001 { iris.clip(to: outline) }
                iris.fill(path(.ellipse(center: irisCenter, rx: irisRadii.x, ry: irisRadii.y), transform),
                          with: .color(inkColor))
                highlights(sigma, p: p, eyeCenter: o, rx: rx, ry: ry, e: e, irisCenter: irisCenter, ri: ri,
                           irisRadius: irisRadii.x, sclera: sclera, scleraAlpha: scleraAlpha, gaze: gaze,
                           transform: transform, in: &iris)
                if sclera > 0.001 {
                    layer.stroke(outline, with: .color(inkColor), lineWidth: 1.5 * ink * outlineWidth)
                }
            }
            if openAlpha >= 0.999 {
                var layer = context
                drawOpen(&layer)
            } else {
                context.drawLayer { layer in
                    layer.opacity = openAlpha
                    drawOpen(&layer)
                }
            }
            // The lower lid's cheek line closes the flat bottom; drawn outside the clip, so the
            // whole stroke shows.
            if lowerLid > 0.001 {
                let half = rx * max(0, 1 - pow(lowerLidY / ry, 2)).squareRoot()
                var cheek = CurvePath()
                cheek.move(to: o + Vec2(-half - 2, lowerLidY))
                cheek.quad(to: o + Vec2(half + 2, lowerLidY), control: o + Vec2(0, lowerLidY + 2))
                context.stroke(path(cheek, transform), with: .color(inkColor.opacity(openAlpha)),
                               style: StrokeStyle(lineWidth: 3 * ink, lineCap: .round))
            }
            if c == .rookie, sclera > 0.001 {
                // The heavy upper-lid line (`EyeShape.upperLid`); `lidInk` thickens it from the
                // outline's weight.
                let weight = RigMath.mix(RookieGeometry.scleraOutline, RookieGeometry.lidLine, RigMath.clamp(p.lidInk, 0, 1))
                let lid = EyeShape.upperLid(rx: rx, ry: ry, lidTop: p.lidTop, rotation: lidRotation, weight: weight,
                                            outline: RookieGeometry.scleraOutline)
                context.fill(path(lid.map { o + $0 }, transform), with: .color(inkColor.opacity(scleraAlpha * openAlpha)))
            } else if p.lidInk > 0.001, p.lidTop > 0.001 {
                // The lid's ink line along its chord, overhanging on the outer side.
                let d = Vec2(1, 0).rotated(by: lidRotation)
                let p0 = Vec2(0, lidY).rotated(by: lidRotation)
                let a = (d.x * d.x) / (rx * rx) + (d.y * d.y) / (ry * ry)
                let b = 2 * ((p0.x * d.x) / (rx * rx) + (p0.y * d.y) / (ry * ry))
                let cc = (p0.x * p0.x) / (rx * rx) + (p0.y * p0.y) / (ry * ry) - 1
                let disc = b * b - 4 * a * cc
                if disc > 0 {
                    let s0 = (-b - disc.squareRoot()) / (2 * a), s1 = (-b + disc.squareRoot()) / (2 * a)
                    let overhang = c == .rookie ? 6.0 : 2.0
                    // The outer end (σ side) overhangs.
                    let lo = s0 - (sigma < 0 ? overhang : 0), hi = s1 + (sigma > 0 ? overhang : 0)
                    var line = CurvePath()
                    line.move(to: o + p0 + d * lo)
                    line.line(to: o + p0 + d * hi)
                    context.stroke(path(line, transform),
                                   with: .color(inkColor.opacity(min(1, p.lidInk) * openAlpha)),
                                   style: StrokeStyle(lineWidth: (c == .rookie ? 7 : 4) * ink, lineCap: .round))
                }
            }
        }
        if openAlpha < 0.999 {
            let glyph = EyeShape.glyph(rx: base.x, ry: base.y, sigma: sigma, arcUp: p.arcUp, arcDown: p.arcDown,
                                       chevron: p.chevron)
            let at = CGAffineTransform(translationX: center.x, y: center.y).concatenating(transform)
            context.stroke(path(glyph, at), with: .color(inkColor.opacity(1 - openAlpha)),
                           style: StrokeStyle(lineWidth: EyeShape.glyphStroke(c) * ink, lineCap: .round,
                                              lineJoin: .round))
        }
    }

    /// The eye's highlights, which read as solid white or nothing: the main highlight (a
    /// bead's ellipse or a dot on the iris), the genius's second dot and sparkle, and the starry
    /// eyes' stars. Blends pass through partial alpha only briefly, on the eye springs.
    private func highlights(_ sigma: Double, p: EyeParams, eyeCenter o: Vec2, rx: Double, ry: Double, e: Double,
                            irisCenter: Vec2, ri: Double, irisRadius: Double, sclera: Double, scleraAlpha: Double,
                            gaze: Vec2, transform: CGAffineTransform, in context: inout GraphicsContext) {
        let highlight = palette.color(colors.highlight[c])
        let inner = -sigma
        let squeeze = min(1, max(e, 0.2))
        let counter = gaze * -1.5
        let starry = RigMath.smoothstep(0.35, 0.65, p.starry)
        // Stars show only on a bead; on an eye white the highlight dot stays.
        let star = starry * (1 - scleraAlpha)
        let alpha = RigMath.smoothstep(0.3, 0.7, p.highlight) * (1 - star)
        if alpha > 0.001 {
            let beadSize = c == .genius ? GeniusGeometry.highlightSize : RookieGeometry.highlightSize
            let beadOffset = c == .genius ? Vec2(inner * GeniusGeometry.highlightInnerOffset.x, GeniusGeometry.highlightInnerOffset.y)
                : RookieGeometry.highlightOffset
            // The rookie's dot sits toward the outer corner, where his angled lids are highest.
            let dotOffset = c == .genius ? Vec2(inner * 0.35 * ri, -0.35 * ri) : Vec2(sigma * 0.33 * ri, -0.3 * ri)
            let beadCentre = o + Vec2(beadOffset.x, beadOffset.y * squeeze)
            let centre = Vec2.lerp(beadCentre, irisCenter + dotOffset, sclera) + counter
            let dot = c == .genius ? 0.6 * ri : RookieGeometry.highlightDot * ri
            let size = Vec2.lerp(beadSize, Vec2(dot, dot), sclera)
            context.fill(path(.ellipse(center: centre, rx: size.x / 2, ry: size.y / 2 * squeeze), transform),
                         with: .color(highlight.opacity(alpha)))
        }
        if p.highlight2 > 0.001, c == .genius {
            let off = GeniusGeometry.highlight2OuterOffset
            let centre = o + Vec2(sigma * off.x, off.y * squeeze) + counter
            let r = GeniusGeometry.highlight2Diameter / 2
            context.fill(path(.ellipse(center: centre, rx: r, ry: r * squeeze), transform),
                         with: .color(highlight.opacity(p.highlight2 * (1 - scleraAlpha))))
        }
        if p.highlight2 > 0.001, c == .rookie, sclera > 0.001 {
            // Excited pupils carry a second, smaller dot low on the inner side.
            let r = 0.12 * ri * min(1, p.highlight2)
            let centre = irisCenter + Vec2(sigma * -0.34 * ri, 0.36 * ri) + counter
            context.fill(path(.ellipse(center: centre, rx: r, ry: r * squeeze), transform),
                         with: .color(highlight.opacity(scleraAlpha)))
        }
        let sparkle = RigMath.smoothstep(0.2, 0.5, p.sparkle) * (1 - starry) * (1 - scleraAlpha)
        if sparkle > 0.001, c == .genius {
            let off = GeniusGeometry.sparkleOuterOffset
            let centre = o + Vec2(sigma * off.x, off.y * squeeze) + counter
            context.fill(path(StarShape.star(center: centre, radius: GeniusGeometry.sparkleTipRadius * squeeze,
                                             waist: GeniusGeometry.sparkleWaist), transform),
                         with: .color(highlight.opacity(sparkle)))
        }
        if star > 0.001 {
            let t = pose.clock
            let twinkle = 1 + 0.12 * sin(2 * Double.pi * 1.3 * t)
            let turn = 15 * Double.pi / 180 * t
            let r = 0.55 * irisRadius
            context.fill(path(StarShape.star(center: irisCenter, radius: r * twinkle * squeeze, waist: 0.3, rotation: turn),
                              transform), with: .color(highlight.opacity(star)))
            context.fill(path(StarShape.star(center: irisCenter + Vec2(sigma * 0.45 * irisRadius, 0.45 * ry),
                                             radius: 0.18 * irisRadius * squeeze, waist: 0.3), transform),
                         with: .color(highlight.opacity(star)))
        }
    }

    // MARK: Brows

    func brows(in context: inout GraphicsContext) {
        for sigma in Self.sides {
            let b = f.brows[sigma]
            let center = Vec2(65 * sigma + 5 * pose.turn.x, -57 + b.dy * 0.65)
            let slant = RigMath.clamp(b.angle * 0.24, -8, 8) * sigma
            var brow = Path()
            brow.move(to: CGPoint(x: center.x - 15, y: center.y + slant))
            brow.addQuadCurve(to: CGPoint(x: center.x + 15, y: center.y - slant),
                              control: CGPoint(x: center.x, y: center.y - 12 * max(0.4, b.arch)))
            context.stroke(brow.applying(head), with: .color(inkColor.opacity(b.alpha)),
                           style: StrokeStyle(lineWidth: 6 * ink, lineCap: .round))
        }
    }

    // MARK: Mouth

    func mouth(in context: inout GraphicsContext) {
        var m = f.mouth
        m.skew *= 0.22
        if c == .rookie { m.width *= 0.88 }
        if q > 0 {
            m.width *= 1 + 0.2 * q
            m.corner -= 6 * q
        }
        let anchor = (c == .genius ? GeniusGeometry.mouthAnchor : RookieGeometry.mouthAnchor)
            + Vec2(4 * pose.turn.x, 22 + 3 * pose.turn.y + 6 * q)
        let transform = CGAffineTransform(translationX: anchor.x, y: anchor.y).concatenating(part(.mouth, about: anchor))
        StageRenderer.drawMouth(m, character: c, transform: transform, ink: ink, palette: palette, in: &context)
    }

    // MARK: Accessories

    /// The rookie's blush profile from its centre out (location, alpha): an even oval whose edge
    /// fades out over its outer third, so it melts into his skin.
    private static let rookieBlushProfile: [(Double, Double)] = [(0, 1), (0.45, 0.97), (0.62, 0.86), (0.74, 0.62),
                                                                  (0.84, 0.33), (0.92, 0.12), (1, 0)]

    func blush(in context: inout GraphicsContext) {
        let amount = BlushShape.strength(pose)
        guard amount > 0.01 else { return }
        let color = colors.blush[c]
        let radii = BlushShape.radii(pose)
        let stops: [Gradient.Stop]
        let reach: Double
        if c == .genius {
            // A soft glow.
            stops = [.init(color: palette.color(color.alpha(color.a * amount)), location: 0),
                     .init(color: palette.color(color.alpha(color.a * amount * 0.9)), location: 0.55),
                     .init(color: palette.color(color.alpha(0)), location: 1)]
            reach = 1.15
        } else {
            stops = Self.rookieBlushProfile.map { location, alpha in
                .init(color: palette.color(color.alpha(color.a * amount * alpha)), location: location)
            }
            reach = 1.2
        }
        let gradient = Gradient(stops: stops)
        let rx = radii.x * pose.scale * pose.sx, ry = radii.y * pose.scale * pose.sy
        let r = rx * reach
        let disc = Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
        for sigma in Self.sides {
            let centre = stage(BlushShape.center(pose, sigma: sigma))
            var layer = context
            layer.translateBy(x: centre.x, y: centre.y)
            layer.rotate(by: .radians(pose.tilt))
            layer.scaleBy(x: 1, y: ry / max(rx, 1e-6))
            layer.fill(disc, with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: r))
        }
    }

    func marks(in context: inout GraphicsContext) {
        let a = f.accessories
        let pulse = 1 + pose.markPulse
        if c == .genius {
            if a.dashes > 0.01 {
                capsules(Self.geniusDashes, amount: a.dashes * pulse,
                         color: colors.geniusDashes, in: &context)
            }
            if a.sparkles > 0.01 {
                for sigma in Self.sides {
                    for mark in GeniusGeometry.sparkleMarks {
                        let r = mark.radius * min(1.4, a.sparkles * pulse)
                        context.fill(path(StarShape.star(center: mark.center.sided(sigma), radius: r, waist: 0.3), head),
                                     with: .color(palette.color(colors.geniusDashes).opacity(min(1, a.sparkles))))
                    }
                }
            }
            if a.puffs > 0.01 {
                for sigma in Self.sides {
                    for dash in Self.geniusDashes {
                        let centre = dash.center.sided(sigma)
                        let k = min(1.4, a.puffs * pulse)
                        var cloud = CurvePath.ellipse(center: centre + Vec2(-sigma * 3 * k, 1 * k), rx: 5 * k, ry: 4 * k)
                        cloud.append(.ellipse(center: centre + Vec2(sigma * 3 * k, -1 * k), rx: 6 * k, ry: 4.5 * k))
                        context.fill(path(cloud, head), with: .color(palette.color(colors.geniusDashes).opacity(min(1, a.puffs) * 0.85)))
                    }
                }
            }
        } else {
            if a.motion > 0.01 {
                capsules(RookieGeometry.motionMarks, amount: a.motion * pulse, color: colors.rookieMotionMarks, in: &context)
            }
            if a.annoyed > 0.01 { angerVein(amount: a.annoyed * pulse, in: &context) }
        }
    }

    /// The anger vein (💢): four thick bent strokes, each corner turned toward its centre,
    /// popping in with `amount` and throbbing slowly. Only its centre follows the head, so it
    /// keeps its proportions however the face squashes.
    private func angerVein(amount: Double, in context: inout GraphicsContext) {
        let vein = RookieGeometry.angerVein
        let k = min(1.4, amount) * (1 + 0.14 * pose.veinThrob)
        let centre = pose.point(vein.center)
        let unit = CGAffineTransform(translationX: centre.x, y: centre.y).rotated(by: pose.tilt)
            .scaledBy(x: pose.scale, y: pose.scale)
        let r = vein.radius * k
        var strokes = CurvePath()
        for (sx, sy) in [(1.0, -1.0), (1, 1), (-1, 1), (-1, -1)] {
            strokes.move(to: Vec2(sx * 0.3 * r, sy * r))
            strokes.cubic(to: Vec2(sx * r, sy * 0.3 * r), Vec2(sx * 0.3 * r, sy * 0.45 * r), Vec2(sx * 0.45 * r, sy * 0.3 * r))
        }
        context.stroke(path(strokes, unit), with: .color(palette.color(colors.rookieAngerVein)),
                       style: StrokeStyle(lineWidth: RookieGeometry.angerVeinStroke * k * pose.scale, lineCap: .round,
                                          lineJoin: .round))
    }

    private func capsules(_ marks: [FaceCapsule], amount: Double, color: RGBA, in context: inout GraphicsContext) {
        let k = min(1.45, amount)
        for sigma in Self.sides {
            for mark in marks {
                let centre = mark.center.sided(sigma)
                let angle = mark.angle * Double.pi / 180
                let direction = Vec2(-sigma * cos(angle), sin(angle))
                let half = (mark.length - mark.thickness) / 2 * k
                var line = CurvePath()
                line.move(to: centre - direction * half)
                line.line(to: centre + direction * half)
                context.stroke(path(line, head), with: .color(palette.color(color).opacity(min(1, amount))),
                               style: StrokeStyle(lineWidth: mark.thickness * k * pose.scale, lineCap: .round))
            }
        }
    }

    func halo(glow: StageGlow?, in context: inout GraphicsContext) {
        let h = pose.halo
        let s = pose.scale
        do {
            var layer = context
            layer.translateBy(x: h.center.x, y: h.center.y)
            layer.rotate(by: .radians(h.rotation))
            layer.scaleBy(x: s, y: s * h.squash)
            if let glow, h.glow > 0.01 {
                let extent = glow.extent
                var sprite = layer
                sprite.opacity = min(1, h.glow)
                sprite.draw(glow.image, in: CGRect(x: -extent.x / 2, y: -extent.y / 2, width: extent.x, height: extent.y))
            }
            // Just the rim: the glow shows through the ring's middle.
            let (outer, hole) = GeniusGeometry.haloRing()
            var ringPath = Path(ellipseIn: CGRect(x: -outer.x / 2, y: -outer.y / 2, width: outer.x, height: outer.y))
            ringPath.addEllipse(in: CGRect(x: -hole.x / 2, y: -hole.y / 2, width: hole.x, height: hole.y))
            if let outline = colors.haloOutline {
                layer.stroke(ringPath, with: .color(palette.color(outline)), lineWidth: 3)
            }
            layer.fill(ringPath, with: .color(palette.color(colors.haloRing)), style: FillStyle(eoFill: true))
        }
    }

    func wings(in context: inout GraphicsContext) {
        let hingeFu = GeniusGeometry.wingHinge
        let k = 1 - 0.15 * q, net = 1 - FacePart.wings.counterScale(c)
        let wsx = pow(pose.sx, net) * k, wsy = pow(pose.sy, net) * k
        for sigma in Self.sides {
            let hinge = stage(Vec2(-sigma * hingeFu.x, hingeFu.y))
            let angle = pose.tilt + sigma * pose.wings[sigma]
            let transform = CGAffineTransform(translationX: hinge.x, y: hinge.y).rotated(by: angle)
                .scaledBy(x: -sigma * pose.scale * wsx, y: pose.scale * wsy)
                .translatedBy(x: -hingeFu.x, y: -hingeFu.y)
            let outline = StageRenderer.wingOutline.applying(transform)
            let start = StageRenderer.cg(hingeFu).applying(transform)
            let end = CGPoint(x: -170, y: -12).applying(transform)
            context.fill(outline, with: .linearGradient(palette.gradient(colors.wingFill), startPoint: start, endPoint: end))
        }
    }

    func horns(in context: inout GraphicsContext) {
        let hingeFu = RookieGeometry.hornHinge
        let net = 1 - FacePart.horns.counterScale(c)
        let hsx = pow(pose.sx, net), hsy = pow(pose.sy, net)
        // Squished under the blob, the horns are pressed down beside the head, so they poke out
        // beside the blob instead of hiding under it; they rise as he is freed.
        let pressed = RookieGeometry.hornPress * q * pose.press
        for sigma in Self.sides {
            let hinge = stage(Vec2(-sigma * hingeFu.x, hingeFu.y + pressed))
            let angle = pose.tilt + sigma * pose.horns[sigma]
            let transform = CGAffineTransform(translationX: hinge.x, y: hinge.y).rotated(by: angle)
                .scaledBy(x: -sigma * pose.scale * hsx, y: pose.scale * hsy * (1 + pose.hornStretch))
                .translatedBy(x: -hingeFu.x, y: -hingeFu.y)
            // Drawn in face units through the horn's transform, so the shading bends, turns and
            // stretches with it.
            var horn = context
            horn.concatenate(transform)
            let outline = StageRenderer.hornOutline
            horn.fill(outline, with: .radialGradient(palette.gradient(colors.horn),
                                                     center: StageRenderer.cg(HornShape.shadeCenter),
                                                     startRadius: 0, endRadius: HornShape.shadeRadius))
            horn.clip(to: outline)
            let shine = palette.color(colors.hornShine).opacity(StageRenderer.hornShineAlpha)
            for band in StageRenderer.hornShine { horn.fill(band, with: .color(shine)) }
        }
    }
}
