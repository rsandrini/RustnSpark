/**
 * The hand-over from the opening to the faction page: the opening ends on black, so the page fades in from black.
 * The director raises the curtain when the story is played out; the page takes it once, on its first render.
 */
let raised = false;

export function raiseCurtain(): void {
  raised = true;
}

/** True once after `raiseCurtain()`. */
export function takeCurtain(): boolean {
  const was = raised;
  raised = false;
  return was;
}
