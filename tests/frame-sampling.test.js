import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ANALYSIS_FRAMES, TARGET_ANALYSIS_FPS, getFrameTimes,
  getScoutFrameTimes, getAdaptiveFrameTimes,
} from '../src/frame-sampling.js';

test('uses a 12 fps target and caps analysis at 96 frames', () => {
  assert.equal(TARGET_ANALYSIS_FPS, 12);
  assert.equal(MAX_ANALYSIS_FRAMES, 96);
});

test('a 6.2 second jump receives 75 frames spanning the clip', () => {
  const times = getFrameTimes(6.2);
  assert.equal(times.length, 75);
  assert.equal(times[0], 0.01);
  assert.equal(times.at(-1), 6.08);
});

test('a 60 second selection is capped at 96 frames', () => {
  const times = getFrameTimes(60);
  assert.equal(times.length, 96);
  assert.equal(times[0], 0.01);
  assert.equal(times.at(-1), 59.88);
});

test('the minimum 0.5 second selection still has eight frames', () => {
  const times = getFrameTimes(0.5);
  assert.equal(times.length, 8);
  assert.equal(times[0], 0.01);
  assert.equal(times.at(-1), 0.38);
});

test('rejects durations outside the accepted numeric range', () => {
  for (const duration of [0, -1, 0.4999, 60.0001, Infinity, -Infinity, NaN, '6.2', null, undefined, true, {}, []]) {
    assert.throws(() => getFrameTimes(duration), RangeError, String(duration));
  }
});

test('timestamps are rounded, strictly increasing and inside both endpoints', () => {
  for (const duration of [0.5, 0.5006, 0.5009999999999999, 0.667, 1, 1.23456, 6.2, 7.9999, 8, 20.125, 59.9997, 60]) {
    const times = getFrameTimes(duration);
    assert.equal(times.length, Math.min(96, Math.max(8, Math.ceil(duration * 12))));
    assert.equal(times[0], 0.01);
    for (let i = 0; i < times.length; i++) {
      assert.equal(times[i], Number(times[i].toFixed(3)));
      assert.ok(times[i] >= 0.01 && times[i] <= duration - 0.12, `timestamp bounds for ${duration}`);
      if (i) assert.ok(times[i] > times[i - 1], `strict order for ${duration}`);
      const uniform = times[0] + (times.at(-1) - times[0]) * i / (times.length - 1);
      assert.ok(Math.abs(times[i] - uniform) <= 0.0005000001, `uniform spacing after rounding for ${duration}`);
    }
  }
});

test('calls return independent arrays', () => {
  const first = getFrameTimes(6.2);
  first[0] = 99;
  assert.equal(getFrameTimes(6.2)[0], 0.01);
});

function assertValidTimes(times, duration) {
  for (let index = 0; index < times.length; index++) {
    assert.equal(times[index], Number(times[index].toFixed(3)));
    assert.ok(times[index] >= 0.01 && times[index] <= duration - 0.12,
      `timestamp bounds for ${duration}: ${times[index]}`);
    if (index) assert.ok(times[index] > times[index - 1], `strict order for ${duration}`);
  }
  assert.equal(times[0], 0.01);
  assert.ok(duration - 0.12 - times.at(-1) < 0.0010000001);
}

test('scouting uses about 8 fps, capped at 320, and retains both clip ends', () => {
  assert.equal(getScoutFrameTimes(6.205011).length, 50);
  assert.equal(getScoutFrameTimes(60).length, 320);
  for (const duration of [0.5, 0.5006, 0.667, 1, 6.205011, 39.9999, 40, 59.9997, 60]) {
    const times = getScoutFrameTimes(duration);
    assert.equal(times.length, Math.min(320, Math.max(2, Math.ceil(duration * 8))));
    assertValidTimes(times, duration);
  }
});

test('a provided air window receives dense frames and sparse context in one sequence', () => {
  const result = getAdaptiveFrameTimes(6.205011, { window: { start: 3.8, end: 4.8 } });
  assert.equal(result.windowSource, 'provided');
  assert.deepEqual(result.denseWindow, { start: 3.8, end: 4.8 });
  assert.equal(result.denseFrameCount, 25);
  assert.equal(result.beforeFrameCount, 7);
  assert.equal(result.afterFrameCount, 2);
  assert.equal(result.denseFps, 24);
  assert.equal(result.targetContextFps, 2);
  assert.equal(result.frameCount, 34);
  assert.equal(result.times.filter((time) => time === 3.8).length, 1);
  assert.equal(result.times.filter((time) => time === 4.8).length, 1);
  assertValidTimes(result.times, 6.205011);
  const dense = result.times.filter((time) => time >= 3.8 && time <= 4.8);
  for (let index = 1; index < dense.length; index++) {
    assert.ok(dense[index] - dense[index - 1] <= 0.043);
  }
  const before = result.times.filter((time) => time < 3.8);
  assert.ok(before[1] - before[0] > 0.5);
});

