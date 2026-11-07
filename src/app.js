/* WWII European fronts on an orthographic globe.
 * Renders one frame for any day t (days since 1939-09-01) onto a 1920x1080 canvas.
 * Data: window.GEO (geography), window.HIST (history: control, fronts, events, camera).
 */
(function () {
  'use strict';
  const GEO = window.GEO, HIST = window.HIST;
  const W = 1920, H = 1080;
  const T0 = Date.UTC(1939, 8, 1), DAY = 86400000;
  const dnum = (s) => {
    if (typeof s === 'number') return s;
    if (s === 'END') return HIST.END_T;
    if (s.startsWith('END+')) return HIST.END_T + Number(s.slice(4));
    const [y, m, d] = s.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - T0) / DAY;
  };
  HIST.END_T = dnum(HIST.END);
  const T_END = HIST.END_T;

  // ---------- factions ------------------------------------------------------
  const FACTION = HIST.FACTIONS;
  const BARB = dnum('1941-06-22'), ITALY_WAR = dnum('1940-06-10');
  const WIN = (a, b) => [dnum(a), dnum(b)];
  const W_POL_SU = WIN('1939-09-17', '1939-10-06');
  const W_WINTER = WIN('1939-11-30', '1940-03-13');
  const W_VICHY = [WIN('1941-06-08', '1941-07-14'), WIN('1942-11-08', '1942-11-11')];
  const inW = (t, w) => t >= w[0] && t <= w[1];
  // Detection channel: R = Axis side, G = Western Allies side, B = Soviet side.
  function channel(f, t) {
    if (f === 'AX') return 'R';
    if (f === 'AXM') return t >= ITALY_WAR ? 'R' : null; // Italy non-belligerent until 1940-06-10
    if (f === 'AL') return 'G';
    if (f === 'SU') return 'B';
    if (f === 'FN' && inW(t, W_WINTER)) return 'G';
    if (f === 'VI' && W_VICHY.some((w) => inW(t, w))) return 'R';
    return null;
  }
  const CH_COLOR = { R: '#ff0000', G: '#00ff00', B: '#0000ff' };
  function hostile(bits, t) {
    if ((bits & 3) === 3) return true;
    if ((bits & 5) === 5 && t >= BARB) return true;
    if ((bits & 6) === 6 && (inW(t, W_POL_SU) || inW(t, W_WINTER))) return true;
    return false;
  }

  // ---------- geometry prep ---------------------------------------------------
  // GeoJSON geometries with closed rings in d3's winding (exterior clockwise).
  const closeRing = (r) => { const a = r[0], b = r[r.length - 1]; return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]; };
  function fixPoly(poly) {
    let rings = poly.map(closeRing);
    if (d3.geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) rings = rings.map((r) => r.slice().reverse());
    return rings;
  }
  const mpoly = (polys) => ({ type: 'MultiPolygon', coordinates: polys.map(fixPoly) });
  const LAND = mpoly(GEO.land), LAKES = mpoly(GEO.lakes);
  const RIVERS = { type: 'MultiLineString', coordinates: GEO.rivers };
  const COUNTRY = {};
  for (const [k, v] of Object.entries(GEO.countries)) COUNTRY[k] = mpoly(v);

  const BASE = {};
  for (const [name, list] of Object.entries(HIST.base)) BASE[name] = list.map(([d, f]) => [dnum(d), f]);
  for (const [name, own] of Object.entries(GEO.owner || {})) {
    if (BASE[name]) continue;
    const of = HIST.ownerFaction[own];
    if (of) BASE[name] = (typeof of === 'string' ? [['1939-01-01', of]] : of).map(([d, f]) => [dnum(d), f]);
  }
  function baseFaction(name, t) {
    const l = BASE[name];
    if (!l) return 'N';
    let f = 'N';
    for (const [d, ff] of l) if (t >= d) f = ff;
    return f;
  }

  // Resample an open polyline to n points evenly spaced by length.
  function resample(pts, n) {
    if (pts.length === 1) return Array.from({ length: n }, () => pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1] || 1, out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = (L * i) / (n - 1);
      while (j < pts.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j] || 1, a = (s - cum[j]) / seg;
      out.push([pts[j][0] + a * (pts[j + 1][0] - pts[j][0]), pts[j][1] + a * (pts[j + 1][1] - pts[j][1])]);
    }
    return out;
  }
  function prepOverlay(ov) {
    const n = ov.n || 40;
    const keys = ov.keys.map(([d, segs]) => {
      if (!Array.isArray(segs[0][0])) segs = [segs]; // single ring given as one segment
      const all = [];
      for (const s of segs) all.push(...resample(s, n));
      if (ov.back) all.push(...ov.back);
      return { t: dnum(d), nseg: segs.length, ring: Float64Array.from(all.flat()) };
    });
    for (const k of keys) if (k.ring.length !== keys[0].ring.length) console.warn('segment count mismatch', ov.id, k);
    ov._keys = keys;
    ov._from = ov.from != null ? dnum(ov.from) : keys[0].t;
    ov._to = ov.to != null ? dnum(ov.to) : keys[keys.length - 1].t;
    ov._clip = ov.clip || null;
  }
  HIST.overlays.forEach(prepOverlay);
  function overlayRing(ov, t) {
    if (t < ov._from || t > ov._to) return null;
    const K = ov._keys;
    if (t <= K[0].t) return K[0].ring;
    if (t >= K[K.length - 1].t) return K[K.length - 1].ring;
    let i = 0;
    while (i < K.length - 2 && K[i + 1].t < t) i++;
    const a = K[i], b = K[i + 1];
    if (a.ring.length !== b.ring.length) return t - a.t < b.t - t ? a.ring : b.ring;
    const u = (t - a.t) / (b.t - a.t || 1);
    const out = new Float64Array(a.ring.length);
    for (let j = 0; j < out.length; j++) out[j] = a.ring[j] + u * (b.ring[j] - a.ring[j]);
    return out;
  }

  // ---------- camera / projection -----------------------------------------------
  const CAM = HIST.camera.map(([d, lon, lat, k]) => ({ t: dnum(d), lon, lat, k }));
  let CAM_OVERRIDE = null;
  const smooth = (u) => u * u * (3 - 2 * u);
  function camera(t) {
    if (t <= CAM[0].t) return CAM[0];
    if (t >= CAM[CAM.length - 1].t) return CAM[CAM.length - 1];
    let i = 0;
    while (i < CAM.length - 2 && CAM[i + 1].t < t) i++;
    const a = CAM[i], b = CAM[i + 1], u = smooth((t - a.t) / (b.t - a.t));
    return { lon: a.lon + u * (b.lon - a.lon), lat: a.lat + u * (b.lat - a.lat), k: Math.exp(Math.log(a.k) + u * (Math.log(b.k) - Math.log(a.k))) };
  }
  const RAD = Math.PI / 180;
  function makeProj(cam) {
    const R = cam.k * 1000, cx = W * 0.57, cy = H * 0.5;
    const proj = d3.geoOrthographic().scale(R).translate([cx, cy]).rotate([-cam.lon, -cam.lat]).clipAngle(90).precision(0.6);
    const gp = d3.geoPath(proj);
    const center = [cam.lon, cam.lat];
    const P = { R, cx, cy, vis: true };
    P.p = (lon, lat) => { P.vis = d3.geoDistance([lon, lat], center) < Math.PI / 2 - 0.01; return proj([lon, lat]); };
    P.path = (geom) => { const p = new Path2D(); gp.context(p)(geom); return p; };
    P.raw = (pt) => proj(pt);
    return P;
  }
  const polysPath = (P, geom) => P.path(geom);
  function ringPath(P, ring) {
    // Densify so long edges follow the authored lon/lat lines rather than great circles.
    const pts = [];
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = ring[2 * i], y0 = ring[2 * i + 1], j = (i + 1) % n, x1 = ring[2 * j], y1 = ring[2 * j + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.75));
      for (let k = 0; k < steps; k++) pts.push([x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps]);
    }
    // Overlay rings always lie on the visible hemisphere, so they are projected
    // directly (no spherical clipping): winding and self-intersections don't matter.
    const path = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      const q = P.raw(pts[i]);
      if (i === 0) path.moveTo(q[0], q[1]); else path.lineTo(q[0], q[1]);
    }
    path.closePath();
    return path;
  }

  // ---------- canvases -----------------------------------------------------------
  const canvas = document.getElementById('map');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const IDW = W / 2, IDH = H / 2;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const idC = mk(IDW, IDH), idX = idC.getContext('2d', { willReadFrequently: true });
  const frC = mk(IDW, IDH), frX = frC.getContext('2d');
  const glC = mk(IDW, IDH), glX = glC.getContext('2d');
  const frImg = frX.createImageData(IDW, IDH);

  const C = HIST.COLORS;
  const FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  // Paint faction areas (base + overlays) through `paint(path, faction)`.
  function paintControl(P, t, cpaths, paintFill) {
    const groups = {};
    for (const name of Object.keys(COUNTRY)) {
      const f = baseFaction(name, t);
      (groups[f] ||= new Path2D()).addPath(cpaths[name]);
    }
    for (const [f, p] of Object.entries(groups)) paintFill(null, p, f);
    for (const ov of HIST.overlays) {
      const ring = overlayRing(ov, t);
      if (!ring) continue;
      let clip = null;
      if (ov._clip) { clip = new Path2D(); for (const n of ov._clip) if (cpaths[n]) clip.addPath(cpaths[n]); }
      paintFill(clip, ringPath(P, ring), typeof ov.f === 'function' ? ov.f(t) : ov.f);
    }
  }

  const GRAT = d3.geoGraticule10();
  const graticule = (P) => P.path(GRAT);

  function fmtDate(t) {
    const d = new Date(T0 + Math.round(t) * DAY);
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  }
  const EVENTS = HIST.events.map((e) => ({ ...e, t: dnum(e.d) })).sort((a, b) => a.t - b.t);
  const CITIES = HIST.cities;

  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  // ---------- frame ---------------------------------------------------------------
  function render(tIn) {
    const t = tIn;                                   // camera time (may run past the war)
    const tc = Math.max(0, Math.min(T_END, tIn));    // control/date time
    const P = makeProj(CAM_OVERRIDE || camera(t));
    const cpaths = {};
    for (const [name, polys] of Object.entries(COUNTRY)) cpaths[name] = polysPath(P, polys);
    const land = polysPath(P, LAND), lakes = polysPath(P, LAKES);
    const globe = new Path2D(); globe.arc(P.cx, P.cy, P.R, 0, Math.PI * 2);

    // background
    const bg = ctx.createRadialGradient(W * 0.55, H * 0.45, 100, W * 0.5, H * 0.5, W * 0.8);
    bg.addColorStop(0, C.space1); bg.addColorStop(1, C.space0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // atmosphere
    const atm = ctx.createRadialGradient(P.cx, P.cy, P.R * 0.98, P.cx, P.cy, P.R * 1.08);
    atm.addColorStop(0, 'rgba(110,170,255,0.45)'); atm.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R * 1.08, 0, Math.PI * 2); ctx.fill();

    ctx.save(); ctx.clip(globe);
    const oc = ctx.createRadialGradient(P.cx - P.R * 0.3, P.cy - P.R * 0.35, P.R * 0.05, P.cx, P.cy, P.R);
    oc.addColorStop(0, C.ocean1); oc.addColorStop(1, C.ocean0);
    ctx.fillStyle = oc; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(160,200,255,0.10)'; ctx.lineWidth = 1; ctx.stroke(graticule(P));

    // land + control
    ctx.save(); ctx.clip(land, 'evenodd');
    ctx.fillStyle = C.N; ctx.fill(land, 'evenodd');
    paintControl(P, tc, cpaths, (clip, path, f) => {
      if (clip) { ctx.save(); ctx.clip(clip); }
      ctx.fillStyle = C[f] || C.N; ctx.fill(path);
      if (clip) ctx.restore();
    });
    ctx.restore();
    ctx.fillStyle = C.lake; ctx.fill(lakes, 'evenodd');
    // rivers
    ctx.strokeStyle = C.river; ctx.lineWidth = 1;
    ctx.stroke(P.path(RIVERS));
    // borders (1938) and coast
    ctx.strokeStyle = 'rgba(20,24,32,0.42)'; ctx.lineWidth = 0.9;
    for (const p of Object.values(cpaths)) ctx.stroke(p);
    ctx.strokeStyle = 'rgba(10,25,45,0.55)'; ctx.lineWidth = 1; ctx.stroke(land);

    // fronts
    drawFronts(P, tc, cpaths, lakes, land);

    // globe shading
    const sh = ctx.createRadialGradient(P.cx - P.R * 0.25, P.cy - P.R * 0.3, P.R * 0.2, P.cx, P.cy, P.R);
    sh.addColorStop(0, 'rgba(255,255,255,0.06)'); sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,5,20,0.55)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    drawCities(P);
    drawEventMarkers(P, tc);
    drawHUD(tc, tIn);
  }

  function drawFronts(P, t, cpaths, lakes, land) {
    idX.setTransform(1, 0, 0, 1, 0, 0);
    idX.fillStyle = '#000'; idX.fillRect(0, 0, IDW, IDH);
    idX.setTransform(0.5, 0, 0, 0.5, 0, 0);
    paintControl(P, t, cpaths, (clip, path, f) => {
      const ch = channel(f, t);
      if (clip) { idX.save(); idX.clip(clip); }
      idX.fillStyle = ch ? CH_COLOR[ch] : '#000'; idX.fill(path);
      if (clip) idX.restore();
    });
    idX.fillStyle = '#000';
    idX.fill(lakes, 'evenodd');
    // "No front" zones (open desert) are blanked out.
    for (const z of HIST.noFront) idX.fill(ringPath(P, Float64Array.from(z.flat())));
    // Sea: blank everything that is not land.
    idX.save();
    idX.globalCompositeOperation = 'destination-in';
    idX.fillStyle = '#fff';
    idX.fill(land, 'evenodd');
    idX.restore();

    const src = idX.getImageData(0, 0, IDW, IDH).data;
    const dst = frImg.data; dst.fill(0);
    const bits = new Uint8Array(IDW * IDH);
    for (let i = 0, j = 0; i < bits.length; i++, j += 4) {
      bits[i] = (src[j] > 110 ? 1 : 0) | (src[j + 1] > 110 ? 2 : 0) | (src[j + 2] > 110 ? 4 : 0);
    }
    const mark = (i) => { const j = i * 4; dst[j] = 255; dst[j + 1] = 236; dst[j + 2] = 160; dst[j + 3] = 255; };
    for (let y = 0; y < IDH - 1; y++) {
      for (let x = 0; x < IDW - 1; x++) {
        const i = y * IDW + x, b = bits[i];
        if (!b) continue;
        if (hostile(b, t)) { mark(i); continue; }
        const r = bits[i + 1], d = bits[i + IDW], dg = bits[i + IDW + 1];
        if (r && r !== b && hostile(b | r, t)) { mark(i); mark(i + 1); }
        if (d && d !== b && hostile(b | d, t)) { mark(i); mark(i + IDW); }
        if (dg && dg !== b && hostile(b | dg, t)) { mark(i); }
      }
    }
    frX.putImageData(frImg, 0, 0);
    glX.globalCompositeOperation = 'copy'; glX.drawImage(frC, 0, 0);
    glX.globalCompositeOperation = 'source-in'; glX.fillStyle = '#ff7a00'; glX.fillRect(0, 0, IDW, IDH);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = 'blur(5px)'; ctx.globalAlpha = 0.95; ctx.drawImage(glC, 0, 0, W, H);
    ctx.filter = 'blur(2px)'; ctx.globalAlpha = 1; ctx.drawImage(glC, 0, 0, W, H);
    ctx.filter = 'blur(0.4px)'; ctx.drawImage(frC, 0, 0, W, H);
    ctx.restore();
  }

  function label(text, x, y, size, color, weight, align) {
    ctx.font = `${weight || 500} ${size}px ${FONT}`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.28); ctx.strokeStyle = 'rgba(8,14,24,0.85)';
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawCities(P) {
    const s = Math.min(1.25, Math.max(0.8, P.R / 1150));
    for (const c of CITIES) {
      const q = P.p(c[1], c[2]);
      if (!P.vis || q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) continue;
      const cap = c[3] === 1;
      if (!cap && P.R < 1600 && !c[6]) continue;
      if (P.R < 700 && !c[6]) continue;
      const x = q[0], y = q[1];
      ctx.beginPath(); ctx.arc(x, y, cap ? 4 * s : 2.8 * s, 0, Math.PI * 2);
      ctx.fillStyle = cap ? '#fff' : '#f2f2f2'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
      const dx = c[4] || 0, dy = c[5] || 0;
      label(c[0], x + 7 * s + dx, y + dy, Math.round((cap ? 17 : 14) * s), cap ? '#ffffff' : '#e8e8e8', cap ? 700 : 500);
    }
  }
  function drawEventMarkers(P, t) {
    for (const e of EVENTS) {
      const age = t - e.t;
      if (age < 0 || age > 30 || !e.at) continue;
      const q = P.p(e.at[0], e.at[1]);
      if (!P.vis) continue;
      const a = 1 - age / 30;
      for (let k = 0; k < 2; k++) {
        const ph = ((age * 0.9 + k * 0.5) % 1);
        ctx.beginPath(); ctx.arc(q[0], q[1], 6 + ph * 34, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${(a * (1 - ph) * 0.9).toFixed(3)})`; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,214,90,${a.toFixed(3)})`; ctx.fill();
    }
  }

  const LEGEND = [
    ['AX', '나치 독일 및 점령지'], ['AXM', '추축 동맹국'], ['VI', '비시 프랑스'],
    ['AL', '연합국 및 해방지역'], ['SU', '소련 및 동맹군'], ['N', '중립국'],
  ];
  const YEAR_T = [1939, 1940, 1941, 1942, 1943, 1944, 1945].map((y) => [y, dnum(`${y}-01-01`)]);
  const TL = { x: 80, y: H - 54, w: W - 160, h: 6 };
  function tlX(t) { return TL.x + (Math.max(0, Math.min(T_END, t)) / T_END) * TL.w; }

  function drawHUD(t, tRaw) {
    // top-left date panel
    const g = ctx.createLinearGradient(0, 0, 0, 230);
    g.addColorStop(0, 'rgba(4,8,16,0.85)'); g.addColorStop(1, 'rgba(4,8,16,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 230);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `500 24px ${FONT}`;
    ctx.fillText('제2차 세계대전 · 유럽 전선의 변화', 64, 62);
    ctx.fillStyle = '#fff'; ctx.font = `800 66px ${FONT}`;
    ctx.fillText(fmtDate(t), 60, 138);
    const day = Math.floor(t) + 1;
    ctx.fillStyle = '#ffcf5a'; ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`개전 ${day.toLocaleString('ko-KR')}일째`, 64, 176);

    // events feed (right)
    const recent = EVENTS.filter((e) => e.t <= t).slice(-5).reverse();
    let y = 218;
    const fx = 56;
    for (let i = 0; i < recent.length; i++) {
      const e = recent[i], age = t - e.t;
      const a = Math.max(0.25, 1 - i * 0.2) * Math.min(1, age / 2 + 0.25);
      const slide = Math.max(0, 1 - age / 2.5) * 30;
      ctx.globalAlpha = a;
      ctx.font = `700 ${i === 0 ? 25 : 20}px ${FONT}`;
      const lines = wrap(e.title, 470, ctx.font);
      const hh = 34 + lines.length * (i === 0 ? 32 : 26) + (e.sub && i === 0 ? 30 : 0);
      roundRect(fx + slide, y, 500, hh, 12);
      ctx.fillStyle = i === 0 ? 'rgba(8,13,24,0.88)' : 'rgba(8,13,24,0.72)'; ctx.fill();
      ctx.fillStyle = i === 0 ? '#ffcf5a' : 'rgba(255,207,90,0.8)'; ctx.fillRect(fx + slide, y + 10, 4, hh - 20);
      ctx.font = `600 16px ${FONT}`; ctx.fillStyle = '#ffcf5a';
      ctx.fillText(fmtDate(e.t), fx + 20 + slide, y + 26);
      ctx.font = `700 ${i === 0 ? 25 : 20}px ${FONT}`; ctx.fillStyle = '#fff';
      lines.forEach((ln, k) => ctx.fillText(ln, fx + 20 + slide, y + 56 + k * (i === 0 ? 32 : 26)));
      if (e.sub && i === 0) {
        ctx.font = `400 17px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(e.sub, fx + 20 + slide, y + 56 + lines.length * 32 + 2);
      }
      ctx.globalAlpha = 1;
      y += hh + 10;
    }

    // legend (bottom-left)
    const lx = 60, ly = H - 128;
    ctx.font = `500 17px ${FONT}`; ctx.textBaseline = 'middle';
    let lw = 30 + ctx.measureText('전선').width + 16;
    for (const [, name] of LEGEND) lw += 40 + ctx.measureText(name).width + 16;
    roundRect(lx - 16, ly - 34, lw + 16, 64, 12); ctx.fillStyle = 'rgba(8,12,22,0.72)'; ctx.fill();
    let x = lx;
    for (const [f, name] of LEGEND) {
      ctx.fillStyle = C[f]; roundRect(x, ly - 9, 22, 18, 4); ctx.fill();
      ctx.fillStyle = '#eee'; ctx.fillText(name, x + 30, ly + 1);
      x += 40 + ctx.measureText(name).width + 16;
    }
    ctx.strokeStyle = '#ff9a2a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + 26, ly); ctx.stroke();
    ctx.strokeStyle = '#fff0b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + 26, ly); ctx.stroke();
    ctx.fillStyle = '#eee'; ctx.fillText('전선', x + 34, ly + 1);

    // timeline
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(TL.x, TL.y, TL.w, TL.h, 3); ctx.fill();
    const px = tlX(t);
    const tg = ctx.createLinearGradient(TL.x, 0, px, 0); tg.addColorStop(0, '#ff9a2a'); tg.addColorStop(1, '#ffd36a');
    ctx.fillStyle = tg; roundRect(TL.x, TL.y, Math.max(6, px - TL.x), TL.h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const e of EVENTS) ctx.fillRect(tlX(e.t) - 0.5, TL.y - 5, 1, 4);
    ctx.font = `600 16px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [yv, ty] of YEAR_T) {
      const xx = tlX(Math.max(0, ty));
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(xx - 1, TL.y + TL.h + 2, 2, 8);
      ctx.fillText(String(yv), xx, TL.y + TL.h + 13);
    }
    ctx.beginPath(); ctx.arc(px, TL.y + TL.h / 2, 9, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ff9a2a'; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // credits
    ctx.font = `400 13px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right';
    ctx.fillText('국경선: 1938년 기준 · 전선 위치는 주요 시점 사이를 보간한 근사치', W - 80, H - 96);
    ctx.textAlign = 'left';

    // end card
    if (tRaw > T_END + 4) {
      const a = Math.min(1, (tRaw - T_END - 4) / 6);
      ctx.globalAlpha = a;
      const ex = W * 0.57, ey = H - 300;
      roundRect(ex - 450, ey - 95, 900, 180, 20); ctx.fillStyle = 'rgba(6,10,20,0.85)'; ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `800 46px ${FONT}`;
      ctx.fillText('유럽에서의 전쟁 종결', ex, ey - 18);
      ctx.font = `500 22px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('1939. 9. 1 독일의 폴란드 침공 ~ 1945. 5. 25 오자크 전투 종결 (2,094일)', ex, ey + 34);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }
  function wrap(text, maxW, font) {
    ctx.font = font;
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ---------- playback -----------------------------------------------------------
  const T_START = HIST.T_INTRO, T_STOP = T_END + HIST.T_OUTRO;
  window.WW2 = { setCam: (c) => { CAM_OVERRIDE = c; }, render, T_START, T_STOP, T_END, dnum, fmtDate, TL, W, H };
})();
