import Foundation
@main struct VerifyNativeBoard {
    static func main() throws {
        let source = try String(contentsOfFile: CommandLine.arguments[1],encoding:.utf8)
        let board = try NativeBoard(source:source)
        let style: [String:Any] = ["color":"#123456","width":4,"eraser":false]
        try board.commit(["type":"start","id":"s1","style":style])
        let points = try board.encoded([StrokePoint(x:0.25,y:0.5,pressure:0.75),StrokePoint(x:1,y:1)])
        precondition(points[0] == [16384,32768,191])
        try board.commit(["type":"points","id":"s1","points":points])
        try board.commit(["type":"end","id":"s1"])
        try board.commit(["type":"undo","id":"s1"])
        precondition(NativeBoardViewState(board:board,studentId:"student").strokes.isEmpty)
        try board.commit(["type":"redo","id":"s1"])
        precondition(NativeBoardViewState(board:board,studentId:"student").strokes.first?.points.count == 2)
        let saved = board.json
        try board.commit(["type":"clear"])
        precondition(board.epoch == 1 && board.operations.count == 1)
        try board.rewind(to:5,beforeClear:saved)
        precondition(board.seq == 5 && board.epoch == 0)
        let restored = try NativeBoard(source:source); try restored.replace(board.json)
        precondition(restored.seq == 5)
        var invalid = board.json; invalid["seq"] = 99
        do { try restored.replace(invalid); fatalError("Accepted invalid snapshot") } catch {}
        do { try board.commit(["type":"points","id":"unknown","points":points]); fatalError("Accepted unknown object") } catch {}
        precondition(board.seq == 5)
        try board.commit(["type":"background","pattern":"squares","paper":"buff"])
        try board.commit(["type":"confidence","value":"amber"])
        try board.commit(["type":"answered","value":true])
        let view = NativeBoardViewState(board:board,studentId:"student")
        precondition(view.background == .squares && view.paper == .buff && view.confidence == .amber && view.answered)
        let bounded = try NativeBoard(source:source)
        for _ in 0..<20000 { try bounded.commit(["type":"confidence","value":"green"]) }
        do { try bounded.commit(["type":"confidence","value":"green"]); fatalError("Accepted oversized history") }
        catch NativeBoardFailure.capacity {}
        precondition(bounded.seq == 20000 && bounded.operations.count == 20000)
        try bounded.commit(["type":"clear"])
        precondition(bounded.operations.count == 1)
        print("Native shared-protocol quantisation, undo/redo, clear, rewind, snapshot validation and indicators passed")
    }
}
