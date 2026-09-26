const SRT_MIN_CUE_MS = 1000;
const SRT_MAX_CUE_MS = 12000;

function formatSrtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`;
}

// Live lines only know when they started, so a cue ends where the next line starts
// (bounded to a readable length). Retranscribed lines carry their own `end`.
function buildSrt(lines, durationMs = 0) {
  const spoken = (lines || []).filter((line) => line.kind !== "marker" && String(line.text || "").trim());
  const cues = spoken.map((line, index) => {
    const start = Math.max(0, Number(line.at) || 0);
    const next = spoken[index + 1] ? Number(spoken[index + 1].at) : Math.max(durationMs, start + SRT_MAX_CUE_MS);
    const fallbackEnd = Math.min(next, start + SRT_MAX_CUE_MS);
    const end = Number(line.end) > start ? Number(line.end) : Math.max(fallbackEnd, start + SRT_MIN_CUE_MS);
    return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${String(line.text).trim()}\n`;
  });
  return cues.join("\n");
}

// Rebuilds a session's lines from timestamped segments, keeping the user's markers.
function linesFromSegments(session, segments) {
  const scratch = { lines: [], activeSpeaker: 1 };
  for (const segment of segments) {
    const at = segment.startMs;
    scratch.lines.push({ at, end: segment.endMs, text: segment.text, speaker: inferSpeaker(scratch, at) });
  }
  const markers = (session.markers || []).map((at) => ({ at, text: "◆ 마커", speaker: 1, kind: "marker" }));
  return [...scratch.lines, ...markers].sort((a, b) => a.at - b.at);
}
