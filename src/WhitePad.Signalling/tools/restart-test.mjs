// Tests persisted authorisation/control metadata across a real workerd process restart.
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const state=await mkdtemp(join(tmpdir(),'whitepad-restart-'));
const origin='http://localhost:5173',endpoint='http://localhost:8790',code='local-restart-test-only';
let child;
async function start(){
 child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--port','8790','--persist-to',state,'--var',`CREATE_ROOM_SECRET:${code}`],{stdio:'ignore'});
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Emulator exited');try{await fetch(endpoint,{signal:AbortSignal.timeout(500)});return;}catch{await new Promise(r=>setTimeout(r,250));}}
 throw Error('Emulator startup timed out');
}
async function stop(){if(!child||child.exitCode!==null)return;const running=child;await new Promise(resolve=>{running.once('exit',resolve);running.kill('SIGTERM');setTimeout(()=>{if(running.exitCode===null)running.kill('SIGKILL');},5000).unref();});}
async function request(path,token,body={}){const response=await fetch(endpoint+path,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();}
try{
 await start();const room=await request('/create',code,{name:'Persistence test'});
 const student=await request(`/rooms/${room.roomId}/join`,'',{joinToken:room.joinToken,name:'Persistent student'});
 for(const command of ['lock','clear'])await request(`/rooms/${room.roomId}/control`,room.teacherToken,{command,studentId:student.studentId});
 await request(`/rooms/${room.roomId}/control`,room.teacherToken,{command:'question',question:'Persistent question'});
 await stop();await start();
 const restored=await request(`/rooms/${room.roomId}/session`,student.studentSessionToken);
 assert.equal(restored.studentId,student.studentId);assert.equal(restored.isLocked,true);assert.equal(restored.control.members[0].epoch,1);assert.equal(restored.currentQuestion,'Persistent question');
 const teacher=await request(`/rooms/${room.roomId}/session`,room.teacherToken);assert.equal(teacher.control.members.length,1);
 console.log('Durable room credentials, membership, lock, clear generation and question survived process restart.');
}finally{await stop();await rm(state,{recursive:true,force:true});}
