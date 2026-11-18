# Project plan: done vs. pending

Last updated: 2026-11-18 · Version 0.1.0 · Branch `develop`

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
| Application tracking (in progress / applied / interview / offer / rejected) | ✅ | Admin → Applications |
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
| Matcher unit tests (11 passing) | ✅ | `./tests/run-tests.sh` |
| Sample job + application test page | ✅ | `tests/fixtures/sample-job.html` |
| Tests for the form filler and extractor | ⬜ | |
| CI on GitHub (run tests on every PR) | ⬜ | |

## Suggested order for next work
1. Push `develop` to GitHub.
2. Load in Chrome and fix anything found (smoke test against the sample page plus 2–3 real job posts).
3. `feature/pdf-text`: read PDF resumes automatically.
4. `feature/workday-widgets`: Workday dropdowns and the experience step.
5. `feature/resume-export`: attach the tailored resume as a PDF.
6. Firefox / Edge / Safari verification.
7. CI + more tests.
