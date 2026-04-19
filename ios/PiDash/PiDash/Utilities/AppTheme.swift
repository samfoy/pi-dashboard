import SwiftUI
import Observation

// MARK: - Color hex initializer

extension Color {
    /// Initialize from a `#RRGGBB` or `#RRGGBBAA` hex string.
    init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h = String(h.dropFirst()) }
        let scanner = Scanner(string: h)
        var value: UInt64 = 0
        scanner.scanHexInt64(&value)
        let r, g, b, a: Double
        switch h.count {
        case 6:
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8)  & 0xFF) / 255
            b = Double( value        & 0xFF) / 255
            a = 1
        case 8:
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8)  & 0xFF) / 255
            a = Double( value        & 0xFF) / 255
        default:
            r = 0; g = 0; b = 0; a = 1
        }
        self.init(red: r, green: g, blue: b, opacity: a)
    }
}

// MARK: - AppTheme

struct AppTheme {
    let name: String

    // Backgrounds
    let pageBg: Color
    let cardBg: Color
    let infoBg: Color

    // Accent
    let accent: Color
    let accentSubtle: Color

    // User message bubble
    let userBubble: Color
    let userBubbleText: Color

    // Assistant message bubble
    let assistantBubble: Color
    let assistantBubbleText: Color

    // Tool call states
    let toolPendingBg: Color
    let toolSuccessBg: Color
    let toolErrorBg: Color

    // Code blocks
    let codeBlockBg: Color
    let codeBlockText: Color

    // Borders
    let border: Color
    let borderAccent: Color

    // Text hierarchy
    let text: Color
    let textSecondary: Color
    let textMuted: Color

    // Semantic
    let success: Color
    let error: Color
    let warning: Color

    // Diffs
    let diffAdded: Color
    let diffRemoved: Color

    // Thinking blocks
    let thinkingBg: Color
    let thinkingText: Color

    // Chrome
    let navBg: Color
    let inputBg: Color
}

// MARK: - Built-in presets

extension AppTheme {
    /// Rosé Pine — default dark
    static let rosePine = AppTheme(
        name: "Rosé Pine",
        pageBg:             Color(hex: "#191724"),
        cardBg:             Color(hex: "#1f1d2e"),
        infoBg:             Color(hex: "#26233a"),
        accent:             Color(hex: "#c4a7e7"),   // iris
        accentSubtle:       Color(hex: "#6e6a86"),   // muted
        userBubble:         Color(hex: "#31748f"),   // pine
        userBubbleText:     Color(hex: "#e0def4"),   // text
        assistantBubble:    Color(hex: "#26233a"),   // overlay
        assistantBubbleText: Color(hex: "#e0def4"),
        toolPendingBg:      Color(hex: "#403d52"),   // hlMed
        toolSuccessBg:      Color(hex: "#1f1d2e").opacity(0.8),
        toolErrorBg:        Color(hex: "#eb6f92").opacity(0.15), // love tint
        codeBlockBg:        Color(hex: "#21202e"),   // hlLow
        codeBlockText:      Color(hex: "#e0def4"),
        border:             Color(hex: "#403d52"),   // hlMed
        borderAccent:       Color(hex: "#c4a7e7"),   // iris
        text:               Color(hex: "#e0def4"),
        textSecondary:      Color(hex: "#908caa"),   // subtle
        textMuted:          Color(hex: "#6e6a86"),   // muted
        success:            Color(hex: "#9ccfd8"),   // foam
        error:              Color(hex: "#eb6f92"),   // love
        warning:            Color(hex: "#f6c177"),   // gold
        diffAdded:          Color(hex: "#9ccfd8").opacity(0.18),
        diffRemoved:        Color(hex: "#eb6f92").opacity(0.18),
        thinkingBg:         Color(hex: "#26233a"),
        thinkingText:       Color(hex: "#908caa"),
        navBg:              Color(hex: "#1f1d2e"),
        inputBg:            Color(hex: "#26233a")
    )

