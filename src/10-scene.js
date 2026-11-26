/* =========================================================
   NEON RAIN — level: sky / wet ground w/ planar reflection / facades / props
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;
  const { clamp, lerp, rnd, rndi, smoothstep } = G;

  const colliders = [];
  G.colliders = colliders;

  function addCollider(mesh, pad) {
    mesh.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(mesh);
    colliders.push({ x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, y1: box.max.y });
  }

  /* ---------------------------------------------------------------
     Planar reflection (for the wet street)
     --------------------------------------------------------------- */
  class Reflector {
    constructor(renderer) {
      this.renderer = renderer;
      this.rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, depthBuffer: true });
      this.rt.texture.generateMipmaps = true;
      this.rt.texture.minFilter = T.LinearMipmapLinearFilter;
      this.rt.texture.magFilter = T.LinearFilter;
      this.cam = new T.PerspectiveCamera();
      this.texMat = new T.Matrix4();
      this._v = new T.Vector3(); this._t = new T.Vector3(); this._up = new T.Vector3();
      this.hidden = [];
    }
    setSize(w, h) {
      this.rt.setSize(Math.max(2, Math.floor(w * 0.5)), Math.max(2, Math.floor(h * 0.5)));
    }
    update(scene, camera) {
      const cam = this.cam;
      cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far;
      cam.updateProjectionMatrix();
      const cp = new T.Vector3().setFromMatrixPosition(camera.matrixWorld);
      // mirror across y = 0
      cam.position.set(cp.x, -cp.y, cp.z);
      const target = new T.Vector3();
      const dir = camera.getWorldDirection(new T.Vector3());
      target.set(cp.x + dir.x, -(cp.y + dir.y), cp.z + dir.z);
      const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      cam.up.set(up.x, -up.y, up.z);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      // bias * proj * view
      this.texMat.set(
        0.5, 0, 0, 0.5,
        0, 0.5, 0, 0.5,
        0, 0, 0.5, 0.5,
        0, 0, 0, 1
      );
      this.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

      for (const o of this.hidden) o.visible = false;
      const prevRT = this.renderer.getRenderTarget();
      const prevShadow = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = false;
      this.renderer.setRenderTarget(this.rt);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      this.renderer.setRenderTarget(prevRT);
      this.renderer.shadowMap.enabled = prevShadow;
      for (const o of this.hidden) o.visible = true;
    }
  }
  G.Reflector = Reflector;

  /* ---------------------------------------------------------------
     Sky dome
     --------------------------------------------------------------- */
  function buildSky(scene) {
    const geo = new T.SphereGeometry(420, 48, 32);
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uMoon: { value: new T.Vector3(-0.45, 0.42, -0.78) } },
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vDir; uniform float uTime; uniform vec3 uMoon;
        float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
        }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          // base gradient: heavy clouds over a light-polluted city
          vec3 zenith = vec3(0.030,0.045,0.085);
          vec3 mid    = vec3(0.065,0.090,0.145);
          vec3 horizon= vec3(0.210,0.170,0.180);
          vec3 col = mix(horizon, mid, smoothstep(0.0,0.35,h));
          col = mix(col, zenith, smoothstep(0.3,0.95,h));
          // cloud layers
          vec2 uv = d.xz / max(0.12, h + 0.18);
          float c1 = fbm(uv*1.35 + vec2(uTime*0.004, uTime*0.002));
          float c2 = fbm(uv*2.7 - vec2(uTime*0.007, 0.0));
          float cl = smoothstep(0.36, 0.78, c1*0.65 + c2*0.45);
          vec3 cloudDark = vec3(0.045,0.058,0.080);
          vec3 cloudLit  = vec3(0.300,0.245,0.280);
          vec3 cloud = mix(cloudDark, cloudLit, smoothstep(0.0,0.5,c2));
          col = mix(col, cloud, cl * smoothstep(0.02,0.30,h) * 0.92);
          // city light pollution near horizon
          float glow = pow(clamp(1.0 - h*2.2, 0.0, 1.0), 2.6);
          col += vec3(0.42,0.19,0.11) * glow * 0.70;
          col += vec3(0.05,0.16,0.22) * pow(clamp(1.0-h*1.1,0.0,1.0), 5.0);
          // moon
          vec3 m = normalize(uMoon);
          float md = dot(d, m);
          float disc = smoothstep(0.99955, 0.99975, md);
          float halo = pow(max(md,0.0), 260.0)*0.5 + pow(max(md,0.0), 30.0)*0.08;
          col += vec3(0.85,0.92,1.0) * disc * 3.0;
          col += vec3(0.35,0.5,0.75) * halo * 1.4;
          // thin bright breaks in clouds
          col += vec3(0.05,0.07,0.10) * smoothstep(0.55,0.95,c2) * (1.0-cl) * 0.4;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const sky = new T.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    scene.add(sky);
    return mat;
  }

  /* ---------------------------------------------------------------
     Ground with wet reflection
     --------------------------------------------------------------- */
  function buildGround(scene, reflector) {
    const S = 90;
    const geo = new T.PlaneGeometry(S, S, 1, 1);
    const asph = G.asphalt();
    const mat = new T.MeshStandardMaterial({
      color: 0xb9b9bd,
      map: asph.map,
      normalMap: asph.normalMap,
      normalScale: new T.Vector2(1.0, 1.0),
      roughness: 0.86,
      metalness: 0.06,
      envMapIntensity: 0.35
    });
    asph.map.repeat.set(16, 16);
    asph.normalMap.repeat.set(16, 16);

    const puddleTex = G.puddleMask();
    mat.userData.u = {
      uReflect: { value: reflector.rt.texture },
      uTexMat: { value: reflector.texMat },
      uPuddle: { value: puddleTex },
      uTime: { value: 0 },
      uWet: { value: 1.0 },
      uReflAmt: { value: 1.0 }
    };

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, mat.userData.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform mat4 uTexMat;
          varying vec4 vReflCoord;
          varying vec3 vWPos;
          varying vec3 vWNormal;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 wp = modelMatrix * vec4( transformed, 1.0 );
          vWPos = wp.xyz;
          vWNormal = normalize( mat3(modelMatrix) * objectNormal );
          vReflCoord = uTexMat * wp;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uReflect;
          uniform sampler2D uPuddle;
          uniform float uTime;
          uniform float uWet;
          uniform float uReflAmt;
          varying vec4 vReflCoord;
          varying vec3 vWPos;
          varying vec3 vWNormal;
          float h21(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+34.7); return fract(p.x*p.y); }
          float ripple(vec2 p, float t){
            float acc = 0.0;
            for(int i=0;i<2;i++){
              vec2 g = p*(1.6+float(i)*0.9) + float(i)*13.0;
              vec2 id = floor(g), f = fract(g)-0.5;
              float h = h21(id);
              float ph = fract(t*(0.55+0.3*h) + h + float(i)*0.37);
              vec2 c = (vec2(h21(id+3.1),h21(id+7.7))-0.5)*0.55;
              float d = length(f-c);
              float ring = smoothstep(0.055,0.0,abs(d - ph*0.44)) * (1.0-ph) * step(0.35,h);
              acc += ring;
            }
            return acc;
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float gPuddle = smoothstep(0.575, 0.725, texture2D(uPuddle, vWPos.xz*0.019).r);
          float gWet = clamp(gPuddle*uWet, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 0.42, gWet);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.045, gWet);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float rip = ripple(vWPos.xz, uTime);
            normal = normalize(normal + vec3(rip*0.12, rip*0.10, 0.0));
            normal = normalize(mix(normal, normalize(vNormal), gWet*0.55));
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float t = uTime;
            float rip = ripple(vWPos.xz, t);
            vec2 ruv = vReflCoord.xy / max(vReflCoord.w, 0.0001);
            vec3 V = normalize(cameraPosition - vWPos);
            vec3 N = normalize(vWNormal);
            float fres = pow(1.0 - clamp(dot(V,N),0.0,1.0), 4.0);
            vec2 warp = vec2(0.0);
            warp += vec2(sin(vWPos.z*7.0 + t*1.3), cos(vWPos.x*6.2 - t*1.1)) * 0.0016;
            warp += vec2(rip) * 0.012 * gWet;
            ruv = clamp(ruv + warp, vec2(0.002), vec2(0.998));
            vec3 refl = texture2D(uReflect, ruv, 2.2).rgb;
            float k = (0.004 + fres*0.028 + gWet*0.62) * uWet * uReflAmt;
            k = clamp(k, 0.0, 0.80);
            vec3 tint = mix(vec3(0.85,0.92,1.0), vec3(1.0), gWet);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, refl*tint, k);
            gl_FragColor.rgb += vec3(0.012,0.018,0.026) * gWet * (0.4 + fres);
          }`);
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () => 'wetFloor';

    const mesh = new T.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    reflector.hidden.push(mesh);
    return { mesh, mat };
  }

  /* ---------------------------------------------------------------
     Materials
     --------------------------------------------------------------- */
  function materials() {
    const concrete = G.concrete();
    const rust = G.rust();
    const wood = G.wood();
    const M = {};
    M.concrete = new T.MeshStandardMaterial({
      color: 0x9a9a99, map: concrete.map, normalMap: concrete.normalMap,
      roughness: 0.92, metalness: 0.02, envMapIntensity: 0.4
    });
    M.concreteDark = new T.MeshStandardMaterial({
      color: 0x4c4d50, map: concrete.map, normalMap: concrete.normalMap,
      roughness: 0.95, metalness: 0.02, envMapIntensity: 0.25
    });
    M.rust = new T.MeshStandardMaterial({
      color: 0xa8a8a8, map: rust.map, normalMap: rust.normalMap,
      roughness: 0.74, metalness: 0.62, envMapIntensity: 0.9
    });
    M.wood = new T.MeshStandardMaterial({
      color: 0xb8a58c, map: wood.map, normalMap: wood.normalMap,
      roughness: 0.86, metalness: 0.02, envMapIntensity: 0.3
    });
    M.metal = new T.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.42, metalness: 0.92, envMapIntensity: 1.1 });
    M.metalLight = new T.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.35, metalness: 0.95, envMapIntensity: 1.3 });
    M.dark = new T.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.9, metalness: 0.2 });
    M.rubber = new T.MeshStandardMaterial({ color: 0x111214, roughness: 0.95, metalness: 0.0 });
    M.plastic = new T.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.1 });
    M.glassDark = new T.MeshStandardMaterial({ color: 0x05080c, roughness: 0.12, metalness: 0.4, envMapIntensity: 1.4 });
    return M;
  }

  /* ---------------------------------------------------------------
     Buildings / facades
     --------------------------------------------------------------- */
  function facadeMaterial(opts) {
    const f = G.makeFacade(opts.seed, opts);
    const map = f.map, em = f.emissiveMap;
    map.repeat.set(opts.rx || 1, opts.ry || 1);
    em.repeat.set(opts.rx || 1, opts.ry || 1);
    const mat = new T.MeshStandardMaterial({
      map, emissiveMap: em, emissive: 0xffffff,
      emissiveIntensity: opts.ei || 0.8,
      roughness: 0.84, metalness: 0.05, envMapIntensity: 0.6,
      color: new T.Color().setHSL(0.07 + ((opts.seed || 1) % 5) * 0.014, 0.07, 0.95)
    });
    const grunge = G.puddleMask();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGrunge = { value: grunge };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosF;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGrunge;\nvarying vec3 vWPosF;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float gr1 = texture2D(uGrunge, vWPosF.xy*0.030 + vWPosF.zx*0.014).r;
          float gr2 = texture2D(uGrunge, vWPosF.zy*0.085 + 0.37).r;
          float gr = gr1*0.65 + gr2*0.35;
          diffuseColor.rgb *= mix(0.45, 1.18, gr);
          diffuseColor.rgb *= mix(0.35, 1.0, smoothstep(0.0, 4.5, vWPosF.y));
        `);
    };
    mat.customProgramCacheKey = () => 'facadeGrime';
    return mat;
  }

  function buildBuildings(scene, M) {
    const walls = [
      { w: 40, h: 30, x: 0, z: -18.6, ry: 0, seed: 11, rx: 1, ry2: 1, cols: 13, rows: 10, size: 1536 },
      { w: 40, h: 24, x: 0, z: 18.6, ry: Math.PI, seed: 23, rx: 1, ry2: 1, cols: 13, rows: 8, size: 1536 },
      { w: 40, h: 28, x: 18.6, z: 0, ry: -Math.PI / 2, seed: 37, rx: 1, ry2: 1, cols: 13, rows: 9, size: 1536 },
      { w: 40, h: 34, x: -18.6, z: 0, ry: Math.PI / 2, seed: 51, rx: 1, ry2: 1, cols: 13, rows: 11, size: 1536 }
    ];
    walls.forEach((w, i) => {
      const mat = facadeMaterial({ seed: w.seed, rx: w.rx, ry: w.ry2, cols: w.cols, rows: w.rows, size: w.size, litRatio: 0.17 + (i % 2) * 0.05 });
      const m = new T.Mesh(new T.PlaneGeometry(w.w, w.h), mat);
      m.position.set(w.x, w.h / 2, w.z);
      m.rotation.y = w.ry;
      m.receiveShadow = true;
      m.name = 'facade' + i;
      scene.add(m);
      // solid backing so light never leaks
      const back = new T.Mesh(new T.BoxGeometry(w.w + 2, w.h + 2, 1.2), M.dark);
      back.position.set(w.x, w.h / 2, w.z);
      back.rotation.y = w.ry;
      back.position.x += Math.sin(w.ry) * -0.8;
      back.position.z += Math.cos(w.ry) * -0.8;
      back.name = 'back' + i;
      scene.add(back);
    });

    // horizontal ledges + pilasters give the facades real depth
    walls.forEach((w) => {
      const nx = Math.sin(w.ry), nz = Math.cos(w.ry);
      const rx = Math.cos(w.ry), rz = -Math.sin(w.ry);
      [0.26, 0.47, 0.68, 0.86].forEach((f) => {
        const y = w.h * f;
        const l = new T.Mesh(new T.BoxGeometry(w.w, 0.16, 0.34), M.concreteDark);
        l.position.set(w.x + nx * 0.18, y, w.z + nz * 0.18);
        l.rotation.y = w.ry;
        l.castShadow = true; l.receiveShadow = true;
        scene.add(l);
      });
      for (let i = 0; i < 5; i++) {
        const off = (i / 4 - 0.5) * (w.w - 4);
        const pil = new T.Mesh(new T.BoxGeometry(0.34, w.h, 0.42), M.concrete);
        pil.position.set(w.x + nx * 0.2 + rx * off, w.h / 2, w.z + nz * 0.2 + rz * off);
        pil.rotation.y = w.ry;
        pil.castShadow = true; pil.receiveShadow = true;
        scene.add(pil);
      }
    });

    // balconies / window boxes give the facades parallax
    const balcMat = M.concreteDark;
    const railMat = M.metal;
    const spots = [
      [-13, 6.8, -18.0, 0], [-2, 9.4, -18.0, 0], [12.5, 7.6, -18.0, 0], [5, 12.4, -18.0, 0],
      [18.0, 8.2, 4.0, 1], [18.0, 11.8, -9.0, 1], [18.0, 5.4, 9.5, 1],
      [-18.0, 6.2, 7.0, 2], [-18.0, 10.6, -8.0, 2],
      [-6, 6.0, 18.0, 3], [7.5, 9.2, 18.0, 3]
    ];
    spots.forEach(([x, y, z, side]) => {
      const g = new T.Group();
      const slab = new T.Mesh(new T.BoxGeometry(2.4, 0.12, 0.85), balcMat);
      slab.castShadow = true; slab.receiveShadow = true;
      g.add(slab);
      for (let k = 0; k < 3; k++) {
        const r = new T.Mesh(new T.BoxGeometry(2.3, 0.04, 0.04), railMat);
        r.position.set(0, 0.42 + k * 0.22, 0.36);
        g.add(r);
      }
      for (let k = -2; k <= 2; k++) {
        const p = new T.Mesh(new T.BoxGeometry(0.05, 0.86, 0.05), railMat);
        p.position.set(k * 0.55, 0.42, 0.36);
        g.add(p);
      }
      // laundry line detail
      const cloth = new T.Mesh(new T.BoxGeometry(0.55, 0.7, 0.02), side % 2 ? M.wood : M.concrete);
      cloth.position.set(0.55, 0.2, 0.3);
      g.add(cloth);
      g.position.set(x, y, z);
      g.rotation.y = side === 0 ? 0 : side === 1 ? -Math.PI / 2 : side === 2 ? Math.PI / 2 : Math.PI;
      scene.add(g);
    });

    // lit ground-floor doorways
    const doorGlow = new T.MeshBasicMaterial({ color: 0xffb877, toneMapped: false });
    [[-15.6, -18.2, 0], [16.2, 6.2, 1], [-16.8, 12.4, 2]].forEach(([x, z, side]) => {
      const frame = new T.Mesh(new T.BoxGeometry(1.7, 2.6, 0.4), M.concreteDark);
      frame.position.set(x, 1.3, z);
      frame.rotation.y = side === 0 ? 0 : side === 1 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(frame);
      const lit = new T.Mesh(new T.PlaneGeometry(1.3, 2.1), doorGlow);
      lit.position.set(x, 1.15, z);
      lit.rotation.y = frame.rotation.y;
      lit.position.x += Math.sin(frame.rotation.y) * 0.22;
      lit.position.z += Math.cos(frame.rotation.y) * 0.22;
      scene.add(lit);
    });

    // corner towers closing the gaps
    const towerPos = [[-19.5, -19.5], [19.5, -19.5], [-19.5, 19.5], [19.5, 19.5]];
    towerPos.forEach(([x, z], i) => {
      const hh = 30 + (i % 3) * 6;
      const mat = facadeMaterial({ seed: 90 + i, rx: 1, ry: hh / 22, cols: 6, rows: 8, size: 512, litRatio: 0.14 });
      const b = new T.Mesh(new T.BoxGeometry(9, hh, 9), mat);
      b.position.set(x, hh / 2, z);
      b.castShadow = false; b.receiveShadow = true;
      scene.add(b);
    });

    // parapets + rooftop clutter silhouettes
    const addRoof = (x, y, z, w, d, ry) => {
      const p = new T.Mesh(new T.BoxGeometry(w, 0.7, d), M.concreteDark);
      p.position.set(x, y, z); p.rotation.y = ry || 0;
      p.castShadow = true; scene.add(p);
    };
    addRoof(0, 30.4, -18.6, 40, 1.2, 0);
    addRoof(0, 24.4, 18.6, 40, 1.2, 0);
    addRoof(18.6, 28.4, 0, 40, 1.2, Math.PI / 2);
    addRoof(-18.6, 34.4, 0, 40, 1.2, Math.PI / 2);

    // water tanks / antennas (silhouettes against the sky)
    const roofProps = [
      [-13, 30.8, -20.5, 0], [9, 30.8, -21.0, 1], [16.5, 29, -19.5, 0],
      [-22, 35.2, 2, 1], [-21.5, 31.2, -11, 0], [21, 28.8, 9, 1],
      [4, 24.8, 20.0, 0], [-8, 24.8, 20.4, 1]
    ];
    roofProps.forEach(([x, y, z, kind], i) => {
      if (kind === 0) {
        const tank = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, 2.2, 14), M.rust);
        tank.position.set(x, y + 1.1, z); tank.castShadow = true; scene.add(tank);
        const cap = new T.Mesh(new T.ConeGeometry(1.25, 0.55, 14), M.rust);
        cap.position.set(x, y + 2.45, z); scene.add(cap);
        for (let k = 0; k < 4; k++) {
          const leg = new T.Mesh(new T.BoxGeometry(0.12, 1.0, 0.12), M.metal);
          leg.position.set(x + Math.cos(k * 1.57) * 0.9, y + 0.1, z + Math.sin(k * 1.57) * 0.9);
          scene.add(leg);
        }
      } else {
        const mast = new T.Mesh(new T.CylinderGeometry(0.05, 0.09, 7, 6), M.metal);
        mast.position.set(x, y + 3.5, z); scene.add(mast);
        const bl = new T.Mesh(new T.SphereGeometry(0.14, 8, 6), new T.MeshBasicMaterial({ color: 0xff2222, toneMapped: false }));
        bl.position.set(x, y + 7.05, z); scene.add(bl);
        G.blinkers = G.blinkers || []; G.blinkers.push(bl);
      }
    });
  }

  /* ---------------------------------------------------------------
     Distant skyline
     --------------------------------------------------------------- */
  function buildSkyline(scene, M) {
    G.seed(4242);
    const facadeMat = facadeMaterial({ seed: 5, rx: 1, ry: 3.0, cols: 7, rows: 10, size: 512, litRatio: 0.16, ei: 0.75 });
    const facadeMat2 = facadeMaterial({ seed: 77, rx: 1, ry: 4.0, cols: 5, rows: 9, size: 512, litRatio: 0.18, ei: 0.7 });
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + G.rnd(-0.06, 0.06);
      const r = G.rnd(58, 118);
      const w = G.rnd(10, 26), h = G.rnd(22, 74), d = G.rnd(10, 24);
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), i % 2 ? facadeMat : facadeMat2);
      m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      m.rotation.y = -a + Math.PI / 2;
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m);
      if (i % 4 === 0) {
        const bl = new T.Mesh(new T.SphereGeometry(0.5, 6, 5), new T.MeshBasicMaterial({ color: 0xff3311, toneMapped: false }));
        bl.position.set(m.position.x, h + 0.4, m.position.z);
        G.blinkers.push(bl);
      }
    }
  }

  /* ---------------------------------------------------------------
     Props
     --------------------------------------------------------------- */
  function buildProps(scene, M) {
    const props = new T.Group(); scene.add(props);
    const add = (m, collide) => { props.add(m); if (collide) addCollider(m); return m; };

    /* --- shipping container --- */
    const cont = new T.Group();
    const bodyMat = M.rust;
    const body = new T.Mesh(new T.BoxGeometry(6.2, 2.6, 2.45), bodyMat);
    body.castShadow = true; body.receiveShadow = true;
    cont.add(body);
    // corrugation ribs
    const ribGeo = new T.BoxGeometry(0.07, 2.34, 0.045);
    const ribs = new T.InstancedMesh(ribGeo, M.rust, 52);
    const mtx = new T.Matrix4();
    let ri = 0;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 26; i++) {
        const x = -3.0 + i * 0.24;
        mtx.makeTranslation(x, 0, (side ? 1.25 : -1.25));
        ribs.setMatrixAt(ri++, mtx);
      }
    }
    ribs.instanceMatrix.needsUpdate = true;
    cont.add(ribs);
    // door hardware
    const bar = new T.Mesh(new T.BoxGeometry(0.08, 1.9, 0.08), M.metalLight);
    bar.position.set(-3.12, 0, 0.55); cont.add(bar);
    const bar2 = bar.clone(); bar2.position.z = -0.55; cont.add(bar2);
    const handle = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.7), M.metalLight);
    handle.position.set(-3.16, 0.2, 0.0); cont.add(handle);
    // top edge trim
    const trim = new T.Mesh(new T.BoxGeometry(6.26, 0.1, 2.5), M.rust);
    trim.position.y = 1.3; cont.add(trim);

    cont.position.set(-7.2, 1.32, -3.6);
    cont.rotation.y = 0.34;
    cont.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    add(cont, true);

    /* --- crates --- */
    const crateGeo = new T.BoxGeometry(1, 1, 1);
    const crateSpots = [
      [7.4, 0.55, 5.2, 0.9, 0.5], [8.4, 0.4, 6.1, 1.05, 1.2], [7.8, 1.4, 5.6, 0.85, 0.2],
      [-11.5, 0.5, 6.5, 1.0, 0.7], [-10.4, 0.45, 7.4, 0.9, -0.4], [-12.2, 1.4, 6.9, 0.95, 1.5],
      [12.4, 0.6, -8.2, 1.2, 0.1], [11.3, 0.5, -9.4, 1.0, 0.8], [4.2, 0.5, -9.6, 1.0, 0.35]
    ];
    crateSpots.forEach(([x, y, z, s, ry]) => {
      const c = new T.Mesh(crateGeo, M.wood);
      c.scale.set(s, s, s); c.position.set(x, y, z); c.rotation.y = ry;
      c.castShadow = true; c.receiveShadow = true;
      add(c, y < 0.8);
    });

    /* --- oil drums --- */
    const drumGeo = new T.CylinderGeometry(0.32, 0.32, 0.92, 18);
    [[13.6, -3.2], [14.2, -4.1], [12.9, -4.6], [-13.8, -6.2], [-13.0, -7.0]].forEach(([x, z], i) => {
      const d = new T.Mesh(drumGeo, M.rust);
      d.position.set(x, 0.46, z);
      d.rotation.y = i * 1.1;
      d.castShadow = true; d.receiveShadow = true;
      add(d, true);
      const ring = new T.Mesh(new T.TorusGeometry(0.325, 0.018, 6, 22), M.metal);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; d.add(ring);
      const ring2 = ring.clone(); ring2.position.y = -0.3; d.add(ring2);
    });

    /* --- concrete barriers --- */
    const barrierGeo = new T.BoxGeometry(2.4, 0.95, 0.5);
    [[2.0, 12.0, 0.1], [-4.5, 13.4, -0.25], [13.0, 1.0, 1.2]].forEach(([x, z, ry]) => {
      const b = new T.Mesh(barrierGeo, M.concrete);
      b.position.set(x, 0.48, z); b.rotation.y = ry;
      b.castShadow = true; b.receiveShadow = true;
      b.material = M.concrete;
      add(b, true);
      // hazard stripe (emissive-ish tape)
      const tape = new T.Mesh(new T.PlaneGeometry(2.2, 0.16), new T.MeshStandardMaterial({ color: 0x6b5a20, roughness: 0.7 }));
      tape.position.set(0, 0.32, 0.256); b.add(tape);
    });

    /* --- cardboard / trash bags --- */
    for (let i = 0; i < 22; i++) {
      const kind = i % 3;
      if (kind === 0) {
        const b = new T.Mesh(new T.BoxGeometry(G.rnd(0.4, 0.8), G.rnd(0.3, 0.6), G.rnd(0.4, 0.8)), M.wood);
        b.position.set(G.rnd(-14, 14), 0.25, G.rnd(-14, 14));
        b.rotation.y = G.rnd(0, 6.28);
        b.castShadow = true; b.receiveShadow = true;
        props.add(b);
      } else if (kind === 1) {
        const s = new T.Mesh(new T.SphereGeometry(G.rnd(0.3, 0.45), 8, 6), M.rubber);
        s.position.set(G.rnd(-14, 14), 0.28, G.rnd(-14, 14));
        s.scale.set(1, 0.8, 1);
        s.castShadow = true; props.add(s);
      } else {
        const p = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.5), M.concreteDark);
        p.position.set(G.rnd(-15, 15), 0.04, G.rnd(-15, 15));
        p.rotation.y = G.rnd(0, 6.28); p.receiveShadow = true;
        props.add(p);
      }
    }

    /* --- wall pipes --- */
    const pipeMat = M.rust;
    function pipeRun(x0, y0, z0, x1, y1, z1, r) {
      const a = new T.Vector3(x0, y0, z0), b = new T.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const cyl = new T.Mesh(new T.CylinderGeometry(r, r, len, 8), pipeMat);
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      cyl.castShadow = true;
      scene.add(cyl);
      return cyl;
    }
    pipeRun(16.9, 10.5, -14, 16.9, 10.5, 14, 0.09);
    pipeRun(16.9, 10.2, -14, 16.9, 10.2, 14, 0.06);
    pipeRun(16.9, 10.5, -14, 16.9, 3.0, -14, 0.09);
    pipeRun(-16.9, 7.0, -6, -16.9, 7.0, 9, 0.11);
    pipeRun(-16.9, 7.0, 9, -16.9, 2.2, 9, 0.11);
    // vertical drainpipes
    [[-17.2, -12], [17.2, 8], [6.0, -17.4], [-3.0, 17.4]].forEach(([x, z]) => {
      pipeRun(x, 0.2, z, x, 22, z, 0.08);
    });

    /* --- wall AC units --- */
    const acBody = new T.BoxGeometry(0.9, 0.65, 0.42);
    const acSpots = [
      [-17.6, 4.2, -8, 0], [-17.6, 6.8, 2, 0], [17.4, 5.2, -6, Math.PI],
      [17.4, 8.4, 6.5, Math.PI], [-6.2, 5.4, 17.4, -Math.PI / 2], [8.5, 7.2, 17.4, -Math.PI / 2]
    ];
    acSpots.forEach(([x, y, z, ry]) => {
      const g = new T.Group();
      const b = new T.Mesh(acBody, M.metalLight); b.castShadow = true; g.add(b);
      const grille = new T.Mesh(new T.CircleGeometry(0.2, 14), M.dark);
      grille.position.set(0, 0, 0.22); g.add(grille);
      for (let k = 0; k < 3; k++) {
        const slat = new T.Mesh(new T.BoxGeometry(0.78, 0.02, 0.03), M.metal);
        slat.position.set(0, -0.18 + k * 0.1, 0.23); g.add(slat);
      }
      const br = new T.Mesh(new T.BoxGeometry(0.94, 0.06, 0.46), M.metal);
      br.position.y = -0.36; g.add(br);
      g.position.set(x, y, z); g.rotation.y = ry;
      scene.add(g);
    });

    /* --- overhead cables with lamps --- */
    function cable(p0, p1, sag, mat) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = new T.Vector3().lerpVectors(p0, p1, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        pts.push(p);
      }
      const curve = new T.CatmullRomCurve3(pts);
      const g = new T.TubeGeometry(curve, 24, 0.022, 5, false);
      const m = new T.Mesh(g, mat || M.dark);
      scene.add(m);
      return curve;
    }
    const cableMat = new T.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.9 });
    const c1 = cable(new T.Vector3(-18, 12.5, -9), new T.Vector3(18, 11.0, -6.5), 2.6, cableMat);
    const c2 = cable(new T.Vector3(-18, 10.2, 3), new T.Vector3(18, 12.2, 5.5), 2.2, cableMat);
    const c3 = cable(new T.Vector3(-18, 13.2, -15), new T.Vector3(18, 9.6, 10), 5.0, cableMat);
    // hanging bulbs
    const bulbMat = new T.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    bulbMat.color.setRGB(3.2, 2.4, 1.5);
    const bulbGeo = new T.SphereGeometry(0.075, 8, 6);
    [0.22, 0.5, 0.78].forEach((t, i) => {
      const p = c1.getPoint(t);
      const drop = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.9, 4), cableMat);
      drop.position.set(p.x, p.y - 0.45, p.z); scene.add(drop);
      const bulb = new T.Mesh(bulbGeo, bulbMat);
      bulb.position.set(p.x, p.y - 0.92, p.z); scene.add(bulb);
      if (i === 1) {
        const pl = new T.PointLight(0xffcf8f, 12, 9, 2);
        pl.position.copy(bulb.position); scene.add(pl);
      }
    });
    [0.3, 0.62].forEach((t) => {
      const p = c2.getPoint(t);
      const bulb = new T.Mesh(bulbGeo, new T.MeshBasicMaterial({ color: 0x9fe6ff, toneMapped: false }));
      bulb.position.set(p.x, p.y - 0.5, p.z); scene.add(bulb);
    });

    /* --- fire escape (west wall) --- */
    const fe = new T.Group();
    for (let f = 0; f < 4; f++) {
      const y = 4.5 + f * 3.6;
      const plat = new T.Mesh(new T.BoxGeometry(0.9, 0.1, 3.4), M.metal);
      plat.position.set(-17.9, y, 3.0); fe.add(plat);
      for (let k = 0; k < 2; k++) {
        const railH = new T.Mesh(new T.BoxGeometry(0.06, 0.9, 0.06), M.metal);
        railH.position.set(-17.55, y + 0.5, 1.4 + k * 3.2); fe.add(railH);
      }
      const rail = new T.Mesh(new T.BoxGeometry(0.06, 0.06, 3.4), M.metal);
      rail.position.set(-17.55, y + 0.95, 3.0); fe.add(rail);
      if (f < 3) {
        const lad = new T.Mesh(new T.BoxGeometry(0.08, 3.6, 0.42), M.metal);
        lad.position.set(-17.75, y + 1.8, 4.4); fe.add(lad);
      }
    }
    fe.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(fe);

    /* --- shop front on the south wall --- */
    const shop = new T.Group();
    const alcove = new T.Mesh(new T.BoxGeometry(5.4, 3.4, 1.4), M.concreteDark);
    alcove.position.set(0, 1.7, 0); shop.add(alcove);
    const innerGlow = new T.Mesh(new T.PlaneGeometry(4.6, 2.8),
      new T.MeshBasicMaterial({ color: 0xffb066, toneMapped: false, transparent: true, opacity: 0.9 }));
    innerGlow.position.set(0, 1.75, -0.72); shop.add(innerGlow);
    const shutter = new T.Mesh(new T.PlaneGeometry(4.8, 2.6),
      new T.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.8, metalness: 0.5 }));
    shutter.position.set(0, 1.6, -0.68); shop.add(shutter);
    for (let i = 0; i < 9; i++) {
      const s = new T.Mesh(new T.BoxGeometry(4.8, 0.03, 0.05), M.dark);
      s.position.set(0, 0.5 + i * 0.27, -0.66); shop.add(s);
    }
    shop.position.set(9.4, 0, 17.4);
    shop.rotation.y = Math.PI;
    scene.add(shop);
    addCollider(alcove);

    /* --- manhole + steam source --- */
    const manhole = new T.Mesh(new T.CircleGeometry(0.42, 20), new T.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.8 }));
    manhole.rotation.x = -Math.PI / 2; manhole.position.set(1.8, 0.012, 2.2);
    scene.add(manhole);
    for (let i = 0; i < 3; i++) {
      const ring = new T.Mesh(new T.TorusGeometry(0.42, 0.015, 4, 24), M.metal);
      ring.rotation.x = Math.PI / 2; ring.position.set(1.8, 0.02, 2.2); scene.add(ring); break;
    }
    /* --- sodium street lamps --- */
    G.lampGlows = [];
    const lampSpots = [[6.2, 8.4, 0], [-9.5, -9.5, 0]];
    lampSpots.forEach(([lx, lz]) => {
      const pole = new T.Mesh(new T.CylinderGeometry(0.075, 0.11, 5.6, 10), M.metal);
      pole.position.set(lx, 2.8, lz); pole.castShadow = true; scene.add(pole);
      const arm = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 8), M.metal);
      arm.position.set(lx + 0.6, 5.5, lz);
      arm.rotation.z = Math.PI / 2;
      arm.scale.y = 1;
      scene.add(arm);
      const head = new T.Mesh(new T.BoxGeometry(0.85, 0.16, 0.42), M.metal);
      head.position.set(lx + 1.2, 5.44, lz); scene.add(head);
      const lens = new T.Mesh(new T.PlaneGeometry(0.72, 0.32), new T.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false }));
      lens.material.color.setRGB(3.2, 2.0, 1.0);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(lx + 1.2, 5.35, lz); scene.add(lens);
      const gl = new T.Sprite(new T.SpriteMaterial({
        map: G.tex.glow, color: 0xffb066, blending: T.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.55, toneMapped: false
      }));
      gl.scale.set(1.9, 1.9, 1);
      gl.position.set(lx + 1.2, 5.3, lz);
      scene.add(gl);
      G.lampGlows.push(gl);
      const pl = new T.PointLight(0xffb066, 55, 20, 2);
      pl.position.set(lx + 1.2, 5.1, lz);
      scene.add(pl);
      if (lx > 0) {
        const sp2 = new T.SpotLight(0xffc48a, 120, 26, 0.86, 0.72, 1.7);
        sp2.position.set(lx + 1.2, 5.2, lz);
        sp2.target.position.set(lx + 1.2, 0, lz);
        sp2.castShadow = true;
        sp2.shadow.mapSize.set(1024, 1024);
        sp2.shadow.camera.near = 0.5;
        sp2.shadow.camera.far = 26;
        sp2.shadow.bias = -0.0012;
        sp2.shadow.normalBias = 0.03;
        scene.add(sp2); scene.add(sp2.target);
      }
    });

    /* --- low ground mist --- */
    G.mists = [];
    for (let i = 0; i < 11; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({
        map: G.tex.smoke, color: 0x2e445c, blending: T.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.055, toneMapped: false
      }));
      const a = (i / 11) * 6.2832;
      sp.position.set(Math.cos(a) * (6 + Math.random() * 10), 0.7 + Math.random() * 0.9, Math.sin(a) * (6 + Math.random() * 10));
      sp.scale.set(14 + Math.random() * 8, 5 + Math.random() * 2.5, 1);
      scene.add(sp);
      G.mists.push({ sp, base: sp.position.clone(), ph: Math.random() * 6.28 });
    }

    G.fxPoints = G.fxPoints || [];
    G.fxPoints.push({ type: 'steam', pos: new T.Vector3(1.8, 0.05, 2.2) });
    G.fxPoints.push({ type: 'steam', pos: new T.Vector3(13.4, 0.05, 4.2) });
    G.fxPoints.push({ type: 'steam', pos: new T.Vector3(-9.2, 0.05, 12.4) });

    /* --- scattered debris / shell casings ground detail --- */
    const debrisGeo = new T.BoxGeometry(0.05, 0.02, 0.14);
    const debris = new T.InstancedMesh(debrisGeo, M.metalLight, 90);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
    for (let i = 0; i < 90; i++) {
      e.set(0, G.rnd(0, 6.28), 0);
      q.setFromEuler(e);
      m4.compose(new T.Vector3(G.rnd(-15, 15), 0.02, G.rnd(-15, 15)), q, new T.Vector3(1, 1, 1));
      debris.setMatrixAt(i, m4);
    }
    debris.instanceMatrix.needsUpdate = true;
    debris.receiveShadow = true;
    scene.add(debris);
  }

  /* ---------------------------------------------------------------
     Signs / neon / light shafts
     --------------------------------------------------------------- */
  function buildSigns(scene) {
    const signs = new T.Group();
    scene.add(signs);

    function signPlane(tex, w, h, x, y, z, ry, color) {
      const mat = new T.MeshBasicMaterial({
        map: tex, transparent: true, blending: T.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: T.DoubleSide
      });
      mat.color.setScalar(2.1);
      const m = new T.Mesh(new T.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.renderOrder = 5;
      signs.add(m);
      return m;
    }

    // big vertical neon on north wall
    const s1 = G.makeNeonSign(['霓', '虹', '旅', '館'], { color: '#ff3d8b', glow: '#ff3d8b', size: 190, vertical: true, w: 320, h: 900 });
    const p1 = signPlane(s1, 2.6, 7.3, -6.0, 12.4, -18.3, 0);
    // frame
    const frame = new T.Mesh(new T.BoxGeometry(3.0, 7.7, 0.35), new T.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0.5 }));
    frame.position.set(-6.0, 12.4, -18.45); signs.add(frame);
    p1.position.z = -18.26;

    // horizontal cyan sign on east wall
    const s2 = G.makeNeonSign(['24H 便利店'], { color: '#35e6ff', glow: '#35e6ff', size: 108, w: 768, h: 256 });
    signPlane(s2, 5.2, 1.75, 18.28, 6.6, -3.0, -Math.PI / 2);

    // orange sign west
    const s3 = G.makeNeonSign(['酒 吧'], { color: '#ff8b2e', glow: '#ff8b2e', size: 128, w: 512, h: 256, border: false });
    signPlane(s3, 3.2, 1.6, -18.28, 5.4, -1.0, Math.PI / 2);

    // shop sign south
    const s4 = G.makeNeonSign(['拉 面'], { color: '#ffcf6b', glow: '#ffaa3c', size: 120, w: 512, h: 256, border: false });
    signPlane(s4, 2.8, 1.4, 9.4, 3.55, 16.55, Math.PI);

    // billboard on north wall
    const bTex = G.makeBillboard();
    const bmat = new T.MeshBasicMaterial({ map: bTex, toneMapped: false });
    bmat.color.setScalar(1.25);
    const bill = new T.Mesh(new T.PlaneGeometry(4.6, 6.9), bmat);
    bill.position.set(7.2, 11.0, -18.3);
    signs.add(bill);
    const bframe = new T.Mesh(new T.BoxGeometry(5.0, 7.3, 0.3), new T.MeshStandardMaterial({ color: 0x101114, roughness: 0.6, metalness: 0.6 }));
    bframe.position.set(7.2, 11.0, -18.45); signs.add(bframe);
    // billboard glow wash
    const bGlow = new T.Mesh(new T.PlaneGeometry(5.4, 7.7), new T.MeshBasicMaterial({
      map: G.tex.glow, color: 0x2a86ff, transparent: true, blending: T.AdditiveBlending, opacity: 0.16, depthWrite: false, toneMapped: false
    }));
    bGlow.position.set(7.2, 11.0, -18.2); signs.add(bGlow);

    // small tube accents around the shop
    const tubeMat = new T.MeshBasicMaterial({ color: 0x63f0ff, toneMapped: false });
    tubeMat.color.setRGB(0.55, 2.4, 2.8);
    const tubeMat2 = new T.MeshBasicMaterial({ color: 0xff3d8b, toneMapped: false });
    tubeMat2.color.setRGB(2.6, 0.35, 1.1);
    function tube(x, y, z, len, ry, mat, vertical) {
      const g = new T.CylinderGeometry(0.035, 0.035, len, 6);
      const m = new T.Mesh(g, mat);
      m.position.set(x, y, z);
      if (vertical) m.rotation.z = 0; else m.rotation.z = Math.PI / 2;
      m.rotation.y = ry || 0;
      signs.add(m);
      return m;
    }
    tube(9.4, 4.2, 16.35, 5.2, 0, tubeMat2, false);
    tube(0, 1.9, -18.1, 0, 0, tubeMat, false);

    /* light shafts */
    G.shaftMaterials = [];
    function shaft(x, y, z, topR, botR, len, color, opacity, tilt) {
      const geo = new T.CylinderGeometry(topR, botR, len, 20, 1, true);
      const mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uColor: { value: new T.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
        vertexShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          void main(){ vUv=uv; vN = normalize(normalMatrix*normal);
            vec4 mv = modelViewMatrix*vec4(position,1.0); vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix*mv; }
        `,
        fragmentShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
          void main(){
            float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.6);
            float fade = smoothstep(0.0,0.28,vUv.y) * smoothstep(1.0,0.55,vUv.y);
            float flick = 0.86 + 0.14*sin(uTime*3.1 + vUv.x*8.0);
            gl_FragColor = vec4(uColor, edge*fade*uOpacity*flick);
          }
        `
      });
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = tilt || 0;
      m.renderOrder = 3;
      scene.add(m);
      G.shaftMaterials.push(mat);
      return m;
    }
    shaft(-6.0, 9.0, -17.4, 1.6, 3.6, 11.0, 0xff3d8b, 0.22, 0.06);
    shaft(7.2, 8.6, -17.2, 2.0, 4.2, 10.5, 0x2a86ff, 0.16, -0.04);
    shaft(18.0, 5.2, -3.0, 0.9, 2.4, 7.5, 0x35e6ff, 0.20, 0.0);
    shaft(9.4, 2.0, 16.2, 1.6, 2.8, 5.4, 0xffb066, 0.18, 0.0);

    G.signPositions = {
      magenta: new T.Vector3(-6.0, 12.4, -18.0),
      cyan: new T.Vector3(17.8, 6.6, -3.0),
      orange: new T.Vector3(-17.8, 5.4, -1.0),
      shop: new T.Vector3(9.4, 2.2, 16.4),
      billboard: new T.Vector3(7.2, 11.0, -17.8)
    };
  }

  /* ---------------------------------------------------------------
     Lights
     --------------------------------------------------------------- */
  function buildLights(scene) {
    const hemi = new T.HemisphereLight(0x4a6484, 0x1a1c20, 9.5);
    scene.add(hemi);

    const moon = new T.DirectionalLight(0xc8dcff, 7.5);
    moon.position.set(14, 46, 26);
    moon.target.position.set(-2, 0, -6);
    scene.add(moon.target);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 95;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.035;
    moon.shadow.radius = 2.2;
    scene.add(moon);

    const mk = (color, intensity, dist, x, y, z, decay) => {
      const l = new T.PointLight(color, intensity, dist, decay === undefined ? 2 : decay);
      l.position.set(x, y, z);
      scene.add(l);
      return l;
    };
    const magenta = mk(0xff2f7f, 78, 24, -6.0, 11.0, -14.8);
    const cyan = mk(0x35e6ff, 70, 30, 14.8, 6.2, -3.0);
    const orange = mk(0xff8b2e, 30, 20, -15.6, 5.2, -1.0);
    const shop = mk(0xffa85c, 85, 26, 9.4, 2.6, 14.0);
    const billboard = mk(0x3a9bff, 40, 20, 7.2, 9.2, -15.8);
    const bulb = mk(0xffcf8f, 16, 11, -3.5, 10.3, -7.0);

    // flashlight
    const flash = new T.SpotLight(0xcfe4ff, 0, 34, 0.48, 0.55, 1.6);
    flash.position.set(0, 0, 0);
    flash.castShadow = false;
    scene.add(flash);
    const flashTarget = new T.Object3D();
    scene.add(flashTarget);
    flash.target = flashTarget;

    // muzzle flash light
    const muzzle = new T.PointLight(0xffd7a0, 0, 18, 2);
    scene.add(muzzle);

    return { hemi, moon, magenta, cyan, orange, shop, billboard, bulb, flash, flashTarget, muzzle };
  }

  /* ---------------------------------------------------------------
     Build everything
     --------------------------------------------------------------- */
  G.buildLevel = function (scene, renderer) {
    G.seed(20261124);
    // environment map (procedural equirect → PMREM)
    const ec = document.createElement('canvas'); ec.width = 1024; ec.height = 512;
    const eg = ec.getContext('2d');
    const grad = eg.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#05070d');
    grad.addColorStop(0.42, '#0b1422');
    grad.addColorStop(0.55, '#1b1a24');
    grad.addColorStop(0.62, '#3a2018');
    grad.addColorStop(0.72, '#120d12');
    grad.addColorStop(1, '#050506');
    eg.fillStyle = grad; eg.fillRect(0, 0, 1024, 512);
    const blobs = [
      [180, 300, 130, 'rgba(255,60,140,0.55)'],
      [640, 290, 150, 'rgba(50,220,255,0.45)'],
      [880, 320, 110, 'rgba(255,150,60,0.4)'],
      [420, 330, 90, 'rgba(120,170,255,0.35)']
    ];
    blobs.forEach(([x, y, r, c]) => {
      const g2 = eg.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, c); g2.addColorStop(1, 'rgba(0,0,0,0)');
      eg.fillStyle = g2; eg.fillRect(x - r, y - r, r * 2, r * 2);
    });
    const et = new T.CanvasTexture(ec);
    et.mapping = T.EquirectangularReflectionMapping;
    et.colorSpace = T.SRGBColorSpace;
    const pmrem = new T.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envMap = pmrem.fromEquirectangular(et).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 1.0;
    G.envMap = envMap;
    et.dispose(); pmrem.dispose();

    scene.fog = new T.FogExp2(0x0d1622, 0.0205);

    const skyMat = buildSky(scene);
    const reflector = new G.Reflector(renderer);
    const ground = buildGround(scene, reflector);
    const M = materials();
    buildBuildings(scene, M);
    buildSkyline(scene, M);
    buildProps(scene, M);
    buildSigns(scene);
    const lights = buildLights(scene);

    return { skyMat, reflector, ground, M, lights };
  };
})();
