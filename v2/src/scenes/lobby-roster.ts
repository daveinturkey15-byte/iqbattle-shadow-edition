/* ============================================================================
 * LOBBY ROSTER POLICY — who is "you", and who may press START.
 *
 * Pixi-free on purpose so `src/scenes/selftest-lobby.ts` can gate it under
 * bare node, the same split as textinput-keys.ts.
 *
 * The defect this exists to prevent: the lobby tagged the "you" card by SEAT
 * INDEX (`i === 0 ? ['you','host'] : []`). Seat 0 is always the HOST, so on
 * every joiner's screen the host's card read "you · host" — each joiner was
 * told they were the host, and the host's real name was shown as their own.
 * Identity is the only thing that can answer "which of these is me", and the
 * net layer has always known it (net.myUid() / PlayerRec.isHost).
 * ==========================================================================*/

/** One lobby seat, as the host published it. */
export interface LobbySeat {
  /** Stable net uid (PlayerRec.id). Null only where there is no net layer. */
  uid: string | null;
  name: string;
  isHost: boolean;
}

/**
 * Tags for one seat's player card.
 *
 * 'you' follows IDENTITY, never seat order. An unknown local uid (null, or a
 * uid absent from the roster) tags NOBODY as "you": showing no self-marker is
 * a cosmetic gap, while showing it on the wrong card is a lie about who the
 * player is.
 */
export function seatTags(seat: LobbySeat, youUid: string | null): string[] {
  const tags: string[] = [];
  if (youUid != null && seat.uid != null && seat.uid === youUid) tags.push('you');
  if (seat.isHost) tags.push('host');
  return tags;
}

/** How the START control renders for this screen. */
export interface StartControl {
  label: string;
  variant: 'primary' | 'ghost';
  /** False ⇒ inert: no pointer events, no hover sheen, dimmed. */
  enabled: boolean;
}

/**
 * Only the host can begin the run — buildMpScreen's onStart returns early for
 * joiners ("joiners wait for the host's begin frame"). A full-strength primary
 * button that silently does nothing reads as a broken game, so a joiner gets a
 * visibly disabled control that says what it is waiting for.
 */
export function startControl(canStart: boolean): StartControl {
  return canStart
    ? { label: 'START', variant: 'primary', enabled: true }
    : { label: 'WAITING FOR HOST', variant: 'ghost', enabled: false };
}

/** Everything buildLobby needs to know about WHO is looking at it. */
export interface LobbyIdentity {
  players: LobbySeat[];
  youUid: string | null;
  canStart: boolean;
}

/**
 * Project a live net roster onto the lobby screen's identity inputs.
 *
 * Kept here, beside the policy it feeds, so the wiring itself is gateable
 * under bare node — the seat/identity confusion lived in the wiring, not in
 * the tag maths. `roster` is structurally PlayerRec[]; the type is restated
 * rather than imported so this module pulls in nothing.
 */
export function lobbyView(
  roster: ReadonlyArray<{ id: string; name: string; isHost: boolean }>,
  myUid: string | null,
  isHost: boolean,
): LobbyIdentity {
  return {
    players: roster.map((p) => ({ uid: p.id, name: p.name, isHost: p.isHost === true })),
    youUid: myUid,
    canStart: isHost,
  };
}
