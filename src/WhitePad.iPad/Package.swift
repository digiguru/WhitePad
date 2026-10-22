// swift-tools-version: 5.9
import PackageDescription

// Foundation-only compatibility tests. SwiftUI/PencilKit still require Xcode and an iPad.
let package = Package(
    name: "WhitePadCompatibility",
    products: [.library(name: "WhitePad_iPad", targets: ["WhitePad_iPad"])],
    targets: [
        .target(name: "WhitePad_iPad", path: "WhitePad.iPad", exclude: ["WhitePadApp.swift", "Info.plist", "App/AppRootView.swift", "App/AppRouter.swift", "Features/Join/JoinLinkEntryView.swift", "Features/Join/JoinedRoomView.swift", "Features/Join/ParsedJoinLinkView.swift", "Features/Whiteboard", "Models", "Services", "Resources", "Shared/SessionPhase.swift"], sources: [
            "Features/Join/JoinLink.swift", "App/DeepLinkRouter.swift", "Shared/WhitePadError.swift"
        ]),
        .testTarget(name: "CompatibilityTests", dependencies: ["WhitePad_iPad"], path: "CompatibilityTests")
    ]
)
