const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const error = message => new Error('无法保存预录视频：' + message);

function requireRange(bytes, at, length, end = bytes.length) {
 if (at < 0 || length < 0 || at + length > end) throw error('MP4 数据不完整。');
}
function uint32(bytes, at) {
 requireRange(bytes, at, 4);
 return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
}
function uint64(bytes, at) {
 requireRange(bytes, at, 8);
 const value = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(at));
 if (!Number.isSafeInteger(value)) throw error('MP4 时间或位置超出可处理范围。');
 return value;
}
function set32(bytes, at, value) {
 if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw error('MP4 时间超出可处理范围。');
 new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(at, value);
}
function set64(bytes, at, value) {
 if (!Number.isSafeInteger(value) || value < 0) throw error('MP4 时间超出可处理范围。');
 new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(at, BigInt(value));
}
function typeAt(bytes, at) {
 requireRange(bytes, at, 4);
 return String.fromCharCode(...bytes.subarray(at, at + 4));
}
function boxAt(bytes, at, end, final = true) {
 if (end - at < 8) {
  if (final) throw error('MP4 盒头不完整。');
  return null;
 }
 let size = uint32(bytes, at), header = 8;
 const type = typeAt(bytes, at + 4);
 if (size === 1) {
  if (end - at < 16) {
   if (final) throw error('MP4 扩展盒头不完整。');
   return null;
  }
  size = uint64(bytes, at + 8); header = 16;
 }
 if (size === 0) {
  if (!final) return null;
  size = end - at;
 }
 if (size < header) throw error('MP4 盒大小无效。');
 if (at + size > end) {
  if (final) throw error('MP4 盒数据不完整。');
  return null;
 }
 return { type, at, size, data: at + header, end: at + size };
}
function children(bytes, box) {
 const result = [];
 for (let at = box.data; at < box.end;) {
  const child = boxAt(bytes, at, box.end);
  result.push(child); at = child.end;
 }
 return result;
}
function child(bytes, box, type) {
 return children(bytes, box).find(item => item.type === type);
}
function fullBox(bytes, box) {
 requireRange(bytes, box.data, 4, box.end);
 return { version: bytes[box.data], flags: (bytes[box.data+1] << 16) | (bytes[box.data+2] << 8) | bytes[box.data+3] };
}
function concatenate(parts) {
 const size = parts.reduce((sum, part) => sum + part.length, 0);
 const result = new Uint8Array(size);
 let at = 0;
 for (const part of parts) { result.set(part, at); at += part.length; }
 return result;
}
function readHeader(bytes) {
 const moov = boxAt(bytes, 0, bytes.length);
 const tracks = children(bytes, moov).filter(box => box.type === 'trak');
 if (tracks.length !== 1) throw error('预录目前需要单路视频。');
 const trak = tracks[0], tkhd = child(bytes, trak, 'tkhd'), mdia = child(bytes, trak, 'mdia');
 if (!tkhd || !mdia) throw error('MP4 缺少视频轨信息。');
 const mdhd = child(bytes, mdia, 'mdhd'), hdlr = child(bytes, mdia, 'hdlr');
 if (!mdhd || !hdlr || typeAt(bytes, hdlr.data + 8) !== 'vide') throw error('预录目前需要视频轨。');
 const track = uint32(bytes, tkhd.data + (fullBox(bytes, tkhd).version === 1 ? 20 : 12));
 const timescale = uint32(bytes, mdhd.data + (fullBox(bytes, mdhd).version === 1 ? 20 : 12));
 if (!timescale) throw error('MP4 时间基无效。');
 const mvex = child(bytes, moov, 'mvex');
 const trex = mvex && children(bytes, mvex).find(box => box.type === 'trex' && uint32(bytes, box.data + 4) === track);
 if (!trex) throw error('浏览器未输出可用于预录的分段 MP4。');
 requireRange(bytes, trex.data, 24, trex.end);
 // A non-empty sample table means this is not the supported fragmented layout.
 const minf = child(bytes, mdia, 'minf'), stbl = minf && child(bytes, minf, 'stbl');
 const stsz = stbl && child(bytes, stbl, 'stsz');
 if (stsz && uint32(bytes, stsz.data + 8) !== 0) throw error('浏览器输出了非分段视频。');
 const edts = child(bytes, trak, 'edts');
 let edit = null;
 if (edts) {
  const elst = child(bytes, edts, 'elst');
  if (!elst || uint32(bytes, elst.data + 4) !== 1) throw error('浏览器的视频时间编辑格式暂不支持预录。');
  const version = fullBox(bytes, elst).version;
  const mediaAt = elst.data + (version === 1 ? 16 : 12);
  const rateAt = elst.data + (version === 1 ? 24 : 16);
  requireRange(bytes, rateAt, 4, elst.end);
  if ((version !== 0 && version !== 1) || uint32(bytes, rateAt) !== 0x00010000) throw error('浏览器的视频播放速率暂不支持预录。');
  const mediaTime = version === 1 ? Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(mediaAt)) : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(mediaAt);
  if (!Number.isSafeInteger(mediaTime) || mediaTime < 0) throw error('浏览器的视频时间偏移暂不支持预录。');
  edit = {version, mediaTime, durationAt: elst.data + 8};
 }
 return { track, timescale, edit, duration: uint32(bytes, trex.data + 12), size: uint32(bytes, trex.data + 16), flags: uint32(bytes, trex.data + 20) };
}
function readFragment(bytes, header) {
 const moof = boxAt(bytes, 0, bytes.length);
 const trafs = children(bytes, moof).filter(box => box.type === 'traf');
 if (trafs.length !== 1) throw error('MP4 视频分段轨道无效。');
 const traf = trafs[0], tfhd = child(bytes, traf, 'tfhd'), tfdt = child(bytes, traf, 'tfdt');
 if (!tfhd || !tfdt) throw error('MP4 视频分段缺少时间信息。');
 const tfhdFlags = fullBox(bytes, tfhd).flags;
 if (uint32(bytes, tfhd.data + 4) !== header.track) throw error('MP4 视频分段轨道不匹配。');
 let at = tfhd.data + 8;
 const baseOffsetAt = tfhdFlags & 1 ? at : null;
 if (baseOffsetAt !== null) at += 8;
 if (tfhdFlags & 2) at += 4;
 let defaultDuration = header.duration, defaultSize = header.size, defaultFlags = header.flags;
 if (tfhdFlags & 8) { defaultDuration = uint32(bytes, at); at += 4; }
 if (tfhdFlags & 16) { defaultSize = uint32(bytes, at); at += 4; }
 if (tfhdFlags & 32) { defaultFlags = uint32(bytes, at); at += 4; }
 requireRange(bytes, tfhd.data, at - tfhd.data, tfhd.end);
 const timeVersion = fullBox(bytes, tfdt).version;
 if (timeVersion !== 0 && timeVersion !== 1) throw error('MP4 时间版本不支持。');
 const start = timeVersion === 1 ? uint64(bytes, tfdt.data + 4) : uint32(bytes, tfdt.data + 4);
 let decode = start, end = start, firstFlags = null, sampleBytes = 0;
 const runs = children(bytes, traf).filter(box => box.type === 'trun');
 for (const run of runs) {
  const { flags, version } = fullBox(bytes, run), count = uint32(bytes, run.data + 4);
  if (count > 1000000) throw error('MP4 分段样本数量无效。');
  let cursor = run.data + 8;
  if (flags & 1) cursor += 4;
  let runFirstFlags = null;
  if (flags & 4) { runFirstFlags = uint32(bytes, cursor); cursor += 4; }
  for (let i = 0; i < count; i++) {
   let duration = defaultDuration, size = defaultSize, sampleFlags = defaultFlags, composition = 0;
   if (flags & 0x100) { duration = uint32(bytes, cursor); cursor += 4; }
   if (flags & 0x200) { size = uint32(bytes, cursor); cursor += 4; }
   if (flags & 0x400) { sampleFlags = uint32(bytes, cursor); cursor += 4; }
   else if (i === 0 && runFirstFlags !== null) sampleFlags = runFirstFlags;
   if (flags & 0x800) { composition = uint32(bytes, cursor); cursor += 4; if (version === 1 && composition > 0x7fffffff) composition -= 0x100000000; }
   if (!duration || !size) throw error('MP4 样本时长或大小无效。');
   if (firstFlags === null) firstFlags = sampleFlags;
   end = Math.max(end, decode + composition + duration);
   decode += duration; sampleBytes += size;
   if (decode > MAX_SAFE_INTEGER || sampleBytes > MAX_SAFE_INTEGER) throw error('MP4 分段太大。');
  }
  requireRange(bytes, run.data, cursor - run.data, run.end);
 }
 if (firstFlags === null) throw error('MP4 分段没有视频样本。');
 return {start, end: Math.max(end, decode), decodeEnd: decode, sync: !(firstFlags & 0x10000) && ((firstFlags >>> 24) & 3) !== 1, sampleBytes, tfdt, timeVersion, baseOffsetAt};
}
function rebaseFragment(fragment, start, outputOffset, sequence) {
 const bytes = fragment.moof.slice(), info = fragment.info;
 const time = info.start - start;
 if (info.timeVersion === 1) set64(bytes, info.tfdt.data + 4, time);
 else set32(bytes, info.tfdt.data + 4, time);
 if (info.baseOffsetAt !== null) {
  const original = uint64(bytes, info.baseOffsetAt);
  set64(bytes, info.baseOffsetAt, original + outputOffset - fragment.originalOffset);
 }
 const mfhd = child(bytes, boxAt(bytes, 0, bytes.length), 'mfhd');
 if (mfhd) set32(bytes, mfhd.data + 4, sequence);
 return bytes;
}
function patchDuration(bytes, durationTicks, movieTimescale, mediaTimescale, edit) {
 const moov = boxAt(bytes, 0, bytes.length), mvhd = child(bytes, moov, 'mvhd');
 const movieDuration = Math.ceil((durationTicks - (edit?.mediaTime ?? 0)) * movieTimescale / mediaTimescale);
 if (edit) {
  if (edit.version === 1) set64(bytes, edit.durationAt, movieDuration); else set32(bytes, edit.durationAt, movieDuration);
 }
 function duration(box, value, kind) {
  const v = fullBox(bytes, box).version;
  const offset = kind === 'tkhd' ? (v === 1 ? 28 : 20) : (v === 1 ? 24 : 16);
  if (v === 1) set64(bytes, box.data + offset, value); else set32(bytes, box.data + offset, value);
 }
 if (mvhd) duration(mvhd, movieDuration, 'mvhd');
 const trak = child(bytes, moov, 'trak'), tkhd = child(bytes, trak, 'tkhd'), mdia = child(bytes, trak, 'mdia'), mdhd = child(bytes, mdia, 'mdhd');
 duration(tkhd, movieDuration, 'tkhd'); duration(mdhd, durationTicks, 'mdhd');
 const mvex = child(bytes, moov, 'mvex'), mehd = mvex && child(bytes, mvex, 'mehd');
 if (mehd) { if (fullBox(bytes, mehd).version === 1) set64(bytes, mehd.data + 4, movieDuration); else set32(bytes, mehd.data + 4, movieDuration); }
}

