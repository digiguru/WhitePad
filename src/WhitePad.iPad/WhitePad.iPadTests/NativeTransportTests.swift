import XCTest
@testable import WhitePad_iPad

@MainActor
final class NativeTransportTests: XCTestCase {
    func testProtocolResourceLoadsInAppBundle() async throws {
        let board = try NativeBoard()
        try board.commit(["type":"confidence","value":"green"])
        let restored = try NativeBoard()
        try restored.replace(board.json)
        XCTAssertEqual(NativeBoardViewState(board:restored,studentId:"student").confidence,.green)
    }
    func testNativeEndpointRejectsCleartextCredentialsAndPaths() async {
        let origin = URL(string:"https://white-pad-woad.vercel.app")!
        for text in ["http://example.com","https://user:secret@example.com","https://example.com/path","https://example.com/?token=secret"] {
            XCTAssertThrowsError(try WebRTCClassroomClient(webOrigin:origin,endpoint:URL(string:text)!))
        }
    }
    func testIncomingWorkCannotGrowWhileMainActorIsBusy() async {
        let gate = NativeIngressGate()
        for _ in 0..<64 { XCTAssertTrue(gate.acquire()) }
        XCTAssertFalse(gate.acquire())
        gate.release()
        XCTAssertTrue(gate.acquire())
        XCTAssertFalse(gate.acquire())
        for _ in 0..<64 { gate.release() }
        XCTAssertTrue(gate.acquire())
        gate.release()
    }
}
