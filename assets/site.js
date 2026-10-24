/* Skyburst site — the night valley, the wisps, and the scroll.
 *
 * Two canvases sit inside the pinned scene. The back one is the sky (stars and
 * aurora); the front one is the field: wisps drifting over the valley, and a
 * burst that wakes every wisp its ring reaches, each of which bursts in turn.
 * That is the game in one gesture, so the page explains itself without words.
 * Tap anywhere on the sky to light one.
 */
(function () {
  "use strict";

  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pin = document.getElementById("pin");
  var skyCv = document.getElementById("sky");
  var fxCv = document.getElementById("fx");
  var hint = document.getElementById("hint");
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var DPR = Math.min(window.devicePixelRatio || 1, 1.6);
  var W = 0, H = 0;

  /* ------------------------------------------------------------ palette -- */

  // The seven wisp varieties, with the game's blast factors.
  var TYPES = [
    { c: [235, 242, 255], blast: 0.62 },  // White Flash
    { c: [80, 150, 255],  blast: 0.79 },  // Blue Star
    { c: [255, 64, 64],   blast: 0.96 },  // Red Comet
    { c: [170, 90, 255],  blast: 1.13 },  // Purple Bloom
    { c: [255, 86, 190],  blast: 1.30 },  // Pink Willow
    { c: [70, 255, 120],  blast: 1.47 },  // Green Burst
    { c: [255, 196, 64],  blast: 1.55 }   // Gold Nova (rare)
  ];
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function makeCanvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  // A wisp: soft halo, a crown of rays, a white core.
  function wispSprite(c) {
    var S = 128, cv = makeCanvas(S, S), g = cv.getContext("2d"), m = S / 2;
    var halo = g.createRadialGradient(m, m, 0, m, m, m);
    halo.addColorStop(0, rgba(c, 0.55));
    halo.addColorStop(0.25, rgba(c, 0.22));
    halo.addColorStop(1, rgba(c, 0));
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = "lighter";
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2, len = (i % 2 ? 0.48 : 0.86) * m;
      var lg = g.createLinearGradient(m, m, m + Math.cos(a) * len, m + Math.sin(a) * len);
      lg.addColorStop(0, rgba(c, 0.95)); lg.addColorStop(1, rgba(c, 0));
      g.strokeStyle = lg; g.lineWidth = 2.2; g.lineCap = "round";
      g.beginPath(); g.moveTo(m, m); g.lineTo(m + Math.cos(a) * len, m + Math.sin(a) * len); g.stroke();
    }
    var core = g.createRadialGradient(m, m, 0, m, m, m * 0.16);
    core.addColorStop(0, "rgba(255,255,255,1)"); core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core; g.fillRect(0, 0, S, S);
    return cv;
  }
  // A burst's body: white-hot centre into the wisp's colour, soft to nothing.
  function burstSprite(c) {
    var S = 160, cv = makeCanvas(S, S), g = cv.getContext("2d"), m = S / 2;
    var b = g.createRadialGradient(m, m, 0, m, m, m);
    b.addColorStop(0, "rgba(255,255,255,0.9)");
    b.addColorStop(0.18, rgba(c, 0.7));
    b.addColorStop(0.55, rgba(c, 0.18));
    b.addColorStop(1, rgba(c, 0));
    g.fillStyle = b; g.fillRect(0, 0, S, S);
    return cv;
  }
  TYPES.forEach(function (t) { t.wisp = wispSprite(t.c); t.burst = burstSprite(t.c); });

  // One column of aurora, bright at its lower edge and fading upward.
  function auroraStrip(c) {
    var cv = makeCanvas(1, 256), g = cv.getContext("2d");
    var lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, rgba(c, 0));
    lg.addColorStop(0.55, rgba(c, 0.28));
    lg.addColorStop(0.9, rgba(c, 0.85));
    lg.addColorStop(1, rgba(c, 0));
    g.fillStyle = lg; g.fillRect(0, 0, 1, 256);
    return cv;
  }
  var AURORA = [
    // Low on the horizon, behind the mountains, so it backlights the land the
    // way it does in the game rather than hanging in the upper sky.
    { strip: auroraStrip([70, 255, 170]), base: 0.67, amp: 0.035, k1: 0.0021, k2: 0.0063, s1: 0.07, s2: -0.13, h: 0.3, a: 0.27 },
    { strip: auroraStrip([60, 210, 200]), base: 0.61, amp: 0.03, k1: 0.0017, k2: 0.0049, s1: -0.05, s2: 0.1, h: 0.22, a: 0.09 }
  ];

  /* -------------------------------------------------------------- sizing -- */

  var skyCtx = skyCv.getContext("2d");
  var fx = fxCv.getContext("2d");
  var stars = [];
  var groundY = 0, spacing = 120, baseR = 80;

  function resize() {
    var r = pin.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    [skyCv, fxCv].forEach(function (cv) {
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    });
    skyCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);

    groundY = H * 0.66;
    var n = Math.round(Math.max(14, Math.min(44, (W * groundY) / 24000)));
    spacing = Math.sqrt((W * groundY) / n);
    baseR = spacing * 0.7;

    // Stars fill the whole frame: the land hides the lower ones until the climb
    // takes it away.
    stars = [];
    var sn = Math.round(Math.min(420, W * H / 3400));
    for (var i = 0; i < sn; i++) {
      stars.push({ x: Math.random() * W, y: Math.pow(Math.random(), 1.15) * H,
                   s: Math.random() < 0.08 ? 1.7 : 0.6 + Math.random() * 0.8,
                   ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.8 });
    }
    nebula = buildNebula();
    auroraCv = makeCanvas(Math.max(2, Math.ceil(W / 4)), Math.max(2, Math.ceil(H / 4)));
    seedField(n);
  }

  // The high sky the climb rises into: soft clouds in the game's teal, green and
  // violet, drawn once at low resolution (it is all falloff) and scaled up.
  var nebula = null, auroraCv = null;
  function buildNebula() {
    var w = Math.max(2, Math.round(W * 0.5)), h = Math.max(2, Math.round(H * 0.5));
    var cv = makeCanvas(w, h), g = cv.getContext("2d");
    var rnd = (function (s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })(7);
    var cols = [[40, 170, 150], [60, 200, 110], [110, 70, 200], [30, 110, 170]];
    for (var i = 0; i < 46; i++) {
      var t = rnd();
      // a diagonal band, top-left to the right, like the game's nebula
      var x = w * (t * 1.2 - 0.1), y = h * (0.62 - t * 0.45 + (rnd() - 0.5) * 0.35);
      var r = Math.min(w, h) * (0.12 + rnd() * 0.3);
      var c = cols[Math.floor(rnd() * cols.length)];
      var gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(c, 0.16 + rnd() * 0.12));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return cv;
  }

  var climb = 0; // 0 in the valley, 1 at the top of the scene's scroll

  /* --------------------------------------------------------------- field -- */

  var wisps = [], bursts = [], sparks = [], fuses = [];
  var chain = 0, chainLabel = null, idleSince = 0, lastTap = -1e9, firstAuto = true;

  function pickType() {
    var r = Math.random();
    if (r < 0.05) return 6;           // the gold ones are rare
    return Math.floor(Math.random() * 6);
  }
  function spot() {
    for (var tries = 0; tries < 30; tries++) {
      var x = W * (0.04 + Math.random() * 0.92), y = H * 0.1 + Math.random() * (groundY - H * 0.1);
      var ok = true;
      for (var i = 0; i < wisps.length; i++) {
        var w = wisps[i];
        if (w.alive && (w.x - x) * (w.x - x) + (w.y - y) * (w.y - y) < spacing * spacing * 0.22) { ok = false; break; }
      }
      if (ok) return [x, y];
    }
    return [W * Math.random(), H * 0.1 + Math.random() * (groundY - H * 0.1)];
  }
  function newWisp(fadeDelay) {
    var p = spot(), t = pickType();
    return { x: p[0], y: p[1], vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 9,
             type: t, r: 3.2 + TYPES[t].blast * 1.8, ph: Math.random() * 6.28,
             a: 0, born: now() + (fadeDelay || 0), alive: true, lit: false };
  }
  function seedField(n) {
    wisps = []; bursts = []; sparks = []; fuses = []; chain = 0;
    for (var i = 0; i < n; i++) { var w = newWisp(Math.random() * 0.9); wisps.push(w); }
  }

  function now() { return performance.now() / 1000; }

  function ignite(x, y, type, power) {
    var t = TYPES[type];
    var R = baseR * t.blast * (power || 1);
    bursts.push({ x: x, y: y, type: type, R: R, r: 0, t0: now() });
    chain++;
    if (chain >= 3) chainLabel = { n: chain, x: x, y: y, t: now() };
    var n = Math.round(14 + t.blast * 10);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = R * (1.6 + Math.random() * 1.6);
      sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: t.c,
                    life: 0.6 + Math.random() * 0.7, age: 0 });
    }
    if (sparks.length > 900) sparks.splice(0, sparks.length - 900);
  }

  function step(dt) {
    var T = now();
    // drift
    for (var i = 0; i < wisps.length; i++) {
      var w = wisps[i];
      if (!w.alive) continue;
      w.vx += (Math.random() - 0.5) * 6 * dt; w.vy += (Math.random() - 0.5) * 6 * dt;
      w.vx = Math.max(-12, Math.min(12, w.vx)); w.vy = Math.max(-8, Math.min(8, w.vy));
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.x < W * 0.03 || w.x > W * 0.97) w.vx *= -1;
      if (w.y < H * 0.08 || w.y > groundY) w.vy *= -1;
      w.a = Math.min(1, Math.max(0, (T - w.born) / 0.9));
    }
    // fronts sweep outward and catch what they reach
    for (var b = bursts.length - 1; b >= 0; b--) {
      var B = bursts[b], age = T - B.t0;
      var k = Math.min(1, age / 0.34);
      B.r = B.R * (1 - Math.pow(1 - k, 3));
      if (age < 0.62) {
        for (var j = 0; j < wisps.length; j++) {
          var q = wisps[j];
          if (!q.alive || q.lit || q.a < 0.6) continue;
          var dx = q.x - B.x, dy = q.y - B.y;
          if (dx * dx + dy * dy < B.r * B.r) {
            q.lit = true;
            fuses.push({ w: q, at: T + 0.05 + Math.random() * 0.06 });
          }
        }
      }
      if (age > 1.05) bursts.splice(b, 1);
    }
    for (var f = fuses.length - 1; f >= 0; f--) {
      if (T >= fuses[f].at) {
        var fw = fuses[f].w;
        fw.alive = false;
        ignite(fw.x, fw.y, fw.type, 1);
        fuses.splice(f, 1);
      }
    }
    for (var s = sparks.length - 1; s >= 0; s--) {
      var p = sparks[s];
      p.age += dt;
      if (p.age > p.life) { sparks.splice(s, 1); continue; }
      var drag = Math.exp(-2.6 * dt);
      p.vx *= drag; p.vy = p.vy * drag + 46 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    var busy = bursts.length || fuses.length;
    if (busy) { idleSince = T; return; }
    // the chain has ended: let the sky refill, then light it again
    if (chain) {
      chain = 0;
      for (var d = 0; d < wisps.length; d++) {
        if (!wisps[d].alive) wisps[d] = newWisp(0.6 + Math.random() * 1.6);
      }
    }
    if (still) return;
    var wait = firstAuto ? 1.4 : 4.2;
    if (T - idleSince > wait && T - lastTap > 7) { autoIgnite(); firstAuto = false; }
  }

  // Light the wisp with the most neighbours in reach, so the sky shows off.
  function autoIgnite() {
    var best = null, bestN = -1;
    for (var i = 0; i < wisps.length; i++) {
      var w = wisps[i];
      if (!w.alive || w.a < 1) continue;
      var n = 0, R = baseR * TYPES[w.type].blast;
      for (var j = 0; j < wisps.length; j++) {
        var q = wisps[j];
        if (q === w || !q.alive) continue;
        if ((q.x - w.x) * (q.x - w.x) + (q.y - w.y) * (q.y - w.y) < R * R) n++;
      }
      n += Math.random() * 1.5;
      if (n > bestN) { bestN = n; best = w; }
    }
    if (best) { best.alive = false; chain = 0; ignite(best.x, best.y, best.type, 1.1); }
  }

  /* ---------------------------------------------------------------- draw -- */

  function drawSky(T) {
    var g = skyCtx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";

    // The climb: the nebula opens overhead as the land falls away.
    if (nebula && climb > 0.02) {
      g.globalAlpha = Math.min(1, Math.pow(climb, 1.1) * 1.15);
      g.drawImage(nebula, 0, -H * 0.18 * (1 - climb), W, H * 1.18);
    }

    // The aurora belongs to the horizon, so it sinks with the land and thins.
    // Drawn a column per pixel on a quarter-size layer and scaled up smoothly:
    // full-size columns overlapped by a pixel and showed as stripes on high-DPI.
    var sink = H * 0.62 * climb, fadeA = Math.max(0, 1 - climb * 1.1);
    if (fadeA > 0.01) {
      var ag = auroraCv.getContext("2d"), aw = auroraCv.width, ah = auroraCv.height, q = W / aw;
      ag.setTransform(1, 0, 0, 1, 0, 0);
      ag.globalCompositeOperation = "source-over";
      ag.clearRect(0, 0, aw, ah);
      ag.globalCompositeOperation = "lighter";
      for (var a = 0; a < AURORA.length; a++) {
        var A = AURORA[a];
        for (var c = 0; c < aw; c++) {
          var x = c * q;
          var yb = sink + H * (A.base + A.amp * Math.sin(x * A.k1 + T * A.s1) + A.amp * 0.4 * Math.sin(x * A.k2 + T * A.s2));
          var h = H * A.h * (0.7 + 0.3 * Math.sin(x * 0.0041 + T * 0.11 + a));
          var al = fadeA * A.a * (0.55 + 0.45 * Math.sin(x * 0.0093 + T * 0.27 + a * 2)) * (0.6 + 0.4 * Math.sin(x * 0.0013 - T * 0.05));
          if (al <= 0.01) continue;
          ag.globalAlpha = al;
          ag.drawImage(A.strip, c, (yb - h) / q, 1, h / q);
        }
      }
      g.globalAlpha = 1;
      g.imageSmoothingQuality = "high";
      g.drawImage(auroraCv, 0, 0, W, H);
    }
    g.globalAlpha = 1;
    // above the haze, the stars come out stronger and drift down past you
    var lift = 1 + climb * 0.7, drift = H * 0.1 * climb;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(T * s.sp + s.ph));
      var sy = (s.y + drift) % H;
      g.fillStyle = "rgba(225,232,255," + Math.min(1, tw * (s.s > 1.5 ? 0.95 : 0.6) * lift).toFixed(3) + ")";
      g.fillRect(s.x, sy, s.s, s.s);
    }
    g.globalCompositeOperation = "source-over";
  }

  function drawField(T) {
    var g = fx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";

    for (var i = 0; i < wisps.length; i++) {
      var w = wisps[i];
      if (!w.alive || w.a <= 0) continue;
      var tw = 0.78 + 0.22 * Math.sin(T * 2.1 + w.ph);
      var sz = w.r * (w.lit ? 11 : 7.2) * (0.94 + 0.06 * Math.sin(T * 3.3 + w.ph));
      g.globalAlpha = w.a * tw;
      g.drawImage(TYPES[w.type].wisp, w.x - sz / 2, w.y - sz / 2, sz, sz);
    }

    for (var b = 0; b < bursts.length; b++) {
      var B = bursts[b], age = T - B.t0, t = TYPES[B.type];
      var fade = age < 0.56 ? 1 : Math.max(0, 1 - (age - 0.56) / 0.49);
      var gs = B.r * 2.6;
      g.globalAlpha = 0.62 * fade;
      g.drawImage(t.burst, B.x - gs / 2, B.y - gs / 2, gs, gs);
      g.globalAlpha = 0.85 * fade;
      g.strokeStyle = rgba(t.c, 1);
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(B.x, B.y, Math.max(0.1, B.r), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.3 * fade;
      g.beginPath(); g.arc(B.x, B.y, Math.max(0.1, B.r * 0.9), 0, Math.PI * 2); g.stroke();
      if (age < 0.14) {
        var fl = (1 - age / 0.14), fs = B.R * 0.9;
        g.globalAlpha = fl;
        g.drawImage(TYPES[0].burst, B.x - fs / 2, B.y - fs / 2, fs, fs);
      }
    }

    g.lineCap = "round";
    for (var s = 0; s < sparks.length; s++) {
      var p = sparks[s], k = 1 - p.age / p.life;
      g.globalAlpha = k * 0.9;
      g.strokeStyle = rgba(p.c, 1);
      g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); g.lineTo(p.x, p.y); g.stroke();
    }

    g.globalCompositeOperation = "source-over";
    if (chainLabel) {
      var la = T - chainLabel.t;
      if (la > 1.4) chainLabel = null;
      else {
        g.globalAlpha = Math.min(1, (1.4 - la) / 0.5);
        g.fillStyle = "#ffd98a";
        g.font = "500 " + Math.round(Math.max(20, Math.min(34, W * 0.022))) + "px 'Inter Tight', Inter, sans-serif";
        g.textAlign = "center";
        g.shadowColor = "rgba(255,170,60,0.7)"; g.shadowBlur = 18;
        g.fillText("×" + chainLabel.n, chainLabel.x, chainLabel.y - 18 - la * 14);
        g.shadowBlur = 0;
      }
    }
    g.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- loop -- */

  var running = false, last = 0, visible = true;
  function frame(ms) {
    if (!running) return;
    var T = ms / 1000, dt = Math.min(0.05, last ? T - last : 0.016);
    last = T;
    step(dt);
    drawSky(T);
    drawField(T);
    requestAnimationFrame(frame);
  }
  function start() { if (running || still) return; running = true; last = 0; requestAnimationFrame(frame); }
  function stop() { running = false; }

  resize();
  if (still) { var T0 = now(); wisps.forEach(function (w) { w.a = 1; }); drawSky(T0); drawField(T0); }
  else start();

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); if (still) { drawSky(now()); drawField(now()); } }, 150);
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else if (visible) start(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      if (visible && !document.hidden) start(); else stop();
    }).observe(pin);
  }

  // Tap the sky: the player's own charge.
  pin.addEventListener("pointerdown", function (e) {
    if (e.target.closest("a")) return;
    var r = pin.getBoundingClientRect();
    lastTap = now();
    chain = 0;
    ignite(e.clientX - r.left, e.clientY - r.top, 6, 1.05);
    if (hint) hint.classList.add("is-gone");
    if (still) {
      // no loop under reduced motion; run this one chain by hand
      var t0 = performance.now();
      var tick = function (ms) {
        step(0.016); drawSky(ms / 1000); drawField(ms / 1000);
        if (bursts.length || fuses.length || sparks.length || ms - t0 < 300) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });

  /* --------------------------------------------------------------- boons -- */

  // A hand of three real boon cards. Dealt face down when the section comes
  // into view, flipped one after another; tap one to keep it and the other two
  // fall away, then a new hand is dealt. Left alone, it re-deals by itself.
  (function boons() {
    var deal = document.getElementById("deal");
    if (!deal) return;
    var TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
    var DECK = [
      ["radius", "Burst Radius", 2, 384], ["crit", "Critical Burst", 4, 384], ["echo", "Echo Burst", 3, 600],
      ["magnet", "Magnetism", 1, 384], ["bond", "Entanglement", 2, 624], ["smoulder", "Smoulder", 5, 444],
      ["resonance", "Resonance", 3, 468], ["arc", "Arc Lightning", 4, 528], ["nova", "Gold Nova", 5, 384],
      ["astro", "The Astronomer", 4, 522], ["size", "Wisp Size", 1, 408]
    ];
    var last = ["crit", "echo", "smoulder"], busy = false, timer = 0, seen = false, hovering = false;

    function cardEl(d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "card t" + d[2] + " is-down";
      b.style.setProperty("--tilt", ((Math.random() - 0.5) * 16).toFixed(1) + "deg");
      b.setAttribute("aria-label", "Keep " + d[1] + ", " + TIERS[d[2]].toLowerCase());
      b.innerHTML = '<span class="card__in"><span class="card__face"><span class="card__tier">' + TIERS[d[2]] +
        '</span><img class="card__icon" src="assets/boons/' + d[0] + '.webp" alt="" width="' + d[3] + '" height="' + d[3] +
        '"><span class="card__name">' + d[1] + '</span></span><span class="card__back" aria-hidden="true"></span></span>' +
        '<span class="ring" aria-hidden="true"></span>';
      b.addEventListener("click", function () { pick(b); });
      return b;
    }
    function hand() {
      var pool = DECK.filter(function (d) { return last.indexOf(d[0]) < 0; });
      for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      var h = pool.slice(0, 3);
      last = h.map(function (d) { return d[0]; });
      return h;
    }
    function dealHand(cards) {
      busy = true;
      deal.innerHTML = "";
      var els = cards.map(cardEl);
      els.forEach(function (e) { deal.appendChild(e); });
      void deal.offsetWidth;
      els.forEach(function (e, i) {
        setTimeout(function () { e.classList.remove("is-down"); e.classList.add("is-hidden"); }, still ? 0 : 120 + i * 140);
        setTimeout(function () { e.classList.remove("is-hidden"); }, still ? 0 : 620 + i * 180);
      });
      setTimeout(function () { busy = false; schedule(); }, still ? 0 : 1300);
    }
    function pick(card) {
      if (busy) return;
      busy = true; clearTimeout(timer);
      Array.prototype.forEach.call(deal.children, function (c) { c.classList.add(c === card ? "is-picked" : "is-gone"); });
      setTimeout(function () {
        Array.prototype.forEach.call(deal.children, function (c) { c.classList.add("is-gone"); });
      }, still ? 300 : 1500);
      setTimeout(function () { dealHand(hand()); }, still ? 400 : 2100);
    }
    function schedule() {
      clearTimeout(timer);
      if (still) return;
      timer = setTimeout(function () {
        if (hovering || document.hidden || !seen) { schedule(); return; }
        var cs = deal.children;
        pick(cs[Math.floor(Math.random() * cs.length)]);
      }, 6500);
    }
    deal.addEventListener("pointerenter", function () { hovering = true; });
    deal.addEventListener("pointerleave", function () { hovering = false; });

    // the static hand in the markup is the no-script fallback; deal over it
    var first = DECK.filter(function (d) { return last.indexOf(d[0]) >= 0; })
      .sort(function (a, b) { return last.indexOf(a[0]) - last.indexOf(b[0]); });
    if ("IntersectionObserver" in window && !still) {
      deal.innerHTML = "";
      new IntersectionObserver(function (e) {
        seen = e[0].isIntersecting;
        if (seen && !deal.children.length) dealHand(first);
      }, { threshold: 0.35 }).observe(deal);
    } else {
      seen = true;
      dealHand(first);
    }
  })();

  /* --------------------------------------------------------------- yours -- */

  // Each slot turns through its few looks, offset from the others.
  if (!still) {
    document.querySelectorAll("[data-cycle]").forEach(function (stage, k) {
      var imgs = stage.querySelectorAll("img"), i = 0;
      setTimeout(function () {
        setInterval(function () {
          if (document.hidden) return;
          imgs[i].classList.remove("is-on");
          i = (i + 1) % imgs.length;
          imgs[i].classList.add("is-on");
        }, 3200);
      }, k * 900);
    });
  }

  /* -------------------------------------------------------------- scroll -- */

  var header = document.querySelector(".site-header");
  var video = document.getElementById("reel-video");

  function plainFallback() {
    document.querySelectorAll(".reveal").forEach(function (el) { el.style.opacity = 1; el.style.transform = "none"; });
    window.addEventListener("scroll", function () { header.classList.toggle("is-solid", window.scrollY > window.innerHeight * 0.8); }, { passive: true });
  }

  function playWhenSeen() {
    if (!video) return;
    if (still) { video.controls = true; return; }
    if (!("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { var p = video.play(); if (p) p.catch(function () {}); }
      else video.pause();
    }, { threshold: 0.3 }).observe(video);
  }
  playWhenSeen();

  if (still || !window.gsap || !window.ScrollTrigger) { plainFallback(); return; }

  var gsap = window.gsap, ST = window.ScrollTrigger;
  gsap.registerPlugin(ST);

  if (window.Lenis) {
    var lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on("scroll", ST.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  ST.create({
    start: function () { return window.innerHeight * 0.85; },
    end: "max",
    onToggle: function (self) { header.classList.toggle("is-solid", self.isActive); }
  });

  // The ascent: each layer sinks at its own depth; the land leaves the frame.
  var tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: ".scene", start: "top top", end: "bottom bottom", scrub: 0.8, invalidateOnRefresh: true,
                     onUpdate: function (self) { climb = self.progress; } }
  });
  document.querySelectorAll(".scene .layer").forEach(function (el) {
    var d = parseFloat(el.getAttribute("data-depth")) || 0;
    tl.to(el, { y: function () { return d * window.innerHeight * 1.1; } }, 0);
  });
  tl.to("#scene-title", { autoAlpha: 0, y: -70, scale: 1.04, duration: 0.2 }, 0)
    .to(["#hint", "#cue"], { autoAlpha: 0, duration: 0.06 }, 0)
    .fromTo("#line-1", { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.26)
    .to("#line-1", { autoAlpha: 0, y: -40, duration: 0.1 }, 0.46)
    .fromTo("#line-2", { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.58)
    .to("#line-2", { autoAlpha: 0, y: -30, duration: 0.1 }, 0.9)
    .to(".scene__fade", { opacity: 1, duration: 0.2 }, 0.8);

  // A breath of mouse parallax on the valley, desktop only.
  if (window.matchMedia("(pointer: fine)").matches) {
    var movers = [];
    document.querySelectorAll(".scene .layer").forEach(function (el) {
      var d = parseFloat(el.getAttribute("data-depth")) || 0;
      movers.push({ d: d, x: gsap.quickTo(el, "x", { duration: 1.4, ease: "power3.out" }) });
    });
    pin.addEventListener("pointermove", function (e) {
      var nx = e.clientX / window.innerWidth - 0.5;
      movers.forEach(function (m) { m.x(-nx * 40 * m.d); });
    });
  }

  // Panels drift against the scroll.
  gsap.utils.toArray(".panel__img").forEach(function (el) {
    gsap.fromTo(el, { yPercent: -7 }, {
      yPercent: 7, ease: "none",
      scrollTrigger: { trigger: el.parentNode, start: "top bottom", end: "bottom top", scrub: true }
    });
  });

  // Something waits: it sharpens a little as you approach, never fully.
  gsap.fromTo("#mystery-img",
    { scale: 1.3, filter: "blur(18px) brightness(0.2) saturate(1.2)" },
    { scale: 1, filter: "blur(5px) brightness(0.62) saturate(1.2)", ease: "none",
      scrollTrigger: { trigger: ".mystery", start: "top bottom", end: "center center", scrub: true } });

  // The valley rises back into frame at the close, nearest trees last.
  [[".cta .trees-far", 60], [".cta .trees-near", 140]].forEach(function (pair) {
    gsap.fromTo(pair[0], { y: pair[1] }, {
      y: 0, ease: "none",
      scrollTrigger: { trigger: ".cta", start: "top bottom", end: "bottom bottom", scrub: true }
    });
  });

  [".relics", ".medals"].forEach(function (row) {
    gsap.utils.toArray(row + " img").forEach(function (el, i) {
      gsap.from(el, { autoAlpha: 0, y: 40, scale: 0.85, duration: 1.2, ease: "power3.out", delay: i * 0.09,
                      scrollTrigger: { trigger: row, start: "top 85%", once: true } });
    });
  });

  gsap.utils.toArray(".reveal").forEach(function (el) {
    gsap.to(el, { autoAlpha: 1, y: 0, duration: 1.3, ease: "power3.out",
                  scrollTrigger: { trigger: el, start: "top 88%", once: true } });
  });

  window.addEventListener("load", function () { ST.refresh(); });
})();
