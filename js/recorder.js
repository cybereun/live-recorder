const VAD_RMS_THRESHOLD = 0.006;
const VAD_PREROLL_MS = 800;
const VAD_SILENCE_FLUSH_MS = 1400;
const VAD_MIN_SEGMENT_MS = 1200;
const VAD_LIVE_FLUSH_MS = 6500;
const VAD_MAX_SEGMENT_MS = 9000;
const VAD_CARRY_MS = 1200;

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
    updateRetranscribeControls();
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
  await attachAudioCapture();

  state.mediaRecorder = new MediaRecorder(state.mediaStream, { mimeType: chooseMimeType() });
  const recordingSession = activeSession();
  const recordingMimeType = state.mediaRecorder.mimeType;
  state.recoverySeq = 0;
  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size <= 0) return;
    state.audioChunks.push(event.data);
    if (recordingSession) persistRecoveryChunk(recordingSession.id, state.recoverySeq++, event.data, recordingMimeType);
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

// Prefer an AudioWorklet (audio thread, no dropouts when the UI is busy); fall back to
// the deprecated ScriptProcessor only if the worklet cannot be loaded.
async function attachAudioCapture() {
  try {
    await state.audioContext.audioWorklet.addModule("./audio-worklet.js");
    const node = new AudioWorkletNode(state.audioContext, "capture-processor", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event) => handleAudioFrame(event.data);
    state.audioSource.connect(node);
    state.scriptProcessor = node;
  } catch (error) {
    console.warn("AudioWorklet unavailable, using ScriptProcessor", error);
    const node = state.audioContext.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = handleAudioProcess;
    state.audioSource.connect(node);
    node.connect(state.audioContext.destination);
    state.scriptProcessor = node;
  }
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
  const input = event.inputBuffer.getChannelData(0);
  const frame = new Float32Array(input.length);
  frame.set(input);
  handleAudioFrame(frame);
}

function handleAudioFrame(frame) {
  if (!state.isRecording || state.isPaused || !state.vad) return;
  processVadFrame(frame);
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
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Audio-Mime": blob.type || "audio/wav",
      "X-Language": languageCode(),
      "X-Offset-Ms": String(Math.round(offsetMs)),
    },
    body: blob,
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
  if (state.isStarting || state.isStopping || state.isRetranscribing) return;
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
  if (session) await clearRecoveryChunks(session.id).catch((error) => console.warn(error));
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
