import { createDeck, shuffle } from './deck';
import { findWinners } from './evaluator';
import type { Action, GameState, LegalActions, Player } from './types';

// The engine is a pure state machine: every function takes a state and returns a NEW state.
// No UI, no network, no timers in this file. The 3D scene and the bots both sit on top of it.

// ---------------------------------------------------------------------------
// Setup (done)
// ---------------------------------------------------------------------------

export function createGame(
  seats: { id: string; name: string; isBot: boolean }[],
  opts: { startingChips?: number; smallBlind?: number; bigBlind?: number } = {},
): GameState {
  const { startingChips = 1000, smallBlind = 5, bigBlind = 10 } = opts;
  return {
    players: seats.map((s) => ({
      ...s,
      chips: startingChips,
      hole: [],
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      hasActed: false,
    })),
    deck: [],
    community: [],
    pot: 0,
    currentBet: 0,
    minRaise: bigBlind,
    street: 'preflop',
    dealer: seats.length - 1, // startHand moves it to seat 0 for hand 1
    toAct: 0,
    smallBlind,
    bigBlind,
    handOver: true,
    winners: [],
    handNumber: 0,
    log: [],
  };
}

/** Shuffle, deal two cards each, post blinds, set who acts first. */
export function startHand(prev: GameState, rng: () => number = Math.random): GameState {
  const s = structuredClone(prev);
  s.deck = shuffle(createDeck(), rng);
  s.community = [];
  s.pot = 0;
  s.street = 'preflop';
  s.handOver = false;
  s.winners = [];
  s.handNumber += 1;
  s.log = [];

  for (const p of s.players) {
    p.bet = 0;
    p.totalBet = 0;
    p.allIn = false;
    p.hasActed = false;
    p.folded = p.chips === 0; // busted players sit out
    p.hole = p.folded ? [] : [s.deck.pop()!, s.deck.pop()!];
  }

  s.dealer = nextSeat(s, s.dealer, (p) => !p.folded);
  const inHand = s.players.filter((p) => !p.folded).length;
  // Heads-up rule: the dealer posts the small blind.
  const sb = inHand === 2 ? s.dealer : nextSeat(s, s.dealer, (p) => !p.folded);
  const bb = nextSeat(s, sb, (p) => !p.folded);
  commit(s, s.players[sb], s.smallBlind);
  commit(s, s.players[bb], s.bigBlind);
  s.currentBet = s.bigBlind;
  s.minRaise = s.bigBlind;
  s.toAct = nextSeat(s, bb, canAct);

  // The blinds can put players all-in. If nobody is left with a decision to make, deal it out.
  const actors = s.players.filter(canAct);
  if (actors.length === 0 || (actors.length === 1 && actors[0].bet >= s.currentBet)) return advanceStreet(s);
  return s;
}

// ---------------------------------------------------------------------------
// Helpers (done)
// ---------------------------------------------------------------------------

/** Move chips from a player's stack into the pot. Caps at all-in. */
function commit(s: GameState, p: Player, amount: number): void {
  const paid = Math.min(amount, p.chips);
  p.chips -= paid;
  p.bet += paid;
  p.totalBet += paid;
  s.pot += paid;
  if (p.chips === 0) p.allIn = true;
}

const canAct = (p: Player) => !p.folded && !p.allIn;

/** Next seat clockwise from `from` that matches the filter. */
function nextSeat(s: GameState, from: number, ok: (p: Player) => boolean): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (ok(s.players[idx])) return idx;
  }
  return from;
}

export function currentPlayer(s: GameState): Player {
  return s.players[s.toAct];
}

/** What the player to act is allowed to do. The UI uses this to enable/label buttons. */
export function legalActions(s: GameState): LegalActions {
  const p = currentPlayer(s);
  const toCall = s.currentBet - p.bet;
  const maxRaiseTo = p.bet + p.chips;
  // A player who already acted only gets the action back after a raise. If it was a
  // short all-in raise, hasActed stays true and betting isn't reopened: call or fold only.
  // Raising is also pointless when nobody else is left to call it.
  const someoneCanRespond = s.players.some((x) => x !== p && canAct(x));
  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: Math.min(toCall, p.chips),
    canRaise: p.chips > toCall && !p.hasActed && someoneCanRespond,
    minRaiseTo: Math.min(s.currentBet + s.minRaise, maxRaiseTo),
    maxRaiseTo,
  };
}

