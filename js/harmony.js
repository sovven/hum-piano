const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const PC = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const wrap = v => v - Math.round(v);

export function estimateTuning(notes, dur) {
  let s = 0, c = 0;
  for (const n of notes) { const w = n.t1 - n.t0, a = 2 * Math.PI * n.p; s += w * Math.sin(a); c += w * Math.cos(a); }
  const global = Math.atan2(s, c) / (2 * Math.PI);
  const step = 0.5, K = Math.max(1, Math.ceil(dur / step) + 1);
  const curve = new Float32Array(K);
  let prev = global;
  for (let k = 0; k < K; k++) {
    const t = k * step;
    let ss = 0, cc = 0, ww = 0;
    for (const n of notes) {
      const g = (n.t1 - n.t0) * Math.exp(-0.5 * Math.pow(((n.t0 + n.t1) / 2 - t) / 4, 2));
      const a = 2 * Math.PI * wrap(n.p - prev);
      ss += g * Math.sin(a); cc += g * Math.cos(a); ww += g;
    }
    if (ww > 1e-6) {
      const R = Math.hypot(ss, cc) / ww;
      prev += Math.atan2(ss, cc) / (2 * Math.PI) * Math.min(1, R / 0.3);
    }
    curve[k] = prev;
  }
  const at = t => {
    const x = Math.max(0, Math.min(K - 1, t / step)), i = Math.floor(x), j = Math.min(K - 1, i + 1);
    return curve[i] + (curve[j] - curve[i]) * (x - i);
  };
  let dev = 0, wsum = 0;
  for (const n of notes) {
    const d = n.p - at((n.t0 + n.t1) / 2);
    n.m = Math.round(d);
    n.dev = (d - n.m) * 100;
    const w = n.t1 - n.t0;
    n.w = Math.max(0.15, Math.min(1, (w - 0.06) / 0.2)) * (1 - 0.6 * Math.min(1, Math.abs(n.dev) / 50));
    dev += Math.abs(n.dev) * w; wsum += w;
  }
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < K; k++) { lo = Math.min(lo, curve[k]); hi = Math.max(hi, curve[k]); }
  return { global, at, meanDev: wsum ? dev / wsum : 0, drift: (curve[K - 1] - curve[0]) * 100, span: (hi - lo) * 100 };
}

export function estimateKey(notes) {
  const h = new Float32Array(12);
  for (const n of notes) h[((n.m % 12) + 12) % 12] += (n.t1 - n.t0) * n.w;
  const corr = (prof, tonic) => {
    let mh = 0, mp = 0;
    for (let i = 0; i < 12; i++) { mh += h[i]; mp += prof[i]; }
    mh /= 12; mp /= 12;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < 12; i++) { const x = h[(i + tonic) % 12] - mh, y = prof[i] - mp; a += x * y; b += x * x; c += y * y; }
    return b > 0 ? a / Math.sqrt(b * c) : 0;
  };
  const out = [];
  for (let t = 0; t < 12; t++) { out.push({ tonic: t, mode: 'maj', score: corr(KS_MAJ, t) }); out.push({ tonic: t, mode: 'min', score: corr(KS_MIN, t) }); }
  out.sort((a, b) => b.score - a.score);
  return out;
}

const SH = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flatKey = k => (k.mode === 'maj' ? [5, 10, 3, 8, 1, 0] : [2, 7, 0, 5, 10, 3]).includes(k.tonic);
export const keyName = k => PC[k.tonic] + (k.mode === 'maj' ? ' 大调' : ' 小调');

