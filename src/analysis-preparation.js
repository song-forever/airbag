import { getScoutFrameTimes, getAdaptiveFrameTimes } from './frame-sampling.js?v=0.16.2';
import { planSubjectCrops, estimateAirborneWindow, estimateSubjectWindow } from './subject-crop.js?v=0.13.1';
import { encodeFrame, getFrameByteBudget } from './frame-encoding.js';
import { createMotionScout, estimateMotionEpisode } from './sampling-motion.js?v=0.16.2';

const checkAbort = signal => { if (signal?.aborted) throw new DOMException('画面提取已取消。', 'AbortError'); };
const yieldControl = () => new Promise(resolve => setTimeout(resolve, 0));

function fixedDenseCrops(byTime, times, window, width, height) {
  const crops = new Map();
  let run = [];
  function finishRun() {
    // Keep scale constant within a useful tracked span while following its
    // translation. A missing/ambiguous timestamp never inherits a nearby crop.
    if (run.length >= 3 && run.at(-1).time - run[0].time >= .08 - 1e-9) {
      const cropWidth = Math.max(...run.map(frame => frame.rect.width));
      const cropHeight = Math.max(...run.map(frame => frame.rect.height));
      if (cropWidth * cropHeight < width * height * .65) {
        for (const frame of run) {
          const original = frame.rect;
          const x = Math.floor(Math.max(0, Math.min(width - cropWidth, original.x + (original.width - cropWidth) / 2)));
          const y = Math.floor(Math.max(0, Math.min(height - cropHeight, original.y + (original.height - cropHeight) / 2)));
          // Translate the intact common-size rectangle into source bounds.
          // If containment ever fails, retain the complete source frame.
          if (x > original.x + 1e-9 || y > original.y + 1e-9
              || x + cropWidth + 1e-9 < original.x + original.width
              || y + cropHeight + 1e-9 < original.y + original.height) continue;
          crops.set(frame.time, { x, y, width: cropWidth, height: cropHeight });
        }
      }
    }
    run = [];
  }
  for (const time of times) {
    if (time < window.start || time > window.end) continue;
    const frame = byTime.get(time);
    if (frame?.rect) run.push(frame);
    else finishRun();
  }
  finishRun();
  return crops;
}

function fullViewAnchors(times, window) {
  const before = times.findLast(time => time < window.start) ?? times[0];
  const after = times.find(time => time > window.end) ?? times.at(-1);
  const center = (window.start + window.end) / 2;
  const middle = times.filter(time => time !== before && time !== after)
    .reduce((best, time) => Math.abs(time - center) < Math.abs(best - center) ? time : best);
  return new Set([before, middle, after]);
}

/** All detection/cropping stays on the device. Only the returned single image
 * sequence is sent to the provider. Short passes avoid retaining decoded
 * full-resolution images in memory on an iPhone.
 */
