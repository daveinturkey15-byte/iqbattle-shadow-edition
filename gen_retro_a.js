/* IQ.Gens['retroA'] — RETRO TAKEOVER generators for IQ BATTLE (contract C5).
 * Two arcade-parody puzzle families, both emitting STANDARD option tiles
 * ({cols,rows,cells}) so the existing renderer draws them unchanged.
 *
 * Interaction model (per C5 "implementer picks simplest", documented here):
 *   picking = choosing the OUTCOME TILE. No live play, no canvas sim needed
 *   for scoring — host-authoritative, answer field untouched.
 *
 * SNAKE ('snake'): 7x7 board shows the final snake body + food after a seeded
 *   simulation. The seeded movement policy continues after the snapshot; the
 *   food is eaten the moment the head enters its square, so the correct tile
 *   marks the FOOD SQUARE (verified reachable by forward simulation).
 *   Decoy tiles mark other plausible/reachable empty squares.
 *
 * TETRIS ('tetris'): a stacked well + falling piece are shown. The piece(s)
 *   hard-drop straight down (no player input); the correct tile is a mini-well
 *   rendering the resulting TOPMOST FILLED ROW's gap pattern. Decoys are
 *   bit-mutations / shifts of that pattern.
 *
 * Determinism: everything keyed off mulberry32(opts.seed) (same pattern as
 * gen_iqb.js). Same seed => deepEqual puzzle. No timers, no motion, no
 * flashing — pure static puzzle data (IQB_MOTION not applicable here).
 * Host-authoritative: never invents scoring, never touches answer flow.
 */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};

function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* ---------- shared helpers ---------- */
function key(x,y){return x+','+y}
function idx(x,y,W){return y*W+x}

/* ================= SNAKE ================= */
var SN=7; /* grid side */
var C_BODY=5,C_HEAD=2,C_FOOD=0;

function snakeSim(d,r){
 var len=d<=2?3:(d<=4?5:7);
 var steps=8+d*4;
 var DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
 for(var attempt=0;attempt<40;attempt++){
  var hx=(len-1)+Math.floor(r()*(SN-len));
  var hy=1+Math.floor(r()*(SN-2));
  var body=[];
  for(var i=0;i<len;i++)body.push({x:hx-i,y:hy});
  var occ={};for(i=0;i<body.length;i++)occ[key(body[i].x,body[i].y)]=1;
  var food=null;
  while(!food){
   var fx=Math.floor(r()*SN),fy=Math.floor(r()*SN);
   if(!occ[key(fx,fy)])food={x:fx,y:fy};
  }
  var dead=false;
  for(var s=0;s<steps;s++){
   var head=body[0];
   var cand=[];
   for(var di=0;di<4;di++){
    var nx=head.x+DIRS[di][0],ny=head.y+DIRS[di][1];
    if(nx<0||ny<0||nx>=SN||ny>=SN)continue;
    if(occ[key(nx,ny)])continue;
    cand.push(di);
   }
   if(!cand.length){dead=true;break}
   var nd=cand[Math.floor(r()*cand.length)];
   var nh={x:head.x+DIRS[nd][0],y:head.y+DIRS[nd][1]};
   body.unshift(nh);occ[key(nh.x,nh.y)]=1;
   if(nh.x===food.x&&nh.y===food.y){
    /* ate: grow (keep tail), respawn food */
    var nf=null,guard=0;
    while(!nf&&guard++<200){
     var rx=Math.floor(r()*SN),ry=Math.floor(r()*SN);
     if(!occ[key(rx,ry)])nf={x:rx,y:ry};
    }
    if(!nf){dead=true;break}
    food=nf;
   }else{
    var t=body.pop();delete occ[key(t.x,t.y)];
   }
  }
  if(dead)continue;
  /* forward-verify: continuing the same seeded policy, the head must reach
     the food (eat square == food square) before trapping itself */
  var ok=false,guard2=0;
  while(!ok&&!dead&&guard2++<500){
   head=body[0];cand=[];
   for(di=0;di<4;di++){
    nx=head.x+DIRS[di][0];ny=head.y+DIRS[di][1];
    if(nx<0||ny<0||nx>=SN||ny>=SN)continue;
    if(occ[key(nx,ny)])continue;
    cand.push(di);
   }
   if(!cand.length){dead=true;break}
   nd=cand[Math.floor(r()*cand.length)];
   nh={x:head.x+DIRS[nd][0],y:head.y+DIRS[nd][1]};
   body.unshift(nh);
   if(nh.x===food.x&&nh.y===food.y){ok=true;break}
   occ[key(nh.x,nh.y)]=1;
   var t2=body.pop();delete occ[key(t2.x,t2.y)];
  }
  if(ok)return{body:body,food:food,answer:idx(food.x,food.y,SN)};
 }
 /* deterministic last resort: straight line, never triggers in practice */
 return{body:[{x:3,y:3},{x:2,y:3},{x:1,y:3}],food:{x:5,y:3},answer:idx(5,3,SN)};
}

