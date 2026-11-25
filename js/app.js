// 화면과 진행. 게임 상태 S는 순수 JSON이고, 모든 변경은 act()를 거친다.
// 한 화면 모드: act가 바로 반영하고 무르기용 기록을 남긴다.
// 온라인 모드: act가 낙관적으로 반영한 뒤 버전 검사 트랜잭션으로 방에 저장한다. 실패하면 서버 상태로 되돌린다.
import {AUG, CAT_KO, TIER_KO, TIER_RANK, GLYPH, VAL, HILL, PICK_AT, HUNT_GOAL, oth, has, alive, rankOf, initial, apply, inDanger, legal, tick, instant, offers, rollTier, sqName, note} from './engine.js?v=5';
import {connect} from './net.js?v=5';
import {firebaseConfig} from './config.js?v=5';

const MARK = {p: ['pawn2', 'pawnBack', 'pawnSide', 'battlePromo', 'earlyPromo'], n: ['centaur', 'nightrider'], b: ['archbishop', 'wazirBishop'], r: ['chancellor', 'cannon'], q: ['amazon'], k: ['stride', 'knightKing']};
const $ = id => document.getElementById(id);
const nm = c => (c === 'w' ? '백' : '흑');
const cc = c => (c === 'w' ? 'w' : 'b');
const esc = v => String(v).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const params = new URLSearchParams(location.search);
const NETKIND = params.get('net') === 'mem' ? 'mem' : 'firebase';
const ONLINE_READY = NETKIND === 'mem' || !!firebaseConfig;
const LS = 'augchess-local';

let S = null, H = [], LM = [], inCheck = false, sel = null, flip = false, promoMs = null;
// 온라인
let mode = 'local', net = null, roomId = null, room = null, me = null, lastMe = undefined, ver = 0;
let pending = false, claiming = false, presenceOn = false, netErr = '', copied = false, showStart = false;

/* ---------- 게임 진행 (S만 바꾼다, 화면은 건드리지 않음) ---------- */
function settle() {
  if (S.winner || S.pick) return;
  // 체크메이트는 없다. 둘 수 있는 수가 하나도 없으면 그 쪽이 진다.
  if (!legal(S, S.turn).length) { S.winner = oth(S.turn); S.reason = nm(S.turn) + '이 둘 수 있는 수가 없음'; }
}
function startTurn() {
  const c = S.turn;
  S.dblTurn = false; S.sub = 0;
  if (has(S, c, 'double') && S.dbl[c] >= 2) { S.dblTurn = true; S.dbl[c] = 0; }
  settle();
}
function switchTurn() { S.turn = oth(S.turn); startTurn(); }
function nextPick() {
  if (!S.queue.length) return false;
  const q = S.queue[0];
  if (!S.tiers[q.r]) S.tiers[q.r] = rollTier(q.r);
  const tier = S.tiers[q.r];
  // 온라인에서는 후보를 고르는 사람의 화면에서만 뽑는다.
  S.pick = {c: q.c, r: q.r, tier, opts: mode === 'local' || q.c === me ? offers(S, q.c, tier, q.r) : null};
  return true;
}
function endTurn() {
  const c = S.turn;
  tick(S, c);
  S.turns[c]++;
  if (!S.dblTurn && has(S, c, 'double')) S.dbl[c]++;
  S.dblTurn = false; S.sub = 0;
  const i = PICK_AT.indexOf(S.turns[c]);
  if (i >= 0) { S.queue = [{c, r: i + 2}]; S.after = 'switch'; nextPick(); return; }
  switchTurn();
}
function moveCore(m) {
  const c = S.turn, o = oth(c), s0 = S;
  const piece = m.drop ? null : s0.board[m.from];
  const count = B => B.filter(p => p && p.c === o).length;
  const before = count(s0.board);
  const [n, ev] = apply(s0, m, c);
  S = n;
  S.last = {from: m.drop ? null : m.from, to: m.to, boom: ev.boom};
  const kingMoved = piece && piece.t === 'k' && !ev.blocked && S.board[m.to] && S.board[m.to].t === 'k';
  let win = '';
  if (!alive(S.board, o)) win = ev.boom.length ? '폭발로 상대 킹 제거' : '킹 포획';
  else if (has(S, c, 'hill') && kingMoved && HILL.includes(m.to)) win = '언덕의 왕';
  else if (has(S, c, 'kingMarch') && kingMoved && rankOf(c, m.to) === 7) win = '왕의 행진';
  if (!win && has(S, c, 'hunter')) { S.kills[c] += before - count(S.board); if (S.kills[c] >= HUNT_GOAL) win = '사냥꾼 (' + HUNT_GOAL + '개 처치)'; }
  const chk = !win && inDanger(S, o);
  if (chk && has(S, c, 'threeCheck')) { S.checks[c]++; if (S.checks[c] >= 3) win = '3회 공격'; }
  S.log.push({c, t: note(s0, m, c, ev, chk), sub: S.sub});
  if (win) { S.winner = c; S.reason = win; return; }
  if (S.dblTurn && S.sub === 0 && !chk) {
    S.sub = 1;
    if (legal(S, c).length) return;
  }
  endTurn();
}
function chooseCore(id) {
  const {c} = S.pick;
  if (!S.pick.opts || !S.pick.opts.includes(id)) return;
  S.aug[c].push(id);
  let msg = '증강: ' + AUG[id].name;
  if (AUG[id].instant) { const d = instant(S, c, id); if (d) msg += ' (' + d + ')'; }
  if (id === 'double') S.dbl[c] = 0;
  if (id === 'hunter') S.kills[c] = 0;
  if (id === 'threeCheck') S.checks[c] = 0;
  S.log.push({c, t: msg, aug: 1});
  S.queue.shift(); S.pick = null;
  if (nextPick()) return;
  if (S.after === 'start') startTurn(); else switchTurn();
}
function freshGame() {
  S = initial();
  nextPick();
}

