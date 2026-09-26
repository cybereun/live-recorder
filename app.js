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
  isRetranscribing: false,
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
  recoveryWrites: Promise.resolve(),
  recoverySeq: 0,
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
  exportSrtButton: document.querySelector("#exportSrtButton"),
  retranscribeButton: document.querySelector("#retranscribeButton"),
  restoreLiveButton: document.querySelector("#restoreLiveButton"),
  sessionTemplate: document.querySelector("#sessionTemplate"),
  lineTemplate: document.querySelector("#lineTemplate"),
};

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
  els.newSessionButton.disabled = state.isRecording || state.isStopping || state.isStarting || state.isRetranscribing;
  if (els.exportSrtButton) els.exportSrtButton.disabled = !session || !session.lines.some((line) => line.kind !== "marker");
  updateRetranscribeControls();
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
  const recovered = await recoverInterruptedAudio();
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
  els.exportSrtButton?.addEventListener("click", downloadSrt);
  els.retranscribeButton?.addEventListener("click", () => retranscribeSession());
  els.restoreLiveButton?.addEventListener("click", restoreLiveTranscript);
  els.archiveButton?.addEventListener("click", () => saveAllToArchive(true).catch((error) => setStatus(error.message || "아카이브 저장 실패", false)));
  els.exportFolderButton?.addEventListener("click", () => exportArchiveToFolder().catch((error) => {
    if (error?.name !== "AbortError") setStatus(error.message || "폴더 저장 실패", false);
  }));
  els.deleteSessionButton?.addEventListener("click", () => deleteActiveSession().catch((error) => setStatus(error.message || "삭제 실패", false)));
  render();
  drawWaveform();
  refreshEngineStatus();
  setupDesktopViews();
  if (recovered > 0) setStatus(`중단된 녹음 ${recovered}건의 오디오를 복구했습니다`, false);
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
