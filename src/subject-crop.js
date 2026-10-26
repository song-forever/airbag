/** Per-timestamp crops for one sequence of sampled images, with full-frame fallback.
 * A person box is not a snowboard detector: padding preserves conservative
 * space for hands and board, but cannot guarantee that either was detected.
 */
const MIN_SCORE = 0.38;
const MAX_GAP = 0.5;
const EPSILON = 1e-9;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const area = box => box.width * box.height;
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
function union(boxes) {
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}
function iou(a, b) {
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlap / Math.max(1, area(a) + area(b) - overlap);
}
function pixelBox(raw, width, height) {
  if (!object(raw) || ![raw.x, raw.y, raw.w, raw.h, raw.score].every(Number.isFinite)
      || raw.w <= 0 || raw.h <= 0 || raw.score < MIN_SCORE || raw.score > 1
      || raw.x < -EPSILON || raw.y < -EPSILON || raw.x + raw.w > 1 + EPSILON || raw.y + raw.h > 1 + EPSILON) return null;
  const x = clamp(raw.x, 0, 1) * width, y = clamp(raw.y, 0, 1) * height;
  return { x, y, width: Math.min(width - x, raw.w * width), height: Math.min(height - y, raw.h * height), score: raw.score };
}
function seed(boxes) {
  const ranked = [...boxes].sort((a, b) => area(b) * b.score - area(a) * a.score);
  const first = ranked[0];
  if (!first || first.score < 0.5) return null;
  if (ranked.length > 1 && (first.score < 0.6 || area(first) * first.score < area(ranked[1]) * ranked[1].score * 2)) return null;
  return first;
}
function associate(boxes, previous, time, velocity, diagonal) {
  const dt = time - previous.time;
  if (dt > MAX_GAP + EPSILON) return { box: null, ambiguous: false };
  const old = previous.box, oldCenter = center(old);
  const predicted = { x: oldCenter.x + velocity.x * dt, y: oldCenter.y + velocity.y * dt };
  const ranked = [];
  for (const box of boxes) {
    const hr = box.height / old.height, wr = box.width / old.width, overlap = iou(box, old);
    if (hr < 0.45 || hr > 2.2 || wr < 0.35 || wr > 2.8) continue;
    // A large scale jump needs actual overlap; a nearby new foreground person
    // cannot replace the target solely because it is larger or scores higher.
    if ((hr > 1.7 || wr > 1.9) && overlap < 0.25) continue;
    const gate = Math.max(diagonal * 0.03, Math.max(old.height, box.height) * 0.6) * (1 + dt);
    // At the top of an arc velocity reverses. Strong direct overlap can
    // corroborate the same subject even when constant-velocity prediction is
    // briefly wrong; otherwise prediction still controls association.
    const d = overlap >= 0.15 ? Math.min(distance(center(box), predicted), distance(center(box), oldCenter)) : distance(center(box), predicted);
    if (d > gate || (overlap < 0.02 && d > gate * 0.65)) continue;
    const cost = d / gate + Math.abs(Math.log(hr)) * 0.3 + Math.abs(Math.log(wr)) * 0.15 - overlap * 0.5 - box.score * 0.1;
    ranked.push({ box, cost });
  }
  ranked.sort((a, b) => a.cost - b.cost);
  if (ranked.length > 1 && ranked[1].cost - ranked[0].cost < 0.2) return { box: null, ambiguous: true };
  return { box: ranked[0]?.box ?? null, ambiguous: false };
}
function cropRect(box, referenceHeight, width, height) {
  const side = Math.max(referenceHeight * 0.12, width * 0.015, 8);
  const top = Math.max(referenceHeight * 0.06, height * 0.01, 4);
  const bottom = Math.max(referenceHeight * 0.22, height * 0.02, 8);
  const cropWidth = Math.ceil(box.width + side * 2), cropHeight = Math.ceil(box.height + top + bottom);
  if (cropWidth > width || cropHeight > height) return { rect: null, reason: 'bounds' };
  // Translate the intact window into the source image; do not squeeze its
  // dimensions at an edge. Outside the source, no missing limb can be restored.
  const x = Math.floor(clamp(box.x - side, 0, width - cropWidth));
  const y = Math.floor(clamp(box.y - top, 0, height - cropHeight));
  if (x > box.x || y > box.y || x + cropWidth + EPSILON < box.x + box.width || y + cropHeight + EPSILON < box.y + box.height) return { rect: null, reason: 'bounds' };
  if (cropWidth * cropHeight >= width * height * 0.65) return { rect: null, reason: 'noGain' };
  return { rect: { x, y, width: cropWidth, height: cropHeight }, reason: null };
}
function validateObservations(observations) {
  if (!Array.isArray(observations) || observations.some((item, index) => !object(item) || !Number.isFinite(item.time) || item.time < 0
      || (index > 0 && item.time <= observations[index - 1].time))) throw new RangeError('Observation times must be finite, nonnegative and strictly increasing.');
}
function trackObservations(observations, width, height) {
  const stats = { observations: observations.length, ignoredDetections: 0, detected: 0, interpolated: 0, ambiguous: 0, untracked: 0, omittedBounds: 0, omittedNoGain: 0, cropped: 0, full: 0 };
  const states = observations.map(item => {
    const detections = Array.isArray(item.detections) ? item.detections : [];
    const boxes = detections.map(raw => pixelBox(raw, width, height)).filter(Boolean);
    stats.ignoredDetections += detections.length - boxes.length;
    return { time: item.time, boxes, box: null, ambiguous: false, source: null };
  });
  const recent=[];
  let velocitySamples = 0, velocityAnchor = null;
  let previous = null, velocity = { x: 0, y: 0 }, initialized = false;
  for (const state of states) {
    if (!initialized) {
      state.box = seed(state.boxes);
      state.ambiguous = !state.box && state.boxes.length > 1;
      if (state.box) initialized = true;
    } else if (previous) {
      let matched = associate(state.boxes, previous, state.time, velocity, Math.hypot(width, height));
      // A detector can briefly return only part of the same body. Compare a
      // rebound with recent full boxes, never across a long gap or an ambiguous
      // frame. The restored size must remain close to that earlier body.
      if(!matched.box&&!matched.ambiguous&&state.boxes.length===1){
       const candidate=state.boxes[0];
       for(const reference of [...recent].reverse()){
        if(state.time-reference.time>MAX_GAP+EPSILON)break;
        const wasPartial=previous.box.height<reference.box.height*.75||previous.box.width<reference.box.width*.7;
        const hr=candidate.height/reference.box.height,wr=candidate.width/reference.box.width;
        if(!wasPartial||hr<.7||hr>1.4||wr<.6||wr>1.6||iou(previous.box,reference.box)<.1)continue;
        const recovered=associate(state.boxes,reference,state.time,{x:0,y:0},Math.hypot(width,height));
        if(recovered.box){matched=recovered;break;}
       }
      }
      state.box = matched.box; state.ambiguous = matched.ambiguous;
    }
    if (state.ambiguous) stats.ambiguous++;
    if (!state.box) continue;
    // Nearby sample times may decode the same frame; estimate speed over a
    // useful interval instead of amplifying box jitter or repeatedly zeroing it.
    if (velocityAnchor && state.time - velocityAnchor.time >= 0.08) {
      const a = center(velocityAnchor.box), b = center(state.box), dt = state.time - velocityAnchor.time;
      const weight = velocitySamples === 0 ? 1 : 0.5;
      velocity = { x: velocity.x * (1 - weight) + (b.x - a.x) / dt * weight, y: velocity.y * (1 - weight) + (b.y - a.y) / dt * weight };
      velocityAnchor = state; velocitySamples++;
    }
    if (!velocityAnchor) velocityAnchor = state;
    state.source = 'detected'; previous = state;recent.push(state);
    while(recent.length&&state.time-recent[0].time>MAX_GAP+EPSILON)recent.shift();
  }
  const reliable = states.filter(state => state.source === 'detected');
  // A lone detection does not establish a trajectory or identity.
  if (reliable.length >= 2) for (let i = 0; i < reliable.length - 1; i++) {
    const a = reliable[i], b = reliable[i + 1], gap = b.time - a.time;
    if (gap > MAX_GAP + EPSILON) continue;
    const middle = states.filter(state => state.time > a.time && state.time < b.time);
    if (middle.some(state => state.ambiguous)) continue;
    for (const state of middle) {
      state.box = union([a.box, b.box]); state.source = 'interpolated';
      // The full union of both observed endpoints, not a narrow interpolated
      // body rectangle, preserves room for unobserved intermediate movement.
      state.endpointHeight = Math.max(a.box.height, b.box.height);
    }
  }
  return { states, reliable, stats };
}

