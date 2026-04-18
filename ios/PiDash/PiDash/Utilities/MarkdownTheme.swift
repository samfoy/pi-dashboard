import SwiftUI
import MarkdownUI

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
                        HStack {
                            Text(language.uppercased())
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button {
                                UIPasteboard.general.string = config.content
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                                    .font(.caption)
                            }
                            .buttonStyle(.borderless)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(.systemGray5))
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