/* ---------- 행동과 저장 ---------- */
const seated = () => !!(room && room.seats && room.seats.w && room.seats.b);
// any=true: 차례와 상관없이 할 수 있는 행동(기권)
function mayAct(any) {
  if (pending || !S || S.winner) return false;
  if (mode === 'local') return true;
  if (!me || !seated()) return false;
  return any || (S.pick ? S.pick.c === me : S.turn === me);
}
function act(fn, any) {
  if (!mayAct(any)) return;
  const before = JSON.stringify(S);
  S = JSON.parse(before);
  fn();
  sel = null; promoMs = null;
  if (mode === 'local') {
    H.push(before); if (H.length > 200) H.shift();
    saveLocal(); view();
    return;
  }
  commit(before);
}
function commit(before) {
  const next = JSON.stringify(S), v = ver;
  pending = true; view();
  net.update(roomId, r => {
    if (r.ver !== v) return undefined;
    r.state = next; r.ver = v + 1; r.req = null;
    r.hist = (r.hist || []).concat(before).slice(-8);
    return r;
  }).then(ok => {
    pending = false;
    if (ok) ver = Math.max(ver, v + 1); else resync();
    view();
  }).catch(e => {
    pending = false; netErr = '저장하지 못했습니다: ' + e.message; resync(); view();
  });
}
function fixState(s) { if (s && !s.kills) s.kills = {w: 0, b: 0}; return s; }
function parseState(str) { try { const s = JSON.parse(str); return s && Array.isArray(s.board) ? fixState(s) : null; } catch { return null; } }
function resync() { if (room) { const s = parseState(room.state); if (s) { S = s; ver = room.ver; } } }
function saveLocal() { try { localStorage.setItem(LS, JSON.stringify({S, H: H.slice(-60)})); } catch {} }

/* ---------- 온라인 방 ---------- */
async function ensureNet() {
  if (net) return net;
  try { net = await connect(firebaseConfig, NETKIND); }
  catch (e) { netErr = '온라인 서버에 연결하지 못했습니다: ' + e.message; }
  if (!net && !netErr) netErr = 'js/config.js에 Firebase 설정이 없습니다.';
  return net;
}
const ID_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randId = () => Array.from({length: 6}, () => ID_CH[Math.floor(Math.random() * ID_CH.length)]).join('');
const roomLink = id => location.origin + location.pathname + '?room=' + id + (NETKIND === 'mem' ? '&net=mem' : '');

