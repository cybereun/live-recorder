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
    assert.equal((await fetch(root+'/audio-worklet.js',{headers})).status,200);
    // The transcription checks need a local engine (absent on CI runners).
    const engine=await (await fetch(root+'/api/engine/status',{headers})).json();
    if(!engine.ready) return;
    const wav=Buffer.alloc(44+32000);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
    const response=await fetch(root+'/api/transcribe-chunk',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({audioBase64:wav.toString('base64'),mimeType:'audio/wav'})});
    const result=await response.json();
    assert.equal(result.reason,'audio_gate');assert.equal(result.text,'');
    const binary=await (await fetch(root+'/api/transcribe-chunk',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Audio-Mime':'audio/wav','X-Language':'ko','X-Offset-Ms':'0'},body:wav})).json();
    assert.equal(binary.reason,'audio_gate');assert.equal(binary.stats.sampleRate,16000);
  } finally { child.kill(); }
});

function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), RECORDER_TOKEN: 'test-only', FASTER_WHISPER_PYTHON: 'missing-python', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('startup timeout')), 25000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Live Recorder:')) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
  });
  return { child, ready };
}
function rawGet(port, host) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request({ host: '127.0.0.1', port, path: '/', headers: { Host: host, 'X-Recorder-Token': 'test-only' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
}
test('server rejects foreign Host headers (DNS rebinding)', async () => {
  const { child, ready } = startServer(19581);
  try {
    await ready;
    assert.equal(await rawGet(19581, 'evil.example.com'), 403);
    assert.equal(await rawGet(19581, '127.0.0.1:19581'), 200);
    assert.equal(await rawGet(19581, 'localhost:19581'), 200);
  } finally { child.kill(); }
});
test('server applies backpressure when the transcription queue is full', async () => {
  const { child, ready } = startServer(19582, { MAX_PENDING_CHUNKS: '0' });
  try {
    await ready;
    const response = await fetch('http://127.0.0.1:19582/api/transcribe-chunk', { method: 'POST', headers: { 'X-Recorder-Token': 'test-only', 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(100) });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'queue_full');
  } finally { child.kill(); }
});
