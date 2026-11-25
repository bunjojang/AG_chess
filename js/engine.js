// AG Chess 규칙 엔진 (v2)
// - 승리: 상대 킹을 잡거나(폭발 포함) 증강의 특수 승리 조건을 채운다. 체크메이트는 없다.
// - 킹을 공격받는 칸에 둬도 된다. 다만 상대가 잡으면 진다. 둘 수 있는 수가 없으면 그 쪽이 진다.
// - 증강은 라운드마다 나올 수 있는 분류가 다르다 (오프닝은 첫 라운드에만).
// UI·네트워크와 무관한 순수 함수만 둔다.

const CAT_KO = {open: '오프닝', mid: '미들', end: '엔드', piece: '기물', rule: '규칙'};
const ROUND_CATS = {1: ['open', 'piece', 'rule'], 2: ['mid', 'piece', 'rule'], 3: ['mid', 'end', 'piece', 'rule'], 4: ['end', 'piece', 'rule']};

const AUG = {
  // 오프닝: 첫 라운드에만, 고르는 즉시 배치가 바뀐다
  advance: {cat: 'open', tier: 'silver', instant: 1, name: '전진 배치', desc: '2랭크에 있는 내 폰이 모두 한 칸 앞에서 시작한다.'},
  reserve: {cat: 'open', tier: 'silver', instant: 1, name: '예비 병력', desc: '3랭크(흑은 6랭크) c·f 칸에 내 폰을 하나씩 더 둔다.'},
  develop: {cat: 'open', tier: 'silver', instant: 1, name: '빠른 전개', desc: '내 나이트 둘이 c3·f3(흑은 c6·f6)에 나간 채 시작한다.'},
  shuffle: {cat: 'open', tier: 'silver', instant: 1, name: '혼돈의 진형', desc: '첫 줄의 내 나이트·비숍·퀸 자리가 무작위로 섞인다.'},
  cavalry: {cat: 'open', tier: 'gold', instant: 1, name: '기병대', desc: 'b·g 파일의 내 폰 두 개가 나이트로 바뀐다. 잡히면 폰으로 친다.'},
  royalGuard: {cat: 'open', tier: 'gold', instant: 1, name: '근위대', desc: '내 킹과 킹 양옆 기물에 보호막이 생긴다.'},
  secondQueen: {cat: 'open', tier: 'prism', instant: 1, name: '제2 왕비', desc: '3랭크(흑은 6랭크) d칸에 내 퀸을 하나 더 둔다.'},
  // 기물: 어느 라운드에나
  pawn2: {cat: 'piece', tier: 'silver', name: '돌격 폰', desc: '폰이 어느 칸에서든 2칸 전진할 수 있다. 이때도 앙파상 대상이 된다.'},
  pawnBack: {cat: 'piece', tier: 'silver', name: '후퇴하는 폰', desc: '폰이 잡지 않고 한 칸 뒤로 물러날 수 있다. 내 첫 줄로는 못 간다.'},
  pawnSide: {cat: 'piece', tier: 'silver', name: '옆걸음 폰', desc: '폰이 잡지 않고 좌우로 한 칸 움직일 수 있다.'},
  centaur: {cat: 'piece', tier: 'silver', name: '켄타우로스', desc: '나이트가 킹처럼 한 칸씩도 움직인다.'},
  wazirBishop: {cat: 'piece', tier: 'silver', name: '색 바꾸는 비숍', desc: '비숍이 상하좌우로 한 칸도 움직인다. 다른 색 칸으로 갈 수 있다.'},
  stride: {cat: 'piece', tier: 'silver', name: '왕의 보폭', desc: '킹이 직선·대각선으로 2칸까지 움직인다. 중간 칸이 막히면 불가.'},
  queenShield: {cat: 'piece', tier: 'silver', instant: 1, name: '왕비의 방패', desc: '내 퀸에 보호막이 생긴다.'},
  archbishop: {cat: 'piece', tier: 'gold', name: '대주교', desc: '비숍이 나이트 이동도 할 수 있다.'},
  chancellor: {cat: 'piece', tier: 'gold', name: '기병 룩', desc: '룩이 나이트 이동도 할 수 있다.'},
  nightrider: {cat: 'piece', tier: 'gold', name: '나이트라이더', desc: '나이트가 같은 방향으로 막힐 때까지 연달아 뛸 수 있다.'},
  cannon: {cat: 'piece', tier: 'gold', name: '포격 룩', desc: '룩이 기물 하나를 넘어 그 뒤의 첫 상대 기물을 잡을 수 있다. 장기의 포와 같다.'},
  knightKing: {cat: 'piece', tier: 'gold', name: '기사 킹', desc: '킹이 나이트처럼도 움직인다.'},
  kingShield: {cat: 'piece', tier: 'gold', instant: 1, name: '왕의 갑옷', desc: '내 킹에 보호막이 생긴다.'},
  amazon: {cat: 'piece', tier: 'prism', name: '아마존', desc: '퀸이 나이트 이동도 할 수 있다.'},
  // 미들: 2·3라운드
  revive: {cat: 'mid', tier: 'silver', instant: 1, name: '부활', desc: '잃은 말 중 가장 강한 하나가 원래 자리(막혔으면 같은 줄 빈칸)에 되살아난다.'},
  conscript: {cat: 'mid', tier: 'silver', instant: 1, name: '징집', desc: '내 2랭크(흑은 7랭크) 빈칸에 폰 2개를 둔다.'},
  drop: {cat: 'mid', tier: 'gold', name: '드롭', desc: '이후 잡은 말이 손패에 들어온다. 한 수를 써서 빈칸에 놓을 수 있다. 폰은 첫 줄·끝 줄과 승급 칸에 못 놓는다.'},
  double: {cat: 'mid', tier: 'gold', name: '연속 행동', desc: '세 번째 턴마다 두 수를 둔다. 첫 수로 상대 킹을 공격하면 거기서 턴이 끝난다.'},
  freeze: {cat: 'mid', tier: 'gold', instant: 1, name: '빙결', desc: '상대의 가장 강한 기물(킹 제외)이 상대 차례 2번 동안 움직이지 못한다.'},
  mutual: {cat: 'mid', tier: 'gold', name: '동귀어진', desc: '내 퀸이나 룩을 잡은 상대 기물은 함께 사라진다. 킹은 예외.'},
  battlePromo: {cat: 'mid', tier: 'gold', name: '전투 승진', desc: '내 폰이 기물을 잡으면 그 자리에서 나이트가 된다.'},
  atomic: {cat: 'mid', tier: 'prism', name: '원자 포격', desc: '내가 잡으면 폭발한다. 잡은 말과 주변 8칸의 폰 아닌 말이 모두 사라진다. 내 킹이 휘말리는 포획은 불가.'},
  grandRevive: {cat: 'mid', tier: 'prism', instant: 1, name: '대부활', desc: '잃은 말 중 가장 강한 둘이 되살아난다.'},
  // 엔드: 3·4라운드
  lastCharge: {cat: 'end', tier: 'silver', instant: 1, name: '총공격', desc: '내 폰이 앞에서부터 한 칸씩 전진한다. 끝 줄에 닿으면 퀸이 된다.'},
  sniper: {cat: 'end', tier: 'silver', instant: 1, name: '저격', desc: '가장 앞으로 나온 상대 폰 하나를 없앤다.'},
  earlyPromo: {cat: 'end', tier: 'silver', name: '조기 승급', desc: '폰이 6랭크(흑은 3랭크) 이상에 닿으면 바로 승급한다.'},
  fieldPromo: {cat: 'end', tier: 'gold', instant: 1, name: '야전 진급', desc: '가장 앞선 내 폰 하나가 퀸이 된다.'},
  kingMarch: {cat: 'end', tier: 'gold', name: '왕의 행진', desc: '내 킹이 상대 첫 줄(백은 8랭크, 흑은 1랭크)에 들어가면 승리.'},
  hill: {cat: 'end', tier: 'prism', name: '언덕의 왕', desc: '내 킹이 중앙 4칸(d4·e4·d5·e5)에 들어가면 승리.'},
  finalPromo: {cat: 'end', tier: 'prism', instant: 1, name: '결전 진급', desc: '5랭크(흑은 4랭크)를 넘어선 내 폰이 모두 퀸이 된다.'},
  // 규칙: 어느 라운드에나
  threeCheck: {cat: 'rule', tier: 'gold', name: '3회 공격', desc: '이 증강을 받은 뒤 상대 킹을 공격하는 수를 3번 두면 승리.'},
  hunter: {cat: 'rule', tier: 'gold', name: '사냥꾼', desc: '이 증강을 받은 뒤 상대 기물을 6개 없애면 승리. 폭발로 없앤 것도 센다.'},
};
const TIER_KO = {silver: '실버', gold: '골드', prism: '프리즘'};
const TIER_RANK = {silver: 0, gold: 1, prism: 2};
const VS = '︎';
const GLYPH = {k: '♚' + VS, q: '♛' + VS, r: '♜' + VS, b: '♝' + VS, n: '♞' + VS, p: '♟' + VS};
const VAL = {k: 100, q: 9, r: 5, b: 3, n: 3, p: 1};
const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const HILL = [27, 28, 35, 36];
const PICK_AT = [6, 12, 18];
const HUNT_GOAL = 6;
const HOME = {q: [3], r: [0, 7], b: [2, 5], n: [1, 6], p: [8, 9, 10, 11, 12, 13, 14, 15]};
const oth = c => (c === 'w' ? 'b' : 'w');
const has = (s, c, id) => s.aug[c].includes(id);
const onB = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const alive = (B, c) => B.some(p => p && p.t === 'k' && p.c === c);
// 백 기준 칸 번호를 c의 시점으로 뒤집는다 (흑이면 랭크를 뒤집음)
const rel = (c, x) => (c === 'w' ? x : (7 - (x >> 3)) * 8 + (x & 7));
// c의 시점에서 몇 번째 랭크인지 (0 = 내 첫 줄)
const rankOf = (c, x) => (c === 'w' ? x >> 3 : 7 - (x >> 3));
// 난수: 온라인에서는 방의 시드로 만든 결정적 난수를 넣어, 두 브라우저가 같은 결과를 내게 한다.
let rnd = Math.random;
function setRng(f) { rnd = f || Math.random; }
// 시드 문자열 + 행동 번호로 난수 생성기를 만든다 (mulberry32)
function seededRng(seed, k) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function initial() {
  const B = Array(64).fill(null), back = 'rnbqkbnr';
  for (let f = 0; f < 8; f++) { B[f] = {c: 'w', t: back[f]}; B[8 + f] = {c: 'w', t: 'p'}; B[48 + f] = {c: 'b', t: 'p'}; B[56 + f] = {c: 'b', t: back[f]}; }
  return {board: B, turn: 'w', castle: {wK: true, wQ: true, bK: true, bQ: true}, ep: null, hand: {w: {}, b: {}}, checks: {w: 0, b: 0}, kills: {w: 0, b: 0}, aug: {w: [], b: []}, lost: {w: [], b: []}, turns: {w: 0, b: 0}, dbl: {w: 0, b: 0}, dblTurn: false, sub: 0, winner: null, reason: '', log: [], last: null, queue: [{c: 'w', r: 1}, {c: 'b', r: 1}], after: 'start', pick: null, tiers: {}};
}

