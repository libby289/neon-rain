/* =========================================================
   NEON RAIN — post: HDR bloom chain / ACES / grading / grain / CA
   ========================================================= */
(function () {
  'use strict';
  const T = THREE, G = window.G;

  const VERT = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  class Post {
    constructor(renderer) {
      this.renderer = renderer;
      this.isGL2 = renderer.capabilities.isWebGL2;
      this.quadScene = new T.Scene();
      this.quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ color: 0xffffff }));
      this.quad.frustumCulled = false;
      this.quadScene.add(this.quad);

      const rtOpts = { type: T.HalfFloatType, depthBuffer: false, stencilBuffer: false };
      this.rtA = new T.WebGLRenderTarget(2, 2, rtOpts);
      this.rtB = new T.WebGLRenderTarget(2, 2, rtOpts);
      this.rtC = new T.WebGLRenderTarget(2, 2, rtOpts);
      this.rtD = new T.WebGLRenderTarget(2, 2, rtOpts);
      this.rtE = new T.WebGLRenderTarget(2, 2, rtOpts);
      this.rtF = new T.WebGLRenderTarget(2, 2, rtOpts);
      [this.rtA, this.rtB, this.rtC, this.rtD, this.rtE, this.rtF].forEach(rt => {
        rt.texture.minFilter = T.LinearFilter;
        rt.texture.magFilter = T.LinearFilter;
        rt.texture.generateMipmaps = false;
      });

      this.hdr = new T.WebGLRenderTarget(2, 2, {
        type: T.HalfFloatType,
        samples: this.isGL2 ? 4 : 0,
        depthBuffer: true,
        stencilBuffer: false
      });
      this.hdr.texture.minFilter = T.LinearFilter;
      this.hdr.texture.magFilter = T.LinearFilter;
      this.hdr.texture.generateMipmaps = false;

      this.brightMat = new T.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.35 }, uKnee: { value: 0.75 } },
        vertexShader: VERT,
        fragmentShader: `
          precision highp float;
          uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uKnee;
          varying vec2 vUv;
          void main(){
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            float l = max(c.r, max(c.g, c.b));
            float w = smoothstep(uThreshold, uThreshold + uKnee, l);
            gl_FragColor = vec4(c * w, 1.0);
          }`
      });

      this.blurMat = new T.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uDir: { value: new T.Vector2(1, 0) }, uTexel: { value: new T.Vector2() } },
        vertexShader: VERT,
        fragmentShader: `
          precision highp float;
          uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel;
          varying vec2 vUv;
          void main(){
            vec2 o = uDir * uTexel;
            vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
            s += (texture2D(tDiffuse, vUv + o*1.3846).rgb + texture2D(tDiffuse, vUv - o*1.3846).rgb) * 0.316216;
            s += (texture2D(tDiffuse, vUv + o*3.2308).rgb + texture2D(tDiffuse, vUv - o*3.2308).rgb) * 0.070270;
            gl_FragColor = vec4(s, 1.0);
          }`
      });

      this.copyMat = new T.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: VERT,
        fragmentShader: `
          precision highp float; uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }`
      });

      this.finalMat = new T.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, tB4: { value: null },
          uRes: { value: new T.Vector2(1, 1) },
          uTime: { value: 0 },
          uBloom: { value: 0.95 },
          uExposure: { value: 1.12 },
          uGrain: { value: 0.017 },
          uCA: { value: 0.0022 },
          uVignette: { value: 0.62 },
          uDamage: { value: 0 },
          uHurtTint: { value: new T.Color(0.55, 0.03, 0.03) }
        },
        vertexShader: VERT,
        fragmentShader: `
          precision highp float;
          uniform sampler2D tDiffuse, tB1, tB2, tB3, tB4;
          uniform vec2 uRes;
          uniform float uTime, uBloom, uExposure, uGrain, uCA, uVignette, uDamage;
          uniform vec3 uHurtTint;
          varying vec2 vUv;

          vec3 aces(vec3 x){
            const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
            return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
          }
          vec3 toSRGB(vec3 c){
            return mix(c*12.92, 1.055*pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
          }
          float hash(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p+19.19); return fract(p.x*p.y); }

          void main(){
            vec2 cc = vUv - 0.5;
            float r2 = dot(cc, cc);
            vec2 uv = 0.5 + cc * (1.0 + 0.020 * r2);
            uv = clamp(uv, vec2(0.0005), vec2(0.9995));

            vec2 ca = cc * uCA * (0.35 + r2 * 2.4);
            vec3 col;
            col.r = texture2D(tDiffuse, clamp(uv + ca, vec2(0.0005), vec2(0.9995))).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, clamp(uv - ca, vec2(0.0005), vec2(0.9995))).b;

            vec3 b1 = texture2D(tB1, uv).rgb;
            vec3 b2 = texture2D(tB2, uv).rgb;
            vec3 b3 = texture2D(tB3, uv).rgb;
            vec3 b4 = texture2D(tB4, uv).rgb;
            col += (b1 * 0.5 + b2 * 0.42 + b3 * 0.38) * uBloom;
            col += b4 * vec3(0.22, 0.30, 0.55) * uBloom;

            col *= uExposure;
            col = aces(col);

            float l = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 shadowTint = vec3(0.84, 0.97, 1.10);
            vec3 highTint   = vec3(1.07, 0.99, 0.90);
            col *= mix(shadowTint, highTint, smoothstep(0.08, 0.8, l));
            col = mix(vec3(l), col, 1.10);
            col = clamp((col - 0.5) * 1.12 + 0.5, 0.0, 1.0);

            // damage / low health
            float dmg = uDamage * (0.35 + 0.65 * smoothstep(0.1, 0.6, length(cc) * 1.4));
            col = mix(col, uHurtTint, dmg * 0.55);
            col *= 1.0 - dmg * 0.25;

            float vig = smoothstep(0.95, 0.24, length(cc) * 1.32);
            col *= mix(1.0, vig, uVignette);

            float g = hash(vUv * uRes + vec2(uTime * 61.7, uTime * 37.1));
            col += (g - 0.5) * uGrain * (1.0 - l * 0.55);
            // tiny dither to prevent banding in the dark gradients
            col += (hash(vUv * uRes + 17.3) - 0.5) * 0.0022;

            col = toSRGB(clamp(col, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }`
      });
      this._blitMat = new T.MeshBasicMaterial({ color: 0xffffff });
      this._size = new T.Vector2(1, 1);
    }

    setSize(w, h, scale) {
      scale = scale || 1;
      const W = Math.max(2, Math.floor(w * scale));
      const H = Math.max(2, Math.floor(h * scale));
      this._size.set(W, H);
      this.hdr.setSize(W, H);
      const h2 = [Math.floor(W / 2), Math.floor(H / 2)];
      const h4 = [Math.floor(W / 4), Math.floor(H / 4)];
      const h8 = [Math.floor(W / 8), Math.floor(H / 8)];
      this.rtA.setSize(h2[0], h2[1]); this.rtB.setSize(h2[0], h2[1]);
      this.rtC.setSize(h4[0], h4[1]); this.rtD.setSize(h4[0], h4[1]);
      this.rtE.setSize(h8[0], h8[1]); this.rtF.setSize(h8[0], h8[1]);
      this.finalMat.uniforms.uRes.value.set(W, H);
      this.pixelScale = scale;
    }

    blit(mat, target) {
      this.quad.material = mat;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.quadScene, this.quadCam);
    }

    blur(src, dst, w, h, dir) {
      this.blurMat.uniforms.tDiffuse.value = src.texture;
      this.blurMat.uniforms.uDir.value.copy(dir);
      this.blurMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      this.blit(this.blurMat, dst);
    }

    render(scene, camera, weaponScene, weaponCam, time, damage) {
      const r = this.renderer;
      r.setRenderTarget(this.hdr);
      r.clear();
      r.render(scene, camera);
      if (weaponScene && weaponCam) {
        r.clearDepth();
        r.render(weaponScene, weaponCam);
      }
      // bright pass → half
      this.brightMat.uniforms.tDiffuse.value = this.hdr.texture;
      this.blit(this.brightMat, this.rtA);
      const w2 = this.rtA.width, h2 = this.rtA.height;
      this.blur(this.rtA, this.rtB, w2, h2, new T.Vector2(1, 0));
      this.blur(this.rtB, this.rtA, w2, h2, new T.Vector2(0, 1));
      // downsample → quarter
      this.copyMat.uniforms.tDiffuse.value = this.rtA.texture;
      this.blit(this.copyMat, this.rtC);
      const w4 = this.rtC.width, h4 = this.rtC.height;
      this.blur(this.rtC, this.rtD, w4, h4, new T.Vector2(1, 0));
      this.blur(this.rtD, this.rtC, w4, h4, new T.Vector2(0, 1));
      // downsample → eighth
      this.copyMat.uniforms.tDiffuse.value = this.rtC.texture;
      this.blit(this.copyMat, this.rtE);
      const w8 = this.rtE.width, h8 = this.rtE.height;
      this.blur(this.rtE, this.rtF, w8, h8, new T.Vector2(1, 0));
      this.blur(this.rtF, this.rtE, w8, h8, new T.Vector2(0, 1));
      // wide anamorphic streak
      this.blurMat.uniforms.tDiffuse.value = this.rtE.texture;
      this.blurMat.uniforms.uDir.value.set(1, 0);
      this.blurMat.uniforms.uTexel.value.set(6 / w8, 0);
      this.blit(this.blurMat, this.rtF);

      const u = this.finalMat.uniforms;
      u.tDiffuse.value = this.hdr.texture;
      u.tB1.value = this.rtA.texture;
      u.tB2.value = this.rtC.texture;
      u.tB3.value = this.rtE.texture;
      u.tB4.value = this.rtF.texture;
      u.uTime.value = time;
      u.uDamage.value = damage || 0;
      this.blit(this.finalMat, null);
    }
  }
  G.Post = Post;
})();
