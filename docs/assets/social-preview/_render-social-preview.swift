import AppKit
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

_ = NSApplication.shared

let outURL = URL(fileURLWithPath: CommandLine.arguments[1])
let width = 1280
let height = 685
let bytesPerPixel = 4
let bytesPerRow = width * bytesPerPixel

var pixels = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

guard let ctx = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fputs("failed to create CGContext\n", stderr)
    exit(1)
}

// Matches docs/assets/what-dark.svg: steel-blue-teal wash on near-black, not the
// earlier green-teal field.
let bg = CGColor(red: 0.0314, green: 0.0392, blue: 0.0784, alpha: 1)
ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

let glowCenter = CGPoint(x: Double(width) / 2, y: Double(height) / 2)
// Raster keeps the wide mathematical radius; grain + JPEG hide the outer wash.
let glowRadius: CGFloat = 480
let glowKeys: [(CGFloat, (CGFloat, CGFloat, CGFloat))] = [
    (0, (0.0627, 0.1725, 0.2196)), // #102C38
    (0.32, (0.0471, 0.1216, 0.1529)), // #0C1F27
    (0.62, (0.0431, 0.1098, 0.1373)), // #0B1C23
    (1, (0.0314, 0.0392, 0.0784)), // #080A14
]
let glowColors = glowKeys.map { CGColor(red: $0.1.0, green: $0.1.1, blue: $0.1.2, alpha: 1) } as CFArray
let locations = glowKeys.map(\.0)
if let gradient = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: locations) {
    ctx.drawRadialGradient(
        gradient,
        startCenter: glowCenter,
        startRadius: 0,
        endCenter: glowCenter,
        endRadius: glowRadius,
        options: [.drawsAfterEndLocation]
    )
}

var rng = SystemRandomNumberGenerator()
for i in 0 ..< (width * height) {
    let n = Int.random(in: -4 ... 4, using: &rng)
    if n == 0 { continue }
    let o = i * bytesPerPixel
    for c in 0 ..< 3 {
        let v = Int(pixels[o + c]) + n
        pixels[o + c] = UInt8(max(0, min(255, v)))
    }
}

let fontsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("fonts")

func font(named file: String, size: CGFloat, weight: CGFloat = 400) -> NSFont {
    let url = fontsDir.appendingPathComponent(file)
    guard
        let data = try? Data(contentsOf: url) as CFData,
        let provider = CGDataProvider(data: data),
        let cgFont = CGFont(provider)
    else {
        fputs("failed to load font \(file)\n", stderr)
        exit(1)
    }
    CTFontManagerRegisterGraphicsFont(cgFont, nil)
    let base = CTFontCreateWithGraphicsFont(cgFont, size, nil, nil) as NSFont
    let desc = base.fontDescriptor.addingAttributes([
        NSFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [
            NSNumber(value: 0x7767_6874): NSNumber(value: Float(weight)),
        ],
    ])
    return NSFont(descriptor: desc, size: size) ?? base
}

func svgPath(from cgPath: CGPath) -> String {
    var d = ""
    cgPath.applyWithBlock { elem in
        let e = elem.pointee
        let pts = e.points
        switch e.type {
        case .moveToPoint:
            d += String(format: "M%.2f %.2f", pts[0].x, pts[0].y)
        case .addLineToPoint:
            d += String(format: "L%.2f %.2f", pts[0].x, pts[0].y)
        case .addQuadCurveToPoint:
            d += String(format: "Q%.2f %.2f %.2f %.2f", pts[0].x, pts[0].y, pts[1].x, pts[1].y)
        case .addCurveToPoint:
            d += String(format: "C%.2f %.2f %.2f %.2f %.2f %.2f", pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y)
        case .closeSubpath:
            d += "Z"
        @unknown default:
            break
        }
    }
    return d
}

func svgPaths(for attr: NSAttributedString, origin: CGPoint) -> [(d: String, fill: String)] {
    let line = CTLineCreateWithAttributedString(attr)
    let runs = CTLineGetGlyphRuns(line) as! [CTRun]
    var out: [(d: String, fill: String)] = []
    for run in runs {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(), &glyphs)
        CTRunGetPositions(run, CFRange(), &positions)
        let attrs = CTRunGetAttributes(run) as! [NSAttributedString.Key: Any]
        let ctFont = attrs[.font] as! CTFont
        let nsColor = (attrs[.foregroundColor] as? NSColor)?.usingColorSpace(.deviceRGB) ?? .white
        let fill = String(
            format: "#%02X%02X%02X",
            Int(nsColor.redComponent * 255),
            Int(nsColor.greenComponent * 255),
            Int(nsColor.blueComponent * 255)
        )
        var combined = ""
        for i in 0 ..< count {
            guard let glyphPath = CTFontCreatePathForGlyph(ctFont, glyphs[i], nil) else { continue }
            var t = CGAffineTransform(translationX: origin.x + positions[i].x, y: origin.y)
                .scaledBy(x: 1, y: -1)
            if let flipped = glyphPath.copy(using: &t) {
                combined += svgPath(from: flipped)
            }
        }
        if !combined.isEmpty {
            out.append((combined, fill))
        }
    }
    return out
}

