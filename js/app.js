// 화면과 진행.
// 한 화면 모드: 상태 S를 바로 바꾸고 무르기용 기록(H)을 남긴다.
// 온라인 모드: 방에는 "누가 무엇을 했는지"(행동 기록)만 쌓는다. 각 브라우저가 방의 시드로 처음부터 다시 두어 보며
//   모든 행동을 엔진으로 검사한다. 규칙에 없는 수, 차례가 아닌 수, 지난 기록을 몰래 바꾼 흔적이 보이면 그 판을 멈추고 알린다.
import {setRng, seededRng, AUG, CAT_KO, TIER_KO, TIER_RANK, GLYPH, VAL, HILL, PICK_AT, HUNT_GOAL, oth, has, alive, rankOf, initial, apply, inDanger, legal, tick, instant, offers, rollTier, sqName, note} from './engine.js?v=6';
import {connect, TIME} from './net.js?v=6';
import {firebaseConfig} from './config.js?v=6';

const MARK = {p: ['pawn2', 'pawnBack', 'pawnSide', 'battlePromo', 'earlyPromo'], n: ['centaur', 'nightrider'], b: ['archbishop', 'wazirBishop'], r: ['chancellor', 'cannon'], q: ['amazon'], k: ['stride', 'knightKing']};
const $ = id => document.getElementById(id);
const nm = c => (c === 'w' ? '백' : '흑');
const cc = c => (c === 'w' ? 'w' : 'b');
const esc = v => String(v).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const params = new URLSearchParams(location.search);
const NETKIND = params.get('net') === 'mem' ? 'mem' : 'firebase';
const ONLINE_READY = NETKIND === 'mem' || !!firebaseConfig;
const LS = 'augchess-local';
const ROOM_RE = /^[A-Z2-9]{6}$/;
const HOUR = 3600000;

let S = null, H = [], LM = [], inCheck = false, sel = null, flip = false, promoMs = null;
// 온라인
let mode = 'local', net = null, roomId = null, room = null, me = null, lastMe = undefined;
let pending = false, claiming = false, presenceOn = false, netErr = '', copied = false, showStart = false;
let known = [];          // 내가 확인한 행동 기록 ("uid|행동" 문자열)
let cache = null;        // known까지 다시 둔 결과 {n, s: JSON}
let tamper = '';         // 규칙 위반/변조를 감지하면 그 설명
let undoAsked = false;   // 내가 무르기를 요청했는가
let myTruncate = -1;     // 내가 무르기를 수락하며 자른 길이

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
  S.pick = {c: q.c, r: q.r, tier, opts: offers(S, q.c, tier, q.r)};
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
  S.drawOffer = null;
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

/* ---------- 한 화면 모드 ---------- */
function act(fn) {
  if (!S || S.winner) return;
  setRng(null);
  const before = JSON.stringify(S);
  S = JSON.parse(before);
  fn();
  sel = null; promoMs = null;
  H.push(before); if (H.length > 200) H.shift();
  saveLocal(); view();
}
function fixState(s) { if (s && !s.kills) s.kills = {w: 0, b: 0}; return s; }
function saveLocal() { try { localStorage.setItem(LS, JSON.stringify({S, H: H.slice(-60)})); } catch {} }

/* ---------- 온라인: 행동 기록 다시 두기와 검사 ---------- */
const seated = () => !!(room && room.seats && room.seats.w && room.seats.b);
const colorOf = (seats, uid) => (seats && seats.w === uid ? 'w' : seats && seats.b === uid ? 'b' : null);
const sameMove = (x, y) => x.from === y.from && x.to === y.to && (x.promo || '') === (y.promo || '') && (x.drop || '') === (y.drop || '') && (x.castle || '') === (y.castle || '');
const moveFields = m => { const o = {to: m.to}; for (const k of ['from', 'promo', 'drop', 'castle']) if (m[k] !== undefined) o[k] = m[k]; return o; };
const keyOf = x => x.u + '|' + x.a;

