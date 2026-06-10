import ActivityKit
import Foundation

/// Manages Live Activities for pi agent slots.
/// One Activity per slotKey. Start when a slot begins running; end when it stops.
/// Called from the WebView bridge (piLiveActivity / piLiveActivityUpdate / piLiveActivityEnd).
@MainActor
final class LiveActivityManager {

    private var activities: [String: Activity<PiDashLiveActivityAttributes>] = [:]

    // MARK: - Public API

    /// Start a Live Activity for `slotKey`, or update it if one is already running.
    func start(
        slotKey: String,
        slotTitle: String,
        currentTool: String?,
        toolInput: String?,
        pendingApproval: Bool,
        tokenCount: Int
    ) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        // Already have one for this slot → update instead
        if activities[slotKey] != nil {
            update(slotKey: slotKey, currentTool: currentTool, toolInput: toolInput,
                   pendingApproval: pendingApproval, tokenCount: tokenCount)
            return
        }

        let attrs = PiDashLiveActivityAttributes(slotKey: slotKey, slotTitle: slotTitle)
        let state = PiDashLiveActivityAttributes.Status(
            currentTool: currentTool,
            toolInput: toolInput,
            pendingApproval: pendingApproval,
            tokenCount: tokenCount,
            startedAt: Date()
        )
        let content = ActivityContent(state: state, staleDate: nil)

        do {
            let activity = try Activity.request(attributes: attrs, content: content, pushType: nil)
            activities[slotKey] = activity
        } catch {
            print("[LiveActivity] start failed for \(slotKey): \(error)")
        }
    }

    /// Update the running state of an existing activity.
    func update(
        slotKey: String,
        currentTool: String?,
        toolInput: String?,
        pendingApproval: Bool,
        tokenCount: Int
    ) {
        guard let activity = activities[slotKey] else { return }
        let existing = activity.content.state
        let state = PiDashLiveActivityAttributes.Status(
            currentTool: currentTool,
            toolInput: toolInput,
            pendingApproval: pendingApproval,
            tokenCount: tokenCount,
            startedAt: existing.startedAt          // preserve original start time
        )
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    /// End the activity for `slotKey`, briefly showing a "Done" state before dismissing.
    func end(slotKey: String) {
        guard let activity = activities.removeValue(forKey: slotKey) else { return }
        let existing = activity.content.state
        let finalState = PiDashLiveActivityAttributes.Status(
            currentTool: nil,
            toolInput: "Done",
            pendingApproval: false,
            tokenCount: existing.tokenCount,
            startedAt: existing.startedAt
        )
        let staleIn4s = Date().addingTimeInterval(4)
        let content = ActivityContent(state: finalState, staleDate: staleIn4s)
        Task { await activity.end(content, dismissalPolicy: .after(staleIn4s)) }
    }

    /// End all live activities (called when the app terminates or disconnects).
    func endAll() {
        for key in Array(activities.keys) { end(slotKey: key) }
    }
}
