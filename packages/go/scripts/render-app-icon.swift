// Generates a coral-themed app icon master PNG (1024×1024) matching the
// `AppIconBadge` design.
//
// Two output variants — iOS and macOS need different PNGs:
//
//   --ios       Full-bleed: gradient fills the entire canvas, no
//               rounded corners. iOS applies its own squircle mask at
//               display time, and the asset MUST be fully opaque (any
//               transparency gets backfilled with black before masking,
//               which is why a floating squircle reads as "black box"
//               on the home screen).
//
//   --macos     Floating: squircle clipped to ~81% of canvas with
//               transparent margin around it. macOS displays the asset
//               as-is (no re-mask), so the float gives the icon
//               breathing room in Finder / Dock — matches the system
//               icon pattern (Finder, Calendar, Reminders, …).
//
// Usage:
//   swift scripts/render-app-icon.swift --ios   /tmp/icon-ios.png
//   swift scripts/render-app-icon.swift --macos /tmp/icon-mac.png
//
// Caller fans out the macOS variant to 10 sizes via `sips`; the iOS
// variant lands directly as `icon_1024.png`.

import AppKit
import SwiftUI

enum IconVariant {
    case ios     // full-bleed, edge-to-edge, opaque, no rounded corners
    case macos   // floating squircle inside transparent canvas
}

@MainActor
struct AppIconView: View {
    let variant: IconVariant

    static let canvas: CGFloat = 1024
    // macOS squircle floats at 81.2% of canvas. iOS uses the full canvas
    // (system applies the mask). The glyph keeps its visual proportion in
    // both — the iOS version just scales everything up to match.
    static let macSquircle: CGFloat = canvas * 0.812

    var squircleSize: CGFloat {
        switch variant {
        case .ios:   return Self.canvas
        case .macos: return Self.macSquircle
        }
    }

    var body: some View {
        ZStack {
            iconBody
                .frame(width: squircleSize, height: squircleSize)
        }
        .frame(width: Self.canvas, height: Self.canvas)
    }

    /// The squircle itself — gradient + gloss + glyph + corner clip. All
    /// inner offsets scale from the squircle dimension so the iOS and
    /// macOS variants stay visually proportional.
    private var iconBody: some View {
        ZStack {
            // Background: coral gradient — lighter at top-leading, deeper
            // at bottom-trailing. Same hues as BrandColors.primaryHi → primary
            // so the icon matches the in-app accent.
            LinearGradient(
                colors: [
                    Color(red: 1.00, green: 0.694, blue: 0.600), // #FFB199 primaryHi
                    Color(red: 1.00, green: 0.420, blue: 0.357), // #FF6B5B primary
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing,
            )

            // Subtle inner gloss — a soft radial light from the top-left
            // that gives the icon depth without going kitsch.
            RadialGradient(
                gradient: Gradient(colors: [
                    Color.white.opacity(0.22),
                    Color.white.opacity(0.0),
                ]),
                center: UnitPoint(x: 0.25, y: 0.20),
                startRadius: 0,
                endRadius: squircleSize * 0.7,
            )

            // Chat-bubble glyph in white. Padding 11.8% of squircle —
            // glyph effective span is 0.764 of squircle on both variants
            // (iOS happens to apply that to a bigger square so the visible
            // glyph after the system mask still reads at the same size as
            // the macOS one).
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white)
                .padding(squircleSize * 0.118)
                .shadow(color: .black.opacity(0.18),
                        radius: squircleSize * 0.018,
                        y: squircleSize * 0.008)
        }
        // macOS pre-bakes the squircle corners (Big Sur+ convention); iOS
        // ships full-bleed (cornerRadius = 0) and lets the system apply
        // its own mask — pre-rounding would leave transparent pixels
        // that iOS fills black before re-masking.
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius,
                                    style: .continuous))
    }

    private var cornerRadius: CGFloat {
        switch variant {
        case .ios:   return 0
        case .macos: return squircleSize * 0.2237  // Apple's 22.37% ratio
        }
    }
}

/// Re-encode `cgImage` into an RGB-only PNG (no alpha channel). Required
/// for the iOS variant: Apple rejects app icons with any alpha channel
/// even if every pixel is α=1, and iOS may silently fall back or render
/// the icon incorrectly (notification banners, Spotlight, Settings) when
/// the PNG carries an alpha byte. SwiftUI's `ImageRenderer.nsImage`
/// always produces an RGBA bitmap, so we redraw into a CGContext with
/// `noneSkipLast` to strip it.
func flattenAlpha(_ cgImage: CGImage) -> Data? {
    let width = cgImage.width
    let height = cgImage.height
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.noneSkipLast.rawValue
    guard let ctx = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: bitmapInfo,
    ) else { return nil }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let opaque = ctx.makeImage() else { return nil }
    return NSBitmapImageRep(cgImage: opaque).representation(using: .png, properties: [:])
}

@MainActor
func render(variant: IconVariant, to outputPath: String) {
    let renderer = ImageRenderer(content: AppIconView(variant: variant))
    renderer.scale = 1.0
    guard let nsImage = renderer.nsImage else {
        FileHandle.standardError.write("failed to render NSImage\n".data(using: .utf8)!)
        exit(1)
    }

    let png: Data?
    switch variant {
    case .ios:
        // iOS MUST be opaque RGB — strip the alpha channel entirely.
        guard let cg = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            FileHandle.standardError.write("failed to get CGImage\n".data(using: .utf8)!)
            exit(1)
        }
        png = flattenAlpha(cg)
    case .macos:
        // macOS keeps the alpha so the floating squircle has transparent
        // margin around it in Finder/Dock.
        png = nsImage.tiffRepresentation
            .flatMap { NSBitmapImageRep(data: $0) }
            .flatMap { $0.representation(using: .png, properties: [:]) }
    }

    guard let pngData = png else {
        FileHandle.standardError.write("failed to encode PNG\n".data(using: .utf8)!)
        exit(1)
    }
    let url = URL(fileURLWithPath: outputPath)
    do {
        try pngData.write(to: url)
        print("wrote \(outputPath) (\(pngData.count) bytes, variant=\(variant))")
    } catch {
        FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: \(args[0]) --ios|--macos <output.png>\n"
                                   .data(using: .utf8)!)
    exit(2)
}

let variant: IconVariant
switch args[1] {
case "--ios":   variant = .ios
case "--macos": variant = .macos
default:
    FileHandle.standardError.write("unknown variant '\(args[1])'; use --ios or --macos\n"
                                   .data(using: .utf8)!)
    exit(2)
}
let outputPath = args[2]

DispatchQueue.main.async {
    render(variant: variant, to: outputPath)
    NSApplication.shared.terminate(nil)
}
NSApplication.shared.run()
