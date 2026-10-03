# Poker engine: build steps

**Status: steps 1-10 and the React frontend are done.**

- `npm run dev`: play in the browser
- `npm run play`: play against the bots in the terminal (`npm run play -- --auto` lets a bot take your seat)
- `npm run play -- --llm`: every bot asks Claude Haiku 4.5 for its moves (needs `ANTHROPIC_API_KEY`; add `--hands N` to cap the game)
- `npm test`: engine tests (Node's built-in runner)
- `npm run typecheck`: checks types

## Already done
- `types.ts`: cards, players, actions, game state
- `deck.ts`: 52 cards + shuffle
- `evaluator.ts`: hand ranking and winners (wraps `pokersolver`)
- `engine.ts`: `createGame`, `startHand` (deal, blinds, first to act), `legalActions`, the `fold` action, and the control flow at the end of `applyAction`

## To build (all in `engine.ts`, each marked `TODO`)

1. **Run it.** You should see four players dealt in, blinds posted, and "Next thing to build: applyAction: call".
2. **check / call / raise** in `applyAction`. Validate against `legalActions`, move chips with `commit`. A raise resets `hasActed` for everyone else.
3. **`isBettingRoundOver`**. Everyone who can act has acted and matched the current bet.
4. **`advanceStreet`**. Reset bets, deal flop/turn/river, set first to act. If fewer than two players can still act, deal through to showdown.
5. **`showdown` + `awardPot`**. Use `findWinners`, split the pot, set `handOver`. After this, `npm run play` finishes a whole hand and prints the winner.
6. **Multiple hands.** Loop `startHand` in `play.ts` until one player has all the chips. Check that the dealer button rotates and busted players are skipped.
7. **Human input.** In `play.ts`, when `currentPlayer` is not a bot, read the action from the terminal (`node:readline/promises`). Now you can actually play it.
8. **Edge cases.** Short all-in calls, all-in raises smaller than the min raise, and side pots (build pots from each player's `totalBet`). Side pots are the hardest part; with only one human it is fine to demo without them at first.
9. **Bot hook.** Define `type Bot = (state: GameState, playerId: string) => Action` in a new `bots.ts`. Easy = random weighted to call. Medium = hand strength. Hard = medium + the player's stats. Bots must only read their own hole cards.
10. **Tests.** Seed the shuffle (`startHand(state, seededRng)`) and assert on known hands: fold-around, split pot, all-in, big blind option.

## Hooking up the frontend later
The UI keeps one `GameState` in React state. Buttons call `applyAction` and set the result;
`legalActions` decides which buttons show and whether the middle one says "Check" or "Call $X".
When `currentPlayer(state).isBot`, call the bot after a short delay and apply its action the same way.
Hide other players' `hole` cards in the renderer until `street === 'showdown'`.
