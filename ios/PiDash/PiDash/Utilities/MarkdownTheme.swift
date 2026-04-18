import SwiftUI
import MarkdownUI

// MARK: - CodeBlockHeader

/// Internal helper that owns the `copied` state so the button can show feedback.
private struct CodeBlockHeader: View {
    let language: String
    let content: String
    @State private var copied = false

    var body: some View {
        HStack {
            Text(language.uppercased())
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                UIPasteboard.general.string = content
                HapticManager.selectionChanged()
                copied = true
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    copied = false
                }
            } label: {
                Label(
                    copied ? "Copied!" : "Copy",
                    systemImage: copied ? "checkmark" : "doc.on.doc"
                )
                .font(.caption)
                .foregroundStyle(copied ? Color.green : Color.accentColor)
                .contentTransition(.symbolEffect(.replace))
                .animation(.easeInOut(duration: 0.2), value: copied)
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(.systemGray5))
    }
}

// MARK: - MarkdownTheme

extension Theme {
    /// PiDash custom theme — clean GitHub style with slight personalizations.
    static var piDash: Theme {
        Theme.gitHub
            .text {
                ForegroundColor(.primary)
                FontSize(16)
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(14)
                ForegroundColor(Color(.label))
                BackgroundColor(Color(.systemGray6))
            }
            .codeBlock { config in
                VStack(alignment: .leading, spacing: 0) {
                    // Language label
                    if let language = config.language {
                        CodeBlockHeader(language: language, content: config.content)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        config.label
                            .relativeLineSpacing(.em(0.3))
                            .markdownTextStyle {
                                FontFamilyVariant(.monospaced)
                                FontSize(13)
                            }
                            .padding(12)
                    }
                }
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color(.separator), lineWidth: 0.5)
                )
            }
    }
}