function promoZone(s, c, sq) { return rankOf(c, sq) >= (has(s, c, 'earlyPromo') ? 5 : 7); }

/* ---------- 이동 생성 ---------- */
function gen(s, c, castle) {
  const M = [], B = s.board;
  for (let sq = 0; sq < 64; sq++) {
    const p = B[sq];
    if (!p || p.c !== c || p.fz) continue;
    const f = sq & 7, r = sq >> 3;
    const leap = D => { for (const [df, dr] of D) { const ff = f + df, rr = r + dr; if (!onB(ff, rr)) continue; const t = rr * 8 + ff, q = B[t]; if (!q || q.c !== c) M.push({from: sq, to: t}); } };
    const slide = (D, max) => { for (const [df, dr] of D) { let ff = f + df, rr = r + dr, k = 0; while (onB(ff, rr) && k < max) { const t = rr * 8 + ff, q = B[t]; if (q) { if (q.c !== c) M.push({from: sq, to: t}); break; } M.push({from: sq, to: t}); ff += df; rr += dr; k++; } } };
    const quiet = t => { if (!B[t]) M.push({from: sq, to: t}); };
    const pawnTo = (t, x) => { if (promoZone(s, c, t)) { for (const pr of 'qrbn') M.push({from: sq, to: t, promo: pr, ...x}); } else M.push({from: sq, to: t, ...x}); };
    if (p.t === 'p') {
      const d = c === 'w' ? 1 : -1, r1 = r + d;
      if (onB(f, r1)) {
        if (!B[r1 * 8 + f]) {
          pawnTo(r1 * 8 + f, {});
          const r2 = r + 2 * d;
          if (onB(f, r2) && !B[r2 * 8 + f] && (rankOf(c, sq) === 1 || has(s, c, 'pawn2'))) pawnTo(r2 * 8 + f, {dbl: true});
        }
        for (const df of [-1, 1]) {
          const ff = f + df; if (!onB(ff, r1)) continue;
          const t = r1 * 8 + ff, q = B[t];
          if (q && q.c !== c) pawnTo(t, {});
          else if (!q && s.ep && s.ep.sq === t && s.ep.c !== c) { const v = B[t - 8 * d]; if (v && v.t === 'p' && v.c === s.ep.c) M.push({from: sq, to: t, ep: true}); }
        }
      }
      if (has(s, c, 'pawnBack')) { const rb = r - d; if (onB(f, rb) && rankOf(c, rb * 8 + f) > 0) quiet(rb * 8 + f); }
      if (has(s, c, 'pawnSide')) for (const df of [-1, 1]) if (onB(f + df, r)) quiet(r * 8 + f + df);
    } else if (p.t === 'n') {
      if (has(s, c, 'nightrider')) slide(KN, 8); else leap(KN);
      if (has(s, c, 'centaur')) leap(KG);
    } else if (p.t === 'b') {
      slide(DIAG, 8);
      if (has(s, c, 'archbishop')) leap(KN);
      if (has(s, c, 'wazirBishop')) leap(ORTH);
    } else if (p.t === 'r') {
      slide(ORTH, 8);
      if (has(s, c, 'chancellor')) leap(KN);
      if (has(s, c, 'cannon')) for (const [df, dr] of ORTH) {
        let ff = f + df, rr = r + dr, screen = false;
        while (onB(ff, rr)) {
          const q = B[rr * 8 + ff];
          if (q) { if (screen) { if (q.c !== c) M.push({from: sq, to: rr * 8 + ff}); break; } screen = true; }
          ff += df; rr += dr;
        }
      }
    } else if (p.t === 'q') {
      slide(DIAG, 8); slide(ORTH, 8);
      if (has(s, c, 'amazon')) leap(KN);
    } else if (p.t === 'k') {
      leap(KG);
      if (has(s, c, 'knightKing')) leap(KN);
      if (has(s, c, 'stride')) for (const [df, dr] of KG) { const ff = f + 2 * df, rr = r + 2 * dr; if (!onB(ff, rr) || B[(r + dr) * 8 + f + df]) continue; const t = rr * 8 + ff, q = B[t]; if (!q || q.c !== c) M.push({from: sq, to: t}); }
      if (castle) castling(s, c, sq, M);
    }
  }
  if (has(s, c, 'drop')) {
    const h = s.hand[c];
    for (const t in h) {
      if (!h[t] || !GLYPH[t] || t === 'k') continue;
      for (let x = 0; x < 64; x++) {
        if (B[x]) continue;
        if (t === 'p') { const rk = rankOf(c, x); if (rk === 0 || rk === 7 || promoZone(s, c, x)) continue; }
        M.push({drop: t, to: x});
      }
    }
  }
  return M;
}