// 방의 행동 목록을 배열로 (Firebase는 배열을 객체로 돌려줄 때가 있다). 번호가 비어 있으면 null.
function toList(v) {
  if (!v) return [];
  let arr;
  if (Array.isArray(v)) arr = v;
  else {
    const ks = Object.keys(v).sort((a, b) => a - b);
    if (ks.some((k, i) => k !== String(i))) return null;
    arr = ks.map(k => v[k]);
  }
  for (const x of arr) if (!x || typeof x.u !== 'string' || typeof x.a !== 'string') return null;
  return arr;
}
const knownList = () => known.map(k => ({u: k.slice(0, k.indexOf('|')), a: k.slice(k.indexOf('|') + 1)}));
function initialFor(seed) { setRng(seededRng(seed, -1)); freshGame(); }
// k번째 행동을 S에 적용한다. 규칙에 맞지 않으면 이유를 돌려준다.
function stepAction(k, x, seats, seed) {
  const c = colorOf(seats, x.u);
  if (!c) return '좌석에 없는 사람의 행동';
  let a; try { a = JSON.parse(x.a); } catch { return '읽을 수 없는 행동'; }
  if (!a || typeof a !== 'object') return '읽을 수 없는 행동';
  if (S.winner) return '끝난 판에 들어온 행동';
  setRng(seededRng(seed, k));
  switch (a.t) {
    case 'm': {
      if (S.pick || S.turn !== c) return '차례가 아닌 수';
      const m = a.m && legal(S, c).find(y => sameMove(y, a.m));
      if (!m) return '규칙에 없는 수';
      moveCore(m); break;
    }
    case 'p':
      if (!S.pick || S.pick.c !== c || !S.pick.opts.includes(a.id)) return '받을 수 없는 증강';
      chooseCore(a.id); break;
    case 's':
      if (S.pick || S.turn !== c || !S.sub) return '넘길 수 없는 차례';
      endTurn(); break;
    case 'r': S.winner = oth(c); S.reason = nm(c) + ' 기권'; break;
    case 'do': if (S.drawOffer) return '겹친 무승부 제안'; S.drawOffer = c; break;
    case 'da': if (!S.drawOffer || S.drawOffer === c) return '제안 없는 무승부 수락'; S.winner = 'draw'; S.reason = '합의 무승부'; S.drawOffer = null; break;
    case 'dn': if (!S.drawOffer || S.drawOffer === c) return '제안 없는 거절'; S.drawOffer = null; break;
    default: return '알 수 없는 행동';
  }
  return '';
}
// 무르기를 하면 몇 번째 행동까지 남는가: 요청한 사람의 마지막 수 바로 앞
function undoTarget(list, seats, by) {
  for (let j = list.length - 1; j >= 0; j--) {
    if (colorOf(seats, list[j].u) !== by) continue;
    try { if (JSON.parse(list[j].a).t === 'm') return j; } catch {}
  }
  return -1;
}
function flagTamper(why, badColor) {
  tamper = why;
  if (S && !S.winner) {
    S.winner = badColor ? oth(badColor) : 'draw';
    S.reason = '규칙 위반 감지: ' + why + (badColor ? ' (' + nm(badColor) + ')' : '');
  }
}
// 방 기록을 검사하고 S를 다시 만든다
function syncActions(r) {
  const list = toList(r.actions);
  const opp = me ? oth(me) : null;
  if (list === null) { flagTamper('행동 기록 형식이 깨짐', opp); return; }
  const keys = list.map(keyOf);
  const m = Math.min(known.length, keys.length);
  for (let i = 0; i < m; i++) if (known[i] !== keys[i]) { flagTamper('지난 기록이 바뀜 (' + (i + 1) + '번째 행동)', opp); return; }
  if (keys.length < known.length) {
    const target = undoTarget(knownList(), r.seats, me);
    const ok = (undoAsked && keys.length === target) || keys.length === myTruncate;
    undoAsked = false; myTruncate = -1;
    if (!ok) { flagTamper('기록이 허락 없이 지워짐', opp); return; }
    cache = null;
  }
  let start = 0;
  if (cache && cache.n <= keys.length && cache.n <= known.length) { S = JSON.parse(cache.s); start = cache.n; }
  else initialFor(r.seed);
  for (let k = start; k < list.length; k++) {
    const err = stepAction(k, list[k], r.seats, r.seed);
    if (err) { known = keys.slice(0, k); cache = null; flagTamper(err + ' (' + (k + 1) + '번째 행동)', colorOf(r.seats, list[k].u)); return; }
  }
  known = keys;
  cache = {n: keys.length, s: JSON.stringify(S)};
}

