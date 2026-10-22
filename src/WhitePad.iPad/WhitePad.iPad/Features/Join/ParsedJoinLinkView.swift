import SwiftUI

struct ParsedJoinLinkView: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var appRouter: AppRouter
    let joinLink: JoinLink

    @State private var displayName = ""
    @State private var isJoining = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section("Parsed Join Link") {
                LabeledContent("Server", value: joinLink.serverBaseURL.absoluteString)
                LabeledContent("Room ID", value: joinLink.roomId)
            }

            Section("Join Room") {
                TextField("Your name", text: $displayName)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .disabled(isJoining)

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }

                Button {
                    joinRoom()
                } label: {
                    Text(isJoining ? "Joining..." : "Join Session")
                }
                .disabled(isJoining || displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            Section {
                Button("Parse Another Link") {
                    appRouter.reset()
                }
                .disabled(isJoining)
            }
        }
        .navigationTitle("Ready to Join")
    }

    private func joinRoom() {
        guard !isJoining else { return }

        isJoining = true
        errorMessage = nil

        Task {
            do {
                try await appRouter.join(joinLink: joinLink, displayName: displayName)
            } catch let error as WhitePadError {
                errorMessage = error.message
                isJoining = false
            } catch {
                errorMessage = "Failed to join room. Please check the link and try again."
                isJoining = false
            }
        }
    }
}
