// pokersolver ships no types; this is the small part of its API we use.
declare module 'pokersolver' {
  export class Hand {
    name: string; // e.g. "Two Pair"
    descr: string; // e.g. "Two Pair, A's & K's"
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
  }
  const _default: { Hand: typeof Hand };
  export default _default;
}
