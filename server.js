const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const net = require("net");
const readline = require("readline");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = __dirname;
const engineRoot = process.env.ENGINE_ROOT || root;
const port = Number(process.env.PORT || 5177);
const whisperServerPort = Number(process.env.WHISPER_SERVER_PORT || 5188);
const tempDir = path.join(process.env.RECORDER_DATA_DIR || path.join(root, "data"), "temp");
const smallQ5ModelPath = path.join(root, "whisper-cpp", "ggml-small-q5_1.bin");
const smallModelPath = path.join(root, "whisper-cpp", "ggml-small.bin");
const realtimeModelPath = path.join(engineRoot, "whisper-cpp", "ggml-base.bin");
const qualityModelPath = path.join(root, "whisper-cpp", "ggml-large-v3-turbo-q5_0.bin");
function usableModel(candidate, minBytes) {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).size >= minBytes;
  } catch {
    return false;
  }
}

const modelPath = process.env.WHISPER_MODEL_PATH ||
  (usableModel(smallQ5ModelPath, 180 * 1024 * 1024) ? smallQ5ModelPath :
  (usableModel(smallModelPath, 450 * 1024 * 1024) ? smallModelPath :
  (usableModel(realtimeModelPath, 140 * 1024 * 1024) ? realtimeModelPath : qualityModelPath)));

const audioGate = {
  minDurationMs: Number(process.env.MIN_SPEECH_DURATION_MS || 650),
  minRms: Number(process.env.MIN_SPEECH_RMS || 0.0015),
  minPeak: Number(process.env.MIN_SPEECH_PEAK || 0.009),
  minActiveRatio: Number(process.env.MIN_ACTIVE_RATIO || 0.003),
  activeSampleThreshold: Number(process.env.ACTIVE_SAMPLE_THRESHOLD || 0.012),
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let whisperServerProcess = null;
let whisperServerStarting = null;
let fasterWhisperProcess = null;
let fasterWhisperStarting = null;
let fasterWhisperLineReader = null;
const fasterWhisperPending = new Map();
let transcriptionQueue = Promise.resolve();

function firstExisting(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (candidate === "ffmpeg") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findWhisperExe() {
  return firstExisting([
    process.env.WHISPER_CPP_EXE,
    path.join(engineRoot, "bin", "whisper-cli.exe"),
    path.join(root, "bin", "main.exe"),
    path.join(root, "whisper-cli.exe"),
    path.join(root, "main.exe"),
    path.join(root, "whisper.cpp", "build", "bin", "Release", "whisper-cli.exe"),
    path.join(root, "whisper.cpp", "build", "bin", "Release", "main.exe"),
  ]);
}

function findWhisperServerExe() {
  return firstExisting([
    process.env.WHISPER_SERVER_EXE,
    path.join(engineRoot, "bin", "whisper-server.exe"),
    path.join(root, "whisper-runtime", "Release", "whisper-server.exe"),
  ]);
}

function findFfmpegExe() {
  return firstExisting([
    process.env.FFMPEG_EXE,
    path.join(engineRoot, "bin", "ffmpeg.exe"),
    path.join(root, "ffmpeg.exe"),
    path.join(root, "..", "Alt", "current", "resources", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    path.join(root, "..", "current", "resources", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    "ffmpeg",
  ]);
}

let checkedPython;
function findPythonExe() {
  if (checkedPython !== undefined) return checkedPython;
  const candidate = firstExisting([
    process.env.FASTER_WHISPER_PYTHON,
    path.join(root, ".venv", "Scripts", "python.exe"),
  ]);
  checkedPython = candidate && spawnSync(candidate, ["-c", "import faster_whisper"], { windowsHide: true, timeout: 15000 }).status === 0 ? candidate : null;
  return checkedPython;
}

function getFasterWhisperStatus() {
  const pythonExe = findPythonExe();
  const enginePath = path.join(root, "engines", "faster-whisper", "engine.py");
  const executable = firstExisting([process.env.FASTER_WHISPER_EXE, path.join(engineRoot, "faster-whisper", "faster-whisper.exe")]);
  return {
    available: Boolean(executable || (pythonExe && fs.existsSync(enginePath))),
    executable,
    managed: Boolean(fasterWhisperProcess && !fasterWhisperProcess.killed),
    pythonExe,
    enginePath,
    model: process.env.FW_MODEL || "small",
    computeType: process.env.FW_COMPUTE_TYPE || "int8",
  };
}

function getLightningStatus() {
  const repoPath = path.join(root, "engines", "Lightning-SimulWhisper");
  const available = fs.existsSync(path.join(repoPath, "simulstreaming_whisper_server.py"));
  const platformSupported = process.platform === "darwin" && process.arch === "arm64";
  return {
    available,
    repoPath,
    platformSupported,
    reason: platformSupported ? "ready_for_setup" : "Lightning-SimulWhisper requires Apple Silicon MLX/CoreML; this Windows runtime cannot execute it directly",
  };
}

function getEngineStatus() {
  const whisperExe = findWhisperExe();
  const whisperServerExe = findWhisperServerExe();
  const ffmpegExe = findFfmpegExe();
  const modelExists = fs.existsSync(modelPath);
  return {
    ready: Boolean((getFasterWhisperStatus().available || ((whisperServerExe || whisperExe) && modelExists)) && ffmpegExe),
    mode: getFasterWhisperStatus().available ? "faster-whisper" : (whisperServerExe ? "persistent-server" : "cli-fallback"),
    whisperExe,
    whisperServerExe,
    whisperServerUrl: "http://127.0.0.1:" + whisperServerPort,
    whisperServerManaged: Boolean(whisperServerProcess && !whisperServerProcess.killed),
    ffmpegExe,
    modelPath,
    modelName: path.basename(modelPath),
    modelExists,
    lightning: getLightningStatus(),
    fasterWhisper: getFasterWhisperStatus(),
    audioGate,
    missing: {
      whisperExe: !whisperExe,
      whisperServerExe: !whisperServerExe,
      ffmpegExe: !ffmpegExe,
      model: !modelExists,
    },
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function extFromMime(mimeType) {
  if (mimeType && mimeType.includes("mp4")) return ".m4a";
  if (mimeType && mimeType.includes("ogg")) return ".ogg";
  if (mimeType && mimeType.includes("wav")) return ".wav";
  return ".webm";
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || engineRoot,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(path.basename(command) + " timed out"));
    }, options.timeoutMs || 180000);
    child.stdout && child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr && child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(path.basename(command) + " exited with code " + code + "\n" + (stderr || stdout)));
    });
  });
}

