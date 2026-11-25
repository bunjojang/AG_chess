// 증강 체스 규칙 엔진: 공통 이동 생성 + 증강 훅 + "킹 제거" 기반 체크 판정
// UI·네트워크와 무관한 순수 함수만 둔다.
const AUG={
  pawn2:{tier:'silver',name:'돌격 폰',desc:'폰이 어느 칸에서든 2칸 전진할 수 있다. 이때도 앙파상 대상이 된다.'},
  earlyPromo:{tier:'silver',name:'조기 승급',desc:'폰이 6랭크(흑은 3랭크) 이상에 닿으면 바로 승급한다.'},
  centaur:{tier:'silver',name:'켄타우로스',desc:'나이트가 킹처럼 한 칸씩도 움직일 수 있다.'},
  stride:{tier:'silver',name:'왕의 보폭',desc:'킹이 직선·대각선으로 2칸까지 움직인다. 중간 칸이 막히면 불가.'},
  revive:{tier:'silver',name:'부활',desc:'즉시 효과: 잃은 말 중 가장 강한 하나가 원래 자리(막혔으면 같은 줄 빈칸)에 되살아난다.'},
  archbishop:{tier:'gold',name:'대주교',desc:'비숍이 나이트 이동도 할 수 있다.'},
  chancellor:{tier:'gold',name:'기병 룩',desc:'룩이 나이트 이동도 할 수 있다.'},
  drop:{tier:'gold',name:'드롭',desc:'이후 잡은 말이 손패에 들어온다. 한 수를 써서 빈칸에 놓을 수 있다. 폰은 1·8랭크와 승급 칸에 못 놓는다.'},
  threeCheck:{tier:'gold',name:'3체크',desc:'이 증강을 받은 뒤 상대에게 체크를 3번 주면 승리.'},
  double:{tier:'gold',name:'연속 행동',desc:'세 번째 턴마다 두 수를 둔다. 첫 수로 체크를 주면 거기서 턴이 끝난다.'},
  amazon:{tier:'prism',name:'아마존',desc:'퀸이 나이트 이동도 할 수 있다.'},
  atomic:{tier:'prism',name:'원자 포격',desc:'내가 잡으면 폭발한다. 잡은 말과 주변 8칸의 폰 아닌 말이 모두 사라진다. 상대 킹을 날리면 승리, 내 킹이 휘말리는 포획은 불가.'},
  hill:{tier:'prism',name:'언덕의 왕',desc:'내 킹이 중앙 4칸(d4·e4·d5·e5)에 들어가면 승리.'}
};
const TIER_KO={silver:'실버',gold:'골드',prism:'프리즘'};
const TIER_RANK={silver:0,gold:1,prism:2};
const VS='︎';
const GLYPH={k:'♚'+VS,q:'♛'+VS,r:'♜'+VS,b:'♝'+VS,n:'♞'+VS,p:'♟'+VS};
const VAL={q:9,r:5,b:3,n:3,p:1};
const KN=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const KG=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const DIAG=[[1,1],[1,-1],[-1,1],[-1,-1]];
const ORTH=[[1,0],[-1,0],[0,1],[0,-1]];
const HILL=[27,28,35,36];
const PICK_AT=[6,12,18];
const HOME={q:[3],r:[0,7],b:[2,5],n:[1,6],p:[8,9,10,11,12,13,14,15]};
const oth=c=>c==='w'?'b':'w';
const has=(s,c,id)=>s.aug[c].includes(id);
const onB=(f,r)=>f>=0&&f<8&&r>=0&&r<8;
const alive=(B,c)=>B.some(p=>p&&p.t==='k'&&p.c===c);

function initial(){
  const B=Array(64).fill(null),back='rnbqkbnr';
  for(let f=0;f<8;f++){B[f]={c:'w',t:back[f]};B[8+f]={c:'w',t:'p'};B[48+f]={c:'b',t:'p'};B[56+f]={c:'b',t:back[f]};}
  return {board:B,turn:'w',castle:{wK:true,wQ:true,bK:true,bQ:true},ep:null,hand:{w:{},b:{}},checks:{w:0,b:0},aug:{w:[],b:[]},lost:{w:[],b:[]},turns:{w:0,b:0},dbl:{w:0,b:0},dblTurn:false,sub:0,winner:null,reason:'',log:[],last:null,queue:[{c:'w',r:1},{c:'b',r:1}],after:'start',pick:null,tiers:{}};
}

function promoZone(s,c,sq){const r=sq>>3,e=has(s,c,'earlyPromo');return c==='w'?r>=(e?5:7):r<=(e?2:0);}

