#!/usr/bin/env bash
# macOS-only, one-peer fixture build. Does not download dependencies or run a test.
set -euo pipefail
: "${WEBRTC_FRAMEWORK_DIR:?Set WEBRTC_FRAMEWORK_DIR to the pinned xcframework macos-x86_64_arm64 directory}"
repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
build_dir=${NATIVE_BUILD_DIR:-/tmp/whitepad-native-checks}
mkdir -p "$build_dir"
cd "$repo_root"
swiftc -swift-version 6 -module-cache-path "$build_dir/module-cache" \
  -F "$WEBRTC_FRAMEWORK_DIR" -framework WebRTC \
  -Xlinker -rpath -Xlinker "$WEBRTC_FRAMEWORK_DIR" \
  src/WhitePad.iPad/WhitePad.iPad/Services/ClassroomClient.swift \
  src/WhitePad.iPad/WhitePad.iPad/Services/NativeBoard.swift \
  src/WhitePad.iPad/WhitePad.iPad/Services/NativeRecoveryStore.swift \
  src/WhitePad.iPad/WhitePad.iPad/Services/WebRTCClassroomClient.swift \
  src/WhitePad.iPad/WhitePad.iPad/Shared/WhitePadError.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/DrawingStroke.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/HubMessages.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/JoinRoomResponse.swift \
  src/WhitePad.iPad/WhitePad.iPad/Models/RoomSettings.swift \
  src/WhitePad.iPad/tools/native-peer.swift -o "$build_dir/native-peer"
printf 'Built native peer fixture: %s\n' "$build_dir/native-peer"
