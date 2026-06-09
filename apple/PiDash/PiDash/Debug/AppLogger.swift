import Foundation
import os.log

// MARK: - Log Entry

struct LogEntry: Identifiable, Sendable {
    let id: UUID
    let timestamp: Date
    let level: LogLevel
    let category: String
    let message: String
    let file: String
    let line: Int

    enum LogLevel: String, CaseIterable, Sendable {
        case debug   = "DEBUG"
        case info    = "INFO"
        case warning = "WARN"
        case error   = "ERROR"

        var symbol: String {
            switch self {
            case .debug:   return "⚪"
            case .info:    return "🔵"
            case .warning: return "🟡"
            case .error:   return "🔴"
            }
        }
    }

    var formattedTime: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: timestamp)
    }
}

// MARK: - AppLogger

/// Thread-safe log ring buffer. Can be called from any actor/thread.
/// UI observes `entries` on the main thread via @Published.
final class AppLogger: ObservableObject, @unchecked Sendable {
    static let shared = AppLogger()

    @Published private(set) var entries: [LogEntry] = []

    private let maxEntries = 500
    private let subsystem = Bundle.main.bundleIdentifier ?? "com.sam.pidash"
    private var osLoggers: [String: Logger] = [:]
    private let lock = NSLock()

    private init() {}

    // MARK: - Log methods (callable from any actor/thread)

    func debug(_ message: String, category: String = "App", file: String = #fileID, line: Int = #line) {
        append(message, level: .debug, category: category, file: file, line: line)
    }
    func info(_ message: String, category: String = "App", file: String = #fileID, line: Int = #line) {
        append(message, level: .info, category: category, file: file, line: line)
    }
    func warning(_ message: String, category: String = "App", file: String = #fileID, line: Int = #line) {
        append(message, level: .warning, category: category, file: file, line: line)
    }
    func error(_ message: String, category: String = "App", file: String = #fileID, line: Int = #line) {
        append(message, level: .error, category: category, file: file, line: line)
    }
    func error(_ err: Error, context: String, category: String = "App", file: String = #fileID, line: Int = #line) {
        append("\(context): \(Self.describe(err))", level: .error, category: category, file: file, line: line)
    }

    // MARK: - Clear / Export

    func clear() {
        lock.withLock { }
        DispatchQueue.main.async { self.entries.removeAll() }
    }

    var exportText: String {
        lock.lock(); defer { lock.unlock() }
        return entries
            .map { "[\($0.formattedTime)] \($0.level.rawValue) [\($0.category)] \($0.message)" }
            .joined(separator: "\n")
    }

    // MARK: - Private

    private func append(_ message: String, level: LogEntry.LogLevel, category: String, file: String, line: Int) {
        // os.Logger is thread-safe
        osLogger(for: category).log(level: level.osLogType, "\(message, privacy: .public)")

        let entry = LogEntry(id: UUID(), timestamp: Date(), level: level,
                             category: category, message: message, file: file, line: line)
        DispatchQueue.main.async {
            if self.entries.count >= self.maxEntries {
                self.entries.removeFirst(self.entries.count - self.maxEntries + 1)
            }
            self.entries.append(entry)
        }
    }

    private func osLogger(for category: String) -> Logger {
        lock.lock(); defer { lock.unlock() }
        if let existing = osLoggers[category] { return existing }
        let l = Logger(subsystem: subsystem, category: category)
        osLoggers[category] = l
        return l
    }

    // MARK: - Error description

    static func describe(_ error: Error) -> String {
        // Always include the type so we can see what we're dealing with
        let typeName = String(reflecting: type(of: error))
        if let de = error as? DecodingError {
            switch de {
            case .keyNotFound(let key, let ctx):
                return "keyNotFound('\(key.stringValue)') at \(codingPath(ctx)) — \(ctx.debugDescription)"
            case .typeMismatch(let type, let ctx):
                return "typeMismatch(expected \(type)) at \(codingPath(ctx)) — \(ctx.debugDescription)"
            case .valueNotFound(let type, let ctx):
                return "valueNotFound(\(type)) at \(codingPath(ctx)) — \(ctx.debugDescription)"
            case .dataCorrupted(let ctx):
                return "dataCorrupted at \(codingPath(ctx)) — \(ctx.debugDescription)"
            @unknown default:
                return "[\(typeName)] \(String(reflecting: error))"
            }
        }
        if let apiError = error as? APIError {
            return apiError.errorDescription ?? error.localizedDescription
        }
        // Fallback: full reflection so we always see something useful
        return "[\(typeName)] \(error.localizedDescription)"
    }

    private static func codingPath(_ ctx: DecodingError.Context) -> String {
        let path = ctx.codingPath.map(\.stringValue).joined(separator: ".")
        return path.isEmpty ? "(root)" : path
    }
}

// MARK: - OSLogType bridge

private extension LogEntry.LogLevel {
    var osLogType: OSLogType {
        switch self {
        case .debug:   return .debug
        case .info:    return .info
        case .warning: return .default
        case .error:   return .error
        }
    }
}

// MARK: - Convenience shorthands (callable from any context)

let Log = AppLogger.shared

