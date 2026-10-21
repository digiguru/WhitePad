# WhitePad peer protocol v1

The executable TypeScript contract is `src/WhitePad.Web/src/p2p/protocol.ts`, shared by the web client and signalling backend. A future native transport must implement the same validation and state machine. JSON frames use UTF-8 on the reliable, ordered `whitepad-v1` RTCDataChannel. No lossy preview channel is enabled.

## Board operations

Every operation is `{v:1, opId, seq, epoch, body}`. `opId` is a unique random identifier. `seq` is a monotonically increasing per-board integer. `epoch` increments for a student clear. A separate durable `controlEpoch` in the envelope increments for a teacher clear. Control revisions also cause the legitimate student to discard unacknowledged offline edits back to its last teacher-acknowledged head before replay. A pending local clear retains at most one former board checkpoint for this purpose. Teacher-clear generation changes reset the student's local sequence space. The complete identity is therefore `(authenticated room, authenticated student, controlEpoch, seq)`.

| Body type | Fields / meaning |
|---|---|
| `start` | `id`, `style:{color,width,eraser}`; metadata sent once per stroke |
| `points` | `id`, `points:[[uint16 x,uint16 y,uint8 pressure],…]` |
| `end` | `id`; pen-up, including when the final point batch was already flushed |
| `shape` | `id`, shape kind, points, style |
| `undo`, `redo` | Refer to an existing stroke or shape ID |
| `clear` | Advance the local epoch, discard prior visible content/history |
| `background` | Pattern `none/dotted/lined/squares`; paper `white/buff` |
| `confidence` | `none/red/amber/green` |
| `answered` | Boolean |

Shapes preserve line, rectangle, circle, arrow, L axes and cross axes. Erasing is a vector stroke with eraser metadata and uses destination-out rendering. Full-canvas screenshots are never routine synchronisation data.

Coordinates are normalized and quantized to 0…65535; pressure to 0…255. Near-identical samples within 16 coordinate units are removed unless pressure changes or they are endpoints. This is intentionally conservative handwriting simplification, not a change to the local pen renderer. Validate appearance with real Pencil handwriting before tuning. The initial peer batching interval is 100 ms; legacy SignalR remains 50 ms. Pen-up flushes immediately.

Application is idempotent: a sequence at or below the accepted head is a duplicate, gaps request recovery, and the wrong epoch is rejected. A clear cannot be undone by delayed content. Reusing an operation ID at another sequence or referring to an unknown drawing object is invalid. Snapshots are validated by rebuilding their ordered operation stream before replacing a replica.

## Peer envelopes and recovery

All frames contain `v:1`, `revision`, `controlEpoch` and `questionRevision`. They must match the latest authenticated server control state for that student. Room/student identity comes from the authenticated signalling pair rather than a trusted field inside a drawing message.

`resync` requests a new head exchange when sender backpressure drops a queued delivery. `hello` exchanges current sequence heads after control reconciliation. The student replays up to 512 missing operations using `op` envelopes; the teacher returns `ack` with its accepted sequence. When replay is unavailable or larger, the student sends `snapshot-start`, sequential `snapshot-chunk` frames, then `snapshot-end`. Each snapshot has a unique transfer ID, chunk count and contiguous chunk indices. Concurrent live changes are sent after the captured snapshot/replay finishes. Incomplete/oversized transfers do not replace the board. An interrupted channel reconnects and starts recovery again.

The teacher never sends board operations to a student. Student commands cannot write another board. Teacher controls travel through authenticated server requests, are persisted first and then broadcast. Their vocabulary is `lock`, `unlock`, `clear`, `kick` and `question`; omission of a target applies room-wide where supported. A new question, including reissuing the same text, increments `questionRevision` and resets answered status. Old question-generation frames are rejected. As in the legacy classroom, confidence and answered controls remain usable while drawing is locked. Clear controls are durable generations rather than transient peer-only events.

## Bounds

| Resource | Limit |
|---|---:|
| Students per room | 28 |
| Live peer channels per pair | 1 |
| Peer JSON frame | 16 KiB UTF-8 |
| Points per batch | 256 |
| Shape points | 16 |
| Stroke width | 0 < width ≤ 100 |
| Board operations | 20,000 |
| Serialized canonical board | 4 MiB |
| Snapshot chunk text | 8,000 characters |
| Snapshot chunks | 1,024, additionally constrained by board size |
| RTC buffer high-water mark | 256 KiB plus at most one frame |
| Application send queue | 512 KiB |
| Peer incoming frames | 200/s, burst 400 |
| Signalling SDP | 24,000 characters |
| Signalling message | 32,768 characters |
| Signalling messages per identity (across reconnects) | 240/minute |
| Room HTTP operations | 300/minute |
| Room creation | 100/day per deployment |

Identifiers use `[a-zA-Z0-9_-]`, maximum 128 characters. Numeric fields must be finite bounded integers where specified. Unknown versions/types are rejected. Backpressure queues do not grow indefinitely: overflow abandons the queued delivery and requests recovery from canonical state. The underlying board remains bounded independently of network speed.

Native implementations must preserve generation checks, point quantisation, operation idempotency, ordered reliable delivery and bounded queues. Do not map every Pencil point to an HTTP request, database write or signalling event.

ICE gathering is bounded to 12 seconds per description. If some server transports are still gathering at the deadline, the client sends the candidates already present in its local description rather than discarding a usable peer. Relay-only mode requires a relay candidate; no-candidate attempts fail and retry. Later candidates are not trickled. A network with slow/unreachable server transports can therefore take roughly two gathering windows to establish the initial connection; committed drawing uses the established reliable channel.
