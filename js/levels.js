(function (LBT) {
  'use strict';

  LBT.MAX_LEVEL = 36;

  LBT.LEVEL_NAMES = [
    'Front Lawn', 'Side Yard', 'Maple Drive', 'Oak Corner', 'Windy Lot',
    'Hedge Row', 'Garden Path', 'Curb Appeal', 'Back Fence', 'Orchard Edge',
    'Wet Wednesday', 'Gust Alley', 'Leaf Trap', 'Narrow Gate', 'Ring Toss',
    'Storm Watch', 'Deep Pile', 'Twisty Pines', 'Flower Maze', 'Long Haul',
    'Whirl Corner', 'Soggy Green', 'Crosswind', 'Pocket Park', 'Grand Sweep',
    'Last Blow',
  ];

  LBT.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  LBT.angDiff = function (a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  };

  LBT.clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  function zoneRect(level) {
    const w = level.yard.w;
    const h = level.yard.h;
    const z = level.zone;
    if (z.type === 'ring') return null;
    const depth = Math.max(52, Math.min(w, h) * 0.072);
    const along = z.edge === 'left' || z.edge === 'right' ? h : w;
    const len = along * z.coverage;
    let start = (along - len) / 2 + (z.offset || 0) * along;
    start = LBT.clamp(start, 0, along - len);
    if (z.edge === 'bottom') return { x: start, y: h - depth, w: len, h: depth };
    if (z.edge === 'top') return { x: start, y: 0, w: len, h: depth };
    if (z.edge === 'left') return { x: 0, y: start, w: depth, h: len };
    return { x: w - depth, y: start, w: depth, h: len };
  }

  LBT.zoneRect = zoneRect;

  LBT.zoneCenter = function (level) {
    if (level.zone.type === 'ring') {
      return { x: level.yard.w * 0.5, y: level.yard.h * 0.5 };
    }
    const r = zoneRect(level);
    return { x: r.x + r.w * 0.5, y: r.y + r.h * 0.5 };
  };

  LBT.zoneContains = function (level, x, y) {
    const z = level.zone;
    if (z.type === 'ring') {
      const dx = x - level.yard.w * 0.5;
      const dy = y - level.yard.h * 0.5;
      return dx * dx + dy * dy <= z.r * z.r;
    }
    const r = zoneRect(level);
    return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  };

  LBT.closestZonePoint = function (level, x, y) {
    if (level.zone.type === 'ring') {
      return { x: level.yard.w * 0.5, y: level.yard.h * 0.5 };
    }
    const r = zoneRect(level);
    return {
      x: LBT.clamp(x, r.x, r.x + r.w),
      y: LBT.clamp(y, r.y, r.y + r.h),
    };
  };

  LBT.distToZone = function (level, x, y) {
    if (LBT.zoneContains(level, x, y)) return 0;
    if (level.zone.type === 'ring') {
      const c = LBT.zoneCenter(level);
      return Math.max(0, Math.hypot(x - c.x, y - c.y) - level.zone.r);
    }
    const p = LBT.closestZonePoint(level, x, y);
    return Math.hypot(x - p.x, y - p.y);
  };

  function startFor(yard, zone) {
    const m = 78;
    if (zone.type === 'ring') {
      return { x: yard.w * 0.5, y: yard.h * 0.8, aim: -Math.PI / 2 };
    }
    if (zone.edge === 'bottom') return { x: yard.w / 2, y: m, aim: Math.PI / 2 };
    if (zone.edge === 'top') return { x: yard.w / 2, y: yard.h - m, aim: -Math.PI / 2 };
    if (zone.edge === 'left') return { x: yard.w - m, y: yard.h / 2, aim: Math.PI };
    return { x: m, y: yard.h / 2, aim: 0 };
  }

  function circleHitsCircle(x, y, r, o) {
    const rr = r + (o.r || 0);
    const dx = x - o.x;
    const dy = y - o.y;
    return dx * dx + dy * dy < rr * rr;
  }

  function circleHitsRect(x, y, rad, rect) {
    const nx = LBT.clamp(x, rect.x, rect.x + rect.w);
    const ny = LBT.clamp(y, rect.y, rect.y + rect.h);
    const dx = x - nx;
    const dy = y - ny;
    return dx * dx + dy * dy < rad * rad;
  }

  function blocked(level, x, y, rad, ignoreZone) {
    if (x < rad || y < rad || x > level.yard.w - rad || y > level.yard.h - rad) return true;
    const s = level.start;
    if (Math.hypot(x - s.x, y - s.y) < 108 + rad) return true;
    if (!ignoreZone) {
      if (level.zone.type === 'ring') {
        const dx = x - level.yard.w * 0.5;
        const dy = y - level.yard.h * 0.5;
        if (dx * dx + dy * dy < (level.zone.r + rad + 24) * (level.zone.r + rad + 24)) return true;
      } else {
        const rect = zoneRect(level);
        const pad = {
          x: rect.x - rad - 16,
          y: rect.y - rad - 16,
          w: rect.w + (rad + 16) * 2,
          h: rect.h + (rad + 16) * 2,
        };
        if (circleHitsRect(x, y, 1, pad)) return true;
      }
    }
    for (let i = 0; i < level.obstacles.length; i++) {
      const o = level.obstacles[i];
      if (o.type === 'fence') {
        if (circleHitsRect(x, y, rad, o)) return true;
      } else if (circleHitsCircle(x, y, rad, o)) return true;
    }
    return false;
  }

  function pushBias(zone, yard, rng) {
    if (zone.type === 'ring') {
      const ang = rng() * Math.PI * 2;
      const reach = Math.min(yard.w, yard.h) * 0.48;
      const dist = zone.r + 28 + rng() * Math.max(20, reach - zone.r);
      return {
        x: yard.w * 0.5 + Math.cos(ang) * dist,
        y: yard.h * 0.5 + Math.sin(ang) * dist,
      };
    }
    return {
      x: 18 + rng() * (yard.w - 36),
      y: 18 + rng() * (yard.h - 36),
    };
  }

  LBT.yardFor = function (levelNum, outerAspect) {
    const grow = Math.min(20, levelNum - 1);
    const innerArea = 640 * 440 * (1 + grow * 0.11);
    const g = LBT.BALANCE.outside;
    const R = Math.max(0.42, Math.min(2.4, outerAspect > 0 ? outerAspect : 640 / 440));
    const b = 2 * g * (R - 1);
    const disc = Math.max(0, b * b + 4 * R * innerArea);
    let h = (-b + Math.sqrt(disc)) / (2 * R);
    let w = R * (h + 2 * g) - 2 * g;
    if (!(w > 280) || !(h > 280) || !isFinite(w) || !isFinite(h)) {
      w = 640;
      h = 440;
    }
    return { w: Math.round(w), h: Math.round(h) };
  };

  LBT.makeLevel = function (n, outerAspect) {
    const levelNum = Math.max(1, Math.min(LBT.MAX_LEVEL, n | 0));
    const rng = LBT.mulberry32(levelNum * 10007 + 17);
    const yard = LBT.yardFor(levelNum, outerAspect);
    let zone;
    if (levelNum <= 4) {
      const edges = ['bottom', 'bottom', 'right', 'left'];
      zone = { type: 'edge', edge: edges[levelNum - 1], coverage: 1, offset: 0 };
    } else if (levelNum <= 9) {
      const edges = ['bottom', 'top', 'right', 'left'];
      zone = {
        type: 'edge',
        edge: edges[Math.floor(rng() * 4)],
        coverage: 0.6,
        offset: (rng() - 0.5) * 0.22,
      };
    } else if (levelNum <= 15) {
      const edges = ['bottom', 'top', 'right', 'left'];
      zone = {
        type: 'edge',
        edge: edges[Math.floor(rng() * 4)],
        coverage: 0.4,
        offset: (rng() - 0.5) * 0.28,
      };
    } else {
      zone = { type: 'ring', r: Math.max(54, 96 - (levelNum - 16) * 2.1) };
    }

    const level = {
      n: levelNum,
      name: LBT.LEVEL_NAMES[(levelNum - 1) % LBT.LEVEL_NAMES.length],
      yard: yard,
      zone: zone,
      obstacles: [],
      leaves: [],
      spawns: [],
      wetRatio: levelNum <= 2 ? 0 : Math.min(0.62, (levelNum - 2) * 0.042),
      wind: levelNum < 3 ? null : {
        speed: Math.min(220, 62 + (levelNum - 3) * 9),
        period: Math.max(3.2, 18 - (levelNum - 3) * 0.72),
      },
      ambient: { strength: 0, gust: 0 },
      total: 0,
      parMs: 0,
    };
    level.start = startFor(yard, zone);

    const obstacleCount = Math.floor(levelNum / 2);
    for (let i = 0; i < obstacleCount; i++) {
      const roll = rng();
      let placed = false;
      for (let attempt = 0; attempt < 28 && !placed; attempt++) {
        let o;
        if (roll < 0.42) {
          o = { type: 'tree', x: 0, y: 0, r: 30 + rng() * 16, spawner: false };
        } else if (roll < 0.68) {
          o = { type: 'bush', x: 0, y: 0, r: 16 + rng() * 12 };
        } else if (roll < 0.84) {
          o = { type: 'bed', x: 0, y: 0, r: 26 + rng() * 16 };
        } else if (rng() < 0.5) {
          o = { type: 'fence', x: 0, y: 0, w: 70 + rng() * 90, h: 16 };
        } else {
          o = { type: 'fence', x: 0, y: 0, w: 16, h: 70 + rng() * 80 };
        }
        if (o.type === 'fence') {
          if (yard.w < o.w + 90 || yard.h < o.h + 90) continue;
          o.x = 40 + rng() * Math.max(10, yard.w - 80 - o.w);
          o.y = 40 + rng() * Math.max(10, yard.h - 80 - o.h);
          const cx = o.x + o.w / 2;
          const cy = o.y + o.h / 2;
          if (blocked(level, cx, cy, Math.max(o.w, o.h) * 0.45, false)) continue;
          // fence blocked() uses obstacles only; test rect against existing via corners
          let hit = false;
          const pts = [
            [o.x, o.y],
            [o.x + o.w, o.y],
            [o.x, o.y + o.h],
            [o.x + o.w, o.y + o.h],
          ];
          for (let p = 0; p < pts.length; p++) {
            if (blocked(level, pts[p][0], pts[p][1], 8, false)) hit = true;
          }
          if (hit) continue;
        } else {
          o.x = 70 + rng() * (yard.w - 140);
          o.y = 70 + rng() * (yard.h - 140);
          if (blocked(level, o.x, o.y, o.r, false)) continue;
        }
        level.obstacles.push(o);
        placed = true;
      }
    }

    const area = yard.w * yard.h;
    const total = Math.min(640, Math.max(140, Math.round(area / 1450)));
    let spawnBudget = 0;
    if (levelNum >= 12) {
      spawnBudget = Math.min(Math.floor(total * 0.16), 6 + Math.floor((levelNum - 12) * 1.1));
    }
    const initial = total - spawnBudget;

    const trees = [];
    for (let t = 0; t < level.obstacles.length; t++) {
      if (level.obstacles[t].type === 'tree') trees.push(level.obstacles[t]);
    }
    const spawnerCount = levelNum >= 12 ? Math.min(trees.length, 1 + Math.floor((levelNum - 12) / 5)) : 0;
    for (let s = 0; s < spawnerCount; s++) trees[s].spawner = true;

    let id = 1;
    function specAt(x, y) {
      const wet = rng() < level.wetRatio ? 1 : 0;
      return {
        id: id++,
        x: x,
        y: y,
        wet: wet,
        type: Math.floor(rng() * 3),
        color: Math.floor(rng() * 6),
        phase: rng() * Math.PI * 2,
      };
    }

    for (let i = 0; i < initial; i++) {
      let leaf = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const p = pushBias(zone, yard, rng);
        if (!blocked(level, p.x, p.y, 10, false)) {
          leaf = specAt(p.x, p.y);
          break;
        }
      }
      if (!leaf) {
        leaf = specAt(yard.w * 0.5, yard.h * 0.35);
      }
      level.leaves.push(LBT.makeLeaf(leaf));
    }

    if (spawnBudget > 0 && spawnerCount > 0) {
      for (let i = 0; i < spawnBudget; i++) {
        const tree = trees[i % spawnerCount];
        const ang = rng() * Math.PI * 2;
        const dist = tree.r + 18 + rng() * 16;
        let x = tree.x + Math.cos(ang) * dist;
        let y = tree.y + Math.sin(ang) * dist;
        x = LBT.clamp(x, 20, yard.w - 20);
        y = LBT.clamp(y, 20, yard.h - 20);
        const spec = specAt(x, y);
        spec.t = 5 + (i / spawnBudget) * 18;
        level.spawns.push(spec);
      }
    } else if (spawnBudget > 0) {
      // No trees to drop from: fold the budget back into the initial pile.
      for (let i = 0; i < spawnBudget; i++) {
        const p = pushBias(zone, yard, rng);
        level.leaves.push(LBT.makeLeaf(specAt(p.x, p.y)));
      }
      spawnBudget = 0;
    }

    level.total = level.leaves.length + level.spawns.length;
    if (LBT.separateLeaves) LBT.separateLeaves(level.leaves, 4);

    const stats = LBT.previewStats(levelNum);
    level.parMs = Math.round(LBT.estimateSeconds(level, stats) * 1000);
    return level;
  };

  LBT.estimateSeconds = function (level, stats) {
    let sum = 0;
    const leaves = level.leaves;
    for (let i = 0; i < leaves.length; i++) sum += LBT.distToZone(level, leaves[i].x, leaves[i].y);
    const avg = sum / Math.max(1, leaves.length);
    const gear = Math.pow(Math.max(0.7, stats.power / 720), 0.45);
    let t = (16 + level.total * 0.14) / gear;
    if (level.n >= 5 && level.n <= 9) t *= 1.16;
    else if (level.n >= 10 && level.n <= 15) t *= 1.28;
    else if (level.n >= 16) t *= 1.38;
    t *= 1 + level.wetRatio * 0.38;
    t *= 1 + level.obstacles.length * 0.018;
    t *= 1 + ((level.wind && level.wind.speed) || 0) / 480;
    const nominal = (level.yard.w + level.yard.h) * 0.2;
    t *= LBT.clamp(avg / Math.max(80, nominal), 0.88, 1.18);
    const blow = t * 0.55;
    if (blow > stats.batteryCapacity) {
      t += (blow - stats.batteryCapacity) / Math.max(0.5, stats.rechargePerSec) * 0.45;
    }
    t *= LBT.BALANCE.parScale;
    return Math.max(32, t);
  };

  LBT.starsForCoins = function (coins, total) {
    if (coins == null || !isFinite(coins)) return 0;
    const ratio = coins / Math.max(1, total);
    if (ratio >= 0.9) return 3;
    if (ratio >= 0.5) return 2;
    return 1;
  };

  function windAngle(levelNum, phase) {
    const rng = LBT.mulberry32((levelNum * 10007 + phase * 9176 + 91) >>> 0);
    return rng() * Math.PI * 2;
  }

  LBT.windAt = function (level, time) {
    const out = LBT._ambient || (LBT._ambient = { x: 0, y: 0, mag: 0, angle: 0 });
    const w = level.wind;
    if (!w || !(w.speed > 0)) {
      out.x = 0;
      out.y = 0;
      out.mag = 0;
      out.angle = 0;
      return out;
    }
    const period = Math.max(0.8, w.period);
    const phase = Math.floor(time / period);
    const u = (time - phase * period) / period;
    const ease = u * u * (3 - 2 * u);
    const a0 = windAngle(level.n, phase);
    const a1 = windAngle(level.n, phase + 1);
    const ang = a0 + LBT.angDiff(a1, a0) * ease;
    out.angle = ang;
    out.mag = w.speed;
    out.x = Math.cos(ang) * w.speed;
    out.y = Math.sin(ang) * w.speed;
    return out;
  };

  LBT.ambientAt = LBT.windAt;
})(window.LBT = window.LBT || {});
