/// <reference types="node" />
// `npm test`. Uses Node's built-in test runner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHardBot, easyBot, mediumBot, runBot, viewFor } from './bots';
import { createDeck, seededRng } from './deck';
import { applyAction, buildPots, createGame, currentPlayer, legalActions, startHand } from './engine';
import type { Action, Card, GameState } from './types';

const fold: Action = { type: 'fold' };
const check: Action = { type: 'check' };
const call: Action = { type: 'call' };
const raise = (to: number): Action => ({ type: 'raise', to });

/** Players p0, p1, ... with the given stacks. Hand 1: p0 deals, then SB, BB. */
function game(stacks: number[]): GameState {
  const s = createGame(stacks.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })));
  s.players.forEach((p, i) => (p.chips = stacks[i]));
  return s;
}

/** Apply actions in turn order, whoever is to act. */
function act(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) s = applyAction(s, currentPlayer(s).id, a);
  return s;
}

/** Replace the dealt cards so the hand has known hole cards and board. */
function rig(s: GameState, holes: Card[][], board: Card[]): GameState {
  s = structuredClone(s);
  s.players.forEach((p, i) => (p.hole = holes[i]));
  const used = new Set([...holes.flat(), ...board]);
  // The engine deals with deck.pop(), so the board goes on the end in reverse.
  s.deck = [...createDeck().filter((c) => !used.has(c)), ...[...board].reverse()];
  return s;
}

const chips = (s: GameState) => s.players.map((p) => p.chips);
const total = (s: GameState) => s.players.reduce((sum, p) => sum + p.chips, 0) + s.pot;

test('the same seed deals the same cards', () => {
  const a = startHand(game([1000, 1000, 1000]), seededRng(42));
  const b = startHand(game([1000, 1000, 1000]), seededRng(42));
  const c = startHand(game([1000, 1000, 1000]), seededRng(7));
  assert.deepEqual(a.players.map((p) => p.hole), b.players.map((p) => p.hole));
  assert.notDeepEqual(a.players.map((p) => p.hole), c.players.map((p) => p.hole));
});

test('fold-around: the big blind wins the blinds', () => {
  let s = startHand(game([1000, 1000, 1000, 1000]), seededRng(1));
  s = act(s, fold, fold, fold);
  assert.equal(s.handOver, true);
  assert.deepEqual(s.winners, [{ playerId: 'p2', amount: 15 }]);
  assert.deepEqual(chips(s), [1000, 995, 1005, 1000]);
});

test('big blind gets the option when everyone limps, and a raise reopens the action', () => {
  let s = startHand(game([1000, 1000, 1000, 1000]), seededRng(1));
  s = act(s, call, call, call); // UTG, button, small blind
  assert.equal(s.street, 'preflop');
  assert.equal(currentPlayer(s).id, 'p2');
  assert.equal(legalActions(s).canCheck, true);
  assert.equal(legalActions(s).canRaise, true);

  s = act(s, raise(30));
  assert.equal(s.street, 'preflop');
  assert.equal(currentPlayer(s).id, 'p3');
  s = act(s, call, call, call);
  assert.equal(s.street, 'flop');
  assert.equal(s.community.length, 3);
  assert.equal(currentPlayer(s).id, 'p1'); // first player left of the dealer
  assert.equal(s.pot, 120);
});

test('split pot: the odd chip goes to the first winner left of the dealer', () => {
  let s = startHand(game([1000, 1000, 1000]), seededRng(1));
  // Royal flush on the board: everyone still in ties.
  s = rig(s, [['2c', '3d'], ['4h', '5c'], ['6d', '7h']], ['As', 'Ks', 'Qs', 'Js', 'Ts']);
  s = act(s, call, fold, check); // button calls, small blind folds: pot is 25
  s = act(s, check, check, check, check, check, check);
  assert.equal(s.handOver, true);
  // Seat order from the dealer's left: p1 (folded), p2, p0. p2 gets the odd chip.
  assert.deepEqual(chips(s), [1002, 995, 1003]);
  assert.equal(s.winners.find((w) => w.playerId === 'p2')!.handName, 'Straight Flush'); // pokersolver's name for a royal
});

