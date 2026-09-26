function updateRetranscribeControls() {
  const session = activeSession();
  const info = state.engineStatus?.retranscribe;
  const busy = state.isRecording || state.isStopping || state.isStarting || state.isRetranscribing;
  if (els.retranscribeButton) {
    els.retranscribeButton.disabled = busy || !session?.audioBlob || !info?.available;
    els.retranscribeButton.title = info?.available ? `정밀 모델 ${info.model}로 다시 받아씁니다` : (info?.reason || "정밀 재전사를 사용할 수 없습니다");
  }
  if (els.restoreLiveButton) {
    els.restoreLiveButton.hidden = !session?.liveLines;
    els.restoreLiveButton.disabled = busy;
  }
}

async function retranscribeSession() {
  const session = activeSession();
  if (!session?.audioBlob || state.isRecording || state.isStopping || state.isStarting || state.isRetranscribing) return;
  if (!confirm("녹음 전체를 정밀 모델로 다시 받아씁니다. 긴 녹음은 오래 걸릴 수 있고, 실시간 결과는 보관되어 되돌릴 수 있습니다. 진행할까요?")) return;
  state.isRetranscribing = true;
  els.recordButton.disabled = true;
  render();
  setStatus("정밀 재전사 중… 창을 닫지 마세요", false);
  try {
    const response = await fetch("/api/retranscribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Audio-Mime": session.audioBlob.type || "audio/webm", "X-Language": languageCode() },
      body: session.audioBlob,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "재전사 실패");
    if (result.skipped || result.segments.length === 0) {
      setStatus("받아쓸 음성이 없어 기존 결과를 유지합니다", false);
      return;
    }
    if (!session.liveLines) session.liveLines = session.lines;
    session.lines = linesFromSegments(session, result.segments);
    session.retranscribedAt = new Date().toISOString();
    session.retranscribeModel = result.model;
    saveSessions();
    setStatus(`정밀 재전사 완료 (${result.model})`, false);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "재전사 실패", false);
  } finally {
    state.isRetranscribing = false;
    els.recordButton.disabled = false;
    render();
    setTimeout(() => { if (!state.isRecording) setStatus("대기", false); }, 2500);
  }
}

function restoreLiveTranscript() {
  const session = activeSession();
  if (!session?.liveLines || state.isRecording || state.isRetranscribing) return;
  session.lines = session.liveLines;
  session.liveLines = null;
  session.retranscribedAt = null;
  session.retranscribeModel = null;
  saveSessions();
  render();
}
