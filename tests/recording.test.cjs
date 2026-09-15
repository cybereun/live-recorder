const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { boundsForMode } = require('../desktop/window-layout.cjs');
function fixture() {
  const element = () => ({ disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({ document: { querySelector: element }, console, setTimeout, clearTimeout, setInterval, clearInterval, Uint8Array, Blob, URL, crypto: require('node:crypto').webcrypto });
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf('\nboot().catch')), context);
  vm.runInContext(`render=()=>{}; saveSessions=()=>{}; saveAllToArchive=async()=>{}; flushVadSegment=()=>{}; finalizeProvisional=()=>{};`, context);
  return { context, run: code => vm.runInContext(code, context) };
}
test('pause preserves elapsed time; resuming does not reset it', () => {
  const { run } = fixture();
  run('state.isRecording=true; state.startedAt=Date.now()-4500; state.elapsedBeforePause=2000; togglePause();');
  const elapsed = run('currentElapsed()');
  assert.ok(elapsed >= 6500 && elapsed < 7000);
  run('togglePause()');
  assert.ok(run('currentElapsed()') >= elapsed);
});
test('stop waits for MediaRecorder audio and outstanding transcription before saving', async () => {
  const { run, context } = fixture();
  context.sequence = [];
  run(`state.isRecording=true; state.startedAt=Date.now();
    state.sessions=[{id:'s',durationMs:0}];state.activeId='s';
    state.mediaRecorder={state:'recording',requestData(){},addEventListener(_name,callback){this.callback=callback},stop(){setTimeout(()=>{sequence.push('audio');this.callback()},20)}};
    state.transcribeQueue=new Promise(resolve=>setTimeout(()=>{sequence.push('text');resolve()},40));
    saveAllToArchive=async()=>{sequence.push('saved')};`);
  await run('stopRecording()');
  assert.deepEqual(context.sequence, ['audio', 'text', 'saved']);
  assert.equal(run('state.isStopping'), false);
  assert.equal(run('state.mediaRecorder'), null);
});
test('new recording cannot start while previous transcription is saving', async () => {
  const { run } = fixture();
  run('state.isStopping=true');
  await run('startRecording()');
  assert.equal(run('state.isRecording'), false);
});
test('side and bottom bounds respect negative monitor coordinates and taskbar work area', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(boundsForMode('side', area), { x: -360, y: 0, width: 360, height: 1040 });
  assert.deepEqual(boundsForMode('bottom', area), { x: -1920, y: 790, width: 1920, height: 250 });
  const full = boundsForMode('full', area, { x: 9000, y: 9999, width: 1200, height: 800 });
  assert.equal(full.x + full.width, 0);
  assert.equal(full.y + full.height, 1040);
});