function canConnect(host, targetPort, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: targetPort });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForTcp(host, targetPort, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect(host, targetPort)) return true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

async function ensureWhisperServer(status) {
  if (!status.whisperServerExe) return false;
  if (await canConnect("127.0.0.1", whisperServerPort)) return true;
  if (whisperServerStarting) return whisperServerStarting;

  whisperServerStarting = (async () => {
    await fsp.mkdir(tempDir, { recursive: true });
    const binDir = path.dirname(status.whisperServerExe);
    const serverEnv = {
      ...process.env,
      PATH: binDir + path.delimiter + path.dirname(status.ffmpegExe) + path.delimiter + (process.env.PATH || ""),
    };
    const args = [
      "-m", modelPath,
      "--host", "127.0.0.1",
      "--port", String(whisperServerPort),
      "--tmp-dir", tempDir,
      "-l", "ko",
      "-nt",
      "-sns",
      "-bo", "2",
      "-bs", "2",
      "-nf",
      "-nth", "0.78",
      "-ng",
    ];
    whisperServerProcess = spawn(status.whisperServerExe, args, {
      cwd: binDir,
      env: serverEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    whisperServerProcess.stdout && whisperServerProcess.stdout.on("data", (data) => process.stdout.write("[whisper-server] " + data));
    whisperServerProcess.stderr && whisperServerProcess.stderr.on("data", (data) => process.stderr.write("[whisper-server] " + data));
    whisperServerProcess.once("exit", () => {
      whisperServerProcess = null;
      whisperServerStarting = null;
    });
    const ready = await waitForTcp("127.0.0.1", whisperServerPort, 180000);
    if (!ready) {
      whisperServerProcess && whisperServerProcess.kill("SIGKILL");
      whisperServerProcess = null;
    }
    return ready;
  })();

  try {
    return await whisperServerStarting;
  } finally {
    whisperServerStarting = null;
  }
}

function parseWhisperText(stdout) {
  return cleanTranscriptText(stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, "").replace(/\(.*?ms\)/g, "").trim())
    .filter((line) => line && !/^(whisper_|main:|system_info:|ggml_|load_backend:)/i.test(line))
    .join(" "));
}

