/* =========================================================
   NEON RAIN — enemies: hover drones, projectiles, wave director
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;
  const { clamp, lerp, damp, rnd, smoothstep } = G;

  /* ---------------------------------------------------------------
     Materials cache (shared, then cloned per drone for hit flash)
     --------------------------------------------------------------- */
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    MATS = {
      shell: new T.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.36, metalness: 0.95, envMapIntensity: 1.3 }),
      shellDark: new T.MeshStandardMaterial({ color: 0x121417, roughness: 0.5, metalness: 0.9, envMapIntensity: 0.9 }),
      plate: new T.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.6, metalness: 0.5, envMapIntensity: 0.8 }),
      ring: new T.MeshStandardMaterial({ color: 0x8f9aa6, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.7 }),
      eye: new T.MeshBasicMaterial({ color: 0xff3a1e, toneMapped: false }),
      eyeHouse: new T.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.3, metalness: 0.8 })
    };
    return MATS;
  }

  const GLOW_RED = 0xff4422;
  const GLOW_BLUE = 0x44ddff;

  /* ---------------------------------------------------------------
     Drone
     --------------------------------------------------------------- */
  class Drone {
    constructor(scene, fx, audio, pos, kind) {
      this.fx = fx; this.audio = audio;
      this.kind = kind || 'scout';
      this.scene = scene;
      this.alive = true;
      this.maxHp = this.kind === 'gunner' ? 150 : 90;
      this.hp = this.maxHp;
      this.radius = this.kind === 'gunner' ? 0.78 : 0.62;
      this.speed = this.kind === 'gunner' ? 2.4 : 3.6;
      this.fireInterval = this.kind === 'gunner' ? 2.4 : 1.9;
      this.projSpeed = this.kind === 'gunner' ? 20 : 24;
      this.dmg = this.kind === 'gunner' ? 15 : 10;
      this.scale = this.kind === 'gunner' ? 1.55 : 1.18;

      this.pos = pos.clone();
      this.vel = new T.Vector3();
      this.phase = rnd(0, 6.28);
      this.strafe = rnd(0, 6.28);
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = rnd(1.2, 3.2);
      this.fireCd = rnd(0.8, 2.4);
      this.charge = 0;
      this.hitFlash = 0;
      this.deadT = 0;
      this.spawnT = 0;
      this.orbitR = rnd(8.5, 13);
      this.baseY = rnd(2.9, 4.6);

      this.build();
    }

    build() {
      const m = mats();
      const g = new T.Group();
      g.scale.setScalar(this.scale);
      const bodyMat = m.shell.clone();
      const darkMat = m.shellDark.clone();
      this.bodyMat = bodyMat;

      const core = new T.Mesh(new T.IcosahedronGeometry(0.4, 2), bodyMat);
      core.scale.set(1, 0.72, 1.15);
      core.castShadow = true;
      g.add(core);

      // armour plates
      const p1 = new T.Mesh(new T.BoxGeometry(0.5, 0.12, 0.62), darkMat);
      p1.position.y = 0.2; p1.rotation.x = 0.12; g.add(p1);
      const p2 = new T.Mesh(new T.BoxGeometry(0.46, 0.1, 0.4), m.plate);
      p2.position.set(0, -0.22, 0.05); g.add(p2);

      // gyro rings
      this.ring1 = new T.Mesh(new T.TorusGeometry(0.66, 0.026, 6, 44), m.ring);
      this.ring1.rotation.x = Math.PI / 2;
      g.add(this.ring1);
      this.ring2 = new T.Mesh(new T.TorusGeometry(0.56, 0.02, 6, 36), m.ring);
      this.ring2.rotation.y = Math.PI / 2;
      g.add(this.ring2);

      // eye assembly
      const house = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.18, 16), m.eyeHouse);
      house.rotation.x = Math.PI / 2;
      house.position.set(0, 0.02, -0.4);
      g.add(house);
      this.eyeMat = m.eye.clone();
      this.eye = new T.Mesh(new T.SphereGeometry(0.1, 12, 10), this.eyeMat);
      this.eye.position.set(0, 0.02, -0.49);
      g.add(this.eye);
      this.eyeGlow = new T.Sprite(new T.SpriteMaterial({
        map: G.tex.glow, color: GLOW_RED, blending: T.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false
      }));
      this.eyeGlow.scale.set(0.62, 0.62, 0.62);
      this.eyeGlow.position.set(0, 0.02, -0.5);
      g.add(this.eyeGlow);

      // thrusters
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094;
        const th = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 0.16, 10), darkMat);
        th.position.set(Math.cos(a) * 0.34, -0.22, Math.sin(a) * 0.34 + 0.1);
        g.add(th);
        const gl = new T.Sprite(new T.SpriteMaterial({
          map: G.tex.glow, color: GLOW_BLUE, blending: T.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: 0.55, toneMapped: false
        }));
        gl.scale.set(0.4, 0.4, 0.4);
        gl.position.copy(th.position); gl.position.y -= 0.1;
        g.add(gl);
      }

      // fins
      for (let i = 0; i < 2; i++) {
        const fin = new T.Mesh(new T.BoxGeometry(0.7, 0.03, 0.16), m.plate);
        fin.position.set(0, -0.05, 0.32);
        fin.rotation.z = i ? 0.5 : -0.5;
        fin.rotation.x = 0.2;
        g.add(fin);
      }

      g.position.copy(this.pos);
      this.scene.add(g);
      this.group = g;
    }

    eyeWorld(out) {
      return this.group.localToWorld(out.set(0, 0.02, -0.49));
    }

    damage(amount, point, head) {
      if (!this.alive) return;
      this.hp -= amount;
      this.hitFlash = 1;
      if (this.hp <= 0) this.die(point);
    }

    die(point) {
      this.alive = false;
      this.deadT = 0;
      this.audio.explode(this.pos.distanceTo(G.playerRef.pos));
      this.fx.explosion(this.pos.clone(), this.kind === 'gunner' ? 1.5 : 1.15);
      G.onKill && G.onKill(this);
      // hide after short delay via fade
      this.dead = true;
    }

    spawnFX() { /* reserved */ }

    fire(playerPos) {
      const from = this.eyeWorld(new T.Vector3());
      const target = new T.Vector3(playerPos.x, playerPos.y + 1.05, playerPos.z);
      const dir = target.clone().sub(from).normalize();
      // slight lead / inaccuracy
      dir.x += rnd(-0.03, 0.03); dir.y += rnd(-0.02, 0.02); dir.z += rnd(-0.03, 0.03);
      dir.normalize();
      G.projectiles.spawn(from, dir, this.projSpeed, this.dmg);
      this.audio.enemyShot();
      // muzzle glow
      for (let i = 0; i < 5; i++) {
        this.fx.sparks.spawn(from.x, from.y, from.z, dir.x * rnd(1, 4) + rnd(-1, 1), dir.y * rnd(1, 3) + rnd(-1, 1), dir.z * rnd(1, 4) + rnd(-1, 1),
          0.22, 0.9, new T.Color(0xff6633), 0, 2, 0);
      }
      this.eyeMat.color.setHex(0xffffff);
    }

    update(dt, t, player) {
      if (!this.alive) {
        this.deadT += dt;
        const k = clamp(1 - this.deadT / 0.22, 0, 1);
        this.group.scale.setScalar(Math.max(0.001, k) * this.scale);
        this.group.rotation.y += dt * 9;
        this.group.position.y -= dt * 2.5;
        if (this.deadT > 0.24) this.group.visible = false;
        return;
      }
      const toPlayer = new T.Vector3().subVectors(player.pos, this.pos);
      const dist = toPlayer.length();
      toPlayer.normalize();

      // steering: orbit target point
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = rnd(1.4, 3.6);
        this.strafeDir *= -1;
        this.orbitR = clamp(this.orbitR + rnd(-1.6, 1.6), 7.5, 14);
      }
      this.strafe += dt * 0.5 * this.strafeDir;
      const wantR = this.orbitR;
      const tx = player.pos.x + Math.cos(this.strafe) * wantR;
      const tz = player.pos.z + Math.sin(this.strafe) * wantR;
      const ty = this.baseY + Math.sin(t * 1.1 + this.phase) * 0.45;

      // keep inside the plaza
      const clampR = v => clamp(v, -15.5, 15.5);

      const desired = new T.Vector3(clampR(tx) - this.pos.x, ty - this.pos.y, clampR(tz) - this.pos.z);
      const dl = desired.length();
      if (dl > 0.001) desired.multiplyScalar(this.speed / Math.max(1, dl * 0.7));

      // separation
      for (const o of G.enemies) {
        if (o === this || !o.alive) continue;
        const dv = new T.Vector3().subVectors(this.pos, o.pos);
        const d = dv.length();
        if (d < 2.2 && d > 0.001) desired.addScaledVector(dv, (2.2 - d) * 0.9 / d);
      }

      this.vel.x = damp(this.vel.x, desired.x, 3.2, dt);
      this.vel.y = damp(this.vel.y, desired.y, 3.2, dt);
      this.vel.z = damp(this.vel.z, desired.z, 3.2, dt);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = clamp(this.pos.y, 2.2, 9.5);

      // face the player
      const look = new T.Vector3().subVectors(player.pos, this.pos);
      look.y += 1.0;
      const q = new T.Quaternion().setFromRotationMatrix(
        new T.Matrix4().lookAt(new T.Vector3(), look, new T.Vector3(0, 1, 0))
      );
      this.group.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
      this.group.position.copy(this.pos);
      this.group.position.y += Math.sin(t * 2.2 + this.phase) * 0.06;
      this.group.rotateZ(Math.sin(t * 1.6 + this.phase) * 0.04);

      // animated rings
      this.ring1.rotation.z += dt * 2.2;
      this.ring2.rotation.x += dt * 1.6;

      // hit flash decay
      this.hitFlash = damp(this.hitFlash, 0, 12, dt);
      const flash = this.hitFlash;
      this.bodyMat.emissive.setRGB(flash * 1.4, flash * 0.5, flash * 0.15);

      // attack
      const losDir = new T.Vector3().subVectors(player.pos, this.pos).normalize();
      const wh = G.worldRay(this.pos, losDir, Math.max(1, dist - 1.0));
      const canSee = !(wh && wh.kind !== 'wet' && wh.t < dist - 1.0);
      if (dist < 26 && canSee) this.fireCd -= dt; else this.fireCd -= dt * 0.2;

      const charging = this.fireCd < 0.55 && this.fireCd > 0;
      if (charging) {
        const k = 1 - clamp(this.fireCd / 0.55, 0, 1);
        this.eyeMat.color.setRGB(1, 0.25 + k * 0.6, 0.15 + k * 0.5);
        this.eyeGlow.scale.setScalar(0.6 + k * 0.9);
        this.eyeGlow.material.opacity = 0.75 + k * 0.25;
        this.group.rotateX(Math.sin(t * 60) * 0.004);
      } else {
        this.eyeMat.color.setRGB(1, 0.22, 0.12);
        this.eyeGlow.scale.setScalar(0.58 + Math.sin(t * 5 + this.phase) * 0.05);
        this.eyeGlow.material.opacity = 0.7;
      }
      if (this.fireCd <= 0) {
        this.fireCd = this.fireInterval + rnd(-0.3, 0.3);
        if (canSee) this.fire(player.pos);
      }
    }

    dispose() {
      this.scene.remove(this.group);
      this.group.visible = false;
    }
  }

  /* ---------------------------------------------------------------
     Projectiles
     --------------------------------------------------------------- */
  class Projectiles {
    constructor(scene, fx) {
      this.scene = scene; this.fx = fx;
      this.list = [];
      this.geo = new T.SphereGeometry(0.085, 10, 8);
      this.matA = new T.MeshBasicMaterial({ color: 0xff7a3c, toneMapped: false });
    }
    spawn(from, dir, speed, dmg) {
      const m = new T.Mesh(this.geo, this.matA);
      m.position.copy(from);
      const glow = new T.Sprite(new T.SpriteMaterial({
        map: G.tex.glow, color: 0xff5522, blending: T.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false
      }));
      glow.scale.set(0.75, 0.75, 0.75);
      m.add(glow);
      this.scene.add(m);
      this.list.push({ mesh: m, dir: dir.clone(), speed, dmg, life: 6, prev: from.clone() });
    }
    update(dt, player) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.life -= dt;
        p.prev.copy(p.mesh.position);
        p.mesh.position.addScaledVector(p.dir, p.speed * dt);
        // world collision
        const seg = p.mesh.position.distanceTo(p.prev);
        const wh = G.worldRay(p.prev, p.dir, seg);
        // player hit
        const pc = new T.Vector3(player.pos.x, player.pos.y + 1.05, player.pos.z);
        const distP = pc.distanceTo(p.mesh.position);
        if (distP < 0.62 && !player.dead) {
          player.hurt(p.dmg, p.mesh.position);
          this.fx.impact(p.mesh.position, p.dir.clone().negate(), 'energy');
          this.remove(i);
          continue;
        }
        if (wh) {
          this.fx.impact(wh.point, wh.normal, 'energy');
          for (let k = 0; k < 6; k++) {
            this.fx.sparks.spawn(wh.point.x, wh.point.y, wh.point.z,
              rnd(-3, 3), rnd(0, 4), rnd(-3, 3), 0.3, 1.2, new T.Color(0xff7a3c), -10, 1, 0);
          }
          this.remove(i);
          continue;
        }
        if (p.life <= 0 || p.mesh.position.y < -2) this.remove(i);
      }
    }
    remove(i) {
      const p = this.list[i];
      this.scene.remove(p.mesh);
      p.mesh.children.forEach(c => { if (c.material) c.material.dispose(); });
      this.list.splice(i, 1);
    }
    clear() { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); }
  }
  G.Projectiles = Projectiles;

  /* ---------------------------------------------------------------
     Wave director
     --------------------------------------------------------------- */
  class Director {
    constructor(scene, fx, audio) {
      this.scene = scene; this.fx = fx; this.audio = audio;
      this.wave = 0;
      this.maxWave = 5;
      this.pending = 0;
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.state = 'idle';
      this.betweenT = 0;
      this.onWave = null;
      this.onWin = null;
      this.startDelay = 1.2;
    }
    reset() {
      this.wave = 0; this.pending = 0; this.spawnQueue = [];
      this.state = 'idle'; this.betweenT = 0; this.startDelay = 1.2;
      for (const e of G.enemies) e.dispose();
      G.enemies.length = 0;
    }
    start() {
      this.state = 'between';
      this.betweenT = 1.6;
    }
    nextWave() {
      this.wave++;
      if (this.wave > this.maxWave) { this.state = 'done'; this.onWin && this.onWin(); return; }
      const n = 2 + this.wave; // 3,4,5,6,7
      this.spawnQueue = [];
      for (let i = 0; i < n; i++) {
        const kind = (this.wave >= 3 && i % 3 === 2) ? 'gunner' : 'scout';
        this.spawnQueue.push({ kind, delay: i * 0.55 });
      }
      this.spawnTimer = 0;
      this.state = 'spawning';
      this.onWave && this.onWave(this.wave, n);
      this.audio.thunder();
    }
    spawnOne(kind) {
      const p = new T.Vector3();
      let tries = 0;
      do {
        const a = Math.random() * 6.2832;
        const r = 10 + Math.random() * 5;
        p.set(Math.cos(a) * r, 3.2 + Math.random() * 1.6, Math.sin(a) * r);
        p.x = clamp(p.x, -14, 14); p.z = clamp(p.z, -14, 14);
        tries++;
      } while (p.distanceTo(G.playerRef.pos) < 7 && tries < 20);
      const d = new Drone(this.scene, this.fx, this.audio, p, kind);
      G.enemies.push(d);
      // spawn burst — sparks only, no smoke wall
      for (let i = 0; i < 18; i++) {
        const v = new T.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(2, 7));
        this.fx.sparks.spawn(p.x, p.y, p.z, v.x, v.y, v.z, rnd(0.2, 0.5), rnd(0.6, 1.5), new T.Color(0x66ccff), -6, 1.2, 0);
      }
      this.audio.click(2600, 0.12, 0.12);
      return d;
    }
    update(dt,time2) {
      if (this.state === 'between') {
        this.betweenT -= dt;
        if (this.betweenT <= 0) this.nextWave();
      } else if (this.state === 'spawning') {
        this.spawnTimer += dt;
        while (this.spawnQueue.length && this.spawnQueue[0].delay <= this.spawnTimer) {
          const s = this.spawnQueue.shift();
          this.spawnOne(s.kind);
        }
        if (!this.spawnQueue.length) this.state = 'fighting';
      } else if (this.state === 'fighting') {
        if (!G.enemies.some(e => e.alive)) {
          this.state = 'between';
          this.betweenT = 4.5;
          this.onWave && this.onWave(-1, 0);
        }
      }
    }
  }
  G.Director = Director;
  G.Drone = Drone;
})();
