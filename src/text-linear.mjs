// text-linear.mjs — LINEAR READS OF TRAILING BLANKS (POS-923 item 4; the sibling quadratics office #943 named and left).
//
// A regex that puts a blank quantifier beside another thing that can eat the same blanks backtracks quadratically on a run of blanks the rest of the pattern cannot finish: the
// engine tries every split. `.replace(/\s*$/, "\n")` is one: unanchored, it starts a `\s*` at every blank of a long internal run and walks to the end of the run before `$` refuses.
// These are the same answers, read once from the right.

const WS = /\s/;   // the engine's own `\s`, one character at a time: the same set, nothing re-spelled

/**
 * `text.replace(/\s*$/, "\n")`, byte for byte, in linear time: the trailing whitespace of `text` (the maximal run at its end, possibly none) becomes ONE newline. The regex's
 * leftmost match is exactly that run's start (an earlier start reaches a non-blank and `$` refuses), so the answer is the text up to it, then "\n".
 */
export function endWithNewline(text) {
  const s = String(text);
  let end = s.length;
  while (end > 0 && WS.test(s[end - 1])) end -= 1;
  return `${s.slice(0, end)}\n`;
}
