import { resampleMono, trackPitch, segmentNotes, onsetEnvelope, trackBeats } from './analyze.js';
import { estimateTuning, estimateKey, keyName, buildGrid, chooseChords, chordVocab, arrange, PC } from './harmony.js';
import { renderPiano, wavBlob, demoVoice } from './piano.js';

const $ = id => document.getElementById(id);
const S = {
  ctx: null, vocalBuf: null, pianoBuf: null, video: null, dur: 0,
  pitch: null, notes: [], onset: null, events: [], grid: null, plan: null, key: null, keys: [], tune: null, bt: null,
  style: 'ballad', keyForce: null, tempoF: 1, meter: 4, showChord: true,
  frameColor: '#FFF3B5', framePattern: 'dots', frameW: 24, playing: false, offset: 0, startAt: 0, srcs: [], exporting: false, cover: null
};

if (location.search.includes('debug')) window.__hum = S;

const setState = s => { document.body.dataset.state = s; };
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let toastT;
const toast = (m, ms = 3200) => { const el = $('toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); };
const work = (txt, p) => { $('worktxt').textContent = txt; $('workbar').style.width = Math.round(p * 100) + '%'; };
const fill = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');

function audio() {
  if (!S.ctx) {
    S.ctx = new AudioContext();
    S.gV = S.ctx.createGain(); S.gP = S.ctx.createGain(); S.master = S.ctx.createGain();
    S.gV.connect(S.master); S.gP.connect(S.master); S.master.connect(S.ctx.destination);
    S.gP.gain.value = .9;
  }
  if (S.ctx.state === 'suspended') S.ctx.resume();
  return S.ctx;
}

async function load(blob, isVideo) {
  stop();
  setState('work'); work('正在听你的声音…', .03);
  const ctx = audio();
  try {
    let buf;
    if (blob instanceof AudioBuffer) buf = blob;
    else buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.duration < 1.5) throw new Error('short');
    S.vocalBuf = buf; S.dur = buf.duration;
    if (S.video) { URL.revokeObjectURL(S.video.src); S.video = null; }
    if (isVideo) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(blob);
      await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
      if (v.videoWidth) S.video = v;
    }
    const x = await resampleMono(buf, 16000);
    S.pitch = await trackPitch(x, 16000, p => work('正在听你的音高…', .05 + p * .55));
    S.notes = segmentNotes(S.pitch);
    if (S.notes.length < 2) throw new Error('nopitch');
    work('在找节拍…', .64);
    await new Promise(r => setTimeout(r, 30));
    S.onset = onsetEnvelope(x, 16000);
    S.keyForce = null; S.tempoF = 1; S.meter = 4;
    $('meter').value = '4';
    document.querySelectorAll('.mini button').forEach(b => b.classList.toggle('on', b.dataset.f === '1'));
    harmonize();
    await synth(true);
    setupCanvas();
    S.offset = 0;
    setState('ready');
    renderUI();
  } catch (e) {
    console.error(e);
    setState('empty');
    toast(e.message === 'short' ? '这段太短啦，至少唱两三秒' : e.message === 'nopitch' ? '没听到清楚的人声，换一段安静点的试试' : '这个文件读不出声音，换个格式试试（mp4 / mov / mp3 / wav）', 4200);
  }
}

function harmonize() {
  S.tune = estimateTuning(S.notes, S.dur);
  S.keys = estimateKey(S.notes);
  S.key = S.keyForce || S.keys[0];
  const base = trackBeats(S.onset, S.notes, S.dur);
  S.bt = S.tempoF === 1 ? base : trackBeats(S.onset, S.notes, S.dur, base.bpm * S.tempoF);
  const cands = S.keyForce ? [S.keyForce] : S.keys.filter(k => k.score >= S.keys[0].score - 0.08).slice(0, 3);
  let best = null;
  for (const key of cands) for (let ph = 0; ph < S.meter; ph++) {
    const grid = buildGrid(S.bt, S.dur, S.meter, S.notes, ph);
    const plan = chooseChords(grid, S.notes, key);
    const mx = Math.max(...grid.PS, 1e-6);
    const sc = plan.score + 0.5 * grid.PS[ph] / mx + (S.keyForce ? 0 : 2 * key.score);
    if (!best || sc > best.sc) best = { sc, grid, plan, key };
  }
  S.grid = best.grid; S.plan = best.plan; S.key = best.key;
}

