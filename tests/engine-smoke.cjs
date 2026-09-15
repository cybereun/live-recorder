const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=process.cwd();
const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'19578',WHISPER_SERVER_PORT:'19579',FASTER_WHISPER_EXE:path.join(root,'build/engine/faster-whisper/faster-whisper.exe'),FW_MODEL:path.join(root,'build/models/small')},stdio:['ignore','pipe','pipe']});
child.stderr.on('data',chunk=>process.stderr.write(chunk));
(async()=>{
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server timeout')),20000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('Live Recorder:')){clearTimeout(timer);resolve()}})});
    const base='http://127.0.0.1:19578';
    const prepare=await fetch(base+'/api/engine/prepare',{method:'POST'});
    assert.equal(prepare.status,200);
    const audio=fs.readFileSync(process.argv[2]);
    const response=await fetch(base+'/api/transcribe-chunk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioBase64:audio.toString('base64'),mimeType:'audio/wav',language:'en'})});
    const result=await response.json();
    assert.equal(response.status,200);assert.equal(result.engine,'faster-whisper');assert.match(result.text,/country/i);
    fs.mkdirSync('build/verification',{recursive:true});fs.writeFileSync('build/verification/engine-result.json',JSON.stringify({passed:true,...result},null,2));
    console.log('ENGINE_SMOKE_PASS',result.text);
  } finally { if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F']);else child.kill(); }
})().catch(error=>{console.error(error);process.exitCode=1});