test('fallback is explicitly labelled and concentrates frames in the middle-to-late clip', () => {
  const result = getAdaptiveFrameTimes(6.205011);
  assert.equal(result.windowSource, 'fallback');
  assert.ok(Math.abs(result.denseWindow.start - (0.01 + 6.075 * 0.35)) < 0.0010000001);
  assert.ok(Math.abs(result.denseWindow.end - (0.01 + 6.075 * 0.85)) < 0.0010000001);
  assert.ok(result.denseFrameCount > result.beforeFrameCount + result.afterFrameCount);
  const gaps = result.times.slice(1).map((time, index) => Number((time - result.times[index]).toFixed(3)));
  assert.ok(Math.max(...gaps) > Math.min(...gaps) * 3, 'does not silently return uniform full-clip sampling');
  assertValidTimes(result.times, 6.205011);
});

test('adaptive sampling handles short clips, full-clip windows and windows near either boundary', () => {
  for (const duration of [0.5, 0.5006, 0.5009999999999999, 0.667, 1, 6.205011, 20.125, 59.9997, 60]) {
    for (const window of [undefined, { start: 0, end: duration },
      { start: 0, end: 0.011 }, { start: duration - 0.121, end: duration },
      { start: 0.0101, end: 0.0102 }]) {
      const result = getAdaptiveFrameTimes(duration, { window });
      assertValidTimes(result.times, duration);
      assert.ok(result.frameCount >= 4 && result.frameCount <= 96);
      assert.equal(result.frameCount, result.times.length);
      assert.equal(result.frameCount,
        result.beforeFrameCount + result.denseFrameCount + result.afterFrameCount);
      assert.ok(result.denseFrameCount <= 64);
      assert.ok(result.beforeFrameCount <= 16 && result.afterFrameCount <= 16);
      assert.ok(result.denseWindow.start < result.denseWindow.end);
      if (window?.start === 0 && window.end === duration) {
        assert.equal(result.beforeFrameCount, 0);
        assert.equal(result.afterFrameCount, 0);
      }
    }
  }
});

test('long candidate windows keep context sparser after the 64-frame dense cap', () => {
  const result = getAdaptiveFrameTimes(60, { window: { start: 10, end: 50 } });
  assert.equal(result.denseFrameCount, 64);
  assert.equal(result.denseFps, 63 / 40);
  assert.ok(result.targetContextFps < result.denseFps);
  assert.ok(result.beforeFrameCount < 16 && result.afterFrameCount < 16);
  const denseGap = 40 / 63;
  const before = result.times.filter((time) => time < 10);
  const after = result.times.filter((time) => time > 50);
  assert.ok(before[1] - before[0] > denseGap);
  assert.ok(after[1] - after[0] > denseGap);
  assertValidTimes(result.times, 60);
});

test('explicit windows are expanded to milliseconds and do not escape the clip bounds', () => {
  const result = getAdaptiveFrameTimes(6.205011, { window: { start: 3.8004, end: 4.8004 } });
  assert.deepEqual(result.denseWindow, { start: 3.8, end: 4.801 });
  assertValidTimes(result.times, 6.205011);
});

test('new samplers reject invalid durations and malformed explicit windows', () => {
  for (const duration of [0, -1, 0.4999, 60.0001, Infinity, -Infinity, NaN, '6.2', null, undefined, true, {}, []]) {
    assert.throws(() => getScoutFrameTimes(duration), RangeError, String(duration));
    assert.throws(() => getAdaptiveFrameTimes(duration), RangeError, String(duration));
  }
  for (const window of [null, false, [], '1,2', {}, { start: 1 }, { start: '1', end: 2 },
    { start: NaN, end: 2 }, { start: 1, end: Infinity }, { start: -1, end: 2 },
    { start: 1, end: 7 }, { start: 2, end: 2 }, { start: 3, end: 2 },
    { start: 0, end: 0.005 }, { start: 6.1, end: 6.2 }]) {
    assert.throws(() => getAdaptiveFrameTimes(6.2, { window }), RangeError, JSON.stringify(window));
  }
});

test('adaptive and scout calls return independent data without mutating the candidate window', () => {
  const window = { start: 3.8, end: 4.8 };
  const first = getAdaptiveFrameTimes(6.205011, { window });
  first.times[0] = 99;
  first.denseWindow.start = 99;
  assert.deepEqual(window, { start: 3.8, end: 4.8 });
  assert.equal(getAdaptiveFrameTimes(6.205011, { window }).times[0], 0.01);
  const scout = getScoutFrameTimes(6.205011);
  scout[0] = 99;
  assert.equal(getScoutFrameTimes(6.205011)[0], 0.01);
});