// 캐슬링은 킹이 공격받는 칸에서 시작하거나 지나갈 수 없다.
function castling(s, c, sq, M) {
  const base = c === 'w' ? 0 : 56, B = s.board;
  if (sq !== base + 4) return;
  const rk = x => B[x] && B[x].c === c && B[x].t === 'r' && !B[x].fz;
  if (s.castle[c + 'K'] && rk(base + 7) && !B[base + 5] && !B[base + 6] && safeAt(s, c, base + 4, [base + 4, base + 5, base + 6])) M.push({from: sq, to: base + 6, castle: 'K'});
  if (s.castle[c + 'Q'] && rk(base) && !B[base + 1] && !B[base + 2] && !B[base + 3] && safeAt(s, c, base + 4, [base + 4, base + 3, base + 2])) M.push({from: sq, to: base + 2, castle: 'Q'});
}
function safeAt(s, c, from, sqs) {
  for (const x of sqs) { const B = s.board.slice(), k = B[from]; B[from] = null; B[x] = k; if (inDanger({...s, board: B}, c)) return false; }
  return true;
}

/* ---------- 수 적용 ---------- */
function apply(s, m, c) {
  const o = oth(c), B = s.board.slice();
  const n = {...s, board: B, hand: {w: {...s.hand.w}, b: {...s.hand.b}}, lost: {w: s.lost.w.slice(), b: s.lost.b.slice()}, ep: null};
  const ev = {cap: null, boom: [], blocked: false, mutual: false};
  const lose = q => { if (q.t !== 'k') n.lost[q.c].push(q.pr ? 'p' : q.t); };
  if (m.drop) { B[m.to] = {c, t: m.drop}; n.hand[c][m.drop]--; }
  else {
    const p = B[m.from];
    const cs = m.ep ? m.to + (c === 'w' ? -8 : 8) : m.to;
    const tgt = B[cs] && B[cs].c === o ? B[cs] : null;
    if (tgt && tgt.sh) {
      // 보호막: 대상은 보호막만 잃고 남는다. 공격한 기물은 제자리.
      B[cs] = {...tgt, sh: 0};
      ev.blocked = true;
    } else {
      B[cs] = null; B[m.from] = null;
      let moved = m.promo ? {c, t: m.promo, pr: 1} : p;
      if (tgt && !m.promo && p.t === 'p' && has(s, c, 'battlePromo')) moved = {...p, t: 'n', pr: 1};
      B[m.to] = moved;
      if (m.castle === 'K') { B[m.from + 1] = B[m.from + 3]; B[m.from + 3] = null; }
      if (m.castle === 'Q') { B[m.from - 1] = B[m.from - 4]; B[m.from - 4] = null; }
      if (m.dbl && !m.promo) n.ep = {sq: (m.from + m.to) / 2, c};
      if (tgt) {
        ev.cap = tgt;
        lose(tgt);
        if (tgt.t !== 'k' && has(s, c, 'drop')) { const ct = tgt.pr ? 'p' : tgt.t; n.hand[c][ct] = (n.hand[c][ct] || 0) + 1; }
        if (has(s, o, 'mutual') && (tgt.t === 'q' || tgt.t === 'r') && moved.t !== 'k') {
          B[m.to] = null; lose(moved); ev.mutual = true;
        }
        if (has(s, c, 'atomic')) {
          const f = m.to & 7, r = m.to >> 3;
          for (const [df, dr] of [[0, 0], ...KG]) {
            const ff = f + df, rr = r + dr; if (!onB(ff, rr)) continue;
            const x = rr * 8 + ff, q = B[x];
            if (!q || (x !== m.to && q.t === 'p')) continue;
            if (q.sh) { B[x] = {...q, sh: 0}; continue; }
            B[x] = null; ev.boom.push(x); lose(q);
          }
        }
      }
    }
  }
  const pc = (x, col, t) => B[x] && B[x].c === col && B[x].t === t;
  n.castle = {wK: s.castle.wK && pc(4, 'w', 'k') && pc(7, 'w', 'r'), wQ: s.castle.wQ && pc(4, 'w', 'k') && pc(0, 'w', 'r'), bK: s.castle.bK && pc(60, 'b', 'k') && pc(63, 'b', 'r'), bQ: s.castle.bQ && pc(60, 'b', 'k') && pc(56, 'b', 'r')};
  return [n, ev];
}

