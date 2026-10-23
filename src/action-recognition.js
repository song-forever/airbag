const TIME_TOLERANCE = 0.001001;
const FEATURE_STATES = ['yes', 'no', 'uncertain'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeEvidence(raw, timestamps) {
  if (!Array.isArray(raw) || raw.length > 4) return null;
  const normalized = [];
  let previousInputTime = -Infinity, previousFrameTime = -Infinity;
  for (const item of raw) {
    if (!object(item) || typeof item.time !== 'number' || !Number.isFinite(item.time)
        || typeof item.observation !== 'string') return null;
    const observation = item.observation.trim();
    const time = timestamps.find(timestamp => Math.abs(timestamp - item.time) <= TIME_TOLERANCE);
    if (!observation || observation.length > 160 || time === undefined
        || item.time <= previousInputTime || time <= previousFrameTime) return null;
    normalized.push({ time, observation });
    previousInputTime = item.time;
    previousFrameTime = time;
  }
  return normalized;
}

function normalizeFeature(raw, timestamps, minimumYes) {
  const incomplete = () => ({ feature: { state: 'uncertain', evidence: [] }, incomplete: true });
  if (!object(raw)) return incomplete();
  const evidence = normalizeEvidence(raw.evidence, timestamps);
  // One invalid entry invalidates the entire feature's evidence; never salvage
  // selected entries into a confident claim.
  if (evidence === null) return incomplete();
  const knownState = FEATURE_STATES.includes(raw.state);
  const state = knownState ? raw.state : 'uncertain';
  const minimum = state === 'yes' ? minimumYes : state === 'no' ? 2 : 0;
  const enoughEvidence = evidence.length >= minimum;
  return { feature: { state: enoughEvidence ? state : 'uncertain', evidence }, incomplete: !knownState || !enoughEvidence };
}

function describeFeatures(rotation, grab) {
  const rotationText = {
    yes: '多帧观察支持转体特征',
    no: '多帧观察未显示转体特征',
    uncertain: '转体特征尚无法确认',
  };
  const grabText = {
    yes: '观察支持抓板特征',
    no: '多帧观察未显示抓板特征',
    uncertain: '抓板特征尚无法确认',
  };
  return rotationText[rotation.state] + '；' + grabText[grab.state] + '。';
}

/**
 * Derive a broad action category from bounded, timestamp-anchored model evidence.
 * This validates a model's evidence structure, not the underlying visual claim.
 * Supplied labels, descriptions and summary timestamps are deliberately ignored.
 */
export function deriveRecognizedAction(raw, frames) {
  const input = object(raw) ? raw : {};
  const timestamps = Array.isArray(frames)
    ? frames.filter(frame => object(frame) && typeof frame.time === 'number' && Number.isFinite(frame.time)).map(frame => frame.time)
    : [];
  const normalizedRotation = normalizeFeature(input.rotation, timestamps, 2);
  const normalizedGrab = normalizeFeature(input.grab, timestamps, 1);
  const rotation = normalizedRotation.feature, grab = normalizedGrab.feature;
  const features = { rotation, grab };
  let evidenceIncomplete = normalizedRotation.incomplete || normalizedGrab.incomplete;
  let type = '无法判断', description = describeFeatures(rotation, grab), otherAction = null;

  if (Object.hasOwn(input, 'otherAction') && input.otherAction !== null) {
    const evidence = object(input.otherAction) ? normalizeEvidence(input.otherAction.evidence, timestamps) : null;
    if (evidence !== null && evidence.length >= 2) {
      type = '其他';
      otherAction = { evidence };
      description = '多帧证据记录了直飞、抓板、转体、转体抓板以外的可见动作。';
    } else {
      description = '其他动作的证据不足，暂不作动作分类。';
      evidenceIncomplete = true;
    }
  } else if (rotation.state !== 'uncertain' && grab.state !== 'uncertain') {
    type = rotation.state === 'yes'
      ? grab.state === 'yes' ? '转体抓板' : '转体'
      : grab.state === 'yes' ? '抓板' : '直飞';
  }

  const retained = otherAction?.evidence ?? [...rotation.evidence, ...grab.evidence];
  const time = retained.length ? Math.max(...retained.map(item => item.time)) : null;
  return { type, description, time, features, otherAction, evidenceIncomplete };
}