test('side pots: each player only wins what they covered', () => {
  let s = startHand(game([100, 300, 1000]), seededRng(1));
  s = rig(s, [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], ['2c', '7d', '9h', 'Js', '3c']);
  s = act(s, raise(100)); // p0 all-in
  s = act(s, raise(300)); // p1 all-in over the top
  s = act(s, call); // p2 calls; nobody can bet any more, so the board runs out
  assert.equal(s.handOver, true);
  assert.equal(s.community.length, 5);
  // Main pot 300 to AA, side pot 400 to KK, QQ loses 300.
  assert.deepEqual(chips(s), [300, 400, 700]);
  assert.equal(total(s), 1400);
});

test('buildPots splits the chips by all-in level', () => {
  let s = startHand(game([100, 300, 1000]), seededRng(1));
  s = act(s, raise(100), raise(300));
  // p2 hasn't acted yet: they've put in 10 and are still live.
  const pots = buildPots(s);
  assert.deepEqual(pots, [
    { amount: 30, eligible: ['p0', 'p1', 'p2'] },
    { amount: 180, eligible: ['p0', 'p1'] },
    { amount: 200, eligible: ['p1'] },
  ]);
  assert.equal(pots.reduce((sum, p) => sum + p.amount, 0), s.pot);
});

test("a short all-in raise doesn't reopen the betting", () => {
  let s = startHand(game([150, 1000, 1000, 1000]), seededRng(1));
  s = act(s, raise(100)); // p3 (UTG) full raise: min raise is now 90
  s = act(s, raise(150)); // p0 all-in for 150: only 50 more, a short raise
  assert.equal(s.minRaise, 90);

  // p1 hasn't acted yet, so they may still raise.
  assert.equal(currentPlayer(s).id, 'p1');
  assert.equal(legalActions(s).canRaise, true);
  s = act(s, fold, fold);

  // p3 already acted: they can call the extra 50 or fold, but not re-raise.
  assert.equal(currentPlayer(s).id, 'p3');
  const legal = legalActions(s);
  assert.equal(legal.canRaise, false);
  assert.equal(legal.callAmount, 50);
  assert.throws(() => act(s, raise(300)));
  s = act(s, call);
  assert.equal(s.handOver, true);
  assert.equal(total(s), 3150);
});

test('a short all-in call', () => {
  let s = startHand(game([1000, 1000, 40]), seededRng(1));
  s = act(s, raise(200), fold); // button raises, small blind folds
  assert.equal(legalActions(s).callAmount, 30); // the big blind only has 30 left
  s = act(s, call);
  assert.equal(s.handOver, true);
  assert.equal(total(s), 2040);
  // The big blind can win at most 40 from each player who paid in: 40 + 40 + 5.
  const bb = s.players[2];
  assert.ok(bb.chips === 0 || bb.chips === 85, `big blind has ${bb.chips}`);
});

test('a blind that puts a player all-in deals the hand straight out', () => {
  // Heads-up: the dealer (p0) posts the small blind with only 3 chips.
  const s = startHand(game([3, 1000]), seededRng(1));
  assert.equal(s.handOver, true);
  assert.equal(s.community.length, 5);
  assert.equal(total(s), 1003);
  // The big blind's 7 uncalled chips always come back to them.
  assert.ok(s.players[1].chips >= 997);
});

test("a bot's view hides the deck and everyone else's cards", () => {
  const s = startHand(game([1000, 1000, 1000]), seededRng(1));
  const view = viewFor(s, 'p1');
  assert.deepEqual(view.deck, []);
  assert.deepEqual(view.players[0].hole, []);
  assert.deepEqual(view.players[1].hole, s.players[1].hole);
  assert.deepEqual(view.players[2].hole, []);
});

test('bots only make legal moves and no chips go missing', async () => {
  const bots = { p0: easyBot, p1: mediumBot, p2: createHardBot(), p3: easyBot };
  let s = game([1000, 1000, 1000, 1000]);
  for (let hand = 0; hand < 40 && s.players.filter((p) => p.chips > 0).length > 1; hand++) {
    s = startHand(s, seededRng(hand));
    while (!s.handOver) {
      const id = currentPlayer(s).id as keyof typeof bots;
      s = applyAction(s, id, await runBot(bots[id], s, id));
    }
    assert.equal(total(s), 4000);
  }
});
