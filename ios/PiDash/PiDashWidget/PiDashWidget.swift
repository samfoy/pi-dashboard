import WidgetKit
import SwiftUI

// MARK: - Widget Entry

struct PiDashEntry: TimelineEntry {
    let date: Date
    let slots: [WidgetSlotDTO]
    let isConnected: Bool

    static var placeholder: PiDashEntry {
        PiDashEntry(
            date: Date(),
            slots: [
                WidgetSlotDTO.mock(key: "chat-1", title: "Build the widget", running: true),
                WidgetSlotDTO.mock(key: "chat-2", title: "Fix API bug", running: false),
                WidgetSlotDTO.mock(key: "chat-3", title: "Write tests", running: false),
            ],
            isConnected: true
        )
    }
}

extension WidgetSlotDTO {
    static func mock(key: String, title: String, running: Bool) -> WidgetSlotDTO {
        WidgetSlotDTO(
            key: key,
            title: title,
            running: running,
            pendingApproval: false,
            updatedAt: nil
        )
    }
}

// MARK: - Timeline Provider

struct PiDashTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> PiDashEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (PiDashEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
            return
        }
        Task {
            let client = WidgetNetworkClient()
            let (slots, connected) = await client.fetchSlots()
            completion(PiDashEntry(date: Date(), slots: slots, isConnected: connected))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PiDashEntry>) -> Void) {
        Task {
            let client = WidgetNetworkClient()
            let (slots, connected) = await client.fetchSlots()
            let entry = PiDashEntry(date: Date(), slots: slots, isConnected: connected)
            // Refresh every 15 minutes
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
            let timeline = Timeline(entries: [entry], policy: .after(nextRefresh))
            completion(timeline)
        }
    }
}

// MARK: - Design Tokens

private extension Color {
    /// App accent — matches Assets.xcassets AccentColor dark mode value
    static let pidashAccent = Color(red: 0.063, green: 0.471, blue: 1.0)
    static let pidashBackground = Color(red: 0.08, green: 0.08, blue: 0.10)
    static let pidashSurface = Color(red: 0.13, green: 0.13, blue: 0.16)
    static let pidashStreaming = Color(red: 0.2, green: 0.85, blue: 0.4)
    static let pidashInputNeeded = Color(red: 1.0, green: 0.75, blue: 0.1)
}

// MARK: - Reusable Sub-views

/// Status indicator dot / spinner
private struct StatusDot: View {
    let slot: WidgetSlotDTO

    var body: some View {
        if slot.isStreaming {
            Circle()
                .fill(Color.pidashStreaming)
                .frame(width: 8, height: 8)
        } else if slot.inputNeeded {
            Circle()
                .fill(Color.pidashInputNeeded)
                .frame(width: 8, height: 8)
        } else {
            Circle()
                .fill(Color.gray.opacity(0.4))
                .frame(width: 8, height: 8)
        }
    }
}

/// A single slot row used in medium/large widget
private struct SlotRowWidget: View {
    let slot: WidgetSlotDTO

    var statusLabel: String {
        if slot.isStreaming { return "Running" }
        if slot.inputNeeded { return "Waiting" }
        return "Idle"
    }

    var body: some View {
        HStack(spacing: 8) {
            StatusDot(slot: slot)
            VStack(alignment: .leading, spacing: 2) {
                Text(slot.displayTitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Text(statusLabel)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.pidashSurface)
        .cornerRadius(8)
    }
}

// MARK: - Small Widget View

struct PiDashSmallView: View {
    let entry: PiDashEntry

    private var activeCount: Int {
        entry.slots.filter { $0.isStreaming || $0.inputNeeded }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack(spacing: 6) {
                Circle()
                    .fill(entry.isConnected ? Color.pidashStreaming : Color.red)
                    .frame(width: 7, height: 7)
                Text(entry.isConnected ? "Connected" : "Offline")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(entry.isConnected ? Color.pidashStreaming : .red)
            }

            Spacer()

            // Slot count
            VStack(alignment: .leading, spacing: 2) {
                Text("\(entry.slots.count)")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundColor(.white)
                Text(entry.slots.count == 1 ? "chat" : "chats")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }

            if activeCount > 0 {
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.pidashStreaming)
                        .frame(width: 6, height: 6)
                    Text("\(activeCount) active")
                        .font(.system(size: 10))
                        .foregroundColor(Color.pidashStreaming)
                }
            }

            Spacer()

            // New chat button hint
            Text("+ New Chat")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color.pidashAccent)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(Color.pidashBackground)
        .widgetURL(URL(string: "pidash://new-chat"))
    }
}

