import Foundation
import CoreFoundation
import WebRTC

@MainActor
final class WebRTCClassroomClient: NSObject, ClassroomClientProtocol {
    var onStudentLocked: ((StudentLocked) -> Void)?
    var onWaitingRoomStateChanged: ((WaitingRoomStateChanged) -> Void)?
    var onQuestionChanged: ((QuestionChanged) -> Void)?
    var onBoardCleared: ((BoardCleared) -> Void)?
    var onKicked: (() -> Void)?
    var onBoardRecovered: ((NativeBoardViewState) -> Void)?
    var onStatus: ((String) -> Void)?
    private static let factory: RTCPeerConnectionFactory = { RTCInitializeSSL(); RTCSetMinDebugLogLevel(.none); return RTCPeerConnectionFactory() }()
    private let endpoint: URL
    private let origin: String
    private let board: NativeBoard
    private let persistence: NativeRecoveryPersistence
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var loop: Task<Void,Never>?
    private var pump: Task<Void,Never>?
    private var saveTask: Task<Void,Never>?
    private var room = "", student = "", token = "", boardKey = ""
    private var stopped = true, online = false, locked = true, ready = false
    private var revision = 0, controlEpoch = 0, questionRevision = 0, confirmedSeq = 0
    private var beforeClear: [String:Any]?
    private var attempt = ""
    private var ice: [RTCIceServer] = []
    private var iceExpires = Date.distantPast
    private var sentSeq = 0
    private var recovery: [[String:Any]] = []
    private var recoveryIndex = 0
    private var snapshot: [UInt8]?
    private var snapshotId = "", snapshotIndex = 0, snapshotTotal = 0
    private var incomingTokens = 400.0, incomingAt = Date()
    private var lastPong = Date(), lastPing = Date.distantPast
    private var connectingSince: Date?
    private let relayOnly: Bool

