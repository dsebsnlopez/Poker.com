/// <reference types="node" />
// Console harness: `npm run play` to play against the bots.
//   --auto       a bot takes your seat; watch a whole game
//   --llm        every bot asks Claude for its moves (needs ANTHROPIC_API_KEY)
//   --hands N    stop after N hands
//   --record     print each finished hand's record (see src/record/recorder.ts) as JSON
// Your player_id is POKER_PLAYER_ID if set, otherwise "you".
import { createInterface } from 'node:readline/promises';
import { HandRecorder } from '../record/recorder';
import { type Bot, createHardBot, easyBot, mediumBot, runBot } from './bots';
import { applyAction, createGame, currentPlayer, legalActions, startHand } from './engine';
import { createLlmBot, LLM_MODEL, llmCost, llmUsage } from './llmBot';
import type { Action, GameState, Player } from './types';

const args = process.argv.slice(2);
const auto = args.includes('--auto');
const llm = args.includes('--llm');
const maxHands = args.includes('--hands') ? Number(args[args.indexOf('--hands') + 1]) : Infinity;
const HUMAN = process.env.POKER_PLAYER_ID || 'you';
const printRecords = args.includes('--record');
const recorder = new HandRecorder();

if (llm && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('--llm needs an Anthropic API key: export ANTHROPIC_API_KEY=sk-ant-... and run again.');
  process.exit(1);
}

function print(s: GameState): void {
  console.log(`\n--- hand ${s.handNumber} | ${s.street} | pot ${s.pot} | board ${s.community.join(' ') || '-'}`);
  s.players.forEach((p, i) => {
    const tags = [i === s.dealer && 'D', p.folded && 'folded', p.allIn && 'all-in', !s.handOver && i === s.toAct && '<- to act']
      .filter(Boolean)
      .join(' ');
    // Bots' cards stay hidden from the human until the hand is over.
    const hole = auto || !p.isBot || s.handOver ? p.hole.join(' ') : p.hole.map(() => '??').join(' ');
    console.log(`${p.name.padEnd(7)} ${String(p.chips).padStart(5)}  bet ${String(p.bet).padStart(3)}  ${hole}  ${tags}`);
  });
}

const names: Record<string, string> = { [HUMAN]: 'You', potato: 'Potato', peanut: 'Peanut', onion: 'Onion' };
const say = (id: string, line: string) => !auto && console.log(`  ${names[id]}: "${line}"`);

const bots: Record<string, Bot> = llm
  ? {
      [HUMAN]: createLlmBot({ style: 'solid and balanced, plays good hands hard', onSay: say }), // only used with --auto
      potato: createLlmBot({ style: 'loose and chatty; loves to see flops and hates folding', onSay: say }),
      peanut: createLlmBot({ style: 'balanced and thoughtful; mixes in the occasional bluff', onSay: say }),
      onion: createLlmBot({ style: 'tight and aggressive; folds a lot, but bets big when it plays', onSay: say }),
    }
  : {
      [HUMAN]: mediumBot, // only used with --auto
      potato: easyBot,
      peanut: mediumBot,
      onion: createHardBot(),
    };

function printUsage(): void {
  if (!llm) return;
  console.log(
    `\n${LLM_MODEL}: ${llmUsage.calls} calls, ${llmUsage.inputTokens} input + ${llmUsage.outputTokens} output tokens, ` +
      `about $${llmCost().toFixed(3)}; ${llmUsage.fallbacks} moves fell back to the medium bot.`,
  );
}

const rl = auto ? null : createInterface({ input: process.stdin, output: process.stdout });
const quit = () => {
  printUsage();
  process.exit(0);
};
process.on('SIGINT', quit);
rl?.on('SIGINT', quit);

/** Read an action from the terminal. Returns null on a typo so the caller asks again. */
async function ask(s: GameState): Promise<Action | null> {
  const legal = legalActions(s);
  const options = [
    'f = fold',
    legal.canCheck ? 'c = check' : `c = call ${legal.callAmount}`,
    legal.canRaise && `r <amount> = raise to ${legal.minRaiseTo}-${legal.maxRaiseTo}`,
    legal.canRaise && `a = all-in ${legal.maxRaiseTo}`,
  ].filter(Boolean);
  const [cmd, arg] = (await rl!.question(`Your move (${options.join(', ')}): `)).trim().toLowerCase().split(/\s+/);

  if (cmd === 'f') return { type: 'fold' };
  if (cmd === 'c') return legal.canCheck ? { type: 'check' } : { type: 'call' };
  if (cmd === 'a') return { type: 'raise', to: legal.maxRaiseTo };
  if (cmd === 'r' && Number.isInteger(Number(arg))) return { type: 'raise', to: Number(arg) };
  return null;
}

async function playHand(state: GameState): Promise<GameState> {
  const before = state;
  const startedAt = new Date();
  state = startHand(state);
  recorder.handStarted(before, state, startedAt);
  if (!auto) print(state);
  while (!state.handOver) {
    const p = currentPlayer(state);
    const action = p.isBot || auto ? await runBot(bots[p.id], state, p.id) : await ask(state);
    if (!action) continue;
    try {
      state = applyAction(state, p.id, action);
      recorder.actionApplied(state);
    } catch (e) {
      if (p.isBot || auto) throw e;
      console.log((e as Error).message); // illegal human move: ask again
      continue;
    }
    if (!auto) {
      console.log(`> ${p.name}: ${action.type}${action.type === 'raise' ? ` to ${action.to}` : ''}`);
      print(state);
    }
  }
  const record = recorder.handFinished(state);
  if (printRecords) console.log(JSON.stringify(record, null, 2));
  return state;
}

function describeWinners(s: GameState): string {
  const name = (id: string) => s.players.find((p) => p.id === id)!.name;
  return s.winners.map((w) => `${name(w.playerId)} wins ${w.amount}${w.handName ? ` with ${w.handName}` : ''}`).join(', ');
}

const playersLeft = (s: GameState): Player[] => s.players.filter((p) => p.chips > 0);

let state = createGame([
  { id: HUMAN, name: 'You', isBot: false },
  { id: 'potato', name: 'Potato', isBot: true },
  { id: 'peanut', name: 'Peanut', isBot: true },
  { id: 'onion', name: 'Onion', isBot: true },
]);
const human = state.players.find((p) => !p.isBot)!.id;
const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);

if (llm) console.log(`Bots are played by ${LLM_MODEL}. Ctrl+C to stop.`);

while (playersLeft(state).length > 1 && state.handNumber < maxHands) {
  state = await playHand(state);
  const dealer = state.players[state.dealer].name;
  console.log(`\nHand ${state.handNumber} (dealer ${dealer}): ${describeWinners(state)}`);

  const chips = state.players.reduce((sum, p) => sum + p.chips, 0);
  if (chips !== totalChips) throw new Error(`Chips leaked: ${chips} != ${totalChips}`);

  if (!auto && state.players.find((p) => p.id === human)!.chips === 0) {
    console.log('You are out of chips. Game over.');
    break;
  }
}

if (playersLeft(state).length === 1) {
  console.log(`\n${playersLeft(state)[0].name} wins the game after ${state.handNumber} hands.`);
}
printUsage();
rl?.close();
