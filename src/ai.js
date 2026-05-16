// Simple but fun AI: aim/launch toward closest opponent edge-push, use pulse when crowded, dash to recover
export class AI {
  constructor() {
    this.cooldownThink = 0;
    this.commit = null; // current plan
  }
  update(p, game, dt) {
    this.cooldownThink -= dt;

    // Pick target: nearest alive enemy
    let target = null, td = 1e9;
    for (const q of game.players) {
      if (q === p || !q.alive) continue;
      if (game.mode === '3v3' && q.team === p.team) continue;
      const d = Math.hypot(q.mesh.position.x - p.mesh.position.x, q.mesh.position.z - p.mesh.position.z);
      if (d < td) { td = d; target = q; }
    }
    if (!target) return;

    // If close to edge, push inward instinctively (survival)
    const r = Math.hypot(p.mesh.position.x, p.mesh.position.z);
    if (r > 6.5 && p.cdDash <= 0 && Math.random() < 0.5) {
      const nx = -p.mesh.position.x / r, nz = -p.mesh.position.z / r;
      p.vx = nx * 14; p.vz = nz * 14; p.cdDash = 2.5;
      return;
    }

    if (this.cooldownThink > 0) return;
    this.cooldownThink = 0.5 + Math.random() * 0.5;

    // Decide action by distance & cooldowns
    if (td < 3.2 && p.cdPulse <= 0 && Math.random() < 0.7) {
      // Pulse
      p.cdPulse = 4.0;
      game._spawnPulse(p, 4.0);
      game.audio.pulse();
      return;
    }
    if (td < 4.5 && p.cdDash <= 0 && Math.random() < 0.6) {
      // Dash through opponent toward arena edge (try to body-check)
      const dx = target.mesh.position.x - p.mesh.position.x;
      const dz = target.mesh.position.z - p.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      // Push opponent toward the edge: dash direction beyond opponent toward the nearest edge from opponent's POV
      const ex = target.mesh.position.x, ez = target.mesh.position.z;
      const er = Math.hypot(ex, ez) || 1;
      // dir = from me toward opponent + a bit toward edge from opp
      const tx = dx / d + (ex / er) * 0.6;
      const tz = dz / d + (ez / er) * 0.6;
      const tm = Math.hypot(tx, tz) || 1;
      p.vx = (tx / tm) * 16; p.vz = (tz / tm) * 16;
      p.facing = Math.atan2(tx, tz);
      p.cdDash = 2.5;
      game._spawnDashTrail(p);
      game.audio.dash();
      return;
    }
    // Else "launch" maneuver (charge & release)
    const dx = target.mesh.position.x - p.mesh.position.x;
    const dz = target.mesh.position.z - p.mesh.position.z;
    const d = Math.hypot(dx, dz) || 1;
    // Aim toward opponent with a slight overshoot bias toward edge
    const er = Math.hypot(target.mesh.position.x, target.mesh.position.z) || 1;
    const bias = 0.3;
    const tx = dx / d + (target.mesh.position.x / er) * bias;
    const tz = dz / d + (target.mesh.position.z / er) * bias;
    const m = Math.hypot(tx, tz) || 1;
    const power = 8 + Math.random() * 4;
    p.vx += (tx / m) * power;
    p.vz += (tz / m) * power;
    p.vy = Math.max(p.vy, 1.0);
    p.facing = Math.atan2(tx, tz);
  }
}
