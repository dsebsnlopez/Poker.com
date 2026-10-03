import type { GameState, Street } from '../engine/types';

// Turns a hand into one record. The engine has no clock, so the game loop tells
// the recorder when things happen:
//
//   const startedAt = new Date();
//   state = startHand(state);
//   recorder.handStarted(before, state, startedAt);
//   ... state = applyAction(...); recorder.actionApplied(state); ...
//   const record = recorder.handFinished(state);

export interface HandRecord {
  tableId: number;
  stakes: string; // "1/2"
  durationMs: number; // from the deal until the chips are awarded
  board: string | null; // "Jc, Kc, Ac, Qc", or null if no cards came out
  numPlayers: number; // players dealt in
  dealtAt: string; // ISO, right after the last player got their two cards
  players: PlayerRecord[];
  actions: ActionRecord[]; // in the order they happened
}

export interface PlayerRecord {
  playerId: string;
  position: string; // "BTN", "SB", "BB", "UTG", "UTG+1", ...
  holeCards: string; // "As, Qc"
  chipsStart: number; // at the beginning of the hand, before the blinds
  chipsEnd: number; // at the end, after the pot is paid out
}

export type StreetName = 'Pre-flop' | 'Flop' | 'Turn' | 'River';
export type ActionName = 'Fold' | 'Check' | 'Call' | 'Bet' | 'Raise';

export interface ActionRecord {
  playerId: string;
  street: StreetName;
  turn: number; // this player's 1st, 2nd, ... decision on this street
  action: ActionName;
  amount: number; // chips put in by this action
  decisionMs: number;
}

const STREET_NAMES: Record<Exclude<Street, 'showdown'>, StreetName> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

/**
 * Position names for the players dealt in, keyed by seat index: the dealer is
 * BTN, then SB, BB, UTG, UTG+1, ... Heads-up, the dealer posts the small blind,
 * so the two seats are BTN and BB.
 */
export function positions(s: GameState): Map<number, string> {
  const n = s.players.length;
  const order = Array.from({ length: n }, (_, i) => (s.dealer + i) % n).filter((i) => s.players[i].hole.length > 0);
  const names = order.length === 2 ? ['BTN', 'BB'] : ['BTN', 'SB', 'BB', ...order.slice(3).map((_, k) => (k === 0 ? 'UTG' : `UTG+${k}`))];
  return new Map(order.map((seat, k) => [seat, names[k]]));
}

interface InProgress {
  startedAt: Date;
  dealtAt: Date;
  lastEventAt: Date;
  chipsStart: Map<string, number>;
  positions: Map<number, string>;
  actions: ActionRecord[];
}

let lastTableId = 0;

export class HandRecorder {
  private hand?: InProgress;
  readonly tableId: number;
  private readonly now: () => Date;

  /** Tables are numbered 1, 2, 3, ... in the order they're created, unless you pass an id. */
  constructor(opts: { tableId?: number; now?: () => Date } = {}) {
    this.tableId = opts.tableId ?? ++lastTableId;
    this.now = opts.now ?? (() => new Date());
  }

  /** `before` is the state passed to startHand, `after` is what it returned. */
  handStarted(before: GameState, after: GameState, startedAt: Date): void {
    const dealtAt = this.now();
    const dealtIn = after.players.filter((p) => p.hole.length > 0);
    this.hand = {
      startedAt,
      dealtAt,
      lastEventAt: dealtAt,
      chipsStart: new Map(dealtIn.map((p) => [p.id, before.players.find((b) => b.id === p.id)!.chips])),
      positions: positions(after),
      actions: [],
    };
  }

  /** Call after every applyAction. Records the new log entry and how long the decision took. */
  actionApplied(after: GameState): void {
    const hand = this.requireHand();
    const at = this.now();
    for (const entry of after.log.slice(hand.actions.length)) {
      const street = STREET_NAMES[entry.street as keyof typeof STREET_NAMES];
      const earlier = hand.actions.filter((a) => a.street === street);
      const opened = street === 'Pre-flop' || earlier.some((a) => a.action === 'Bet' || a.action === 'Raise');
      hand.actions.push({
        playerId: entry.playerId,
        street,
        turn: earlier.filter((a) => a.playerId === entry.playerId).length + 1,
        action:
          entry.action.type === 'raise'
            ? opened
              ? 'Raise'
              : 'Bet'
            : (`${entry.action.type[0].toUpperCase()}${entry.action.type.slice(1)}` as ActionName),
        amount: entry.amount,
        decisionMs: at.getTime() - hand.lastEventAt.getTime(),
      });
    }
    hand.lastEventAt = at;
  }

  /** Call once state.handOver is true. */
  handFinished(s: GameState): HandRecord {
    const hand = this.requireHand();
    if (!s.handOver) throw new Error('handFinished called before the hand is over');
    const endedAt = this.now();
    this.hand = undefined;

    return {
      tableId: this.tableId,
      stakes: `${s.smallBlind}/${s.bigBlind}`,
      durationMs: endedAt.getTime() - hand.startedAt.getTime(),
      board: s.community.length ? s.community.join(', ') : null,
      numPlayers: hand.chipsStart.size,
      dealtAt: hand.dealtAt.toISOString(),
      players: s.players.flatMap((p, seat) =>
        hand.chipsStart.has(p.id)
          ? [
              {
                playerId: p.id,
                position: hand.positions.get(seat)!,
                holeCards: p.hole.join(', '),
                chipsStart: hand.chipsStart.get(p.id)!,
                chipsEnd: p.chips,
              },
            ]
          : [],
      ),
      actions: hand.actions,
    };
  }

  private requireHand(): InProgress {
    if (!this.hand) throw new Error('No hand in progress: call handStarted first');
    return this.hand;
  }
}
