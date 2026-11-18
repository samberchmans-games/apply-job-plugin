# Status tracker

This is the single page for **where every component stands right now**. The other documents cover the rest:
- [PLAN.md](PLAN.md): goals and roadmap
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): test details
- [SUPPORT.md](SUPPORT.md): error codes

**Last updated:** 2026-11-18 · **Version:** 0.1.0 · **Branch:** `develop` · **Latest step:** 11, smarter matching

## Summary

| | |
|---|---|
| Components built | **33 / 35** |
| Components not started | **2**: resume export, CI |
| Automated tests | **812 / 812 passing** (456 also run without a browser), incl. convention checks |
| Error handling | **One standard across the plugin**: coded errors, retries, guarded actions, no silent failures ([ARCHITECTURE §9b](ARCHITECTURE.md)) |
| Tester material | Tester Guide (8 sessions, 87 checks) + 7 walkthrough videos (~8.5 min) + local Workday emulation page |
| Problem reports | GitHub issues with a pre-filled form + automatic acknowledgement ([ISSUE-REPORTING.md](ISSUE-REPORTING.md)) |
| Verified in a real browser | **0 / 4 browsers**: waiting on your manual pass |
| Real-AI quality check of resume tailoring | **⏳ waiting on you** (needs a free Groq or Gemini key) |
| Open bugs | **0 known** (14 found and fixed so far, each with a test) |
| Next step | **Step 12: per-site adapters for Greenhouse, Lever, Ashby, iCIMS** |

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
| C05 | Error codes + **THE STANDARD** (retry, http, guard) | `src/lib/errors.js` | ✅ | 7 + 43 | ⏳ | 23 codes in SUPPORT.md; convention tests scan the source |
| C06 | Diagnostics / issue report | `src/lib/diagnostics.js` | ✅ | 11 | ⏳ | No personal data (tested) |
| C07 | Skills dictionary | `src/lib/skills-dictionary.js` | ✅ | (in C08) | ⏳ | 199 skills |
| C08 | Matcher (match %, gaps, fit) + **synonyms**: implied skills count fully (Next.js → React), similar ones half (Azure for AWS) | `src/lib/matcher.js`, `src/lib/skills-dictionary.js` | ✅ | 49 + 13 | ⏳ | |
| C26 | **Experience & seniority check**: years asked (overall + per skill) vs. profile / work history / resume dates; job level vs. your level; fit rows only, never the % | `src/lib/experience.js` | ✅ | 50 | ⏳ | Check on real job posts (2.10–2.13): report a number it misread |
| C09 | AI providers & prompts | `src/lib/ai.js` | ✅ | 28 | ⏳ | Gemini, Groq, OpenRouter, Ollama; one automatic retry on invalid JSON. ⬜ Chrome built-in AI (step 12) |
| C10 | Word (.docx) resume reader | `src/lib/docx.js` | ✅ | 5 | ⏳ | |
| C11 | **PDF resume reader** (pdf.js 4.10.38, loaded on demand; lines, bullets, paragraphs) | `src/lib/pdf.js`, `src/vendor/pdfjs/` | ✅ | 26 | ⏳ | Scanned PDFs → AJP-PDF-NOTEXT; locked → AJP-PDF-LOCKED |
| C12 | Application tracker logic | `src/lib/tracker.js` | ✅ | 77 | ⏳ | Job identity across 8 sites, merge rules, reminders, stats, CSV |
| C24 | **Career tracks logic** (score every job per track, best track, insights, history) | `src/lib/tracks.js` | ✅ | 20 | ⏳ | Implicit "General" track = no migration needed |
| C32 | **Career tracks UI** (panel tabs, Admin tracks + insights + compare, per-track tailoring/autofill/tracking) | `content.js`, `panel.js`, `src/admin/tracks-view.js` | ✅ | 13 | ⏳ | |
| C33 | **Issue reporting rules** (pre-filled issue, public-text scrubbing, status mapping, crash-prompt rules) | `src/lib/issue-report.js` | ✅ | 29 | ⏳ | |
| C35 | **Issue reporting UI** (Report on GitHub, similar reports, My reports + badge, crash prompt/banner, Simulate a problem) | `background.js`, `admin.js`, `panel.js` | ✅ | 21 | ⏳ | Status via public GitHub search |
| C25 | **Workday adapter** (pop-up dropdowns, search prompts, dates, Add entries, multi-page offer) | `src/content/workday.js`, `tests/fixtures/workday-mock.js` | ✅ | 34 | ⏳ | Built against an emulation: **verify on real Workday (W03b)** |
| C29 | **Resume enhancement rules engine** | `src/lib/resume-engine.js` | ✅ | 54 | ⏳ | Parsing, strict prompts, validator (no job numbers, no invented numbers/skills/names, no copied job text, evidence required), result-oriented checks, assembly + integrity check |

