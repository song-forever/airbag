import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrames } from '../src/analysis-client.js';
import { deriveRecognizedAction } from '../src/action-recognition.js';

const evidence = (times = [0, 1.5], observation = '身体与雪板保持可见朝向。') => times.map(time => ({ time, observation }));
const feature = (state, times = [0, 1.5]) => ({ state, evidence: evidence(times) });
const features = (rotation = 'no', grab = 'no') => ({ rotation: feature(rotation), grab: feature(grab) });
const frames = [0, 1.5, 3.7, 4.2].map(time => ({ time }));

test('automatic analysis derives straight air from validated features instead of trusting a claimed rotation label', async () => {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]).toString('base64');
  const modelAnswer = {
    recognizedAction: { type: '转体', description: '模型声称已经转体。', time: 3.7, ...features() },
    stages: ['助滑', '上台', '起跳', '腾空'].map(phase => ({ phase, analysis: '本阶段可见动作表现。', time: null })),
    nextJump: { instruction: '继续保持肩线平稳。', reason: '当前可见肩线平稳。', check: '肩线是否同样平稳。', time: 1.5 },
    followUp: null,
  };
  const result = await analyzeFrames({
    apiKey: 'sk-test-only-not-a-real-key-12345', model: 'qwen3-vl-plus', actionMode: 'auto', duration: 6.2,
    frames: frames.map(frame => ({ ...frame, dataUrl: jpeg })),
  }, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelAnswer) } }] })) });
  assert.equal(result.analysis.recognizedAction.type, '直飞');
  assert.ok(!result.analysis.recognizedAction.description.includes('已经转体'));
});

test('only two determined features produce one of the four broad practice action types', () => {
  for (const [rotation, grab, type] of [
    ['no', 'no', '直飞'], ['no', 'yes', '抓板'], ['yes', 'no', '转体'], ['yes', 'yes', '转体抓板'],
    ['uncertain', 'no', '无法判断'], ['uncertain', 'yes', '无法判断'], ['no', 'uncertain', '无法判断'],
    ['yes', 'uncertain', '无法判断'], ['uncertain', 'uncertain', '无法判断'],
  ]) {
    const result = deriveRecognizedAction(features(rotation, grab), frames);
    assert.equal(result.type, type, rotation + '/' + grab);
    assert.deepEqual(result.features, features(rotation, grab));
    assert.equal(result.time, 1.5);
    assert.equal(result.otherAction, null);
    assert.equal(result.evidenceIncomplete, false);
  }
});

test('positive and negative rotation need two distinct frames; one visible grab frame can establish grab presence', () => {
  for (const state of ['yes', 'no']) {
    for (const times of [[], [0]]) {
      const result = deriveRecognizedAction({ rotation: feature(state, times), grab: feature('no') }, frames);
      assert.equal(result.type, '无法判断');
      assert.equal(result.features.rotation.state, 'uncertain');
      assert.deepEqual(result.features.rotation.evidence, evidence(times));
      assert.equal(result.evidenceIncomplete, true);
    }
  }
  const grabbed = deriveRecognizedAction({ rotation: feature('no'), grab: feature('yes', [0]) }, frames);
  assert.equal(grabbed.type, '抓板');
  assert.equal(grabbed.evidenceIncomplete, false);
  assert.equal(grabbed.time, 1.5);
  const noGrab = deriveRecognizedAction({ rotation: feature('no'), grab: feature('no', [0]) }, frames);
  assert.equal(noGrab.type, '无法判断');
  assert.equal(noGrab.features.grab.state, 'uncertain');
  assert.equal(noGrab.evidenceIncomplete, true);
});

test('legacy labels, summaries and arbitrary summary timestamps cannot determine or embellish action types', () => {
  for (const raw of [null, undefined, [], {}, '转体', { type: '转体', description: '已经转体。', time: 4.2 }]) {
    const result = deriveRecognizedAction(raw, frames);
    assert.equal(result.type, '无法判断');
    assert.equal(result.time, null);
    assert.equal(result.evidenceIncomplete, true);
    assert.deepEqual(result.features, { rotation: { state: 'uncertain', evidence: [] }, grab: { state: 'uncertain', evidence: [] } });
  }
  const result = deriveRecognizedAction({ ...features(), type: '转体', description: '已经转体。', time: 999 }, frames);
  assert.equal(result.type, '直飞');
  assert.equal(result.time, 1.5);
  assert.match(result.description, /未显示转体特征/);
  assert.ok(!result.description.includes('已经转体'));
});

test('missing or unsupported feature states stay unknown even when evidence is present', () => {
  for (const value of [undefined, null, [], 'no', {}, { state: 'NO', evidence: evidence() }, { state: true, evidence: evidence() }, { evidence: evidence() }]) {
    const result = deriveRecognizedAction({ rotation: value, grab: feature('no') }, frames);
    assert.equal(result.features.rotation.state, 'uncertain');
    assert.equal(result.type, '无法判断');
    assert.equal(result.evidenceIncomplete, true);
  }
});

