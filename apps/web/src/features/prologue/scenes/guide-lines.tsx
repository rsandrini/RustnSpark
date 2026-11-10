import { useMemo, useState } from 'react';
import { DialogueBox } from '../../dialogue/dialogue-box';
import { giverOf, nodesOf, type GuideId } from '../prologue-script';

export interface GuideLinesProps {
  guide: GuideId;
  /** Translation keys of the lines, spoken one after the other. */
  lines: readonly string[];
  /** The last line was dismissed (or the conversation was skipped). */
  onDone: () => void;
}

/** A guide speaking their lines in the game's own dialogue box. It does not block the screen behind it. */
export function GuideLines({ guide, lines, onDone }: GuideLinesProps) {
  const [index, setIndex] = useState(0);
  const giver = useMemo(() => giverOf(guide), [guide]);
  const nodes = useMemo(() => nodesOf(lines), [lines]);
  const node = nodes[index];
  if (node === undefined) return null;
  return (
    <DialogueBox
      giver={giver}
      node={node}
      onContinue={() => (index + 1 < nodes.length ? setIndex(index + 1) : onDone())}
      onChoose={() => {}}
      onSkip={onDone}
    />
  );
}
