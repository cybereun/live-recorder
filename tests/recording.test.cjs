const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { boundsForMode } = require('../desktop/window-layout.cjs');
function fixture() {
  const element = () => ({ disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({ document: { querySelector: element }, console, setTimeout, clearTimeout, setInterval, clearInterval, Uint8Array, Blob, URL, crypto: require('node:crypto').webcrypto });
  const files = ['js/text-utils.js', 'js/audio-utils.js', 'js/archive.js', 'js/subtitle-utils.js', 'js/retranscribe.js', 'js/recorder.js', 'js/export.js', 'app.js'];
  const source = files.map(file => fs.readFileSync(require.resolve('../' + file), 'utf8')).join('\n');
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
test('transcription removes repeated phrases inside one chunk result', () => {
  const { run, context } = fixture();
  context.committed = '';
  run('addLine = text => { committed = text }; handleTranscriptResult("지금 이야기하고 있는 것을 이야기하고 있는 것을 지금 테스트 중이야", 0, "stop");');
  assert.equal(context.committed, '지금 이야기하고 있는 것을 지금 테스트 중이야');
});
test('resampleTo16k downsamples 48 kHz audio to a third of the length and preserves level', () => {
  const { run } = fixture();
  const result = run('(() => { const src = new Float32Array(48000).fill(0.5); const out = resampleTo16k(src, 48000); return [out.length, out[0], out[out.length - 1], resampleTo16k(src, 16000) === src]; })()');
  assert.equal(result[0], 16000);
  assert.ok(Math.abs(result[1] - 0.5) < 1e-6 && Math.abs(result[2] - 0.5) < 1e-6);
  assert.equal(result[3], true);
});
test('dedupeRepeatedPhrases collapses repeated word runs but keeps short fillers and empty input', () => {
  const { run } = fixture();
  assert.equal(run('dedupeRepeatedPhrases("안녕하세요 안녕하세요 여러분")'), '안녕하세요 여러분');
  assert.equal(run('dedupeRepeatedPhrases("a b a b c")'), 'a b c');
  assert.equal(run('dedupeRepeatedPhrases("이것은 테스트 입니다 이것은 테스트 입니다")'), '이것은 테스트 입니다');
  assert.equal(run('dedupeRepeatedPhrases("네 네 네")'), '네 네 네');
  assert.equal(run('dedupeRepeatedPhrases("")'), '');
  assert.equal(run('dedupeRepeatedPhrases("하나")'), '하나');
});
test('normalizeText strips punctuation and case', () => {
  const { run } = fixture();
  assert.equal(run('normalizeText("Hello, World! 안녕~")'), 'helloworld안녕');
});
test('chunk-boundary merging keeps word spacing and does not merge unrelated lines', () => {
  const { run } = fixture();
  assert.equal(run('shouldMergeLine("오늘 수업을 시작합니다","수업을 시작합니다")'), true);
  assert.equal(run('shouldMergeLine("오늘 수업","전혀 다른 문장")'), false);
  assert.equal(run('textOverlapTail("가나다","라마바")'), '');
  assert.equal(run('mergeLineText("오늘은 날씨가 좋고 바람이","바람이 불어서 시원합니다")'), '오늘은 날씨가 좋고 바람이 불어서 시원합니다');
  assert.equal(run('mergeLineText("오늘 수업을 시작합니다","수업을 시작합니다 첫 번째 주제는")'), '오늘 수업을 시작합니다 첫 번째 주제는');
  assert.equal(run('mergeStreamingText("안녕하세요 여러분","여러분 반갑습니다")'), '안녕하세요 여러분 반갑습니다');
  assert.equal(run('mergeStreamingText("","안녕")'), '안녕');
});
test('streaming helpers find the stable prefix and strip it', () => {
  const { run } = fixture();
  assert.equal(run('commonPrefixByChars("오늘 수업을 시작하겠습니다 여러분","오늘 수업을 시작하겠습니다 그러면")'), '오늘 수업을 시작하겠습니다');
  assert.equal(run('removePrefixText("오늘 수업을 시작 합니다","오늘 수업을")'), '시작 합니다');
});
test('addLine drops a recent duplicate and merges an overlapping continuation', () => {
  const { run } = fixture();
  run('state.sessions=[{id:"s",lines:[],markers:[],durationMs:0}];state.activeId="s";');
  run('addLine("오늘 수업을 시작합니다", 1000); addLine("오늘 수업을 시작합니다", 2000);');
  assert.equal(run('activeSession().lines.length'), 1);
  run('addLine("시작합니다 첫 번째 주제는", 3000);');
  assert.equal(run('activeSession().lines.length'), 1);
  assert.equal(run('activeSession().lines[0].text'), '오늘 수업을 시작합니다 첫 번째 주제는');
});
test('buildSrt formats cues, skips markers and bounds live cue length', () => {
  const { run } = fixture();
  assert.equal(run('formatSrtTime(3723004)'), '01:02:03,004');
  const srt = run('buildSrt([{at:1000,text:"첫 문장"},{at:2500,text:"◆ 마커",kind:"marker"},{at:4000,text:"둘째",end:5200},{at:60000,text:"마지막"}], 70000)');
  const expected = [
    '1', '00:00:01,000 --> 00:00:04,000', '첫 문장', '',
    '2', '00:00:04,000 --> 00:00:05,200', '둘째', '',
    '3', '00:01:00,000 --> 00:01:12,000', '마지막', '',
  ].join('\n');
  assert.equal(srt, expected);
});
test('linesFromSegments keeps markers in time order', () => {
  const { run } = fixture();
  const lines = JSON.parse(run('JSON.stringify(linesFromSegments({markers:[2500]}, [{startMs:1000,endMs:2000,text:"가"},{startMs:3000,endMs:4000,text:"나"}]))'));
  assert.deepEqual(lines.map((line) => line.text), ['가', '◆ 마커', '나']);
  assert.equal(lines[0].end, 2000);
});
test('a full localStorage quota does not break saving sessions', () => {
  const { run, context } = fixture();
  context.localStorage = { getItem() { return null; }, setItem() { throw new Error('QuotaExceededError'); } };
  context.warned = 0;
  run('console = { warn() { warned += 1; }, error() {}, debug() {} }; state.sessions = [{ id: "s", lines: [], markers: [], liveLines: [{ text: "x" }] }]; storage.save(state.sessions);');
  assert.equal(context.warned, 1);
});
test('side and bottom bounds respect negative monitor coordinates and taskbar work area', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(boundsForMode('side', area), { x: -360, y: 0, width: 360, height: 1040 });
  assert.deepEqual(boundsForMode('bottom', area), { x: -1920, y: 790, width: 1920, height: 250 });
  const full = boundsForMode('full', area, { x: 9000, y: 9999, width: 1200, height: 800 });
  assert.equal(full.x + full.width, 0);
  assert.equal(full.y + full.height, 1040);
});
