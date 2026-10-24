import { getScoutFrameTimes, getAdaptiveFrameTimes } from './frame-sampling.js?v=0.12.0';
import { planSubjectCrops, estimateAirborneWindow, estimateSubjectWindow } from './subject-crop.js?v=0.12.0';
import { encodeFrame, getFrameByteBudget } from './frame-encoding.js';

const checkAbort = signal => { if (signal?.aborted) throw new DOMException('画面提取已取消。', 'AbortError'); };
const yieldControl = () => new Promise(resolve => setTimeout(resolve, 0));

/** All detection/cropping stays on the device. Only the returned single image
 * sequence is sent to the provider. Three short passes avoid retaining decoded
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
  const observations = new Map();
  const progress = (phase, completed, total) => { onProgress({ phase, completed, total }); };
  async function observe(time) {
    checkAbort(signal);
    await seek(video, start + time, signal);
    checkAbort(signal);
    let detections = [];
    if (typeof detectPersons === 'function') {
      try { detections = await detectPersons(video); }
      catch (error) { checkAbort(signal); detections = []; }
    }
    checkAbort(signal);
    const observation = { time, detections: Array.isArray(detections) ? detections : [] };
    observations.set(time, observation);
    return observation;
  }
  if (typeof detectPersons === 'function') {
    for (let i = 0; i < scoutTimes.length; i++) {
      await observe(scoutTimes[i]); progress('scout', i + 1, scoutTimes.length);
      await yieldTask(); checkAbort(signal);
    }
  }
  const candidate = estimateAirborneWindow([...observations.values()], { duration });
  const visibleWindow = candidate || estimateSubjectWindow([...observations.values()], { duration });
  const sampling = getAdaptiveFrameTimes(duration, visibleWindow ? { window: visibleWindow } : {});
  for (let i = 0; i < sampling.times.length; i++) {
    const time = sampling.times[i];
    if (!observations.has(time)) await observe(time);
    progress('locate', i + 1, sampling.times.length);
    await yieldTask(); checkAbort(signal);
  }
  const ordered = [...observations.values()].sort((a, b) => a.time - b.time);
  const plan = planSubjectCrops(ordered, { width: video.videoWidth, height: video.videoHeight });
  const byTime = new Map(plan.frames.map(frame => [frame.time, frame]));
  const canvas = createCanvas(), context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法准备视频画面，请重新打开页面后重试。');
  const frameBudget = getFrameByteBudget({ frameCount: sampling.times.length, maxBodyBytes, maxFrameBytes });
  const frames = [];
  for (let i = 0; i < sampling.times.length; i++) {
    const time = sampling.times[i];
    checkAbort(signal); await seek(video, start + time, signal); checkAbort(signal);
    const rect = byTime.get(time)?.rect;
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
    preparation: { scoutCount: typeof detectPersons === 'function' ? scoutTimes.length : 0,
      beforeFrameCount: sampling.beforeFrameCount, denseFrameCount: sampling.denseFrameCount,
      afterFrameCount: sampling.afterFrameCount, denseFps: sampling.denseFps },
  };
}
