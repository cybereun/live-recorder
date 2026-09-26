// Usage: node tests/retranscribe-smoke.cjs <speech.wav>   (needs whisper-cli, ffmpeg and a large model)
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '19580', WHISPER_SERVER_PORT: '19581', FASTER_WHISPER_PYTHON: 'missing' }, stdio: ['ignore', 'pipe', 'pipe'] });
(async () => {
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('server timeout')), 20000); child.stdout.on('data', c => { if (c.toString().includes('Live Recorder:')) { clearTimeout(timer); resolve(); } }); });
    const base = 'http://127.0.0.1:19580';
    const status = await (await fetch(base + '/api/engine/status')).json();
    assert.equal(status.retranscribe.available, true, status.retranscribe.reason);
    const audio = fs.readFileSync(process.argv[2]);
    const started = Date.now();
    const response = await fetch(base + '/api/retranscribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Mime': 'audio/wav', 'X-Language': 'en' }, body: audio });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.ok(result.segments.length > 0);
    assert.match(result.segments.map(s => s.text).join(' '), /country/i);
    assert.ok(result.segments.every(s => s.endMs > s.startMs));
    console.log('RETRANSCRIBE_SMOKE_PASS', result.model, Date.now() - started + 'ms', JSON.stringify(result.segments));
  } finally { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); else child.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
