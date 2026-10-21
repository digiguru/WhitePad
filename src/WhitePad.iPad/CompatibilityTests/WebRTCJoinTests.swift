import XCTest
@testable import WhitePad_iPad

final class WebRTCJoinTests: XCTestCase {
    func testWebRTCLinkOpensBrowserOnlyPathWithStudentCredential() throws {
        let link = try DeepLinkRouter().parse("https://school.example/join?roomId=room-123&token=student-join-token&transport=webrtc")
        XCTAssertTrue(link.usesWebRTC)
        let url = try XCTUnwrap(link.webRTCURL)
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "school.example")
        XCTAssertEqual(url.path, "/web-join")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first(where: { $0.name == "token" })?.value, "student-join-token")
        XCTAssertNil(query?.first(where: { $0.name == "teacherToken" }))
    }
    func testLegacyLinkRemainsNative() throws {
        let link = try DeepLinkRouter().parse("https://legacy.example/join?roomId=r&token=t")
        XCTAssertFalse(link.usesWebRTC)
        XCTAssertNil(link.webRTCURL)
    }
    func testCustomLinkRetainsTransportAndEncodedToken() throws {
        let link = try DeepLinkRouter().parse("whitepad://join?roomId=r&token=a%2Bb&transport=webrtc&server=https%3A%2F%2Fschool.example")
        XCTAssertTrue(link.usesWebRTC)
        XCTAssertEqual(link.webRTCURL?.host, "school.example")
        XCTAssertEqual(URLComponents(url: link.webRTCURL!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value, "a+b")
    }
}
