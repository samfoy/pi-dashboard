import Foundation
import SwiftUI

// MARK: - WorkflowRunState

enum WorkflowRunState: String, Codable, CaseIterable {
    case pending
    case approved
    case running
    case paused
    case done
    case failed
    case stopped
    case cancelledPreRun = "cancelled-pre-run"

    var isTerminal: Bool {
        switch self {
        case .done, .failed, .stopped, .cancelledPreRun: return true
        default: return false
        }
    }

    var isActive: Bool { !isTerminal }

    var displayLabel: String {
        switch self {
        case .pending: return "Pending"
        case .approved: return "Approved"
        case .running: return "Running"
        case .paused: return "Paused"
        case .done: return "Done"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        case .cancelledPreRun: return "Cancelled"
        }
    }
}

// MARK: - WorkflowError

struct WorkflowError: Codable, Equatable {
    let name: String
    let message: String
}

// MARK: - WorkflowRun

/// Summary of a single workflow run (from `/api/workflows/runs`).
struct WorkflowRun: Codable, Identifiable, Equatable {
    var id: String { runId }

    let runId: String
    let workflowName: String
    let state: WorkflowRunState
    let startedAt: String
    let endedAt: String?
    let durationMs: Int?
    let cwd: String?
    let agentCount: Int?
    let error: WorkflowError?
    let input: String?
    let piWorkflowsVersion: String?

    // MARK: Derived

    var startDate: Date? {
        ISO8601DateFormatter().date(from: startedAt)
    }

    var endDate: Date? {
        guard let endedAt else { return nil }
        return ISO8601DateFormatter().date(from: endedAt)
    }

    var durationLabel: String {
        if let ms = durationMs {
            return formatDuration(ms: ms)
        }
        if let start = startDate {
            let elapsed = Int(Date().timeIntervalSince(start) * 1000)
            return formatDuration(ms: elapsed)
        }
        return "—"
    }

    var relativeStartLabel: String {
        guard let date = startDate else { return "—" }
        let delta = Int(Date().timeIntervalSince(date))
        if delta < 60 { return "\(delta)s ago" }
        if delta < 3600 { return "\(delta / 60)m ago" }
        if delta < 86400 { return "\(delta / 3600)h ago" }
        return "\(delta / 86400)d ago"
    }
}

func formatDuration(ms: Int) -> String {
    let totalSec = ms / 1000
    let h = totalSec / 3600
    let m = (totalSec % 3600) / 60
    let s = totalSec % 60
    if h > 0 { return "\(h)h \(m)m" }
    if m > 0 { return "\(m)m \(String(format: "%02d", s))s" }
    return "\(s)s"
}

// MARK: - WorkflowRunsResponse

struct WorkflowRunsResponse: Codable {
    let runs: [WorkflowRun]
}

// MARK: - LedgerEntry

struct LedgerEntry: Codable, Identifiable {
    var id: String { "\(type)-\(at)" }

    let type: String
    let at: String
    // transition fields
    let from: String?
    let to: String?
    // cancel
    let cause: String?
    // phase fields
    let phaseName: String?
    let agentCount: Int?
    let durationMs: Int?
    // agent fields
    let agentId: String?
    let cached: Bool?
    let usage: AgentUsage?
    // result
    let result: String?
    let truncated: Bool?

    var date: Date? { ISO8601DateFormatter().date(from: at) }

    var timeLabel: String {
        guard let date else { return at }
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm:ss.SSS"
        return fmt.string(from: date)
    }

