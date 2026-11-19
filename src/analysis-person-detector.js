const MIN_SCORE = 0.38;
const DUPLICATE_IOU = 0.4;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function normalize(result, rect, width, height) {
  const boxes = [];
  for (const detection of Array.isArray(result?.detections) ? result.detections : []) {
    const categories = Array.isArray(detection?.categories) ? detection.categories : [];
    const category = categories.find(item => item
      && (item.categoryName === 'person' || item.categoryName == null));
    const box = detection?.boundingBox, score = category?.score;
    if (!box || ![box.originX, box.originY, box.width, box.height, score].every(Number.isFinite)
        || box.width <= 0 || box.height <= 0 || score < MIN_SCORE || score > 1) continue;
    // A detector may round an edge a few pixels beyond its source. Retain only
    // the visible intersection; never map a tile box outside the source video.
    const left = clamp(box.originX, 0, rect.width), top = clamp(box.originY, 0, rect.height);
    const right = clamp(box.originX + box.width, 0, rect.width);
    const bottom = clamp(box.originY + box.height, 0, rect.height);
    if (right <= left || bottom <= top) continue;
    boxes.push({ x: (rect.x + left) / width, y: (rect.y + top) / height,
      w: (right - left) / width, h: (bottom - top) / height, score });
  }
  return boxes;
}

function intersectionOverUnion(a, b) {
  const intersection = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return intersection / (a.w * a.h + b.w * b.h - intersection);
}

function tileRectangles(width, height) {
  const side = Math.min(width, height), longer = Math.max(width, height);
  if (side === longer) return [];
  // Usual 16:9 clips cover the entire long axis. For more extreme ratios the
  // pair stays centered and overlapping; the full-frame pass still comes first.
  const distance = Math.min(longer - side, Math.floor(side * .8));
  const start = Math.floor((longer - side - distance) / 2);
  return [start, start + distance].map(offset => ({
    x: width > height ? offset : 0, y: height > width ? offset : 0,
    width: side, height: side,
  }));
}

/** Analysis-only fallback using the already loaded person detector and weights.
 * Full-frame boxes always take priority. Missing full-frame detections may be
 * recovered from two overlapping square views, without sending extra AI images.
 */
export function createAnalysisPersonDetector(detector, {
  createCanvas = () => document.createElement('canvas'), now = () => performance.now(),
} = {}) {
  if (typeof detector?.detectForVideo !== 'function' || typeof createCanvas !== 'function' || typeof now !== 'function') {
    throw new TypeError('A video detector, canvas factory and clock are required.');
  }
  let lastTimestamp = -1, canvas = null, context = null;
  const timestamp = () => {
    let value;
    try { value = now(); } catch { value = 0; }
    lastTimestamp = Math.max(Number.isFinite(value) && value >= 0 ? value : 0, lastTimestamp + 1);
    return lastTimestamp;
  };
  const detectPersons = async (video, { allowTiles = true } = {}) => {
    const width = video?.videoWidth, height = video?.videoHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0 || width > 16384 || height > 16384) return [];
    let full;
    try { full = normalize(detector.detectForVideo(video, timestamp()), { x: 0, y: 0, width, height }, width, height); }
    catch { return []; }
    if (full.length || !allowTiles) return full;
    const rectangles = tileRectangles(width, height);
    if (!rectangles.length) return full;
    const found = [];
    try {
      if (!canvas) { canvas = createCanvas(); context = canvas?.getContext('2d', { alpha: false }); }
      if (!context) return full;
      for (let tile = 0; tile < rectangles.length; tile++) {
        const rect = rectangles[tile];
        try {
          canvas.width = rect.width; canvas.height = rect.height;
          context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
          const boxes = normalize(detector.detectForVideo(canvas, timestamp()), rect, width, height);
          found.push(...boxes.map(box => ({ box, tile })));
        } catch { /* A failing tile leaves other observations usable; no guessed box. */ }
      }
    } catch { return full; }
    finally {
      // Reuse the canvas object, but do not retain this video frame's pixels.
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
    const kept = [];
    for (const candidate of found.sort((a, b) => b.box.score - a.box.score)) {
      // Only suppress duplicate views across tiles; two people detected in one
      // tile remain distinct so downstream ambiguity handling is preserved.
      if (!kept.some(other => other.tile !== candidate.tile
          && intersectionOverUnion(other.box, candidate.box) >= DUPLICATE_IOU)) kept.push(candidate);
    }
    return kept.map(item => item.box);
  };
  // Scout planning can commit an entire clip to the original full-frame track.
  // Both entry points share the model clock, including when mixed in one pass.
  detectPersons.fullFrame = video => detectPersons(video, { allowTiles: false });
  return detectPersons;
}