// c의 킹이 공격받는가: 상대가 다음 한 수로 c의 킹을 없앨 수 있는가
function inDanger(s, c) {
  const o = oth(c), B = s.board, at = has(s, o, 'atomic');
  for (const m of gen(s, o, false)) {
    if (m.drop) continue;
    const tg = B[m.to];
    if (!m.ep && !tg) continue;
    if (!at) { if (tg && tg.t === 'k' && tg.c === c && !tg.sh) return true; continue; }
    const nb = apply(s, m, o)[0].board;
    if (!alive(nb, o)) continue;
    if (!alive(nb, c)) return true;
  }
  return false;
}

// 둘 수 있는 수: 내 킹을 스스로 없애는 수(원자 포격)만 빼고 모두.
function legal(s, c) {
  const M = gen(s, c, true);
  if (!has(s, c, 'atomic')) return M;
  return M.filter(m => alive(apply(s, m, c)[0].board, c));
}

// c 쪽 기물의 빙결을 한 턴 줄인다 (c의 턴이 끝날 때)
function tick(s, c) {
  s.board = s.board.map(p => (p && p.c === c && p.fz ? {...p, fz: p.fz - 1} : p));
}

/* ---------- 즉시 효과 ---------- */
function reviveTarget(s, c, skip) {
  const types = [...new Set(s.lost[c])].filter(t => HOME[t]).sort((a, b) => VAL[b] - VAL[a]);
  for (const t of types) {
    const row = t === 'p' ? 1 : 0;
    const cand = HOME[t].map(x => rel(c, x)).concat([0, 1, 2, 3, 4, 5, 6, 7].map(f => rel(c, row * 8 + f)));
    for (const x of cand) {
      if (s.board[x] || (skip && skip.includes(x))) continue;
      const B = s.board.slice(); B[x] = {c, t};
      if (inDanger({...s, board: B}, c)) continue;
      return {t, sq: x};
    }
  }
  return null;
}
const myPawns = (s, c) => s.board.map((p, x) => (p && p.c === c && p.t === 'p' ? x : -1)).filter(x => x >= 0);
const emptyIn = (s, c, rk) => [0, 1, 2, 3, 4, 5, 6, 7].map(f => rel(c, rk * 8 + f)).filter(x => !s.board[x]);
const strongest = (s, c) => {
  const xs = s.board.map((p, x) => (p && p.c === c && p.t !== 'k' ? x : -1)).filter(x => x >= 0);
  if (!xs.length) return -1;
  const best = Math.max(...xs.map(x => VAL[s.board[x].t] || 0));
  return shuffleArr(xs.filter(x => (VAL[s.board[x].t] || 0) === best))[0];
};
const SHUF_SQ = [1, 2, 3, 5, 6];

