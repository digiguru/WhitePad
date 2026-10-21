import Foundation

struct JoinLink: Equatable, Identifiable {
    var id: String { "\(serverBaseURL.absoluteString)|\(roomId)|\(joinToken)" }
    let serverBaseURL: URL
    let roomId: String
    let joinToken: String
    let sourceURL: URL?

    var usesWebRTC: Bool {
        guard let sourceURL else { return false }
        return URLComponents(url: sourceURL, resolvingAgainstBaseURL: false)?.queryItems?
            .contains(where: { $0.name == "transport" && $0.value == "webrtc" }) == true
    }

    // /web-join must be excluded from Universal Links to avoid reopening this app.
    var webRTCURL: URL? {
        guard usesWebRTC, ["http", "https"].contains(serverBaseURL.scheme?.lowercased() ?? ""),
              serverBaseURL.host != nil else { return nil }
        var components = URLComponents(url: serverBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/web-join"
        components?.queryItems = [URLQueryItem(name: "roomId", value: roomId),
                                  URLQueryItem(name: "token", value: joinToken),
                                  URLQueryItem(name: "transport", value: "webrtc")]
        return components?.url
    }
}