    init(webOrigin: URL, endpoint: URL, relayOnly: Bool = false, session: URLSession? = nil, protocolSource: String? = nil, persistence: NativeRecoveryPersistence = DeviceRecoveryPersistence()) throws {
        guard endpoint.scheme == "https", endpoint.user == nil, endpoint.password == nil,
              endpoint.query == nil, endpoint.fragment == nil, endpoint.path.isEmpty || endpoint.path == "/" else {
            throw WhitePadError.connectionFailed("Configure a trusted HTTPS signalling endpoint")
        }
        self.endpoint = endpoint; self.origin = webOrigin.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/"))
        self.persistence = persistence
        self.board = try protocolSource.map { try NativeBoard(source:$0) } ?? NativeBoard(); self.session = session ?? URLSession(configuration:.ephemeral,delegate:NoClassroomRedirects(),delegateQueue:nil); self.relayOnly = relayOnly
        super.init()
    }
    private func api(_ action: String, _ body: [String:Any] = [:], authenticated: Bool = true) async throws -> [String:Any] {
        let url = endpoint.appendingPathComponent("rooms").appendingPathComponent(room).appendingPathComponent(action)
        var request = URLRequest(url:url); request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue(origin,forHTTPHeaderField:"Origin")
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if authenticated { request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject:body)
        // URLSession redirects are disabled by the app-owned session delegate below.
        let (data,response) = try await session.data(for:request)
        guard let http = response as? HTTPURLResponse else { throw NativeServiceRejection(status:503) }
        if http.statusCode != 200 { throw NativeServiceRejection(status:http.statusCode) }
        guard http.url?.host == endpoint.host, data.count <= 32768,
              let value = try JSONSerialization.jsonObject(with:data) as? [String:Any] else {
            throw WhitePadError.connectionFailed("Classroom authentication or service unavailable")
        }
        return value
    }
    func joinRoom(roomId: String, joinToken: String, displayName: String) async throws -> JoinRoomResponse {
        guard roomId.range(of:"^[a-zA-Z0-9_-]{1,128}$",options:.regularExpression) != nil else { throw WhitePadError.joinRejected("Invalid room") }
        room = roomId
        let credentialKey = NativeRecoveryStore.key(origin+"|"+room+"|"+joinToken)
        let response: [String:Any]
        if let saved = try persistence.loadSession(credentialKey) {
            token = saved.token; student = saved.studentId
            response = try await api("session") // A rejected/expired session never silently creates a duplicate student.
        } else {
            response = try await api("join",["joinToken":joinToken,"name":displayName],authenticated:false)
            guard let id = response["studentId"] as? String, let secret = response["studentSessionToken"] as? String else { throw WhitePadError.joinRejected("Invalid join response") }
            student = id; token = secret
            try persistence.saveSession(NativeSessionRecord(studentId:id,token:secret,name:displayName,created:Date()),key:credentialKey)
        }
        boardKey = NativeRecoveryStore.key(origin+"|"+room+"|"+student)
        if let saved = try persistence.loadBoard(boardKey), let raw = saved["board"] as? [String:Any] {
            try board.replace(raw)
            revision = saved["revision"] as? Int ?? 0; controlEpoch = saved["controlEpoch"] as? Int ?? 0
            questionRevision = saved["questionRevision"] as? Int ?? 0; confirmedSeq = saved["confirmedSeq"] as? Int ?? 0
            beforeClear = saved["beforeClear"] as? [String:Any]
            guard revision >= 0, controlEpoch >= 0, questionRevision >= 0, confirmedSeq >= 0, confirmedSeq <= board.seq else {
                throw WhitePadError.connectionFailed("Invalid recovery metadata")
            }
            if let beforeClear {
                guard board.validSnapshot(beforeClear) else { throw WhitePadError.connectionFailed("Invalid recovery checkpoint") }
            }
        }
        try reconcile(response["control"])
        let data = try JSONSerialization.data(withJSONObject:response)
        stopped = false
        return try JSONDecoder().decode(JoinRoomResponse.self,from:data)
    }
    func startListening() {
        guard loop == nil, !stopped else { return }
        publishBoard()
        pump = Task { [weak self] in
            while !Task.isCancelled {
                do { try self?.flush() } catch { self?.disconnect() }
                try? await Task.sleep(nanoseconds:50_000_000)
            }
        }
        loop = Task { [weak self] in
            var retries = 0
            while let self, !self.stopped, !Task.isCancelled {
                do {
                    try await self.connect()
                    retries = 0
                    while !Task.isCancelled, !self.stopped, let ws = self.socket {
                        let message = try await ws.receive()
                        guard self.socket === ws else { break }
                        let data: Data
                        switch message { case .data(let d): data = d; case .string(let s): data = Data(s.utf8); @unknown default: continue }
                        guard data.count <= 32768, let object = try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw WhitePadError.connectionFailed("Invalid signalling") }
                        try await self.signal(object)
                    }
                } catch {
                    let closeCode = self.socket?.closeCode.rawValue
                    self.disconnect()
                    if closeCode == 4003 || (error as? NativeServiceRejection)?.status == 403 || (error as? NativeServiceRejection)?.status == 404 {
                        self.stopped = true; self.onStatus?("Classroom ended or membership revoked"); self.onKicked?()
                    } else if closeCode == 4001 {
                        self.stopped = true; self.onStatus?("Session open on another device")
                    }
                }
                guard !self.stopped, !Task.isCancelled else { break }
                retries = min(retries+1,6)
                self.onStatus?("Disconnected — drawing paused; reconnecting")
                let delay = min(30.0,pow(2.0,Double(retries-1))) * Double.random(in:0.7...1.3)
                try? await Task.sleep(nanoseconds:UInt64(delay*1_000_000_000))
            }
        }
    }
    private func connect() async throws {
        if Date() >= iceExpires {
            let turn = try await api("turn")
            guard let servers = turn["iceServers"] as? [[String:Any]], !servers.isEmpty else { throw WhitePadError.connectionFailed("TURN unavailable") }
            ice = servers.map { s in
                RTCIceServer(urlStrings:s["urls"] as? [String] ?? [s["urls"] as? String ?? ""],username:s["username"] as? String,credential:s["credential"] as? String)
            }
            iceExpires = Date(timeIntervalSince1970:(turn["expires"] as? Double ?? 0)/1000-600)
        }
        let ticket = try await api("ticket")
        guard let value = ticket["ticket"] as? String else { throw WhitePadError.connectionFailed("No signalling ticket") }
        var components = URLComponents(url:endpoint.appendingPathComponent("rooms/\(room)/socket"),resolvingAgainstBaseURL:false)!
        components.scheme = "wss"
        var request = URLRequest(url:components.url!); request.setValue(origin,forHTTPHeaderField:"Origin")
        request.setValue("whitepad, \(value)",forHTTPHeaderField:"Sec-WebSocket-Protocol")
        let ws = session.webSocketTask(with:request); ws.maximumMessageSize = 32768; socket = ws; ws.resume()
        lastPong = Date(); lastPing = .distantPast; connectingSince = Date()
    }
    private func signal(_ msg: [String:Any]) async throws {
        switch msg["type"] as? String {
        case "welcome", "control":
            try reconcile(msg["control"]); online = true; connectingSince = nil
            onStudentLocked?(StudentLocked(studentId:student,isLocked:locked)); onStatus?("Connecting to teacher")
        case "pong": lastPong = Date()
        case "kicked": stopped = true; onKicked?(); stop()
        case "teacher":
            if msg["online"] as? Bool == false { dropPeer(); onStatus?("Teacher disconnected — board saved locally") }
        case "signal":
            guard msg["from"] as? String == "teacher", let description = msg["description"] as? [String:Any],
                  description["type"] as? String == "offer", let sdp = description["sdp"] as? String,
                  sdp.utf8.count <= 24000, let nextAttempt = msg["attempt"] as? String else { throw WhitePadError.connectionFailed("Invalid teacher signalling") }
            try await answer(sdp,attempt:nextAttempt)
        default: break
        }
    }
    private func reconcile(_ raw: Any?) throws {
        guard let control = raw as? [String:Any], let members = control["members"] as? [[String:Any]],
              members.count == 1, let own = members.first, own["id"] as? String == student,
              let epoch = integer(own["epoch"]), let rev = integer(own["revision"]),
              let questionRev = integer(control["questionRevision"]), let isLocked = own["locked"] as? Bool,
              epoch >= 0, rev >= 0, questionRev >= 0 else { throw WhitePadError.connectionFailed("Invalid classroom authority") }
        if epoch != controlEpoch {
            let background = board.operations.last { ($0["body"] as? [String:Any])?["type"] as? String == "background" }?["body"] as? [String:Any]
            board.reset(); confirmedSeq = 0; beforeClear = nil
            if let background { try board.commit(background) }
            onBoardCleared?(BoardCleared(studentId:student))
        } else if rev != revision { try board.rewind(to:confirmedSeq,beforeClear:beforeClear); beforeClear = nil }
        revision = rev; controlEpoch = epoch; locked = isLocked
        if questionRev != questionRevision {
            questionRevision = questionRev
            if board.seq > 0 { try board.commit(["type":"answered","value":false]) }
        }
        onQuestionChanged?(QuestionChanged(question:control["question"] as? String))
        onStudentLocked?(StudentLocked(studentId:student,isLocked:!online || locked))
        try persist(); publishBoard(); ready = false; clearRecovery(); sendHello()
    }
    private func answer(_ sdp: String, attempt: String) async throws {
        dropPeer(); self.attempt = attempt
        let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan; config.iceServers = ice
        config.iceTransportPolicy = relayOnly ? .relay : .all
        guard let pc = Self.factory.peerConnection(with:config,constraints:RTCMediaConstraints(mandatoryConstraints:nil,optionalConstraints:nil),delegate:self) else { throw WhitePadError.connectionFailed("Peer unavailable") }
        peer = pc
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
            pc.setRemoteDescription(RTCSessionDescription(type:.offer,sdp:sdp)) { error in
                if let error { continuation.resume(throwing:error) } else { continuation.resume() }
            }
        }
        let description: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            pc.answer(for:RTCMediaConstraints(mandatoryConstraints:nil,optionalConstraints:nil)) { description,error in
                if let description { continuation.resume(returning:description) } else { continuation.resume(throwing:error ?? WhitePadError.connectionFailed("Answer failed")) }
            }
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
            pc.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing:error) } else { continuation.resume() }
            }
        }
        let deadline = Date().addingTimeInterval(12)
        while pc.iceGatheringState != .complete, Date() < deadline, !stopped { try await Task.sleep(nanoseconds:100_000_000) }
        guard peer === pc, !stopped, let local = pc.localDescription, local.sdp.contains("a=candidate:"),
              !relayOnly || local.sdp.contains(" typ relay") else { throw WhitePadError.connectionFailed("ICE gathering failed") }
        sendSignal(["type":"signal","to":"teacher","attempt":attempt,"description":["type":"answer","sdp":local.sdp]])
    }
    private func header(_ type: String) -> [String:Any] { ["v":1,"type":type,"revision":revision,"controlEpoch":controlEpoch,"questionRevision":questionRevision] }
    private func sendHello() { var msg = header("hello"); msg["seq"] = board.seq; sendFrame(msg) }
    private func sendSignal(_ msg: [String:Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject:msg), data.count <= 32768, let text = String(data:data,encoding:.utf8) else { return }
        socket.send(.string(text)) { [weak self] error in if error != nil { Task { @MainActor in self?.disconnect() } } }
    }
    @discardableResult private func sendFrame(_ msg: [String:Any]) -> Bool {
        guard let channel, channel.readyState == .open, channel.bufferedAmount < 256*1024,
              let data = try? JSONSerialization.data(withJSONObject:msg), data.count <= 16*1024 else { return false }
        return channel.sendData(RTCDataBuffer(data:data,isBinary:false))
    }
    private func requireSend(_ msg: [String:Any]) throws {
        guard sendFrame(msg) else { throw WhitePadError.connectionFailed("Peer delivery requires recovery") }
    }
    func refreshConnection() { disconnect() }
    private func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded(.down) == number.doubleValue else { return nil }
        return number.intValue
    }
    private func receive(_ data: Data) throws {
        let now = Date(); incomingTokens = min(400,incomingTokens+now.timeIntervalSince(incomingAt)*200); incomingAt = now
        guard data.count <= 16*1024, incomingTokens >= 1, let msg = try JSONSerialization.jsonObject(with:data) as? [String:Any],
              integer(msg["v"]) == 1 else { throw WhitePadError.connectionFailed("Invalid peer frame") }
        incomingTokens -= 1
        guard integer(msg["revision"]) == revision, integer(msg["controlEpoch"]) == controlEpoch,
              integer(msg["questionRevision"]) == questionRevision else { return }
        guard let head = integer(msg["seq"]), head >= 0, head <= 9_007_199_254_740_991 else { throw WhitePadError.connectionFailed("Invalid sequence") }
        switch msg["type"] as? String {
        case "ack":
            guard head <= board.seq else { throw WhitePadError.connectionFailed("Invalid acknowledgement") }
            confirmedSeq = max(confirmedSeq,head)
            if let old = beforeClear?["seq"] as? Int, head > old { beforeClear = nil }
            scheduleSave()
        case "hello":
            ready = true; sendHello(); clearRecovery()
            let missing = board.operations.filter{($0["seq"] as? Int ?? 0)>head}
            sentSeq = board.seq
            if head <= board.seq, missing.count <= 512, missing.isEmpty || missing.first?["seq"] as? Int == head+1 {
                recovery = missing
            } else {
                snapshot = Array(try JSONSerialization.data(withJSONObject:board.json))
                snapshotId = UUID().uuidString; snapshotIndex = -1
                snapshotTotal = Int(ceil(Double(snapshot!.count)/8000))
            }
            onStatus?("Connected")
        default: throw WhitePadError.connectionFailed("Teacher cannot write a student board")
        }
    }
    private func clearRecovery() { recovery = []; recoveryIndex = 0; snapshot = nil; snapshotIndex = 0 }
    private func flush() throws {
        guard !stopped else { return }
        if let since = connectingSince, Date().timeIntervalSince(since) > 15 { disconnect(); return }
        if socket != nil, Date().timeIntervalSince(lastPing)>20 {
            if Date().timeIntervalSince(lastPong)>60 { disconnect(); return }
            sendSignal(["type":"ping"]); lastPing = Date()
        }
        guard ready, let channel, channel.readyState == .open else { return }
        // No unbounded delivery queue: canonical board is the bounded resend source.
        for _ in 0..<16 {
            guard channel.bufferedAmount < 256*1024 else { return }
            if let snapshot {
                if snapshotIndex == -1 {
                    var msg = header("snapshot-start"); msg["id"] = snapshotId; msg["total"] = snapshotTotal; try requireSend(msg); snapshotIndex = 0
                } else if snapshotIndex < snapshotTotal {
                    let units = snapshot
                    let lo = snapshotIndex*8000, hi = min(units.count,lo+8000)
                    var msg = header("snapshot-chunk"); msg["id"] = snapshotId; msg["index"] = snapshotIndex
                    msg["data"] = String(decoding:units[lo..<hi],as:UTF8.self); try requireSend(msg); snapshotIndex += 1
                } else { var msg = header("snapshot-end"); msg["id"] = snapshotId; try requireSend(msg); self.snapshot = nil }
            } else if recoveryIndex < recovery.count {
                var msg = header("op"); msg["op"] = recovery[recoveryIndex]; try requireSend(msg); recoveryIndex += 1
            } else if let op = board.operations.first(where:{($0["seq"] as? Int ?? 0)>sentSeq}) {
                var msg = header("op"); msg["op"] = op; try requireSend(msg); sentSeq = op["seq"] as! Int
            } else { return }
        }
    }
    private func commit(_ body: [String:Any], indicator: Bool = false) throws {
        guard online, !locked || indicator else { throw WhitePadError.connectionFailed("Drawing paused until controls reconcile") }
        if body["type"] as? String == "clear", beforeClear == nil { beforeClear = board.json }
        try board.commit(body); scheduleSave()
    }
    func sendStrokeBatch(_ b: StrokeBatch) async throws {
        if b.points.isEmpty { try commit(["type":"background","pattern":b.backgroundType,"paper":b.paperColor]) }
        else {
            if !board.hasObject(b.strokeId) { try commit(["type":"start","id":b.strokeId,"style":["color":b.color,"width":abs(b.lineWidth),"eraser":b.isEraser]]) }
            let points = try board.encoded(b.points)
            for i in stride(from:0,to:points.count,by:256) { try commit(["type":"points","id":b.strokeId,"points":Array(points[i..<min(points.count,i+256)])]) }
        }
        if b.isComplete, board.hasObject(b.strokeId) { try commit(["type":"end","id":b.strokeId]) }
    }
    func sendShape(_ s: WhiteboardShape) async throws { try commit(["type":"shape","id":s.shapeId,"shape":s.type.rawValue,"points":board.encoded(s.points),"style":["color":s.color,"width":abs(s.lineWidth),"eraser":false]]) }
    func undoStroke(_ id: String) async throws { try commit(["type":"undo","id":id]) }
    func redoStroke(_ id: String) async throws { try commit(["type":"redo","id":id]) }
    func clearBoard() async throws {
        let retained = ["background","confidence","answered"].compactMap { kind in board.operations.last{($0["body"] as? [String:Any])?["type"] as? String == kind}?["body"] as? [String:Any] }
        try commit(["type":"clear"]); for body in retained { try commit(body) }
    }
    func setAnswered(_ value: Bool) async throws { try commit(["type":"answered","value":value],indicator:true) }
    func setConfidence(_ value: String) async throws { try commit(["type":"confidence","value":value],indicator:true) }
    func joinFromWaitingRoom() async throws {}
    private func publishBoard() { onBoardRecovered?(NativeBoardViewState(board:board,studentId:student)) }
    private func persist() throws {
        guard !boardKey.isEmpty else { return }
        var state: [String:Any] = ["board":board.json,"revision":revision,"controlEpoch":controlEpoch,"questionRevision":questionRevision,"confirmedSeq":confirmedSeq]
        if let beforeClear { state["beforeClear"] = beforeClear }
        try persistence.saveBoard(state,key:boardKey)
    }
    private func scheduleSave() {
        guard saveTask == nil else { return }
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds:100_000_000)
            do { try self?.persist() } catch { self?.onStatus?("Local recovery unavailable") }
            self?.saveTask = nil
        }
    }
    func selectedPathIsRelayed() async -> Bool {
        guard let peer else { return false }
        return await withCheckedContinuation { continuation in
            peer.statistics { report in
                let selected = report.statistics.values.filter { $0.type == "transport" }.compactMap { $0.values["selectedCandidatePairId"] as? String }
                let relayed = selected.contains { pairId in
                    guard let pair = report.statistics[pairId], let localId = pair.values["localCandidateId"] as? String,
                          let candidate = report.statistics[localId] else { return false }
                    return candidate.values["candidateType"] as? String == "relay"
                }
                continuation.resume(returning:relayed)
            }
        }
    }
    private func dropPeer() { ready = false; channel?.delegate = nil; channel?.close(); channel = nil; peer?.delegate = nil; peer?.close(); peer = nil; clearRecovery() }
    private func disconnect() { online = false; dropPeer(); socket?.cancel(with:.goingAway,reason:nil); socket = nil; onStudentLocked?(StudentLocked(studentId:student,isLocked:true)) }
    func stop() { stopped = true; loop?.cancel(); loop = nil; pump?.cancel(); pump = nil; saveTask?.cancel(); saveTask = nil; try? persist(); disconnect(); session.invalidateAndCancel() }
}

