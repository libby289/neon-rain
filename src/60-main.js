/* =========================================================
   NEON RAIN — boot / input / loop / hud
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;
  const $ = (id) => document.getElementById(id);
  const { clamp, damp } = G;

  let renderer, scene, camera, post, fx, gun, player, director, projectiles;
  let quality = 'auto', renderScale = 1, targetScale = 1, adaptive = true;
  let state = 'menu';
  let time = 0, last = performance.now();
  let score = 0, deathT = 0, lockGrace = 0;
  let frameAvg = 16.7, resCooldown = 0;

  const input = { keys: {}, mouseDelta: { x: 0, y: 0 }, fire: false, ads: false };
  G.enemies = [];

  const QUALITY = { ultra: 1.0, high: 0.88, medium: 0.76, low: 0.6, auto: 1.0 };

  /* -------------------------------------------------------------
     loading helpers
     ------------------------------------------------------------- */
  const setProgress = (p, txt) => {
    $('loadbar').firstElementChild.style.width = (p * 100).toFixed(0) + '%';
    if (txt) $('loadtxt').textContent = txt;
  };
  const tick = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  /* -------------------------------------------------------------
     BOOT
     ------------------------------------------------------------- */
  async function boot() {
    const canvas = $('c');
    renderer = new T.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, alpha: false, depth: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.toneMapping = T.NoToneMapping;
    setProgress(0.08, '编译着色器…');
    await tick();

    scene = new T.Scene();
    camera = new T.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.06, 420);
    camera.rotation.order = 'YXZ';
    camera.position.set(2, 2.2, 9);

    setProgress(0.18, '生成湿沥青与混凝土…');
    await tick();
    G.asphalt(); G.concrete();

    setProgress(0.34, '锈蚀金属 / 木箱 / 积水遮罩…');
    await tick();
    G.rust(); G.wood(); G.puddleMask(); G.makeSprites();

    setProgress(0.46, '构筑第九街区…');
    await tick();
    const level = G.buildLevel(scene, renderer);
    G.level = level;
    G.scene = scene; G.camera = camera; G.renderer = renderer;

    setProgress(0.62, '点亮霓虹灯牌…');
    await tick();
    // world hit boxes
    G.hitBoxes = G.colliders.map(c => ({
      min: new T.Vector3(c.x0, 0, c.z0), max: new T.Vector3(c.x1, c.y1, c.z1), kind: 'concrete'
    }));
    const walls = [
      { min: new T.Vector3(-40, 0, -40), max: new T.Vector3(40, 60, -18.4) },
      { min: new T.Vector3(-40, 0, 18.4), max: new T.Vector3(40, 60, 40) },
      { min: new T.Vector3(18.4, 0, -40), max: new T.Vector3(40, 60, 40) },
      { min: new T.Vector3(-40, 0, -40), max: new T.Vector3(-18.4, 60, 40) }
    ];
    walls.forEach(w => G.hitBoxes.push({ min: w.min, max: w.max, kind: 'concrete' }));

    post = new G.Post(renderer);
    fx = new G.FXManager(scene, camera);
    G.fx = fx;
    gun = G.buildWeapon(G.envMap);
    G.gun = gun;

    player = new G.Player(camera, gun, fx, level.lights, G.Audio);
    G.playerRef = player;
    projectiles = new G.Projectiles(scene, fx);
    G.projectiles = projectiles;
    director = new G.Director(scene, fx, G.Audio);
    G.director = director;

    setProgress(0.8, '预编译着色器…');
    await tick();
    resize();
    try {
      renderer.compile(scene, camera);
      renderer.compile(gun.scene, gun.cam);
    } catch (e) { console.warn(e); }

    setProgress(1, '就绪');
    await tick();

    // menu camera framing
    camera.position.set(2.2, 2.1, 9.2);
    camera.lookAt(-2, 8.0, -17);

    $('loading').classList.add('hide');
    setTimeout(() => $('loading').style.display = 'none', 800);

    bindUI();
    bindInput();
    last = performance.now();
    requestAnimationFrame(frame);
    G.ready = true;
  }

  /* -------------------------------------------------------------
     UI wiring
     ------------------------------------------------------------- */
  function showOverlay(id) {
    ['start', 'pause', 'dead', 'win'].forEach(k => {
      const el = $(k);
      if (k === id) { el.classList.remove('hidden'); requestAnimationFrame(() => el.classList.add('show')); }
      else { el.classList.remove('show'); setTimeout(() => { if (!el.classList.contains('show')) el.classList.add('hidden'); }, 300); }
    });
  }
  function hideOverlays() {
    ['start', 'pause', 'dead', 'win'].forEach(k => {
      const el = $(k);
      el.classList.remove('show');
      setTimeout(() => { if (!el.classList.contains('show')) el.classList.add('hidden'); }, 300);
    });
  }

  function banner(title, sub, dur) {
    const b = $('banner');
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub || '';
    b.classList.add('on');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => b.classList.remove('on'), dur || 2200);
  }

  function feed(text) {
    const d = document.createElement('div');
    d.innerHTML = text;
    $('feed').appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .5s'; d.style.opacity = '0'; }, 2200);
    setTimeout(() => d.remove(), 2800);
    while ($('feed').children.length > 5) $('feed').firstElementChild.remove();
  }

  let hmT = 0;
  function hitMarker(kill, head) {
    const hm = $('hm');
    hm.classList.add('show');
    hm.classList.toggle('kill', !!kill);
    hmT = kill ? 0.34 : 0.14;
    if (kill) G.Audio.kill();
  }

  /* -------------------------------------------------------------
     state transitions
     ------------------------------------------------------------- */
  function startGame() {
    G.Audio.init();
    G.Audio.resume();
    G.Audio.startAmbience();
    hideOverlays();
    $('hud').classList.add('on');
    $('hint').style.opacity = '0';
    player.reset();
    director.reset();
    projectiles.clear();
    score = 0; deathT = 0;
    $('scoreTxt').textContent = '0';
    $('feed').innerHTML = '';
    state = 'playing';
    director.start();
    lockGrace = performance.now() + 1400;
    try { $('c').requestPointerLock(); } catch (e) { }
    verifyLock();
  }

  function releasePointer() {
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (e) { }
    }
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    showOverlay('pause');
    releasePointer();
    $('lockhint').style.opacity = '0';
  }
  function resumeGame() {
    if (state !== 'paused') return;
    hideOverlays();
    state = 'playing';
    last = performance.now();
    lockGrace = performance.now() + 1400;
    try { $('c').requestPointerLock(); } catch (e) { }
    verifyLock();
  }

  // 浏览器（或预览容器）有时会拒绝指针锁定：此时回到暂停界面并给出明确提示
  let lockCheckTimer = 0;
  function verifyLock() {
    clearTimeout(lockCheckTimer);
    lockCheckTimer = setTimeout(() => {
      if (state === 'playing' && document.pointerLockElement !== $('c')) {
        pauseGame();
        const card = $('pause').querySelector('div[style*="margin-top"]');
        if (card) card.innerHTML = '浏览器没有允许锁定鼠标<br><span style="color:#4f6675;font-size:10px;">再点一次「继续行动」，或在独立浏览器窗口里打开本文件</span>';
      }
    }, 900);
  }

  function toMenuIdle() { /* reserved */ }

  function bindUI() {
    $('btnStart').addEventListener('click', startGame);
    $('btnResume').addEventListener('click', resumeGame);
    $('btnRestart').addEventListener('click', () => { director.reset(); startGame(); });
    $('btnRetry').addEventListener('click', () => startGame());
    $('btnAgain').addEventListener('click', () => startGame());
    $('quality').addEventListener('change', (e) => {
      quality = e.target.value;
      adaptive = quality === 'auto';
      targetScale = QUALITY[quality] || 1;
      renderScale = Math.min(renderScale, targetScale) || targetScale;
      renderScale = targetScale;
      resize();
    });
    // click anywhere on the start screen also deploys
    $('start').addEventListener('click', (e) => {
      if (e.target.closest('.btn') || e.target.closest('select')) return;
      startGame();
    });
  }

  function bindInput() {
    const canvas = $('c');
    window.addEventListener('keydown', (e) => {
      const k = e.code.toLowerCase();
      input.keys[k] = true;
      if (k === 'escape') {
        if (state === 'playing') pauseGame();
        else if (state === 'paused') resumeGame();
      }
      if (k === 'keyr' && state === 'playing') player.startReload();
      if (k === 'keyf' && state === 'playing') {
        player.flashlight = !player.flashlight;
        G.Audio.click(1200, 0.04, 0.18);
      }
      if (k === 'space' || k === 'tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { input.keys[e.code.toLowerCase()] = false; });
    window.addEventListener('blur', () => {
      input.keys = {}; input.fire = false; input.ads = false;
      releasePointer();
      if (state === 'playing') pauseGame();
    });
    document.addEventListener('pointerlockerror', () => {
      $('lockhint').textContent = '鼠标锁定被拒绝 · 点「继续行动」重试';
      if (state === 'playing') pauseGame();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (state !== 'playing') return;
      // 鼠标已释放时不自动抢回指针，交给「继续行动」按钮显式重新锁定
      if (e.button === 0) input.fire = true;
      if (e.button === 2) input.ads = true;
      G.Audio.resume();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) input.fire = false;
      if (e.button === 2) input.ads = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        input.mouseDelta.x += e.movementX || 0;
        input.mouseDelta.y += e.movementY || 0;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && state === 'playing') {
        if (performance.now() > lockGrace) pauseGame();
      }
    });
    window.addEventListener('resize', resize);
    window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    gun.cam.aspect = w / h;
    gun.cam.updateProjectionMatrix();
    post.setSize(w, h, renderScale);
    G.level.reflector.setSize(w * renderScale, h * renderScale);
  }

  function applyScale() {
    const w = window.innerWidth, h = window.innerHeight;
    post.setSize(w, h, renderScale);
    G.level.reflector.setSize(w * renderScale, h * renderScale);
  }

  /* -------------------------------------------------------------
     hud
     ------------------------------------------------------------- */
  let hudTick = 0;
  function updateHUD(dt) {
    const alive = G.enemies.filter(e => e.alive).length;
    if (player.reloading) {
      const p = clamp(player.reloadT / player.reloadDur, 0, 1);
      $('reloadbar').classList.add('on');
      $('reloadbar').firstElementChild.style.width = (p * 100) + '%';
      $('prompt').classList.remove('on');
    } else {
      $('reloadbar').classList.remove('on');
      const need = player.ammo <= 6 && state === 'playing';
      $('prompt').classList.toggle('on', need);
      if (need) $('prompt').textContent = '按 R 换弹';
    }
    if (++hudTick % 3 === 0) {
      const hpPct = clamp(player.hp / player.maxHp, 0, 1);
      $('hpbar').style.width = (hpPct * 100) + '%';
      $('hpbar').style.background = hpPct > 0.5
        ? 'linear-gradient(90deg,#2fe8a8,#8ff5c8)'
        : hpPct > 0.25 ? 'linear-gradient(90deg,#ffb34d,#ffd89b)' : 'linear-gradient(90deg,#ff3b5c,#ff8aa0)';
      $('hpnum').innerHTML = Math.ceil(player.hp) + '<span>HP</span>';
      $('mag').innerHTML = player.ammo + '<small>/ ∞</small>';
      $('mag').classList.toggle('low', player.ammo <= 6);
      $('waveTxt').textContent = '第 ' + clamp(director.wave, 1, 5) + ' / 5 波';
      $('hostTxt').innerHTML = '剩余目标 <b>' + alive + '</b>';
      $('scoreTxt').textContent = score.toString().padStart(4, '0');
    }
    const locked = document.pointerLockElement === $('c');
    $('lockhint').style.opacity = locked && time < 14 ? '0.75' : (locked ? '0.28' : '0');
    const gap = clamp(5 + player.spreadVisual * 1050, 5, 34).toFixed(1);
    $('crosshair').style.setProperty('--gap', gap + 'px');
    $('crosshair').classList.toggle('ads', player.ads > 0.55);
    if (hmT > 0) {
      hmT -= dt;
      if (hmT <= 0) $('hm').classList.remove('show');
    }
    const flash = Math.max(player.hurtFlash * 0.55, player.hp < 30 ? 0.18 + Math.sin(time * 6) * 0.05 : 0);
    $('flash').style.opacity = flash.toFixed(3);
  }

  /* -------------------------------------------------------------
     hooks
     ------------------------------------------------------------- */
  G.onHit = function (kill, head) {
    hitMarker(kill, head);
  };
  G.onKill = function (drone) {
    score += drone.kind === 'gunner' ? 220 : 120;
    const names = ['哨兵', '游隼', '蜂群', '蓝隼', '铁蝗'];
    feed('<b>' + G.pick(names) + '-' + (10 + Math.floor(Math.random() * 89)) + '</b> 已击毁' + (drone.kind === 'gunner' ? ' · 重型' : ''));
  };

  /* -------------------------------------------------------------
     LOOP
     ------------------------------------------------------------- */
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, Math.max(0.0008, rawDt));
    time += dt;

    // ---- adaptive resolution
    resCooldown -= dt;
    if (state === 'playing' && adaptive && resCooldown <= 0) {
      frameAvg = frameAvg * 0.93 + rawDt * 1000 * 0.07;
      if (frameAvg > 23 && renderScale > 0.62) {
        renderScale = Math.max(0.62, renderScale - 0.07);
        applyScale(); resCooldown = 2.2; frameAvg = 18;
      } else if (frameAvg < 13.5 && renderScale < 1.0) {
        renderScale = Math.min(1.0, renderScale + 0.04);
        applyScale(); resCooldown = 3.0; frameAvg = 16;
      }
    }

    // ---- gameplay
    if (state === 'playing') {
      player.update(dt, time, input);
      director.update(dt, time);
      for (const e of G.enemies) e.update(dt, time, player);
      projectiles.update(dt, player);
      if (player.dead) {
        deathT += dt;
        if (deathT > 1.15 && state === 'playing') {
          state = 'dead';
          $('dWave').textContent = clamp(director.wave, 0, 5);
          $('dKills').textContent = player.kills;
          $('dAcc').textContent = (player.shots ? Math.round(player.hits / player.shots * 100) : 0) + '%';
          $('dScore').textContent = score;
          showOverlay('dead');
          $('hud').classList.remove('on');
          try { document.exitPointerLock(); } catch (e) { }
        }
      }
    } else if (state === 'menu') {
      const t = time * 0.05;
      camera.position.set(Math.sin(t) * 3.0 + 5.2, 1.35 + Math.sin(t * 0.7) * 0.16, 6.0 + Math.cos(t) * 1.6);
      camera.lookAt(Math.sin(t * 0.4) * 2.2 - 6.0, 9.6, -17.0);
      camera.updateMatrixWorld();
      for (const e of G.enemies) e.update(dt, time, player);
      projectiles.update(dt, player);
    } else if (state === 'dead' || state === 'win' || state === 'paused') {
      // gentle idle motion for the drones / fx only
      for (const e of G.enemies) if (!e.alive) e.update(dt, time, player);
    }

    // ---- ambience animation
    G.level.skyMat.uniforms.uTime.value = time;
    if (G.blinkers) {
      for (let i = 0; i < G.blinkers.length; i++) {
        const on = Math.sin(time * 2.2 + i * 1.7) > 0.4;
        G.blinkers[i].material.color.setHex(on ? 0xff2a1a : 0x2a0806);
      }
    }
    if (G.shaftMaterials) for (const m of G.shaftMaterials) m.uniforms.uTime.value = time;
    fx.update(dt, time, camera);
    if (G.mists) for (const m of G.mists) {
      m.sp.position.x = m.base.x + Math.sin(time * 0.07 + m.ph) * 2.4;
      m.sp.position.z = m.base.z + Math.cos(time * 0.055 + m.ph) * 2.0;
      m.sp.material.opacity = 0.04 + 0.022 * (0.5 + 0.5 * Math.sin(time * 0.3 + m.ph));
    }
    if (state === 'playing') updateHUD(dt);

    // ---- render
    camera.updateMatrixWorld(true);
    if (state !== 'menu') {
      G.level.reflector.update(scene, camera);
      const dmg = Math.max(player.hurtFlash * 0.7, player.hp < 32 ? (1 - player.hp / 32) * 0.5 : 0);
      post.render(scene, camera, gun.scene, gun.cam, time, dmg);
    } else {
      G.level.reflector.update(scene, camera);
      post.render(scene, camera, null, null, time, 0);
    }
  }

  /* -------------------------------------------------------------
     win handling from director
     ------------------------------------------------------------- */
  function wireDirector() {
    director.onWave = function (wave, n) {
      if (wave === -1) {
        banner('区域清空', 'W A V E   C L E A R', 1500);
      } else if (wave === 1) {
        banner('第 1 波 · 接触', n + ' 个目标接近中', 2400);
      } else {
        banner('第 ' + wave + ' 波', n + ' 个目标 · 保持移动', 2100);
      }
    };
    director.onWin = function () {
      state = 'win';
      $('wKills').textContent = player.kills;
      $('wHead').textContent = player.headshots;
      $('wAcc').textContent = (player.shots ? Math.round(player.hits / player.shots * 100) : 0) + '%';
      $('wScore').textContent = score;
      showOverlay('win');
      $('hud').classList.remove('on');
      try { document.exitPointerLock(); } catch (e) { }
    };
  }

  const _boot = boot().then(() => {
    wireDirector();
    G.debugStart = function () { startGame(); };
    G.debugStep = function (sec, dt) {
      dt = dt || 1 / 60;
      const n = Math.max(1, Math.round(sec / dt));
      for (let i = 0; i < n; i++) {
        time += dt;
        if (state === 'playing') {
          player.update(dt, time, input);
          director.update(dt, time);
          for (const e of G.enemies) e.update(dt, time, player);
          projectiles.update(dt, player);
        }
        fx.update(dt, time, camera);
      }
      camera.updateMatrixWorld(true);
    };
    G.debugSpawn = function (x, y, z, kind) {
      const d = new G.Drone(scene, fx, G.Audio, new T.Vector3(x, y, z), kind || 'scout');
      G.enemies.push(d);
      return d;
    };
    G.debugAim = function (e) {
      const p = player;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = e.pos.y - (p.pos.y + p.eyeH);
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      p.update(0.0001, time, input);
    };
    G.getState = () => state;
    G.forceState = (s) => { state = s; };
    window.__G = G;
  }).catch(err => {
    console.error(err);
    $('loadtxt').textContent = '启动失败: ' + err.message;
    $('loadtxt').style.color = '#ff6b6b';
  });
  window.__boot = _boot;

  // kill counter bookkeeping
  const _origOnKill = G.onKill;
  G.onKill = function (d) {
    player.kills++;
    _origOnKill(d);
  };
})();
