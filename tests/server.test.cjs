const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
test('server limits static files, rejects missing desktop token, gates silent audio', async () => {
  const port = 19577;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), RECORDER_TOKEN: 'test-only', FASTER_WHISPER_PYTHON: 'missing-python' }, stdio: ['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('startup timeout')),25000);
      child.stdout.on('data', chunk=>{if(chunk.toString().includes('Live Recorder:')){clearTimeout(timer);resolve()}});
      child.once('error',reject);
    });
    const root='http://127.0.0.1:'+port;
    assert.equal((await fetch(root)).status,403);
    const headers={'X-Recorder-Token':'test-only'};
    assert.equal((await fetch(root,{headers})).status,200);
    assert.equal((await fetch(root+'/server.js',{headers})).status,404);
    assert.equal((await fetch(root+'/.venv/pyvenv.cfg',{headers})).status,404);
    const wav=Buffer.alloc(44+32000);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
    const response=await fetch(root+'/api/transcribe-chunk',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({audioBase64:wav.toString('base64'),mimeType:'audio/wav'})});
    const result=await response.json();
    assert.equal(result.reason,'audio_gate');assert.equal(result.text,'');
  } finally { child.kill(); }
});
