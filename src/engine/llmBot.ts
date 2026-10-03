import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { type Bot, mediumBot } from './bots';
import { legalActions } from './engine';
import type { Action, GameState, LegalActions } from './types';

// Bots that ask Claude for each move. Node only: the client reads ANTHROPIC_API_KEY,
// which must never be shipped to a browser.

export const LLM_MODEL = 'claude-haiku-4-5';
const PRICE_PER_MTOK = { input: 1, output: 5 }; // claude-haiku-4-5, USD

const Move = z.object({
  action: z.enum(['fold', 'check', 'call', 'raise']),
  raiseTo: z.number().int().nullable(), // only for "raise": total bet for this street
  says: z.string(), // one line of table talk
});
type Move = z.infer<typeof Move>;

const SYSTEM = `You are a player in a 4-handed no-limit Texas hold'em game, played for chips until one player has them all.

Each turn you get the table state and your legal options. Reply with your move:
- action: "fold", "check", "call" or "raise". Only pick an option that is listed as legal.
- raiseTo: for a raise (or an opening bet), the TOTAL amount you want in front of you this street, within the listed range. Otherwise null.
- says: one short line of table talk (under 12 words). Stay in character, never reveal your cards.

Think about your hand strength, the board, pot odds, position, stack sizes and what the other players' actions suggest they hold.`;

/** Running totals across every LLM bot, for the cost summary. */
export const llmUsage = { calls: 0, inputTokens: 0, outputTokens: 0, fallbacks: 0 };

export function llmCost(): number {
  return (llmUsage.inputTokens * PRICE_PER_MTOK.input + llmUsage.outputTokens * PRICE_PER_MTOK.output) / 1e6;
}

interface Options {
  style: string; // personality, e.g. "loose and talkative, calls too much"
  onSay?: (playerId: string, line: string) => void;
  client?: Pick<Anthropic, 'messages'>; // injectable for tests
}

export function createLlmBot({ style, onSay, client }: Options): Bot {
  return async (view, playerId) => {
    const legal = legalActions(view);
    try {
      client ??= new Anthropic({ timeout: 20_000 });
      const res = await client.messages.parse({
        model: LLM_MODEL,
        max_tokens: 300,
        system: `${SYSTEM}\n\nYour playing style: ${style}`,
        messages: [{ role: 'user', content: describeTable(view, playerId, legal) }],
        output_config: { format: zodOutputFormat(Move) },
      });
      llmUsage.calls++;
      llmUsage.inputTokens += res.usage.input_tokens;
      llmUsage.outputTokens += res.usage.output_tokens;

      const action = res.stop_reason === 'refusal' || !res.parsed_output ? null : toAction(res.parsed_output, legal);
      if (!action) throw new Error(`unusable reply: ${JSON.stringify(res.parsed_output)}`);
      if (res.parsed_output!.says) onSay?.(playerId, res.parsed_output!.says);
      return action;
    } catch (e) {
      // Never stall the game: play the hand-strength bot's move for this turn instead.
      llmUsage.fallbacks++;
      console.warn(`[llm] ${playerId}: ${e instanceof Error ? e.message : e}. Using the medium bot's move.`);
      return mediumBot(view, playerId);
    }
  };
}

/**
 * Turn the model's move into a legal action. Harmless slips are corrected
 * (folding when checking is free, calling when there's nothing to call, a raise
 * outside the range); a move that can't be made at all returns null.
 */
export function toAction(move: Move, legal: LegalActions): Action | null {
  switch (move.action) {
    case 'fold':
      return legal.canCheck ? { type: 'check' } : { type: 'fold' };
    case 'check':
      return legal.canCheck ? { type: 'check' } : null;
    case 'call':
      return legal.canCheck ? { type: 'check' } : { type: 'call' };
    case 'raise': {
      if (!legal.canRaise) return null;
      const to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, move.raiseTo ?? legal.minRaiseTo));
      return { type: 'raise', to };
    }
  }
}

/** Everything the player is allowed to know, as plain text. `view` already has other hands hidden. */
export function describeTable(view: GameState, playerId: string, legal: LegalActions): string {
  const me = view.players.find((p) => p.id === playerId)!;
  const name = (id: string) => view.players.find((p) => p.id === id)!.name;

  const seats = view.players.map((p, i) => {
    const tags = [p.id === playerId && 'YOU', i === view.dealer && 'dealer'].filter(Boolean).join(', ');
    const status = p.chips === 0 && p.hole.length === 0 ? 'busted' : p.folded ? 'folded' : p.allIn ? 'all-in' : 'in';
    return `- ${p.name}${tags ? ` (${tags})` : ''}: ${p.chips} chips behind, ${p.bet} bet this street, ${status}`;
  });

  const history: string[] = [];
  for (const e of view.log) {
    const a = e.action;
    const text = a.type === 'raise' ? `raises to ${a.to}` : `${a.type}s`;
    const line = history.at(-1);
    if (line?.startsWith(`${e.street}:`)) history[history.length - 1] = `${line}, ${name(e.playerId)} ${text}`;
    else history.push(`${e.street}: ${name(e.playerId)} ${text}`);
  }

  const options = [
    legal.canCheck ? 'check' : `fold, call ${legal.callAmount}`,
    legal.canRaise &&
      `${view.currentBet === 0 ? 'bet' : 'raise'} (raiseTo between ${legal.minRaiseTo} and ${legal.maxRaiseTo}; ${legal.maxRaiseTo} is all-in)`,
  ].filter(Boolean);

  return [
    `Hand #${view.handNumber}, ${view.street}. Blinds ${view.smallBlind}/${view.bigBlind}.`,
    `You are ${me.name}. Your cards: ${me.hole.join(' ')}`,
    `Board: ${view.community.join(' ') || '(none yet)'}`,
    `Pot: ${view.pot} (includes this street's bets). Current bet to match: ${view.currentBet}.`,
    `Players, in seat order (play goes down the list and wraps around):`,
    ...seats,
    `Action this hand:`,
    ...(history.length ? history : ['(none)']),
    `Your legal options: ${options.join('; ')}.`,
  ].join('\n');
}
