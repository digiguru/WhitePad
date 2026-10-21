import Foundation

@main
struct VerifyJoin {
    static func main() throws {
        let router = DeepLinkRouter()
        let rtc = try router.parse("https://school.example/join?roomId=r&token=a%2Bb&transport=webrtc")
        precondition(rtc.usesWebRTC && rtc.webRTCURL?.path == "/web-join")
        precondition(rtc.webRTCURL?.host == "school.example")
        let query = URLComponents(url: rtc.webRTCURL!, resolvingAgainstBaseURL: false)!.queryItems!
        precondition(query.first(where: { $0.name == "token" })?.value == "a+b")
        precondition(!query.contains(where: { $0.name == "teacherToken" }))
        let legacy = try router.parse("https://legacy.example/join?roomId=r&token=t")
        precondition(!legacy.usesWebRTC && legacy.webRTCURL == nil)
        let custom = try router.parse("whitepad://join?roomId=r&token=t&transport=webrtc&server=https%3A%2F%2Fschool.example")
        precondition(custom.usesWebRTC && custom.webRTCURL?.host == "school.example")
        print("Swift join compatibility checks passed (web, legacy, custom scheme, encoded token).")
    }
}
