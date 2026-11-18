# Issue reporting to GitHub (option A)

Users and testers report problems as **GitHub issues** on [samberchmans-games/apply-job-plugin](https://github.com/samberchmans-games/apply-job-plugin/issues). The extension pre-fills the issue; the user reviews it and clicks **Submit** in their own GitHub account. A GitHub Action replies with an acknowledgement and labels the issue, so the team can find, fix and close it.

**Why this design:**
- No server and no secret in the extension. A GitHub token built into an extension can be extracted by anyone.
- The user always sees exactly what is posted before it is sent.
- It keeps the promise that everything stays local.

The trade-off: reporters need a GitHub account. Users without one send the report file to the organizer by email (see §8).

| Status | Part |
|---|---|
| ✅ Live now | Issue form (`.github/ISSUE_TEMPLATE/bug_report.yml`), automatic acknowledgement + labels (`.github/workflows/issue-ack.yml`), maintainer workflow (this doc) |
| ✅ Step 7 (built) | Extension side: **Report on GitHub** button, crash prompt, duplicate check, "My reports" status (§3–§6), plus a **🧪 Simulate a problem** button for testers. Code: `src/lib/issue-report.js`, `background.js`, `admin.js`, `panel.js`; tests: `tests/unit/issue-report.test.js`, `issue-flow.test.js` |

---

## 1. End-to-end flow

```
User hits a problem ──► Admin → Logs & support → 🆘 Report an issue   (or: crash prompt, popup → Report a problem)
                         │  describes it; extension builds the report (R-YYYYMMDD-XXXXX), already scrubbed
                         ├─► ⬇ Download report (.json, kept locally)
                         └─► 🐙 Report on GitHub
                               │ 1. checks for open issues with the same error code → "Similar reports" (add 👍 instead?)
                               │ 2. opens github.com/…/issues/new with the form pre-filled (summary only, no logs)
                               ▼
                       User reviews, optionally attaches the .json, clicks Submit
                               ▼
GitHub Action (issue-ack.yml) ──► comments "Thanks — received R-…; we'll triage within 3 business days"
                               └─► labels: bug, from-extension, needs-triage, code:AJP-…, browser:…
                               ▼
Extension "My reports" ──► finds the issue by report id (public search, no login)
                           shows: "Received #42 · open" → "Fixed in v0.2.0" (closed + label fixed)
                               ▼
Team triages → reproduces → writes a failing test → fixes → "Fixes #42" → release → labels fixed-in:vX
```

## 2. What goes into the issue, and what never does

The repo is **public**, so anyone can read issues.

| Included (pre-filled) | Never included automatically |
|---|---|
| Title: `[AJP-AI-429] <first line of the description> (R-20261118-7KQ2D)` | Logs (even scrubbed logs show which sites and jobs someone looked at) |
| Report id, extension version, browser + version, OS | Name, email, phone, resume text, EEO answers, API keys (already never in reports) |
| Error codes with counts (e.g. `AJP-AI-429 ×2, AJP-JD-NONE ×1`) and the last error's message | Job URLs or job titles |
| The user's description (scrubbed again: emails, phone numbers and keys masked) | Learned answers, applications, profile content |
| AI provider name (not the key), log level, number of tracks | |

**The full `.json` report** stays on the user's computer. The issue form asks them to attach it **only if they're comfortable**. It's scrubbed, but it shows sites visited.

**URL limit:** pre-filled issue URLs are capped at about **7,500 characters**. The extension trims the description and error list to fit, and never drops the report id.

## 3. Extension: "Report on GitHub" button (step 7 ✅)
- **Where:**
  - in the 🆘 Report an issue dialog, next to Download report
  - on the crash prompt (§4)
  - in the popup (Report a problem)
- **URL:** `https://github.com/samberchmans-games/apply-job-plugin/issues/new?template=bug_report.yml&title=…&report_id=…&version=…&browser=…&codes=…&what_happened=…&environment=…`. The query keys match the form field ids, so each field is pre-filled.
- **Before opening,** the button shows **"Similar reports"**: open issues whose title contains the same error code, from the GitHub search API (`repo:samberchmans-games/apply-job-plugin is:issue is:open "AJP-AI-429" in:title`). Each has a link: *"Same problem? Add 👍 or a comment there instead."*
- **Saves the report locally** in `reports[]` = `{ reportId, createdAt, codes[], title, openedOnGitHub: true }`.
- Needs host permission `https://api.github.com/*` (read-only public search; no token).

## 4. Extension: crash prompt (step 7 ✅)
The prompt appears when something fails that the user may not notice.

- **Triggers:**
  - any `AJP-INTERNAL` error
  - `AJP-STORE`
  - the same error code 3 times within 10 minutes
  - never for problems users fix themselves (AI off, wrong key, rate limit, no job description, resume format, …)
- **What the user sees:** a small panel or Admin banner: *"Something went wrong (AJP-INTERNAL). Report it?"* with **Report** and **Not now**, plus a **Don't ask again for this error** link.
- **Limits:** at most once per error code per day. Can be switched off in Settings.
- **Never sends anything automatically.** "Report" opens the same dialog, pre-filled.

## 5. Extension: acknowledgement and status ("My reports", step 7 ✅)
Admin → Logs & support → **My reports** lists `reports[]`:

| Status shown | How it's known |
|---|---|
| ⏳ Not submitted yet | No issue found with this report id |
| ✅ Received #42, open | Public search finds the issue by report id; the Action's acknowledgement is on it |
| 🔧 Being fixed | Label `confirmed` or `in-progress` |
| 🎉 Fixed in v0.2.0 | Issue closed with label `fixed-in:v0.2.0` |
| ↩ Closed: duplicate / won't fix | Issue closed with that label |

- **Lookup:** `GET https://api.github.com/search/issues?q=repo:samberchmans-games/apply-job-plugin+"R-20261118-7KQ2D"+in:title`. No login is needed.
- **When it checks:**
  - when Admin opens, at most every 10 minutes
  - a daily background check for reports that are still open
- **Limits:** GitHub allows 10 unauthenticated searches per minute, so the extension checks at most 5 reports per run.
- When a report changes to "Fixed", the toolbar badge shows a ✓ until Admin is opened.

## 6. Extension: tests (step 7 ✅: 50 tests)

| Area | Tests |
|---|---|
| URL builder | Every field pre-filled; title format; length ≤ 7,500 with the report id never dropped; scrubbing of the description; no logs, URLs or personal data in the URL |
| Similar reports | Search query per code; results shown; network error → button still works |
| Crash prompt | Triggers (`AJP-INTERNAL`, `AJP-STORE`, 3× in 10 min); once per code per day; "don't ask again"; setting off; never sends without a click |
| My reports | Status mapping (not submitted / received / being fixed / fixed in vX / closed); rate limit (5 per run); badge on fixed |
| UI | Button in the dialog and popup; Similar reports list; My reports list |

## 7. Maintainer workflow (how we take it and fix it)

**Labels** (the Action creates `code:*` and `browser:*` automatically; create the rest once):

| Label | Meaning |
|---|---|
| `bug` · `from-extension` | Every report from the form |
| `needs-triage` | New, not looked at yet (the Action adds it) |
| `needs-info` | Waiting for the reporter (e.g. please attach the report file) |
| `confirmed` | Reproduced |
| `in-progress` | Being fixed |
| `fixed-in:v0.2.0` | Shipped in that version (add before closing) |
| `duplicate` · `wont-fix` | Closed without a fix |
| `code:AJP-AI-429` | Error code, parsed from the title by the Action |
| `browser:chrome` / `firefox` / `edge` / `safari` | From the form |

**Within 3 business days of a new issue:**
1. **Triage.** Read the code and description. Look up the code in [SUPPORT.md](SUPPORT.md). If the report file is attached, filter its logs by the trace id (`tid`) of the failing action.
2. **Label it:** `confirmed`, `needs-info`, `duplicate` (link the original), or `wont-fix`, each with a one-line reason. Remove `needs-triage`.
3. **Fix:**
   1. Write a test that fails without the fix (the rule from [TEST-SCENARIOS.md](TEST-SCENARIOS.md)).
   2. Fix it on a branch.
   3. Put `Fixes #42` in the commit or PR, then merge to `develop`.
   4. Add the bug to [TRACKER.md](TRACKER.md) §4.
4. **Release:** bump the version, add `fixed-in:vX.Y.Z`, then close. The reporter is notified by GitHub, and the extension's My reports shows *"Fixed in vX.Y.Z"*.

## 8. Users without a GitHub account
- In the report dialog, **Download report** + **Copy summary**, then email both to the organizer.
- The organizer opens the issue on their behalf with the same form, pasting the summary and the report id. The status then shows up in the reporter's My reports, because it searches by report id.

## 9. Manual test scenarios (to add to TEST-SCENARIOS.md with step 7)
| ID | Steps | Expected |
|---|---|---|
| L1 | Report an issue → Report on GitHub | GitHub opens with title `[code] … (R-…)` and every form field filled; no logs, emails or URLs in it |
| L2 | Submit the issue | Within about a minute, a "Thanks, received R-…" comment and the labels `bug`, `from-extension`, `needs-triage` and `code:…` appear |
| L3 | Admin → My reports | It shows "Received #N · open" |
| L4 | Maintainer closes it with `fixed-in:v0.2.0` | My reports shows "Fixed in v0.2.0"; the toolbar badge shows ✓ |
| L5 | Cause an `AJP-INTERNAL` error | The crash prompt appears once; Report opens the dialog pre-filled; Not now hides it for the day |
| L6 | Report the same error code twice | "Similar reports" lists the first issue |
| L7 | Disconnect from the internet → Report on GitHub | It still opens; similar reports and status show "couldn't check" |
| L8 | Settings → turn off crash prompts | No prompt appears |
