// UI controller (DOM screens, events, HUD updates)
export class UI {
  constructor() {
    this.listeners = {};
    this.mode = '1v1';
    this._bindTitle();
    this._bindRoom();
    this._bindJoin();
    this._bindHowTo();
    this._bindGameOverlays();
  }

  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); }
  emit(ev, ...args) { (this.listeners[ev] || []).forEach(fn => fn(...args)); }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    this.currentScreen = name;
  }

  toast(msg, ms = 1800) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  _bindTitle() {
    document.querySelectorAll('#screen-title .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#screen-title .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.mode = b.dataset.mode;
      });
    });
    document.querySelectorAll('#screen-title [data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'solo') {
          this.showScreen('game');
          this.emit('start-solo', this.mode);
        } else if (a === 'create-room') {
          this.emit('create-room', this.mode);
        } else if (a === 'join-room') {
          this.showScreen('join');
        } else if (a === 'how-to') {
          this.showScreen('howto');
        }
      });
    });
  }

  _bindRoom() {
    document.querySelectorAll('#screen-room [data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'back-title') { this.showScreen('title'); this.emit('leave-room'); }
        else if (a === 'copy-invite') {
          const code = document.getElementById('room-code').textContent;
          const url = location.origin + location.pathname + '#join=' + code;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => this.toast('招待リンクをコピーしました'));
          } else {
            this.toast('リンク: ' + url);
          }
        }
      });
    });
    document.getElementById('btn-start-game').addEventListener('click', () => {
      this.showScreen('game');
      this.emit('start-game-from-room');
    });
  }

  _bindJoin() {
    document.querySelectorAll('#screen-join [data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'back-title') this.showScreen('title');
        else if (a === 'do-join') {
          const code = document.getElementById('join-code').value.trim().toUpperCase();
          if (code.length !== 6) { this.toast('6文字のコードを入力'); return; }
          this.emit('join-room', code);
        }
      });
    });
  }

  _bindHowTo() {
    document.querySelectorAll('#screen-howto [data-action="back-title"]').forEach(b => {
      b.addEventListener('click', () => this.showScreen('title'));
    });
  }

  _bindGameOverlays() {
    document.querySelectorAll('#screen-game [data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'pause') document.getElementById('overlay-pause').classList.add('show'), this.emit('pause', true);
        else if (a === 'resume') document.getElementById('overlay-pause').classList.remove('show'), this.emit('pause', false);
        else if (a === 'quit') {
          document.getElementById('overlay-pause').classList.remove('show');
          document.getElementById('overlay-end').classList.remove('show');
          this.emit('quit-game');
        } else if (a === 'rematch') {
          document.getElementById('overlay-end').classList.remove('show');
          this.emit('rematch');
        }
      });
    });
  }

  showRoom({ code, isHost, mode }) {
    document.getElementById('room-code').textContent = code;
    document.getElementById('room-title').textContent = '部屋（' + this._modeLabel(mode) + '）';
    document.getElementById('btn-start-game').style.display = isHost ? '' : 'none';
    this.updatePlayersList([]);
    this.showScreen('room');
  }

  updatePlayersList(players) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <span class="player-dot" style="background:${p.color || '#81b29a'}"></span>
        <span class="player-name">${escapeHTML(p.name)}</span>
        ${p.isHost ? '<span class="player-tag">ホスト</span>' : ''}
        ${p.isLocal ? '<span class="player-tag">あなた</span>' : ''}
        ${p.team !== undefined && (p.modeIs3v3) ? `<span class="player-tag">Team ${p.team+1}</span>` : ''}
      `;
      list.appendChild(row);
    });
  }

  _modeLabel(m) { return { '1v1': '1v1', 'ffa6': '6人個人戦', '3v3': '3v3' }[m] || m; }

  // Game HUD
  setScores(left, right) {
    document.getElementById('score-left').innerHTML = left;
    document.getElementById('score-right').innerHTML = right;
  }
  setTimer(seconds) {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    document.getElementById('timer').textContent = `${m}:${String(s).padStart(2,'0')}`;
  }
  setCooldown(key, ratio /* 0..1, 1=ready */) {
    const el = document.getElementById('cd-' + key);
    if (!el) return;
    const bar = el.querySelector('.cd-bar i');
    bar.style.transform = `scaleX(${ratio})`;
    el.classList.toggle('ready', ratio >= 0.999);
  }
  floater(msg, ms = 900) {
    const f = document.getElementById('floater');
    f.textContent = msg;
    f.classList.add('show');
    clearTimeout(this._floatT);
    this._floatT = setTimeout(() => f.classList.remove('show'), ms);
  }
  showEnd(title, detail) {
    document.getElementById('end-title').textContent = title;
    document.getElementById('end-detail').innerHTML = detail;
    document.getElementById('overlay-end').classList.add('show');
  }
  showDragIndicator(x, y, dx, dy) {
    const el = document.getElementById('drag-indicator');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.add('show');
    const line = document.getElementById('drag-line');
    const end = document.getElementById('drag-end');
    line.setAttribute('x2', dx);
    line.setAttribute('y2', dy);
    end.setAttribute('cx', dx);
    end.setAttribute('cy', dy);
  }
  hideDragIndicator() {
    document.getElementById('drag-indicator').classList.remove('show');
  }
}

function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
