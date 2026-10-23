import { Chess } from './vendor/chess.js';
import * as D from './describe.js';
import { Signer, NostrGame, DEFAULT_RELAYS } from './nostr-game.js';

const $ = (id) => document.getElementById(id);
const store = (() => { try { localStorage.setItem('bc.t', '1'); return localStorage; } catch { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; } })();
const VS = '\uFE0E'; // text presentation, so iOS doesn't draw the pawn as an emoji
const GLYPH = { w: { k: '♔' + VS, q: '♕' + VS, r: '♖' + VS, b: '♗' + VS, n: '♘' + VS, p: '♙' + VS }, b: { k: '♚' + VS, q: '♛' + VS, r: '♜' + VS, b: '♝' + VS, n: '♞' + VS, p: '♟' + VS } };
const settings = Object.assign({ voice: 'sr', rate: 1.1, sounds: true, haptics: true, promote: 'q', level: '2' }, JSON.parse(store.getItem('blindchess.settings') || '{}'));

const S = {
  mode: 'none', // none | solo | local | nostr
  chess: new Chess(),
  me: 'w',
  selected: null,
  focus: 'e2',
  lastSaid: '',
  thinking: false,
  over: false,
  game: null, // NostrGame
  spectator: false,
  resigned: null,
};

// ---------------- Sound ----------------
const Sound = {
  ctx: null, buffers: {}, loading: null,
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.load();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  load() {
    if (this.loading) return this.loading;
    const names = ['move', 'capture', 'check', 'turn', 'error', 'start', 'end', 'select'];
    this.loading = Promise.all(names.map(async (n) => {
      try {
        const res = await fetch(`sounds/${n}.mp3`);
        const arr = await res.arrayBuffer();
        this.buffers[n] = await new Promise((ok, bad) => this.ctx.decodeAudioData(arr, ok, bad));
      } catch { /* falls back to a tone */ }
    }));
    return this.loading;
  },
  tone(freqs, dur = 0.12, type = 'sine', at = 0) {
    const c = this.ctx; if (!c) return;
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      const t = c.currentTime + at + i * dur;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  },
  play(name, delay = 0) {
    if (!settings.sounds) return;
    this.unlock();
    const c = this.ctx; if (!c) return;
    const b = this.buffers[name];
    if (b) {
      const src = c.createBufferSource(), g = c.createGain();
      g.gain.value = name === 'select' ? 0.5 : 0.9;
      src.buffer = b; src.connect(g).connect(c.destination); src.start(c.currentTime + delay);
      if (name === 'check') this.tone([880, 660], 0.09, 'triangle', delay + 0.12);
      return;
    }
    const fall = { move: [[440], 0.08], capture: [[300, 200], 0.08, 'square'], check: [[880, 660, 880], 0.1, 'triangle'], turn: [[523, 659, 784], 0.09], error: [[200, 150], 0.12, 'sawtooth'], start: [[392, 523], 0.1], end: [[784, 659, 523, 392], 0.15], select: [[660], 0.04] };
    const [f, d, t] = fall[name] || [[440], 0.1];
    this.tone(f, d, t || 'sine', delay);
  },
};
['pointerdown', 'keydown', 'touchend'].forEach((ev) => document.addEventListener(ev, () => Sound.unlock(), { capture: true }));

// ---------------- Speech ----------------
function speakable(text) {
  // Help built-in voices read squares as letters: "e4" -> "E 4".
  return text.replace(/\b([a-h])([1-8])\b/g, (m, f, r) => `${f.toUpperCase()} ${r}`).replace(/\bO-O-O\b/g, 'castle queenside').replace(/\bO-O\b/g, 'castle kingside');
}
function announce(text, { queue = false } = {}) {
  if (!text) return;
  S.lastSaid = text;
  $('last-said').textContent = text;
  if (settings.voice === 'tts' && 'speechSynthesis' in window) {
    if (!queue) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.rate = Number(settings.rate) || 1;
    u.lang = 'en-US';
    speechSynthesis.speak(u);
    return;
  }
  const region = $('announcer');
  const p = document.createElement('p');
  p.textContent = text;
  region.appendChild(p);
  while (region.childNodes.length > 3) region.removeChild(region.firstChild);
  setTimeout(() => { if (p.parentNode === region && region.lastChild !== p) p.remove(); }, 15000);
}
function buzz(pattern) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} } }