    /// Rosé Pine Moon
    static let rosePineMoon = AppTheme(
        name: "Rosé Pine Moon",
        pageBg:             Color(hex: "#232136"),
        cardBg:             Color(hex: "#2a273f"),
        infoBg:             Color(hex: "#393552"),
        accent:             Color(hex: "#c4a7e7"),   // iris
        accentSubtle:       Color(hex: "#6e6a86"),
        userBubble:         Color(hex: "#3e8fb0"),   // pine
        userBubbleText:     Color(hex: "#e0def4"),
        assistantBubble:    Color(hex: "#393552"),   // overlay
        assistantBubbleText: Color(hex: "#e0def4"),
        toolPendingBg:      Color(hex: "#44415a"),   // hlMed
        toolSuccessBg:      Color(hex: "#2a273f").opacity(0.8),
        toolErrorBg:        Color(hex: "#eb6f92").opacity(0.15),
        codeBlockBg:        Color(hex: "#2a283e"),   // hlLow
        codeBlockText:      Color(hex: "#e0def4"),
        border:             Color(hex: "#44415a"),
        borderAccent:       Color(hex: "#c4a7e7"),
        text:               Color(hex: "#e0def4"),
        textSecondary:      Color(hex: "#908caa"),
        textMuted:          Color(hex: "#6e6a86"),
        success:            Color(hex: "#9ccfd8"),
        error:              Color(hex: "#eb6f92"),
        warning:            Color(hex: "#f6c177"),
        diffAdded:          Color(hex: "#9ccfd8").opacity(0.18),
        diffRemoved:        Color(hex: "#eb6f92").opacity(0.18),
        thinkingBg:         Color(hex: "#393552"),
        thinkingText:       Color(hex: "#908caa"),
        navBg:              Color(hex: "#2a273f"),
        inputBg:            Color(hex: "#393552")
    )

    /// Rosé Pine Dawn — light theme
    static let rosePineDawn = AppTheme(
        name: "Rosé Pine Dawn",
        pageBg:             Color(hex: "#faf4ed"),
        cardBg:             Color(hex: "#fffaf3"),
        infoBg:             Color(hex: "#f2e9e1"),
        accent:             Color(hex: "#907aa9"),   // iris
        accentSubtle:       Color(hex: "#9893a5"),   // muted
        userBubble:         Color(hex: "#286983"),   // pine
        userBubbleText:     Color(hex: "#fffaf3"),
        assistantBubble:    Color(hex: "#f2e9e1"),   // overlay
        assistantBubbleText: Color(hex: "#575279"),
        toolPendingBg:      Color(hex: "#dfdad9"),   // hlMed
        toolSuccessBg:      Color(hex: "#fffaf3"),
        toolErrorBg:        Color(hex: "#b4637a").opacity(0.12),
        codeBlockBg:        Color(hex: "#f4ede8"),   // hlLow
        codeBlockText:      Color(hex: "#575279"),
        border:             Color(hex: "#dfdad9"),
        borderAccent:       Color(hex: "#907aa9"),
        text:               Color(hex: "#575279"),
        textSecondary:      Color(hex: "#797593"),   // subtle
        textMuted:          Color(hex: "#9893a5"),   // muted
        success:            Color(hex: "#56949f"),   // foam
        error:              Color(hex: "#b4637a"),   // love
        warning:            Color(hex: "#ea9d34"),   // gold
        diffAdded:          Color(hex: "#56949f").opacity(0.18),
        diffRemoved:        Color(hex: "#b4637a").opacity(0.18),
        thinkingBg:         Color(hex: "#f2e9e1"),
        thinkingText:       Color(hex: "#797593"),
        navBg:              Color(hex: "#fffaf3"),
        inputBg:            Color(hex: "#f2e9e1")
    )

