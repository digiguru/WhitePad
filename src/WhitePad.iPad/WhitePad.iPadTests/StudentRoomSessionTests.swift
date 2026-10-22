import XCTest
@testable import WhitePad_iPad

@MainActor
final class StudentRoomSessionTests: XCTestCase {
    func testLegacyWaitingRoomStateIsIgnoredOnJoin() {
        let session = makeSession(isLocked: true, waitingRoomEnabled: true, waitingRoomUnlocked: false)

        XCTAssertTrue(session.isLocked)
        XCTAssertFalse(session.isInWaitingRoomFlow)
        XCTAssertFalse(session.waitingRoomEnabled)
        XCTAssertTrue(session.waitingRoomUnlocked)
    }

    func testLegacyWaitingRoomUpdatesDoNotEnterWaitingRoomFlow() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient, isLocked: true, waitingRoomEnabled: true, waitingRoomUnlocked: false)

        hubClient.onWaitingRoomStateChanged?(WaitingRoomStateChanged(waitingRoomEnabled: true, waitingRoomUnlocked: true))

        XCTAssertFalse(session.isInWaitingRoomFlow)
        XCTAssertFalse(session.waitingRoomEnabled)
        XCTAssertTrue(session.waitingRoomUnlocked)
    }

    func testStudentLockedFalseClearsWaitingRoomFlow() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient, isLocked: true, waitingRoomEnabled: true, waitingRoomUnlocked: true)

        hubClient.onStudentLocked?(StudentLocked(studentId: "student-1", isLocked: false))

        XCTAssertFalse(session.isLocked)
        XCTAssertFalse(session.isInWaitingRoomFlow)
    }

    func testLegacyWaitingRoomCannotOverrideTeacherLock() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient, isLocked: true, waitingRoomEnabled: true, waitingRoomUnlocked: false)

        hubClient.onWaitingRoomStateChanged?(WaitingRoomStateChanged(waitingRoomEnabled: false, waitingRoomUnlocked: false))

        XCTAssertTrue(session.isLocked)
        XCTAssertFalse(session.isInWaitingRoomFlow)
        XCTAssertFalse(session.waitingRoomEnabled)
    }

    func testQuestionChangeResetsAnsweredState() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient)
        session.hasAnswered = true

        hubClient.onQuestionChanged?(QuestionChanged(question: "What is 2 + 2?"))

        XCTAssertEqual(session.currentQuestion, "What is 2 + 2?")
        XCTAssertFalse(session.hasAnswered)
    }

    func testAnsweredFailureRollsBackState() async {
        let hubClient = FakeHubClient()
        hubClient.setAnsweredError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.setAnswered(true)

        XCTAssertFalse(session.hasAnswered)
        XCTAssertEqual(session.statusMessage, "Could not update answered state.")
    }

    func testConfidenceFailureRollsBackState() async {
        let hubClient = FakeHubClient()
        hubClient.setConfidenceError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.setConfidence(.green)

        XCTAssertEqual(session.confidenceLevel, .none)
        XCTAssertEqual(session.statusMessage, "Could not update confidence.")
    }

    func testKickedStopsHubClientAndMarksSessionKicked() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient)

        hubClient.onKicked?()

        XCTAssertTrue(session.wasKicked)
        XCTAssertTrue(hubClient.didStop)
    }

    func testBoardClearedForCurrentStudentIncrementsClearRevision() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient)

        hubClient.onBoardCleared?(BoardCleared(studentId: "student-1"))

        XCTAssertEqual(session.boardClearRevision, 1)
    }

    func testBoardClearedForDifferentStudentIsIgnored() {
        let hubClient = FakeHubClient()
        let session = makeSession(hubClient: hubClient)

        hubClient.onBoardCleared?(BoardCleared(studentId: "student-2"))

        XCTAssertEqual(session.boardClearRevision, 0)
    }

    func testSendStrokeBatchFailureSetsStatusMessage() async {
        let hubClient = FakeHubClient()
        hubClient.sendStrokeBatchError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.sendStrokeBatch(StrokeBatch(
            studentId: "student-1",
            strokeId: "stroke-1",
            points: [StrokePoint(x: 0.1, y: 0.2)],
            isComplete: false
        ))

        XCTAssertEqual(session.statusMessage, "Could not send drawing to the teacher.")
    }

    func testSendShapeFailureSetsStatusMessage() async {
        let hubClient = FakeHubClient()
        hubClient.sendShapeError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.sendShape(WhiteboardShape(
            shapeId: "shape-1",
            studentId: "student-1",
            type: .line,
            points: [StrokePoint(x: 0.1, y: 0.2), StrokePoint(x: 0.5, y: 0.6)],
            color: "#000000",
            lineWidth: 4,
            backgroundType: .none,
            paperColor: .white,
            isComplete: true
        ))

        XCTAssertEqual(session.statusMessage, "Could not send shape to the teacher.")
    }

    func testUndoStrokeFailureSetsStatusMessage() async {
        let hubClient = FakeHubClient()
        hubClient.undoStrokeError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.undoStroke("stroke-1")

        XCTAssertEqual(session.statusMessage, "Could not undo on the teacher view.")
    }

    func testClearBoardFailureSetsStatusMessage() async {
        let hubClient = FakeHubClient()
        hubClient.clearBoardError = WhitePadError.connectionFailed("offline")
        let session = makeSession(hubClient: hubClient)

        await session.clearBoard()

        XCTAssertEqual(session.statusMessage, "Could not clear the teacher view.")
    }

    func testTeacherClearRestoresDrawingAfterCapacityLimit() async {
        let client = FakeHubClient()
        let session = makeSession(hubClient:client)
        session.drawingCapacityReached = true
        client.onBoardCleared?(BoardCleared(studentId:"student-1"))
        XCTAssertFalse(session.drawingCapacityReached)
        XCTAssertEqual(session.boardClearRevision,1)
    }

    private func makeSession(
        hubClient: FakeHubClient = FakeHubClient(),
        isLocked: Bool = false,
        waitingRoomEnabled: Bool = false,
        waitingRoomUnlocked: Bool = false,
        currentQuestion: String? = nil
    ) -> StudentRoomSession {
        StudentRoomSession(
            studentId: "student-1",
            displayName: "Oliver",
            joinLink: JoinLink(
                serverBaseURL: URL(string: "http://localhost:5173")!,
                roomId: "room-1",
                joinToken: "TOKEN",
                sourceURL: URL(string: "http://localhost:5173/join?roomId=room-1&token=TOKEN")!
            ),
            isLocked: isLocked,
            waitingRoomEnabled: waitingRoomEnabled,
            waitingRoomUnlocked: waitingRoomUnlocked,
            currentQuestion: currentQuestion,
            hubClient: hubClient
        )
    }
}

