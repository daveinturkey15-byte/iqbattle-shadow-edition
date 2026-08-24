/* IQ.Gens['retroB'] — RETRO TAKEOVER generators (W1 contract C5) for IQ BATTLE.
 * Three arcade takeover puzzles: pacman / doom / battleship (parody-flavored,
 * rendered by retro-*.js; this module only builds the puzzle envelope).
 *
 * C5 interaction model (documented per header requirement): picking an option
 * tile = choosing the OUTCOME tile (the player predicts the result of the next
 * game tick; the renderer plays the tick on reveal). No client scoring, no
 * answer fields touched.
 *
 * Envelope: kind:'retro', retro:{game, data:{...renderer payload}},
 * standard tile options ({cols,rows,cells:[{shape,color,rot}]}), exactly 8
 * options, answer index 0..7, fully deterministic under opts.seed (mulberry32).
 *
 * Encodings:
 *   pacman     — board: seeded maze fragment. Option tiles are 3x3 maze
 *                neighborhoods (wall=square/0, eaten=square/1, pellet=ring/2);
 *                correct tile = the pellet junction the ghost reaches next
 *                (its fragment shows the ghost's eaten trail flowing in).
 *   doom       — board: corridor of health packs (+) and monsters (-).
 *                Option tiles are 1x1 health bars: color 0 (drained) .. 7
 *                (full) = clamp(startHp + healths - monsterDamage,0,100)
 *                mapped by round(final*7/100). Arithmetic is shown visually
 *                on the board; tiles encode only the end-state.
 *   battleship — board: mini-grid with hit/miss history (miss=ring/4,
 *                hit=triangle/1). Option tiles replay the full grid with the
 *                candidate next shot marked cross/6; correct tile = the cell
 *                the seeded targeting policy fires at next.
 *
 * Registers: IQ.Gens.retroB plus aliases IQ.Gens.pacman / .doom /
 * .battleship (game-forced views of the same api). */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function shuffle(arr,r){for(let i=arr.length-1;i>0;i--){const j=Math.floor(r()*(i+1));const t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}
function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}

