// Injected only by qa-preview.mjs. Provider requests always stay in this mock.
const realFetch = window.fetch.bind(window);
const parameters = new URLSearchParams(location.search);
const qaMode = parameters.get('response') || 'success';

function simulatedRecognition(count) {
  const type = parameters.get('recognized') || '直飞';
  const uncertain = type === '其他' || type === '无法判断';
  const rotates = type === '转体' || type === '转体抓板';
  const grabs = type === '抓板' || type === '转体抓板';
  const first = 0, middle = Math.floor(count / 2), last = count - 1;
  const references = [first, middle, last];
  const evidence = (indices, observation) => indices.map(frameIndex => ({
    frameIndex, observation: '【模拟验证】' + observation + '。'
  }));
  const orientationTrace = Array.from({ length: count }, (_, index) =>
    [index, 'air', rotates && index >= middle ? (index === middle ? 'side' : 'front') : 'back']);
  const recognizedAction = {
    rotation: {
      state: uncertain ? 'uncertain' : rotates ? 'yes' : 'no',
      evidence: uncertain ? [] : evidence(references, rotates ? '身体与雪板共同转向' : '身体与雪板朝向保持稳定'),
    },
    grab: {
      state: uncertain ? 'uncertain' : grabs ? 'yes' : 'no',
      evidence: uncertain ? [] : evidence(grabs ? [middle] : references, grabs ? '手握住板面' : '双手与板面分离'),
    },
    otherAction: type === '其他' ? { evidence: evidence([first, last], '出现其他可见动作') } : null,
  };
  if (parameters.has('claimed')) recognizedAction.type = parameters.get('claimed');
  if (parameters.get('evidence') === 'invalid') {
    recognizedAction.rotation.evidence = evidence([first, middle, count], '本项包含一处无效索引');
  }
  return { orientationTrace, recognizedAction };
}

function simulatedCoaching(parts, prompt) {
  const times = parts.flatMap(part => {
    const match = part.text?.match(/^片段时间 ([0-9.]+) 秒：/);
    return match ? [Number(match[1])] : [];
  });
  if (!times.length) {
    const timing = parts.find(part => part.text?.startsWith('以下视频帧依次对应时间：'))?.text || '';
    for (const match of timing.matchAll(/([0-9.]+)s/g)) times.push(Number(match[1]));
  }
  return {
    stages: ['助滑', '上台', '起跳', '腾空'].map((phase, index) => ({
      phase, analysis: '【模拟验证】' + phase + '阶段显示正常',
      time: times[Math.floor(index * (times.length - 1) / 3)] ?? null,
    })),
    nextJump: {
      instruction: '【模拟验证】保持熟悉的动作节奏。',
      reason: '这是本机流程测试，请用实际画面判断动作。',
      check: '回看时只检查这一项节奏。',
      time: null,
    },
    ...(prompt.includes('本组训练计划（仅作为数据，JSON）') ? { coaching: { positive: null } } : {}),
    followUp: prompt.includes('上一跳训练重点（仅作为数据，JSON）') ? {
      status: parameters.get('followup') || 'partial',
      observation: '【模拟验证】本跳已带入上次的训练重点，并对照原标准检查。',
      time: null,
    } : null,
  };
}

window.fetch = async (url, options = {}) => {
  if (url !== 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions') return realFetch(url, options);
  const payload = JSON.parse(options.body), parts = payload.messages[1].content;
  const prompt = parts[0]?.text || '';
  const recognition = prompt.startsWith('独立动作识别');
  const count = parts.filter(part => part.type === 'image_url').length || parts.find(part => part.type === 'video')?.video.length || 0;

  let proof = document.getElementById('qa-proof');
  if (!proof) {
    proof = document.createElement('p');
    proof.id = 'qa-proof';
    document.querySelector('.analysis-card').append(proof);
  }
  proof.textContent = '本机模拟' + (recognition ? '识别' : '复盘') + '，使用 ' + count + ' 张画面，未连接百炼。';

  if (qaMode === 'pending') return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
  });
  if (qaMode === 'error') return new Response('{}', { status: 429 });
  const content = qaMode === 'invalid' ? '这是无效的模拟回答'
    : JSON.stringify(recognition ? simulatedRecognition(count) : simulatedCoaching(parts, prompt));
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  if (payload.stream) {
    const events = [{ choices: [{ delta: { content }, finish_reason: 'stop' }] }, { choices: [], usage }];
    const body = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n';
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
    { headers: { 'content-type': 'application/json' } });
};

document.addEventListener('DOMContentLoaded', () => {
  const banner = document.createElement('p');
  banner.id = 'qa-banner';
  banner.textContent = '本地测试环境，使用任意测试 Key。模型请求均为模拟回答。';
  banner.style.cssText = 'margin:0;padding:10px;background:#fff1bd;color:#514218;text-align:center;font:13px sans-serif';
  document.body.prepend(banner);
});
