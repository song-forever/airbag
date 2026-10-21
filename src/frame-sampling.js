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