    /// Default Dark — neutral dark (system-ish)
    static let defaultDark = AppTheme(
        name: "Default Dark",
        pageBg:             Color(hex: "#000000"),
        cardBg:             Color(hex: "#1c1c1e"),
        infoBg:             Color(hex: "#2c2c2e"),
        accent:             Color(hex: "#0a84ff"),
        accentSubtle:       Color(hex: "#3a3a3c"),
        userBubble:         Color(hex: "#0a84ff"),
        userBubbleText:     Color(hex: "#ffffff"),
        assistantBubble:    Color(hex: "#2c2c2e"),
        assistantBubbleText: Color(hex: "#ffffff"),
        toolPendingBg:      Color(hex: "#3a3a3c"),
        toolSuccessBg:      Color(hex: "#1c2e1c"),
        toolErrorBg:        Color(hex: "#2e1c1c"),
        codeBlockBg:        Color(hex: "#1c1c1e"),
        codeBlockText:      Color(hex: "#e5e5e5"),
        border:             Color(hex: "#3a3a3c"),
        borderAccent:       Color(hex: "#0a84ff"),
        text:               Color(hex: "#ffffff"),
        textSecondary:      Color(hex: "#ebebf599"),
        textMuted:          Color(hex: "#ebebf54c"),
        success:            Color(hex: "#30d158"),
        error:              Color(hex: "#ff453a"),
        warning:            Color(hex: "#ffd60a"),
        diffAdded:          Color(hex: "#30d158").opacity(0.15),
        diffRemoved:        Color(hex: "#ff453a").opacity(0.15),
        thinkingBg:         Color(hex: "#2c2c2e"),
        thinkingText:       Color(hex: "#8e8e93"),
        navBg:              Color(hex: "#1c1c1e"),
        inputBg:            Color(hex: "#2c2c2e")
    )

    /// Default Light — neutral light
    static let defaultLight = AppTheme(
        name: "Default Light",
        pageBg:             Color(hex: "#f2f2f7"),
        cardBg:             Color(hex: "#ffffff"),
        infoBg:             Color(hex: "#e5e5ea"),
        accent:             Color(hex: "#007aff"),
        accentSubtle:       Color(hex: "#c7c7cc"),
        userBubble:         Color(hex: "#007aff"),
        userBubbleText:     Color(hex: "#ffffff"),
        assistantBubble:    Color(hex: "#e5e5ea"),
        assistantBubbleText: Color(hex: "#000000"),
        toolPendingBg:      Color(hex: "#d1d1d6"),
        toolSuccessBg:      Color(hex: "#e6f4ea"),
        toolErrorBg:        Color(hex: "#fce8e6"),
        codeBlockBg:        Color(hex: "#f2f2f7"),
        codeBlockText:      Color(hex: "#1c1c1e"),
        border:             Color(hex: "#c6c6c8"),
        borderAccent:       Color(hex: "#007aff"),
        text:               Color(hex: "#000000"),
        textSecondary:      Color(hex: "#3c3c4399"),
        textMuted:          Color(hex: "#3c3c434c"),
        success:            Color(hex: "#34c759"),
        error:              Color(hex: "#ff3b30"),
        warning:            Color(hex: "#ff9500"),
        diffAdded:          Color(hex: "#34c759").opacity(0.15),
        diffRemoved:        Color(hex: "#ff3b30").opacity(0.15),
        thinkingBg:         Color(hex: "#e5e5ea"),
        thinkingText:       Color(hex: "#6c6c70"),
        navBg:              Color(hex: "#ffffff"),
        inputBg:            Color(hex: "#e5e5ea")
    )

    /// All built-in presets in display order.
    static let allPresets: [AppTheme] = [
        .rosePine, .rosePineMoon, .rosePineDawn, .defaultDark, .defaultLight
    ]

    /// Lookup by name, falling back to rosePine.
    static func named(_ name: String) -> AppTheme {
        allPresets.first { $0.name == name } ?? .rosePine
    }
}

// MARK: - EnvironmentKey

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue: AppTheme = .rosePine
}

extension EnvironmentValues {
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }
}

// MARK: - ThemeManager

@Observable
final class ThemeManager {
    private static let defaultsKey = "selectedTheme"
    private static let suiteName   = "group.com.sam.pidash"

    private(set) var current: AppTheme

    init() {
        let defaults = UserDefaults(suiteName: Self.suiteName) ?? UserDefaults.standard
        let saved    = defaults.string(forKey: Self.defaultsKey) ?? ""
        current      = AppTheme.named(saved.isEmpty ? AppTheme.rosePine.name : saved)
    }

    func select(_ theme: AppTheme) {
        current = theme
        let defaults = UserDefaults(suiteName: Self.suiteName) ?? UserDefaults.standard
        defaults.set(theme.name, forKey: Self.defaultsKey)
    }
}
