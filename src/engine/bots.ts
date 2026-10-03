import { legalActions } from './engine';
import { estimateEquity } from './evaluator';
import type { Action, GameState, LegalActions } from './types';

/**
 * A bot picks an action for `playerId`, who must be the player to act. It may
 * answer later (an LLM bot waits on the API). Call bots through `runBot`, which
 * hides every card the bot shouldn't see.
 */
export type Bot = (state: GameState, playerId: string) => Action | Promise<Action>;

/** What `playerId` is allowed to know: no deck, no other players' hole cards. */
export function viewFor(s: GameState, playerId: string): GameState {
  const view = structuredClone(s);
  view.deck = [];
  for (const p of view.players) if (p.id !== playerId) p.hole = [];
  return view;
}

export async function runBot(bot: Bot, s: GameState, playerId: string): Promise<Action> {
  return bot(viewFor(s, playerId), playerId);
}

const check = { type: 'check' } as const;
const call = { type: 'call' } as const;
const fold = { type: 'fold' } as const;
const checkOrCall = (legal: LegalActions): Action => (legal.canCheck ? check : call);
const raiseTo = (legal: LegalActions, to: number): Action => ({
  type: 'raise',
  to: Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(to))),
});

// ---------------------------------------------------------------------------
// Easy: random, weighted toward calling
// ---------------------------------------------------------------------------

export const easyBot: Bot = (s) => {
  const legal = legalActions(s);
  const r = Math.random();
  if (legal.canRaise && r < 0.1) return raiseTo(legal, legal.minRaiseTo);
  if (!legal.canCheck && r > 0.85) return fold;
  return checkOrCall(legal);
};

// ---------------------------------------------------------------------------
// Medium: plays its hand strength against the pot odds
// ---------------------------------------------------------------------------

interface Tweaks {
  callBonus: number; // added to equity when deciding whether a call is worth it
  bluff: boolean; // bet even without a hand
}

function playStrength(s: GameState, playerId: string, tweaks: Tweaks = { callBonus: 0, bluff: false }): Action {
  const legal = legalActions(s);
  const me = s.players.find((p) => p.id === playerId)!;
  const opponents = s.players.filter((p) => !p.folded && p.id !== playerId).length;
  const equity = estimateEquity(me.hole, s.community, opponents);
  // 1 = an average hand against this many opponents, 2 = twice the average share.
  const edge = equity * (opponents + 1) + (Math.random() - 0.5) * 0.3;
  const potOdds = legal.callAmount / (s.pot + legal.callAmount);

  if (legal.canRaise && (edge > 1.6 || tweaks.bluff)) {
    // Bet bigger the stronger the hand: half the pot up to the whole pot.
    return raiseTo(legal, s.currentBet + s.pot * Math.min(1, Math.max(0.5, equity)));
  }
  if (legal.canCheck) return check;
  return equity + tweaks.callBonus >= potOdds ? call : fold;
}

export const mediumBot: Bot = (s, playerId) => playStrength(s, playerId);

// ---------------------------------------------------------------------------
// Hard: medium, adjusted for how each opponent has been playing
// ---------------------------------------------------------------------------

interface Stats {
  actions: number;
  raises: number;
  folds: number;
}

/**
 * Each hard bot keeps its own notes, so create one per seat. It reads the
 * current hand's action log whenever it's asked to act, so it sees everything
 * up to its own decisions (actions after its last turn in a hand are missed).
 */
export function createHardBot(): Bot {
  const stats = new Map<string, Stats>();
  let hand = -1;
  let seen = 0;

  // Smoothed rates, so one early raise doesn't brand someone a maniac.
  const aggression = (id: string) => {
    const st = stats.get(id);
    return ((st?.raises ?? 0) + 1) / ((st?.actions ?? 0) + 5);
  };
  const foldRate = (id: string) => {
    const st = stats.get(id);
    return ((st?.folds ?? 0) + 1) / ((st?.actions ?? 0) + 4);
  };

  return (s, playerId) => {
    if (s.handNumber !== hand) {
      hand = s.handNumber;
      seen = 0;
    }
    for (const entry of s.log.slice(seen)) {
      if (entry.playerId === playerId) continue;
      const st = stats.get(entry.playerId) ?? { actions: 0, raises: 0, folds: 0 };
      st.actions++;
      if (entry.action.type === 'raise') st.raises++;
      if (entry.action.type === 'fold') st.folds++;
      stats.set(entry.playerId, st);
    }
    seen = s.log.length;

    const opponents = s.players.filter((p) => !p.folded && p.id !== playerId);
    const lastRaise = s.log.findLast((e) => e.street === s.street && e.action.type === 'raise');

    // Raises from a maniac mean less than raises from a rock.
    let callBonus = 0;
    if (lastRaise) {
      const a = aggression(lastRaise.playerId);
      if (a > 0.3) callBonus = 0.08;
      else if (a < 0.12) callBonus = -0.08;
    }
    // Against players who give up easily, take a stab when nobody has shown strength.
    const avgFold = opponents.reduce((sum, p) => sum + foldRate(p.id), 0) / Math.max(1, opponents.length);
    const bluff = !lastRaise && avgFold > 0.45 && Math.random() < 0.3;

    return playStrength(s, playerId, { callBonus, bluff });
  };
}
