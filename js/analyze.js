const tick = () => new Promise(r => setTimeout(r));

export async function resampleMono(audioBuffer, sr = 16000) {
  const len = Math.max(1, Math.ceil(audioBuffer.duration * sr));
  const oc = new OfflineAudioContext(1, len, sr);
  const s = oc.createBufferSource();
  s.buffer = audioBuffer;
  s.connect(oc.destination);
  s.start();
  return (await oc.startRendering()).getChannelData(0);
}

export async function trackPitch(x, sr, onProgress) {
  const hop = 160, W = 512;
  const tauMin = Math.floor(sr / 900), tauMax = Math.ceil(sr / 65);
  const n = Math.max(0, Math.floor((x.length - W - tauMax) / hop));
  const midi = new Float32Array(n), cm = new Float32Array(n), rms = new Float32Array(n);
  const d = new Float32Array(tauMax + 2);
  for (let i = 0; i < n; i++) {
    const s = i * hop;
    let e = 0;
    for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
    rms[i] = Math.sqrt(e / W);
    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) { const df = x[s + j] - x[s + j + tau]; sum += df * df; }
      run += sum;
      d[tau] = run > 0 ? sum * tau / run : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < 0.12) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau; break;
      }
    }
    if (best < 0) {
      let mn = 1e9;
      for (let tau = tauMin; tau <= tauMax; tau++) if (d[tau] < mn) { mn = d[tau]; best = tau; }
    }
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c;
    const off = den > 1e-9 ? 0.5 * (a - c) / den : 0;
    const f = sr / (best + Math.max(-1, Math.min(1, off)));
    midi[i] = 69 + 12 * Math.log2(f / 440);
    cm[i] = b;
    if (i % 150 === 0) { onProgress && onProgress(i / n); await tick(); }
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (rms[i] > mx) mx = rms[i];
  const gate = Math.max(mx * 0.04, 0.002);
  const voiced = new Uint8Array(n);
  for (let i = 0; i < n; i++) voiced[i] = cm[i] < 0.3 && rms[i] > gate ? 1 : 0;
  const sm = new Float32Array(n);
  const tmp = [];
  for (let i = 0; i < n; i++) {
    if (!voiced[i]) continue;
    tmp.length = 0;
    for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n && voiced[j]) tmp.push(midi[j]); }
    tmp.sort((p, q) => p - q);
    const med = tmp[tmp.length >> 1];
    let v = midi[i];
    if (Math.abs(v - med) > 9) v = med;
    sm[i] = tmp.length >= 3 ? (v + med) / 2 : v;
  }
  const t0 = (W / 2) / sr, dt = hop / sr;
  return { midi: sm, voiced, rms, n, t0, dt };
}

export function segmentNotes(pt) {
  const { midi, voiced, n, t0, dt } = pt;
  const notes = [];
  let cur = null, away = 0, gap = 0;
  const close = () => {
    if (!cur) return;
    const len = cur.ps.length;
    if (len * dt >= 0.07) {
      const cut = cur.ps.slice(Math.floor(len * 0.2), Math.max(Math.floor(len * 0.2) + 1, Math.ceil(len * 0.95)));
      cut.sort((a, b) => a - b);
      notes.push({ t0: t0 + cur.i0 * dt, t1: t0 + (cur.i0 + len) * dt, p: cut[cut.length >> 1] });
    }
    cur = null;
  };
  for (let i = 0; i < n; i++) {
    if (!voiced[i]) { gap++; if (gap > 5) close(); continue; }
    gap = 0;
    const p = midi[i];
    if (!cur) { cur = { i0: i, ps: [p], sum: p }; away = 0; continue; }
    const tail = cur.ps.slice(-12);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    if (Math.abs(p - mean) > 0.75) {
      away++;
      if (away >= 4) {
        const moved = cur.ps.splice(cur.ps.length - (away - 1), away - 1);
        const start = i - (away - 1);
        close();
        cur = { i0: start, ps: [...moved, p] };
        away = 0;
        continue;
      }
    } else away = 0;
    cur.ps.push(p);
  }
  close();
  return notes;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function onsetEnvelope(x, sr) {
  const N = 512, hop = 160, half = N / 2;
  const n = Math.max(0, Math.floor((x.length - N) / hop));
  const env = new Float32Array(n);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float32Array(N), im = new Float32Array(N);
  let prev = new Float32Array(half), cur = new Float32Array(half);
  for (let f = 0; f < n; f++) {
    const s = f * hop;
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < half; k++) {
      cur[k] = Math.log1p(60 * Math.hypot(re[k], im[k]));
      const df = cur[k] - prev[k];
      if (df > 0) flux += df;
    }
    env[f] = flux;
    const t = prev; prev = cur; cur = t;
  }
  return { env, fps: sr / hop, t0: (N / 2) / sr };
}

