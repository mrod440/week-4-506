**User:**
In the trace.txt file logs from the harness, a race condition is shown here:

```text
=== HARNESS LOG ===
1. Simulating saving the initial draft: 'Draft 1'
   Initial draft saved.
2. Simulating user typing 'Draft 2' and clicking Save...
3. User immediately clicks Publish before Draft 2 save completes...
4. Let's see what was published:
   Final published state: "Draft 1"
>>> BUG DEMONSTRATED: 'Draft 1' was published instead of 'Draft 2'!

=== SERVER INSTRUMENTATION LOG ===
[2026-04-30T01:23:55.408Z] POST /draft START | incoming: "Draft 2" | current: "Draft 1"
[2026-04-30T01:23:55.460Z] POST /publish START | reading currentDraft: "Draft 1"
[2026-04-30T01:23:55.460Z] POST /publish END | publishedDraft set to: "Draft 1"
[2026-04-30T01:23:55.610Z] POST /draft END (COMMIT) | committed: "Draft 2" | new current: "Draft 2"
```

The trace shows publish runs before save commits the new draft. What exactly is going wrong here?

**AI:**
Looking at the timestamps in the trace, the problem is clear. At `01:23:55.408`, the `/draft` request for "Draft 2" arrives — but because of the simulated write delay (`SAVE_COMMIT_DELAY_MS = 200ms`), it doesn't actually commit to `currentDraft` until `01:23:55.610`.

In between, at `01:23:55.460`, the `/publish` request arrives. It reads `currentDraft` immediately and synchronously — and at that moment, `currentDraft` is still "Draft 1" because the save hasn't committed yet. So it publishes the stale value.

The root cause is that `/publish` has no awareness of whether a `/draft` save is in progress. It just grabs whatever `currentDraft` happens to be at that instant.

**User:**
We need to fix the issue to ensure publish always reads the most recent saved draft, even if the save is currently is ongoing. How would you fix this?

**AI:**
We can introduce a `pendingSavePromise` variable that tracks the most recent in-flight save. Each time `/draft` is called, we create a new Promise that only resolves once the `setTimeout` fires and the draft is committed. Then in `/publish`, we `await pendingSavePromise` before reading `currentDraft`.

Here is the fix:

```javascript
// Add a new variable to track in-flight saves
let currentDraft = '';
let publishedDraft = '';
let pendingSavePromise = Promise.resolve();

// POST /draft — save the current draft text.
app.post('/draft', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  // Create a promise that resolves when this save commits
  let resolveSave;
  const thisSavePromise = new Promise(resolve => { resolveSave = resolve; });
  pendingSavePromise = thisSavePromise;

  // Simulate write latency.
  setTimeout(() => {
    currentDraft = content;
    resolveSave();  // Signal that the save is complete
    res.json({ ok: true, saved: content });
  }, SAVE_COMMIT_DELAY_MS);
});

// POST /publish — now waits for any pending save before reading.
app.post('/publish', async (req, res) => {
  await pendingSavePromise;  // Wait for in-flight save to finish

  publishedDraft = currentDraft;
  res.json({ ok: true, published: publishedDraft });
});
```

If no save is in progress, `pendingSavePromise` is already resolved (initialized to `Promise.resolve()`), so `/publish` proceeds instantly with no delay.

**User:**
Can you explain the solution you provided?

**AI:**
Sure. The core idea is that we need `/publish` to know when a save is still in progress so it can wait for it. Here's how each piece works:

1. **`pendingSavePromise`** starts as `Promise.resolve()` — meaning "no save is pending, you're clear to proceed."
2. When a `/draft` request comes in, we create a brand new Promise and store it in `pendingSavePromise`. This new promise is *unresolved* — it acts like a gate that says "hold on, a save is happening."
3. Inside the `setTimeout`, once the draft is actually committed to `currentDraft`, we call `resolveSave()` which opens the gate.
4. When `/publish` runs, it hits `await pendingSavePromise`. If the gate is open (no in-flight save), it passes through instantly. If a save is in progress, it pauses right there until `resolveSave()` is called.

So the timing from the trace would now look like: `/draft` arrives → `/publish` arrives but *waits* → `setTimeout` fires and commits "Draft 2" → `/publish` resumes and reads "Draft 2" → correct value is published.

**User:**
What about the `/reset` endpoint? Does it need to change too?

**AI:**
Yes — if `/reset` doesn't also clear `pendingSavePromise`, there's a subtle issue: any in-flight save from before the reset would leave a dangling unresolved promise. A `/publish` call after the reset would hang forever waiting on it. The fix is to reset the promise back to a resolved state:

```javascript
app.post('/reset', (req, res) => {
  currentDraft = '';
  publishedDraft = '';
  pendingSavePromise = Promise.resolve();
  res.json({ ok: true });
});
```

**User:**
How can I verify the fix works?

**AI:**
You can verify it two ways:

1. **Run the existing test suite** with `npm test`. The repo includes a regression test that simulates the exact race condition — sending `/draft` and `/publish` concurrently and checking that the published value matches the in-flight draft. Before the fix this test fails; after the fix it should pass.

2. **Re-run your harness** with `node harness/index.js` while the fixed server is running. The trace should now show `/publish` waiting for the save to complete before reading `currentDraft`, and the final published state should be "Draft 2" instead of "Draft 1".

**User:**
I ran `npm test` and here are the results:

```text
✔ publish reflects the most recent save, even when save is in flight (618.282708ms)
✔ publish reflects the saved value when no save is in flight (304.444083ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Both tests pass. The instrumentation logs confirm that `/publish` now waits for the pending save:

```text
POST /draft START | incoming: "draft B" | current: "draft A"
POST /publish START | waiting for any pending saves...
POST /draft END (COMMIT) | committed: "draft B" | new current: "draft B"
POST /publish RESUMED | reading currentDraft: "draft B"
POST /publish END | publishedDraft set to: "draft B"
```

**AI:**
The test results confirm the fix is working correctly. The key line is `POST /publish START | waiting for any pending saves...` followed by `POST /publish RESUMED | reading currentDraft: "draft B"` — this shows that `/publish` paused while "draft B" was still being committed, then resumed and read the correct value after the save completed. Before the fix, `/publish` would have read "draft A" (the stale value) without waiting. Both tests passing means the fix handles both cases: the race condition scenario and the normal no-race scenario.
