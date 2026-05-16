// Gravity Duel - core game (Three.js)
// Arena: hexagonal floating platform. Players are spheres with characters.
// Mechanics: pull-and-release launch, tap pulse, swipe dash, device tilt to tilt arena.

import * as THREE from 'three';
import { AI } from './ai.js';
import { Input } from './input.js';

const ARENA_RADIUS = 7;
const FALL_Y = -8;
const RESPAWN_TIME = 1.5;
const MATCH_SECONDS = 120;

const COLORS = ['#e07a5f','#3d5a80','#81b29a','#f2cc8f','#bb6588','#5da4d9'];

export class Game {
  constructor({ canvas, ui, audio }) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = audio;

    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.players = [];
    this.localPlayer = null;
    this.mode = '1v1';
    this.multiplayer = false;
    this.lastPlayers = null;

    this.arenaTiltX = 0;
    this.arenaTiltZ = 0;
    this.targetTiltX = 0;
    this.targetTiltZ = 0;

    this.effects = []; // visual effects (gravity waves, particles)

    this._setupRenderer();
    this._setupScene();

    this.input = new Input({
      canvas: this.canvas,
      onPullStart: (x, y) => this._onPullStart(x, y),
      onPullMove: (x, y, dx, dy) => this._onPullMove(x, y, dx, dy),
      onPullEnd: (x, y, dx, dy) => this._onPullEnd(x, y, dx, dy),
      onTap: (x, y) => this._onTap(x, y),
      onSwipe: (dx, dy) => this._onSwipe(dx, dy),
      onTilt: (gx, gy) => this._onTilt(gx, gy),
      ui: this.ui
    });

    this.ui.on('pause', (p) => { this.paused = p; });

    window.addEventListener('resize', () => this._resize());
    this._resize();

