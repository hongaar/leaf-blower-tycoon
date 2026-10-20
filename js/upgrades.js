(function (LBT) {
  'use strict';

  // All tuning lives here. Physics, economy, and par times read these values.
  LBT.BALANCE = {
    leafDrag: 0.022,
    leafDragWet: 0.013,
    friction: 6,
    frictionWet: 36,
    gravity: 300,
    lift: 1.15,
    liftWet: 0.4,
    liftThreshold: 80,
    heightSpring: 8,
    leafRadius: 8,
    sepIterations: 2,
    maxLeafSpeed: 1280,
    outside: 48,
    batteryLimp: 0.32,
    batteryRecover: 0.2,
    limpRecharge: 0.4,
    vacuumDrain: 2.4,
    vacuumPower: 0.82,
    vacuumRange: 0.66,
    vacuumCollectR: 36,
    comboWindow: 0.5,
    parBonus: 0.3,
    parClose: 0.08,
    parScale: 1,
    costGrowth: 1.62,
    maxTier: 5,
  };

  LBT.BLOWERS = [
    { id: 'handfan', name: 'Hand Fan', cost: 0, power: 720, range: 270, half: 0.64, battery: 32, color: '#d7b48a', accent: '#8c6239', scale: 0.84 },
    { id: 'mini', name: 'Electric Mini', cost: 520, power: 1020, range: 330, half: 0.6, battery: 38, color: '#6eb0e8', accent: '#24527a', scale: 0.94 },
    { id: 'pro', name: 'Cordless Pro', cost: 1700, power: 1420, range: 400, half: 0.56, battery: 46, color: '#3f9a62', accent: '#1c4a30', scale: 1.04 },
    { id: 'gas', name: 'Gas Backpack', cost: 4400, power: 1980, range: 470, half: 0.54, battery: 56, color: '#e8883a', accent: '#7a3e12', scale: 1.14 },
    { id: 'turbo', name: 'Turbo Jet', cost: 10500, power: 2700, range: 540, half: 0.5, battery: 66, color: '#e25b4a', accent: '#6e2218', scale: 1.22 },
    { id: 'vortex', name: 'Industrial Vortex', cost: 25000, power: 3600, range: 620, half: 0.55, battery: 80, color: '#8d6adf', accent: '#3a2670', scale: 1.34 },
  ];

  LBT.UPGRADES = [
    { id: 'impeller', name: 'Impeller', max: 5, base: 260, blurb: 'Stronger wind', stat: 'power', per: 0.16 },
    { id: 'extension', name: 'Extension Tube', max: 5, base: 220, blurb: 'Longer reach', stat: 'range', per: 0.14 },
    { id: 'battery', name: 'Battery Pack', max: 5, base: 190, blurb: 'More blow time', stat: 'battery', per: 0.18 },
    { id: 'charger', name: 'Fast Charger', max: 5, base: 160, blurb: 'Recovers faster', stat: 'recharge', per: 0.22 },
    { id: 'wheels', name: 'Wheels', max: 5, base: 140, blurb: 'Quicker movement', stat: 'move', per: 0.2 },
    { id: 'magnet', name: 'Coin Magnet', max: 5, base: 340, blurb: 'Bonus coin chance', stat: 'magnet', per: 0.08 },
  ];

  LBT.ATTACHMENTS = [
    { id: 'narrow', name: 'Narrow Nozzle', cost: 720, blurb: '+36% power, narrower cone', gate: 1 },
    { id: 'wide', name: 'Wide Nozzle', cost: 720, blurb: 'Wider cone, -20% power', gate: 1 },
    { id: 'vacuum', name: 'Vacuum Kit', cost: 5600, blurb: 'Suck leaves in. Heavy battery drain.', gate: 7 },
  ];

  LBT.defaultSave = function () {
    return {
      v: 1,
      coins: 0,
      blowerId: 'handfan',
      tiers: { impeller: 0, extension: 0, battery: 0, charger: 0, wheels: 0, magnet: 0 },
      attachments: { narrow: false, wide: false, vacuum: false },
      nozzle: 'stock',
      vacuumOn: false,
      unlockedLevel: 1,
      bestTimes: {},
      bestCoins: {},
      muted: false,
      lastLevel: 1,
    };
  };

  LBT.blowerById = function (id) {
    for (let i = 0; i < LBT.BLOWERS.length; i++) {
      if (LBT.BLOWERS[i].id === id) return LBT.BLOWERS[i];
    }
    return LBT.BLOWERS[0];
  };

  LBT.blowerIndex = function (id) {
    for (let i = 0; i < LBT.BLOWERS.length; i++) {
      if (LBT.BLOWERS[i].id === id) return i;
    }
    return 0;
  };

  LBT.tierCost = function (upgrade, owned) {
    return Math.round(upgrade.base * Math.pow(LBT.BALANCE.costGrowth, owned));
  };

  LBT.computeStats = function (save) {
    const model = LBT.blowerById(save.blowerId);
    const t = save.tiers;
    let power = model.power * (1 + 0.16 * t.impeller);
    let range = model.range * (1 + 0.14 * t.extension);
    let half = model.half;
    const batteryCapacity = model.battery * (1 + 0.18 * t.battery);
    if (save.nozzle === 'narrow' && save.attachments.narrow) {
      power *= 1.36;
      half *= 0.6;
    } else if (save.nozzle === 'wide' && save.attachments.wide) {
      power *= 0.8;
      half *= 1.42;
    }
    half = Math.min(1.15, half);
    return {
      power: power,
      range: range,
      halfAngle: half,
      batteryCapacity: batteryCapacity,
      rechargePerSec: 1.25 * (1 + 0.22 * t.charger),
      drainPerSec: 1,
      moveSpeed: 1680 * (1 + 0.2 * t.wheels),
      magnet: Math.min(0.45, 0.08 * t.magnet),
      vacuum: !!(save.attachments.vacuum && save.vacuumOn),
      model: model,
    };
  };

  // Gear a competent player is expected to own by this level. Par uses this.
  LBT.previewStats = function (levelNum) {
    const idx = levelNum < 3 ? 0 : levelNum < 6 ? 1 : levelNum < 10 ? 2 : levelNum < 15 ? 3 : levelNum < 22 ? 4 : 5;
    const tier = Math.min(5, Math.floor((levelNum - 1) / 5));
    const fake = LBT.defaultSave();
    fake.blowerId = LBT.BLOWERS[idx].id;
    fake.tiers.impeller = tier;
    fake.tiers.extension = Math.max(0, tier - 1);
    fake.tiers.battery = tier;
    fake.tiers.charger = Math.max(0, tier - 1);
    fake.tiers.wheels = Math.min(5, Math.max(0, tier - 1));
    return LBT.computeStats(fake);
  };

  LBT.attachmentGateOpen = function (att, save) {
    return (save.unlockedLevel || 1) >= att.gate;
  };

  LBT.anythingAffordable = function (save) {
    const coins = save.coins;
    for (let i = 0; i < LBT.UPGRADES.length; i++) {
      const u = LBT.UPGRADES[i];
      const owned = save.tiers[u.id] || 0;
      if (owned < u.max && coins >= LBT.tierCost(u, owned)) return true;
    }
    const idx = LBT.blowerIndex(save.blowerId);
    if (idx < LBT.BLOWERS.length - 1) {
      const next = LBT.BLOWERS[idx + 1];
      if (coins >= next.cost) return true;
    }
    for (let j = 0; j < LBT.ATTACHMENTS.length; j++) {
      const a = LBT.ATTACHMENTS[j];
      if (!save.attachments[a.id] && LBT.attachmentGateOpen(a, save) && coins >= a.cost) return true;
    }
    return false;
  };
})(window.LBT = window.LBT || {});
