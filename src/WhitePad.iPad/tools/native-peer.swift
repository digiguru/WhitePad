import Foundation
// A two-peer integration fixture, never a load generator. Secrets enter on stdin only.
private final class MemoryRecovery: NativeRecoveryPersistence {
    func loadSession(_ key: String) throws -> NativeSessionRecord? { nil }
    func saveSession(_ record: NativeSessionRecord, key: String) throws {}
    func loadBoard(_ key: String) throws -> [String:Any]? { nil }
    func saveBoard(_ value: [String:Any], key: String) throws {}
}
@main struct NativePeer {
    @MainActor static func main() async {
        do {
            guard let line = readLine(), let data = line.data(using:.utf8),
                  let config = try JSONSerialization.jsonObject(with:data) as? [String:String],
                  let origin = URL(string:config["origin"] ?? ""), let endpoint = URL(string:config["endpoint"] ?? "") else { throw WhitePadError.connectionFailed("Fixture configuration") }
            let source = try String(contentsOfFile:CommandLine.arguments[1],encoding:.utf8)
            let client = try WebRTCClassroomClient(webOrigin:origin,endpoint:endpoint,relayOnly:config["relay"] == "true",protocolSource:source,persistence:MemoryRecovery())
            let response = try await client.joinRoom(roomId:config["room"] ?? "",joinToken:config["join"] ?? "",displayName:"Native fixture")
            var connected = false
            client.onStatus = { if $0 == "Connected" { connected = true } }
            client.startListening()
            let deadline = Date().addingTimeInterval(60)
            while !connected, Date()<deadline { try await Task.sleep(nanoseconds:100_000_000) }
            guard connected, let student = response.studentId else { throw WhitePadError.connectionFailed("Peer timeout") }
            try await client.sendStrokeBatch(StrokeBatch(studentId:student,strokeId:UUID().uuidString,points:[StrokePoint(x:0.2,y:0.2),StrokePoint(x:0.8,y:0.7)],isComplete:true))
            try await client.setConfidence("green"); try await client.setAnswered(true)
            if config["relay"] == "true" {
                guard await client.selectedPathIsRelayed() else { throw WhitePadError.connectionFailed("No selected relay path") }
            }
            print("NATIVE_DRAWING_SENT"); fflush(stdout)
            try await Task.sleep(nanoseconds:3_000_000_000)
            client.stop()
        } catch { fputs("Native peer fixture failed\n",stderr); exit(1) }
    }
}
