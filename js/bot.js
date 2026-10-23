// Built-in opponent: a small alpha-beta search over chess.js.
// Runs in a Web Worker so the page (and VoiceOver) never freezes.
import { Chess } from './vendor/chess.js';

const V = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Simple piece-square tables from White's side, a8 first (row 0 = rank 8).
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

function evaluate(chess) {
  // Score from the side to move's point of view.
  let s = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const c = board[r][f];
      if (!c) continue;
      const idx = c.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const v = V[c.type] + PST[c.type][idx];
      s += c.color === 'w' ? v : -v;
    }
  }
  return chess.turn() === 'w' ? s : -s;
}

function ordered(moves) {
  return moves.sort((a, b) => score(b) - score(a));
  function score(m) {
    let s = 0;
    if (m.captured) s += 10 * V[m.captured] - V[m.piece];
    if (m.promotion) s += 800;
    if (m.san.includes('+')) s += 50;
    return s;
  }
}

let nodes = 0, deadline = 0, stopped = false;
const MATE = 100000;

function quiesce(chess, alpha, beta, depth) {
  const stand = evaluate(chess);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth <= 0) return alpha;
  const caps = ordered(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));
  for (const m of caps) {
    chess.move(m);
    const sc = -quiesce(chess, -beta, -alpha, depth - 1);
    chess.undo();
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function search(chess, depth, alpha, beta, ply, qdepth) {
  nodes++;
  if ((nodes & 255) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return 0;
  if (chess.isCheckmate()) return -MATE + ply;
  if (chess.isDraw()) return 0;
  if (depth === 0) return quiesce(chess, alpha, beta, qdepth);
  const moves = ordered(chess.moves({ verbose: true }));
  for (const m of moves) {
    chess.move(m);
    const sc = -search(chess, depth - 1, -beta, -alpha, ply + 1, qdepth);
    chess.undo();
    if (stopped) return 0;
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

export function bestMove(fen, level = 2, timeMs = 2500) {
  const chess = new Chess(fen);
  const moves = ordered(chess.moves({ verbose: true }));
  if (!moves.length) return null;
  const maxDepth = level <= 1 ? 1 : level === 2 ? 2 : 3;
  const qdepth = level <= 1 ? 0 : level === 2 ? 2 : 4;
  nodes = 0; stopped = false; deadline = Date.now() + timeMs;
  let best = moves[0], bestScores = null;
  for (let d = 1; d <= maxDepth; d++) {
    const scored = [];
    for (const m of moves) {
      chess.move(m);
      const sc = -search(chess, d - 1, -MATE - 1, MATE + 1, 1, qdepth);
      chess.undo();
      if (stopped) break;
      scored.push({ m, sc });
    }
    if (stopped && d > 1) break;
    scored.sort((a, b) => b.sc - a.sc);
    bestScores = scored;
    // Search the best line first next round.
    moves.sort((a, b) => scored.findIndex((x) => x.m === a) - scored.findIndex((x) => x.m === b));
  }
  if (!bestScores || !bestScores.length) return { san: best.san, from: best.from, to: best.to, promotion: best.promotion };
  // Easy level: pick at random among moves close to the best, so it blunders sometimes.
  const slack = level <= 1 ? 120 : level === 2 ? 15 : 0;
  const top = bestScores[0].sc;
  const pool = bestScores.filter((x) => x.sc >= top - slack);
  best = pool[Math.floor(Math.random() * pool.length)].m;
  return { san: best.san, from: best.from, to: best.to, promotion: best.promotion };
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { id, fen, level, timeMs } = e.data;
    try {
      self.postMessage({ id, move: bestMove(fen, level, timeMs) });
    } catch (err) {
      self.postMessage({ id, error: String(err) });
    }
  };
}