/* ---------------- PACMAN ---------------- */
function carveMaze(n,r){
 const g=new Array(n*n).fill(1);
 const idx=function(x,y){return y*n+x;};
 const stack=[[1,1]];g[idx(1,1)]=0;
 while(stack.length){
  const cur=stack[stack.length-1];
  const dirs=shuffle([[2,0],[-2,0],[0,2],[0,-2]],r);
  let moved=false;
  for(let i=0;i<dirs.length;i++){
   const dx=dirs[i][0],dy=dirs[i][1];
   const nx=cur[0]+dx,ny=cur[1]+dy;
   if(nx>0&&nx<n-1&&ny>0&&ny<n-1&&g[idx(nx,ny)]===1){
    g[idx(cur[0]+dx/2,cur[1]+dy/2)]=0;
    g[idx(nx,ny)]=0;
    stack.push([nx,ny]);moved=true;break;
   }
  }
  if(!moved)stack.pop();
 }
 // knock a few interior walls open -> loops and proper junctions
 let knocks=Math.floor(n/3);
 let guard=0;
 while(knocks>0&&guard++<200){
  const x=1+Math.floor(r()*(n-2)),y=1+Math.floor(r()*(n-2));
  if(g[idx(x,y)]!==1)continue;
  const horiz=g[idx(x-1,y)]===0&&g[idx(x+1,y)]===0;
  const vert=g[idx(x,y-1)]===0&&g[idx(x,y+1)]===0;
  if(horiz||vert){g[idx(x,y)]=0;knocks--;}
 }
 return g;
}
function openDeg(g,n,x,y){
 let d=0;
 if(x>0&&g[y*n+x-1]===0)d++;
 if(x<n-1&&g[y*n+x+1]===0)d++;
 if(y>0&&g[(y-1)*n+x]===0)d++;
 if(y<n-1&&g[(y+1)*n+x]===0)d++;
 return d;
}
// BFS distance from every open cell to the nearest pellet (targets[] booleans)
function pelletDist(g,n,targets){
 const dist=new Array(n*n).fill(-1);
 const q=[];
 for(let i=0;i<n*n;i++)if(g[i]===0&&targets[i]){dist[i]=0;q.push(i);}
 for(let qi=0;qi<q.length;qi++){
  const i=q[qi],x=i%n,y=(i-x)/n,d=dist[i];
  const nb=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
  for(let k=0;k<4;k++){
   const nx=nb[k][0],ny=nb[k][1];
   if(nx<0||ny<0||nx>=n||ny>=n)continue;
   const j=ny*n+nx;
   if(g[j]===0&&dist[j]<0){dist[j]=d+1;q.push(j);}
  }
 }
 return dist;
}
function pacmanFrag(g,n,cx,cy,eaten){
 const keySet={};
 for(let i=0;i<eaten.length;i++)keySet[eaten[i][1]*n+eaten[i][0]]=1;
 const cells=[];
 for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){
  if(x<0||y<0||x>=n||y>=n){cells.push({shape:'square',color:0,rot:0});continue;}
  const i=y*n+x;
  if(g[i]!==0)cells.push({shape:'square',color:0,rot:0});
  else if(keySet[i])cells.push({shape:'square',color:1,rot:0});
  else cells.push({shape:'ring',color:2,rot:0});
 }
 return {cols:3,rows:3,cells:cells};
}
function genPacman(d,seed,r){
 const n=d<=2?7:(d<=4?9:11);
 const g=carveMaze(n,r);
 const idx=function(x,y){return y*n+x;};
 // collect junctions (3+ open neighbors)
 const junctions=[];
 for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
  if(g[idx(x,y)]===0&&openDeg(g,n,x,y)>=3)junctions.push([x,y]);
 }
 // seeded ghost run: greedy toward nearest pellet, no instant reversal,
 // stop at first NEW junction reached (start cell may be one).
 let start=null,path=null,goal=null;
 for(let attempt=0;attempt<24&&!goal;attempt++){
  const opens=[];
  for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++)if(g[idx(x,y)]===0)opens.push([x,y]);
  const cand=[];
  for(let i=0;i<opens.length;i++)if(openDeg(g,n,opens[i][0],opens[i][1])>=2)cand.push(opens[i]);
  if(!cand.length)break;
  start=cand[Math.floor(r()*cand.length)];
  const pellets={};
  for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++)if(g[idx(x,y)]===0)pellets[idx(x,y)]=true;
  let px=start[0],py=start[1],prev=-1;
  path=[[px,py]];
  delete pellets[idx(px,py)];
  const cap=n*n*2;
  for(let step=0;step<cap;step++){
   const dist=pelletDist(g,n,pellets);
   const nb=[[px-1,py],[px+1,py],[px,py-1],[px,py+1]];
   const order=shuffle([0,1,2,3],r);
   let best=-1,bestD=Infinity;
   for(let k=0;k<4;k++){
    const kk=order[k],nx=nb[kk][0],ny=nb[kk][1];
    if(nx<0||ny<0||nx>=n||ny>=n)continue;
    const j=idx(nx,ny);
    if(g[j]!==0)continue;
    if(j===prev&&k<3&&openDeg(g,n,px,py)>1)continue; // no reverse unless dead end
    const dd=dist[j]<0?Infinity:dist[j];
    if(dd<bestD){bestD=dd;best=j;}
   }
   if(best<0)break;
   prev=idx(px,py);
   px=best%n;py=(best-px)/n;
   path.push([px,py]);
   delete pellets[idx(px,py)];
   if(openDeg(g,n,px,py)>=3&&!(px===start[0]&&py===start[1])){goal=[px,py];break;}
  }
 }
 if(!goal&&junctions.length)goal=junctions[Math.floor(r()*junctions.length)];
 if(!goal)return null;
 // answer fragment: eaten trail = ghost path cells visible in the 3x3
 const eatenAns=path.filter(function(c){return Math.abs(c[0]-goal[0])<=1&&Math.abs(c[1]-goal[1])<=1;});
 const correctFrag=pacmanFrag(g,n,goal[0],goal[1],eatenAns);
 const seen={};seen[JSON.stringify(correctFrag)]=1;
 const options=[correctFrag];
 const decoysPool=shuffle(junctions.filter(function(c){return !(c[0]===goal[0]&&c[1]===goal[1]);}),r);
 for(let i=0;i<decoysPool.length&&options.length<8;i++){
  const c=decoysPool[i];
  let f=pacmanFrag(g,n,c[0],c[1],[]);
  let mut=0,key=JSON.stringify(f);
  while(seen[key]&&mut++<6){
   const ex=c[0]+Math.floor(r()*3)-1,ey=c[1]+Math.floor(r()*3)-1;
   f=pacmanFrag(g,n,c[0],c[1],[[ex,ey]]);
   key=JSON.stringify(f);
  }
  if(!seen[key]){seen[key]=1;options.push(f);}
 }
 // fill remainder with mutated copies of the answer fragment
 let fillGuard=0;
 while(options.length<8&&fillGuard++<200){
  const f={cols:3,rows:3,cells:correctFrag.cells.slice()};
  const ci=Math.floor(r()*9);
  if(ci===4)continue; // keep the junction center intact
  const c=f.cells[ci];
  f.cells[ci]=c.shape==='ring'?{shape:'square',color:1,rot:0}:{shape:'ring',color:2,rot:0};
  const key=JSON.stringify(f);
  if(!seen[key]){seen[key]=1;options.push(f);}
 }
 while(options.length<8){ // absolute fallback: recolor a copy (unique key by construction)
  const f={cols:3,rows:3,cells:correctFrag.cells.map(function(c,i){
   return i===options.length%9?{shape:c.shape,color:(c.color+1)%8,rot:0}:{shape:c.shape,color:c.color,rot:0};
  })};
  const key=JSON.stringify(f);
  if(seen[key])break;
  seen[key]=1;options.push(f);
 }
 if(options.length<8)return null;
 const answer=Math.floor(r()*8);
 const others=options.slice(1);others.splice(answer,0,correctFrag);
 // board preview: whole maze, ghost start marked diamond/5, goal hidden
 const bcells=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=idx(x,y);
  if(g[i]!==0)bcells.push({shape:'square',color:0,rot:0});
  else if(x===start[0]&&y===start[1])bcells.push({shape:'diamond',color:5,rot:0});
  else bcells.push({shape:'ring',color:2,rot:0});
 }
 return {
  id:'retro-pacman-'+d+'-'+seed.toString(36),kind:'retro',difficulty:d,
  prompt:'WHICH JUNCTION DOES THE GHOST REACH NEXT?',
  rule:'the ghost eats toward the nearest pellet, never doubling back',
  retro:{game:'pacman',data:{n:n,walls:g,start:start.slice(),trail:path,goal:goal}},
  board:{cols:n,rows:n,cells:bcells},
  options:others,answer:answer
 };
}