function cleanTranscriptText(text) {
  return String(text || "")
    .replace(/\[[^\]]*(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]/gi, "")
    .replace(/<\|[^>]+\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(text) {
  return cleanTranscriptText(text).toLowerCase().replace(/[\s.,!?~…。！？，、"'“”‘’()[\]{}:;\-]/g, "");
}

const commonHallucinations = new Set([
  "감사합니다",
  "고맙습니다",
  "시청해주셔서감사합니다",
  "시청해주셔서고맙습니다",
  "thankyou",
  "thanksforwatching",
  "thankyouforwatching",
  "you",
]);

function rejectTranscriptReason(text, stats) {
  const cleaned = cleanTranscriptText(text);
  if (!cleaned) return "empty_text";
  const normalized = normalizeForCompare(cleaned);
  if (!stats.speechLike) return "audio_gate";
  if (commonHallucinations.has(normalized) && (stats.durationMs < 3000 || stats.rms < 0.012)) {
    return "common_silence_hallucination";
  }
  const peakToRms = stats.rms > 0 ? stats.peak / stats.rms : 0;
  if (stats.durationMs < 3000 && normalized.length <= 2 && stats.activeRatio > 0.9 && peakToRms < 2.2) {
    return "steady_noise";
  }
  if (stats.durationMs < 2500 && normalized.length <= 1) return "too_short";
  return null;
}

function normalizeLanguage(language) {
  const value = String(language || "ko").toLowerCase();
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("en")) return "en";
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("zh")) return "zh";
  return value.slice(0, 2) || "ko";
}

function findWavChunk(buffer, chunkName) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === chunkName) return { offset: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function analyzeWav(wavPath) {
  const buffer = await fsp.readFile(wavPath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Converted audio is not a WAV file");
  }
  const fmt = findWavChunk(buffer, "fmt ");
  const data = findWavChunk(buffer, "data");
  if (!fmt || !data) throw new Error("Converted WAV is missing fmt/data chunks");
  const channels = buffer.readUInt16LE(fmt.offset + 2);
  const sampleRate = buffer.readUInt32LE(fmt.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(fmt.offset + 14);
  if (bitsPerSample !== 16) throw new Error("Unsupported WAV bit depth: " + bitsPerSample);

  const sampleBytes = 2;
  const totalSamples = Math.floor(data.size / sampleBytes);
  const frameCount = Math.floor(totalSamples / Math.max(1, channels));
  let sumSquares = 0;
  let peak = 0;
  let activeSamples = 0;

  for (let index = 0; index < totalSamples; index += 1) {
    const value = Math.abs(buffer.readInt16LE(data.offset + index * sampleBytes) / 32768);
    sumSquares += value * value;
    if (value > peak) peak = value;
    if (value >= audioGate.activeSampleThreshold) activeSamples += 1;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, totalSamples));
  const activeRatio = activeSamples / Math.max(1, totalSamples);
  const durationMs = (frameCount / Math.max(1, sampleRate)) * 1000;
  const speechLike = durationMs >= audioGate.minDurationMs &&
    rms >= audioGate.minRms &&
    peak >= audioGate.minPeak &&
    activeRatio >= audioGate.minActiveRatio;

  return {
    durationMs: Math.round(durationMs),
    sampleRate,
    channels,
    rms: Number(rms.toFixed(5)),
    peak: Number(peak.toFixed(5)),
    activeRatio: Number(activeRatio.toFixed(5)),
    speechLike,
  };
}

async function ensureFasterWhisper() {
  const fw = getFasterWhisperStatus();
  if (!fw.available) return false;
  if (fasterWhisperProcess && !fasterWhisperProcess.killed) return true;
  if (fasterWhisperStarting) return fasterWhisperStarting;

  fasterWhisperStarting = new Promise((resolve) => {
    const env = {
      ...process.env,
      PYTHONUTF8: "1",
      FW_MODEL: process.env.FW_MODEL || "small",
      FW_DEVICE: process.env.FW_DEVICE || "cpu",
      FW_COMPUTE_TYPE: process.env.FW_COMPUTE_TYPE || "int8",
      FW_CPU_THREADS: process.env.FW_CPU_THREADS || "6",
      FW_BEAM_SIZE: process.env.FW_BEAM_SIZE || "3",
    };
    fasterWhisperProcess = spawn(fw.executable || fw.pythonExe, fw.executable ? [] : [fw.enginePath], {
      cwd: engineRoot,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolved = false;
    let startupTimer;
    const finishStart = (ok) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(startupTimer);
        resolve(ok);
      }
    };
    fasterWhisperLineReader = readline.createInterface({ input: fasterWhisperProcess.stdout });
    fasterWhisperLineReader.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { process.stdout.write("[faster-whisper] " + line + "\n"); return; }
      if (msg.type === "status") {
        process.stdout.write("[faster-whisper] " + JSON.stringify(msg) + "\n");
        if (msg.status === "ready") finishStart(true);
        return;
      }
      const pending = fasterWhisperPending.get(msg.id);
      if (pending) {
        fasterWhisperPending.delete(msg.id);
        pending.resolve(msg);
      }
    });
    fasterWhisperProcess.stderr.on("data", (data) => process.stderr.write("[faster-whisper] " + data));
    fasterWhisperProcess.once("error", () => { finishStart(false); fasterWhisperProcess = null; fasterWhisperStarting = null; });
    fasterWhisperProcess.once("exit", (code) => {
      for (const pending of fasterWhisperPending.values()) pending.reject(new Error("faster-whisper exited"));
      fasterWhisperPending.clear();
      fasterWhisperLineReader?.close();
      fasterWhisperLineReader = null;
      fasterWhisperProcess = null;
      fasterWhisperStarting = null;
      finishStart(false);
      process.stderr.write("[faster-whisper] exited " + code + "\n");
    });
    startupTimer = setTimeout(() => { finishStart(false); fasterWhisperProcess?.kill(); }, 240000);
  });

  return fasterWhisperStarting;
}