async function synth(first) {
  S.events = arrange(S.grid, S.plan, S.key, S.style, S.dur, S.notes);
  S.pianoBuf = await renderPiano(S.events, S.dur, S.tune.at, 44100, p => first && work('钢琴在弹了…', .7 + p * .28));
  if (S.playing) startSources(now());
}

let synthQ = Promise.resolve();
const resynth = () => { synthQ = synthQ.then(() => synth(false)).then(renderChords); };

const now = () => S.playing ? Math.min(S.dur, S.offset + S.ctx.currentTime - S.startAt) : S.offset;

function stopSources() { for (const s of S.srcs) { s.onended = null; try { s.stop(); } catch { } } S.srcs = []; }
function startSources(off) {
  stopSources();
  const ctx = audio(), when = ctx.currentTime + 0.06;
  for (const [buf, g] of [[S.vocalBuf, S.gV], [S.pianoBuf, S.gP]]) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start(when, Math.min(off, buf.duration - 0.01)); S.srcs.push(s);
  }
  S.srcs[0].onended = () => { if (S.playing && now() >= S.dur - 0.1) ended(); };
  S.offset = off; S.startAt = when;
}
function play() {
  if (!S.vocalBuf || !S.pianoBuf) return;
  if (S.offset >= S.dur - 0.1) S.offset = 0;
  S.playing = true; startSources(S.offset);
  if (S.video) { S.video.currentTime = S.offset; S.video.play().catch(() => { }); }
  icon();
}
function stop() {
  if (S.playing) S.offset = now();
  S.playing = false; stopSources();
  if (S.video) S.video.pause();
  icon();
}
function ended() {
  S.playing = false; stopSources(); S.offset = S.dur; if (S.video) S.video.pause(); icon();
  if (S.exporting) setTimeout(() => S.rec && S.rec.state !== 'inactive' && S.rec.stop(), 250);
}
function seek(t) {
  S.offset = Math.max(0, Math.min(S.dur, t));
  if (S.playing) startSources(S.offset);
  if (S.video) S.video.currentTime = S.offset;
}
const icon = () => { $('ic-play').innerHTML = S.playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5.5v13l11-6.5z"/>'; };

const LO = 36, HI = 96, BLACK = [1, 3, 6, 8, 10];
const cv = $('cv'), g = cv.getContext('2d');
let W = 1080, MH = 810, KH = 150, whites = [];

function setupCanvas() {
  if (S.video) { W = 1080; const m = S.frameW, pad = 0, vw = W - 2 * (m + pad), vh = Math.round(vw * S.video.videoHeight / S.video.videoWidth); S.vr = { x: m + pad, y: m + pad, w: vw, h: vh, m }; MH = vh + 2 * (m + pad); }
  else { W = 1080; MH = 1302; }
  whites = []; for (let m = LO; m <= HI; m++) if (!BLACK.includes(m % 12)) whites.push(m);
  KH = Math.round(W / whites.length * 4.6);
  MH -= MH % 2; KH -= KH % 2;
  cv.width = W; cv.height = MH + KH;
  S.cover = makeCover();
  document.fonts.load('500 30px Poppins').then(() => { if (S.grid) S.cover = makeCover(); });
}

function paintFrame(c, w, h) {
  const col = S.frameColor, n = parseInt(col.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  const ink = lum > 0.95 ? '#F3E3A0' : '#FFFFFF';
  c.fillStyle = col; c.fillRect(0, 0, w, h);
  c.fillStyle = ink;
  const p = S.framePattern;
  if (p === 'check') {
    c.globalAlpha = 0.5;
    for (let x = 0; x < w; x += 36) c.fillRect(x, 0, 18, h);
    for (let y = 0; y < h; y += 36) c.fillRect(0, y, w, 18);
    c.globalAlpha = 1; return;
  }
  if (p === 'plain') return;
  const step = p === 'dots' ? 22 : p === 'stars' ? 27 : 24;
  for (let y = step / 2, r = 0; y < h + step; y += step, r++) for (let x = (r % 2) * step + step / 2; x < w + step; x += step * 2) {
    if (p === 'dots') { c.beginPath(); c.arc(x, y, 4.2, 0, 7); c.fill(); }
    else if (p === 'stars') {
      c.save(); c.translate(x, y); c.rotate(((r * 7 + x) % 5) * 0.25); c.beginPath();
      for (let k = 0; k < 10; k++) { const rr = k % 2 ? 3.4 : 8, an = k * Math.PI / 5 - Math.PI / 2; c.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      c.closePath(); c.fill(); c.restore();
    } else {
      const blue = (n & 255) > (n >> 16) + 12, dark = lum < 0.62;
      const leaf = (lx, ly, len, wd, rot) => { c.save(); c.translate(lx, ly); c.rotate(rot); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.45, -wd, len, 0); c.quadraticCurveTo(len * 0.45, wd, 0, 0); c.fill(); c.restore(); };
      c.save(); c.translate(x, y); c.rotate([0.3, 2.5, -1.1, 3.9, 1.4, -2.4, 0.9, 4.6][(r * 3 + Math.round(x / step)) % 8]);
      c.strokeStyle = dark ? '#F4EEDC' : '#6C7455'; c.lineWidth = 1.1; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-9, 10); c.quadraticCurveTo(-4, 5, 1, -1); c.stroke();
      c.fillStyle = dark ? '#E9E4CC' : '#7E8862';
      leaf(-6, 7, 8.5, 2.6, -2.5); leaf(-3, 3.5, 8, 2.5, 0.25); leaf(-8, 9, 6, 2, 1.9);
      const pc = blue ? ['#F0B4C2', '#DE8FA4', '#C9708A'] : ['#A3AEDB', '#8792C8', '#636EAB'];
      c.fillStyle = pc[0];
      for (let k = 0; k < 5; k++) { const an = k * 1.2566 + 0.4; c.beginPath(); c.ellipse(3 + Math.cos(an) * 3.1, -4.5 + Math.sin(an) * 3.1, 3, 2.5, an, 0, 7); c.fill(); }
      c.fillStyle = pc[1];
      for (let k = 0; k < 3; k++) { const an = k * 1.2566 + 2.1; c.beginPath(); c.ellipse(3 + Math.cos(an) * 2.6, -4.5 + Math.sin(an) * 2.6, 2, 1.5, an, 0, 7); c.fill(); }
      c.fillStyle = pc[2]; c.beginPath(); c.arc(3, -4.5, 1.3, 0, 7); c.fill();
      c.fillStyle = ink;
      c.restore();
    }
  }
}
function makeCover() {
  const o = document.createElement('canvas'); o.width = W; o.height = MH;
  const c = o.getContext('2d');
  paintFrame(c, W, MH);
  const vid = !!S.video;
  const fm = S.frameW ? S.frameW + 16 : 0, px = vid ? S.vr.m : fm, py = vid ? S.vr.m : fm, pw = W - 2 * px, ph = MH - 2 * py;
  if (vid) return { canvas: o, px, py, pw, ph };
  c.fillStyle = '#FFFFFB'; c.fillRect(px, py, pw, ph);
  c.setLineDash([7, 7]); c.strokeStyle = '#E9E2C8'; c.lineWidth = 2; c.beginPath(); c.rect(px + 16, py + 16, pw - 32, ph - 32); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#5F87D9'; c.textAlign = 'center';
  c.font = '500 30px Poppins, sans-serif'; c.letterSpacing = '5px';
  c.fillText('a cappella  ·  piano ver.', W / 2, py + 96);
  return { canvas: o, px, py, pw, ph };
}

function drawMedia(t) {
  if (S.video) {
    const r = S.vr;
    g.drawImage(S.cover.canvas, 0, 0);
    g.fillStyle = '#EDE6CF'; g.fillRect(r.x, r.y, r.w, r.h);
    try { g.drawImage(S.video, r.x, r.y, r.w, r.h); } catch { }
    return;
  }
  const { canvas, px, py, pw, ph } = S.cover;
  g.drawImage(canvas, 0, 0);
  const x0 = px + 60, x1 = px + pw - 60, yMid = py + ph * 0.5, span = 6;
  let lo = 127, hi = 0; for (const n of S.notes) { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); }
  const rng = Math.max(12, hi - lo + 2), unit = Math.min(40, (ph * 0.55) / rng), mid = (lo + hi) / 2;
  g.save(); g.beginPath(); g.rect(x0, py + 120, x1 - x0, ph - 160); g.clip();
  for (const n of S.notes) {
    const a = x0 + (n.t0 - t + span / 2) / span * (x1 - x0), b = x0 + (n.t1 - t + span / 2) / span * (x1 - x0);
    if (b < x0 || a > x1) continue;
    const on = t >= n.t0 && t <= n.t1;
    g.fillStyle = on ? '#5F87D9' : t > n.t1 ? '#C9DBF8' : '#FFE27A';
    g.beginPath(); g.roundRect(a, yMid - (n.m - mid) * unit - unit * 0.42, Math.max(6, b - a - 3), unit * 0.84, unit * 0.42); g.fill();
  }
  g.restore();
  g.strokeStyle = '#F6C3CF'; g.lineWidth = 3; g.setLineDash([3, 9]); g.lineCap = 'round';
  g.beginPath(); g.moveTo(W / 2, py + 130); g.lineTo(W / 2, py + ph - 50); g.stroke(); g.setLineDash([]);
}

