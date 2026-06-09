import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Helpers

private func toolIcon(_ tool: String) -> String {
    switch tool {
    case "bash":         return "terminal"
    case "read":         return "doc.text"
    case "write":        return "pencil"
    case "edit":         return "pencil.and.outline"
    case "web_search":   return "globe"
    case "fetch_content": return "arrow.down.circle"
    case "knowledge_search", "session_search": return "magnifyingglass"
    default:             return "hammer"
    }
}

private func formatTokens(_ count: Int) -> String {
    count >= 1_000 ? "\(count / 1_000)k" : "\(count)"
}

// MARK: - Design Tokens

private extension Color {
    static let piAccent   = Color(red: 0.063, green: 0.471, blue: 1.0)
    static let piBg       = Color(red: 0.08,  green: 0.08,  blue: 0.10)
    static let piSurface  = Color(red: 0.13,  green: 0.13,  blue: 0.16)
    static let piGreen    = Color(red: 0.2,   green: 0.85,  blue: 0.4)
    static let piYellow   = Color(red: 1.0,   green: 0.75,  blue: 0.1)
}

// MARK: - Lock Screen / Notification Center View

struct PiDashLockScreenActivityView: View {
    let context: ActivityViewContext<PiDashLiveActivityAttributes>

    var body: some View {
        VStack(spacing: 10) {
            // Header row
            HStack(spacing: 10) {
                Image(systemName: "bolt.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(context.state.pendingApproval ? Color.piYellow : Color.piGreen)

                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.slotTitle)
                        .font(.subheadline.bold())
                        .lineLimit(1)

                    if context.state.pendingApproval {
                        Label("Needs approval", systemImage: "hand.raised.fill")
                            .font(.caption)
                            .foregroundStyle(Color.piYellow)
                    } else if let tool = context.state.currentTool {
                        Label(context.state.toolInput ?? tool, systemImage: toolIcon(tool))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text("Idle")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 3) {
                    Text(context.state.startedAt, style: .timer)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)

                    if context.state.tokenCount > 0 {
                        Text("\(formatTokens(context.state.tokenCount)) tok")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            // Approval buttons (only shown when agent is waiting)
            if context.state.pendingApproval {
                HStack(spacing: 10) {
                    Link(destination: URL(string: "pidash://action?type=approve&slot=\(context.attributes.slotKey)")!) {
                        Label("Approve", systemImage: "checkmark")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(.green, in: Capsule())
                    }
                    Link(destination: URL(string: "pidash://action?type=reject&slot=\(context.attributes.slotKey)")!) {
                        Label("Reject", systemImage: "xmark")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(.red, in: Capsule())
                    }
                }
            }
        }
        .padding(14)
        .background(Color.piBg)
    }
}

// MARK: - Dynamic Island: Expanded Regions

private struct PiDashExpandedLeadingView: View {
    let context: ActivityViewContext<PiDashLiveActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(context.attributes.slotTitle)
                .font(.caption.bold())
                .lineLimit(1)
            Text(context.state.startedAt, style: .timer)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.leading, 4)
    }
}

private struct PiDashExpandedTrailingView: View {
    let context: ActivityViewContext<PiDashLiveActivityAttributes>

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Image(systemName: "bolt.circle.fill")
                .foregroundStyle(context.state.pendingApproval ? Color.piYellow : Color.piGreen)
                .font(.system(size: 16))
            if context.state.tokenCount > 0 {
                Text("\(formatTokens(context.state.tokenCount))t")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.trailing, 4)
    }
}

private struct PiDashExpandedBottomView: View {
    let context: ActivityViewContext<PiDashLiveActivityAttributes>

    var body: some View {
        if context.state.pendingApproval {
            // Approve / Reject row
            HStack(spacing: 8) {
                Link(destination: URL(string: "pidash://action?type=approve&slot=\(context.attributes.slotKey)")!) {
                    Label("Approve", systemImage: "checkmark")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(.green, in: Capsule())
                }
                Link(destination: URL(string: "pidash://action?type=reject&slot=\(context.attributes.slotKey)")!) {
                    Label("Reject", systemImage: "xmark")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(.red, in: Capsule())
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 6)
        } else if let tool = context.state.currentTool {
            HStack(spacing: 6) {
                Image(systemName: toolIcon(tool))
                    .font(.caption2)
                    .foregroundStyle(Color.piAccent)
                Text(context.state.toolInput ?? tool)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 6)
        }
    }
}

// MARK: - Live Activity Widget

struct PiDashLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PiDashLiveActivityAttributes.self) { context in
            PiDashLockScreenActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PiDashExpandedLeadingView(context: context)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PiDashExpandedTrailingView(context: context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PiDashExpandedBottomView(context: context)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.circle.fill")
                        .foregroundStyle(context.state.pendingApproval ? Color.piYellow : Color.piGreen)
                        .font(.system(size: 13))
                    Text(context.attributes.slotTitle)
                        .font(.caption2.bold())
                        .lineLimit(1)
                        .frame(maxWidth: 90, alignment: .leading)
                }
            } compactTrailing: {
                if context.state.pendingApproval {
                    Image(systemName: "hand.raised.circle.fill")
                        .foregroundStyle(Color.piYellow)
                        .font(.system(size: 14))
                } else if let tool = context.state.currentTool {
                    Text(tool)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.piAccent.opacity(0.85), in: Capsule())
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.piGreen)
                        .font(.system(size: 13))
                }
            } minimal: {
                Image(
                    systemName: context.state.pendingApproval
                        ? "exclamationmark.circle.fill"
                        : "bolt.circle.fill"
                )
                .foregroundStyle(context.state.pendingApproval ? Color.piYellow : Color.piGreen)
                .font(.system(size: 12))
            }
        }
    }
}
