import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisPersonDetector } from '../src/analysis-person-detector.js';

const person = (x, y, width, height, score = .8, categoryName = 'person') => ({
  boundingBox: { originX: x, originY: y, width, height }, categories: [{ categoryName, score }],
});
const result = (...detections) => ({ detections });
function fixture(responses, { width = 720, height = 1280, now = () => 10 } = {}) {
  const video = { videoWidth: width, videoHeight: height }, calls = [], draws = [];
  let created = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }) };
  const detector = { detectForVideo(source, time) {
    calls.push({ source, time });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  } };
  const detect = createAnalysisPersonDetector(detector, { now, createCanvas: () => { created++; return canvas; } });
  return { video, canvas, calls, draws, detect, created: () => created };
}

test('usable whole-frame observations take priority without canvas or extra inference', async () => {
  const f = fixture([result(person(72, 128, 144, 256, .38), person(360, 640, 72, 128, .7))]);
  assert.deepEqual(await f.detect(f.video), [{ x: .1, y: .1, w: .2, h: .2, score: .38 },
    { x: .5, y: .5, w: .1, h: .1, score: .7 }]);
  assert.equal(f.calls.length, 1); assert.equal(f.created(), 0); assert.equal(f.draws.length, 0);
});

test('the exposed fullFrame callback and explicit option never run fallback inference or allocate a canvas', async () => {
  const f = fixture([result(), result(person(72, 128, 144, 256, .379)),
    result(person(72, 128, 144, 256, .8))]);
  assert.equal(typeof f.detect.fullFrame, 'function');
  assert.deepEqual(await f.detect.fullFrame(f.video), []);
  assert.deepEqual(await f.detect(f.video, { allowTiles: false }), []);
  assert.deepEqual(await f.detect.fullFrame(f.video), [{ x: .1, y: .1, w: .2, h: .2, score: .8 }]);
  assert.equal(f.calls.length, 3); assert.equal(f.created(), 0); assert.equal(f.draws.length, 0);
});

test('fullFrame and tiled calls share strictly increasing detector timestamps', async () => {
  const f = fixture([result(), result(), result(), result(), result()]);
  await f.detect.fullFrame(f.video);
  await f.detect(f.video);
  await f.detect.fullFrame(f.video);
  assert.deepEqual(f.calls.map(call => call.time), [10, 11, 12, 13, 14]);
  assert.equal(f.created(), 1); assert.equal(f.draws.length, 2);
});

test('portrait fallback maps both overlapping square tiles back to original coordinates', async () => {
  const f = fixture([result(), result(person(72, 128, 144, 256)), result(person(360, 80, 72, 128, .9))]);
  assert.deepEqual(await f.detect(f.video), [{ x: .5, y: .5, w: .1, h: .1, score: .9 },
    { x: .1, y: .1, w: .2, h: .2, score: .8 }]);
  assert.deepEqual(f.draws.map(args => args.slice(1, 5)), [[0, 0, 720, 720], [0, 560, 720, 720]]);
  assert.equal(f.calls.length, 3); assert.equal(f.created(), 1);
  assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
});

test('landscape fallback maps the second tile on the horizontal axis', async () => {
  const f = fixture([result(), result(person(128, 72, 256, 144)), result(person(80, 360, 128, 72, .9))], { width: 1280, height: 720 });
  assert.deepEqual(await f.detect(f.video), [{ x: .5, y: .5, w: .1, h: .1, score: .9 },
    { x: .1, y: .1, w: .2, h: .2, score: .8 }]);
  assert.deepEqual(f.draws.map(args => args.slice(1, 5)), [[0, 0, 720, 720], [560, 0, 720, 720]]);
});

test('duplicate tile views retain the highest score while separate people remain distinct', async () => {
  const f = fixture([result(), result(person(100, 620, 100, 80, .6), person(400, 620, 80, 80, .7)),
    result(person(100, 60, 100, 80, .9))]);
  const boxes = await f.detect(f.video);
  assert.equal(boxes.length, 2); assert.equal(boxes[0].score, .9); assert.equal(boxes[1].score, .7);
  assert.equal(boxes[0].y, 620 / 1280);
});

test('overlapping people from the same tile are not collapsed into one person', async () => {
  const f = fixture([result(), result(person(100, 100, 100, 100, .9), person(120, 100, 100, 100, .8)), result()]);
  assert.equal((await f.detect(f.video)).length, 2);
});

