// Unified pointer input: distinguishes tap / swipe / pull (long-press drag).
// Also handles device orientation (tilt).
export class Input {
  constructor({ canvas, onPullStart, onPullMove, onPullEnd, onTap, onSwipe, onTilt, ui }) {
    this.canvas = canvas;
    this.ui = ui;
    this.callbacks = { onPullStart, onPullMove, onPullEnd, onTap, onSwipe, onTilt };

    this.active = null; // pointer state
    this.tiltZero = null;
    this.tiltEnabled = false;

    this._bindPointer();
    this._bindTilt();
  }

  _bindPointer() {
    const c = this.canvas;
    const start = (x, y, id) => {
      this.active = {
        id, x0: x, y0: y, x, y,
        t0: performance.now(),
        moved: 0,
        pulling: false,
      };
      // Don't immediately call pull; wait until movement OR delay
      this._pullTimer = setTimeout(() => {
        if (this.active && !this.active.pulling) {
          this.active.pulling = true;
          this.callbacks.onPullStart && this.callbacks.onPullStart(this.active.x0, this.active.y0);
        }
      }, 110);
    };
    const move = (x, y) => {
      if (!this.active) return;
      const dx = x - this.active.x0, dy = y - this.active.y0;
      const mag = Math.hypot(dx, dy);
      this.active.moved = Math.max(this.active.moved, mag);
      this.active.x = x; this.active.y = y;
      // If significant movement -> pull mode (immediately)
      if (!this.active.pulling && mag > 14) {
        clearTimeout(this._pullTimer);
        this.active.pulling = true;
        this.callbacks.onPullStart && this.callbacks.onPullStart(this.active.x0, this.active.y0);
      }
      if (this.active.pulling) {
        this.callbacks.onPullMove && this.callbacks.onPullMove(this.active.x0, this.active.y0, dx, dy);
      }
    };
    const end = (x, y) => {
      if (!this.active) return;
      clearTimeout(this._pullTimer);
      const dt = performance.now() - this.active.t0;
      const dx = x - this.active.x0, dy = y - this.active.y0;
      const dist = Math.hypot(dx, dy);
      const wasPulling = this.active.pulling;
      if (wasPulling && dt > 160 && dist > 14) {
        // Pull release
        this.callbacks.onPullEnd && this.callbacks.onPullEnd(this.active.x0, this.active.y0, dx, dy);
      } else if (dt < 250 && dist < 30) {
        // Tap
        this.callbacks.onTap && this.callbacks.onTap(this.active.x0, this.active.y0);
      } else if (dt < 320 && dist > 30) {
        // Swipe
        this.callbacks.onSwipe && this.callbacks.onSwipe(dx, dy);
      } else if (wasPulling) {
        // Slow drag with little distance => release as small pull
        this.callbacks.onPullEnd && this.callbacks.onPullEnd(this.active.x0, this.active.y0, dx, dy);
      } else {
        // Long press without much movement -> treat as tap
        this.callbacks.onTap && this.callbacks.onTap(this.active.x0, this.active.y0);
      }
      this.active = null;
    };

    // Pointer events (covers touch + mouse)
    c.addEventListener('pointerdown', e => {
      if (this.active) return;
      c.setPointerCapture(e.pointerId);
      start(e.clientX, e.clientY, e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!this.active || e.pointerId !== this.active.id) return;
      move(e.clientX, e.clientY);
      e.preventDefault();
    });
    const upHandler = e => {
      if (!this.active || e.pointerId !== this.active.id) return;
      end(e.clientX, e.clientY);
      e.preventDefault();
    };
    c.addEventListener('pointerup', upHandler);
    c.addEventListener('pointercancel', upHandler);
  }

  _bindTilt() {
    const handler = (e) => {
      // beta = front/back tilt (-180..180), gamma = left/right (-90..90)
      let beta = e.beta || 0;
      let gamma = e.gamma || 0;
      if (!this.tiltZero) this.tiltZero = { beta, gamma };
      const portrait = window.innerHeight > window.innerWidth;
      // For portrait, gamma = left/right; beta = forward/back
      // For landscape, swap
      let gx, gy;
      if (portrait) {
        gx = (gamma - this.tiltZero.gamma) / 25;
        gy = (beta - this.tiltZero.beta) / 25;
      } else {
        // landscape: swap depending on orientation
        const orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
        if (orient === 90) {
          gx = -(beta - this.tiltZero.beta) / 25;
          gy = (gamma - this.tiltZero.gamma) / 25;
        } else {
          gx = (beta - this.tiltZero.beta) / 25;
          gy = -(gamma - this.tiltZero.gamma) / 25;
        }
      }
      // Clamp and smooth
      gx = Math.max(-1, Math.min(1, gx));
      gy = Math.max(-1, Math.min(1, gy));
      this.callbacks.onTilt && this.callbacks.onTilt(gx, gy);
    };
    const enable = () => {
      window.addEventListener('deviceorientation', handler);
      this.tiltEnabled = true;
      // Hide perm button
      const btn = document.getElementById('tilt-perm');
      if (btn) btn.hidden = true;
    };

    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const btn = document.getElementById('tilt-perm');
      if (btn) {
        btn.hidden = false;
        btn.addEventListener('click', async () => {
          try {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res === 'granted') enable();
            else this.ui && this.ui.toast('傾け操作は無効のままです');
          } catch (e) {
            this.ui && this.ui.toast('傾け操作を有効化できませんでした');
          }
        });
      }
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      enable();
    }
  }
}