function curSeg(t) { const s = S.grid.segs; for (let i = 0; i < s.length; i++) if (t >= s[i].t0 && t < s[i].t1) return i; return -1; }

function draw() {
  requestAnimationFrame(draw);
  if (document.body.dataset.state !== 'ready' || !S.grid) return;
  const t = now();
  if (S.video && S.playing && Math.abs(S.video.currentTime - t) > 0.18) S.video.currentTime = t;
  drawMedia(t);
  const lit = new Map();
  for (const e of S.events) {
    if (e.t > t) break;
    const a = 1 - (t - e.t) / Math.min(0.55, e.dur);
    if (a > 0) lit.set(e.m, Math.max(lit.get(e.m) || 0, 0.35 + 0.65 * a));
  }
  let sung = -1;
  for (const n of S.notes) if (t >= n.t0 && t <= n.t1) { sung = n.m; break; }
  const y0 = MH, ww = W / whites.length;
  g.fillStyle = '#FFFDF3'; g.fillRect(0, y0, W, KH);
  whites.forEach((m, i) => {
    const x = i * ww, a = lit.get(m);
    g.fillStyle = '#fff'; g.fillRect(x, y0, ww, KH);
    if (m === sung) { g.fillStyle = '#FFD84D'; g.fillRect(x, y0, ww, KH); }
    if (a) { g.globalAlpha = a; g.fillStyle = '#7FA9F2'; g.fillRect(x, y0, ww, KH); g.globalAlpha = 1; }
    g.fillStyle = '#D9D2BC'; g.fillRect(x + ww - 1, y0, 1, KH);
  });
  const bw = ww * 0.62, bh = KH * 0.62;
  whites.forEach((m, i) => {
    const b = m + 1; if (!BLACK.includes(b % 12) || b > HI) return;
    const x = (i + 1) * ww - bw / 2, a = lit.get(b);
    g.fillStyle = '#3B352B'; g.beginPath(); g.roundRect(x, y0, bw, bh, [0, 0, 3, 3]); g.fill();
    if (b === sung) { g.fillStyle = '#F2C230'; g.beginPath(); g.roundRect(x, y0, bw, bh, [0, 0, 3, 3]); g.fill(); }
    if (a) { g.globalAlpha = a; g.fillStyle = '#5F87D9'; g.beginPath(); g.roundRect(x, y0, bw, bh, [0, 0, 3, 3]); g.fill(); g.globalAlpha = 1; }
  });
  g.fillStyle = '#F6C3CF'; g.fillRect(0, y0, W, Math.max(3, KH * 0.035));
  const si = curSeg(t), ch = si >= 0 && S.grid.segs[si].chord >= 0 ? S.plan.vocab[S.grid.segs[si].chord].name : '';
  if (S.showChord && ch) {
    const fs = Math.round(W * 0.05);
    g.font = `500 ${Math.round(fs * 0.8)}px Poppins, sans-serif`;
    if (S.video) {
      g.textAlign = 'left'; g.lineWidth = fs * 0.12; g.strokeStyle = 'rgba(60,50,30,.35)'; g.lineJoin = 'round';
      const cx = S.vr.x + S.vr.w * 0.04, cy = S.vr.y + S.vr.h - fs * 0.55;
      g.strokeText(ch, cx, cy); g.fillStyle = '#FFFBE6'; g.fillText(ch, cx, cy);
    } else { g.textAlign = 'center'; g.fillStyle = '#4B4436'; g.font = `500 ${fs * 1.15}px Poppins, sans-serif`; g.fillText(ch, W / 2, S.cover.py + S.cover.ph - 62); }
  }
  if (!seeking) { $('seek').value = S.dur ? t / S.dur * 1000 : 0; fill($('seek')); }
  $('time').textContent = `${fmt(t)} / ${fmt(S.dur)}`;
  if (si !== lastSeg) { lastSeg = si; document.querySelectorAll('#chords button').forEach(b => b.classList.toggle('now', +b.dataset.i === si)); }
}
let lastSeg = -2, seeking = false;

