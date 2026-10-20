(function (LBT) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.blowerGain = null;
    this.filter = null;
    this.osc = null;
    this.muted = false;
    this.pendingPing = 0;
    this.rustleCool = 0;
    this.tickCool = 0;
  }

  AudioEngine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    master.connect(ctx.destination);
    this.master = master;

    const seconds = 1;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const blowerGain = ctx.createGain();
    blowerGain.gain.value = 0;
    src.connect(filter);
    filter.connect(blowerGain);
    blowerGain.connect(master);
    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'bandpass';
    rustleFilter.frequency.value = 900;
    rustleFilter.Q.value = 0.45;
    const rustleGain = ctx.createGain();
    rustleGain.gain.value = 0;
    src.connect(rustleFilter);
    rustleFilter.connect(rustleGain);
    rustleGain.connect(master);
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    src.start();
    this.filter = filter;
    this.blowerGain = blowerGain;
    this.rustleGain = rustleGain;
    this.windGain = windGain;
    this.windFilter = windFilter;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 58;
    const og = ctx.createGain();
    og.gain.value = 0.35;
    osc.connect(og);
    og.connect(blowerGain);
    osc.start();
    this.osc = osc;

    this.noise = buffer;
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (!this.ctx) return;
    const g = muted ? 0 : 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  };

  AudioEngine.prototype.updateBlower = function (blowing, powerNorm, powerMul) {
    if (!this.ctx || !this.blowerGain) return;
    const now = this.ctx.currentTime;
    const mul = typeof powerMul === 'number' ? powerMul : 1;
    const vol = this.muted ? 0 : blowing ? (0.05 + powerNorm * 0.08) * (0.5 + 0.5 * mul) : 0;
    this.blowerGain.gain.setTargetAtTime(vol, now, blowing ? 0.06 : 0.09);
    const cut = blowing ? 320 + powerNorm * 900 * mul : 220;
    this.filter.frequency.setTargetAtTime(cut, now, 0.08);
    this.osc.frequency.setTargetAtTime(42 + powerNorm * 48 * mul, now, 0.08);
  };

  AudioEngine.prototype.updateWind = function (mag) {
    if (!this.ctx || !this.windGain) return;
    const speed = Math.max(0, mag || 0);
    const target = this.muted ? 0 : Math.min(0.11, speed / 2400);
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
    this.windFilter.frequency.setTargetAtTime(260 + speed * 1.6, this.ctx.currentTime, 0.3);
  };
    if (!this.ctx || !this.rustleGain) return;
    const amount = Math.max(0, moving || 0);
    const target = this.muted ? 0 : Math.min(0.05, amount * 0.0009);
    this.rustleGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.18);
  };

  AudioEngine.prototype.requestPing = function (combo) {
    if (combo > this.pendingPing) this.pendingPing = combo;
  };

  AudioEngine.prototype.flush = function () {
    if (!this.ctx || this.muted) {
      this.pendingPing = 0;
      return;
    }
    if (this.pendingPing) {
      this.ping(this.pendingPing);
      this.pendingPing = 0;
    }
  };

  function envGain(ctx, master, peak, dur) {
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    g.connect(master);
    return g;
  }

  AudioEngine.prototype.ping = function (combo) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 620 * Math.pow(1.06, Math.min(combo, 14));
    const g = envGain(ctx, this.master, 0.09, 0.14);
    o.connect(g);
    o.start();
    o.stop(ctx.currentTime + 0.15);
  };

  AudioEngine.prototype.rustle = function (amount) {
    if (!this.ctx || this.muted || !this.noise) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.6;
    const g = envGain(ctx, this.master, 0.03 + amount * 0.04, 0.09);
    src.connect(filter);
    filter.connect(g);
    src.start();
    src.stop(ctx.currentTime + 0.1);
  };

  AudioEngine.prototype.chime = function () {
    if (!this.ensure || !this.ctx) this.ensure();
    if (!this.ctx || this.muted) return;
    const notes = [523, 784];
    for (let i = 0; i < notes.length; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      const g = this.ctx.createGain();
      const t0 = this.ctx.currentTime + i * 0.07;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.24);
    }
  };

  AudioEngine.prototype.jingle = function () {
    if (!this.ctx || this.muted) return;
    const notes = [523, 659, 784, 1046];
    for (let i = 0; i < notes.length; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      const g = this.ctx.createGain();
      const t0 = this.ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.3);
    }
  };

  AudioEngine.prototype.tick = function () {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 180;
    const g = envGain(this.ctx, this.master, 0.03, 0.07);
    o.connect(g);
    o.start();
    o.stop(this.ctx.currentTime + 0.08);
  };

  AudioEngine.prototype.deny = function () {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 140;
    const g = envGain(this.ctx, this.master, 0.05, 0.12);
    o.connect(g);
    o.start();
    o.stop(this.ctx.currentTime + 0.13);
  };

  LBT.audio = new AudioEngine();
})(window.LBT = window.LBT || {});
