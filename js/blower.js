(function (LBT) {
  'use strict';

  const _wind = { x: 0, y: 0, mag: 0 };

  function segHitsCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) {
      const ex = x1 - cx;
      const ey = y1 - cy;
      return ex * ex + ey * ey < r * r;
    }
    let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x1 + dx * t - cx;
    const py = y1 + dy * t - cy;
    return px * px + py * py < r * r;
  }

  function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    const rpx = bx - ax;
    const rpy = by - ay;
    const spx = dx - cx;
    const spy = dy - cy;
    const den = rpx * spy - rpy * spx;
    if (den * den < 1e-8) return false;
    const qpx = cx - ax;
    const qpy = cy - ay;
    const t = (qpx * spy - qpy * spx) / den;
    const u = (qpx * rpy - qpy * rpx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  function segHitsRect(x1, y1, x2, y2, r) {
    if (x1 >= r.x && x1 <= r.x + r.w && y1 >= r.y && y1 <= r.y + r.h) return true;
    if (x2 >= r.x && x2 <= r.x + r.w && y2 >= r.y && y2 <= r.y + r.h) return true;
    const x = r.x;
    const y = r.y;
    const w = r.w;
    const h = r.h;
    return segSeg(x1, y1, x2, y2, x, y, x + w, y) ||
      segSeg(x1, y1, x2, y2, x, y + h, x + w, y + h) ||
      segSeg(x1, y1, x2, y2, x, y, x, y + h) ||
      segSeg(x1, y1, x2, y2, x + w, y, x + w, y + h);
  }

  function occlusion(x1, y1, x2, y2, obstacles) {
    let pass = 1;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.type === 'fence') {
        if (segHitsRect(x1, y1, x2, y2, o)) return 0;
      } else if (o.type === 'tree') {
        if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r * 0.9)) pass = Math.min(pass, 0.05);
      } else if (o.type === 'bush') {
        if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r)) pass = Math.min(pass, 0.4);
      } else if (o.type === 'bed') {
        if (segHitsCircle(x1, y1, x2, y2, o.x, o.y, o.r * 0.75)) pass = Math.min(pass, 0.82);
      }
    }
    return pass;
  }

  LBT.sampleWind = function (x, y, blower, stats, level, ambient) {
    let wx = ambient.x;
    let wy = ambient.y;
    if (blower.blowing) {
      const dx = x - blower.x;
      const dy = y - blower.y;
      const dist = Math.hypot(dx, dy);
      const range = stats.vacuum ? stats.range * LBT.BALANCE.vacuumRange : stats.range;
      if (dist > 8 && dist < range) {
        const ang = Math.atan2(dy, dx);
        const diff = LBT.angDiff(ang, blower.aim);
        const half = stats.halfAngle;
        if (Math.abs(diff) <= half * 1.12) {
          const along = Math.pow(1 - dist / range, 1.5);
          const across = Math.exp(-0.5 * Math.pow(diff / (half * 0.9), 2));
          const block = occlusion(blower.x, blower.y, x, y, level.obstacles);
          let v = stats.power * along * across * block;
          if (stats.vacuum) v *= LBT.BALANCE.vacuumPower;
          if (typeof blower.powerMul === 'number') v *= blower.powerMul;
          if (stats.vacuum) {
            wx -= Math.cos(blower.aim) * v;
            wy -= Math.sin(blower.aim) * v;
          } else {
            wx += Math.cos(blower.aim) * v;
            wy += Math.sin(blower.aim) * v;
          }
        }
      }
    }
    _wind.x = wx;
    _wind.y = wy;
    _wind.mag = Math.hypot(wx, wy);
    return _wind;
  };

  function resolveCircle(body, radius, c) {
    let dx = body.x - c.x;
    let dy = body.y - c.y;
    let d = Math.hypot(dx, dy);
    const min = c.r + radius;
    if (d < 0.001) {
      dx = 1;
      dy = 0;
      d = 1;
    }
    if (d >= min) return;
    const nx = dx / d;
    const ny = dy / d;
    body.x += nx * (min - d);
    body.y += ny * (min - d);
    if (body.vx == null) return;
    const vn = body.vx * nx + body.vy * ny;
    if (vn < 0) {
      body.vx -= nx * vn * 1.2;
      body.vy -= ny * vn * 1.2;
    }
  }

  function resolveRect(body, radius, r) {
    const nearestX = LBT.clamp(body.x, r.x, r.x + r.w);
    const nearestY = LBT.clamp(body.y, r.y, r.y + r.h);
    let dx = body.x - nearestX;
    let dy = body.y - nearestY;
    const dsq = dx * dx + dy * dy;
    if (dsq >= radius * radius && (nearestX !== body.x || nearestY !== body.y)) return;
    if (dsq < 0.0001) {
      const penL = body.x - r.x;
      const penR = r.x + r.w - body.x;
      const penT = body.y - r.y;
      const penB = r.y + r.h - body.y;
      const m = Math.min(penL, penR, penT, penB);
      if (m === penL) body.x = r.x - radius;
      else if (m === penR) body.x = r.x + r.w + radius;
      else if (m === penT) body.y = r.y - radius;
      else body.y = r.y + r.h + radius;
      return;
    }
    const d = Math.sqrt(dsq);
    const nx = dx / d;
    const ny = dy / d;
    body.x += nx * (radius - d);
    body.y += ny * (radius - d);
    if (body.vx == null) return;
    const vn = body.vx * nx + body.vy * ny;
    if (vn < 0) {
      body.vx -= nx * vn * 1.25;
      body.vy -= ny * vn * 1.25;
    }
  }

  LBT.resolveBody = function (body, radius, obstacles) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.type === 'fence') resolveRect(body, radius, o);
      else resolveCircle(body, radius, o);
    }
  };

  LBT.stepBlower = function (blower, stats, dt, level) {
    if (!blower.snap) {
      const dx = blower.targetX - blower.x;
      const dy = blower.targetY - blower.y;
      const dist = Math.hypot(dx, dy);
      const maxStep = stats.moveSpeed * dt;
      if (dist <= maxStep || dist < 0.4) {
        blower.x = blower.targetX;
        blower.y = blower.targetY;
        blower.vx = dist > 0 ? dx / Math.max(dt, 0.0001) : 0;
        blower.vy = dist > 0 ? dy / Math.max(dt, 0.0001) : 0;
      } else {
        blower.vx = (dx / dist) * stats.moveSpeed;
        blower.vy = (dy / dist) * stats.moveSpeed;
        blower.x += blower.vx * dt;
        blower.y += blower.vy * dt;
      }
    } else {
      blower.x = blower.targetX;
      blower.y = blower.targetY;
      blower.vx = 0;
      blower.vy = 0;
    }

    const gutter = LBT.BALANCE.outside;
    blower.x = LBT.clamp(blower.x, -gutter, level.yard.w + gutter);
    blower.y = LBT.clamp(blower.y, -gutter, level.yard.h + gutter);
    blower.targetX = LBT.clamp(blower.targetX, -gutter, level.yard.w + gutter);
    blower.targetY = LBT.clamp(blower.targetY, -gutter, level.yard.h + gutter);
    if (blower.x > 8 && blower.y > 8 && blower.x < level.yard.w - 8 && blower.y < level.yard.h - 8) {
      LBT.resolveBody(blower, 16, level.obstacles);
    }

    const travel = Math.hypot(blower.vx, blower.vy);
    if (blower.followMove && !blower.aimLock && travel > 160) {
      blower.desiredAim = Math.atan2(blower.vy, blower.vx);
      blower.hasAim = true;
    }
    if (blower.hasAim) {
      const diff = LBT.angDiff(blower.desiredAim, blower.aim);
      const turn = Math.abs(diff) > 0.85 ? 1 : Math.min(1, dt * 52);
      blower.aim += diff * turn;
    }

    const B = LBT.BALANCE;
    const cap = Math.max(0.001, stats.batteryCapacity);
    if (blower.blowing && blower.charge > 0) {
      let drain = stats.drainPerSec * dt;
      if (stats.vacuum) drain *= B.vacuumDrain;
      blower.charge = Math.max(0, blower.charge - drain);
    } else if (!blower.blowing) {
      blower.charge = Math.min(cap, blower.charge + stats.rechargePerSec * dt);
    }
    const pct = blower.charge / cap;
    blower.powerMul = pct >= 0.25 ? 1 : 0.45 + 0.55 * (pct / 0.25);
    blower.limp = pct < 0.25;
  };
})(window.LBT = window.LBT || {});
