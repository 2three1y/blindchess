// Chess over Nostr, compatible with jesterui's message format (kind 30).
// Start event: {version:'0', kind:0, history:[], nonce}. Move: {version:'0', kind:1, fen, move, history}
// with two e tags (start id, previous head id). Blind Chess adds a join event (kind 101)
// and a resign event (kind 102) that jesterui simply ignores.
import { Chess } from './vendor/chess.js';

const NT = () => globalThis.NostrTools;
export const KIND = 30;
export const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io', 'wss://offchain.pub', 'wss://nostr.mom'];
const C_START = 0, C_MOVE = 1, C_JOIN = 101, C_RESIGN = 102;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
function parse(content) { try { const j = JSON.parse(content); return j && typeof j === 'object' ? j : null; } catch { return null; } }

// ---- Identity: a temporary key by default, optional NIP-07 extension or a pasted nsec.
export class Signer {
  constructor(storage) {
    this.storage = storage;
    this.mode = 'temp';
    let hex = storage && storage.getItem('blindchess.tempkey');
    if (!hex) { hex = bytesToHex(NT().generateSecretKey()); storage && storage.setItem('blindchess.tempkey', hex); }
    this.sk = hexToBytes(hex);
    this.pubkey = NT().getPublicKey(this.sk);
  }
  async useExtension() {
    if (!globalThis.nostr) throw new Error('No Nostr signer extension found in this browser.');
    this.pubkey = await globalThis.nostr.getPublicKey();
    this.mode = 'extension';
    this.sk = null;
  }
  useNsec(nsec) {
    const d = NT().nip19.decode(nsec.trim());
    if (d.type !== 'nsec') throw new Error('That is not an nsec key.');
    this.sk = d.data; this.pubkey = NT().getPublicKey(this.sk); this.mode = 'nsec';
  }
  useTemp() {
    const hex = this.storage.getItem('blindchess.tempkey');
    this.sk = hexToBytes(hex); this.pubkey = NT().getPublicKey(this.sk); this.mode = 'temp';
  }
  npub() { return NT().nip19.npubEncode(this.pubkey); }
  async sign(template) {
    const t = { created_at: Math.floor(Date.now() / 1000), tags: [], ...template };
    if (this.mode === 'extension') return globalThis.nostr.signEvent({ ...t, pubkey: this.pubkey });
    return NT().finalizeEvent(t, this.sk);
  }
}

// ---- Pure game reconstruction from a set of events.
// Returns {chess, white, black, heads:[event ids], moveEvents, resigned, joinedBy}.
export function rebuild(start, events, opts = {}) {
  const sc = parse(start.content) || {};
  const creatorColor = (sc.blindchess && sc.blindchess.creatorColor) === 'b' ? 'b' : 'w';
  const seats = { w: null, b: null };
  seats[creatorColor] = start.pubkey;
  const otherColor = creatorColor === 'w' ? 'b' : 'w';
  const sorted = events.filter((e) => e.id !== start.id).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  // Seat claims by join events, earliest first.
  for (const e of sorted) {
    const c = parse(e.content);
    if (c && c.kind === C_JOIN && !seats[otherColor] && e.pubkey !== start.pubkey) seats[otherColor] = e.pubkey;
  }
  const moves = sorted.filter((e) => { const c = parse(e.content); return c && c.kind === C_MOVE && Array.isArray(c.history) && c.history.length > 0; });
  const chess = new Chess();
  let head = start.id;
  const applied = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    const n = chess.history().length;
    const hist = chess.history();
    for (const e of moves) {
      const c = parse(e.content);
      if (c.history.length !== n + 1) continue;
      if (!hist.every((s, i) => s === c.history[i])) continue;
      const etags = e.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
      if (!etags.includes(start.id)) continue;
      const turn = chess.turn();
      if (seats[turn] && seats[turn] !== e.pubkey) continue; // not that player's move
      let mv = null;
      try { mv = chess.move(c.move); } catch { mv = null; }
      if (!mv) continue;
      if (c.fen && c.fen.split(' ')[0] !== chess.fen().split(' ')[0]) { chess.undo(); continue; }
      if (!seats[turn]) seats[turn] = e.pubkey; // first mover claims the seat (jesterui style)
      head = e.id; applied.push({ event: e, move: mv }); progressed = true;
      break;
    }
  }
  let resigned = null;
  for (const e of sorted) {
    const c = parse(e.content);
    if (c && c.kind === C_RESIGN) {
      if (e.pubkey === seats.w) { resigned = 'w'; break; }
      if (e.pubkey === seats.b) { resigned = 'b'; break; }
    }
  }
  return { chess, seats, head, applied, resigned, creatorColor };
}