async function createRoom(color) {
  netErr = '';
  const n = await ensureNet();
  if (!n) { view(); return; }
  const c = color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
  for (let tries = 0; tries < 5; tries++) {
    const id = randId();
    mode = 'online'; me = c; roomId = id;
    freshGame();
    const ok = await n.create(id, {seats: {[c]: n.uid}, state: JSON.stringify(S), ver: 1, createdAt: Date.now()});
    if (ok) {
      history.replaceState(null, '', roomLink(id));
      enterRoom(id);
      return;
    }
  }
  mode = 'local'; me = null; roomId = null;
  netErr = '방을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
  restoreLocal();
}
function enterRoom(id) {
  mode = 'online'; roomId = id; H = []; presenceOn = false;
  const timer = setTimeout(() => { if (!room) { netErr = '방 정보를 받아 오지 못했습니다. 링크를 확인해 주세요.'; view(); } }, 10000);
  net.subscribe(id, r => { clearTimeout(timer); onRoom(r); }, e => { netErr = '방을 읽지 못했습니다: ' + e.message; view(); });
  view();
}
function onRoom(r) {
  if (!r) { room = null; netErr = '방을 찾을 수 없습니다.'; view(); return; }
  room = r;
  const seats = r.seats || {};
  me = seats.w === net.uid ? 'w' : seats.b === net.uid ? 'b' : null;
  if (!me && !claiming && (!seats.w || !seats.b)) claimSeat();
  if (me !== lastMe) { flip = me === 'b'; lastMe = me; }
  if (me && !presenceOn) { net.presence(roomId, net.uid); presenceOn = true; }
  if (!pending || r.ver > ver) {
    const s = parseState(r.state);
    if (s) { S = s; ver = r.ver; sel = null; promoMs = null; }
  }
  // 내 증강 후보가 아직 안 뽑혔으면 내 화면에서 뽑아 저장한다.
  if (!pending && S && !S.winner && S.pick && S.pick.c === me && !S.pick.opts && seated()) {
    act(() => { S.pick.opts = offers(S, me, S.pick.tier); });
    return;
  }
  view();
}
function claimSeat() {
  claiming = true;
  net.update(roomId, r => {
    r.seats = r.seats || {};
    if (r.seats.w === net.uid || r.seats.b === net.uid) return r;
    const c = !r.seats.w ? 'w' : !r.seats.b ? 'b' : null;
    if (!c) return undefined;
    r.seats[c] = net.uid;
    return r;
  }).catch(e => { netErr = '자리에 앉지 못했습니다: ' + e.message; view(); })
    .finally(() => { claiming = false; });
}
function sendReq(type) {
  if (!me || pending) return;
  net.update(roomId, r => {
    if (r.req) return undefined;
    r.req = {type, by: me};
    return r;
  });
}
function cancelReq() {
  net.update(roomId, r => (r.req && r.req.by === me ? (r.req = null, r) : undefined));
}
function answerReq(yes) {
  net.update(roomId, r => {
    const q = r.req;
    if (!q || q.by === me || !me) return undefined;
    r.req = null;
    if (!yes) return r;
    if (q.type === 'draw') {
      const s = parseState(r.state);
      if (!s || s.winner) return r;
      s.winner = 'draw'; s.reason = '합의 무승부';
      r.hist = (r.hist || []).concat(r.state).slice(-8);
      r.state = JSON.stringify(s); r.ver++;
      return r;
    }
    if (q.type === 'undo') {
      // 요청한 사람이 다시 둘 차례인 가장 가까운 과거 상태로 되돌린다.
      const h = (r.hist || []).slice();
      while (h.length) {
        const cand = h.pop(), s = parseState(cand);
        if (s && s.turn === q.by && !s.pick && !s.winner) { r.state = cand; r.hist = h; r.ver++; return r; }
      }
      return r;
    }
    return r;
  });
}
function rematch() {
  if (!me || !S || !S.winner) return;
  net.update(roomId, r => {
    const s = parseState(r.state);
    if (!s || !s.winner) return undefined;
    r.seats = {w: r.seats.b, b: r.seats.w};
    const g = initial();
    g.tiers[1] = rollTier(1);
    g.pick = {c: 'w', r: 1, tier: g.tiers[1], opts: null};
    r.state = JSON.stringify(g); r.ver++; r.hist = []; r.req = null;
    return r;
  });
}

