import * as THREE from 'three';

/**
 * Zeropoint 3D Scene
 * -------------------
 * A panorama sphere centered on the camera + a particle starfield +
 * avatar meshes for the local player and remote peers.
 *
 * The panorama image is wrapped on the inside of a large sphere; even
 * when the source isn't true equirectangular, it still produces a
 * cinematic, abstract, "inside another world" feeling thanks to the
 * dreamy gradient fog on top.
 */

export class ZeropointScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.006);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
    this.camera.position.set(0, 0, 0.01);

    this.yaw = 0;      // horizontal look
    this.pitch = 0;    // vertical look
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.avatarPos = new THREE.Vector3(0, 0, 0);
    this.avatarTargetPos = new THREE.Vector3(0, 0, 0);

    this.peers = new Map(); // id -> { group, label, bubble, pos, targetPos, color }

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();

    this._buildStars();
    this._buildGround();
    this._buildPanoSphere();
    this._buildLights();

    this._hudPeers = []; // DOM refs for labels/bubbles

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    this._installPointerControls();

    this.running = true;
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.panoTex) this.panoTex.dispose();
  }

  /* ---------------- build ---------------- */
  _buildStars() {
    const count = 1800;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 600 + Math.random() * 300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const tint = 0.6 + Math.random() * 0.4;
      col[i * 3] = tint;
      col[i * 3 + 1] = tint;
      col[i * 3 + 2] = Math.min(1, tint + Math.random() * 0.2);
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.stars = new THREE.Points(geom, mat);
    this.scene.add(this.stars);
  }

  _buildGround() {
    // High-end reflective ground with layered textures
    const g = new THREE.CircleGeometry(60, 128);
    const m = new THREE.MeshStandardMaterial({
      color: 0x0a0d14,
      roughness: 0.15,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    this.ground = new THREE.Mesh(g, m);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -2.2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Dynamic Grid with bloom-like effect
    const grid = new THREE.GridHelper(120, 60, 0x7ce7ff, 0x1a2030);
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    grid.position.y = -2.195;
    this.scene.add(grid);
    
    // Additional glowing ring for orientation
    const ringGeom = new THREE.RingGeometry(5.8, 6, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7ce7ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -2.19;
    this.scene.add(ring);
  }

  _buildPanoSphere() {
    const geom = new THREE.SphereGeometry(500, 60, 40);
    geom.scale(-1, 1, 1); // invert for inside view

    const mat = new THREE.MeshBasicMaterial({
      color: 0x111522,
      fog: false,
    });
    this.panoSphere = new THREE.Mesh(geom, mat);
    this.scene.add(this.panoSphere);

    // Soft inner gradient to fade horizon and mask texture stretching
    const fadeGeom = new THREE.SphereGeometry(490, 40, 30);
    fadeGeom.scale(-1, 1, 1);
    const fadeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x05060a) },
        uAccent: { value: new THREE.Color(0x7ce7ff) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform vec3 uColor;
        uniform vec3 uAccent;
        void main() {
          float y = vWorld.y;
          // Dark top & bottom, subtle accent mid
          float top = smoothstep(0.15, 0.9, y);
          float bot = smoothstep(-0.1, -0.9, y);
          float horizon = 1.0 - abs(y) * 1.8;
          horizon = clamp(horizon, 0.0, 1.0);
          vec3 c = mix(uColor, uColor * 0.2, top);
          c = mix(c, uColor, bot);
          c += uAccent * 0.08 * horizon;
          float alpha = max(top, bot) * 0.85;
          gl_FragColor = vec4(c, alpha);
        }
      `,
    });
    this.fade = new THREE.Mesh(fadeGeom, fadeMat);
    this.scene.add(this.fade);
  }

  _buildLights() {
    // Cinematic Lighting System
    const amb = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(amb);

    const hemi = new THREE.HemisphereLight(0x7ce7ff, 0x080a12, 0.6);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;
    this.scene.add(dir);

    // Point lights for "magical" atmosphere
    const p1 = new THREE.PointLight(0x7ce7ff, 15, 20);
    p1.position.set(-8, 5, -8);
    this.scene.add(p1);

    const p2 = new THREE.PointLight(0xb878ff, 12, 20);
    p2.position.set(8, 3, 8);
    this.scene.add(p2);
  }

  /* ---------------- place swap ---------------- */
  async setPlace(place) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    this.currentPlace = place;
    this.fade.material.uniforms.uAccent.value.set(place.sky || '#7ce7ff');

    if (place.procedural === 'space') {
      // For the orbit shot we leave the black + stars and skip texture
      if (this.panoTex) { this.panoTex.dispose(); this.panoTex = null; }
      this.panoSphere.material.color.set(0x05060a);
      this.panoSphere.material.map = null;
      this.panoSphere.material.needsUpdate = true;
      this.stars.material.opacity = 1.2;
      return;
    }

    this.stars.material.opacity = 0.55;

    return new Promise((resolve) => {
      loader.load(
        place.pano,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          if (this.panoTex) this.panoTex.dispose();
          this.panoTex = tex;
          this.panoSphere.material.map = tex;
          this.panoSphere.material.color.set(0xffffff);
          this.panoSphere.material.needsUpdate = true;
          resolve();
        },
        undefined,
        () => {
          // Fallback: keep color-only sphere
          this.panoSphere.material.color.set(place.sky || '#111522');
          this.panoSphere.material.map = null;
          this.panoSphere.material.needsUpdate = true;
          resolve();
        }
      );
    });
  }

  /* ---------------- avatars ---------------- */
  setSelfAvatar({ color }) {
    if (this.selfAvatar) this.scene.remove(this.selfAvatar);
    this.selfAvatar = this._makeAvatar(color);
    this.selfAvatar.position.copy(this.avatarPos);
    // Self avatar is subtle so you don't see yourself blocking view
    this.selfAvatar.visible = false;
    this.scene.add(this.selfAvatar);
  }

  _makeAvatar(colorHex) {
    const group = new THREE.Group();
    const color = new THREE.Color(colorHex || '#7ce7ff');

    // Body - stylized capsule with glow
    const bodyGeom = new THREE.CapsuleGeometry(0.35, 0.7, 6, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.4),
      roughness: 0.35,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.6;
    group.add(body);

    // Halo ring
    const ringGeom = new THREE.TorusGeometry(0.55, 0.04, 8, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = 1.35;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Ground glow
    const glowGeom = new THREE.CircleGeometry(0.8, 24);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -2.18;
    group.add(glow);

    return group;
  }

  addPeer(id, { name, color }) {
    if (this.peers.has(id)) return;
    const group = this._makeAvatar(color);
    // Spawn on a ring around center
    const angle = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 5;
    const pos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    group.position.copy(pos);
    this.scene.add(group);

    const entry = {
      id,
      name,
      color,
      group,
      pos: pos.clone(),
      targetPos: pos.clone(),
      lastSeen: performance.now(),
      bubbleEl: null,
      bubbleExpiry: 0,
      labelEl: null,
    };
    this.peers.set(id, entry);
    return entry;
  }

  updatePeer(id, { x, z, name, color }) {
    const p = this.peers.get(id);
    if (!p) return;
    if (typeof x === 'number' && typeof z === 'number') {
      p.targetPos.set(x, 0, z);
    }
    if (name) p.name = name;
    if (color) {
      p.color = color;
      p.group.children.forEach((c) => {
        if (c.material && c.material.color) c.material.color.set(color);
        if (c.material && c.material.emissive) c.material.emissive.set(new THREE.Color(color).multiplyScalar(0.4));
      });
    }
    p.lastSeen = performance.now();
  }

  removePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    if (p.bubbleEl && p.bubbleEl.parentNode) p.bubbleEl.parentNode.removeChild(p.bubbleEl);
    if (p.labelEl && p.labelEl.parentNode) p.labelEl.parentNode.removeChild(p.labelEl);
    this.peers.delete(id);
  }

  setPeerChat(id, text) {
    const p = this.peers.get(id);
    if (!p) return;
    p.bubbleText = text;
    p.bubbleExpiry = performance.now() + 5500;
  }

  setPeerEmote(id, emote) {
    const p = this.peers.get(id);
    if (!p) return;
    this._spawnEmoteAt(p.group.position, emote);
  }

  selfEmote(emote) {
    this._spawnEmoteAt(this.avatarPos, emote);
  }

  _spawnEmoteAt(worldPos, emote) {
    const el = document.createElement('div');
    el.className = 'emote-float';
    el.textContent = emote;
    document.body.appendChild(el);
    this._floatingEmotes = this._floatingEmotes || [];
    this._floatingEmotes.push({ el, worldPos: worldPos.clone().setY(1.3), expires: performance.now() + 1800 });
  }

  /* ---------------- self movement ---------------- */
  moveSelfTo(x, z) {
    this.avatarTargetPos.set(x, 0, z);
  }

  /* ---------------- controls ---------------- */
  async enableGyro() {
    // iOS requires explicit user-gesture permission
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', (e) => {
        if (e.alpha == null || e.beta == null) return;
        // Map device orientation to yaw/pitch
        this.targetYaw = -((e.alpha || 0) * Math.PI) / 180;
        this.targetPitch = Math.max(-1.0, Math.min(1.0, ((e.beta || 0) - 45) * Math.PI / 180));
      });
      this.gyroEnabled = true;
      return true;
    } catch { return false; }
  }

  _installPointerControls() {
    const el = this.canvas;
    let dragging = false;
    let startX = 0, startY = 0;
    let startYaw = 0, startPitch = 0;
    let lastTap = 0;

    const onDown = (e) => {
      const p = pointerXY(e);
      dragging = true;
      startX = p.x; startY = p.y;
      startYaw = this.targetYaw;
      startPitch = this.targetPitch;
      el.setPointerCapture && e.pointerId && el.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const p = pointerXY(e);
      const dx = p.x - startX;
      const dy = p.y - startY;
      this.targetYaw = startYaw - dx * 0.003;
      this.targetPitch = clamp(startPitch - dy * 0.003, -1.2, 1.2);
    };
    const onUp = (e) => {
      dragging = false;
      // Double-tap to move in the looked direction (simple navigation)
      const now = performance.now();
      if (now - lastTap < 300) {
        this._tapMove();
      }
      lastTap = now;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);

    // Mouse wheel -> no zoom, but a subtle fov change for parallax feel
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = clamp(this.camera.fov + e.deltaY * 0.03, 55, 95);
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }, { passive: false });

    // Keyboard: WASD walk
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    function pointerXY(e) { return { x: e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0, y: e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0 }; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  }

  _tapMove() {
    // Move one step forward in the direction we look
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const next = this.avatarPos.clone().addScaledVector(dir, 4);
    // Clamp to a reasonable radius
    const maxR = 18;
    if (next.length() > maxR) next.setLength(maxR);
    this.avatarTargetPos.copy(next);
  }

  _applyKeyboardMovement(dt) {
    if (!this.keys) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate();

    const speed = 6 * dt;
    const vec = new THREE.Vector3();
    if (this.keys.has('w') || this.keys.has('arrowup')) vec.add(forward);
    if (this.keys.has('s') || this.keys.has('arrowdown')) vec.sub(forward);
    if (this.keys.has('a') || this.keys.has('arrowleft')) vec.sub(right);
    if (this.keys.has('d') || this.keys.has('arrowright')) vec.add(right);

    if (vec.lengthSq() > 0) {
      vec.normalize().multiplyScalar(speed);
      const next = this.avatarTargetPos.clone().add(vec);
      const maxR = 18;
      if (next.length() > maxR) next.setLength(maxR);
      this.avatarTargetPos.copy(next);
    }
  }

  /* ---------------- resize ---------------- */
  _onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- loop ---------------- */
  _loop() {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());

    this._applyKeyboardMovement(dt);

    // Smooth camera look
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 12);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 12);
    const lookDir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    // Camera stays at avatar head height
    this.avatarPos.lerp(this.avatarTargetPos, Math.min(1, dt * 6));
    const headY = 1.4;
    this.camera.position.set(this.avatarPos.x, headY, this.avatarPos.z);
    this.camera.lookAt(
      this.avatarPos.x + lookDir.x,
      headY + lookDir.y,
      this.avatarPos.z + lookDir.z
    );
    if (this.selfAvatar) this.selfAvatar.position.copy(this.avatarPos);

    // Animate peers
    this.peers.forEach((p) => {
      p.pos.lerp(p.targetPos, Math.min(1, dt * 4));
      p.group.position.copy(p.pos);
      p.group.rotation.y += dt * 0.3;
    });

    // Slow star rotation
    this.stars.rotation.y += dt * 0.005;

    // Send compass needle (consumed via getter)

    this.renderer.render(this.scene, this.camera);

    // Update HUD overlays (names + bubbles + floating emotes)
    this._syncHUD();
  }

  _syncHUD() {
    if (!this._hudContainer) return;
    const now = performance.now();
    const cam = this.camera;

    // Peer labels + bubbles
    this.peers.forEach((p) => {
      const worldHead = p.group.position.clone().add(new THREE.Vector3(0, 1.35, 0));
      const screen = this._projectToScreen(worldHead);

      if (!p.labelEl) {
        p.labelEl = document.createElement('div');
        p.labelEl.className = 'avatar-label';
        this._hudContainer.appendChild(p.labelEl);
      }
      p.labelEl.textContent = p.name || 'traveller';
      if (screen.visible) {
        p.labelEl.style.transform = `translate(${screen.x}px, ${screen.y - 14}px) translate(-50%, -100%)`;
        p.labelEl.style.opacity = screen.opacity;
      } else {
        p.labelEl.style.opacity = 0;
      }

      // Bubble
      if (p.bubbleText && p.bubbleExpiry > now) {
        if (!p.bubbleEl) {
          p.bubbleEl = document.createElement('div');
          p.bubbleEl.className = 'chat-bubble';
          this._hudContainer.appendChild(p.bubbleEl);
        }
        p.bubbleEl.textContent = p.bubbleText;
        if (screen.visible) {
          p.bubbleEl.style.transform = `translate(${screen.x}px, ${screen.y - 48}px) translate(-50%, -100%)`;
          p.bubbleEl.style.opacity = 1;
        } else {
          p.bubbleEl.style.opacity = 0;
        }
      } else if (p.bubbleEl) {
        p.bubbleEl.remove();
        p.bubbleEl = null;
      }
    });

    // Floating emotes
    if (this._floatingEmotes && this._floatingEmotes.length) {
      for (let i = this._floatingEmotes.length - 1; i >= 0; i--) {
        const fe = this._floatingEmotes[i];
        if (now > fe.expires) {
          fe.el.remove();
          this._floatingEmotes.splice(i, 1);
          continue;
        }
        const screen = this._projectToScreen(fe.worldPos);
        if (screen.visible) {
          fe.el.style.left = `${screen.x}px`;
          fe.el.style.top = `${screen.y}px`;
          fe.el.style.opacity = screen.opacity;
        } else {
          fe.el.style.opacity = 0;
        }
      }
    }
  }

  _projectToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    const visible = v.z > -1 && v.z < 1;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
      z: v.z,
      visible,
      opacity: visible ? 1 : 0,
    };
  }

  setHUDContainer(el) { this._hudContainer = el; }

  /* ---------------- accessors ---------------- */
  getSelfTransform() {
    return {
      x: +this.avatarPos.x.toFixed(2),
      z: +this.avatarPos.z.toFixed(2),
      yaw: +this.yaw.toFixed(3),
    };
  }

  getYawDegrees() {
    let deg = (this.yaw * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    return deg;
  }
}