function requestFasterWhisper(payload, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    if (!fasterWhisperProcess || fasterWhisperProcess.killed) {
      reject(new Error("faster-whisper is not running"));
      return;
    }
    const id = payload.id || (Date.now() + "-" + Math.random().toString(16).slice(2));
    payload.id = id;
    const timeout = setTimeout(() => {
      fasterWhisperPending.delete(id);
      reject(new Error("faster-whisper timed out"));
    }, timeoutMs);
    fasterWhisperPending.set(id, {
      resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    fasterWhisperProcess.stdin.write(JSON.stringify(payload) + "\n", "utf8");
  });
}

async function transcribeWithFasterWhisper(wavPath, language, offsetMs) {
  if (!await ensureFasterWhisper()) return null;
  const audioBase64 = await fsp.readFile(wavPath, { encoding: "base64" });
  const result = await requestFasterWhisper({
    audioBase64,
    language,
    offsetMs,
    prompt: "한국어 강의와 회의 내용을 자연스러운 문장으로 받아쓴다.",
  });
  if (result.error) throw new Error(result.error);
  return result;
}

async function transcribeWithServer(wavPath, language, status) {
  if (!await ensureWhisperServer(status)) return null;
  if (typeof fetch !== "function" || typeof FormData !== "function" || typeof Blob !== "function") return null;

  const form = new FormData();
  const wavBuffer = await fsp.readFile(wavPath);
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "chunk.wav");
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("temperature_inc", "0");
  form.append("no_speech_thold", "0.78");
  form.append("best_of", "2");
  form.append("beam_size", "2");
  form.append("suppress_nst", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch("http://127.0.0.1:" + whisperServerPort + "/inference", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error("whisper-server failed: " + response.status + " " + raw);
    return parseServerTranscription(raw);
  } finally {
    clearTimeout(timeout);
  }
}

function parseServerTranscription(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed);
    if (typeof json.text === "string") return cleanTranscriptText(json.text);
    if (typeof json.transcription === "string") return cleanTranscriptText(json.transcription);
    if (Array.isArray(json.segments)) return cleanTranscriptText(json.segments.map((segment) => segment.text || "").join(" "));
  } catch {
    // Some server builds return plain text for inference responses.
  }
  return cleanTranscriptText(trimmed);
}

async function transcribeWithCli(wavPath, language, status) {
  const args = [
    "-m", modelPath,
    "-f", wavPath,
    "-l", language,
    "-nt",
    "-sns",
    "-nf",
    "-nth", "0.82",
    "-ng",
  ];
  const { stdout } = await runProcess(status.whisperExe, args, { timeoutMs: 240000 });
  return parseWhisperText(stdout);
}

