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
| Tests | ✅ 1481 automated + 171 manual scenarios · ✅ CI on every push |

**Code size:** about 13,100 lines of JavaScript in 42 files (plus HTML/CSS), plus 55 test files. No dependencies, no build step.

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
| **Limits**: only for close matches (default 70%+; below, the panel shows the biggest gaps instead), at most 6 reworded lines, skills only if you tick them, each placed in the job you choose (spread across jobs by default), resume match capped at your match + 15 | ✅ | Admin → AI settings → Tailoring limits; `AJP-TAILOR-LOW` |
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
| Applications that go through sign-up / login (new tab) | ✅ | The job is held in the tab and shown while you create your account / log in; Autofill turns on when the form appears |
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
| Error codes (`AJP-AI-429`, `AJP-JD-NONE`, …) with a message and a hint, shown in the panel, popup and Admin | ✅ | `src/lib/errors.js`, 38 codes |
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
| Automated tests: 1481 across 40+ areas, incl. end-to-end, Admin UI and convention checks | ✅ | `./tests/run-browser-tests.sh` (all 1481) · `./tests/run-tests.sh` (the 722 that need no browser) |
| Tester Guide (shareable doc, 8 sessions, 72 checks) + walkthrough videos (`video/build.py`) | ✅ | Updated with every feature step |
| Sample job + application test page | ✅ | `tests/fixtures/sample-job.html` |
| Autofill, page reading, storage, AI, logging, background tests | ✅ | `tests/unit/` |
| Manual test checklist (real browsers & sites) | ✅ | `docs/TEST-SCENARIOS.md`, 169 scenarios, to be run by you later |
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
| 19 | **Job Finder (Job Radar)**: watch company careers boards (11 job boards), score new jobs with the matcher, alert by badge / notification / New jobs list. [JOB-FINDER.md](JOB-FINDER.md); tasks in [TRACKER.md §2b](TRACKER.md). **Built on `feature/job-radar`; waiting on your browser pass (T17), then merge** | 🔨 | Large (8 phases) |

