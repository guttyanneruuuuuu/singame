// Network: simple WebRTC P2P with public signaling via PeerJS cloud (free).
// Falls back gracefully if signaling is unreachable.
// PeerJS is loaded lazily to avoid blocking page load.

export class Net {
  constructor({ ui, game }) {
    this.ui = ui;
    this.game = game;
    this.listeners = {};
    this.peer = null;
    this.conns = new Map(); // peerId -> conn
    this.roomCode = null;
    this.isHost = false;
    this.mode = '1v1';
    this.players = []; // {id, name, isLocal, isHost, color, team}
    this.localName = randName();
    this._wireGameInput();
  }

  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); }
  emit(ev, ...args) { (this.listeners[ev] || []).forEach(fn => fn(...args)); }

  async _ensurePeer() {
    if (window.Peer) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      s.onload = res; s.onerror = () => rej(new Error('シグナリング読み込み失敗'));
      document.head.appendChild(s);
    });
  }

  async createRoom(mode) {
    this.mode = mode;
    this.isHost = true;
    try {
      await this._ensurePeer();
    } catch (e) {
      this.ui.toast('オフラインのためAIモードで遊んでね');
      throw e;
    }
    const code = makeCode();
    this.roomCode = code;
    const peerId = 'gd-' + code;
    this.peer = new window.Peer(peerId, { debug: 0 });
    await new Promise((res, rej) => {
      this.peer.on('open', res);
      this.peer.on('error', e => {
        if (String(e).includes('unavailable-id') || String(e).includes('is taken')) {
          // try once with random suffix
        }
        rej(e);
      });
      setTimeout(() => rej(new Error('シグナリングタイムアウト')), 8000);
    }).catch(err => {
      this.ui.toast('オンライン接続に失敗。AI戦をどうぞ');
      throw err;
    });

    this.peer.on('connection', conn => this._acceptConn(conn));
    this.players = [{
      id: this.peer.id, name: this.localName, isLocal: true, isHost: true, color: '#e07a5f', team: 0
    }];
    this._refreshRoomList();
    return code;
  }

  async joinRoom(code) {
    await this._ensurePeer();
    this.roomCode = code;
    this.isHost = false;
    const myId = 'gd-c-' + Math.random().toString(36).slice(2, 8);
    this.peer = new window.Peer(myId, { debug: 0 });
    await new Promise((res, rej) => {
      this.peer.on('open', res);
      this.peer.on('error', rej);
      setTimeout(() => rej(new Error('タイムアウト')), 8000);
    });
    const hostId = 'gd-' + code;
    const conn = this.peer.connect(hostId, { reliable: true, metadata: { name: this.localName } });
    this.players = [];
    await new Promise((res, rej) => {
      conn.on('open', res);
      conn.on('error', rej);
      setTimeout(() => rej(new Error('部屋に接続できませんでした')), 8000);
    });
    this.conns.set(hostId, conn);
    conn.on('data', d => this._onData(conn, d));
    conn.on('close', () => this._onConnClose(conn));
    // Tell host my info
    conn.send({ t: 'hello', name: this.localName });
    return { mode: this.mode };
  }

  _acceptConn(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', d => this._onData(conn, d));
      conn.on('close', () => this._onConnClose(conn));
    });
  }

  _onData(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello' && this.isHost) {
      const cap = capacityFor(this.mode);
      if (this.players.length >= cap) { conn.send({ t: 'full' }); conn.close(); return; }
      const team = this.mode === '3v3' ? (this.players.filter(p => p.team === 0).length <= this.players.filter(p => p.team === 1).length ? 0 : 1) : this.players.length;
      this.players.push({
        id: conn.peer, name: d.name || 'P', isLocal: false, isHost: false,
        color: paletteFor(this.players.length), team
      });
      this._refreshRoomList();
      this._broadcastRoom();
    } else if (d.t === 'room') {
      this.players = d.players.map(p => ({ ...p, isLocal: p.id === this.peer.id }));
      this.mode = d.mode;
      this._refreshRoomList();
    } else if (d.t === 'start') {
      this.players = d.players.map(p => ({ ...p, isLocal: p.id === this.peer.id, isBot: false }));
      this.game.setHost(false);
      this.ui.showScreen('game');
      this.emit('remote-start', this.players);
    } else if (d.t === 'input') {
      this.game.onRemoteInput(conn.peer, d);
    } else if (d.t === 'state') {
      this.game.onRemoteState(d.state);
    } else if (d.t === 'full') {
      this.ui.toast('部屋が満員です');
    }
  }

  _onConnClose(conn) {
    this.conns.delete(conn.peer);
    this.players = this.players.filter(p => p.id !== conn.peer);
    this._refreshRoomList();
    if (this.isHost) this._broadcastRoom();
  }

  _broadcastRoom() {
    const payload = { t: 'room', players: this.players, mode: this.mode };
    this.conns.forEach(c => { try { c.send(payload); } catch {} });
  }

  _refreshRoomList() {
    const list = this.players.map(p => ({ ...p, modeIs3v3: this.mode === '3v3' }));
    this.ui.updatePlayersList(list);
  }

  buildPlayersFromRoom() {
    // Fill remaining slots with bots
    const cap = capacityFor(this.mode);
    const out = this.players.map(p => ({ ...p, isBot: false }));
    let teamFor = (i) => this.mode === '3v3' ? (i % 2) : (this.mode === '1v1' ? i : i);
    for (let i = out.length; i < cap; i++) {
      out.push({ id: 'bot' + i, name: 'AI' + i, isLocal: false, isBot: true, team: teamFor(i), color: paletteFor(i) });
    }
    return out;
  }

  broadcastStart() {
    if (!this.isHost) return;
    const players = this.buildPlayersFromRoom();
    this.game.setHost(true);
    const payload = { t: 'start', players };
    this.conns.forEach(c => { try { c.send(payload); } catch {} });
  }

  leaveRoom() {
    this.conns.forEach(c => { try { c.close(); } catch {} });
    this.conns.clear();
    try { this.peer && this.peer.destroy(); } catch {}
    this.peer = null;
    this.roomCode = null;
  }

  _wireGameInput() {
    // Forward local inputs to peers
    this.game.onLocalInput = (msg) => {
      const payload = { t: 'input', ...msg };
      this.conns.forEach(c => { try { c.send(payload); } catch {} });
    };
    this.game.onHostState = (state) => {
      if (!this.isHost) return;
      const payload = { t: 'state', state };
      this.conns.forEach(c => { try { c.send(payload); } catch {} });
    };
  }
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function randName() {
  const adj = ['素早い','勇敢な','怒れる','静かな','陽気な','謎の','光る','重力の'];
  const noun = ['キツネ','クマ','タカ','ネコ','ウサギ','イノシシ','カラス','イルカ'];
  return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)];
}
function paletteFor(i) {
  const cols = ['#e07a5f','#3d5a80','#81b29a','#f2cc8f','#bb6588','#5da4d9'];
  return cols[i % cols.length];
}
function capacityFor(mode) { return mode === '1v1' ? 2 : mode === 'ffa6' ? 6 : 6; }
