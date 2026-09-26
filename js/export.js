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

function downloadSrt() {
  const session = activeSession();
  if (!session) return;
  downloadBlob(new Blob(["﻿" + buildSrt(session.lines, session.durationMs)], { type: "text/plain;charset=utf-8" }), `${session.title}.srt`);
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
  return String(name || "녹음").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "녹음";
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
    await writeHandleFile(sessionDirectory, "transcript.srt", new Blob(["﻿" + buildSrt(session.lines, session.durationMs)], { type: "text/plain;charset=utf-8" }));
    await writeHandleFile(sessionDirectory, "session.json", new Blob([sessionExportJson(session)], { type: "application/json;charset=utf-8" }));
    if (session.audioBlob) await writeHandleFile(sessionDirectory, "audio." + audioExtension(session.audioBlob), session.audioBlob);
    index.push({ id: session.id, title: session.title, folder: folderName, durationMs: session.durationMs || 0, lines: session.lines.length, hasAudio: Boolean(session.audioBlob) });
  }
  await writeHandleFile(directory, "live-recorder-index.json", new Blob([JSON.stringify(index, null, 2)], { type: "application/json;charset=utf-8" }));
  setStatus("폴더 저장 완료", false);
  setTimeout(() => setStatus(state.isRecording ? "녹음 중" : "대기", state.isRecording), 1100);
}
