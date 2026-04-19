import SwiftUI
import MarkdownUI

// MARK: - CodeBlockHeader

/// Internal helper that owns the `copied` state so the button can show feedback.
private struct CodeBlockHeader: View {
    let language: String
    let content: String
    let theme: AppTheme
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
                .foregroundStyle(copied ? theme.success : theme.accent)
                .contentTransition(.symbolEffect(.replace))
                .animation(.easeInOut(duration: 0.2), value: copied)
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(theme.codeBlockBg)
    }
}

// MARK: - MarkdownTheme

extension Theme {
    /// PiDash custom theme — derives colors from the active AppTheme.
    static func piDash(theme: AppTheme) -> Theme {
        Theme.gitHub
            .text {
                ForegroundColor(theme.text)
                FontSize(16)
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(14)
                ForegroundColor(theme.codeBlockText)
                BackgroundColor(theme.codeBlockBg)
            }
            .table { configuration in
                ScrollView(.horizontal, showsIndicators: true) {
                    configuration.label
                        .fixedSize(horizontal: false, vertical: true)
                        .markdownTableBorderStyle(
                            .init(color: .init(theme.border))
                        )
                        .markdownTableBackgroundStyle(
                            .alternatingRows(
                                Color.clear,
                                theme.codeBlockBg.opacity(0.5)
                            )
                        )
                }
                .markdownMargin(top: 0, bottom: 16)
            }
            .tableCell { configuration in
                configuration.label
                    .markdownTextStyle {
                        if configuration.row == 0 {
                            FontWeight(.semibold)
                        }
                        ForegroundColor(theme.text)
                        BackgroundColor(nil)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 13)
                    .relativeLineSpacing(.em(0.25))
            }
            .codeBlock { config in
                VStack(alignment: .leading, spacing: 0) {
                    // Language label
                    if let language = config.language {
                        CodeBlockHeader(language: language, content: config.content, theme: theme)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        config.label
                            .relativeLineSpacing(.em(0.3))
                            .markdownTextStyle {
                                FontFamilyVariant(.monospaced)
                                FontSize(13)
                                ForegroundColor(theme.codeBlockText)
                            }
                            .padding(12)
                    }
                }
                .background(theme.codeBlockBg)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(theme.border, lineWidth: 0.5)
                )
            }
    }
}