// 즉시 효과를 이 상태에서 쓸 수 있는가 (효과가 없을 증강은 후보에서 뺀다)
function avail(s, c, id) {
  const B = s.board, o = oth(c), mine = (x, t) => B[x] && B[x].c === c && B[x].t === t;
  switch (id) {
    case 'advance': return [0, 1, 2, 3, 4, 5, 6, 7].some(f => mine(rel(c, 8 + f), 'p') && !B[rel(c, 16 + f)]);
    case 'reserve': return !B[rel(c, 18)] || !B[rel(c, 21)];
    case 'develop': return (mine(rel(c, 1), 'n') && !B[rel(c, 18)]) || (mine(rel(c, 6), 'n') && !B[rel(c, 21)]);
    case 'shuffle': return SHUF_SQ.filter(x => { const p = B[rel(c, x)]; return p && p.c === c && 'nbq'.includes(p.t); }).length >= 2;
    case 'cavalry': return mine(rel(c, 9), 'p') || mine(rel(c, 14), 'p');
    case 'secondQueen': return !B[rel(c, 19)];
    case 'queenShield': return B.some(p => p && p.c === c && p.t === 'q' && !p.sh);
    case 'kingShield': return B.some(p => p && p.c === c && p.t === 'k' && !p.sh);
    case 'revive': case 'grandRevive': return !!reviveTarget(s, c);
    case 'conscript': return emptyIn(s, c, 1).length > 0;
    case 'freeze': return strongest(s, o) >= 0;
    case 'lastCharge': return myPawns(s, c).some(x => { const t = x + (c === 'w' ? 8 : -8); return t >= 0 && t < 64 && !B[t]; });
    case 'sniper': return myPawns(s, o).length > 0;
    case 'fieldPromo': return myPawns(s, c).length > 0;
    case 'finalPromo': return myPawns(s, c).some(x => rankOf(c, x) >= 4);
    default: return true;
  }
}

