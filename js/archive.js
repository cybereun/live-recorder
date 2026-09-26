const ARCHIVE_DB_NAME = "live-recorder:archive";
const ARCHIVE_STORE_NAME = "sessions";
const RECOVERY_STORE_NAME = "recovery";

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
    const request = indexedDB.open(ARCHIVE_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RECOVERY_STORE_NAME)) db.createObjectStore(RECOVERY_STORE_NAME, { keyPath: "key" });
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
    liveLines: Array.isArray(session.liveLines) ? session.liveLines : null,
    retranscribedAt: session.retranscribedAt || null,
    retranscribeModel: session.retranscribeModel || null,
  };
}

// Crash-safe audio: every MediaRecorder chunk is persisted as it arrives, so a crash
// or power loss mid-recording leaves the audio recoverable on the next launch.
function recoveryKey(sessionId, seq) {
  return sessionId + ":" + String(seq).padStart(8, "0");
}

function recoveryRange(sessionId) {
  return IDBKeyRange.bound(sessionId + ":", sessionId + ":￿");
}

function persistRecoveryChunk(sessionId, seq, blob, mimeType) {
  state.recoveryWrites = state.recoveryWrites
    .then(async () => {
      const db = await openArchiveDb();
      const tx = db.transaction(RECOVERY_STORE_NAME, "readwrite");
      tx.objectStore(RECOVERY_STORE_NAME).put({ key: recoveryKey(sessionId, seq), sessionId, seq, mimeType, blob });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("복구 조각 저장 취소됨"));
      });
    })
    .catch((error) => console.warn("recovery chunk save failed", error));
  return state.recoveryWrites;
}

async function clearRecoveryChunks(sessionId) {
  await state.recoveryWrites;
  const db = await openArchiveDb();
  const tx = db.transaction(RECOVERY_STORE_NAME, "readwrite");
  tx.objectStore(RECOVERY_STORE_NAME).delete(recoveryRange(sessionId));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("복구 조각 삭제 취소됨"));
  });
}

async function recoverInterruptedAudio() {
  let records;
  try {
    const db = await openArchiveDb();
    records = await requestToPromise(db.transaction(RECOVERY_STORE_NAME, "readonly").objectStore(RECOVERY_STORE_NAME).getAll());
  } catch (error) {
    console.warn(error);
    return 0;
  }
  const bySession = new Map();
  for (const record of records) {
    if (!bySession.has(record.sessionId)) bySession.set(record.sessionId, []);
    bySession.get(record.sessionId).push(record);
  }
  let recovered = 0;
  for (const [sessionId, chunks] of bySession) {
    chunks.sort((a, b) => a.seq - b.seq);
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: chunks[0].mimeType || "audio/webm" });
    let session = state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = { ...createSession(), id: sessionId, title: "복구된 녹음" };
      state.sessions.unshift(session);
    }
    if (!session.audioBlob) {
      session.audioBlob = blob;
      recovered += 1;
    }
    try {
      await saveSessionToArchive(session);
      await clearRecoveryChunks(sessionId);
    } catch (error) {
      console.warn("recovery finalize failed", error);
    }
  }
  return recovered;
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
