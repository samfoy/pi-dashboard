// PiDashLiveActivityAttributes.swift
// ⚠️ XCODE SETUP: In Xcode, select this file → File Inspector → Target Membership
//    and check BOTH "PiDash" and "PiDashWidget". ActivityKit requires the shared type
//    in both the main app (to start/update/end) and the widget extension (to render).

import ActivityKit
import Foundation

struct PiDashLiveActivityAttributes: ActivityAttributes {
    public typealias ContentState = Status

    // Dynamic state — updated via Activity.update()
    public struct Status: Codable, Hashable {
        var currentTool: String?   // e.g. "bash", "read", "edit" — nil when idle or done
        var toolInput: String?     // first line of args, max 60 chars
        var pendingApproval: Bool
        var tokenCount: Int
        var startedAt: Date
    }

    // Static — set at Activity.request(), immutable for the activity's lifetime
    let slotKey: String
    let slotTitle: String
}
