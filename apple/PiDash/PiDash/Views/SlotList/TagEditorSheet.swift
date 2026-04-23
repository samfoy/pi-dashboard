import SwiftUI

// MARK: - TagEditorSheet

/// Sheet for adding/removing tags on a chat slot.
struct TagEditorSheet: View {
    let slot: ChatSlot
    let apiClient: APIClient
    let onUpdate: ([String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var tags: [String]
    @State private var newTag: String = ""
    @State private var isSaving = false
    @FocusState private var inputFocused: Bool

    init(slot: ChatSlot, apiClient: APIClient, onUpdate: @escaping ([String]) -> Void) {
        self.slot = slot
        self.apiClient = apiClient
        self.onUpdate = onUpdate
        self._tags = State(initialValue: slot.tags)
    }

    var body: some View {
        NavigationStack {
            List {
                // Add new tag
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "tag")
                            .foregroundStyle(.secondary)
                        TextField("Add tag…", text: $newTag)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .focused($inputFocused)
                            .onSubmit { addTag() }
                        if !newTag.isEmpty {
                            Button("Add") { addTag() }
                                .font(.subheadline.bold())
                        }
                    }
                }

                // Suggestions from recent tags
                let suggestions = recentTags.filter { !tags.contains($0) }
                if !suggestions.isEmpty {
                    Section("Suggestions") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(suggestions, id: \.self) { tag in
                                    Button {
                                        withAnimation { tags.append(tag) }
                                    } label: {
                                        Text(tag)
                                            .font(.subheadline)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 6)
                                            .background(theme.cardBg)
                                            .overlay(
                                                Capsule()
                                                    .strokeBorder(theme.border, lineWidth: 1)
                                            )
                                            .clipShape(Capsule())
                                    }
                                    .foregroundStyle(.primary)
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                }

                // Current tags
                if !tags.isEmpty {
                    Section("Current Tags") {
                        ForEach(tags, id: \.self) { tag in
                            HStack {
                                Text(tag)
                                    .font(.body)
                                Spacer()
                                Button {
                                    withAnimation { tags.removeAll { $0 == tag } }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .onDelete { offsets in
                            tags.remove(atOffsets: offsets)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Tags")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .fontWeight(.semibold)
                    .disabled(isSaving)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .onAppear { inputFocused = true }
    }

    // MARK: - Actions

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespaces).lowercased()
        guard !tag.isEmpty, !tags.contains(tag) else { return }
        withAnimation { tags.append(tag) }
        newTag = ""
    }

    private func save() async {
        isSaving = true
        do {
            let saved = try await apiClient.setTags(slot: slot.key, tags: tags)
            onUpdate(saved)
            dismiss()
        } catch {
            // Still dismiss — optimistic update
            onUpdate(tags)
            dismiss()
        }
    }

    // MARK: - Suggestions

    /// Recently used tags across all slots, persisted in UserDefaults.
    private static let recentTagsKey = "tagEditor.recentTags"

    private var recentTags: [String] {
        UserDefaults.standard.stringArray(forKey: Self.recentTagsKey) ?? []
    }

    /// Call after saving to update recent tags.
    static func recordTags(_ tags: [String]) {
        var recent = UserDefaults.standard.stringArray(forKey: recentTagsKey) ?? []
        for tag in tags {
            recent.removeAll { $0 == tag }
            recent.insert(tag, at: 0)
        }
        if recent.count > 20 { recent = Array(recent.prefix(20)) }
        UserDefaults.standard.set(recent, forKey: recentTagsKey)
    }
}
