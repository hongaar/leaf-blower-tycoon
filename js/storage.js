(function (LBT) {
  'use strict';

  const KEY = 'lbt.save.v1';

  function migrate(raw) {
    const base = LBT.defaultSave();
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return base;
    base.coins = Math.max(0, raw.coins | 0);
    if (LBT.blowerById(raw.blowerId)) base.blowerId = raw.blowerId;
    if (raw.tiers) {
      Object.keys(base.tiers).forEach(function (k) {
        const n = raw.tiers[k] | 0;
        base.tiers[k] = Math.max(0, Math.min(LBT.BALANCE.maxTier, n));
      });
    }
    if (raw.attachments) {
      base.attachments.narrow = !!raw.attachments.narrow;
      base.attachments.wide = !!raw.attachments.wide;
      base.attachments.vacuum = !!raw.attachments.vacuum;
    }
    if (raw.nozzle === 'narrow' || raw.nozzle === 'wide' || raw.nozzle === 'stock') {
      base.nozzle = raw.nozzle;
    }
    if (base.nozzle === 'narrow' && !base.attachments.narrow) base.nozzle = 'stock';
    if (base.nozzle === 'wide' && !base.attachments.wide) base.nozzle = 'stock';
    base.vacuumOn = !!raw.vacuumOn && base.attachments.vacuum;
    base.unlockedLevel = Math.max(1, raw.unlockedLevel | 0);
    base.lastLevel = Math.max(1, raw.lastLevel | 0);
    base.muted = !!raw.muted;
    base.bestTimes = {};
    base.bestCoins = {};
    if (raw.bestCoins && typeof raw.bestCoins === 'object') {
      Object.keys(raw.bestCoins).forEach(function (k) {
        const n = Number(raw.bestCoins[k]);
        if (n >= 0 && isFinite(n)) base.bestCoins[k] = n;
      });
    }
    return base;
  }

  LBT.loadSave = function () {
    try {
      const text = localStorage.getItem(KEY);
      if (!text) return LBT.defaultSave();
      return migrate(JSON.parse(text));
    } catch (err) {
      return LBT.defaultSave();
    }
  };

  LBT.writeSave = function (save) {
    if (LBT.testing) return true;
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
      return true;
    } catch (err) {
      return false;
    }
  };

  LBT.resetSave = function () {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      /* private mode */
    }
    return LBT.defaultSave();
  };
})(window.LBT = window.LBT || {});
