# Status tracker

This is the single page for **where every component stands right now**. The other documents cover the rest:
- [PLAN.md](PLAN.md): goals and roadmap
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): test details
- [SUPPORT.md](SUPPORT.md): error codes

**Last updated:** 2026-11-18 · **Version:** 0.1.0 · **Branch:** `develop` · **Latest step:** 18, Admin / popup UI tests (all planned items built)

## Summary

| | |
|---|---|
| Components built | **33 / 35** |
| Components not started | **2**: resume export, CI |
| Automated tests | **993 / 993 passing** (505 also run without a browser), incl. convention checks |
| Error handling | **One standard across the plugin**: coded errors, retries, guarded actions, no silent failures ([ARCHITECTURE §9b](ARCHITECTURE.md)) |
| Tester material | Tester Guide (8 sessions, 105 checks) + 7 walkthrough videos (~8.5 min) + local Workday and Greenhouse/Lever/Ashby/iCIMS emulation pages |
| Problem reports | GitHub issues with a pre-filled form + automatic acknowledgement ([ISSUE-REPORTING.md](ISSUE-REPORTING.md)) |
| Verified in a real browser | **0 / 4 browsers**: waiting on your manual pass |
| Real-AI quality check of resume tailoring | **⏳ waiting on you** (needs a free Groq or Gemini key) |
| Open bugs | **0 known** (18 found and fixed so far, each with a test) |
| Next step | **None planned.** Remaining work is real-world testing (your side), store submission (your side), and fixes from tester reports |

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
| C05 | Error codes + **THE STANDARD** (retry, http, guard) | `src/lib/errors.js` | ✅ | 7 + 43 | ⏳ | Every code documented in SUPPORT.md (checked by a test); convention tests scan the source |
| C06 | Diagnostics / issue report | `src/lib/diagnostics.js` | ✅ | 11 | ⏳ | No personal data (tested) |
| C07 | Skills dictionary | `src/lib/skills-dictionary.js` | ✅ | (in C08) | ⏳ | 199 skills |
| C08 | Matcher (match %, gaps, fit) + **synonyms**: implied skills count fully (Next.js → React), similar ones half (Azure for AWS) | `src/lib/matcher.js`, `src/lib/skills-dictionary.js` | ✅ | 49 + 13 | ⏳ | |
| C26 | **Experience & seniority check**: years asked (overall + per skill) vs. profile / work history / resume dates; job level vs. your level; fit rows only, never the % | `src/lib/experience.js` | ✅ | 50 | ⏳ | Check on real job posts (2.10–2.13): report a number it misread |
| C09 | AI providers & prompts | `src/lib/ai.js` | ✅ | 28 + 29 | ⏳ | Gemini, Groq, OpenRouter, Ollama, **Chrome built-in AI** (on-device, no key; Prompt API, current + older shape; prompts fitted to the small window; one-time download from Admin); one automatic retry on invalid JSON |
| C10 | Word (.docx) resume reader | `src/lib/docx.js` | ✅ | 5 | ⏳ | |
| C11 | **PDF resume reader** (pdf.js 4.10.38, loaded on demand; lines, bullets, paragraphs) | `src/lib/pdf.js`, `src/vendor/pdfjs/` | ✅ | 26 | ⏳ | Scanned PDFs → AJP-PDF-NOTEXT; locked → AJP-PDF-LOCKED |
| C12 | Application tracker logic | `src/lib/tracker.js` | ✅ | 77 | ⏳ | Job identity across 8 sites, merge rules, reminders, stats, CSV |
| C24 | **Career tracks logic** (score every job per track, best track, insights, history) | `src/lib/tracks.js` | ✅ | 20 | ⏳ | Implicit "General" track = no migration needed |
| C32 | **Career tracks UI** (panel tabs, Admin tracks + insights + compare, per-track tailoring/autofill/tracking) | `content.js`, `panel.js`, `src/admin/tracks-view.js` | ✅ | 13 | ⏳ | |
| C33 | **Issue reporting rules** (pre-filled issue, public-text scrubbing, status mapping, crash-prompt rules) | `src/lib/issue-report.js` | ✅ | 29 | ⏳ | |
| C35 | **Issue reporting UI** (Report on GitHub, similar reports, My reports + badge, crash prompt/banner, Simulate a problem) | `background.js`, `admin.js`, `panel.js` | ✅ | 21 | ⏳ | Status via public GitHub search |
| C27 | **Greenhouse / Lever / Ashby / iCIMS adapters**: site field names, searchable dropdowns (React-Select), location autocompletes, Yes/No buttons, hidden selects behind custom dropdowns (select2, iCIMS), Lever resume-first, iCIMS sign-in note; the widgets also work on unknown sites | `src/content/ats.js`, `tests/fixtures/ats-mock.js`, `tests/fixtures/ats-sample.html` | ✅ | 55 | ⏳ | Built against emulations: **verify on real applications (W06b)** |
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
| C30 | **Resume enhancement pipeline** (analyze → verify → edits → validate → draft → apply) + **limits**: only for close matches (70%+), max 6 rewrites, user-confirmed skills placed in the job they choose (spread 2 : 1 by default), resume match ≤ your match + 15 | `background.js` (`resume.enhance`, `resume.addSkills`, `resume.applyEnhancement`), `content.js`, `enhance-view.js` | ✅ | 26 + 25 | ⏳ | Tested with a fake AI that deliberately cheats |

