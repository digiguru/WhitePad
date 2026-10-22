import CoreGraphics
import Foundation

struct DrawingStrokeRecorder {
    let studentId: String
    let color: String
    let lineWidth: Double
    let backgroundType: BackgroundType
    let paperColor: PaperColor
    let isEraser: Bool
    let batchInterval: TimeInterval

    private(set) var activeStrokeId: String?
    private(set) var activePoints: [StrokePoint] = []
    private var lastSentPointIndex = 0
    private var lastBatchSentAt = Date.distantPast

    init(
        studentId: String,
        color: String = "#000000",
        lineWidth: Double = 4,
        backgroundType: BackgroundType = .none,
        paperColor: PaperColor = .white,
        isEraser: Bool = false,
        batchInterval: TimeInterval = 0.1
    ) {
        self.studentId = studentId
        self.color = color
        self.lineWidth = lineWidth
        self.backgroundType = backgroundType
        self.paperColor = paperColor
        self.isEraser = isEraser
        self.batchInterval = batchInterval
    }

    mutating func appendPoint(
        at location: CGPoint,
        canvasSize: CGSize,
        isComplete: Bool,
        now: Date = Date(),
        makeStrokeId: () -> String = { UUID().uuidString }
    ) -> StrokeBatch? {
        if activeStrokeId == nil {
            activeStrokeId = "\(studentId)-\(makeStrokeId())"
            activePoints = []
            lastSentPointIndex = 0
            lastBatchSentAt = .distantPast
        }

        let point = Self.normalize(location, canvasSize: canvasSize)
        if activePoints.last == point {
            return isComplete ? makePendingBatch(isComplete: true, now: now) : nil
        }

        activePoints.append(point)

        if isComplete || now.timeIntervalSince(lastBatchSentAt) >= batchInterval {
            return makePendingBatch(isComplete: isComplete, now: now)
        }

        return nil
    }

    mutating func finishStroke() -> DrawingStroke? {
        defer { reset() }

        guard let activeStrokeId, !activePoints.isEmpty else {
            return nil
        }

        return DrawingStroke(
            id: activeStrokeId,
            points: activePoints,
            color: color,
            lineWidth: lineWidth,
            paperColor: paperColor,
            isEraser: isEraser
        )
    }

    mutating func reset() {
        activeStrokeId = nil
        activePoints = []
        lastSentPointIndex = 0
        lastBatchSentAt = .distantPast
    }

    static func normalize(_ point: CGPoint, canvasSize: CGSize) -> StrokePoint {
        guard canvasSize.width > 0, canvasSize.height > 0 else {
            return StrokePoint(x: 0, y: 0)
        }

        return StrokePoint(
            x: clamped(Double(point.x / canvasSize.width), lowerBound: 0, upperBound: 1),
            y: clamped(Double(point.y / canvasSize.height), lowerBound: 0, upperBound: 1)
        )
    }

    private mutating func makePendingBatch(isComplete: Bool, now: Date) -> StrokeBatch? {
        guard let activeStrokeId else { return nil }

        let pendingPoints = Array(activePoints.dropFirst(lastSentPointIndex))
        guard !pendingPoints.isEmpty || isComplete else { return nil }

        lastSentPointIndex = activePoints.count
        lastBatchSentAt = now

        return StrokeBatch(
            studentId: studentId,
            strokeId: activeStrokeId,
            points: pendingPoints,
            color: isEraser ? "__WHITEPAD_ERASER__" : color,
            lineWidth: isEraser ? -lineWidth : lineWidth,
            backgroundType: backgroundType.rawValue,
            paperColor: paperColor.rawValue,
            isEraser: isEraser,
            isComplete: isComplete
        )
    }

    private static func clamped(_ value: Double, lowerBound: Double, upperBound: Double) -> Double {
        min(max(value, lowerBound), upperBound)
    }
}
