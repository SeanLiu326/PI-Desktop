import assert from "node:assert/strict";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/**
 * #1920: with an empty draft the steering shortcut (Alt+Enter) is the keyboard
 * path to a queue row's "send now" — it promotes the first promotable
 * follow-up instead of doing nothing. A visible draft still steers only the
 * draft, and a blocked send promotes nothing.
 */
test("an empty steering submit promotes the first queued follow-up", async (t) => {
  const ssr = await slotSsr(t);
  const { useComposerSubmit } = await ssr.load("/src/features/chat/composer/hooks/useComposerSubmit.ts");
  const calls = [];
  const draft = {
    ref: { current: null }, draftRevision: () => 1,
    draftSnapshot: (text) => ({ text, fileReferences: [] }),
    clearDraftForKey: () => calls.push("clear"),
    restoreDraftForKey: () => calls.push("restore"),
  };
  const build = (overrides = {}) =>
    useComposerSubmit({
      value: "", draftKey: "s1", activeSessionId: "s1",
      modelReady: true, sendBlocked: false, localCommandsAllowed: false,
      steeringAllowed: true,
      invalidateComposerTransforms() {}, pasting: false, activeFileReferences: [],
      t: (key) => key, showToast: () => {}, draft,
      sendPrompt: async () => { calls.push("prompt"); return true; },
      steerPrompt: async () => { calls.push("steer"); return true; },
      promoteQueuedPrompt: async () => { calls.push("promote"); return true; },
      ...overrides,
    });

  await build().submit(true);
  assert.ok(calls.includes("promote"), "empty steering submit must promote the queue head");
  assert.ok(!calls.includes("steer") && !calls.includes("prompt"));

  // Without the modifier it stays a no-op: plain Enter on an empty draft
  // never sends or promotes.
  calls.length = 0;
  await build().submit();
  assert.deepEqual(calls, []);

  // A blocked send (approval pending, paste in flight) promotes nothing.
  calls.length = 0;
  await build({ sendBlocked: true }).submit(true);
  assert.deepEqual(calls, []);

  // With a visible draft only the draft is steered; the queue is untouched.
  calls.length = 0;
  await build({ value: "look at this first" }).submit(true);
  assert.ok(calls.includes("steer"));
  assert.ok(!calls.includes("promote"));

  // A queue-less composition (tests, detached surfaces) simply stays a no-op.
  calls.length = 0;
  await build({ promoteQueuedPrompt: undefined }).submit(true);
  assert.deepEqual(calls, []);
});