### Extension pages
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C19 | Admin: profile, skills (**added automatically from the resume**), preferences, resumes, auto-apply, AI settings, learned answers, backup | `src/admin/admin.html/.js/.css` | ✅ | 29 | ⏳ | UI tests: navigation, profile, skills, preferences, resumes, auto-apply, backup (`admin-screens.test.js`) |
| C20 | Admin: Applications (board, table, details, stats, CSV) | `src/admin/tracker-view.js` | ✅ | 10 | ⏳ | |
| C21 | Admin: Logs & support (Report an issue) | `src/admin/admin.js` | ✅ | 7 | ⏳ | |
| C31 | **Admin: resume tailoring review** | `src/admin/enhance-view.js` | ✅ | 6 | ⏳ | Requirements + evidence, before/after, blocked reasons, "add your real number", gaps, create |
| C22 | **Resume PDF writer** (one format): every resume gets an ATS-readable PDF; tailored ones on creation; kept in sync with typed text; Autofill uploads the one tailored for the job; Download / View PDF | `src/lib/pdf-writer.js` | ✅ | 29 | ⏳ | Replaces the old print view. Check the PDF on a real ATS upload (B9, E18) |
| C23 | Toolbar popup | `src/popup/*` | ✅ | 7 + 1 | ⏳ | UI tests: status, warnings, AI label, due link, Admin / report links, Analyze, error display |

### Not started (roadmap)
| ID | Component | Roadmap step | Built | Notes |
|---|---|---|---|---|
| C39 | **Repeatable entries** (work experience / education on any site except Workday) | `src/content/entries.js` | ✅ | 17 | ⏳ | Built against emulations (Greenhouse blocks, SmartRecruiters forms): verify on real sites |
| C38 | **Store packaging** (Chrome, Edge, Firefox, Safari) | `tools/package.py`, `tools/safari.sh`, `tools/store_assets.py`, `docs/store/` | ✅ | — | ⏳ | Submission needs your developer accounts (W21) |
| C37 | **Profile suggestions** (learned answers → profile) + shared field rules | `src/lib/profile-suggest.js`, `src/lib/field-rules.js`, `admin.js`, `popup.js` | ✅ | 19 | ⏳ | |
| C36 | **CI** (GitHub Actions: checks, CLI tests, browser tests) | — | ✅ | `.github/workflows/ci.yml`, `tests/check.sh`; status badge in README |
| C34 | GitHub issue form + acknowledgement Action | — | ✅ | `.github/`; live on the default branch |

