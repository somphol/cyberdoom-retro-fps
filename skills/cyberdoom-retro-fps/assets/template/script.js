/* ==========================================================================
   CYBERDOOM // RETRO 3D FIRST-PERSON SHOOTER STUDIO
   script.js — vanilla ES6 + Three.js r128
   A complete client-side FPS built for static hosting.
   ========================================================================== */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const BUILD = '2026.10.31';
  const SAVE_FORMAT = 'cyberdoom-save';
  const SAVE_SCHEMA = 1;
  const STORAGE_KEYS = {
    autosave: 'cyberdoom.autosave.v1',
    highScores: 'cyberdoom.highscores.v1',
    settings: 'cyberdoom.settings.v1'
  };

  const CELL = 2.8;
  const WALL_H = 3.7;
  const EYE_HEIGHT = 1.62;
  const PLAYER_RADIUS = 0.42;
  const GRAVITY = 19.5;
  const JUMP_SPEED = 6.4;
  const WALK_SPEED = 5.4;
  const SPRINT_SPEED = 7.4;
  const MAX_DT = 0.05;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const nowIso = () => new Date().toISOString();
  const formatNumber = (n) => Math.max(0, Math.round(n)).toString().padStart(6, '0');
  const formatTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const formatDuration = (seconds) => {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function safeGet(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (err) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function safeRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) { /* private mode */ }
  }

  function readJson(key, fallback) {
    const raw = safeGet(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function sanitiseNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
  }

  function sanitiseString(value, fallback, maxLength = 80) {
    if (typeof value !== 'string') return fallback;
    return value.replace(/[<>]/g, '').slice(0, maxLength) || fallback;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /* ============================== SETTINGS ============================== */

  const DEFAULT_SETTINGS = {
    sensitivity: 1,
    volume: 55,
    pixelScale: 0.75,
    shake: true,
    muted: false
  };

  function loadSettings() {
    const raw = readJson(STORAGE_KEYS.settings, {});
    return {
      sensitivity: sanitiseNumber(raw && raw.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.3, 2),
      volume: sanitiseNumber(raw && raw.volume, DEFAULT_SETTINGS.volume, 0, 100),
      pixelScale: sanitiseNumber(raw && raw.pixelScale, DEFAULT_SETTINGS.pixelScale, 0.5, 1),
      shake: raw && typeof raw.shake === 'boolean' ? raw.shake : DEFAULT_SETTINGS.shake,
      muted: raw && typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_SETTINGS.muted
    };
  }

  const settings = loadSettings();

  function saveSettings() {
    safeSet(STORAGE_KEYS.settings, JSON.stringify(settings));
  }

  /* ============================== AUDIO SYNTH ============================== */

  class SynthEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.ambientGain = null;
      this.ambientNodes = [];
      this.noiseBuffer = null;
      this.muted = settings.muted;
      this.volume = settings.volume;
      this.started = false;
    }

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return true;
      }
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return false;
      try {
        this.ctx = new AudioCtor();
      } catch (err) {
        return false;
      }
      this.master = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.16;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0.7;
      this.ambientGain.connect(this.master);
      this.applyVolume();
      this.buildNoise();
      this.startAmbient();
      return true;
    }

    applyVolume() {
      if (!this.ctx || !this.master) return;
      const target = this.muted ? 0 : Math.pow(this.volume / 100, 1.5) * 0.8;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.035);
    }

    setVolume(value) {
      this.volume = clamp(Number(value) || 0, 0, 100);
      settings.volume = this.volume;
      this.applyVolume();
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      settings.muted = this.muted;
      this.applyVolume();
    }

    toggleMuted() {
      this.setMuted(!this.muted);
      return this.muted;
    }

    buildNoise() {
      if (!this.ctx) return;
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, rate * 2, rate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      this.noiseBuffer = buffer;
    }

    get time() { return this.ctx ? this.ctx.currentTime : 0; }

    tone(opts = {}) {
      if (!this.ctx) return;
      const {
        freq = 440, end = freq, type = 'square', dur = 0.2, gain = 0.1,
        when = 0, filter = 0, filterEnd = filter, q = 0.8, attack = 0.006
      } = opts;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(10, freq), t0);
      if (end && end !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(10, end), t0 + dur);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = osc;
      if (filter) {
        const biquad = this.ctx.createBiquadFilter();
        biquad.type = 'lowpass';
        biquad.Q.value = q;
        biquad.frequency.setValueAtTime(Math.max(40, filter), t0);
        if (filterEnd && filterEnd !== filter) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), t0 + dur);
        node.connect(biquad);
        node = biquad;
      }
      node.connect(amp);
      amp.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    noise(opts = {}) {
      if (!this.ctx || !this.noiseBuffer) return;
      const {
        dur = 0.16, gain = 0.1, when = 0, filter = 2200, filterEnd = filter,
        type = 'lowpass', q = 0.9, rate = 1
      } = opts;
      const t0 = this.ctx.currentTime + when;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = rate;
      const biquad = this.ctx.createBiquadFilter();
      biquad.type = type;
      biquad.Q.value = q;
      biquad.frequency.setValueAtTime(Math.max(40, filter), t0);
      if (filterEnd && filterEnd !== filter) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), t0 + dur);
      const amp = this.ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(biquad);
      biquad.connect(amp);
      amp.connect(this.master);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.02);
    }

    shotPlasma() {
      this.ensure();
      this.tone({ freq: 1180, end: 180, type: 'square', dur: 0.16, gain: 0.12, filter: 2600, filterEnd: 420 });
      this.tone({ freq: 220, end: 90, type: 'sawtooth', dur: 0.13, gain: 0.06 });
      this.noise({ dur: 0.09, gain: 0.055, filter: 4200, filterEnd: 900, type: 'bandpass', q: 1.4 });
    }

    shotShotgun() {
      this.ensure();
      this.noise({ dur: 0.32, gain: 0.26, filter: 3400, filterEnd: 260, q: 0.7 });
      this.tone({ freq: 128, end: 38, type: 'sine', dur: 0.3, gain: 0.18 });
      this.tone({ freq: 460, end: 110, type: 'square', dur: 0.09, gain: 0.05 });
      this.noise({ dur: 0.07, gain: 0.08, filter: 7000, type: 'highpass', when: 0.02 });
    }

    dryFire() {
      this.ensure();
      this.tone({ freq: 170, end: 120, type: 'square', dur: 0.035, gain: 0.06 });
    }

    switchWeapon() {
      this.ensure();
      this.noise({ dur: 0.06, gain: 0.05, filter: 3400, type: 'bandpass', q: 2 });
      this.tone({ freq: 520, end: 760, type: 'square', dur: 0.05, gain: 0.035 });
    }

    enemyShot(type = 'trooper') {
      this.ensure();
      const base = type === 'heavy' ? 220 : 360;
      this.tone({ freq: base, end: base * 0.28, type: 'sawtooth', dur: 0.2, gain: 0.055, filter: 1600, filterEnd: 380 });
      this.noise({ dur: 0.1, gain: 0.04, filter: 2600, filterEnd: 600, type: 'bandpass', q: 1.2 });
    }

    growl(type = 'trooper') {
      this.ensure();
      const base = type === 'hound' ? 74 : type === 'heavy' ? 52 : 92;
      this.tone({ freq: base, end: base * 0.66, type: 'sawtooth', dur: 0.5, gain: 0.075, filter: 580, filterEnd: 180, q: 3 });
      this.tone({ freq: base * 1.5, end: base * 1.1, type: 'square', dur: 0.32, gain: 0.02, filter: 900 });
    }

    alert() {
      this.ensure();
      this.tone({ freq: 660, end: 660, type: 'square', dur: 0.07, gain: 0.04 });
      this.tone({ freq: 990, end: 990, type: 'square', dur: 0.07, gain: 0.035, when: 0.09 });
    }

    hit(headshot = false) {
      this.ensure();
      this.tone({ freq: headshot ? 1500 : 980, end: headshot ? 980 : 620, type: 'square', dur: 0.045, gain: headshot ? 0.075 : 0.045 });
      this.noise({ dur: 0.04, gain: 0.035, filter: 5000, type: 'highpass' });
    }

    hurt() {
      this.ensure();
      this.tone({ freq: 120, end: 48, type: 'sawtooth', dur: 0.22, gain: 0.11, filter: 420 });
      this.noise({ dur: 0.18, gain: 0.09, filter: 950, filterEnd: 240 });
    }

    pickup(kind = 'health') {
      this.ensure();
      const notes = kind === 'armor' ? [523, 659, 784] : kind === 'ammo' ? [440, 660, 880] : [660, 880, 1175];
      notes.forEach((freq, i) => {
        this.tone({ freq, end: freq, type: 'square', dur: 0.08, gain: 0.045, when: i * 0.055 });
      });
    }

    step() {
      this.ensure();
      this.noise({ dur: 0.07, gain: 0.025, filter: 380, filterEnd: 120 });
      this.tone({ freq: 70, end: 42, type: 'sine', dur: 0.06, gain: 0.03 });
    }

    jump() {
      this.ensure();
      this.tone({ freq: 190, end: 320, type: 'sine', dur: 0.1, gain: 0.035 });
    }

    death() {
      this.ensure();
      this.tone({ freq: 180, end: 34, type: 'sawtooth', dur: 1.2, gain: 0.12, filter: 800, filterEnd: 90 });
      this.noise({ dur: 0.8, gain: 0.08, filter: 600, filterEnd: 80 });
    }

    levelClear() {
      this.ensure();
      [392, 523, 659, 784, 1046].forEach((freq, i) => {
        this.tone({ freq, end: freq, type: 'square', dur: 0.18, gain: 0.05, when: i * 0.11 });
        this.tone({ freq: freq / 2, end: freq / 2, type: 'triangle', dur: 0.22, gain: 0.035, when: i * 0.11 });
      });
    }

    victory() {
      this.ensure();
      const seq = [392, 523, 659, 784, 1046, 1318, 1568];
      seq.forEach((freq, i) => {
        this.tone({ freq, end: freq, type: 'square', dur: 0.3, gain: 0.055, when: i * 0.14 });
        this.tone({ freq: freq * 1.5, end: freq * 1.5, type: 'sine', dur: 0.4, gain: 0.025, when: i * 0.14 });
      });
      this.noise({ dur: 1.2, gain: 0.035, filter: 6000, type: 'highpass', when: 0.2 });
    }

    portal() {
      this.ensure();
      [220, 330, 440, 660].forEach((freq, i) => {
        this.tone({ freq, end: freq * 1.4, type: 'sine', dur: 0.4, gain: 0.04, when: i * 0.08 });
      });
    }

    startAmbient() {
      if (!this.ctx || this.started) return;
      this.started = true;
      const t0 = this.ctx.currentTime;
      const droneGain = this.ctx.createGain();
      droneGain.gain.setValueAtTime(0.0001, t0);
      droneGain.gain.exponentialRampToValueAtTime(0.035, t0 + 2.5);
      droneGain.connect(this.ambientGain);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 4;
      filter.connect(droneGain);

      const oscA = this.ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 41.2;
      const oscB = this.ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.value = 55.0;
      oscB.detune.value = 7;
      const gainA = this.ctx.createGain();
      gainA.gain.value = 0.55;
      const gainB = this.ctx.createGain();
      gainB.gain.value = 0.32;
      oscA.connect(gainA); gainA.connect(filter);
      oscB.connect(gainB); gainB.connect(filter);
      oscA.start();
      oscB.start();

      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 75;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      const air = this.ctx.createBufferSource();
      air.buffer = this.noiseBuffer;
      air.loop = true;
      const airFilter = this.ctx.createBiquadFilter();
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 480;
      airFilter.Q.value = 0.8;
      const airGain = this.ctx.createGain();
      airGain.gain.value = 0.008;
      air.connect(airFilter);
      airFilter.connect(airGain);
      airGain.connect(this.ambientGain);
      air.start();

      this.ambientNodes.push(oscA, oscB, lfo, air);
      this.ambientFilter = filter;
      this.ambientDroneGain = droneGain;

      const ping = () => {
        if (!this.ctx) return;
        if (!this.muted && Math.random() < 0.55) {
          const freq = rand(480, 1400);
          this.tone({ freq, end: freq * 0.94, type: 'sine', dur: 0.9, gain: 0.008, filter: 1800 });
        }
        this.ambientTimer = window.setTimeout(ping, rand(6500, 14000));
      };
      this.ambientTimer = window.setTimeout(ping, rand(5000, 9000));
    }

    setDucked(ducked) {
      if (!this.ctx || !this.ambientGain) return;
      this.ambientGain.gain.setTargetAtTime(ducked ? 0.18 : 0.7, this.ctx.currentTime, 0.25);
    }
  }

  const audio = new SynthEngine();

  /* ============================== GAME DATA ============================== */

  const WEAPONS = {
    plasma: {
      id: 'plasma',
      name: 'PLASMA GUN',
      ammoName: 'PLASMA CELLS',
      ammoKey: 'plasma',
      maxAmmo: 240,
      damage: 27,
      cooldown: 0.155,
      pellets: 1,
      spread: 0.004,
      range: 44,
      color: 0x63ffd3,
      hudColor: '#63ffd3',
      score: 1
    },
    shotgun: {
      id: 'shotgun',
      name: 'SUPER SHOTGUN',
      ammoName: '12G SHELLS',
      ammoKey: 'shotgun',
      maxAmmo: 72,
      damage: 12,
      cooldown: 0.82,
      pellets: 9,
      spread: 0.072,
      range: 24,
      color: 0xffa83d,
      hudColor: '#ffa83d',
      score: 1
    }
  };

  const ENEMY_TYPES = {
    trooper: {
      id: 'trooper',
      name: 'CULT TROOPER',
      hp: 64,
      speed: 2.15,
      radius: 0.39,
      height: 2.25,
      width: 1.5,
      sight: 15,
      attackRange: 11,
      preferredRange: 6.2,
      damage: 9,
      cooldown: 1.55,
      projectileSpeed: 8.8,
      projectileColor: 0x6bffe0,
      score: 100,
      bob: 0.035
    },
    hound: {
      id: 'hound',
      name: 'CYBER HOUND',
      hp: 38,
      speed: 3.75,
      radius: 0.36,
      height: 1.18,
      width: 1.75,
      sight: 13,
      attackRange: 1.55,
      preferredRange: 1.1,
      damage: 14,
      cooldown: 0.95,
      projectileSpeed: 0,
      projectileColor: 0xff4455,
      score: 150,
      bob: 0.055
    },
    heavy: {
      id: 'heavy',
      name: 'SIEGE CYBORG',
      hp: 156,
      speed: 1.35,
      radius: 0.55,
      height: 2.75,
      width: 2.15,
      sight: 17,
      attackRange: 13,
      preferredRange: 8,
      damage: 12,
      cooldown: 2.15,
      projectileSpeed: 7.4,
      projectileColor: 0xffa53a,
      score: 300,
      bob: 0.025
    }
  };

  const LEVELS = [
    {
      id: 0,
      name: 'DOCKING BAY SEVEN',
      code: 'SECTOR 01',
      subtitle: 'Iron docks // machine cult vanguard',
      size: 23,
      rooms: 3,
      braid: 0.15,
      enemies: { trooper: 5, hound: 2, heavy: 0 },
      pickups: { health: 2, armor: 1, plasma: 2, shells: 2 },
      theme: {
        wall: '#243932', wallDark: '#14221d', wallLight: '#3d5a4c', trim: '#7dff5a',
        floor: '#1d2723', floorLine: '#365045', ceiling: '#101816',
        fog: 0x07100d, ambient: 0x315a47, light: 0x79ffc2, prop: '#2d443a'
      }
    },
    {
      id: 1,
      name: 'REACTOR SPINE',
      code: 'SECTOR 02',
      subtitle: 'Coolant veins // irradiated war forms',
      size: 25,
      rooms: 4,
      braid: 0.11,
      enemies: { trooper: 5, hound: 4, heavy: 1 },
      pickups: { health: 2, armor: 2, plasma: 3, shells: 2 },
      theme: {
        wall: '#352b24', wallDark: '#1c1511', wallLight: '#5b4330', trim: '#ffb52e',
        floor: '#2a241f', floorLine: '#58452f', ceiling: '#17120f',
        fog: 0x120b07, ambient: 0x69491f, light: 0xffb553, prop: '#4a3827'
      }
    },
    {
      id: 2,
      name: 'THE CYBER CORE',
      code: 'SECTOR 03',
      subtitle: 'Core chamber // final purge protocol',
      size: 27,
      rooms: 4,
      braid: 0.09,
      enemies: { trooper: 6, hound: 5, heavy: 2 },
      pickups: { health: 3, armor: 2, plasma: 3, shells: 3 },
      theme: {
        wall: '#322b3d', wallDark: '#18141f', wallLight: '#54456b', trim: '#b478ff',
        floor: '#25212d', floorLine: '#4a3b5c', ceiling: '#121018',
        fog: 0x0c0812, ambient: 0x4d3671, light: 0xc08cff, prop: '#3d2f52'
      }
    }
  ];

  const PICKUP_TYPES = {
    health: { id: 'health', label: 'MEDKIT', color: '#ff5566', amount: 25, max: 100 },
    armor: { id: 'armor', label: 'ARMOR SHARD', color: '#4ff5df', amount: 25, max: 100 },
    plasma: { id: 'plasma', label: 'PLASMA CELLS', color: '#8dff5a', amount: 35, max: 240 },
    shells: { id: 'shells', label: 'SHOTGUN SHELLS', color: '#ffb52e', amount: 9, max: 72 }
  };

  /* ============================== PROCEDURAL ART ============================== */

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  }

  function toTexture(canvas, opts = {}) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = opts.wrapS || THREE.RepeatWrapping;
    texture.wrapT = opts.wrapT || THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = opts.mipmaps === false ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = opts.mipmaps !== false;
    texture.anisotropy = 1;
    if (opts.repeat) texture.repeat.set(opts.repeat[0], opts.repeat[1]);
    if (opts.offset) texture.offset.set(opts.offset[0], opts.offset[1]);
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function shade(hex, amount) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    const r = clamp((num >> 16) + amount, 0, 255);
    const g = clamp(((num >> 8) & 255) + amount, 0, 255);
    const b = clamp((num & 255) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function withAlpha(hex, alpha) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  function speckle(ctx, w, h, count, colors, alpha = 0.25) {
    ctx.globalAlpha = alpha;
    for (let i = 0; i < count; i += 1) {
      ctx.fillStyle = pick(colors);
      const size = Math.random() < 0.86 ? 1 : 2;
      ctx.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * h), size, size);
    }
    ctx.globalAlpha = 1;
  }

  const TextureFactory = {
    wall(theme, variant = 0) {
      const { canvas, ctx } = makeCanvas(128, 128);
      px(ctx, 0, 0, 128, 128, theme.wallDark);
      const inset = 5;
      px(ctx, inset, inset, 128 - inset * 2, 128 - inset * 2, theme.wall);
      px(ctx, inset, inset, 128 - inset * 2, 3, shade(theme.wall, 24));
      px(ctx, inset, 128 - inset - 3, 128 - inset * 2, 3, shade(theme.wall, -22));
      px(ctx, inset, inset, 3, 128 - inset * 2, shade(theme.wall, 15));
      px(ctx, 128 - inset - 3, inset, 3, 128 - inset * 2, shade(theme.wall, -18));

      if (variant % 3 === 0) {
        px(ctx, 20, 26, 88, 2, shade(theme.wall, -26));
        px(ctx, 20, 29, 88, 1, shade(theme.wall, 18));
        px(ctx, 20, 96, 88, 2, shade(theme.wall, -26));
        px(ctx, 20, 93, 88, 1, shade(theme.wall, 18));
        px(ctx, 60, 20, 8, 88, shade(theme.wall, 13));
        for (let i = 0; i < 4; i += 1) {
          px(ctx, 10 + i * 2, 12 + i * 4, 2, 2, shade(theme.wall, 26));
          px(ctx, 116 - i * 2, 12 + i * 4, 2, 2, shade(theme.wall, 26));
          px(ctx, 10 + i * 2, 112 - i * 4, 2, 2, shade(theme.wall, 26));
          px(ctx, 116 - i * 2, 112 - i * 4, 2, 2, shade(theme.wall, 26));
        }
        px(ctx, 18, 107, 92, 4, theme.trim);
        px(ctx, 18, 103, 92, 2, withAlpha(theme.trim, 0.3));
      } else if (variant % 3 === 1) {
        for (let y = 20; y < 104; y += 7) {
          px(ctx, 18, y, 92, 4, shade(theme.wall, -24));
          px(ctx, 18, y + 4, 92, 1, shade(theme.wall, 12));
        }
        px(ctx, 20, 14, 4, 100, shade(theme.wall, -18));
        px(ctx, 104, 14, 4, 100, shade(theme.wall, -18));
        px(ctx, 24, 18, 3, 4, theme.trim);
        px(ctx, 101, 106, 3, 4, theme.trim);
        px(ctx, 62, 15, 18, 8, shade(theme.wall, -30));
        px(ctx, 65, 17, 12, 3, withAlpha(theme.trim, 0.7));
      } else {
        px(ctx, 16, 18, 96, 3, shade(theme.wall, -30));
        px(ctx, 16, 107, 96, 3, shade(theme.wall, -30));
        for (let i = 0; i < 5; i += 1) {
          const bx = 20 + i * 19;
          px(ctx, bx, 28, 13, 72, shade(theme.wall, -12));
          px(ctx, bx + 2, 30, 9, 68, shade(theme.wall, 8));
          px(ctx, bx + 4, 34, 5, 5, i === 2 ? theme.trim : shade(theme.wall, 30));
          px(ctx, bx + 4, 90, 5, 5, i === 2 ? theme.trim : shade(theme.wall, -30));
        }
        px(ctx, 24, 48, 80, 2, withAlpha(theme.trim, 0.55));
        px(ctx, 24, 52, 30, 2, withAlpha(theme.trim, 0.25));
      }

      // grime, scratches and rivet highlights
      speckle(ctx, 128, 128, 420, ['#000000', '#ffffff', theme.wallDark, theme.wallLight], 0.11);
      ctx.strokeStyle = withAlpha('#000000', 0.3);
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i += 1) {
        const x = rand(8, 120);
        const y = rand(8, 120);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rand(-9, 9), y + rand(4, 16));
        ctx.stroke();
      }
      return toTexture(canvas, { repeat: [1, 1], mipmaps: true });
    },

    floor(theme) {
      const { canvas, ctx } = makeCanvas(256, 256);
      px(ctx, 0, 0, 256, 256, theme.floor);
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const ox = x * 64;
          const oy = y * 64;
          px(ctx, ox + 1, oy + 1, 62, 62, shade(theme.floor, (x + y) % 2 ? 5 : -4));
          px(ctx, ox + 1, oy + 1, 62, 2, shade(theme.floor, 14));
          px(ctx, ox + 1, oy + 62, 62, 2, shade(theme.floor, -18));
          px(ctx, ox + 1, oy + 1, 2, 62, shade(theme.floor, 12));
          px(ctx, ox + 62, oy + 1, 2, 62, shade(theme.floor, -14));
        }
      }
      // grates
      for (let y = 24; y < 256; y += 64) {
        for (let x = 24; x < 256; x += 64) {
          px(ctx, x, y, 16, 16, shade(theme.floor, -24));
          for (let g = 0; g < 4; g += 1) px(ctx, x + 2 + g * 4, y + 2, 1, 12, shade(theme.floor, 18));
          px(ctx, x, y, 16, 1, shade(theme.floor, 18));
        }
      }
      // worn hazard strip
      px(ctx, 0, 118, 256, 10, withAlpha(theme.trim, 0.22));
      for (let x = -20; x < 256; x += 32) {
        ctx.fillStyle = withAlpha(theme.trim, 0.35);
        ctx.beginPath();
        ctx.moveTo(x, 118);
        ctx.lineTo(x + 10, 118);
        ctx.lineTo(x + 22, 128);
        ctx.lineTo(x + 12, 128);
        ctx.closePath();
        ctx.fill();
      }
      speckle(ctx, 256, 256, 1700, ['#000000', '#ffffff', theme.floorLine], 0.11);
      ctx.strokeStyle = withAlpha('#000000', 0.3);
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i += 1) {
        let x = rand(6, 250);
        let y = rand(6, 250);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let j = 0; j < 4; j += 1) {
          x += rand(-11, 11);
          y += rand(2, 12);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return toTexture(canvas, { repeat: [8, 8] });
    },

    ceiling(theme) {
      const { canvas, ctx } = makeCanvas(128, 128);
      px(ctx, 0, 0, 128, 128, theme.ceiling);
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 2; x += 1) {
          px(ctx, x * 64 + 2, y * 64 + 2, 60, 60, shade(theme.ceiling, (x + y) % 2 ? 5 : -3));
          px(ctx, x * 64 + 2, y * 64 + 2, 60, 2, shade(theme.ceiling, 9));
          px(ctx, x * 64 + 2, y * 64 + 60, 60, 2, shade(theme.ceiling, -15));
        }
      }
      for (let y = 8; y < 128; y += 26) {
        px(ctx, 4, y, 120, 2, withAlpha(theme.trim, 0.1));
      }
      speckle(ctx, 128, 128, 260, ['#000000', theme.floorLine], 0.12);
      return toTexture(canvas, { repeat: [5, 5] });
    },

    crate(theme) {
      const { canvas, ctx } = makeCanvas(64, 64);
      px(ctx, 0, 0, 64, 64, shade(theme.prop, -18));
      px(ctx, 2, 2, 60, 60, theme.prop);
      px(ctx, 2, 2, 60, 3, shade(theme.prop, 18));
      px(ctx, 2, 59, 60, 3, shade(theme.prop, -24));
      px(ctx, 6, 6, 52, 4, shade(theme.prop, -26));
      px(ctx, 6, 54, 52, 4, shade(theme.prop, -26));
      for (let i = 0; i < 3; i += 1) px(ctx, 8 + i * 20, 10, 4, 44, shade(theme.prop, -18));
      px(ctx, 23, 23, 18, 18, shade(theme.prop, -30));
      px(ctx, 25, 25, 14, 14, withAlpha(theme.trim, 0.35));
      px(ctx, 29, 29, 6, 6, theme.trim);
      speckle(ctx, 64, 64, 120, ['#000000', '#ffffff'], 0.18);
      return toTexture(canvas, { repeat: [1, 1] });
    },

    glow(color = '#ffffff', size = 64) {
      const { canvas, ctx } = makeCanvas(size, size);
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.16, color);
      gradient.addColorStop(0.46, withAlpha(color, 0.45));
      gradient.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, mipmaps: false });
    },

    spark() {
      const { canvas, ctx } = makeCanvas(8, 8);
      const gradient = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.35, 'rgba(255,255,220,0.9)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 8, 8);
      return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, mipmaps: false });
    },

    enemyAtlas(type) {
      const frameW = 64;
      const frameH = 96;
      const { canvas, ctx } = makeCanvas(frameW * 3, frameH);
      ctx.imageSmoothingEnabled = false;
      for (let frame = 0; frame < 3; frame += 1) {
        ctx.save();
        ctx.translate(frame * frameW, 0);
        if (type === 'hound') this.drawHound(ctx, frame);
        else if (type === 'heavy') this.drawHeavy(ctx, frame);
        else this.drawTrooper(ctx, frame);
        ctx.restore();
      }
      return toTexture(canvas, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        mipmaps: false
      });
    },

    drawTrooper(ctx, frame) {
      const walk = frame === 1 ? 1 : frame === 2 ? 0 : 0;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(32, 91, 21, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // legs
      px(ctx, 20 - walk * 2, 67, 9, 20, '#17211f');
      px(ctx, 36 + walk * 2, 67, 9, 20, '#1d2926');
      px(ctx, 18 - walk * 2, 84, 12, 5, '#0c1211');
      px(ctx, 35 + walk * 2, 84, 12, 5, '#0c1211');
      px(ctx, 21 - walk * 2, 69, 2, 13, '#3d5b50');
      px(ctx, 37 + walk * 2, 69, 2, 13, '#3d5b50');

      // torso
      px(ctx, 17, 36, 31, 34, '#101917');
      px(ctx, 19, 38, 27, 30, '#2f4740');
      px(ctx, 21, 40, 23, 8, '#48675b');
      px(ctx, 22, 49, 21, 15, '#253b35');
      px(ctx, 25, 52, 15, 3, '#15211e');
      px(ctx, 30, 42, 5, 5, '#8dff5a');
      px(ctx, 31, 43, 3, 3, '#d6ffb0');
      px(ctx, 20, 57, 4, 10, '#1a2a26');
      px(ctx, 41, 57, 4, 10, '#1a2a26');

      // shoulder pads
      px(ctx, 12, 35, 11, 11, '#172522');
      px(ctx, 13, 36, 9, 8, '#3f5f53');
      px(ctx, 42, 35, 11, 11, '#172522');
      px(ctx, 43, 36, 9, 8, '#3f5f53');
      px(ctx, 14, 38, 6, 2, '#7affc9');
      px(ctx, 45, 38, 6, 2, '#7affc9');

      // helmet
      px(ctx, 23, 17, 19, 19, '#111a18');
      px(ctx, 25, 19, 15, 15, '#3a5149');
      px(ctx, 25, 24, 15, 5, '#0a0f0e');
      px(ctx, 27, 25, 11, 3, '#ff3b50');
      px(ctx, 35, 25, 3, 3, '#ff9aa5');
      px(ctx, 27, 20, 9, 2, '#5e7a6e');
      px(ctx, 21, 27, 3, 8, '#1c2b26');
      px(ctx, 40, 27, 3, 8, '#1c2b26');
      px(ctx, 36, 12, 2, 7, '#5b7268');
      px(ctx, 37, 11, 3, 3, '#ff3b50');

      // rifle across chest
      px(ctx, 32, 56, 26, 6, '#0b1110');
      px(ctx, 36, 58, 22, 2, '#4b6258');
      px(ctx, 43, 62, 5, 7, '#141d1a');
      px(ctx, 53, 55, 8, 3, '#24332e');
      px(ctx, 58, 56, 4, 4, '#8dff5a');
      if (frame === 2) {
        px(ctx, 60, 54, 4, 7, '#eaffb0');
        px(ctx, 62, 55, 2, 5, '#ffffff');
      }

      // battle wear
      speckle(ctx, 64, 96, 70, ['#000000', '#8dff5a', '#ffffff'], 0.08);
    },

    drawHound(ctx, frame) {
      const lunge = frame === 2 ? 2 : 0;
      const step = frame === 1 ? 2 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(32, 90, 24, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // legs
      px(ctx, 13, 69 - step, 5, 20, '#24201f');
      px(ctx, 23, 69 + step, 5, 20, '#332b29');
      px(ctx, 38, 69 + step, 5, 20, '#24201f');
      px(ctx, 49, 69 - step, 5, 20, '#332b29');
      px(ctx, 11, 86 + step, 9, 4, '#100d0c');
      px(ctx, 21, 86 - step, 9, 4, '#100d0c');
      px(ctx, 36, 86 - step, 9, 4, '#100d0c');
      px(ctx, 47, 86 + step, 9, 4, '#100d0c');

      // body
      px(ctx, 10, 54, 43, 20, '#12100f');
      px(ctx, 13, 55, 37, 16, '#3c2c28');
      px(ctx, 16, 57, 31, 6, '#5b3f37');
      px(ctx, 17, 65, 29, 4, '#2a1c1a');
      px(ctx, 12, 59, 5, 9, '#241b19');
      px(ctx, 48, 57, 5, 11, '#241b19');

      // glowing spine
      for (let i = 0; i < 5; i += 1) {
        px(ctx, 17 + i * 7, 48, 3, 7, '#5c1119');
        px(ctx, 18 + i * 7, 47, 2, 4, '#ff4455');
      }

      // head
      px(ctx, 47, 51 + lunge, 13, 13, '#171110');
      px(ctx, 49, 53 + lunge, 11, 9, '#4b3630');
      px(ctx, 50, 55 + lunge, 4, 3, '#ff2138');
      px(ctx, 57, 55 + lunge, 4, 3, '#ff2138');
      px(ctx, 58, 60 + lunge, 7, 4, '#0e0b0b');
      px(ctx, 60, 61 + lunge, 2, 2, '#ffd4d8');
      px(ctx, 61, 62 + lunge, 2, 2, '#ffd4d8');
      if (frame === 2) {
        px(ctx, 63, 58 + lunge, 4, 6, '#ff5566');
        px(ctx, 65, 59 + lunge, 2, 4, '#ffffff');
      }

      // tail / antenna
      px(ctx, 7, 52, 7, 2, '#4b3630');
      px(ctx, 4, 48, 4, 6, '#ff4455');
      speckle(ctx, 64, 96, 70, ['#000000', '#ff4455', '#ffffff'], 0.08);
    },

    drawHeavy(ctx, frame) {
      const step = frame === 1 ? 2 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath();
      ctx.ellipse(32, 92, 25, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // legs
      px(ctx, 17 - step, 68, 12, 22, '#171513');
      px(ctx, 36 + step, 68, 12, 22, '#211d1a');
      px(ctx, 14 - step, 86, 16, 6, '#0b0908');
      px(ctx, 35 + step, 86, 16, 6, '#0b0908');
      px(ctx, 19 - step, 71, 3, 12, '#5a4534');
      px(ctx, 38 + step, 71, 3, 12, '#5a4534');

      // torso
      px(ctx, 12, 31, 41, 41, '#0e0c0b');
      px(ctx, 15, 33, 35, 36, '#40342a');
      px(ctx, 18, 35, 29, 7, '#6b543e');
      px(ctx, 20, 45, 25, 17, '#2c241d');
      px(ctx, 24, 49, 17, 8, '#170f0b');
      px(ctx, 29, 50, 7, 6, '#ffa53a');
      px(ctx, 30, 51, 5, 4, '#ffe1a6');
      px(ctx, 20, 65, 24, 3, '#14100d');

      // shoulders / cannons
      px(ctx, 3, 30, 13, 18, '#14100e');
      px(ctx, 4, 32, 11, 14, '#544231');
      px(ctx, 49, 30, 13, 18, '#14100e');
      px(ctx, 50, 32, 11, 14, '#544231');
      px(ctx, 6, 25, 7, 20, '#1c1713');
      px(ctx, 52, 25, 7, 20, '#1c1713');
      px(ctx, 7, 25, 5, 4, '#ffa53a');
      px(ctx, 53, 25, 5, 4, '#ffa53a');
      if (frame === 2) {
        px(ctx, 7, 19, 5, 7, '#ffe1a6');
        px(ctx, 53, 19, 5, 7, '#ffe1a6');
      }

      // head
      px(ctx, 25, 18, 15, 14, '#120e0c');
      px(ctx, 27, 20, 11, 10, '#4b392a');
      px(ctx, 27, 24, 11, 3, '#0d0908');
      px(ctx, 29, 24, 7, 2, '#ff3b50');
      px(ctx, 24, 14, 3, 7, '#67503a');
      px(ctx, 38, 14, 3, 7, '#67503a');

      // rivets
      for (let i = 0; i < 4; i += 1) {
        px(ctx, 17 + i * 8, 39, 2, 2, '#c19b68');
        px(ctx, 17 + i * 8, 60, 2, 2, '#c19b68');
      }
      speckle(ctx, 64, 96, 85, ['#000000', '#ffa53a', '#ffffff'], 0.08);
    },

    pickup(type) {
      const { canvas, ctx } = makeCanvas(64, 64);
      const config = PICKUP_TYPES[type];
      const glow = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      glow.addColorStop(0, withAlpha(config.color, 0.45));
      glow.addColorStop(1, withAlpha(config.color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 64, 64);

      ctx.fillStyle = 'rgba(3,7,5,0.92)';
      ctx.beginPath();
      ctx.ellipse(32, 58, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      if (type === 'health') {
        px(ctx, 19, 20, 26, 26, '#160b0d');
        px(ctx, 21, 22, 22, 22, '#d9e8e2');
        px(ctx, 23, 24, 18, 18, '#eef8f3');
        px(ctx, 29, 25, 6, 16, '#ff3b50');
        px(ctx, 24, 30, 16, 6, '#ff3b50');
        px(ctx, 22, 19, 20, 2, '#ff8a97');
        px(ctx, 18, 17, 4, 4, '#ff3b50');
        px(ctx, 42, 17, 4, 4, '#ff3b50');
      } else if (type === 'armor') {
        ctx.fillStyle = '#0a1a18';
        ctx.beginPath();
        ctx.moveTo(32, 14);
        ctx.lineTo(49, 23);
        ctx.lineTo(46, 43);
        ctx.lineTo(32, 52);
        ctx.lineTo(18, 43);
        ctx.lineTo(15, 23);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2c8177';
        ctx.beginPath();
        ctx.moveTo(32, 18);
        ctx.lineTo(45, 25);
        ctx.lineTo(43, 41);
        ctx.lineTo(32, 48);
        ctx.lineTo(21, 41);
        ctx.lineTo(19, 25);
        ctx.closePath();
        ctx.fill();
        px(ctx, 29, 22, 6, 23, '#9cfff2');
        px(ctx, 22, 29, 20, 6, '#9cfff2');
        px(ctx, 30, 23, 4, 21, '#eafffc');
      } else if (type === 'plasma') {
        px(ctx, 22, 17, 20, 33, '#0a1108');
        px(ctx, 24, 19, 16, 29, '#3d5c33');
        px(ctx, 26, 21, 12, 25, '#6cffce');
        px(ctx, 28, 23, 8, 7, '#eafff6');
        px(ctx, 27, 33, 10, 2, '#14231b');
        px(ctx, 27, 38, 10, 2, '#14231b');
        px(ctx, 30, 13, 4, 5, '#8dff5a');
        px(ctx, 29, 45, 6, 4, '#8dff5a');
      } else {
        for (let i = 0; i < 3; i += 1) {
          const x = 23 + i * 7;
          px(ctx, x, 22, 5, 24, '#4a1812');
          px(ctx, x + 1, 20, 3, 22, '#c33a2c');
          px(ctx, x + 1, 20, 3, 5, '#ffb52e');
          px(ctx, x, 42, 5, 5, '#f0c46a');
        }
        px(ctx, 19, 47, 28, 5, '#1b1209');
        px(ctx, 20, 47, 26, 2, '#8c6a35');
      }
      speckle(ctx, 64, 64, 50, ['#ffffff', '#000000'], 0.08);
      return toTexture(canvas, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        mipmaps: false
      });
    },

    sign(text, color) {
      const { canvas, ctx } = makeCanvas(256, 64);
      ctx.clearRect(0, 0, 256, 64);
      px(ctx, 0, 0, 256, 64, 'rgba(3,8,6,0.86)');
      px(ctx, 3, 3, 250, 58, 'rgba(0,0,0,0.4)');
      ctx.strokeStyle = withAlpha(color, 0.55);
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, 248, 56);
      px(ctx, 4, 4, 34, 4, color);
      px(ctx, 218, 56, 34, 4, color);
      ctx.fillStyle = color;
      ctx.font = 'bold 21px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 35);
      ctx.globalAlpha = 0.25;
      for (let y = 0; y < 64; y += 4) ctx.fillRect(0, y, 256, 1);
      ctx.globalAlpha = 1;
      return toTexture(canvas, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        mipmaps: false
      });
    },

    portalLabel(text, color) {
      const { canvas, ctx } = makeCanvas(320, 72);
      ctx.clearRect(0, 0, 320, 72);
      ctx.fillStyle = 'rgba(2,6,4,0.72)';
      ctx.fillRect(10, 8, 300, 56);
      ctx.strokeStyle = withAlpha(color, 0.7);
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 8, 300, 56);
      ctx.fillStyle = color;
      ctx.font = 'bold 22px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 160, 37);
      ctx.globalAlpha = 0.3;
      for (let y = 0; y < 72; y += 4) ctx.fillRect(10, y, 300, 1);
      ctx.globalAlpha = 1;
      return toTexture(canvas, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        mipmaps: false
      });
    }
  };

  /* ============================== PARTICLES / TRACERS ============================== */

  class ParticleField {
    constructor(scene, capacity = 280) {
      this.capacity = capacity;
      this.particles = [];
      this.cursor = 0;
      const positions = new Float32Array(capacity * 3);
      const colors = new Float32Array(capacity * 3);
      for (let i = 0; i < capacity; i += 1) {
        positions[i * 3 + 1] = -999;
        this.particles.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, gravity: 1, drag: 0.96 });
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.geometry = geometry;
      this.material = new THREE.PointsMaterial({
        size: 0.12,
        map: TextureFactory.spark(),
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      });
      this.points = new THREE.Points(geometry, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = 5;
      scene.add(this.points);
      this.scene = scene;
      this.baseColor = new THREE.Color();
    }

    spawnBurst(origin, color, count = 10, speed = 4, opts = {}) {
      const c = new THREE.Color(color);
      const spread = opts.spread || 1;
      for (let n = 0; n < count; n += 1) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.capacity;
        const p = this.particles[i];
        p.alive = true;
        p.pos.copy(origin);
        p.vel.set(rand(-1, 1) * spread, rand(-0.45, 1) * spread, rand(-1, 1) * spread).normalize().multiplyScalar(rand(speed * 0.35, speed));
        p.life = rand(0.18, 0.55);
        p.maxLife = p.life;
        p.gravity = opts.gravity === undefined ? 1 : opts.gravity;
        p.drag = opts.drag || 0.94;
        const posAttr = this.geometry.attributes.position;
        const colAttr = this.geometry.attributes.color;
        posAttr.array[i * 3] = p.pos.x;
        posAttr.array[i * 3 + 1] = p.pos.y;
        posAttr.array[i * 3 + 2] = p.pos.z;
        colAttr.array[i * 3] = c.r;
        colAttr.array[i * 3 + 1] = c.g;
        colAttr.array[i * 3 + 2] = c.b;
      }
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
    }

    update(dt) {
      const posAttr = this.geometry.attributes.position;
      let changed = false;
      for (let i = 0; i < this.capacity; i += 1) {
        const p = this.particles[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          posAttr.array[i * 3 + 1] = -999;
          changed = true;
          continue;
        }
        p.vel.y -= 9.5 * p.gravity * dt;
        p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
        p.pos.addScaledVector(p.vel, dt);
        posAttr.array[i * 3] = p.pos.x;
        posAttr.array[i * 3 + 1] = p.pos.y;
        posAttr.array[i * 3 + 2] = p.pos.z;
        changed = true;
      }
      if (changed) posAttr.needsUpdate = true;
    }

    dispose() {
      this.scene.remove(this.points);
      this.geometry.dispose();
      this.material.map.dispose();
      this.material.dispose();
    }
  }

  class TracerPool {
    constructor(scene, count = 20) {
      this.items = [];
      this.scene = scene;
      for (let i = 0; i < count; i += 1) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const material = new THREE.LineBasicMaterial({
          color: 0x8dff5a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const line = new THREE.Line(geometry, material);
        line.visible = false;
        line.frustumCulled = false;
        line.renderOrder = 4;
        scene.add(line);
        this.items.push({ line, life: 0, maxLife: 0.07 });
      }
      this.cursor = 0;
    }

    fire(origin, end, color = 0x8dff5a, life = 0.075) {
      const item = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.items.length;
      const pos = item.line.geometry.attributes.position;
      pos.array[0] = origin.x; pos.array[1] = origin.y; pos.array[2] = origin.z;
      pos.array[3] = end.x; pos.array[4] = end.y; pos.array[5] = end.z;
      pos.needsUpdate = true;
      item.line.material.color.setHex(color);
      item.line.material.opacity = 0.9;
      item.line.visible = true;
      item.life = life;
      item.maxLife = life;
    }

    update(dt) {
      for (const item of this.items) {
        if (!item.line.visible) continue;
        item.life -= dt;
        if (item.life <= 0) {
          item.line.visible = false;
          item.line.material.opacity = 0;
        } else {
          item.line.material.opacity = 0.9 * (item.life / item.maxLife);
        }
      }
    }

    dispose() {
      for (const item of this.items) {
        this.scene.remove(item.line);
        item.line.geometry.dispose();
        item.line.material.dispose();
      }
    }
  }

  /* ============================== LEVEL GENERATION ============================== */

  class DungeonLevel {
    constructor(index, seed) {
      this.index = index;
      this.config = LEVELS[index];
      this.theme = this.config.theme;
      this.size = this.config.size;
      this.seed = seed >>> 0;
      this.rng = mulberry32(this.seed);
      this.half = (this.size * CELL) / 2;
      this.grid = [];
      this.rooms = [];
      this.openCells = [];
      this.obstacles = [];
      this.wallMeshes = [];
      this.signMeshes = [];
      this.disposables = new Set();
      this.lightPanels = [];
      this.lights = [];
      this.portal = null;
      this.exitUnlocked = false;
      this.generate();
    }

    random() { return this.rng(); }

    generate() {
      const n = this.size;
      this.grid = Array.from({ length: n }, () => Array(n).fill(1));
      this.carveMaze(1, 1);
      this.carveRooms();
      this.braidMaze();
      this.sealBorder();
      this.chooseStartAndExit();
      this.computeDistances();
      this.collectOpenCells();
    }

    carveMaze(startX, startZ) {
      const stack = [{ x: startX, z: startZ }];
      this.grid[startZ][startX] = 0;
      const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      while (stack.length) {
        const current = stack[stack.length - 1];
        const options = [];
        for (const [dx, dz] of dirs) {
          const nx = current.x + dx;
          const nz = current.z + dz;
          if (nx > 0 && nz > 0 && nx < this.size - 1 && nz < this.size - 1 && this.grid[nz][nx] === 1) {
            options.push({ nx, nz, wx: current.x + dx / 2, wz: current.z + dz / 2 });
          }
        }
        if (!options.length) {
          stack.pop();
          continue;
        }
        const next = options[Math.floor(this.random() * options.length)];
        this.grid[next.wz][next.wx] = 0;
        this.grid[next.nz][next.nx] = 0;
        stack.push({ x: next.nx, z: next.nz });
      }
    }

    carveRooms() {
      const count = this.config.rooms;
      const attempts = count * 18;
      let made = 0;
      for (let attempt = 0; attempt < attempts && made < count; attempt += 1) {
        const w = 3 + Math.floor(this.random() * 3) * 2;
        const h = 3 + Math.floor(this.random() * 3) * 2;
        const x = 1 + Math.floor(this.random() * ((this.size - w - 2) / 2)) * 2;
        const z = 1 + Math.floor(this.random() * ((this.size - h - 2) / 2)) * 2;
        if (x + w >= this.size - 1 || z + h >= this.size - 1) continue;
        let overlap = false;
        for (const room of this.rooms) {
          if (x < room.x + room.w + 1 && x + w + 1 > room.x && z < room.z + room.h + 1 && z + h + 1 > room.z) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;
        for (let rz = z; rz < z + h; rz += 1) {
          for (let rx = x; rx < x + w; rx += 1) this.grid[rz][rx] = 0;
        }
        this.rooms.push({ x, z, w, h, cx: Math.floor(x + w / 2), cz: Math.floor(z + h / 2) });
        made += 1;
      }
    }

    braidMaze() {
      const chance = this.config.braid;
      for (let z = 1; z < this.size - 1; z += 1) {
        for (let x = 1; x < this.size - 1; x += 1) {
          if (this.grid[z][x] !== 1) continue;
          const left = this.grid[z][x - 1] === 0;
          const right = this.grid[z][x + 1] === 0;
          const up = this.grid[z - 1][x] === 0;
          const down = this.grid[z + 1][x] === 0;
          const horizontal = left && right && !up && !down;
          const vertical = up && down && !left && !right;
          if ((horizontal || vertical) && this.random() < chance) this.grid[z][x] = 0;
        }
      }
    }

    sealBorder() {
      const n = this.size;
      for (let i = 0; i < n; i += 1) {
        this.grid[0][i] = 1;
        this.grid[n - 1][i] = 1;
        this.grid[i][0] = 1;
        this.grid[i][n - 1] = 1;
      }
    }

    chooseStartAndExit() {
      const rooms = this.rooms.slice().sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz));
      if (rooms.length) {
        const startRoom = rooms[0];
        this.start = { gx: startRoom.cx, gz: startRoom.cz };
      } else {
        const cell = this.findFirstOpen();
        this.start = { gx: cell.gx, gz: cell.gz };
      }
      this.grid[this.start.gz][this.start.gx] = 0;
      this.computeDistances();
      let best = null;
      for (const room of this.rooms) {
        if (room.cx === this.start.gx && room.cz === this.start.gz) continue;
        const dist = this.distanceMap[room.cz] ? this.distanceMap[room.cz][room.cx] : -1;
        if (dist > 0 && (!best || dist > best.dist)) best = { room, dist };
      }
      if (best) {
        this.exit = { gx: best.room.cx, gz: best.room.cz };
      } else {
        let max = -1;
        for (let z = 1; z < this.size - 1; z += 1) {
          for (let x = 1; x < this.size - 1; x += 1) {
            if (this.grid[z][x] === 0 && this.distanceMap[z][x] > max) {
              max = this.distanceMap[z][x];
              this.exit = { gx: x, gz: z };
            }
          }
        }
      }
      if (!this.exit) this.exit = { gx: this.start.gx, gz: this.start.gz };
      // guarantee breathing room around the exit portal
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = this.exit.gx + dx;
          const z = this.exit.gz + dz;
          if (x > 0 && z > 0 && x < this.size - 1 && z < this.size - 1) this.grid[z][x] = 0;
        }
      }
      this.computeDistances();
    }

    findFirstOpen() {
      for (let z = 1; z < this.size - 1; z += 1) {
        for (let x = 1; x < this.size - 1; x += 1) {
          if (this.grid[z][x] === 0) return { gx: x, gz: z };
        }
      }
      return { gx: 1, gz: 1 };
    }

    computeDistances() {
      const n = this.size;
      const dist = Array.from({ length: n }, () => Array(n).fill(-1));
      if (!this.start) return;
      const queue = [{ x: this.start.gx, z: this.start.gz }];
      dist[this.start.gz][this.start.gx] = 0;
      let head = 0;
      while (head < queue.length) {
        const { x, z } = queue[head++];
        const d = dist[z][x] + 1;
        const neighbours = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
        for (const [nx, nz] of neighbours) {
          if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1) continue;
          if (this.grid[nz][nx] !== 0 || dist[nz][nx] !== -1) continue;
          dist[nz][nx] = d;
          queue.push({ x: nx, z: nz });
        }
      }
      this.distanceMap = dist;
    }

    collectOpenCells() {
      this.openCells = [];
      for (let z = 1; z < this.size - 1; z += 1) {
        for (let x = 1; x < this.size - 1; x += 1) {
          if (this.grid[z][x] === 0 && this.distanceMap[z][x] >= 0) {
            const w = this.world(x, z);
            this.openCells.push({ gx: x, gz: z, x: w.x, z: w.z, dist: this.distanceMap[z][x] });
          }
        }
      }
    }

    get startWorld() { return this.world(this.start.gx, this.start.gz); }
    get exitWorld() { return this.world(this.exit.gx, this.exit.gz); }

    world(gx, gz) {
      return {
        x: (gx + 0.5) * CELL - this.half,
        z: (gz + 0.5) * CELL - this.half
      };
    }

    cellAt(x, z) {
      return {
        gx: Math.floor((x + this.half) / CELL),
        gz: Math.floor((z + this.half) / CELL)
      };
    }

    isWall(gx, gz) {
      if (gx < 0 || gz < 0 || gx >= this.size || gz >= this.size) return true;
      return this.grid[gz][gx] !== 0;
    }

    isWallAt(x, z) {
      const cell = this.cellAt(x, z);
      return this.isWall(cell.gx, cell.gz);
    }

    collides(x, z, radius = PLAYER_RADIUS) {
      if (x < -this.half + 0.1 || z < -this.half + 0.1 || x > this.half - 0.1 || z > this.half - 0.1) return true;
      const minX = Math.floor((x - radius + this.half) / CELL);
      const maxX = Math.floor((x + radius + this.half) / CELL);
      const minZ = Math.floor((z - radius + this.half) / CELL);
      const maxZ = Math.floor((z + radius + this.half) / CELL);
      for (let gz = minZ; gz <= maxZ; gz += 1) {
        for (let gx = minX; gx <= maxX; gx += 1) {
          if (!this.isWall(gx, gz)) continue;
          const cx = (gx + 0.5) * CELL - this.half;
          const cz = (gz + 0.5) * CELL - this.half;
          const closestX = clamp(x, cx - CELL / 2, cx + CELL / 2);
          const closestZ = clamp(z, cz - CELL / 2, cz + CELL / 2);
          const dx = x - closestX;
          const dz = z - closestZ;
          if (dx * dx + dz * dz < radius * radius) return true;
        }
      }
      for (const obstacle of this.obstacles) {
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        const rr = radius + obstacle.radius;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
      return false;
    }

    moveEntity(position, dx, dz, radius = PLAYER_RADIUS) {
      let movedX = 0;
      let movedZ = 0;
      if (!this.collides(position.x + dx, position.z + dz, radius)) {
        position.x += dx;
        position.z += dz;
        movedX = dx;
        movedZ = dz;
      } else {
        if (Math.abs(dx) > 0.00001 && !this.collides(position.x + dx, position.z, radius)) {
          position.x += dx;
          movedX = dx;
        }
        if (Math.abs(dz) > 0.00001 && !this.collides(position.x, position.z + dz, radius)) {
          position.z += dz;
          movedZ = dz;
        }
      }
      return { x: movedX, z: movedZ };
    }

    hasLineOfSight(x1, z1, x2, z2) {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.2) return true;
      const steps = Math.ceil(distance / 0.22);
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        if (this.isWallAt(x1 + dx * t, z1 + dz * t)) return false;
      }
      return true;
    }

    findPath(fromX, fromZ, toX, toZ) {
      const n = this.size;
      const start = this.cellAt(fromX, fromZ);
      const goal = this.cellAt(toX, toZ);
      if (this.isWall(start.gx, start.gz) || this.isWall(goal.gx, goal.gz)) return [];
      if (start.gx === goal.gx && start.gz === goal.gz) return [];
      const count = n * n;
      const open = [];
      const gScore = new Float32Array(count).fill(Infinity);
      const fScore = new Float32Array(count).fill(Infinity);
      const came = new Int32Array(count).fill(-1);
      const closed = new Uint8Array(count);
      const idx = (x, z) => z * n + x;
      const h = (x, z) => Math.abs(x - goal.gx) + Math.abs(z - goal.gz);
      const startIdx = idx(start.gx, start.gz);
      const goalIdx = idx(goal.gx, goal.gz);
      gScore[startIdx] = 0;
      fScore[startIdx] = h(start.gx, start.gz);
      open.push({ x: start.gx, z: start.gz, f: fScore[startIdx] });
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let guard = 0;
      while (open.length && guard < 2500) {
        guard += 1;
        let bestIndex = 0;
        for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
        const current = open.splice(bestIndex, 1)[0];
        const cIdx = idx(current.x, current.z);
        if (cIdx === goalIdx) {
          const path = [];
          let cursor = cIdx;
          while (cursor !== startIdx && cursor !== -1) {
            const cx = cursor % n;
            const cz = Math.floor(cursor / n);
            const world = this.world(cx, cz);
            path.push({ x: world.x, z: world.z, gx: cx, gz: cz });
            cursor = came[cursor];
          }
          path.reverse();
          return path;
        }
        closed[cIdx] = 1;
        for (const [dx, dz] of dirs) {
          const nx = current.x + dx;
          const nz = current.z + dz;
          if (this.isWall(nx, nz)) continue;
          const ni = idx(nx, nz);
          if (closed[ni]) continue;
          const tentative = gScore[cIdx] + 1;
          if (tentative >= gScore[ni]) continue;
          came[ni] = cIdx;
          gScore[ni] = tentative;
          fScore[ni] = tentative + h(nx, nz);
          const existing = open.find((node) => node.x === nx && node.z === nz);
          if (existing) existing.f = fScore[ni];
          else open.push({ x: nx, z: nz, f: fScore[ni] });
        }
      }
      return [];
    }

    randomOpenCells(minDistance = 0, maxDistance = Infinity) {
      return this.openCells.filter((cell) => cell.dist >= minDistance && cell.dist <= maxDistance);
    }

    pickSpawnCells(count, minDistance, occupied = new Set(), spacing = 2) {
      const candidates = this.randomOpenCells(minDistance);
      for (let i = candidates.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const chosen = [];
      for (const cell of candidates) {
        if (chosen.length >= count) break;
        if (cell.gx === this.exit.gx && cell.gz === this.exit.gz) continue;
        const key = `${cell.gx},${cell.gz}`;
        if (occupied.has(key)) continue;
        let crowded = false;
        if (spacing > 0) {
          for (const other of chosen) {
            if (Math.abs(other.gx - cell.gx) + Math.abs(other.gz - cell.gz) < spacing) {
              crowded = true;
              break;
            }
          }
        }
        if (crowded) continue;
        chosen.push(cell);
        occupied.add(key);
      }
      return chosen;
    }

    build(scene) {
      this.group = new THREE.Group();
      this.group.name = `sector-${this.index + 1}`;
      scene.add(this.group);

      const theme = this.theme;
      const wallTextures = [0, 1, 2].map((variant) => TextureFactory.wall(theme, variant));
      const wallMaterials = wallTextures.map((texture) => {
        const material = new THREE.MeshLambertMaterial({
          map: texture,
          color: 0xffffff
        });
        this.disposables.add(texture);
        this.disposables.add(material);
        return material;
      });

      const floorTexture = TextureFactory.floor(theme);
      const floorMaterial = new THREE.MeshLambertMaterial({ map: floorTexture });
      const floorGeometry = new THREE.PlaneGeometry(this.size * CELL, this.size * CELL);
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = false;
      this.group.add(floor);
      this.disposables.add(floorTexture);
      this.disposables.add(floorMaterial);
      this.disposables.add(floorGeometry);

      const ceilTexture = TextureFactory.ceiling(theme);
      const ceilMaterial = new THREE.MeshLambertMaterial({ map: ceilTexture });
      const ceilGeometry = new THREE.PlaneGeometry(this.size * CELL, this.size * CELL);
      const ceiling = new THREE.Mesh(ceilGeometry, ceilMaterial);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = WALL_H;
      this.group.add(ceiling);
      this.disposables.add(ceilTexture);
      this.disposables.add(ceilMaterial);
      this.disposables.add(ceilGeometry);

      const wallGeometry = new THREE.BoxGeometry(CELL, WALL_H, CELL);
      const wallGroup = new THREE.Group();
      for (let gz = 0; gz < this.size; gz += 1) {
        for (let gx = 0; gx < this.size; gx += 1) {
          if (this.grid[gz][gx] !== 1) continue;
          const material = wallMaterials[(gx * 7 + gz * 13 + this.index) % 3];
          const wall = new THREE.Mesh(wallGeometry, material);
          const world = this.world(gx, gz);
          wall.position.set(world.x, WALL_H / 2, world.z);
          wall.updateMatrix();
          wall.matrixAutoUpdate = false;
          wallGroup.add(wall);
          this.wallMeshes.push(wall);
        }
      }
      this.group.add(wallGroup);
      this.disposables.add(wallGeometry);

      this.addCeilingLights();
      this.addSigns();
      this.addProps();
      this.addExitPortal();

      return this.group;
    }

    addCeilingLights() {
      const candidates = this.openCells.filter((cell) => (cell.gx + cell.gz) % 4 === 0);
      const chosen = [];
      for (const cell of candidates) {
        if (chosen.length >= 9) break;
        let close = false;
        for (const other of chosen) {
          if (Math.hypot(other.gx - cell.gx, other.gz - cell.gz) < 2.4) { close = true; break; }
        }
        if (close) continue;
        chosen.push(cell);
      }
      const panelGeo = new THREE.BoxGeometry(1.15, 0.055, 0.38);
      const panelMat = new THREE.MeshBasicMaterial({ color: this.theme.light });
      this.disposables.add(panelGeo);
      this.disposables.add(panelMat);
      for (const cell of chosen) {
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(cell.x, WALL_H - 0.04, cell.z);
        this.group.add(panel);
        this.lightPanels.push(panel);
        const light = new THREE.PointLight(this.theme.light, 0.72, 10.5, 2);
        light.position.set(cell.x, WALL_H - 0.38, cell.z);
        this.group.add(light);
        this.lights.push(light);
      }
    }

    addSigns() {
      const signTexts = this.index === 0
        ? ['SECTOR 01 // DOCK 7', 'NO ORGANIC ENTRY', 'SECURITY GRID LIVE', 'REACTOR ACCESS']
        : this.index === 1
          ? ['REACTOR SPINE', 'COOLANT PRESSURE HIGH', 'RADIATION ZONE', 'AUTHORISED UNITS ONLY']
          : ['CYBER CORE', 'PURGE PROTOCOL ARMED', 'NO RETREAT', 'CORE BREACH'];
      const signs = [];
      for (let gz = 1; gz < this.size - 1 && signs.length < signTexts.length * 2; gz += 1) {
        for (let gx = 1; gx < this.size - 1 && signs.length < signTexts.length * 2; gx += 1) {
          if (this.grid[gz][gx] !== 1) continue;
          const dirs = [[1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, 1, 0], [0, -1, Math.PI]];
          for (const [dx, dz, rot] of dirs) {
            const nx = gx + dx;
            const nz = gz + dz;
            if (nx <= 0 || nz <= 0 || nx >= this.size - 1 || nz >= this.size - 1) continue;
            if (this.grid[nz][nx] !== 0) continue;
            if ((gx * 5 + gz * 3 + this.index) % 7 !== 0) continue;
            const world = this.world(gx, gz);
            const texture = TextureFactory.sign(signTexts[signs.length % signTexts.length], this.theme.trim);
            const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide, depthWrite: false, opacity: 0.92 });
            const geometry = new THREE.PlaneGeometry(1.9, 0.48);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
              world.x + dx * (CELL / 2 + 0.012),
              2.47,
              world.z + dz * (CELL / 2 + 0.012)
            );
            mesh.rotation.y = rot;
            this.group.add(mesh);
            this.signMeshes.push(mesh);
            this.disposables.add(texture);
            this.disposables.add(material);
            this.disposables.add(geometry);
            signs.push(mesh);
            break;
          }
        }
      }
    }

    addProps() {
      const reserved = new Set([
        `${this.exit.gx},${this.exit.gz}`,
        `${this.start.gx},${this.start.gz}`
      ]);
      const roomCells = [];
      for (const room of this.rooms) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const gx = room.cx + dx;
            const gz = room.cz + dz;
            if (this.isWall(gx, gz)) continue;
            if (gx === this.exit.gx && gz === this.exit.gz) continue;
            if (gx === this.start.gx && gz === this.start.gz) continue;
            if (reserved.has(`${gx},${gz}`)) continue;
            roomCells.push({ gx, gz });
          }
        }
      }
      const chosen = [];
      const shuffled = roomCells.slice().sort(() => this.random() - 0.5);
      for (const cell of shuffled) {
        if (chosen.length >= 7) break;
        if (chosen.some((c) => c.gx === cell.gx && c.gz === cell.gz)) continue;
        chosen.push(cell);
      }
      const crateTexture = TextureFactory.crate(this.theme);
      const crateMaterial = new THREE.MeshStandardMaterial({ map: crateTexture, roughness: 0.9, metalness: 0.08 });
      this.disposables.add(crateTexture);
      this.disposables.add(crateMaterial);
      const metalMaterial = new THREE.MeshStandardMaterial({ color: this.theme.prop, roughness: 0.55, metalness: 0.62 });
      this.disposables.add(metalMaterial);
      const trimMaterial = new THREE.MeshBasicMaterial({ color: this.theme.trim });
      this.disposables.add(trimMaterial);

      chosen.forEach((cell, i) => {
        const world = this.world(cell.gx, cell.gz);
        const offset = { x: rand(-0.35, 0.35), z: rand(-0.35, 0.35) };
        const kind = (i + this.index) % 3;
        const group = new THREE.Group();
        group.position.set(world.x + offset.x, 0, world.z + offset.z);
        if (kind === 0) {
          const geo = new THREE.BoxGeometry(0.78, 0.78, 0.78);
          const crate = new THREE.Mesh(geo, crateMaterial);
          crate.position.y = 0.39;
          crate.rotation.y = rand(-0.3, 0.3);
          group.add(crate);
          this.disposables.add(geo);
          this.obstacles.push({ x: group.position.x, z: group.position.z, radius: 0.46 });
        } else if (kind === 1) {
          const geo = new THREE.CylinderGeometry(0.31, 0.34, 0.98, 10);
          const barrel = new THREE.Mesh(geo, metalMaterial);
          barrel.position.y = 0.49;
          group.add(barrel);
          const ringGeo = new THREE.TorusGeometry(0.325, 0.025, 6, 14);
          const ring = new THREE.Mesh(ringGeo, trimMaterial);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.72;
          group.add(ring);
          this.disposables.add(geo);
          this.disposables.add(ringGeo);
          this.obstacles.push({ x: group.position.x, z: group.position.z, radius: 0.4 });
        } else {
          const geo = new THREE.BoxGeometry(0.52, 2.35, 0.52);
          const pillar = new THREE.Mesh(geo, metalMaterial);
          pillar.position.y = 1.175;
          group.add(pillar);
          const slotGeo = new THREE.BoxGeometry(0.54, 0.09, 0.54);
          const slot = new THREE.Mesh(slotGeo, trimMaterial);
          slot.position.y = 1.6;
          group.add(slot);
          this.disposables.add(geo);
          this.disposables.add(slotGeo);
          this.obstacles.push({ x: group.position.x, z: group.position.z, radius: 0.42 });
        }
        this.group.add(group);
      });
    }

    addExitPortal() {
      const pos = this.exitWorld;
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);

      const ringGeo = new THREE.TorusGeometry(0.98, 0.09, 8, 26);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3b50 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 1.35;
      group.add(ring);

      const ring2Geo = new THREE.TorusGeometry(1.16, 0.025, 6, 26);
      const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xff3b50, transparent: true, opacity: 0.5 });
      const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
      ring2.position.y = 1.35;
      group.add(ring2);

      const swirl = this.makePortalTexture('#ff3b50', '#ff9a4d');
      const innerMat = new THREE.MeshBasicMaterial({
        map: swirl,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const innerGeo = new THREE.PlaneGeometry(1.72, 2.3);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.y = 1.35;
      group.add(inner);

      const pylonGeo = new THREE.BoxGeometry(0.16, 2.75, 0.16);
      const pylonMat = new THREE.MeshStandardMaterial({ color: 0x1b2622, roughness: 0.55, metalness: 0.6 });
      const pylonL = new THREE.Mesh(pylonGeo, pylonMat);
      pylonL.position.set(-1.28, 1.37, 0);
      const pylonR = new THREE.Mesh(pylonGeo, pylonMat);
      pylonR.position.set(1.28, 1.37, 0);
      const pylonTrimGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
      const pylonTrimMat = new THREE.MeshBasicMaterial({ color: 0xff3b50 });
      const trimL = new THREE.Mesh(pylonTrimGeo, pylonTrimMat);
      trimL.position.set(-1.28, 2.62, 0);
      const trimR = new THREE.Mesh(pylonTrimGeo, pylonTrimMat);
      trimR.position.set(1.28, 2.62, 0);
      group.add(pylonL, pylonR, trimL, trimR);

      const padGeo = new THREE.CircleGeometry(1.45, 24);
      const padMat = new THREE.MeshBasicMaterial({ color: 0xff3b50, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.025;
      group.add(pad);

      const light = new THREE.PointLight(0xff3b50, 1.25, 8, 2);
      light.position.set(0, 1.6, 0);
      group.add(light);

      const lockedTexture = TextureFactory.portalLabel('EXIT // SEALED', '#ff3b50');
      const openTexture = TextureFactory.portalLabel('EXIT // ONLINE', '#8dff5a');
      const labelMat = new THREE.SpriteMaterial({ map: lockedTexture, transparent: true, depthWrite: false });
      const label = new THREE.Sprite(labelMat);
      label.position.y = 2.66;
      label.scale.set(1.72, 0.39, 1);
      group.add(label);

      this.group.add(group);
      this.portal = {
        group, ring, ring2, inner, innerMat, ringMat, ring2Mat, pylonTrimMat, padMat, light,
        label, lockedTexture, openTexture, swirl, time: 0
      };
      this.disposables.add(ringGeo); this.disposables.add(ringMat);
      this.disposables.add(ring2Geo); this.disposables.add(ring2Mat);
      this.disposables.add(innerGeo); this.disposables.add(innerMat); this.disposables.add(swirl);
      this.disposables.add(pylonGeo); this.disposables.add(pylonMat);
      this.disposables.add(pylonTrimGeo); this.disposables.add(pylonTrimMat);
      this.disposables.add(padGeo); this.disposables.add(padMat);
      this.disposables.add(lockedTexture); this.disposables.add(openTexture);
      this.disposables.add(labelMat);
    }

    makePortalTexture(colorA, colorB) {
      const { canvas, ctx } = makeCanvas(128, 128);
      const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
      gradient.addColorStop(0, colorB);
      gradient.addColorStop(0.28, colorA);
      gradient.addColorStop(0.72, withAlpha(colorA, 0.26));
      gradient.addColorStop(1, withAlpha(colorA, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = withAlpha('#ffffff', 0.5);
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 2; a += 0.15) {
          const r = 6 + i * 9 + Math.sin(a * 5 + i * 1.7) * 3.5;
          const x = 64 + Math.cos(a) * r;
          const y = 64 + Math.sin(a) * r;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return toTexture(canvas, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        mipmaps: false
      });
    }

    setExitUnlocked(unlocked, silent = false) {
      if (!this.portal || this.exitUnlocked === unlocked) return;
      this.exitUnlocked = unlocked;
      const p = this.portal;
      const color = unlocked ? 0x8dff5a : 0xff3b50;
      p.ringMat.color.setHex(color);
      p.ring2Mat.color.setHex(color);
      p.innerMat.color.setHex(unlocked ? 0xb6ff8a : 0xffffff);
      p.pylonTrimMat.color.setHex(color);
      p.padMat.color.setHex(color);
      p.light.color.setHex(color);
      p.light.intensity = unlocked ? 2 : 1.25;
      p.label.material.map = unlocked ? p.openTexture : p.lockedTexture;
      p.label.material.needsUpdate = true;
      p.innerMat.opacity = unlocked ? 0.85 : 0.55;
      this.exitUnlocked = unlocked;
      if (!silent && unlocked && window.gameAudio) window.gameAudio.portal();
    }

    update(time, dt) {
      if (!this.portal) return;
      const p = this.portal;
      p.time += dt;
      p.ring.rotation.z = p.time * (p.ringMat.color.getHex() === 0x8dff5a ? 0.75 : 0.28);
      p.ring2.rotation.z = -p.time * 0.4;
      p.inner.rotation.z = Math.sin(p.time * 0.43) * 0.025;
      p.innerMat.opacity = (this.exitUnlocked ? 0.82 : 0.5) + Math.sin(p.time * 2.2) * 0.06;
      p.padMat.opacity = (this.exitUnlocked ? 0.2 : 0.11) + Math.sin(p.time * 2) * 0.03;
      for (const light of this.lights) {
        light.intensity = 0.68 + Math.sin(p.time * 1.7 + light.position.x) * 0.012;
      }
    }

    dispose(scene) {
      if (!this.group) return;
      scene.remove(this.group);
      this.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            for (const key of ['map', 'alphaMap', 'emissiveMap']) {
              if (material[key]) material[key].dispose();
            }
            material.dispose();
          }
        }
      });
      this.disposables.forEach((item) => {
        if (item && item.dispose) item.dispose();
      });
      this.disposables.clear();
      this.group = null;
    }
  }

  /* ============================== ENEMIES ============================== */

  class Enemy {
    constructor(game, typeId, x, z, options = {}) {
      this.game = game;
      this.level = game.level;
      this.typeId = typeId;
      this.type = ENEMY_TYPES[typeId] || ENEMY_TYPES.trooper;
      this.maxHealth = this.type.hp;
      this.health = options.health !== undefined ? clamp(options.health, 0, this.maxHealth) : this.maxHealth;
      this.dead = Boolean(options.dead) || this.health <= 0;
      this.state = options.state || (this.dead ? 'dead' : 'idle');
      this.position = new THREE.Vector3(x, 0, z);
      this.group = new THREE.Group();
      this.group.position.copy(this.position);
      this.sprite = null;
      this.texture = null;
      this.material = null;
      this.healthBar = null;
      this.healthFill = null;
      this.path = [];
      this.pathTimer = rand(0, 0.5);
      this.attackTimer = rand(0.5, this.type.cooldown);
      this.alertTimer = 0;
      this.walkTime = rand(0, 10);
      this.bobTime = rand(0, 10);
      this.idleTime = rand(1, 4);
      this.flashTimer = 0;
      this.deathTimer = 0;
      this.deathDuration = 1.05;
      this.lastSeenAt = -999;
      this.lastSeen = new THREE.Vector3(x, 0, z);
      this.patrolTarget = null;
      this.attackAnim = 0;
      this.strafe = rand(-1, 1) > 0 ? 1 : -1;
      this.isDead = this.dead;
      this.box = new THREE.Box3();
      this.boxCenter = new THREE.Vector3();
      this.boxSize = new THREE.Vector3(this.type.width * 0.72, this.type.height, this.type.width * 0.62);
      this.build();
      this.updateBox();
      if (this.dead) this.hideAsCorpse();
    }

    build() {
      const base = this.game.getEnemyTexture(this.typeId);
      this.texture = base.clone();
      this.texture.needsUpdate = true;
      this.texture.repeat.set(1 / 3, 1);
      this.texture.offset.set(0, 0);
      this.material = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.08,
        color: 0xffffff
      });
      this.sprite = new THREE.Sprite(this.material);
      this.sprite.scale.set(this.type.width, this.type.height, 1);
      this.sprite.center.set(0.5, 0);
      this.sprite.position.y = 0.025;
      this.sprite.renderOrder = 3;
      this.group.add(this.sprite);

      const barBgMat = new THREE.SpriteMaterial({ color: 0x120808, transparent: true, opacity: 0.85, depthWrite: false, depthTest: true });
      const barFillMat = new THREE.SpriteMaterial({ color: 0xff3b50, transparent: true, opacity: 0.95, depthWrite: false, depthTest: true });
      this.healthBar = new THREE.Sprite(barBgMat);
      this.healthBar.center.set(0, 0.5);
      this.healthBar.scale.set(0.92, 0.065, 1);
      this.healthBar.position.set(-0.46, this.type.height + 0.24, 0);
      this.healthBar.visible = false;
      this.healthBar.renderOrder = 4;
      this.healthFill = new THREE.Sprite(barFillMat);
      this.healthFill.center.set(0, 0.5);
      this.healthFill.scale.set(0.88, 0.038, 1);
      this.healthFill.position.set(-0.44, this.type.height + 0.24, 0.001);
      this.healthFill.visible = false;
      this.healthFill.renderOrder = 5;
      this.group.add(this.healthBar, this.healthFill);

      this.game.worldGroup.add(this.group);
    }

    updateBox() {
      this.boxCenter.set(this.position.x, this.type.height / 2, this.position.z);
      this.box.setFromCenterAndSize(this.boxCenter, this.boxSize);
    }

    hideAsCorpse() {
      this.dead = true;
      this.state = 'dead';
      this.group.visible = false;
      this.healthBar.visible = false;
      this.healthFill.visible = false;
    }

    get alive() { return !this.dead; }

    showHealth() {
      if (this.dead) return;
      this.healthBar.visible = true;
      this.healthFill.visible = true;
    }

    updateHealthBar() {
      if (!this.healthFill) return;
      const ratio = clamp(this.health / this.maxHealth, 0, 1);
      this.healthFill.scale.x = 0.88 * ratio;
      if (ratio > 0.55) this.healthFill.material.color.setHex(0x8dff5a);
      else if (ratio > 0.25) this.healthFill.material.color.setHex(0xffb52e);
      else this.healthFill.material.color.setHex(0xff3b50);
    }

    alertNearby() {
      for (const other of this.game.enemies) {
        if (other === this || other.dead) continue;
        const distance = Math.hypot(other.position.x - this.position.x, other.position.z - this.position.z);
        if (distance < 8.5 && other.state === 'idle') {
          other.state = 'alert';
          other.alertTimer = rand(0.3, 0.7);
          other.lastSeen.copy(this.game.player.position);
          other.lastSeenAt = this.game.elapsed;
          other.pathTimer = 0;
        }
      }
    }

    spotPlayer() {
      if (this.dead) return;
      this.state = 'alert';
      this.alertTimer = 0.48;
      this.lastSeen.copy(this.game.player.position);
      this.lastSeenAt = this.game.elapsed;
      this.pathTimer = 0;
      this.showHealth();
      this.game.audio.growl(this.typeId);
      this.game.audio.alert();
      this.alertNearby();
    }

    takeDamage(amount, headshot = false) {
      if (this.dead) return false;
      this.health -= amount;
      this.flashTimer = 0.09;
      this.showHealth();
      this.updateHealthBar();
      this.pathTimer = 0;
      if (this.state === 'idle') {
        this.state = 'alert';
        this.alertTimer = 0.25;
        this.lastSeen.copy(this.game.player.position);
        this.lastSeenAt = this.game.elapsed;
        this.alertNearby();
      }
      if (this.health <= 0) {
        this.die(headshot);
        return true;
      }
      return false;
    }

    die(headshot = false) {
      if (this.dead) return;
      this.dead = true;
      this.state = 'dead';
      this.deathTimer = this.deathDuration;
      this.healthBar.visible = false;
      this.healthFill.visible = false;
      const chest = new THREE.Vector3(this.position.x, this.type.height * 0.55, this.position.z);
      this.game.particles.spawnBurst(chest, this.type.projectileColor, 20, 5.5, { spread: 1.2 });
      this.game.particles.spawnBurst(chest, 0xffb52e, 8, 3.2, { spread: 0.8 });
      this.game.audio.growl(this.typeId);
      this.game.onEnemyKilled(this, headshot);
    }

    choosePatrolTarget() {
      const cells = this.level.randomOpenCells(2);
      if (!cells.length) return;
      const near = cells.filter((cell) => Math.hypot(cell.x - this.position.x, cell.z - this.position.z) < 10);
      const target = pick(near.length ? near : cells);
      this.patrolTarget = { x: target.x, z: target.z };
      this.path = this.level.findPath(this.position.x, this.position.z, target.x, target.z);
      this.pathTimer = 1.6 + rand(0, 1.5);
    }

    followPath(dt, speed) {
      if (!this.path.length) return false;
      const node = this.path[0];
      const dx = node.x - this.position.x;
      const dz = node.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.14) {
        this.path.shift();
        return true;
      }
      const step = Math.min(distance, speed * dt);
      const moved = this.level.moveEntity(this.position, (dx / distance) * step, (dz / distance) * step, this.type.radius);
      if (Math.abs(moved.x) < 0.0001 && Math.abs(moved.z) < 0.0001) {
        this.pathTimer = 0;
        return false;
      }
      this.walkTime += dt * 8;
      return true;
    }

    moveToward(targetX, targetZ, dt, speed) {
      const dx = targetX - this.position.x;
      const dz = targetZ - this.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.001) return;
      const step = Math.min(distance, speed * dt);
      const moved = this.level.moveEntity(this.position, (dx / distance) * step, (dz / distance) * step, this.type.radius);
      if (Math.abs(moved.x) > 0.0001 || Math.abs(moved.z) > 0.0001) this.walkTime += dt * 8;
      else { this.pathTimer = 0; this.strafe *= -1; }
    }

    separate() {
      for (const other of this.game.enemies) {
        if (other === this || other.dead) continue;
        const dx = this.position.x - other.position.x;
        const dz = this.position.z - other.position.z;
        const min = (this.type.radius + other.type.radius) * 0.92;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.001 && dist < min) {
          const push = (min - dist) * 0.5;
          const nx = this.position.x + (dx / dist) * push;
          const nz = this.position.z + (dz / dist) * push;
          if (!this.level.collides(nx, nz, this.type.radius)) {
            this.position.x = nx;
            this.position.z = nz;
          }
        }
      }
    }

    fireAtPlayer() {
      const origin = new THREE.Vector3(this.position.x, this.type.height * 0.62, this.position.z);
      const target = new THREE.Vector3(this.game.player.position.x, this.game.player.position.y + 1.15, this.game.player.position.z);
      const direction = target.clone().sub(origin).normalize();
      const count = this.typeId === 'heavy' ? 3 : 1;
      for (let i = 0; i < count; i += 1) {
        const spreadAngle = count > 1 ? (i - 1) * 0.075 : 0;
        const shotDir = direction.clone();
        shotDir.x += Math.cos(spreadAngle) * 0.055 - 0.055 + rand(-0.018, 0.018);
        shotDir.z += Math.sin(spreadAngle) * 0.055 + rand(-0.018, 0.018);
        shotDir.normalize();
        this.game.projectiles.push(new Projectile(
          this.game,
          origin.clone(),
          shotDir,
          this.type.projectileSpeed,
          this.type.damage,
          this.type.projectileColor,
          this.typeId
        ));
      }
      this.game.audio.enemyShot(this.typeId);
      this.attackAnim = 0.18;
    }

    melee() {
      this.game.damagePlayer(this.type.damage, this.type.name);
      this.game.particles.spawnBurst(
        new THREE.Vector3(this.game.player.position.x, 1.2, this.game.player.position.z),
        0xff3b50, 12, 4.2, { spread: 1.1 }
      );
      this.game.audio.growl('hound');
      this.attackAnim = 0.22;
    }

    update(dt, player, elapsed) {
      if (this.dead) {
        if (this.deathTimer > 0) {
          this.deathTimer -= dt;
          const t = clamp(1 - this.deathTimer / this.deathDuration, 0, 1);
          this.sprite.material.opacity = 1 - t;
          this.sprite.position.y = 0.025 - t * 0.35;
          this.sprite.material.rotation = -t * 0.9;
          if (this.deathTimer <= 0) this.group.visible = false;
        }
        return;
      }

      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      const canSee = distance <= this.type.sight && this.level.hasLineOfSight(this.position.x, this.position.z, player.position.x, player.position.z);

      this.attackTimer = Math.max(0, this.attackTimer - dt);
      this.pathTimer -= dt;
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.attackAnim = Math.max(0, this.attackAnim - dt);
      this.bobTime += dt;

      if (this.flashTimer > 0) this.material.color.setHex(0xffdede);
      else this.material.color.setHex(0xffffff);

      if (canSee) {
        this.lastSeen.copy(player.position);
        this.lastSeenAt = elapsed;
      }

      switch (this.state) {
        case 'idle': {
          this.idleTime -= dt;
          if (canSee) {
            this.spotPlayer();
          } else if (this.idleTime <= 0) {
            this.choosePatrolTarget();
            this.state = 'patrol';
            this.idleTime = rand(3, 7);
          }
          break;
        }
        case 'patrol': {
          if (canSee) {
            this.spotPlayer();
            break;
          }
          if (!this.path.length && this.pathTimer <= 0) this.choosePatrolTarget();
          this.followPath(dt, this.type.speed * 0.58);
          break;
        }
        case 'alert': {
          this.alertTimer -= dt;
          this.lastSeen.copy(player.position);
          if (canSee || this.alertTimer <= 0) {
            this.state = 'chase';
            this.pathTimer = 0;
          }
          break;
        }
        case 'chase': {
          if (canSee) {
            this.showHealth();
            if (distance <= this.type.attackRange && this.typeId === 'hound' && this.attackTimer <= 0) {
              this.melee();
              this.attackTimer = this.type.cooldown;
              break;
            }
            if (distance <= this.type.attackRange && this.typeId !== 'hound' && this.attackTimer <= 0) {
              this.fireAtPlayer();
              this.attackTimer = this.type.cooldown;
            }
            const ideal = this.type.preferredRange;
            if (distance > ideal + 0.4) {
              if (distance > this.type.attackRange * 0.95 && this.pathTimer <= 0) {
                this.path = this.level.findPath(this.position.x, this.position.z, player.position.x, player.position.z);
                this.pathTimer = 0.55 + rand(0, 0.35);
              }
              if (this.path.length) this.followPath(dt, this.type.speed);
              else this.moveToward(player.position.x, player.position.z, dt, this.type.speed);
            } else if (distance < ideal - 1.2 && this.typeId !== 'hound') {
              this.moveToward(player.position.x, player.position.z, dt, -this.type.speed * 0.42);
            } else if (this.typeId === 'hound' && distance > this.type.attackRange) {
              this.moveToward(player.position.x, player.position.z, dt, this.type.speed);
            } else {
              // strafe when holding a firing line
              const strafeDir = Math.atan2(dx, dz) + Math.PI / 2 * this.strafe;
              this.moveToward(
                this.position.x + Math.sin(strafeDir) * 0.65,
                this.position.z + Math.cos(strafeDir) * 0.65,
                dt,
                this.type.speed * 0.34
              );
            }
          } else if (elapsed - this.lastSeenAt < 3.2) {
            if (this.pathTimer <= 0) {
              this.path = this.level.findPath(this.position.x, this.position.z, this.lastSeen.x, this.lastSeen.z);
              this.pathTimer = 1.1;
            }
            this.followPath(dt, this.type.speed * 0.82);
          } else {
            this.state = 'patrol';
            this.choosePatrolTarget();
          }
          break;
        }
        default:
          this.state = 'idle';
      }

      if (this.state !== 'chase' && this.state !== 'patrol') this.walkTime += dt * 1.6;
      this.separate();
      this.group.position.x = this.position.x;
      this.group.position.z = this.position.z;

      this.bobTime += dt;
      const moving = this.state === 'chase' || this.state === 'patrol';
      const bob = Math.sin(this.bobTime * (moving ? 11 : 3.4)) * this.type.bob;
      this.sprite.position.y = 0.025 + Math.abs(bob) * (moving ? 1 : 0.35);
      this.sprite.material.rotation = this.typeId === 'hound' && moving ? Math.sin(this.bobTime * 6) * 0.025 : 0;

      let frame = 0;
      if (this.attackAnim > 0) frame = 2;
      else if (moving) frame = Math.floor(this.walkTime) % 2;
      if (this.texture.offset.x !== frame / 3) this.texture.offset.x = frame / 3;

      this.updateBox();
      this.healthBar.position.y = this.type.height + 0.24 + Math.sin(this.bobTime * 2) * 0.015;
      this.healthFill.position.y = this.healthBar.position.y;
    }

    dispose() {
      this.game.worldGroup.remove(this.group);
      if (this.texture) this.texture.dispose();
      if (this.material) this.material.dispose();
      if (this.healthBar) {
        this.healthBar.material.dispose();
        this.healthFill.material.dispose();
      }
    }

    serialize() {
      return {
        type: this.typeId,
        x: Number(this.position.x.toFixed(3)),
        z: Number(this.position.z.toFixed(3)),
        health: Math.round(this.health),
        state: this.state,
        dead: this.dead
      };
    }
  }

  /* ============================== PROJECTILES ============================== */

  class Projectile {
    constructor(game, position, direction, speed, damage, color, ownerType) {
      this.game = game;
      this.position = position.clone();
      this.velocity = direction.clone().normalize().multiplyScalar(speed);
      this.damage = damage;
      this.color = color;
      this.ownerType = ownerType;
      this.life = 4.5;
      this.dead = false;
      this.group = new THREE.Group();
      this.group.position.copy(this.position);

      const coreGeo = new THREE.SphereGeometry(0.105, 6, 5);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const core = new THREE.Mesh(coreGeo, coreMat);
      this.group.add(core);
      const glowMat = new THREE.SpriteMaterial({
        map: game.getGlowTexture(color),
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(0.7, 0.7, 1);
      this.group.add(glow);
      this.group.renderOrder = 4;
      game.worldGroup.add(this.group);
      this.geometry = coreGeo;
      this.material = coreMat;
      this.glowMaterial = glowMat;
      this.glowTexture = glowMat.map;
    }

    update(dt) {
      if (this.dead) return;
      this.life -= dt;
      if (this.life <= 0) {
        this.impact(false);
        return;
      }
      const steps = 2;
      for (let i = 0; i < steps; i += 1) {
        const stepDt = dt / steps;
        this.position.addScaledVector(this.velocity, stepDt);
        this.group.position.copy(this.position);
        if (this.position.y < 0.08 || this.position.y > WALL_H - 0.05) {
          this.impact(false);
          return;
        }
        if (this.game.level.isWallAt(this.position.x, this.position.z)) {
          this.impact(false);
          return;
        }
        for (const obstacle of this.game.level.obstacles) {
          const ox = this.position.x - obstacle.x;
          const oz = this.position.z - obstacle.z;
          if (ox * ox + oz * oz < (obstacle.radius + 0.08) * (obstacle.radius + 0.08)) {
            this.impact(false);
            return;
          }
        }
        const player = this.game.player.position;
        const dx = this.position.x - player.x;
        const dz = this.position.z - player.z;
        const dy = this.position.y - (player.y + 1.05);
        if (dx * dx + dz * dz < 0.34 * 0.34 && Math.abs(dy) < 1.0) {
          this.game.damagePlayer(this.damage, this.ownerType === 'heavy' ? 'SIEGE CYBORG' : 'CULT TROOPER');
          this.impact(true);
          return;
        }
      }
      if (Math.random() < dt * 22) {
        this.game.particles.spawnBurst(this.position, this.color, 1, 1.4, { spread: 0.4, gravity: 0.1, drag: 0.9 });
      }
    }

    impact(hitPlayer) {
      if (this.dead) return;
      this.dead = true;
      this.game.particles.spawnBurst(this.position, this.color, hitPlayer ? 12 : 8, 3.6, { spread: 0.9 });
      this.game.audio.hit(false);
      this.game.removeProjectile(this);
    }

    dispose() {
      this.game.worldGroup.remove(this.group);
      this.geometry.dispose();
      this.material.dispose();
      this.glowMaterial.dispose();
      // The glow map is cached by Game and must stay alive for future projectiles.
    }
  }

  /* ============================== PICKUPS ============================== */

  class Pickup {
    constructor(game, typeId, x, z, options = {}) {
      this.game = game;
      this.typeId = typeId;
      this.config = PICKUP_TYPES[typeId] || PICKUP_TYPES.health;
      this.taken = Boolean(options.taken);
      this.position = new THREE.Vector3(x, 0, z);
      this.group = new THREE.Group();
      this.group.position.copy(this.position);
      this.group.visible = !this.taken;
      this.time = rand(0, 6);
      this.baseY = 0.46;

      const texture = game.getPickupTexture(typeId);
      this.material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.08
      });
      this.sprite = new THREE.Sprite(this.material);
      this.sprite.scale.set(0.8, 0.8, 1);
      this.sprite.position.y = this.baseY;
      this.sprite.renderOrder = 3;
      this.group.add(this.sprite);

      this.glowMaterial = new THREE.SpriteMaterial({
        map: game.getGlowTexture(this.config.color),
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this.glow = new THREE.Sprite(this.glowMaterial);
      this.glow.scale.set(1.6, 1.6, 1);
      this.glow.position.y = this.baseY;
      this.group.add(this.glow);

      const ringGeo = new THREE.TorusGeometry(0.36, 0.018, 5, 16);
      const ringMat = new THREE.MeshBasicMaterial({ color: this.config.color, transparent: true, opacity: 0.55 });
      this.ring = new THREE.Mesh(ringGeo, ringMat);
      this.ring.rotation.x = Math.PI / 2;
      this.ring.position.y = 0.08;
      this.group.add(this.ring);
      this.ringGeometry = ringGeo;
      this.ringMaterial = ringMat;

      game.worldGroup.add(this.group);
    }

    update(dt) {
      if (this.taken) return;
      this.time += dt;
      this.sprite.position.y = this.baseY + Math.sin(this.time * 2.4) * 0.08;
      this.glow.position.y = this.sprite.position.y;
      this.glowMaterial.opacity = 0.28 + Math.sin(this.time * 2.1) * 0.08;
      this.ring.rotation.z += dt * 1.2;
      this.ringMaterial.opacity = 0.42 + Math.sin(this.time * 2.4) * 0.14;
      const dx = this.position.x - this.game.player.position.x;
      const dz = this.position.z - this.game.player.position.z;
      if (dx * dx + dz * dz < 1.0 * 1.0) {
        this.game.collectPickup(this);
      }
    }

    collect() {
      if (this.taken) return;
      this.taken = true;
      this.group.visible = false;
      this.game.particles.spawnBurst(new THREE.Vector3(this.position.x, 0.8, this.position.z), this.config.color, 14, 2.6, { spread: 1, gravity: 0.2 });
    }

    dispose() {
      this.game.worldGroup.remove(this.group);
      this.material.dispose();
      this.glowMaterial.dispose();
      this.ringGeometry.dispose();
      this.ringMaterial.dispose();
    }

    serialize() {
      return {
        type: this.typeId,
        x: Number(this.position.x.toFixed(3)),
        z: Number(this.position.z.toFixed(3)),
        taken: this.taken
      };
    }
  }

  /* ============================== HUD ============================== */

  const HIGH_SCORE_KEY = STORAGE_KEYS.highScores;
  const MAX_HIGH_SCORES = 8;

  function loadHighScores() {
    const raw = readJson(HIGH_SCORE_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        score: Math.round(sanitiseNumber(entry.score, 0, 0, 99999999)),
        kills: Math.round(sanitiseNumber(entry.kills, 0, 0, 99999)),
        level: Math.round(sanitiseNumber(entry.level, 1, 1, 3)),
        time: Math.round(sanitiseNumber(entry.time, 0, 0, 864000)),
        date: sanitiseString(entry.date, '----', 10),
        victory: Boolean(entry.victory)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_HIGH_SCORES);
  }

  function saveHighScores(scores) {
    safeSet(HIGH_SCORE_KEY, JSON.stringify(scores.slice(0, MAX_HIGH_SCORES)));
  }

  function recordHighScore(run, victory) {
    const scores = loadHighScores();
    const entry = {
      score: Math.round(run.score || 0),
      kills: Math.round(run.kills || 0),
      level: Math.round((run.level || 0) + 1),
      time: Math.round(run.timePlayed || 0),
      date: new Date().toISOString().slice(0, 10),
      victory: Boolean(victory)
    };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    saveHighScores(scores);
    return scores.slice(0, MAX_HIGH_SCORES);
  }

  class HUD {
    constructor(game) {
      this.game = game;
      this.root = $('#hud');
      this.elements = {
        sector: $('#hud-sector'),
        threat: $('#hud-threat'),
        sectorName: $('#hud-sector-name'),
        objectiveText: $('#hud-objective-text'),
        hostiles: $('#hud-hostiles'),
        compassCardinal: $('#compass-cardinal'),
        compassBearing: $('#compass-bearing'),
        minimap: $('#minimap'),
        crosshair: $('#crosshair'),
        hitmarker: $('#hitmarker'),
        interaction: $('#interaction-prompt'),
        interactionText: $('#interaction-text'),
        messages: $('#message-feed'),
        ammo: $('#ammo-value'),
        ammoType: $('#ammo-type'),
        health: $('#health-value'),
        healthBar: $('#health-bar'),
        armor: $('#armor-value'),
        armorBar: $('#armor-bar'),
        score: $('#score-value'),
        kills: $('#kills-value'),
        accuracy: $('#accuracy-value'),
        face: $('#face-canvas'),
        faceStatus: $('#face-status'),
        weaponPlasma: $('#weapon-plasma'),
        weaponShotgun: $('#weapon-shotgun'),
        damage: $('#damage-vignette'),
        flash: $('#flash-overlay'),
        weaponCanvas: $('#weapon-canvas'),
        systemClock: $('#system-clock')
      };
      this.faceCtx = this.elements.face.getContext('2d');
      this.weaponCtx = this.elements.weaponCanvas.getContext('2d');
      this.minimapCtx = this.elements.minimap.getContext('2d');
      this.faceCtx.imageSmoothingEnabled = false;
      this.weaponCtx.imageSmoothingEnabled = false;
      this.minimapCtx.imageSmoothingEnabled = false;
      this.cache = {};
      this.messageItems = [];
      this.minimapTimer = 0;
      this.faceBlink = 0;
      this.faceLook = 0;
      this.faceHurt = 0;
      this.faceKill = 0;
      this.damageTimer = 0;
      this.lowHealth = false;
      this.crosshairTimer = 0;
      this.hitmarkerTimer = 0;
      this.lastHitKill = false;
      this.updateClock();
      window.setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
      if (!this.elements.systemClock) return;
      const now = new Date();
      this.elements.systemClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    show() {
      this.root.classList.remove('is-hidden');
      this.root.setAttribute('aria-hidden', 'false');
    }

    hide() {
      this.root.classList.add('is-hidden');
      this.root.setAttribute('aria-hidden', 'true');
    }

    setText(element, value) {
      if (!element) return;
      const str = String(value);
      if (element.textContent !== str) element.textContent = str;
    }

    setBar(element, value) {
      if (!element) return;
      const pct = clamp(value, 0, 100);
      element.style.width = `${pct}%`;
      element.classList.toggle('is-low', pct <= 25);
    }

    message(text, kind = '', duration = 3400) {
      const item = document.createElement('div');
      item.className = `message${kind ? ` is-${kind}` : ''}`;
      item.textContent = text;
      this.elements.messages.appendChild(item);
      this.messageItems.push(item);
      while (this.messageItems.length > 4) {
        const old = this.messageItems.shift();
        old.remove();
      }
      window.setTimeout(() => {
        item.classList.add('is-out');
        window.setTimeout(() => item.remove(), 420);
      }, duration);
    }

    toast(text, isError = false) {
      const toast = $('#toast');
      toast.textContent = text;
      toast.classList.toggle('is-error', isError);
      toast.classList.add('is-visible');
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
    }

    flashFire() {
      const el = this.elements.flash;
      el.classList.remove('is-red');
      el.classList.remove('is-fire');
      void el.offsetWidth;
      el.classList.add('is-fire');
    }

    flashDamage(big = false) {
      const el = this.elements.flash;
      el.classList.remove('is-fire');
      el.classList.remove('is-red');
      void el.offsetWidth;
      el.classList.add('is-red');
      const dmg = this.elements.damage;
      dmg.classList.remove('is-hit');
      void dmg.offsetWidth;
      dmg.classList.add('is-hit');
      window.clearTimeout(this.damageTimer);
      this.damageTimer = window.setTimeout(() => dmg.classList.remove('is-hit'), 260);
    }

    hitmarker(kill = false) {
      const el = this.elements.hitmarker;
      el.classList.remove('is-hit');
      el.classList.toggle('is-kill', kill);
      void el.offsetWidth;
      el.classList.add('is-hit');
      this.hitmarkerTimer = 0.2;
    }

    kickCrosshair() {
      this.elements.crosshair.classList.add('is-fire');
      this.crosshairTimer = 0.09;
    }

    faceReact(hurt = false, kill = false) {
      if (hurt) this.faceHurt = 0.55;
      if (kill) this.faceKill = 0.9;
    }

    update(dt, game) {
      if (!game.player) return;
      const player = game.player;
      const weapon = WEAPONS[game.weapons.current];
      const ammo = game.weapons[weapon.ammoKey].ammo;
      const alive = game.aliveEnemyCount();
      const accuracy = game.shotsFired > 0 ? Math.round((game.shotsHit / game.shotsFired) * 100) : 0;

      this.setText(this.elements.sector, pad(game.levelIndex + 1));
      this.setText(this.elements.sectorName, game.level.config.name);
      this.setText(this.elements.threat, alive > 0 ? 'HOSTILE' : 'CLEAR');
      this.setText(this.elements.objectiveText, alive > 0 ? 'PURGE ALL HOSTILES' : 'EXIT PORTAL ONLINE');
      this.setText(this.elements.hostiles, pad(alive));
      this.elements.hostiles.classList.toggle('is-clear', alive === 0);

      this.setText(this.elements.ammo, ammo);
      this.setText(this.elements.ammoType, `${weapon.ammoName} // ${weapon.name}`);
      this.elements.ammo.classList.toggle('is-low', ammo <= Math.max(3, weapon.maxAmmo * 0.12));

      this.setText(this.elements.health, Math.ceil(player.health));
      this.setText(this.elements.armor, Math.ceil(player.armor));
      this.elements.health.classList.toggle('is-low', player.health <= 25);
      this.setBar(this.elements.healthBar, player.health);
      this.setBar(this.elements.armorBar, player.armor);
      this.setText(this.elements.score, formatNumber(game.score));
      this.setText(this.elements.kills, game.kills);
      this.setText(this.elements.accuracy, `${accuracy}%`);

      this.elements.weaponPlasma.classList.toggle('is-active', game.weapons.current === 'plasma');
      this.elements.weaponShotgun.classList.toggle('is-active', game.weapons.current === 'shotgun');

      if (player.health <= 25 && !this.lowHealth) {
        this.elements.damage.classList.add('is-low');
        this.lowHealth = true;
      } else if (player.health > 25 && this.lowHealth) {
        this.elements.damage.classList.remove('is-low');
        this.lowHealth = false;
      }

      const dir = game.getLookDirection();
      let heading = Math.atan2(dir.x, -dir.z) * 180 / Math.PI;
      if (heading < 0) heading += 360;
      const cardinal = heading < 22.5 || heading >= 337.5 ? 'N'
        : heading < 67.5 ? 'NE'
          : heading < 112.5 ? 'E'
            : heading < 157.5 ? 'SE'
              : heading < 202.5 ? 'S'
                : heading < 247.5 ? 'SW'
                  : heading < 292.5 ? 'W' : 'NW';
      this.setText(this.elements.compassCardinal, cardinal);
      this.setText(this.elements.compassBearing, pad(Math.round(heading), 3));

      const exitDistance = Math.hypot(player.position.x - game.level.exitWorld.x, player.position.z - game.level.exitWorld.z);
      if (exitDistance < 3.6) {
        this.elements.interaction.classList.remove('is-hidden');
        this.setText(
          this.elements.interactionText,
          alive === 0 ? 'ENTER EXIT PORTAL' : `EXIT SEALED // ${alive} HOSTILES REMAIN`
        );
      } else {
        this.elements.interaction.classList.add('is-hidden');
      }

      this.faceHurt = Math.max(0, this.faceHurt - dt);
      this.faceKill = Math.max(0, this.faceKill - dt);
      this.faceBlink += dt;
      this.faceLook += dt;
      this.drawFace(game, dt);
      this.drawWeapon(game, dt);

      this.minimapTimer -= dt;
      if (this.minimapTimer <= 0) {
        this.minimapTimer = 0.09;
        this.drawMinimap(game);
      }

      if (this.crosshairTimer > 0) {
        this.crosshairTimer -= dt;
        if (this.crosshairTimer <= 0) this.elements.crosshair.classList.remove('is-fire');
      }
      if (this.hitmarkerTimer > 0) {
        this.hitmarkerTimer -= dt;
        if (this.hitmarkerTimer <= 0) this.elements.hitmarker.classList.remove('is-hit', 'is-kill');
      }
    }

    drawFace(game, dt) {
      const ctx = this.faceCtx;
      const player = game.player;
      const health = player.health;
      const mood = health > 75 ? 'steady' : health > 50 ? 'worn' : health > 25 ? 'wounded' : 'critical';
      const hurt = this.faceHurt > 0;
      const kill = this.faceKill > 0;
      const t = game.elapsed;
      const blink = (t % 4.2) > 4.04 || hurt;
      const look = Math.sin(this.faceLook * 0.7) * 1.2;

      ctx.clearRect(0, 0, 96, 96);
      // backdrop
      const grad = ctx.createLinearGradient(0, 0, 0, 96);
      grad.addColorStop(0, '#0d1814');
      grad.addColorStop(1, '#030706');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 96, 96);
      ctx.fillStyle = 'rgba(141,255,90,0.045)';
      for (let y = 0; y < 96; y += 4) ctx.fillRect(0, y, 96, 1);

      // shoulders / suit
      px(ctx, 8, 78, 80, 18, '#0a1210');
      px(ctx, 13, 73, 70, 14, '#21352c');
      px(ctx, 17, 76, 62, 4, '#355445');
      px(ctx, 21, 82, 54, 8, '#182821');
      px(ctx, 44, 84, 8, 8, '#8dff5a');
      px(ctx, 46, 86, 4, 4, '#d8ffc0');

      // neck / jaw
      px(ctx, 35, 65, 26, 15, '#8d6b55');
      px(ctx, 38, 68, 20, 12, '#a67c61');
      px(ctx, 40, 76, 16, 3, '#6e503f');

      // head base
      if (mood === 'critical') px(ctx, 25, 22, 46, 46, '#9a7a66');
      else if (mood === 'wounded') px(ctx, 25, 22, 46, 46, '#a98468');
      else px(ctx, 25, 22, 46, 46, '#b48e6d');
      px(ctx, 28, 25, 40, 8, '#c39a78');
      px(ctx, 21, 32, 6, 24, '#9c735c');
      px(ctx, 69, 32, 6, 24, '#9c735c');
      px(ctx, 29, 50, 38, 16, '#a77f63');
      px(ctx, 33, 64, 30, 5, '#8d6652');

      // helmet
      px(ctx, 21, 12, 54, 16, '#111c18');
      px(ctx, 24, 14, 48, 9, '#2d453b');
      px(ctx, 28, 16, 40, 3, '#4c6b5c');
      px(ctx, 22, 26, 7, 10, '#263a32');
      px(ctx, 67, 26, 7, 10, '#263a32');
      px(ctx, 43, 10, 10, 4, '#3e5a4c');
      px(ctx, 47, 7, 2, 4, '#8dff5a');

      // brows
      if (hurt) {
        px(ctx, 33, 34, 11, 4, '#5b4033');
        px(ctx, 52, 34, 11, 4, '#5b4033');
        px(ctx, 34, 38, 9, 2, '#5b4033');
        px(ctx, 53, 38, 9, 2, '#5b4033');
      } else if (kill) {
        px(ctx, 33, 32, 11, 5, '#5b4033');
        px(ctx, 52, 32, 11, 5, '#5b4033');
      } else {
        px(ctx, 33, 33, 11, 4, '#5b4033');
        px(ctx, 52, 33, 11, 4, '#5b4033');
      }

      // eyes
      const eyeY = hurt ? 40 : 39;
      const eyeShift = Math.round(look);
      if (blink && !hurt) {
        px(ctx, 35, eyeY + 2, 8, 2, '#4b3028');
        px(ctx, 53, eyeY + 2, 8, 2, '#4b3028');
      } else {
        px(ctx, 35, eyeY, 8, 5, '#e8e4d2');
        px(ctx, 53, eyeY, 8, 5, '#e8e4d2');
        px(ctx, 37 + eyeShift, eyeY + 1, 3, 3, mood === 'critical' ? '#ff3b50' : '#1d3a32');
        px(ctx, 55 + eyeShift, eyeY + 1, 3, 3, mood === 'critical' ? '#ff3b50' : '#1d3a32');
        px(ctx, 38 + eyeShift, eyeY + 1, 1, 1, '#ffffff');
        px(ctx, 56 + eyeShift, eyeY + 1, 1, 1, '#ffffff');
      }
      // nose
      px(ctx, 46, 43, 5, 10, '#8f6752');
      px(ctx, 43, 52, 11, 3, '#7c5745');

      // mouth
      if (hurt || mood === 'critical') {
        px(ctx, 39, 58, 19, 7, '#3d1519');
        px(ctx, 41, 59, 15, 3, '#8f2832');
        px(ctx, 43, 63, 11, 2, '#c34b56');
        px(ctx, 34, 57, 5, 2, '#6d4636');
        px(ctx, 59, 57, 5, 2, '#6d4636');
      } else if (kill) {
        px(ctx, 39, 57, 19, 6, '#40191c');
        px(ctx, 41, 58, 15, 3, '#dfd8c1');
      } else if (mood === 'worn') {
        px(ctx, 41, 58, 15, 3, '#6b4238');
      } else {
        px(ctx, 41, 58, 15, 2, '#6b4238');
      }

      // grime / scars / blood by health
      if (health < 75) {
        px(ctx, 31, 44, 2, 6, 'rgba(90,60,45,0.6)');
        px(ctx, 64, 49, 2, 4, 'rgba(90,60,45,0.5)');
      }
      if (health < 60) {
        px(ctx, 66, 39, 2, 15, '#a11f2c');
        px(ctx, 67, 52, 3, 4, '#7f1520');
        px(ctx, 30, 36, 5, 2, '#7f1520');
      }
      if (health < 35) {
        px(ctx, 28, 30, 3, 20, '#8f1724');
        px(ctx, 30, 46, 4, 3, '#b32634');
        px(ctx, 31, 57, 5, 2, '#6f101b');
        px(ctx, 63, 31, 2, 20, '#8f1724');
      }
      if (health < 18) {
        px(ctx, 22, 48, 5, 3, '#c62c3b');
        px(ctx, 69, 56, 4, 4, '#c62c3b');
        px(ctx, 44, 54, 8, 2, '#8f1724');
      }
      // sweat
      if (mood !== 'steady') {
        px(ctx, 29, 42, 2, 4, 'rgba(180,240,255,0.55)');
        px(ctx, 66, 46, 2, 3, 'rgba(180,240,255,0.45)');
      }

      // scanline overlay
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let y = 0; y < 96; y += 3) ctx.fillRect(0, y, 96, 1);

      const status = health <= 0 ? 'FLATLINE' : health <= 25 ? 'CRITICAL' : health <= 50 ? 'WOUNDED' : health <= 75 ? 'STRAINED' : hurt ? 'HIT' : 'STEADY';
      this.setText(this.elements.faceStatus, status);
      this.elements.faceStatus.classList.toggle('is-hurt', hurt);
      this.elements.faceStatus.classList.toggle('is-low', health <= 25);
    }

    drawWeapon(game, dt) {
      const ctx = this.weaponCtx;
      const w = 900;
      const h = 420;
      ctx.clearRect(0, 0, w, h);
      const weapon = WEAPONS[game.weapons.current];
      const player = game.player;
      const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.4;
      const bob = Math.sin(player.bobPhase) * (moving ? 7 : 2.2);
      const sway = Math.cos(player.bobPhase * 0.5) * (moving ? 5 : 1.6);
      const recoil = game.weaponRecoil * 44;
      const raise = (1 - game.weaponRaise) * 150;
      const muzzle = Math.max(0, game.muzzleTimer);
      ctx.save();
      ctx.translate(w / 2 + sway, h + bob + recoil + raise);
      ctx.lineJoin = 'miter';

      const drawPlasma = () => {
        // hands
        this.drawGlove(ctx, -132, -112, -1);
        this.drawGlove(ctx, 106, -150, 1);
        // underside glow
        ctx.fillStyle = 'rgba(70,255,220,0.08)';
        ctx.beginPath();
        ctx.ellipse(0, -80, 120, 32, 0, 0, Math.PI * 2);
        ctx.fill();

        // stock / receiver
        ctx.fillStyle = '#091311';
        ctx.beginPath();
        ctx.moveTo(-74, -35);
        ctx.lineTo(74, -35);
        ctx.lineTo(63, -158);
        ctx.lineTo(44, -188);
        ctx.lineTo(-44, -188);
        ctx.lineTo(-63, -158);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1f3d36';
        ctx.beginPath();
        ctx.moveTo(-63, -49);
        ctx.lineTo(63, -49);
        ctx.lineTo(54, -152);
        ctx.lineTo(38, -176);
        ctx.lineTo(-38, -176);
        ctx.lineTo(-54, -152);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#335b4e';
        ctx.fillRect(-50, -65, 100, 9);

        // side heat exchangers / receiver wings
        const wing = (side) => {
          ctx.fillStyle = '#08110f';
          ctx.beginPath();
          ctx.moveTo(side * 62, -70);
          ctx.lineTo(side * 118, -96);
          ctx.lineTo(side * 104, -162);
          ctx.lineTo(side * 56, -178);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#1d3932';
          ctx.beginPath();
          ctx.moveTo(side * 68, -77);
          ctx.lineTo(side * 108, -99);
          ctx.lineTo(side * 96, -154);
          ctx.lineTo(side * 62, -168);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#335b4e';
          ctx.fillRect(side * 76 - (side > 0 ? 22 : 0), -130, 22, 5);
          ctx.fillStyle = '#4ff5df';
          ctx.fillRect(side * 82 - (side > 0 ? 18 : 0), -122, 18, 3);
          ctx.fillStyle = '#12231e';
          ctx.fillRect(side * 72 - (side > 0 ? 20 : 0), -105, 20, 9);
          for (let i = 0; i < 3; i += 1) {
            ctx.fillStyle = '#41685a';
            ctx.fillRect(side * 74 - (side > 0 ? 18 : 0) + i * 6, -103, 3, 5);
          }
        };
        wing(-1);
        wing(1);
        ctx.fillStyle = '#0d1d19';
        ctx.fillRect(-48, -100, 96, 22);
        ctx.fillStyle = '#4ff5df';
        ctx.fillRect(-31, -94, 62, 4);
        ctx.fillStyle = 'rgba(79,245,223,0.34)';
        ctx.fillRect(-26, -88, 52, 2);
        // vents
        for (let i = 0; i < 5; i += 1) {
          ctx.fillStyle = i % 2 ? '#162c26' : '#25443b';
          ctx.fillRect(-38 + i * 16, -134, 9, 20);
        }
        // side rails
        ctx.fillStyle = '#0a1512';
        ctx.fillRect(-72, -150, 10, 62);
        ctx.fillRect(62, -150, 10, 62);
        ctx.fillStyle = '#6dffce';
        ctx.fillRect(-71, -144, 3, 34);
        ctx.fillRect(68, -144, 3, 34);

        // barrel
        ctx.fillStyle = '#08110f';
        ctx.beginPath();
        ctx.moveTo(-43, -176);
        ctx.lineTo(43, -176);
        ctx.lineTo(30, -326);
        ctx.lineTo(-30, -326);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#24463d';
        ctx.beginPath();
        ctx.moveTo(-34, -182);
        ctx.lineTo(34, -182);
        ctx.lineTo(24, -318);
        ctx.lineTo(-24, -318);
        ctx.closePath();
        ctx.fill();
        // glowing coils
        for (let i = 0; i < 4; i += 1) {
          const y = -218 - i * 25;
          const ww = 29 - i * 3;
          ctx.fillStyle = '#0d2420';
          ctx.fillRect(-ww - 5, y - 6, ww * 2 + 10, 13);
          ctx.fillStyle = '#3ee8cf';
          ctx.fillRect(-ww, y - 3, ww * 2, 6);
          ctx.fillStyle = '#c7fff6';
          ctx.fillRect(-ww + 4, y - 3, ww * 2 - 8, 2);
        }
        // core
        ctx.fillStyle = '#07110f';
        ctx.beginPath();
        ctx.moveTo(0, -130);
        ctx.lineTo(18, -150);
        ctx.lineTo(0, -170);
        ctx.lineTo(-18, -150);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#4ff5df';
        ctx.beginPath();
        ctx.moveTo(0, -137);
        ctx.lineTo(12, -150);
        ctx.lineTo(0, -163);
        ctx.lineTo(-12, -150);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e5fffb';
        ctx.fillRect(-2, -152, 4, 7);

        // muzzle ring
        ctx.fillStyle = '#172a26';
        ctx.fillRect(-34, -330, 68, 12);
        ctx.fillStyle = '#4ff5df';
        ctx.fillRect(-28, -326, 56, 4);
        ctx.fillStyle = '#050b09';
        ctx.beginPath();
        ctx.ellipse(0, -332, 16, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#7a988b';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CD-7 // PLASMA', 0, -55);

        if (muzzle > 0) this.drawMuzzleFlash(ctx, 0, -338, 1, '#63ffd3');
      };

      const drawShotgun = () => {
        this.drawGlove(ctx, -118, -106, -1);
        this.drawGlove(ctx, 74, -150, 1);

        // stock / receiver
        ctx.fillStyle = '#0d0b08';
        ctx.beginPath();
        ctx.moveTo(-88, -28);
        ctx.lineTo(88, -28);
        ctx.lineTo(76, -155);
        ctx.lineTo(48, -188);
        ctx.lineTo(-48, -188);
        ctx.lineTo(-76, -155);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#3d2d20';
        ctx.beginPath();
        ctx.moveTo(-74, -44);
        ctx.lineTo(74, -44);
        ctx.lineTo(63, -148);
        ctx.lineTo(41, -176);
        ctx.lineTo(-41, -176);
        ctx.lineTo(-63, -148);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#6a5138';
        ctx.fillRect(-58, -70, 116, 10);
        ctx.fillStyle = '#241a12';
        ctx.fillRect(-54, -108, 108, 26);
        ctx.fillStyle = '#ffb52e';
        ctx.fillRect(-43, -102, 86, 3);
        ctx.fillStyle = '#13100c';
        ctx.fillRect(-48, -140, 96, 24);
        for (let i = 0; i < 4; i += 1) {
          ctx.fillStyle = i % 2 ? '#5a432e' : '#39291b';
          ctx.fillRect(-42 + i * 22, -134, 14, 12);
        }

        // twin barrels
        const barrel = (x) => {
          ctx.fillStyle = '#080b0a';
          ctx.fillRect(x - 20, -332, 40, 158);
          ctx.fillStyle = '#2d3b36';
          ctx.fillRect(x - 15, -326, 30, 148);
          ctx.fillStyle = '#556b62';
          ctx.fillRect(x - 12, -322, 4, 138);
          ctx.fillStyle = '#0b1210';
          ctx.fillRect(x - 13, -312, 26, 7);
          ctx.fillRect(x - 13, -286, 26, 5);
          ctx.fillRect(x - 13, -224, 26, 6);
          ctx.fillStyle = '#ffb52e';
          ctx.fillRect(x - 8, -288, 16, 3);
          ctx.fillStyle = '#050807';
          ctx.beginPath();
          ctx.ellipse(x, -334, 14, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        };
        barrel(-25);
        barrel(25);

        // pump
        ctx.fillStyle = '#14100b';
        ctx.fillRect(-68, -228, 136, 24);
        ctx.fillStyle = '#4b3724';
        ctx.fillRect(-60, -224, 120, 15);
        for (let i = 0; i < 9; i += 1) {
          ctx.fillStyle = i % 2 ? '#61472f' : '#332419';
          ctx.fillRect(-56 + i * 13, -222, 5, 12);
        }

        // shells
        ctx.fillStyle = '#8f1f1b';
        ctx.fillRect(52, -190, 13, 28);
        ctx.fillRect(37, -190, 13, 28);
        ctx.fillStyle = '#ffb52e';
        ctx.fillRect(52, -190, 13, 7);
        ctx.fillRect(37, -190, 13, 7);

        ctx.fillStyle = '#b0a58f';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SUPER 12G // CD-7', 0, -56);

        if (muzzle > 0) {
          this.drawMuzzleFlash(ctx, -25, -340, 0.9, '#ffb52e');
          this.drawMuzzleFlash(ctx, 25, -340, 0.9, '#ffb52e');
          this.drawMuzzleFlash(ctx, 0, -304, 1.3, '#ff7a2e');
        }
      };

      if (weapon.id === 'shotgun') drawShotgun(); else drawPlasma();
      ctx.restore();
    }

    drawGlove(ctx, x, y, dir) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(dir, 1);
      ctx.fillStyle = '#07100d';
      ctx.beginPath();
      ctx.moveTo(-8, 52);
      ctx.lineTo(6, 26);
      ctx.lineTo(44, 4);
      ctx.lineTo(54, 18);
      ctx.lineTo(34, 42);
      ctx.lineTo(42, 60);
      ctx.lineTo(10, 78);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#294239';
      ctx.beginPath();
      ctx.moveTo(2, 42);
      ctx.lineTo(14, 28);
      ctx.lineTo(40, 12);
      ctx.lineTo(46, 19);
      ctx.lineTo(28, 38);
      ctx.lineTo(34, 54);
      ctx.lineTo(12, 66);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3f6053';
      ctx.fillRect(14, 27, 20, 4);
      ctx.fillRect(4, 43, 16, 4);
      ctx.fillStyle = '#8dff5a';
      ctx.fillRect(41, 12, 4, 6);
      ctx.fillStyle = '#0c1713';
      ctx.fillRect(20, 38, 5, 16);
      ctx.restore();
    }

    drawMuzzleFlash(ctx, x, y, scale, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 76);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.18, color);
      grad.addColorStop(0.5, withAlpha(color, 0.34));
      grad.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 76, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fffbe8';
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2 + 0.2;
        const len = i % 2 ? 38 : 62;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(0, -len);
        ctx.lineTo(5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    drawMinimap(game) {
      const ctx = this.minimapCtx;
      const size = 180;
      const level = game.level;
      const scale = size / level.size;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#04100b';
      ctx.fillRect(0, 0, size, size);

      for (let gz = 0; gz < level.size; gz += 1) {
        for (let gx = 0; gx < level.size; gx += 1) {
          const x = gx * scale;
          const y = gz * scale;
          if (level.grid[gz][gx] === 1) {
            ctx.fillStyle = '#142a20';
            ctx.fillRect(x, y, scale + 0.25, scale + 0.25);
            ctx.fillStyle = 'rgba(141,255,90,0.06)';
            ctx.fillRect(x, y, scale + 0.25, 0.6);
          } else {
            ctx.fillStyle = '#071a12';
            ctx.fillRect(x, y, scale, scale);
          }
        }
      }
      // grid
      ctx.strokeStyle = 'rgba(141,255,90,0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= level.size; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * scale, 0);
        ctx.lineTo(i * scale, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * scale);
        ctx.lineTo(size, i * scale);
        ctx.stroke();
      }

      const toMap = (x, z) => ({
        x: (x + level.half) / (level.size * CELL) * size,
        y: (z + level.half) / (level.size * CELL) * size
      });

      // pickups
      for (const pickup of game.pickups) {
        if (pickup.taken) continue;
        const p = toMap(pickup.position.x, pickup.position.z);
        ctx.fillStyle = pickup.config.color;
        ctx.globalAlpha = 0.65;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        ctx.globalAlpha = 1;
      }

      // enemies
      for (const enemy of game.enemies) {
        if (enemy.dead) continue;
        const dist = Math.hypot(enemy.position.x - game.player.position.x, enemy.position.z - game.player.position.z);
        if (dist > 24 && enemy.state !== 'chase') continue;
        const p = toMap(enemy.position.x, enemy.position.z);
        ctx.fillStyle = enemy.typeId === 'heavy' ? '#ffb52e' : enemy.typeId === 'hound' ? '#ff7180' : '#ff3b50';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, enemy.typeId === 'heavy' ? 3 : 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // exit
      const exit = toMap(level.exitWorld.x, level.exitWorld.z);
      const pulse = 0.55 + Math.sin(game.elapsed * 4) * 0.3;
      ctx.strokeStyle = game.level.exitUnlocked ? '#8dff5a' : '#ff3b50';
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(exit.x - 4, exit.y - 4, 8, 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = game.level.exitUnlocked ? '#8dff5a' : '#ff3b50';
      ctx.fillRect(exit.x - 1.5, exit.y - 1.5, 3, 3);

      // player
      const player = toMap(game.player.position.x, game.player.position.z);
      const dir = game.getLookDirection();
      const angle = Math.atan2(dir.z, dir.x);
      ctx.save();
      ctx.translate(player.x, player.y);
      // FOV wedge
      ctx.fillStyle = 'rgba(79,245,223,0.09)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 20, angle - 0.48, angle + 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(angle);
      ctx.fillStyle = '#4ff5df';
      ctx.shadowColor = '#4ff5df';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -3.5);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // scanning line
      const scanY = (game.elapsed * 24) % size;
      ctx.fillStyle = 'rgba(141,255,90,0.06)';
      ctx.fillRect(0, scanY, size, 1);
      // corner brackets
      ctx.strokeStyle = 'rgba(141,255,90,0.35)';
      ctx.lineWidth = 1;
      const b = 8;
      ctx.beginPath();
      ctx.moveTo(0, b); ctx.lineTo(0, 0); ctx.lineTo(b, 0);
      ctx.moveTo(size - b, 0); ctx.lineTo(size, 0); ctx.lineTo(size, b);
      ctx.moveTo(0, size - b); ctx.lineTo(0, size); ctx.lineTo(b, size);
      ctx.moveTo(size - b, size); ctx.lineTo(size, size); ctx.lineTo(size, size - b);
      ctx.stroke();
    }
  }

  /* ============================== SAVE SANITISATION ============================== */

  function sanitiseRun(input) {
    if (!input || typeof input !== 'object') return null;
    const rawLevel = Number(input.level);
    if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel >= LEVELS.length) return null;
    const level = rawLevel;
    const seed = Math.floor(sanitiseNumber(input.seed, 1, 1, 4294967295));
    const playerRaw = input.player && typeof input.player === 'object' ? input.player : {};
    const weaponsRaw = input.weapons && typeof input.weapons === 'object' ? input.weapons : {};
    const statsRaw = input.stats && typeof input.stats === 'object' ? input.stats : {};
    const current = weaponsRaw.current === 'shotgun' ? 'shotgun' : 'plasma';
    const plasmaAmmo = Math.round(sanitiseNumber(weaponsRaw.plasma && weaponsRaw.plasma.ammo, 80, 0, WEAPONS.plasma.maxAmmo));
    const shotgunAmmo = Math.round(sanitiseNumber(weaponsRaw.shotgun && weaponsRaw.shotgun.ammo, 12, 0, WEAPONS.shotgun.maxAmmo));
    const enemies = Array.isArray(input.enemies)
      ? input.enemies.slice(0, 60).map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const type = ENEMY_TYPES[raw.type] ? raw.type : 'trooper';
        const typeConfig = ENEMY_TYPES[type];
        return {
          type,
          x: sanitiseNumber(raw.x, 0, -500, 500),
          z: sanitiseNumber(raw.z, 0, -500, 500),
          health: Math.round(sanitiseNumber(raw.health, typeConfig.hp, 0, typeConfig.hp)),
          state: typeof raw.state === 'string' ? raw.state.slice(0, 20) : 'idle',
          dead: Boolean(raw.dead) || Number(raw.health) <= 0
        };
      }).filter(Boolean)
      : null;
    const pickups = Array.isArray(input.pickups)
      ? input.pickups.slice(0, 60).map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const type = PICKUP_TYPES[raw.type] ? raw.type : null;
        if (!type) return null;
        return {
          type,
          x: sanitiseNumber(raw.x, 0, -500, 500),
          z: sanitiseNumber(raw.z, 0, -500, 500),
          taken: Boolean(raw.taken)
        };
      }).filter(Boolean)
      : null;

    return {
      schema: SAVE_SCHEMA,
      version: VERSION,
      savedAt: sanitiseString(input.savedAt, nowIso(), 40),
      level,
      seed,
      player: {
        x: sanitiseNumber(playerRaw.x, 0, -500, 500),
        z: sanitiseNumber(playerRaw.z, 0, -500, 500),
        y: sanitiseNumber(playerRaw.y, 0, 0, 6),
        yaw: sanitiseNumber(playerRaw.yaw, 0, -Math.PI * 2, Math.PI * 2),
        pitch: sanitiseNumber(playerRaw.pitch, 0, -1.45, 1.45),
        health: sanitiseNumber(playerRaw.health, 100, 1, 100),
        armor: sanitiseNumber(playerRaw.armor, 0, 0, 100),
        hasPosition: Number.isFinite(Number(playerRaw.x)) && Number.isFinite(Number(playerRaw.z))
      },
      weapons: {
        current,
        plasma: { ammo: plasmaAmmo },
        shotgun: { ammo: shotgunAmmo }
      },
      stats: {
        score: Math.round(sanitiseNumber(statsRaw.score, 0, 0, 99999999)),
        kills: Math.round(sanitiseNumber(statsRaw.kills, 0, 0, 99999)),
        shotsFired: Math.round(sanitiseNumber(statsRaw.shotsFired, 0, 0, 999999)),
        shotsHit: Math.round(sanitiseNumber(statsRaw.shotsHit, 0, 0, 999999)),
        timePlayed: sanitiseNumber(statsRaw.timePlayed, 0, 0, 864000)
      },
      enemies,
      pickups
    };
  }

  /* ============================== POINTER LOCK FALLBACK ============================== */

  class FallbackPointerControls {
    constructor(camera, domElement) {
      this.camera = camera;
      this.domElement = domElement;
      this.pointerSpeed = 1;
      this.isLocked = false;
      this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
      this.onMouseMove = this.onMouseMove.bind(this);
      this.onLockChange = this.onLockChange.bind(this);
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('pointerlockchange', this.onLockChange);
    }

    onLockChange() {
      this.isLocked = document.pointerLockElement === this.domElement;
    }

    onMouseMove(event) {
      if (!this.isLocked) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= event.movementX * 0.002 * this.pointerSpeed;
      this.euler.x -= event.movementY * 0.002 * this.pointerSpeed;
      this.euler.x = clamp(this.euler.x, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
      this.camera.quaternion.setFromEuler(this.euler);
    }

    lock() {
      if (this.domElement.requestPointerLock) this.domElement.requestPointerLock();
    }

    unlock() {
      if (document.exitPointerLock) document.exitPointerLock();
    }

    getObject() {
      return this.camera;
    }
  }

  /* ============================== GAME ============================== */

  class Game {
    constructor() {
      this.version = VERSION;
      this.mode = 'boot';
      this.canvas = $('#game-canvas');
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.hud = null;
      this.level = null;
      this.levelIndex = 0;
      this.levelSeed = 1;
      this.enemies = [];
      this.projectiles = [];
      this.pickups = [];
      this.worldGroup = null;
      this.particles = null;
      this.tracers = null;
      this.ambientLights = [];
      this.assets = { enemy: new Map(), pickup: new Map(), glow: new Map() };
      this.audio = audio;
      this.baseFov = 72;
      this.fovKick = 0;
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      this.isHeadless = /HeadlessChrome/i.test(navigator.userAgent) || navigator.webdriver === true;
      this.pointerLocked = false;
      this.lockRequested = false;
      this.touchMove = { x: 0, y: 0 };
      this.touchFire = false;
      this.touchPointer = null;
      this.lookPointer = null;
      this.lastPointer = { x: 0, y: 0 };
      this.keys = new Set();
      this.jumpQueued = false;
      this.shake = 0;
      this.wasShaking = false;
      this.muzzleTimer = 0;
      this.weaponRecoil = 0;
      this.weaponRaise = 1;
      this.fireCooldown = 0;
      this.score = 0;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.timePlayed = 0;
      this.elapsed = 0;
      this.autosaveTimer = 0;
      this.deathTimer = 0;
      this.recordedScore = -1;
      this.lastFrame = 0;
      this.bobPhase = 0;
      this.stepTimer = 0;
      this.flashlightOn = true;
      this.pendingAutosave = null;
      this.messageCooldown = 0;
      this.player = {
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(),
        verticalVelocity: 0,
        onGround: true,
        health: 100,
        armor: 0,
        dead: false,
        bobPhase: 0
      };
      this.weapons = {
        current: 'plasma',
        plasma: { ammo: 120 },
        shotgun: { ammo: 24 }
      };
      this.init();
    }

    init() {
      if (typeof THREE === 'undefined') {
        this.fatal('Three.js could not be loaded from the CDN. Check your network connection and reload.');
        return;
      }
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false
        });
      } catch (err) {
        this.fatal('This browser could not initialise WebGL. Enable hardware acceleration or try a current browser.');
        return;
      }
      this.renderer.setPixelRatio(1);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.setClearColor(0x020403, 1);
      this.renderer.autoClear = true;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x020403);
      this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 70);
      this.camera.rotation.order = 'YXZ';
      this.camera.position.set(0, EYE_HEIGHT, 6);
      this.scene.add(this.camera);

      this.worldGroup = new THREE.Group();
      this.scene.add(this.worldGroup);

      const Controls = THREE.PointerLockControls || FallbackPointerControls;
      this.controls = new Controls(this.camera, this.renderer.domElement);
      if (this.controls.pointerSpeed !== undefined) this.controls.pointerSpeed = settings.sensitivity;
      // r128 ignores the Promise returned by requestPointerLock on current browsers.
      // Wrap it so a blocked lock request never becomes an unhandled rejection.
      this.controls.lock = () => {
        try {
          if (!this.renderer.domElement.requestPointerLock) return;
          const request = this.renderer.domElement.requestPointerLock();
          if (request && typeof request.catch === 'function') request.catch(() => { this.lockRequested = false; });
        } catch (err) {
          this.lockRequested = false;
        }
      };

      this.flashlight = new THREE.SpotLight(0xcaffdf, 1.05, 18, 0.58, 0.62, 1.7);
      this.flashlight.position.set(0.15, -0.16, -0.12);
      this.flashlight.target.position.set(0, -0.12, -8);
      this.flashlight.castShadow = false;
      this.camera.add(this.flashlight);
      this.camera.add(this.flashlight.target);

      this.muzzleLight = new THREE.PointLight(0x8dff5a, 0, 7, 2);
      this.muzzleLight.position.set(0.22, -0.12, -1.05);
      this.camera.add(this.muzzleLight);

      this.particles = new ParticleField(this.scene);
      this.tracers = new TracerPool(this.scene);
      this.hud = new HUD(this);
      window.gameAudio = audio;
      this.audio.setVolume(settings.volume);
      this.audio.setMuted(settings.muted);

      this.bindEvents();
      this.applySettings(true);
      this.resize();
      this.updateTitleRecords();
      this.updateContinueButton();
      this.showTitle();
      this.boot();
      this.lastFrame = performance.now();
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }

    fatal(message) {
      const loading = $('#screen-loading');
      if (loading) loading.classList.remove('is-active');
      const fatal = $('#fatal-error');
      if (fatal) fatal.classList.remove('is-hidden');
      const msg = $('#fatal-message');
      if (msg && message) msg.textContent = message;
      this.mode = 'fatal';
    }

    /* ============================== UI / SETTINGS / EVENTS ============================== */

    bindEvents() {
      const bind = (selector, event, handler) => {
        const element = $(selector);
        if (element) element.addEventListener(event, handler);
      };

      bind('#btn-new', 'click', () => this.startNew());
      bind('#btn-continue', 'click', () => this.continueRun());
      bind('#btn-load-file', 'click', () => this.openFilePicker());
      bind('#btn-pause-load', 'click', () => this.openFilePicker());
      bind('#btn-pause-save', 'click', () => this.exportSave());
      bind('#btn-pause-quit', 'click', () => this.returnToTitle());
      bind('#btn-resume', 'click', () => this.resumeGame());
      bind('#btn-level-next', 'click', () => this.nextLevel());
      bind('#btn-victory-new', 'click', () => this.startNew());
      bind('#btn-victory-save', 'click', () => this.exportSave());
      bind('#btn-victory-title', 'click', () => this.returnToTitle());
      bind('#btn-gameover-retry', 'click', () => this.retrySector());
      bind('#btn-gameover-title', 'click', () => this.returnToTitle());
      bind('#import-file', 'change', (event) => this.importFile(event));

      bind('#setting-sensitivity', 'input', (event) => {
        settings.sensitivity = Number(event.target.value);
        const label = $('#setting-sensitivity-value');
        if (label) label.textContent = settings.sensitivity.toFixed(2);
        if (this.controls && this.controls.pointerSpeed !== undefined) this.controls.pointerSpeed = settings.sensitivity;
        saveSettings();
      });
      bind('#setting-volume', 'input', (event) => {
        settings.volume = Number(event.target.value);
        const label = $('#setting-volume-value');
        if (label) label.textContent = String(settings.volume);
        this.audio.setVolume(settings.volume);
        if (settings.muted && settings.volume > 0) {
          this.audio.setMuted(false);
          settings.muted = false;
        }
        saveSettings();
      });
      bind('#setting-pixel', 'input', (event) => {
        settings.pixelScale = Number(event.target.value) / 100;
        const label = $('#setting-pixel-value');
        if (label) label.textContent = `${event.target.value}%`;
        this.resize();
        saveSettings();
      });
      bind('#setting-shake', 'change', (event) => {
        settings.shake = event.target.checked;
        const label = $('#setting-shake-value');
        if (label) label.textContent = settings.shake ? 'ON' : 'OFF';
        this.applySettings();
        saveSettings();
      });

      document.addEventListener('keydown', (event) => this.onKeyDown(event));
      document.addEventListener('keyup', (event) => this.onKeyUp(event));
      document.addEventListener('mousedown', (event) => this.onMouseDown(event));
      document.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
      document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
      document.addEventListener('pointerlockerror', () => this.onPointerLockError());
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('blur', () => {
        this.keys.clear();
        if (this.mode === 'playing') this.pauseGame();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.mode === 'playing') this.pauseGame();
      });
      window.addEventListener('beforeunload', () => {
        if (this.mode === 'playing' || this.mode === 'paused') this.autosave(true);
      });
      this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
      this.canvas.addEventListener('click', () => {
        if (this.mode === 'playing' && !this.pointerLocked && !this.isTouch) this.requestLock();
      });

      this.setupTouchControls();
      if (this.isTouch) {
        this.showTouch();
        const note = $('.menu-note');
        if (note) note.innerHTML = '<span class="note-key">TAP</span> to deploy &middot; drag to look &middot; pads to move &amp; fire';
        const layoutNote = $('.brief-list');
        if (layoutNote) layoutNote.setAttribute('aria-label', 'Touch controls active');
      }
    }

    applySettings(initial = false) {
      if (this.controls && this.controls.pointerSpeed !== undefined) this.controls.pointerSpeed = settings.sensitivity;
      this.audio.setVolume(settings.volume);
      this.audio.setMuted(settings.muted);
      const sens = $('#setting-sensitivity');
      const sensLabel = $('#setting-sensitivity-value');
      if (sens) sens.value = String(settings.sensitivity);
      if (sensLabel) sensLabel.textContent = settings.sensitivity.toFixed(2);
      const vol = $('#setting-volume');
      const volLabel = $('#setting-volume-value');
      if (vol) vol.value = String(settings.volume);
      if (volLabel) volLabel.textContent = String(settings.volume);
      const pixel = $('#setting-pixel');
      const pixelLabel = $('#setting-pixel-value');
      if (pixel) pixel.value = String(Math.round(settings.pixelScale * 100));
      if (pixelLabel) pixelLabel.textContent = `${Math.round(settings.pixelScale * 100)}%`;
      const shake = $('#setting-shake');
      if (shake) shake.checked = settings.shake;
      const shakeLabel = $('#setting-shake-value');
      if (shakeLabel) shakeLabel.textContent = settings.shake ? 'ON' : 'OFF';
      document.body.classList.toggle('reduced-fx', !settings.shake);
      if (!initial) this.resize();
      saveSettings();
    }

    resize() {
      if (!this.renderer || !this.camera) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      let scale = settings.pixelScale;
      if (width * scale > 1920) scale = 1920 / width;
      if (height * scale > 1200) scale = Math.min(scale, 1200 / height);
      scale = Math.max(0.42, scale);
      this.renderer.setSize(Math.max(320, Math.floor(width * scale)), Math.max(240, Math.floor(height * scale)), false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    onKeyDown(event) {
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((tag === 'BUTTON' || tag === 'A') && (event.code === 'Space' || event.code === 'Enter')) return;
      const code = event.code;

      if (code === 'Space') event.preventDefault();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) event.preventDefault();

      if (this.mode === 'title') {
        if (code === 'Enter') { event.preventDefault(); this.startNew(); }
        return;
      }
      if (this.mode === 'levelclear' && (code === 'Enter' || code === 'Space')) { event.preventDefault(); this.nextLevel(); return; }
      if (this.mode === 'gameover' && (code === 'Enter' || code === 'Space')) { event.preventDefault(); this.retrySector(); return; }
      if (this.mode === 'victory' && code === 'Enter') { event.preventDefault(); this.startNew(); return; }

      if (this.mode === 'paused') {
        if (code === 'KeyP' || code === 'Escape') { event.preventDefault(); this.resumeGame(); }
        return;
      }
      if (this.mode !== 'playing') return;

      this.keys.add(code);
      if (event.repeat) return;

      if (code === 'Space') {
        if (!this.tryInteract()) this.jumpQueued = true;
      } else if (code === 'Digit1') {
        this.switchWeapon('plasma');
      } else if (code === 'Digit2') {
        this.switchWeapon('shotgun');
      } else if (code === 'KeyQ') {
        this.switchWeapon(this.weapons.current === 'plasma' ? 'shotgun' : 'plasma');
      } else if (code === 'KeyF') {
        this.toggleFlashlight();
      } else if (code === 'KeyM') {
        this.toggleMute();
      } else if (code === 'Escape' || code === 'KeyP') {
        this.pauseGame();
      }
    }

    onKeyUp(event) {
      this.keys.delete(event.code);
    }

    onMouseDown(event) {
      if (event.button !== 0) return;
      if (this.mode !== 'playing' || this.isTouch) return;
      if (!this.pointerLocked) {
        this.requestLock();
        return;
      }
      this.fire();
    }

    onWheel(event) {
      if (this.mode !== 'playing') return;
      event.preventDefault();
      this.switchWeapon(this.weapons.current === 'plasma' ? 'shotgun' : 'plasma');
    }

    onPointerLockChange() {
      const locked = document.pointerLockElement === this.renderer.domElement;
      this.pointerLocked = locked;
      if (locked) {
        this.lockRequested = false;
        if (this.mode === 'paused') {
          this.mode = 'playing';
          this.hideScreens();
          this.audio.setDucked(false);
        }
      } else if (this.mode === 'playing' && !this.isTouch) {
        this.pauseGame();
      }
    }

    onPointerLockError() {
      this.lockRequested = false;
      if (this.mode === 'playing') this.hud.toast('Mouse capture blocked — click the viewport to retry', true);
    }

    requestLock() {
      if (this.isTouch || !this.controls || this.isHeadless) return;
      this.lockRequested = true;
      try {
        this.controls.lock();
      } catch (err) {
        this.lockRequested = false;
      }
    }

    setupTouchControls() {
      const moveZone = $('#touch-move-zone');
      const stick = $('#touch-stick');
      const stickKnob = stick ? stick.querySelector('i') : null;
      const lookZone = $('#touch-look-zone');
      const fire = $('#touch-fire');
      const jump = $('#touch-jump');
      const swap = $('#touch-swap');

      const resetStick = () => {
        this.touchMove.x = 0;
        this.touchMove.y = 0;
        this.touchPointer = null;
        if (stickKnob) stickKnob.style.transform = 'translate(0px, 0px)';
      };

      if (moveZone) {
        moveZone.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.touchPointer = event.pointerId;
          moveZone.setPointerCapture(event.pointerId);
          const rect = moveZone.getBoundingClientRect();
          this.touchStart = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        moveZone.addEventListener('pointermove', (event) => {
          if (this.touchPointer !== event.pointerId || !this.touchStart) return;
          event.preventDefault();
          let dx = event.clientX - this.touchStart.x;
          let dy = event.clientY - this.touchStart.y;
          const max = 40;
          const dist = Math.hypot(dx, dy);
          if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
          this.touchMove.x = dx / max;
          this.touchMove.y = -dy / max;
          if (stickKnob) stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        });
        const end = (event) => {
          if (this.touchPointer !== event.pointerId) return;
          resetStick();
        };
        moveZone.addEventListener('pointerup', end);
        moveZone.addEventListener('pointercancel', end);
        moveZone.addEventListener('lostpointercapture', end);
      }

      if (lookZone) {
        lookZone.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.lookPointer = event.pointerId;
          this.lastPointer.x = event.clientX;
          this.lastPointer.y = event.clientY;
          lookZone.setPointerCapture(event.pointerId);
        });
        lookZone.addEventListener('pointermove', (event) => {
          if (this.lookPointer !== event.pointerId) return;
          event.preventDefault();
          const dx = event.clientX - this.lastPointer.x;
          const dy = event.clientY - this.lastPointer.y;
          this.lastPointer.x = event.clientX;
          this.lastPointer.y = event.clientY;
          this.lookYaw -= dx * 0.0048 * settings.sensitivity;
          this.lookPitch -= dy * 0.0048 * settings.sensitivity;
          this.lookPitch = clamp(this.lookPitch, -1.35, 1.35);
          this.applyTouchLook();
        });
        const end = (event) => {
          if (this.lookPointer === event.pointerId) this.lookPointer = null;
        };
        lookZone.addEventListener('pointerup', end);
        lookZone.addEventListener('pointercancel', end);
        lookZone.addEventListener('lostpointercapture', end);
      }

      if (fire) {
        fire.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.touchFire = true;
          this.fire();
        });
        const release = () => { this.touchFire = false; };
        fire.addEventListener('pointerup', release);
        fire.addEventListener('pointercancel', release);
        fire.addEventListener('pointerleave', release);
      }
      if (jump) {
        jump.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          if (!this.tryInteract()) this.jumpQueued = true;
        });
      }
      if (swap) {
        swap.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.switchWeapon(this.weapons.current === 'plasma' ? 'shotgun' : 'plasma');
        });
      }
    }

    applyTouchLook() {
      if (!this.camera) return;
      const euler = new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }

    showTouch() {
      const ui = $('#touch-ui');
      if (ui) ui.classList.remove('is-hidden');
    }

    hideTouch() {
      const ui = $('#touch-ui');
      if (ui) ui.classList.add('is-hidden');
    }

    tryInteract() {
      if (!this.level || this.mode !== 'playing') return false;
      const distance = Math.hypot(
        this.player.position.x - this.level.exitWorld.x,
        this.player.position.z - this.level.exitWorld.z
      );
      if (distance < 3.6) {
        if (this.level.exitUnlocked) {
          this.completeLevel();
        } else {
          this.hud.message(`EXIT SEALED // ${this.aliveEnemyCount()} HOSTILES REMAIN`, 'warn', 2200);
        }
        return true;
      }
      return false;
    }

    toggleFlashlight() {
      this.flashlightOn = !this.flashlightOn;
      if (this.flashlight) this.flashlight.intensity = this.flashlightOn ? 1.05 : 0;
      this.hud.message(this.flashlightOn ? 'SUIT FLOODLIGHT ONLINE' : 'SUIT FLOODLIGHT OFFLINE', 'system', 1600);
    }

    toggleMute() {
      const muted = this.audio.toggleMuted();
      settings.muted = muted;
      saveSettings();
      this.hud.toast(muted ? 'AUDIO MUTED' : 'AUDIO ONLINE');
    }

    /* ============================== SCREENS / BOOT ============================== */

    hideScreens() {
      $$('.screen').forEach((screen) => screen.classList.remove('is-active'));
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
        document.activeElement.blur();
      }
    }

    showScreen(id) {
      this.hideScreens();
      const screen = document.getElementById(id);
      if (screen) screen.classList.add('is-active');
    }

    boot() {
      const bar = $('#boot-bar');
      const status = $('#boot-status');
      const steps = [
        'MOUNTING CARTRIDGE',
        'SPINNING UP RENDER CORE',
        'SYNTHESISING WEAPON AUDIO',
        'CALIBRATING RETINA TRACKER',
        'ARMING COMBAT SIMULATION'
      ];
      let progress = 6;
      let index = 0;
      const timer = window.setInterval(() => {
        progress = Math.min(100, progress + rand(9, 23));
        if (bar) bar.style.width = `${progress}%`;
        if (status && progress < 96) {
          index = Math.min(steps.length - 1, Math.floor(progress / 21));
          status.textContent = steps[index];
        }
        if (progress >= 100) {
          window.clearInterval(timer);
          if (status) status.textContent = 'SYSTEM READY // ENGAGE';
          window.setTimeout(() => {
            const loading = $('#screen-loading');
            if (loading) loading.classList.remove('is-active');
            if (this.mode === 'title') this.showTitle();
          }, 460);
        }
      }, 110);
    }

    showTitle() {
      this.mode = 'title';
      this.hideTouch();
      this.hud.hide();
      this.audio.setDucked(true);
      this.showScreen('screen-start');
      this.updateTitleRecords();
      this.updateContinueButton();
    }

    updateTitleRecords() {
      const tbody = $('#title-records');
      if (!tbody) return;
      const scores = loadHighScores();
      tbody.textContent = '';
      if (!scores.length) {
        const row = document.createElement('tr');
        row.className = 'empty-row';
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'NO COMBAT RECORDS // BE THE FIRST';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
      }
      scores.slice(0, 5).forEach((entry, index) => {
        const row = document.createElement('tr');
        [String(index + 1).padStart(2, '0'), formatNumber(entry.score), String(entry.kills), pad(entry.level), entry.date].forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
    }

    updateContinueButton() {
      const button = $('#btn-continue');
      const detail = $('#continue-detail');
      const data = sanitiseRun(readJson(STORAGE_KEYS.autosave, null));
      this.pendingAutosave = data;
      if (button) button.disabled = !data;
      if (detail) {
        detail.textContent = data
          ? `SECTOR ${pad(data.level + 1)} // ${formatNumber(data.stats.score)} PTS // ${data.stats.kills} KILLS`
          : 'No autosave detected';
      }
    }

    openFilePicker() {
      const input = $('#import-file');
      if (input) {
        input.value = '';
        input.click();
      }
    }

    showHUD() {
      this.hud.show();
      if (this.isTouch) this.showTouch();
    }

    /* ============================== ASSETS ============================== */

    getEnemyTexture(type) {
      if (!this.assets.enemy.has(type)) this.assets.enemy.set(type, TextureFactory.enemyAtlas(type));
      return this.assets.enemy.get(type);
    }

    getPickupTexture(type) {
      if (!this.assets.pickup.has(type)) this.assets.pickup.set(type, TextureFactory.pickup(type));
      return this.assets.pickup.get(type);
    }

    getGlowTexture(color) {
      const css = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : String(color);
      const key = css.toLowerCase();
      if (!this.assets.glow.has(key)) this.assets.glow.set(key, TextureFactory.glow(css, 64));
      return this.assets.glow.get(key);
    }

    /* ============================== RUN LIFECYCLE ============================== */

    resetRun() {
      this.score = 0;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.timePlayed = 0;
      this.elapsed = 0;
      this.autosaveTimer = 0;
      this.recordedScore = -1;
      this.player.health = 100;
      this.player.armor = 0;
      this.player.dead = false;
      this.player.position.set(0, 0, 0);
      this.player.velocity.set(0, 0, 0);
      this.player.verticalVelocity = 0;
      this.player.onGround = true;
      this.weapons = {
        current: 'plasma',
        plasma: { ammo: 120 },
        shotgun: { ammo: 24 }
      };
    }

    startNew() {
      this.audio.ensure();
      this.audio.setDucked(false);
      this.resetRun();
      this.levelIndex = 0;
      this.levelSeed = (Math.random() * 4294967295) >>> 0;
      this.beginLevel(0, {});
      this.mode = 'playing';
      this.hideScreens();
      this.showHUD();
      this.weaponRaise = 0;
      this.audio.setDucked(false);
      this.hud.message('SECTOR 01 // DOCKING BAY SEVEN', 'system', 4600);
      this.hud.message('PURGE ALL HOSTILES TO UNSEAL THE EXIT', 'warn', 5400);
      if (!this.isTouch) this.hud.message('AUTOSAVE ONLINE // ESC TO PAUSE', '', 3800);
      this.autosave(true);
      this.requestLock();
    }

    continueRun() {
      const data = sanitiseRun(readJson(STORAGE_KEYS.autosave, null));
      if (!data) {
        this.hud.toast('NO VALID AUTOSAVE FOUND', true);
        this.updateContinueButton();
        return;
      }
      this.audio.ensure();
      this.audio.setDucked(false);
      this.applyRun(data);
      this.mode = 'playing';
      this.hideScreens();
      this.showHUD();
      this.hud.message(`AUTOSAVE RESTORED // SECTOR ${pad(data.level + 1)}`, 'system', 3800);
      this.hud.message(`${data.stats.kills} HOSTILES DOWN // ${formatNumber(data.stats.score)} PTS`, '', 3600);
      this.requestLock();
    }

    applyRun(data) {
      const run = sanitiseRun(data);
      if (!run) throw new Error('Invalid save data');
      this.score = run.stats.score;
      this.kills = run.stats.kills;
      this.shotsFired = run.stats.shotsFired;
      this.shotsHit = run.stats.shotsHit;
      this.timePlayed = run.stats.timePlayed;
      this.recordedScore = -1;
      this.weapons = {
        current: run.weapons.current,
        plasma: { ammo: run.weapons.plasma.ammo },
        shotgun: { ammo: run.weapons.shotgun.ammo }
      };
      this.levelIndex = run.level;
      this.beginLevel(run.level, {
        seed: run.seed,
        player: run.player,
        enemies: run.enemies,
        pickups: run.pickups
      });
      this.mode = 'playing';
      this.hideScreens();
      this.showHUD();
      this.audio.setDucked(false);
      this.autosaveTimer = 0;
    }

    beginLevel(index, options = {}) {
      this.disposeWorld();
      this.levelIndex = clamp(index, 0, LEVELS.length - 1);
      this.levelSeed = options.seed !== undefined ? (Number(options.seed) >>> 0) : (Math.random() * 4294967295) >>> 0;
      this.level = new DungeonLevel(this.levelIndex, this.levelSeed);
      this.level.build(this.scene);
      this.setupAmbient();

      if (options.stats) {
        this.score = Math.round(sanitiseNumber(options.stats.score, this.score, 0, 99999999));
        this.kills = Math.round(sanitiseNumber(options.stats.kills, this.kills, 0, 99999));
        this.shotsFired = Math.round(sanitiseNumber(options.stats.shotsFired, this.shotsFired, 0, 999999));
        this.shotsHit = Math.round(sanitiseNumber(options.stats.shotsHit, this.shotsHit, 0, 999999));
        this.timePlayed = sanitiseNumber(options.stats.timePlayed, this.timePlayed, 0, 864000);
      }
      if (options.weapons) {
        const raw = options.weapons;
        this.weapons.current = raw.current === 'shotgun' ? 'shotgun' : 'plasma';
        this.weapons.plasma.ammo = Math.round(sanitiseNumber(raw.plasma && raw.plasma.ammo, this.weapons.plasma.ammo, 0, WEAPONS.plasma.maxAmmo));
        this.weapons.shotgun.ammo = Math.round(sanitiseNumber(raw.shotgun && raw.shotgun.ammo, this.weapons.shotgun.ammo, 0, WEAPONS.shotgun.maxAmmo));
      }

      const playerRaw = options.player || {};
      if (playerRaw.health !== undefined) this.player.health = sanitiseNumber(playerRaw.health, this.player.health, 1, 100);
      if (playerRaw.armor !== undefined) this.player.armor = sanitiseNumber(playerRaw.armor, this.player.armor, 0, 100);
      this.player.dead = false;
      this.player.velocity.set(0, 0, 0);
      this.player.verticalVelocity = 0;
      this.player.onGround = true;
      this.player.bobPhase = 0;
      this.bobPhase = 0;

      const start = this.level.startWorld;
      let spawnX = start.x;
      let spawnZ = start.z;
      if (playerRaw.hasPosition && Number.isFinite(Number(playerRaw.x)) && Number.isFinite(Number(playerRaw.z))) {
        const candidateX = Number(playerRaw.x);
        const candidateZ = Number(playerRaw.z);
        if (!this.level.collides(candidateX, candidateZ, PLAYER_RADIUS)) {
          spawnX = candidateX;
          spawnZ = candidateZ;
        }
      }
      this.player.position.set(spawnX, sanitiseNumber(playerRaw.y, 0, 0, 1.4), spawnZ);
      this.player.health = Math.max(1, this.player.health);
      this.player.dead = false;

      if (options.enemies && Array.isArray(options.enemies)) {
        for (const raw of options.enemies) {
          if (!raw || !ENEMY_TYPES[raw.type]) continue;
          let ex = raw.x;
          let ez = raw.z;
          if (this.level.collides(ex, ez, 0.4)) {
            const fallback = pick(this.level.openCells);
            ex = fallback.x;
            ez = fallback.z;
          }
          const enemy = new Enemy(this, raw.type, ex, ez, {
            health: raw.health,
            state: raw.state,
            dead: raw.dead
          });
          this.enemies.push(enemy);
        }
      } else {
        this.generateEnemies();
      }

      if (options.pickups && Array.isArray(options.pickups)) {
        for (const raw of options.pickups) {
          if (!raw || !PICKUP_TYPES[raw.type]) continue;
          if (this.level.isWallAt(raw.x, raw.z)) continue;
          this.pickups.push(new Pickup(this, raw.type, raw.x, raw.z, { taken: raw.taken }));
        }
      } else {
        this.generatePickups();
      }

      this.level.setExitUnlocked(this.aliveEnemyCount() === 0, true);

      const exitWorld = this.level.exitWorld;
      let yaw = Math.atan2(-(exitWorld.x - spawnX), -(exitWorld.z - spawnZ));
      if (playerRaw.hasPosition && Number.isFinite(Number(playerRaw.yaw))) yaw = Number(playerRaw.yaw);
      const pitch = playerRaw.hasPosition ? sanitiseNumber(playerRaw.pitch, 0, -1.35, 1.35) : 0;
      this.lookYaw = yaw;
      this.lookPitch = pitch;
      this.applyLookAngles();

      this.camera.position.set(this.player.position.x, this.player.position.y + EYE_HEIGHT, this.player.position.z);
      this.weaponRaise = 0;
      this.weaponRecoil = 0;
      this.fireCooldown = 0;
      this.muzzleTimer = 0;
      this.fovKick = 0;
      this.touchMove = { x: 0, y: 0 };
      this.touchFire = false;
      this.jumpQueued = false;
      this.keys.clear();
      this.projectiles.forEach((projectile) => projectile.dispose());
      this.projectiles = [];
      this.autosaveTimer = 0;
      this.hud.update(0, this);
      if (this.flashlight) this.flashlight.intensity = this.flashlightOn ? 1.05 : 0;
    }

    setupAmbient() {
      this.ambientLights.forEach((light) => this.scene.remove(light));
      this.ambientLights = [];
      const theme = this.level.theme;
      this.scene.background = new THREE.Color(theme.fog);
      this.scene.fog = new THREE.FogExp2(theme.fog, 0.036);
      const ambient = new THREE.AmbientLight(theme.ambient, 0.7);
      const hemi = new THREE.HemisphereLight(theme.light, 0x030605, 0.32);
      this.scene.add(ambient, hemi);
      this.ambientLights.push(ambient, hemi);
    }

    generateEnemies() {
      const counts = this.level.config.enemies;
      const roster = [];
      Object.keys(counts).forEach((type) => {
        for (let i = 0; i < counts[type]; i += 1) roster.push(type);
      });
      for (let i = roster.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.level.random() * (i + 1));
        [roster[i], roster[j]] = [roster[j], roster[i]];
      }
      const candidates = this.level.openCells
        .filter((cell) => cell.dist >= 4 && !(cell.gx === this.level.start.gx && cell.gz === this.level.start.gz))
        .sort(() => this.level.random() - 0.5);
      const chosen = [];
      for (const cell of candidates) {
        if (chosen.length >= roster.length) break;
        if (this.level.collides(cell.x, cell.z, 0.55)) continue;
        if (chosen.some((other) => Math.abs(other.gx - cell.gx) + Math.abs(other.gz - cell.gz) < 2)) continue;
        chosen.push(cell);
      }
      let fallbackIndex = 0;
      while (chosen.length < roster.length && fallbackIndex < this.level.openCells.length) {
        const failsafe = this.level.openCells[(fallbackIndex * 7 + 3) % this.level.openCells.length];
        fallbackIndex += 1;
        if (this.level.collides(failsafe.x, failsafe.z, 0.5)) continue;
        if (failsafe.gx === this.level.start.gx && failsafe.gz === this.level.start.gz) continue;
        chosen.push(failsafe);
      }
      roster.forEach((type, index) => {
        const cell = chosen[index];
        if (!cell) return;
        this.enemies.push(new Enemy(this, type, cell.x, cell.z));
      });
    }

    generatePickups() {
      const counts = this.level.config.pickups;
      const roster = [];
      Object.keys(counts).forEach((type) => {
        for (let i = 0; i < counts[type]; i += 1) roster.push(type);
      });
      for (let i = roster.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.level.random() * (i + 1));
        [roster[i], roster[j]] = [roster[j], roster[i]];
      }
      const occupied = new Set();
      for (const enemy of this.enemies) {
        const cell = this.level.cellAt(enemy.position.x, enemy.position.z);
        occupied.add(`${cell.gx},${cell.gz}`);
      }
      occupied.add(`${this.level.start.gx},${this.level.start.gz}`);
      occupied.add(`${this.level.exit.gx},${this.level.exit.gz}`);
      const candidates = this.level.openCells
        .filter((cell) => cell.dist >= 2 && !this.level.collides(cell.x, cell.z, 0.5))
        .sort(() => this.level.random() - 0.5);
      const chosen = [];
      for (const cell of candidates) {
        if (chosen.length >= roster.length) break;
        const key = `${cell.gx},${cell.gz}`;
        if (occupied.has(key)) continue;
        if (chosen.some((other) => other.gx === cell.gx && other.gz === cell.gz)) continue;
        chosen.push(cell);
        occupied.add(key);
      }
      roster.forEach((type, index) => {
        const cell = chosen[index];
        if (!cell) return;
        this.pickups.push(new Pickup(this, type, cell.x + rand(-0.15, 0.15), cell.z + rand(-0.15, 0.15)));
      });
    }

    disposeWorld() {
      this.enemies.forEach((enemy) => enemy.dispose());
      this.pickups.forEach((pickup) => pickup.dispose());
      this.projectiles.forEach((projectile) => projectile.dispose());
      this.enemies = [];
      this.pickups = [];
      this.projectiles = [];
      if (this.level) {
        this.level.dispose(this.scene);
        this.level = null;
      }
      this.ambientLights.forEach((light) => this.scene.remove(light));
      this.ambientLights = [];
      this.scene.fog = null;
    }

    aliveEnemyCount() {
      let count = 0;
      for (const enemy of this.enemies) if (!enemy.dead) count += 1;
      return count;
    }

    /* ============================== COMBAT ============================== */

    switchWeapon(id) {
      if (!WEAPONS[id] || this.mode !== 'playing' || this.weapons.current === id) return;
      this.weapons.current = id;
      this.weaponRaise = 0;
      this.weaponRecoil = 0;
      this.audio.switchWeapon();
    }

    getLookDirection() {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      return direction;
    }

    getLookAngles() {
      const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      return { yaw: euler.y, pitch: euler.x };
    }

    applyLookAngles() {
      const euler = new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }

    fire() {
      if (this.mode !== 'playing' || this.player.dead) return;
      if (this.fireCooldown > 0) return;
      const weapon = WEAPONS[this.weapons.current];
      const ammoState = this.weapons[weapon.ammoKey];
      if (ammoState.ammo <= 0) {
        this.audio.dryFire();
        this.fireCooldown = 0.22;
        if (this.elapsed - (this.lastDryFire || 0) > 1.2) {
          this.lastDryFire = this.elapsed;
          this.hud.message('OUT OF AMMO // SWITCH WEAPON', 'warn', 1400);
        }
        return;
      }

      ammoState.ammo -= 1;
      this.shotsFired += weapon.pellets;
      this.fireCooldown = weapon.cooldown;
      this.weaponRecoil = 1;
      this.muzzleTimer = 0.075;
      this.weaponRaise = 1;
      this.fovKick = weapon.id === 'shotgun' ? 1.4 : 0.55;
      if (weapon.id === 'shotgun') this.shake = Math.max(this.shake, settings.shake ? 0.4 : 0);
      this.muzzleLight.color.setHex(weapon.color);
      this.muzzleLight.intensity = weapon.id === 'shotgun' ? 4.8 : 3.6;

      if (weapon.id === 'shotgun') this.audio.shotShotgun(); else this.audio.shotPlasma();
      this.hud.flashFire();
      this.hud.kickCrosshair();
      this.alertEnemiesNearby();

      const origin = this.camera.position.clone();
      const forward = this.getLookDirection();
      const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const muzzle = origin.clone().addScaledVector(forward, 0.7).addScaledVector(right, 0.18).addScaledVector(up, -0.14);
      let anyHit = false;

      for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
        const direction = forward.clone();
        if (weapon.spread > 0) {
          direction.addScaledVector(right, rand(-weapon.spread, weapon.spread));
          direction.addScaledVector(up, rand(-weapon.spread, weapon.spread));
          direction.normalize();
        }
        const result = this.shotRay(origin, direction, weapon.range);
        if (result.enemy) {
          anyHit = true;
          this.shotsHit += 1;
          const headshot = result.point.y > result.enemy.position.y + result.enemy.type.height * 0.8;
          let damage = weapon.damage;
          if (weapon.id === 'shotgun') {
            const falloff = clamp(1 - (result.distance / weapon.range) * 0.45, 0.52, 1);
            damage *= falloff;
          }
          if (headshot) damage *= 2;
          damage = Math.round(damage);
          const killed = result.enemy.takeDamage(damage, headshot);
          this.particles.spawnBurst(result.point, weapon.color, headshot ? 14 : 9, 4.2, { spread: 0.9 });
          this.particles.spawnBurst(result.point, 0xff3b50, 6, 2.8, { spread: 0.8 });
          this.audio.hit(headshot);
          this.hud.hitmarker(killed);
          this.hud.faceReact(false, killed);
          if (headshot) {
            this.hud.message('HEADSHOT // +50', 'loot', 1000);
          }
        } else {
          this.particles.spawnBurst(result.point, weapon.color, 6, 3.0, { spread: 0.6 });
        }
        this.tracers.fire(muzzle, result.point, weapon.color, weapon.id === 'shotgun' ? 0.055 : 0.085);
      }

      if (!anyHit && weapon.id === 'shotgun') {
        // compact pellet miss feedback for the heavy weapon
        this.audio.noise({ dur: 0.05, gain: 0.02, filter: 1200 });
      }
    }

    shotRay(origin, direction, range) {
      const wallDistance = this.rayWallDistance(origin, direction, range);
      const ray = new THREE.Ray(origin, direction);
      let bestEnemy = null;
      let bestPoint = null;
      let bestDistance = wallDistance;
      const point = new THREE.Vector3();
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const hit = ray.intersectBox(enemy.box, point);
        if (!hit) continue;
        const distance = origin.distanceTo(hit);
        if (distance <= bestDistance) {
          bestDistance = distance;
          bestEnemy = enemy;
          bestPoint = hit.clone();
        }
      }
      const endPoint = bestPoint || origin.clone().addScaledVector(direction, wallDistance);
      return {
        enemy: bestEnemy,
        point: endPoint,
        distance: bestDistance,
        wallDistance
      };
    }

    rayWallDistance(origin, direction, range) {
      const floorT = direction.y < -0.0001 ? -origin.y / direction.y : Infinity;
      const ceilT = direction.y > 0.0001 ? (WALL_H - origin.y) / direction.y : Infinity;
      const limit = Math.min(range, floorT, ceilT);
      let wallT = limit;
      for (let t = 0.15; t < limit; t += 0.1) {
        const x = origin.x + direction.x * t;
        const z = origin.z + direction.z * t;
        if (this.level.isWallAt(x, z)) {
          wallT = t;
          break;
        }
      }
      return Math.max(0.15, wallT);
    }

    alertEnemiesNearby() {
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const distance = Math.hypot(enemy.position.x - this.player.position.x, enemy.position.z - this.player.position.z);
        if (distance < 17 && (enemy.state === 'idle' || enemy.state === 'patrol')) {
          enemy.state = 'alert';
          enemy.alertTimer = rand(0.4, 0.9);
          enemy.lastSeen.copy(this.player.position);
          enemy.lastSeenAt = this.elapsed;
          enemy.pathTimer = 0;
          enemy.showHealth();
        }
      }
    }

    damagePlayer(amount, source = 'HOSTILE') {
      if (this.mode !== 'playing' || this.player.dead) return;
      const incoming = clamp(Number(amount) || 0, 0, 100);
      if (incoming <= 0) return;
      const absorbed = Math.min(this.player.armor, incoming * 0.58);
      this.player.armor = Math.max(0, this.player.armor - absorbed);
      const healthDamage = incoming - absorbed;
      this.player.health = Math.max(0, this.player.health - healthDamage);
      this.shake = Math.max(this.shake, settings.shake ? 1 : 0);
      this.hud.flashDamage(healthDamage > 15);
      this.hud.faceReact(true);
      this.audio.hurt();
      if (this.elapsed - (this.lastDamageMessage || 0) > 1.4) {
        this.lastDamageMessage = this.elapsed;
        this.hud.message(`VITALS HIT // ${source} // -${Math.ceil(incoming)}`, 'warn', 1700);
      }
      if (this.player.health <= 0) this.die(source);
    }

    die(source) {
      if (this.mode !== 'playing') return;
      this.mode = 'dying';
      this.player.dead = true;
      this.player.health = 0;
      this.deathTimer = 1.65;
      this.keys.clear();
      this.jumpQueued = false;
      this.touchFire = false;
      this.hideTouch();
      this.audio.death();
      this.audio.setDucked(true);
      this.hud.message(`FLATLINE // ${source}`, 'warn', 2400);
      try { if (document.pointerLockElement) this.controls.unlock(); } catch (err) { /* noop */ }
    }

    onEnemyKilled(enemy, headshot) {
      this.kills += 1;
      const points = enemy.type.score + (headshot ? 50 : 0);
      this.score += points;
      this.hud.faceReact(false, true);
      this.hud.message(`${enemy.type.name} TERMINATED // +${points}`, 'system', 1650);
      if (this.aliveEnemyCount() === 0) {
        this.score += 250;
        this.level.setExitUnlocked(true);
        this.hud.message('EXIT PORTAL ONLINE // +250', 'loot', 4600);
        this.hud.message('PROCEED TO THE EXIT MARKER', 'system', 4200);
        this.autosave(true);
      }
    }

    collectPickup(pickup) {
      if (!pickup || pickup.taken) return;
      const config = pickup.config;
      if (pickup.typeId === 'health') {
        if (this.player.health >= 100) return;
        this.player.health = Math.min(100, this.player.health + config.amount);
      } else if (pickup.typeId === 'armor') {
        if (this.player.armor >= 100) return;
        this.player.armor = Math.min(100, this.player.armor + config.amount);
      } else if (pickup.typeId === 'plasma') {
        if (this.weapons.plasma.ammo >= WEAPONS.plasma.maxAmmo) return;
        this.weapons.plasma.ammo = Math.min(WEAPONS.plasma.maxAmmo, this.weapons.plasma.ammo + config.amount);
      } else if (pickup.typeId === 'shells') {
        if (this.weapons.shotgun.ammo >= WEAPONS.shotgun.maxAmmo) return;
        this.weapons.shotgun.ammo = Math.min(WEAPONS.shotgun.maxAmmo, this.weapons.shotgun.ammo + config.amount);
      }
      pickup.collect();
      this.audio.pickup(pickup.typeId);
      this.hud.message(`${config.label} +${config.amount}`, 'loot', 1800);
      this.hud.faceReact(false, pickup.typeId === 'health');
    }

    removeProjectile(projectile) {
      if (projectile) projectile.dead = true;
    }

    checkExit() {
      if (this.mode !== 'playing' || !this.level || !this.level.exitUnlocked) return;
      const distance = Math.hypot(
        this.player.position.x - this.level.exitWorld.x,
        this.player.position.z - this.level.exitWorld.z
      );
      if (distance < 1.45) this.completeLevel();
    }

    completeLevel() {
      if (this.mode !== 'playing' || !this.level) return;
      const deadCount = this.enemies.filter((enemy) => enemy.dead).length;
      const bonus = 500 * (this.levelIndex + 1) + deadCount * 20 + Math.round(this.player.health) * 5;
      this.score += bonus;
      safeRemove(STORAGE_KEYS.autosave);
      this.updateContinueButton();
      try { if (document.pointerLockElement) this.controls.unlock(); } catch (err) { /* noop */ }
      this.audio.setDucked(true);
      this.hideTouch();
      if (this.levelIndex >= LEVELS.length - 1) {
        this.showVictory();
        return;
      }
      this.mode = 'levelclear';
      this.audio.levelClear();
      const clearTitle = $('#clear-title');
      const sectorName = $('#clear-sector-name');
      if (clearTitle) clearTitle.textContent = `SECTOR ${pad(this.levelIndex + 1)} SECURED`;
      if (sectorName) sectorName.textContent = this.level.config.name;
      this.setText('#clear-kills', deadCount);
      this.setText('#clear-time', formatTime(this.timePlayed));
      this.setText('#clear-bonus', `+${bonus}`);
      this.setText('#clear-score', formatNumber(this.score));
      const nextDetail = $('#next-sector-detail');
      if (nextDetail) nextDetail.textContent = `SECTOR ${pad(this.levelIndex + 2)} // ${LEVELS[this.levelIndex + 1].name}`;
      this.showScreen('screen-levelclear');
      this.updateTitleRecords();
    }

    nextLevel() {
      if (this.mode !== 'levelclear') return;
      const next = this.levelIndex + 1;
      if (next >= LEVELS.length) {
        this.showVictory();
        return;
      }
      this.audio.setDucked(false);
      this.player.health = clamp(this.player.health + 15, 1, 100);
      this.weapons.plasma.ammo = Math.min(WEAPONS.plasma.maxAmmo, this.weapons.plasma.ammo + 20);
      this.weapons.shotgun.ammo = Math.min(WEAPONS.shotgun.maxAmmo, this.weapons.shotgun.ammo + 5);
      this.beginLevel(next, {
        player: { health: this.player.health, armor: this.player.armor },
        stats: {
          score: this.score,
          kills: this.kills,
          shotsFired: this.shotsFired,
          shotsHit: this.shotsHit,
          timePlayed: this.timePlayed
        },
        weapons: this.weapons
      });
      this.mode = 'playing';
      this.hideScreens();
      this.showHUD();
      this.audio.setDucked(false);
      this.hud.message(`SECTOR ${pad(next + 1)} // ${this.level.config.name}`, 'system', 4600);
      this.hud.message('NEW HOSTILE SIGNATURES DETECTED', 'warn', 4000);
      this.autosave(true);
      this.requestLock();
    }

    showVictory() {
      const previousBest = (loadHighScores()[0] || {}).score || 0;
      this.mode = 'victory';
      this.audio.setDucked(true);
      this.audio.victory();
      this.hideTouch();
      try { if (document.pointerLockElement) this.controls.unlock(); } catch (err) { /* noop */ }
      safeRemove(STORAGE_KEYS.autosave);
      this.updateContinueButton();
      const accuracy = this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
      const rank = this.score >= 7500 ? 'S' : this.score >= 6000 ? 'A' : this.score >= 4500 ? 'B' : this.score >= 3000 ? 'C' : 'D';
      if (this.score > 0 && this.score !== this.recordedScore) {
        recordHighScore({ score: this.score, kills: this.kills, level: this.levelIndex, timePlayed: this.timePlayed }, true);
        this.recordedScore = this.score;
      }
      this.setText('#victory-score', formatNumber(this.score));
      this.setText('#victory-kills', this.kills);
      this.setText('#victory-accuracy', `${accuracy}%`);
      this.setText('#victory-time', formatTime(this.timePlayed));
      this.setText('#victory-rank', rank);
      this.setText('#victory-record-note', this.score >= previousBest && this.score > 0 ? 'NEW RECORD' : 'RUN ARCHIVED');
      this.showScreen('screen-victory');
      this.updateTitleRecords();
    }

    showGameOver() {
      if (this.mode === 'dead') return;
      this.mode = 'dead';
      this.audio.setDucked(true);
      this.hideTouch();
      safeRemove(STORAGE_KEYS.autosave);
      this.updateContinueButton();
      if (this.score > 0 && this.score !== this.recordedScore) {
        recordHighScore({ score: this.score, kills: this.kills, level: this.levelIndex, timePlayed: this.timePlayed }, false);
        this.recordedScore = this.score;
      }
      const best = (loadHighScores()[0] || {}).score || 0;
      this.setText('#gameover-score', formatNumber(this.score));
      this.setText('#gameover-kills', this.kills);
      this.setText('#gameover-level', pad(this.levelIndex + 1));
      this.setText('#gameover-best', formatNumber(best));
      this.showScreen('screen-gameover');
      this.updateTitleRecords();
    }

    retrySector() {
      if (!this.level) {
        this.startNew();
        return;
      }
      this.hideScreens();
      this.mode = 'playing';
      this.player.dead = false;
      this.player.health = 55;
      this.player.armor = Math.max(25, this.player.armor);
      this.player.position.set(this.level.startWorld.x, 0, this.level.startWorld.z);
      this.player.verticalVelocity = 0;
      this.player.onGround = true;
      this.player.velocity.set(0, 0, 0);
      this.weapons.plasma.ammo = Math.max(this.weapons.plasma.ammo, 75);
      this.weapons.shotgun.ammo = Math.max(this.weapons.shotgun.ammo, 18);
      this.projectiles.forEach((projectile) => projectile.dispose());
      this.projectiles = [];
      this.lookPitch = 0;
      const exit = this.level.exitWorld;
      this.lookYaw = Math.atan2(-(exit.x - this.player.position.x), -(exit.z - this.player.position.z));
      this.applyLookAngles();
      this.camera.position.set(this.player.position.x, EYE_HEIGHT, this.player.position.z);
      this.camera.rotation.z = 0;
      this.audio.setDucked(false);
      this.showHUD();
      this.hud.message('FIELD KIT DEPLOYED // SECTOR RETRY', 'loot', 3800);
      this.hud.message('VITALS 55 // ARMOR ONLINE', '', 3000);
      this.autosave(true);
      this.requestLock();
    }

    /* ============================== PAUSE / TITLE ============================== */

    pauseGame() {
      if (this.mode !== 'playing') return;
      this.mode = 'paused';
      this.keys.clear();
      this.jumpQueued = false;
      this.touchFire = false;
      this.touchMove = { x: 0, y: 0 };
      this.hideTouch();
      this.audio.setDucked(true);
      this.autosave(true);
      this.setText('#pause-level', pad(this.levelIndex + 1));
      this.setText('#pause-score', formatNumber(this.score));
      this.setText('#pause-kills', this.kills);
      this.setText('#pause-time', formatTime(this.timePlayed));
      this.showScreen('screen-pause');
      try { if (document.pointerLockElement) this.controls.unlock(); } catch (err) { /* noop */ }
    }

    resumeGame() {
      if (this.mode !== 'paused') return;
      this.mode = 'playing';
      this.hideScreens();
      this.audio.setDucked(false);
      this.showHUD();
      this.requestLock();
    }

    returnToTitle() {
      if (this.mode === 'playing' || this.mode === 'paused') this.autosave(true);
      if (this.mode === 'playing') this.pauseGame();
      try { if (document.pointerLockElement) this.controls.unlock(); } catch (err) { /* noop */ }
      this.disposeWorld();
      this.player.dead = false;
      this.mode = 'title';
      this.hideTouch();
      this.hud.hide();
      this.audio.setDucked(true);
      this.scene.background = new THREE.Color(0x020403);
      this.showScreen('screen-start');
      this.updateTitleRecords();
      this.updateContinueButton();
      this.player.health = 100;
      this.player.armor = 0;
    }

    setText(selector, value) {
      const element = $(selector);
      if (element) element.textContent = String(value);
    }

    /* ============================== SIMULATION ============================== */

    updatePlayer(dt) {
      const keys = this.keys;
      let forward = 0;
      let strafe = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
      if (this.isTouch) {
        forward += this.touchMove.y;
        strafe += this.touchMove.x;
      }
      forward = clamp(forward, -1, 1);
      strafe = clamp(strafe, -1, 1);
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

      const look = this.getLookDirection();
      look.y = 0;
      if (look.lengthSq() < 0.001) look.set(0, 0, -1);
      look.normalize();
      const right = new THREE.Vector3(-look.z, 0, look.x);
      const desired = new THREE.Vector3()
        .addScaledVector(look, forward)
        .addScaledVector(right, strafe);
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(speed);

      this.player.velocity.x = damp(this.player.velocity.x, desired.x, 11, dt);
      this.player.velocity.z = damp(this.player.velocity.z, desired.z, 11, dt);
      this.level.moveEntity(this.player.position, this.player.velocity.x * dt, this.player.velocity.z * dt, PLAYER_RADIUS);
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const ex = this.player.position.x - enemy.position.x;
        const ez = this.player.position.z - enemy.position.z;
        const minDistance = PLAYER_RADIUS + enemy.type.radius;
        const distance = Math.hypot(ex, ez);
        if (distance > 0.001 && distance < minDistance) {
          const push = (minDistance - distance) * 0.65;
          const nx = this.player.position.x + (ex / distance) * push;
          const nz = this.player.position.z + (ez / distance) * push;
          if (!this.level.collides(nx, nz, PLAYER_RADIUS)) {
            this.player.position.x = nx;
            this.player.position.z = nz;
          }
        }
      }

      if (this.jumpQueued) {
        if (this.player.onGround) {
          this.player.verticalVelocity = JUMP_SPEED;
          this.player.onGround = false;
          this.audio.jump();
        }
        this.jumpQueued = false;
      }
      if (!this.player.onGround) {
        this.player.verticalVelocity -= GRAVITY * dt;
        this.player.position.y += this.player.verticalVelocity * dt;
        if (this.player.position.y <= 0) {
          this.player.position.y = 0;
          this.player.verticalVelocity = 0;
          this.player.onGround = true;
          if (settings.shake) this.shake = Math.max(this.shake, 0.25);
        }
      }

      const horizontalSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
      if (this.player.onGround && horizontalSpeed > 0.45) {
        this.bobPhase += dt * horizontalSpeed * 1.85;
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.audio.step();
          this.stepTimer = sprint ? 0.32 : 0.43;
        }
      } else {
        this.stepTimer = 0.12;
      }
      this.player.bobPhase = this.bobPhase;
      const bob = this.player.onGround ? Math.sin(this.bobPhase) * 0.04 * clamp(horizontalSpeed / WALK_SPEED, 0, 1.25) : 0;
      this.camera.position.set(
        this.player.position.x,
        this.player.position.y + EYE_HEIGHT + bob,
        this.player.position.z
      );
      if (this.flashlight) {
        this.flashlight.intensity = this.flashlightOn ? 1.02 + Math.sin(this.elapsed * 27) * 0.018 : 0;
      }
    }

    updateWeapons(dt) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
      this.weaponRecoil = damp(this.weaponRecoil, 0, 9.5, dt);
      this.weaponRaise = damp(this.weaponRaise, 1, 8, dt);
      this.fovKick = damp(this.fovKick, 0, 9, dt);
      this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 20, dt);
      if (this.isTouch && this.touchFire) this.fire();
      const targetFov = this.baseFov + this.fovKick * 2.4;
      if (Math.abs(this.camera.fov - targetFov) > 0.01) {
        this.camera.fov = damp(this.camera.fov, targetFov, 12, dt);
        this.camera.updateProjectionMatrix();
      }
    }

    updateEnemies(dt) {
      for (const enemy of this.enemies) enemy.update(dt, this.player, this.elapsed);
    }

    updateProjectiles(dt) {
      for (const projectile of this.projectiles) projectile.update(dt);
      const alive = [];
      for (const projectile of this.projectiles) {
        if (projectile.dead) projectile.dispose();
        else alive.push(projectile);
      }
      this.projectiles = alive;
    }

    updatePickups(dt) {
      for (const pickup of this.pickups) pickup.update(dt);
    }

    updateShake(dt) {
      if (!settings.shake) {
        if (this.wasShaking) {
          this.renderer.domElement.style.transform = '';
          this.wasShaking = false;
        }
        this.shake = 0;
        return;
      }
      if (this.shake > 0.008) {
        const amount = this.shake * 4.5;
        this.renderer.domElement.style.transform = `translate3d(${rand(-amount, amount).toFixed(2)}px, ${rand(-amount, amount).toFixed(2)}px, 0) scale(1.018)`;
        this.wasShaking = true;
      } else if (this.wasShaking) {
        this.renderer.domElement.style.transform = '';
        this.wasShaking = false;
      }
      this.shake = damp(this.shake, 0, 6.5, dt);
    }

    updateAutosave(dt) {
      if (this.mode !== 'playing') return;
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= 3.8) {
        this.autosaveTimer = 0;
        this.autosave();
      }
    }

    autosave(force = false) {
      if (!this.level) return false;
      if (!force && this.mode !== 'playing') return false;
      try {
        const run = this.gatherRun();
        return safeSet(STORAGE_KEYS.autosave, JSON.stringify(run));
      } catch (err) {
        return false;
      }
    }

    gatherRun() {
      const angles = this.getLookAngles();
      return {
        schema: SAVE_SCHEMA,
        version: VERSION,
        savedAt: nowIso(),
        level: this.levelIndex,
        seed: this.levelSeed,
        player: {
          x: Number(this.player.position.x.toFixed(3)),
          y: Number(this.player.position.y.toFixed(3)),
          z: Number(this.player.position.z.toFixed(3)),
          yaw: Number(angles.yaw.toFixed(4)),
          pitch: Number(angles.pitch.toFixed(4)),
          health: Math.round(this.player.health * 10) / 10,
          armor: Math.round(this.player.armor * 10) / 10,
          hasPosition: true
        },
        weapons: {
          current: this.weapons.current,
          plasma: { ammo: this.weapons.plasma.ammo },
          shotgun: { ammo: this.weapons.shotgun.ammo }
        },
        stats: {
          score: Math.round(this.score),
          kills: this.kills,
          shotsFired: this.shotsFired,
          shotsHit: this.shotsHit,
          timePlayed: Math.round(this.timePlayed * 10) / 10
        },
        enemies: this.enemies.map((enemy) => enemy.serialize()),
        pickups: this.pickups.map((pickup) => pickup.serialize())
      };
    }

    /* ============================== SAVE IMPORT / EXPORT ============================== */

    buildExportPayload() {
      const run = this.level ? this.gatherRun() : this.pendingAutosave;
      if (!run) throw new Error('No run to export');
      return {
        format: SAVE_FORMAT,
        schema: SAVE_SCHEMA,
        version: VERSION,
        exportedAt: nowIso(),
        run,
        highScores: loadHighScores(),
        credits: {
          builtWith: 'OpenCode 2.2.5',
          model: 'DeepSeek V4.1 Flash (opencode-go/deepseek-v4.1-flash)',
          engine: 'Three.js r128'
        }
      };
    }

    exportSave() {
      try {
        const payload = this.buildExportPayload();
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'cyberdoom_save.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1800);
        this.hud.toast('SAVE FILE EXPORTED // CYBERDOOM_SAVE.JSON');
      } catch (err) {
        this.hud.toast('SAVE EXPORT FAILED', true);
      }
    }

    importFile(event) {
      const file = event.target && event.target.files ? event.target.files[0] : null;
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(String(reader.result));
          const runRaw = payload && payload.run ? payload.run : payload;
          const data = sanitiseRun(runRaw);
          if (!data) throw new Error('Invalid run payload');
          if (payload && Array.isArray(payload.highScores)) {
            const imported = payload.highScores.slice(0, 40).map((entry) => ({
              score: Math.round(sanitiseNumber(entry && entry.score, 0, 0, 99999999)),
              kills: Math.round(sanitiseNumber(entry && entry.kills, 0, 0, 99999)),
              level: Math.round(sanitiseNumber(entry && entry.level, 1, 1, 3)),
              time: Math.round(sanitiseNumber(entry && entry.time, 0, 0, 864000)),
              date: sanitiseString(entry && entry.date, '----', 10),
              victory: Boolean(entry && entry.victory)
            })).filter((entry) => entry.score > 0);
            const merged = loadHighScores().concat(imported).sort((a, b) => b.score - a.score).slice(0, MAX_HIGH_SCORES);
            saveHighScores(merged);
          }
          this.audio.ensure();
          this.audio.setDucked(false);
          this.applyRun(data);
          this.mode = 'playing';
          this.hideScreens();
          this.showHUD();
          this.hud.toast('SAVE STATE RESTORED');
          this.hud.message(`IMPORTED SAVE // SECTOR ${pad(data.level + 1)}`, 'system', 4200);
          this.hud.message(`${data.stats.kills} KILLS // ${formatNumber(data.stats.score)} PTS`, '', 3600);
          this.autosave(true);
          this.requestLock();
          this.updateTitleRecords();
        } catch (err) {
          this.hud.toast('INVALID SAVE FILE // IMPORT ABORTED', true);
        }
      };
      reader.onerror = () => this.hud.toast('SAVE FILE COULD NOT BE READ', true);
      reader.readAsText(file);
      if (event.target) event.target.value = '';
    }

    /* ============================== SELF TEST / LOOP ============================== */

    selfTest() {
      const results = [];
      const test = (name, fn) => {
        try {
          const pass = Boolean(fn());
          results.push({ name, pass });
        } catch (err) {
          results.push({ name, pass: false, error: String(err && err.message ? err.message : err) });
        }
      };
      let level = null;
      try {
        level = new DungeonLevel(0, 0xC0FFEE);
      } catch (err) {
        results.push({ name: 'Dungeon generator', pass: false, error: String(err) });
      }

      test('Three.js r128 loaded', () => typeof THREE !== 'undefined' && THREE.REVISION === '128');
      test('PointerLockControls API present', () => this.controls && typeof this.controls.lock === 'function' && typeof this.controls.getObject === 'function');
      test('WebGL renderer online', () => Boolean(this.renderer && this.renderer.getContext()));
      test('Dungeon generated', () => level && level.openCells.length > 80);
      test('Exit reachable from start', () => level && level.distanceMap[level.exit.gz][level.exit.gx] > 10);
      test('Start and exit are walkable', () => level && !level.isWall(level.start.gx, level.start.gz) && !level.isWall(level.exit.gx, level.exit.gz));
      test('Start is collision free', () => level && !level.collides(level.startWorld.x, level.startWorld.z, PLAYER_RADIUS));
      test('Walls collide', () => {
        if (!level) return false;
        for (let z = 0; z < level.size; z += 1) {
          for (let x = 0; x < level.size; x += 1) {
            if (level.isWall(x, z)) {
              const w = level.world(x, z);
              return level.collides(w.x, w.z, 0.3) === true;
            }
          }
        }
        return false;
      });
      test('Pathfinding resolves start to exit', () => level && level.findPath(level.startWorld.x, level.startWorld.z, level.exitWorld.x, level.exitWorld.z).length > 0);
      test('Two weapons configured', () => Object.keys(WEAPONS).length === 2 && WEAPONS.plasma.damage > 0 && WEAPONS.shotgun.pellets > 1);
      test('Three enemy archetypes configured', () => Object.keys(ENEMY_TYPES).length === 3);
      test('Four pickup types configured', () => Object.keys(PICKUP_TYPES).length === 4);
      test('HUD elements mounted', () => ['#health-value', '#ammo-value', '#score-value', '#face-canvas', '#minimap', '#weapon-canvas'].every((selector) => Boolean($(selector))));
      test('Web Audio API available', () => typeof (window.AudioContext || window.webkitAudioContext) === 'function');
      const sample = {
        level: 1,
        seed: 123456,
        player: { x: 1.5, z: -2, health: 74, armor: 12, yaw: 0.2, pitch: 0.1 },
        weapons: { current: 'shotgun', plasma: { ammo: 44 }, shotgun: { ammo: 7 } },
        stats: { score: 1234, kills: 8, shotsFired: 30, shotsHit: 18, timePlayed: 91.2 },
        enemies: [{ type: 'heavy', x: 3, z: 4, health: 55, dead: false }],
        pickups: [{ type: 'health', x: 5, z: 6, taken: false }]
      };
      const sanitized = sanitiseRun(sample);
      test('Save sanitisation roundtrip', () => sanitized && sanitized.level === 1 && sanitized.weapons.shotgun.ammo === 7 && sanitized.stats.score === 1234 && sanitized.enemies.length === 1);
      test('Save validator rejects malformed input', () => sanitiseRun({ level: 99 }) === null && sanitiseRun(null) === null);
      test('High score archive readable', () => Array.isArray(loadHighScores()));

      const passed = results.filter((result) => result.pass).length;
      return { passed, total: results.length, results, version: VERSION };
    }

    update(dt) {
      if (this.mode === 'playing') {
        this.elapsed += dt;
        this.timePlayed += dt;
        this.updatePlayer(dt);
        this.updateWeapons(dt);
        this.updateEnemies(dt);
        this.updateProjectiles(dt);
        this.updatePickups(dt);
        this.level.update(this.elapsed, dt);
        this.checkExit();
        this.hud.update(dt, this);
        this.updateAutosave(dt);
      } else if (this.mode === 'dying') {
        this.elapsed += dt;
        this.deathTimer -= dt;
        this.updateProjectiles(dt);
        this.level.update(this.elapsed, dt);
        this.hud.update(dt, this);
        const t = clamp(1 - this.deathTimer / 1.65, 0, 1);
        this.camera.position.y = this.player.position.y + EYE_HEIGHT - t * 1.0;
        this.camera.rotation.z = -t * 0.18;
        if (this.deathTimer <= 0) {
          this.camera.rotation.z = 0;
          this.showGameOver();
        }
      } else {
        if (this.level) this.level.update(this.elapsed, dt);
        if (this.mode === 'paused' || this.mode === 'levelclear' || this.mode === 'victory' || this.mode === 'dead') {
          this.elapsed += dt;
        }
      }

      this.particles.update(dt);
      this.tracers.update(dt);
      this.updateShake(dt);
    }

    animate(now) {
      requestAnimationFrame(this.animate);
      if (!this.renderer || !this.scene || !this.camera) return;
      const dt = clamp((now - this.lastFrame) / 1000, 0, MAX_DT);
      this.lastFrame = now;
      try {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        // Keep the render loop alive; surface a one-time fault for debugging.
        if (!this.renderFaulted) {
          this.renderFaulted = true;
          console.error('CYBERDOOM render fault:', err);
        }
      }
    }
  }

  /* ============================== BOOT ============================== */

  try {
    const game = new Game();
    window.__cyberdoomGame = game;
    window.CyberDoom = {
      version: VERSION,
      build: BUILD,
      get game() { return game; },
      get state() {
        const angles = game.getLookAngles();
        return {
          mode: game.mode,
          level: game.levelIndex + 1,
          levelName: game.level ? game.level.config.name : null,
          health: game.player.health,
          armor: game.player.armor,
          ammo: game.weapons[game.weapons.current].ammo,
          weapon: game.weapons.current,
          score: game.score,
          kills: game.kills,
          aliveEnemies: game.aliveEnemyCount(),
          totalEnemies: game.enemies.length,
          shotsFired: game.shotsFired,
          shotsHit: game.shotsHit,
          timePlayed: Math.round(game.timePlayed * 10) / 10,
          position: { x: game.player.position.x, z: game.player.position.z },
          look: { yaw: angles.yaw, pitch: angles.pitch },
          pointerLocked: game.pointerLocked,
          exitUnlocked: game.level ? game.level.exitUnlocked : false
        };
      },
      startNew: () => game.startNew(),
      continueRun: () => game.continueRun(),
      pause: () => game.pauseGame(),
      resume: () => game.resumeGame(),
      fire: () => game.fire(),
      damage: (amount) => game.damagePlayer(amount, 'DEBUG'),
      switchWeapon: (id) => game.switchWeapon(id),
      killAll: () => {
        game.enemies.filter((enemy) => !enemy.dead).forEach((enemy) => enemy.takeDamage(99999, true));
        return game.aliveEnemyCount();
      },
      teleport: (x, z) => {
        if (!game.level || game.level.collides(x, z, PLAYER_RADIUS)) return false;
        game.player.position.set(x, 0, z);
        game.camera.position.set(x, EYE_HEIGHT, z);
        return true;
      },
      teleportToExit: () => {
        if (!game.level) return false;
        const exit = game.level.exitWorld;
        game.player.position.set(exit.x, 0, exit.z - 2.0);
        game.camera.position.set(exit.x, EYE_HEIGHT, exit.z - 2.0);
        return true;
      },
      setLook: (yaw, pitch = 0) => {
        game.lookYaw = yaw;
        game.lookPitch = clamp(pitch, -1.35, 1.35);
        game.applyLookAngles();
      },
      placeEnemy: (type = 'trooper', distance = 5) => {
        if (!game.level) return null;
        const dir = game.getLookDirection();
        let x = game.player.position.x + dir.x * distance;
        let z = game.player.position.z + dir.z * distance;
        if (game.level.collides(x, z, 0.4)) {
          const fallback = pick(game.level.openCells);
          x = fallback.x;
          z = fallback.z;
        }
        const enemy = new Enemy(game, ENEMY_TYPES[type] ? type : 'trooper', x, z);
        game.enemies.push(enemy);
        return { type: enemy.typeId, x, z, health: enemy.health };
      },
      gatherRun: () => game.gatherRun(),
      buildExportPayload: () => game.buildExportPayload(),
      exportSave: () => game.exportSave(),
      applyRun: (data) => {
        game.applyRun(data);
        return true;
      },
      selfTest: () => game.selfTest(),
      audio,
      settings,
      levels: LEVELS,
      weapons: WEAPONS,
      enemies: ENEMY_TYPES
    };

    const params = new URLSearchParams(window.location.search);
    if (params.has('selftest')) {
      window.setTimeout(() => {
        const report = game.selfTest();
        console.info(`CYBERDOOM SELF-TEST ${report.passed}/${report.total}`);
        console.table(report.results);
        if (report.passed !== report.total) console.warn('CYBERDOOM SELF-TEST FAILURES', report.results.filter((r) => !r.pass));
        document.documentElement.setAttribute('data-selftest', `${report.passed}/${report.total}`);
      }, 1500);
    }
    if (params.has('play') || params.has('autostart')) {
      window.setTimeout(() => {
        if (game.mode === 'title') game.startNew();
      }, 1700);
    }
  } catch (err) {
    const fatal = document.getElementById('fatal-error');
    const loading = document.getElementById('screen-loading');
    const message = document.getElementById('fatal-message');
    if (loading) loading.classList.remove('is-active');
    if (fatal) fatal.classList.remove('is-hidden');
    if (message) message.textContent = `Boot sequence failed: ${err && err.message ? err.message : err}`;
    console.error('CYBERDOOM boot failure:', err);
  }
})();