// 즉시 효과를 적용한다. s.board 등은 이미 복사본이라고 보고 직접 바꾼다. 기보에 붙일 짧은 설명을 돌려준다.
function instant(s, c, id) {
  const B = s.board, o = oth(c), fwd = c === 'w' ? 8 : -8, parts = [];
  const put = (x, piece) => { B[x] = piece; parts.push(GLYPH[piece.t] + sqName(x)); };
  const queenAt = x => { B[x] = {...B[x], t: 'q', pr: 1}; parts.push(GLYPH.q + sqName(x)); };
  const byAdvance = xs => xs.sort((a, b) => rankOf(c, b) - rankOf(c, a));
  switch (id) {
    case 'advance':
      for (let f = 0; f < 8; f++) { const a = rel(c, 8 + f), b = rel(c, 16 + f); if (B[a] && B[a].c === c && B[a].t === 'p' && !B[b]) { B[b] = B[a]; B[a] = null; } }
      break;
    case 'reserve': for (const x of [18, 21].map(v => rel(c, v))) if (!B[x]) put(x, {c, t: 'p'}); break;
    case 'develop':
      for (const [a, b] of [[1, 18], [6, 21]].map(([a, b]) => [rel(c, a), rel(c, b)])) if (B[a] && B[a].c === c && B[a].t === 'n' && !B[b]) { B[b] = B[a]; B[a] = null; parts.push(GLYPH.n + sqName(b)); }
      break;
    case 'shuffle': {
      const xs = SHUF_SQ.map(x => rel(c, x)).filter(x => B[x] && B[x].c === c && 'nbq'.includes(B[x].t));
      const orig = xs.map(x => B[x].t).join('');
      let ps = xs.map(x => B[x]);
      for (let i = 0; i < 12; i++) { ps = shuffleArr(ps.slice()); if (ps.map(p => p.t).join('') !== orig) break; }
      xs.forEach((x, i) => { B[x] = ps[i]; });
      break;
    }
    case 'cavalry': for (const x of [9, 14].map(v => rel(c, v))) if (B[x] && B[x].c === c && B[x].t === 'p') put(x, {...B[x], t: 'n', pr: 1}); break;
    case 'royalGuard': {
      const k = B.findIndex(p => p && p.c === c && p.t === 'k');
      for (const x of [k, k - 1, k + 1]) if (x >= 0 && x < 64 && (x >> 3) === (k >> 3) && B[x] && B[x].c === c) B[x] = {...B[x], sh: 1};
      break;
    }
    case 'secondQueen': if (!B[rel(c, 19)]) put(rel(c, 19), {c, t: 'q'}); break;
    case 'queenShield': B.forEach((p, x) => { if (p && p.c === c && p.t === 'q') B[x] = {...p, sh: 1}; }); break;
    case 'kingShield': B.forEach((p, x) => { if (p && p.c === c && p.t === 'k') B[x] = {...p, sh: 1}; }); break;
    case 'revive': case 'grandRevive':
      for (let i = 0; i < (id === 'grandRevive' ? 2 : 1); i++) {
        const rv = reviveTarget(s, c);
        if (!rv) break;
        put(rv.sq, {c, t: rv.t});
        s.lost[c].splice(s.lost[c].indexOf(rv.t), 1);
      }
      break;
    case 'conscript': for (const x of shuffleArr(emptyIn(s, c, 1)).slice(0, 2)) put(x, {c, t: 'p'}); break;
    case 'freeze': { const x = strongest(s, o); if (x >= 0) { B[x] = {...B[x], fz: 2}; parts.push(GLYPH[B[x].t] + sqName(x) + ' 빙결'); } break; }
    case 'lastCharge':
      for (const x of byAdvance(myPawns(s, c))) {
        const t = x + fwd; if (t < 0 || t > 63 || B[t]) continue;
        B[t] = B[x]; B[x] = null;
        if (rankOf(c, t) === 7) queenAt(t);
      }
      break;
    case 'sniper': {
      const xs = myPawns(s, o).sort((a, b) => rankOf(o, b) - rankOf(o, a));
      if (xs.length) { parts.push('×' + sqName(xs[0])); B[xs[0]] = null; s.lost[o].push('p'); }
      break;
    }
    case 'fieldPromo': { const xs = byAdvance(myPawns(s, c)); if (xs.length) queenAt(xs[0]); break; }
    case 'finalPromo': for (const x of myPawns(s, c)) if (rankOf(c, x) >= 4) queenAt(x); break;
  }
  return parts.join(' ');
}