function snakeBoardCells(sim){
 var cells=new Array(SN*SN).fill(null);
 for(var i=sim.body.length-1;i>=0;i--){
  var seg=sim.body[i];
  cells[idx(seg.x,seg.y,SN)]={shape:i===0?'diamond':'square',color:i===0?C_HEAD:C_BODY,rot:0};
 }
 cells[idx(sim.food.x,sim.food.y,SN)]={shape:'ring',color:C_FOOD,rot:0};
 return cells;
}

function markerTile(cellIndex){
 var cells=new Array(SN*SN).fill(null);
 cells[cellIndex]={shape:'ring',color:C_FOOD,rot:0};
 return{cols:SN,rows:SN,cells:cells};
}

function snakeGen(d,seed,r){
 var sim=snakeSim(d,r);
 var cells=snakeBoardCells(sim);
 var answer=sim.answer;
 /* decoys: reachable EMPTY squares near the action, seeded order */
 var head=sim.body[0];
 var occb={};for(var i=0;i<sim.body.length;i++)occb[key(sim.body[i].x,sim.body[i].y)]=1;
 var pool=[],near=[];
 for(var y=0;y<SN;y++)for(var x=0;x<SN;x++){
  if(occb[key(x,y)])continue;
  var dist=Math.abs(x-head.x)+Math.abs(y-head.y);
  if(dist<=3)near.push(idx(x,y,SN));else pool.push(idx(x,y,SN));
 }
 /* seeded shuffle both pools */
 for(i=near.length-1;i>0;i--){var j=Math.floor(r()*(i+1));var t=near[i];near[i]=near[j];near[j]=t}
 for(i=pool.length-1;i>0;i--){j=Math.floor(r()*(i+1));t=pool[i];pool[i]=pool[j];pool[j]=t}
 var candPool=near.concat(pool).filter(function(c){return c!==answer});
 var options=[markerTile(answer)];
 var seen={};seen[answer]=1;
 var ci=0;
 while(options.length<8&&ci<candPool.length){
  var c=candPool[ci++];
  if(seen[c])continue;
  seen[c]=1;options.push(markerTile(c));
 }
 while(options.length<8){ /* saturated-board fallback: recolor markers */
  var m=new Array(SN*SN).fill(null);
  m[answer]={shape:'ring',color:(C_FOOD+options.length)%8,rot:0};
  options.push({cols:SN,rows:SN,cells:m});
 }
 var answerPos=Math.floor(r()*8);
 var others=options.slice(1);others.splice(answerPos,0,options[0]);
 return{id:'retroA-snake-'+seed.toString(36),kind:'retro',retro:{game:'snake'},difficulty:d,
  prompt:'WHERE WILL THE SNAKE EAT NEXT?',rule:'the snake follows its seeded path — food is eaten on the square it sits on',
  board:{cols:SN,rows:SN,cells:cells},
  options:others,answer:answerPos};
}

/* ================= TETRIS ================= */
var C_STACK=4,C_PIECE=6;
var BASE={
 I:[[1,1,1,1]],
 O:[[1,1],[1,1]],
 T:[[1,1,1],[0,1,0]],
 S:[[0,1,1],[1,1,0]],
 Z:[[1,1,0],[0,1,1]],
 J:[[1,0,0],[1,1,1]],
 L:[[0,0,1],[1,1,1]]
};
var TYPES=['I','O','T','S','Z','J','L'];
function rotCW(m){
 var h=m.length,w=m[0].length,out=[];
 for(var x=0;x<w;x++){var row=[];for(var y=h-1;y>=0;y--)row.push(m[y][x]);out.push(row)}
 return out;
}
function pieceMat(type,rot){
 var m=BASE[type];
 for(var i=0;i<rot%4;i++)m=rotCW(m);
 return m;
}

