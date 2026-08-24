/* IQ.Gens['missingSec'] — MISSING-SECTION generator pack for IQ BATTLE (W1).
 * Faithful to the ORIGINAL iqversus 'missing section' family
 * (research/w1-original-recon.md#17): a larger REPEATING pattern field
 * (6x6 leaf cells tiled from 2x2 / 2x3 motif blocks — cube / flower /
 * lattice motifs) with one whole rectangular SECTION removed.
 *
 * Board envelope: kind:'matrix', board.cells holds COMPOSITE sub-tiles
 * ({cols,rows,cells:[leaf…]}) which index.html tileSVG (#238-245) renders
 * through its one-level c.cells recursion. The removed section is a null
 * board cell -> renderer draws the '?' placeholder (showQ path).
 * Options are multi-cell candidate sections (cols/rows > 1); the correct
 * one continues the global repeat exactly (spacing + orientation + face
 * colors preserved); decoys are orientation-flipped / phase-shifted /
 * color-swapped sections.
 *
 * Global repeat rules over the BLOCK grid (bx,by):
 *   rowColor   : face color constant along each block-row
 *   colColor   : face color constant down each block-column
 *   checker    : color alternates with (bx+by) parity
 *   latin      : every block row/column sees each color once, (bx+by)%3
 *   diagStep   : hue steps linearly, (h0 + sx*bx + sy*by) % 8
 * Orientation rule (difficulty>=3): triangle faces, rot=(a*bx+b*by)%4.
 * Spacing templates (identical in EVERY block, part of the repeat):
 *   solid | lattice(corners empty) | checkerboard(empty alternating)
 *
 * API: window.IQ.Gens.missingSec = {name,'generate(opts{difficulty1-5,kinds?,seed?})',
 *   validate(p)->{ok,errors}, explain(p), selfTest(n?)->{pass,fail,details}}
 * Deterministic under the same seed (mulberry32). No client-side scoring.
 */