### On the job page
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C13 | Job description reader | `src/content/jd-extractor.js` | ✅ | 26 | ⏳ | Live LinkedIn, Indeed and Glassdoor selectors are unverified |
| C14 | Autofill + learning | `src/content/form-filler.js` | ✅ | 104 | ⏳ | 55 field rules (question rules first) |
| C15 | Applied-job detector | `src/content/apply-detector.js` | ✅ | 25* | ⏳ | *Shared with C17/C18 (tracker end-to-end flows) |
| C16 | On-page panel | `src/content/panel.js` | ✅ | 11 | ⏳ | Shadow DOM; escaping tested |
| C17 | Page controller | `src/content/content.js` | ✅ | 3 + 25* | ⏳ | Covered by the end-to-end tests |

### Background
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C18 | Background (router, AI, saving, badge, tabs) | `src/background/background.js` | ✅ | 21 | ⏳ | Trace correlation tested end-to-end |
| C30 | **Resume enhancement pipeline** (analyze → verify → edits → validate → draft → apply) | `background.js` (`resume.enhance`, `resume.applyEnhancement`), `content.js` | ✅ | 26 | ⏳ | Tested with a fake AI that deliberately cheats |

### Extension pages
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C19 | Admin: profile, skills, preferences, resumes, auto-apply, AI settings, learned answers, backup | `src/admin/admin.html/.js/.css` | ✅ | 0 | ⏳ | 🟡 **No automated UI tests yet**; covered by manual scenarios B1–B18 |
| C20 | Admin: Applications (board, table, details, stats, CSV) | `src/admin/tracker-view.js` | ✅ | 10 | ⏳ | |
| C21 | Admin: Logs & support (Report an issue) | `src/admin/admin.js` | ✅ | 7 | ⏳ | |
| C31 | **Admin: resume tailoring review** | `src/admin/enhance-view.js` | ✅ | 6 | ⏳ | Requirements + evidence, before/after, blocked reasons, "add your real number", gaps, create |
| C22 | **Resume PDF writer** (one format): every resume gets an ATS-readable PDF; tailored ones on creation; kept in sync with typed text; Autofill uploads the one tailored for the job; Download / View PDF | `src/lib/pdf-writer.js` | ✅ | 29 | ⏳ | Replaces the old print view. Check the PDF on a real ATS upload (B9, E18) |
| C23 | Toolbar popup | `src/popup/*` | ✅ | 0 | ⏳ | 🟡 No automated tests; manual A2, F7, I12 |

### Not started (roadmap)
| ID | Component | Roadmap step | Built | Notes |
|---|---|---|---|---|
| C26 | Tailored resume as a PDF/DOCX file | 10 | ⬜ | |
| C27 | Per-site adapters (Greenhouse, Lever, Ashby, iCIMS) | 12 | ⬜ | |
| C28 | CI on GitHub (run tests on every push) | 15 | ⬜ | |
| C34 | GitHub issue form + acknowledgement Action | — | ✅ | `.github/`; live on the default branch |

**Test totals:** 14 + 49 + 33 + 7 + 11 + 17 + 28 + 5 + 102 + 26 + 11 + 28 (tracker flows 25 + end-to-end 3) + 21 + 77 + 10 + 7 + **54 + 26 + 6** (resume enhancement) + **20 + 13** (career tracks) + **29 + 21** (issue reporting) + **43** (the standard & conventions) + **26** (PDF) + **34 + 2** (Workday + rule fixes) + **29** (resume PDFs) + **63** (smarter matching) = **812**

---

## 2. Work items