export function trackBeats(on, notes, dur, bpmForce) {
  const { fps } = on;
  const n = on.env.length;
  const e = new Float32Array(n);
  const win = Math.round(fps * 0.4);
  let acc = 0;
  const pre = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + on.env[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win);
    e[i] = Math.max(0, on.env[i] - (pre[b] - pre[a]) / (b - a));
  }
  let sd = 0;
  for (let i = 0; i < n; i++) sd += e[i] * e[i];
  sd = Math.sqrt(sd / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) e[i] /= sd;
  for (const nt of notes) {
    const c = Math.round((nt.t0 - on.t0) * fps);
    const w = Math.min(2.5, 1 + (nt.t1 - nt.t0) * 3);
    for (let k = -2; k <= 2; k++) { const j = c + k; if (j >= 0 && j < n) e[j] += w * Math.exp(-0.5 * k * k); }
  }
  let P;
  let conf = 0;
  if (bpmForce) P = fps * 60 / bpmForce;
  else {
    const l0 = Math.round(fps * 60 / 180), l1 = Math.min(Math.round(fps * 60 / 55), Math.floor(n / 2));
    const ac = l => { if (l >= n) return 0; let s = 0; for (let t = 0; t + l < n; t++) s += e[t] * e[t + l]; return s / (n - l); };
    const a0 = ac(0) || 1;
    let best = -1e9; P = fps * 0.6;
    for (let l = l0; l <= l1; l++) {
      const bpm = fps * 60 / l;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 96) / 0.7, 2));
      const v = w * (ac(l) + 0.5 * ac(2 * l) + 0.25 * ac(4 * l));
      if (v > best) { best = v; P = l; conf = ac(l) / a0; }
    }
  }
  const C = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const tight = 100;
  for (let t = 0; t < n; t++) {
    let bs = 0, bi = -1;
    const lo = Math.max(0, Math.round(t - 2 * P)), hi = Math.round(t - P / 2);
    for (let p = lo; p <= hi && p < t; p++) {
      const lg = Math.log((t - p) / P);
      const sc = C[p] - tight * lg * lg;
      if (bi < 0 || sc > bs) { bs = sc; bi = p; }
    }
    C[t] = e[t] + (bi >= 0 ? Math.max(bs, 0) : 0);
    back[t] = bi >= 0 && bs > 0 ? bi : -1;
  }
  let end = n - 1, mx = -1;
  for (let t = Math.max(0, n - Math.round(P * 1.2)); t < n; t++) if (C[t] > mx) { mx = C[t]; end = t; }
  const idx = [];
  for (let t = end; t >= 0; t = back[t]) { idx.push(t); if (back[t] < 0) break; }
  idx.reverse();
  let beats = idx.map(i => on.t0 + i / fps);
  const per = P / fps;
  if (beats.length < 2) { beats = []; for (let t = 0; t < dur; t += per) beats.push(t); }
  while (beats[0] > 0) beats.unshift(beats[0] - per);
  while (beats[beats.length - 1] < dur) beats.push(beats[beats.length - 1] + per);
  const dif = [];
  for (let i = 1; i < beats.length; i++) dif.push(beats[i] - beats[i - 1]);
  dif.sort((a, b) => a - b);
  const med = dif[dif.length >> 1] || per;
  return { beats, period: med, bpm: 60 / med, conf };
}
