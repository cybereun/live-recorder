function boundsForMode(mode, area, previous) {
  if (mode === 'side') {
    const width = Math.min(360, area.width);
    return { x: area.x + area.width - width, y: area.y, width, height: area.height };
  }
  if (mode === 'bottom') {
    const height = Math.min(250, area.height);
    return { x: area.x, y: area.y + area.height - height, width: area.width, height };
  }
  const width = Math.min(previous?.width || 1120, area.width);
  const height = Math.min(previous?.height || 800, area.height);
  return { width, height, x: Math.max(area.x, Math.min(previous?.x ?? area.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(previous?.y ?? area.y, area.y + area.height - height)) };
}
module.exports = { boundsForMode };
