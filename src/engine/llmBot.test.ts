/// <reference types="node" />
// LLM bot tests with a fake client: no API key or network needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { runBot } from './bots';
import { seededRng } from './deck';
import { applyAction, createGame, currentPlayer, legalActions, startHand } from './engine';
import { createLlmBot, describeTable, llmUsage, toAction } from './llmBot';
import type { GameState } from './types';

function newHand(): GameState {
  const s = createGame(['p0', 'p1', 'p2', 'p3'].map((id) => ({ id, name: id.toUpperCase(), isBot: true })));
  return startHand(s, seededRng(3));
}

/** A client whose parse() records each request and returns the given reply. */
function fakeClient(reply: unknown, prompts: string[] = []) {
  return {
    messages: {
      parse: async (params: { messages: { content: string }[] }) => {
        prompts.push(params.messages[0].content);
        if (reply instanceof Error) throw reply;
        return { stop_reason: 'end_turn', parsed_output: reply, usage: { input_tokens: 500, output_tokens: 40 } };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

test('the prompt shows only the bot’s own cards', () => {
  const s = applyAction(newHand(), 'p3', { type: 'raise', to: 30 });
  const id = currentPlayer(s).id;
  const prompt = describeTable(s, id, legalActions(s));
  for (const p of s.players) {
    for (const card of p.hole) assert.equal(prompt.includes(card), p.id === id, `${card} of ${p.id}`);
  }
  assert.match(prompt, /preflop: P3 raises to 30/);
  assert.match(prompt, /call 30/);
});

test('model moves are turned into legal actions', () => {
  const s = newHand(); // p3 to act, facing the big blind
  const legal = legalActions(s);
  assert.deepEqual(toAction({ action: 'call', raiseTo: null, says: '' }, legal), { type: 'call' });
  assert.deepEqual(toAction({ action: 'raise', raiseTo: 25, says: '' }, legal), { type: 'raise', to: 25 });
  // Out-of-range raises are clamped, and a missing amount means a min-raise.
  assert.deepEqual(toAction({ action: 'raise', raiseTo: 5, says: '' }, legal), { type: 'raise', to: 20 });
  assert.deepEqual(toAction({ action: 'raise', raiseTo: 99999, says: '' }, legal), { type: 'raise', to: 1000 });
  assert.deepEqual(toAction({ action: 'raise', raiseTo: null, says: '' }, legal), { type: 'raise', to: 20 });
  // Checking isn't possible when facing a bet.
  assert.equal(toAction({ action: 'check', raiseTo: null, says: '' }, legal), null);

  const free = legalActions(applyAction(applyAction(applyAction(s, 'p3', { type: 'call' }), 'p0', { type: 'call' }), 'p1', { type: 'call' }));
  // Big blind's option: folding or calling for free is a check.
  assert.deepEqual(toAction({ action: 'fold', raiseTo: null, says: '' }, free), { type: 'check' });
  assert.deepEqual(toAction({ action: 'call', raiseTo: null, says: '' }, free), { type: 'check' });
});

test('the bot plays the model’s move and passes on its table talk', async () => {
  const s = newHand();
  const said: string[] = [];
  const prompts: string[] = [];
  const bot = createLlmBot({
    style: 'test',
    client: fakeClient({ action: 'raise', raiseTo: 40, says: 'Let’s go.' }, prompts),
    onSay: (_, line) => said.push(line),
  });
  const before = llmUsage.calls;
  const action = await runBot(bot, s, 'p3');
  assert.deepEqual(action, { type: 'raise', to: 40 });
  assert.deepEqual(said, ['Let’s go.']);
  assert.equal(llmUsage.calls, before + 1);
  // runBot hid the other players' cards before the prompt was built.
  assert.ok(!prompts[0].includes(s.players[0].hole[0]));
});

test('API errors and unusable replies fall back to the medium bot', async () => {
  const s = newHand();
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const reply of [new Error('rate limited'), null, { action: 'check', raiseTo: null, says: '' }]) {
      const before = llmUsage.fallbacks;
      const action = await runBot(createLlmBot({ style: 'test', client: fakeClient(reply) }), s, 'p3');
      assert.doesNotThrow(() => applyAction(s, 'p3', action));
      assert.equal(llmUsage.fallbacks, before + 1);
    }
  } finally {
    console.warn = warn;
  }
});