function gen(s,c,castle){
  const M=[],B=s.board;
  for(let sq=0;sq<64;sq++){
    const p=B[sq];
    if(!p||p.c!==c)continue;
    const f=sq&7,r=sq>>3;
    const leap=D=>{for(const[df,dr]of D){const ff=f+df,rr=r+dr;if(!onB(ff,rr))continue;const t=rr*8+ff,q=B[t];if(!q||q.c!==c)M.push({from:sq,to:t});}};
    const slide=(D,max)=>{for(const[df,dr]of D){let ff=f+df,rr=r+dr,k=0;while(onB(ff,rr)&&k<max){const t=rr*8+ff,q=B[t];if(q){if(q.c!==c)M.push({from:sq,to:t});break;}M.push({from:sq,to:t});ff+=df;rr+=dr;k++;}}};
    const pawnTo=(t,x)=>{if(promoZone(s,c,t)){for(const pr of 'qrbn')M.push({from:sq,to:t,promo:pr,...x});}else M.push({from:sq,to:t,...x});};
    if(p.t==='p'){
      const d=c==='w'?1:-1,r1=r+d;
      if(!onB(f,r1))continue;
      if(!B[r1*8+f]){
        pawnTo(r1*8+f,{});
        const r2=r+2*d;
        if(onB(f,r2)&&!B[r2*8+f]&&(r===(c==='w'?1:6)||has(s,c,'pawn2')))pawnTo(r2*8+f,{dbl:true});
      }
      for(const df of[-1,1]){
        const ff=f+df;if(!onB(ff,r1))continue;
        const t=r1*8+ff,q=B[t];
        if(q&&q.c!==c)pawnTo(t,{});
        else if(!q&&s.ep&&s.ep.sq===t&&s.ep.c!==c){const cs=t-8*d,v=B[cs];if(v&&v.t==='p'&&v.c===s.ep.c)M.push({from:sq,to:t,ep:true});}
      }
    }else if(p.t==='n'){leap(KN);if(has(s,c,'centaur'))leap(KG);}
    else if(p.t==='b'){slide(DIAG,8);if(has(s,c,'archbishop'))leap(KN);}
    else if(p.t==='r'){slide(ORTH,8);if(has(s,c,'chancellor'))leap(KN);}
    else if(p.t==='q'){slide(DIAG,8);slide(ORTH,8);if(has(s,c,'amazon'))leap(KN);}
    else if(p.t==='k'){
      leap(KG);
      if(has(s,c,'stride'))for(const[df,dr]of KG){const mf=f+df,mr=r+dr,ff=f+2*df,rr=r+2*dr;if(!onB(ff,rr)||B[mr*8+mf])continue;const t=rr*8+ff,q=B[t];if(!q||q.c!==c)M.push({from:sq,to:t});}
      if(castle)castling(s,c,sq,M);
    }
  }
  if(has(s,c,'drop')){
    const h=s.hand[c];
    for(const t in h){
      if(!h[t])continue;
      for(let x=0;x<64;x++){
        if(B[x])continue;
        if(t==='p'){const r=x>>3;if(r===0||r===7||promoZone(s,c,x))continue;}
        M.push({drop:t,to:x});
      }
    }
  }
  return M;
}

function castling(s,c,sq,M){
  const base=c==='w'?0:56,B=s.board;
  if(sq!==base+4)return;
  const rk=x=>B[x]&&B[x].c===c&&B[x].t==='r';
  if(s.castle[c+'K']&&rk(base+7)&&!B[base+5]&&!B[base+6]&&safeAt(s,c,base+4,[base+4,base+5,base+6]))M.push({from:sq,to:base+6,castle:'K'});
  if(s.castle[c+'Q']&&rk(base)&&!B[base+1]&&!B[base+2]&&!B[base+3]&&safeAt(s,c,base+4,[base+4,base+3,base+2]))M.push({from:sq,to:base+2,castle:'Q'});
}
function safeAt(s,c,from,sqs){
  for(const x of sqs){const B=s.board.slice(),k=B[from];B[from]=null;B[x]=k;if(inDanger({...s,board:B},c))return false;}
  return true;
}