test('any malformed evidence invalidates the feature without retaining selected entries or trusting its label', () => {
  const invalidLists = [
    undefined, null, {}, '0,1.5', [null], [[]], [{ time: 0 }], [{ time: '0', observation: '朝向可见。' }],
    [{ time: NaN, observation: '朝向可见。' }], [{ time: Infinity, observation: '朝向可见。' }],
    [{ time: 0, observation: ' ' }], [{ time: 0, observation: ['朝向可见。'] }],
    [{ time: 0, observation: 'x'.repeat(161) }], [evidence()[0], { time: 3.6, observation: '未发送帧。' }],
    evidence([0, 0]), evidence([1.5, 0]), evidence([0, .0005]), evidence([0, 1.5, 3.7, 4.2, 4.3]),
  ];
  for (const invalid of invalidLists) {
    const result = deriveRecognizedAction({ type: '直飞', rotation: { state: 'no', evidence: invalid }, grab: feature('no') }, frames);
    assert.equal(result.type, '无法判断');
    assert.deepEqual(result.features.rotation, { state: 'uncertain', evidence: [] });
    assert.deepEqual(result.features.grab, feature('no'));
    assert.equal(result.time, 1.5);
    assert.equal(result.evidenceIncomplete, true);
  }
});

test('timestamps normalize to supplied frames, including zero, and preserve exact evidence text within bounds', () => {
  const result = deriveRecognizedAction({
    rotation: { state: 'yes', evidence: [{ time: .001, observation: ' 起跳前朝向可见。 ' }, { time: 1.501, observation: 'x'.repeat(160) }] },
    grab: feature('no'),
  }, frames);
  assert.equal(result.type, '转体');
  assert.deepEqual(result.features.rotation.evidence, [{ time: 0, observation: '起跳前朝向可见。' }, { time: 1.5, observation: 'x'.repeat(160) }]);
  assert.equal(result.time, 1.5);
  const zero = deriveRecognizedAction({ rotation: feature('uncertain', [0]), grab: feature('uncertain', []) }, frames);
  assert.equal(zero.time, 0);
  const inside = deriveRecognizedAction({ rotation: { state: 'no', evidence: evidence([.001001, 1.5]) }, grab: feature('no') }, frames);
  assert.equal(inside.type, '直飞');
  const outside = deriveRecognizedAction({ rotation: { state: 'no', evidence: evidence([.001002, 1.5]) }, grab: feature('no') }, frames);
  assert.equal(outside.type, '无法判断');
  assert.deepEqual(outside.features.rotation.evidence, []);
});

test('uncertain features can retain zero through four valid evidence entries, but never invalid evidence', () => {
  for (let count = 0; count <= 4; count++) {
    const kept = evidence(frames.slice(0, count).map(frame => frame.time));
    const result = deriveRecognizedAction({ rotation: { state: 'uncertain', evidence: kept }, grab: feature('no') }, frames);
    assert.equal(result.type, '无法判断');
    assert.deepEqual(result.features.rotation, { state: 'uncertain', evidence: kept });
    assert.equal(result.evidenceIncomplete, false);
  }
  const bad = deriveRecognizedAction({ rotation: { state: 'uncertain', evidence: evidence([0, 1.6]) }, grab: feature('no') }, frames);
  assert.deepEqual(bad.features.rotation, { state: 'uncertain', evidence: [] });
  assert.equal(bad.evidenceIncomplete, true);
});

test('other actions require their own two-frame evidence and cannot silently fall back to straight air', () => {
  const other = { evidence: evidence([1.5, 3.7], '可见不属于前四类的动作。') };
  const result = deriveRecognizedAction({ ...features(), otherAction: other }, frames);
  assert.equal(result.type, '其他');
  assert.deepEqual(result.otherAction, other);
  assert.equal(result.time, 3.7);
  assert.equal(result.evidenceIncomplete, false);
  assert.ok(!result.description.includes('已经转体'));
  for (const invalid of [undefined, [], {}, '其他', { evidence: [] }, { evidence: evidence([0]) }, { evidence: evidence([0, 0]) }, { evidence: evidence([0, 1.6]) }]) {
    const unknown = deriveRecognizedAction({ ...features(), otherAction: invalid }, frames);
    assert.equal(unknown.type, '无法判断');
    assert.equal(unknown.otherAction, null);
    assert.equal(unknown.time, 1.5);
    assert.equal(unknown.evidenceIncomplete, true);
  }
  assert.equal(deriveRecognizedAction({ ...features(), otherAction: null }, frames).type, '直飞');
});

test('invalid frame lists cannot anchor evidence and missing timestamps never become guessed replay points', () => {
  for (const invalid of [null, undefined, {}, [], [{ time: '0' }], [{ time: NaN }], [null, {}]]) {
    const result = deriveRecognizedAction(features('yes', 'yes'), invalid);
    assert.equal(result.type, '无法判断');
    assert.equal(result.time, null);
    assert.deepEqual(result.features.rotation.evidence, []);
    assert.deepEqual(result.features.grab.evidence, []);
  }
});

test('derivation leaves model input untouched and produces independent evidence snapshots', () => {
  const input = { ...features('yes', 'yes'), otherAction: { evidence: evidence([1.5, 3.7]) } };
  const original = structuredClone(input);
  const frozen = value => {
    if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) frozen(item); }
    return value;
  };
  frozen(input); frozen(frames);
  const first = deriveRecognizedAction(input, frames), second = deriveRecognizedAction(input, frames);
  assert.deepEqual(input, original);
  assert.notEqual(first.features, second.features);
  assert.notEqual(first.features.rotation.evidence[0], input.rotation.evidence[0]);
  assert.notEqual(first.otherAction.evidence[0], input.otherAction.evidence[0]);
  first.features.rotation.evidence[0].observation = 'CHANGED';
  first.features.grab.evidence.push({ time: 4.2, observation: 'NEW' });
  first.otherAction.evidence[0].time = 0;
  assert.deepEqual(input, original);
  assert.deepEqual(second.features.rotation, original.rotation);
  assert.deepEqual(second.features.grab, original.grab);
  assert.deepEqual(second.otherAction, original.otherAction);
});
