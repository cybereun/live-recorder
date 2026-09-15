const { app, BrowserWindow, ipcMain, screen, session, desktopCapturer, dialog, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { boundsForMode } = require('./window-layout.cjs');

let win, worker, fullBounds, closeIntent, closeTimer;
let allowClose = false;
let mode = 'full';
const origin = 'http://127.0.0.1:5179';
const token = crypto.randomBytes(32).toString('hex');
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.on('second-instance', () => { if (win) { win.restore(); win.show(); win.focus(); } });

function status(message) { if (win && !win.isDestroyed()) win.webContents.send('update-status', message); }
function trusted(event) { return win && event.sender === win.webContents && event.senderFrame?.url?.startsWith(origin + '/'); }
function requestClose(intent) {
  if (closeIntent) return;
  closeIntent = intent;
  status('마지막 받아쓰기와 녹음을 저장하고 있습니다…');
  win.webContents.send('prepare-close');
  closeTimer = setTimeout(() => {
    closeIntent = null;
    dialog.showMessageBox(win, { type: 'warning', message: '저장을 기다리고 있습니다.', detail: '녹음과 받아쓰기가 끝나면 종료 또는 업데이트를 다시 눌러 주세요.' });
  }, 360000);
}
async function stopWorker() {
  if (!worker) return;
  const child = worker;
  worker = null;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.postMessage('shutdown');
  });
}
async function startServer() {
  const resources = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, '..');
  const packagedEngine = app.isPackaged ? path.join(resources, 'faster-whisper', 'faster-whisper.exe') : path.join(resources, 'build', 'engine', 'faster-whisper', 'faster-whisper.exe');
  const model = app.isPackaged ? path.join(resources, 'models', 'small') : path.join(resources, 'build', 'models', 'small');
  worker = utilityProcess.fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: '5179', WHISPER_SERVER_PORT: '5189', ENGINE_ROOT: resources,
      RECORDER_DATA_DIR: app.getPath('userData'), RECORDER_TOKEN: token,
      FASTER_WHISPER_EXE: packagedEngine, FW_MODEL: model },
    stdio: 'pipe', serviceName: 'Live Recorder engine',
  });
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'engine.log'), { flags: 'a' });
  worker.stdout?.pipe(log, { end: false });
  worker.stderr?.pipe(log, { end: false });
  worker.once('exit', () => log.end());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('로컬 서버 시작 시간 초과')), 45000);
    worker.once('message', message => { clearTimeout(timer); message.ready ? resolve() : reject(new Error(message.error)); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error('로컬 서버 종료: ' + code)); });
  });
}
function configureUpdates() {
  let downloaded = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', error => status('업데이트 확인 실패: ' + error.message));
  autoUpdater.on('update-not-available', () => status('최신 버전 v' + app.getVersion()));
  autoUpdater.on('download-progress', progress => status('업데이트 다운로드 ' + Math.round(progress.percent) + '%'));
  autoUpdater.on('update-available', async info => {
    const result = await dialog.showMessageBox(win, { type: 'info', title: '새 업데이트', message: 'Live Recorder v' + info.version,
      detail: '새 버전을 다운로드할까요? 녹음은 계속할 수 있습니다.', buttons: ['다운로드', '나중에'], defaultId: 0, cancelId: 1 });
    if (result.response === 0) autoUpdater.downloadUpdate().catch(error => status(error.message));
  });
  autoUpdater.on('update-downloaded', async info => {
    downloaded = true;
    const result = await dialog.showMessageBox(win, { type: 'info', title: '업데이트 준비 완료', message: 'v' + info.version + ' 설치 준비 완료',
      detail: '녹음을 종료하고 마지막 문장과 오디오를 저장한 뒤 업데이트합니다. 기존 프로그램 파일을 교체하고 앱을 다시 실행합니다. 저장된 노트는 유지됩니다.',
      buttons: ['저장 후 업데이트', '나중에'], defaultId: 1, cancelId: 1 });
    if (result.response === 0) requestClose('update');
    else status('업데이트 준비됨 · 업데이트 확인을 눌러 설치하세요');
  });
  ipcMain.handle('check-updates', async event => {
    if (!trusted(event)) return;
    if (downloaded) { requestClose('update'); return; }
    await checkUpdates();
  });
  const checkUpdates = async () => {
    if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) { status('업데이트 배포 저장소가 아직 설정되지 않았습니다'); return; }
    status('업데이트 확인 중…');
    try { await autoUpdater.checkForUpdates(); } catch (error) { status('업데이트 확인 실패: ' + error.message); }
  };
  setTimeout(checkUpdates, 7000).unref();
  setInterval(checkUpdates, 4 * 60 * 60 * 1000).unref();
}

if (lock) app.whenReady().then(async () => {
  await startServer();
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'X-Recorder-Token': token } });
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win?.webContents && contents.getURL().startsWith(origin + '/') && ['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => contents === win?.webContents && requestingOrigin === origin && ['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (request.frame !== win.webContents.mainFrame) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (!sources.length) return callback({});
      callback({ video: sources[0], audio: 'loopback' });
    } catch { callback({}); }
  });
  win = new BrowserWindow({ width: 1120, height: 800, minWidth: 720, minHeight: 500, show: false, backgroundColor: '#f3f5f3',
    title: 'Live Recorder', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
  win.on('close', event => { if (!allowClose) { event.preventDefault(); requestClose('quit'); } });
  ipcMain.handle('view-mode', (event, next) => {
    if (!trusted(event) || !['full', 'side', 'bottom'].includes(next)) throw new Error('Invalid view');
    if (next === mode) return;
    if (mode === 'full') fullBounds = win.getBounds();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    if (win.isMaximized()) win.unmaximize();
    win.setMinimumSize(next === 'full' ? 720 : next === 'side' ? 340 : 640, next === 'full' ? 500 : next === 'side' ? 420 : 240);
    win.setBounds(boundsForMode(next, area, fullBounds));
    mode = next;
  });
  ipcMain.handle('toggle-pin', event => { if (!trusted(event)) return false; win.setAlwaysOnTop(!win.isAlwaysOnTop()); return win.isAlwaysOnTop(); });
  ipcMain.on('close-ready', async (event, result) => {
    if (!trusted(event) || !closeIntent) return;
    clearTimeout(closeTimer);
    if (!result?.ok) { closeIntent = null; dialog.showErrorBox('저장 실패', String(result?.error || '저장 상태를 확인해 주세요')); return; }
    const intent = closeIntent;
    await stopWorker();
    allowClose = true;
    if (intent === 'update') autoUpdater.quitAndInstall(false, true);
    else app.quit();
  });
  await win.loadURL(origin);
  win.show();
  configureUpdates();
}).catch(async error => { dialog.showErrorBox('Live Recorder 실행 실패', error.message); await stopWorker(); allowClose = true; app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => { if (!allowClose && win && !win.isDestroyed()) { event.preventDefault(); requestClose('quit'); } });
