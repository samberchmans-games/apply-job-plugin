# Status tracker

This is the single page for **where every component stands right now**. The other documents cover the rest:
- [PLAN.md](PLAN.md): goals and roadmap
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): test details
- [SUPPORT.md](SUPPORT.md): error codes
- [JOB-FINDER.md](JOB-FINDER.md): Job Finder (Job Radar) architecture, roadmap step 19

**Last updated:** 2026-11-21 · **Version:** 0.1.0 · **Branch:** `develop` · **Latest step:** 19, Job Finder (built on `feature/job-radar`) · **Next:** your browser pass of Job Radar (T17), then merge

## Summary

| | |
|---|---|
| Components built | **38 / 40** (incl. the 5 Job Finder components) |
| Components not started | **0** (resume export and CI are done) |
| Automated tests | **1507 / 1507 passing** (729 also run without a browser), incl. convention checks |
| Error handling | **One standard across the plugin**: coded errors, retries, guarded actions, no silent failures ([ARCHITECTURE §9b](ARCHITECTURE.md)) |
| Tester material | Tester Guide (8 sessions, 110 checks) + 7 walkthrough videos (~8.5 min) + local Workday and Greenhouse/Lever/Ashby/iCIMS emulation pages |
| Problem reports | GitHub issues with a pre-filled form + automatic acknowledgement ([ISSUE-REPORTING.md](ISSUE-REPORTING.md)) |
| Verified in a real browser | **0 / 4 browsers**: waiting on your manual pass |
| Pending testing | **17 test areas × 4 browsers** to tick off, incl. retests of B18/B19: see [§2a Pending testing](#2a-pending-testing-your-side) |
| Job Finder (Job Radar) | **Built** on `feature/job-radar`: all 11 boards, Admin, popup, panel, alerts, badge (J01–J37 ✅); **your browser pass (T17 / J38) is next**, then merge (J39). [JOB-FINDER.md](JOB-FINDER.md) |
| Real-AI quality check of resume tailoring | **⏳ waiting on you** (needs a free Groq or Gemini key) |
| Open bugs | **0 known** (65 found and fixed so far, each with a test) |
| Next step | **Your Job Radar test pass (T17, TEST-SCENARIOS §M)**, then merge into `develop`. Alongside: real-world testing (§2a), store submission (your side), and fixes from tester reports |

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
| C19 | Admin: profile, skills (**added automatically from the resume, with years and level estimated from the job dates**), preferences, resumes, auto-apply, AI settings, learned answers, backup | `src/admin/admin.html/.js/.css` | ✅ | 29 | ⏳ | UI tests: navigation, profile, skills, preferences, resumes, auto-apply, backup (`admin-screens.test.js`) |
| C20 | Admin: Applications (board, table, details, stats, CSV) | `src/admin/tracker-view.js` | ✅ | 10 | ⏳ | |
| C21 | Admin: Logs & support (Report an issue) | `src/admin/admin.js` | ✅ | 7 | ⏳ | |
| C31 | **Admin: resume tailoring review** | `src/admin/enhance-view.js` | ✅ | 6 | ⏳ | Requirements + evidence, before/after, blocked reasons, "add your real number", gaps, create |
| C22 | **Resume PDF writer** (one format): every resume gets an ATS-readable PDF; tailored ones on creation; kept in sync with typed text; Autofill uploads the one tailored for the job; Download / View PDF | `src/lib/pdf-writer.js` | ✅ | 29 | ⏳ | Replaces the old print view. Check the PDF on a real ATS upload (B9, E18) |
| C23 | Toolbar popup | `src/popup/*` | ✅ | 7 + 1 | ⏳ | UI tests: status, warnings, AI label, due link, Admin / report links, Analyze, error display |

### Not started (roadmap)
| ID | Component | Roadmap step | Built | Notes |
|---|---|---|---|---|
| C39 | **Repeatable entries** (work experience / education on any site except Workday) | `src/content/entries.js` | ✅ | 17 | ⏳ | Built against emulations (Greenhouse blocks, SmartRecruiters forms): verify on real sites |
| C40 | **Application hold across pages** (Apply → new tab → sign up / log in → form): job kept in the tab, same job recognised in another tab, 1 hour after last activity (alert when lost), offboarded once applied; **history retention** (default 30 days from the apply date, Admin setting) | `background.js` (`tabJob.*`, `applyClicked`, `pruneHistory`), `content.js`, `panel.js` | ✅ | 20 | ⏳ | Content scripts run only on the listed job sites: an application on an unlisted company domain isn't held |
| C38 | **Store packaging** (Chrome, Edge, Firefox, Safari) | `tools/package.py`, `tools/safari.sh`, `tools/store_assets.py`, `docs/store/` | ✅ | — | ⏳ | Submission needs your developer accounts (W21) |
| C37 | **Profile suggestions** (learned answers → profile) + shared field rules | `src/lib/profile-suggest.js`, `src/lib/field-rules.js`, `admin.js`, `popup.js` | ✅ | 19 | ⏳ | |
| C36 | **CI** (GitHub Actions: checks, CLI tests, browser tests) | — | ✅ | `.github/workflows/ci.yml`, `tests/check.sh`; status badge in README |
| C34 | GitHub issue form + acknowledgement Action | — | ✅ | `.github/`; live on the default branch |

### Job Finder (step 19: see [JOB-FINDER.md](JOB-FINDER.md))
| ID | Component | File(s) | Built | Tests | Browser | Notes / known gaps |
|---|---|---|---|---|---|---|
| C40 | **Job Radar core**: shared job shape, HTML/XML/RSS text parsing (no `DOMParser`), dates, salary, remote, quick filter, skip-seen, pruning | `src/lib/radar-core.js` | ✅ | 33 | ⏳ | Tasks J04–J08 |
| C41 | **Board adapters** (11): Greenhouse, Lever, Ashby · Workable, Recruitee, Breezy HR, SmartRecruiters, Rippling · Personio, Teamtailor, Workday | `src/lib/radar-boards.js`, `tests/fixtures/radar/` | ✅ | 22 | ⏳ | Tasks J11–J13, J27–J34 |
| C42 | **Board detection** from careers URL and page HTML | `src/lib/radar-detect.js` | ✅ | 19 | ⏳ | Tasks J10, J35 |
| C43 | **Scan engine**: lock, resumable queue, paging, detail calls, budgets, scoring, alerts | `src/lib/radar-scan.js`, `background.js` | ✅ | 27 | ⏳ | Tasks J14–J20 |
| C44 | **Job Radar UI**: Admin watchlist / settings / New jobs, popup count, panel "Watch this company" | `src/admin/radar-view.js`, `popup.*`, `panel.js` | ✅ | 16 | ⏳ | Tasks J21–J26, J36 |

**Test totals:** 14 + 49 + 33 + 7 + 11 + 17 + 28 + 5 + 102 + 26 + 11 + 28 (tracker flows 25 + end-to-end 3) + 21 + 77 + 10 + 7 + **54 + 26 + 6** (resume enhancement) + **20 + 13** (career tracks) + **29 + 21** (issue reporting) + **43** (the standard & conventions) + **26** (PDF) + **34 + 2** (Workday + rule fixes) + **29** (resume PDFs) + **63** (smarter matching) + **55** (site adapters) + **29** (built-in AI) + **19** (profile suggestions) + **17** (entries) + **31** (Admin screens & popup) + **5** (skills from resume) + **25** (tailoring limits) + **5** (skill years) + **18** (date formats, estimate on open) + **43** (resumes without bullets, section names, job lines, wrapped lines, tailored flow) + **22** (application hold, retention, skills case) + **24** (tailoring with Groq / Gemini, billing errors, retired models, which AI) + **21** (Claude, NVIDIA NIM, Mistral providers) + **4** (OpenRouter busy / weak free models, B26) + **5** (slow auto-picked models, test timeout, Gemini default and thinking level, B27) + **2** + **4** (model manager: fallback chain, cooldown, daily check) + **2** (server errors switch models, B28) + **3** (per-model quota, B29) + **2** (working model remembered, B30) + **88** (Job Radar: core, detection, 11 adapters, scan engine, background, Admin, popup, panel) + **26** (Job Radar per career track, eligibility, freshness) + **11** (built-in company directory) + **14** (title rule, remote country, unscored title-only jobs + backfill, track locations, re-check, Stop / Restart) + **5** (level words, stale lock, time cap, pages) + **7** (relevance: technical skills, data center phrase) + **5** (levels near your experience, management by track) + **5** (general vs leadership years) + **5** (busy AI: one-click other provider) + **3** (NVIDIA ranking, 410 Gone) + **26** (rebuilt AI path: streaming, reply reading, quirks, pace, setup check) + **5** (fixes from your first real check) + **10** (tailoring accuracy) + **11** (remote by country) + **12** (Job Radar related titles, skills rescue, skipped words) + **8** (new look: panel checklist, gap reasons, pill, grouped sidebar, save indicator, link fields) + **6** (screening questions) + **9** (race list, Job Radar Applied) + **1** (popup link check) + **2** (date line after bullets) = **1507**

---

## 2. Work items

| ID | Work item | Step | Owner | Status | Depends on |
|---|---|---|---|---|---|
| W16 | **Resume enhancement v2**: job-requirement analysis, verified evidence, targeted result-oriented edits, hard safety rules (never copy job numbers), review screen | 5 | Claude | ✅ Done | — |
| W17 | Try resume tailoring with a real free AI (Groq or Gemini; Admin → AI settings → AI for resume tailoring) on 2–3 real jobs and your real resume; judge quality | — | **You** | ⏳ Waiting on you | A free API key |
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
| W22 | **Job Finder design** (Job Radar): architecture, 11 boards, scan engine, data, permissions, errors, build plan ([JOB-FINDER.md](JOB-FINDER.md)) | 19 | Claude | ✅ Done (design only) | — |
| W23 | Decide the 6 Job Finder choices (task J01 in §2b) | 19 | Both | ✅ Done (recommended defaults, 2026-11-21; changeable in settings) | W22 |
| W24 | **Build Job Finder** (tasks J02–J37 in §2b) | 19 | Claude | ✅ Done on `feature/job-radar` | W23 |
| W26 | **More AI providers**: Anthropic Claude (paid, optional, own key), NVIDIA NIM and Mistral (free keys); "Tailoring model" field; pay-per-use note; AJP-AI-CREDIT / AJP-AI-REFUSED | — | Claude | ✅ Done (against faked APIs) | — |
| W27 | **Model manager**: models chosen and checked automatically (daily model-list check, fallback chain up to 3 models per call on retired / slow / busy, cooldowns, last working model remembered); Admin "Now using …" + optional Re-check | — | Claude | ✅ Done | — |
| W28 | **Cloud AI path rebuilt**: streaming, per-provider profiles, careful reply reading, real error reasons, **Check my AI setup** | — | Claude | ✅ Built; ⏳ needs your first real check | — |
| W26b | Try NVIDIA NIM and Mistral tailoring; optionally Claude with a little credit (D14–D17, test area T18) | — | **You** | ⏳ Waiting on you | W26 |
| W25 | Test Job Finder in the 4 browsers (task J38, test area T17 in §2a; TEST-SCENARIOS §M, Tester Guide Session 9) | 19 | **You** | ⏳ Waiting on you | W24 |

## 2a. Pending testing (your side)

Every area below still needs a hand check in a real browser. Scenario IDs are in [TEST-SCENARIOS.md §2](TEST-SCENARIOS.md);
the Tester Guide has the same checks as sessions. Set a browser cell to ✅ when that area passes there (or ❌ + a bug
ID in §4 when it fails), and fill **Tested on** with the date.

| ID | Area | Scenarios | Work item | Chrome | Firefox | Edge | Safari | Tested on | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T01 | Install & setup (unpacked; Firefox permissions; Safari converter) | A1–A5 | W10, W11 | ⏳ | ⏳ | ⏳ | ⏳ | | Safari needs the Xcode step |
| T02 | Store packages install and run | A9, A10 | W21 | ⏳ | ⏳ | ⏳ | ⏳ | | `python3 tools/package.py`, `sh tools/safari.sh` |
| T03 | Admin page: profile, skills, preferences, resumes (.docx/PDF), backup, dark mode, phone width | B1–B20 | W10, W11 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T04 | **Retest recent fixes**: B19 skill years from job dates next to company names ("Acme 06-2019 – 03-2021"); B18 no "0" badge on Learned answers | B6–B8, E24 | — | ⏳ | ⏳ | ⏳ | ⏳ | | B19 fixed in `88c2c14` + `e7c56ce`; B18 in `4623e08`. Also check skills added from the resume (`78aa515`) and the tailoring limits (`f9ffa30`, D11–D12) |
| T05 | Job page reading & match % on live sites (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Greenhouse, Lever, Ashby, Workday, SmartRecruiters) | C1–C16 | W12 | ⏳ | ⏳ | ⏳ | ⏳ | | Report any `AJP-JD-NONE` with the page |
| T06 | Resume tailoring with a real free AI (Groq or Gemini) on 2–3 real jobs | D1–D13 | W17 | ⏳ | ⏳ | ⏳ | ⏳ | | Judge truthfulness and wording |
| T07 | Autofill on real Greenhouse, Lever, Ashby, iCIMS applications | E1, E2, E20–E22 | W06b | ⏳ | ⏳ | ⏳ | ⏳ | | Report missed fields (site + label) |
| T08 | Autofill on real Workday applications | E3, E14–E16 | W03b | ⏳ | ⏳ | ⏳ | ⏳ | | Report missed fields (page + label) |
| T09 | Autofill: other sites, tailored-resume upload, learning, entries, safety | E4–E13, E18, E19, E24, E25 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T10 | Chrome built-in AI (desktop Chrome 138+) | A6–A8 | W07b | ⏳ | — | — | — | | Firefox/Safari: check the "not supported" message (A8) |
| T11 | Logging & support | F1–F10 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T12 | Privacy & safety | G1–G4 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T13 | Application tracker | I1–I17 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | I12 needs a day (or an edited record) |
| T14 | Career tracks | K1–K10 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T15 | Reporting problems on GitHub | L1–L8 | W20 | ⏳ | ⏳ | ⏳ | ⏳ | | Create the triage labels first (W20) |
| T16 | Performance | H1–H4 | W10 | ⏳ | ⏳ | ⏳ | ⏳ | | |
| T18 | **More AI providers**: NVIDIA NIM, Mistral (free); Claude (paid, optional) incl. Tailoring model, no-credit and wrong-key messages | D14–D17 | W26b | ⏳ | ⏳ | ⏳ | ⏳ | | Claude needs a few dollars of API credit at console.anthropic.com; skip if you don't want to pay |
| T17 | Job Finder: one company per wave, permission prompt, notification, "Watch this company", save to tracker, Safari CORS for Workday; tracks, eligibility, freshness, built-in directory, Stop / Restart, track locations | M1–M28 | W25 | ⏳ | ⏳ | ⏳ | ⏳ | | Ready: load the extension from the `feature/job-radar` branch |

## 2b. Job Finder build tasks (step 19)

Architecture: [JOB-FINDER.md](JOB-FINDER.md). Branch: `feature/job-radar` off `develop`. J02–J26 give a working Job Radar
for Greenhouse, Lever and Ashby; J27–J34 add the other 8 boards; J35–J39 finish and merge. Every board task starts by
capturing a live response from a real company board into `tests/fixtures/radar/`, which also confirms the endpoint.
Status: ⬜ not started · 🔨 in progress · ✅ done · ⏳ waiting on you · ⛔ blocked.

| ID | Phase | Task | Files | Depends on | Done when | Owner | Status |
|---|---|---|---|---|---|---|---|
| J01 | 0 Decide | Decide: approve the design; boards in the first release (all 11 in waves, or ship after wave A); scan interval (3 h); alert threshold (60%); per-scan vs daily digest; badge order | JOB-FINDER.md | — | All six answered here | Both | ✅ (recommended defaults: all 11 in waves, 3 h, 60%, daily summary, `!`→`✓`→blue→amber; JOB-FINDER §1) |
| J02 | 1 Foundation | Create `feature/job-radar` off `develop` | — | J01 | Branch pushed | Claude | ✅ |
| J03 | 1 Foundation | Test wiring: radar files + `radar-*.test.js` in `tests/run-tests.sh` and `tests/test-runner.html`; `tests/fixtures/radar/` | `tests/` | J02 | An empty radar suite runs in both runners | Claude | ✅ |
| J04 | 1 Foundation | Job shape + `normalize()` (key, defaults, length limits) | `radar-core.js` | J03 | Tests: defaults; keys unique per board/company/ID | Claude | ✅ |
| J05 | 1 Foundation | `decodeEntities`, `htmlToText`, `xmlItems`, `xmlValue(s)` without `DOMParser` | `radar-core.js` | J03 | Tests: double-encoded HTML, CDATA, namespaced tags; pass in JavaScriptCore | Claude | ✅ |
| J06 | 1 Foundation | `parseDate`, `salaryFromText`, `remoteFrom` | `radar-core.js` | J04 | Tests: every date style in JOB-FINDER §6.2; salary rejects; every remote flag | Claude | ✅ |
| J07 | 1 Foundation | `quickFilter` (titleFit + targetRoles fallback, location/remote, min salary), skip-seen, pruning | `radar-core.js` | J04 | Tests: pass/fail cases, General track, prune at 60/30 days and 500 jobs | Claude | ✅ |
| J08 | 1 Foundation | Storage: `radarSettings`, `radarWatchlist`, `radarJobs`, `radarSeen` (exported), `radarScanState` (internal) | `storage.js` | J04 | Export → import restores watchlist + seen; scan state not exported | Claude | ✅ |
| J09 | 1 Foundation | `RADAR_*` error codes + SUPPORT.md entries | `errors.js`, `docs/SUPPORT.md` | J03 | Convention test "every error code is documented" passes | Claude | ✅ |
| J10 | 1 Foundation | URL detection for the 11 boards (JOB-FINDER §9 table) | `radar-detect.js` | J03 | Tests: every pattern, Workday locale paths, Lever EU, Personio .com | Claude | ✅ |
| J11 | 2 Wave A | Greenhouse adapter | `radar-boards.js`, fixture | J04–J06 | Fixture → correct titles, locations, links, dates, plain-text description | Claude | ✅ |
| J12 | 2 Wave A | Lever adapter (+ EU host) | `radar-boards.js`, fixture | J04–J06 | Fixture parses; `salaryRange`, `workplaceType` mapped | Claude | ✅ |
| J13 | 2 Wave A | Ashby adapter (skip unlisted) | `radar-boards.js`, fixture | J04–J06 | Fixture parses; `isListed:false` skipped; compensation mapped | Claude | ✅ |
| J14 | 3 Engine | HTTP helper: timeout, JSON/text, status → `RADAR_*`, one retry on 429/5xx | `radar-scan.js` | J09 | Fake-fetch tests for 200, 404, 429, 500, timeout | Claude | ✅ |
| J15 | 3 Engine | List stage: lock, queue, paging caps, per-host pause, save per company, resume | `radar-scan.js` | J14, J11 | 3 companies scanned; a stop mid-scan resumes at the right company | Claude | ✅ |
| J16 | 3 Engine | Detail stage: 25 per company, 400 per scan | `radar-scan.js` | J15 | Budgets respected; over-budget jobs marked title-only | Claude | ✅ |
| J17 | 3 Engine | Score with `AJP.tracks.analyzeAll`; save jobs + seen; summary log line | `radar-scan.js` | J15, J07 | Sample job scores the same as on its job page; summary logged | Claude | ✅ |
| J18 | 3 Engine | Background wiring: `importScripts` + manifest `scripts`, `ajp-radar` alarm, `radar.*` handlers | `background.js`, `manifest.json` | J17 | Every message in JOB-FINDER §13 answers in a browser test; `tests/check.sh` passes | Claude | ✅ |
| J19 | 3 Engine | Badge order `!` → `✓` → new jobs (blue) → follow-ups (amber) | `background.js` | J18 | Each state shows when forced in a test | Claude | ✅ |
| J20 | 3 Engine | Notifications (per scan or digest), click opens the list, feature check | `background.js`, `manifest.json` | J18 | One notification per scan; no error where unsupported | Claude | ✅ |
| J21 | 4 Interface | `optional_host_permissions` per board; request on first company of a board | `manifest.json`, `radar-view.js` | J18 | Adding a Lever company asks for Lever only; refusing shows `AJP-RADAR-PERM` | Claude | ✅ |
| J22 | 4 Interface | Admin watchlist: add by URL with live job count, pause, remove, errors | `radar-view.js`, `admin.html`, `admin.js` | J21, J10 | Bad URL → "board not found"; good URL shows its job count before saving | Claude | ✅ |
| J23 | 4 Interface | Admin settings: on/off, interval, threshold, locations, remote, min salary, notify mode | `radar-view.js` | J18 | Changing the interval re-creates the alarm | Claude | ✅ |
| J24 | 4 Interface | Admin New jobs: sort by match, open, save to tracker, dismiss, "title match only" label | `radar-view.js` | J17 | Save creates a tracker entry; dismissed jobs never return | Claude | ✅ |
| J25 | 4 Interface | Popup: new-jobs count, top 5, See all | `popup.*` | J24 | Count matches the badge | Claude | ✅ |
| J26 | 4 Interface | Panel "Watch this company" (falls back to Admin when permission is missing) | `panel.js`, manifest content scripts | J10, J21 | One click on a Greenhouse posting adds the company | Claude | ✅ |
| J27 | 5 Wave B | Workable adapter | `radar-boards.js`, fixture | J18 | Fixture parses; `telecommuting` → remote | Claude | ✅ |
| J28 | 5 Wave B | Recruitee adapter | `radar-boards.js`, fixture | J18 | Non-ISO date + salary object handled | Claude | ✅ |
| J29 | 5 Wave B | Breezy HR adapter (no descriptions) | `radar-boards.js`, fixture | J18 | Jobs marked title-only; free-text salary parsed | Claude | ✅ |
| J30 | 5 Wave B | SmartRecruiters adapter: offset paging + detail | `radar-boards.js`, fixtures | J16 | Two-page fixture fully read; description from `jobAd.sections` | Claude | ✅ |
| J31 | 5 Wave B | Rippling adapter: page paging + detail | `radar-boards.js`, fixtures | J16 | Stops at `totalPages`; date + pay range from detail | Claude | ✅ |
| J32 | 6 Wave C | Personio adapter (XML; `.de` → `.com`) | `radar-boards.js`, fixture | J05, J18 | XML fixture parses; `.com` fallback saved | Claude | ✅ |
| J33 | 6 Wave C | Teamtailor adapter (RSS; custom domains) | `radar-boards.js`, `radar-detect.js`, fixture | J05, J21 | RSS fixture parses; custom domain asks for that domain only | Claude | ✅ |
| J34 | 6 Wave C | Workday adapter: POST, keyword search (≤3), `postedOn` text, detail | `radar-boards.js`, fixtures | J16 | Keyword cap respected; "Posted 30+ Days Ago" → ~30 days, `postedAtExact:false` | Claude | ✅ |
| J35 | 7 Finish | Careers-page detection from HTML (one-time site permission) | `radar-detect.js`, `radar-view.js` | J10, J21 | Saved careers pages embedding Greenhouse and Teamtailor are detected | Claude | ✅ |
| J36 | 7 Finish | Add a list of careers URLs (paste or .txt/.csv) | `radar-view.js`, `background.js` | J22 | Mixed list: supported lines added, others skipped with reasons | Claude | ✅ |
| J37 | 7 Finish | Docs: README, ARCHITECTURE (link + contexts), TEST-SCENARIOS section M, Tester Guide session, this tracker | `README.md`, `docs/` | J36 | Docs reviewed; T17 scenarios listed | Claude | ✅ |
| J38 | 7 Finish | Manual run in Chrome, Firefox, Edge, Safari: one company per wave (test area T17) | — | J34, J37 | T17 ✅ in all four browsers (Safari CORS + notifications checked) | **You** | ⬜ |
| J39 | 7 Finish | Merge `feature/job-radar` into `develop`; move step 19 to Done | — | J38 | All tests pass; merged | Claude | ⬜ |

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
| B23 | Tailored PDF had orphan words and half bullets: lines wrapped mid-sentence were kept as separate paragraphs, and a rewrite only replaced the first half of a wrapped bullet | Your tailored PDF | After step 18 | tailored resumes › wrapped lines… |
| B24 | A new skill was appended to the first skills group ("Cloud (AWS): …, Stakeholder management") | Your tailored PDF | After step 18 | resume engine › new skills go to their own "Additional skills:" line… |
| B25 | Requirements with verified evidence were shown as "Not in resume" | Your review screen | After step 18 | tailored resumes › verified evidence… |
| B26 | OpenRouter: after its default free model was retired, a weak "flash" free model was picked, and when that model was busy upstream the test failed with "free AI limit reached" (AJP-AI-429) | Your log | `8fafc85` | providers › OpenRouter free models |
| B27 | Gemini key without `gemini-2.5-flash`: the automatic replacement could pick a slow special model (deep research, robotics…), so Test connection and tailoring waited 90 s and failed with AJP-AI-TIME; Admin didn't show which model was used | Your report R-20261121-XX1QF (GitHub #1) | `af18130` | providers › Gemini model choice and timeouts |
| B28 | Gemini server errors (AJP-AI-5XX, "model overloaded") on `gemini-flash-latest` failed the test instead of moving to `gemini-3.6-flash`, which worked; the alias was also ranked above numbered models, and the same model was retried for ~27 s | Your screenshot (Recent AI calls) | `e3e2992` | providers › a server error on one model… |
| B29 | Gemini "free limit reached" (AJP-AI-429) on the newest model `gemini-3.8-flash` failed the test, although Gemini counts free limits per model and `gemini-3.6-flash` was available | Your screenshot (Recent AI calls) | `db5671d` | providers › one model out of free quota… |
| B31 | Job Radar settings: the Save button sat in a form, so a click (or Enter) would submit it and reload Admin | Automated tests (while building) | `0066e33` | admin screens › Job Radar › settings are saved |
| B33 | Job Radar showed 100% on title-only jobs (skills named in the title, e.g. "Machine Learning", matched); the job page said 54% | You | `f8bad11` | radar v3 › scores… |
| B34 | Title rule too loose: one shared word ("Engineer") let "Senior Software Engineer" through for "Data Engineer" | You | `f8bad11` | radar v3 › title rule… |
| B35 | Jobs already listed were never re-checked after preferences changed (e.g. "Publicity Coordinator" from a scan before tracks had titles) | You | `f8bad11` | radar v3 › preferences change… |
| B36 | Career-track locations were dropped on save (no field, and `tracks.normalize` discarded them) | You | `f8bad11` | radar v3 › career track locations |
| B37 | "Remote Canada" passed a US search; the area "Remote - US" matched on-site Austin jobs ("us" inside "austin") | You / tests | `f8bad11` | radar v3 › remote jobs limited… |
| B38 | "Scan stopped" but still "Scanning now": a scan killed by Chrome's ~5-minute background limit left its lock, and Stop couldn't reach it | You | `ceb7a46` | radar v3 › Stop clears a lock… |
| B39 | Level words counted in titles: "Senior DevOps Engineer" matched "Senior Data Engineer" (2 of 3 words) | You | `ceb7a46` | radar v3 › level words… |
| B40 | Non-IT jobs listed for Data Architect / Senior Data Engineer: "Data Center Power Generation … Engineer" (a facility job) and "Security Data Engineer" (physical security of sites) | You | `a039d1f` | radar relevance › the reported jobs |
| B41 | Tailoring held the panel ~3 minutes when Gemini was overloaded (503), then ended in a dead-end error although other AI keys were set up | You | `f6f853d` | providers › the tailoring AI is busy |
| B42 | NVIDIA test failed: the default model was retired (410), and the ranking knew only one current model, a huge one that timed out, so nothing was left to try | You | `bc06f86` | providers › NVIDIA ranking…, 410 Gone… |
| B43 | Cloud AI design gaps (audit): no streaming against Chrome's 30 s fetch limit, no output limit, cut-off / thinking-only / error-in-200 replies misread, same request for every provider, untested models tried during tailoring, provider reasons hidden | Your review | `e4f673d` | ai wire › … |
| B44 | Gemini reports a bad API key as HTTP 400, shown as a vague "request failed" | Live endpoint probe | `e4f673d` | ai wire › Gemini's real bad-key answer |
| B45 | First real setup check: a tiny model passed on valid JSON alone; slow thinking models cost 90–140 s; Groq's "Failed to generate JSON" wasn't retried; NVIDIA account id appeared in logs and copied results; the check took 7.5 min one provider at a time | Your check results | `0851375` | ai wire › quality gate…, account id… |
| B46 | First real tailored resume: "forecasting" counted as Budgeting; "data models" not counted as Data modeling; an edit removed EMR and Spark from a line; lines ending "against" / "PyTorch /" left orphan words in the PDF; a stored "was N%" didn't explain an unchanged score | You | `6fadcbd` | tailor accuracy › … |
| B47 | A remote job listed only in Europe showed a green location check for a US user: a bare "NJ" wasn't recognized as the US, and "nj" matched inside words like "enjoy" | You | `1946cff` | location fit › … |
| B48 | B47 was too strict: a remote job listing another country can still hire in the US, so it was wrongly hidden; jobs limited to certain states were not detected; filtered jobs could not be reviewed | You | `eb83766` | remote limits › …, filtered list › … |
| B49 | A Job Radar job on a company's own careers site (e.g. a Greenhouse job hosted on the company domain) opened with no assistant panel, because the extension only runs by itself on 12 job sites | You | `bf5f4e3` | company career sites › … |
| B50 | Free AI reliability audit: a stream that stopped halfway was accepted as the answer; a model that cut off, broke JSON or replied empty ended the job instead of trying the next; one busy moment benched a good model for 1 to 6 hours; a busy "Check my AI setup" erased verified models and hid that provider from Try with; Gemini daily quota was held 24 h instead of until its midnight Pacific reset; the OpenRouter check spent its shared daily cap on more models | Your test failures + audit | `6c24c6e` | ai resilience › … |
| B51 | Code review: a Groq tailoring request for a long resume and job could exceed the model's free per-minute token limit (8K for gpt-oss-120b) on its own and failed as "too large" without trying smaller output or another model; the Filtered list kept up to 500 full descriptions (about 9 MB rewritten after every company) | Code review | `253d35d` | ai resilience › per-minute token limits…, filtered list › a kept description is trimmed |
| B52 | "Autofill form" in the panel on a Greenhouse page failed with AJP-PAGE-ACCESS: before filling, the background re-injected its scripts, which needs broader access than running on a job site, and the browser refused, although the scripts were already on the page | You | `5ec2595` | autofill › the browser refuses re-injection |
| B53 | Live Greenhouse job boards (Coinbase form): Employment and Education were never filled. The section titles are plain paragraphs, not headings, and "Add another" sits outside the block with the title; month pickers got "01" instead of "January"; with no jobs saved, nothing said why | You | `87eb732` | entries › live Greenhouse layout… |
| B54 | Autofill took work history and education from Auto-apply details, typed by hand, instead of the resume being sent; you asked for them to come from the resume (the one tailored for the job, else the base resume) | You | `fee7700` | resume facts › …, entries › … jobs and schools come from the resume being sent |
| B55 | Real resume: the experience section titled "Career Profile" was not recognized, so no jobs were read; one-line roles ("Title | Company (Place) Mon Year – Mon Year") with a summary paragraph and sub-headings were not parsed reliably; a school not in Greenhouse's list was typed and then cleared | You | `ea7a18e` | resume facts › "Career profile"…, entries › … "Other" is picked |
| B56 | Greenhouse Education stayed empty: School, Degree and Discipline are lists searched on Greenhouse's server, which load after the menu opens and match whole phrases only ("B.Tech" and "Electronics and Communication Engineering" find nothing), and the school list's "Other" is named "0 - Other" | You | `0bfd794` | entries › … lists that load from the server…, … Greenhouse's "0 - Other" |
| B57 | Greenhouse: after a school was picked, Degree and Discipline stayed empty (the site redraws them as new elements, so autofill was filling boxes no longer on the page); the school name was also typed into a referral question about an "institutional client" ("institution" matched inside a longer word) | You | `7a935e4` | entries › Greenhouse redraws Degree and Discipline…, autofill › label → profile field rules › … institutional client |
| B58 | Live Coinbase / Greenhouse check (our code on the real form, made-up profile): a pick was reported as failed because the check looked inside the input's wrapper; hidden "required" twins of each dropdown were treated as fields; Degree and Discipline vanish for a moment when a school is picked and were skipped; server lists answered slower than the fixed waits | Live run | `95c3c8b` | entries › live Greenhouse layout… (fixture now has the wrapper, the hidden twins and the redraw gap) |
| B59 | Outside code review, checked and fixed: a new resume summary made other edits apply twice; a date line could join text from the previous section; "## Technical Expertise" inside Experience was a job line; learned checkbox answers never filled back; the panel allowed a second Autofill before the first ended; removing one Workday site removed the company's other sites' jobs; the directory position skipped companies after a budget stop; description backfill could run past the scan's time; long waits could let Chrome stop the scan; a job on several list pages kept one page's places; the tailoring review lost its scroll and "active resume" tick; a PDF could be regenerated for the wrong resume; restoring a key-less backup erased saved API keys; job links were not limited to http(s); a shortened prompt lost its closing tag; retried AI rounds were not counted for the per-minute budget; a JSON-LD address list was ignored | Code review | `3366370` | review fixes › … |
| B60 | Job Radar title search, from your question: titles were matched word for word, so Analytics Engineer, ETL Developer, Big Data Developer, DataOps or Databricks Engineer jobs were never looked at for a Data Engineer. Now: built-in related titles (all words must match), other titles kept only with a strong skill match (≤ 5 read per company), and title words to skip; required skills already counted more in the score | Your request | `7fe1edd` | radar titles › … |
| B61 | UI review, from your outside feedback: mixed emoji, flat surfaces, many accent colors; panel crowded (fit rows wrapping, "Best fit" tooltip over the duplicate warning, uneven buttons). Now: one line-icon set, grouped Admin sidebar, cards and one indigo accent, save indicator, link fields with open / copy, panel summary + fit checklist + clickable gap reasons + action hierarchy, minimized pill | Your request | `e6444d4` | panel › new look…, admin screens › new look |
| B62 | Live Coinbase application: screening dropdowns stayed empty (18+, previously employed by Coinbase, how did you hear, government official / relative, conflict of interest, referred by a senior leader). Now answered: 18+ Yes; previously employed from the companies named vs your work history; how you heard → job board (your earlier answer first); government / conflict No; all changeable in Auto-apply details → Screening questions. Legal acknowledgements and opinion questions are left for you | Live run | `1ceda6d` | screening › … |
| B63 | Your report and request: a Race question shown as round buttons under definitions that mention Hispanic was read as the Yes / No Hispanic question and left empty (now decided by the choices offered); Job Radar gets an Applied button, an Applied list, automatic moves when you apply elsewhere, and a flag on similar jobs you applied to | Your request | `9e147fc` | screening › EEO race list, radar applied › … |
| B64 | Follow-up to the outside review: the popup opened a Job Radar job by its saved link without the http(s) check that the visible link had (a job saved by an older version could hold any link). Now checked on click too; a flaky storage test moved to a key the background never writes during tests | Code review | `6a6aa91` | admin screens › toolbar popup › non-http(s) link |
| B65 | Follow-up to the outside review: in resume tailoring, a date line that starts the next job after bullets was joined to the previous job's header (edits named the wrong job); the docs said 38 error codes, errors.js has 49. Now: bullets end a job header; counts corrected and `tests/check.sh` fails when the counts or SUPPORT.md drift from errors.js | Code review | `0796572` | review fixes › resume tailoring › a date line after a job's bullets… |
| B32 | Workday careers sites named "Careers" were refused as a reserved word by board detection | Automated tests (while building) | `d149a52` | radar › careers URL detection |
| B30 | Every Gemini call started again at 3.8 → 3.7 → 3.6 (~40 s): Admin's Test buttons save Admin's own copy of the settings, which wiped the remembered working model; models outside the free tier were only skipped for an hour | You | `6d4723d` | providers › the model that worked goes first next time… |
| B22 | "CAREER PROFILE" (jobs) was read as a summary because of the word "profile", and job intros / sub-headings ("Architecture", "General Responsibilities") replaced the job a bullet belongs to | Your real resume | After step 18 | bullets › "CAREER PROFILE" with dated jobs… / each bullet belongs to its JOB line… |
| B21 | Tailoring still found no achievements when the Experience heading was unusual ("EXPERIENCE SUMMARY", "Career History"): jobs were read as part of the Summary | You (testing) | After step 18 | bullets › "EXPERIENCE SUMMARY" is the Experience section… |
| B20 | Tailoring failed with AJP-RES-STRUCT on Word resumes: Word bullets are list formatting, so the extracted text had no "-"; only a few bullet symbols were known | You (testing) | After step 18 | bullets › … |
| B19 | Job dates next to a company name ("Acme 06-2019 – 03-2021", "Umbrella 01/2020 to 06/2020", "Stark 2014–2014") were not read: any word was taken as a month name, and "06-2019" wasn't accepted in ranges, so skill years stayed empty | You (years not updating) | After step 18 | experience › date range in … |
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
