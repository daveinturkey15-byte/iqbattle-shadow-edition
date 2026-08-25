/* Room-name broadcast smoke — slices the REAL functions out of index.html, stubs DOM. */
const fs = require('fs');
const html = fs.readFileSync('C:/Users/david/Desktop/stuff/iqbattle/index.html', 'utf8');
function grab(name) {
  const m = html.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
  return m[0];
}
const src = grab('applyRoomMeta') + '\n' + grab('refreshLobbyTitle') + '\n' + grab('updateTitle');
const G = { screen: 'lobby', stage: 0, mp: { on: true, host: false, code: 'X7K2Q' } };
let lobbyText = null, titleText = null, docTitle = null;
const $ = (sel) => ({
  '#lobby-title': { set textContent(v) { lobbyText = v; } },
  '#room-title': { set textContent(v) { titleText = v; } }
})[sel];
const { applyRoomMeta, refreshLobbyTitle } = new Function(
  'G', '$', 'document',
  src + '\nreturn {applyRoomMeta:applyRoomMeta,refreshLobbyTitle:refreshLobbyTitle};'
)(G, $, {});
let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + ': ' + JSON.stringify(got));
}
// 1. meta arrives while in lobby -> "<roomName> · <CODE>"
applyRoomMeta("Dave's Den");
check('lobby title after meta', lobbyText, "Dave's Den · X7K2Q");
// 2. meta arrives during play -> play-screen title likewise
G.screen = 'play'; applyRoomMeta("Dave's Den");
check('play title after meta', titleText, "Dave's Den · X7K2Q");
// 3. no room name yet -> fallback
G.mp.roomName = undefined; G.screen = 'lobby'; refreshLobbyTitle();
check('lobby fallback', lobbyText, 'Room');
// 4. host guard — must not clobber host share-hint title
G.mp.host = true; lobbyText = 'HOST SHARE HINT';
refreshLobbyTitle(); applyRoomMeta('X');
check('host title untouched', lobbyText, 'HOST SHARE HINT');
// 5. empty rn ignored
G.mp.host = false; delete G.mp.roomName;
applyRoomMeta('');
check('empty rn ignored', G.mp.roomName === undefined ? 'ignored' : 'set!', 'ignored');
console.log(fails ? 'SMOKE FAILURES: ' + fails : 'ALL SMOKE PASS');
process.exit(fails ? 1 : 0);