const VOCAB = {
  maj: {
    ch: [[0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min'], [10, 'maj'], [5, 'min'], [4, 'maj']],
    prior: [1, .5, .35, .9, .9, .8, .1, .1, .1],
    T: [[0, .1, .1, .3, .3, .2, .06, .03, .05], [.1, 0, .1, .1, .6, .1, .02, .02, .03], [.05, .1, 0, .4, .05, .4, 0, 0, 0], [.35, .1, .05, 0, .35, .15, .04, .25, .02], [.5, 0, .05, .15, 0, .3, .02, .02, .05], [.05, .25, .1, .4, .2, 0, .03, .02, .04],
      [.4, .03, 0, .45, .05, .07, 0, 0, 0], [.65, .03, 0, .05, .25, 0, 0, 0, 0], [.03, .03, 0, .2, 0, .7, 0, 0, 0]],
    scale: [0, 2, 4, 5, 7, 9, 11]
  },
  min: {
    ch: [[0, 'min'], [3, 'maj'], [5, 'min'], [7, 'min'], [7, 'maj'], [8, 'maj'], [10, 'maj']],
    prior: [1, .6, .8, .4, .5, .85, .75],
    T: [[0, .1, .25, .05, .15, .25, .2], [.1, 0, .2, 0, 0, .4, .3], [.3, 0, 0, .1, .3, .05, .25], [.5, 0, .2, 0, 0, .3, 0], [.7, 0, 0, 0, 0, .3, 0], [.1, .2, .2, 0, .15, 0, .35], [.35, .4, 0, .1, 0, .15, 0]],
    scale: [0, 2, 3, 5, 7, 8, 10]
  }
};

export function chordVocab(key) {
  return VOCAB[key.mode].ch.map(([deg, q]) => {
    const root = (key.tonic + deg) % 12;
    return { root, q, name: (flatKey(key) ? PC : SH)[root] + (q === 'min' ? 'm' : '') };
  });
}

function toneWeight(iv, q) {
  if (iv === 0) return 1;
  if (iv === 7) return .8;
  if (q === 'maj') return iv === 4 ? .9 : iv === 11 ? .3 : iv === 2 || iv === 9 || iv === 10 ? .2 : iv === 5 ? -1 : iv === 1 ? -1.2 : iv === 6 ? -1 : -.6;
  return iv === 3 ? .9 : iv === 10 ? .35 : iv === 2 ? .2 : iv === 5 ? .1 : iv === 8 ? -.8 : iv === 1 ? -1.2 : -.6;
}

export function buildGrid(bt, dur, meter, notes, forcePh) {
  const P = bt.period;
  const beats = bt.beats.slice();
  for (let i = 0; i < meter; i++) beats.unshift(beats[0] - P);
  for (let i = 0; i < meter + 1; i++) beats.push(beats[beats.length - 1] + P);
  const S = new Float32Array(meter);
  for (const n of notes) {
    let j = 0, bd = 1e9;
    for (let i = 0; i < beats.length; i++) { const d = Math.abs(beats[i] - n.t0); if (d < bd) { bd = d; j = i; } }
    if (bd < 0.22 * P) S[j % meter] += Math.min(1.2, n.t1 - n.t0);
  }
  let ph = 0, best = -1;
  const PS = [];
  for (let p = 0; p < meter; p++) {
    const v = S[p] + (meter === 4 ? 0.5 * S[(p + 2) % 4] : 0);
    PS.push(v);
    if (v > best) { best = v; ph = p; }
  }
  if (forcePh != null) ph = forcePh;
  const segs = [];
  const span = meter === 4 ? 2 : meter;
  for (let b = ph; b + span < beats.length; b += span) {
    const t0 = beats[b], t1 = beats[b + span];
    if (t1 <= 0 || t0 >= dur) continue;
    const inBar = ((b - ph) % meter + meter) % meter;
    segs.push({ b0: b, b1: b + span, t0, t1, barStart: inBar === 0, inBar, chord: -1 });
  }
  return { beats, segs, ph, meter, PS };
}

export function chooseChords(grid, notes, key) {
  const V = VOCAB[key.mode], vocab = chordVocab(key), nC = vocab.length;
  const segs = grid.segs;
  if (!notes.length || !segs.length) return { vocab, first: 0, last: -1, score: -1e9 };
  const tA = notes[0].t0, tB = notes[notes.length - 1].t1;
  let first = segs.findIndex(s => s.t1 > tA + 0.05); if (first < 0) first = 0;
  let last = segs.length - 1;
  while (last > first && segs[last].t0 >= tB - 0.05) last--;
  const E = [];
  for (let i = first; i <= last; i++) {
    const s = segs[i], row = new Float32Array(nC), len = s.t1 - s.t0;
    for (const n of notes) {
      const ov = Math.min(n.t1, s.t1) - Math.max(n.t0, s.t0);
      if (ov <= 0) continue;
      const head = n.t0 >= s.t0 - 0.08 && n.t0 < s.t0 + len * 0.3 ? 1.6 : 1;
      for (let c = 0; c < nC; c++) row[c] += ov * n.w * head * toneWeight(((n.m - vocab[c].root) % 12 + 12) % 12, vocab[c].q);
    }
    for (let c = 0; c < nC; c++) row[c] = row[c] / len;
    E.push(row);
  }
  const L = E.length, wE = 4.5;
  const D = [], B = [];
  for (let i = 0; i < L; i++) {
    const s = segs[first + i];
    D.push(new Float32Array(nC)); B.push(new Int8Array(nC));
    for (let c = 0; c < nC; c++) {
      const em = wE * E[i][c] + 0.4 * Math.log(V.prior[c]);
      if (i === 0) { D[0][c] = em + (c === 0 ? 0.8 : 0); continue; }
      let bs = -1e9, bi = 0;
      for (let p = 0; p < nC; p++) {
        const tr = p === c ? Math.log(s.barStart ? 0.14 : 0.8) : Math.log(V.T[p][c] + 0.02) + (s.barStart ? 0 : -0.9);
        const v = D[i - 1][p] + tr;
        if (v > bs) { bs = v; bi = p; }
      }
      D[i][c] = bs + em; B[i][c] = bi;
    }
  }
  D[L - 1][0] += 1.2;
  let c = 0;
  for (let k = 1; k < nC; k++) if (D[L - 1][k] > D[L - 1][c]) c = k;
  const score = D[L - 1][c] / L;
  for (let i = L - 1; i >= 0; i--) { segs[first + i].chord = c; c = B[i][c]; }
  for (let i = 0; i < segs.length; i++) if (i < first || i > last) segs[i].chord = -1;
  const has = i => notes.some(n => Math.min(n.t1, segs[i].t1) - Math.max(n.t0, segs[i].t0) > 0.03);
  for (let i = first; i <= last;) {
    if (has(i)) { i++; continue; }
    let j = i; while (j + 1 <= last && !has(j + 1)) j++;
    if (j - i + 1 >= 3) for (let k = i + 1; k <= j; k++) segs[k].chord = -1;
    i = j + 1;
  }
  return { vocab, first, last, score };
}

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function arrange(grid, plan, key, style, dur, notes = []) {
  const { beats, segs, meter } = grid, { vocab, first, last } = plan;
  const ev = [];
  if (last < first) return ev;
  const rnd = rng(7);
  const scale = VOCAB[key.mode].scale.map(d => (d + key.tonic) % 12);
  const tAt = b => { const i = Math.floor(b), f = b - i; return beats[i] + (beats[Math.min(beats.length - 1, i + 1)] - beats[i]) * f; };
  const put = (t, m, vel, end) => {
    t += (rnd() - 0.5) * 0.012;
    if (t < 0 || t >= dur - 0.05) return;
    ev.push({ t, m, vel: Math.max(0.08, Math.min(1, vel + (rnd() - 0.5) * 0.07)), dur: Math.max(0.15, end - t) });
  };
  const voic = (ch, s) => {
    let third = ch.q === 'maj' ? 4 : 3, fifth = 7;
    const held = new Float32Array(12);
    for (const n of notes) { const ov = Math.min(n.t1, s.t1) - Math.max(n.t0, s.t0); if (ov > 0) held[((n.m - ch.root) % 12 + 12) % 12] += ov * (n.w ?? 1); }
    const sus = (iv, alts) => { if (held[iv] > 0.12) return iv; for (const q of alts) if (held[q] > 0.28) return q; return iv; };
    third = sus(third, ch.q === 'maj' ? [5, 3] : [2, 4]);
    fifth = sus(fifth, [8, 6]);
    const tones = [ch.root, ch.root + third, ch.root + fifth].map(p => { let m = 48 + (p % 12); while (m < 55) m += 12; while (m > 66) m -= 12; return m; }).sort((a, b) => a - b);
    let bass = 36 + ch.root; if (bass > 45) bass -= 12;
    return { tones, bass, third, fifth };
  };
  for (let i = first; i <= last; i++) {
    const s = segs[i];
    if (s.chord < 0) continue;
    const ch = vocab[s.chord], v = voic(ch, s);
    const isNew = i === first || s.barStart || segs[i - 1].chord !== s.chord;
    let j = i;
    while (j + 1 <= last && !segs[j + 1].barStart && segs[j + 1].chord === s.chord) j++;
    const end = segs[j].t1 + 0.04;
    const nb = s.b1 - s.b0;
    if (isNew) { put(s.t0, v.bass, .66, end); put(s.t0 + 0.004, v.bass + 12, .36, end); }
    if (style === 'block') {
      for (let k = 0; k < nb; k++) {
        const t = beats[s.b0 + k], strong = isNew && k === 0;
        const pos = s.inBar + k;
        if (!strong && pos === 2) put(t, v.bass + v.fifth, .38, end);
        if (strong || meter === 3 || pos % 2 === 0 || true) v.tones.forEach((m, q) => put(t + q * 0.011, m, strong ? .54 : .3, strong ? end : Math.min(end, beats[s.b0 + k + 1] + 0.1)));
      }
    } else if (style === 'dream') {
      const b = v.bass + 12;
      const ninth = scale.includes((ch.root + 2) % 12) ? 26 : 24;
      const up = [0, v.fifth, 12, 12 + v.third, 12 + v.fifth, ninth, 24 + v.third, 24 + v.fifth];
      const steps = nb * 4;
      for (let q = 0; q < steps; q++) {
        if (isNew && q === 0) continue;
        const pos = (s.inBar * 4 + q) % 16;
        const idx = pos < 8 ? pos : 15 - pos;
        const m = b + up[Math.max(0, Math.min(7, idx))];
        put(tAt(s.b0 + q / 4), m, .3 + (q % 4 === 0 ? .1 : 0) + idx * 0.012, end);
      }
    } else {
      const [a, b2, c] = v.tones;
      const pat = meter === 3 ? [a, b2, c, b2, c, b2] : [a, b2, c, b2, a + 12, c, b2, c];
      for (let q = 0; q < nb * 2; q++) {
        const pos = (s.inBar * 2 + q) % pat.length;
        put(tAt(s.b0 + q / 2), pat[pos], (q % 2 === 0 ? .46 : .36) + (pos === 4 ? .06 : 0), end);
      }
    }
  }
  const ls = segs[last];
  if (ls.chord >= 0 && ls.t1 < dur - 0.35) {
    const v = voic(vocab[ls.chord], ls);
    put(ls.t1, v.bass, .6, dur);
    [v.bass + 12, ...v.tones, v.tones[0] + 12].forEach((m, q) => put(ls.t1 + 0.03 + q * 0.035, m, .44, dur));
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
