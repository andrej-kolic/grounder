import AppKit
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

_ = NSApplication.shared

let outURL = URL(fileURLWithPath: CommandLine.arguments[1])
let width = 1280
let height = 640
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

// Sampled from the original preview: blue-black field, dim teal wash, no hot spot.
let bg = CGColor(red: 0.024, green: 0.027, blue: 0.043, alpha: 1)
ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

let glowCenter = CGPoint(x: Double(width) / 2, y: Double(height) / 2)
// Raster keeps the wide mathematical radius; grain + JPEG hide the outer wash.
let glowRadius: CGFloat = 480
let glowKeys: [(CGFloat, (CGFloat, CGFloat, CGFloat))] = [
    (0, (0.024, 0.148, 0.138)),
    (0.32, (0.022, 0.125, 0.122)),
    (0.62, (0.022, 0.078, 0.090)),
    (1, (0.024, 0.027, 0.043)),
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

func font(named file: String, size: CGFloat, weight: CGFloat = 400) -> NSFont {
    let url = URL(fileURLWithPath: "/tmp/outfit/\(file)")
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

let titleSize = title.size()
let subtitleSize = subtitle.size()
let taglineSize = tagline.size()
let gapTitle: CGFloat = 16
let gapSub: CGFloat = 12
let blockHeight = titleSize.height + gapTitle + subtitleSize.height + gapSub + taglineSize.height
fputs("widths title=\(Int(titleSize.width)) sub=\(Int(subtitleSize.width)) tag=\(Int(taglineSize.width)) blockH=\(Int(blockHeight))\n", stderr)
// CG y-axis is up; start at the top of the centered block and draw downward.
var y = (CGFloat(height) + blockHeight) / 2 - 8

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

var svgY = (CGFloat(height) - blockHeight) / 2 + 8
func lineOrigin(_ s: NSAttributedString, size: NSSize, top: CGFloat) -> CGPoint {
    let f = s.attribute(.font, at: 0, effectiveRange: nil) as! NSFont
    let x = (CGFloat(width) - size.width) / 2
    return CGPoint(x: x, y: top + f.ascender)
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

let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <title>Grounder — Obsidian vault memory for Cursor and Claude Code</title>
  <defs>
    <radialGradient id="glow" cx="640" cy="320" r="480" gradientUnits="userSpaceOnUse" color-interpolation="sRGB">
      <stop offset="0" stop-color="#03322F"/>
      <stop offset="0.08" stop-color="#03302E"/>
      <stop offset="0.16" stop-color="#032E2D"/>
      <stop offset="0.24" stop-color="#022C2B"/>
      <stop offset="0.32" stop-color="#022929"/>
      <stop offset="0.40" stop-color="#032627"/>
      <stop offset="0.50" stop-color="#032023"/>
      <stop offset="0.62" stop-color="#041A1E"/>
      <stop offset="0.75" stop-color="#041318"/>
      <stop offset="0.88" stop-color="#050C11"/>
      <stop offset="1" stop-color="#05060C"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="640" fill="#05060C"/>
  <circle cx="640" cy="320" r="480" fill="url(#glow)"/>
\(pathMarkup)</svg>
"""

let svgURL = outURL.deletingPathExtension().appendingPathExtension("svg")
do {
    try svg.write(to: svgURL, atomically: true, encoding: .utf8)
} catch {
    fputs("failed to write svg: \(error)\n", stderr)
    exit(1)
}

