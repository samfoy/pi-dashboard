import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var urlText: String = ""
    @State private var tokenText: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://100.x.x.x:3000", text: $urlText)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Server URL")
                } footer: {
                    Text("Your pi-dashboard server address (Tailscale IP or local network).")
                }

                Section {
                    SecureField("Auth token (optional)", text: $tokenText)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Auth Token")
                } footer: {
                    Text("Leave empty for unauthenticated servers.")
                }
            }
            .navigationTitle("Pi Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(urlText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                urlText = appState.serverConfig.baseURL
                tokenText = appState.serverConfig.token
            }
        }
    }

    private func save() {
        let url = urlText.trimmingCharacters(in: .whitespaces)
        let token = tokenText.trimmingCharacters(in: .whitespaces)
        appState.serverConfig.update(baseURL: url)
        appState.serverConfig.update(token: token)
        appState.connectionFailed = false
        dismiss()
    }
}
