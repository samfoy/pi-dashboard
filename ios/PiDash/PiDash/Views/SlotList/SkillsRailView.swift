import SwiftUI

// MARK: - Skills Rail

/// Horizontal scroll rail of skill shortcuts shown above the chat list on the home screen.
struct SkillsRailView: View {
    let skills: [SlashCommand]   // pre-filtered to source == .skill
    let onSelect: (ChatSlot) -> Void

    @Environment(AppState.self) private var appState
    @State private var selectedAll = true

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                // "All" chip
                allChip

                ForEach(skills) { skill in
                    skillCard(skill)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Color(.systemBackground))
    }

    private var allChip: some View {
        Button {
            selectedAll = true
        } label: {
            Text("All")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(selectedAll ? .white : .primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(selectedAll ? Color.accentColor : Color(.systemGray5))
                )
        }
        .buttonStyle(.plain)
    }

    private func skillCard(_ skill: SlashCommand) -> some View {
        Button {
            selectedAll = false
            Task { await launchSkill(skill) }
        } label: {
            VStack(spacing: 4) {
                Text(skill.icon)
                    .font(.title3)
                Text(skill.displayName)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 76)
            .padding(.vertical, 10)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color(.systemGray6))
            )
        }
        .buttonStyle(.plain)
    }

    private func launchSkill(_ skill: SlashCommand) async {
        guard let newSlot = await appState.createSlot() else { return }
        // Queue the skill command — ChatViewModel picks it up after loadHistory()
        appState.setPendingCommand("/\(skill.name)", forSlot: newSlot.key)
        onSelect(newSlot)
    }
}