/* ---------- 증강 후보 ---------- */
function offers(s, c, tier, round) {
  const cats = ROUND_CATS[round] || ROUND_CATS[4];
  const ok = id => cats.includes(AUG[id].cat) && !s.aug[c].includes(id) && (!AUG[id].instant || avail(s, c, id));
  let ids = shuffleArr(Object.keys(AUG).filter(id => AUG[id].tier === tier && ok(id)));
  if (ids.length < 3) {
    const rest = shuffleArr(Object.keys(AUG).filter(id => AUG[id].tier !== tier && ok(id)));
    rest.sort((a, b) => Math.abs(TIER_RANK[AUG[a].tier] - TIER_RANK[tier]) - Math.abs(TIER_RANK[AUG[b].tier] - TIER_RANK[tier]));
    ids = ids.concat(rest);
  }
  return ids.slice(0, 3);
}
function rollTier(r) {
  const W = [[0.55, 0.4, 0.05], [0.35, 0.5, 0.15], [0.2, 0.5, 0.3], [0.1, 0.45, 0.45]][Math.min(r, 4) - 1];
  let x = rnd();
  for (let i = 0; i < 3; i++) { if (x < W[i]) return ['silver', 'gold', 'prism'][i]; x -= W[i]; }
  return 'gold';
}

const sqName = x => 'abcdefgh'[x & 7] + ((x >> 3) + 1);
function note(s, m, c, ev, chk) {
  let t;
  if (m.drop) t = GLYPH[m.drop] + '@' + sqName(m.to);
  else if (m.castle) t = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const p = s.board[m.from];
    t = (p.t === 'p' ? '' : GLYPH[p.t]) + sqName(m.from) + (ev.cap || ev.blocked ? '×' : '-') + sqName(m.to);
    if (m.promo) t += '=' + GLYPH[m.promo];
    if (ev.blocked) t += ' 막힘';
    if (ev.mutual) t += ' 동귀어진';
    if (ev.boom.length) t += ' ✸';
  }
  return t + (chk ? '+' : '');
}

export {setRng, seededRng, AUG, CAT_KO, ROUND_CATS, TIER_KO, TIER_RANK, GLYPH, VAL, HILL, PICK_AT, HUNT_GOAL, oth, has, alive, rankOf, initial, gen, apply, inDanger, legal, tick, reviveTarget, avail, instant, offers, rollTier, sqName, note};