### 🧪 Your side (manual, when you're ready)
| Item | Notes |
|---|---|
| Load in Chrome and run the manual scenarios | `docs/TEST-SCENARIOS.md`, 128 scenarios |
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
| 2026-11-21 | `1946cff` | Fixed B47: remote jobs are judged by country, the same way on the job page and in Job Radar; state codes count as the US; places match whole words; 1370 tests |
| 2026-11-21 | `eb83766` | Fixed B48: open vs restricted remote (states and countries); Job Radar gets Matched and Filtered tabs, each paged, with the reason and Move to Matched; 1395 tests |
| 2026-11-22 | `bf5f4e3` | Fixed B49: opening a Job Radar job on a company site asks for that one site, then the assistant appears in its careers section; 1403 tests |
| 2026-11-23 | `6c24c6e` | Fixed B50: free AI recovers from partial answers and bad models, rests models briefly, respects real daily resets, and keeps verified models through busy periods; 1419 tests |
| 2026-11-24 | `253d35d` | Fixed B51 (code review): AI requests fit per-minute token limits and learn each model's real limit; Filtered keeps less text; 1423 tests |
| 2026-11-24 | `0145f87` | Optimizations from the code review: busy data and API keys moved to an extension-only database (no copy to every tab; pages can't read keys); job-site pages limited to the background actions they need; the full suite also runs on the database in CI; 1435 tests |
| 2026-11-24 | `5ec2595` | Fixed B52: Autofill from the panel no longer fails when the browser refuses extra script injection; 1437 tests |
| 2026-11-24 | `87eb732` | Fixed B53: Employment and Education on the live Greenhouse job boards are found, added with "Add another" and filled; 1441 tests |
| 2026-11-24 | `fee7700` | Fixed B54: autofill reads work history and education from the resume it sends (tailored, else base); Admin shows what it read; typing them is only a fallback; 1453 tests |
| 2026-11-24 | `ea7a18e` | Fixed B55: "Career Profile" and one-line roles are read from the resume; a school, degree or field missing from the site's list gets "Other" with a note; 1456 tests |
| 2026-11-24 | `0bfd794` | Fixed B56: Greenhouse education lists from the server: waits for them, searches the usual names and the school's own words, and uses "0 - Other"; 1457 tests |
| 2026-11-24 | `7a935e4` | Fixed B57: redrawn fields are found again by id; the School rule matches whole words only; 1459 tests |
| 2026-11-24 | `95c3c8b` | Fixed B58 after a live run on the Coinbase form: Country, months, School (0 - Other), Degree (Bachelor's) and Discipline all fill, 6 of 6 runs; server lists are waited on until they answer; 1459 tests |
| 2026-11-24 | `3366370` | Fixed B59 (outside code review, each finding checked): 17 logic, safety and data fixes, faster copies of stored data and resume scans, docs brought up to date; 1469 tests |
| 2026-11-24 | (pending) | B60 Job Radar title search: related titles, other titles kept for a strong skill match, title words to skip; 1481 tests |
| 2026-11-21 | `6fadcbd` | Fixed B46 from the first real tailored resume: two false skill gaps, edits may not remove a tool from a line, wrapped-line tails joined in the PDF, the panel compares with your original resume scored now and explains an unchanged score; 1359 tests |
| 2026-11-21 | `0851375` | Fixed B45 from the first real AI check: quality gate on the full-size step, small models last, no long retry for slow thinking models, Groq JSON failures retried, account ids masked, providers checked side by side; 1349 tests |
| 2026-11-21 | `e4f673d` (`feature/ai-rebuild`) | **Cloud AI path rebuilt**: streaming for every provider, per-provider profiles, careful reply reading (cut off, thinking, refusals, errors in 200), learned model quirks, free-tier pace, real error reasons, **Check my AI setup** with real calls and a sample resume, tailoring only on verified models; fixed B43, B44; 1344 tests |
| 2026-11-21 | `bc06f86` | Fixed B42: NVIDIA default moved to a current fast model; ranking prefers fast chat models and keeps fallbacks; 410 Gone replaces the model in the same call; saved shortlists rebuilt once; 1318 tests |
| 2026-11-21 | `f6f853d` | Fixed B41: a busy AI no longer holds tailoring for minutes (60 s per model, 75 s budget); the panel offers "Try with …" for your other keys, never switching providers by itself; 1315 tests |
| 2026-11-21 | `54915b0` | Job Radar: a JD's general years and its leading / managing years are read separately; leadership years never filter a job out; cards show both; 1310 tests |
| 2026-11-21 | `e902f9d` | Job Radar levels near your experience: with 8+ years Senior / Lead / Staff / Principal (no junior roles), years asked near yours, management titles only via a management track; "asks N+ yrs" on cards; 1305 tests |
| 2026-11-21 | `a039d1f` | Job Radar relevance (B40): a listed job must share at least 2 of your technical skills (soft skills don't count); "data center" / "data entry" aren't data work; listed jobs re-scored and re-checked once; 1300 tests |
| 2026-11-21 | `ceb7a46` | Job Radar: level words ignored in titles (B39); scans end after 4 min and resume, heartbeat lock, Stop clears a dead scan's lock (B38); 25 jobs per page; listed jobs re-checked once when rules change; 1293 tests |
| 2026-11-21 | `f8bad11` | **Job Radar accuracy + control**: career-track locations; Job preferences = defaults for all tracks; stricter title rule; remote jobs limited to other countries filtered; title-only jobs unscored + description backfill; "N of M skills" like the panel; list re-checked when preferences change, ■ Stop and Restart search; one card per job posted in several places; fixed B33–B37; 1288 tests |
| 2026-11-21 | `4ce1ba5` | **Job Radar built-in company directory**: 322 companies (Greenhouse, Lever, Ashby) checked live by `tools/build_radar_directory.py`, on by default, scanned a slice at a time (all about once a day) on allowed boards, quiet failures, 50 MB download budget; Greenhouse light lists with descriptions only for matching jobs; Hide company; 1274 tests |
| 2026-11-21 | `4b19a6d` | **Job Radar follows your career tracks** (up to 3: titles, then each track's places / work types); **eligibility** from the job text (no visa sponsorship, citizenship, clearance) against Auto-apply details (+ new "U.S. citizen?"): conflicts shown apart with the reason and never alerted; **freshness** labels (Posted today / This week) + Newest first sort; Allow all 11 boards in one prompt; 1263 tests |
| 2026-11-21 | `d149a52` … `259d3e8` (`feature/job-radar`) | **Job Radar (step 19)**: watch company careers boards on 11 job boards (Greenhouse, Lever, Ashby, Workable, Recruitee, Breezy HR, SmartRecruiters, Rippling, Personio, Teamtailor, Workday), each against a captured live response; resumable, polite scan engine (budgets, coded errors, retries, pause after 5 failures); scoring with the career tracks; Admin → Job Radar (new jobs, watchlist incl. careers pages and lists, settings), popup box, panel "Watch this company", notifications (daily summary / per scan), blue badge; per-board optional permissions; fixed B31, B32; 1237 tests |
| 2026-11-21 | `2ea688b` | Recent AI calls shows the models tried first in a call and why (e.g. "gemini-3.8-flash (out of free quota) → …") |
| 2026-11-21 | `6d4723d` | Fixed B30: the model that worked is remembered in the AI's own record (Admin's settings saves wiped it, so every call went 3.8 → 3.7 → 3.6); models that worked rank above untried newer ones; a model outside the free tier is skipped for a day; 1149 tests |
| 2026-11-21 | `db5671d` | Fixed B29: Gemini / Groq / NVIDIA count free limits per model, so one model out of quota (429, or Gemini "limit: 0") moves to the next model and is set aside until its quota resets (daily → 24 h); tailoring tries another model before waiting; 1147 tests |
| 2026-11-21 | `e3e2992` | Fixed B28: a server error / "overloaded" on one model moves to the next model (one retry first, not three); Gemini ranks numbered stable flash models above the `-latest` alias; 1144 tests |
| 2026-11-21 | `c1b277b` | **Model manager**: no manual model fixes. Daily model-list check per provider in use; each call falls back through up to 3 models when one is retired, deprecated, slow or busy; failing models cool down (24 h / 6 h / 1 h) then get another chance; the last working model is remembered; Admin shows "Now using …"; 1142 tests |
| 2026-11-21 | `01cfcd4` | Gemini asked to think less (Gemini 3+ / -latest `thinkingLevel: low`, 2.5 Flash budget 0): default high thinking made even "Say OK" take 30–90 s+ on the free tier (still AJP-AI-TIME after the model fix); a model rejecting the setting is retried without it; 1138 tests |
| 2026-11-21 | `1420fc4` | Gemini default moved to `gemini-3.6-flash` (Google deprecated 2.5-flash: 404 for newer keys, the 2 errors in AI Studio's chart); a replacement is the newest flash version; Admin model placeholders show the model actually in use; 1136 tests |
| 2026-11-21 | `af18130` | Fixed B27 (report R-20261121-XX1QF): model replacement never picks slow special models (deep research, robotics…); a slow auto-picked model is forgotten; Test connection gives up after 30 s and names the model; Admin shows auto-picked models with Reset; 1135 tests |
| 2026-11-21 | `8fafc85` | Fixed B26: OpenRouter picks capable free models (never small "flash" ones first, never paid), and a free model busy upstream is swapped for another free model instead of failing; 1130 tests |
| 2026-11-21 | `6c96c9a` | **More AI providers**: Anthropic Claude (paid, optional, bring your own key; default Opus 5.5, "Tailoring model" for Sonnet / Haiku; refusal and no-credit errors; server-side fallback), NVIDIA NIM and Mistral (free keys); model discovery for all three; backups blank every key; 1126 tests |
| 2026-11-20 | `d37a86a` | **Which AI did the work**: Recent AI calls in Admin (task, provider · model, time, result; no prompts); test buttons, panel (tailoring, deep analysis, drafted answers) and review screen name the provider · model; 1105 tests |
| 2026-11-20 | `f747ede` | Retired AI models replaced automatically: on "model not found" the provider's model list is read, a capable chat model picked and remembered (Groq, Gemini, OpenRouter); 1101 tests |
| 2026-11-20 | `a878f41` | AJP-AI-BILLING: a provider whose free tier isn't available for the account / project (Gemini "set up billing", "location not supported", "limit: 0") gets a clear message pointing to Groq; Admin advice corrected; 1097 tests |
| 2026-11-20 | `13bffd3` | **Tailoring with a free Groq or Gemini key**: a separate "AI for resume tailoring" (e.g. Chrome built-in for everyday tasks, Gemini/Groq for tailoring) + test button; free-tier rate limits waited out once (≤ 60 s, Retry-After or Groq's "try again in Ns"); 6–15 separate requirements asked, too few → asked again once; clickable key links; 1093 tests |
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
| 2026-11-19 | `43a707f` | **Application hold** across tabs and sign-up/login pages (1 h after last activity, alert when lost, offboarded when applied, same job recognised in a new tab); **history retention** 30 days default (applications from the apply date, job history, drafts, logs), Admin setting; 1079 tests |
| 2026-11-19 | `c391f3a` | Tailored flow: one tailored resume per job (replaced on re-tailoring), grouped in Admin; panel re-scores with it live and downloads it; file name has company + job title; review stays open with Download; skills ceiling is a warning (4 skills hard); wrapped lines joined (parser + PDF), PDF styles for plain-text resumes, "Additional skills:" line, evidence ⇒ not "not in resume"; B23–B25; 1059 tests |
| 2026-11-19 | `f1dce41` | Sections decided by content too (a "Career Profile" with dated jobs is Experience); bullets belong to the job line (title / company / dates), not sub-headings or intros; job labels without dates; fixed B22; 1044 tests |
| 2026-11-19 | `c741498` | Resume sections: "Experience Summary", "Career History", "Employment Details", ALL-CAPS headings with a section word; fixed B21; 1040 tests |
| 2026-11-19 | `b4614d3` | Resumes without bullets: Word list paragraphs read as "- ", more bullet symbols, achievement lines used without markers, Admin "Mark achievement lines as bullets"; fixed B20; 1032 tests |
| 2026-11-19 | `e7c56ce` | Job dates: "Till date" / "To date", "Jun-2019", "Jun’19", "Feb, 2019"; resumes without a recognisable Experience heading (dated lines anywhere, education skipped); 1016 tests |
| 2026-11-19 | `88c2c14` | Skill years filled when Admin / Skills opens (no click), status line with the number of dated jobs found; fixed B19 (job dates next to company names); 1008 tests |
| 2026-11-19 | `78aa515` | **Skill years and level from the resume's job dates** (only empty fields, marked as estimates); plain PDF headings understood by the date reader; 998 tests |
| 2026-11-19 | `f9ffa30` | **Tailoring limits**: close matches only (70%+), max 6 rewrites, confirmed skills placed per job (2 : 1 spread), resume match ≤ your match + 15; new `resume.addSkills`, `AJP-TAILOR-LOW`; 993 tests |
| 2026-11-18 | `4623e08` | **Skills added automatically from the resume** (upload, paste, edit, Read text from PDF); removed skills are not re-added; fixed B18 ("0" badge); 968 tests |
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

