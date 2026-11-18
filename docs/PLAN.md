# Project plan: done vs. pending

Last updated: 2026-11-18 · Version 0.1.0 (+ test suite) · Branch `develop`

Legend: ✅ done · 🟡 partial · ⬜ pending

## 1. Platform & foundation
| Item | Status | Notes / where |
|---|---|---|
| One extension for Chrome, Edge, Firefox and Safari (Manifest V3) | ✅ | `manifest.json` |
| No build step, fast, framework-free | ✅ | `src/lib/*` |
| Local-only storage, no DB, in-memory cache | ✅ | `src/lib/storage.js` |
| Backup / restore / delete-all | ✅ | Admin → Backup |
| Loaded and verified in a real browser | ⬜ | **Next step**: Chrome first, then Firefox, Edge, Safari |
| Safari packaging (Xcode converter) | ⬜ | Steps documented in README; not yet run |
| Store packaging (Chrome Web Store, AMO, Edge, Safari) | ⬜ | |

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
| Text extraction from PDF | ⬜ | User must paste the text for now (needs pdf.js) |
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
| Years-of-experience & seniority check | ⬜ | |
| Smarter matching (synonyms / embeddings) | ⬜ | |
| Site selectors verified on live LinkedIn, Indeed, Glassdoor | ⬜ | These sites change often |

## 4. Resume enhancement
| Item | Status | Notes |
|---|---|---|
| AI tailoring for key gaps, without inventing skills | ✅ | Saved as a new resume version |
| Gap notes (covered / not covered + suggestions) | ✅ | |
| View / print / save as PDF, download .md | ✅ | |
| Generate a real PDF/DOCX file and attach the **tailored** resume | ⬜ | Autofill currently attaches the uploaded file |

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
| Workday custom dropdowns, date pickers, multi-step "My Experience" | ⬜ | High priority |
| Repeatable experience/education entries on forms | ⬜ | |
| Per-ATS adapters (Greenhouse, Lever, Ashby, iCIMS) | ⬜ | |
| Job-site accounts (username/password) | ⬜ | Plan: use the browser's password manager, not our storage |

## 6. Learning about the user
| Item | Status | Notes |
|---|---|---|
| Remember answers the user types and reuse them | ✅ | Exact + fuzzy question match |
| View / edit / delete learned answers | ✅ | Admin → Learned answers |
| Never learn passwords, SSNs, bank details, date of birth | ✅ | |
| Suggest profile updates from learned answers | ⬜ | |

## 7. AI (free)
| Item | Status | Notes |
|---|---|---|
| Gemini, Groq, OpenRouter (free tiers), Ollama (local) | ✅ | `src/lib/ai.js` |
| Test-connection button | ✅ | |
| Chrome built-in on-device AI (no key needed) | ⬜ | |
| Logging into free ChatGPT/Claude/Gemini chat websites | ❌ | Not planned: breaks their terms of service and is unreliable |

## 8. Logging & support
| Item | Status | Notes |
|---|---|---|
| Structured logs from every part (`[AJP][context][module]`) | ✅ | |
| Auto-redaction of keys, contact details and EEO data | ✅ | |
| View / filter / search / download / clear in Admin | ✅ | |
| Error capture (uncaught errors, failed AI calls) | ✅ | |

## 9. Quality
| Item | Status | Notes |
|---|---|---|
| Automated tests: 391 across 13 areas, incl. end-to-end and Admin UI | ✅ | `./tests/run-browser-tests.sh` (all 391) · `./tests/run-tests.sh` (the 216 that need no browser) |
| Sample job + application test page | ✅ | `tests/fixtures/sample-job.html` |
| Autofill, page reading, storage, AI, logging, background tests | ✅ | `tests/unit/` |
| Manual test checklist (real browsers & sites) | ✅ | `docs/TEST-SCENARIOS.md`, 85 scenarios, to be run by you later |
| CI on GitHub (run tests on every PR) | ⬜ | |

## 10. Multiple career tracks (new — requested 2026-11-18)

**Goal:** someone with experience in more than one direction, e.g. **AWS Cloud Architect** *and* **Java Architect**, can set up 2–3 *tracks*. Every job is then evaluated against each track, and they apply with the right resume for the track that fits best.

| Item | Status | Notes |
|---|---|---|
| Up to 3 career tracks in Admin. Each track has: name, target job titles, its own key skills, its own resume, salary range, and (optionally) its own areas and work types | ⬜ | Personal details, education, work authorization and EEO answers stay shared |
| Shared "core skills" that count for every track (e.g. Leadership, Agile) | ⬜ | Each track adds its own skills on top |
| Migration: the current profile becomes Track 1 automatically, so no data is lost | ⬜ | |
| On a job page, score the job against **every** track and show them side by side: match %, matching/gap skills and fit for each | ⬜ | e.g. "Cloud Architect 82% · Java Architect 45%" |
| Automatically pick the best track (match % + how close the job title is to the track's target titles), with a switch to change it | ⬜ | |
| Tailor resume, Autofill and AI draft answers use the **selected track's** resume and skills | ⬜ | |
| Applications record which track was used; Applications can be filtered by track | ⬜ | |
| **Track insights** in Admin: for each track, jobs evaluated, average match %, applications sent, and the **most frequent gaps** across the jobs looked at | ⬜ | Shows which skills to learn next for each direction |
| Evaluation history: keep the last 300 analyzed jobs (title, company, URL, score per track) so insights can be built and jobs re-opened | ⬜ | Local only, oldest dropped |
| Compare view: pick 2–3 saved jobs and see their scores across tracks side by side | ⬜ | Helps decide where to apply first |
| Tests for multi-track scoring, best-track choice, migration and insights | ⬜ | Added to the automated suite |

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
| Optional email status sync (Gmail/Outlook, read-only, opt-in) | ⬜ later | Ideas discussed; not planned yet |

## Suggested order for next work
1. ~~Push `develop` to GitHub.~~ ✅
1. ~~Full automated test suite.~~ ✅
1. ~~Application tracker (section 11).~~ ✅
1. Stronger support logging (session/action IDs, error codes, "Report an issue" bundle).
1. **Multiple career tracks** (section 10).
2. Load in Chrome and fix anything found (smoke test against the sample page plus 2–3 real job posts).
3. `feature/pdf-text`: read PDF resumes automatically.
4. `feature/workday-widgets`: Workday dropdowns and the experience step.
5. `feature/resume-export`: attach the tailored resume as a PDF.
6. Firefox / Edge / Safari verification.
7. CI + more tests.
