const VAD_RMS_THRESHOLD = 0.006;
const VAD_PREROLL_MS = 800;
const VAD_SILENCE_FLUSH_MS = 1400;
const VAD_MIN_SEGMENT_MS = 1200;
const VAD_LIVE_FLUSH_MS = 6500;
const VAD_MAX_SEGMENT_MS = 9000;
const VAD_CARRY_MS = 1200;

const state = {
  sessions: [],
  activeId: null,
  isRecording: false,
  isPaused: false,
  isStopping: false,
  startedAt: 0,
  elapsedBeforePause: 0,
  timerId: null,
  mediaStream: null,
  captureStream: null,
  mediaRecorder: null,
  audioChunks: [],
  audioUrl: null,
  audioSource: null,
  scriptProcessor: null,
  vad: null,
  audioContext: null,
  analyser: null,
  waveform: new Uint8Array(512).fill(128),
  isStarting: false,
  stopPromise: null,
  viewMode: "full",
  transcribeQueue: Promise.resolve(),
  pendingTranscriptions: 0,
  provisionalText: "",
  lastLiveText: "",
  engineStatus: null,
  archiveDb: null,
  archiveReady: false,
  archiveSaveTimer: null,
};

const els = {
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  recordButton: document.querySelector("#recordButton"),
  recordButtonText: document.querySelector("#recordButtonText"),
  pauseButton: document.querySelector("#pauseButton"),
  markerButton: document.querySelector("#markerButton"),
  timer: document.querySelector("#timer"),
  languageSelect: document.querySelector("#languageSelect"),
  audioSourceSelect: document.querySelector("#audioSourceSelect"),
  speakerModeSelect: document.querySelector("#speakerModeSelect"),
  waveCanvas: document.querySelector("#waveCanvas"),
  audioLevelText: document.querySelector("#audioLevelText"),
  speechEngineText: document.querySelector("#speechEngineText"),
  sessions: document.querySelector("#sessions"),
  newSessionButton: document.querySelector("#newSessionButton"),
  archiveButton: document.querySelector("#archiveButton"),
  exportFolderButton: document.querySelector("#exportFolderButton"),
  deleteSessionButton: document.querySelector("#deleteSessionButton"),
  sessionTitle: document.querySelector("#sessionTitle"),
  interimText: document.querySelector("#interimText"),
  provisionalPanel: document.querySelector("#provisionalPanel"),
  provisionalText: document.querySelector("#provisionalText"),
  transcriptList: document.querySelector("#transcriptList"),
  copyButton: document.querySelector("#copyButton"),
  exportTextButton: document.querySelector("#exportTextButton"),
  downloadAudioButton: document.querySelector("#downloadAudioButton"),
  sessionTemplate: document.querySelector("#sessionTemplate"),
  lineTemplate: document.querySelector("#lineTemplate"),
};

const ARCHIVE_DB_NAME = "live-recorder:archive";
const ARCHIVE_STORE_NAME = "sessions";

const storage = {
  load() {
    try {
      return JSON.parse(localStorage.getItem("live-recorder:sessions") || "[]");
    } catch {
      return [];
    }
  },
  save(sessions) {
    localStorage.setItem("live-recorder:sessions", JSON.stringify(sessions));
  },
};

function openArchiveDb() {
  if (!window.indexedDB) return Promise.reject(new Error("이 브라우저는 자체 아카이브 저장을 지원하지 않습니다"));
  if (state.archiveDb) return Promise.resolve(state.archiveDb);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => {
      state.archiveDb = request.result;
      resolve(state.archiveDb);
    };
    request.onerror = () => reject(request.error || new Error("아카이브를 열 수 없습니다"));
  });
}

function archiveTx(mode = "readonly") {
  return openArchiveDb().then((db) => db.transaction(ARCHIVE_STORE_NAME, mode).objectStore(ARCHIVE_STORE_NAME));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("아카이브 작업 실패"));
  });
}

function sanitizeSession(session) {
  return {
    id: session.id || crypto.randomUUID(),
    title: session.title || "녹음",
    createdAt: session.createdAt || new Date().toISOString(),
    lines: Array.isArray(session.lines) ? session.lines : [],
    markers: Array.isArray(session.markers) ? session.markers : [],
    audioBlob: session.audioBlob || null,
    durationMs: Number(session.durationMs || 0),
    activeSpeaker: Number(session.activeSpeaker || 1),
    archivedAt: session.archivedAt || null,
  };
}

