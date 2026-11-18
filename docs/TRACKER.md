# Status tracker

This is the single page for **where every component stands right now**. The other documents cover the rest:
- [PLAN.md](PLAN.md): goals and roadmap
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): test details
- [SUPPORT.md](SUPPORT.md): error codes

**Last updated:** 2026-11-18 · **Version:** 0.1.0 · **Branch:** `develop` · **Latest code commit:** `ab79d58`

## Summary

| | |
|---|---|
| Components built | **23 / 28** |
| Components not started | **5**: career tracks, PDF reader, Workday adapter, resume export, CI |
| Automated tests | **449 / 449 passing** (241 also run without a browser) |
| Verified in a real browser | **0 / 4 browsers**: waiting on your manual pass |
| Open bugs | **0 known** (7 found and fixed so far, each with a test) |
| Next step | **Step 5: multiple career tracks** |

Legend: ✅ done · 🟡 partial · 🔨 in progress · ⬜ not started · ⏳ waiting on you · — not applicable

---

## 1. Components

Columns:
- **Built**: whether the code exists and works in automated tests.
- **Tests**: the number of automated tests that exercise this component.
- **Browser**: whether it has been verified by hand in a real browser (Chrome / Firefox / Edge / Safari).

### Platform & shared libraries
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C01 | Extension manifest (MV3, 4 browsers) | `manifest.json` | ✅ | — | ⏳ | Firefox: the user must allow job-site permissions. Safari: needs the Xcode converter step. |
| C02 | Core helpers & messaging | `src/lib/core.js` | ✅ | 14 | ⏳ | |
| C03 | Local storage ("database") | `src/lib/storage.js` | ✅ | 17 | ⏳ | Versioned cache (race fix), backup/restore, coded errors |
| C04 | Logger (sessions, traces, redaction) | `src/lib/logger.js` | ✅ | 33 | ⏳ | Flight recorder; value redaction |
| C05 | Error codes | `src/lib/errors.js` | ✅ | 7 | ⏳ | 19 codes, listed in SUPPORT.md |
| C06 | Diagnostics / issue report | `src/lib/diagnostics.js` | ✅ | 11 | ⏳ | No personal data (tested) |
| C07 | Skills dictionary | `src/lib/skills-dictionary.js` | ✅ | (in C08) | ⏳ | 199 skills |
| C08 | Matcher (match %, gaps, fit) | `src/lib/matcher.js` | ✅ | 49 | ⏳ | ⬜ years/seniority check, synonyms (step 9) |
| C09 | AI providers & prompts | `src/lib/ai.js` | ✅ | 29 | ⏳ | Gemini, Groq, OpenRouter, Ollama. ⬜ Chrome built-in AI (step 11) |
| C10 | Word (.docx) resume reader | `src/lib/docx.js` | ✅ | 5 | ⏳ | |
| C11 | PDF resume reader | — | ⬜ | — | — | **Step 6.** Users paste the text for now. |
| C12 | Application tracker logic | `src/lib/tracker.js` | ✅ | 77 | ⏳ | Job identity across 8 sites, merge rules, reminders, stats, CSV |

### On the job page
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C13 | Job description reader | `src/content/jd-extractor.js` | ✅ | 26 | ⏳ | Live LinkedIn, Indeed and Glassdoor selectors are unverified |
| C14 | Autofill + learning | `src/content/form-filler.js` | ✅ | 102 | ⏳ | 54 field rules. 🟡 Workday custom widgets are not handled (step 7). |
| C15 | Applied-job detector | `src/content/apply-detector.js` | ✅ | 25* | ⏳ | *Shared with C17/C18 (tracker end-to-end flows) |
| C16 | On-page panel | `src/content/panel.js` | ✅ | 11 | ⏳ | Shadow DOM; escaping tested |
| C17 | Page controller | `src/content/content.js` | ✅ | 3 + 25* | ⏳ | Covered by the end-to-end tests |

### Background
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C18 | Background (router, AI, saving, badge, tabs) | `src/background/background.js` | ✅ | 23 | ⏳ | Trace correlation tested end-to-end |

### Extension pages
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C19 | Admin: profile, skills, preferences, resumes, auto-apply, AI settings, learned answers, backup | `src/admin/admin.html/.js/.css` | ✅ | 0 | ⏳ | 🟡 **No automated UI tests yet**; covered by manual scenarios B1–B18 |
| C20 | Admin: Applications (board, table, details, stats, CSV) | `src/admin/tracker-view.js` | ✅ | 10 | ⏳ | |
| C21 | Admin: Logs & support (Report an issue) | `src/admin/admin.js` | ✅ | 7 | ⏳ | |
| C22 | Printable resume (Save as PDF) | `src/admin/resume-view.*` | ✅ | 0 | ⏳ | Manual scenario B9 |
| C23 | Toolbar popup | `src/popup/*` | ✅ | 0 | ⏳ | 🟡 No automated tests; manual A2, F7, I12 |

