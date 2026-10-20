(function (LBT) {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const STRESS = params.has('stress');
  const TEST = params.has('test');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  const $ = function (id) { return document.getElementById(id); };

  let save = LBT.loadSave();
  let mode = 'start';
  let shopReturn = 'start';
  let levelsReturn = 'start';
  let session = null;
  let demo = null;
  let fx = LBT.createFx();
  let cssW = 1;
  let cssH = 1;
  let dpr = 1;
  let grass = null;
  let grassKey = '';
  let cam = { ox: 0, oy: 0, scale: 1 };
  const sprites = [];
  const metaCache = {};
  const pointers = new Map();
  const pointerOrder = [];
  const keys = new Set();
  let hover = null;
  let shopFlash = '';
  let saveTimer = 0;
  let fps = 60;
  let fpsFrames = 0;
  const drawOrder = [];

  const LEAF_COLORS = ['#e24b1a', '#ef8a28', '#f2c14e', '#c44832', '#b56a1e', '#f0dd9a'];
  const WET_COLORS = ['#6a3a24', '#7d5a28', '#8a7a3a', '#5c342c', '#5a4328', '#8a8460'];

  function traceLeaf(g, type) {
    g.beginPath();
    if (type === 0) {
      g.moveTo(0, -18);
      g.bezierCurveTo(7, -14, 12, -8, 16, -11);
      g.bezierCurveTo(11, -4, 14, 2, 9, 5);
      g.bezierCurveTo(15, 9, 8, 16, 2, 11);
      g.lineTo(0, 18);
      g.lineTo(-2, 11);
      g.bezierCurveTo(-8, 16, -15, 9, -9, 5);
      g.bezierCurveTo(-14, 2, -11, -4, -16, -11);
      g.bezierCurveTo(-12, -8, -7, -14, 0, -18);
    } else if (type === 1) {
      g.moveTo(0, 18);
      g.bezierCurveTo(8, 14, 14, 8, 12, 2);
      g.bezierCurveTo(17, -1, 14, -10, 6, -13);
      g.bezierCurveTo(4, -19, -4, -19, -6, -13);
      g.bezierCurveTo(-14, -10, -17, -1, -12, 2);
      g.bezierCurveTo(-14, 8, -8, 14, 0, 18);
    } else {
      g.moveTo(0, 18);
      g.bezierCurveTo(8, 8, 7, -8, 0, -18);
      g.bezierCurveTo(-7, -8, -8, 8, 0, 18);
    }
  }

  function buildSprites() {
    for (let wet = 0; wet < 2; wet++) {
      for (let type = 0; type < 3; type++) {
        for (let c = 0; c < 6; c++) {
          const spr = document.createElement('canvas');
          spr.width = 64;
          spr.height = 64;
          const g = spr.getContext('2d');
          g.translate(32, 32);
          g.scale(1.15, 1.15);
          g.fillStyle = wet ? WET_COLORS[c] : LEAF_COLORS[c];
          traceLeaf(g, type);
          g.fill();
          g.strokeStyle = 'rgba(40, 20, 8, 0.35)';
          g.lineWidth = 1.2;
          g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.28)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(0, 14);
          g.lineTo(0, -10);
          g.stroke();
          sprites.push(spr);
        }
      }
    }
  }

  function spriteFor(leaf) {
    return sprites[(leaf.wet ? 18 : 0) + leaf.type * 6 + (leaf.color % 6)];
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  function computeCam(yard, withHud) {
    let top = 18;
    let bot = 18;
    if (withHud) {
      const nodes = [$('hud-top')];
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]) top = Math.max(top, nodes[i].getBoundingClientRect().bottom + 8);
      }
      const bottomBar = $('hud-bottom').getBoundingClientRect();
      bot = Math.max(72, cssH - bottomBar.top + 8);
    }
    const gutter = LBT.BALANCE.outside;
    const availW = Math.max(40, cssW - 16);
    const availH = Math.max(40, cssH - top - bot);
    const scale = Math.min(availW / (yard.w + gutter * 2), availH / (yard.h + gutter * 2));
    let sx = 0;
    let sy = 0;
    if (!reducedMotion && fx.shake > 0.2) {
      sx = Math.sin(performance.now() * 0.05) * fx.shake;
      sy = Math.cos(performance.now() * 0.04) * fx.shake * 0.65;
    }
    const worldW = yard.w + gutter * 2;
    const worldH = yard.h + gutter * 2;
    return {
      scale: scale,
      ox: (cssW - worldW * scale) / 2 + gutter * scale + sx,
      oy: top + (availH - worldH * scale) / 2 + gutter * scale + sy,
    };
  }

  function screenToWorld(sx, sy, camera) {
    return {
      x: (sx - camera.ox) / camera.scale,
      y: (sy - camera.oy) / camera.scale,
    };
  }

  function readPointer(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
      type: e.pointerType,
      buttons: e.buttons,
    };
  }

  function formatMs(ms) {
    if (ms == null || !(ms >= 0)) return '--';
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + r.toFixed(1).padStart(4, '0');
  }

  function formatCoins(n) {
    return String(Math.max(0, n | 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function starString(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += i < n ? '★' : '☆';
    return s;
  }

  function playAspect() {
    let top = 64;
    let bot = 84;
    const hudTop = $('hud-top');
    const bottom = $('hud-bottom');
    if (hudTop && bottom && hud && !hud.classList.contains('hidden')) {
      top = Math.max(top, hudTop.getBoundingClientRect().bottom + 8);
      bot = Math.max(bot, cssH - bottom.getBoundingClientRect().top + 8);
    }
    const availW = Math.max(220, cssW - 16);
    const availH = Math.max(220, cssH - top - bot);
    return availW / availH;
  }

  function levelMeta(n) {
    const key = n + '@' + playAspect().toFixed(2);
    if (!metaCache[key]) {
      const level = LBT.makeLevel(n, playAspect());
      metaCache[key] = { parMs: level.parMs, name: level.name, total: level.total };
    }
    return metaCache[key];
  }

  function activeView() {
    if (session && (mode === 'play' || mode === 'pause' || mode === 'complete' || (mode === 'shop' && shopReturn === 'play') || (mode === 'shop' && shopReturn === 'pause') || (mode === 'shop' && shopReturn === 'complete') || (mode === 'levels' && levelsReturn === 'pause'))) {
      return session;
    }
    return demo;
  }

  function makeBlower(level, stats) {
    return {
      x: level.start.x,
      y: level.start.y,
      vx: 0,
      vy: 0,
      aim: level.start.aim,
      desiredAim: level.start.aim,
      hasAim: true,
      targetX: level.start.x,
      targetY: level.start.y,
      charge: stats.batteryCapacity,
      limp: false,
      powerMul: 1,
      blowing: false,
      snap: true,
      _lock: null,
      _lockT: 0,
      _lastTX: level.start.x,
      _lastTY: level.start.y,
    };
  }

  function buildGrass(level) {
    const key = level.n + ':' + level.yard.w + 'x' + level.yard.h;
    if (grass && grassKey === key) return;
    const c = document.createElement('canvas');
    c.width = level.yard.w;
    c.height = level.yard.h;
    const g = c.getContext('2d');
    g.fillStyle = '#6fa84a';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(86, 143, 52, 0.55)';
    for (let y = 0; y < c.height; y += 26) {
      if (Math.floor(y / 26) % 2 === 0) g.fillRect(0, y, c.width, 13);
    }
    const rng = LBT.mulberry32(level.n * 7919 + 3);
    for (let i = 0; i < 800; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(20, 60, 16, 0.08)';
      g.fillRect(rng() * c.width, rng() * c.height, 2, 2);
    }
    for (let i = 0; i < 50; i++) {
      g.fillStyle = rng() < 0.5 ? '#f3e7a2' : '#f7faf4';
      g.beginPath();
      g.arc(rng() * c.width, rng() * c.height, 1.5, 0, Math.PI * 2);
      g.fill();
    }
    grass = c;
    grassKey = key;
  }

  function resetFx() {
    fx.dust.length = 0;
    fx.coins.length = 0;
    fx.popups.length = 0;
    fx.confetti.length = 0;
    fx.shake = 0;
  }

  function startLevel(n) {
    const level = LBT.makeLevel(n, playAspect());
    if (STRESS) {
      const base = level.leaves.slice();
      let i = 0;
      while (level.leaves.length < 400 && base.length) {
        const src = base[i % base.length];
        const copy = Object.assign({}, src);
        copy.id = 50000 + level.leaves.length;
        copy.x = 24 + ((src.x + i * 19) % (level.yard.w - 48));
        copy.y = 24 + ((src.y + i * 11) % (level.yard.h - 48));
        copy.collected = false;
        copy.alive = true;
        copy.dying = 0;
        copy.vx = 0;
        copy.vy = 0;
        copy.height = 0;
        level.leaves.push(copy);
        i++;
      }
      level.spawns = [];
      level.total = level.leaves.length;
    }
    const stats = LBT.computeStats(save);
    session = {
      level: level,
      stats: stats,
      blower: makeBlower(level, stats),
      leaves: level.leaves,
      spawns: level.spawns.map(function (s) { return Object.assign({ done: false }, s); }),
      raceStarted: !!STRESS,
      raceTime: 0,
      collected: 0,
      bagged: 0,
      escaped: 0,
      runCoins: 0,
      parBonus: 0,
      combo: 0,
      lastCollect: -10,
      won: false,
      winDelay: -1,
      timeMs: 0,
      isBest: false,
      hint: true,
    };
    save.lastLevel = n;
    LBT.writeSave(save);
    buildGrass(level);
    resetFx();
    setMode('play');
    canvas.focus({ preventScroll: true });
  }

  function makeDemo() {
    const level = LBT.makeLevel(1, playAspect());
    const stats = LBT.computeStats(LBT.defaultSave());
    demo = {
      level: level,
      stats: stats,
      blower: makeBlower(level, stats),
      leaves: level.leaves,
      spawns: [],
      raceStarted: true,
      raceTime: 0,
      collected: 0,
      demo: true,
    };
    buildGrass(level);
  }

  function setMode(next) {
    mode = next;
    const map = {
      start: 'screen-start',
      levels: 'screen-levels',
      pause: 'screen-pause',
      shop: 'screen-shop',
      complete: 'screen-complete',
      confirm: 'screen-confirm',
    };
    Object.keys(map).forEach(function (key) {
      $(map[key]).classList.toggle('hidden', key !== mode);
    });
    hud.classList.toggle('hidden', mode !== 'play');
    if (mode === 'shop') buildShop();
    if (mode === 'levels') fillLevels();
    if (mode === 'pause') fillPauseHelp();
    if (mode === 'play') updateHud();
  }

  function uncollected(view) {
    let n = 0;
    const spawns = view.spawns || [];
    for (let i = 0; i < spawns.length; i++) if (!spawns[i].done) n++;
    const leaves = view.leaves;
    for (let i = 0; i < leaves.length; i++) if (!leaves[i].collected) n++;
    return n;
  }

  function onCollect(leaf) {
    const t = session.raceTime;
    if (t - session.lastCollect <= LBT.BALANCE.comboWindow) session.combo += 1;
    else session.combo = 1;
    session.lastCollect = t;
    let gain = 1;
    if (session.combo >= 3 && session.combo % 3 === 0) gain += 1;
    if (Math.random() < session.stats.magnet) gain += 1;
    save.coins += gain;
    session.runCoins += gain;
    session.bagged += 1;
    session.collected += 1;
    session.hint = false;
    LBT.audio.requestPing(session.combo);
    LBT.spawnCoinFx(fx, leaf, gain);
    const chip = $('coins-chip');
    chip.classList.remove('pop');
    void chip.offsetWidth;
    chip.classList.add('pop');
    saveTimer = 0.4;
  }

  function onEscape() {
    session.escaped += 1;
    session.collected += 1;
  }

  function releaseSpawns(view, time) {
    const spawns = view.spawns || [];
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      if (!s.done && time >= s.t) {
        s.done = true;
        view.leaves.push(LBT.makeLeaf(s));
      }
    }
  }

  function applyInput() {
    if (!session) return;
    const blower = session.blower;
    const camera = cam;
    let blowing = keys.has('Space');
    let keyX = 0;
    let keyY = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) keyX -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) keyX += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) keyY -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) keyY += 1;

    const downs = [];
    for (let i = 0; i < pointerOrder.length; i++) {
      const p = pointers.get(pointerOrder[i]);
      if (p) downs.push(p);
    }
    const touches = [];
    let mouse = null;
    for (let i = 0; i < downs.length; i++) {
      if (downs[i].type === 'touch') touches.push(downs[i]);
      else mouse = downs[i];
    }

    let pointer = null;
    if (touches.length) pointer = touches[0];
    else if (mouse) pointer = mouse;
    else if (hover && hover.type !== 'touch') pointer = hover;

    if (pointer && (pointer.buttons & 1)) blowing = true;
    if (touches.length) blowing = true;

    const world = pointer ? screenToWorld(pointer.sx, pointer.sy, camera) : null;
    let aimWorld = null;
    if (touches.length > 1) aimWorld = screenToWorld(touches[1].sx, touches[1].sy, camera);

    if (keyX || keyY) {
      const mag = Math.hypot(keyX, keyY) || 1;
      blower.targetX = blower.x + (keyX / mag) * 5000;
      blower.targetY = blower.y + (keyY / mag) * 5000;
      blower.desiredAim = Math.atan2(keyY, keyX);
      blower.hasAim = true;
    } else if (world) {
      blower.targetX = world.x;
      blower.targetY = world.y;
    }

    if (!(keyX || keyY)) {
      if (world && !touches.length) {
        const dx = world.x - blower._lastTX;
        const dy = world.y - blower._lastTY;
        if (dx * dx + dy * dy > 1) {
          blower.desiredAim = Math.atan2(dy, dx);
          blower.hasAim = true;
        }
      }
      if (world) {
        blower._lastTX = world.x;
        blower._lastTY = world.y;
      }
      if (aimWorld) {
        blower.desiredAim = Math.atan2(aimWorld.y - blower.y, aimWorld.x - blower.x);
        blower.hasAim = true;
      }
    }
    blower.aimLock = !!(aimWorld || keyX || keyY);
    blower.followMove = !blower.aimLock;
    blower.coarseAim = touches.length > 0 && !aimWorld;

    const wantsStart = blowing || keyX !== 0 || keyY !== 0;
    blower.snap = !session.raceStarted;
    blower.blowing = session.raceStarted ? blowing : false;
    if (!session.raceStarted && wantsStart) {
      session.raceStarted = true;
      blower.blowing = blowing || keyX !== 0 || keyY !== 0;
    }
  }

  function stepSession(dt) {
    if (!session || session.won || mode !== 'play') return;
    applyInput();
    const blower = session.blower;
    LBT.stepBlower(blower, session.stats, dt, session.level);
    if (!session.raceStarted) return;
    session.raceTime += dt;
    releaseSpawns(session, session.raceTime);
    LBT.stepLeaves(session.leaves, blower, session.stats, session.level, session.raceTime, dt, onCollect, onEscape);
    if (blower.blowing) LBT.spawnDust(fx, blower, session.stats);
    if (!reducedMotion && blower.blowing && session.stats.power > 750) {
      fx.shake = Math.max(fx.shake, session.stats.power > 1200 ? 2.4 : 1.15);
    }
    if (!session.won && uncollected(session) === 0) {
      if (session.winDelay < 0) session.winDelay = 0.4;
      session.winDelay -= dt;
      if (session.winDelay <= 0) finishLevel();
    }
    saveTimer -= dt;
    if (saveTimer <= 0) {
      saveTimer = 2;
      LBT.writeSave(save);
    }
  }

  function stepDemo(dt) {
    if (!demo) return;
    demo.raceTime += dt;
    LBT.steerAi(demo.blower, demo.leaves, demo.level, demo.stats, dt);
    LBT.stepBlower(demo.blower, demo.stats, dt, demo.level);
    LBT.stepLeaves(demo.leaves, demo.blower, demo.stats, demo.level, demo.raceTime, dt, function () {}, function () {});
    if (demo.blower.blowing) LBT.spawnDust(fx, demo.blower, demo.stats);
    const yard = demo.level.yard;
    for (let i = 0; i < demo.leaves.length; i++) {
      const leaf = demo.leaves[i];
      if (!leaf.alive) {
        leaf.alive = true;
        leaf.collected = false;
        leaf.dying = 0;
        leaf.hold = 0;
        leaf.height = 0;
        leaf.vz = 0;
        leaf.vx = 0;
        leaf.vy = 0;
        leaf.escaped = false;
        leaf.x = 70 + Math.random() * (yard.w - 140);
        leaf.y = 50 + Math.random() * yard.h * 0.45;
      }
    }
  }

  function finishLevel() {
    if (session.won) return;
    session.won = true;
    session.blower.blowing = false;
    const level = session.level;
    const score = session.runCoins;
    session.timeMs = Math.max(1, session.raceTime * 1000);
    const key = String(level.n);
    const prev = save.bestCoins[key];
    session.isBest = prev == null || score > prev;
    if (session.isBest) save.bestCoins[key] = score;
    if (save.unlockedLevel < level.n + 1) save.unlockedLevel = level.n + 1;
    if (level.n < LBT.MAX_LEVEL) save.lastLevel = level.n + 1;
    LBT.writeSave(save);
    LBT.spawnConfetti(fx, level.yard);
    LBT.audio.jingle();
    if (navigator.vibrate) navigator.vibrate(12);
    fillComplete();
    setMode('complete');
  }

  function movingLeaves(view) {
    if (!view) return 0;
    let n = 0;
    const leaves = view.leaves;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!leaf.alive || leaf.collected) continue;
      if (leaf.vx * leaf.vx + leaf.vy * leaf.vy > 1600) n++;
    }
    return n;
  }

  function syncAudio(dt) {
    const view = mode === 'play' ? session : mode === 'start' ? demo : session;
    const blowing = !!(view && view.blower.blowing && (mode === 'play' || mode === 'start'));
    const powerNorm = view ? Math.min(1, view.stats.power / 1600) : 0;
    const powerMul = view && typeof view.blower.powerMul === 'number' ? view.blower.powerMul : 1;
    const wind = view ? LBT.windAt(view.level, view.raceTime || 0) : null;
    LBT.audio.updateWind(wind ? wind.mag : 0);
    LBT.audio.updateBlower(blowing, powerNorm, powerMul);
    const rustleView = mode === 'play' ? session : mode === 'start' ? demo : null;
    LBT.audio.updateRustle(rustleView ? movingLeaves(rustleView) : 0);
    LBT.audio.flush();
  }

  function updateHud() {
    if (!session || mode !== 'play') return;
    const level = session.level;
    $('level-chip').textContent = 'Lv ' + level.n;
    $('level-chip').title = level.name;
    $('timer').textContent = formatCoins(session.runCoins);
    $('leaves-count').textContent = uncollected(session) + '/' + level.total;
    $('coins').textContent = formatCoins(save.coins);
    const afford = LBT.anythingAffordable(save);
    $('afford-badge').classList.toggle('hidden', !afford);
    $('shop-btn').classList.toggle('afford', afford);
    const vac = $('vacuum-btn');
    vac.classList.toggle('hidden', !save.attachments.vacuum);
    vac.classList.toggle('on', !!save.vacuumOn);
    vac.setAttribute('aria-pressed', save.vacuumOn ? 'true' : 'false');
    $('hint').classList.toggle('hidden', !session.hint);
    if (session.hint) {
      $('hint').textContent = 'Coins only count in the bag. Leaves blown off the lawn vanish.';
    }
  }

  function fillPauseHelp() {
    $('pause-help').textContent = coarsePointer
      ? 'Drag anywhere to blow. Second finger sets aim. Vacuum is the purple button, if you own it.'
      : 'WASD or arrows move. Space blows. V toggles vacuum. B opens the shop. Esc pauses.';
  }

  function fillComplete() {
    const level = session.level;
    const stars = LBT.starsForCoins(session.runCoins, level.total);
    $('result-kicker').textContent = 'Level ' + level.n + ' cleared';
    $('result-title').textContent = level.name;
    $('result-stars').innerHTML = starString(stars).replace(/☆/g, '<span class="off">☆</span>');
    $('result-banner').classList.toggle('hidden', !session.isBest);
    const rows = [
      ['Coins', formatCoins(session.runCoins)],
      ['Best', formatCoins(save.bestCoins[String(level.n)] == null ? 0 : save.bestCoins[String(level.n)])],
      ['Blown away', String(session.escaped)],
    ];
    $('result-stats').innerHTML = rows.map(function (row) {
      return '<dt>' + row[0] + '</dt><dd>' + row[1] + '</dd>';
    }).join('');
    const next = $('next-btn');
    const atEnd = level.n >= LBT.MAX_LEVEL;
    next.classList.toggle('hidden', atEnd);
    next.textContent = atEnd ? 'Done' : 'Next level';
  }

  function fillLevels() {
    const grid = $('level-grid');
    let html = '';
    for (let n = 1; n <= LBT.MAX_LEVEL; n++) {
      const locked = n > save.unlockedLevel;
      const meta = locked ? null : levelMeta(n);
      const best = save.bestCoins[String(n)];
      const stars = meta && best != null ? LBT.starsForCoins(best, meta.total) : 0;
      html += '<button type="button" class="lvl' + (locked ? ' lock' : '') + (best != null ? ' cleared' : '') + '" data-level="' + n + '"' + (locked ? ' disabled' : '') + '>';
      html += '<span class="n">' + (locked ? '·' : n) + '</span>';
      html += '<span class="s">' + (locked ? 'Locked' : starString(stars)) + '</span>';
      html += '<span class="t">' + (best != null ? formatCoins(best) : '') + '</span>';
      html += '</button>';
    }
    grid.innerHTML = html;
  }

  function pipRow(owned, max) {
    let html = '<span class="pips">';
    for (let i = 0; i < max; i++) html += '<i class="pip' + (i < owned ? ' on' : '') + '"></i>';
    html += '</span>';
    return html;
  }

  function buildShop() {
    const stats = LBT.computeStats(save);
    const pctPower = Math.round(stats.power / LBT.BLOWERS[0].power * 100);
    $('shop-stats').innerHTML =
      '<span>' + stats.model.name + '</span>' +
      '<span>Power ' + pctPower + '%</span>' +
      '<span>Reach ' + Math.round(stats.range) + '</span>' +
      '<span>Battery ' + stats.batteryCapacity.toFixed(0) + 's</span>' +
      '<span class="coin-line">Leafcoins ' + formatCoins(save.coins) + '</span>';
    $('shop-note').textContent = shopReturn === 'play' || shopReturn === 'pause'
      ? 'Timer is paused. Purchases apply immediately.'
      : 'Gear persists across every level.';

    const nozzle = $('nozzle-row');
    if (save.attachments.narrow || save.attachments.wide) {
      nozzle.classList.remove('hidden');
      const options = [{ id: 'stock', label: 'Stock nozzle' }];
      if (save.attachments.narrow) options.push({ id: 'narrow', label: 'Narrow' });
      if (save.attachments.wide) options.push({ id: 'wide', label: 'Wide' });
      nozzle.innerHTML = options.map(function (o) {
        return '<button type="button" data-act="nozzle" data-id="' + o.id + '" class="' + (save.nozzle === o.id ? 'on' : '') + '">' + o.label + '</button>';
      }).join('');
    } else {
      nozzle.classList.add('hidden');
      nozzle.innerHTML = '';
    }

    const cur = LBT.blowerIndex(save.blowerId);
    let html = '<h3 class="section-label">Blowers</h3>';
    for (let i = 0; i < LBT.BLOWERS.length; i++) {
      const b = LBT.BLOWERS[i];
      const owned = i <= cur;
      const equipped = i === cur;
      const next = i === cur + 1;
      let cost = equipped ? 'Equipped' : owned ? 'Equip' : next ? (TEST ? 'Free' : formatCoins(b.cost)) : 'Locked';
      let cls = 'card';
      if (equipped) cls += ' equipped';
      if (!owned && !next) cls += ' cant';
      if (shopFlash === 'blower:' + b.id) cls += ' flash';
      html += '<button type="button" class="' + cls + '" data-act="blower" data-id="' + b.id + '">';
      html += '<span class="name">' + b.name + '</span>';
      html += '<span class="meta">Power ' + b.power + ' · Reach ' + b.range + ' · ' + b.battery + 's</span>';
      html += '<span class="cost">' + cost + '</span></button>';
    }
    html += '<h3 class="section-label">Upgrades</h3>';
    for (let i = 0; i < LBT.UPGRADES.length; i++) {
      const u = LBT.UPGRADES[i];
      const owned = save.tiers[u.id] || 0;
      const maxed = owned >= u.max;
      const price = LBT.shopCost(LBT.tierCost(u, owned));
      const cost = maxed ? 'Maxed' : (TEST ? 'Free' : formatCoins(price));
      const cant = !maxed && save.coins < price;
      let cls = 'card' + (maxed ? ' maxed' : '') + (cant ? ' cant' : '');
      if (shopFlash === 'upgrade:' + u.id) cls += ' flash';
      const total = Math.round(u.per * owned * 100);
      const nextPct = Math.round(u.per * 100);
      html += '<button type="button" class="' + cls + '" data-act="upgrade" data-id="' + u.id + '">';
      html += '<span class="name">' + u.name + '</span>';
      html += pipRow(owned, u.max);
      html += '<span class="meta">' + u.blurb + (maxed ? ' · +' + total + '%' : ' · next +' + nextPct + '%') + '</span>';
      html += '<span class="cost">' + cost + '</span></button>';
    }
    html += '<h3 class="section-label">Attachments</h3>';
    for (let i = 0; i < LBT.ATTACHMENTS.length; i++) {
      const a = LBT.ATTACHMENTS[i];
      const owned = !!save.attachments[a.id];
      const open = LBT.attachmentGateOpen(a, save);
      const price = LBT.shopCost(a.cost);
      let cost = owned ? 'Owned' : open ? (TEST ? 'Free' : formatCoins(price)) : 'Level ' + a.gate;
      const cant = !owned && (!open || save.coins < price);
      let cls = 'card' + (owned ? ' maxed' : '') + (cant ? ' cant' : '');
      if (shopFlash === 'attach:' + a.id) cls += ' flash';
      html += '<button type="button" class="' + cls + '" data-act="attach" data-id="' + a.id + '">';
      html += '<span class="name">' + a.name + '</span>';
      html += '<span class="meta">' + a.blurb + '</span>';
      html += '<span class="cost">' + cost + '</span></button>';
    }
    const grid = $('shop-grid');
    const scroll = grid.scrollTop;
    grid.innerHTML = html;
    grid.scrollTop = scroll;
    shopFlash = '';
  }

  function refreshStats(chargePct) {
    if (session) {
      session.stats = LBT.computeStats(save);
      session.blower.charge = Math.min(session.stats.batteryCapacity, Math.max(0, chargePct) * session.stats.batteryCapacity);
      if (session.blower.charge >= session.stats.batteryCapacity * LBT.BALANCE.batteryRecover) {
        session.blower.limp = false;
      }
    }
    LBT.writeSave(save);
    LBT.audio.chime();
    buildShop();
  }

  function chargePct() {
    if (!session || !session.stats.batteryCapacity) return 1;
    return session.blower.charge / session.stats.batteryCapacity;
  }

  function onShopClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-id');
    if (act === 'nozzle') {
      if ((id === 'narrow' && !save.attachments.narrow) || (id === 'wide' && !save.attachments.wide)) return;
      save.nozzle = id;
      shopFlash = '';
      refreshStats(chargePct());
      return;
    }
    if (act === 'upgrade') {
      const u = LBT.UPGRADES.filter(function (item) { return item.id === id; })[0];
      const owned = save.tiers[id] || 0;
      if (!u || owned >= u.max) return;
      const cost = LBT.shopCost(LBT.tierCost(u, owned));
      if (save.coins < cost) { LBT.audio.ensure(); LBT.audio.deny(); return; }
      const pct = chargePct();
      save.coins -= cost;
      save.tiers[id] += 1;
      shopFlash = 'upgrade:' + id;
      refreshStats(pct);
      return;
    }
    if (act === 'blower') {
      const idx = LBT.blowerIndex(id);
      const cur = LBT.blowerIndex(save.blowerId);
      if (idx === cur) return;
      if (idx < cur) {
        save.blowerId = id;
        shopFlash = 'blower:' + id;
        refreshStats(chargePct());
        return;
      }
      if (idx !== cur + 1) { LBT.audio.deny(); return; }
      const model = LBT.BLOWERS[idx];
      if (save.coins < LBT.shopCost(model.cost)) { LBT.audio.ensure(); LBT.audio.deny(); return; }
      save.coins -= LBT.shopCost(model.cost);
      save.blowerId = id;
      shopFlash = 'blower:' + id;
      refreshStats(1);
      return;
    }
    if (act === 'attach') {
      const a = LBT.ATTACHMENTS.filter(function (item) { return item.id === id; })[0];
      if (!a || save.attachments[id]) return;
      if (!LBT.attachmentGateOpen(a, save) || save.coins < LBT.shopCost(a.cost)) {
        LBT.audio.ensure();
        LBT.audio.deny();
        return;
      }
      save.coins -= LBT.shopCost(a.cost);
      save.attachments[id] = true;
      if (id === 'narrow') save.nozzle = 'narrow';
      if (id === 'wide' && save.nozzle === 'stock') save.nozzle = 'wide';
      shopFlash = 'attach:' + id;
      refreshStats(chargePct());
    }
  }

  function openShop() {
    shopReturn = mode;
    setMode('shop');
  }

  function closeShop() {
    const back = shopReturn || 'start';
    shopReturn = back;
    setMode(back);
  }

  function openLevels() {
    levelsReturn = mode === 'play' ? 'pause' : mode;
    if (mode === 'play') mode = 'pause';
    setMode('levels');
  }

  function toggleVacuum() {
    if (!save.attachments.vacuum) return;
    save.vacuumOn = !save.vacuumOn;
    if (session) session.stats = LBT.computeStats(save);
    LBT.writeSave(save);
    updateHud();
    if (mode === 'shop') buildShop();
  }

  function toggleMute() {
    save.muted = !save.muted;
    LBT.audio.ensure();
    LBT.audio.setMuted(save.muted);
    LBT.writeSave(save);
    paintMute();
  }

  function paintMute() {
    const btn = $('mute');
    btn.classList.toggle('muted', !!save.muted);
    btn.setAttribute('aria-pressed', save.muted ? 'true' : 'false');
    btn.setAttribute('aria-label', save.muted ? 'Unmute sound' : 'Mute sound');
    btn.innerHTML = save.muted
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4V9zm12 2 4 4m0-4-4 4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4V9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawGale(level, time) {
    const wind = LBT.windAt(level, time);
    if (!(wind.mag > 1)) return;
    const ang = wind.angle;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 244, 255, ' + Math.min(0.55, 0.18 + wind.mag / 520) + ')';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const shift = (time * (50 + wind.mag)) % 120;
    const cols = Math.ceil(level.yard.w / 110) + 1;
    const rows = Math.ceil(level.yard.h / 84) + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ((c * 110 + shift * cx + r * 23) % (level.yard.w + 80)) - 40;
        const y = ((r * 84 + shift * cy + c * 19) % (level.yard.h + 80)) - 40;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + cx * 42, y + cy * 42);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const horizontal = Math.abs(cx) >= Math.abs(cy);
    const count = horizontal ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = horizontal ? (cx > 0 ? 34 : level.yard.w - 34) : t * level.yard.w;
      const y = horizontal ? t * level.yard.h : (cy > 0 ? 34 : level.yard.h - 34);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-12, 11);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-12, -11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawZone(level, time) {
    const z = level.zone;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 28;
    if (z.type === 'ring') {
      ctx.beginPath();
      ctx.arc(level.yard.w / 2, level.yard.h / 2, z.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120, 196, 110, 0.28)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 255, 196, 0.9)';
      ctx.stroke();
      ctx.setLineDash([]);
      drawBin(level.yard.w / 2, level.yard.h / 2, 22);
    } else {
      const r = LBT.zoneRect(level);
      ctx.fillStyle = 'rgba(116, 186, 104, 0.32)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(226, 255, 196, 0.9)';
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = '#6e6a60';
      if (z.edge === 'bottom') ctx.fillRect(r.x, r.y, r.w, 8);
      else if (z.edge === 'top') ctx.fillRect(r.x, r.y + r.h - 8, r.w, 8);
      else if (z.edge === 'left') ctx.fillRect(r.x + r.w - 8, r.y, 8, r.h);
      else ctx.fillRect(r.x, r.y, 8, r.h);
      drawBin(r.x + r.w / 2, r.y + r.h / 2, 18);
    }
    ctx.restore();
  }

  function drawBin(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#c9853a';
    roundRect(-s, -s * 0.2, s * 2, s * 1.15, 4);
    ctx.fill();
    ctx.fillStyle = '#8d5a22';
    ctx.fillRect(-s, -s * 0.35, s * 2, s * 0.28);
    ctx.fillStyle = '#f6f3ea';
    ctx.font = '700 ' + Math.max(11, s * 0.7) + 'px Avenir Next, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAG', 0, s * 0.35);
    ctx.restore();
  }

  function drawObstacles(level, time) {
    const list = level.obstacles;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      ctx.save();
      if (o.type === 'fence') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(o.x + 3, o.y + 4, o.w, o.h);
        ctx.fillStyle = '#8d5a32';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      } else if (o.type === 'tree') {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(o.x + 4, o.y + o.r * 0.45, o.r * 0.75, o.r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b4423';
        ctx.fillRect(o.x - 4, o.y - 2, 8, o.r * 0.55);
        ctx.fillStyle = o.spawner ? '#2f8f45' : '#2a6b34';
        ctx.beginPath();
        ctx.arc(o.x, o.y - 4, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(o.x - o.r * 0.25, o.y - o.r * 0.35, o.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        if (o.spawner) {
          ctx.globalAlpha = 0.65 + Math.sin(time * 3 + o.x) * 0.35;
          ctx.fillStyle = '#f0c14e';
          ctx.beginPath();
          ctx.ellipse(o.x + o.r * 0.2, o.y - o.r - 6, 5, 3, 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (o.type === 'bush') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.ellipse(o.x + 2, o.y + 3, o.r, o.r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3e8f48';
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5eae62';
        ctx.beginPath();
        ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.2, o.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#6d4a2c';
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.r, o.r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d4556a';
        ctx.beginPath();
        ctx.arc(o.x - o.r * 0.3, o.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f2d15a';
        ctx.beginPath();
        ctx.arc(o.x + o.r * 0.25, o.y - 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawWind(blower, stats, time) {
    ctx.save();
    ctx.translate(blower.x, blower.y);
    ctx.rotate(blower.aim);
    const range = stats.vacuum ? stats.range * LBT.BALANCE.vacuumRange : stats.range;
    const half = stats.halfAngle;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.arc(0, 0, range, -half, half);
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 12, 0, 0, range);
    if (stats.vacuum) {
      g.addColorStop(0, blower.blowing ? 'rgba(180, 160, 255, 0.38)' : 'rgba(180, 160, 255, 0.08)');
      g.addColorStop(1, 'rgba(180, 160, 255, 0)');
    } else {
      g.addColorStop(0, blower.blowing ? 'rgba(210, 235, 255, 0.38)' : 'rgba(210, 235, 255, 0.07)');
      g.addColorStop(1, 'rgba(210, 235, 255, 0)');
    }
    ctx.fillStyle = g;
    ctx.fill();
    if (blower.blowing) {
      ctx.clip();
      ctx.strokeStyle = stats.vacuum ? 'rgba(230, 220, 255, 0.45)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      const speed = (stats.vacuum ? -1 : 1) * Math.max(80, stats.power) * 0.45;
      const shift = (time * speed) % 46;
      for (let i = 0; i < 9; i++) {
        const a = -half + (i + 0.5) * (2 * half / 9);
        const start = ((shift + i * 18) % 46 + 46) % 46;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * start, Math.sin(a) * start);
        ctx.lineTo(Math.cos(a) * (start + 16), Math.sin(a) * (start + 16));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBlower(blower, stats, time) {
    const s = stats.model.scale;
    ctx.save();
    ctx.translate(blower.x, blower.y);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(3, 6, 16 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    const pct = stats.batteryCapacity ? blower.charge / stats.batteryCapacity : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(-16, -26 * s, 32, 5, 2);
    ctx.fill();
    ctx.fillStyle = blower.limp ? '#e25b4a' : pct < 0.45 ? '#e8b84a' : '#7dce6a';
    ctx.fillRect(-16, -26 * s, Math.max(0, 32 * pct), 5);
    ctx.rotate(blower.aim);
    ctx.fillStyle = '#2c302c';
    roundRect(4 * s, -4.5 * s, 24 * s, 9 * s, 3);
    ctx.fill();
    ctx.fillStyle = stats.model.color;
    roundRect(-16 * s, -12 * s, 28 * s, 24 * s, 7);
    ctx.fill();
    ctx.fillStyle = stats.model.accent;
    ctx.fillRect(-12 * s, -4 * s, 16 * s, 8 * s);
    if (blower.blowing) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-2 * s, 0, 6 * s, time * 18, time * 18 + 1.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#e7eef2';
    roundRect(26 * s, -3.2 * s, 8 * s, 6.4 * s, 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    const view = activeView();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a2a16';
    ctx.fillRect(0, 0, cssW, cssH);
    if (!view) return;
    const level = view.level;
    const withHud = mode === 'play';
    cam = computeCam(level.yard, withHud);
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.scale, cam.scale);

    const gutter = LBT.BALANCE.outside;
    ctx.fillStyle = '#3e3426';
    roundRect(-gutter + 6, -gutter + 6, level.yard.w + (gutter - 6) * 2, level.yard.h + (gutter - 6) * 2, 28);
    ctx.fill();
    ctx.fillStyle = '#5a4630';
    roundRect(-16, -16, level.yard.w + 32, level.yard.h + 32, 22);
    ctx.fill();
    roundRect(0, 0, level.yard.w, level.yard.h, 18);
    ctx.save();
    ctx.clip();
    if (grass) ctx.drawImage(grass, 0, 0);
    drawGale(level, view.raceTime || 0);
    drawZone(level, view.raceTime || 0);
    drawObstacles(level, view.raceTime || 0);
    drawWind(view.blower, view.stats, view.raceTime || 0);

    for (let i = 0; i < fx.dust.length; i++) {
      const p = fx.dust[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.45;
      ctx.fillStyle = '#e6d7b0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawOrder.length = 0;
    const leaves = view.leaves;
    for (let i = 0; i < leaves.length; i++) if (leaves[i].alive) drawOrder.push(i);
    drawOrder.sort(function (a, b) {
      return (leaves[a].y + leaves[a].height) - (leaves[b].y + leaves[b].height);
    });
    for (let i = 0; i < drawOrder.length; i++) {
      const leaf = leaves[drawOrder[i]];
      const spr = spriteFor(leaf);
      let sc = 1 + leaf.height * 0.012;
      if (leaf.dying > 0) sc *= Math.max(0.08, leaf.dying / 0.24);
      const size = 36 * sc;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(leaf.x + leaf.height * 0.35, leaf.y + 5, size * 0.32, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(leaf.x, leaf.y - leaf.height * 0.55);
      ctx.rotate(leaf.angle + Math.sin((view.raceTime || 0) * 2 + leaf.phase) * (leaf.vx * leaf.vx + leaf.vy * leaf.vy > 400 ? 0 : 0.06));
      if (leaf.height > 8 && (leaf.vx * leaf.vx + leaf.vy * leaf.vy) > 4000) {
        ctx.globalAlpha = 0.28;
        ctx.drawImage(spr, -size * 0.5 - leaf.vx * 0.012, -size * 0.5 - leaf.vy * 0.012, size, size);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    for (let i = 0; i < fx.popups.length; i++) {
      const p = fx.popups[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = '#f0c14e';
      ctx.font = '800 16px Avenir Next, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < fx.confetti.length; i++) {
      const p = fx.confetti[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s * 0.5, -p.s * 0.3, p.s, p.s * 0.6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawBlower(view.blower, view.stats, view.raceTime || 0);
    ctx.strokeStyle = 'rgba(42, 32, 16, 0.55)';
    ctx.lineWidth = 8;
    roundRect(0, 0, level.yard.w, level.yard.h, 18);
    ctx.stroke();

    const chip = $('coins-chip');
    if (chip && !hud.classList.contains('hidden') && fx.coins.length) {
      const rect = chip.getBoundingClientRect();
      const crect = canvas.getBoundingClientRect();
      const tx = rect.left + rect.width * 0.5 - crect.left;
      const ty = rect.top + rect.height * 0.5 - crect.top;
      for (let i = 0; i < fx.coins.length; i++) {
        const c = fx.coins[i];
        const u = Math.min(1, c.t / c.life);
        const e = 1 - Math.pow(1 - u, 3);
        const sx = cam.ox + c.x * cam.scale;
        const sy = cam.oy + c.y * cam.scale;
        const x = sx + (tx - sx) * e;
        const y = sy + (ty - sy) * e - Math.sin(e * Math.PI) * 34;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(x, y);
        ctx.fillStyle = '#f0c14e';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a5a12';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (DEBUG) {
      let avgDist = 0;
      let counted = 0;
      let moving = 0;
      if (view.leaves && view.level) {
        for (let i = 0; i < view.leaves.length; i++) {
          const leaf = view.leaves[i];
          if (!leaf.alive || leaf.collected) continue;
          avgDist += LBT.distToZone(view.level, leaf.x, leaf.y);
          counted++;
          if (leaf.vx * leaf.vx + leaf.vy * leaf.vy > 400) moving++;
        }
      }
      $('debug-readout').textContent =
        'fps ' + fps.toFixed(0) +
        '  leaves ' + (view.leaves ? view.leaves.length : 0) +
        '  alive ' + drawOrder.length +
        '  ' + mode +
        (counted ? '  avg ' + Math.round(avgDist / counted) + '  moving ' + moving : '') +
        (session ? '  bat ' + session.blower.charge.toFixed(0) + (session.blower.limp ? ' limp' : '') : '') +
        (view.level ? '  par ' + (view.level.parMs / 1000).toFixed(0) + 's' : '');
    }
  }

function frame(ts) {
  try {
  if (!frame.last) frame.last = ts;
    let dt = (ts - frame.last) / 1000;
    frame.last = ts;
    if (dt > 0.05) dt = 0.05;
    fpsFrames++;
    if (ts - (frame.fpsT || 0) > 400) {
      fps = fpsFrames * 1000 / (ts - (frame.fpsT || ts - 400));
      fpsFrames = 0;
      frame.fpsT = ts;
    }
    if (mode === 'play' && session) cam = computeCam(session.level.yard, true);
    if (mode === 'play') {
      frame.acc = (frame.acc || 0) + dt;
      let guard = 0;
      const step = 1 / 120;
      while (mode === 'play' && frame.acc >= step && guard < 8) {
        stepSession(step);
        frame.acc -= step;
        guard++;
      }
      if (guard >= 8) frame.acc = 0;
    } else {
      frame.acc = 0;
      if (mode === 'start') stepDemo(Math.min(dt, 1 / 30));
    }
    if (mode !== 'pause') LBT.stepFx(fx, dt, reducedMotion);
    syncAudio(dt);
    if (mode === 'play') updateHud();
render();
  } catch (err) {
    const readout = $('debug-readout');
    if (readout) readout.textContent = (err && err.stack) ? err.stack : String(err);
  }
  requestAnimationFrame(frame);
}

  function bootInput() {
    canvas.addEventListener('pointerdown', function (e) {
      LBT.audio.ensure();
      if (e.pointerType === 'touch') e.preventDefault();
      if (mode !== 'play') return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
      const p = readPointer(e);
      pointers.set(e.pointerId, p);
      pointerOrder.push(e.pointerId);
    }, { passive: false });

    canvas.addEventListener('pointermove', function (e) {
      const p = readPointer(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (e.pointerType !== 'touch') hover = p;
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      const idx = pointerOrder.indexOf(e.pointerId);
      if (idx >= 0) pointerOrder.splice(idx, 1);
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (mode === 'play') toggleVacuum();
    });
    canvas.addEventListener('pointerleave', function () { hover = null; });

    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      LBT.audio.ensure();
      keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Escape') {
        if (mode === 'shop') closeShop();
        else if (mode === 'pause') setMode('play');
        else if (mode === 'levels') setMode(levelsReturn === 'play' ? 'pause' : levelsReturn);
        else if (mode === 'confirm') setMode('start');
        else if (mode === 'play') setMode('pause');
        else if (mode === 'complete') setMode('start');
      } else if (e.code === 'KeyP' && mode === 'play') setMode('pause');
      else if (e.code === 'KeyB' && (mode === 'play' || mode === 'pause')) openShop();
      else if (e.code === 'KeyM') toggleMute();
      else if (e.code === 'KeyV' && mode === 'play') toggleVacuum();
    });
    window.addEventListener('keyup', function (e) { keys.delete(e.code); });
    window.addEventListener('blur', function () { keys.clear(); });
  }

  function bootUi() {
    $('continue-btn').addEventListener('click', function () {
      LBT.audio.ensure();
      const n = Math.min(LBT.MAX_LEVEL, Math.max(1, save.lastLevel || save.unlockedLevel || 1));
      if (n > save.unlockedLevel) save.unlockedLevel = n;
      startLevel(Math.min(n, save.unlockedLevel));
    });
    $('levels-btn').addEventListener('click', function () { levelsReturn = 'start'; setMode('levels'); });
    $('menu-shop-btn').addEventListener('click', function () { shopReturn = 'start'; setMode('shop'); });
    $('reset-btn').addEventListener('click', function () { setMode('confirm'); });
    $('confirm-no').addEventListener('click', function () { setMode('start'); });
    $('confirm-yes').addEventListener('click', function () {
      save = LBT.resetSave();
      if (TEST) applyTestUnlock();
      session = null;
      Object.keys(metaCache).forEach(function (key) { delete metaCache[key]; });
      makeDemo();
      paintMute();
      setMode('start');
    });
    $('levels-back').addEventListener('click', function () {
      setMode(levelsReturn === 'play' ? 'pause' : (levelsReturn || 'start'));
    });
    $('level-grid').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-level]');
      if (!btn || btn.disabled) return;
      const n = Number(btn.getAttribute('data-level'));
      if (n <= save.unlockedLevel) startLevel(n);
    });
    $('resume-btn').addEventListener('click', function () { setMode('play'); });
    $('pause-btn').addEventListener('click', function () { setMode('pause'); });
    $('pause-shop').addEventListener('click', openShop);
    $('shop-btn').addEventListener('click', openShop);
    $('pause-restart').addEventListener('click', function () {
      if (session) startLevel(session.level.n);
    });
    $('pause-levels').addEventListener('click', openLevels);
    $('pause-quit').addEventListener('click', function () { setMode('start'); });
    $('shop-close').addEventListener('click', closeShop);
    $('shop-grid').addEventListener('click', onShopClick);
    $('nozzle-row').addEventListener('click', onShopClick);
    $('vacuum-btn').addEventListener('click', toggleVacuum);
    $('mute').addEventListener('click', toggleMute);
    $('next-btn').addEventListener('click', function () {
      if (!session) return;
      const n = session.level.n + 1;
      if (n <= LBT.MAX_LEVEL) startLevel(n);
    });
    $('replay-btn').addEventListener('click', function () {
      if (session) startLevel(session.level.n);
    });
    $('complete-shop').addEventListener('click', openShop);
    $('complete-levels').addEventListener('click', function () { levelsReturn = 'complete'; setMode('levels'); });
    if (DEBUG) {
      $('debug').classList.remove('hidden');
      $('debug-sim').addEventListener('click', function () {
        const out = $('debug-readout');
        out.textContent = 'Simulating…';
        setTimeout(function () {
          const level = session ? session.level : LBT.makeLevel(1, playAspect());
          const stats = session ? session.stats : LBT.previewStats(level.n);
          const started = performance.now();
          const result = LBT.simulateLevel(level, stats, 180);
          const ms = Math.round(performance.now() - started);
          out.textContent = result.time
            ? 'Sim clear ' + result.time.toFixed(1) + 's in ' + ms + 'ms\npar ' + (level.parMs / 1000).toFixed(1) + 's'
            : 'Sim stuck ' + result.collected + '/' + result.total + ' (' + ms + 'ms)';
        }, 30);
      });
    }
    $('start-hint').textContent = 'Bag leaves for coins. Anything blown off the lawn is gone and pays nothing.';
  }

  function applyTestUnlock() {
    LBT.testing = true;
    save.unlockedLevel = LBT.MAX_LEVEL;
    if (!document.querySelector('.test-tag')) {
      const tag = document.createElement('div');
      tag.className = 'test-tag';
      tag.textContent = 'TEST';
      document.body.appendChild(tag);
    }
  }

  function boot() {
    canvas.tabIndex = 0;
    buildSprites();
    resize();
    window.addEventListener('resize', resize);
    LBT.audio.setMuted = LBT.audio.setMuted.bind(LBT.audio);
    LBT.audio.muted = !!save.muted;
    paintMute();
    if (TEST) applyTestUnlock();
    makeDemo();
    bootInput();
    bootUi();
    if (DEBUG) {
      window.__LBT = {
        win: function () {
          if (!session) return;
          for (let i = 0; i < session.leaves.length; i++) {
            session.leaves[i].collected = true;
            session.leaves[i].alive = false;
          }
          for (let i = 0; i < session.spawns.length; i++) session.spawns[i].done = true;
        },
      };
    }
    if (STRESS) startLevel(Number(params.get('level') || 1));
    else setMode('start');
    requestAnimationFrame(frame);
  }

  boot();
})(window.LBT = window.LBT || {});
