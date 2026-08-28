/* IQ.GenV 'iqb' — research-faithful generator matching captured original-site puzzles.
   Archetypes: colorRow, colorCol, latinSquare, hueStepDiag. Grids 2x2 (easy) / 3x3.
   Hole always bottom-right. Decoys = single-attribute mutations, duplicates allowed. */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function gen(opts){
 opts=opts||{};const d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
 const seed=(opts.seed!=null?opts.seed:(Date.now()^Math.random()*1e9))>>>0;
 const r=mul(seed);
 const size=d<=1?2:3,n=size*size;
 const kinds=Array.isArray(opts.kinds)&&opts.kinds.length?opts.kinds:['matrix'];
 const kind=kinds.indexOf('matrix')>=0?'matrix':kinds[0];
 if(kind!=='matrix')return fallback(kind,d,seed,r);
 const archs=d<=1?['colorRow','colorCol']:['colorRow','colorCol','latinSquare','hueStepDiag'];
 const arch=archs[Math.floor(r()*archs.length)];
 const shape=r()<.7?'plus':(r()<.5?'ring':'square');
 const hues=[0,1,2,3,4,5,6].sort(function(){return r()-.5});
 const rot=r()<.12?Math.floor(r()*4):0;
 const cells=new Array(n).fill(null);
 const ruleName={colorRow:'each row holds one color',colorCol:'each column holds one color',latinSquare:'every row and column contains each color exactly once',hueStepDiag:'colors step one slot along the reading order'}[arch];
 if(arch==='colorRow'){
  for(let y=0;y<size;y++){const c=hues[y%Math.min(3,hues.length)];for(let x=0;x<size;x++)cells[y*size+x]={shape:shape,color:c,rot:rot};}
 }else if(arch==='colorCol'){
  for(let x=0;x<size;x++){const c=hues[x%Math.min(3,hues.length)];for(let y=0;y<size;y++)cells[y*size+x]={shape:shape,color:c,rot:rot};}
 }else if(arch==='latinSquare'){
  const h=hues.slice(0,size===2?2:3);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)cells[y*size+x]={shape:shape,color:h[(x+y)%h.length],rot:rot};
 }else{
  const step=hues.length>1?1:0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)cells[y*size+x]={shape:shape,color:(hues[0]+step*(x+y))%8,rot:rot};
 }
 const hole=n-1;cells[hole]=null;
 var truth;
 if(arch==='colorRow')truth={shape:shape,color:cells[(Math.floor(hole/size)*size)%cells.length].color,rot:rot};
 else if(arch==='colorCol')truth={shape:shape,color:cells[hole%size].color,rot:rot};
 else if(arch==='latinSquare'){const h=hues.slice(0,size===2?2:3);const x=hole%size,y=Math.floor(hole/size);truth={shape:shape,color:h[(x+y)%h.length],rot:rot};}
 else {const x=hole%size,y=Math.floor(hole/size);truth={shape:shape,color:(hues[0]+(hues.length>1?1:0)*(x+y))%8,rot:rot};}
 const correct={cols:1,rows:1,cells:[truth]};
 const options=[correct];
 const seen={};seen[JSON.stringify(truth)]=1;
 let guard=0;
 while(options.length<8&&guard++<200){
  const m={shape:truth.shape,color:truth.color,rot:truth.rot};
  const roll=r();
  if(roll<.6)m.color=(m.color+1+Math.floor(r()*7))%8;
  else if(roll<.8)m.shape=['plus','ring','square','triangle','diamond','cross'][Math.floor(r()*6)];
  else m.rot=(m.rot+1+Math.floor(r()*3))%4;
  const key=JSON.stringify(m);
  if(!seen[key]){seen[key]=1;options.push({cols:1,rows:1,cells:[m]})}
 }
 while(options.length<8)options.push({cols:1,rows:1,cells:[{shape:truth.shape,color:(truth.color+options.length)%8,rot:truth.rot}]});
 const answer=Math.floor(r()*8);
 const others=options.slice(1);others.splice(answer,0,correct);
 return {id:'iqb-m'+d+'-'+seed.toString(36),kind:'matrix',difficulty:d,
  prompt:'WHICH FRAGMENT COMPLETES THE PATTERN?',rule:ruleName,
  board:{cols:size,rows:size,cells:cells,holeIndex:hole},
  options:others,answer:answer};
}
function fallback(kind,d,seed,r){
 const n=d<=1?3:4;const hues=[0,1,2,3,4,5,6].sort(function(){return r()-.5});
 const shape=['plus','ring','square','triangle','diamond','cross'][Math.floor(r()*6)];
 if(kind==='sequence'){
  const seq=[];for(let i=0;i<n;i++)seq.push({shape:shape,color:hues[i%hues.length],rot:0});
  const correct={shape:shape,color:hues[n%hues.length],rot:0};
  const options=[{cols:1,rows:1,cells:[correct]}];
  while(options.length<8){const m={shape:shape,color:(correct.color+options.length)%8,rot:0};options.push({cols:1,rows:1,cells:[m]})}
  return {id:'iqb-s-'+seed.toString(36),kind:'sequence',difficulty:d,prompt:'WHAT COMES NEXT?',rule:'colors continue the sequence',seq:seq,options:options,answer:Math.floor(r()*8)};
 }
 const size=3,cells=[];const odd=Math.floor(r()*n);
 for(let i=0;i<n;i++)cells.push({shape:shape,color:hues[0],rot:0});
 cells[odd]={shape:shape,color:hues[1],rot:0};
 const correct={shape:shape,color:hues[1],rot:0};
 const options=[{cols:1,rows:1,cells:[correct]}];
 while(options.length<8){const m={shape:shape,color:(hues[1]+1+Math.floor(r()*6))%8,rot:0};options.push({cols:1,rows:1,cells:[m]})}
 return {id:'iqb-o-'+seed.toString(36),kind:'oddone',difficulty:d,prompt:'ONE FRAGMENT IS AN IMPOSTOR',rule:'one cell breaks the color pattern',oddBoard:{cols:size,rows:size,cells:cells,oddIndex:odd},options:options,answer:Math.floor(r()*8)};
}
root.IQ.GenV={name:'iqb',generate:gen,validate:function(p){return {ok:!!(p&&p.options&&p.options.length===8&&typeof p.answer==='number'&&p.answer>=0&&p.answer<8&&(p.board||p.seq||p.oddBoard))}},
 explain:function(p){return (p&&p.rule)||''}};
if(typeof module!=='undefined'&&module.exports)module.exports=root.IQ.GenV;
})();
