import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrames, estimateCostCny, QWEN_ENDPOINT, MAX_BODY_BYTES, MAX_FRAME_BYTES } from '../src/analysis-client.js';

const KEY = 'sk-test-only-not-a-real-key-12345';
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]).toString('base64');
const input = (overrides = {}) => ({ apiKey: KEY, model: 'qwen3-vl-plus', action: '直飞', duration: 6.2,
  frames: [0, 1.5, 3.7, 4.2].map((time) => ({ time, dataUrl: JPEG })), ...overrides });
const content = (overrides = {}) => JSON.stringify({ summary: '离台后出现侧倾，原因尚不能确定。',
  observations: [{ time: 3.7, evidence: '双臂位置不同。', interpretation: '可能与主动动作有关。', certainty: '可能' }],
  focus: '对比离台前后的肩线。', limitations: ['后方视角存在遮挡。'], ...overrides });
const upstream = (text = content(), usage = { prompt_tokens: 16000, completion_tokens: 700, total_tokens: 16700 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage }));
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => { assert.equal(error.code, code); assert.ok(!error.message.includes(KEY)); return true; });

test('browser sends only to official endpoint, no cookies or key in JSON, bounded nonthinking request', async () => {
  let called = 0;
  const result = await analyzeFrames(input(), { fetchImpl: async (url, options) => {
    called++;
    assert.equal(url, QWEN_ENDPOINT); assert.equal(options.mode, 'cors'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST'); assert.equal(options.headers.authorization, `Bearer ${KEY}`); assert.ok(!options.body.includes(KEY));
    const data = JSON.parse(options.body);
    assert.equal(data.model, 'qwen3-vl-plus'); assert.equal(data.enable_thinking, false); assert.equal(data.max_tokens, 1400); assert.equal(data.stream, false);
    assert.match(data.messages[0].content, /不分析落地/); assert.match(data.messages[0].content, /独立 JPEG/); assert.match(data.messages[0].content, /不是指令/);
    assert.equal(data.messages[1].content.filter((part) => part.type === 'image_url').length, 4);
    assert.match(data.messages[1].content[5].text, /3\.700/);
    assert.equal(data.messages[1].content[6].image_url.url, JPEG);
    return upstream();
  } });
  assert.equal(called, 1); assert.equal(result.model, 'qwen3-vl-plus'); assert.equal(result.sampling, 'frames'); assert.equal(result.frameCount, 4);
  assert.equal(result.estimatedCostCny, .023); assert.equal(result.analysis.observations[0].time, 3.7); assert.ok(result.analysis.limitations.some((item) => item.includes('抽帧')));
  assert.ok(!JSON.stringify(result).includes(KEY));
});
test('supports default model and a 240-character goal', async () => {
  const payload = input({ action: 'x'.repeat(240) }); delete payload.model;
  const result = await analyzeFrames(payload, { fetchImpl: async () => upstream() }); assert.equal(result.model, 'qwen3-vl-plus');
});
test('invalid input is rejected before network access', async (t) => {
  const cases = [
    ['missing key', { apiKey: '' }, 'invalid_api_key'], ['newline key', { apiKey: KEY + '\r\nX: injected' }, 'invalid_api_key'],
    ['unknown model', { model: 'https://attacker.example/' }, 'unsupported_model'], ['long duration', { duration: 61 }, 'invalid_duration'],
    ['NaN duration', { duration: NaN }, 'invalid_duration'], ['no action', { action: ' ' }, 'invalid_action'], ['long action', { action: 'x'.repeat(241) }, 'invalid_action'],
    ['few frames', { frames: input().frames.slice(0, 3) }, 'invalid_frame_count'], ['many frames', { frames: Array.from({ length: 41 }, (_, i) => ({ time: i / 10, dataUrl: JPEG })) }, 'invalid_frame_count'],
    ['out of order', { frames: [0, 3, 1, 4].map((time) => ({ time, dataUrl: JPEG })) }, 'invalid_timestamps'], ['duplicate times', { frames: [0, 1, 1, 4].map((time) => ({ time, dataUrl: JPEG })) }, 'invalid_timestamps'],
    ['beyond clip', { frames: [0, 1, 4, 7].map((time) => ({ time, dataUrl: JPEG })) }, 'invalid_timestamps'],
    ['remote image', { frames: input().frames.map((frame) => ({ ...frame, dataUrl: 'https://attacker.example/image.jpg' })) }, 'invalid_frame'],
    ['not JPEG', { frames: input().frames.map((frame) => ({ ...frame, dataUrl: 'data:image/jpeg;base64,aGVsbG8=' })) }, 'invalid_frame'],
    ['too large JPEG', { frames: input().frames.map((frame) => ({ ...frame, dataUrl: 'data:image/jpeg;base64,' + Buffer.alloc(MAX_FRAME_BYTES + 1, 255).toString('base64') })) }, 'frame_too_large'],
  ];
  for (const [name, overrides, code] of cases) await t.test(name, async () => {
    let called = false;
    await rejectsCode(analyzeFrames(input(overrides), { fetchImpl: () => { called = true; throw new Error('unexpected'); } }), code);
    assert.equal(called, false);
  });
});
test('total outbound body is bounded even when each individual JPEG is within limit', async () => {
  const bytes = Buffer.alloc(400 * 1024, 255); bytes[0] = 255; bytes[1] = 216; bytes[2] = 255;
  const dataUrl = 'data:image/jpeg;base64,' + bytes.toString('base64');
  const frames = Array.from({ length: 40 }, (_, i) => ({ time: i / 10, dataUrl }));
  assert.ok(frames.reduce((sum, frame) => sum + frame.dataUrl.length, 0) > MAX_BODY_BYTES);
  await rejectsCode(analyzeFrames(input({ frames }), { fetchImpl: () => { throw new Error('unexpected'); } }), 'payload_too_large');
});
test('provider errors preserve useful category but never leak response details', async (t) => {
  for (const [status, code] of [[401, 'provider_auth_failed'], [403, 'provider_forbidden'], [429, 'provider_rate_limited'], [400, 'provider_request_rejected'], [404, 'provider_request_rejected'], [503, 'provider_unavailable']]) {
    await t.test(String(status), async () => {
      await rejectsCode(analyzeFrames(input(), { fetchImpl: async () => new Response(`internal ${KEY}`, { status }) }), code);
    });
  }
});
test('CORS and network failures return an honest combined browser error', async () => {
  await assert.rejects(analyzeFrames(input(), { fetchImpl: async () => { throw new TypeError('Failed to fetch ' + KEY); } }), (error) => {
    assert.equal(error.code, 'provider_network_or_cors'); assert.match(error.message, /跨域/); assert.ok(!error.message.includes(KEY)); return true;
  });
});
test('fenced JSON and raw text fallback are safe data, timestamp hallucinations are dropped', async () => {
  const observations = [{ time: 3.7, evidence: '可见', certainty: '画面明确' }, { time: 4.201, evidence: '时间舍入', certainty: '99%' }, { time: 5.9, evidence: '未采样', certainty: '画面明确' }];
  const result = await analyzeFrames(input(), { fetchImpl: async () => upstream('```json\n' + content({ observations }) + '\n```') });
  assert.equal(result.analysis.observations.length, 2); assert.equal(result.analysis.observations[1].time, 4.2); assert.equal(result.analysis.observations[1].certainty, '可能');
  const html = '<img src=x onerror=alert(1)>这是普通文本';
  const raw = await analyzeFrames(input(), { fetchImpl: async () => upstream(html) }); assert.deepEqual(raw.analysis, { rawText: html });
});
test('empty, invalid JSON, declared-size, and streamed-size failures are mapped', async () => {
  await rejectsCode(analyzeFrames(input(), { fetchImpl: async () => upstream('') }), 'empty_analysis');
  await rejectsCode(analyzeFrames(input(), { fetchImpl: async () => new Response('not JSON') }), 'invalid_provider_response');
  await rejectsCode(analyzeFrames(input(), { fetchImpl: async () => new Response('{}', { headers: { 'content-length': '999999' } }) }), 'provider_response_too_large');
  await rejectsCode(analyzeFrames(input(), { fetchImpl: async () => new Response('x'.repeat(300 * 1024)) }), 'provider_response_too_large');
});
test('missing usage is unknown, not free, and price tiers are applied to all tokens', async () => {
  const result = await analyzeFrames(input(), { fetchImpl: async () => upstream(content(), {}) }); assert.equal(result.estimatedCostCny, null); assert.equal(result.usage.prompt_tokens, null);
  assert.equal(estimateCostCny({ prompt_tokens: 32000, completion_tokens: 1000 }), .042); assert.equal(estimateCostCny({ prompt_tokens: 32001, completion_tokens: 1000 }), .063002);
  assert.equal(estimateCostCny({ prompt_tokens: 128001, completion_tokens: 1000 }), .414003); assert.equal(estimateCostCny({ prompt_tokens: 256001, completion_tokens: 0 }), null); assert.equal(estimateCostCny(), null);
});
const pendingFetch = (_url, options) => new Promise((_resolve, reject) => {
  if (options.signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
});
test('pre-aborted and in-flight cancelled requests stop without sending or leaking data', async () => {
  const pre = new AbortController(); pre.abort(); let called = false;
  await rejectsCode(analyzeFrames(input(), { signal: pre.signal, fetchImpl: () => { called = true; } }), 'analysis_cancelled'); assert.equal(called, false);
  const active = new AbortController(); const request = analyzeFrames(input(), { signal: active.signal, fetchImpl: pendingFetch }); setTimeout(() => active.abort(), 5);
  await assert.rejects(request, (error) => { assert.equal(error.code, 'analysis_cancelled'); assert.equal(error.name, 'AbortError'); return true; });
});
test('timeout aborts fetch and response-body streaming; success cleans up timeout and listener', async () => {
  await rejectsCode(analyzeFrames(input(), { fetchImpl: pendingFetch, timeoutMs: 5 }), 'analysis_timeout');
  await rejectsCode(analyzeFrames(input(), { timeoutMs: 5, fetchImpl: async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } })) }), 'analysis_timeout');
  let signal; const external = new AbortController();
  const result = await analyzeFrames(input(), { signal: external.signal, timeoutMs: 10, fetchImpl: async (_url, options) => { signal = options.signal; return upstream(); } });
  assert.equal(result.model, 'qwen3-vl-plus'); external.abort(); await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(signal.aborted, false);
});