### Not started (roadmap)
| ID | Component | Roadmap step | Built | Notes |
|---|---|---|---|---|
| C24 | Multiple career tracks | **5 (next)** | ⬜ | Design in ARCHITECTURE.md §15 |
| C25 | Workday adapter (dropdowns, dates, "My Experience") | 7 | ⬜ | |
| C26 | Tailored resume as a PDF/DOCX file | 8 | ⬜ | |
| C27 | Per-site adapters (Greenhouse, Lever, Ashby, iCIMS) | 10 | ⬜ | |
| C28 | CI on GitHub (run tests on every push) | 13 | ⬜ | |

**Test totals:** 14 + 49 + 33 + 7 + 11 + 17 + 29 + 5 + 102 + 26 + 11 + 26 (tracker flows + end-to-end) + 23 + 77 + 10 + 7 = **449**

---

## 2. Work items

| ID | Work item | Step | Owner | Status | Depends on |
|---|---|---|---|---|---|
| W01 | Multiple career tracks (2–3 profiles, score every job against each, best track, insights, compare) | 5 | Claude | **⬜ Next**, waiting for your go | — |
| W02 | Read PDF resumes automatically | 6 | Claude | ⬜ To do | — |
| W03 | Workday custom dropdowns, date pickers, multi-step experience | 7 | Claude | ⬜ To do | Ideally W10 first (real Workday pages) |
| W04 | Attach the tailored resume as PDF/DOCX | 8 | Claude | ⬜ To do | — |
| W05 | Years-of-experience & seniority check; skill synonyms | 9 | Claude | ⬜ To do | — |
| W06 | Per-site autofill adapters (Greenhouse, Lever, Ashby, iCIMS) | 10 | Claude | ⬜ To do | W10 findings |
| W07 | Chrome built-in AI provider (no key) | 11 | Claude | ⬜ To do | — |
| W08 | Suggest profile updates from learned answers | 12 | Claude | ⬜ To do | — |
| W09 | CI on GitHub | 13 | Claude | ⬜ To do | — |
| W10 | Load in Chrome and run the manual scenarios | — | **You** | ⏳ Waiting on you | — |
| W11 | Verify in Firefox, Edge and Safari | — | **You** | ⏳ Waiting on you | W10 |
| W12 | Check job-page reading on live LinkedIn, Indeed and Glassdoor | — | **You** | ⏳ Waiting on you | W10 |
| W13 | Automated UI tests for the Admin profile/skills/resume screens and the popup (C19, C22, C23) | — | Claude | ⬜ To do (nice to have) | — |
| W14 | Publish to browser stores | — | Both | 💤 Later | W10, W11 |
| W15 | Optional email status sync (Gmail/Outlook) | — | Claude | 💤 Later, not decided | — |

## 3. Done

| Step | What | Commit | Tests after |
|---|---|---|---|
| 1 | v0.1 foundation: extension, Admin, matcher, page reading, autofill, AI, logging | `cb1ac98` | 11 |
| 2 | Full automated test suite + manual scenarios | `3609410` | 279 |
| 3 | Application tracker | `15fbc3c` | 391 |
| 4 | Support logging: error codes, trace ids, Report an issue | `ab79d58` | 449 |
| — | Architecture & plan documentation; this tracker | `bb34324`, *this commit* | 449 |

## 4. Bugs found & fixed

| # | Bug | Found by | Fixed in | Test |
|---|---|---|---|---|
| B1 | A read racing a write could cache stale data (e.g. old AI settings) | Automated tests | `3609410` | storage › a read racing with a write… |
| B2 | Any line with the word "preferred" (e.g. "our preferred vendors") was treated as a nice-to-have skill | Automated tests | `3609410` | matcher › long sentences are not treated as headings |
| B3 | Autofill reset an "applied" job back to "in progress" | Code review | `15fbc3c` | tracker › BUG FIX: automatic updates never move status backwards |
| B4 | Undo did nothing on a just-added application | Automated tests | `15fbc3c` | tracker › undo on a just-added application removes it |
| B5 | Application details: editing two fields quickly lost the first edit | Automated tests | `15fbc3c` | admin › detail dialog … saved |
| B6 | Interview date shown in UTC instead of local time | Screenshot review | `15fbc3c` | admin › detail dialog (no timezone shift) |
| B7 | Some test files silently failed to load in headless runs (dev server backlog) | Test tooling | `3609410` | Runner now reports load errors |

## 5. How to update this file

When a step is finished:
1. Update **Summary**.
2. Flip the component's **Built** status and update its **Tests** count. `BY_SUITE=--by-suite ./tests/run-browser-tests.sh` prints the counts per suite.
3. Move the work item to **Done**, with its commit.
4. Add any bug that was fixed to **Bugs found & fixed**.

When you finish manual testing in a browser, set the **Browser** column to ✅ (or note the browser, e.g. "✅ Chrome 131"). Log failures as new bugs, and attach an issue report (`R-…`) where possible.
