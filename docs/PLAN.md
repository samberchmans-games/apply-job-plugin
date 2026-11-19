# Project plan: done vs. pending

Last updated: **2026-11-18** · Version **0.1.0** · Branch **`develop`** · Latest step: **9, Workday support**. Related documents:
- [TRACKER.md](TRACKER.md): **current status of every component**
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): tests
- [SUPPORT.md](SUPPORT.md): logs and error codes
- [ISSUE-REPORTING.md](ISSUE-REPORTING.md): how users report problems as GitHub issues, and how we fix them

Legend: ✅ done · 🟡 partial · ⬜ pending · ❌ decided not to do

## At a glance

| Area | Status |
|---|---|
| Platform (Chrome / Edge / Firefox / Safari, local-only storage) | ✅ built · ⬜ real-browser verification (your side) |
| Admin page | ✅ (incl. PDF resumes, one PDF per resume) |
| Job reading & match % | ✅ (incl. years, seniority, synonyms) |
| Resume tailoring (v2: evidence-checked, result-oriented) | ✅ incl. the tailored PDF attached by Autofill · ⏳ real-AI quality check (your side) |
| Autofill & learning | ✅ incl. Workday, Greenhouse, Lever, Ashby, iCIMS (verify on real sites) |
| Application tracker | ✅ complete |
| Logging & support | ✅ complete · one standard for errors, retries and failure capture across the plugin (enforced by tests) |
| Issue reporting to GitHub (option A) | ✅ complete (issue form, auto-acknowledgement, extension side) |
| Multiple career tracks | ✅ |
| Tester material | ✅ Tester Guide (8 sessions, 75 checks) + 7 walkthrough videos, updated every step |
| Tests | ✅ 963 automated + 122 manual scenarios · ✅ CI on every push |

**Code size:** about 4,600 lines of JavaScript in 22 files (plus HTML/CSS), plus 16 test files. No dependencies, no build step.

## How we work

