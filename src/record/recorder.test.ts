/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seededRng } from '../engine/deck';
import { applyAction, createGame, currentPlayer, startHand } from '../engine/engine';
import type { Action, GameState } from '../engine/types';
import { HandRecorder, positions } from './recorder';

function game(n: number): GameState {
  return createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })));
}

/** A clock that moves forward one second every time it's read. */
function fakeClock(start = Date.UTC(2026, 9, 3, 12, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000));
}

/** Play the hand with the given actions, recording as the game loop would. */
function playRecorded(before: GameState, actions: Action[], recorder: HandRecorder) {
  let s = startHand(before, seededRng(5));
  recorder.handStarted(before, s, new Date(Date.UTC(2026, 9, 3, 12, 0, 0)));
  for (const a of actions) {
    s = applyAction(s, currentPlayer(s).id, a);
    recorder.actionApplied(s);
  }
  return { state: s, record: recorder.handFinished(s) };
}

const call: Action = { type: 'call' };
const check: Action = { type: 'check' };
const fold: Action = { type: 'fold' };
const raise = (to: number): Action => ({ type: 'raise', to });

test('positions run BTN, SB, BB, UTG, UTG+1, ...', () => {
  const names = (n: number) => [...positions(startHand(game(n), seededRng(1))).values()];
  assert.deepEqual(names(2), ['BTN', 'BB']);
  assert.deepEqual(names(3), ['BTN', 'SB', 'BB']);
  assert.deepEqual(names(4), ['BTN', 'SB', 'BB', 'UTG']);
  assert.deepEqual(names(6), ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2']);
});

test('busted players get no position and are not counted', () => {
  const g = game(4);
  g.players[2].chips = 0;
  const s = startHand(g, seededRng(1));
  const pos = positions(s);
  assert.equal(pos.has(2), false);
  assert.deepEqual([...pos.values()], ['BTN', 'SB', 'BB']);
});

test('a full hand record', () => {
  const recorder = new HandRecorder({ tableId: 7, now: fakeClock() });
  // Hand 1, 4 players: p0 is BTN, p1 SB, p2 BB, p3 UTG.
  const { state, record } = playRecorded(
    game(4),
    [
      call, //       p3 UTG calls 10
      raise(30), //  p0 BTN raises to 30
      fold, //       p1 SB folds
      call, //       p2 BB calls 20 more
      call, //       p3 calls 20 more: their second pre-flop decision
      check, check, check, // flop
      raise(60), //  p2 bets 60 on the turn
      fold, fold, // p3 and p0 fold
    ],
    recorder,
  );

  assert.equal(record.tableId, 7);
  assert.equal(record.stakes, '5/10');
  assert.equal(record.numPlayers, 4);
  assert.equal(record.board, state.community.join(', '));
  assert.equal(record.board!.split(', ').length, 4); // ended on the turn: 4 cards
  // The fake clock reads once at the deal, once per action, once at the end.
  assert.equal(record.dealtAt, '2026-10-03T12:00:01.000Z');
  assert.equal(record.durationMs, 13_000);

  assert.deepEqual(
    record.players.map((p) => [p.playerId, p.position, p.chipsStart, p.chipsEnd]),
    [
      ['p0', 'BTN', 1000, 970],
      ['p1', 'SB', 1000, 995],
      ['p2', 'BB', 1000, 1065],
      ['p3', 'UTG', 1000, 970],
    ],
  );
  assert.equal(record.players[0].holeCards, state.players[0].hole.join(', '));
  assert.match(record.players[0].holeCards, /^[2-9TJQKA][shdc], [2-9TJQKA][shdc]$/);

  assert.deepEqual(
    record.actions.map((a) => [a.playerId, a.street, a.turn, a.action, a.amount]),
    [
      ['p3', 'Pre-flop', 1, 'Call', 10],
      ['p0', 'Pre-flop', 1, 'Raise', 30],
      ['p1', 'Pre-flop', 1, 'Fold', 0],
      ['p2', 'Pre-flop', 1, 'Call', 20],
      ['p3', 'Pre-flop', 2, 'Call', 20],
      ['p2', 'Flop', 1, 'Check', 0],
      ['p3', 'Flop', 1, 'Check', 0],
      ['p0', 'Flop', 1, 'Check', 0],
      ['p2', 'Turn', 1, 'Bet', 60],
      ['p3', 'Turn', 1, 'Fold', 0],
      ['p0', 'Turn', 1, 'Fold', 0],
    ],
  );
  assert.ok(record.actions.every((a) => a.decisionMs === 1000));
});

test('board is null when everyone folds pre-flop', () => {
  const { record } = playRecorded(game(4), [fold, fold, fold], new HandRecorder({ now: fakeClock() }));
  assert.equal(record.board, null);
  assert.equal(record.actions.length, 3);
});