// ---------------------------------------------------------------------------
// The core: applyAction
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, playerId: string, action: Action): GameState {
  if (prev.handOver) throw new Error('Hand is over; call startHand');
  if (currentPlayer(prev).id !== playerId) throw new Error(`Not ${playerId}'s turn`);

  const s = structuredClone(prev);
  const p = currentPlayer(s);
  const legal = legalActions(s);

  switch (action.type) {
    case 'fold': // worked example
      p.folded = true;
      break;

    case 'check':
      if (!legal.canCheck) throw new Error(`${p.name} cannot check`);
      break;

    case 'call':
      if (!legal.canCall) throw new Error(`${p.name} cannot call`);
      commit(s, p, legal.callAmount);
      break;

    case 'raise': {
      if (!legal.canRaise) throw new Error(`${p.name} cannot raise`);
      if (action.to < legal.minRaiseTo || action.to > legal.maxRaiseTo) {
        throw new Error(`Raise to ${action.to} outside [${legal.minRaiseTo}, ${legal.maxRaiseTo}]`);
      }
      // A full raise sets the new minimum and reopens the betting for everyone.
      // A short all-in raise does neither: the others just have to call the difference.
      const raiseBy = action.to - s.currentBet;
      if (raiseBy >= s.minRaise) {
        s.minRaise = raiseBy;
        for (const other of s.players) if (other !== p) other.hasActed = false;
      }
      commit(s, p, action.to - p.bet);
      s.currentBet = action.to;
      break;
    }
  }
  p.hasActed = true;
  s.log.push({ playerId: p.id, street: s.street, action });

  // After any action, exactly one of three things happens:
  const remaining = s.players.filter((x) => !x.folded);
  if (remaining.length === 1) return awardPot(s, [remaining[0].id]); // everyone else folded
  if (isBettingRoundOver(s)) return advanceStreet(s);
  s.toAct = nextSeat(s, s.toAct, canAct);
  return s;
}

/**
 * The round is over when every player who can still act (not folded, not all-in)
 * has acted and matched the current bet. This one rule also handles the big
 * blind's option preflop.
 */
export function isBettingRoundOver(s: GameState): boolean {
  return s.players.filter(canAct).every((p) => p.hasActed && p.bet === s.currentBet);
}

const nextStreet = { preflop: 'flop', flop: 'turn', turn: 'river' } as const;
const cardsToDeal = { flop: 3, turn: 1, river: 1 } as const;

/**
 * Move to the next street: reset bets, deal, and hand the action to the first
 * active player left of the dealer. After the river, go to showdown. If fewer
 * than two players can act (the rest are all-in), nobody can bet, so keep
 * dealing straight through to showdown.
 */
export function advanceStreet(s: GameState): GameState {
  if (s.street === 'river' || s.street === 'showdown') return showdown(s);

  for (const p of s.players) {
    p.bet = 0;
    p.hasActed = false;
  }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;

  s.street = nextStreet[s.street];
  for (let i = 0; i < cardsToDeal[s.street]; i++) s.community.push(s.deck.pop()!);

  if (s.players.filter(canAct).length < 2) return advanceStreet(s);
  s.toAct = nextSeat(s, s.dealer, canAct);
  return s;
}

export interface Pot {
  amount: number;
  eligible: string[]; // ids of players who can win it
}

/**
 * Split the chips into a main pot and side pots. Each all-in amount among the
 * players still in marks a level; a player can only win the chips at levels they
 * paid into. Folded players' chips count toward the pots but they can't win any.
 */
export function buildPots(s: GameState): Pot[] {
  const live = s.players.filter((p) => !p.folded);
  const levels = [...new Set(live.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = s.players.reduce((sum, p) => sum + Math.min(p.totalBet, level) - Math.min(p.totalBet, prev), 0);
    const eligible = live.filter((p) => p.totalBet >= level).map((p) => p.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Anything above the top level (a folded player who put in more) goes to the last pot.
  const leftover = s.pot - pots.reduce((sum, p) => sum + p.amount, 0);
  if (leftover > 0) pots[pots.length - 1].amount += leftover;
  return pots;
}

/** Rank the hands still in and award each pot to the best hand(s) eligible for it. */
export function showdown(s: GameState): GameState {
  const live = s.players.filter((p) => !p.folded);
  s.winners = [];
  for (const pot of buildPots(s)) {
    const ranked = findWinners(live.filter((p) => pot.eligible.includes(p.id)), s.community);
    split(s, pot.amount, ranked.map((r) => r.playerId));
    for (const w of s.winners) w.handName ??= ranked.find((r) => r.playerId === w.playerId)?.handName;
  }
  return finishHand(s);
}

/** Give the whole pot to winnerIds (used when everyone else folded). */
export function awardPot(s: GameState, winnerIds: string[]): GameState {
  s.winners = [];
  split(s, s.pot, winnerIds);
  return finishHand(s);
}

/**
 * Split `amount` evenly between winnerIds and record it in s.winners. Odd chips
 * go to the winners closest to the dealer's left.
 */
function split(s: GameState, amount: number, winnerIds: string[]): void {
  const n = s.players.length;
  const seats = Array.from({ length: n }, (_, i) => (s.dealer + 1 + i) % n).filter((i) =>
    winnerIds.includes(s.players[i].id),
  );
  const share = Math.floor(amount / seats.length);
  let oddChips = amount - share * seats.length;

  for (const i of seats) {
    const p = s.players[i];
    const won = share + (oddChips-- > 0 ? 1 : 0);
    p.chips += won;
    const existing = s.winners.find((w) => w.playerId === p.id);
    if (existing) existing.amount += won;
    else s.winners.push({ playerId: p.id, amount: won });
  }
}

function finishHand(s: GameState): GameState {
  s.pot = 0;
  s.street = 'showdown';
  s.handOver = true;
  return s;
}