// libwebrtc invokes delegates off-main. Every state mutation returns to the main actor.
extension WebRTCClassroomClient: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        if newState == .failed || newState == .disconnected { Task { @MainActor [weak self] in if self?.peer === pc { self?.disconnect() } } }
    }
    nonisolated func peerConnection(_ pc: RTCPeerConnection, didOpen dc: RTCDataChannel) {
        Task { @MainActor [weak self] in
            guard let self, self.peer === pc, self.channel == nil, dc.label == "whitepad-v1", dc.isOrdered,
                  dc.maxRetransmits == UInt16.max, dc.maxPacketLifeTime == UInt16.max else { dc.close(); return }
            self.channel = dc; dc.delegate = self
            if dc.readyState == .open { self.sendHello() }
        }
    }
    nonisolated func dataChannelDidChangeState(_ dc: RTCDataChannel) {
        Task { @MainActor [weak self] in guard let self, self.channel === dc else { return }; if dc.readyState == .open { self.sendHello() } }
    }
    nonisolated func dataChannel(_ dc: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        Task { @MainActor [weak self] in
            guard let self, self.channel === dc else { return }
            do { try self.receive(buffer.data) } catch { self.disconnect() }
        }
    }
}

private final class NoClassroomRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct NativeServiceRejection: Error { let status: Int }