func attributed(_ text: String, font: NSFont, color: NSColor, tracking: CGFloat) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    return NSAttributedString(string: text, attributes: [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph,
        .kern: tracking,
    ])
}

let white = NSColor(calibratedWhite: 0.96, alpha: 1)
let muted = NSColor(calibratedWhite: 0.72, alpha: 1)

let title = attributed("Grounder", font: font(named: "Outfit-Bold.ttf", size: 176, weight: 700), color: white, tracking: -3.0)
let subtitle = attributed(
    "Obsidian vault memory for Cursor and Claude Code",
    font: font(named: "Outfit-Bold.ttf", size: 40, weight: 500),
    color: white,
    tracking: 0.1
)
let tagline = attributed(
    "Session handoffs, plans, and notes in files you own",
    font: font(named: "Outfit-Bold.ttf", size: 30, weight: 400),
    color: muted,
    tracking: 0.2
)

// Grounder mark, flat version (docs/assets/grounder-logo.svg), authored in a 600x400,
// y-down local box. Kept here as plain point lists so raster + SVG output share one
// source of truth instead of duplicating hand-picked path data per format.
typealias RGB = (CGFloat, CGFloat, CGFloat)
let logoNavy: RGB = (0.1059, 0.3608, 0.5490) // #1B5C8C
let logoTeal: RGB = (0.2706, 0.7647, 0.8549) // #45C3DA
let logoMid: RGB = (0.1882, 0.5647, 0.7020) // #3090B3

let logoShapes: [(points: [(CGFloat, CGFloat)], color: RGB, hex: String)] = [
    ([(500, 100), (400, 0), (200, 0), (0, 200), (200, 400), (400, 400), (600, 200), (400, 200), (300, 300), (200, 200), (300, 100)], logoNavy, "#1B5C8C"),
    ([(400, 0), (200, 0), (0, 200), (200, 200)], logoTeal, "#45C3DA"),
    ([(600, 200), (400, 200), (300, 300), (400, 400)], logoTeal, "#45C3DA"),
    ([(400, 0), (200, 0), (300, 100)], logoMid, "#3090B3"),
    ([(300, 300), (200, 400), (400, 400)], logoMid, "#3090B3"),
]
let logoLocalHeight: CGFloat = 400
let logoLocalWidth: CGFloat = 600

// ~1.2x the title's cap height (124.3pt at this size): big enough to read as a
// deliberate mark of its own above the wordmark, not just a same-size echo of "G".
let logoHeight: CGFloat = 150
let logoWidth: CGFloat = logoHeight * logoLocalWidth / logoLocalHeight
let logoScale: CGFloat = logoHeight / logoLocalHeight
// Tuned so logo-bottom -> top of title's "u" equals bottom of "u" -> top of
// subtitle's "o": both measured off actual glyph ink (x-height letters, no
// cap-overshoot/descender noise), not the line box or the whole-word bounding box.
let gapLogo: CGFloat = -10.0

let titleSize = title.size()
let subtitleSize = subtitle.size()
let taglineSize = tagline.size()
let gapTitle: CGFloat = 16
let gapSub: CGFloat = 12
let textBlockHeight = titleSize.height + gapTitle + subtitleSize.height + gapSub + taglineSize.height
let blockHeight = logoHeight + gapLogo + textBlockHeight
fputs("widths title=\(Int(titleSize.width)) sub=\(Int(subtitleSize.width)) tag=\(Int(taglineSize.width)) blockH=\(Int(blockHeight))\n", stderr)
// CG y-axis is up; start at the top of the centered block and draw downward.
// -1: measured against rendered ink so top and bottom padding come out equal.
var y = (CGFloat(height) + blockHeight) / 2 - 1

let logoBoxX = (CGFloat(width) - logoWidth) / 2

// Maps a local (x, y-down) point into the CG bitmap's y-up space for a box whose
// top edge sits at `topY`.
func logoPoint(_ p: (CGFloat, CGFloat), boxX: CGFloat, topY: CGFloat, scale: CGFloat) -> CGPoint {
    CGPoint(x: boxX + p.0 * scale, y: topY - p.1 * scale)
}

func fillLogoShape(_ points: [(CGFloat, CGFloat)], color: RGB, boxX: CGFloat, topY: CGFloat, scale: CGFloat, in ctx: CGContext) {
    let path = CGMutablePath()
    let mapped = points.map { logoPoint($0, boxX: boxX, topY: topY, scale: scale) }
    path.addLines(between: mapped)
    path.closeSubpath()
    ctx.setFillColor(CGColor(red: color.0, green: color.1, blue: color.2, alpha: 1))
    ctx.addPath(path)
    ctx.fillPath()
}

let logoTopY = y
y -= logoHeight
for shape in logoShapes {
    fillLogoShape(shape.points, color: shape.color, boxX: logoBoxX, topY: logoTopY, scale: logoScale, in: ctx)
}
y -= gapLogo

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)