function renderUI() {
  const c = S.tune.global * 100, a4 = 440 * Math.pow(2, S.tune.global / 12);
  $('facts').innerHTML = `<li><b>${keyName(S.key)}</b><span>key</span></li><li><b>♩ = ${Math.round(S.bt.bpm)}</b><span>tempo</span></li><li><b>±${Math.round(S.tune.meanDev)} 音分</b><span>pitch wobble</span></li>`;
  const dir = Math.abs(c) < 4 ? '几乎就在标准音上' : `比标准音${c > 0 ? '高' : '低'} <b>${Math.abs(Math.round(c))} 音分</b>（A = ${a4.toFixed(1)} Hz）`;
  const drift = Math.abs(S.tune.drift) > 12 ? `，唱到后面慢慢${S.tune.drift > 0 ? '升' : '降'}了 ${Math.abs(Math.round(S.tune.drift))} 音分` : '';
  $('tuneline').innerHTML = `你的起音${dir}${drift} —— 钢琴已经悄悄跟着你调好了。`;
  const sel = $('keysel');
  sel.innerHTML = `<option value="">自动（${keyName(S.keys[0])}）</option>` + ['maj', 'min'].map(mo => PC.map((n, i) => `<option value="${i}-${mo}">${n} ${mo === 'maj' ? '大调' : '小调'}</option>`).join('')).join('');
  sel.value = S.keyForce ? `${S.keyForce.tonic}-${S.keyForce.mode}` : '';
  renderChords();
}