| ID | Work item | Step | Owner | Status | Depends on |
|---|---|---|---|---|---|
| W16 | **Resume enhancement v2**: job-requirement analysis, verified evidence, targeted result-oriented edits, hard safety rules (never copy job numbers), review screen | 5 | Claude | ✅ Done | — |
| W17 | Try resume tailoring with a real free AI (Groq or Gemini) on 2–3 real jobs and your real resume; judge quality | — | **You** | ⏳ Waiting on you | A free API key |
| W01 | Multiple career tracks (2–3 profiles, score every job against each, best track, insights, compare) | 6 | Claude | ✅ Done | W16 ✅ |
| W18 | Tester material for every step: Tester Guide session + walkthrough video part | — | Claude | ✅ Ongoing (8 sessions, 7 videos, Workday emulation, PDF checks) | — |
| W19 | **Issue reporting, extension side**: Report on GitHub, similar reports, crash prompt, My reports | 7 | Claude | ✅ Done | — |
| W20 | Create the triage labels once in GitHub (`needs-info`, `confirmed`, `in-progress`, `duplicate`, `wont-fix`, `fixed-in:…`) | — | **You** | ⏳ Waiting on you | — |
| W02 | Read PDF resumes automatically | 8 | Claude | ✅ Done | — |
| W03 | Workday custom dropdowns, date pickers, multi-step experience | 9 | Claude | ✅ Done (against an emulation) | — |
| W03b | Try Autofill on 1–2 real Workday applications; report any missed field (page + label) | — | **You** | ⏳ Waiting on you | W03 |
| W04 | Attach the tailored resume as PDF/DOCX | 10 | Claude | **⬜ Next**, waiting for your go | — |
| W05 | Years-of-experience & seniority check; skill synonyms | 11 | Claude | ⬜ To do | — |
| W06 | Per-site autofill adapters (Greenhouse, Lever, Ashby, iCIMS) | 12 | Claude | ⬜ To do | W10 findings |
| W07 | Chrome built-in AI provider (no key) | 13 | Claude | ⬜ To do | — |
| W08 | Suggest profile updates from learned answers | 14 | Claude | ⬜ To do | — |
| W09 | CI on GitHub | 15 | Claude | ⬜ To do | — |
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
| — | Architecture & plan documentation; this tracker | `bb34324`, `ab0c213` | 449 |
| 5 | **Resume enhancement v2**: requirements + verified evidence, targeted result-oriented edits, safety validator, review screen | `3022695` | 532 |
| — | Tester Guide (shareable doc) + 5 walkthrough videos | `53f4881` | 532 |
| — | Issue reporting option A: spec, GitHub issue form, auto-acknowledgement | `dbf8a47` | 565 |
| 6 | **Multiple career tracks**: per-track scoring, best track, switching, per-track tailoring/autofill/tracking, insights, compare; Tester Guide Session 7 + video Part 6 | `2ace0d5` | 565 |
| 7 | **Issue reporting, extension side**: Report on GitHub, similar reports, crash prompt, My reports, Simulate a problem; Tester Guide Session 8 + video Part 7 | `845b501` | 615 |
| — | **THE STANDARD** for errors, failure capture and retries, applied everywhere + convention tests | `3fb5ee3` | 658 |
| 8 | **PDF resumes**: text read automatically on upload (pdf.js, verified download), Read text from PDF, coded errors; Tester Guide 1.10–1.12 + video Part 1 scene; all videos re-rendered with aligned highlights | `eacd1a3` | 684 |
| 9 | **Workday support**: pop-up dropdowns, search prompts, Month/Year dates, Add entries for experience/education, "Autofill this page" across pages, learning from picks; emulated Workday for tests/videos; Tester Guide 4.9–4.12 + video Part 4 scenes | `fd1b226` | 720 |
| 11 | **Smarter matching**: years of experience (overall + per skill, from profile / work history / resume dates), seniority level, implied and similar skills; fixed B14; Tester Guide 2.10–2.13 + video Part 2 scene | `29a3e2a` | 812 |
| 10 | **One resume format (PDF)**: built-in PDF writer; every resume gets a PDF (tailored ones named for the company); Autofill uploads the resume tailored for *this* job and the panel names the file; Admin Download / View PDF (print view and .md removed); Tester Guide 1.13–1.15, 4.13–4.14 + video scenes | `b7b2522` | 749 |

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
| B8 | Old tailoring let the AI rewrite the whole resume, trusting it not to invent facts | Your review | Step 5 | Replaced by the evidence-checked edit pipeline (86 tests) |
| B9 | Resume reader treated `### Role — Company` lines as new sections, losing the role | Automated tests | Step 5 | resume engine › finds the bullets… with their role |
| B10 | Review screen didn't open when the Admin tab was already open | Automated tests | Step 5 | admin › resume tailoring review |
| B11 | A manual track pick carried over to the next job on single-page sites (LinkedIn) | Automated tests | Step 6 | tracks flow › a different job gets its own best track |
| B12 | "Are you legally authorized to work in the **country**…?" was answered with the country (address rule matched first) | Workday tests | Step 9 | autofill › a work-authorization question mentioning "country"… |
| B13 | "Phone Device Type" was filled with the phone number | Workday tests | Step 9 | autofill › "Phone Device Type" is the device type… |
| B14 | A short bullet with "experience" or "skills" under **Nice to have** (e.g. "- Experience with Snowflake") was read as a heading and flipped the rest back to *required* | Experience tests | Step 11 | matcher › bug B14… |

## 5. How to update this file

When a step is finished:
1. Update **Summary**.
2. Flip the component's **Built** status and update its **Tests** count. `BY_SUITE=--by-suite ./tests/run-browser-tests.sh` prints the counts per suite.
3. Move the work item to **Done**, with its commit.
4. Add any bug that was fixed to **Bugs found & fixed**.

When you finish manual testing in a browser, set the **Browser** column to ✅ (or note the browser, e.g. "✅ Chrome 131"). Log failures as new bugs, and attach an issue report (`R-…`) where possible.