async function transcribeChunk(body) {
  const status = getEngineStatus();
  if (!status.ready) {
    const missing = Object.entries(status.missing).filter(([, value]) => value).map(([key]) => key).join(", ");
    const failure = new Error("Local Whisper engine is not ready: " + missing);
    failure.statusCode = 503;
    failure.details = status;
    throw failure;
  }
  if (!body.audioBase64 || typeof body.audioBase64 !== "string") {
    const error = new Error("Missing audioBase64");
    error.statusCode = 400;
    throw error;
  }

  await fsp.mkdir(tempDir, { recursive: true });
  const id = Date.now() + "-" + Math.random().toString(16).slice(2);
  const inputPath = path.join(tempDir, id + "-input" + extFromMime(body.mimeType));
  const wavPath = path.join(tempDir, id + ".wav");

  try {
    await fsp.writeFile(inputPath, Buffer.from(body.audioBase64, "base64"));
    await runProcess(status.ffmpegExe, ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath], { timeoutMs: 60000 });
    const stats = await analyzeWav(wavPath);
    const language = normalizeLanguage(body.language);
    const offsetMs = Number(body.offsetMs || 0);

    if (!stats.speechLike) {
      return { text: "", skipped: true, reason: "audio_gate", language, offsetMs, stats, engine: status.mode };
    }

    let text = "";
    let engine = "faster-whisper";
    let fwResult = null;
    try {
      fwResult = await transcribeWithFasterWhisper(wavPath, language, offsetMs);
    } catch (error) {
      process.stderr.write("[faster-whisper] fallback: " + error.message + "\n");
    }
    if (fwResult && typeof fwResult.text === "string") {
      text = fwResult.text;
      engine = fwResult.engine || "faster-whisper";
    } else {
      text = await transcribeWithServer(wavPath, language, status);
      engine = "persistent-server";
      if (text === null) {
        text = await transcribeWithCli(wavPath, language, status);
        engine = "cli-fallback";
      }
    }

    const rejectReason = rejectTranscriptReason(text, stats);
    if (rejectReason) {
      return { text: "", skipped: true, reason: rejectReason, language, offsetMs, stats, engine };
    }
    return { text: cleanTranscriptText(text), skipped: false, language, offsetMs, stats, engine, segments: fwResult?.segments || [] };
  } finally {
    await Promise.allSettled([fsp.unlink(inputPath), fsp.unlink(wavPath)]);
  }
}

function enqueueTranscription(task) {
  const next = transcriptionQueue.then(task, task);
  transcriptionQueue = next.catch(() => undefined);
  return next;
}

async function handleApi(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/engine/prepare") {
    try {
      const status = getEngineStatus();
      const fwReady = status.fasterWhisper.available && await ensureFasterWhisper();
      if (fwReady) await requestFasterWhisper({ command: "reset" });
      const ready = fwReady || await ensureWhisperServer(status);
      sendJson(res, ready ? 200 : 503, { ready, error: ready ? null : "음성 엔진을 시작하지 못했습니다" });
    } catch (error) { sendJson(res, 503, { error: error.message }); }
    return true;
  }
  if (req.method === "GET" && pathname === "/api/engine/status") {
    sendJson(res, 200, getEngineStatus());
    return true;
  }
  if (req.method === "POST" && pathname === "/api/transcribe-chunk") {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, await enqueueTranscription(() => transcribeChunk(body)));
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Transcription failed", details: error.details });
    }
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  if (process.env.RECORDER_TOKEN && req.headers["x-recorder-token"] !== process.env.RECORDER_TOKEN) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  const url = new URL(req.url || "/", "http://" + req.headers.host);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, pathname);
    if (!handled) sendJson(res, 404, { error: "Not found" });
    return;
  }
  if (!["/index.html", "/app.js", "/styles.css"].includes(pathname)) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
});

function shutdown() {
  if (whisperServerProcess) whisperServerProcess.kill("SIGTERM");
  if (fasterWhisperProcess) fasterWhisperProcess.kill("SIGTERM");
}

process.parentPort?.on("message", (event) => {
  if (event.data === "shutdown") { shutdown(); server.close(() => process.exit(0)); }
});
server.on("error", (error) => { process.parentPort?.postMessage({ error: error.message }); });

process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });

server.listen(port, "127.0.0.1", () => {
  console.log("Live Recorder: http://127.0.0.1:" + port);
  process.parentPort?.postMessage({ ready: true, port: server.address().port });
  console.log("Whisper engine:", getEngineStatus());
});