/** One result per input timestamp. A null rect means use the complete frame.
 * Nearby reliable boxes stabilize framing locally without making a whole-clip
 * union that would include the large person at the start of the run.
 */
export function planSubjectCrops(observations, { width, height } = {}) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new RangeError('Invalid crop dimensions.');
  validateObservations(observations);
  const { states, reliable, stats } = trackObservations(observations, width, height);
  const frames = [];
  for (const state of states) {
    const full = () => { stats.full++; frames.push({ time: state.time, rect: null, source: 'full' }); };
    if (!state.source || reliable.length < 2) { stats.untracked++; full(); continue; }
    stats[state.source]++;
    const neighbors = reliable.filter(other => Math.abs(other.time - state.time) <= 0.35 + EPSILON).map(other => other.box.height);
    const referenceHeight = Math.max(state.endpointHeight ?? state.box.height, neighbors.length ? median(neighbors) : 0);
    const close = reliable.filter(other => Math.abs(other.time - state.time) <= 0.2 + EPSILON).map(other => other.box);
    const localUnion = union([state.box, ...close]);
    const { rect, reason } = cropRect(localUnion, referenceHeight, width, height);
    if (!rect) { stats[reason === 'bounds' ? 'omittedBounds' : 'omittedNoGain']++; full(); continue; }
    stats.cropped++;
    frames.push({ time: state.time, rect, source: state.source });
  }
  return { frames, stats };
}

