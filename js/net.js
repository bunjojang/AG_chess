// 동기화 계층.
//  - firebase: 실제 온라인 대전. Firebase 익명 로그인 + Realtime Database.
//  - mem: 개발·테스트용. 같은 브라우저의 탭끼리 localStorage + BroadcastChannel로 동기화한다 (?net=mem).
// 두 구현 모두 같은 모양이다:
//   uid
//   subscribe(id, cb, onErr)            방이 바뀔 때마다 cb(방 또는 null)
//   create(id, room, secret) -> 'ok'|'exists'|'denied'   (보안 규칙: 한 사람당 20초에 방 하나)
//     secret은 읽을 수 없는 곳에 저장되고, 링크에 이 값을 가진 사람만 빈 자리에 앉을 수 있다
//   append(id, i, action, extra) -> bool  actions/i가 비어 있을 때만 쓴다
//   patch(id, paths) -> bool             방 안의 여러 경로를 한 번에 바꾼다 (null이면 지움)
//   staleRooms(before, n) -> [{id, r}]    updatedAt이 before보다 오래된 방
//   remove(id) -> bool
//   presence(id, uid)
// TIME 자리에는 서버 시각이 들어간다.

export const TIME = {'.sv': 'timestamp'};
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

export async function connect(config, kind) {
  if (kind === 'mem') return memNet();
  if (!config) return null;
  const [{initializeApp}, {getAuth, signInAnonymously}, D] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-database.js'),
  ]);
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = D.getDatabase(app);
  // 이미 익명 사용자가 있으면 그 사용자를 그대로 돌려준다 → 새로고침해도 같은 자리로 돌아온다.
  const {user} = await signInAnonymously(auth);
  const R = id => D.ref(db, 'rooms/' + id);
  const ok = p => p.then(() => true, () => false);
  return {
    uid: user.uid,
    subscribe(id, cb, onErr) { return D.onValue(R(id), snap => cb(snap.val()), onErr); },
    async create(id, room, secret) {
      try {
        const p = {['rooms/' + id]: room, ['limits/' + user.uid]: TIME};
        if (secret) p['secrets/' + id] = secret;
        await D.update(D.ref(db), p);
        return 'ok';
      } catch (e) {
        const snap = await D.get(R(id)).catch(() => null);
        return snap && snap.exists() ? 'exists' : 'denied';
      }
    },
    append(id, i, action, extra) { return ok(D.update(R(id), {['actions/' + i]: action, ...extra})); },
    patch(id, paths) { return ok(D.update(R(id), paths)); },
    async staleRooms(before, n) {
      const q = D.query(D.ref(db, 'rooms'), D.orderByChild('updatedAt'), D.endAt(before), D.limitToFirst(n));
      const snap = await D.get(q);
      const out = [];
      snap.forEach(ch => { out.push({id: ch.key, r: ch.val()}); });
      return out;
    },
    remove(id) { return ok(D.remove(R(id))); },
    presence(id, uid) {
      const me = D.ref(db, `rooms/${id}/online/${uid}`);
      D.onValue(D.ref(db, '.info/connected'), snap => {
        if (snap.val() !== true) return;
        D.onDisconnect(me).remove().then(() => D.set(me, true)).catch(() => {});
      });
    },
  };
}

// 테스트용: 보안 규칙 중 핵심(덮어쓰기 금지, 좌석 선점, 생성 속도)만 흉내 낸다.
function memNet() {
  let uid = sessionStorage.getItem('mem-uid');
  if (!uid) {
    uid = 'u' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('mem-uid', uid);
  }
  const key = id => 'mem-room:' + id;
  const last = {};
  const read = id => {
    let ls = null;
    try { ls = JSON.parse(localStorage.getItem(key(id))); } catch {}
    const c = last[id];
    const pick = c && (!ls || (c._t || 0) > (ls._t || 0)) ? c : ls;
    return pick && !pick._gone ? JSON.parse(JSON.stringify(pick)) : null;
  };
  const subs = {}, chans = {};
  const notify = id => (subs[id] || []).forEach(f => f(read(id)));
  const chan = id => {
    if (!chans[id]) {
      chans[id] = new BroadcastChannel(key(id));
      chans[id].onmessage = e => { if (e.data && (!last[id] || e.data._t > (last[id]._t || 0))) last[id] = e.data; notify(id); };
    }
    return chans[id];
  };
  const fix = v => JSON.parse(JSON.stringify(v, (k, x) => (x && x['.sv'] === 'timestamp' ? Date.now() : x === null ? undefined : x)));
  const write = (id, v) => {
    const s = v ? fix(v) : {_gone: 1};
    s._t = performance.timeOrigin + performance.now();
    last[id] = s;
    if (!s._gone) localStorage.setItem(key(id), JSON.stringify(s)); else localStorage.removeItem(key(id));
    chan(id).postMessage(s);
    setTimeout(() => notify(id));
  };
  const setPath = (o, path, v) => {
    const ps = path.split('/');
    let cur = o;
    for (let i = 0; i < ps.length - 1; i++) { if (typeof cur[ps[i]] !== 'object' || cur[ps[i]] === null) cur[ps[i]] = {}; cur = cur[ps[i]]; }
    if (v === null || v === undefined) delete cur[ps[ps.length - 1]]; else cur[ps[ps.length - 1]] = v;
  };
  const getPath = (o, path) => path.split('/').reduce((c, k) => (c == null ? undefined : c[k]), o);
  return {
    uid,
    subscribe(id, cb) {
      (subs[id] = subs[id] || []).push(cb);
      chan(id);
      setTimeout(() => cb(read(id)));
    },
    async create(id, room, secret) {
      if (read(id)) return 'exists';
      if (secret) localStorage.setItem('mem-secret:' + id, secret);
      const lim = +(localStorage.getItem('mem-limit:' + uid) || 0);
      if (Date.now() - lim < 20000 && !sessionStorage.getItem('mem-nolimit')) return 'denied';
      localStorage.setItem('mem-limit:' + uid, String(Date.now()));
      write(id, room);
      return 'ok';
    },
    async append(id, i, action, extra) {
      const cur = read(id);
      if (!cur || getPath(cur, 'actions/' + i) !== undefined) return false;
      setPath(cur, 'actions/' + i, action);
      for (const [p, v] of Object.entries(extra || {})) setPath(cur, p, v);
      write(id, cur);
      return true;
    },
    async patch(id, paths) {
      const cur = read(id);
      if (!cur) return false;
      for (const p of Object.keys(paths)) {
        if (!p.startsWith('seats/')) continue;
        if (getPath(cur, p) !== undefined) return false;
        const c = p.slice(6);
        if (cur.reserved ? cur.reserved[c] !== uid : paths['proofs/' + uid] !== localStorage.getItem('mem-secret:' + id)) return false;
      }
      for (const [p, v] of Object.entries(paths)) setPath(cur, p, v);
      write(id, cur);
      return true;
    },
    async staleRooms(before, n) {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith('mem-room:')) continue;
        const r = read(k.slice(9));
        if (r && r.updatedAt <= before) out.push({id: k.slice(9), r});
      }
      return out.slice(0, n);
    },
    async remove(id) { write(id, null); return true; },
    presence(id, key2) {
      const set = on => { const cur = read(id); if (!cur) return; setPath(cur, 'online/' + key2, on ? true : null); write(id, cur); };
      set(true);
      addEventListener('pagehide', () => set(false));
    },
  };
}