@MainActor
private final class FakeHubClient: ClassroomClientProtocol {
    var onStudentLocked: ((StudentLocked) -> Void)?
    var onWaitingRoomStateChanged: ((WaitingRoomStateChanged) -> Void)?
    var onQuestionChanged: ((QuestionChanged) -> Void)?
    var onBoardCleared: ((BoardCleared) -> Void)?
    var onKicked: (() -> Void)?

    var didStop = false
    var setAnsweredError: Error?
    var setConfidenceError: Error?
    var sendStrokeBatchError: Error?
    var sendShapeError: Error?
    var undoStrokeError: Error?
    var clearBoardError: Error?

    func startListening() {}

    func joinFromWaitingRoom() async throws {}

    func setAnswered(_ hasAnswered: Bool) async throws {
        if let setAnsweredError {
            throw setAnsweredError
        }
    }

    func setConfidence(_ confidenceLevel: String) async throws {
        if let setConfidenceError {
            throw setConfidenceError
        }
    }

    func sendStrokeBatch(_ batch: StrokeBatch) async throws {
        if let sendStrokeBatchError {
            throw sendStrokeBatchError
        }
    }

    func sendShape(_ shape: WhiteboardShape) async throws {
        if let sendShapeError {
            throw sendShapeError
        }
    }

    func undoStroke(_ strokeId: String) async throws {
        if let undoStrokeError {
            throw undoStrokeError
        }
    }

    func clearBoard() async throws {
        if let clearBoardError {
            throw clearBoardError
        }
    }

    func stop() {
        didStop = true
    }
}