**Test totals:** 14 + 49 + 33 + 7 + 11 + 17 + 28 + 5 + 102 + 26 + 11 + 28 (tracker flows 25 + end-to-end 3) + 21 + 77 + 10 + 7 + **54 + 26 + 6** (resume enhancement) + **20 + 13** (career tracks) + **29 + 21** (issue reporting) + **43** (the standard & conventions) + **26** (PDF) + **34 + 2** (Workday + rule fixes) + **29** (resume PDFs) + **63** (smarter matching) + **55** (site adapters) + **29** (built-in AI) + **19** (profile suggestions) + **17** (entries) + **31** (Admin screens & popup) + **5** (skills from resume) + **25** (tailoring limits) = **993**

---

## 2. Work items

| ID | Work item | Step | Owner | Status | Depends on |
|---|---|---|---|---|---|
| W16 | **Resume enhancement v2**: job-requirement analysis, verified evidence, targeted result-oriented edits, hard safety rules (never copy job numbers), review screen | 5 | Claude | ✅ Done | — |
| W17 | Try resume tailoring with a real free AI (Groq or Gemini) on 2–3 real jobs and your real resume; judge quality | — | **You** | ⏳ Waiting on you | A free API key |
| W01 | Multiple career tracks (2–3 profiles, score every job against each, best track, insights, compare) | 6 | Claude | ✅ Done | W16 ✅ |
| W18 | Tester material for every step: Tester Guide session + walkthrough video part | — | Claude | ✅ Ongoing (8 sessions, 7 videos, Workday emulation, PDF checks) | — |
| W19 | **Issue reporting, extension side**: Report on GitHub, similar reports, crash prompt, My reports | 7 | Claude | ✅ Done | — |
| W21 | Submit to the stores: Chrome Web Store (one-time fee), Edge Add-ons, Firefox AMO; Safari needs an Apple Developer membership. Decide the 4 items in docs/store/SUBMISSION.md first | — | **You** | ⏳ When you're ready | Store packaging ✅ |
| W20 | Create the triage labels once in GitHub (`needs-info`, `confirmed`, `in-progress`, `duplicate`, `wont-fix`, `fixed-in:…`) | — | **You** | ⏳ Waiting on you | — |
| W02 | Read PDF resumes automatically | 8 | Claude | ✅ Done | — |
| W03 | Workday custom dropdowns, date pickers, multi-step experience | 9 | Claude | ✅ Done (against an emulation) | — |
| W03b | Try Autofill on 1–2 real Workday applications; report any missed field (page + label) | — | **You** | ⏳ Waiting on you | W03 |
| W04 | Attach the tailored resume (one format: PDF) | 10 | Claude | ✅ Done | — |
| W05 | Years-of-experience & seniority check; skill synonyms | 11 | Claude | ✅ Done | — |
| W06 | Per-site autofill adapters (Greenhouse, Lever, Ashby, iCIMS) | 12 | Claude | ✅ Done (against emulations) | — |
| W06b | Try Autofill on 1–2 real Greenhouse, Lever, Ashby and iCIMS applications (Tester Guide 4.15–4.19); report any missed field (site + label) | — | **You** | ⏳ Waiting on you | W06 |
| W07 | Chrome built-in AI provider (no key) | 13 | Claude | ✅ Done (against a simulated Prompt API) | — |
| W07b | Try Chrome built-in AI on a real desktop Chrome 138+: download, Test connection, AI deep analysis, Draft answer, Tailor resume (Tester Guide 1.16–1.18); note speed and quality | — | **You** | ⏳ Waiting on you | W07 |
| W08 | Suggest profile updates from learned answers | 14 | Claude | ✅ Done | — |
| W09 | CI on GitHub | 15 | Claude | ✅ Done | — |
| W10 | Load in Chrome and run the manual scenarios | — | **You** | ⏳ Waiting on you | — |
| W11 | Verify in Firefox, Edge and Safari | — | **You** | ⏳ Waiting on you | W10 |
| W12 | Check job-page reading on live LinkedIn, Indeed and Glassdoor | — | **You** | ⏳ Waiting on you | W10 |
| W13 | Automated UI tests for the Admin profile/skills/resume screens and the popup (C19, C22, C23) | 18 | Claude | ✅ Done (found and fixed B16, B17) | — |
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
| 18 | **Admin & popup UI tests**: navigation, profile, skills, preferences, resumes, auto-apply, backup (export without keys, import, wipe), popup; fixed B16 (resume rename lost) and B17 (unknown Admin link → blank page) | `1d59cc4` | 963 |
| 17 | **Work experience / education entries on any site**: sections found by heading + anchor field, "Add another" clicked per profile item, fields by label (dates as month+year / MM/YYYY / month input, current job, searchable school/degree), user entries kept; Tester Guide 4.22–4.23 + video Part 4 scene | `d3cbc4c` | 932 |
| 16 | **Store packaging**: per-store zips with the right manifest + verification (`tools/package.py`), Chrome packer and Safari Xcode build verified, CI package job with Mozilla `web-ext lint`, listing texts, privacy policy, submission checklist, screenshots + promo tiles (`tools/store_assets.py`), Safari project (`tools/safari.sh`) | `3794ddc` | 915 |
| 14 | **Profile suggestions from learned answers**: shared field rules (`field-rules.js`), suggestion rules (empty field / typed twice, most used wins, EEO never), Admin box with Save / Dismiss / Save all + menu count, popup line; Tester Guide 4.20–4.21 + video Part 4 scene | `4561e39` | 915 |
| 15 | **CI on GitHub**: checks (manifest, files, syntax, debug code), CLI tests (Node), full browser suite (headless Chrome) on every push / PR; `tests/check.sh` | `db02377` | 896 |
| 13 | **Chrome built-in AI** (on-device, no key): new provider, Admin status + one-time download + "Use it" banner, prompt fitting, 4 new error codes; Tester Guide 1.16–1.18 + video Part 1 scene | `be4de6f` | 896 |
| 12 | **Greenhouse / Lever / Ashby / iCIMS adapters** + generic searchable dropdowns, Yes/No buttons, hidden selects, "TX → Texas" for every native dropdown; fixed B15; emulations + local sample page; Tester Guide 4.15–4.19 + video Part 4 scenes | `02b032c` | 867 |
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
| B18 | The "Learned answers" menu showed a "0" badge when there was nothing to suggest (CSS beat `hidden`) | You (screenshot) | After step 18 | admin screens › the Learned answers badge is hidden… |
| B17 | An unknown Admin link (old bookmark, typo) showed an empty page | Admin UI tests | Step 18 | admin screens › … unknown section falls back to Profile |
| B16 | Renaming a resume and then editing its text within half a second lost the new name (one shared save timer) | Admin UI tests | Step 18 | admin screens › bug B16… |
| B15 | A `<select>` inside its own `<label>` (Lever) was labelled with all its options ("Gender✱Select …MaleFemale…"); "✱" was not stripped | Video render | Step 12 | sites › bug B15… |
| B14 | A short bullet with "experience" or "skills" under **Nice to have** (e.g. "- Experience with Snowflake") was read as a heading and flipped the rest back to *required* | Experience tests | Step 11 | matcher › bug B14… |

## 5. How to update this file

When a step is finished:
1. Update **Summary**.
2. Flip the component's **Built** status and update its **Tests** count. `BY_SUITE=--by-suite ./tests/run-browser-tests.sh` prints the counts per suite.
3. Move the work item to **Done**, with its commit.
4. Add any bug that was fixed to **Bugs found & fixed**.

When you finish manual testing in a browser, set the **Browser** column to ✅ (or note the browser, e.g. "✅ Chrome 131"). Log failures as new bugs, and attach an issue report (`R-…`) where possible.