// MARK: - Medium Widget View

struct PiDashMediumView: View {
    let entry: PiDashEntry

    private var displaySlots: [WidgetSlotDTO] {
        Array(entry.slots.prefix(3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header bar
            HStack {
                HStack(spacing: 5) {
                    Circle()
                        .fill(entry.isConnected ? Color.pidashStreaming : Color.red)
                        .frame(width: 6, height: 6)
                    Text("PiDash")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                }
                Spacer()
                Text("\(entry.slots.count) chats")
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
                Link(destination: URL(string: "pidash://new-chat")!) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(Color.pidashAccent)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            if displaySlots.isEmpty {
                Spacer()
                Text(entry.isConnected ? "No chats yet" : "Server offline")
                    .font(.system(size: 13))
                    .foregroundColor(.gray)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(spacing: 4) {
                    ForEach(displaySlots, id: \.key) { slot in
                        Link(destination: URL(string: "pidash://slot/\(slot.key)")!) {
                            SlotRowWidget(slot: slot)
                        }
                    }
                }
                .padding(.horizontal, 10)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.pidashBackground)
    }
}

// MARK: - Large Widget View

struct PiDashLargeView: View {
    let entry: PiDashEntry

    private var displaySlots: [WidgetSlotDTO] {
        Array(entry.slots.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header bar
            HStack {
                HStack(spacing: 5) {
                    Circle()
                        .fill(entry.isConnected ? Color.pidashStreaming : Color.red)
                        .frame(width: 6, height: 6)
                    Text("PiDash")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.white)
                }
                Spacer()
                Text("\(entry.slots.count) chats")
                    .font(.system(size: 11))
                    .foregroundColor(.gray)
                Link(destination: URL(string: "pidash://new-chat")!) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(Color.pidashAccent)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            if displaySlots.isEmpty {
                Spacer()
                Text(entry.isConnected ? "No chats yet" : "Server offline")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(spacing: 5) {
                    ForEach(displaySlots, id: \.key) { slot in
                        Link(destination: URL(string: "pidash://slot/\(slot.key)")!) {
                            SlotRowWidget(slot: slot)
                        }
                    }
                }
                .padding(.horizontal, 12)

                if entry.slots.count > 6 {
                    Text("+\(entry.slots.count - 6) more")
                        .font(.system(size: 10))
                        .foregroundColor(.gray)
                        .padding(.horizontal, 14)
                }

                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.pidashBackground)
    }
}

// MARK: - Entry View (family dispatch)

struct PiDashWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: PiDashEntry

    var body: some View {
        switch family {
        case .systemSmall:
            PiDashSmallView(entry: entry)
        case .systemMedium:
            PiDashMediumView(entry: entry)
        case .systemLarge:
            PiDashLargeView(entry: entry)
        default:
            PiDashMediumView(entry: entry)
        }
    }
}

// MARK: - Widget Declaration

struct PiDashWidget: Widget {
    let kind: String = "PiDashWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PiDashTimelineProvider()) { entry in
            PiDashWidgetEntryView(entry: entry)
                .containerBackground(Color.pidashBackground, for: .widget)
        }
        .configurationDisplayName("PiDash")
        .description("Monitor your pi chat sessions.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
