import { readFile,writeFile } from 'node:fs/promises';
const filename=process.argv[2];if(!filename)throw Error('Usage: node tools/webrtc/summarise-load.mjs <report.json>');
const raw=JSON.parse(await readFile(filename,'utf8'));
const distribution=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return {samples:a.length,min:a[0]??null,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,max:a.at(-1)??null};};
const studentTransports=raw.students.flatMap(s=>s.transport),teacherTransports=raw.teachers.flatMap(t=>t.transport);
const summary={
 ...Object.fromEntries(['rooms','participants','seconds','duty','relayOnly','started','establishedAt','summary'].map(k=>[k,raw[k]])),
 harness:`Chromium real RTCDataChannels; ${raw.rooms} actual React teacher grids; students generated in one page per room; one local host`,
 pageErrors:raw.errors.length,
 connectionEstablishmentMs:distribution(studentTransports.flatMap(s=>s.connectionMs)),
 postBatchDeliveryLatencyMs:distribution(teacherTransports.flatMap(s=>s.latencyMs)),
 teacherTaskCpuSecondsIncludingSetup:distribution(raw.teachers.map(t=>t.taskCpuSeconds)),
 teacherJsHeapBytesAtEnd:distribution(raw.teachers.map(t=>t.heapBytes)),
 teacherRendering:{frames:raw.teachers.reduce((n,t)=>n+t.render.frames,0),framesAbove50ms:raw.teachers.reduce((n,t)=>n+t.render.slowFrames,0),longTasks:raw.teachers.reduce((n,t)=>n+t.render.longTasks,0),canvasCounts:raw.teachers.map(t=>t.canvases),expectedBoards:raw.teachers.map(t=>t.expectedBoards)},
 peerPeakBufferedBytes:distribution(studentTransports.flatMap(s=>s.peers.map(p=>p.peakBuffered))),
 turnBillableBytes:null,
 notes:['Local delivery timestamps exclude the initial 100ms point batching and final browser presentation.','One host runs all peers; CPU/heap are browser metrics, not full native process memory.','TURN billing requires credentials and provider egress counters; zero relays does not test TURN.','A 60-second run does not establish full-lesson stability.']
};
const out=filename.replace(/\.json$/,'.summary.json');await writeFile(out,JSON.stringify(summary,null,2)+'\n');console.log(out);