// ---------------- Board ----------------
const boardEl = $('board');
let squareEls = {};
let builtFor = null;
function buildBoard() {
  const flip = S.me === 'b';
  if (builtFor === flip) return;
  builtFor = flip;
  boardEl.textContent = '';
  squareEls = {};
  boardEl.setAttribute('aria-label', `Chess board, seen from ${flip ? "Black's" : "White's"} side`);
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flip ? D.FILES.slice().reverse() : D.FILES;
  ranks.forEach((r, ri) => {
    const row = document.createElement('div');
    row.className = 'rank';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Rank ${r}`);
    files.forEach((f, fi) => {
      const sq = f + r;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq ' + ((D.FILES.indexOf(f) + r) % 2 === 1 ? 'light' : 'dark');
      b.dataset.sq = sq;
      b.dataset.row = ri; b.dataset.col = fi;
      b.tabIndex = -1;
      const g = document.createElement('span'); g.setAttribute('aria-hidden', 'true'); g.className = 'glyph';
      b.appendChild(g);
      if (fi === 0 || ri === 7) b.dataset.coord = (ri === 7 ? f : '') + (fi === 0 ? r : '');
      row.appendChild(b);
      squareEls[sq] = b;
    });
    boardEl.appendChild(row);
  });
}
function renderBoard() {
  buildBoard();
  const targets = new Map();
  if (S.selected) for (const m of S.chess.moves({ square: S.selected, verbose: true })) targets.set(m.to, m);
  const hist = S.chess.history({ verbose: true });
  const last = hist[hist.length - 1];
  for (const [sq, b] of Object.entries(squareEls)) {
    const p = S.chess.get(sq);
    const g = b.querySelector('.glyph');
    g.textContent = p ? GLYPH[p.color][p.type] : '';
    g.className = 'glyph ' + (p ? 'pc-' + p.color : '');
    let label = `${sq}, ${D.pieceLabel(p)}`;
    if (S.selected === sq) label += ', selected';
    const t = targets.get(sq);
    if (t) label += t.captured ? ', can capture' : ', can move here';
    b.setAttribute('aria-label', label);
    b.classList.toggle('sel', S.selected === sq);
    b.classList.toggle('target', !!t);
    b.classList.toggle('last', !!last && (last.from === sq || last.to === sq));
    b.tabIndex = sq === S.focus ? 0 : -1;
  }
}
function focusSquare(sq) {
  S.focus = sq;
  for (const [s, b] of Object.entries(squareEls)) b.tabIndex = s === sq ? 0 : -1;
  squareEls[sq] && squareEls[sq].focus();
}

// ---------------- Game state helpers ----------------
function myTurn() {
  if (S.over || S.thinking) return false;
  if (S.mode === 'local') return true;
  if (S.mode === 'solo') return S.chess.turn() === S.me;
  if (S.mode === 'nostr') return !S.spectator && S.chess.turn() === S.me;
  return false;
}
function sideName(c) { return D.COLOR_NAMES[c]; }
function opponentName() { return S.mode === 'solo' ? 'The computer' : S.mode === 'nostr' ? 'Your friend' : sideName(D.other(S.me)); }

function statusText() {
  if (S.mode === 'none') return 'No game yet. Pick a way to play below.';
  const c = S.chess;
  const moveNo = Math.floor(c.history().length / 2) + 1;
  if (S.resigned) return `${sideName(S.resigned)} resigned. ${sideName(D.other(S.resigned))} wins.`;
  if (c.isGameOver()) return D.gameOverText(c);
  const check = c.inCheck() ? ` ${sideName(c.turn())} is in check.` : '';
  if (S.mode === 'local') return `Pass and play. ${sideName(c.turn())} to move. Move ${moveNo}.${check}`;
  if (S.mode === 'nostr' && S.spectator) return `Watching. ${sideName(c.turn())} to move. Move ${moveNo}.${check}`;
  const you = `You are ${sideName(S.me)}.`;
  if (S.mode === 'nostr' && S.game && S.game.state) {
    const seats = S.game.state.seats;
    if (!seats[D.other(S.me)]) return `${you} Waiting for your friend to open the invite link.${c.turn() === S.me ? ' You can move first.' : ''}`;
  }
  if (S.thinking) return `${you} The computer is thinking.`;
  if (c.turn() === S.me) return `${you} Your turn. Move ${moveNo}.${check}`;
  return `${you} ${opponentName()}'s turn. Move ${moveNo}.${check}`;
}
function render() {
  renderBoard();
  $('status').textContent = statusText();
  const hist = S.chess.history({ verbose: true });
  const ol = $('history');
  ol.textContent = '';
  for (let i = 0; i < hist.length; i += 2) {
    const li = document.createElement('li');
    li.textContent = D.describeMove(hist[i]) + (hist[i + 1] ? ' ' + D.describeMove(hist[i + 1]) : '');
    ol.appendChild(li);
  }
  $('history-empty').hidden = hist.length > 0;
  $('undo').disabled = !(S.mode === 'solo' || S.mode === 'local') || hist.length === 0 || S.over || S.thinking;
  $('resign').disabled = S.mode === 'none' || S.over || S.spectator;
  save();
}
function save() {
  if (S.mode === 'solo' || S.mode === 'local') store.setItem('blindchess.save', JSON.stringify({ mode: S.mode, me: S.me, level: settings.level, history: S.chess.history(), over: S.over, resigned: S.resigned }));
}
function checkGameOver() {
  if (S.resigned) { S.over = true; return `${sideName(S.resigned)} resigned. ${sideName(D.other(S.resigned))} wins.`; }
  if (S.chess.isGameOver()) { S.over = true; return D.gameOverText(S.chess); }
  return '';
}
function clone(c) { const n = new Chess(); for (const m of c.history()) n.move(m); return n; }

// Announce a move with its sounds. `who` is 'me' or 'them'.
function announceMove(mv, who) {
  const capture = !!mv.captured;
  Sound.play(capture ? 'capture' : 'move');
  if (mv.san.includes('+') || mv.san.includes('#')) Sound.play('check', 0.25);
  let text = D.describeMove(mv);
  const end = checkGameOver();
  if (end) {
    if (!mv.san.includes('#')) text += ' ' + end;
    else text += ' ' + end.replace(/^Checkmate\. /, '');
    Sound.play('end', 0.6);
  } else if (who === 'them' || S.mode === 'local') {
    if (S.mode === 'local') text += ` ${sideName(S.chess.turn())} to move.`;
    else { text += ' Your turn.'; Sound.play('turn', 0.45); buzz([60, 60, 60]); }
  }
  announce(text, { queue: who === 'them' });
  render();
}

// ---------------- Moves ----------------
async function playMove(moveObj) {
  if (!myTurn()) { Sound.play('error'); announce(notYourTurnText()); return false; }
  let mv;
  try { mv = S.chess.move({ from: moveObj.from, to: moveObj.to, promotion: moveObj.promotion || settings.promote }); } catch { mv = null; }
  if (!mv) { Sound.play('error'); announce('That move is not legal.'); return false; }
  S.selected = null;
  if (S.mode === 'nostr') {
    render();
    announceMove(mv, 'me');
    try {
      await S.game.sendMove(S.chess);
    } catch (e) {
      Sound.play('error');
      announce("Your move didn't reach any relay. Check your connection, then type resend.", { queue: true });
      S.pendingResend = true;
    }
    return true;
  }
  render();
  announceMove(mv, 'me');
  if (S.mode === 'solo' && !S.over) botMove(mv.san.length * 70 + 1600);
  return true;
}
function notYourTurnText() {
  if (S.mode === 'none') return 'Start a game first. The New game section has the options.';
  if (S.over) return 'The game is over. Start a new game below.';
  if (S.spectator) return "You're watching this game, so you can't move.";
  if (S.thinking) return 'The computer is still thinking.';
  return `It's ${opponentName().toLowerCase()}'s turn, not yours.`;
}

let worker = null;
function getWorker() {
  if (worker !== null) return worker;
  try { worker = new Worker(new URL('./bot.js', import.meta.url), { type: 'module' }); }
  catch { worker = false; }
  return worker;
}
let botReq = 0;
async function botMove(minDelay = 900) {
  S.thinking = true; render();
  const id = ++botReq;
  const started = Date.now();
  const level = Number(settings.level) || 2;
  const fen = S.chess.fen();
  let result;
  const w = getWorker();
  if (w) {
    result = await new Promise((resolve) => {
      const onMsg = (e) => { if (e.data.id === id) { w.removeEventListener('message', onMsg); resolve(e.data.move); } };
      w.addEventListener('message', onMsg);
      w.postMessage({ id, fen, level, timeMs: 2500 });
    });
  } else {
    const { bestMove } = await import('./bot.js');
    await new Promise((r) => setTimeout(r, 30));
    result = bestMove(fen, level, 2000);
  }
  const wait = Math.max(0, minDelay - (Date.now() - started));
  await new Promise((r) => setTimeout(r, wait));
  if (id !== botReq || S.mode !== 'solo') return;
  S.thinking = false;
  if (!result) { render(); return; }
  const mv = S.chess.move({ from: result.from, to: result.to, promotion: result.promotion });
  render();
  announceMove(mv, 'them');
}

// ---------------- Commands ----------------
function runCommand(raw) {
  const t = raw.toLowerCase().replace(/[’']/g, "'").replace(/[.!,]/g, '').replace(/\s+/g, ' ').trim();
  const c = S.chess;
  const me = S.mode === 'local' ? c.turn() : S.me;
  const them = D.other(me);
  const colorWord = (w) => (w === 'white' ? 'w' : w === 'black' ? 'b' : null);
  let m;
  if (/^(help|\?|commands|what can i (say|type|do))$/.test(t)) return 'Type a move like e4, Nf3, knight to f3 or e2 e4. Or a command: my pieces, their pieces, where is my queen, what\'s on e5, moves from g1, legal moves, last move, history, status, threats, material, read board, repeat, undo, resign. The Help section has the full list.';
  if (/^(repeat|again|say (that )?again|what\?)$/.test(t)) return S.lastSaid || 'Nothing to repeat yet.';
  if (S.mode === 'none' && !/^(new game)$/.test(t)) {
    if (/pieces|on [a-h][1-8]|last move|status|turn|threat|material|board|moves/.test(t)) return 'No game yet. Start one in the New game section.';
  }
  if ((m = t.match(/^(?:where (?:are|is) )?(white|black)(?:'s)? pieces$|^(white|black)$/))) {
    const col = colorWord(m[1] || m[2]);
    return D.describePieces(c, col, `${sideName(col)} has`);
  }
  if (/^(?:where (?:are|is) )?(?:my|mine|all my)(?: own)? pieces$|^(?:my )?pieces$|^where am i$/.test(t)) return D.describePieces(c, me, S.mode === 'local' ? `${sideName(me)} has` : 'You have');
  if (/^(?:where (?:are|is) )?(?:their|the opponent'?s?|opponent'?s?|enemy|the other|his|her|the computer'?s?|computer'?s?|my friend'?s?|friend'?s?)(?: side'?s?)? pieces$/.test(t)) return D.describePieces(c, them, S.mode === 'solo' ? 'The computer has' : S.mode === 'nostr' ? 'Your friend has' : `${sideName(them)} has`);
  if ((m = t.match(/^(?:where(?:'s| is| are)) ?(my|their|the|his|her|white'?s?|black'?s?|opponent'?s?|the computer'?s?)? ?(king|queen|rooks?|bishops?|knights?|horses?|pawns?)s?\??$/))) {
    const who = m[1] || 'my';
    const type = D.findPieceType(m[2]);
    let col = me;
    if (/their|opponent|computer|his|her/.test(who)) col = them;
    if (/^white/.test(who)) col = 'w';
    if (/^black/.test(who)) col = 'b';
    const label = col === me && !/^(white|black)/.test(who) ? (S.mode === 'local' ? `${sideName(col)}'s` : 'Your') : col === them && S.mode !== 'local' && !/^(white|black)/.test(who) ? 'Their' : `${sideName(col)}'s`;
    return D.describeWhere(c, col, type, label).replace(/^(Your|Their|White's|Black's) no /, (x, a) => `${a === 'Your' ? 'You have' : a === 'Their' ? 'They have' : a.replace("'s", ' has')} no `);
  }
  if ((m = t.match(/(?:what'?s|whats|what is|who'?s|whos|who is|look|inspect|check|square|describe|tell me about)\s*(?:on|at|in)?\s*([a-h][1-8])\??$/)) || (m = t.match(/^([a-h][1-8])\s*\?$/))) return D.describeSquare(c, m[1]);
  if ((m = t.match(/^(?:moves?|where can|options)\s*(?:from|for|of)?\s*(?:the )?(?:piece )?(?:on )?([a-h][1-8])(?: go)?\??$/))) return D.describeMovesFrom(c, m[1]);
  if ((m = t.match(/^(?:moves?|where can)\s*(?:for|of)?\s*(?:my|the)?\s*(king|queen|rooks?|bishops?|knights?|pawns?)(?: go)?\??$/))) {
    const type = D.findPieceType(m[1]);
    const sqs = D.piecesOf(c, c.turn())[type];
    if (!sqs.length) return `No ${D.PLURAL[type]} left.`;
    return sqs.map((s) => D.describeMovesFrom(c, s)).join(' ');
  }
  if (/^(legal moves|all moves|all my moves|my moves|moves|options|what can i play|all my legal moves)$/.test(t)) {
    if (S.mode !== 'local' && c.turn() !== me) return `It's not your turn, so you have no moves right now.`;
    return D.describeAllMoves(c);
  }
  if (/^(last move|what did (they|he|she|it|the computer|my friend) (play|do|move)|their move|last)\??$/.test(t)) {
    const h = c.history({ verbose: true });
    return h.length ? `Last move: ${D.describeMove(h[h.length - 1])}` : 'No moves yet.';
  }
  if (/^(history|moves so far|move list|game history|all moves so far|pgn)$/.test(t)) return t === 'pgn' ? (c.pgn() || 'No moves yet.') : D.describeHistory(c);
  if (/^(status|whose turn|who'?s turn|whos turn|turn|is it my turn|who moves)\??$/.test(t)) return statusText();
  if (/threat|attacked|hanging|danger|safe/.test(t)) {
    const mine = D.describeThreats(c, me, S.mode === 'local' ? `${sideName(me)}'s` : 'your');
    const theirs = D.describeThreats(c, them, S.mode === 'local' ? `${sideName(them)}'s` : 'their');
    return `${mine} ${theirs}`;
  }
  if (/^(material|score|points|who'?s winning|count)\??$/.test(t)) return D.describeMaterial(c, me);
  if (/^((read|describe|whole|full)( the)?( whole)? board|board)$/.test(t)) return D.describeBoard(c, S.me);
  if (/^fen$/.test(t)) return c.fen();
  if (/^(undo|take ?back|takeback)$/.test(t)) { undo(); return null; }
  if (/^resign$/.test(t)) { resign(); return null; }
  if (/^resend$/.test(t)) { resend(); return null; }
  if (/^new game$/.test(t)) { $('play-heading').tabIndex = -1; $('play-heading').focus(); return 'New game options. Play the computer, invite a friend, or pass and play.'; }
  return undefined; // not a command
}

function handleInput(value) {
  const v = value.trim();
  if (!v) { announce('Type a move or a command first.'); return; }
  const out = runCommand(v);
  if (out === null) return true;
  if (typeof out === 'string') { announce(out); return true; }
  if (S.mode === 'none') { Sound.play('error'); announce('Start a game first. Play the computer, invite a friend, or pass and play, in the New game section.'); return false; }
  if (!myTurn()) { Sound.play('error'); announce(notYourTurnText()); return false; }
  const r = D.resolveMove(S.chess, v, settings.promote);
  if (r.move) { playMove(r.move); return true; }
  Sound.play('error');
  announce(r.error);
  return false;
}

$('move-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('move-input');
  const ok = handleInput(input.value);
  if (ok) input.value = '';
  input.focus();
});
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => handleInput(b.dataset.cmd)));
document.querySelectorAll('[data-sound]').forEach((b) => b.addEventListener('click', () => { Sound.unlock(); Sound.load().then(() => Sound.play(b.dataset.sound)); }));

// ---------------- Board interaction ----------------
function clickSquare(sq) {
  S.focus = sq;
  const c = S.chess;
  const p = c.get(sq);
  if (S.mode === 'none') { announce(`${D.describeSquare(c, sq)} Start a game to move pieces.`); return; }
  if (S.selected) {
    if (S.selected === sq) { S.selected = null; renderBoard(); announce('Put back.'); return; }
    const moves = c.moves({ square: S.selected, verbose: true }).filter((m) => m.to === sq);
    if (moves.length) { playMove(moves.find((m) => !m.promotion || m.promotion === settings.promote) || moves[0]); return; }
    if (p && p.color === c.turn()) { selectSquare(sq); return; }
    Sound.play('error');
    const sp = c.get(S.selected);
    announce(`The ${D.PIECE_NAMES[sp.type]} on ${S.selected} can't go to ${sq}. ${D.describeMovesFrom(c, S.selected)}`);
    return;
  }
  if (p && myTurn() && p.color === c.turn()) { selectSquare(sq); return; }
  let text = D.describeSquare(c, sq);
  if (p && !myTurn() && !S.over && p.color === S.me) text += ` ${notYourTurnText()}`;
  announce(text);
}
function selectSquare(sq) {
  const c = S.chess;
  const moves = c.moves({ square: sq, verbose: true });
  if (!moves.length) { Sound.play('error'); announce(`The ${D.pieceLabel(c.get(sq))} on ${sq} has no legal moves.`); return; }
  S.selected = sq;
  Sound.play('select');
  renderBoard();
  announce(`Picked up. ${D.describeMovesFrom(c, sq)}`);
}
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (b) clickSquare(b.dataset.sq);
});
boardEl.addEventListener('keydown', (e) => {
  const b = e.target.closest('.sq');
  if (!b) return;
  const row = Number(b.dataset.row), col = Number(b.dataset.col);
  const at = (r, cc) => boardEl.querySelector(`.sq[data-row="${r}"][data-col="${cc}"]`);
  let next = null;
  switch (e.key) {
    case 'ArrowUp': next = at(Math.max(0, row - 1), col); break;
    case 'ArrowDown': next = at(Math.min(7, row + 1), col); break;
    case 'ArrowLeft': next = at(row, Math.max(0, col - 1)); break;
    case 'ArrowRight': next = at(row, Math.min(7, col + 1)); break;
    case 'Home': next = at(row, 0); break;
    case 'End': next = at(row, 7); break;
    case 'Escape': if (S.selected) { S.selected = null; renderBoard(); announce('Put back.'); } e.preventDefault(); return;
    case '?': announce(D.describeSquare(S.chess, b.dataset.sq)); e.preventDefault(); return;
    case 'm': case 'M': announce(D.describeMovesFrom(S.chess, b.dataset.sq)); e.preventDefault(); return;
    case 'p': case 'P': handleInput('my pieces'); e.preventDefault(); return;
    case 'o': case 'O': handleInput('their pieces'); e.preventDefault(); return;
    case 'l': case 'L': handleInput('last move'); e.preventDefault(); return;
    case 't': case 'T': handleInput('status'); e.preventDefault(); return;
    case '/': $('move-input').focus(); e.preventDefault(); return;
    default: return;
  }
  e.preventDefault();
  if (next) focusSquare(next.dataset.sq);
});

// ---------------- Game modes ----------------
function resetCommon(mode, me) {
  if (S.game) { S.game.close(); S.game = null; }
  botReq++;
  S.mode = mode; S.me = me; S.chess = new Chess(); S.selected = null; S.thinking = false; S.over = false; S.resigned = null; S.spectator = false; S.pendingResend = false;
  S.focus = me === 'b' ? 'e7' : 'e2';
  $('invite').hidden = true;
  if (mode !== 'nostr' && location.hash) history.replaceState(null, '', location.pathname + location.search);
}
function startSolo(me) {
  resetCommon('solo', me);
  const lvl = $('level').selectedOptions[0].textContent;
  render();
  Sound.play('start');
  $('move-input').focus();
  if (me === 'w') announce(`New game against the computer, ${lvl}. You are White. Your turn. Type a move or use the board.`);
  else { announce(`New game against the computer, ${lvl}. You are Black. The computer moves first.`); botMove(2600); }
}
function startLocal() {
  resetCommon('local', 'w');
  render();
  Sound.play('start');
  $('move-input').focus();
  announce('Pass and play on this device. White moves first.');
}
function undo() {
  if (S.mode === 'nostr') { announce("You can't take back moves in an online game."); return; }
  if (S.mode === 'none' || S.over) { announce('Nothing to take back.'); return; }
  if (S.thinking) { announce('Wait for the computer to finish its move.'); return; }
  const c = S.chess;
  if (!c.history().length) { announce('No moves to take back.'); return; }
  if (S.mode === 'solo') {
    if (c.turn() === S.me && c.history().length >= 2) { c.undo(); c.undo(); }
    else if (c.turn() !== S.me) c.undo();
    else { announce('No move of yours to take back.'); return; }
  } else c.undo();
  S.selected = null;
  render();
  announce(`Took back. ${statusText()}`);
}
async function resign() {
  if (S.mode === 'none' || S.over || S.spectator) { announce('There is no game to resign.'); return; }
  if (!window.confirm('Resign this game?')) return;
  const loser = S.mode === 'local' ? S.chess.turn() : S.me;
  S.resigned = loser; S.over = true;
  if (S.mode === 'nostr' && S.game) { try { await S.game.resign(); } catch {} }
  render();
  Sound.play('end');
  announce(`${sideName(loser)} resigned. ${sideName(D.other(loser))} wins.`);
}
async function resend() {
  if (S.mode !== 'nostr' || !S.game) { announce('Nothing to resend.'); return; }
  const evs = [...S.game.events.values()].filter((e) => e.pubkey === S.game.signer.pubkey);
  let ok = 0;
  for (const e of evs) { try { await S.game.publish(e); ok++; } catch {} }
  announce(ok ? 'Sent again.' : "Still can't reach the relays.");
}

// ---------------- Nostr ----------------
let signer = null;
function getSigner() {
  if (!globalThis.NostrTools) throw new Error('The Nostr library did not load.');
  if (!signer) signer = new Signer(store);
  return signer;
}
function relays() {
  const saved = JSON.parse(store.getItem('blindchess.relays') || 'null');
  return Array.isArray(saved) && saved.length ? saved : DEFAULT_RELAYS.slice();
}
function shortNpub(n) { return n.slice(0, 12) + '…' + n.slice(-6); }
function showIdentity() {
  try {
    const s = getSigner();
    const how = s.mode === 'temp' ? 'a temporary key made in this browser' : s.mode === 'extension' ? 'your Nostr signer extension' : 'the key you pasted';
    $('identity').textContent = `You play with ${how}: ${shortNpub(s.npub())}.`;
  } catch (e) { $('identity').textContent = e.message; }
}
function onNostrUpdate(state, prev) {
  if (!S.game) return;
  const g = S.game;
  const mine = g.myColor();
  const before = prev ? prev.applied.length : 0;
  S.chess = clone(state.chess);
  if (typeof mine === 'string') { S.me = mine; S.spectator = false; }
  const fresh = state.applied.slice(before);
  if (prev) {
    if (!prev.seats[D.other(S.me)] && state.seats[D.other(S.me)] && state.seats[D.other(S.me)] !== g.signer.pubkey && !S.spectator) {
      Sound.play('start');
      announce(`Your friend joined. They play ${sideName(D.other(S.me))}.${S.chess.turn() === S.me ? ' Your turn.' : ''}`, { queue: true });
    }
    for (const a of fresh) {
      if (a.event.pubkey === g.signer.pubkey) continue;
      render();
      if (S.spectator) { Sound.play(a.move.captured ? 'capture' : 'move'); announce(D.describeMove(a.move), { queue: true }); }
      else announceMove(a.move, 'them');
    }
    if (state.resigned && !prev.resigned) {
      S.resigned = state.resigned; S.over = true;
      Sound.play('end');
      announce(state.resigned === S.me ? 'You resigned.' : `${sideName(state.resigned)} resigned. ${S.spectator ? sideName(D.other(state.resigned)) + ' wins.' : 'You win!'}`, { queue: true });
    }
  }
  S.resigned = state.resigned; 
  S.over = !!state.resigned || S.chess.isGameOver();
  render();
}
async function startNostr(color) {
  resetCommon('nostr', color);
  render();
  announce('Making your invite link. One moment.');
  try {
    const g = new NostrGame({ signer: getSigner(), relays: relays(), onUpdate: onNostrUpdate });
    S.game = g;
    const ok = await g.create(color);
    const base = location.origin + location.pathname;
    const link = g.link(base);
    history.replaceState(null, '', '#' + link.split('#')[1]);
    $('invite-link').value = link;
    $('invite').hidden = false;
    $('share-link').hidden = !navigator.share;
    Sound.play('start');
    render();
    $('copy-link').focus();
    announce(`Invite link ready, saved on ${ok} ${ok === 1 ? 'relay' : 'relays'}. Copy or share it with your friend. You are ${sideName(color)}.${color === 'w' ? ' You can move first, or wait for them.' : ' Your friend moves first.'}`);
  } catch (e) {
    Sound.play('error');
    S.mode = 'none'; render();
    announce(`Couldn't make the invite: ${e.message || e}`);
  }
}
async function openFromLink() {
  if (!globalThis.NostrTools) return false;
  const link = NostrGame.parseLink(location.hash);
  if (!link) return false;
  resetCommon('nostr', 'b');
  $('status').textContent = 'Opening the game from your invite link…';
  announce('Opening the game from your invite link.');
  try {
    const g = new NostrGame({ signer: getSigner(), relays: relays(), onUpdate: onNostrUpdate });
    S.game = g;
    await g.open(link.id, link.relays);
    const mine = g.myColor();
    if (typeof mine === 'string') {
      S.me = mine; builtFor = null; render();
      $('invite-link').value = location.href; $('invite').hidden = false; $('share-link').hidden = !navigator.share;
      announce(`Back in your game. ${statusText()}`);
    } else if (mine && mine.open) {
      S.me = mine.open; builtFor = null;
      await g.join();
      render();
      Sound.play('start');
      announce(`You joined the game. You play ${sideName(S.me)}. ${S.chess.turn() === S.me ? 'Your turn.' : "Your friend's turn."}`);
    } else {
      S.spectator = true; S.me = 'w'; builtFor = null; render();
      announce("Both seats in this game are taken, so you're watching. Moves will be read out as they happen.");
    }
    return true;
  } catch (e) {
    Sound.play('error');
    S.mode = 'none'; render();
    announce(e.message || String(e));
    return true;
  }
}

// ---------------- Wiring ----------------
$('solo-white').addEventListener('click', () => startSolo('w'));
$('solo-black').addEventListener('click', () => startSolo('b'));
$('local-game').addEventListener('click', startLocal);
$('nostr-white').addEventListener('click', () => startNostr('w'));
$('nostr-black').addEventListener('click', () => startNostr('b'));
$('undo').addEventListener('click', undo);
$('resign').addEventListener('click', resign);
$('copy-link').addEventListener('click', async () => {
  const v = $('invite-link').value;
  try { await navigator.clipboard.writeText(v); announce('Invite link copied.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); announce('Copy did not work here. The link is selected in the text box, so you can copy it yourself.'); }
});
$('share-link').addEventListener('click', async () => {
  try { await navigator.share({ title: 'Blind Chess', text: "Let's play chess. Open this link to join my game:", url: $('invite-link').value }); } catch {}
});
$('level').value = settings.level;
$('level').addEventListener('change', () => { settings.level = $('level').value; saveSettings(); });
function saveSettings() { store.setItem('blindchess.settings', JSON.stringify(settings)); }
document.querySelectorAll('input[name=voice]').forEach((r) => {
  r.checked = r.value === settings.voice;
  r.addEventListener('change', () => { settings.voice = r.value; saveSettings(); $('rate-row').hidden = settings.voice !== 'tts'; announce(settings.voice === 'tts' ? 'The built-in voice will read announcements.' : 'Your screen reader will read announcements.'); });
});
if (!('speechSynthesis' in window)) { $('voice-tts').disabled = true; }
$('rate-row').hidden = settings.voice !== 'tts';
$('rate').value = settings.rate; $('rate-out').textContent = settings.rate;
$('rate').addEventListener('input', () => { settings.rate = Number($('rate').value); $('rate-out').textContent = settings.rate; saveSettings(); });
$('rate').addEventListener('change', () => announce('This is the new speed.'));
$('sounds').checked = settings.sounds; $('sounds').addEventListener('change', () => { settings.sounds = $('sounds').checked; saveSettings(); });
$('haptics').checked = settings.haptics; $('haptics').addEventListener('change', () => { settings.haptics = $('haptics').checked; saveSettings(); });
if (!navigator.vibrate) $('haptics').closest('.check').hidden = true;
$('promote').value = settings.promote; $('promote').addEventListener('change', () => { settings.promote = $('promote').value; saveSettings(); });
$('relays').value = relays().join('\n');
$('save-relays').addEventListener('click', () => {
  const list = $('relays').value.split(/\s+/).map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s));
  if (!list.length) { store.removeItem('blindchess.relays'); $('relays').value = DEFAULT_RELAYS.join('\n'); announce('Back to the default relays.'); return; }
  store.setItem('blindchess.relays', JSON.stringify(list)); announce(`Saved ${list.length} relays. They apply to your next game.`);
});
$('use-extension').addEventListener('click', async () => {
  try { await getSigner().useExtension(); showIdentity(); announce('Using your Nostr signer extension.'); }
  catch (e) { announce(e.message); }
});
$('use-nsec').addEventListener('click', () => {
  try { getSigner().useNsec($('nsec').value); $('nsec').value = ''; showIdentity(); announce('Using your key for this tab.'); }
  catch (e) { announce(e.message || 'That key did not work.'); }
});
$('use-temp').addEventListener('click', () => { try { getSigner().useTemp(); showIdentity(); announce('Back to the temporary key.'); } catch (e) { announce(e.message); } });
window.addEventListener('hashchange', () => { if (NostrGame.parseLink(location.hash) && (!S.game || location.hash.indexOf(S.game.start?.id || '~') < 0)) openFromLink(); });

// ---------------- Boot ----------------
(async function boot() {
  showIdentity();
  if (await openFromLink()) return;
  const saved = JSON.parse(store.getItem('blindchess.save') || 'null');
  if (saved && saved.history && (saved.mode === 'solo' || saved.mode === 'local') && !saved.over) {
    S.mode = saved.mode; S.me = saved.me || 'w';
    try { for (const m of saved.history) S.chess.move(m); } catch { S.chess = new Chess(); }
    S.focus = S.me === 'b' ? 'e7' : 'e2';
    render();
    $('status').textContent = 'Welcome back, your game is restored. ' + statusText();
    if (S.mode === 'solo' && S.chess.turn() !== S.me && !S.chess.isGameOver()) botMove(1500);
    return;
  }
  render();
})();

// For the smoke test.
window.__blindchess = { S, handleInput, clickSquare };