/* ---------------- DOOM ---------------- */
function genDoom(d,seed,r){
 const L=d<=2?5:(d<=4?7:9);
 const pair=d<=2?[15,15]:(d<=4?[20,25]:[25,30]); // [+heal, -damage]
 const startHp=50;
 const nMon=Math.max(1,Math.floor(L/3));
 const nHea=Math.max(1,Math.floor(L/3));
 const events=new Array(L).fill('empty');
 const spots=[];for(let i=0;i<L;i++)spots.push(i);
 shuffle(spots,r);
 for(let i=0;i<nMon&&i<spots.length;i++)events[spots[i]]='monster';
 for(let i=0;i<nHea&&i<spots.length;i++){if(events[spots[i]]==='empty')events[spots[i]]='health';}
 // walk the corridor
 let hp=startHp;
 const deltas=[];
 for(let i=0;i<L;i++){
  if(events[i]==='health'){hp+=pair[0];deltas.push(pair[0]);}
  else if(events[i]==='monster'){hp-=pair[1];deltas.push(-pair[1]);}
  else deltas.push(0);
 }
 const final=clamp(hp,0,100);
 const bucketOf=function(v){return clamp(Math.round(v*7/100),0,7);};
 const correct=bucketOf(final);
 const seen={};seen[correct]=1;
 const options=[{cols:1,rows:1,cells:[{shape:'square',color:correct,rot:0}]}];
 // plausible miscounts: skip first, skip last, flip a sign, drop one event
 const wrongs=[clamp(startHp-deltas[0],0,100),clamp(startHp+deltas.slice(0,-1).reduce(function(a,b){return a+b;},0),0,100),
  clamp(startHp-deltas.reduce(function(a,b){return a+b;},0),0,100)];
 for(let i=0;i<L;i++){
  if(deltas[i]!==0)wrongs.push(clamp(final-deltas[i]*2,0,100)); // sign flip on event i
 }
 for(let i=0;i<wrongs.length&&options.length<8;i++){
  const b=bucketOf(wrongs[i]);
  if(!seen[b]){seen[b]=1;options.push({cols:1,rows:1,cells:[{shape:'square',color:b,rot:0}]});}
 }
 const rest=shuffle([0,1,2,3,4,5,6,7].filter(function(b){return !seen[b];}),r);
 for(let i=0;i<rest.length&&options.length<8;i++){
  seen[rest[i]]=1;options.push({cols:1,rows:1,cells:[{shape:'square',color:rest[i],rot:0}]});
 }
 const answer=Math.floor(r()*8);
 const others=options.slice(1);others.splice(answer,0,{cols:1,rows:1,cells:[{shape:'square',color:correct,rot:0}]});
 const bcells=events.map(function(e){
  if(e==='health')return {shape:'plus',color:3,rot:0};
  if(e==='monster')return {shape:'triangle',color:1,rot:0};
  return {shape:'square',color:0,rot:0};
 });
 return {
  id:'retro-doom-'+d+'-'+seed.toString(36),kind:'retro',difficulty:d,
  prompt:'THE MARINE HOLDS THE CORRIDOR — ENDING HEALTH?',
  rule:'health packs add, monsters subtract; pick the ending health level',
  retro:{game:'doom',data:{events:events,startHp:startHp,heal:pair[0],dmg:pair[1],final:final,bucket:correct}},
  board:{cols:L,rows:1,cells:bcells},
  options:others,answer:answer
 };
}

