/**
 * ST-175. Every derived figure says which kind of number it is. **Estimate**
 * is modelled from engine scores; **observed** is counted from games. The type
 * is a word rather than a colour or a glyph, so it survives a reader who cannot
 * see colour and a page rendered without styles, and it sits where the reader
 * meets the number rather than in a footnote.
 *
 * The leak is the product's only estimate. Its input is the report's
 * `gamesCovered`, which is the same baseline game count the model was run over,
 * so the note can name the model's own input in the reader's words.
 */
import { Text } from '@astryxdesign/core/Text';

export type FigureType = 'estimate' | 'observed';

const TYPE_WORD: Record<FigureType, string> = {
  estimate: 'Estimate',
  observed: 'Observed',
};

/** One line carrying a figure group's type and what it is derived from. */
export function FigureTypeNote({ type, detail }: { type: FigureType; detail: string }) {
  return (
    <Text as="p" display="block" type="supporting" className="font-ui text-xs">
      {TYPE_WORD[type]} · {detail}
    </Text>
  );
}

/**
 * The type word on the line that carries the figure, for a number that needs
 * its own mark rather than a group note. `aria-hidden` is not used: a reader
 * on a screen reader meets the same word in the same reading order.
 */
export function FigureTypeTag({ type }: { type: FigureType }) {
  return <span className="font-ui text-xs text-muted">{TYPE_WORD[type]}</span>;
}

/** The leak's model input, in words a player reads: the games it was run over. */
export function leakSourcePhrase(games: number): string {
  return `modelled from the ${games} rated ${games === 1 ? 'game' : 'games'} in this window, not counted from results`;
}