(function(){
const root=typeof window!=='undefined'?window:globalThis;
root.IQ=root.IQ||{};
root.IQ.Gens=root.IQ.Gens||{};

function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

var SHAPES=['square','diamond','plus','ring','triangle','cross'];
var TEMPLATES=['solid','lattice','checker','bar'];
var COLOR_RULES=['rowColor','colColor','checker','latin','diagStep'];

/* ---- slot occupancy per spacing template ---- */
function slotFilled(template,x,y,w,h){
  if(template==='solid')return true;
  if(template==='bar')return y===0;
  var corner=(x===0||x===w-1)&&(y===0||y===h-1);
  /* lattice = corners empty. On a 2x2 every slot is a corner -> would
     leave an ALL-EMPTY section (degenerate + hangs decoy fill), so 2x2
     blocks fall back to the checker cut. */
  if(template==='lattice')return (w===2&&h===2)?(x+y)%2===0:!corner;
  return (x+y)%2===0; /* checker */
}
function templatesFor(w,h){return (w===2&&h===2)?['solid','checker','bar']:TEMPLATES.slice();}

function buildBlock(rule,pal,h0,sx,sy,rotA,rotB,shape,template,bw,bh,bx,by){
  var leaves=new Array(bw*bh);
  for(var y=0;y<bh;y++)for(var x=0;x<bw;x++){
    var i=y*bw+x;
    if(!slotFilled(template,x,y,bw,bh)){leaves[i]=null;continue;}
    var c;
    if(rule==='rowColor')c=pal[by%pal.length];
    else if(rule==='colColor')c=pal[bx%pal.length];
    else if(rule==='checker')c=pal[(bx+by)%2];
    else if(rule==='latin')c=pal[(bx+by)%3];
    else c=(h0+sx*bx+sy*by)%8;
    var rot=shape==='triangle'?((rotA*bx+rotB*by)%4+4)%4:0;
    leaves[i]={shape:shape,color:c,rot:rot};
  }
  return leaves;
}

/* Reconstruct the TRUE section for block (bx,by) from the public meta. */
function solveSection(meta,bx,by){
  return buildBlock(meta.rule,meta.pal,meta.h0,meta.sx,meta.sy,
    meta.rotA,meta.rotB,meta.shape,meta.template,meta.bw,meta.bh,bx,by);
}

function generate(opts){
  opts=opts||{};
  var d=Math.min(5,Math.max(1,Math.floor(opts.difficulty||2)));
  var seed=(opts.seed!=null?opts.seed:(Date.now()^Math.random()*1e9))>>>0;
  var r=mul(seed);

  /* --- field geometry: block grid over a 6x6 leaf field --- */
  var bh=d>=4&&r()<.5?3:2;          /* section is 2x2 or 2x3 cells */
  var bw=2;
  var BGX=6/bw,BGY=6/bh;            /* 3x3 blocks or 3x2 blocks */

  /* --- global repeat parameters --- */
  var rules=d<=1?['rowColor','colColor']
           :d===2?['rowColor','colColor','checker','latin']
                 :COLOR_RULES.slice();
  var rule=rules[Math.floor(r()*rules.length)];
  var nh=rule==='checker'?2:(d<=1?2:d<=3?(2+Math.floor(r()*2)):3);
  if(rule==='latin')nh=3;
  var pool=[0,1,2,3,4,5,6,7].sort(function(){return r()-.5});
  var pal=pool.slice(0,nh);
  var h0=pool[7];
  var sx=1+Math.floor(r()*2),sy=r()<.5?-sx:sx;

  var shape;
  var wantRot=d>=3&&r()<.55;
  if(wantRot)shape='triangle';                    /* only asymmetric face */
  else shape=['cube','flower','lattice'][Math.floor(r()*3)]==='flower'
      ?(r()<.5?'diamond':'plus'):SHAPES[Math.floor(r()*SHAPES.length)];
  var rotA=wantRot?(r()<.5?0:1):0, rotB=wantRot?(rotA===1?Math.floor(r()*2):1):0;
  if(!wantRot){rotA=0;rotB=0;}

  var templates=d>=3?templatesFor(bw,bh):templatesFor(bw,bh).filter(function(t){return t!=='checker'});
  /* flower motifs favor petal gaps, lattice favors holes */
  var template=templates[Math.floor(r()*templates.length)];

  var meta={bw:bw,bh:bh,BGX:BGX,BGY:BGY,rule:rule,pal:pal,h0:h0,sx:sx,sy:sy,
            rotA:rotA,rotB:rotB,shape:shape,template:template};

  /* --- pick the removed section --- */
  var holeBX=Math.floor(r()*BGX),holeBY=Math.floor(r()*BGY);
  var holeIndex=holeBY*BGX+holeBX;

  /* --- assemble board of composite sub-tiles --- */
  var cells=new Array(BGX*BGY);
  for(var by=0;by<BGY;by++)for(var bx=0;bx<BGX;bx++){
    if(bx===holeBX&&by===holeBY){cells[by*BGX+bx]=null;continue;}
    cells[by*BGX+bx]={cols:bw,rows:bh,
      cells:buildBlock(rule,pal,h0,sx,sy,rotA,rotB,shape,template,bw,bh,bx,by)};
  }

  /* --- options: correct section + mutated decoys --- */
  var truth=solveSection(meta,holeBX,holeBY);
  var tkey=JSON.stringify(truth);
  var options=[],seen={};seen[tkey]=1;
  options.push({cols:bw,rows:bh,cells:truth});

  function cand(fns){
    for(var k=0;k<fns.length;k++){
      var sec;
      try{sec=fns[k]();}catch(e){sec=null;}
      if(!sec)continue;
      var key=JSON.stringify(sec);
      if(seen[key])continue;
      seen[key]=1;
      options.push({cols:bw,rows:bh,cells:sec});
      if(options.length===8)return true;
    }
    return false;
  }
  var shift=function(sec,k){return sec.map(function(c){return c?{shape:c.shape,color:(c.color+k)%8,rot:c.rot}:null;});};
  var rotShift=function(sec,k){return sec.map(function(c){return c?{shape:c.shape,color:c.color,rot:((c.rot+k)%4+4)%4}:null;});};
  var east=solveSection(meta,(holeBX+1)%BGX,holeBY);
  var south=solveSection(meta,holeBX,(holeBY+1)%BGY);
  var diag=solveSection(meta,(holeBX+1)%BGX,(holeBY+1)%BGY);
  var otherTemplate=templates.filter(function(t){return t!==template});
  var pool2=[
    function(){return shift(truth,1)},
    function(){return shift(truth,3)},
    function(){return rotShift(truth,1)},
    function(){return rotShift(east,2)},
    function(){return shift(east,1)},
    function(){return south},
    function(){return diag},
    function(){return buildBlock(rule,pal,h0,sx,sy,rotA,rotB,shape,otherTemplate[Math.floor(r()*otherTemplate.length)],bw,bh,holeBX,holeBY)},
    function(){return shift(south,2)},
    function(){return rotShift(diag,3)}
  ];
  /* draw candidates without replacement, deterministic order */
  var idx=pool2.map(function(_,i){return i});
  for(var i=idx.length-1;i>0;i--){var j=Math.floor(r()*(i+1));var t=idx[i];idx[i]=idx[j];idx[j]=t;}
  cand(idx.map(function(i){return pool2[i]}));
  /* deterministic filler: fresh color shifts guarantee completion */
  var off=1;
  while(options.length<8&&off<=64){
    var sec=shift(truth,off%8);off++;
    var key=JSON.stringify(sec);
    if(seen[key])continue;
    seen[key]=1;options.push({cols:bw,rows:bh,cells:sec});
  }

  var answer=Math.floor(r()*8);
  var correct=options.shift();
  options.splice(answer,0,correct);

  return {id:'miss-'+d+'-'+seed.toString(36),kind:'matrix',difficulty:d,
    prompt:'WHICH SECTION COMPLETES THE PATTERN?',
    rule:explainMeta(meta),
    board:{cols:BGX,rows:BGY,cells:cells,holeIndex:holeIndex},
    options:options,answer:answer,meta:meta};
}

function explainMeta(m){
  var s={rowColor:'each band of the field keeps one face color',
         colColor:'each column of the field keeps one face color',
         checker:'face colors alternate checkerboard-wise across the field',
         latin:'every band and column of the field cycles the same three face colors',
         diagStep:'the face hue steps steadily along the field diagonals'}[m.rule];
  if(m.rotA||m.rotB)s+='; faces rotate stepwise across the field';
  if(m.template!=='solid')s+='; '+m.template+' spacing repeats in every motif';
  return s;
}

function validate(p){
  var errors=[];
  if(!p||typeof p!=='object'){errors.push('puzzle missing');}
  else{
    if(p.kind!=='matrix')errors.push('kind must be matrix');
    var b=p.board;
    if(!b||!b.cells||!(b.cols>0&&b.rows>0))errors.push('board missing');
    else{
      if(b.cells.length!==b.cols*b.rows)errors.push('board cells != cols*rows');
      var holes=0,tiles=0;
      b.cells.forEach(function(c){
        if(c==null){holes++;return;}
        if(!(c.cols>1&&c.rows>1&&Array.isArray(c.cells)&&c.cells.length===c.cols*c.rows))errors.push('board sub-tile not composite');
        else tiles++;
      });
      if(holes!==1)errors.push('expected exactly one removed section, got '+holes);
      if(!tiles)errors.push('no composite sections on board');
      if(typeof b.holeIndex!=='number'||b.cells[b.holeIndex]!==null)errors.push('holeIndex does not point at the hole');
    }
    if(!Array.isArray(p.options)||p.options.length!==8)errors.push('need exactly 8 options');
    else{
      var keys={};
      p.options.forEach(function(o,i){
        if(!(o.cols>1&&o.rows>1&&Array.isArray(o.cells)&&o.cells.length===o.cols*o.rows))errors.push('option '+i+' not a multi-cell section');
        else{var k=JSON.stringify(o.cells);if(keys[k])errors.push('duplicate option at '+i);keys[k]=1;}
      });
      if(typeof p.answer!=='number'||p.answer<0||p.answer>7)errors.push('answer out of range');
    }
  }
  return {ok:errors.length===0,errors:errors};
}

function explain(p){return (p&&p.rule)||'';}

/* Minimal mirror of index.html#238-245 tileSVG recursion — test-only,
   proves boards/options render as nested SVG strings without DOM. */
function mirrorTileSVG(tile,size){
  var t=tile||{cols:1,rows:1,cells:[null]};
  var cs=size/Math.max(t.cols,t.rows),out='';
  for(var i=0;i<t.cols*t.rows;i++){
    var c=t.cells[i],x=(i%t.cols)*cs,y=Math.floor(i/t.cols)*cs;
    out+='<rect>';
    if(c&&c.cells&&c.cells.length)out+=mirrorTileSVG(c,cs);
    else if(c)out+='<glyph>';
  }
  return '<svg>'+out+'</svg>';
}

function selfTest(n){
  n=n||40;
  var pass=0,fail=0,details=[];
  for(var i=0;i<n;i++){
    var d=1+(i%5),seed=0xBEEF+i*7919;
    var p;
    try{p=generate({difficulty:d,seed:seed});}
    catch(e){fail++;details.push('d'+d+' seed'+seed+' threw '+e.message);continue;}
    var v=validate(p);
    if(!v.ok){fail++;details.push('d'+d+' seed'+seed+' invalid: '+v.errors.join('; '));continue;}
    /* exactly one correct: recompute truth from shipped meta */
    var m=p.meta,hx=p.board.holeIndex%p.board.cols,hy=Math.floor(p.board.holeIndex/p.board.cols);
    var truth=JSON.stringify(solveSection(m,hx,hy));
    var hits=p.options.filter(function(o){return JSON.stringify(o.cells)===truth}).length;
    if(hits!==1){fail++;details.push('d'+d+' seed'+seed+' correct-count='+hits);continue;}
    if(JSON.stringify(p.options[p.answer].cells)!==truth){fail++;details.push('d'+d+' seed'+seed+' answer misindexed');continue;}
    /* determinism */
    var p2=generate({difficulty:d,seed:seed});
    if(JSON.stringify(p)!==JSON.stringify(p2)){fail++;details.push('d'+d+' seed'+seed+' nondeterministic');continue;}
    /* render sanity: mirrored tileSVG produces non-empty nested SVG everywhere */
    var boardSvg=mirrorTileSVG({cols:p.board.cols,rows:p.board.rows,cells:p.board.cells},300);
    var optOk=p.options.every(function(o){return mirrorTileSVG(o,104).indexOf('<svg')===0});
    if(boardSvg.indexOf('<svg')!==0||boardSvg.indexOf('<svg><rect>')<0||!optOk){
      fail++;details.push('d'+d+' seed'+seed+' render mirror empty');continue;}
    pass++;
  }
  return {pass:pass,fail:fail,details:details};
}

var api={name:'missingSec',generate:generate,validate:validate,explain:explain,selfTest:selfTest};
root.IQ.Gens.missingSec=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof require!=='undefined'&&typeof module!=='undefined'&&require.main===module){
  console.log(JSON.stringify(selfTest(40)));
}
})();