function tetrisGen(d,seed,r){
 var W=d<=2?4:(d<=4?5:6);
 var H=d+5;
 var maxH=Math.min(H-3,1+d); /* cap stack so top rows stay clear */
 var k=d<=2?1:(d<=4?2:3);
 var grid=[];
 for(var y=0;y<H;y++)grid.push(new Array(W).fill(0));
 for(var x=0;x<W;x++){
  var h=1+Math.floor(r()*maxH);
  for(y=0;y<h;y++)grid[H-1-y][x]=1;
 }
 var firstPiece=null;
 for(var p=0;p<k;p++){
  var placed=false,guard=0;
  while(!placed&&guard++<60){
   var type=TYPES[Math.floor(r()*TYPES.length)];
   var rot=Math.floor(r()*4);
   var m=pieceMat(type,rot);
   var mh=m.length,mw=m[0].length;
   if(mw>W)continue;
   var px=Math.floor(r()*(W-mw+1));
   var landY=-1;
   for(y=0;y<=H-mh;y++){
    var fit=true;
    for(var my=0;my<mh&&fit;my++)for(var mx=0;mx<mw&&fit;mx++){
     if(!m[my][mx])continue;
     if(grid[y+my][px+mx])fit=false;
    }
    if(fit)landY=y;else break; /* must be a clean vertical fall */
   }
   if(landY<0)continue;
   for(my=0;my<mh;my++)for(mx=0;mx<mw;mx++){
    if(m[my][mx])grid[landY+my][px+mx]=1;
   }
   if(p===0)firstPiece={type:type,rot:rot,x:px,m:m};
   placed=true;
  }
 }
 /* topmost filled row => outcome pattern */
 var top=-1;
 for(y=0;y<H;y++){var any=false;for(x=0;x<W;x++)if(grid[y][x]){any=true;break}if(any){top=y;break}}
 if(top<0)top=H-1;
 var pat=grid[top].slice();
 function tileOf(pattern){
  return{cols:W,rows:1,cells:pattern.map(function(f){return f?{shape:'square',color:C_STACK,rot:0}:null})};
 }
 function pk(pattern){return pattern.join('')}
 var answerKey=pk(pat);
 var options=[tileOf(pat)];
 var seen={};seen[answerKey]=1;
 guard=0;
 while(options.length<8&&guard++<400){
  var m2=pat.slice();
  var roll=r();
  if(roll<.45){ /* toggle one bit */
   var b=Math.floor(r()*W);m2[b]=m2[b]?0:1;
  }else if(roll<.75){ /* shift by one, wrap */
   var dir=r()<.5?1:W-1;
   m2=m2.map(function(_,i){return pat[(i+dir)%W]});
  }else{ /* toggle two bits */
   b=Math.floor(r()*W);var b2=Math.floor(r()*W);if(b2===b)b2=(b2+1)%W;
   m2[b]=m2[b]?0:1;m2[b2]=m2[b2]?0:1;
  }
  var kk=pk(m2);
  if(!seen[kk]){seen[kk]=1;options.push(tileOf(m2))}
 }
 while(options.length<8){ /* recolor fallback, keeps pattern semantics */
  var cells=pat.map(function(f){return f?{shape:'square',color:(C_STACK+options.length)%8,rot:0}:null});
  options.push({cols:W,rows:1,cells:cells});
 }
 var answerPos=Math.floor(r()*8);
 var others=options.slice(1);others.splice(answerPos,0,options[0]);
 /* board: stacked well + first falling piece ghosted at the top */
 var bcells=new Array(W*H).fill(null);
 for(y=0;y<H;y++)for(x=0;x<W;x++)if(grid[y][x])bcells[idx(x,y,W)]={shape:'square',color:C_STACK,rot:0};
 if(firstPiece){
  var fm=firstPiece.m;
  for(my=0;my<fm.length;my++)for(mx=0;mx<fm[0].length;mx++){
   if(fm[my][mx]){
    var bx=firstPiece.x+mx,by=my;
    if(by<H&&!bcells[idx(bx,by,W)])bcells[idx(bx,by,W)]={shape:'square',color:C_PIECE,rot:0};
   }
  }
 }
 return{id:'retroA-tetris-'+seed.toString(36),kind:'retro',retro:{game:'tetris'},difficulty:d,
  prompt:'WHICH TOP ROW RESULTS AFTER THE DROP?',rule:'the piece falls straight down — read the gap pattern of the topmost filled row',
  board:{cols:W,rows:H,cells:bcells},
  options:others,answer:answerPos};
}

/* ================= registration ================= */
function clampOpts(opts){
 opts=opts||{};
 var d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
 var seed=(opts.seed!=null?opts.seed:(Date.now()^Math.random()*1e9))>>>0;
 return{opts:opts,d:d,seed:seed,r:mul(seed)};
}
function genOne(game,opts){
 var c=clampOpts(opts);
 if(game==='auto')game=c.r()<.5?'snake':'tetris';
 return game==='tetris'?tetrisGen(c.d,c.seed,c.r):snakeGen(c.d,c.seed,c.r);
}
function validate(p){
 return{ok:!!(p&&p.kind==='retro'&&p.retro&&(p.retro.game==='snake'||p.retro.game==='tetris')&&p.options&&p.options.length===8&&typeof p.answer==='number'&&p.answer>=0&&p.answer<8&&p.board)};
}
function explain(p){return (p&&p.rule)||''}

root.IQ.Gens=root.IQ.Gens||{};
root.IQ.Gens.retroA={
 name:'retroA',
 generate:function(opts){
  opts=opts||{};
  var game=opts.game==='snake'||opts.game==='tetris'?opts.game:'auto';
  return genOne(game,opts);
 },
 validate:validate,explain:explain};
root.IQ.Gens.snake={
 name:'snake',
 generate:function(opts){return genOne('snake',opts)},
 validate:validate,explain:explain};
root.IQ.Gens.tetris={
 name:'tetris',
 generate:function(opts){return genOne('tetris',opts)},
 validate:validate,explain:explain};

if(typeof module!=='undefined'&&module.exports)module.exports=root.IQ.Gens.retroA;
})();
