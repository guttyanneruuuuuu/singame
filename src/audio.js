// Lightweight WebAudio sound effects (no assets)
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._unlock = this._unlock.bind(this);
    ['touchstart','touchend','mousedown','keydown','click'].forEach(ev =>
      window.addEventListener(ev, this._unlock, { once: true, passive: true })
    );
  }
  _unlock() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  }
  _now() { return this.ctx ? this.ctx.currentTime : 0; }

  beep({ freq = 440, dur = 0.1, type = 'sine', vol = 0.2, slide = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), this._now() + dur);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(vol, this._now() + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, this._now() + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this._now() + dur + 0.02);
  }
  pulse() { this.beep({ freq: 220, slide: 600, dur: 0.18, type: 'sine', vol: 0.25 }); }
  dash()  { this.beep({ freq: 700, slide: -400, dur: 0.12, type: 'triangle', vol: 0.22 }); }
  shoot() { this.beep({ freq: 350, slide: 250, dur: 0.13, type: 'square', vol: 0.18 }); }
  hit()   { this.beep({ freq: 180, slide: -120, dur: 0.16, type: 'sawtooth', vol: 0.28 }); }
  fall()  { this.beep({ freq: 400, slide: -380, dur: 0.6, type: 'sawtooth', vol: 0.25 }); }
  win()   { setTimeout(()=>this.beep({freq:523,dur:0.18,type:'triangle',vol:0.3}),0);
            setTimeout(()=>this.beep({freq:659,dur:0.18,type:'triangle',vol:0.3}),180);
            setTimeout(()=>this.beep({freq:880,dur:0.28,type:'triangle',vol:0.3}),360); }
  lose()  { this.beep({ freq: 330, slide: -200, dur: 0.5, type: 'triangle', vol: 0.25 }); }
  tick()  { this.beep({ freq: 800, dur: 0.05, type: 'square', vol: 0.1 }); }
}
