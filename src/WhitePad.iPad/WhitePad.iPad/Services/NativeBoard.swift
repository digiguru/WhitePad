import Foundation
import JavaScriptCore

// Executes the exact web protocol validator/reducer, bundled at build time. No remote code.
final class NativeBoard {
    private let context: JSContext
    private var value: JSValue
    private var api: JSValue
    var seq: Int { Int(value.forProperty("seq").toDouble()) }
    var epoch: Int { Int(value.forProperty("epoch").toDouble()) }
    var operations: [[String: Any]] { value.forProperty("operations").toArray() as? [[String: Any]] ?? [] }
    var json: [String: Any] { value.toDictionary() as? [String: Any] ?? [:] }

    init(source: String) throws {
        guard let context = JSContext() else { throw WhitePadError.connectionFailed("Protocol engine unavailable") }
        self.context = context
        context.evaluateScript(source)
        guard let api = context.objectForKeyedSubscript("WhitePadProtocol"), !api.isUndefined,
              let board = api.forProperty("emptyBoard")?.call(withArguments: []) else {
            throw WhitePadError.connectionFailed("Protocol bundle unavailable")
        }
        self.api = api; self.value = board
    }
    convenience init() throws {
        guard let url = Bundle.main.url(forResource: "whitepad-protocol", withExtension: "js") else {
            throw WhitePadError.connectionFailed("Protocol resource missing")
        }
        try self.init(source: String(contentsOf: url, encoding: .utf8))
    }
    func validSnapshot(_ board: [String:Any]) -> Bool { call("validateBoard", [board])?.toBool() == true }
    func replace(_ board: [String: Any]) throws {
        guard validSnapshot(board) else { throw WhitePadError.connectionFailed("Invalid saved board") }
        value = JSValue(object: board, in: context)
    }
    func reset() { value = call("emptyBoard", [])! }
    func rewind(to head: Int, beforeClear: [String: Any]?) throws {
        guard let result = call("rewindBoard", [value as Any, head, beforeClear as Any? ?? NSNull()]),
              !result.isUndefined else { throw WhitePadError.connectionFailed("Recovery failed") }
        value = result
    }
    @discardableResult func commit(_ body: [String: Any]) throws -> [String: Any] {
        let op: [String: Any] = ["v":1,"opId":UUID().uuidString,"seq":seq+1,
            "epoch":epoch + ((body["type"] as? String) == "clear" ? 1 : 0),"body":body]
        guard call("apply", [value as Any, op])?.toString() == "applied" else {
            throw WhitePadError.connectionFailed("Board limit or invalid drawing operation")
        }
        return op
    }
    func hasObject(_ id: String) -> Bool {
        operations.contains { let b = $0["body"] as? [String: Any]; return b?["id"] as? String == id && ["start","shape"].contains(b?["type"] as? String ?? "") }
    }
    func encoded(_ points: [StrokePoint]) throws -> [[Int]] {
        let data = try JSONEncoder().encode(points)
        let array = try JSONSerialization.jsonObject(with: data)
        guard let result = call("encodePoints", [array])?.toArray() as? [[Int]] else {
            throw WhitePadError.connectionFailed("Invalid coordinates")
        }
        return result
    }
    private func call(_ name: String, _ args: [Any]) -> JSValue? {
        context.exception = nil
        let result = api.forProperty(name)?.call(withArguments: args)
        return context.exception == nil ? result : nil
    }
}

struct NativeBoardViewState {
    var strokes: [DrawingStroke] = []
    var shapes: [WhiteboardShape] = []
    var order: [String] = []
    var hiddenStrokes: [DrawingStroke] = []
    var hiddenShapes: [WhiteboardShape] = []
    var undoneOrder: [String] = []
    var background = BackgroundType.none
    var paper = PaperColor.white
    var confidence = ConfidenceLevel.none
    var answered = false
    init(board: NativeBoard, studentId: String) {
        var hidden = Set<String>()
        for op in board.operations {
            guard let b = op["body"] as? [String: Any], let type = b["type"] as? String else { continue }
            let id = b["id"] as? String ?? ""
            let style = b["style"] as? [String: Any] ?? [:]
            let points = (b["points"] as? [[Int]] ?? []).map { StrokePoint(x:Double($0[0])/65535,y:Double($0[1])/65535,pressure:Double($0[2])/255) }
            switch type {
            case "start":
                strokes.append(DrawingStroke(id:id,points:[],color:style["color"] as? String ?? "#000000",lineWidth:style["width"] as? Double ?? 4,paperColor:paper,isEraser:style["eraser"] as? Bool ?? false)); order.append(id)
            case "points": if let i = strokes.firstIndex(where:{$0.id == id}) { strokes[i].points += points }
            case "shape":
                if let kind = DrawingTool(rawValue:b["shape"] as? String ?? "") {
                    shapes.append(WhiteboardShape(shapeId:id,studentId:studentId,type:kind,points:points,color:style["color"] as? String ?? "#000000",lineWidth:style["width"] as? Double ?? 4,backgroundType:background,paperColor:paper,isComplete:true)); order.append(id)
                }
            case "undo": hidden.insert(id); undoneOrder.removeAll{$0 == id}; undoneOrder.append(id)
            case "redo": hidden.remove(id); undoneOrder.removeAll{$0 == id}
            case "background": background = BackgroundType(rawValue:b["pattern"] as? String ?? "") ?? .none; paper = PaperColor(rawValue:b["paper"] as? String ?? "") ?? .white
            case "confidence": confidence = ConfidenceLevel(rawValue:b["value"] as? String ?? "") ?? .none
            case "answered": answered = b["value"] as? Bool ?? false
            default: break
            }
        }
        hiddenStrokes = strokes.filter{hidden.contains($0.id)}; hiddenShapes = shapes.filter{hidden.contains($0.id)}
        strokes.removeAll{hidden.contains($0.id)}; shapes.removeAll{hidden.contains($0.id)}; order.removeAll{hidden.contains($0)}
    }
}