async function loadArchiveSessions() {
  try {
    const store = await archiveTx("readonly");
    const sessions = await requestToPromise(store.getAll());
    if (sessions.length > 0) return sessions.map(sanitizeSession).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (error) {
    console.warn(error);
  }
  return storage.load().map(sanitizeSession);
}

async function saveSessionToArchive(session) {
  const store = await archiveTx("readwrite");
  const payload = sanitizeSession({ ...session, archivedAt: new Date().toISOString() });
  session.archivedAt = payload.archivedAt;
  await new Promise((resolve, reject) => {
    store.transaction.oncomplete = resolve;
    store.transaction.onerror = () => reject(store.transaction.error);
    store.transaction.onabort = () => reject(store.transaction.error || new Error("저장 취소됨"));
    store.put(payload);
  });
}

async function saveAllToArchive(showStatus = false) {
  await Promise.all(state.sessions.map((session) => saveSessionToArchive(session)));
  if (showStatus) {
    setStatus("아카이브 저장됨", false);
    setTimeout(() => setStatus(state.isRecording ? "녹음 중" : "대기", state.isRecording), 900);
    render();
  }
}

function scheduleArchiveSave() {
  if (!state.archiveReady) return;
  clearTimeout(state.archiveSaveTimer);
  state.archiveSaveTimer = setTimeout(() => {
    saveAllToArchive().catch((error) => console.warn("archive save failed", error));
  }, 350);
}

async function deleteSessionFromArchive(id) {
  try {
    const store = await archiveTx("readwrite");
    await requestToPromise(store.delete(id));
  } catch (error) {
    console.warn(error);
  }
}

function createSession() {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    title: `녹음 ${now.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    createdAt: now.toISOString(),
    lines: [],
    markers: [],
    audioBlob: null,
    durationMs: 0,
    activeSpeaker: 1,
  };
}

function activeSession() {
  return state.sessions.find((session) => session.id === state.activeId) || null;
}

function setStatus(text, recording = false) {
  els.statusText.textContent = text;
  els.statusPill.classList.toggle("is-recording", recording);
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function currentElapsed() {
  if (!state.isRecording && !state.isStopping) return activeSession()?.durationMs || 0;
  if (state.isPaused) return state.elapsedBeforePause;
  return state.elapsedBeforePause + Date.now() - state.startedAt;
}

function saveSessions() {
  storage.save(state.sessions.map((session) => ({ ...session, audioBlob: null })));
  scheduleArchiveSave();
}

function renderSessions() {
  els.sessions.replaceChildren();
  if (state.sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "저장된 녹음이 없습니다";
    els.sessions.append(empty);
    return;
  }
  for (const session of state.sessions) {
    const item = els.sessionTemplate.content.firstElementChild.cloneNode(true);
    item.classList.toggle("is-active", session.id === state.activeId);
    item.querySelector(".session-name").textContent = session.title;
    const audioLabel = session.audioBlob ? " · 오디오" : "";
    const archiveLabel = session.archivedAt ? " · 보관됨" : "";
    item.querySelector(".session-meta").textContent = `${formatTime(session.durationMs || 0)} · ${session.lines.length}줄${audioLabel}${archiveLabel}`;
    item.addEventListener("click", () => {
      if (state.isRecording || state.isStopping || state.isStarting) return;
      state.activeId = session.id;
      render();
    });
    els.sessions.append(item);
  }
}

function renderTranscript() {
  const session = activeSession();
  els.transcriptList.replaceChildren();
  els.sessionTitle.textContent = session?.title || "새 녹음";
  if (!session || session.lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "아직 기록된 문장이 없습니다";
    els.transcriptList.append(empty);
    return;
  }
  const visibleLines = state.viewMode === "full" ? session.lines : session.lines.slice(state.viewMode === "bottom" ? -2 : -5);
  for (const group of groupTranscriptLines(visibleLines)) {
    els.transcriptList.append(createSpeakerBlock(group));
  }
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function groupTranscriptLines(lines) {
  const groups = [];
  for (const line of lines) {
    const speaker = Number(line.speaker || 1);
    const last = groups[groups.length - 1];
    if (last && last.speaker === speaker && line.kind !== "marker") {
      last.lines.push(line);
      last.endAt = line.at;
    } else {
      groups.push({ speaker, startAt: line.at || 0, endAt: line.at || 0, lines: [line] });
    }
  }
  return groups;
}

function createSpeakerBlock(group) {
  const article = document.createElement("article");
  article.className = "speaker-block";
  const badge = document.createElement("div");
  badge.className = "speaker-badge";
  badge.textContent = String(group.speaker);
  const body = document.createElement("div");
  body.className = "speaker-body";
  const head = document.createElement("div");
  head.className = "speaker-head";
  const name = document.createElement("strong");
  name.textContent = "화자 " + group.speaker;
  const elapsed = document.createElement("span");
  elapsed.textContent = formatTime(group.startAt);
  head.append(name, elapsed);
  const paragraph = document.createElement("p");
  paragraph.textContent = group.lines.map((line) => line.text).join(" ");
  body.append(head, paragraph);
  article.append(badge, body);
  return article;
}

function render() {
  renderSessions();
  renderTranscript();
  els.timer.textContent = formatTime(currentElapsed());
  const session = activeSession();
  els.downloadAudioButton.disabled = !session?.audioBlob;
  if (els.deleteSessionButton) els.deleteSessionButton.disabled = !session || state.isRecording;
  if (els.archiveButton) els.archiveButton.disabled = !session;
  if (els.exportFolderButton) els.exportFolderButton.disabled = state.sessions.length === 0;
  els.newSessionButton.disabled = state.isRecording || state.isStopping || state.isStarting;
}

function ensureActiveSession() {
  let session = activeSession();
  if (!session) {
    session = createSession();
    state.sessions.unshift(session);
    state.activeId = session.id;
    saveSessions();
  }
  return session;
}

function addLine(text, at = currentElapsed()) {
  const cleaned = dedupeRepeatedPhrases(text).trim();
  if (!cleaned) return;
  const session = ensureActiveSession();
  const speaker = inferSpeaker(session, at);
  const last = session.lines[session.lines.length - 1];
  if (last && last.speaker === speaker && shouldMergeLine(last.text, cleaned)) {
    last.text = mergeLineText(last.text, cleaned);
    session.durationMs = Math.max(session.durationMs || 0, at);
    saveSessions();
    render();
    return;
  }
  if (session.lines.slice(-4).some((line) => normalizeText(line.text) === normalizeText(cleaned))) return;
  session.lines.push({ at, text: cleaned, speaker });
  session.durationMs = Math.max(session.durationMs || 0, at);
  saveSessions();
  render();
}

function inferSpeaker(session, at) {
  const mode = els.speakerModeSelect?.value || "1";
  if (mode !== "2") return 1;
  const last = session.lines.filter((line) => line.kind !== "marker").at(-1);
  if (!last) return session.activeSpeaker || 1;
  const gap = Math.max(0, at - (last.at || 0));
  if (gap >= 2200) session.activeSpeaker = last.speaker === 1 ? 2 : 1;
  return session.activeSpeaker || last.speaker || 1;
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[\s.,!?~…。！？，、"'“”‘’()[\]{}:;\-]/g, "");
}

function dedupeRepeatedPhrases(text) {
  let words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(" ");
  for (let pass = 0; pass < words.length; pass += 1) {
    let removed = false;
    const maxSize = Math.min(12, Math.floor(words.length / 2));
    for (let size = maxSize; size >= 1 && !removed; size -= 1) {
      for (let index = 0; index + size * 2 <= words.length; index += 1) {
        const same = words.slice(index, index + size).every((word, offset) =>
          normalizeText(word) && normalizeText(word) === normalizeText(words[index + size + offset])
        );
        if (!same) continue;
        const phraseKey = normalizeText(words[index]);
        if (size === 1 && phraseKey.length < 3) continue;
        words.splice(index + size, size);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return words.join(" ");
}

function textOverlapTail(previous, next) {
  const a = String(previous || "").trim();
  const b = String(next || "").trim();
  const max = Math.min(a.length, b.length);
  for (let size = max; size >= 2; size -= 1) {
    if (normalizeText(a.slice(-size)) === normalizeText(b.slice(0, size))) return b.slice(size);
  }
  return "";
}

function shouldMergeLine(previous, next) {
  const a = normalizeText(previous);
  const b = normalizeText(next);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || textOverlapTail(previous, next).length >= 2;
}

function mergeLineText(previous, next) {
  const a = String(previous || "").trim();
  const b = String(next || "").trim();
  if (normalizeText(a).includes(normalizeText(b))) return dedupeRepeatedPhrases(a);
  if (normalizeText(b).includes(normalizeText(a))) return dedupeRepeatedPhrases(b);
  const tail = textOverlapTail(a, b);
  return dedupeRepeatedPhrases(tail ? a + tail : a + " " + b);
}

function addMarker() {
  const session = ensureActiveSession();
  const at = currentElapsed();
  session.markers.push(at);
  session.lines.push({ at, text: "◆ 마커", speaker: session.activeSpeaker || 1, kind: "marker" });
  saveSessions();
  render();
}

function startTimer() {
  stopTimer();
  state.timerId = setInterval(() => {
    const elapsed = currentElapsed();
    els.timer.textContent = formatTime(elapsed);
    const session = activeSession();
    if (session) session.durationMs = elapsed;
  }, 250);
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

async function refreshEngineStatus() {
  try {
    const response = await fetch("/api/engine/status");
    state.engineStatus = await response.json();
    if (state.engineStatus.ready) {
      const fw = state.engineStatus.fasterWhisper;
      if (fw?.available) {
        const modelLabel = String(fw.model).split(/[\\/]/).pop();
        els.speechEngineText.textContent = `로컬 받아쓰기 · ${modelLabel} · ${fw.computeType}`;
      } else {
        const modelName = state.engineStatus.modelName ? ` · ${state.engineStatus.modelName}` : "";
        els.speechEngineText.textContent = state.engineStatus.mode === "persistent-server" ? `로컬 Whisper 준비 (실시간)${modelName}` : `로컬 Whisper 준비${modelName}`;
      }
    } else {
      const missing = Object.entries(state.engineStatus.missing || {}).filter(([, value]) => value).map(([key]) => key).join(", ");
      els.speechEngineText.textContent = `로컬 Whisper 미완료: ${missing}`;
    }
  } catch {
    els.speechEngineText.textContent = "로컬 서버 연결 실패";
  }
}

async function setupAudio() {
  state.captureStream = null;
  if (els.audioSourceSelect?.value === "system") {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((track) => track.stop());
      throw new Error("컴퓨터 소리를 선택하려면 공유 창에서 오디오 공유를 켜야 합니다");
    }
    state.captureStream = displayStream;
    state.mediaStream = new MediaStream(audioTracks);
  } else {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  }
  state.audioContext = new AudioContext();
  state.audioSource = state.audioContext.createMediaStreamSource(state.mediaStream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.audioSource.connect(state.analyser);

  state.audioChunks = [];
  state.vad = createVadState(state.audioContext.sampleRate);
  state.scriptProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
  state.scriptProcessor.onaudioprocess = handleAudioProcess;
  state.audioSource.connect(state.scriptProcessor);
  state.scriptProcessor.connect(state.audioContext.destination);

  state.mediaRecorder = new MediaRecorder(state.mediaStream, { mimeType: chooseMimeType() });
  const recordingSession = activeSession();
  const recordingMimeType = state.mediaRecorder.mimeType;
  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) state.audioChunks.push(event.data);
  };
  state.mediaRecorder.onstop = () => {
    const session = recordingSession;
    if (!session || state.audioChunks.length === 0) return;
    const blob = new Blob(state.audioChunks, { type: recordingMimeType });
    session.audioBlob = blob;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(blob);
    els.downloadAudioButton.disabled = false;
    saveSessions();
    render();
  };
  state.mediaRecorder.start(1000);
}

function createVadState(sampleRate) {
  return {
    sampleRate,
    preRoll: [],
    segment: [],
    inSpeech: false,
    lastVoiceAt: 0,
    segmentStartedAt: 0,
    segmentSamples: 0,
    preRollSamples: 0,
  };
}

function handleAudioProcess(event) {
  if (!state.isRecording || state.isPaused || !state.vad) return;
  const input = event.inputBuffer.getChannelData(0);
  const frame = new Float32Array(input.length);
  frame.set(input);
  processVadFrame(frame);
}

function rmsOfFrame(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function pushPreRoll(vad, frame) {
  vad.preRoll.push(frame);
  vad.preRollSamples += frame.length;
  const maxSamples = Math.round((VAD_PREROLL_MS / 1000) * vad.sampleRate);
  while (vad.preRollSamples > maxSamples && vad.preRoll.length > 1) {
    const removed = vad.preRoll.shift();
    vad.preRollSamples -= removed.length;
  }
}

function beginSpeechSegment(vad, now) {
  vad.inSpeech = true;
  vad.segment = vad.preRoll.slice();
  vad.segmentSamples = vad.preRollSamples;
  vad.segmentStartedAt = Math.max(0, now - (vad.preRollSamples / vad.sampleRate) * 1000);
  vad.lastVoiceAt = now;
}

function processVadFrame(frame) {
  const vad = state.vad;
  const now = currentElapsed();
  const rms = rmsOfFrame(frame);
  const isVoice = rms >= VAD_RMS_THRESHOLD;
  const frameMs = (frame.length / vad.sampleRate) * 1000;
  if (isVoice) els.interimText.textContent = state.pendingTranscriptions ? `받아쓰기 중 (${state.pendingTranscriptions})` : "말소리 감지 중";
  else if (!state.pendingTranscriptions) els.interimText.textContent = "듣는 중";

  if (isVoice && !vad.inSpeech) beginSpeechSegment(vad, now);

  if (vad.inSpeech) {
    vad.segment.push(frame);
    vad.segmentSamples += frame.length;
    if (isVoice) vad.lastVoiceAt = now;
    const segmentMs = (vad.segmentSamples / vad.sampleRate) * 1000;
    const silenceMs = now - vad.lastVoiceAt;
    if (segmentMs >= VAD_MAX_SEGMENT_MS) {
      flushVadSegment("max");
    } else if (segmentMs >= VAD_LIVE_FLUSH_MS && isVoice) {
      flushVadSegment("live");
    } else if (silenceMs >= VAD_SILENCE_FLUSH_MS && segmentMs >= VAD_MIN_SEGMENT_MS) {
      flushVadSegment("silence");
    }
  } else {
    pushPreRoll(vad, frame);
  }

  if (!isVoice && vad.inSpeech && frameMs > 0) {
    pushPreRoll(vad, frame);
  }
}

function concatFloat32(chunks, totalSamples) {
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function wavBlobFromFloat32(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function carryTailFromSegment(vad) {
  const maxSamples = Math.round((VAD_CARRY_MS / 1000) * vad.sampleRate);
  const tail = [];
  let total = 0;
  for (let i = vad.segment.length - 1; i >= 0 && total < maxSamples; i -= 1) {
    tail.unshift(vad.segment[i]);
    total += vad.segment[i].length;
  }
  vad.preRoll = tail;
  vad.preRollSamples = total;
}

function resetVadSegment(keepPreRoll = false) {
  if (!state.vad) return;
  state.vad.segment = [];
  state.vad.segmentSamples = 0;
  state.vad.inSpeech = false;
  state.vad.lastVoiceAt = 0;
  if (!keepPreRoll) {
    state.vad.preRoll = [];
    state.vad.preRollSamples = 0;
  }
}

function flushVadSegment(reason = "manual") {
  const vad = state.vad;
  if (!vad || vad.segmentSamples <= 0) return;
  const segmentMs = (vad.segmentSamples / vad.sampleRate) * 1000;
  if (segmentMs < VAD_MIN_SEGMENT_MS) {
    resetVadSegment(false);
    return;
  }
  const samples = concatFloat32(vad.segment, vad.segmentSamples);
  const blob = wavBlobFromFloat32(samples, vad.sampleRate);
  const offsetMs = vad.segmentStartedAt;
  const keepListening = reason === "live" || reason === "max";
  if (keepListening) carryTailFromSegment(vad);
  resetVadSegment(keepListening);
  if (keepListening) els.interimText.textContent = "계속 듣는 중";
  enqueueTranscription(blob, offsetMs, reason);
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function languageCode() {
  const value = els.languageSelect.value.toLowerCase();
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("en")) return "en";
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("zh")) return "zh";
  return "ko";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function enqueueTranscription(blob, offsetMs, reason = "live") {
  state.pendingTranscriptions += 1;
  els.interimText.textContent = `로컬 Whisper 처리 중 (${state.pendingTranscriptions})`;
  state.transcribeQueue = state.transcribeQueue
    .then(() => transcribeBlob(blob, offsetMs, reason))
    .catch((error) => {
      console.error(error);
      els.interimText.textContent = error.message || "전사 실패";
    })
    .finally(() => {
      state.pendingTranscriptions = Math.max(0, state.pendingTranscriptions - 1);
      els.interimText.textContent = state.pendingTranscriptions === 0 ? (state.isRecording ? "듣는 중" : "") : `받아쓰기 중 (${state.pendingTranscriptions})`;
    });
}

async function transcribeBlob(blob, offsetMs, reason = "live") {
  if (!state.engineStatus?.ready) await refreshEngineStatus();
  if (!state.engineStatus?.ready) throw new Error("whisper-cli.exe 또는 모델 파일이 준비되지 않았습니다");
  const response = await fetch("/api/transcribe-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: await blobToBase64(blob), mimeType: blob.type, language: languageCode(), offsetMs }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "전사 실패");
  if (result.skipped) {
    if (result.reason && result.reason !== "audio_gate") console.debug("transcription skipped", result.reason, result.stats);
    return;
  }
  if (result.text) handleTranscriptResult(result.text, result.offsetMs || offsetMs, reason);
}

function renderProvisional() {
  const text = state.provisionalText.trim();
  if (!els.provisionalPanel || !els.provisionalText) return;
  els.provisionalPanel.hidden = !text;
  els.provisionalText.textContent = text;
}

function commonPrefixByChars(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  const max = Math.min(left.length, right.length);
  let end = 0;
  for (let i = 0; i < max; i += 1) {
    if (normalizeText(left.slice(0, i + 1)) === normalizeText(right.slice(0, i + 1))) end = i + 1;
    else if (left[i] !== right[i]) break;
  }
  return left.slice(0, end).trim();
}

function removePrefixText(text, prefix) {
  const source = String(text || "").trim();
  const p = String(prefix || "").trim();
  if (!p) return source;
  if (normalizeText(source).startsWith(normalizeText(p))) return source.slice(p.length).trim();
  return source;
}

function mergeStreamingText(previous, next) {
  const a = String(previous || "").trim();
  const b = String(next || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (normalizeText(a).includes(normalizeText(b))) return a;
  if (normalizeText(b).includes(normalizeText(a))) return b;
  const tail = textOverlapTail(a, b);
  return dedupeRepeatedPhrases(tail ? a + tail : `${a} ${b}`).trim();
}

function commitStableText(text, at) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  addLine(cleaned, at);
}

function finalizeProvisional(at) {
  const text = state.provisionalText.trim();
  if (text) commitStableText(text, at);
  state.provisionalText = "";
  state.lastLiveText = "";
  renderProvisional();
}

function handleTranscriptResult(text, at, reason) {
  const cleaned = dedupeRepeatedPhrases(text).trim();
  if (!cleaned) return;
  const isFinal = reason === "silence" || reason === "stop" || reason === "pause" || reason === "manual";
  if (isFinal) {
    const merged = mergeStreamingText(state.provisionalText, cleaned);
    commitStableText(merged, at);
    state.provisionalText = "";
    state.lastLiveText = "";
    renderProvisional();
    return;
  }

  if (!state.provisionalText) {
    state.provisionalText = cleaned;
    state.lastLiveText = cleaned;
    renderProvisional();
    return;
  }

  const agreed = commonPrefixByChars(state.lastLiveText || state.provisionalText, cleaned);
  if (normalizeText(agreed).length >= 12) {
    commitStableText(agreed, at);
    state.provisionalText = removePrefixText(mergeStreamingText(state.provisionalText, cleaned), agreed);
  } else {
    state.provisionalText = mergeStreamingText(state.provisionalText, cleaned);
  }
  state.lastLiveText = cleaned;
  renderProvisional();
}

async function startRecording() {
  if (state.isStarting || state.isStopping) return;
  if (state.isRecording) {
    await stopRecording();
    return;
  }
  state.isStarting = true;
  els.recordButton.disabled = true;
  setStatus("음성 엔진 준비 중", false);
  try {
  await refreshEngineStatus();
  const prepared = await fetch("/api/engine/prepare", { method: "POST" });
  const preparation = await prepared.json();
  if (!prepared.ok || !preparation.ready) throw new Error(preparation.error || "음성 엔진 준비 실패");
  const previousSession = activeSession();
  if (previousSession && (previousSession.audioBlob || previousSession.durationMs > 0 || previousSession.lines.length)) {
    const fresh = createSession();
    state.sessions.unshift(fresh);
    state.activeId = fresh.id;
  }
  ensureActiveSession();
  state.provisionalText = "";
  state.lastLiveText = "";
  renderProvisional();
  setStatus("권한 요청", false);
  els.audioSourceSelect.disabled = true;
  await setupAudio();
  state.isRecording = true;
  state.isPaused = false;
  state.isStopping = false;
  state.startedAt = Date.now();
  state.elapsedBeforePause = activeSession()?.durationMs || 0;
  startTimer();
  setStatus("녹음 중", true);
  els.recordButton.classList.add("is-recording");
  els.recordButtonText.textContent = "녹음 정지";
  els.pauseButton.disabled = false;
  els.pauseButton.classList.remove("is-paused");
  els.pauseButton.title = "일시정지";
  els.pauseButton.setAttribute?.("aria-label", "일시정지");
  els.markerButton.disabled = false;
  drawWaveform();
  render();
  if (!state.engineStatus?.ready) els.interimText.textContent = "녹음은 가능하지만 로컬 Whisper 실행 파일이 없어 전사는 대기 중입니다";
  } finally { state.isStarting = false; els.recordButton.disabled = false; }
}

async function stopRecording() {
  if (state.stopPromise) return state.stopPromise;
  state.stopPromise = finishRecording();
  try { await state.stopPromise; } finally { state.stopPromise = null; }
}

async function finishRecording() {
  const finalElapsed = currentElapsed();
  state.isStopping = true;
  els.recordButton.disabled = true;
  setStatus("받아쓰기와 녹음 저장 중", false);
  state.elapsedBeforePause = finalElapsed;
  state.startedAt = Date.now();
  state.isRecording = false;
  state.isPaused = false;
  stopTimer();
  const session = activeSession();
  if (session) session.durationMs = finalElapsed;
  const recorder = state.mediaRecorder;
  const stopped = recorder && recorder.state !== "inactive" ? new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true })) : Promise.resolve();
  if (state.mediaRecorder?.state !== "inactive") {
    try { state.mediaRecorder?.requestData(); } catch {}
    state.mediaRecorder?.stop();
  }
  flushVadSegment("stop");
  state.scriptProcessor?.disconnect();
  state.audioSource?.disconnect();
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.captureStream?.getTracks().forEach((track) => track.stop());
  await state.audioContext?.close().catch(() => undefined);
  await stopped;
  state.mediaStream = null;
  state.captureStream = null;
  state.mediaRecorder = null;
  state.audioSource = null;
  state.scriptProcessor = null;
  state.audioContext = null;
  state.analyser = null;
  state.vad = null;
  const finalDurationMs = session?.durationMs ?? currentElapsed();
  state.transcribeQueue = state.transcribeQueue.finally(() => {
    if (!state.isRecording) {
      finalizeProvisional(finalDurationMs);
      saveSessions();
      render();
    }
  });
  await state.transcribeQueue;
  await saveAllToArchive();
  state.isStopping = false;
  els.recordButton.disabled = false;
  setStatus("대기", false);
  els.recordButton.classList.remove("is-recording");
  els.recordButtonText.textContent = "녹음 시작";
  els.pauseButton.disabled = true;
  els.markerButton.disabled = true;
  els.audioSourceSelect.disabled = false;
  els.pauseButton.classList.remove("is-paused");
  els.pauseButton.title = "일시정지";
  els.pauseButton.setAttribute?.("aria-label", "일시정지");
  saveSessions();
  render();
}

function togglePause() {
  if (!state.isRecording) return;
  const elapsed = currentElapsed();
  state.isPaused = !state.isPaused;
  if (state.isPaused) {
    state.elapsedBeforePause = elapsed;
    state.mediaRecorder?.pause();
    flushVadSegment("pause");
      setStatus("일시정지", false);
    els.pauseButton.classList.add("is-paused");
    els.pauseButton.title = "재개";
    els.pauseButton.setAttribute?.("aria-label", "재개");
  } else {
    state.startedAt = Date.now();
    state.mediaRecorder?.resume();
    setStatus("녹음 중", true);
    els.pauseButton.classList.remove("is-paused");
    els.pauseButton.title = "일시정지";
    els.pauseButton.setAttribute?.("aria-label", "일시정지");
  }
}

function drawWaveform() {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f7f9f8";
  ctx.fillRect(0, 0, width, height);
  if (state.analyser) state.analyser.getByteTimeDomainData(state.waveform);
  let peak = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = state.isRecording && !state.isPaused ? "#20c997" : "#4a5562";
  ctx.beginPath();
  for (let i = 0; i < state.waveform.length; i++) {
    const value = (state.waveform[i] - 128) / 128;
    peak = Math.max(peak, Math.abs(value));
    const x = (i / (state.waveform.length - 1)) * width;
    const y = height / 2 + value * (height * 0.38);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  els.audioLevelText.textContent = `입력 레벨 ${Math.round(peak * 100)}%`;
  if (state.isRecording || state.isStopping) requestAnimationFrame(drawWaveform);
}

function transcriptText(session = activeSession()) {
  if (!session) return "";
  return groupTranscriptLines(session.lines).map((group) => `화자 ${group.speaker}: ${group.lines.map((line) => line.text).join(" ")}`).join("\n\n");
}

async function copyTranscript() {
  await navigator.clipboard.writeText(transcriptText());
  setStatus("복사됨", false);
  setTimeout(() => setStatus(state.isRecording ? "녹음 중" : "대기", state.isRecording), 900);
}

function downloadText() {
  const session = activeSession();
  if (!session) return;
  downloadBlob(new Blob([transcriptText(session)], { type: "text/plain;charset=utf-8" }), `${session.title}.txt`);
}

function downloadAudio() {
  const session = activeSession();
  if (!session?.audioBlob) return;
  downloadBlob(session.audioBlob, `${session.title}.${session.audioBlob.type.includes("mp4") ? "m4a" : "webm"}`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name) {
  return String(name || "녹음").replace(/[\/:*?"<>|]/g, "_").replace(/s+/g, " ").trim().slice(0, 80) || "녹음";
}

function audioExtension(blob) {
  const type = blob?.type || "";
  if (type.includes("mp4")) return "m4a";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function sessionExportJson(session) {
  return JSON.stringify({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    durationMs: session.durationMs || 0,
    markers: session.markers || [],
    lines: session.lines || [],
    transcript: transcriptText(session),
    hasAudio: Boolean(session.audioBlob),
    archivedAt: session.archivedAt || null,
  }, null, 2);
}

async function writeHandleFile(directoryHandle, filename, data) {
  const fileHandle = await directoryHandle.getFileHandle(safeFilename(filename), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function exportArchiveToFolder() {
  await saveAllToArchive(false).catch(console.warn);
  if (!window.showDirectoryPicker) {
    setStatus("폴더 저장은 Chrome/Edge에서 가능합니다", false);
    downloadText();
    return;
  }
  const sessionsToExport = state.sessions.filter((session) => session.audioBlob || session.lines.length > 0 || session.markers.length > 0);
  if (sessionsToExport.length === 0) {
    setStatus("저장할 녹음이 없습니다", false);
    return;
  }
  const directory = await window.showDirectoryPicker({ mode: "readwrite" });
  const index = [];
  for (const session of sessionsToExport) {
    const folderName = safeFilename(session.title) + "-" + String(session.id).slice(0, 8);
    const sessionDirectory = await directory.getDirectoryHandle(folderName, { create: true });
    await writeHandleFile(sessionDirectory, "transcript.txt", new Blob([transcriptText(session)], { type: "text/plain;charset=utf-8" }));
    await writeHandleFile(sessionDirectory, "session.json", new Blob([sessionExportJson(session)], { type: "application/json;charset=utf-8" }));
    if (session.audioBlob) await writeHandleFile(sessionDirectory, "audio." + audioExtension(session.audioBlob), session.audioBlob);
    index.push({ id: session.id, title: session.title, folder: folderName, durationMs: session.durationMs || 0, lines: session.lines.length, hasAudio: Boolean(session.audioBlob) });
  }
  await writeHandleFile(directory, "live-recorder-index.json", new Blob([JSON.stringify(index, null, 2)], { type: "application/json;charset=utf-8" }));
  setStatus("폴더 저장 완료", false);
  setTimeout(() => setStatus(state.isRecording ? "녹음 중" : "대기", state.isRecording), 1100);
}

async function deleteActiveSession() {
  const session = activeSession();
  if (!session) return;
  if (state.isRecording) {
    setStatus("녹음 중에는 삭제할 수 없습니다", true);
    return;
  }
  if (!confirm("'" + session.title + "' 녹음 목록을 삭제할까요?")) return;
  state.sessions = state.sessions.filter((item) => item.id !== session.id);
  await deleteSessionFromArchive(session.id);
  if (state.sessions.length === 0) state.sessions.push(createSession());
  state.activeId = state.sessions[0].id;
  saveSessions();
  render();
  setStatus("삭제됨", false);
  setTimeout(() => setStatus("대기", false), 900);
}

async function boot() {
  state.sessions = await loadArchiveSessions();
  state.archiveReady = true;
  if (state.sessions.length === 0) {
    const session = createSession();
    state.sessions.push(session);
    state.activeId = session.id;
  } else {
    state.activeId = state.sessions[0].id;
  }
  els.recordButton.addEventListener("click", () => startRecording().catch((error) => {
    console.error(error);
    setStatus(error.message || "녹음 실패", false);
    stopRecording().catch(() => undefined);
  }));
  els.pauseButton.addEventListener("click", togglePause);
  els.markerButton.addEventListener("click", addMarker);
  els.newSessionButton.addEventListener("click", () => {
    if (state.isRecording || state.isStopping || state.isStarting) return;
    const session = createSession();
    state.sessions.unshift(session);
    state.activeId = session.id;
    saveSessions();
    render();
  });
  els.speakerModeSelect?.addEventListener("change", () => {
    const session = activeSession();
    if (session) session.activeSpeaker = 1;
    render();
  });
  els.copyButton.addEventListener("click", () => copyTranscript().catch(console.error));
  els.exportTextButton.addEventListener("click", downloadText);
  els.downloadAudioButton.addEventListener("click", downloadAudio);
  els.archiveButton?.addEventListener("click", () => saveAllToArchive(true).catch((error) => setStatus(error.message || "아카이브 저장 실패", false)));
  els.exportFolderButton?.addEventListener("click", () => exportArchiveToFolder().catch((error) => {
    if (error?.name !== "AbortError") setStatus(error.message || "폴더 저장 실패", false);
  }));
  els.deleteSessionButton?.addEventListener("click", () => deleteActiveSession().catch((error) => setStatus(error.message || "삭제 실패", false)));
  render();
  drawWaveform();
  refreshEngineStatus();
  setupDesktopViews();
}

function setupDesktopViews() {
  const modes = document.querySelectorAll("[data-mode]");
  const applyMode = (mode) => {
    state.viewMode = mode;
    document.body.dataset.view = mode;
    modes.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    renderTranscript();
  };
  modes.forEach(button => button.addEventListener("click", async () => {
    try {
      if (window.desktop) await window.desktop.setMode(button.dataset.mode);
      applyMode(button.dataset.mode);
    } catch (error) { setStatus(error.message, false); }
  }));
  applyMode("full");
  const pin = document.querySelector("#pinButton");
  pin.hidden = !window.desktop;
  pin.addEventListener("click", async () => {
    const pinned = await window.desktop.togglePin();
    pin.setAttribute("aria-pressed", String(pinned));
    pin.textContent = pinned ? "고정됨" : "항상 위";
  });
  const update = document.querySelector("#updateButton");
  update.hidden = !window.desktop;
  update.addEventListener("click", () => window.desktop.checkUpdates());
  window.desktop?.onPrepareClose(async () => {
    try {
      if (state.isStarting) throw new Error("엔진 준비가 끝난 뒤 다시 시도해 주세요.");
      if (state.isRecording || state.isStopping) await stopRecording();
      await state.transcribeQueue;
      await saveAllToArchive();
      window.desktop.closeReady({ ok: true });
    } catch (error) { window.desktop.closeReady({ ok: false, error: error.message }); }
  });
  window.desktop?.onUpdateStatus(message => { document.querySelector("#updateStatus").textContent = message; });
}

boot().catch((error) => {
  console.error(error);
  state.sessions = storage.load().map(sanitizeSession);
  if (state.sessions.length === 0) state.sessions.push(createSession());
  state.activeId = state.sessions[0].id;
  render();
  setStatus("앱 초기화 실패", false);
});
