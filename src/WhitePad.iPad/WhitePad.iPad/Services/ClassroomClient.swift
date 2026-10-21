import Foundation

@MainActor
protocol ClassroomClientProtocol: AnyObject {
    var onStudentLocked: ((StudentLocked) -> Void)? { get set }
    var onWaitingRoomStateChanged: ((WaitingRoomStateChanged) -> Void)? { get set }
    var onQuestionChanged: ((QuestionChanged) -> Void)? { get set }
    var onBoardCleared: ((BoardCleared) -> Void)? { get set }
    var onKicked: (() -> Void)? { get set }
    var onBoardRecovered: ((NativeBoardViewState) -> Void)? { get set }
    var onStatus: ((String) -> Void)? { get set }
    func refreshConnection()
    func startListening()
    func joinFromWaitingRoom() async throws
    func setAnswered(_ hasAnswered: Bool) async throws
    func setConfidence(_ confidenceLevel: String) async throws
    func sendStrokeBatch(_ batch: StrokeBatch) async throws
    func sendShape(_ shape: WhiteboardShape) async throws
    func undoStroke(_ strokeId: String) async throws
    func redoStroke(_ strokeId: String) async throws
    func clearBoard() async throws
    func stop()
}
extension ClassroomClientProtocol {
    func refreshConnection() {}
    var onBoardRecovered: ((NativeBoardViewState) -> Void)? { get { nil } set {} }
    var onStatus: ((String) -> Void)? { get { nil } set {} }
    func redoStroke(_ strokeId: String) async throws { throw WhitePadError.connectionFailed("Redo unavailable") }
}