/* ---------- 온라인: 방 ---------- */
async function ensureNet() {
  if (net) return net;
  try { net = await connect(firebaseConfig, NETKIND); }
  catch (e) { netErr = '온라인 서버에 연결하지 못했습니다: ' + e.message; }
  if (!net && !netErr) netErr = 'js/config.js에 Firebase 설정이 없습니다.';
  return net;
}
const ID_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randStr = (n, ch) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, v => ch[v % ch.length]).join(''); };
const roomLink = id => location.origin + location.pathname + '?room=' + id + (NETKIND === 'mem' ? '&net=mem' : '');

// 방을 만든다. seats: 내 자리, reserved: 재대국에서 두 사람 자리를 미리 잡아 둘 때
async function makeRoom(seats, reserved) {
  const n = await ensureNet();
  if (!n) return null;
  for (let tries = 0; tries < 4; tries++) {
    const id = randStr(6, ID_CH);
    const r = {seats, seed: randStr(16, ID_CH), createdBy: n.uid, createdAt: TIME, updatedAt: TIME};
    if (reserved) r.reserved = reserved;
    const res = await n.create(id, r).catch(() => 'denied');
    if (res === 'ok') { sweep(); return id; }
    if (res === 'denied') { netErr = '방은 20초에 하나씩만 만들 수 있습니다. 잠시 뒤 다시 시도해 주세요.'; return null; }
  }
  netErr = '방을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
  return null;
}
// 오래된 방 정리: 끝나고 1시간, 또는 24시간 동안 아무도 안 둔 방 (보안 규칙도 같은 조건만 허락한다)
async function sweep() {
  try {
    const now = Date.now(), slack = 5 * 60000;
    const list = await net.staleRooms(now - HOUR - slack, 10);
    for (const {id, r} of list) {
      if (!r || typeof r.updatedAt !== 'number') continue;
      if ((r.done === true && r.updatedAt < now - HOUR - slack) || r.updatedAt < now - 24 * HOUR - slack) net.remove(id).catch(() => {});
    }
  } catch {}
}
async function createRoom(color) {
  netErr = '';
  const n = await ensureNet();
  if (!n) { view(); return; }
  const c = color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
  const id = await makeRoom({[c]: n.uid});
  if (!id) { view(); return; }
  history.replaceState(null, '', roomLink(id));
  enterRoom(id);
}
function enterRoom(id) {
  mode = 'online'; roomId = id; H = []; presenceOn = false; known = []; cache = null; tamper = ''; room = null; S = null;
  const timer = setTimeout(() => { if (!room) { netErr = '방 정보를 받아 오지 못했습니다. 링크를 확인해 주세요.'; view(); } }, 10000);
  net.subscribe(id, r => { clearTimeout(timer); room = r; if (!pending) processRoom(); }, e => { netErr = '방을 읽지 못했습니다: ' + e.message; view(); });
  view();
}
function processRoom() {
  const r = room;
  if (!r) { netErr = '방을 찾을 수 없습니다. 오래되어 정리되었을 수 있습니다.'; S = null; view(); return; }
  if (typeof r.seed !== 'string' || !r.seats || typeof r.seats !== 'object') { netErr = '방 데이터가 올바르지 않습니다.'; view(); return; }
  if (typeof r.next === 'string' && ROOM_RE.test(r.next)) { location.replace(roomLink(r.next)); return; }
  me = colorOf(r.seats, net.uid);
  if (!me && !claiming && (!r.seats.w || !r.seats.b)) claimSeat(r);
  if (me !== lastMe) { flip = me === 'b'; lastMe = me; }
  if (me && !presenceOn) { net.presence(roomId, net.uid); presenceOn = true; }
  if (!tamper) { syncActions(r); sel = null; promoMs = null; }
  if (!r.req) undoAsked = false; // 기록이 잘리지 않고 요청만 사라졌다면 거절된 것
  view();
}
function claimSeat(r) {
  const c = !r.seats.w ? 'w' : !r.seats.b ? 'b' : null;
  if (!c) return;
  if (r.reserved && r.reserved[c] !== net.uid) return; // 재대국 방: 원래 두 사람만 앉는다
  claiming = true;
  net.patch(roomId, {['seats/' + c]: net.uid}).catch(() => {}).finally(() => { claiming = false; });
}
// 내 행동을 보낸다: 먼저 내 화면에서 규칙대로 둬 보고, 통과하면 방에 다음 번호로 붙인다
function send(a) {
  if (pending || tamper || !me || !seated() || !room) return;
  const before = JSON.stringify(S), k = known.length;
  const x = {u: net.uid, a: JSON.stringify(a)};
  const err = stepAction(k, x, room.seats, room.seed);
  if (err) { S = JSON.parse(before); netErr = '보낼 수 없는 행동입니다: ' + err; view(); return; }
  const extra = {updatedAt: TIME};
  if (S.winner) extra.done = true;
  if (room.req && a.t === 'm') extra.req = null;
  pending = true; sel = null; promoMs = null; netErr = ''; view();
  net.append(roomId, k, x, extra).then(ok => {
    if (!ok) netErr = '상대의 행동과 겹쳐서 반영하지 못했습니다. 다시 시도해 주세요.';
  }).catch(e => { netErr = '보내지 못했습니다: ' + e.message; })
    .finally(() => { pending = false; S = cache ? JSON.parse(cache.s) : S; processRoom(); });
}
function sendReq(type) {
  if (!me || pending || !room || room.req) return;
  undoAsked = type === 'undo';
  net.patch(roomId, {req: {type, by: me}}).catch(() => { undoAsked = false; });
}
function cancelReq() { if (room && room.req && room.req.by === me) net.patch(roomId, {req: null}).catch(() => {}); }
function answerReq(yes) {
  const q = room && room.req;
  if (!q || q.by === me || !me) return;
  if (!yes || q.type !== 'undo') { net.patch(roomId, {req: null}).catch(() => {}); return; }
  const list = knownList();
  const j = undoTarget(list, room.seats, q.by);
  if (j < 0) { net.patch(roomId, {req: null}).catch(() => {}); return; }
  const p = {req: null, updatedAt: TIME};
  for (let i = j; i < list.length; i++) p['actions/' + i] = null;
  myTruncate = j;
  net.patch(roomId, p).catch(e => { myTruncate = -1; netErr = '무르기를 반영하지 못했습니다: ' + e.message; view(); });
}
// 재대국: 색을 바꾼 새 방을 만들고 지금 방에 다음 방을 적는다. 두 사람 모두 자동으로 옮겨 간다.
async function rematch() {
  if (!me || !S || !S.winner || !room) return;
  const opp = room.seats[oth(me)];
  const id = await makeRoom({[oth(me)]: net.uid}, {[oth(me)]: net.uid, [me]: opp});
  if (!id) { view(); return; }
  await net.patch(roomId, {next: id}).catch(() => {});
  location.replace(roomLink(id));
}

