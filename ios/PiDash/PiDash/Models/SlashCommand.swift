import Foundation

// MARK: - SlashCommand Model

/// Represents a single slash command returned by `GET /api/slash-commands`.
struct SlashCommand: Identifiable, Hashable {
    let name: String          // e.g. "compact", "skill:python-expert"
    let description: String
    let source: CommandSource

    var id: String { name }

    /// Display name — strips "skill:" prefix and title-cases.
    var displayName: String {
        let stripped = name.hasPrefix("skill:") ? String(name.dropFirst(6)) : name
        return stripped
            .split(separator: "-")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    /// Category grouping for the command palette.
    var category: CommandCategory {
        switch source {
        case .skill:
            return .skills
        case .builtin:
            let sessionCommands = ["compact", "clear", "cost", "model", "thinking", "copy", "status"]
            return sessionCommands.contains(name) ? .session : .tools
        case .extension:
            return .tools
        }
    }

    /// Emoji used as a visual icon in palette rows.
    var icon: String {
        switch name {
        case "compact":      return "🗜️"
        case "clear":        return "🗑️"
        case "cost":         return "💰"
        case "model":        return "🧠"
        case "thinking":     return "💭"
        case "copy":         return "📋"
        case "status":       return "📡"
        default:
            switch source {
            case .skill:     return "🎓"
            case .extension: return "🔧"
            case .builtin:   return "⚡"
            }
        }
    }
}

// MARK: - Supporting Enums

enum CommandSource: String, Decodable {
    case builtin
    case skill
    case `extension`
}

enum CommandCategory: String, CaseIterable {
    case session = "Session"
    case tools   = "Tools & Extensions"
    case skills  = "Skills"
}

// MARK: - DTO

struct SlashCommandDTO: Decodable {
    let name: String
    let description: String
    let source: String

    func toSlashCommand() -> SlashCommand {
        let src = CommandSource(rawValue: source) ?? .builtin
        return SlashCommand(name: name, description: description, source: src)
    }
}