    // Render loop always running so canvas redraws on resize, etc.
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x1a1f3a, 1);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a1f3a, 25, 60);

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.camera.position.set(0, 14, 16);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const amb = new THREE.AmbientLight(0xb8c5e8, 0.55);
    this.scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.0);
    sun.position.set(8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x98c1d9, 0.4);
    rim.position.set(-10, 6, -6);
    this.scene.add(rim);

    // Arena group (so it can tilt)
    this.arenaGroup = new THREE.Group();
    this.scene.add(this.arenaGroup);

    // Hex platform
    const platGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 0.8, 6);
    const platMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.7, metalness: 0.05 });
    this.platform = new THREE.Mesh(platGeo, platMat);
    this.platform.receiveShadow = true;
    this.platform.position.y = -0.4;
    this.arenaGroup.add(this.platform);

    // Decorative rim
    const rimGeo = new THREE.TorusGeometry(ARENA_RADIUS - 0.05, 0.1, 8, 64);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe07a5f, roughness: 0.4 });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.01;
    this.arenaGroup.add(rimMesh);

    // Pattern lines (subtle)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe6dcc4, transparent: true, opacity: 0.6 });
    for (let i = 1; i <= 3; i++) {
      const r = (ARENA_RADIUS - 0.5) * (i / 3);
      const pts = [];
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * r, 0.02, Math.sin(t) * r));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.arenaGroup.add(new THREE.Line(g, lineMat));
    }

    // Background stars / particles
    const starGeo = new THREE.BufferGeometry();
    const starCount = 200;
    const arr = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 30 + Math.random() * 30;
      const t = Math.random() * Math.PI * 2;
      const p = (Math.random() - 0.5) * Math.PI;
      arr[i*3]   = Math.cos(t) * Math.cos(p) * r;
      arr[i*3+1] = Math.sin(p) * r;
      arr[i*3+2] = Math.sin(t) * Math.cos(p) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xfff0d8, size: 0.15, transparent: true, opacity: 0.85 });
    this.stars = new THREE.Points(starGeo, starMat);
    this.scene.add(this.stars);

    // Pull aim ring (shown when pulling)
    const ringGeo = new THREE.RingGeometry(0.6, 0.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    this.aimRing = new THREE.Mesh(ringGeo, ringMat);
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.visible = false;
    this.arenaGroup.add(this.aimRing);

    // Aim arrow (3D)
    const arrowGeo = new THREE.ConeGeometry(0.18, 0.5, 12);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.aimArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.aimArrow.visible = false;
    this.arenaGroup.add(this.aimArrow);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Vertical adjust for portrait
    const portrait = h > w;
    this.camera.position.set(0, portrait ? 16 : 13, portrait ? 14 : 16);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  startMatch({ mode, multiplayer, players }) {
    this.mode = mode;
    this.multiplayer = !!multiplayer;
    this.lastPlayers = players;
    if (!multiplayer) this._hostFlag = true;

    // Reset arena tilt
    this.arenaTiltX = this.arenaTiltZ = this.targetTiltX = this.targetTiltZ = 0;
    this.arenaGroup.rotation.set(0, 0, 0);

    // Remove existing player meshes & effects
    this.players.forEach(p => { if (p.mesh) this.arenaGroup.remove(p.mesh); });
    this.effects.forEach(e => this.arenaGroup.remove(e.mesh));
    this.effects = [];

    this.players = players.map((p, i) => this._createPlayer(p, i, players.length));
    this.localPlayer = this.players.find(p => p.isLocal) || this.players[0];

    this.matchTime = MATCH_SECONDS;
    this.running = true;
    this.paused = false;
    this.winnerShown = false;

    this._updateHUD();
    this.ui.floater('READY!', 700);
    setTimeout(() => this.ui.floater('GO!', 600), 800);
  }

  endMatch(silent = false) {
    this.running = false;
    if (silent) return;
    // Determine winner
    let title = '', detail = '';
    if (this.mode === '3v3') {
      const team0 = this.players.filter(p => p.team === 0).reduce((s, p) => s + p.kos, 0);
      const team1 = this.players.filter(p => p.team === 1).reduce((s, p) => s + p.kos, 0);
      if (team0 > team1) title = '青チーム勝利！';
      else if (team1 > team0) title = '赤チーム勝利！';
      else title = '引き分け';
      detail = `青: ${team0} KO / 赤: ${team1} KO`;
      const myTeam = this.localPlayer.team;
      const won = (myTeam === 0 && team0 > team1) || (myTeam === 1 && team1 > team0);
      this.audio[won ? 'win' : 'lose']();
    } else {
      const sorted = [...this.players].sort((a,b)=>b.kos-a.kos);
      const winner = sorted[0];
      title = winner === this.localPlayer ? '勝利！' : `${winner.name} の勝ち`;
      detail = sorted.map((p,i)=> `${i+1}. ${p.name} — ${p.kos} KO`).join('<br/>');
      this.audio[winner === this.localPlayer ? 'win' : 'lose']();
    }
    this.ui.showEnd(title, detail);
  }

  _createPlayer(info, index, total) {
    const angle = (index / total) * Math.PI * 2;
    const r = ARENA_RADIUS * 0.55;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const color = new THREE.Color(info.color || COLORS[index % COLORS.length]);

    const group = new THREE.Group();

    // Body (capsule-like: sphere + cylinder)
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 18), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.5, 12), bodyMat);
    legs.position.y = 0.25;
    legs.castShadow = true;
    group.add(legs);

    // Eyes (face direction indicator)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
    eyeL.position.set(-0.16, 0.65, 0.38);
    eyeR.position.set( 0.16, 0.65, 0.38);
    group.add(eyeL); group.add(eyeR);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x222244 });
    const pupL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pupilMat);
    const pupR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pupilMat);
    pupL.position.set(-0.16, 0.65, 0.43);
    pupR.position.set( 0.16, 0.65, 0.43);
    group.add(pupL); group.add(pupR);

    // Outline ring (team color)
    const ringGeo = new THREE.RingGeometry(0.55, 0.7, 24);
    const ringColor = info.team === 0 ? 0x3d5a80 : (info.team === 1 ? 0xe07a5f : 0x81b29a);
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    // Name label (sprite)
    const label = this._makeLabel(info.name || 'P', info.isLocal);
    label.position.set(0, 1.4, 0);
    group.add(label);

    group.position.set(x, 0, z);
    this.arenaGroup.add(group);

    return {
      ...info,
      mesh: group,
      body, faceGroup: group, // for facing
      vx: 0, vz: 0, vy: 0,
      onGround: true,
      cdPulse: 0, cdDash: 0, cdTilt: 0,
      stunned: 0,
      kos: 0,
      deaths: 0,
      respawnTimer: 0,
      alive: true,
      facing: angle + Math.PI, // face toward center
      ai: info.isBot ? new AI() : null,
      pullState: null,
      lastHitBy: null,
      lastHitAt: 0,
    };
  }

  _makeLabel(text, isLocal) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isLocal ? 'rgba(224,122,95,0.95)' : 'rgba(42,47,74,0.85)';
    roundRect(ctx, 4, 8, canvas.width - 8, 48, 22); ctx.fill();
    ctx.fillStyle = '#fffaf0';
    ctx.font = 'bold 28px -apple-system, Hiragino Sans, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text + (isLocal ? ' ★' : ''), canvas.width / 2, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.4, 0.35, 1);
    return sprite;
  }

  // ----------- Input handlers (operating on local player) -----------
  _onPullStart(x, y) {
    if (!this.running || this.paused) return;
    const p = this.localPlayer;
    if (!p || !p.alive || p.stunned > 0) return;
    p.pullState = { active: true };
  }
  _onPullMove(x, y, dx, dy) {
    if (!this.localPlayer || !this.localPlayer.pullState) return;
    // Show drag indicator (UI). Limit length
    const maxLen = 110;
    const len = Math.hypot(dx, dy);
    const lim = Math.min(len, maxLen);
    const sx = len > 0 ? (dx / len) * lim : 0;
    const sy = len > 0 ? (dy / len) * lim : 0;
    this.ui.showDragIndicator(x, y, sx, sy);

    // Visualize aim ring on player
    const p = this.localPlayer;
    this.aimRing.visible = true;
    this.aimRing.position.copy(p.mesh.position);
    this.aimRing.position.y = 0.05;
    const power = lim / maxLen;
    this.aimRing.scale.set(1 + power, 1 + power, 1 + power);
    this.aimArrow.visible = true;
    // Convert screen-space drag to world-space direction (opposite of drag for slingshot feel)
    const worldDir = this._screenDeltaToWorld(-dx, -dy);
    if (worldDir) {
      this.aimArrow.position.copy(p.mesh.position);
      this.aimArrow.position.y = 0.6;
      this.aimArrow.position.x += worldDir.x * (0.8 + power * 1.6);
      this.aimArrow.position.z += worldDir.z * (0.8 + power * 1.6);
      const yaw = Math.atan2(worldDir.x, worldDir.z);
      this.aimArrow.rotation.set(Math.PI / 2, 0, -yaw);
    }
  }
  _onPullEnd(x, y, dx, dy) {
    this.ui.hideDragIndicator();
    this.aimRing.visible = false;
    this.aimArrow.visible = false;
    const p = this.localPlayer;
    if (!p || !p.pullState) return;
    p.pullState = null;
    if (!p.alive || p.stunned > 0) return;
    const maxLen = 110;
    const len = Math.min(Math.hypot(dx, dy), maxLen);
    if (len < 12) return;
    const power = len / maxLen;
    const world = this._screenDeltaToWorld(-dx, -dy);
    if (!world) return;
    const speed = 6 + power * 12;
    p.vx = world.x * speed;
    p.vz = world.z * speed;
    p.vy = Math.max(p.vy, 0.5 + power * 1.5);
    p.facing = Math.atan2(world.x, world.z);
    this.audio.shoot();
    this._broadcastInput({ kind: 'launch', vx: p.vx, vz: p.vz, vy: p.vy, x: p.mesh.position.x, z: p.mesh.position.z });
  }
  _onTap(x, y) {
    if (!this.running || this.paused) return;
    const p = this.localPlayer;
    if (!p || !p.alive || p.stunned > 0) return;
    if (p.cdPulse > 0) return;
    p.cdPulse = 4.0;
    this._spawnPulse(p, 4.0);
    this.audio.pulse();
    this._broadcastInput({ kind: 'pulse', x: p.mesh.position.x, z: p.mesh.position.z });
  }
  _onSwipe(dx, dy) {
    if (!this.running || this.paused) return;
    const p = this.localPlayer;
    if (!p || !p.alive || p.stunned > 0) return;
    if (p.cdDash > 0) return;
    const world = this._screenDeltaToWorld(dx, dy);
    if (!world) return;
    p.vx = world.x * 16;
    p.vz = world.z * 16;
    p.cdDash = 2.5;
    p.facing = Math.atan2(world.x, world.z);
    this._spawnDashTrail(p);
    this.audio.dash();
    this._broadcastInput({ kind: 'dash', vx: p.vx, vz: p.vz, x: p.mesh.position.x, z: p.mesh.position.z });
  }
  _onTilt(gx, gy) {
    // gx, gy in [-1,1]. Apply to arena tilt
    if (!this.running || this.paused) return;
    const p = this.localPlayer;
    if (!p) return;
    // Tilt strength is gated by cooldown but updates instantly
    const maxTilt = 0.18; // radians
    const cdReady = p.cdTilt <= 0;
    const scale = cdReady ? 1.0 : 0.25; // limited control during CD
    this.targetTiltZ = THREE.MathUtils.clamp(gx, -1, 1) * maxTilt * scale;
    this.targetTiltX = THREE.MathUtils.clamp(gy, -1, 1) * maxTilt * scale;
  }

  _screenDeltaToWorld(dx, dy) {
    // Convert screen pixel delta into world XZ direction relative to camera.
    // The camera looks down-ish from +Z to origin, so screen-up = world -Z, screen-right = world +X.
    const cam = this.camera;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    cam.getWorldDirection(new THREE.Vector3()); // ensure matrix up to date
    cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    // Project onto XZ plane
    right.y = 0; up.y = 0;
    // 'up' in camera space corresponds to screen-up. But we used dy positive = down screen.
    // We want movement direction in world.
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return null;
    const nx = dx / len, ny = dy / len;
    // screen right -> camera right; screen up (i.e. -dy) -> -camera forward on XZ
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    right.normalize();
    const world = new THREE.Vector3();
    world.addScaledVector(right, nx);
    world.addScaledVector(forward, -ny); // screen down(positive dy) = away from camera? Actually screen down corresponds to forward (toward camera target from camera). Let's test: camera at +Z looking toward origin; screen down = world -Y but we'll use forward (down screen = into scene = +forward).
    world.y = 0;
    if (world.lengthSq() < 1e-6) return null;
    world.normalize();
    return world;
  }

  // ------------- Effects -------------
  _spawnPulse(p, range) {
    const geo = new THREE.RingGeometry(0.4, 0.55, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd49a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p.mesh.position);
    m.position.y = 0.05;
    this.arenaGroup.add(m);
    this.effects.push({ mesh: m, kind: 'pulse', owner: p, t: 0, dur: 0.5, range });
  }
  _spawnDashTrail(p) {
    const geo = new THREE.SphereGeometry(0.3, 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p.mesh.position);
    this.arenaGroup.add(m);
    this.effects.push({ mesh: m, kind: 'trail', t: 0, dur: 0.35 });
  }
  _spawnFallBurst(p) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.12, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, opacity: 0.9 });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p.mesh.position);
      const a = (i / 8) * Math.PI * 2;
      this.arenaGroup.add(m);
      this.effects.push({ mesh: m, kind: 'burst', t: 0, dur: 0.6, vx: Math.cos(a) * 3, vy: 3 + Math.random() * 2, vz: Math.sin(a) * 3 });
    }
  }

  // ------------- Loop -------------
  _tick(now) {
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0);
    this.lastTime = now;

    // Slow rotate stars
    if (this.stars) this.stars.rotation.y += dt * 0.01;

    if (this.running && !this.paused) {
      this._update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    // Timer
    this.matchTime -= dt;
    if (this.matchTime <= 0) {
      this.matchTime = 0;
      if (!this.winnerShown) { this.winnerShown = true; this.endMatch(); }
    }

    // Arena tilt lerp
    this.arenaTiltX += (this.targetTiltX - this.arenaTiltX) * Math.min(1, dt * 5);
    this.arenaTiltZ += (this.targetTiltZ - this.arenaTiltZ) * Math.min(1, dt * 5);
    this.arenaGroup.rotation.x = this.arenaTiltX;
    this.arenaGroup.rotation.z = this.arenaTiltZ;

    // In multiplayer non-host mode, only simulate local player; host state handles others.
    const isClient = this.multiplayer && !this._isHost();
    // Update players
    for (const p of this.players) {
      // Cooldowns (always)
      if (p.cdPulse > 0) p.cdPulse = Math.max(0, p.cdPulse - dt);
      if (p.cdDash > 0)  p.cdDash  = Math.max(0, p.cdDash  - dt);
      if (p.cdTilt > 0)  p.cdTilt  = Math.max(0, p.cdTilt  - dt);
      if (p.stunned > 0) p.stunned = Math.max(0, p.stunned - dt);

      if (isClient && !p.isLocal) continue; // remote players are server-driven

      if (!p.alive) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) this._respawn(p);
        continue;
      }

      // AI logic (only host runs AI)
      if (p.ai && !isClient) p.ai.update(p, this, dt);

      // Gravity from arena tilt (simulated as a horizontal force)
      // Tilt rotation makes the floor slope. Convert to in-plane force.
      const gTilt = 9.8;
      const accX = Math.sin(this.arenaTiltZ) * gTilt;
      const accZ = -Math.sin(this.arenaTiltX) * gTilt;
      p.vx += accX * dt;
      p.vz += accZ * dt;

      // Damping
      const damp = p.onGround ? 0.9 : 0.3;
      const f = Math.exp(-damp * dt);
      p.vx *= f; p.vz *= f;

      // Vertical / gravity
      const G = 18;
      p.vy -= G * dt;

      // Integrate
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      // Check platform
      const distXZ = Math.hypot(p.mesh.position.x, p.mesh.position.z);
      const inArena = distXZ < ARENA_RADIUS - 0.2;
      if (p.mesh.position.y <= 0 && inArena) {
        p.mesh.position.y = 0;
        p.vy = 0;
        p.onGround = true;
      } else if (p.mesh.position.y > 0) {
        p.onGround = false;
      }

      // Falling off
      if (p.mesh.position.y < FALL_Y) {
        this._kill(p);
        continue;
      }

      // Animation: face direction of velocity if moving
      const speed = Math.hypot(p.vx, p.vz);
      if (speed > 1.5) p.facing = Math.atan2(p.vx, p.vz);
      p.mesh.rotation.y = p.facing;

      // No artificial edge resistance — falling is the point of the game.

      // Bob head while moving
      const t = performance.now() * 0.01;
      p.body.position.y = 0.55 + Math.sin(t * (1 + speed * 0.4)) * 0.04 * Math.min(1, speed * 0.2);
    }

    // Player-player collisions (simple sphere)
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i]; if (!a.alive) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j]; if (!b.alive) continue;
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const d = Math.hypot(dx, dz);
        const minD = 0.9;
        if (d < minD && d > 0.0001) {
          const nx = dx / d, nz = dz / d;
          const overlap = minD - d;
          a.mesh.position.x -= nx * overlap * 0.5;
          a.mesh.position.z -= nz * overlap * 0.5;
          b.mesh.position.x += nx * overlap * 0.5;
          b.mesh.position.z += nz * overlap * 0.5;
          // Exchange impulse based on velocity difference
          const rvx = a.vx - b.vx, rvz = a.vz - b.vz;
          const vn = rvx * nx + rvz * nz;
          if (vn > 0) {
            const imp = vn * 0.9;
            a.vx -= nx * imp; a.vz -= nz * imp;
            b.vx += nx * imp; b.vz += nz * imp;
            if (vn > 4) {
              this.audio.hit();
              a.stunned = Math.max(a.stunned, 0.12);
              b.stunned = Math.max(b.stunned, 0.12);
              // Attribution: faster mover hit the slower
              const aSpd = Math.hypot(a.vx, a.vz), bSpd = Math.hypot(b.vx, b.vz);
              const now = performance.now();
              if (aSpd > bSpd) { b.lastHitBy = a; b.lastHitAt = now; }
              else { a.lastHitBy = b; a.lastHitAt = now; }
            }
          }
        }
      }
    }

    // Effects update
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      if (e.kind === 'pulse') {
        const t = e.t / e.dur;
        e.mesh.scale.setScalar(1 + t * e.range * 2.2);
        e.mesh.material.opacity = 0.9 * (1 - t);
        // Apply push to others
        for (const p of this.players) {
          if (p === e.owner || !p.alive) continue;
          const dx = p.mesh.position.x - e.mesh.position.x;
          const dz = p.mesh.position.z - e.mesh.position.z;
          const d = Math.hypot(dx, dz);
          const curR = (1 + t * e.range * 2.2) * 0.55;
          if (d > 0.001 && d < curR + 0.4 && !e.applied) {
            // Only apply once per target near peak
          }
        }
        // Apply push at half-time only once
        if (!e.applied && t > 0.15) {
          e.applied = true;
          for (const p of this.players) {
            if (p === e.owner || !p.alive) continue;
            // Friendly fire off in 3v3
            if (this.mode === '3v3' && e.owner && p.team === e.owner.team) continue;
            const dx = p.mesh.position.x - e.mesh.position.x;
            const dz = p.mesh.position.z - e.mesh.position.z;
            const d = Math.hypot(dx, dz);
            if (d < e.range) {
              const f = (1 - d / e.range);
              const nx = dx / Math.max(d, 0.001), nz = dz / Math.max(d, 0.001);
              const pwr = 14 * f;
              p.vx += nx * pwr; p.vz += nz * pwr; p.vy = Math.max(p.vy, 2 + f * 4);
              p.stunned = 0.2;
              p.lastHitBy = e.owner;
              p.lastHitAt = performance.now();
            }
          }
        }
        if (e.t >= e.dur) { this.arenaGroup.remove(e.mesh); this.effects.splice(i, 1); }
      } else if (e.kind === 'trail') {
        const t = e.t / e.dur;
        e.mesh.material.opacity = 0.6 * (1 - t);
        e.mesh.scale.setScalar(1 + t * 2);
        if (e.t >= e.dur) { this.arenaGroup.remove(e.mesh); this.effects.splice(i, 1); }
      } else if (e.kind === 'burst') {
        const t = e.t / e.dur;
        e.mesh.position.x += e.vx * dt;
        e.mesh.position.y += e.vy * dt; e.vy -= 9 * dt;
        e.mesh.position.z += e.vz * dt;
        e.mesh.material.opacity = 1 - t;
        if (e.t >= e.dur) { this.arenaGroup.remove(e.mesh); this.effects.splice(i, 1); }
      }
    }

    // HUD
    this._updateHUD();

    // Host state sync (limited rate)
    this._netAccum = (this._netAccum || 0) + dt;
    if (this.multiplayer && this._netAccum >= 0.08) { // ~12 Hz
      this._netAccum = 0;
      if (this.onHostState) {
        const state = {
          t: performance.now() | 0,
          players: this.players.map(p => ({
            id: p.id,
            x: +p.mesh.position.x.toFixed(2),
            y: +p.mesh.position.y.toFixed(2),
            z: +p.mesh.position.z.toFixed(2),
            vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2), vz: +p.vz.toFixed(2),
            kos: p.kos, deaths: p.deaths, alive: p.alive, stunned: +p.stunned.toFixed(2),
          })),
          tiltX: +this.arenaTiltX.toFixed(3),
          tiltZ: +this.arenaTiltZ.toFixed(3),
          time: +this.matchTime.toFixed(2),
        };
        this.onHostState(state);
      }
    }
  }

  _kill(p) {
    p.alive = false;
    p.deaths++;
    p.mesh.visible = false;
    p.respawnTimer = RESPAWN_TIME;
    this.audio.fall();
    this._spawnFallBurst(p);

    // Attribution: prefer recent lastHitBy (within 3s)
    let killer = null;
    if (p.lastHitBy && (performance.now() - p.lastHitAt) < 3000 && p.lastHitBy.alive !== undefined && p.lastHitBy !== p) {
      if (!(this.mode === '3v3' && p.lastHitBy.team === p.team)) killer = p.lastHitBy;
    }
    // Fallback: nearest opponent within 4u
    if (!killer) {
      let bestD = 4;
      for (const q of this.players) {
        if (q === p || !q.alive) continue;
        if (this.mode === '3v3' && q.team === p.team) continue;
        const d = Math.hypot(q.mesh.position.x - p.mesh.position.x, q.mesh.position.z - p.mesh.position.z);
        if (d < bestD) { bestD = d; killer = q; }
      }
    }
    if (killer) killer.kos++;
    if (p === this.localPlayer) this.ui.floater('落下！', 800);
    else if (killer === this.localPlayer) this.ui.floater('KO！', 800);
  }

  _respawn(p) {
    const angle = Math.random() * Math.PI * 2;
    const r = ARENA_RADIUS * 0.4;
    p.mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    p.vx = p.vz = p.vy = 0;
    p.alive = true;
    p.mesh.visible = true;
    p.stunned = 0.5;
    p.facing = Math.atan2(-p.mesh.position.x, -p.mesh.position.z);
  }

  _updateHUD() {
    // Scores - 1v1: left/right; ffa6: top 2; 3v3: team scores
    let leftHTML = '', rightHTML = '';
    if (this.mode === '1v1') {
      const me = this.localPlayer;
      const opp = this.players.find(p => p !== me) || this.players[1];
      leftHTML = `<b>${escapeHTML(me.name)}</b><br><span>${me.kos} KO</span>`;
      rightHTML = `<b>${escapeHTML(opp.name)}</b><br><span>${opp.kos} KO</span>`;
    } else if (this.mode === '3v3') {
      const t0 = this.players.filter(p=>p.team===0).reduce((s,p)=>s+p.kos,0);
      const t1 = this.players.filter(p=>p.team===1).reduce((s,p)=>s+p.kos,0);
      leftHTML = `<b>青チーム</b><br><span>${t0}</span>`;
      rightHTML = `<b>赤チーム</b><br><span>${t1}</span>`;
    } else {
      const sorted = [...this.players].sort((a,b)=>b.kos-a.kos).slice(0,2);
      leftHTML = `<b>1位</b><br><span>${escapeHTML(sorted[0]?.name||'-')} ${sorted[0]?.kos||0}</span>`;
      rightHTML = `<b>あなた</b><br><span>${this.localPlayer.kos} KO</span>`;
    }
    this.ui.setScores(leftHTML, rightHTML);
    this.ui.setTimer(this.matchTime);
    const me = this.localPlayer;
    if (me) {
      this.ui.setCooldown('pulse', 1 - me.cdPulse / 4.0);
      this.ui.setCooldown('dash', 1 - me.cdDash / 2.5);
      this.ui.setCooldown('tilt', 1 - me.cdTilt / 5.0);
    }
  }

  // ---- Multiplayer hooks ----
  onLocalInput = null; // assigned by Net
  onHostState = null;
  _isHost() {
    // Provided externally by net; default: any local player is host in solo
    return this._hostFlag !== false;
  }
  setHost(isHost) { this._hostFlag = !!isHost; }
  _broadcastInput(msg) {
    if (this.onLocalInput) this.onLocalInput(msg);
  }
  onRemoteInput(peerId, msg) {
    const p = this.players.find(p => p.id === peerId);
    if (!p) return;
    if (msg.kind === 'launch') {
      p.vx = msg.vx; p.vy = msg.vy; p.vz = msg.vz;
      p.mesh.position.x = msg.x; p.mesh.position.z = msg.z;
    } else if (msg.kind === 'pulse') {
      this._spawnPulse(p, 4.0);
    } else if (msg.kind === 'dash') {
      p.vx = msg.vx; p.vz = msg.vz;
      p.mesh.position.x = msg.x; p.mesh.position.z = msg.z;
      this._spawnDashTrail(p);
    }
  }
  onRemoteState(state) {
    // Client receives authoritative state from host; smooth positions
    if (!state || !state.players) return;
    for (const s of state.players) {
      const p = this.players.find(pp => pp.id === s.id);
      if (!p) continue;
      if (p.isLocal) {
        // For local player, only reconcile if drift is large
        const dx = s.x - p.mesh.position.x, dz = s.z - p.mesh.position.z;
        if (Math.hypot(dx, dz) > 2.0) {
          p.mesh.position.x = s.x; p.mesh.position.z = s.z; p.mesh.position.y = s.y;
        }
        p.kos = s.kos; p.deaths = s.deaths;
      } else {
        // Lerp remote player toward host state
        p._targetX = s.x; p._targetY = s.y; p._targetZ = s.z;
        p.vx = s.vx; p.vy = s.vy; p.vz = s.vz;
        p.alive = s.alive;
        p.mesh.visible = s.alive;
        p.kos = s.kos; p.deaths = s.deaths;
        // Apply immediate snap for now (cheap)
        p.mesh.position.set(s.x, s.y, s.z);
      }
    }
    this.targetTiltX = state.tiltX;
    this.targetTiltZ = state.tiltZ;
    this.matchTime = state.time;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
