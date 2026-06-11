import SwiftUI

/// Type scale for the OpenAgents Swift apps. Mirrors the Caregiver pattern
/// of inline `.font(.system(size:, weight:, design:))` calls but routes them
/// through semantic tokens so a future scale change touches one file.
///
/// Display sizes use **SF Pro Rounded** (`design: .rounded`) for the same
/// friendly-modern feel Caregiver gets in section titles and splash. Body
/// stays on the default SF Pro for readability density. Mono is reserved
/// for code blocks and command popups.
enum BrandFonts {

    // MARK: - Display (rounded, used for app-chrome titles and hero callouts)

    static let displayLarge   = Font.system(size: 32, weight: .semibold, design: .rounded)
    static let displayMedium  = Font.system(size: 26, weight: .semibold, design: .rounded)
    static let displaySmall   = Font.system(size: 22, weight: .semibold, design: .rounded)

    // MARK: - Headings (used for inline section/sheet titles)

    static let title          = Font.system(size: 20, weight: .semibold)
    static let headline       = Font.system(size: 17, weight: .semibold)
    static let subheadline    = Font.system(size: 15, weight: .medium)

    // MARK: - Body

    static let body           = Font.system(size: 16, weight: .regular)
    static let bodyMedium     = Font.system(size: 16, weight: .medium)
    static let callout        = Font.system(size: 15, weight: .regular)
    static let footnote       = Font.system(size: 13, weight: .regular)
    static let caption        = Font.system(size: 12, weight: .regular)

    // MARK: - Section header (UPPERCASE, tracked — iOS Settings vibe)

    static let sectionHeader  = Font.system(size: 12, weight: .medium)
    static let sectionEyebrow = Font.system(size: 11, weight: .medium)

    // MARK: - Mono (code, slash-commands, JSON payload previews)

    static let mono           = Font.system(size: 13, weight: .regular, design: .monospaced)
    static let monoSmall      = Font.system(size: 12, weight: .regular, design: .monospaced)
}