test('low scores and invalid full-frame boxes permit fallback without lowering confidence thresholds', async () => {
  const f = fixture([result(person(72, 128, 144, 256, .379), person(900, 100, 10, 10),
    person(0, 0, 100, 100, .8, 'car')), result(person(72, 128, 144, 256, .38)), result()]);
  const boxes = await f.detect(f.video);
  assert.equal(f.calls.length, 3); assert.equal(boxes.length, 1); assert.equal(boxes[0].score, .38);
});

test('malformed category lists do not discard other valid full-frame observations', async () => {
  const f = fixture([result({ ...person(0, 0, 10, 10), categories: {} },
    { ...person(0, 0, 10, 10), categories: [null] }, person(72, 128, 144, 256))]);
  assert.deepEqual(await f.detect(f.video), [{ x: .1, y: .1, w: .2, h: .2, score: .8 }]);
  assert.equal(f.calls.length, 1); assert.equal(f.created(), 0);
});

test('malformed boxes are discarded and partial boundary intersections stay inside the original video', async () => {
  const f = fixture([result(), result(null, person(100, 100, -1, 10), person(NaN, 1, 10, 10),
    person(0, 0, 10, 10, Infinity), person(0, 0, 10, 10, 1.01), person(1000, 1, 10, 10),
    person(-20, 10, 50, 60)), result(person(710, 700, 40, 40))]);
  const boxes = await f.detect(f.video);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { x: 0, y: 10 / 1280, w: 30 / 720, h: 60 / 1280, score: .8 });
  for (const box of boxes) {
    assert.ok(Object.values(box).every(Number.isFinite));
    assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0);
    assert.ok(box.x + box.w <= 1 && box.y + box.h <= 1);
  }
});

test('all inferences use strictly increasing timestamps when the supplied clock repeats or goes backwards', async () => {
  const clock = [10, 10, 9, NaN, -5, 11];
  const f = fixture(Array.from({ length: 6 }, () => result()), { now: () => clock.shift() });
  await f.detect(f.video); await f.detect(f.video);
  assert.deepEqual(f.calls.map(call => call.time), [10, 11, 12, 13, 14, 15]);
  assert.equal(f.created(), 1);
});

test('full-frame and tile detector failures yield no invented boxes and leave subsequent observations usable', async () => {
  const f = fixture([new Error('full failed'), result(), new Error('tile failed'), result(person(100, 60, 100, 80, .9))]);
  assert.deepEqual(await f.detect(f.video), []); assert.equal(f.calls.length, 1);
  assert.equal((await f.detect(f.video)).length, 1); assert.equal(f.calls.length, 4);
  assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
});

test('canvas failures and unavailable pixel contexts safely retain the whole-view fallback', async () => {
  for (const createCanvas of [() => { throw Error('no canvas'); }, () => ({ getContext: () => null })]) {
    const detector = { detectForVideo: () => result() };
    const detect = createAnalysisPersonDetector(detector, { createCanvas });
    assert.deepEqual(await detect({ videoWidth: 720, videoHeight: 1280 }), []);
  }
});

test('invalid dimensions are rejected before inference and square clips do not repeat the same full image', async () => {
  const f = fixture([result()], { width: 720, height: 720 });
  for (const video of [null, {}, { videoWidth: 0, videoHeight: 1 }, { videoWidth: 1.5, videoHeight: 720 },
    { videoWidth: 99999, videoHeight: 720 }]) assert.deepEqual(await f.detect(video), []);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.detect(f.video), []); assert.equal(f.calls.length, 1); assert.equal(f.created(), 0);
});

test('extreme aspect-ratio tile pairs remain overlapping and bounded', async () => {
  for (const [width, height] of [[720, 3000], [3000, 720]]) {
    const f = fixture([result(), result(), result()], { width, height });
    await f.detect(f.video);
    const [a, b] = f.draws.map(args => args.slice(1, 5));
    assert.ok(a[0] >= 0 && a[1] >= 0 && b[0] + b[2] <= width && b[1] + b[3] <= height);
    assert.ok(width > height ? b[0] < a[0] + a[2] : b[1] < a[1] + a[3]);
  }
});