/** Bounded fMP4 video ring. Retains complete, independently decodable fragments. */
export class Mp4PreRoll {
 constructor({keepSeconds = 2, maxWaitingBytes = 16 * 1024 * 1024, maxRecordingBytes = 64 * 1024 * 1024} = {}) {
  if (!(keepSeconds >= 0) || !Number.isFinite(keepSeconds)) throw new TypeError('Invalid pre-roll duration');
  this.keepSeconds = keepSeconds; this.maxWaitingBytes = maxWaitingBytes; this.maxRecordingBytes = maxRecordingBytes;
  this.fragments = []; this.pending = new Uint8Array(); this.offset = 0; this.bytes = 0;
  this.queue = Promise.resolve(); this.failure = null; this.committed = false; this.ended = false; this.disposed = false;
  this.header = null; this.ftyp = null; this.moov = null; this.current = null; this.commitEnd = null;
 }
 append(blob) {
  if (this.ended) return Promise.reject(error('录像已结束。'));
  const task = this.queue.then(async () => {
   if (this.failure) throw this.failure;
   const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
   if (this.disposed) return;
   this.pending = concatenate([this.pending, bytes]);
   if (this.pending.length > (this.committed ? this.maxRecordingBytes : this.maxWaitingBytes)) throw error('单个视频分段超过本机缓存上限。');
   this.parse(false);
  });
  this.queue = task.catch(reason => { this.failure = reason; });
  return task;
 }
 commit() {
  // Set this synchronously, before outstanding blob conversions finish, so no
  // queued pre-trigger data can be evicted after recording is confirmed.
  this.committed = true;
  this.commitEnd = this.fragments.at(-1)?.info.end ?? null;
 }
 parse(final) {
  let consumed = 0;
  while (consumed < this.pending.length) {
   const box = boxAt(this.pending, consumed, this.pending.length, final);
   if (!box) break;
   const bytes = this.pending.slice(box.at, box.end), originalOffset = this.offset + box.at;
   if (box.type === 'ftyp') {
    if (this.ftyp || this.fragments.length || this.current) throw error('视频编码在预录期间改变。');
    this.ftyp = bytes;
   } else if (box.type === 'moov') {
    if (this.moov) throw error('视频编码在预录期间改变。');
    this.moov = bytes; this.header = readHeader(bytes);
   } else if (box.type === 'moof') {
    if (!this.header || !this.ftyp || this.current) throw error('MP4 分段顺序无效。');
    this.current = {moof: bytes, info: readFragment(bytes, this.header), originalOffset};
   } else if (box.type === 'mdat') {
    if (!this.current) throw error('浏览器未输出分段 MP4 视频。');
    const mdat = boxAt(bytes, 0, bytes.length);
    if (this.current.info.sampleBytes > bytes.length - mdat.data) throw error('MP4 视频样本不完整。');
    const fragment = {...this.current, mdat: bytes}; this.current = null;
    const previous = this.fragments.at(-1);
    if (previous && fragment.info.start <= previous.info.start) throw error('MP4 视频时间不连续。');
    this.fragments.push(fragment); this.bytes += fragment.moof.length + bytes.length;
    this.prune();
   } else if (this.current) throw error('MP4 分段包含暂不支持的数据盒。');
   else if (!['free', 'skip', 'wide', 'sidx', 'mfra', 'mfro'].includes(box.type)) throw error('视频分段格式暂不支持。');
   consumed = box.end;
  }
  this.offset += consumed; this.pending = this.pending.slice(consumed);
 }
 prune() {
  if (this.committed) {
   if (this.bytes + this.ftyp.length + this.moov.length > this.maxRecordingBytes) throw error('本跳视频超过本机缓存上限。');
   return;
  }
  const latest = this.fragments.at(-1), threshold = latest.info.end - this.keepSeconds * this.header.timescale;
  let start = -1;
  for (let i = 0; i < this.fragments.length; i++) if (this.fragments[i].info.sync && this.fragments[i].info.start <= threshold) start = i;
  if (start < 0) start = this.fragments.findIndex(fragment => fragment.info.sync);
  if (start > 0) {
   for (const fragment of this.fragments.splice(0, start)) this.bytes -= fragment.moof.length + fragment.mdat.length;
  }
  if (this.bytes + this.ftyp.length + this.moov.length > this.maxWaitingBytes) throw error('关键帧间隔太长，无法安全保留预录缓存。');
 }
 dispose() {
  this.disposed = true; this.ended = true; this.pending = new Uint8Array(); this.fragments = [];
  this.ftyp = null; this.moov = null; this.header = null; this.current = null; this.bytes = 0;
 }
 async finish() {
  this.ended = true; await this.queue;
  if (this.failure) throw this.failure;
  this.parse(true);
  if (this.pending.length || this.current) throw error('最后一段视频不完整。');
  if (!this.committed) return null;
  if (!this.header || !this.fragments.length || !this.fragments[0].info.sync) throw error('视频缺少可解码的起始关键帧。');
  const first = this.fragments[0].info.start, end = this.fragments.at(-1).info.end;
  const moov = this.moov.slice(), mvhd = child(moov, boxAt(moov, 0, moov.length), 'mvhd');
  if (!mvhd) throw error('MP4 缺少视频时长信息。');
  const movieTimescale = uint32(moov, mvhd.data + (fullBox(moov, mvhd).version === 1 ? 20 : 12));
  if (!movieTimescale) throw error('MP4 时间基无效。');
  patchDuration(moov, end - first, movieTimescale, this.header.timescale, this.header.edit);
  const output = [this.ftyp, moov]; let offset = this.ftyp.length + moov.length;
  for (let i = 0; i < this.fragments.length; i++) {
   const fragment = this.fragments[i], moof = rebaseFragment(fragment, first, offset, i + 1);
   output.push(moof, fragment.mdat); offset += moof.length + fragment.mdat.length;
  }
  return {blob: new Blob(output, {type: 'video/mp4'}), startTime: first / this.header.timescale,
   endTime: end / this.header.timescale, duration: (end - first - (this.header.edit?.mediaTime ?? 0)) / this.header.timescale,
   preRollSeconds: Math.max(0, ((this.commitEnd ?? first) - first) / this.header.timescale)};
 }
}
