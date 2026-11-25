// 동기화 계층.
//  - firebase: 실제 온라인 대전. Firebase 익명 로그인 + Realtime Database.
//  - mem: 개발·테스트용. 같은 브라우저의 탭끼리 localStorage + BroadcastChannel로 동기화한다 (?net=mem).
// 두 구현 모두 같은 인터페이스를 가진다:
//   uid, subscribe(id, cb, onErr), create(id, room) -> bool, update(id, fn) -> bool, presence(id, key)
// update의 fn은 현재 방 객체를 받아 새 방 객체를 돌려준다. undefined를 돌려주면 쓰기를 취소한다.

const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

export async function connect(config, kind) {
  if (kind === 'mem') return memNet();
  if (!config) return null;
  const [{ initializeApp }, { getAuth, signInAnonymously }, D] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-database.js'),
  ]);
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = D.getDatabase(app);
  // 이미 익명 사용자가 있으면 그 사용자를 그대로 돌려준다 → 새로고침해도 같은 자리로 돌아온다.
  const { user } = await signInAnonymously(auth);
  const R = id => D.ref(db, 'rooms/' + id);
  return {
    uid: user.uid,
    subscribe(id, cb, onErr) {
      return D.onValue(R(id), snap => cb(snap.val()), onErr);
    },
    async create(id, room) {
      const res = await D.runTransaction(R(id), cur => (cur === null ? room : undefined));
      return res.committed;
    },
    async update(id, fn) {
      // 캐시가 비어 있으면 첫 호출에 null이 온다. null을 그대로 돌려주면 서버가 실제 값으로 다시 호출한다.
      const res = await D.runTransaction(R(id), cur => (cur === null ? null : fn(cur)));
      return res.committed && res.snapshot.exists();
    },
    presence(id, key) {
      const me = D.ref(db, `rooms/${id}/online/${key}`);
      D.onValue(D.ref(db, '.info/connected'), snap => {
        if (snap.val() !== true) return;
        D.onDisconnect(me).remove().then(() => D.set(me, true)).catch(() => {});
      });
    },
  };
}

function memNet() {
  let uid = sessionStorage.getItem('mem-uid');
  if (!uid) {
    uid = 'u' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('mem-uid', uid);
  }
  const key = id => 'mem-room:' + id;
  // 탭 사이 localStorage 반영이 늦을 수 있어서, 메시지로 받은 최신 값을 따로 들고 있다가 더 새 것을 쓴다.
  const last = {};
  const read = id => {
    let ls = null;
    try { ls = JSON.parse(localStorage.getItem(key(id))); } catch {}
    const c = last[id];
    const pick = c && (!ls || (c._t || 0) > (ls._t || 0)) ? c : ls;
    return pick ? JSON.parse(JSON.stringify(pick)) : null;
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
  // Firebase처럼 null 값과 빈 배열은 저장하지 않는다.
  const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (x === null || (Array.isArray(x) && !x.length) ? undefined : x)));
  const write = (id, v) => {
    const s = strip(v);
    s._t = performance.timeOrigin + performance.now();
    last[id] = s;
    localStorage.setItem(key(id), JSON.stringify(s));
    chan(id).postMessage(s);
    setTimeout(() => notify(id));
  };
  return {
    uid,
    subscribe(id, cb) {
      (subs[id] = subs[id] || []).push(cb);
      chan(id);
      setTimeout(() => cb(read(id)));
    },
    async create(id, room) {
      if (read(id)) return false;
      write(id, room);
      return true;
    },
    async update(id, fn) {
      const cur = read(id);
      if (cur === null) return false;
      const next = fn(cur);
      if (next === undefined) return false;
      write(id, next);
      return true;
    },
    presence(id, key) {
      const set = on => {
        const cur = read(id);
        if (!cur) return;
        cur.online = cur.online || {};
        if (on) cur.online[key] = true; else delete cur.online[key];
        write(id, cur);
      };
      set(true);
      addEventListener('pagehide', () => set(false));
    },
  };
}
