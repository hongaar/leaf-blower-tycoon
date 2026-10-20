(function (LBT) {
  'use strict';

  let leafSeq = 1;

  LBT.makeLeaf = function (spec) {
    return {
      id: spec.id || leafSeq++,
      x: spec.x,
      y: spec.y,
      vx: 0,
      vy: 0,
      angle: spec.phase || 0,
      angVel: 0,
      height: 0,
      vz: 0,
      wet: spec.wet ? 1 : 0,
      type: spec.type || 0,
      color: spec.color || 0,
      phase: spec.phase || 0,
      alive: true,
      collected: false,
      dying: 0,
      hold: 0,
      radius: LBT.BALANCE.leafRadius,
    };
  };

  const bucketMap = new Map();
  const bucketPool = [];

  function clearBuckets() {
    bucketMap.forEach(function (b) {
      b.length = 0;
      bucketPool.push(b);
    });
    bucketMap.clear();
  }

  function bucketFor(k) {
    let b = bucketMap.get(k);
    if (!b) {
      b = bucketPool.pop() || [];
      bucketMap.set(k, b);
    }
    return b;
  }

  LBT.separateLeaves = function (leaves, iterations) {
    const cell = 22;
    const min = LBT.BALANCE.leafRadius * 2;
    const iters = iterations || LBT.BALANCE.sepIterations;
    for (let iter = 0; iter < iters; iter++) {
      clearBuckets();
      const active = [];
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        if (!leaf.alive || leaf.collected || leaf.height > 14) continue;
        const ix = Math.floor(leaf.x / cell);
        const iy = Math.floor(leaf.y / cell);
        leaf._ix = ix;
        leaf._iy = iy;
        bucketFor(ix + iy * 4096).push(leaf);
        active.push(leaf);
      }
      for (let a = 0; a < active.length; a++) {
        const L = active[a];
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const bucket = bucketMap.get(L._ix + ox + (L._iy + oy) * 4096);
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const O = bucket[b];
              if (O.id <= L.id) continue;
              let dx = L.x - O.x;
              let dy = L.y - O.y;
              const d = Math.hypot(dx, dy);
              if (d < min && d > 0.0001) {
                const push = (min - d) * 0.5;
                dx /= d;
                dy /= d;
                L.x += dx * push;
                L.y += dy * push;
                O.x -= dx * push;
                O.y -= dy * push;
              } else if (d <= 0.0001) {
                L.x += 0.4;
              }
            }
          }
        }
      }
    }
  };

  function collect(leaf, onCollect) {
    if (leaf.collected) return;
    leaf.collected = true;
    leaf.escaped = false;
    leaf.dying = 0.24;
    leaf.vx *= 0.2;
    leaf.vy *= 0.2;
    if (onCollect) onCollect(leaf);
  }

  function vanish(leaf, onEscape) {
    if (leaf.collected) return;
    leaf.collected = true;
    leaf.escaped = true;
    leaf.dying = 0.22;
    leaf.vx *= 0.15;
    leaf.vy *= 0.15;
    if (onEscape) onEscape(leaf);
  }

  LBT.stepLeaves = function (leaves, blower, stats, level, time, dt, onCollect, onEscape) {
    const B = LBT.BALANCE;
    const ambient = LBT.ambientAt(level, time);
    const yard = level.yard;
    const zoneC = LBT.zoneCenter(level);

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!leaf.alive) continue;
      if (leaf.dying > 0) {
        leaf.dying -= dt;
        if (!leaf.escaped) {
          const k = Math.min(1, dt * 9);
          leaf.x += (zoneC.x - leaf.x) * k;
          leaf.y += (zoneC.y - leaf.y) * k;
        }
        leaf.height *= 1 - Math.min(1, dt * 6);
        if (leaf.dying <= 0) leaf.alive = false;
        continue;
      }

      const wind = LBT.sampleWind(leaf.x, leaf.y, blower, stats, level, ambient);
      const wx = wind.x;
      const wy = wind.y;
      const wsp = wind.mag;
      const vrx = wx - leaf.vx;
      const vry = wy - leaf.vy;
      const vr = Math.hypot(vrx, vry);
      const drag = leaf.wet ? B.leafDragWet : B.leafDrag;
      let ax = drag * vr * vrx;
      let ay = drag * vr * vry;

      if (wsp > 24) {
        const flutter = Math.sin(leaf.phase + time * (leaf.wet ? 5.5 : 9.5));
        const px = -wy / wsp;
        const py = wx / wsp;
        const mag = flutter * wsp * (leaf.height > 3 ? 0.15 : 0.065) * (leaf.wet ? 0.45 : 1);
        ax += px * mag;
        ay += py * mag;
      }

      if (leaf.height < 2.4) {
        const fr = leaf.wet ? B.frictionWet : B.friction;
        const sp = Math.hypot(leaf.vx, leaf.vy);
        if (sp > 2) {
          ax -= (leaf.vx / sp) * fr;
          ay -= (leaf.vy / sp) * fr;
        } else {
          leaf.vx = 0;
          leaf.vy = 0;
        }
      }

      leaf.vx += ax * dt;
      leaf.vy += ay * dt;
      if (leaf.height < 2.4 && wsp < 22) {
        const settled = Math.hypot(leaf.vx, leaf.vy);
        if (settled < 6) {
          leaf.vx = 0;
          leaf.vy = 0;
        }
      }
      const sp = Math.hypot(leaf.vx, leaf.vy);
      if (sp > B.maxLeafSpeed) {
        const s = B.maxLeafSpeed / sp;
        leaf.vx *= s;
        leaf.vy *= s;
      }
      leaf.x += leaf.vx * dt;
      leaf.y += leaf.vy * dt;

      const liftK = leaf.wet ? B.liftWet : B.lift;
      const liftAcc = Math.max(0, wsp - B.liftThreshold) * liftK;
      leaf.vz += (liftAcc - B.gravity - leaf.height * B.heightSpring) * dt;
      leaf.height += leaf.vz * dt;
      if (leaf.height < 0) {
        leaf.height = 0;
        if (leaf.vz < 0) leaf.vz = 0;
      } else if (leaf.height > 46) {
        leaf.height = 46;
        leaf.vz *= 0.4;
      }

      leaf.angVel += (Math.sin(leaf.phase + leaf.angle) * wsp * 0.55 - leaf.angVel * 2.6) * dt;
      leaf.angle += leaf.angVel * dt;

      LBT.resolveBody(leaf, leaf.radius, level.obstacles);

      const inZone = LBT.zoneContains(level, leaf.x, leaf.y);
      if (inZone && leaf.height < 40) {
        collect(leaf, onCollect);
      } else if (leaf.x < 0 || leaf.y < 0 || leaf.x > yard.w || leaf.y > yard.h) {
        vanish(leaf, onEscape);
      }

      if (!leaf.collected && stats.vacuum && blower.blowing && blower.powerMul !== 0) {
        const db = Math.hypot(leaf.x - blower.x, leaf.y - blower.y);
        if (db < B.vacuumCollectR && leaf.height < 40) collect(leaf, onCollect);
      }
    }

    LBT.separateLeaves(leaves, B.sepIterations);
  };

  function aimAtLeaf(blower, leaf, level, stats, blowing) {
    const p = LBT.closestZonePoint(level, leaf.x, leaf.y);
    let ax = p.x - leaf.x;
    let ay = p.y - leaf.y;
    const m = Math.hypot(ax, ay) || 1;
    ax /= m;
    ay /= m;
    blower.desiredAim = Math.atan2(ay, ax);
    blower.hasAim = true;
    const backOff = Math.min(62, stats.range * 0.28);
    blower.targetX = leaf.x - ax * backOff;
    blower.targetY = leaf.y - ay * backOff;
    blower.blowing = blowing;
    blower.snap = false;
  }

  LBT.steerAi = function (blower, leaves, level, stats, dt) {
    if (blower.limp || blower.charge < stats.batteryCapacity * 0.08) blower._rest = true;
    if (blower._rest) {
      blower.blowing = false;
      if (!blower.limp && blower.charge >= stats.batteryCapacity * 0.8) blower._rest = false;
      else return;
    }

    let target = null;
    let bestD = -1;
    const reach = Math.max(90, stats.range * 0.72);
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!leaf.alive || leaf.collected) continue;
      if (Math.hypot(leaf.x - blower.x, leaf.y - blower.y) > reach) continue;
      const d = LBT.distToZone(level, leaf.x, leaf.y);
      if (d > bestD) {
        bestD = d;
        target = leaf;
      }
    }
    if (target) {
      aimAtLeaf(blower, target, level, stats, true);
      return;
    }

    let far = null;
    let farD = -1;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!leaf.alive || leaf.collected) continue;
      const d = LBT.distToZone(level, leaf.x, leaf.y);
      if (d > farD) {
        farD = d;
        far = leaf;
      }
    }
    if (!far) {
      blower.blowing = false;
      return;
    }
    aimAtLeaf(blower, far, level, stats, false);
  };

  LBT.simulateLevel = function (level, stats, maxSec) {
    const leaves = level.leaves.map(function (leaf) {
      return Object.assign({}, leaf);
    });
    const spawns = level.spawns.map(function (s) {
      return Object.assign({ done: false }, s);
    });
    const blower = {
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
      blowing: false,
      snap: false,
      _lock: null,
      _lockT: 0,
    };
    let collected = 0;
    const total = leaves.length + spawns.length;
    const dt = 1 / 60;
    const maxT = maxSec || 180;
    for (let race = 0; race < maxT; race += dt) {
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[i];
        if (!s.done && race >= s.t) {
          s.done = true;
          leaves.push(LBT.makeLeaf(s));
        }
      }
      LBT.steerAi(blower, leaves, level, stats, dt);
      LBT.stepBlower(blower, stats, dt, level);
      LBT.stepLeaves(leaves, blower, stats, level, race, dt, function () {
        collected++;
      }, function () {
        collected++;
      });
      if (collected >= total) return { time: race, collected: collected, total: total };
    }
    return { time: null, collected: collected, total: total };
  };
})(window.LBT = window.LBT || {});