function renderChords() {
  const box = $('chords'); box.innerHTML = ''; lastSeg = -2;
  const { segs } = S.grid, { first, last, vocab } = S.plan;
  for (let i = first; i <= last; i++) {
    if (segs[i].barStart && i > first) { const s = document.createElement('span'); s.className = 'bar-sep'; box.appendChild(s); }
    const b = document.createElement('button');
    b.dataset.i = i; b.textContent = vocab[segs[i].chord].name;
    if (i > first && !segs[i].barStart && segs[i - 1].chord === segs[i].chord) b.classList.add('same');
    b.onclick = ev => openPop(ev.currentTarget, i);
    box.appendChild(b);
  }
}

function openPop(btn, i) {
  const pop = $('pop'); pop.innerHTML = '';
  S.plan.vocab.forEach((c, k) => {
    const b = document.createElement('button'); b.textContent = c.name;
    if (k === S.grid.segs[i].chord) b.classList.add('on');
    b.onclick = () => { S.grid.segs[i].chord = k; pop.hidden = true; renderChords(); resynth(); };
    pop.appendChild(b);
  });
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + window.scrollX + 'px';
  pop.style.top = r.bottom + 8 + window.scrollY + 'px';
  seek(Math.max(0, S.grid.segs[i].t0));
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('#pop') && !e.target.closest('#chords')) $('pop').hidden = true; });