/* ---------------- BATTLESHIP ---------------- */
function genBattleship(d,seed,r){
 const N=d<=2?4:(d===5?6:5);
 const fleet=d<=3?[3,2]:[3,2,2];
 const kShots=d<=2?3:(d===3?5:7);
 const idx=function(x,y){return y*N+x;};
 let ships=null,history=null,pending=null;
 for(let attempt=0;attempt<25&&(ships===null||history===null);attempt++){
  // seeded fleet placement
  ships=[];
  const occupied={};
  let ok=true;
  for(let s=0;s<fleet.length&&ok;s++){
   const len=fleet[s];
   let placed=false,pg=0;
   while(!placed&&pg++<120){
    const horiz=r()<.5;
    const x=Math.floor(r()*(horiz?N-len+1:N));
    const y=Math.floor(r()*(horiz?N-len+1:N));
    const cells=[];
    for(let i=0;i<len;i++)cells.push(horiz?[x+i,y+i*0]:[x,y+i]);
    let free=true;
    for(let i=0;i<cells.length;i++)if(occupied[idx(cells[i][0],cells[i][1])]){free=false;break;}
    if(free){for(let i=0;i<cells.length;i++)occupied[idx(cells[i][0],cells[i][1])]=true;ships.push(cells);placed=true;}
   }
   if(!placed)ok=false;
  }
  if(!ok){ /* retry whole placement */ ships=null;continue; }
  const shipAt=function(x,y){return occupied[idx(x,y)]===true;};
  // seeded targeting policy produces BOTH history and the answer
  const shots={},hits=[],hist=[];
  const nextShot=function(){
   // kill mode: extend from existing hits
   if(hits.length){
    let axis=null,fixed=null;
    if(hits.length>=2&&hits[0][0]===hits[1][0])axis='v';
    else if(hits.length>=2&&hits[0][1]===hits[1][1])axis='h';
    if(axis==='h'){fixed=hits[0][1];}
    if(axis==='v'){fixed=hits[0][0];}
    const cands=[];
    if(axis==='h'){
     let minX=hits[0][0],maxX=hits[0][0];
     for(let i=1;i<hits.length;i++){minX=Math.min(minX,hits[i][0]);maxX=Math.max(maxX,hits[i][0]);}
     if(r()<.5){cands.push([minX-1,fixed],[maxX+1,fixed]);}else{cands.push([maxX+1,fixed],[minX-1,fixed]);}
    }else if(axis==='v'){
     let minY=hits[0][1],maxY=hits[0][1];
     for(let i=1;i<hits.length;i++){minY=Math.min(minY,hits[i][1]);maxY=Math.max(maxY,hits[i][1]);}
     if(r()<.5){cands.push([fixed,minY-1],[fixed,maxY+1]);}else{cands.push([fixed,maxY+1],[fixed,minY-1]);}
    }else{
     const h=hits[hits.length-1];
     const around=r()<.5?[[h[0]-1,h[1]],[h[0]+1,h[1]],[h[0],h[1]-1],[h[0],h[1]+1]]
                         :[[h[0],h[1]-1],[h[0],h[1]+1],[h[0]-1,h[1]],[h[0]+1,h[1]]];
     for(let i=0;i<around.length;i++)cands.push(around[i]);
    }
    for(let i=0;i<cands.length;i++){
     const cx=cands[i][0],cy=cands[i][1];
     if(cx<0||cy<0||cx>=N||cy>=N)continue;
     if(shots[idx(cx,cy)])continue;
     return [cx,cy];
    }
   }
   // hunt mode: seeded parity scan ((x+y)%2===0 preferred)
   const all=[];
   for(let y=0;y<N;y++)for(let x=0;x<N;x++)all.push([x,y]);
   const order=shuffle(all,r);
   let pick=null;
   for(let i=0;i<order.length;i++){
    const cx=order[i][0],cy=order[i][1];
    if(shots[idx(cx,cy)])continue;
    if((cx+cy)%2===0){pick=order[i];break;}
   }
   if(!pick){
    for(let i=0;i<order.length;i++){if(!shots[idx(order[i][0],order[i][1])]){pick=order[i];break;}}
   }
   return pick;
  };
  for(let s=0;s<kShots;s++){
   const shot=nextShot();
   if(!shot)break;
   const hitR=shipAt(shot[0],shot[1]);
   shots[idx(shot[0],shot[1])]=hitR?'hit':'miss';
   hist.push({x:shot[0],y:shot[1],result:hitR?'hit':'miss'});
   if(hitR)hits.push(shot);
  }
  if(hist.length<kShots){ships=null;continue;}
  if(!hist.some(function(h){return h.result==='hit';})){ships=null;continue;} // want a hit to reason from
  history=hist;pending=nextShot();
 }
 if(!ships||!history||!pending)return null;
 const goal=pending;
 const shotsMap={};
 for(let i=0;i<history.length;i++)shotsMap[idx(history[i].x,history[i].y)]=history[i].result;
 const baseGlyph=function(x,y){
  const res=shotsMap[idx(x,y)];
  if(res==='miss')return {shape:'ring',color:4,rot:0};
  if(res==='hit')return {shape:'triangle',color:1,rot:0};
  return {shape:'square',color:0,rot:0};
 };
 const boardGlyphs=[];
 for(let y=0;y<N;y++)for(let x=0;x<N;x++)boardGlyphs.push(baseGlyph(x,y));
 const tileFor=function(mark){
  const cells=[];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   if(mark&&x===mark[0]&&y===mark[1])cells.push({shape:'cross',color:6,rot:0});
   else cells.push(baseGlyph(x,y));
  }
  return {cols:N,rows:N,cells:cells};
 };
 const correctFrag=tileFor(goal);
 const seen={};seen[JSON.stringify(correctFrag)]=1;
 const options=[correctFrag];
 // plausible decoys: unshot cells nearest the last shot first
 const lastH=history[history.length-1];
 const unshot=[];
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  if(shotsMap[idx(x,y)])continue;
  if(x===goal[0]&&y===goal[1])continue;
  unshot.push([x,y,Math.abs(x-lastH.x)+Math.abs(y-lastH.y)]);
 }
 unshot.sort(function(a,b){return a[2]-b[2];});
 for(let i=0;i<unshot.length&&options.length<8;i++){
  const f=tileFor(unshot[i]);
  const key=JSON.stringify(f);
  if(!seen[key]){seen[key]=1;options.push(f);}
 }
 let fg=0;
 while(options.length<8&&fg++<60){
  const mx=Math.floor(r()*N),my=Math.floor(r()*N);
  const f=tileFor([mx,my]);
  const key=JSON.stringify(f);
  if(!seen[key]){seen[key]=1;options.push(f);}
 }
 if(options.length<8)return null;
 const answer=Math.floor(r()*8);
 const others=options.slice(1);others.splice(answer,0,correctFrag);
 return {
  id:'retro-battleship-'+d+'-'+seed.toString(36),kind:'retro',difficulty:d,
  prompt:'WHERE DOES THE TARGETING COMPUTER FIRE NEXT?',
  rule:'after a hit, keep pressing along the ship\u2019s line',
  retro:{game:'battleship',data:{n:N,history:history,next:goal,shipsHidden:true}},
  board:{cols:N,rows:N,cells:boardGlyphs},
  options:others,answer:answer
 };
}

