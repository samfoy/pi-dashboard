import SwiftUI

// MARK: - ConnectionBanner

/// Displays an amber banner at the top when the server connection is degraded.
/// Tap to manually reconnect.
struct ConnectionBanner: View {
    let state: ConnectionState
    var onTap: (() -> Void)?

    var shouldShow: Bool {
        switch state {
        case .connected, .connecting: return false
        case .reconnecting(let n) where n <= 1: return false  // Hide during first quick retry
        default: return true
        }
    }

    var body: some View {
        if shouldShow {
            Button(action: { onTap?() }) {
                HStack(spacing: 8) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.caption)
                    Text(state.displayText)
                        .font(.caption.weight(.medium))
                    if case .reconnecting = state {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                    } else {
                        Text("Tap to retry")
                            .font(.caption2)
                            .opacity(0.8)
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Color.orange)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.spring(duration: 0.4), value: shouldShow)
        }
    }
}