/* ---------- 입력 ---------- */
function clickSq(x) {
  if (!S || S.winner || S.pick || promoMs || !LM.length) return;
  const c = S.turn, p = S.board[x];
  if (sel) {
    const ms = LM.filter(m => (sel.drop ? m.drop === sel.drop : m.from === sel.from) && m.to === x);
    if (ms.length) {
      if (ms[0].promo) { promoMs = ms; render(); }
      else act(() => moveCore(ms[0]));
      return;
    }
  }
  sel = p && p.c === c && LM.some(m => m.from === x) ? {from: x} : null;
  render();
}
function clickHand(t) {
  if (!LM.length) return;
  sel = sel && sel.drop === t ? null : {drop: t};
  render();
}
function undo() {
  if (mode === 'online') { sendReq('undo'); return; }
  if (!H.length) return;
  S = JSON.parse(H.pop()); promoMs = null; sel = null;
  saveLocal(); view();
}
function newGame() {
  if (mode === 'online') { rematch(); return; }
  H = []; promoMs = null; sel = null;
  freshGame(); saveLocal(); view();
}
function restoreLocal(first) {
  mode = 'local'; me = null;
  try {
    const d = JSON.parse(localStorage.getItem(LS));
    if (d && d.S && Array.isArray(d.S.board) && d.S.log && d.S.log.length) { S = fixState(d.S); H = d.H || []; view(); return; }
  } catch {}
  showStart = !!first && ONLINE_READY;
  newGame();
}

$('board').addEventListener('click', e => { const el = e.target.closest('[data-x]'); if (el) clickSq(+el.dataset.x); });
document.addEventListener('click', e => {
  const t = e.target;
  const h = t.closest('[data-h]'); if (h && !h.disabled) { clickHand(h.dataset.h); return; }
  const a = t.closest('[data-aug]'); if (a) { const id = a.dataset.aug; act(() => chooseCore(id)); return; }
  const pr = t.closest('[data-pr]');
  if (pr) {
    const ms = promoMs; promoMs = null;
    if (pr.dataset.pr === 'x') { render(); return; }
    const m = ms.find(x => x.promo === pr.dataset.pr);
    act(() => moveCore(m));
    return;
  }
  const mk = t.closest('[data-make]'); if (mk) { showStart = false; createRoom(mk.dataset.make); return; }
  const b = t.closest('button'); if (!b) return;
  switch (b.id) {
    case 'bSkip': act(() => endTurn()); break;
    case 'bDraw': if (mode === 'online') sendReq('draw'); else act(() => { S.winner = 'draw'; S.reason = '합의 무승부'; }); break;
    case 'bResign': { const c = mode === 'online' ? me : S.turn; if (!c) break; act(() => { S.winner = oth(c); S.reason = nm(c) + ' 기권'; }, true); break; }
    case 'bAgain': case 'bNew': newGame(); break;
    case 'bFlip': flip = !flip; render(); break;
    case 'bUndo': undo(); break;
    case 'bYes': answerReq(true); break;
    case 'bNo': answerReq(false); break;
    case 'bCancel': cancelReq(); break;
    case 'bCopy': navigator.clipboard.writeText(roomLink(roomId)).then(() => { copied = true; render(); setTimeout(() => { copied = false; render(); }, 1600); }).catch(() => { const i = $('roomLink'); if (i) i.select(); }); break;
    case 'bLocal': showStart = false; render(); break;
    case 'bStart': showStart = true; render(); break;
    case 'bLeave': location.href = location.pathname + (NETKIND === 'mem' ? '?net=mem' : ''); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (sel || promoMs)) { sel = null; promoMs = null; render(); } });