/* ---------- 입력 ---------- */
function doMove(m) {
  if (mode === 'local') act(() => moveCore(m));
  else send({t: 'm', m: moveFields(m)});
}
function clickSq(x) {
  if (!S || S.winner || S.pick || promoMs || !LM.length) return;
  const c = S.turn, p = S.board[x];
  if (sel) {
    const ms = LM.filter(m => (sel.drop ? m.drop === sel.drop : m.from === sel.from) && m.to === x);
    if (ms.length) {
      if (ms[0].promo) { promoMs = ms; render(); }
      else if (ms.length > 1) doMove(ms.find(m => m.castle) || ms[0]);
      else doMove(ms[0]);
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
  setRng(null); freshGame(); saveLocal(); view();
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
  const a = t.closest('[data-aug]');
  if (a && !a.disabled) {
    const id = a.dataset.aug;
    if (mode === 'local') act(() => chooseCore(id)); else send({t: 'p', id});
    return;
  }
  const pr = t.closest('[data-pr]');
  if (pr) {
    const ms = promoMs; promoMs = null;
    if (pr.dataset.pr === 'x') { render(); return; }
    doMove(ms.find(x => x.promo === pr.dataset.pr));
    return;
  }
  const mk = t.closest('[data-make]'); if (mk) { showStart = false; createRoom(mk.dataset.make); return; }
  const b = t.closest('button'); if (!b) return;
  const online = mode === 'online';
  switch (b.id) {
    case 'bSkip': if (online) send({t: 's'}); else act(() => endTurn()); break;
    case 'bDraw': if (online) send({t: 'do'}); else act(() => { S.winner = 'draw'; S.reason = '합의 무승부'; }); break;
    case 'bDrawYes': send({t: 'da'}); break;
    case 'bDrawNo': send({t: 'dn'}); break;
    case 'bResign': if (online) send({t: 'r'}); else { const c = S.turn; act(() => { S.winner = oth(c); S.reason = nm(c) + ' 기권'; }); } break;
    case 'bAgain': case 'bNew': newGame(); break;
    case 'bFlip': flip = !flip; render(); break;
    case 'bUndo': undo(); break;
    case 'bYes': answerReq(true); break;
    case 'bNo': answerReq(false); break;
    case 'bCancel': cancelReq(); break;
    case 'bLocal': showStart = false; render(); break;
    case 'bStart': showStart = true; render(); break;
    case 'bCopy': navigator.clipboard.writeText(roomLink(roomId)).then(() => { copied = true; render(); setTimeout(() => { copied = false; render(); }, 1600); }).catch(() => { const i = $('roomLink'); if (i) i.select(); }); break;
    case 'bLeave': location.href = location.pathname + (NETKIND === 'mem' ? '?net=mem' : ''); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (sel || promoMs)) { sel = null; promoMs = null; render(); } });

/* ---------- 화면 ---------- */
function view() {
  LM = []; inCheck = false;
  if (S && !S.winner && !S.pick) {
    inCheck = inDanger(S, S.turn);
    const mine = mode === 'local' || (me && S.turn === me && seated() && !tamper);
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
        '<button type="button" id="bDraw"' + (D.drawOffer ? ' disabled' : '') + '>' + (online ? '무승부 제안' : '무승부 합의') + '</button>' +
        '<button type="button" id="bResign">' + (online ? '기권' : nm(D.turn) + ' 기권') + '</button></div>';
    }
  }
  if (online && me && D.drawOffer && !D.winner) {
    st += D.drawOffer === me
      ? '<div class="req"><p>무승부를 제안했습니다. 상대의 답을 기다리는 중입니다. 다음 수를 두면 제안은 사라집니다.</p></div>'
      : '<div class="req"><p>상대가 <b>무승부</b>를 제안했습니다.</p><div class="row"><button type="button" id="bDrawYes">수락</button><button type="button" id="bDrawNo">거절</button></div></div>';
  }
  if (online && room && room.req && room.req.type === 'undo' && me && !D.winner) {
    st += room.req.by === me
      ? '<div class="req"><p>무르기를 요청했습니다. 상대의 답을 기다리는 중입니다.</p><div class="row"><button type="button" id="bCancel">요청 취소</button></div></div>'
      : '<div class="req"><p>상대가 <b>무르기</b>를 요청했습니다. 수락하면 상대의 마지막 수 이전으로 돌아갑니다.</p><div class="row"><button type="button" id="bYes">수락</button><button type="button" id="bNo">거절</button></div></div>';
  }
  if (tamper) st += '<p class="err">상대 쪽에서 규칙에 어긋난 데이터가 들어와 이 판을 멈췄습니다. 재대국이나 새 방으로 다시 시작해 주세요.</p>';
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
  bu.disabled = mode === 'online' ? !me || !room || !!room.req || pending || !S || !!S.winner || !!tamper || undoTarget(knownList(), room.seats, me) < 0 : !H.length;
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
  if (P && P.opts && (mode === 'local' || (P.c === me && seated() && !tamper))) {
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
  if (ROOM_RE.test(rid)) {
    mode = 'online'; roomId = rid; S = null; render();
    const n = await ensureNet();
    if (!n) { render(); return; }
    enterRoom(rid);
    return;
  }
  restoreLocal(true);
})();