- **Branches:** `develop` is the integration branch, and everything currently goes there. Larger features may use `feature/<name>` → PR → `develop`. `main` is kept for releases.
- **One step at a time:** Claude builds a step with its tests, pushes to `develop`, and reports. You review before the next step starts.
- **Status lives in [TRACKER.md](TRACKER.md)**, which is updated at the end of every step.
- **Errors, failure capture and retries follow THE STANDARD** ([ARCHITECTURE §9b](ARCHITECTURE.md#9b-the-standard-errors-failure-capture-and-retries-applies-to-every-change)): coded errors, `AJP.retry`, `AJP.http`, `AJP.guard`, no silent failures. Convention tests enforce it.
- **Definition of done for each step:**
  - tester material updated: a Tester Guide session and a walkthrough video part
  - new code follows THE STANDARD (the convention tests pass; new error codes are in SUPPORT.md)
  - code is in place
  - automated tests are added, and all of them pass (`./tests/run-tests.sh` + `./tests/run-browser-tests.sh`)
  - manual scenarios are added to TEST-SCENARIOS.md
  - this plan and ARCHITECTURE.md are updated
- **Bugs:** every fix comes with a test that fails without it.

## 1. Platform & foundation
| Item | Status | Notes / where |
|---|---|---|
| One extension for Chrome, Edge, Firefox and Safari (Manifest V3) | ✅ | `manifest.json` |
| No build step, fast, framework-free | ✅ | `src/lib/*` |
| Local-only storage, no DB, in-memory cache | ✅ | `src/lib/storage.js` |
| Backup / restore / delete-all | ✅ | Admin → Backup |
| Loaded and verified in a real browser | ⬜ | Your side, when ready: Chrome first, then Firefox, Edge, Safari |
| Safari packaging (Xcode converter) | ✅ | `tools/safari.sh`: converter + unsigned Debug build verified on this Mac; running it in Safari / App Store needs your Apple team |
| Store packaging (Chrome Web Store, AMO, Edge, Safari) | ✅ | `tools/package.py` (per-store manifests, verification), CI artifact + `web-ext lint`, `docs/store/` (listing, privacy policy, checklist, screenshots). Submitting = your side (accounts) |

## 2. Admin page (local)
| Item | Status | Notes |
|---|---|---|
| Profile (name, contact details, links, current role) | ✅ | |
| Key skills: add/remove, level, years, aliases (k8s → Kubernetes) | ✅ | |
| Detect skills from resume | ✅ | |
| Salary range, positions, suitable areas | ✅ | |
| Work type: remote / hybrid / on-site, relocation | ✅ | |
| Resume upload (.pdf/.docx/.txt/.md), multiple versions, active resume | ✅ | |
| Text extraction from .docx | ✅ | `src/lib/docx.js` |
| Text extraction from PDF | ✅ | pdf.js 4.10.38 (verified, loaded on demand); bullets → "- "; scanned → AJP-PDF-NOTEXT; step 8 |
| Auto-apply: education, experience, work authorization, sponsorship, notice period, start date | ✅ | |
| EEO: race, veteran, disability, gender, Hispanic, pronouns | ✅ | Never sent to AI; redacted from logs |
| Cover letter template | ✅ | |

## 3. Job reading & match %
| Item | Status | Notes |
|---|---|---|
| Read the job description (JSON-LD, site selectors, heuristic) | ✅ | `src/content/jd-extractor.js` |
| Right-click → analyze selected text | ✅ | Fallback for any site |
| Match % out of 100 (required > unlabeled > preferred) | ✅ | `src/lib/matcher.js` |
| Matching vs. missing skills shown side by side | ✅ | On-page panel |
| Work type / salary / location fit | ✅ | |
| AI deep analysis (extra skills, years required, summary) | ✅ | |
| Years-of-experience & seniority check | ✅ | Step 11; `experience.js`: overall + per-skill years, level from title; shown as fit rows (never changes the %) |
| Smarter matching: synonyms | ✅ | Step 11; implied skills (full credit), similar skills (half credit, "≈ you have X"), more aliases. Embeddings: not planned (no server, keep it offline) |
| Site selectors verified on live LinkedIn, Indeed, Glassdoor | ⬜ | These sites change often |

## 4. Resume enhancement — ✅ v2 done 2026-11-18 (step 5)
| Item | Status | Notes |
|---|---|---|
| Extract the job's key points: requirements with priority (must / should / nice), type, exact job wording, and keywords an applicant tracking system (ATS) scans for | ✅ | AI, strict JSON |
| Evidence for each requirement, quoted word for word from the resume; **fake quotes are dropped by code** | ✅ | Strong / partial / not in resume |
| Targeted edits only (summary, skills order, individual bullets); the AI never rewrites the whole resume | ✅ | Code assembles the final resume |
| **Never copy the job's numbers** ("10TB", "20+ APIs", "<5% defects"); keep the candidate's own numbers exactly, even if smaller | ✅ | Enforced by the validator, not just the prompt |
| **Result-oriented** bullets: action → what → result. Existing results kept and made prominent; otherwise impact described in words, and the user is asked for a real number | ✅ | "Add your real number" prompt |
| Block invented numbers (including spelled out), skills, tools, employers/clients/products, copied job sentences, placeholders, first person, overlong lines | ✅ | 54 rule tests |
| Protected lines (name, contact, employers, titles, dates, education) can never change | ✅ | Integrity check before saving |
| Review screen: requirements + evidence, before → after, why, blocked reasons, accept/reject, edit, gaps with honest advice | ✅ | Admin → Resumes |
| Coverage: % of requirements backed by the resume; job keywords before → after | ✅ | |
| Prompt hygiene: job and resume fenced as data; injected instructions ignored; one automatic retry on invalid JSON | ✅ | |
| Quality check with a real free AI on real jobs | ⏳ | Your side: needs a Groq or Gemini key (scenarios D1–D10) |
| One format: every resume has a PDF (uploaded PDF kept as is; Word/text/typed → PDF made from the text, kept in sync) · Download / View PDF | ✅ | Step 10; `src/lib/pdf-writer.js` (ATS-readable text, standard fonts) |
| Tailored resume gets its own PDF, named "<Name> - Resume - <Company>.pdf"; Autofill uploads the one tailored for *this* job | ✅ | Step 10 |

## 5. Apply / autofill
| Item | Status | Notes |
|---|---|---|
| Scan the apply page and fill fields from the profile | ✅ | `src/content/form-filler.js` |
| Selects, radios, yes/no, "decline to self-identify" | ✅ | |
| Attach resume file | ✅ | |
| Forms inside iframes (e.g. Greenhouse embeds) | ✅ | |
| Draft free-text answers with AI from the resume | ✅ | |
| Never auto-submit (user reviews) | ✅ | By design |
| Application tracking | ✅ | Full tracker — see section 11 |
| Workday custom dropdowns, date pickers, multi-step "My Experience" | ✅ | Step 9; `src/content/workday.js`; built against an emulation, to verify on real Workday |
| Repeatable experience/education entries on forms | ✅ | Workday (its adapter) + any other site (`entries.js`, step 17): Add another per item, dates in the site's format, your own entries kept |
| Per-ATS adapters (Greenhouse, Lever, Ashby, iCIMS) | ✅ | Step 12; `ats.js`: site field names, searchable dropdowns, location autocompletes, Yes/No buttons, hidden selects, Lever resume-first, iCIMS sign-in note. Built against emulations: verify on real sites |
| Job-site accounts (username/password) | ✅ by design | Not stored by the extension, ever: the browser's password manager handles logins; iCIMS-style sign-in pages get a note |

## 6. Learning about the user
| Item | Status | Notes |
|---|---|---|
| Remember answers the user types and reuse them | ✅ | Exact + fuzzy question match |
| View / edit / delete learned answers | ✅ | Admin → Learned answers |
| Never learn passwords, SSNs, bank details, date of birth | ✅ | |
| Suggest profile updates from learned answers | ✅ | Step 14; Admin → Learned answers box (Save / Dismiss / Save all), menu count, popup line; EEO never suggested |

## 7. AI (free)
| Item | Status | Notes |
|---|---|---|
| Gemini, Groq, OpenRouter (free tiers), Ollama (local) | ✅ | `src/lib/ai.js` |
| Test-connection button | ✅ | |
| Chrome built-in on-device AI (no key needed) | ✅ | Step 13; Prompt API (`LanguageModel`, older `ai.languageModel`), runs in the background; one-time model download from Admin (needs a click); prompts fitted to the on-device window; also works in Edge where the API exists |
| Logging into free ChatGPT/Claude/Gemini chat websites | ❌ | Not planned: breaks their terms of service and is unreliable |

## 8. Logging & support — ✅ upgraded 2026-11-18
| Item | Status | Notes |
|---|---|---|
| Structured logs from every part (`[AJP][context][module]`) | ✅ | |
| Session id per page or background run; trace id per user action, shared page → background → AI | ✅ | `AJP.startTrace`, `AJP.send(type, payload, trace)` |
| Error codes (`AJP-AI-429`, `AJP-JD-NONE`, …) with a message and a hint, shown in the panel, popup and Admin | ✅ | `src/lib/errors.js`, 23 codes |
| Timing for actions; slow steps logged as warnings | ✅ | |
| Flight recorder: debug details before an error are kept even at level "info" | ✅ | |
| Redaction by key **and** by value (emails, API keys, bearer tokens, phone numbers, SSNs) | ✅ | |
| Uncaught errors captured in Admin, popup and resume view | ✅ | |
| One-click **Report an issue**: description + environment + settings summary + data counts + health + error summary + logs, then a final scrub | ✅ | Admin → Logs & support; popup link |
| Logs view: error-code summary, click a trace id or code to filter | ✅ | |
| Support guide with the error-code table | ✅ | `docs/SUPPORT.md` |

## 9. Quality
| Item | Status | Notes |
|---|---|---|
| Automated tests: 963 across 30 areas, incl. end-to-end, Admin UI and convention checks | ✅ | `./tests/run-browser-tests.sh` (all 963) · `./tests/run-tests.sh` (the 498 that need no browser) |
| Tester Guide (shareable doc, 8 sessions, 72 checks) + walkthrough videos (`video/build.py`) | ✅ | Updated with every feature step |
| Sample job + application test page | ✅ | `tests/fixtures/sample-job.html` |
| Autofill, page reading, storage, AI, logging, background tests | ✅ | `tests/unit/` |
| Manual test checklist (real browsers & sites) | ✅ | `docs/TEST-SCENARIOS.md`, 122 scenarios, to be run by you later |
| CI on GitHub (run tests on every push / PR) | ✅ | Step 15; `.github/workflows/ci.yml`: checks, CLI tests (Node), full browser suite (headless Chrome) |

## 10. Multiple career tracks — ✅ done 2026-11-18 (step 6)

**Goal:** someone with experience in more than one direction, e.g. **AWS Cloud Architect** *and* **Java Architect**, can set up 2–3 *tracks*. Every job is then evaluated against each track, and they apply with the right resume for the track that fits best.

| Item | Status | Notes |
|---|---|---|
| Up to 3 career tracks in Admin. Each track has: name, target job titles, its own key skills, its own resume, salary range, and (optionally) its own areas and work types | ✅ | Personal details, education, work authorization and EEO answers stay shared |
| Shared "core skills" that count for every track (e.g. Leadership, Agile) | ✅ | Each track adds its own skills on top |
| Migration: the current profile becomes Track 1 automatically, so no data is lost | ✅ | Implemented as an implicit "General" track: nothing changes until you add tracks |
| On a job page, score the job against **every** track and show them side by side: match %, matching/gap skills and fit for each | ✅ | e.g. "Cloud Architect 82% · Java Architect 45%" |
| Automatically pick the best track (match % + how close the job title is to the track's target titles), with a switch to change it | ✅ | |
| Tailor resume, Autofill and AI draft answers use the **selected track's** resume and skills | ✅ | |
| Applications record which track was used; Applications can be filtered by track | ✅ | |
| **Track insights** in Admin: for each track, jobs evaluated, average match %, applications sent, and the **most frequent gaps** across the jobs looked at | ✅ | Shows which skills to learn next for each direction |
| Evaluation history: keep the last 300 analyzed jobs (title, company, URL, score per track) so insights can be built and jobs re-opened | ✅ | Local only, oldest dropped |
| Compare view: recent jobs and their scores across tracks side by side | ✅ | Admin → Career tracks, last 15 jobs |
| Tests for multi-track scoring, best-track choice, migration and insights | ✅ | Added to the automated suite |

How it works: [ARCHITECTURE.md §15](ARCHITECTURE.md#15-career-tracks).

## 11. Application tracker (no email needed) — ✅ done 2026-11-18
| Item | Status | Notes |
|---|---|---|
| Detect "applied" automatically: Submit on an application form + confirmation ("Thank you for applying", `/confirmation`, LinkedIn "application was sent") | ✅ | `src/content/apply-detector.js`. Asks "Did you submit?" if no confirmation within 30 s. Undo available. |
| Job context survives new tabs (LinkedIn → company Workday) and multi-page apply flows | ✅ | Per-tab job memory in the background |
| Same job recognized across URLs (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Glassdoor) | ✅ | `tracker.jobKey` |
| Job snapshot: description, salary, work type, location, resume used | ✅ | Kept even after the posting disappears |
| Pipeline board (drag & drop) + table view, search, status and "due" filters | ✅ | Admin → Applications |
| Details: notes, recruiter, interview date, next step, status history | ✅ | |
| Follow-up reminders: count on the toolbar icon + popup link; "I followed up" resets it | ✅ | Default 7 days, configurable |
| Stats: tracked, applied, per week (8 weeks), response rate, interview rate, avg match interviewed vs others | ✅ | |
| CSV export (Excel / Google Sheets), safe against formula injection | ✅ | |
| Duplicate warning on job pages ("You already tracked this job…") | ✅ | Same job or same company + similar title |
| Fix: Autofill no longer resets an "applied" job to "in progress" | ✅ | Automatic updates only move forward |
| Optional email status sync (Gmail/Outlook, read-only, opt-in) | ⏸ parked | Needs your decision + your Google/Microsoft OAuth app registration (and Google's verification for Gmail read scopes); conflicts with "no data leaves the computer" unless done fully client-side. Not built |

## 12. Issue reporting to GitHub (option A) — ✅ done 2026-11-18 (step 7)
Users report problems as GitHub issues. The extension pre-fills the form, and the user reviews and submits it from their own GitHub account. A GitHub Action acknowledges and labels each report. No server, and no token in the extension. Full spec: [ISSUE-REPORTING.md](ISSUE-REPORTING.md).

| Item | Status | Notes |
|---|---|---|
| Issue form (report id, codes, description, version, browser, environment, optional report file) | ✅ | `.github/ISSUE_TEMPLATE/bug_report.yml`, usable now from GitHub |
| Automatic acknowledgement comment + labels (`needs-triage`, `code:AJP-…`, `browser:…`) | ✅ | `.github/workflows/issue-ack.yml` |
| Maintainer workflow: triage within 3 business days, labels, failing test → fix → `Fixes #N` → `fixed-in:vX` | ✅ | ISSUE-REPORTING.md §7 |
| Extension: **Report on GitHub** button (pre-filled, summary only, no logs) | ✅ | Step 7 |
| Extension: "Similar reports" duplicate check before submitting | ✅ | Step 7 |
| Extension: crash prompt for unnoticed failures (ask, never auto-send) | ✅ | Step 7 |
| Extension: **My reports**, showing received #N, being fixed, or fixed in vX | ✅ | Step 7, via public GitHub search by report id |
| Reporters without GitHub: email the report to the organizer, who files it | ✅ | Process documented |
| 🧪 Simulate a problem (for testers) | ✅ | Admin → Logs & support |
| Option B (relay service, no GitHub account needed) | 💤 | Later, only if needed |

## Roadmap (updated 2026-11-18)

### ✅ Done
| # | Step | Commit |
|---|---|---|
| 1 | v0.1 foundation: extension, Admin page, match %, autofill, AI, logs | `cb1ac98` |
| 2 | Full automated test suite + manual test scenarios | `3609410` |
| 3 | Application tracker (section 11) | `15fbc3c` |
| 4 | Support logging: error codes, trace ids, Report an issue (section 8) | `ab79d58` |
| 5 | **Resume enhancement v2**: verified evidence, targeted result-oriented edits, safety validator, review screen (section 4) | `3022695` |
| 18 | **Admin & popup UI tests** (section 9) + 2 bug fixes | `1d59cc4` |
| 17 | **Work experience / education entries on any site** (section 5) + tester checks & video scene | `d3cbc4c` |
| 16 | **Store packaging** (Chrome, Edge, Firefox, Safari) + listing, privacy policy, screenshots | `3794ddc` |
| 14 | **Profile suggestions from learned answers** (section 6) + tester checks & video scene | `4561e39` |
| 15 | **CI on GitHub** (section 9) | `db02377` |
| 13 | **Chrome built-in AI** (section 7) + tester checks & video scene | `be4de6f` |
| 12 | **Greenhouse / Lever / Ashby / iCIMS adapters** (section 5) + emulations, tester checks & video scenes | `02b032c` |
| 11 | **Smarter matching** (section 3) + tester checks & video scene | `29a3e2a` |
| 10 | **One resume format (PDF)** (section 4) + tester checks & video scenes | `b7b2522` |
| 9 | **Workday support** (section 5) + tester checks, video scenes, Workday emulation | `fd1b226` |
| 8 | **PDF resumes** (section 2) + tester checks & video scene | `eacd1a3` |
| 7 | **Issue reporting, extension side** (section 12) + tester guide session & video | `845b501` |
| 6 | **Multiple career tracks** (section 10) + tester guide session & video | `2ace0d5` |

### ⬜ Next (built by Claude, one step at a time, reviewed by you)
| # | Step | Section | Size |
|---|---|---|---|

### 🧪 Your side (manual, when you're ready)
| Item | Notes |
|---|---|
| Load in Chrome and run the manual scenarios | `docs/TEST-SCENARIOS.md`, 122 scenarios |
| Try resume tailoring with a real free AI on 2–3 real jobs | Scenarios D1–D10; judge truthfulness and result-oriented wording |
| Firefox / Edge / Safari verification | Safari also needs the Xcode converter step (README) |
| Check job-page reading on live LinkedIn, Indeed, Glassdoor | These sites change often; report any `AJP-JD-NONE` |

### 💤 Later / not decided
| Item | Notes |
|---|---|
| Publish to browser stores (Chrome, Firefox, Edge, Safari) | After real-browser testing |
| Optional email status sync (Gmail/Outlook, read-only, opt-in) | Ideas discussed |

### ❌ Decided not to do
| Item | Why |
|---|---|
| Logging into free ChatGPT / Claude / Gemini chat websites | Breaks their terms, unreliable; free API keys instead |
| Storing job-site passwords | The browser's password manager handles this more safely |

## Risks & open questions

| Risk / question | Impact | Mitigation / next action |
|---|---|---|
| Not yet run in a real browser | Integration issues (permissions, Safari quirks) may appear | Your Chrome pass using TEST-SCENARIOS.md; Claude fixes what you find |
| Job sites change their HTML (LinkedIn, Indeed, Glassdoor) | The badge may not appear (`AJP-JD-NONE`) | JSON-LD and the heuristic are fallbacks; selectors are in one place (`jd-extractor.js` `SITES`); issue reports include the host |
| Workday markup differs between companies | Some Workday fields missed | Adapter built against an emulation with Workday's automation ids; selectors in one place (`workday.js` SEL); misses are reported; verify on real pages (W03b) |
| Free AI tiers have rate limits | `AJP-AI-429` during heavy use (tailoring makes 2 calls) | Clear message + hint; switching providers is one click; matching works without AI |
| Firefox requires manual site permission | Badge missing on Firefox until granted | Documented in the README; consider an in-Admin prompt |
| Detecting "applied" depends on confirmation wording | Some sites may be missed | "Did you submit?" prompt as a fallback; manual "Mark applied"; patterns tested |
| Publishing to stores | Store review needs a privacy policy and a description of permissions | Plan once real-browser testing is done |
| Free AI models may propose few valid edits | Fewer suggestions (blocked edits are shown with reasons) | Rules are enforced in code either way; try a larger free model; quality check W17 |

## Change log

| Date | Commit | Change |
|---|---|---|
| 2026-11-18 | `cb1ac98` | v0.1 foundation: MV3 extension, Admin page, matcher, job-page reading, autofill + learning, AI providers, logging |
| 2026-11-18 | `c6f67d8` | Plan document |
| 2026-11-18 | `3609410` | Automated test suite (279), manual scenarios; fixed a stale-cache race and "preferred" misdetection |
| 2026-11-18 | `8e6fb46` | Plan: multiple career tracks (section 10) |
| 2026-11-18 | `15fbc3c` | Application tracker (section 11); fixed the Autofill status downgrade, lost dialog edits, interview-date timezone |
| 2026-11-18 | `ab79d58` | Support logging: error codes, trace ids, flight recorder, Report an issue, SUPPORT.md |
| 2026-11-18 | `5d78eb1` | Consolidated roadmap |
| 2026-11-18 | `bb34324` | ARCHITECTURE.md rewritten as a full technical reference; plan refreshed |
| 2026-11-18 | `ab0c213` | TRACKER.md: component status tracker; per-suite test counts in the runner |
| 2026-11-18 | `dbf8a47` | Issue reporting option A: spec (ISSUE-REPORTING.md), GitHub issue form, auto-acknowledgement workflow |
| 2026-11-18 | `1d59cc4` | **Step 18: Admin & popup UI tests**; fixed B16 (resume rename lost), B17 (unknown Admin link); 963 tests |
| 2026-11-18 | `d3cbc4c` | **Step 17: work experience / education entries on any site** (entries.js); 932 tests |
| 2026-11-18 | `3794ddc` | **Step 16: store packaging**: per-store zips, Safari project build, CI package job, store listing / privacy policy / screenshots |
| 2026-11-18 | `4561e39` | **Step 14: profile suggestions from learned answers**; shared field rules; 915 tests |
| 2026-11-18 | `db02377` | **Step 15: CI on GitHub** (checks, CLI tests, browser tests on every push / PR) |
| 2026-11-18 | `be4de6f` | **Step 13: Chrome built-in AI** (on-device, no key), Admin download + status, prompt fitting, AJP-AI-LOCAL-* codes; 896 tests |
| 2026-11-18 | `02b032c` | **Step 12: Greenhouse / Lever / Ashby / iCIMS adapters**, generic dropdown widgets, B15 fix; 867 tests |
| 2026-11-18 | `29a3e2a` | **Step 11: smarter matching**: years (overall + per skill), seniority, implied/similar skills, B14 fix; 812 tests |
| 2026-11-18 | `b7b2522` | **Step 10: one resume format (PDF)**: PDF writer, tailored PDFs, Autofill uploads the job's tailored PDF, Download / View PDF; 749 tests |
| 2026-11-18 | `fd1b226` | **Step 9: Workday support** + rule-order fixes + Workday emulation + tester checks/video; 720 tests |
| 2026-11-18 | `eacd1a3` | **Step 8: PDF resumes** (pdf.js, Read text from PDF, AJP-PDF-* codes) + tester checks + videos re-rendered; 684 tests |
| 2026-11-18 | `3fb5ee3` | THE STANDARD for errors, failure capture and retries: AJP.retry / AJP.http / AJP.guard applied everywhere, convention tests; 658 tests |
| 2026-11-18 | `845b501` | **Step 7: issue reporting, extension side** + tester Session 8 + video Part 7; 615 tests |
| 2026-11-18 | `53f4881` | Tester walkthrough videos (5 parts) + Tester Guide doc |
| 2026-11-18 | `2ace0d5` | **Step 6: multiple career tracks** + tester Session 7 + video Part 6; 565 tests |
| 2026-11-18 | `3022695` | **Step 5: resume enhancement v2**: requirements + verified evidence, targeted result-oriented edits, hard rules (never copy job numbers), review screen; 3 new error codes; 532 tests |