/* ---------------- registry ---------------- */
const GAMES={pacman:genPacman,doom:genDoom,battleship:genBattleship};
function gen(opts){
 opts=opts||{};
 const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
 const seed=(opts.seed!=null?opts.seed:(Date.now()^Math.random()*1e9))>>>0;
 const game=GAMES[opts.game]?opts.game:'pacman';
 const r=mul(seed);
 return GAMES[game](d,seed,r);
}
function validate(p){
 const errors=[];
 if(!p||typeof p!=='object')return {ok:false,errors:['not an object']};
 if(p.kind!=='retro')errors.push('kind must be "retro"');
 if(!p.retro||!GAMES[p.retro.game])errors.push('retro.game must be pacman|doom|battleship');
 if(!Array.isArray(p.options)||p.options.length!==8)errors.push('options must hold exactly 8 tiles');
 else{
  for(let i=0;i<p.options.length;i++){
   const t=p.options[i];
   if(!t||!Array.isArray(t.cells)||!t.cols||!t.rows||t.cols*t.rows!==t.cells.length){errors.push('option '+i+' is not a well-formed tile');break;}
  }
 }
 if(typeof p.answer!=='number'||p.answer<0||p.answer>7||(p.answer|0)!==p.answer)errors.push('answer must be an integer 0..7');
 if(!p.board||!Array.isArray(p.board.cells))errors.push('board missing');
 if(Array.isArray(p.options)&&p.options.length===8){
  const keys={};
  for(let i=0;i<8;i++){
   const k=JSON.stringify(p.options[i].cells);
   if(keys[k])errors.push('duplicate option tiles');
   keys[k]=1;
  }
 }
 return {ok:errors.length===0,errors:errors};
}
function explain(p){return (p&&p.rule)||'';}
function selfTest(){
 const out={games:{},ok:true};
 Object.keys(GAMES).forEach(function(game){
  const g={deterministic:true,valid:true};
  for(let s=0;s<4;s++){
   const seed=[1,42,12345,999999][s];
   const a=gen({game:game,difficulty:1+(s%5),seed:seed});
   const b=gen({game:game,difficulty:1+(s%5),seed:seed});
   if(JSON.stringify(a)!==JSON.stringify(b)){g.deterministic=false;out.ok=false;}
   const v=validate(a);
   if(!v.ok){g.valid=false;g.errors=v.errors;out.ok=false;}
  }
  out.games[game]=g;
 });
 return out;
}
const api={name:'retroB',generate:gen,validate:validate,explain:explain,selfTest:selfTest};
root.IQ.Gens=root.IQ.Gens||{};
root.IQ.Gens.retroB=api;
Object.keys(GAMES).forEach(function(game){
 root.IQ.Gens[game]={name:game,generate:function(o){o=o||{};return gen(Object.assign({},o,{game:game}));},
  validate:validate,explain:explain,selfTest:selfTest};
});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
