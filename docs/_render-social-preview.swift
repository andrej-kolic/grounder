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
let glowColors = [
    CGColor(red: 0.024, green: 0.148, blue: 0.138, alpha: 1),
    CGColor(red: 0.022, green: 0.125, blue: 0.122, alpha: 1),
    CGColor(red: 0.022, green: 0.078, blue: 0.090, alpha: 1),
    CGColor(red: 0.024, green: 0.027, blue: 0.043, alpha: 1),
] as CFArray
let locations: [CGFloat] = [0, 0.32, 0.62, 1]
if let gradient = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: locations) {
    ctx.drawRadialGradient(
        gradient,
        startCenter: glowCenter,
        startRadius: 0,
        endCenter: glowCenter,
        endRadius: 480,
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