// ---- Live game over relays.
export class NostrGame {
  constructor({ signer, relays, onUpdate, onStatus }) {
    this.signer = signer;
    this.relays = relays && relays.length ? relays : DEFAULT_RELAYS;
    this.onUpdate = onUpdate || (() => {});
    this.onStatus = onStatus || (() => {});
    this.pool = new (NT().SimplePool)();
    this.events = new Map();
    this.start = null;
    this.sub = null;
    this.state = null;
  }

  static parseLink(hash) {
    const m = String(hash || '').match(/(?:^|[#&?])(?:game|join)=([a-z0-9]+)/i);
    if (!m) return null;
    const v = m[1];
    if (/^[0-9a-f]{64}$/i.test(v)) return { id: v.toLowerCase(), relays: [] };
    try {
      const d = NT().nip19.decode(v);
      if (d.type === 'nevent') return { id: d.data.id, relays: d.data.relays || [], author: d.data.author };
      if (d.type === 'note') return { id: d.data, relays: [] };
    } catch {}
    return null;
  }

  link(base) {
    const nevent = NT().nip19.neventEncode({ id: this.start.id, relays: this.relays.slice(0, 3), author: this.start.pubkey, kind: KIND });
    return `${base}#game=${nevent}`;
  }

  async publish(event) {
    this.ingest(event);
    for (let attempt = 0; attempt < 3; attempt++) {
      const results = await Promise.allSettled(this.pool.publish(this.relays, event));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      if (ok) return ok;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    throw new Error('No relay accepted it.');
  }

  async create(creatorColor = 'w') {
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(4)));
    // A random reference tag keeps invite games out of public lobbies.
    const ref = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const ev = await this.signer.sign({
      kind: KIND,
      tags: [['e', ref], ['t', 'blind-chess'], ['client', 'Blind Chess']],
      content: JSON.stringify({ version: '0', kind: C_START, history: [], nonce, blindchess: { creatorColor } }),
    });
    this.start = ev;
    this.events.set(ev.id, ev);
    const ok = await this.publish(ev);
    this.subscribe();
    this.recompute();
    return ok;
  }

  async open(id, extraRelays = []) {
    for (const r of extraRelays) if (!this.relays.includes(r)) this.relays.push(r);
    this.onStatus('Looking for the game on Nostr relays…');
    const start = await this.pool.get(this.relays, { ids: [id] }, { maxWait: 6000 });
    if (!start) throw new Error('Could not find that game on the relays. The link may be old, or the relays are unreachable.');
    this.start = start;
    this.events.set(start.id, start);
    const past = await this.pool.querySync(this.relays, { kinds: [KIND], '#e': [id] }, { maxWait: 6000 });
    for (const e of past) this.events.set(e.id, e);
    this.subscribe();
    this.recompute();
    return this.state;
  }

  subscribe() {
    if (this.sub) this.sub.close();
    this.sub = this.pool.subscribeMany(this.relays, { kinds: [KIND], '#e': [this.start.id] }, {
      onevent: (e) => this.ingest(e),
    });
  }

  ingest(e) {
    if (this.events.has(e.id)) return;
    this.events.set(e.id, e);
    this.recompute();
  }

  recompute() {
    const prev = this.state;
    this.state = rebuild(this.start, [...this.events.values()]);
    this.onUpdate(this.state, prev);
  }

  myColor() {
    const s = this.state.seats;
    if (s.w === this.signer.pubkey) return 'w';
    if (s.b === this.signer.pubkey) return 'b';
    const open = !s.w ? 'w' : !s.b ? 'b' : null;
    return open ? { open } : null;
  }

  async join() {
    const ev = await this.signer.sign({ kind: KIND, tags: [['e', this.start.id]], content: JSON.stringify({ version: '0', kind: C_JOIN, blindchess: 'join' }) });
    return this.publish(ev);
  }

  async sendMove(chessAfter) {
    const history = chessAfter.history();
    const ev = await this.signer.sign({
      kind: KIND,
      tags: [['e', this.start.id], ['e', this.state.head]],
      content: JSON.stringify({ version: '0', kind: C_MOVE, fen: chessAfter.fen(), move: history[history.length - 1], history }),
    });
    return this.publish(ev);
  }

  async resign() {
    const ev = await this.signer.sign({ kind: KIND, tags: [['e', this.start.id]], content: JSON.stringify({ version: '0', kind: C_RESIGN, blindchess: 'resign' }) });
    return this.publish(ev);
  }

  close() {
    try { this.sub && this.sub.close(); } catch {}
    try { this.pool.close(this.relays); } catch {}
  }
}