    var displayLabel: String {
        switch type {
        case "init": return "Initialized"
        case "transition":
            if let from, let to { return "\(from) → \(to)" }
            if let to { return "→ \(to)" }
            return "Transition"
        case "cancelled": return "Cancelled (\(cause ?? "user"))"
        case "phase_start":
            if let name = phaseName, let count = agentCount {
                return "Phase: \(name) (\(count) agent\(count == 1 ? "" : "s"))"
            }
            return "Phase start: \(phaseName ?? "?")"
        case "phase_end":
            if let name = phaseName, let ms = durationMs {
                return "Phase done: \(name) (\(formatDuration(ms: ms)))"
            }
            return "Phase end: \(phaseName ?? "?")"
        case "agent_start":
            return "Agent: \(agentId ?? "?")\(phaseName.map { " in \($0)" } ?? "")"
        case "agent_end":
            var label = "Agent done: \(agentId ?? "?")"
            if let ms = durationMs { label += " (\(formatDuration(ms: ms)))" }
            if cached == true { label += " 💾 cached" }
            return label
        case "result": return "Result written"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct AgentUsage: Codable {
    let input: Int?
    let output: Int?
    let cacheRead: Int?
    let cacheWrite: Int?
    let totalTokens: Int?
}

// MARK: - TokenSummary

struct TokenSummary {
    let totalInput: Int
    let totalOutput: Int
    let totalCacheRead: Int
    let totalTokens: Int

    /// Formats as "12.3k" for values ≥ 1000, plain integer otherwise.
    static func format(_ n: Int) -> String {
        n >= 1000 ? String(format: "%.1fk", Double(n) / 1000) : "\(n)"
    }
}

// MARK: - WorkflowRunDetail

/// Full detail for a single run (from `/api/workflows/runs/:id`).
struct WorkflowRunDetail: Codable {
    let runId: String
    let workflowName: String
    let state: WorkflowRunState
    let startedAt: String
    let endedAt: String?
    let durationMs: Int?
    let cwd: String?
    let agentCount: Int?
    let error: WorkflowError?
    let input: String?
    let piWorkflowsVersion: String?
    let finishCallbackPrompt: String?
    let timeline: [LedgerEntry]
    // resultPayload is arbitrary JSON — decode as raw value
    let resultPayload: ResultPayload?

    var tokenSummary: TokenSummary? {
        let usages = timeline
            .filter { $0.type == "agent_end" }
            .compactMap(\.usage)
        guard !usages.isEmpty else { return nil }
        return TokenSummary(
            totalInput:     usages.compactMap(\.input).reduce(0, +),
            totalOutput:    usages.compactMap(\.output).reduce(0, +),
            totalCacheRead: usages.compactMap(\.cacheRead).reduce(0, +),
            totalTokens:    usages.compactMap(\.totalTokens).reduce(0, +)
        )
    }

    var asSummary: WorkflowRun {
        WorkflowRun(
            runId: runId,
            workflowName: workflowName,
            state: state,
            startedAt: startedAt,
            endedAt: endedAt,
            durationMs: durationMs,
            cwd: cwd,
            agentCount: agentCount,
            error: error,
            input: input,
            piWorkflowsVersion: piWorkflowsVersion
        )
    }
}

/// Thin wrapper to decode the `resultPayload` field as either a string or
/// an arbitrary JSON object. We store it as a pretty-printed string.
struct ResultPayload: Codable {
    let displayString: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) {
            displayString = s
        } else if let raw = try? container.decode(AnyJSON.self) {
            let data = try JSONEncoder().encode(raw)
            if let pretty = try? JSONSerialization.jsonObject(with: data),
               let prettyData = try? JSONSerialization.data(withJSONObject: pretty, options: .prettyPrinted),
               let str = String(data: prettyData, encoding: .utf8) {
                displayString = str
            } else {
                displayString = String(data: data, encoding: .utf8) ?? "(result)"
            }
        } else {
            displayString = "(empty result)"
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(displayString)
    }
}

// Minimal type-erased JSON value for decoding arbitrary payloads.
struct AnyJSON: Codable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) { value = bool }
        else if let int = try? container.decode(Int.self) { value = int }
        else if let double = try? container.decode(Double.self) { value = double }
        else if let string = try? container.decode(String.self) { value = string }
        else if let array = try? container.decode([AnyJSON].self) { value = array.map(\.value) }
        else if let dict = try? container.decode([String: AnyJSON].self) { value = dict.mapValues(\.value) }
        else { value = NSNull() }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let b as Bool: try container.encode(b)
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let s as String: try container.encode(s)
        case let a as [Any]:
            let wrapped = a.map { AnyJSON(raw: $0) }
            try container.encode(wrapped)
        case let d as [String: Any]:
            let wrapped = d.mapValues { AnyJSON(raw: $0) }
            try container.encode(wrapped)
        default: try container.encodeNil()
        }
    }

    init(raw: Any) { value = raw }
}

// MARK: - WorkflowRunState + UI

extension WorkflowRunState {
    var stateColor: Color {
        switch self {
        case .running: return .blue
        case .paused: return .orange
        case .done: return .green
        case .failed: return .red
        case .stopped: return .secondary
        case .cancelledPreRun: return .secondary
        case .pending, .approved: return .yellow
        }
    }

    var systemImage: String {
        switch self {
        case .running: return "arrow.trianglehead.2.clockwise.rotate.90"
        case .paused: return "pause.circle"
        case .done: return "checkmark.circle"
        case .failed: return "xmark.circle"
        case .stopped: return "stop.circle"
        case .cancelledPreRun: return "minus.circle"
        case .pending: return "clock"
        case .approved: return "checkmark.seal"
        }
    }
}

struct WorkflowScript: Codable, Identifiable {
    var id: String { path }
    let name: String
    let path: String
    let scope: String
    let mtimeMs: Double
}

struct WorkflowScriptsResponse: Codable {
    let scripts: [WorkflowScript]
}