function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
function exportVideo() {
  if (S.exporting) return;
  stop(); seek(0);
  const ctx = audio(), dest = ctx.createMediaStreamDestination();
  S.master.connect(dest);
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    S.master.disconnect(dest); S.exporting = false; S.rec = null;
    $('b-export').disabled = false; $('b-export').lastChild.textContent = '保存视频';
    save(new Blob(chunks, { type: mime }), `hum-keys.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
    toast('存好啦，去发吧 ♡');
  };
  S.rec = rec; S.exporting = true;
  $('b-export').disabled = true; $('b-export').lastChild.textContent = '正在录制成片…';
  toast('会完整播一遍来录成片，这期间别切走这个页面', 5000);
  rec.start(200);
  setTimeout(play, 150);
}

let cap = null;
async function openCapture(cam) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: cam ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
    });
    cap = { stream, cam, rec: null, t0: 0 };
    $('capbox').classList.toggle('cam', cam);
    if (cam) { $('camv').srcObject = stream; $('camv').play(); }
    const ctx = audio(), an = ctx.createAnalyser(); an.fftSize = 1024;
    cap.node = ctx.createMediaStreamSource(stream); cap.node.connect(an); cap.an = an;
    $('caphint').textContent = '准备好就按下去，唱完再按一次 · 戴耳机或安静一点效果最好';
    setState('capture'); capLoop();
  } catch (e) { toast(cam ? '没拿到摄像头/麦克风权限，可以改用上传' : '没拿到麦克风权限，可以改用上传', 4000); }
}
function capLoop() {
  if (!cap) return;
  requestAnimationFrame(capLoop);
  if (cap.rec) $('timer').textContent = fmt((performance.now() - cap.t0) / 1000);
  if (cap.cam) return;
  const c = $('micwave'), x = c.getContext('2d'), d = new Uint8Array(512);
  cap.an.getByteTimeDomainData(d);
  x.clearRect(0, 0, 600, 120); x.strokeStyle = '#8DB3F2'; x.lineWidth = 3; x.lineCap = 'round'; x.beginPath();
  for (let i = 0; i < 512; i += 4) { const y = 60 + (d[i] - 128) / 128 * 110; i ? x.lineTo(i / 512 * 600, y) : x.moveTo(0, y); }
  x.stroke();
}
function closeCapture() {
  if (!cap) return;
  cap.stream.getTracks().forEach(t => t.stop()); cap.node.disconnect(); $('camv').srcObject = null;
  $('v-capture').classList.remove('recording'); cap = null;
}
function toggleRec() {
  if (!cap) return;
  if (cap.rec) { cap.rec.stop(); return; }
  const mime = (cap.cam ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']).find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(cap.stream, { mimeType: mime, videoBitsPerSecond: 6e6, audioBitsPerSecond: 192000 });
  const chunks = [], cam = cap.cam;
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => { closeCapture(); load(new Blob(chunks, { type: mime }), cam); };
  cap.rec = rec; cap.t0 = performance.now();
  $('v-capture').classList.add('recording');
  rec.start();
}

$('file').onchange = e => { const f = e.target.files[0]; if (f) load(f, f.type.startsWith('video')); e.target.value = ''; };
const drop = $('drop');
['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) load(f, f.type.startsWith('video')); });
$('b-cam').onclick = () => openCapture(true);
$('b-mic').onclick = () => openCapture(false);
$('b-rec').onclick = toggleRec;
$('b-capback').onclick = () => { if (cap && cap.rec) { cap.rec.onstop = null; cap.rec.stop(); } closeCapture(); setState('empty'); };
$('b-demo').onclick = () => load(demoVoice(audio()), false);
$('b-play').onclick = () => S.playing ? stop() : play();
$('b-again').onclick = () => { stop(); $('pop').hidden = true; setState('empty'); };
$('b-export').onclick = exportVideo;
$('b-wav').onclick = () => save(wavBlob(S.pianoBuf), 'piano-only.wav');
const sk = $('seek');
sk.addEventListener('pointerdown', () => seeking = true);
sk.addEventListener('input', () => fill(sk));
sk.addEventListener('change', () => { seek(sk.value / 1000 * S.dur); seeking = false; });
$('styles').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#styles button').forEach(x => x.classList.toggle('on', x === b));
  S.style = b.dataset.s; resynth();
};
for (const [id, gain] of [['vol-p', 'gP'], ['vol-v', 'gV']]) {
  const el = $(id); fill(el);
  el.oninput = () => { fill(el); audio(); S[gain].gain.value = el.value / 100 * (gain === 'gP' ? 1 : 1); };
}
const rethink = () => { harmonize(); renderUI(); resynth(); };
$('keysel').onchange = e => { const v = e.target.value; if (!v) S.keyForce = null; else { const [t, m] = v.split('-'); S.keyForce = { tonic: +t, mode: m }; } rethink(); };
$('meter').onchange = e => { S.meter = +e.target.value; rethink(); };
document.querySelector('.mini').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.mini button').forEach(x => x.classList.toggle('on', x === b));
  S.tempoF = +b.dataset.f; rethink();
};
try { const s = JSON.parse(localStorage.getItem('hum-frame')); if (s && /^#[0-9a-f]{6}$/i.test(s.c)) { S.frameColor = s.c; S.framePattern = s.p; if ([0, 24, 46, 76, 110].includes(s.w)) S.frameW = s.w; } } catch { }
const frameUI = () => {
  document.querySelectorAll('#swatches button').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === S.frameColor.toLowerCase()));
  document.querySelectorAll('#patterns button').forEach(b => b.classList.toggle('on', b.dataset.p === S.framePattern));
  $('customcol').value = S.frameColor;
  try { localStorage.setItem('hum-frame', JSON.stringify({ c: S.frameColor, p: S.framePattern, w: S.frameW })); } catch { }
  document.querySelectorAll('#framew button').forEach(b => b.classList.toggle('on', +b.dataset.w === S.frameW));
  for (const id of ['swatches', 'patterns']) { $(id).style.opacity = S.frameW ? '' : '.35'; $(id).style.pointerEvents = S.frameW ? '' : 'none'; }
  if (S.grid) setupCanvas();
};
$('framew').onclick = e => { const b = e.target.closest('button'); if (b) { S.frameW = +b.dataset.w; frameUI(); } };
$('swatches').onclick = e => { const b = e.target.closest('button'); if (b) { S.frameColor = b.dataset.c; frameUI(); } };
$('customcol').oninput = e => { S.frameColor = e.target.value; frameUI(); };
$('patterns').onclick = e => { const b = e.target.closest('button'); if (b) { S.framePattern = b.dataset.p; frameUI(); } };
frameUI();
$('showchord').onchange = e => S.showChord = e.target.checked;
document.addEventListener('keydown', e => { if (e.code === 'Space' && document.body.dataset.state === 'ready' && !/INPUT|SELECT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); S.playing ? stop() : play(); } });
document.fonts.load('500 30px Poppins');
draw();
