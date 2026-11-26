/* =========================================================
   NEON RAIN  —  core: math / noise / procedural textures / audio
   ========================================================= */
(function () {
  'use strict';
  const T = THREE;
  const G = window.G || (window.G = {});
  G.T = T;

  /* ---------------------------- math ---------------------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let RNG = mulberry32(20261124);
  const rnd = (a = 0, b = 1) => a + (b - a) * RNG();
  const rndi = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(RNG() * arr.length)];

  G.clamp = clamp; G.lerp = lerp; G.smoothstep = smoothstep; G.damp = damp;
  G.rnd = rnd; G.rndi = rndi; G.pick = pick; G.seed = (s) => { RNG = mulberry32(s); };

  /* --------------------------- noise ---------------------------- */
  function hash2(x, y) {
    let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return h - Math.floor(h);
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbm(x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); norm += amp; f *= 2.03; amp *= 0.5; }
    return s / norm;
  }
  G.fbm = fbm; G.vnoise = vnoise;

  /* ------------------------- textures --------------------------- */
  const TEXCACHE = {};

  function dataTex(data, S, srgb) {
    const t = new T.DataTexture(data, S, S, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  G.dataTex = dataTex;

  function normalFromHeight(h, S, strength) {
    const out = new Uint8Array(S * S * 4);
    const at = (x, y) => h[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
        const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
        let nz = 1.0;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * S + x) * 4;
        out[i] = ((nx / l) * 0.5 + 0.5) * 255;
        out[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        out[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
        out[i + 3] = 255;
      }
    }
    return out;
  }
  G.normalFromHeight = normalFromHeight;

  // ---- wet asphalt -------------------------------------------------
  function makeAsphalt() {
    if (TEXCACHE.asphalt) return TEXCACHE.asphalt;
    const S = 512;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * 7, v = (y / S) * 7;
        let n = fbm(u, v, 5) * 0.75 + fbm(u * 4.1, v * 4.1, 3) * 0.25;
        const grit = hash2(x * 1.7, y * 2.3);
        if (grit > 0.9) n += 0.12;
        else if (grit < 0.08) n -= 0.08;
        // cracks / tar seams
        const cr = 1.0 - Math.abs(fbm(u * 1.35 + 17, v * 1.35 + 3, 4) * 2 - 1);
        n -= Math.pow(cr, 26) * 0.55;
        h[y * S + x] = clamp(n, 0, 1);
      }
    }
    const alb = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const n = h[y * S + x];
        const tint = fbm((x / S) * 2.2 + 40, (y / S) * 2.2 + 9, 3);
        let v = 62 + n * 96;
        v *= 0.86 + tint * 0.32;
        alb[i] = clamp(v * 1.02, 0, 255);
        alb[i + 1] = clamp(v * 1.0, 0, 255);
        alb[i + 2] = clamp(v * 1.05, 0, 255);
        alb[i + 3] = 255;
      }
    }
    const nm = normalFromHeight(h, S, 26);
    TEXCACHE.asphalt = {
      map: dataTex(alb, S, true),
      normalMap: dataTex(nm, S, false)
    };
    return TEXCACHE.asphalt;
  }
  G.asphalt = makeAsphalt;

  // ---- concrete / plaster -----------------------------------------
  function makeConcrete() {
    if (TEXCACHE.concrete) return TEXCACHE.concrete;
    const S = 512;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * 5, v = (y / S) * 5;
        let n = fbm(u, v, 5) * 0.6 + fbm(u * 5, v * 5, 3) * 0.4;
        // pockmarks
        const pk = fbm(u * 9 + 3, v * 9 + 8, 2);
        n -= pk > 0.72 ? 0.22 * (pk - 0.72) * 8 : 0;
        h[y * S + x] = clamp(n, 0, 1);
      }
    }
    const alb = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const n = h[y * S + x];
        const stain = fbm((x / S) * 3 + 21, (y / S) * 3 + 5, 4);
        // vertical rain streaks
        const streak = fbm((x / S) * 26 + 7, (y / S) * 1.2, 3);
        let v = 96 + n * 62;
        v *= 0.9 + (1 - stain) * 0.22;
        v -= Math.pow(streak, 3) * 26;
        alb[i] = clamp(v * 1.02, 0, 255);
        alb[i + 1] = clamp(v * 0.99, 0, 255);
        alb[i + 2] = clamp(v * 0.95, 0, 255);
        alb[i + 3] = 255;
      }
    }
    TEXCACHE.concrete = {
      map: dataTex(alb, S, true),
      normalMap: dataTex(normalFromHeight(h, S, 12), S, false)
    };
    return TEXCACHE.concrete;
  }
  G.concrete = makeConcrete;

  // ---- rusted metal ------------------------------------------------
  function makeRust() {
    if (TEXCACHE.rust) return TEXCACHE.rust;
    const S = 512;
    const h = new Float32Array(S * S);
    const alb = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * 6, v = (y / S) * 6;
        const base = fbm(u, v, 5);
        const rust = smoothstep(0.44, 0.72, fbm(u * 1.9 + 30, v * 1.9 + 12, 4));
        const streak = Math.pow(fbm((x / S) * 30, (y / S) * 2.5 + 4, 3), 3);
        const n = base * 0.55 + rust * 0.45;
        h[y * S + x] = clamp(n - streak * 0.2, 0, 1);
        const i = (y * S + x) * 4;
        const paint = [34, 48, 56];
        const rc = [104, 52, 26];
        const mixR = clamp(rust * 1.25 + streak * 0.5, 0, 1);
        alb[i] = clamp(paint[0] * (1 - mixR) + rc[0] * mixR + base * 22, 0, 255);
        alb[i + 1] = clamp(paint[1] * (1 - mixR) + rc[1] * mixR + base * 20, 0, 255);
        alb[i + 2] = clamp(paint[2] * (1 - mixR) + rc[2] * mixR + base * 18, 0, 255);
        alb[i + 3] = 255;
      }
    }
    TEXCACHE.rust = {
      map: dataTex(alb, S, true),
      normalMap: dataTex(normalFromHeight(h, S, 20), S, false)
    };
    return TEXCACHE.rust;
  }
  G.rust = makeRust;

  // ---- wood crate --------------------------------------------------
  function makeWood() {
    if (TEXCACHE.wood) return TEXCACHE.wood;
    const S = 256;
    const h = new Float32Array(S * S);
    const alb = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S), v = (y / S);
        const plank = Math.floor(v * 6);
        const grain = fbm(u * 3 + plank * 7.3, v * 46 + plank, 4);
        const gap = Math.abs((v * 6) % 1 - 0.5) > 0.46 ? 1 : 0;
        h[y * S + x] = clamp(0.5 + grain * 0.35 - gap * 0.45, 0, 1);
        const i = (y * S + x) * 4;
        const g2 = 0.75 + grain * 0.5;
        alb[i] = clamp((92 - gap * 55) * g2, 0, 255);
        alb[i + 1] = clamp((64 - gap * 40) * g2, 0, 255);
        alb[i + 2] = clamp((40 - gap * 26) * g2, 0, 255);
        alb[i + 3] = 255;
      }
    }
    TEXCACHE.wood = {
      map: dataTex(alb, S, true),
      normalMap: dataTex(normalFromHeight(h, S, 10), S, false)
    };
    return TEXCACHE.wood;
  }
  G.wood = makeWood;

  // ---- puddle / wetness mask ---------------------------------------
  function makePuddleMask() {
    if (TEXCACHE.puddle) return TEXCACHE.puddle;
    const S = 512;
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * 3.2, v = (y / S) * 3.2;
        let n = fbm(u + 11, v + 4, 5) * 0.7 + fbm(u * 3.2 + 3, v * 3.2 + 9, 3) * 0.3;
        n = smoothstep(0.42, 0.62, n);
        const i = (y * S + x) * 4;
        const b = clamp(n * 255, 0, 255);
        data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    TEXCACHE.puddle = dataTex(data, S, false);
    return TEXCACHE.puddle;
  }
  G.puddleMask = makePuddleMask;

  // ---- building facade (canvas 2d, crisp windows) -------------------
  function makeFacade(seed, opts) {
    opts = opts || {};
    const S = opts.size || 1024;
    const cols = opts.cols || 12, rows = opts.rows || 15;
    const cA = document.createElement('canvas'); cA.width = cA.height = S;
    const cE = document.createElement('canvas'); cE.width = cE.height = S;
    const a = cA.getContext('2d'), e = cE.getContext('2d');
    const R = mulberry32(seed);
    const rr = (x, y) => x + (y - x) * R();

    // base wall — mid grey concrete so the facade actually reads at night
    const g = a.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#6a6a66');
    g.addColorStop(0.45, '#60615c');
    g.addColorStop(1, '#4c4d46');
    a.fillStyle = g; a.fillRect(0, 0, S, S);
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S);

    // concrete mottling
    for (let i = 0; i < 2600; i++) {
      const x = R() * S, y = R() * S, r = R() * 44 + 6;
      const dark = R() < 0.6;
      a.fillStyle = dark ? 'rgba(0,0,0,' + (R() * 0.06).toFixed(3) + ')' : 'rgba(255,255,255,' + (R() * 0.035).toFixed(3) + ')';
      a.beginPath(); a.arc(x, y, r, 0, 6.2832); a.fill();
    }
    // slab / panel seams
    a.strokeStyle = 'rgba(0,0,0,0.30)';
    a.lineWidth = Math.max(1.5, S * 0.0035);
    for (let r = 0; r <= rows; r++) {
      const y = (r / rows) * S;
      a.beginPath(); a.moveTo(0, y); a.lineTo(S, y); a.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * S;
      a.beginPath(); a.moveTo(x, 0); a.lineTo(x, S); a.stroke();
    }
    // vertical rain streaks
    for (let i = 0; i < 190; i++) {
      const x = R() * S, w = R() * 12 + 1, hh = R() * S * 0.7 + 60;
      const gg = a.createLinearGradient(0, 0, 0, hh);
      gg.addColorStop(0, 'rgba(0,0,0,0.20)');
      gg.addColorStop(0.7, 'rgba(0,0,0,0.07)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = gg; a.fillRect(x, R() * S * 0.3, w, hh);
    }

    const cw = S / cols, ch = S / rows;
    const warmCols = ['#ffcf94', '#ffd9a8', '#ffbf7a', '#ffc98a'];
    const coolCols = ['#a9d8ff', '#c4e6ff', '#8fc8f0'];
    const pinkCols = ['#ff9fc4', '#ffb6d2'];

    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = cc * cw, y = r * ch;
        const mx = cw * 0.19, my = ch * 0.22;
        const wx = x + mx, wy = y + my, ww = cw - mx * 2, wh = ch - my * 2;

        // recessed frame
        a.fillStyle = '#2b2c2b';
        a.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
        a.fillStyle = 'rgba(0,0,0,0.55)';
        a.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);

        const lit = R() < (opts.litRatio || 0.36);
        const tint = R();
        let glassGrad, ecol;
        if (lit) {
          if (tint < 0.62) ecol = warmCols[(R() * warmCols.length) | 0];
          else if (tint < 0.86) ecol = coolCols[(R() * coolCols.length) | 0];
          else ecol = pinkCols[(R() * pinkCols.length) | 0];
          glassGrad = a.createLinearGradient(wx, wy, wx + ww, wy + wh);
          glassGrad.addColorStop(0, ecol);
          glassGrad.addColorStop(0.55, '#ffffff');
          glassGrad.addColorStop(1, ecol);
          a.globalAlpha = 0.35 + R() * 0.5;
          a.fillStyle = glassGrad; a.fillRect(wx, wy, ww, wh);
          a.globalAlpha = 1;
          // curtain / furniture silhouette
          if (R() < 0.5) {
            a.fillStyle = 'rgba(0,0,0,0.5)';
            a.fillRect(wx, wy, ww * rr(0.2, 0.9), wh * rr(0.1, 0.45));
          }
          // emissive: crisp glass panel (no big halo — bloom does that)
          e.fillStyle = ecol;
          e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
          e.fillStyle = 'rgba(255,255,255,0.35)';
          e.fillRect(wx + 2, wy + 2, ww - 4, (wh - 4) * 0.35);
          if (R() < 0.5) {
            e.fillStyle = 'rgba(0,0,0,0.65)';
            e.fillRect(wx, wy, ww * rr(0.2, 0.9), wh * rr(0.1, 0.45));
          }
        } else {
          glassGrad = a.createLinearGradient(wx, wy, wx + ww * 0.8, wy + wh);
          glassGrad.addColorStop(0, '#2b3540');
          glassGrad.addColorStop(0.45, '#131a21');
          glassGrad.addColorStop(1, '#070a0e');
          a.fillStyle = glassGrad; a.fillRect(wx, wy, ww, wh);
          // faint sky reflection
          a.fillStyle = 'rgba(120,170,220,0.10)';
          a.beginPath(); a.moveTo(wx, wy + wh * 0.95); a.lineTo(wx + ww * 0.5, wy); a.lineTo(wx + ww * 0.72, wy); a.lineTo(wx + ww * 0.22, wy + wh * 0.95); a.closePath(); a.fill();
        }
        // mullions
        a.fillStyle = 'rgba(0,0,0,0.65)';
        a.fillRect(wx + ww * 0.5 - 1.5, wy, 3, wh);
        a.fillRect(wx, wy + wh * 0.5, ww, 3);
        // sill
        a.fillStyle = '#6a6a66';
        a.fillRect(wx - 8, wy + wh + 4, ww + 16, Math.max(3, ch * 0.05));
        a.fillStyle = 'rgba(0,0,0,0.35)';
        a.fillRect(wx - 8, wy + wh + 4 + Math.max(3, ch * 0.05), ww + 16, 2);
      }
    }

    // AC units / clutter
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S, w = rr(18, 48), hh = rr(14, 32);
      a.fillStyle = 'rgba(38,38,38,0.95)'; a.fillRect(x, y, w, hh);
      a.strokeStyle = 'rgba(120,120,118,0.55)'; a.lineWidth = 1.5; a.strokeRect(x, y, w, hh);
      a.fillStyle = 'rgba(85,85,82,0.85)';
      for (let k = 0; k < 3; k++) a.fillRect(x + 3, y + 4 + k * 7, w - 6, 2);
    }

    const mk = (cv, srgb) => {
      const t = new T.CanvasTexture(cv);
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.anisotropy = 8;
      return t;
    };
    return { map: mk(cA, true), emissiveMap: mk(cE, true) };
  }
  G.makeFacade = makeFacade;

  // ---- neon sign (emissive only) ------------------------------------
  function makeNeonSign(lines, opts) {
    opts = opts || {};
    const W = opts.w || 512, H = opts.h || 512;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const color = opts.color || '#31e8ff';
    const glow = opts.glow || color;
    const size = opts.size || Math.floor(Math.min(W, H) * 0.42);
    const vertical = !!opts.vertical;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + size + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    const n = lines.length;
    for (let i = 0; i < n; i++) {
      const txt = lines[i];
      const x = vertical ? W * 0.5 : (W * (i + 0.5)) / n;
      const y = vertical ? H * (i + 0.5) / n : H * 0.5;
      // outer bloom
      g.shadowColor = glow; g.shadowBlur = size * 0.55;
      g.fillStyle = color;
      for (let k = 0; k < 3; k++) {
        g.globalAlpha = 0.55;
        g.fillText(txt, x, y);
      }
      g.globalAlpha = 1; g.shadowBlur = size * 0.18;
      g.fillStyle = '#ffffff';
      g.fillText(txt, x, y);
      g.shadowBlur = 0;
    }
    // thin border tube
    if (opts.border !== false) {
      g.strokeStyle = color; g.shadowColor = glow; g.shadowBlur = 26; g.lineWidth = Math.max(2, W * 0.008);
      g.strokeRect(W * 0.04, H * 0.04, W * 0.92, H * 0.92);
      g.shadowBlur = 0;
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  G.makeNeonSign = makeNeonSign;

  // ---- billboard poster ---------------------------------------------
  function makeBillboard() {
    const W = 512, H = 768;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = mulberry32(777);
    // backdrop
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#06131c'); bg.addColorStop(0.45, '#0b2b3a');
    bg.addColorStop(0.7, '#2a1240'); bg.addColorStop(1, '#08070f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // glowing rings
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = i % 2 ? 'rgba(60,230,255,0.5)' : 'rgba(255,60,150,0.4)';
      g.lineWidth = 2 + R() * 3;
      g.beginPath(); g.arc(W * (0.3 + R() * 0.4), H * (0.25 + R() * 0.35), 40 + R() * 190, 0, 6.2832); g.stroke();
    }
    // figure silhouette
    g.fillStyle = 'rgba(3,6,10,0.85)';
    g.beginPath();
    g.ellipse(W * 0.5, H * 0.44, W * 0.115, W * 0.145, 0, 0, 6.2832);
    g.fill();
    g.beginPath();
    g.moveTo(W * 0.34, H * 0.92); g.quadraticCurveTo(W * 0.42, H * 0.52, W * 0.5, H * 0.52);
    g.quadraticCurveTo(W * 0.58, H * 0.52, W * 0.66, H * 0.92); g.closePath(); g.fill();
    // neon rim
    g.strokeStyle = '#39f0ff'; g.shadowColor = '#39f0ff'; g.shadowBlur = 24; g.lineWidth = 3;
    g.beginPath(); g.ellipse(W * 0.5, H * 0.44, W * 0.118, W * 0.148, 0, 3.4, 6.1); g.stroke();
    g.shadowBlur = 0;
    // type
    g.textAlign = 'center';
    g.font = '900 58px "Microsoft YaHei",sans-serif';
    g.fillStyle = '#eafcff'; g.shadowColor = '#3ff'; g.shadowBlur = 30;
    g.fillText('霓虹之城', W * 0.5, H * 0.13);
    g.shadowBlur = 0;
    g.font = '500 26px "Segoe UI",sans-serif';
    g.fillStyle = 'rgba(180,240,255,0.85)';
    g.fillText('N E O N   C I T Y   2 0 7 7', W * 0.5, H * 0.175);
    g.font = 'italic 22px Georgia,serif';
    g.fillStyle = 'rgba(255,80,160,0.9)';
    g.fillText('the rain never stops', W * 0.5, H * 0.965);
    // scanlines
    for (let y = 0; y < H; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, W, 1.6);
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  G.makeBillboard = makeBillboard;

  // ---- sprite textures ------------------------------------------------
  function spriteCanvas(size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function makeSprites() {
    if (TEXCACHE.glow) return;
    // radial glow
    TEXCACHE.glow = spriteCanvas(128, (g, S) => {
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.16, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    });
    // soft smoke puff
    TEXCACHE.smoke = spriteCanvas(128, (g, S) => {
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.40)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.14)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    });
    // bullet hole
    TEXCACHE.hole = spriteCanvas(64, (g, S) => {
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.28, 'rgba(10,10,10,0.95)');
      gr.addColorStop(0.5, 'rgba(30,28,26,0.5)');
      gr.addColorStop(0.75, 'rgba(40,38,36,0.15)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      // cracks
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * 6.2832, l = 10 + Math.random() * 18;
        g.beginPath(); g.moveTo(S / 2, S / 2);
        g.lineTo(S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l); g.stroke();
      }
    });
    // ripple ring
    TEXCACHE.ring = spriteCanvas(128, (g, S) => {
      g.strokeStyle = 'rgba(255,255,255,1)';
      g.lineWidth = 5;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 8, 0, 6.2832); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 9;
      g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 14, 0, 6.2832); g.stroke();
    });
    // soft vertical streak for light shafts
    TEXCACHE.streak = spriteCanvas(128, (g, S) => {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(S * 0.4, 0, S * 0.2, S);
    });
  }
  G.makeSprites = makeSprites;
  G.tex = TEXCACHE;

  /* --------------------------- audio -------------------------------- */
  const Audio = {
    ctx: null, master: null, muted: false, started: false,
    noiseBuf: null, verb: null,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const master = this.master = ctx.createGain();
      master.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 5;
      comp.attack.value = 0.004; comp.release.value = 0.22;
      master.connect(comp); comp.connect(ctx.destination);

      // noise buffer
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // reverb impulse (procedural hall)
      const irLen = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const dd = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) {
          const t = i / irLen;
          dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1);
        }
      }
      const verb = this.verb = ctx.createConvolver();
      verb.buffer = ir;
      const vg = ctx.createGain(); vg.gain.value = 0.34;
      verb.connect(vg); vg.connect(master);
      this.verbGain = vg;
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    },
    nsrc() {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      s.playbackRate.value = 0.8 + Math.random() * 0.5;
      return s;
    },
    env(gainNode, t0, a, d, peak) {
      const g = gainNode.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(peak, t0 + a);
      g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    },
    shot() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      // crack
      const n = this.nsrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.9;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const g1 = ctx.createGain();
      n.connect(bp); bp.connect(hp); hp.connect(g1);
      g1.connect(this.master);
      const send = ctx.createGain(); send.gain.value = 0.55; g1.connect(send); send.connect(this.verb);
      this.env(g1, t, 0.002, 0.10, 0.55);
      n.start(t); n.stop(t + 0.22);
      // body thump
      const o = ctx.createOscillator(); o.type = 'sine';
      const g2 = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(0.7, t + 0.004);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
      o.connect(g2); g2.connect(this.master);
      o.start(t); o.stop(t + 0.2);
      // tail
      const n2 = this.nsrc();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(320, t + 0.4);
      const g3 = ctx.createGain();
      n2.connect(lp); lp.connect(g3); g3.connect(this.master);
      const s2 = ctx.createGain(); s2.gain.value = 0.5; g3.connect(s2); s2.connect(this.verb);
      this.env(g3, t, 0.005, 0.42, 0.22);
      n2.start(t); n2.stop(t + 0.5);
    },
    dryFire() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.nsrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 3;
      const g = ctx.createGain();
      n.connect(bp); bp.connect(g); g.connect(this.master);
      this.env(g, t, 0.001, 0.05, 0.22);
      n.start(t); n.stop(t + 0.08);
    },
    click(freq, dur, vol) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.nsrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq || 1800; bp.Q.value = 4;
      const g = ctx.createGain();
      n.connect(bp); bp.connect(g); g.connect(this.master);
      this.env(g, t, 0.001, dur || 0.05, vol || 0.2);
      n.start(t); n.stop(t + 0.1);
    },
    step(wet) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.nsrc();
      n.playbackRate.value = 0.5 + Math.random() * 0.4;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = wet ? 1500 : 900;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420 + Math.random() * 260; bp.Q.value = 1.2;
      const g = ctx.createGain();
      n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.master);
      this.env(g, t, 0.004, 0.11, 0.16);
      n.start(t); n.stop(t + 0.16);
      if (wet) {
        const n2 = this.nsrc();
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
        const g2 = ctx.createGain();
        n2.connect(hp); hp.connect(g2); g2.connect(this.master);
        this.env(g2, t + 0.01, 0.002, 0.07, 0.06);
        n2.start(t); n2.stop(t + 0.1);
      }
    },
    hit() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      [1560, 2340, 3120].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f * (0.98 + Math.random() * 0.06);
        const g = ctx.createGain();
        o.connect(g); g.connect(this.master);
        const gg = ctx.createGain(); gg.gain.value = 0.2; g.connect(gg); gg.connect(this.verb);
        this.env(g, t, 0.001, 0.09 + i * 0.02, 0.07 / (i + 1));
        o.start(t); o.stop(t + 0.2);
      });
    },
    kill() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.09);
      const g = ctx.createGain(); o.connect(g); g.connect(this.master);
      this.env(g, t, 0.002, 0.14, 0.16);
      o.start(t); o.stop(t + 0.2);
    },
    enemyShot() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.18);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const g = ctx.createGain();
      o.connect(lp); lp.connect(g); g.connect(this.master);
      this.env(g, t, 0.004, 0.18, 0.14);
      o.start(t); o.stop(t + 0.24);
    },
    explode(dist) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const v = clamp(1 - dist / 26, 0.12, 1);
      const n = this.nsrc();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.6);
      const g = ctx.createGain();
      n.connect(lp); lp.connect(g); g.connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.9; g.connect(s); s.connect(this.verb);
      this.env(g, t, 0.004, 0.7, 0.5 * v);
      n.start(t); n.stop(t + 0.85);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
      const g2 = ctx.createGain(); o.connect(g2); g2.connect(this.master);
      this.env(g2, t, 0.004, 0.5, 0.5 * v);
      o.start(t); o.stop(t + 0.6);
    },
    hurt() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.nsrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.4;
      const g = ctx.createGain();
      n.connect(bp); bp.connect(g); g.connect(this.master);
      this.env(g, t, 0.004, 0.28, 0.4);
      n.start(t); n.stop(t + 0.34);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 62;
      const g2 = ctx.createGain(); o.connect(g2); g2.connect(this.master);
      this.env(g2, t, 0.004, 0.3, 0.32);
      o.start(t); o.stop(t + 0.34);
    },
    thunder() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.nsrc(); n.playbackRate.value = 0.35;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      const g = ctx.createGain();
      n.connect(lp); lp.connect(g); g.connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(this.verb);
      this.env(g, t, 0.15, 2.6, 0.5);
      n.start(t); n.stop(t + 3.0);
    },
    startAmbience() {
      if (!this.ctx || this.started) return;
      this.started = true;
      const ctx = this.ctx;
      // rain hiss
      const rain = this.nsrc(); rain.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = 0.0;
      rain.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 2.5);
      rain.start();
      // low city hum
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.7;
      const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 180;
      const hg = ctx.createGain(); hg.gain.value = 0.035;
      o1.connect(hlp); o2.connect(hlp); hlp.connect(hg); hg.connect(this.master);
      o1.start(); o2.start();
      // distant siren-ish pad
      const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 220;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lfog = ctx.createGain(); lfog.gain.value = 6;
      lfo.connect(lfog); lfog.connect(o3.frequency);
      const g3 = ctx.createGain(); g3.gain.value = 0.0;
      o3.connect(g3); g3.connect(this.verb);
      g3.gain.setValueAtTime(0.0, ctx.currentTime);
      g3.gain.linearRampToValueAtTime(0.02, ctx.currentTime + 6);
      o3.start(); lfo.start();
    }
  };
  G.Audio = Audio;
})();
