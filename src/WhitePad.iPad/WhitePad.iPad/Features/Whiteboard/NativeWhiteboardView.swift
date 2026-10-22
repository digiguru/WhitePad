import SwiftUI

struct NativeWhiteboardView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var session: StudentRoomSession
    let onLeave: () -> Void

    private let colors = ["#000000", "#E11D48", "#F59E0B", "#22C55E", "#2563EB", "#7C3AED"]
    private let thicknesses = [2.0, 4.0, 6.0, 8.0, 10.0]

    @State private var currentTool: DrawingTool = .pen
    @State private var currentColor = "#000000"
    @State private var currentThickness = 4.0
    @State private var currentBackground: BackgroundType = .none
    @State private var currentPaperColor: PaperColor = .white

    @State private var strokes: [DrawingStroke] = []
    @State private var shapes: [WhiteboardShape] = []
    @State private var drawOrder: [String] = []
    @State private var undoneItems: [WhiteboardHistoryItem] = []
    @State private var recorder: DrawingStrokeRecorder?
    @State private var shapeDraft: WhiteboardShape?
    @State private var isToolPanelOpen = false
    @State private var isConfidencePanelOpen = false
    @State private var isClearConfirmationVisible = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                canvas

                if session.isLocked {
                    lockedOverlay
                }

                toolOverlay(screenSize: geometry.size)
                classroomOverlay
                bottomControlsOverlay
            }
        }
        .onAppear { restoreBoard() }
        .onChange(of: scenePhase) { _, _ in session.refreshConnection() }
        .onChange(of: session.recoveryRevision) { _, _ in restoreBoard() }
        .onChange(of: session.drawingCapacityReached) { _, full in
            if full { recorder?.reset(); recorder = nil; shapeDraft = nil }
        }
        .onChange(of: session.isLocked) { _, locked in
            if locked { recorder?.reset(); recorder = nil; shapeDraft = nil }
        }
        .onChange(of: session.boardClearRevision) { _, _ in
            clearLocalBoard()
        }
        .onChange(of: currentBackground) { _, _ in
            sendBackgroundUpdate()
        }
        .onChange(of: currentPaperColor) { _, _ in
            sendBackgroundUpdate()
        }
        .alert("Clear your board?", isPresented: $isClearConfirmationVisible) {
            Button("Cancel", role: .cancel) { }
            Button("Clear", role: .destructive) {
                clearBoard()
            }
        } message: {
            Text("This removes your drawing from your iPad and the teacher view.")
        }
    }

    private var classroomOverlay: some View {
        VStack {
            if let status = session.statusMessage {
                Text(status)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .accessibilityIdentifier("classroom-connection-status")
            }
            if let currentQuestion = session.currentQuestion, !currentQuestion.isEmpty {
                questionBanner(currentQuestion)
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.spring(response: 0.28, dampingFraction: 0.9), value: session.currentQuestion)
    }

    private func questionBanner(_ question: String) -> some View {
        HStack(spacing: 12) {
            Text(question)
                .font(.headline)
                .lineLimit(2)

            Button {
                Task {
                    await session.setAnswered(!session.hasAnswered)
                }
            } label: {
                Label(
                    session.hasAnswered ? "Answered" : "Answer",
                    systemImage: session.hasAnswered ? "checkmark.circle.fill" : "circle"
                )
            }
            .buttonStyle(.bordered)
            .disabled(session.isLocked)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .floatingGlassSurface(cornerRadius: 20)
    }

    private func toolOverlay(screenSize: CGSize) -> some View {
        let panelWidth = min(390, max(320, screenSize.width * 0.38))
        let panelHeight = min(screenSize.height - 32, 620)

        return ZStack(alignment: .topLeading) {
            HStack(spacing: 12) {
                toolToggleButton

                if isToolPanelOpen {
                    toolbar
                        .frame(width: panelWidth, height: panelHeight)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }

                Spacer(minLength: 0)
            }
            .padding(.leading, 12)
            .padding(.top, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: isToolPanelOpen)
    }

    private var bottomControlsOverlay: some View {
        VStack {
            Spacer()

            HStack {
                Spacer()

                VStack(alignment: .trailing, spacing: 12) {
                    if isConfidencePanelOpen {
                        confidencePanel
                            .transition(.scale(scale: 0.92, anchor: .bottomTrailing).combined(with: .opacity))
                    }

                    HStack(spacing: 12) {
                        moreMenuButton
                        clearBoardButton
                        confidenceToggleButton
                    }
                }
                .padding(.trailing, 16)
                .padding(.bottom, 16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: isConfidencePanelOpen)
    }

    private var moreMenuButton: some View {
        Menu {
            Button("Leave And Join Another Room") {
                onLeave()
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 58, height: 58)
                .contentShape(Circle())
                .accessibilityLabel("More options")
        }
        .buttonStyle(.plain)
        .floatingGlassSurface(cornerRadius: 29, interactive: true)
    }

    private var clearBoardButton: some View {
        Button {
            isClearConfirmationVisible = true
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.red)
                .frame(width: 58, height: 58)
                .contentShape(Circle())
                .accessibilityLabel("Clear board")
        }
        .buttonStyle(.plain)
        .floatingGlassSurface(cornerRadius: 29, interactive: true)
        .disabled(session.isLocked || drawOrder.isEmpty)
    }

    private var confidenceToggleButton: some View {
        Button {
            isConfidencePanelOpen.toggle()
        } label: {
            Circle()
                .fill(session.confidenceLevel.displayColor)
                .frame(width: 58, height: 58)
                .overlay {
                    Circle()
                        .stroke(.white.opacity(0.85), lineWidth: 3)
                }
                .overlay {
                    if session.confidenceLevel == .none {
                        Image(systemName: "questionmark")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .accessibilityLabel("Set confidence")
        }
        .buttonStyle(.plain)
        .floatingGlassSurface(cornerRadius: 29, interactive: true)
        .disabled(session.isLocked)
    }

    private var confidencePanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How are you feeling?")
                .font(.headline)

            ForEach(ConfidenceLevel.allCases) { level in
                Button {
                    selectConfidence(level)
                } label: {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(level.displayColor)
                            .frame(width: 24, height: 24)
                            .overlay {
                                Circle()
                                    .stroke(.white.opacity(0.85), lineWidth: level == .none ? 0 : 2)
                            }

                        Text(level.label)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)

                        Spacer()

                        if session.confidenceLevel == level {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.blue)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(session.confidenceLevel == level ? Color.blue.opacity(0.16) : Color.secondary.opacity(0.08))
                    )
                }
                .buttonStyle(.plain)
                .disabled(session.isLocked)
            }
        }
        .padding(14)
        .frame(width: 250)
        .floatingGlassSurface(cornerRadius: 24)
    }

    private var toolToggleButton: some View {
        Button {
            isToolPanelOpen.toggle()
        } label: {
            Image(systemName: isToolPanelOpen ? "xmark" : currentTool.symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 58, height: 58)
                .contentShape(Circle())
                .accessibilityLabel(isToolPanelOpen ? "Close tools" : "Open tools")
        }
        .buttonStyle(.plain)
        .floatingGlassSurface(cornerRadius: 29, interactive: true)
        .disabled(session.isLocked)
    }

    private func selectConfidence(_ level: ConfidenceLevel) {
        isConfidencePanelOpen = false

        Task {
            await session.setConfidence(level)
        }
    }

    private var toolbar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                toolPicker
                backgroundPicker
                paperPicker
                colorPicker
                thicknessPicker
                actionButtons
            }
            .padding(18)
        }
        .scrollIndicators(.hidden)
        .floatingGlassSurface(cornerRadius: 28)
    }

    private var toolPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Draw")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(DrawingTool.allCases) { tool in
                    toolButton(tool)
                }
            }
        }
    }

    private func toolButton(_ tool: DrawingTool) -> some View {
        Button {
            currentTool = tool
        } label: {
            VStack(spacing: 6) {
                Image(systemName: tool.symbol)
                    .font(.system(size: 22, weight: .semibold))
                    .frame(height: 24)
                Text(tool.label)
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(currentTool == tool ? .white : .primary)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(currentTool == tool ? Color.blue : Color.secondary.opacity(0.10))
            )
        }
        .buttonStyle(.plain)
        .disabled(session.isLocked)
    }

    private var backgroundPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Paper style")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                ForEach(BackgroundType.allCases) { background in
                    Button {
                        currentBackground = background
                    } label: {
                        Text(background.label)
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 14)
                                    .fill(currentBackground == background ? Color.blue.opacity(0.18) : Color.secondary.opacity(0.10))
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isLocked)
                }
            }
        }
    }

    private var paperPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Paper colour")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                ForEach(PaperColor.allCases) { paperColor in
                    Button {
                        currentPaperColor = paperColor
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(Color(hex: paperColor.hex))
                                .frame(width: 18, height: 18)
                                .overlay(Circle().stroke(.quaternary, lineWidth: 1))
                            Text(paperColor.label)
                                .font(.subheadline.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(currentPaperColor == paperColor ? Color.blue.opacity(0.18) : Color.secondary.opacity(0.10))
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isLocked)
                }
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    undoLastItem()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(session.isLocked || drawOrder.isEmpty)

                Button {
                    redoLastItem()
                } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(session.isLocked || undoneItems.isEmpty)
            }

            Button(role: .destructive) {
                isClearConfirmationVisible = true
            } label: {
                Label("Clear", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(session.isLocked || drawOrder.isEmpty)
        }
    }

    private var colorPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Colour")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 6), spacing: 12) {
                ForEach(colors, id: \.self) { color in
                    Button {
                        currentColor = color
                        if currentTool == .eraser {
                            currentTool = .pen
                        }
                    } label: {
                        Circle()
                            .fill(Color(hex: color))
                            .frame(width: 38, height: 38)
                            .overlay {
                                Circle()
                                    .stroke(currentColor == color ? .blue : .clear, lineWidth: 5)
                            }
                            .overlay {
                                Circle()
                                    .stroke(.white.opacity(0.85), lineWidth: currentColor == color ? 2 : 0)
                            }
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isLocked)
                }
            }
        }
    }

    private var thicknessPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Size")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                ForEach(thicknesses, id: \.self) { thickness in
                    Button {
                        currentThickness = thickness
                    } label: {
                        Circle()
                            .fill(.primary)
                            .frame(width: thickness * 2, height: thickness * 2)
                            .frame(maxWidth: .infinity, minHeight: 42)
                            .background(
                                Capsule()
                                    .fill(currentThickness == thickness ? Color.blue.opacity(0.18) : Color.secondary.opacity(0.10))
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isLocked)
                }
            }
        }
    }

    private var canvas: some View {
        Canvas { context, size in
            drawBackground(in: &context, size: size)

            for id in drawOrder {
                if let stroke = strokes.first(where: { $0.id == id }) {
                    draw(stroke: stroke, in: &context, size: size)
                } else if let shape = shapes.first(where: { $0.shapeId == id }) {
                    draw(shape: shape, in: &context, size: size)
                }
            }

            if let recorder, let activeStrokeId = recorder.activeStrokeId, !recorder.activePoints.isEmpty {
                draw(
                    stroke: DrawingStroke(
                        id: activeStrokeId,
                        points: recorder.activePoints,
                        color: recorder.color,
                        lineWidth: recorder.lineWidth,
                        paperColor: currentPaperColor,
                        isEraser: recorder.isEraser
                    ),
                    in: &context,
                    size: size
                )
            }

            if let shapeDraft {
                draw(shape: shapeDraft, in: &context, size: size, isPreview: true)
            }
        }
        .overlay {
            GeometryReader { canvasGeometry in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(drawingGesture(canvasSize: canvasGeometry.size))
                    .allowsHitTesting(!session.isLocked)
            }
        }
    }

    private func drawingGesture(canvasSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                guard !session.isLocked, !session.drawingCapacityReached else { return }
                if currentTool.isShape {
                    updateShapeDraft(start: value.startLocation, end: value.location, canvasSize: canvasSize)
                } else {
                    appendPoint(at: value.location, canvasSize: canvasSize, isComplete: false)
                }
            }
            .onEnded { value in
                guard !session.isLocked, !session.drawingCapacityReached else { return }
                if currentTool.isShape {
                    completeShape(start: value.startLocation, end: value.location, canvasSize: canvasSize)
                } else {
                    appendPoint(at: value.location, canvasSize: canvasSize, isComplete: true)
                    finishStroke()
                }
            }
    }

    private var lockedOverlay: some View {
        VStack {
            Spacer()

            HStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.headline)
                Text(session.statusMessage?.hasPrefix("Connected") == true ? "Drawing is locked by your teacher" : "Drawing is paused")
                    .font(.headline.weight(.semibold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private func appendPoint(at location: CGPoint, canvasSize: CGSize, isComplete: Bool) {
        if recorder == nil {
            recorder = DrawingStrokeRecorder(
                studentId: session.studentId,
                color: currentColor,
                lineWidth: currentThickness,
                backgroundType: currentBackground,
                paperColor: currentPaperColor,
                isEraser: currentTool == .eraser
            )
        }

        if let batch = recorder?.appendPoint(at: location, canvasSize: canvasSize, isComplete: isComplete) {
            send(batch)
        }
    }

    private func finishStroke() {
        guard let stroke = recorder?.finishStroke() else {
            recorder = nil
            return
        }

        strokes.append(stroke)
        drawOrder.append(stroke.id)
        undoneItems = []
        recorder = nil
    }

    private func updateShapeDraft(start: CGPoint, end: CGPoint, canvasSize: CGSize) {
        let points = normalizedShapePoints(start: start, end: end, canvasSize: canvasSize)
        guard !points.isEmpty else { return }

        let shapeId = shapeDraft?.shapeId ?? "\(session.studentId)-shape-\(UUID().uuidString)"
        shapeDraft = WhiteboardShape(
            shapeId: shapeId,
            studentId: session.studentId,
            type: currentTool,
            points: points,
            color: currentColor,
            lineWidth: currentThickness,
            backgroundType: currentBackground,
            paperColor: currentPaperColor,
            isComplete: false
        )
    }

    private func completeShape(start: CGPoint, end: CGPoint, canvasSize: CGSize) {
        updateShapeDraft(start: start, end: end, canvasSize: canvasSize)
        guard let draft = shapeDraft else { return }

        let shape = WhiteboardShape(
            shapeId: draft.shapeId,
            studentId: draft.studentId,
            type: draft.type,
            points: draft.points,
            color: draft.color,
            lineWidth: draft.lineWidth,
            backgroundType: draft.backgroundType,
            paperColor: draft.paperColor,
            isComplete: true
        )

        shapes.append(shape)
        drawOrder.append(shape.shapeId)
        undoneItems = []
        shapeDraft = nil

        Task {
            await session.sendShape(shape)
        }
    }

    private func normalizedShapePoints(start: CGPoint, end: CGPoint, canvasSize: CGSize) -> [StrokePoint] {
        let startPoint = DrawingStrokeRecorder.normalize(start, canvasSize: canvasSize)
        let endPoint = DrawingStrokeRecorder.normalize(end, canvasSize: canvasSize)

        if currentTool == .axesL || currentTool == .axesCross {
            if startPoint == endPoint {
                let extent = StrokePoint(
                    x: min(startPoint.x + 0.25, 1),
                    y: max(startPoint.y - 0.25, 0)
                )
                return [startPoint, extent]
            }
        }

        return [startPoint, endPoint]
    }

    private func undoLastItem() {
        guard let id = drawOrder.popLast() else { return }

        if let strokeIndex = strokes.firstIndex(where: { $0.id == id }) {
            let stroke = strokes.remove(at: strokeIndex)
            undoneItems.append(.stroke(stroke))
        } else if let shapeIndex = shapes.firstIndex(where: { $0.shapeId == id }) {
            let shape = shapes.remove(at: shapeIndex)
            undoneItems.append(.shape(shape))
        }

        Task {
            await session.undoStroke(id)
        }
    }

    private func redoLastItem() {
        guard let item = undoneItems.popLast() else { return }

        switch item {
        case .stroke(let stroke):
            strokes.append(stroke)
            drawOrder.append(stroke.id)
            Task { await session.redoStroke(stroke.id) }
        case .shape(let shape):
            shapes.append(shape)
            drawOrder.append(shape.shapeId)
            Task {
                await session.redoStroke(shape.shapeId)
            }
        }
    }

    private func clearBoard() {
        clearLocalBoard()

        Task {
            await session.clearBoard()
        }
    }

    private func restoreBoard() {
        guard let board = session.recoveredBoard else { return }
        strokes = board.strokes; shapes = board.shapes; drawOrder = board.order
        currentBackground = board.background; currentPaperColor = board.paper
        undoneItems = board.undoneOrder.compactMap { id in
            if let stroke = board.hiddenStrokes.first(where:{$0.id == id}) { return .stroke(stroke) }
            if let shape = board.hiddenShapes.first(where:{$0.id == id}) { return .shape(shape) }
            return nil
        }
        recorder?.reset(); recorder = nil; shapeDraft = nil
    }
    private func clearLocalBoard() {
        strokes = []
        shapes = []
        drawOrder = []
        undoneItems = []
        recorder?.reset()
        recorder = nil
        shapeDraft = nil
    }

    private func sendBackgroundUpdate() {
        guard !session.isLocked, !session.drawingCapacityReached else { return }

        let batch = StrokeBatch(
            studentId: session.studentId,
            strokeId: "\(session.studentId)-background-\(UUID().uuidString)",
            points: [],
            color: currentPaperColor.hex,
            lineWidth: 0,
            backgroundType: currentBackground.rawValue,
            paperColor: currentPaperColor.rawValue,
            isEraser: false,
            isComplete: true
        )

        send(batch)
    }

    private func resend(_ stroke: DrawingStroke) {
        let batch = StrokeBatch(
            studentId: session.studentId,
            strokeId: stroke.id,
            points: stroke.points,
            color: stroke.isEraser ? "__WHITEPAD_ERASER__" : stroke.color,
            lineWidth: stroke.isEraser ? -stroke.lineWidth : stroke.lineWidth,
            backgroundType: currentBackground.rawValue,
            paperColor: stroke.paperColor.rawValue,
            isEraser: stroke.isEraser,
            isComplete: true
        )

        send(batch)
    }

    private func send(_ batch: StrokeBatch) {
        Task {
            await session.sendStrokeBatch(batch)
        }
    }

    private func drawBackground(in context: inout GraphicsContext, size: CGSize) {
        let paperRect = CGRect(origin: .zero, size: size)
        context.fill(Path(paperRect), with: .color(Color(hex: currentPaperColor.hex)))

        guard currentBackground != .none else { return }

        var path = Path()
        let spacing = 35.0

        switch currentBackground {
        case .none:
            return
        case .dotted:
            var x = spacing
            while x < size.width {
                var y = spacing
                while y < size.height {
                    context.fill(
                        Path(ellipseIn: CGRect(x: x - 1.25, y: y - 1.25, width: 2.5, height: 2.5)),
                        with: .color(.gray.opacity(0.35))
                    )
                    y += spacing
                }
                x += spacing
            }
        case .lined:
            var y = spacing
            while y < size.height {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                y += spacing
            }
        case .squares:
            var x = spacing
            while x < size.width {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
                x += spacing
            }
            var y = spacing
            while y < size.height {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                y += spacing
            }
        }

        context.stroke(path, with: .color(.gray.opacity(0.28)), lineWidth: 0.7)
    }

    private func draw(stroke: DrawingStroke, in context: inout GraphicsContext, size: CGSize) {
        guard let firstPoint = stroke.points.first else { return }

        var path = Path()
        path.move(to: denormalize(firstPoint, size: size))

        for point in stroke.points.dropFirst() {
            path.addLine(to: denormalize(point, size: size))
        }

        context.stroke(
            path,
            with: .color(stroke.isEraser ? Color(hex: stroke.paperColor.hex) : Color(hex: stroke.color)),
            style: StrokeStyle(lineWidth: abs(stroke.lineWidth), lineCap: .round, lineJoin: .round)
        )
    }

    private func draw(shape: WhiteboardShape, in context: inout GraphicsContext, size: CGSize, isPreview: Bool = false) {
        guard shape.points.count >= 2 else { return }

        var path = Path()
        let start = denormalize(shape.points[0], size: size)
        let end = denormalize(shape.points[1], size: size)

        switch shape.type {
        case .line:
            path.move(to: start)
            path.addLine(to: end)
        case .rectangle:
            path.addRect(CGRect(
                x: min(start.x, end.x),
                y: min(start.y, end.y),
                width: abs(end.x - start.x),
                height: abs(end.y - start.y)
            ))
        case .circle:
            let radius = hypot(end.x - start.x, end.y - start.y)
            path.addEllipse(in: CGRect(x: start.x - radius, y: start.y - radius, width: radius * 2, height: radius * 2))
        case .arrow:
            path.move(to: start)
            path.addLine(to: end)
            let headLength = max(15, shape.lineWidth * 4)
            let angle = atan2(end.y - start.y, end.x - start.x)
            path.move(to: end)
            path.addLine(to: CGPoint(
                x: end.x - headLength * cos(angle - .pi / 6),
                y: end.y - headLength * sin(angle - .pi / 6)
            ))
            path.move(to: end)
            path.addLine(to: CGPoint(
                x: end.x - headLength * cos(angle + .pi / 6),
                y: end.y - headLength * sin(angle + .pi / 6)
            ))
        case .axesL:
            path.move(to: start)
            path.addLine(to: CGPoint(x: end.x, y: start.y))
            path.move(to: start)
            path.addLine(to: CGPoint(x: start.x, y: end.y))
        case .axesCross:
            let dx = abs(end.x - start.x)
            let dy = abs(end.y - start.y)
            path.move(to: CGPoint(x: start.x - dx, y: start.y))
            path.addLine(to: CGPoint(x: start.x + dx, y: start.y))
            path.move(to: CGPoint(x: start.x, y: start.y - dy))
            path.addLine(to: CGPoint(x: start.x, y: start.y + dy))
        case .pen, .eraser:
            return
        }

        context.stroke(
            path,
            with: .color(Color(hex: shape.color).opacity(isPreview ? 0.55 : 1)),
            style: StrokeStyle(lineWidth: shape.lineWidth, lineCap: .round, lineJoin: .round, dash: isPreview ? [6, 6] : [])
        )
    }

    private func denormalize(_ point: StrokePoint, size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }
}

private enum WhiteboardHistoryItem {
    case stroke(DrawingStroke)
    case shape(WhiteboardShape)
}

private struct FloatingGlassSurface: ViewModifier {
    let cornerRadius: CGFloat
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content.glassEffect(
                interactive ? .regular.interactive() : .regular,
                in: .rect(cornerRadius: cornerRadius)
            )
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(.white.opacity(0.45), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.12), radius: 18, x: 0, y: 10)
    }
}

private extension View {
    func floatingGlassSurface(cornerRadius: CGFloat, interactive: Bool = false) -> some View {
        modifier(FloatingGlassSurface(cornerRadius: cornerRadius, interactive: interactive))
    }
}

private extension ConfidenceLevel {
    var displayColor: Color {
        switch self {
        case .none:
            return .gray
        case .red:
            return .red
        case .amber:
            return .orange
        case .green:
            return .green
        }
    }
}

private extension Color {
    init(hex: String) {
        let sanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: sanitized).scanHexInt64(&value)

        let red = Double((value >> 16) & 0xff) / 255
        let green = Double((value >> 8) & 0xff) / 255
        let blue = Double(value & 0xff) / 255

        self.init(red: red, green: green, blue: blue)
    }
}
