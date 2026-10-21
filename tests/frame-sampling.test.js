import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ANALYSIS_FRAMES, TARGET_ANALYSIS_FPS, getFrameTimes } from '../src/frame-sampling.js';

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
