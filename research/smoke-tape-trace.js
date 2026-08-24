
// focused: trace the unwatched cycle state
const g = globalThis; g.window = g;
g.localStorage = { getItem: () => null };
g.document = { head:{appendChild(){}}, body:{classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}}},
  addEventListener(){}, removeEventListener(){}, createElement(){ return {style:{}, set textContent(v){}, appendChild(){}} } };
g.performance = { now: () => Date.now() };
require('C:/Users/david/Desktop/stuff/iqbattle/worlds.js');
require('C:/Users/david/Desktop/stuff/iqbattle/hooks.js');
require('C:/Users/david/Desktop/stuff/iqbattle/pack-horror.js');
const H = g.IQ.Hooks;
function mb(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
H.beginRun('run-A', 12345);
for (let r=1;r<=18;r++){
  const m = H.dispatch('roundStart',{round:r,runId:'run-A',world:'well-curse',rng:mb(r),optCount:8})[0];
  console.log('round',r,'cd=',H.state.get('pack-horror:tapeCountdown'),'watched=',!!H.state.get('pack-horror:tapeWatched'),'mod=',m&&JSON.stringify({hp:m.hpDelta,flag:m.flag,b:m.bannerText}));
}
