// Plain-speech descriptions of chess positions and moves.
// Pure functions over a chess.js instance, no DOM.
export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const PLURAL = { p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens', k: 'kings' };
export const COLOR_NAMES = { w: 'White', b: 'Black' };
export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function other(color) { return color === 'w' ? 'b' : 'w'; }

export function listJoin(items, word = 'and') {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${word} ${items[items.length - 1]}`;
}

export function pieceLabel(piece) {
  if (!piece) return 'empty';
  return `${COLOR_NAMES[piece.color].toLowerCase()} ${PIECE_NAMES[piece.type]}`;
}

function sortSquares(squares) {
  return squares.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a.charCodeAt(0) - b.charCodeAt(0)));
}

// All pieces of one color, grouped by type.
export function piecesOf(chess, color) {
  const groups = { k: [], q: [], r: [], b: [], n: [], p: [] };
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) groups[cell.type].push(cell.square);
    }
  }
  for (const t of ORDER) groups[t] = sortSquares(groups[t]);
  return groups;
}

export function describePieces(chess, color, whose) {
  const g = piecesOf(chess, color);
  const parts = [];
  for (const t of ORDER) {
    const sq = g[t];
    if (!sq.length) continue;
    const name = sq.length === 1 ? PIECE_NAMES[t] : PLURAL[t];
    const cap = name[0].toUpperCase() + name.slice(1);
    parts.push(`${cap} on ${listJoin(sq)}`);
  }
  const count = Object.values(g).reduce((n, a) => n + a.length, 0);
  return `${whose} ${count} ${count === 1 ? 'piece' : 'pieces'}. ${parts.join('. ')}.`;
}

export function findPieceType(word) {
  const w = (word || '').toLowerCase().replace(/s$/, '');
  const map = { king: 'k', queen: 'q', rook: 'r', castle: 'r', bishop: 'b', knight: 'n', horse: 'n', night: 'n', pawn: 'p' };
  return map[w] || null;
}

export function describeWhere(chess, color, type, whose) {
  const sq = piecesOf(chess, color)[type];
  if (!sq.length) return `${whose} no ${PLURAL[type]} left.`;
  const name = sq.length === 1 ? PIECE_NAMES[type] : PLURAL[type];
  return `${whose} ${name} ${sq.length === 1 ? 'is' : 'are'} on ${listJoin(sq)}.`;
}

export function describeSquare(chess, square) {
  const piece = chess.get(square);
  let text = piece ? `${square}: ${pieceLabel(piece)}.` : `${square} is empty.`;
  if (piece) {
    const foe = other(piece.color);
    const attackers = chess.attackers(square, foe);
    const defenders = chess.attackers(square, piece.color);
    if (attackers.length) {
      const names = attackers.map((s) => `${PIECE_NAMES[chess.get(s).type]} on ${s}`);
      text += ` Attacked by ${listJoin(names)}.`;
      text += defenders.length ? ` Defended ${defenders.length === 1 ? 'once' : defenders.length + ' times'}.` : ' Not defended.';
    }
  }
  return text;
}

// Describe a chess.js verbose move object in plain speech.
export function describeMove(move) {
  const who = COLOR_NAMES[move.color];
  const piece = PIECE_NAMES[move.piece];
  const flags = move.flags || '';
  let text;
  if (flags.includes('k')) text = `${who} castles kingside`;
  else if (flags.includes('q')) text = `${who} castles queenside`;
  else if (flags.includes('e')) text = `${who} pawn from ${move.from} takes pawn en passant on ${move.to}`;
  else if (move.captured) text = `${who} ${piece} from ${move.from} takes ${PIECE_NAMES[move.captured]} on ${move.to}`;
  else text = `${who} ${piece} from ${move.from} to ${move.to}`;
  if (move.promotion) text += `, promotes to ${PIECE_NAMES[move.promotion]}`;
  const san = move.san || '';
  if (san.includes('#')) text += '. Checkmate';
  else if (san.includes('+')) text += '. Check';
  return text + '.';
}

export function gameOverText(chess) {
  if (chess.isCheckmate()) {
    const winner = COLOR_NAMES[other(chess.turn())];
    return `Checkmate. ${winner} wins.`;
  }
  if (chess.isStalemate()) return 'Stalemate. The game is a draw.';
  if (chess.isInsufficientMaterial()) return 'Draw. Not enough pieces left to checkmate.';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition.';
  if (chess.isDrawByFiftyMoves()) return 'Draw by the fifty move rule.';
  if (chess.isDraw()) return 'The game is a draw.';
  return '';
}

export function material(chess, color) {
  const g = piecesOf(chess, color);
  return Object.entries(g).reduce((n, [t, a]) => n + VALUES[t] * a.length, 0);
}

export function describeMaterial(chess, me) {
  const mine = material(chess, me), theirs = material(chess, other(me));
  const diff = mine - theirs;
  let lead = 'Material is even.';
  if (diff > 0) lead = `You are up ${diff} ${diff === 1 ? 'point' : 'points'}.`;
  if (diff < 0) lead = `You are down ${-diff} ${diff === -1 ? 'point' : 'points'}.`;
  return `${lead} You have ${mine} points of material, your opponent has ${theirs}. Pawn 1, knight and bishop 3, rook 5, queen 9.`;
}

// Pieces of `color` that the other side attacks.
export function describeThreats(chess, color, whose) {
  const foe = other(color);
  const lines = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color) continue;
      const att = chess.attackers(cell.square, foe);
      if (!att.length) continue;
      const def = chess.attackers(cell.square, color).length;
      lines.push(`${PIECE_NAMES[cell.type]} on ${cell.square}, attacked by ${listJoin(att.map((s) => PIECE_NAMES[chess.get(s).type] + ' on ' + s))}${def ? '' : ', not defended'}`);
    }
  }
  if (!lines.length) return `None of ${whose} pieces are attacked.`;
  return `${lines.length} of ${whose} pieces ${lines.length === 1 ? 'is' : 'are'} attacked. ${lines.join('. ')}.`;
}

export function describeMovesFrom(chess, square) {
  const piece = chess.get(square);
  if (!piece) return `${square} is empty.`;
  const moves = chess.moves({ square, verbose: true });
  const name = `${pieceLabel(piece)} on ${square}`;
  if (!moves.length) return `The ${name} has no legal moves.`;
  const targets = [...new Set(moves.map((m) => (m.captured ? `${m.to}, taking the ${PIECE_NAMES[m.captured]}` : m.to)))];
  return `The ${name} can go to ${listJoin(targets, 'or')}.`;
}

export function describeAllMoves(chess) {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return 'No legal moves.';
  const byFrom = {};
  for (const m of moves) (byFrom[m.from] = byFrom[m.from] || []).push(m);
  const parts = Object.keys(byFrom).map((from) => {
    const p = chess.get(from);
    const tos = [...new Set(byFrom[from].map((m) => m.to))];
    return `${PIECE_NAMES[p.type]} ${from} to ${listJoin(tos, 'or')}`;
  });
  return `${moves.length} legal moves. ${parts.join('. ')}.`;
}

export function describeBoard(chess, fromColor = 'w') {
  const ranks = fromColor === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = fromColor === 'w' ? FILES : FILES.slice().reverse();
  const out = [];
  for (const r of ranks) {
    const items = [];
    for (const f of files) {
      const p = chess.get(f + r);
      if (p) items.push(`${f}${r} ${pieceLabel(p)}`);
    }
    out.push(items.length ? `Rank ${r}: ${items.join(', ')}.` : `Rank ${r}: empty.`);
  }
  return out.join(' ');
}

export function describeHistory(chess) {
  const h = chess.history({ verbose: true });
  if (!h.length) return 'No moves yet.';
  return h.map((m, i) => `${Math.floor(i / 2) + 1}${m.color === 'w' ? '' : ' black'}: ${describeMove(m)}`).join(' ');
}

// Turn a typed or dictated move into a legal chess.js move.
// Returns {move} or {error} or {ambiguous: [moves]}.
export function resolveMove(chess, input, promoteDefault = 'q') {
  const legal = chess.moves({ verbose: true });
  let raw = String(input || '').trim();
  if (!raw) return { error: 'Type a move first.' };
  // Normalize unicode castling zeros and dashes.
  raw = raw.replace(/[–—−]/g, '-').replace(/0/g, 'O').replace(/o-o/gi, (m) => m.toUpperCase());
  const lower = raw.toLowerCase().replace(/[!?.,]/g, ' ').replace(/\s+/g, ' ').trim();

  // Castling words.
  const castleK = /^(o-o|oo|castle( king ?side| short)?|short castle|king ?side castle|castles?( kingside)?)$/.test(lower);
  const castleQ = /^(o-o-o|ooo|castle (queen ?side|long)|long castle|queen ?side castle|castles? queenside)$/.test(lower);
  if (castleQ || castleK) {
    const flag = castleQ ? 'q' : 'k';
    const m = legal.find((x) => x.flags.includes(flag));
    return m ? { move: m } : { error: `You can't castle ${castleQ ? 'queenside' : 'kingside'} right now.` };
  }

  // Promotion piece from words or "=Q".
  let promo = null;
  const pw = lower.match(/(?:=|promote(?:s)? (?:to )?|to a |promotion )?(queen|rook|bishop|knight)\s*$/);
  const pl = raw.match(/=?\(?([QRBNqrbn])\)?\s*[+#]?$/);

  // Coordinate form: e2e4, e2-e4, e2 e4, e2 to e4, e7e8q.
  const coord = lower.match(/^([a-h][1-8])\s*(?:-|x|to|takes|\s)?\s*([a-h][1-8])\s*(?:=)?\s*([qrbn])?\s*[+#]?$/);
  if (coord) {
    const [, from, to, pr] = coord;
    const cands = legal.filter((m) => m.from === from && m.to === to);
    if (!cands.length) return { error: explainIllegal(chess, from, to) };
    const want = pr || promoteDefault;
    return { move: cands.find((m) => !m.promotion || m.promotion === want) || cands[0] };
  }

  // Word form: "knight f3", "knight to f3", "knight g1 to f3", "pawn takes d5", "bishop takes on c6".
  const words = lower.replace(/\b(to|takes|take|captures|capture|on|the|my|x|moves?|goes|go)\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const pieceType = findPieceType(words[0]);
  if (pieceType) {
    const squares = words.slice(1).filter((w) => /^[a-h][1-8]$/.test(w));
    const fileHint = words.slice(1).find((w) => /^[a-h]$/.test(w));
    if (!squares.length) return { error: `Which square should the ${PIECE_NAMES[pieceType]} go to?` };
    const to = squares[squares.length - 1];
    const from = squares.length > 1 ? squares[0] : null;
    let cands = legal.filter((m) => m.piece === pieceType && m.to === to && (!from || m.from === from) && (!fileHint || m.from[0] === fileHint));
    if (!cands.length) return { error: `No ${PIECE_NAMES[pieceType]} of yours can go to ${to}.` };
    if (pieceType === 'p') {
      const want = pw ? findPieceType(pw[1]) : promoteDefault;
      const pr = cands.filter((m) => !m.promotion || m.promotion === want);
      if (pr.length) cands = pr;
    }
    const uniqFrom = [...new Set(cands.map((m) => m.from))];
    if (uniqFrom.length > 1) return { ambiguous: cands, error: `Two ${PLURAL[pieceType]} can go to ${to}: from ${listJoin(uniqFrom, 'or')}. Say which, like "${PIECE_NAMES[pieceType]} ${uniqFrom[0]} to ${to}".` };
    return { move: cands[0] };
  }

  // SAN, case-insensitive. Normalize both sides.
  const norm = (s) => s.replace(/[+#!?=\s]/g, '').replace(/x/gi, '').toLowerCase();
  const target = norm(raw);
  const exact = legal.filter((m) => m.san.replace(/[+#]/g, '') === raw.replace(/[+#!?\s]/g, ''));
  if (exact.length === 1) return { move: exact[0] };
  let cands = legal.filter((m) => norm(m.san) === target);
  if (!cands.length) {
    // Promotion with default piece: "e8" for a pawn reaching the last rank.
    cands = legal.filter((m) => m.promotion && norm(m.san) === target + (pl ? '' : promoteDefault));
  }
  if (!cands.length && pl) {
    cands = legal.filter((m) => m.promotion && norm(m.san) === target);
  }
  if (cands.length === 1) return { move: cands[0] };
  if (cands.length > 1) {
    // "bc4" can be Bishop c4 or pawn b takes c4. Upper-case B means bishop.
    if (/^B/.test(raw)) {
      const b = cands.filter((m) => m.piece === 'b');
      if (b.length === 1) return { move: b[0] };
    }
    if (/^b/.test(raw)) {
      const p = cands.filter((m) => m.piece === 'p');
      const b = cands.filter((m) => m.piece === 'b');
      if (p.length && b.length) return { ambiguous: cands, error: `Did you mean the bishop to ${b[0].to}, or the b pawn takes on ${p[0].to}? Type "bishop ${b[0].to}" or "${p[0].from} ${p[0].to}".` };
    }
    const promoPick = cands.filter((m) => m.promotion === promoteDefault);
    if (promoPick.length === 1) return { move: promoPick[0] };
    return { ambiguous: cands, error: `That could be ${listJoin(cands.map((m) => describeMove(m).replace(/\.$/, '')), 'or')}. Add the starting square, like "${cands[0].from} ${cands[0].to}".` };
  }
  // A bare square: "e4" handled by SAN; "f3" with a knight is Nf3 in SAN, so try piece-less target.
  if (/^[a-h][1-8]$/.test(lower)) {
    const any = legal.filter((m) => m.to === lower);
    const pieces = [...new Set(any.map((m) => m.piece))];
    if (!any.length) return { error: `Nothing of yours can move to ${lower}.` };
    return { ambiguous: any, error: `No pawn can go to ${lower}. ${listJoin(any.map((m) => 'The ' + PIECE_NAMES[m.piece] + ' on ' + m.from), 'or')} can. Say which, like "${PIECE_NAMES[any[0].piece]} to ${lower}".` };
    if (false) return { ambiguous: any, error: `More than one piece can go to ${lower}: ${listJoin(any.map((m) => PIECE_NAMES[m.piece] + ' from ' + m.from), 'or')}. Say which, like "${PIECE_NAMES[any[0].piece]} ${any[0].from} to ${lower}".` };
    return { error: `Nothing of yours can move to ${lower}.` };
  }
  return { error: `I didn't understand "${String(input).trim()}". Try e4, Nf3, knight to f3, e2 e4, or castle. Type help for commands.` };
}

function explainIllegal(chess, from, to) {
  const p = chess.get(from);
  if (!p) return `There's no piece on ${from}.`;
  if (p.color !== chess.turn()) return `The piece on ${from} isn't yours to move.`;
  if (chess.inCheck()) return `${PIECE_NAMES[p.type]} ${from} to ${to} is not legal. You're in check.`;
  return `The ${PIECE_NAMES[p.type]} on ${from} can't go to ${to}.`;
}
