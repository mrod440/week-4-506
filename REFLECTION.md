# Reflection

**1. Why do we create a harness? Why is it worth the time, instead of just asking AI to fix the bug directly?**

We built the harness to generate evidence that a bug exists in the code. Triggering the bug manually in the web app is almost impossible because I need to click save and publish extremely quickly, so even after multiple attempts, I couldn’t click fast enough. 

The harness can send requests just 50ms apart, which is virtually impossible to do manually, and it also generates a trace that shows us exactly where the problem is. Without the evidence we generated with the harness, we could only tell the AI to look for a race-condition bug, which is a vague prompt that could lead us to unnecessary work that might not have fixed the issue. The time and effort spent creating the tools and logs paid off.      

**2. Why is isolation important? Why does the harness drive the failing code path under controlled conditions instead of running the full app and hoping the bug fires?**

The bug was never triggered in the browser, even after multiple attempts; my publish always registered after 200ms. With Isolation, we can manipulate the variables of reaction time and network latency and iterate an exact sequence of events on every run. The harness sends draft and publish with a 50ms window, guaranteeing the publish hits while the save is still processing.  
With the information from the harness’s log data, we can confirm the bug, and, more importantly, we have all the data we need to provide a fix. 

**3. How does modular design help in debugging? This bug had a clear seam between "save" and "publish." How would the debugging have been different if the same logic were buried in a 500-line monolithic handler with no clear boundaries?**

Since save and publish are handled by separate modules, I can independently generate logs from each, clearly visualizing the start and end to track their execution and data handling. Having save and publish in a single module would make it harder to track where one module ends and the next begins. This would result in overlapping log messages, making it difficult to distinguish when save completes and publish begins.

**4. What kinds of problems with a fix can a code review catch that an automated test cannot? Be specific — name a category of issue.**
The code review would be critical for catching problems that are outside the scope of automated testing. In our test program, testing verified that the save completed normally, but the review found that if a save caused an error, resolveSave would not be called, and the save action would remain unresolved, preventing further publish actions. 

**5. Quote from your review. Paste 1–3 lines from your actual review session — the most useful or interesting point your reviewer raised — and explain why testing alone wouldn't have surfaced it.**

> "If the DB write (simulated here) fails or throws an exception, `resolveSave()` is never called. `pendingSavePromise` will remain unresolved forever. Every subsequent `/publish` request will hang indefinitely waiting for this dangling promise, causing a complete system deadlock."
This was the most critical part of the review because the test environment could not catch this issue. Simulating a critical event, like a database crash, might only come up during a review (human or AI) while going through the code and thinking about use-case scenarios.  
