// Gravity Duel - main entry
import { Game } from './game.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { Audio } from './audio.js';

const ui = new UI();
const audio = new Audio();
const game = new Game({ canvas: document.getElementById('three-canvas'), ui, audio });
const net = new Net({ ui, game });

window.__app = { ui, game, net, audio };

// Auto join via URL hash (#join=ABC123)
const m = location.hash.match(/join=([A-Z0-9]{6})/i);
if (m) {
  ui.showScreen('join');
  document.getElementById('join-code').value = m[1].toUpperCase();
}

ui.on('start-solo', (mode) => {
  game.startMatch({ mode, multiplayer: false, players: buildBotPlayers(mode) });
});

ui.on('create-room', async (mode) => {
  const code = await net.createRoom(mode);
  ui.showRoom({ code, isHost: true, mode });
});

ui.on('join-room', async (code) => {
  try {
    const info = await net.joinRoom(code);
    ui.showRoom({ code, isHost: false, mode: info.mode });
  } catch (e) {
    ui.toast(e.message || '参加に失敗しました');
  }
});

ui.on('start-game-from-room', () => {
  const players = net.buildPlayersFromRoom();
  game.startMatch({ mode: net.mode, multiplayer: true, players });
  net.broadcastStart();
});

net.on('remote-start', (players) => {
  game.startMatch({ mode: net.mode, multiplayer: true, players });
});

ui.on('quit-game', () => {
  game.endMatch(true);
  net.leaveRoom();
  ui.showScreen('title');
});

ui.on('rematch', () => {
  game.startMatch({ mode: game.mode, multiplayer: game.multiplayer, players: game.lastPlayers });
  if (game.multiplayer) net.broadcastStart();
});

// Automated smoke test (?test=auto): start a quick 1v1 AI match and log status
if (location.search.includes('test=auto')) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      ui.showScreen('game');
      game.startMatch({ mode: '1v1', multiplayer: false, players: buildBotPlayers('1v1') });
      // Tick a synthetic tap every 1.5s
      let n = 0;
      const iv = setInterval(() => {
        if (!game.running) { clearInterval(iv); return; }
        // simulate gesture by calling internal handlers
        const w = window.innerWidth, h = window.innerHeight;
        if (n % 4 === 0) game._onTap(w/2, h/2);
        else if (n % 4 === 1) game._onSwipe(60, 0);
        else if (n % 4 === 2) game._onPullStart(w/2, h/2), game._onPullMove(w/2,h/2,0,-80), game._onPullEnd(w/2,h/2,0,-80);
        else game._onSwipe(0, 60);
        n++;
        console.log('TEST tick', n, 'kos:', game.players.map(p=>p.kos).join('/'), 'time:', game.matchTime.toFixed(1));
      }, 1500);
    }, 600);
  });
}

// Helper: build AI players for solo mode
function buildBotPlayers(mode) {
  const me = { id: 'me', name: 'あなた', isLocal: true, isBot: false, team: 0 };
  if (mode === '1v1') {
    return [me, { id: 'bot1', name: 'AI', isLocal: false, isBot: true, team: 1 }];
  }
  if (mode === 'ffa6') {
    const players = [me];
    for (let i = 1; i < 6; i++) {
      players.push({ id: 'bot' + i, name: 'AI' + i, isLocal: false, isBot: true, team: i });
    }
    return players;
  }
  if (mode === '3v3') {
    const players = [me];
    for (let i = 1; i < 3; i++) players.push({ id: 'ally' + i, name: '味方' + i, isLocal: false, isBot: true, team: 0 });
    for (let i = 0; i < 3; i++) players.push({ id: 'enemy' + i, name: '敵' + (i+1), isLocal: false, isBot: true, team: 1 });
    return players;
  }
  return [me];
}
