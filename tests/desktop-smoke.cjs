// Run with Electron, using a disposable profile and synthetic microphone.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'live-recorder-test-')));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
require('../desktop/main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 150; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('typeof state !== "undefined" && state.archiveReady')) break;
      await delay(200);
    }
    assert.ok(win, 'desktop window exists');
    const run = source => win.webContents.executeJavaScript(source);
    const errors=[];
    win.webContents.on('console-message', (_event, level, message) => {if(level===3)errors.push(message)});
    fs.mkdirSync(path.join(__dirname, '..', 'build', 'verification'), { recursive:true });
    for (const mode of ['full','side','bottom','full']) {
      await run(`document.querySelector('[data-mode="${mode}"]').click()`);
      await delay(300);
      assert.equal(await run('state.viewMode'),mode);
      assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'),true);
      const image=await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname,'..','build','verification',mode+'.png'),image.toPNG());
    }
    assert.equal(await run('window.desktop.togglePin()'),true);
    assert.equal(win.isAlwaysOnTop(),true);
    await run('window.desktop.togglePin()');
    await run('startRecording()');
    assert.equal(await run('state.isRecording'),true);
    const identity=await run('state.activeId');
    for(const mode of ['side','bottom','full']) {
      await run(`document.querySelector('[data-mode="${mode}"]').click()`); await delay(250);
      assert.equal(await run('state.activeId'),identity);
      assert.equal(await run('state.mediaRecorder.state'),'recording');
    }
    await run('togglePause()'); assert.equal(await run('state.mediaRecorder.state'),'paused');
    await run('togglePause()');
    await run('stopRecording()');
    assert.ok(await run('activeSession().audioBlob.size') > 0);
    assert.equal(await run('state.pendingTranscriptions'),0);
    assert.equal(await run('(async()=> (await loadArchiveSessions()).find(s=>s.id===state.activeId).audioBlob.size === activeSession().audioBlob.size)()'),true);
    assert.deepEqual(errors,[]);
    console.log('DESKTOP_SMOKE_PASS: all modes, pin, synthetic recording, pause, archive, engine startup');
    fs.writeFileSync(path.join(__dirname,'..','build','verification','desktop-result.json'),JSON.stringify({passed:true, checks:['full/side/bottom','no horizontal overflow','always on top','engine startup','recording continuity','pause/resume','audio saved','archive committed'],errors},null,2));
    win.close();
  } catch(error) { fs.mkdirSync(path.join(__dirname,'..','build','verification'),{recursive:true}); fs.writeFileSync(path.join(__dirname,'..','build','verification','desktop-result.json'),JSON.stringify({passed:false,error:error.stack},null,2)); console.error(error); process.exitCode=1; app.exit(1); }
});