/* ---------- 화면 ---------- */
function view() {
  LM = []; inCheck = false;
  if (S && !S.winner && !S.pick) {
    inCheck = inDanger(S, S.turn);
    const mine = mode === 'local' || (me && S.turn === me && seated());
    if (mine && !pending) LM = legal(S, S.turn);
  }
  render();
}
function markTier(s, c, t) {
  let best = -1;
  for (const id of MARK[t] || []) if (has(s, c, id)) best = Math.max(best, TIER_RANK[AUG[id].tier]);
  return best < 0 ? '' : ['silver', 'gold', 'prism'][best];
}
function renderBoard(D) {
  const tg = new Map();
  if (sel) for (const m of LM) if (sel.drop ? m.drop === sel.drop : m.from === sel.from) tg.set(m.to, m);
  const atom = has(D, D.turn, 'atomic');
  // 이 수를 두면 내 킹이 공격받게 되는지 (킹 포획 규칙이라 둘 수는 있지만 경고한다)
  const risky = m => { const n = apply(D, m, D.turn)[0]; return alive(n.board, oth(D.turn)) && inDanger(n, D.turn); };
  const kingSq = inCheck && !D.winner ? D.board.findIndex(p => p && p.t === 'k' && p.c === D.turn) : -1;
  let h = '';
  for (let i = 0; i < 64; i++) {
    const row = i >> 3, col = i & 7;
    const r = flip ? row : 7 - row, f = flip ? 7 - col : col, x = r * 8 + f, p = D.board[x];
    const cl = ['sq', (r + f) % 2 === 0 ? 'dk' : 'lt'];
    if (D.last && (D.last.from === x || D.last.to === x)) cl.push('last');
    if (D.last && Array.isArray(D.last.boom) && D.last.boom.includes(x)) cl.push('boom');
    if (sel && sel.from === x) cl.push('sel');
    if (x === kingSq) cl.push('chk');
    if (tg.has(x)) { const m = tg.get(x); if (p || m.ep) { cl.push('cap'); if (atom) cl.push('atom'); } else { cl.push('dot'); if (m.drop) cl.push('drop'); } if (risky(m)) cl.push('risk'); }
    let inner = '';
    if (p) {
      const mt = markTier(D, p.c, p.t);
      inner = (p.fz ? '<span class="ice"></span>' : '') + (p.sh ? '<span class="shl"></span>' : '') + '<span class="pc ' + cc(p.c) + '">' + (GLYPH[p.t] || '?') + '</span>' + (mt ? '<span class="mk ' + mt + '"></span>' : '');
    }
    if (row === 7) inner += '<span class="co f">' + 'abcdefgh'[f] + '</span>';
    if (col === 0) inner += '<span class="co r">' + (r + 1) + '</span>';
    const lab = sqName(x) + (p ? ' ' + nm(p.c) + ' ' + ({k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰'}[p.t] || '') + (p.sh ? ' 보호막' : '') + (p.fz ? ' 빙결 ' + (+p.fz) : '') : '');
    h += '<div class="' + cl.join(' ') + '" data-x="' + x + '" role="gridcell" aria-label="' + esc(lab) + '" title="' + esc(lab) + '">' + inner + '</div>';
  }
  $('board').innerHTML = h;
}
function trayHTML(D, c) {
  const on = !D.winner && !D.pick && D.turn === c;
  const handOn = on && LM.length > 0;
  const augs = D.aug[c].filter(id => AUG[id]);
  const chips = augs.length ? augs.map(id => '<span class="chip ' + AUG[id].tier + '" title="' + esc(CAT_KO[AUG[id].cat] + ' · ' + AUG[id].desc) + '">' + esc(AUG[id].name) + '</span>').join('') : '<span class="mute">아직 증강 없음</span>';
  const meta = [];
  if (has(D, c, 'drop')) {
    const hd = Object.entries(D.hand[c] || {}).filter(([t, n]) => n > 0 && GLYPH[t]).sort((a, b) => VAL[b[0]] - VAL[a[0]]);
    meta.push('<span>손패 ' + (hd.length ? '<span class="hand">' + hd.map(([t, n]) => '<button type="button" class="' + (sel && sel.drop === t && handOn ? 'on' : '') + '" data-h="' + t + '" ' + (handOn ? '' : 'disabled') + ' aria-label="' + t + ' 드롭">' + GLYPH[t] + '<small>×' + (+n) + '</small></button>').join('') + '</span>' : '<b>비어 있음</b>') + '</span>');
  }
  if (has(D, c, 'hunter')) meta.push('<span>사냥 <b>' + (+D.kills[c] || 0) + '/' + HUNT_GOAL + '</b></span>');
  if (has(D, c, 'threeCheck')) meta.push('<span>킹 공격 <span class="pips">' + [0, 1, 2].map(i => '<i class="' + (i < D.checks[c] ? 'f' : '') + '"></i>').join('') + '</span></span>');
  if (has(D, c, 'double')) {
    const ready = (on && D.dblTurn) || D.dbl[c] >= 2;
    meta.push('<span>연속 행동 <span class="pips g">' + [0, 1, 2].map(i => '<i class="' + (ready || i < D.dbl[c] ? 'f' : '') + '"></i>').join('') + '</span>' + (on && D.dblTurn ? ' <b>' + (D.sub ? '두 번째 수' : '이번 턴 두 수') + '</b>' : '') + '</span>');
  }
  const nx = PICK_AT.find(t => t > D.turns[c]);
  meta.push('<span>' + (nx ? '다음 증강까지 <b>' + (nx - D.turns[c]) + '턴</b>' : '증강 모두 받음') + '</span>');
  let tag = '';
  if (mode === 'online') {
    const seat = room && room.seats && room.seats[c];
    const live = !!(seat && room.online && room.online[seat]);
    tag = (me === c ? '<span class="you">나</span>' : '') + '<span class="net ' + (!seat ? 'empty' : live ? 'live' : 'off') + '">' + (!seat ? '빈 자리' : live ? '접속 중' : '오프라인') + '</span>';
  }
  return '<div class="who"><span class="disc ' + c + '"></span><h3>' + nm(c) + '</h3>' + tag + '</div><div class="chips">' + chips + '</div><div class="meta">' + meta.join('') + '</div>';
}
function statusHTML(D) {
  if (!S) return '<h2>방에 연결하는 중…</h2><p>' + esc(netErr || '잠시만 기다려 주세요.') + '</p>' + (netErr ? '<div class="row"><button type="button" id="bLeave">한 화면 모드로</button></div>' : '');
  const online = mode === 'online';
  let st = '';
  if (D.winner) {
    const res = D.winner === 'draw' ? '무승부' : (online && me ? (D.winner === me ? '승리!' : '패배') + ' · ' + nm(D.winner) + ' 승' : nm(D.winner) + ' 승리');
    st = '<h2>' + res + '</h2><p>' + esc(D.reason) + '</p>';
    if (!online || me) st += '<div class="row"><button type="button" id="bAgain">' + (online ? '재대국 (색 바꿔서)' : '새 게임') + '</button></div>';
  } else if (online && !seated()) {
    st = '<h2>상대를 기다리는 중</h2><p>아래 링크를 상대에게 보내세요. 들어오면 바로 시작합니다.</p>';
  } else if (D.pick) {
    const mine = !online || D.pick.c === me;
    st = '<h2>' + (mine ? nm(D.pick.c) + ' 증강 선택 중' : me ? '상대가 증강을 고르는 중' : nm(D.pick.c) + '이 증강을 고르는 중') + '</h2><p>' + (+D.pick.r || '') + '라운드 · ' + (TIER_KO[D.pick.tier] || '') + ' 등급</p>';
  } else {
    const head = online ? (me ? (D.turn === me ? '내 차례' : '상대 차례') + ' · ' + nm(D.turn) : nm(D.turn) + ' 차례 (관전 중)') : nm(D.turn) + ' 차례';
    st = '<h2>' + head + '</h2>' + (inCheck ? '<p class="err">' + nm(D.turn) + ' 킹이 공격받고 있습니다. 피하지 않으면 잡힙니다.</p>' : '');
    const myMove = !online || D.turn === me;
    let hint = '말을 눌러 갈 수 있는 칸을 보세요.';
    if (D.dblTurn) hint = D.sub ? '연속 행동: 두 번째 수를 두거나 넘기세요.' : '연속 행동 턴: 첫 수로 상대 킹을 공격하면 턴이 끝납니다.';
    else if (!sel && myMove) hint = '말을 눌러 갈 수 있는 칸을 보세요. 빨간 점은 두면 내 킹이 잡힐 수 있는 칸입니다.';
    else if (sel && sel.drop) hint = '놓을 빈칸을 고르세요.';
    else if (online && !myMove) hint = '상대가 두기를 기다리는 중입니다.';
    st += '<p>' + hint + '</p>';
    if (!online || me) {
      st += '<div class="row">' + (D.sub && myMove ? '<button type="button" id="bSkip">두 번째 수 넘기기</button>' : '') +
        '<button type="button" id="bDraw">' + (online ? '무승부 제안' : '무승부 합의') + '</button>' +
        '<button type="button" id="bResign">' + (online ? '기권' : nm(D.turn) + ' 기권') + '</button></div>';
    }
  }
  if (online && room && room.req && me) {
    const q = room.req, what = q.type === 'undo' ? '무르기' : '무승부';
    st += q.by === me
      ? '<div class="req"><p>' + what + ' 요청을 보냈습니다. 상대의 답을 기다리는 중입니다.</p><div class="row"><button type="button" id="bCancel">요청 취소</button></div></div>'
      : '<div class="req"><p>상대가 <b>' + what + '</b>를 요청했습니다.</p><div class="row"><button type="button" id="bYes">수락</button><button type="button" id="bNo">거절</button></div></div>';
  }
  if (pending) st += '<p class="mute">저장 중…</p>';
  if (netErr && S) st += '<p class="err">' + esc(netErr) + '</p>';
  return st;
}
function roomHTML() {
  if (mode === 'online') {
    const me2 = me ? nm(me) : '관전자';
    return '<h3>온라인 방 <span class="code">' + esc(roomId) + '</span></h3>' +
      '<p class="mute">나: ' + me2 + (NETKIND === 'mem' ? ' · 테스트 모드(같은 브라우저 탭끼리)' : '') + '</p>' +
      '<div class="linkrow"><input id="roomLink" readonly value="' + esc(roomLink(roomId)) + '" aria-label="방 링크"><button type="button" id="bCopy">' + (copied ? '복사됨' : '링크 복사') + '</button></div>' +
      '<div class="row"><button type="button" id="bLeave">방 나가기 (한 화면 모드)</button></div>';
  }
  if (!ONLINE_READY) {
    return '<h3>온라인 대전</h3><p class="mute">js/config.js에 Firebase 설정을 넣으면 켜집니다. docs/setup.md를 보세요.</p>';
  }
  return '<h3>온라인 대전</h3><p class="mute">방을 만들면 링크가 생깁니다. 상대가 그 링크로 들어오면 남은 색 자리에 앉습니다.</p>' +
    '<div class="row"><button type="button" data-make="w">백으로 방 만들기</button><button type="button" data-make="b">흑으로</button><button type="button" data-make="r">무작위</button></div>' +
    (netErr ? '<p class="err">' + esc(netErr) + '</p>' : '');
}
function logHTML(D) {
  let lg = '', k = 0, col = 0;
  const pad = () => { while (col % 3) { lg += '<span></span>'; col++; } col = 0; };
  for (const e of D.log) {
    if (e.aug || e.sub) { pad(); lg += '<span class="n">' + (e.aug ? '✦' : '+') + '</span><span style="grid-column:span 2"' + (e.aug ? ' class="mute"' : '') + '>' + nm(e.c) + ' ' + esc(e.t) + '</span>'; continue; }
    if (e.c === 'w') { pad(); k++; lg += '<span class="n">' + k + '.</span><span>' + esc(e.t) + '</span>'; col = 2; }
    else { if (col !== 2) { pad(); lg += '<span class="n">' + (k || 1) + '…</span><span></span>'; } lg += '<span>' + esc(e.t) + '</span>'; col = 0; }
  }
  return lg || '<span class="mute" style="grid-column:1/-1">아직 둔 수가 없습니다.</span>';
}
function render() {
  const D = S || initial();
  renderBoard(D);
  const top = flip ? 'w' : 'b', bot = flip ? 'b' : 'w';
  for (const [id, c] of [['tTop', top], ['tBot', bot]]) {
    const el = $(id);
    el.innerHTML = trayHTML(D, c);
    el.classList.toggle('on', !!S && !D.winner && !D.pick && D.turn === c);
  }
  $('status').innerHTML = statusHTML(D);
  $('room').innerHTML = roomHTML();
  $('log').innerHTML = logHTML(D);
  $('log').scrollTop = 1e6;
  const bu = $('bUndo');
  bu.textContent = mode === 'online' ? '무르기 요청' : '무르기';
  bu.disabled = mode === 'online' ? !me || !room || !(room.hist || []).length || !!room.req || pending || !S || !!S.winner : !H.length;
  $('bNew').hidden = mode === 'online';
  renderModal(D);
}
function renderModal(D) {
  const ov = $('ov'), d = $('dlg');
  if (showStart && mode === 'local') {
    d.innerHTML = '<h2>어떻게 둘까요?</h2><p>온라인은 방을 만들고 링크를 상대에게 보내면 됩니다.</p>' +
      '<div class="start"><div><h3>한 화면에서 둘이</h3><p class="mute">한 기기를 번갈아 씁니다.</p><div class="row"><button type="button" id="bLocal">이대로 시작</button></div></div>' +
      '<div><h3>온라인 대전</h3><p class="mute">내 색을 고르면 방이 만들어집니다.</p><div class="row"><button type="button" data-make="w">백</button><button type="button" data-make="b">흑</button><button type="button" data-make="r">무작위</button></div></div></div>' +
      (netErr ? '<p class="err">' + esc(netErr) + '</p>' : '');
    ov.hidden = false; return;
  }
  if (promoMs) {
    const c = cc(D.turn);
    d.innerHTML = '<h2>승급할 말을 고르세요</h2><div class="promo">' + 'qrbn'.split('').map(t => '<button type="button" data-pr="' + t + '"><span class="pc ' + c + '" style="font-size:44px">' + GLYPH[t] + '</span></button>').join('') + '<button type="button" data-pr="x" style="font-size:16px">취소</button></div>';
    ov.hidden = false; return;
  }
  const P = S && !S.winner && S.pick;
  if (P && P.opts && (mode === 'local' || (P.c === me && seated()))) {
    const c = P.c, o = oth(c);
    const oa = D.aug[o].filter(id => AUG[id]).map(id => AUG[id].name).join(', ') || '없음';
    const opts = P.opts.filter(id => AUG[id]);
    d.innerHTML = '<h2>' + nm(c) + ' · ' + (+P.r) + '라운드 증강</h2><p>' + (TIER_KO[P.tier] || '') + ' 라운드입니다. 한 장을 고르세요. 증강은 지금부터 효과가 나고, "즉시" 증강은 고르는 순간 판이 바뀝니다.</p><div class="deal">' +
      opts.map(id => '<button type="button" class="aug ' + AUG[id].tier + '" data-aug="' + id + '"' + (pending ? ' disabled' : '') + '><span class="tier">' + CAT_KO[AUG[id].cat] + ' · ' + TIER_KO[AUG[id].tier] + (AUG[id].instant ? ' · 즉시' : '') + '</span><h3>' + esc(AUG[id].name) + '</h3><p>' + esc(AUG[id].desc) + '</p></button>').join('') +
      '</div><p class="opp">' + nm(o) + '의 증강: ' + esc(oa) + '</p>' +
      (mode === 'local' && ONLINE_READY && !D.log.length ? '<div class="row"><button type="button" id="bStart">온라인 대전으로 바꾸기</button></div>' : '');
    ov.hidden = false; return;
  }
  ov.hidden = true; d.innerHTML = '';
}

const CAT_WHEN = {open: '1라운드에만', mid: '2·3라운드', end: '3·4라운드', piece: '모든 라운드', rule: '모든 라운드'};
$('cat').innerHTML = Object.keys(CAT_KO).map(k => '<h4>' + CAT_KO[k] + ' <span class="mute">' + CAT_WHEN[k] + '</span></h4>' +
  Object.values(AUG).filter(a => a.cat === k).sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]).map(a => '<div class="' + a.tier + '"><b>' + esc(a.name) + '</b> · ' + TIER_KO[a.tier] + (a.instant ? ' · 즉시' : '') + '<br>' + esc(a.desc) + '</div>').join('')).join('');

/* ---------- 시작 ---------- */
(async function boot() {
  const rid = (params.get('room') || '').toUpperCase();
  if (/^[A-Z2-9]{6}$/.test(rid)) {
    mode = 'online'; roomId = rid; S = null; render();
    const n = await ensureNet();
    if (!n) { render(); return; }
    enterRoom(rid);
    return;
  }
  restoreLocal(true);
})();
