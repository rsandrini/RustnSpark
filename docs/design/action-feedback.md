# Feedback after an action

Every action that changes something (accept, dispatch, buy, sell, refuel, repair, upgrade, scavenge, mine, save the
layout, rename the ship) answers in three small ways at once, on desktop and phone:

1. **The button answers.** While the request runs it shows a spinner (`aria-busy` / `.answer-busy`); on the buttons that stay
   on screen (Save layout, Refuel) it turns green for about a second with the new word ("Saved", "Filled"). `useAnswer()`.
2. **The numbers move.** The wallet in the top bar pulses and the amount floats up from it (`−405 ¢`, `+253 ¢`), for any
   change of the pilot's credits, including a mission's pay. `useWalletAnswer()` in `AccountMenu`.
3. **One short message under the top bar,** with a next step where there is an obvious one (after refuelling: *Missions*;
   after buying a part: *Ship*). It goes away by itself after about three seconds. A dispatch (and the start of a
   scavenging or mining job) also sends a small ship across the line under the top bar. `FeedbackProvider` / `useFeedback()`.

Motion only plays for people who have not asked for less (`prefers-reduced-motion`): with it set, the message, the colour and
the numbers still change, nothing moves. On Android a very short vibration goes with the message (iPhones do not support it).

## Where it lives

- `apps/web/src/ui/feedback.tsx`: the provider and host (message, take-off), `useFeedback()`, `useNotice()`, `useAnswer()`.
- `apps/web/src/ui/use-wallet-answer.ts`, `apps/web/src/styles/feedback.css`.
- `useNotice()` replaces the inline "notice" state of a screen: with the host it becomes the message; a screen rendered alone
  (tests, previews) keeps the inline paragraph, so nothing is lost without the provider.
- To add one: call `useFeedback().notify(text, { next?, takeoff? })` in the mutation's `onSuccess`, or use `useNotice()`.
- The demo page that was used to choose this style is not in the repo.
