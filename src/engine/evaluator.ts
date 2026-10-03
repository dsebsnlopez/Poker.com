import pokersolver from 'pokersolver';
import { createDeck } from './deck';
import type { Card, Player } from './types';

const { Hand } = pokersolver;

export interface RankedHand {
  playerId: string;
  handName: string; // "Flush"
  description: string; // "Flush, Ah High"
}

/** Best 5-of-7 hand for one player. */
export function rankHand(player: Player, community: Card[]): RankedHand {
  const h = Hand.solve([...player.hole, ...community]);
  return { playerId: player.id, handName: h.name, description: h.descr };
}

/** Returns the winner(s) among the given players. More than one = split pot. */
export function findWinners(contenders: Player[], community: Card[]): RankedHand[] {
  const hands = contenders.map((p) => Hand.solve([...p.hole, ...community]));
  const best = Hand.winners(hands);
  return contenders
    .filter((_, i) => best.includes(hands[i]))
    .map((p) => rankHand(p, community));
}

/**
 * Chance (0-1) that `hole` wins at showdown against `opponents` random hands,
 * estimated by dealing out the rest of the board `trials` times. Ties count as
 * a share of a win.
 */
export function estimateEquity(
  hole: Card[],
  community: Card[],
  opponents: number,
  trials = 200,
  rng: () => number = Math.random,
): number {
  const known = new Set<Card>([...hole, ...community]);
  const rest = createDeck().filter((c) => !known.has(c));
  const need = 2 * opponents + (5 - community.length);
  let won = 0;
  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only shuffle the cards we're about to use.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const board = [...community, ...rest.slice(2 * opponents, need)];
    const mine = Hand.solve([...hole, ...board]);
    const hands = [mine];
    for (let o = 0; o < opponents; o++) hands.push(Hand.solve([rest[2 * o], rest[2 * o + 1], ...board]));
    const best = Hand.winners(hands);
    if (best.includes(mine)) won += 1 / best.length;
  }
  return won / trials;
}
