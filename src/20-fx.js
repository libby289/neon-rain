/* =========================================================
   NEON RAIN — FX: rain, spray, sparks, smoke, tracers, decals, muzzle
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;
  const { clamp, rnd, lerp } = G;

  /* ---------------- particle pool ---------------- */
  class Pool {
    constructor(max, opts) {
      this.max = max; this.n = 0;
      this.pos = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3);
      this.col = new Float32Array(max * 3);
      this.size = new Float32Array(max);
      this.alpha = new Float32Array(max);
      this.life = new Float32Array(max);
      this.maxLife = new Float32Array(max);
      this.grav = new Float32Array(max);
      this.drag = new Float32Array(max);
      this.grow = new Float32Array(max);

      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
      geo.setAttribute('aColor', new T.BufferAttribute(this.col, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(this.size, 1));
      geo.setAttribute('aAlpha', new T.BufferAttribute(this.alpha, 1));
      geo.setDrawRange(0, 0);
      geo.boundingSphere = new T.Sphere(new T.Vector3(), 999);

      const mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true,
        blending: opts.additive ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { uMap: { value: opts.tex }, uOpacity: { value: opts.opacity === undefined ? 1.0 : opts.opacity }, uSizeScale: { value: opts.sizeScale || 300 } },
        vertexShader: `
          attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
          uniform float uSizeScale;
          varying vec3 vColor; varying float vAlpha;
          void main(){
            vColor = aColor; vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = clamp(aSize * (uSizeScale / max(0.1, -mv.z)), 1.0, 220.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D uMap; uniform float uOpacity; uniform float uSizeScale;
          varying vec3 vColor; varying float vAlpha;
          void main(){
            vec4 t = texture2D(uMap, gl_PointCoord);
            if (t.a < 0.002) discard;
            gl_FragColor = vec4(vColor, t.a * vAlpha * uOpacity);
          }`
      });
      this.points = new T.Points(geo, mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 20;
      this.geo = geo;
      this.opts = opts;
    }
    spawn(x, y, z, vx, vy, vz, life, size, color, grav, drag, grow) {
      const i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
      const i3 = i * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
      this.size[i] = size; this.alpha[i] = 1;
      this.life[i] = life; this.maxLife[i] = life;
      this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow || 0;
    }
    update(dt) {
      const n = this.n;
      if (!n) return;
      const pos = this.pos, vel = this.vel, life = this.life, ml = this.maxLife;
      for (let i = 0; i < n; i++) {
        if (life[i] <= 0) { this.alpha[i] = 0; continue; }
        life[i] -= dt;
        const i3 = i * 3;
        vel[i3 + 1] += this.grav[i] * dt;
        const d = 1 - this.drag[i] * dt;
        vel[i3] *= d; vel[i3 + 1] *= d; vel[i3 + 2] *= d;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        if (pos[i3 + 1] < 0.02 && this.grav[i] < 0) {
          pos[i3 + 1] = 0.02;
          vel[i3 + 1] *= -0.32;
          vel[i3] *= 0.6; vel[i3 + 2] *= 0.6;
        }
        const t = clamp(life[i] / ml[i], 0, 1);
        this.alpha[i] = t * t * (this.opts.fadePow || 1);
        this.size[i] += this.grow[i] * dt;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.setDrawRange(0, n);
    }
  }

  /* ---------------- rain ---------------- */
  function makeRain(scene) {
    const COUNT = 5200;
    const RANGE = 40, HEIGHT = 26;
    const pos = new Float32Array(COUNT * 2 * 3);
    const aEnd = new Float32Array(COUNT * 2);
    const aSpeed = new Float32Array(COUNT * 2);
    const aLen = new Float32Array(COUNT * 2);
    const aTint = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = rnd(-RANGE / 2, RANGE / 2);
      const y = rnd(0, HEIGHT);
      const z = rnd(-RANGE / 2, RANGE / 2);
      const sp = rnd(17, 27);
      const ln = rnd(0.35, 0.8);
      const tint = rnd(0.5, 1.0);
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
        aEnd[j] = k;
        aSpeed[j] = sp;
        aLen[j] = ln;
        aTint[j] = tint;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new T.BufferAttribute(aEnd, 1));
    geo.setAttribute('aSpeed', new T.BufferAttribute(aSpeed, 1));
    geo.setAttribute('aLen', new T.BufferAttribute(aLen, 1));
    geo.setAttribute('aTint', new T.BufferAttribute(aTint, 1));
    geo.boundingSphere = new T.Sphere(new T.Vector3(), 999);

    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new T.Vector3() },
        uRange: { value: RANGE }, uHeight: { value: HEIGHT },
        uColor: { value: new T.Color(0x9fc4e8) }
      },
      vertexShader: `
        attribute float aEnd; attribute float aSpeed; attribute float aLen; attribute float aTint;
        uniform float uTime; uniform vec3 uCam; uniform float uRange; uniform float uHeight;
        varying float vA; varying float vTint;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime*aSpeed, uHeight);
          p.x = mod(p.x - uCam.x + uRange*0.5, uRange) - uRange*0.5 + uCam.x;
          p.z = mod(p.z - uCam.z + uRange*0.5, uRange) - uRange*0.5 + uCam.z;
          p.y += uCam.y - 3.0;
          vec3 dir = normalize(vec3(0.14, -1.0, 0.05));
          p += dir * aEnd * aLen;
          float d = length(p - uCam);
          vA = smoothstep(uRange*0.52, uRange*0.16, d) * (0.22 + 0.78*aEnd);
          vTint = aTint;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA; varying float vTint;
        void main(){
          gl_FragColor = vec4(uColor * (0.60 + vTint*0.7), vA * 0.44);
        }`
    });
    const rain = new T.LineSegments(geo, mat);
    rain.frustumCulled = false;
    rain.renderOrder = 15;
    scene.add(rain);

    // ground spray (little pops of water)
    const SCOUNT = 900;
    const sp = new Float32Array(SCOUNT * 3);
    const ph = new Float32Array(SCOUNT);
    for (let i = 0; i < SCOUNT; i++) {
      sp[i * 3] = rnd(-18, 18); sp[i * 3 + 1] = 0; sp[i * 3 + 2] = rnd(-18, 18);
      ph[i] = Math.random();
    }
    const sgeo = new T.BufferGeometry();
    sgeo.setAttribute('position', new T.BufferAttribute(sp, 3));
    sgeo.setAttribute('aPhase', new T.BufferAttribute(ph, 1));
    sgeo.boundingSphere = new T.Sphere(new T.Vector3(), 999);
    const smat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aPhase; uniform float uTime;
        varying float vA;
        void main(){
          float t = fract(uTime*0.85 + aPhase*7.13);
          vec3 p = position;
          p.y += sin(t*3.14159) * 0.14 * (0.5+aPhase);
          vA = (1.0-t) * 0.34 * smoothstep(0.0,0.15,t);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = clamp((8.0 + aPhase*6.0) / max(0.1,-mv.z), 1.0, 14.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA;
        void main(){ vec2 c = gl_PointCoord-0.5; float d=length(c); if(d>0.5) discard;
          gl_FragColor = vec4(vec3(0.65,0.8,0.95), vA*(1.0-d*2.0)); }`
    });
    const spray = new T.Points(sgeo, smat);
    spray.frustumCulled = false;
    scene.add(spray);

    return { rain, mat, spray, smat };
  }

  /* ---------------- FX manager ---------------- */
  class FXManager {
    constructor(scene, camera) {
      this.scene = scene;
      this.camera = camera;
      const tex = G.tex;
      this.sparks = new Pool(600, { additive: true, tex: tex.glow, sizeScale: 80 });
      this.smoke = new Pool(220, { additive: false, tex: tex.smoke, fadePow: 1.0, opacity: 0.30, sizeScale: 300 });
      this.glow = new Pool(120, { additive: true, tex: tex.glow, sizeScale: 70 });
      scene.add(this.sparks.points, this.smoke.points, this.glow.points);

      this.rain = makeRain(scene);
      this.decals = [];
      this.decalIdx = 0;
      this.tracers = [];
      this.flashes = [];
      this.rings = [];
      this.steamT = 0;

      const holeMat = new T.MeshBasicMaterial({
        map: tex.hole, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        opacity: 0.95, toneMapped: false, color: 0xffffff
      });
      for (let i = 0; i < 48; i++) {
        const m = new T.Mesh(new T.PlaneGeometry(0.22, 0.22), holeMat.clone());
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        this.decals.push(m);
      }
      const tracerGeo = new T.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
      for (let i = 0; i < 10; i++) {
        const m = new T.Mesh(tracerGeo, new T.MeshBasicMaterial({
          color: 0xffd9a0, transparent: true, opacity: 0, blending: T.AdditiveBlending,
          depthWrite: false, toneMapped: false
        }));
        m.visible = false;
        scene.add(m);
        this.tracers.push({ mesh: m, life: 0, max: 0.075 });
      }
      const flashTex = tex.glow;
      for (let i = 0; i < 3; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({
          map: flashTex, color: 0xffdca8, blending: T.AdditiveBlending,
          depthTest: false, depthWrite: false, transparent: true, opacity: 0, toneMapped: false
        }));
        s.scale.set(0.6, 0.6, 0.6);
        s.visible = false;
        s.renderOrder = 30;
        scene.add(s);
        this.flashes.push({ sprite: s, life: 0 });
      }
      const ringGeo = new T.RingGeometry(0.85, 1.0, 40);
      for (let i = 0; i < 4; i++) {
        const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({
          color: 0xffb070, transparent: true, opacity: 0, blending: T.AdditiveBlending,
          side: T.DoubleSide, depthWrite: false, toneMapped: false
        }));
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        scene.add(m);
        this.rings.push({ mesh: m, life: 0, max: 0.55 });
      }
      this.tmpC = new T.Color();
    }

    /* ---- events ---- */
    impact(pos, normal, kind) {
      const n = normal || new T.Vector3(0, 1, 0);
      const c = this.tmpC;
      if (kind === 'metal') c.setHex(0xffc27a); else if (kind === 'wet') c.setHex(0xa8d8ff); else c.setHex(0xffb060);
      const count = kind === 'wet' ? 6 : 12;
      for (let i = 0; i < count; i++) {
        const v = new T.Vector3(
          n.x + rnd(-0.85, 0.85), n.y + rnd(-0.2, 1.0), n.z + rnd(-0.85, 0.85)
        ).normalize().multiplyScalar(rnd(2, 9));
        this.sparks.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(0.16, 0.45), rnd(0.5, 1.3), c, -14, 1.2, 0);
      }
      // smoke puff
      const sc = new T.Color(0x5a5f66);
      for (let i = 0; i < 3; i++) {
        this.smoke.spawn(pos.x + n.x * 0.05, pos.y + n.y * 0.05, pos.z + n.z * 0.05,
          n.x * 0.4 + rnd(-0.3, 0.3), 0.4 + rnd(0, 0.4), n.z * 0.4 + rnd(-0.3, 0.3),
          rnd(0.6, 1.1), rnd(1.2, 2.2), sc, 0.3, 1.4, 1.3);
      }
      if (kind !== 'energy') this.decal(pos, n);
    }
    decal(pos, normal) {
      const m = this.decals[this.decalIdx++ % this.decals.length];
      m.visible = true;
      m.position.copy(pos).addScaledVector(normal, 0.012);
      const look = pos.clone().add(normal);
      m.lookAt(look);
      m.rotateZ(Math.random() * 6.2832);
      const s = rnd(0.7, 1.35);
      m.scale.set(s, s, s);
      m.material.opacity = 0.95;
    }
    tracer(from, to, color) {
      const t = this.tracers.find(x => x.life <= 0) || this.tracers[0];
      const dir = new T.Vector3().subVectors(to, from);
      const len = dir.length();
      if (len < 0.05) return;
      t.mesh.visible = true;
      t.mesh.position.copy(from).addScaledVector(dir, 0.5);
      t.mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      t.mesh.scale.set(1, len, 1);
      t.mesh.material.color.set(color || 0xffe0b0);
      t.mesh.material.opacity = 0.9;
      t.life = t.max;
    }
    muzzle(pos, scale) {
      const f = this.flashes.find(x => x.life <= 0) || this.flashes[0];
      f.sprite.position.copy(pos);
      f.sprite.visible = true;
      const s = scale || 1;
      f.sprite.scale.set(0.30 * s, 0.30 * s, 0.30 * s);
      f.sprite.material.rotation = Math.random() * 6.28;
      f.sprite.material.opacity = 1;
      f.life = 0.055;
    }
    explosion(pos, scale) {
      const s = scale || 1;
      for (let i = 0; i < 46; i++) {
        const v = new T.Vector3(rnd(-1, 1), rnd(-0.2, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(3, 16) * s);
        const c = new T.Color().setHSL(rnd(0.02, 0.11), 1, rnd(0.5, 0.72));
        this.sparks.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(0.3, 0.9), rnd(0.8, 2.2), c, -16, 0.7, 0);
      }
      for (let i = 0; i < 16; i++) {
        const c = new T.Color().setHSL(0.06, 0.25, rnd(0.08, 0.2));
        this.smoke.spawn(pos.x + rnd(-0.4, 0.4) * s, pos.y + rnd(-0.3, 0.5) * s, pos.z + rnd(-0.4, 0.4) * s,
          rnd(-1.2, 1.2), rnd(0.4, 2.2), rnd(-1.2, 1.2), rnd(1.0, 2.0), rnd(1.4, 2.6) * s, c, 0.6, 0.9, 1.8);
      }
      const r = this.rings.find(x => x.life <= 0) || this.rings[0];
      r.mesh.visible = true;
      r.mesh.position.copy(pos);
      r.mesh.scale.setScalar(0.4 * s);
      r.mesh.material.opacity = 0.9;
      r.life = r.max;
      // light burst via glow sprite
      const f = this.flashes.find(x => x.life <= 0) || this.flashes[0];
      f.sprite.position.copy(pos);
      f.sprite.visible = true;
      f.sprite.scale.set(4 * s, 4 * s, 1);
      f.sprite.material.opacity = 1;
      f.life = 0.16;
    }
    steamPuff(pos) {
      const c = new T.Color(0x3b4650);
      this.smoke.spawn(pos.x + rnd(-0.16, 0.16), pos.y, pos.z + rnd(-0.16, 0.16),
        rnd(-0.18, 0.18), rnd(0.45, 0.95), rnd(-0.18, 0.18),
        rnd(1.9, 2.9), rnd(0.8, 1.4), c, 0.18, 0.55, 0.85);
    }

    update(dt, time, camera) {
      this.rain.mat.uniforms.uTime.value = time;
      this.rain.mat.uniforms.uCam.value.copy(camera.position);
      this.rain.smat.uniforms.uTime.value = time;
      this.sparks.update(dt);
      this.smoke.update(dt);
      this.glow.update(dt);

      for (const t of this.tracers) {
        if (t.life > 0) {
          t.life -= dt;
          const k = clamp(t.life / t.max, 0, 1);
          t.mesh.material.opacity = k * 0.9;
          if (t.life <= 0) t.mesh.visible = false;
        }
      }
      for (const f of this.flashes) {
        if (f.life > 0) {
          f.life -= dt;
          const k = clamp(f.life / 0.055, 0, 1);
          f.sprite.material.opacity = k;
          if (f.life <= 0) { f.sprite.visible = false; f.sprite.material.opacity = 0; }
        }
      }
      for (const r of this.rings) {
        if (r.life > 0) {
          r.life -= dt;
          const t = 1 - clamp(r.life / r.max, 0, 1);
          r.mesh.scale.setScalar(0.4 + t * 9);
          r.mesh.material.opacity = (1 - t) * 0.55;
          if (r.life <= 0) r.mesh.visible = false;
        }
      }
      // ambient steam
      this.steamT -= dt;
      if (this.steamT <= 0 && G.fxPoints) {
        this.steamT = 0.19;
        const vents = G.fxPoints.filter(p => p.type === 'steam');
        if (vents.length) {
          this.steamIdx = ((this.steamIdx || 0) + 1) % vents.length;
          this.steamPuff(vents[this.steamIdx].pos);
        }
      }
    }
  }
  G.FXManager = FXManager;
})();
