import SwiftUI

/// Compact branch indicator shown in the chat toolbar when the slot's cwd
/// is inside a git repo. Shows the current branch and a small dirty-files
/// count when there are uncommitted changes.
struct GitBranchPill: View {
    let branch: String
    let dirty: Int

    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 9, weight: .semibold))
            Text(branch)
                .font(.caption2)
                .lineLimit(1)
            if dirty > 0 {
                Text("·")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("\(dirty)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(theme.accent.opacity(0.12))
        )
        .foregroundStyle(.secondary)
    }
}
