import SwiftUI

// MARK: - ConnectionBanner

/// Displays an amber banner at the top when the server connection is degraded.
struct ConnectionBanner: View {
    let state: ConnectionState

    var shouldShow: Bool {
        switch state {
        case .connected: return false
        default: return true
        }
    }

    var body: some View {
        if shouldShow {
            HStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.caption)
                Text(state.displayText)
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color.orange)
            .clipShape(Capsule())
            .padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.spring(duration: 0.4), value: shouldShow)
        }
    }
}
