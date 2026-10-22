import Foundation
import Combine

@MainActor
final class AppRouter: ObservableObject {
    @Published var phase: SessionPhase = .idle

    private let deepLinkRouter = DeepLinkRouter()
    private var hubClient: WebRTCClassroomClient?

    func handleIncomingURL(_ url: URL) {
        resolve(rawURL: url.absoluteString)
    }

    func resolve(rawURL: String) {
        do {
            let joinLink = try deepLinkRouter.parse(rawURL)
            phase = .resolvingJoinLink(joinLink)
        } catch let error as WhitePadError {
            phase = .failed(error)
        } catch {
            phase = .failed(.invalidJoinLink("Could not parse that join link."))
        }
    }

    func reset() {
        hubClient?.stop()
        hubClient = nil
        phase = .idle
    }

    func join(joinLink: JoinLink, displayName: String) async throws {
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            throw WhitePadError.joinRejected("Please enter your name.")
        }

        guard trimmedName.count <= 50 else {
            throw WhitePadError.joinRejected("Names must be 50 characters or fewer.")
        }

        hubClient?.stop()

        guard let trustedOrigin = Bundle.main.object(forInfoDictionaryKey: "WhitePadWebOrigin") as? String,
              joinLink.serverBaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == trustedOrigin,
              let endpoint = Bundle.main.object(forInfoDictionaryKey: "WhitePadSignallingURL") as? String,
              let url = URL(string: endpoint) else {
            throw WhitePadError.joinRejected("This app build is not configured for that classroom host.")
        }
        let client = try WebRTCClassroomClient(webOrigin: joinLink.serverBaseURL, endpoint: url)
        hubClient = client

        do {
            let response = try await client.joinRoom(
                roomId: joinLink.roomId,
                joinToken: joinLink.joinToken,
                displayName: trimmedName
            )

            guard response.success else {
                throw WhitePadError.joinRejected(response.error ?? "Failed to join room.")
            }

            guard let studentId = response.studentId,
                  let confirmedDisplayName = response.displayName else {
                throw WhitePadError.connectionFailed("The server accepted the join but did not return student details.")
            }

            let roomSession = StudentRoomSession(
                studentId: studentId,
                displayName: confirmedDisplayName,
                joinLink: joinLink,
                isLocked: response.isLocked ?? true,
                waitingRoomEnabled: response.waitingRoomEnabled ?? false,
                waitingRoomUnlocked: response.waitingRoomUnlocked ?? false,
                currentQuestion: response.currentQuestion,
                hubClient: client
            )
            client.startListening()
            phase = .joined(roomSession)
        } catch {
            client.stop()
            hubClient = nil
            throw error
        }
    }
}
