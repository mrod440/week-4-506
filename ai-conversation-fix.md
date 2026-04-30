**User:**
In the trace.txt file logs from the harness a race condition is shown here:

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

The trace shows publish runs before save commits the new draft. A fix is needed to ensure publish always reads the most recent saved draft, even if the save is currently in flight. Can you fix `app/server.js`?

**AI:**
I can see the issue clearly in the trace! The `/publish` handler is reading `currentDraft` synchronously while the asynchronous `/draft` save (simulated by the `setTimeout`) is still executing. As a result, it publishes the old `currentDraft` ("Draft 1") before the new one ("Draft 2") finishes committing.

To fix this, we can introduce a `pendingSavePromise` to track the status of the most recent `/draft` request. When a `/draft` request arrives, we create a new Promise and set it as the `pendingSavePromise`. The Promise is resolved when the draft is fully committed. Then, we can simply `await pendingSavePromise` inside the `/publish` handler to ensure it waits for any in-flight saves to finish before reading `currentDraft`.

Here is the updated `server.js` logic:

```javascript
let currentDraft = '';
let publishedDraft = '';
let pendingSavePromise = Promise.resolve();

app.post('/draft', (req, res) => {
  const { content } = req.body;
  // ... validation ...
  
  let resolveSave;
  const thisSavePromise = new Promise(resolve => { resolveSave = resolve; });
  pendingSavePromise = thisSavePromise;

  // Simulate write latency.
  setTimeout(() => {
    currentDraft = content;
    resolveSave();
    res.json({ ok: true, saved: content });
  }, SAVE_COMMIT_DELAY_MS);
});

app.post('/publish', async (req, res) => {
  // Wait for any in-flight saves to complete
  await pendingSavePromise;
  
  publishedDraft = currentDraft;
  res.json({ ok: true, published: publishedDraft });
});
```

This ensures that `/publish` reflects the most recent draft, even when the save is in flight!
