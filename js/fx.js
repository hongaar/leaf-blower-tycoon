(function (LBT) {
  'use strict';

  LBT.createFx = function () {
    return {
      dust: [],
      coins: [],
      confetti: [],
      popups: [],
      shake: 0,
    };
  };

  LBT.spawnDust = function (fx, blower, stats) {
    if (!blower.blowing || fx.dust.length > 80) return;
    const count = stats.power > 800 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const a = blower.aim + (Math.random() - 0.5) * stats.halfAngle * 1.4;
      const dist = 24 + Math.random() * stats.range * (stats.vacuum ? 0.4 : 0.72);
      const speed = 30 + Math.random() * 50;
      const dir = stats.vacuum ? a + Math.PI : a;
      fx.dust.push({
        x: blower.x + Math.cos(a) * dist * (stats.vacuum ? 0.55 : 1),
        y: blower.y + Math.sin(a) * dist * (stats.vacuum ? 0.55 : 1),
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        life: 0.28 + Math.random() * 0.28,
        max: 0.5,
        s: 1.6 + Math.random() * 2.4,
      });
    }
  };

  LBT.spawnCoinFx = function (fx, leaf, amount) {
    fx.coins.push({
      x: leaf.x,
      y: leaf.y - (leaf.height || 0),
      t: 0,
      life: 0.62,
    });
    fx.popups.push({
      x: leaf.x,
      y: leaf.y - 10,
      text: '+' + amount,
      life: 0.7,
      max: 0.7,
    });
  };

  LBT.spawnConfetti = function (fx, yard) {
    const colors = ['#f0c14e', '#e07a32', '#e25b4a', '#7dce6a', '#f4efe4', '#8d6adf'];
    for (let i = 0; i < 90; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const sp = 80 + Math.random() * 220;
      fx.confetti.push({
        x: yard.w * (0.25 + Math.random() * 0.5),
        y: yard.h * 0.45,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 40,
        life: 1.4 + Math.random() * 0.8,
        max: 2,
        s: 3 + Math.random() * 4,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 8,
        color: colors[i % colors.length],
      });
    }
    fx.shake = Math.max(fx.shake, 7);
  };

  LBT.stepFx = function (fx, dt, reduced) {
    for (let i = fx.dust.length - 1; i >= 0; i--) {
      const p = fx.dust[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      if (p.life <= 0) fx.dust.splice(i, 1);
    }
    for (let i = fx.coins.length - 1; i >= 0; i--) {
      fx.coins[i].t += dt;
      if (fx.coins[i].t >= fx.coins[i].life) fx.coins.splice(i, 1);
    }
    for (let i = fx.popups.length - 1; i >= 0; i--) {
      const p = fx.popups[i];
      p.life -= dt;
      p.y -= 28 * dt;
      if (p.life <= 0) fx.popups.splice(i, 1);
    }
    for (let i = fx.confetti.length - 1; i >= 0; i--) {
      const p = fx.confetti[i];
      p.life -= dt;
      p.vy += 280 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.life <= 0) fx.confetti.splice(i, 1);
    }
    const decay = reduced ? 12 : 4.5;
    fx.shake = Math.max(0, fx.shake - decay * dt);
  };
})(window.LBT = window.LBT || {});
