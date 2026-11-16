const tick = () => new Promise(r => setTimeout(r));

export async function renderPiano(events, dur, tuneAt, sr = 44100, onProgress) {
  const N = Math.ceil(dur * sr);
  const L = new Float32Array(N), R = new Float32Array(N);
  const relR = Math.exp(-1 / (0.11 * sr));
  let done = 0;
  for (const e of events) {
    const f0 = 440 * Math.pow(2, (e.m - 69 + tuneAt(e.t)) / 12);
    const s0 = Math.floor(e.t * sr);
    const relAt = Math.floor(Math.min(e.dur, 7) * sr);
    const total = Math.min(N - s0, relAt + Math.floor(0.6 * sr));
    if (total <= 0) continue;
    const tau1 = Math.max(0.35, Math.min(5, 4.5 * Math.pow(2, -(e.m - 36) / 16)));
    const B = 0.00012 * Math.pow(2, (e.m - 48) / 14);
    const slope = 1.95 - 0.85 * e.vel;
    const amp = Math.pow(e.vel, 1.3) * 0.5;
    const pan = Math.max(0.2, Math.min(0.8, 0.5 + (e.m - 60) / 80));
    const nPart = Math.max(2, Math.min(12, Math.floor(15000 / f0)));
    for (let n = 1; n <= nPart; n++) {
      const strings = n <= 3 ? 2 : 1;
      for (let st = 0; st < strings; st++) {
        const f = n * f0 * Math.sqrt(1 + B * n * n) * (st ? 1.0008 : 1);
        if (f > sr * 0.45) continue;
        const w = 2 * Math.PI * f / sr;
        const tau = tau1 / (1 + 0.38 * (n - 1));
        let r = Math.exp(-1 / (tau * sr));
        const A = amp * Math.pow(n, -slope) * (0.35 + 0.65 * Math.abs(Math.sin(n * Math.PI * 0.13))) * (st ? 0.5 : 1);
        const p = st ? pan + 0.12 : pan - (n % 2 ? 0.04 : -0.04);
        const gl = A * Math.cos(p * Math.PI / 2), gr = A * Math.sin(p * Math.PI / 2);
        let c = 2 * r * Math.cos(w), r2 = r * r;
        let y2 = 0, y1 = r * Math.sin(w), env = r;
        L[s0] += 0;
        for (let i = 1; i < total; i++) {
          if (i === relAt) { r *= relR; c = 2 * r * Math.cos(w); r2 = r * r; }
          const idx = s0 + i;
          L[idx] += gl * y1; R[idx] += gr * y1;
          const y = c * y1 - r2 * y2; y2 = y1; y1 = y;
          env *= r;
          if (env < 2e-4) break;
        }
      }
    }
    if (++done % 40 === 0) { onProgress && onProgress(done / events.length); await tick(); }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
  const g = peak > 0 ? 0.62 / peak : 1;
  const fade = Math.floor(0.35 * sr);
  for (let i = 0; i < N; i++) { const k = i > N - fade ? (N - i) / fade : 1; L[i] *= g * k; R[i] *= g * k; }
  const oc = new OfflineAudioContext(2, N, sr);
  const buf = oc.createBuffer(2, N, sr);
  buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
  const irN = Math.floor(2 * sr), ir = oc.createBuffer(2, irN, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0;
    for (let i = 0; i < irN; i++) { lp += 0.25 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.exp(-i / (0.5 * sr)) * (i < 400 ? i / 400 : 1); }
  }
  const src = oc.createBufferSource(); src.buffer = buf;
  const conv = oc.createConvolver(); conv.buffer = ir;
  const wet = oc.createGain(); wet.gain.value = 0.16;
  src.connect(oc.destination); src.connect(conv); conv.connect(wet); wet.connect(oc.destination);
  src.start();
  return await oc.startRendering();
}

export function wavBlob(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels), n = buffer.length, sr = buffer.sampleRate;
  const ab = new ArrayBuffer(44 + n * ch * 2), v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s * 32767, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

export function demoVoice(ctx) {
  const sr = ctx.sampleRate, bpm = 84, beat = 60 / bpm;
  const mel = [[66, 1], [66, 1], [69, 1], [71, 1], [69, 2], [66, 2], [64, 1], [64, 1], [66, 1], [64, 1], [62, 3], [0, 1],
    [66, 1], [66, 1], [69, 1], [71, 1], [74, 2], [71, 2], [69, 1], [71, 1], [69, 1], [64, 1], [62, 4]];
  const total = mel.reduce((a, b) => a + b[1], 0) * beat + 0.6;
  const N = Math.ceil(total * sr), buf = ctx.createBuffer(1, N, sr), d = buf.getChannelData(0);
  let t = 0.25, ph = 0, cur = 66, lp1 = 0, lp2 = 0;
  for (const [m, len] of mel) {
    const s0 = Math.floor(t * sr), nn = Math.floor(len * beat * sr);
    for (let i = 0; i < nn && s0 + i < N; i++) {
      const tt = (s0 + i) / sr;
      if (m) cur += (m - cur) * 0.0025;
      const drift = 0.32 - 0.012 * tt;
      const vib = 0.18 * Math.sin(2 * Math.PI * 5.4 * tt) * Math.min(1, i / (0.25 * sr));
      const f = 440 * Math.pow(2, (cur - 69 + drift + vib) / 12);
      ph += f / sr; if (ph > 1) ph -= 1;
      const saw = 2 * ph - 1;
      lp1 += 0.16 * (saw - lp1); lp2 += 0.16 * (lp1 - lp2);
      const a = m ? Math.min(1, i / (0.03 * sr)) * Math.min(1, (nn - i) / (0.05 * sr)) : 0;
      d[s0 + i] = (lp2 * 0.8 + (Math.random() - 0.5) * 0.01) * a * 0.5;
    }
    t += len * beat;
  }
  return buf;
}