export async function prepareAnalysisFrames(video, {
  start = 0, end = video.duration, signal, seek, detectPersons,
  createCanvas = () => document.createElement('canvas'),
  onProgress = () => {}, maxBodyBytes = 15 * 1024 * 1024, maxFrameBytes = 500 * 1024,
  encode = encodeFrame, yieldTask = yieldControl,
} = {}) {
  checkAbort(signal);
  const duration = end - start;
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end > video.duration + .001
      || !Number.isInteger(video.videoWidth) || !Number.isInteger(video.videoHeight)
      || video.videoWidth <= 0 || video.videoHeight <= 0 || typeof seek !== 'function') throw new RangeError('Invalid video analysis input');
  const scoutTimes = getScoutFrameTimes(duration);
  let observations = new Map();
  const hasDetector = typeof detectPersons === 'function';
  const fullFrameDetector = hasDetector && typeof detectPersons.fullFrame === 'function'
    ? detectPersons.fullFrame.bind(detectPersons) : null;
  let activeDetector = fullFrameDetector || (hasDetector ? detectPersons : null);
  let scoutCount = 0;
  const progress = (phase, completed, total) => { onProgress({ phase, completed, total }); };
  async function observe(time) {
    checkAbort(signal);
    await seek(video, start + time, signal);
    checkAbort(signal);
    let detections = [];
    if (typeof activeDetector === 'function') {
      try { detections = await activeDetector(video); }
      catch (error) { checkAbort(signal); detections = []; }
    }
    checkAbort(signal);
    const observation = { time, detections: Array.isArray(detections) ? detections : [] };
    observations.set(time, observation);
    return observation;
  }
  const motionScout = createMotionScout({ createCanvas }), motionObservations = [];
  async function scout(total, collectMotion = false) {
    for (let i = 0; i < scoutTimes.length; i++) {
      await observe(scoutTimes[i]);
      if (collectMotion) {
        const motion = motionScout.observe(video, scoutTimes[i]);
        if (motion) motionObservations.push(motion);
      }
      scoutCount++; progress('scout', scoutCount, total);
      await yieldTask(); checkAbort(signal);
    }
  }
  function trackedScoutCount() {
    const { stats } = planSubjectCrops([...observations.values()], { width: video.videoWidth, height: video.videoHeight });
    return stats.detected + stats.interpolated;
  }
  try {
    await scout(scoutTimes.length, true);
  } finally { motionScout.dispose(); }
  if (hasDetector) {
    if (fullFrameDetector) {
      const fullObservations = observations, fullTracked = trackedScoutCount();
      // Preserve an established full-view trajectory. Tiled detections may
      // otherwise seed a different foreground subject before the actual jump.
      if (fullTracked < 3) {
        observations = new Map(); activeDetector = detectPersons;
        await scout(scoutTimes.length * 2);
        if (trackedScoutCount() <= fullTracked) {
          observations = fullObservations; activeDetector = fullFrameDetector;
        }
      }
    }
  }
  // An arc candidate guides sampling density, not exact takeoff/landing times.
  // A visibility track may end before flight; disappearance is not its ending.
  const candidate = estimateAirborneWindow([...observations.values()], { duration });
  const visibleWindow = candidate ? null : estimateSubjectWindow([...observations.values()], { duration });
  const motionWindow = candidate || visibleWindow ? null : estimateMotionEpisode(motionObservations, { duration }).window;
  const window = candidate || (visibleWindow ? {
    start: Math.max(0, visibleWindow.start - .6),
    end: Math.min(duration, visibleWindow.end + 1.65),
  } : motionWindow);
  // With no reliable window, retain the complete seekable clip rather than
  // assuming that its middle contains the jump. The dense-frame cap still holds.
  const sampling = getAdaptiveFrameTimes(duration, window ? { window } : {});
  for (let i = 0; i < sampling.times.length; i++) {
    const time = sampling.times[i];
    if (!observations.has(time)) await observe(time);
    progress('locate', i + 1, sampling.times.length);
    await yieldTask(); checkAbort(signal);
  }
  const ordered = [...observations.values()].sort((a, b) => a.time - b.time);
  const plan = planSubjectCrops(ordered, { width: video.videoWidth, height: video.videoHeight });
  const byTime = new Map(plan.frames.map(frame => [frame.time, frame]));
  const denseCrops = fixedDenseCrops(byTime, sampling.times, sampling.denseWindow, video.videoWidth, video.videoHeight);
  const anchors = fullViewAnchors(sampling.times, sampling.denseWindow);
  const canvas = createCanvas(), context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法准备视频画面，请重新打开页面后重试。');
  const frameBudget = getFrameByteBudget({ frameCount: sampling.times.length, maxBodyBytes, maxFrameBytes });
  const frames = [];
  for (let i = 0; i < sampling.times.length; i++) {
    const time = sampling.times[i];
    checkAbort(signal); await seek(video, start + time, signal); checkAbort(signal);
    const inDenseWindow = time >= sampling.denseWindow.start && time <= sampling.denseWindow.end;
    const rect = anchors.has(time) ? null : inDenseWindow ? denseCrops.get(time) : byTime.get(time)?.rect;
    const source = rect || { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    // A bounded image size keeps up to 96 images within the older models'
    // context limits. Enlargement changes presentation, not source detail.
    const scale = 512 / Math.max(source.width, source.height);
    canvas.width = Math.max(12, Math.round(source.width * scale));
    canvas.height = Math.max(12, Math.round(source.height * scale));
    context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    const dataUrl = await encode(canvas, { maxBytes: frameBudget, createCanvas, signal, yieldControl: yieldTask });
    checkAbort(signal);
    frames.push({ time, dataUrl, ...(rect ? { crop: { ...rect, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight } } : {}) });
    progress('encode', i + 1, sampling.times.length);
    await yieldTask(); checkAbort(signal);
  }
  return {
    frames,
    samplingMetadata: {
      strategy: 'adaptive-subject-crop', denseWindow: sampling.denseWindow,
      windowSource: candidate ? 'detected' : 'fallback',
      croppedFrameCount: frames.filter(frame => frame.crop).length,
    },
    preparation: { scoutCount,
      windowKind: candidate ? 'arc' : visibleWindow ? 'subject' : motionWindow ? 'motion' : 'clip',
      beforeFrameCount: sampling.beforeFrameCount, denseFrameCount: sampling.denseFrameCount,
      afterFrameCount: sampling.afterFrameCount, denseFps: sampling.denseFps },
  };
}
