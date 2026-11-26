/* =========================================================
   NEON RAIN — player controller + weapon viewmodel + shooting
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;
  const { clamp, lerp, damp, rnd } = G;

  /* ---------------------------------------------------------------
     Weapon viewmodel scene
     --------------------------------------------------------------- */
  function buildWeapon(envMap) {
    const scene = new T.Scene();
    const cam = new T.PerspectiveCamera(46, 1, 0.01, 12);
    scene.add(cam);
    scene.environment = envMap;
    scene.environmentIntensity = 0.95;

    const M = {
      gun: new T.MeshStandardMaterial({ color: 0x33383e, roughness: 0.46, metalness: 0.55, envMapIntensity: 2.0 }),
      gunDark: new T.MeshStandardMaterial({ color: 0x22262b, roughness: 0.52, metalness: 0.5, envMapIntensity: 1.6 }),
      poly: new T.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.68, metalness: 0.14, envMapIntensity: 0.8 }),
      tan: new T.MeshStandardMaterial({ color: 0x3a382f, roughness: 0.74, metalness: 0.12, envMapIntensity: 0.55 }),
      glove: new T.MeshStandardMaterial({ color: 0x22252a, roughness: 0.8, metalness: 0.05, envMapIntensity: 0.4 }),
      glovePad: new T.MeshStandardMaterial({ color: 0x34383e, roughness: 0.62, metalness: 0.16, envMapIntensity: 0.7 }),
      glass: new T.MeshStandardMaterial({ color: 0x1a4050, roughness: 0.05, metalness: 0.5, envMapIntensity: 2.4, transparent: true, opacity: 0.22, depthWrite: false }),
      red: new T.MeshBasicMaterial({ color: 0xff3322, toneMapped: false })
    };

    const root = new T.Group();
    root.scale.setScalar(0.70);
    scene.add(root);

    const box = (w, h, d, x, y, z, mat, parent) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat || M.gun);
      m.position.set(x, y, z);
      (parent || root).add(m);
      return m;
    };
    const cyl = (r1, r2, len, x, y, z, mat, seg) => {
      const m = new T.Mesh(new T.CylinderGeometry(r1, r2, len, seg || 14), mat || M.gun);
      m.position.set(x, y, z);
      m.rotation.x = Math.PI / 2;
      root.add(m);
      return m;
    };

    // ---------------- receiver
    box(0.056, 0.088, 0.30, 0, 0, 0, M.gun);
    box(0.05, 0.026, 0.26, 0, 0.057, -0.01, M.gunDark);
    // magwell
    box(0.062, 0.05, 0.10, 0, -0.055, 0.015, M.poly);
    // ejection port + brass deflector
    box(0.014, 0.032, 0.07, 0.03, 0.022, 0.03, M.gunDark);
    box(0.008, 0.03, 0.03, 0.034, 0.03, 0.075, M.gun);
    // ---------------- handguard (two tone)
    box(0.058, 0.064, 0.30, 0, 0.004, -0.30, M.tan);
    box(0.04, 0.012, 0.30, 0, 0.040, -0.30, M.gunDark);
    for (let i = 0; i < 7; i++) {
      const slot = box(0.008, 0.014, 0.026, 0.031, 0.004, -0.19 - i * 0.038, M.gunDark);
      const slot2 = box(0.008, 0.014, 0.026, -0.031, 0.004, -0.19 - i * 0.038, M.gunDark);
    }
    // ---------------- barrel + brake
    cyl(0.0115, 0.0115, 0.22, 0, 0.006, -0.52, M.gunDark);
    cyl(0.019, 0.019, 0.075, 0, 0.006, -0.655, M.gun);
    for (let i = 0; i < 3; i++) box(0.04, 0.006, 0.009, 0, 0.006, -0.638 - i * 0.02, M.gunDark);
    // ---------------- magazine (curved look via two segments)
    const mag = new T.Group();
    const magBody = new T.Mesh(new T.BoxGeometry(0.036, 0.135, 0.082), M.poly);
    magBody.position.set(0, -0.10, 0);
    mag.add(magBody);
    const magBody2 = new T.Mesh(new T.BoxGeometry(0.034, 0.075, 0.078), M.poly);
    magBody2.position.set(0, -0.20, 0.012);
    magBody2.rotation.x = -0.22;
    mag.add(magBody2);
    const magLip = new T.Mesh(new T.BoxGeometry(0.038, 0.012, 0.086), M.gunDark);
    magLip.position.set(0, -0.032, 0);
    mag.add(magLip);
    for (let i = 0; i < 3; i++) {
      const rib = new T.Mesh(new T.BoxGeometry(0.038, 0.005, 0.084), M.gunDark);
      rib.position.set(0, -0.075 - i * 0.03, 0);
      mag.add(rib);
    }
    mag.position.set(0, -0.025, 0.02);
    mag.rotation.x = -0.10;
    root.add(mag);
    // ---------------- grip
    const grip = box(0.038, 0.125, 0.058, 0, -0.10, 0.115, M.poly);
    grip.rotation.x = 0.30;
    box(0.032, 0.02, 0.052, 0, -0.155, 0.14, M.gunDark);
    box(0.008, 0.03, 0.10, 0, -0.062, 0.055, M.gunDark);
    // ---------------- stock
    box(0.036, 0.05, 0.10, 0, -0.004, 0.21, M.poly);
    box(0.045, 0.09, 0.03, 0, -0.012, 0.277, M.poly);
    box(0.013, 0.032, 0.13, 0, 0.031, 0.21, M.gunDark);
    box(0.05, 0.012, 0.05, 0, -0.045, 0.245, M.poly);
    // ---------------- optic (tube sight)
    box(0.034, 0.026, 0.075, 0, 0.077, -0.05, M.gunDark);
    const tube = new T.Mesh(new T.CylinderGeometry(0.023, 0.023, 0.10, 20, 1, true), M.gun);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.113, -0.055);
    root.add(tube);
    const ringA = new T.Mesh(new T.TorusGeometry(0.0235, 0.004, 8, 22), M.gunDark);
    ringA.position.set(0, 0.113, -0.108); root.add(ringA);
    const ringB = ringA.clone(); ringB.position.z = -0.002; root.add(ringB);
    const ringC = new T.Mesh(new T.TorusGeometry(0.0245, 0.004, 8, 22), M.gun);
    ringC.position.set(0, 0.113, -0.055); root.add(ringC);
    const turret = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, 0.016, 12), M.gunDark);
    turret.position.set(0, 0.142, -0.055); root.add(turret);
    const lensF = new T.Mesh(new T.CircleGeometry(0.0235, 22), M.glass);
    lensF.position.set(0, 0.113, -0.1105);
    lensF.rotation.y = Math.PI;
    root.add(lensF);
    // (rear lens intentionally open so the sight picture is see-through)
    const dot = new T.Mesh(new T.CircleGeometry(0.0016, 8), M.red);
    dot.position.set(0, 0.112, -0.1082);
    dot.rotation.y = Math.PI;
    root.add(dot);
    const dotGlow = null;
    // back-up sights
    box(0.006, 0.028, 0.007, 0, 0.075, -0.40, M.gunDark);
    box(0.018, 0.006, 0.007, 0, 0.088, -0.40, M.gunDark);
    // ---------------- weapon light
    const fl = new T.Group();
    const flBody = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.095, 14), M.gunDark);
    flBody.rotation.x = Math.PI / 2; fl.add(flBody);
    const flHead = new T.Mesh(new T.CylinderGeometry(0.021, 0.019, 0.03, 14), M.gun);
    flHead.rotation.x = Math.PI / 2; flHead.position.z = -0.058; fl.add(flHead);
    const flLens = new T.Mesh(new T.CircleGeometry(0.016, 14), new T.MeshBasicMaterial({ color: 0xeaf6ff, toneMapped: false }));
    flLens.position.z = -0.073; flLens.rotation.y = Math.PI; fl.add(flLens);
    fl.position.set(0.035, -0.006, -0.40);
    root.add(fl);
    // ---------------- charging handle
    const charge = box(0.022, 0.012, 0.045, 0.035, 0.05, 0.075, M.gunDark);
    // ---------------- hands
    function hand(x, y, z, ry) {
      const g = new T.Group();
      const palm = new T.Mesh(new T.BoxGeometry(0.064, 0.078, 0.092), M.glove);
      g.add(palm);
      for (let i = 0; i < 4; i++) {
        const f = new T.Mesh(new T.BoxGeometry(0.014, 0.058, 0.026), M.glove);
        f.position.set(-0.024 + i * 0.016, 0.01, -0.054);
        f.rotation.x = -0.55;
        g.add(f);
        const pad = new T.Mesh(new T.BoxGeometry(0.014, 0.022, 0.022), M.glovePad);
        pad.position.set(-0.024 + i * 0.016, 0.042, -0.046);
        g.add(pad);
      }
      const thumb = new T.Mesh(new T.BoxGeometry(0.018, 0.052, 0.032), M.glove);
      thumb.position.set(0.033, 0.004, -0.022);
      thumb.rotation.z = 0.5;
      g.add(thumb);
      const cuff = new T.Mesh(new T.BoxGeometry(0.074, 0.084, 0.06), M.glovePad);
      cuff.position.set(0, -0.004, 0.078);
      g.add(cuff);
      g.position.set(x, y, z);
      g.rotation.y = ry || 0;
      root.add(g);
      return g;
    }
    hand(0.014, -0.098, 0.10, 0.12);
    hand(-0.006, -0.05, -0.265, -0.16);
    // short sleeves
    const sleeveR = new T.Mesh(new T.BoxGeometry(0.09, 0.105, 0.15), M.glove);
    sleeveR.position.set(0.03, -0.16, 0.185);
    sleeveR.rotation.set(0.6, 0, -0.12);
    root.add(sleeveR);
    const sleeveL = new T.Mesh(new T.BoxGeometry(0.085, 0.098, 0.12), M.glove);
    sleeveL.position.set(-0.012, -0.112, -0.155);
    sleeveL.rotation.set(0.8, 0, 0.14);
    root.add(sleeveL);

    // ---------------- lighting
    const key = new T.DirectionalLight(0xe4eeff, 3.4);
    key.position.set(-1.0, 1.5, 1.0);
    scene.add(key);
    const rim = new T.DirectionalLight(0x66d6ff, 3.6);
    rim.position.set(1.5, 0.5, -0.8);
    scene.add(rim);
    const warm = new T.PointLight(0xff9d58, 1.1, 4, 2);
    warm.position.set(0.6, -0.5, 0.5);
    scene.add(warm);
    const fill = new T.PointLight(0xa8c4e4, 1.9, 3, 2);
    fill.position.set(-0.45, 0.15, 0.45);
    scene.add(fill);
    const backFill = new T.PointLight(0xcfd8e8, 1.1, 2.2, 2);
    backFill.position.set(0.15, 0.25, 0.95);
    scene.add(backFill);
    const flashLight = new T.PointLight(0xffd9a8, 0, 3.2, 2);
    flashLight.position.set(0, 0.02, -0.66);
    scene.add(flashLight);

    root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    return { scene, cam, root, M, mag, charge, dot, dotGlow, flashLight, lensF, muzzleLocal: new T.Vector3(0, 0.006, -0.70) };
  }
  G.buildWeapon = buildWeapon;

  /* ---------------------------------------------------------------
     Player
     --------------------------------------------------------------- */
  class Player {
    constructor(camera, gun, fx, lights, audio) {
      this.camera = camera;
      this.gun = gun;
      this.fx = fx;
      this.lights = lights;
      this.audio = audio;

      this.pos = new T.Vector3(0, 0, 9.5);
      this.vel = new T.Vector3();
      this.yaw = 0; this.pitch = -0.02;
      this.eyeH = 1.64;
      this.radius = 0.34;
      this.hp = 100; this.maxHp = 100;
      this.lastHurt = -999;
      this.dead = false;

      this.onGround = true;
      this.crouch = 0;
      this.sprint = 0;
      this.walkPhase = 0;
      this.bob = 0;
      this.stepDist = 0;
      this.roll = 0;

      this.ads = 0;
      this.recoil = 0;
      this.recoilPitch = 0;
      this.recoilYaw = 0;
      this.kick = 0;
      this.sway = new T.Vector2();
      this.swayTarget = new T.Vector2();

      this.ammo = 30; this.magSize = 30; this.reserve = Infinity;
      this.reloading = false; this.reloadT = 0; this.reloadDur = 2.05;
      this.fireCd = 0; this.fireRate = 0.092;
      this.shots = 0; this.hits = 0; this.kills = 0; this.headshots = 0;

      this.flashlight = true;
      this.spread = 0; this.spreadVisual = 0;
      this.shake = 0; this.shakeT = 0;
      this.hurtFlash = 0;
      this.landKick = 0;

      this.hipPos = new T.Vector3(0.145, -0.185, -0.44);
      this.adsPos = new T.Vector3(0, -0.076, -0.44);
      this.tmpV = new T.Vector3();
      this.keys = {};
    }

    reset() {
      this.pos.set(0, 0, 9.5);
      this.vel.set(0, 0, 0);
      this.yaw = 0; this.pitch = -0.02;
      this.hp = this.maxHp;
      this.dead = false;
      this.ammo = 30; this.reloading = false; this.reloadT = 0;
      this.shots = this.hits = this.kills = this.headshots = 0;
      this.recoilPitch = this.recoilYaw = 0;
      this.ads = 0; this.flashlight = true;
      this.camera.fov = 78; this.camera.updateProjectionMatrix();
    }

    get eye() { return this.pos.y + this.eyeH - this.crouch * 0.42; }

    /* ---- collision ---- */
    blocked(x, z) {
      const r = this.radius;
      for (const c of G.colliders) {
        if (x + r > c.x0 && x - r < c.x1 && z + r > c.z0 && z - r < c.z1) return true;
      }
      if (x < -17.4 || x > 17.4 || z < -17.4 || z > 17.4) return true;
      return false;
    }
    move(dx, dz) {
      const px = this.pos.x, pz = this.pos.z;
      if (!this.blocked(px + dx, pz)) this.pos.x = px + dx;
      if (!this.blocked(this.pos.x, pz + dz)) this.pos.z = pz + dz;
    }

    hurt(amount, srcPos) {
      if (this.dead) return;
      this.hp -= amount;
      this.lastHurt = performance.now() / 1000;
      this.hurtFlash = 1;
      this.shake = Math.min(1.2, this.shake + 0.6);
      this.audio.hurt();
      if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    }

    startReload() {
      if (this.reloading || this.ammo >= this.magSize) return;
      this.reloading = true;
      this.reloadT = 0;
      this.audio.click(900, 0.05, 0.22);
      setTimeout(() => this.audio.click(1400, 0.06, 0.2), 320);
      setTimeout(() => this.audio.click(700, 0.08, 0.25), 1500);
      setTimeout(() => { this.ammo = this.magSize; this.reloading = false; this.audio.click(2200, 0.05, 0.18); }, 2020);
    }

    /* ---- shooting ---- */
    tryFire(now, enemies) {
      if (this.dead || this.reloading) return;
      if (this.fireCd > 0) return;
      if (this.ammo <= 0) {
        this.audio.dryFire();
        this.fireCd = 0.28;
        this.startReload();
        return;
      }
      this.fireCd = this.fireRate;
      this.ammo--;
      this.shots++;

      const cam = this.camera;
      const origin = cam.getWorldPosition(new T.Vector3());
      const dir = cam.getWorldDirection(new T.Vector3());

      const spreadBase = 0.0075 + this.spread;
      const s = spreadBase * (1 - this.ads * 0.82);
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * s;
      // build basis
      const right = new T.Vector3().crossVectors(dir, new T.Vector3(0, 1, 0)).normalize();
      const up = new T.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.cos(ang) * rad).addScaledVector(up, Math.sin(ang) * rad).normalize();

      // recoil
      const rk = 0.0068 * (1 - this.ads * 0.28);
      const rp = rk * (0.72 + Math.random() * 0.55);
      const ryR = (Math.random() - 0.5) * rk * 1.2;
      this.recoilPitch = Math.min(0.085, this.recoilPitch + rp);
      this.recoilYaw += ryR;
      this.pitch += rp;
      this.yaw += ryR;
      this.kick = Math.min(1.4, this.kick + 0.55);
      this.shake = Math.min(1.0, this.shake + 0.12);
      this.audio.shot();
      this.muzzleFlash();

      const hit = this.trace(origin, dir, 90, enemies);
      const muzzleWorld = cam.localToWorld(new T.Vector3(0.1, -0.09, -0.62));
      if (hit) {
        this.fx.tracer(muzzleWorld, hit.point, 0xffe6bd);
        if (hit.enemy) {
          this.hits++;
          const head = hit.head;
          hit.enemy.damage(head ? 100 : 34, hit.point, head);
          this.fx.impact(hit.point, dir.clone().negate(), 'metal');
          this.audio.hit();
          if (head) this.headshots++;
          G.onHit && G.onHit(hit.enemy.hp <= 0, head);
        } else {
          this.fx.impact(hit.point, hit.normal, hit.kind === 'wet' ? 'wet' : 'concrete');
        }
      }
      // shell casing
      const rightV = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      this.fx.sparks.spawn(
        origin.x + rightV.x * 0.12, origin.y - 0.06, origin.z + rightV.z * 0.12,
        rightV.x * 2.6 + rnd(-0.3, 0.3), rnd(0.8, 2.2), rightV.z * 2.6 + rnd(-0.3, 0.3),
        0.9, 0.7, new T.Color(0xd8a24a), -9.5, 0.4, 0
      );
    }

    trace(origin, dir, maxDist, enemies) {
      let best = null;
      // enemies (sphere)
      for (const e of enemies) {
        if (!e.alive) continue;
        const c = e.pos;
        const toC = new T.Vector3().subVectors(c, origin);
        const tca = toC.dot(dir);
        if (tca < 0) continue;
        const d2 = toC.lengthSq() - tca * tca;
        const R = 0.62;
        if (d2 < R * R) {
          const t = tca - Math.sqrt(R * R - d2);
          if (t > 0 && t < maxDist && (!best || t < best.t)) {
            best = { t, point: origin.clone().addScaledVector(dir, t), enemy: e, normal: dir.clone().negate(), head: false, kind: 'metal' };
          }
        }
        // eye / head sphere
        const eye = e.eyeWorld(new T.Vector3());
        const toE = new T.Vector3().subVectors(eye, origin);
        const tcaE = toE.dot(dir);
        if (tcaE > 0) {
          const d2E = toE.lengthSq() - tcaE * tcaE;
          const RE = 0.26;
          if (d2E < RE * RE) {
            const t = tcaE - Math.sqrt(RE * RE - d2E);
            if (t > 0 && t < maxDist && (!best || t < best.t)) {
              best = { t, point: origin.clone().addScaledVector(dir, t), enemy: e, normal: dir.clone().negate(), head: true, kind: 'metal' };
            }
          }
        }
      }
      // world
      const wh = G.worldRay(origin, dir, maxDist);
      if (wh && (!best || wh.t < best.t)) {
        wh.enemy = null;
        best = wh;
      }
      return best;
    }

    muzzleFlash() {
      const g = this.gun;
      const cam = this.camera;
      const wp = cam.localToWorld(new T.Vector3(0.11, -0.085, -0.68));
      this.fx.muzzle(wp, 0.9 + Math.random() * 0.45);
      this.lights.muzzle.position.copy(wp);
      this.lights.muzzle.intensity = 46;
      g.flashLight.intensity = 8;
    }

    /* ---- per frame ---- */
    update(dt, now, input) {
      const cam = this.camera;
      if (this.dead) {
        // death cam drop
        this.recoilPitch = damp(this.recoilPitch, 0.42, 3, dt);
        cam.position.set(this.pos.x, this.pos.y + 0.7, this.pos.z);
        cam.rotation.set(-0.35, this.yaw, 0.5, 'YXZ');
        return;
      }
      const K = input.keys;
      const mouse = input.mouseDelta;
      this.mouseDX = mouse.x; this.mouseDY = mouse.y;
      input.mouseDelta = { x: 0, y: 0 };

      // look
      const sens = 0.0021 * (1 - this.ads * 0.32);
      this.yaw -= mouse.x * sens;
      this.pitch -= mouse.y * sens;
      this.pitch = clamp(this.pitch, -1.45, 1.42);

      // reload progress
      if (this.reloading) {
        this.reloadT += dt;
        if (this.reloadT > this.reloadDur) { this.reloading = false; this.reloadT = 0; }
      }

      // movement
      const wantSprint = (K['shiftleft'] || K['shiftright']) && K['keyw'] && !this.reloading;
      const crouching = K['controlleft'] || K['keyc'];
      this.crouch = damp(this.crouch, crouching ? 1 : 0, 12, dt);
      const sprinting = wantSprint && !crouching && !K['mouse0'];
      this.sprint = damp(this.sprint, sprinting ? 1 : 0, 9, dt);

      let fwd = 0, side = 0;
      if (K['keyw']) fwd += 1;
      if (K['keys']) fwd -= 1;
      if (K['keya']) side -= 1;
      if (K['keyd']) side += 1;
      const len = Math.hypot(fwd, side);
      if (len > 0) { fwd /= len; side /= len; }

      const speed = crouching ? 2.3 : (sprinting ? 8.4 : 5.3);
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      const wishX = (-sinY * fwd + cosY * side) * speed;
      const wishZ = (-cosY * fwd - sinY * side) * speed;

      const accel = this.onGround ? (len > 0 ? 14 : 11) : 3.2;
      this.vel.x = damp(this.vel.x, wishX, accel, dt);
      this.vel.z = damp(this.vel.z, wishZ, accel, dt);
      this.vel.y -= 21 * dt;
      if (K['space'] && this.onGround) {
        this.vel.y = 6.3;
        this.onGround = false;
        this.audio.step(true);
      }
      this.move(this.vel.x * dt, this.vel.z * dt);
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        if (!this.onGround && this.vel.y < -4) {
          this.landKick = Math.min(1, -this.vel.y / 10);
          this.audio.step(true);
        }
        this.pos.y = 0; this.vel.y = 0; this.onGround = true;
      }
      this.landKick = damp(this.landKick, 0, 7, dt);

      // footsteps
      const hspeed = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hspeed > 1.2) {
        this.stepDist += hspeed * dt;
        const stride = sprinting ? 1.9 : 2.3;
        if (this.stepDist > stride) { this.stepDist = 0; this.audio.step(true); }
        this.walkPhase += dt * (sprinting ? 11 : 7.2);
      } else {
        this.walkPhase += dt * 1.4;
      }
      const bobAmp = clamp(hspeed / 8, 0, 1) * (1 - this.ads * 0.75);
      this.bob = damp(this.bob, Math.sin(this.walkPhase * 2) * 0.022 * bobAmp, 14, dt);
      this.roll = damp(this.roll, -side * 0.022 * (1 - this.ads * 0.5), 6, dt);

      // ADS
      const wantAds = input.ads && !this.reloading;
      this.ads = damp(this.ads, wantAds ? 1 : 0, 13, dt);
      const fov = 78 + this.sprint * 6 - this.ads * 26;
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }

      // recoil recovery
      const rec = Math.min(this.recoilPitch, dt * 2.4);
      this.pitch -= rec;
      this.recoilPitch -= rec;
      this.recoilYaw = damp(this.recoilYaw, 0, 9, dt);
      this.kick = damp(this.kick, 0, 12, dt);

      // shake
      this.shake = damp(this.shake, 0, 4.4, dt);
      const st = now * 34;
      const shX = Math.sin(st * 1.7) * this.shake * 0.006;
      const shY = Math.cos(st * 2.3) * this.shake * 0.005;

      // camera transform
      cam.position.set(this.pos.x, this.eye + this.bob - this.landKick * 0.09, this.pos.z);
      if (this.onGround) cam.position.x += Math.sin(this.walkPhase) * 0.012 * bobAmp;
      cam.rotation.set(this.pitch + shY, this.yaw + shX, this.roll, 'YXZ');

      // weapon viewmodel
      this.updateGun(dt, now, input, hspeed, sprinting);

      // spread state
      const moveSpread = clamp(hspeed / 8, 0, 1) * 0.012 + (this.onGround ? 0 : 0.02);
      this.spread = damp(this.spread, moveSpread + this.kick * 0.006, 8, dt);
      this.spreadVisual = damp(this.spreadVisual, this.spread, 18, dt);

      // auto fire
      this.fireCd -= dt;
      if (input.fire && !this.reloading) this.tryFire(now, G.enemies || []);

      // flashlight
      const fl = this.lights.flash;
      fl.intensity = this.flashlight ? 42 : 0;
      const fwdV = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      fl.position.copy(cam.position).addScaledVector(fwdV, 0.35);
      fl.position.y -= 0.1;
      this.lights.flashTarget.position.copy(cam.position).addScaledVector(fwdV, 12);
      fl.position.x += new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).x * 0.16;
      fl.position.z += new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).z * 0.16;

      // damage regen
      const tsec = now;
      if (tsec - this.lastHurt > 5.2 && this.hp < this.maxHp) {
        this.hp = Math.min(this.maxHp, this.hp + dt * 9);
      }
      this.hurtFlash = damp(this.hurtFlash, 0, 2.6, dt);
    }

    updateGun(dt, now, input, hspeed, sprinting) {
      const g = this.gun;
      const root = g.root;
      const ads = this.ads;
      const t = now;

      // sway from mouse (also drives gun lag)
      this.swayTarget.set(
        clamp(-(this.mouseDX || 0) * 0.00035, -0.026, 0.026),
        clamp(-(this.mouseDY || 0) * 0.00035, -0.026, 0.026)
      );
      this.sway.x = damp(this.sway.x, this.swayTarget.x - Math.sin(t * 0.9) * 0.0025, 6, dt);
      this.sway.y = damp(this.sway.y, this.swayTarget.y + Math.cos(t * 1.3) * 0.002, 6, dt);

      const bobScale = (1 - ads * 0.85);
      const bobX = Math.sin(this.walkPhase) * 0.016 * bobScale * clamp(hspeed / 5, 0, 1);
      const bobY = Math.abs(Math.cos(this.walkPhase)) * 0.012 * bobScale * clamp(hspeed / 5, 0, 1);

      const sprintDrop = this.sprint * 0.12;
      const hip = this.hipPos, ap = this.adsPos;
      let px = lerp(hip.x, ap.x, ads) + this.sway.x + bobX;
      let py = lerp(hip.y, ap.y, ads) + this.sway.y - bobY - sprintDrop - this.landKick * 0.03;
      let pz = lerp(hip.z, ap.z, ads) + this.kick * 0.045;

      let rx = this.kick * 0.07 - this.sprint * 0.26 + this.recoilPitch * 0.55;
      let ry = this.sway.x * 1.6 + this.sprint * 0.3 + 0.03;
      let rz = this.sprint * 0.24 + this.sway.x * 1.2;

      // reload animation
      if (this.reloading) {
        const p = clamp(this.reloadT / this.reloadDur, 0, 1);
        const down = Math.sin(clamp(p / 0.28, 0, 1) * Math.PI * 0.5);
        const up = 1 - clamp((p - 0.82) / 0.18, 0, 1);
        const k = down * up;
        px -= 0.05 * k; py -= 0.16 * k; pz += 0.04 * k;
        rx -= 0.5 * k; rz += 0.55 * k;
        // magazine out / in
        const mt = clamp((p - 0.18) / 0.5, 0, 1);
        const out = mt < 0.5 ? mt * 2 : (1 - mt) * 2;
        g.mag.position.y = -0.03 - out * 0.18;
        g.mag.position.z = 0.03 + out * 0.06;
        g.mag.rotation.z = out * 0.5;
        g.mag.visible = !(p > 0.6 && p < 0.66);
        // charging handle
        if (p > 0.8) g.charge.position.z = 0.06 + Math.sin((p - 0.8) / 0.2 * Math.PI) * 0.05;
        else g.charge.position.z = 0.06;
      } else {
        g.mag.position.y = -0.03; g.mag.position.z = 0.03; g.mag.rotation.z = 0; g.mag.visible = true;
        g.charge.position.z = 0.06;
      }

      root.position.set(px, py, pz);
      root.rotation.set(rx, ry, rz);

      // flash decay
      g.flashLight.intensity = damp(g.flashLight.intensity, 0, 30, dt);
      this.lights.muzzle.intensity = damp(this.lights.muzzle.intensity, 0, 26, dt);
      if (g.dotGlow) g.dotGlow.material.opacity = 0.35 + 0.25 * Math.sin(t * 3.0);
    }
  }
  G.Player = Player;

  /* ---------------------------------------------------------------
     World raycast (floor + boxes)
     --------------------------------------------------------------- */
  function rayBox(o, d, min, max) {
    let tmin = 0, tmax = 1e9, axis = 0, sign = 1;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const mn = a === 0 ? min.x : a === 1 ? min.y : min.z;
      const mx = a === 0 ? max.x : a === 1 ? max.y : max.z;
      if (Math.abs(da) < 1e-9) {
        if (oa < mn || oa > mx) return null;
        continue;
      }
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmin <= 0) return null;
    const n = new T.Vector3();
    if (axis === 0) n.x = sign; else if (axis === 1) n.y = sign; else n.z = sign;
    return { t: tmin, n };
  }

  G.worldRay = function (from, dir, maxDist) {
    let best = null;
    if (dir.y < -1e-5) {
      const t = -from.y / dir.y;
      if (t > 0.02 && t < maxDist) {
        best = { t, point: from.clone().addScaledVector(dir, t), normal: new T.Vector3(0, 1, 0), kind: 'wet' };
      }
    }
    const boxes = G.hitBoxes || [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const r = rayBox(from, dir, b.min, b.max);
      if (r && r.t < maxDist && (!best || r.t < best.t)) {
        best = { t: r.t, point: from.clone().addScaledVector(dir, r.t), normal: r.n, kind: b.kind || 'concrete' };
      }
    }
    return best;
  };
})();
