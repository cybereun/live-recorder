// SRT parsing shared by the server and its tests.
function srtTimeToMs(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(String(value).trim());
  if (!match) return null;
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, "0"));
}

function parseSrt(text) {
  const segments = [];
  const blocks = String(text || "").replace(/^﻿/, "").split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== "");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [from, to] = lines[timingIndex].split("-->");
    const startMs = srtTimeToMs(from);
    const endMs = srtTimeToMs(to);
    if (startMs === null || endMs === null) continue;
    const body = lines.slice(timingIndex + 1).join(" ").replace(/\s+/g, " ").trim();
    if (body) segments.push({ startMs, endMs, text: body });
  }
  return segments;
}

module.exports = { parseSrt, srtTimeToMs };
