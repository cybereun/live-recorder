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
    if (normalizeText(a.slice(-size)) === normalizeText(b.slice(0, size))) {
      const rest = b.slice(size);
      // Keep the word boundary when the overlap ended on whitespace ("바람이 " + "불어서").
      return rest && /\s/.test(b[size - 1]) ? " " + rest : rest;
    }
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