/** Heuristic dense-sampling candidate, never an exact takeoff/landing marker.
 * Requires fresh, associated far-end boxes on BOTH sides of a visible vertical
 * reversal. Missing detections do not themselves establish a peak or a fall.
 */
export function estimateAirborneWindow(observations, { duration } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  try { validateObservations(observations); } catch { return null; }
  if (observations.length < 5 || observations.some(item => item.time > duration + EPSILON)) return null;
  // Fixed virtual dimensions retain normalized coordinates for this geometry
  // heuristic; crop planning itself always uses the actual pixel dimensions.
  const { states, reliable } = trackObservations(observations, 1000, 1000);
  const peaks = [];
  const cy = item => center(item.box).y / 1000;
  for (let index = 2; index < reliable.length - 2; index++) {
    const peak = reliable[index], h = peak.box.height / 1000, w = peak.box.width / 1000;
    if (peak.box.score < 0.45 || h < 0.025 || h > 0.30 || w < 0.015 || w > 0.35 || h * w > 0.09) continue;
    const left = reliable.filter(item => item.time < peak.time && item.time >= peak.time - 1.1 - EPSILON);
    const right = reliable.filter(item => item.time > peak.time && item.time <= peak.time + 1.1 + EPSILON);
    if (left.length < 2 || right.length < 2) continue;
    const nearby = [...left, peak, ...right];
    if (states.some(item => item.ambiguous && item.time >= nearby[0].time && item.time <= nearby.at(-1).time)) continue;
    if (nearby.some((item, i) => i > 0 && item.time - nearby[i - 1].time > MAX_GAP + EPSILON)) continue;
    if (nearby.some(item => cy(item) < cy(peak) - 0.008)) continue;
    const minimumAmplitude = Math.max(0.04, h * 0.25);
    const rise = Math.max(...left.map(cy)) - cy(peak), fall = Math.max(...right.map(cy)) - cy(peak);
    if (rise < minimumAmplitude || fall < minimumAmplitude) continue;
    const before = [...left, peak], after = [peak, ...right];
    const upSteps = before.slice(1).map((item, i) => cy(before[i]) - cy(item));
    const downSteps = after.slice(1).map((item, i) => cy(item) - cy(after[i]));
    if (upSteps.filter(delta => delta >= 0.006).length < 2 || downSteps.filter(delta => delta >= 0.006).length < 2
        || upSteps.some(delta => delta < -0.02) || downSteps.some(delta => delta < -0.02)) continue;
    // A crouch can move a person box's center. Require actual upper/lower box
    // boundaries to reverse too, rather than relying on height shrinkage alone.
    const top = item => item.box.y / 1000, bottom = item => (item.box.y + item.box.height) / 1000;
    if (Math.max(...left.map(top)) - top(peak) < 0.02 || Math.max(...right.map(top)) - top(peak) < 0.02
        || Math.max(...left.map(bottom)) - bottom(peak) < 0.02 || Math.max(...right.map(bottom)) - bottom(peak) < 0.02) continue;
    peaks.push({ peak, prominence: Math.min(rise, fall) });
  }
  peaks.sort((a, b) => b.prominence - a.prominence || cy(a.peak) - cy(b.peak) || a.peak.time - b.peak.time);
  if (!peaks.length) return null;
  const best = peaks[0];
  if (peaks.some(item => Math.abs(item.peak.time - best.peak.time) > 0.6 && item.prominence >= best.prominence * 0.75)) return null;
  return {
    start: Number(Math.max(0, best.peak.time - 0.8).toFixed(3)),
    end: Number(Math.min(duration, best.peak.time + 1).toFixed(3)),
    peakTime: best.peak.time,
  };
}

/** A visible-subject interval for sampling when an arc cannot be established.
 * This is deliberately a fallback, not a takeoff/landing classification.
 */
export function estimateSubjectWindow(observations, { duration } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  try { validateObservations(observations); } catch { return null; }
  if (observations.some(item => item.time > duration + EPSILON)) return null;
  const { states, reliable } = trackObservations(observations, 1000, 1000);
  if (reliable.length < 3 || reliable.at(-1).time - reliable[0].time < 0.25) return null;
  // A disconnected early track does not establish the full visible interval.
  // Later detections may be the same rider after a camera/scale change or a
  // different person. Keep the clip-wide fallback instead of discarding them.
  if(states.some(state=>state.time>reliable.at(-1).time+0.35+EPSILON&&state.boxes.length))return null;
  return {
    start: Number(Math.max(0, reliable[0].time - 0.2).toFixed(3)),
    end: Number(Math.min(duration, reliable.at(-1).time + 0.35).toFixed(3)),
  };
}
