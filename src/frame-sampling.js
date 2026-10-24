/** Frame timestamps for one short analysis clip, in seconds. */
export const MAX_ANALYSIS_FRAMES = 96;
export const TARGET_ANALYSIS_FPS = 12;

export function getFrameTimes(duration) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0.5 || duration > 60) {
    throw new RangeError('Analysis duration must be a finite number from 0.5 to 60 seconds.');
  }
  const count = Math.min(MAX_ANALYSIS_FRAMES, Math.max(8, Math.ceil(duration * TARGET_ANALYSIS_FPS)));
  const start = 0.01;
  // Quantize the upper bound down so rounding never seeks beyond the permitted
  // endpoint when an imported clip has a duration with sub-millisecond digits.
  const upperBound = duration - 0.12;
  let endTicks = Math.round(upperBound * 1000);
  if (endTicks / 1000 > upperBound) endTicks--;
  const end = endTicks / 1000;
  return Array.from({ length: count }, (_, index) =>
    Number((start + (end - start) * index / (count - 1)).toFixed(3)));
}

function getSamplingBounds(duration) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0.5 || duration > 60) {
    throw new RangeError('Analysis duration must be a finite number from 0.5 to 60 seconds.');
  }
  const upperBound = duration - 0.12;
  let endTicks = Math.round(upperBound * 1000);
  if (endTicks / 1000 > upperBound) endTicks--;
  return { startTicks: 10, endTicks };
}

function sampleTicks(startTicks, endTicks, count) {
  if (!count) return [];
  if (count === 1) return [startTicks / 1000];
  return Array.from({ length: count }, (_, index) =>
    Math.round(startTicks + (endTicks - startTicks) * index / (count - 1)) / 1000);
}

/** Low-resolution local scouting; these timestamps are not a detected jump. */
export function getScoutFrameTimes(duration) {
  const { startTicks, endTicks } = getSamplingBounds(duration);
  const count = Math.min(320, Math.max(2, Math.ceil(duration * 8)));
  return sampleTicks(startTicks, endTicks, count);
}

/** One nonuniform analysis sequence with more frames in a candidate air window. */
export function getAdaptiveFrameTimes(duration, { window } = {}) {
  const { startTicks, endTicks } = getSamplingBounds(duration);
  const provided = window !== undefined;
  if (provided && (!window || typeof window !== 'object' || Array.isArray(window)
    || typeof window.start !== 'number' || !Number.isFinite(window.start)
    || typeof window.end !== 'number' || !Number.isFinite(window.end)
    || window.start < 0 || window.end > duration || window.start >= window.end)) {
    throw new RangeError('The candidate window must have finite start < end within the video.');
  }
  const start = startTicks / 1000;
  const end = endTicks / 1000;
  const candidate = provided ? window : {
    start: start + (end - start) * 0.35,
    end: start + (end - start) * 0.85,
  };
  const candidateStart = Math.max(start, candidate.start);
  const candidateEnd = Math.min(end, candidate.end);
  if (candidateStart >= candidateEnd) {
    throw new RangeError('The candidate window must overlap the seekable video range.');
  }
  // Expand to millisecond boundaries so even a narrow local estimate is kept.
  const denseStartTicks = Math.max(startTicks, Math.floor(candidateStart * 1000));
  const denseEndTicks = Math.min(endTicks, Math.ceil(candidateEnd * 1000));
  const denseSpanTicks = denseEndTicks - denseStartTicks;
  const beforeSpanTicks = denseStartTicks - startTicks;
  const afterSpanTicks = endTicks - denseEndTicks;
  const counts = {
    dense: Math.min(64, Math.max(2, Math.floor(denseSpanTicks * 24 / 1000) + 1)),
    before: 0,
    after: 0,
  };
  const denseFps = (counts.dense - 1) * 1000 / denseSpanTicks;
  // A capped long window can be below 24 fps. Keep context sparser in that case.
  const targetContextFps = Math.min(2, denseFps / 2);
  counts.before = beforeSpanTicks ? Math.min(16, Math.max(1, Math.floor(beforeSpanTicks * targetContextFps / 1000))) : 0;
  counts.after = afterSpanTicks ? Math.min(16, Math.max(1, Math.floor(afterSpanTicks * targetContextFps / 1000))) : 0;
  // Tiny windows in short clips may otherwise yield only three timestamps.
  // Add available millisecond positions without duplicating segment boundaries.
  while (counts.dense + counts.before + counts.after < 4) {
    if (counts.dense < Math.min(64, denseSpanTicks + 1)) counts.dense++;
    else if (counts.before < Math.min(16, beforeSpanTicks)) counts.before++;
    else counts.after++;
  }
  const before = counts.before
    ? sampleTicks(startTicks, denseStartTicks, counts.before + 1).slice(0, -1) : [];
  const dense = sampleTicks(denseStartTicks, denseEndTicks, counts.dense);
  const after = counts.after
    ? sampleTicks(denseEndTicks, endTicks, counts.after + 1).slice(1) : [];
  const times = [...before, ...dense, ...after];
  return {
    times,
    denseWindow: { start: denseStartTicks / 1000, end: denseEndTicks / 1000 },
    windowSource: provided ? 'provided' : 'fallback',
    frameCount: times.length,
    beforeFrameCount: before.length,
    denseFrameCount: dense.length,
    afterFrameCount: after.length,
    denseFps: (dense.length - 1) * 1000 / denseSpanTicks,
    targetContextFps,
  };
}