func draw(_ s: NSAttributedString, size: NSSize, y: inout CGFloat) {
    y -= size.height
    let x = (CGFloat(width) - size.width) / 2
    s.draw(in: NSRect(x: x, y: y, width: size.width, height: size.height))
}

draw(title, size: titleSize, y: &y)
y -= gapTitle
draw(subtitle, size: subtitleSize, y: &y)
y -= gapSub
draw(tagline, size: taglineSize, y: &y)

NSGraphicsContext.restoreGraphicsState()

guard let image = ctx.makeImage() else {
    fputs("failed to make image\n", stderr)
    exit(1)
}

guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fputs("failed to create image destination\n", stderr)
    exit(1)
}
CGImageDestinationAddImage(dest, image, nil)
if !CGImageDestinationFinalize(dest) {
    fputs("failed to write png\n", stderr)
    exit(1)
}

var svgY = (CGFloat(height) - blockHeight) / 2 + 1
func lineOrigin(_ s: NSAttributedString, size: NSSize, top: CGFloat) -> CGPoint {
    let f = s.attribute(.font, at: 0, effectiveRange: nil) as! NSFont
    let x = (CGFloat(width) - size.width) / 2
    return CGPoint(x: x, y: top + f.ascender)
}

let logoTopSVG = svgY
svgY += logoHeight + gapLogo

func svgLogoPath(_ points: [(CGFloat, CGFloat)], boxX: CGFloat, topY: CGFloat, scale: CGFloat) -> String {
    var d = ""
    for (i, p) in points.enumerated() {
        let x = boxX + p.0 * scale
        let y = topY + p.1 * scale
        d += (i == 0 ? "M" : "L") + String(format: "%.2f %.2f", x, y)
    }
    d += "Z"
    return d
}

var logoMarkup = ""
for shape in logoShapes {
    let d = svgLogoPath(shape.points, boxX: logoBoxX, topY: logoTopSVG, scale: logoScale)
    logoMarkup += "  <path fill=\"\(shape.hex)\" d=\"\(d)\"/>\n"
}

let titleOrigin = lineOrigin(title, size: titleSize, top: svgY)
svgY += titleSize.height + gapTitle
let subtitleOrigin = lineOrigin(subtitle, size: subtitleSize, top: svgY)
svgY += subtitleSize.height + gapSub
let taglineOrigin = lineOrigin(tagline, size: taglineSize, top: svgY)

var pathMarkup = ""
for (d, fill) in svgPaths(for: title, origin: titleOrigin)
    + svgPaths(for: subtitle, origin: subtitleOrigin)
    + svgPaths(for: tagline, origin: taglineOrigin)
{
    pathMarkup += "  <path fill=\"\(fill)\" d=\"\(d)\"/>\n"
}

// Same 4 keys driving the raster radial glow, resampled at finer offsets — vector
// output has no dithering to hide banding, so it needs more stops than the raster.
func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }
func interpolateGlow(at t: CGFloat) -> RGB {
    if t <= glowKeys.first!.0 { return glowKeys.first!.1 }
    if t >= glowKeys.last!.0 { return glowKeys.last!.1 }
    for i in 0 ..< (glowKeys.count - 1) {
        let (o0, c0) = glowKeys[i]
        let (o1, c1) = glowKeys[i + 1]
        if t >= o0 && t <= o1 {
            let f = (t - o0) / (o1 - o0)
            return (lerp(c0.0, c1.0, f), lerp(c0.1, c1.1, f), lerp(c0.2, c1.2, f))
        }
    }
    return glowKeys.last!.1
}
func hex(_ c: RGB) -> String {
    String(format: "#%02X%02X%02X", Int((c.0 * 255).rounded()), Int((c.1 * 255).rounded()), Int((c.2 * 255).rounded()))
}
let svgGlowOffsets: [CGFloat] = [0, 0.08, 0.16, 0.24, 0.32, 0.40, 0.50, 0.62, 0.75, 0.88, 1]
let svgGlowStops = svgGlowOffsets
    .map { "      <stop offset=\"\($0)\" stop-color=\"\(hex(interpolateGlow(at: $0)))\"/>" }
    .joined(separator: "\n")

let svgBg = hex((0.0314, 0.0392, 0.0784))

let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)">
  <title>Grounder — Obsidian vault memory for Cursor and Claude Code</title>
  <defs>
    <radialGradient id="glow" cx="\(Int(glowCenter.x))" cy="\(Int(glowCenter.y))" r="\(Int(glowRadius))" gradientUnits="userSpaceOnUse" color-interpolation="sRGB">
\(svgGlowStops)
    </radialGradient>
  </defs>
  <rect width="\(width)" height="\(height)" fill="\(svgBg)"/>
  <circle cx="\(Int(glowCenter.x))" cy="\(Int(glowCenter.y))" r="\(Int(glowRadius))" fill="url(#glow)"/>
\(logoMarkup)\(pathMarkup)</svg>
"""

let svgURL = outURL.deletingPathExtension().appendingPathExtension("svg")
do {
    try svg.write(to: svgURL, atomically: true, encoding: .utf8)
} catch {
    fputs("failed to write svg: \(error)\n", stderr)
    exit(1)
}