function apply(s,m,c){
  const o=oth(c),B=s.board.slice();
  const n={...s,board:B,hand:{w:{...s.hand.w},b:{...s.hand.b}},lost:{w:s.lost.w.slice(),b:s.lost.b.slice()},ep:null};
  const ev={cap:null,boom:[]};
  if(m.drop){B[m.to]={c,t:m.drop};n.hand[c][m.drop]--;}
  else{
    const p=B[m.from];
    const cs=m.ep?m.to+(c==='w'?-8:8):m.to;
    const cap=B[cs]&&B[cs].c===o?B[cs]:null;
    B[cs]=null;B[m.from]=null;
    B[m.to]=m.promo?{c,t:m.promo,pr:1}:p;
    if(m.castle==='K'){B[m.from+1]=B[m.from+3];B[m.from+3]=null;}
    if(m.castle==='Q'){B[m.from-1]=B[m.from-4];B[m.from-4]=null;}
    if(m.dbl&&!m.promo)n.ep={sq:(m.from+m.to)/2,c};
    if(cap){
      ev.cap=cap;
      const ct=cap.pr?'p':cap.t;
      if(cap.t!=='k'){n.lost[o].push(ct);if(has(s,c,'drop'))n.hand[c][ct]=(n.hand[c][ct]||0)+1;}
      if(has(s,c,'atomic')){
        const me=B[m.to];B[m.to]=null;ev.boom.push(m.to);
        if(me.t!=='k')n.lost[c].push(me.pr?'p':me.t);
        const f=m.to&7,r=m.to>>3;
        for(const[df,dr]of KG){
          const ff=f+df,rr=r+dr;if(!onB(ff,rr))continue;
          const x=rr*8+ff,q=B[x];
          if(q&&q.t!=='p'){B[x]=null;ev.boom.push(x);if(q.t!=='k')n.lost[q.c].push(q.pr?'p':q.t);}
        }
      }
    }
  }
  const pc=(x,col,t)=>B[x]&&B[x].c===col&&B[x].t===t;
  n.castle={wK:s.castle.wK&&pc(4,'w','k')&&pc(7,'w','r'),wQ:s.castle.wQ&&pc(4,'w','k')&&pc(0,'w','r'),bK:s.castle.bK&&pc(60,'b','k')&&pc(63,'b','r'),bQ:s.castle.bQ&&pc(60,'b','k')&&pc(56,'b','r')};
  return [n,ev];
}

// c의 킹이 "상대가 다음 한 수로 킹을 없앨 수 있는" 상태인가
function inDanger(s,c){
  const o=oth(c),B=s.board,at=has(s,o,'atomic');
  for(const m of gen(s,o,false)){
    if(m.drop)continue;
    const tg=B[m.to];
    if(!m.ep&&!tg)continue;
    if(!at){if(tg&&tg.t==='k'&&tg.c===c)return true;continue;}
    const nb=apply(s,m,o)[0].board;
    if(!alive(nb,o))continue;
    if(!alive(nb,c))return true;
  }
  return false;
}

function legal(s,c){
  const o=oth(c),out=[];
  for(const m of gen(s,c,true)){
    const nb=apply(s,m,c)[0];
    if(!alive(nb.board,c))continue;
    if(!alive(nb.board,o)){out.push(m);continue;}
    if(inDanger(nb,c))continue;
    out.push(m);
  }
  return out;
}

function reviveTarget(s,c){
  const types=[...new Set(s.lost[c])].sort((a,b)=>VAL[b]-VAL[a]);
  const fl=x=>c==='w'?x:(7-(x>>3))*8+(x&7);
  for(const t of types){
    const row=t==='p'?1:0;
    const cand=HOME[t].map(fl).concat([0,1,2,3,4,5,6,7].map(f=>fl(row*8+f)));
    for(const x of cand){
      if(s.board[x])continue;
      const B=s.board.slice();B[x]={c,t};
      if(inDanger({...s,board:B},c))continue;
      return {t,sq:x};
    }
  }
  return null;
}

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function offers(s,c,tier){
  const ok=id=>!s.aug[c].includes(id)&&(id!=='revive'||reviveTarget(s,c));
  let ids=shuffle(Object.keys(AUG).filter(id=>AUG[id].tier===tier&&ok(id)));
  if(ids.length<3){
    const rest=Object.keys(AUG).filter(id=>AUG[id].tier!==tier&&ok(id));
    rest.sort((a,b)=>Math.abs(TIER_RANK[AUG[a].tier]-TIER_RANK[tier])-Math.abs(TIER_RANK[AUG[b].tier]-TIER_RANK[tier])||Math.random()-.5);
    ids=ids.concat(rest);
  }
  return ids.slice(0,3);
}
function rollTier(r){
  const W=[[.55,.4,.05],[.35,.5,.15],[.2,.5,.3],[.1,.45,.45]][Math.min(r,4)-1];
  let x=Math.random();
  for(let i=0;i<3;i++){if(x<W[i])return ['silver','gold','prism'][i];x-=W[i];}
  return 'gold';
}
const sqName=x=>'abcdefgh'[x&7]+((x>>3)+1);
function note(s,m,c,ev,chk){
  let t;
  if(m.drop)t=GLYPH[m.drop]+'@'+sqName(m.to);
  else if(m.castle)t=m.castle==='K'?'O-O':'O-O-O';
  else{
    const p=s.board[m.from];
    t=(p.t==='p'?'':GLYPH[p.t])+sqName(m.from)+(ev.cap?'×':'-')+sqName(m.to);
    if(m.promo)t+='='+GLYPH[m.promo];
    if(ev.boom.length)t+=' ✸';
  }
  return t+(chk?'+':'');
}

export {AUG,TIER_KO,TIER_RANK,GLYPH,VAL,HILL,PICK_AT,oth,has,alive,initial,gen,apply,inDanger,legal,reviveTarget,offers,rollTier,sqName,note};
