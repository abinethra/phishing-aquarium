/**
 * js/tank.js
 * Animated sticker-style aquarium canvas for "The Phishing Aquarium".
 * Uses vanilla Canvas 2D + Path2D, respects devicePixelRatio, container resize,
 * tab visibility pausing, and prefers-reduced-motion.
 */
(function () {
  const INK = '#111318';
  const DEFAULT_SPECIES = [
    { id: 'bulk-phish', name: 'Bulk Phish', colour: '#D85A30', shape: 'classic', difficulty: 1 },
    { id: 'spear-phish', name: 'Spear Phish', colour: '#D4537E', shape: 'classic', difficulty: 2 },
    { id: 'whale-ceo-fraud', name: 'Whale (CEO fraud)', colour: '#5DCAA5', shape: 'round', difficulty: 3 },
    { id: 'clone-phish', name: 'Clone Phish', colour: '#7F77DD', shape: 'classic', difficulty: 2 },
    { id: 'invoice-eel', name: 'Invoice Eel', colour: '#FAC775', shape: 'long', difficulty: 2 },
    { id: 'delivery-dart', name: 'Delivery Dart', colour: '#5DCAA5', shape: 'spiky', difficulty: 1 },
    { id: 'fake-login-ray', name: 'Fake Login Ray', colour: '#7F77DD', shape: 'spiky', difficulty: 2 },
    { id: 'tech-support-crab', name: 'Tech Support Crab', colour: '#D85A30', shape: 'round', difficulty: 3 }
  ];

  const state = {
    canvas: null,
    ctx: null,
    width: 1040,
    height: 460,
    dpr: 1,
    allSpecies: DEFAULT_SPECIES.slice(),
    caughtIds: new Set(),
    fishList: [],
    hoveredFish: null,
    selectedFish: null,
    frozenFishId: null,
    catchAnim: null,
    sparkles: [],
    bubbles: [],
    stars: [],
    seaweed: [],
    sandDots: [],
    rays: [
      { baseX: 0.18, width: 85, speed: 0.00018, phase: 0.2, alpha: 0.11 },
      { baseX: 0.48, width: 110, speed: -0.00014, phase: 1.7, alpha: 0.09 },
      { baseX: 0.74, width: 78, speed: 0.00021, phase: 3.4, alpha: 0.1 }
    ],
    rafId: null,
    lastTime: 0,
    elapsed: 0,
    isHidden: false,
    reducedMotion: false,
    clickListeners: []
  };

  function isWhaleSpecies(species) {
    return species.id === 'whale-ceo-fraud' || /whale/i.test(species.name || '');
  }

  function getMotionScale() {
    return state.reducedMotion ? 0.18 : 1;
  }

  function createFishEntity(species, index, total) {
    const whale = isWhaleSpecies(species);
    const shape = species.shape || 'classic';

    let baseW = 78;
    let baseH = 42;
    let speed = 44 + (index % 3) * 10;

    if (whale) {
      baseW = 138;
      baseH = 66;
      speed = 28;
    } else if (shape === 'long') {
      baseW = 104;
      baseH = 34;
      speed = 52;
    } else if (shape === 'round') {
      baseW = 84;
      baseH = 54;
      speed = 36;
    } else if (shape === 'spiky') {
      baseW = 82;
      baseH = 46;
      speed = 46;
    }

    const cols = 4;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const usableW = Math.max(220, state.width - 370);
    const usableH = Math.max(150, state.height - 130);

    const x = 70 + ((col + 0.5) / cols) * usableW;
    const y = 55 + ((row + 0.5) / Math.max(2, Math.ceil(total / cols))) * usableH;

    return {
      species,
      id: species.id || `fish-${index}`,
      name: species.name || `Fish ${index + 1}`,
      colour: species.colour || '#D85A30',
      shape,
      isWhale: whale,
      x,
      y,
      baseY: y,
      vx: index % 2 === 0 ? speed : -speed,
      dir: index % 2 === 0 ? 1 : -1,
      w: baseW,
      h: baseH,
      amp: whale ? 7 : 10 + (index % 4) * 2.5,
      freq: 0.0022 + (index % 3) * 0.0004,
      phase: index * 1.15,
      tailPhase: index * 0.85,
      tilt: 0
    };
  }

  function rebuildFishList() {
    const activeSpecies = state.allSpecies.filter((sp) => !state.caughtIds.has(sp.id));
    state.fishList = activeSpecies.map((sp, idx) => createFishEntity(sp, idx, activeSpecies.length));
    if (state.hoveredFish && state.caughtIds.has(state.hoveredFish.id)) {
      state.hoveredFish = null;
    }
    if (state.selectedFish && state.caughtIds.has(state.selectedFish.id)) {
      state.selectedFish = null;
    }
    if (state.frozenFishId && state.caughtIds.has(state.frozenFishId)) {
      state.frozenFishId = null;
    }
  }

  function populateSceneDecor() {
    const w = state.width;
    const h = state.height;
    const sandTop = h - 54;

    state.bubbles = Array.from({ length: 12 }, (_, i) => ({
      x: 45 + ((i * 89) % Math.max(140, w - 140)),
      y: 60 + ((i * 53) % Math.max(120, sandTop - 80)),
      r: 3 + (i % 4) * 1.8,
      speed: 14 + (i % 5) * 4.5,
      wobblePhase: i * 0.9
    }));

    state.stars = [
      { x: w * 0.14, y: h * 0.22, size: 7.5, phase: 0.3, colour: '#FAC775' },
      { x: w * 0.34, y: h * 0.14, size: 6.5, phase: 1.6, colour: '#FFFFFF' },
      { x: w * 0.56, y: h * 0.27, size: 8, phase: 2.8, colour: '#FFFFFF' },
      { x: w * 0.24, y: h * 0.72, size: 7, phase: 4.1, colour: '#D4537E' },
      { x: w * 0.62, y: h * 0.66, size: 6, phase: 5.0, colour: '#FFFFFF' }
    ];

    state.seaweed = [
      { x: w * 0.11, baseY: sandTop + 4, height: 58, swayPhase: 0.2, colour: '#279B6E' },
      { x: w * 0.14, baseY: sandTop + 4, height: 42, swayPhase: 1.4, colour: '#5DCAA5' },
      { x: w * 0.46, baseY: sandTop + 4, height: 64, swayPhase: 2.5, colour: '#1E825C' },
      { x: w * 0.49, baseY: sandTop + 4, height: 48, swayPhase: 3.7, colour: '#5DCAA5' }
    ];

    state.sandDots = Array.from({ length: 16 }, (_, i) => ({
      xRatio: ((i * 0.063 + 0.03) % 0.96),
      yOffset: 11 + (i % 4) * 9,
      r: 1.7 + (i % 3) * 0.7
    }));
  }

  function buildFishBodyPath(fish) {
    const hw = fish.w * 0.5;
    const hh = fish.h * 0.5;
    const p = new Path2D();

    if (fish.isWhale) {
      p.moveTo(-hw, 0);
      p.bezierCurveTo(-hw * 0.75, -hh * 1.15, hw * 0.45, -hh * 1.05, hw, -hh * 0.15);
      p.bezierCurveTo(hw * 1.08, hh * 0.35, hw * 0.55, hh * 0.95, -hw * 0.55, hh * 0.88);
      p.bezierCurveTo(-hw * 0.85, hh * 0.78, -hw, hh * 0.3, -hw, 0);
      p.closePath();
      return p;
    }

    if (fish.shape === 'long') {
      p.moveTo(-hw, 0);
      p.bezierCurveTo(-hw * 0.55, -hh * 0.95, hw * 0.55, -hh * 0.85, hw, 0);
      p.bezierCurveTo(hw * 0.55, hh * 0.85, -hw * 0.55, hh * 0.95, -hw, 0);
      p.closePath();
      return p;
    }

    if (fish.shape === 'round') {
      p.moveTo(-hw, 0);
      p.bezierCurveTo(-hw * 0.85, -hh * 1.18, hw * 0.65, -hh * 1.12, hw, 0);
      p.bezierCurveTo(hw * 0.65, hh * 1.12, -hw * 0.85, hh * 1.18, -hw, 0);
      p.closePath();
      return p;
    }

    if (fish.shape === 'spiky') {
      p.moveTo(-hw, 0);
      p.lineTo(-hw * 0.45, -hh * 0.82);
      p.lineTo(-hw * 0.1, -hh * 1.15);
      p.lineTo(hw * 0.35, -hh * 0.72);
      p.lineTo(hw, 0);
      p.lineTo(hw * 0.35, hh * 0.72);
      p.lineTo(-hw * 0.1, hh * 1.12);
      p.lineTo(-hw * 0.45, hh * 0.82);
      p.closePath();
      return p;
    }

    p.moveTo(-hw, 0);
    p.bezierCurveTo(-hw * 0.65, -hh * 1.05, hw * 0.55, -hh * 0.98, hw, 0);
    p.bezierCurveTo(hw * 0.55, hh * 0.98, -hw * 0.65, hh * 1.05, -hw, 0);
    p.closePath();
    return p;
  }

  function buildTailPath(fish, wagAngle) {
    const hw = fish.w * 0.5;
    const hh = fish.h * 0.5;
    const tailLen = fish.isWhale ? 24 : 18;
    const tipY = Math.sin(wagAngle) * 8;
    const p = new Path2D();

    p.moveTo(-hw + 3, -hh * 0.25);
    p.lineTo(-hw - tailLen, -hh * 0.85 + tipY);
    p.lineTo(-hw - tailLen * 0.65, tipY);
    p.lineTo(-hw - tailLen, hh * 0.85 + tipY);
    p.lineTo(-hw + 3, hh * 0.25);
    p.closePath();
    return p;
  }

  function buildDorsalFinPath(fish) {
    const hw = fish.w * 0.5;
    const hh = fish.h * 0.5;
    const p = new Path2D();

    if (fish.isWhale) {
      p.moveTo(-hw * 0.05, -hh * 0.86);
      p.quadraticCurveTo(hw * 0.14, -hh * 1.38, hw * 0.34, -hh * 0.78);
      p.closePath();
      return p;
    }

    p.moveTo(-hw * 0.18, -hh * 0.75);
    p.quadraticCurveTo(0, -hh * 1.35, hw * 0.22, -hh * 0.72);
    p.closePath();
    return p;
  }

  function drawBackground(ctx, t) {
    const w = state.width;
    const h = state.height;
    const sandTop = h - 54;
    const topBandH = Math.round(h * 0.28);

    const waterGrad = ctx.createLinearGradient(0, 0, 0, sandTop);
    waterGrad.addColorStop(0, '#1A62C4');
    waterGrad.addColorStop(0.55, '#0F467A');
    waterGrad.addColorStop(1, '#0C3A5B');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, w, sandTop);

    ctx.fillStyle = 'rgba(72, 148, 250, 0.32)';
    ctx.fillRect(0, 0, w, topBandH);

    ctx.strokeStyle = 'rgba(185, 224, 255, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, topBandH);
    ctx.lineTo(w, topBandH);
    ctx.stroke();

    ctx.save();
    state.rays.forEach((ray) => {
      const drift = Math.sin(t * ray.speed * 1000 + ray.phase) * 48;
      const topX = w * ray.baseX + drift;
      const spread = ray.width * 0.65;

      const beamGrad = ctx.createLinearGradient(0, 0, 0, sandTop);
      beamGrad.addColorStop(0, `rgba(210, 236, 255, ${ray.alpha * 1.45})`);
      beamGrad.addColorStop(0.75, `rgba(155, 205, 255, ${ray.alpha * 0.55})`);
      beamGrad.addColorStop(1, 'rgba(155, 205, 255, 0)');

      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(topX - ray.width * 0.45, 0);
      ctx.lineTo(topX + ray.width * 0.45, 0);
      ctx.lineTo(topX + ray.width * 0.45 + spread, sandTop);
      ctx.lineTo(topX - ray.width * 0.45 + spread * 0.6, sandTop);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    state.stars.forEach((star) => {
      const twinkle = 0.55 + 0.45 * Math.sin(t * 0.0032 + star.phase);
      const r = star.size * (0.8 + 0.25 * twinkle);

      ctx.save();
      ctx.globalAlpha = twinkle;
      ctx.translate(star.x, star.y);
      ctx.fillStyle = star.colour;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(215, 238, 255, 0.8)';
    ctx.fillStyle = 'rgba(215, 238, 255, 0.15)';
    ctx.lineWidth = 1.6;
    state.bubbles.forEach((b) => {
      const wobbleX = b.x + Math.sin(t * 0.0025 + b.wobblePhase) * 5;
      ctx.beginPath();
      ctx.arc(wobbleX, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawSeaweedAndCoral(ctx, t) {
    const w = state.width;
    const h = state.height;
    const sandTop = h - 54;

    state.seaweed.forEach((blade) => {
      const sway = Math.sin(t * 0.002 + blade.swayPhase) * 9;
      ctx.save();
      ctx.fillStyle = blade.colour;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(blade.x - 7, blade.baseY);
      ctx.quadraticCurveTo(blade.x - 10 + sway * 0.5, blade.baseY - blade.height * 0.55, blade.x + sway, blade.baseY - blade.height);
      ctx.quadraticCurveTo(blade.x + 10 + sway * 0.5, blade.baseY - blade.height * 0.55, blade.x + 7, blade.baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    const coralX = w * 0.28;
    const coralY = sandTop + 3;
    ctx.save();
    ctx.fillStyle = '#D85A30';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(coralX - 18, coralY);
    ctx.quadraticCurveTo(coralX - 24, coralY - 34, coralX - 10, coralY - 46);
    ctx.quadraticCurveTo(coralX - 4, coralY - 32, coralX - 2, coralY - 18);
    ctx.quadraticCurveTo(coralX + 2, coralY - 44, coralX + 12, coralY - 48);
    ctx.quadraticCurveTo(coralX + 18, coralY - 26, coralX + 14, coralY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawSeabed(ctx, t) {
    const w = state.width;
    const h = state.height;
    const sandTop = h - 54;

    ctx.save();
    const sandGrad = ctx.createLinearGradient(0, sandTop, 0, h);
    sandGrad.addColorStop(0, '#F8C66D');
    sandGrad.addColorStop(1, '#E3A748');
    ctx.fillStyle = sandGrad;

    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, sandTop + 2);
    for (let x = 0; x <= w; x += 40) {
      const waveY = sandTop + Math.sin(x * 0.025 + t * 0.0008) * 2.5;
      ctx.lineTo(x, waveY);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 40) {
      const waveY = sandTop + Math.sin(x * 0.025 + t * 0.0008) * 2.5;
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();

    ctx.fillStyle = '#B97E25';
    state.sandDots.forEach((dot) => {
      ctx.beginPath();
      ctx.arc(dot.xRatio * w, sandTop + dot.yOffset, dot.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const sx = w * 0.66;
    const sy = sandTop + 26;
    ctx.translate(sx, sy);
    ctx.fillStyle = '#D4537E';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? 15 : 6.5;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawFishEntity(ctx, fish, options = {}) {
    const { isHovered = false, isFrozen = false, scale = 1, alpha = 1 } = options;
    const hw = fish.w * 0.5;
    const hh = fish.h * 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(fish.x, fish.y);
    ctx.rotate(fish.tilt);
    ctx.scale(fish.dir * scale, scale);

    if (isHovered || isFrozen) {
      ctx.save();
      ctx.strokeStyle = isFrozen ? '#FAC775' : '#FFFFFF';
      ctx.lineWidth = isFrozen ? 3 : 2.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.roundRect(-hw - 22, -hh - 14, fish.w + 34, fish.h + 28, 16);
      ctx.stroke();
      ctx.restore();
    }

    const tailPath = buildTailPath(fish, fish.tailPhase);
    ctx.fillStyle = fish.colour;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.fill(tailPath);
    ctx.stroke(tailPath);

    const finPath = buildDorsalFinPath(fish);
    ctx.fillStyle = fish.colour;
    ctx.fill(finPath);
    ctx.stroke(finPath);

    const bodyPath = buildFishBodyPath(fish);
    ctx.fillStyle = fish.colour;
    ctx.fill(bodyPath);

    ctx.save();
    ctx.clip(bodyPath);

    if (fish.isWhale) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      const spotCoords = [
        [-0.45, -0.35, 3], [-0.22, -0.45, 2.6], [0.02, -0.32, 3.2], [0.26, -0.42, 2.5], [0.48, -0.22, 2.4],
        [-0.35, -0.05, 2.8], [-0.1, -0.08, 3.3], [0.16, -0.04, 2.9], [0.4, 0.05, 2.3],
        [-0.28, 0.25, 2.5], [-0.02, 0.22, 2.8], [0.22, 0.26, 2.2]
      ];
      spotCoords.forEach(([rx, ry, r]) => {
        ctx.beginPath();
        ctx.arc(rx * hw, ry * hh, r, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-hw * 0.14, -hh * 1.2, hw * 0.18, hh * 2.4);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw * 0.14, -hh * 1.2, hw * 0.18, hh * 2.4);
    }

    ctx.restore();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke(bodyPath);

    const eyeX = hw * 0.56;
    const eyeY = -hh * 0.12;
    const eyeR = fish.isWhale ? 6.5 : 5.5;

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.28, eyeY, eyeR * 0.46, 0, Math.PI * 2);
    ctx.fill();

    const envW = fish.isWhale ? 24 : 20;
    const envH = fish.isWhale ? 16 : 14;
    const envX = fish.isWhale ? -hw * 0.08 : hw * 0.04;
    const envY = fish.isWhale ? hh * 0.25 : -envH * 0.45;

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.roundRect(envX, envY, envW, envH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(envX + 1.5, envY + 1.5);
    ctx.lineTo(envX + envW * 0.5, envY + envH * 0.58);
    ctx.lineTo(envX + envW - 1.5, envY + 1.5);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function drawSparkles(ctx) {
    state.sparkles.forEach((sp) => {
      const alpha = Math.max(0, sp.life / sp.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rot);
      ctx.fillStyle = sp.colour;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;

      const r = sp.size;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  function spawnSparkles(x, y, count = 14) {
    const colours = ['#FAC775', '#5DCAA5', '#FFFFFF', '#D4537E', '#7F77DD'];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
      const speed = 45 + Math.random() * 85;
      state.sparkles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vRot: (Math.random() - 0.5) * 8,
        life: 0.65 + Math.random() * 0.25,
        maxLife: 0.9,
        colour: colours[i % colours.length]
      });
    }
  }

  function update(dtMs) {
    const scale = getMotionScale();
    const dt = (dtMs / 1000) * scale;
    state.elapsed += dtMs * scale;

    const w = state.width;
    const h = state.height;
    const sandTop = h - 54;
    const marginLeft = 36;
    const marginRight = w > 768 ? 310 : 36;

    state.fishList.forEach((fish) => {
      if (state.frozenFishId === fish.id) {
        fish.tilt *= Math.max(0, 1 - dt * 10);
        return;
      }

      const prevY = fish.y;
      fish.x += fish.vx * dt;

      const minX = marginLeft + fish.w * 0.5;
      const maxX = Math.max(minX + 80, w - marginRight - fish.w * 0.5);

      if (fish.x >= maxX) {
        fish.x = maxX;
        fish.vx = -Math.abs(fish.vx);
        fish.dir = -1;
      } else if (fish.x <= minX) {
        fish.x = minX;
        fish.vx = Math.abs(fish.vx);
        fish.dir = 1;
      }

      const minY = 38 + fish.h * 0.5;
      const maxY = sandTop - fish.h * 0.65 - 8;
      fish.baseY = Math.max(minY, Math.min(maxY, fish.baseY));

      const waveOffset = Math.sin(state.elapsed * fish.freq + fish.phase) * fish.amp;
      fish.y = Math.max(minY, Math.min(maxY, fish.baseY + waveOffset));

      const vy = dt > 0 ? (fish.y - prevY) / dt : 0;
      const targetTilt = Math.max(-0.18, Math.min(0.18, vy * 0.0045)) * fish.dir;
      fish.tilt += (targetTilt - fish.tilt) * Math.min(1, dt * 8);

      fish.tailPhase += dt * (fish.isWhale ? 5.5 : 8.5);
    });

    // Catch shrink-into-collection-strip animation
    if (state.catchAnim) {
      const anim = state.catchAnim;
      anim.progress += dt / anim.duration;
      const p = Math.min(1, anim.progress);
      const ease = p * p * (3 - 2 * p);
      anim.fish.x = anim.startX + (anim.targetX - anim.startX) * ease;
      anim.fish.y = anim.startY + (anim.targetY - anim.startY) * ease;
      anim.scale = Math.max(0.12, 1 - ease * 0.85);
      anim.alpha = Math.max(0, 1 - ease * 0.85);
      anim.fish.tailPhase += dt * 16;

      if (p >= 1) {
        spawnSparkles(anim.targetX, anim.targetY, 12);
        state.catchAnim = null;
        rebuildFishList();
      }
    }

    // Update sparkles
    for (let i = state.sparkles.length - 1; i >= 0; i--) {
      const sp = state.sparkles[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 90 * dt;
      sp.rot += sp.vRot * dt;
      sp.life -= dt;
      if (sp.life <= 0) {
        state.sparkles.splice(i, 1);
      }
    }

    state.bubbles.forEach((b) => {
      b.y -= b.speed * dt;
      if (b.y < 14) {
        b.y = sandTop - 8;
      }
    });
  }

  function render(nowMs) {
    if (!state.ctx) return;
    const ctx = state.ctx;

    ctx.save();
    ctx.scale(state.dpr, state.dpr);
    ctx.clearRect(0, 0, state.width, state.height);

    drawBackground(ctx, state.elapsed || nowMs);
    drawSeaweedAndCoral(ctx, state.elapsed || nowMs);
    drawSeabed(ctx, state.elapsed || nowMs);

    state.fishList.forEach((fish) => {
      if (state.catchAnim && state.catchAnim.fish.id === fish.id) return;
      const isHovered = state.hoveredFish && state.hoveredFish.id === fish.id;
      const isFrozen = state.frozenFishId === fish.id;
      drawFishEntity(ctx, fish, { isHovered, isFrozen });
    });

    if (state.catchAnim) {
      drawFishEntity(ctx, state.catchAnim.fish, {
        scale: state.catchAnim.scale,
        alpha: state.catchAnim.alpha
      });
    }

    drawSparkles(ctx);
    ctx.restore();
  }

  function loop(nowMs) {
    if (state.isHidden) {
      state.rafId = null;
      return;
    }
    if (!state.lastTime) state.lastTime = nowMs;
    const dtMs = Math.min(100, nowMs - state.lastTime);
    state.lastTime = nowMs;

    update(dtMs);
    render(nowMs);

    state.rafId = window.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (state.rafId || state.isHidden) return;
    state.lastTime = performance.now();
    state.rafId = window.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function resizeToContainer() {
    if (!state.canvas) return;
    const rect = state.canvas.getBoundingClientRect();
    const parentRect = state.canvas.parentElement
      ? state.canvas.parentElement.getBoundingClientRect()
      : rect;

    const rawW = rect.width || parentRect.width || 1040;
    const rawH = rect.height || parentRect.height || 460;

    const newW = Math.max(300, Math.round(rawW));
    const newH = Math.max(220, Math.round(rawH));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const oldW = state.width || newW;
    const oldH = state.height || newH;

    state.width = newW;
    state.height = newH;
    state.dpr = dpr;

    state.canvas.width = Math.round(newW * dpr);
    state.canvas.height = Math.round(newH * dpr);

    if (state.fishList.length > 0 && oldW > 0 && oldH > 0) {
      const sx = newW / oldW;
      const sy = newH / oldH;
      state.fishList.forEach((f) => {
        f.x = Math.max(40, Math.min(newW - 40, f.x * sx));
        f.baseY = Math.max(40, Math.min(newH - 90, f.baseY * sy));
        f.y = f.baseY;
      });
    }

    populateSceneDecor();
    render(performance.now());
  }

  function clientToCanvasCoords(clientX, clientY) {
    if (!state.canvas) return { x: 0, y: 0 };
    const rect = state.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * state.width,
      y: ((clientY - rect.top) / rect.height) * state.height
    };
  }

  function getFishAt(x, y) {
    for (let i = state.fishList.length - 1; i >= 0; i--) {
      const fish = state.fishList[i];
      if (state.caughtIds.has(fish.id)) continue;
      const padX = fish.w * 0.56 + 14;
      const padY = fish.h * 0.62 + 10;
      const dx = x - fish.x;
      const dy = y - fish.y;

      if (Math.abs(dx) <= padX && Math.abs(dy) <= padY) {
        return fish;
      }
    }
    return null;
  }

  function handlePointerMove(e) {
    const pt = clientToCanvasCoords(e.clientX, e.clientY);
    const hit = getFishAt(pt.x, pt.y);
    state.hoveredFish = hit;
    if (state.canvas) {
      state.canvas.style.cursor = hit ? 'pointer' : 'default';
    }
  }

  function handlePointerLeave() {
    state.hoveredFish = null;
    if (state.canvas) {
      state.canvas.style.cursor = 'default';
    }
  }

  function handleClick(e) {
    const pt = clientToCanvasCoords(e.clientX, e.clientY);
    const hit = getFishAt(pt.x, pt.y);
    if (!hit) return;

    state.selectedFish = hit;
    state.clickListeners.forEach((fn) => fn(hit));

    if (state.canvas) {
      state.canvas.dispatchEvent(
        new CustomEvent('tank:fishclick', {
          detail: { fish: hit, species: hit.species, x: pt.x, y: pt.y },
          bubbles: true
        })
      );
    }
  }

  function init(options = {}) {
    if (state.canvas) return;
    const canvasId = options.canvasId || 'tank';
    const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!canvas) return;

    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reducedMotion = mq.matches;
    mq.addEventListener('change', (ev) => {
      state.reducedMotion = ev.matches;
    });

    document.addEventListener('visibilitychange', () => {
      state.isHidden = document.hidden;
      if (state.isHidden) {
        stopLoop();
      } else {
        startLoop();
      }
    });

    if (Array.isArray(options.species) && options.species.length > 0) {
      state.allSpecies = options.species.slice();
    }
    rebuildFishList();

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('click', handleClick);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        resizeToContainer();
      });
      if (canvas.parentElement) {
        ro.observe(canvas.parentElement);
      } else {
        ro.observe(canvas);
      }
    } else {
      window.addEventListener('resize', resizeToContainer);
    }

    resizeToContainer();
    startLoop();
  }

  function setSpecies(speciesList) {
    if (!Array.isArray(speciesList) || speciesList.length === 0) return;
    state.allSpecies = speciesList.slice();
    rebuildFishList();
    state.hoveredFish = null;
  }

  function setCaughtIds(ids) {
    state.caughtIds = new Set(Array.isArray(ids) ? ids : []);
    rebuildFishList();
  }

  function setFrozenFish(fishId) {
    state.frozenFishId = fishId || null;
  }

  function playCatchAnimation(fishId, targetSlotIndex = 0) {
    const targetFish = state.fishList.find((f) => f.id === fishId) ||
      (state.selectedFish && state.selectedFish.id === fishId ? state.selectedFish : null);

    const startX = targetFish ? targetFish.x : state.width * 0.35;
    const startY = targetFish ? targetFish.y : state.height * 0.45;
    const slotFrac = Math.min(0.45, 0.07 + targetSlotIndex * 0.05);
    const targetX = state.width * slotFrac;
    const targetY = state.height - 16;

    spawnSparkles(startX, startY, 16);

    const clonedFish = targetFish
      ? { ...targetFish }
      : {
          id: fishId,
          name: 'Caught Phish',
          colour: '#5DCAA5',
          shape: 'classic',
          isWhale: false,
          x: startX,
          y: startY,
          w: 78,
          h: 42,
          dir: 1,
          tilt: 0,
          tailPhase: 0
        };

    state.caughtIds.add(fishId);
    if (state.frozenFishId === fishId) {
      state.frozenFishId = null;
    }

    state.catchAnim = {
      fish: clonedFish,
      startX,
      startY,
      targetX,
      targetY,
      scale: 1,
      alpha: 1,
      progress: 0,
      duration: state.reducedMotion ? 1.4 : 0.65
    };
  }

  function onClick(callback) {
    if (typeof callback === 'function') {
      state.clickListeners.push(callback);
    }
  }

  window.Tank = {
    init,
    setSpecies,
    setCaughtIds,
    setFrozenFish,
    playCatchAnimation,
    getFishAt,
    onClick,
    getFishList: () => state.fishList.slice()
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();