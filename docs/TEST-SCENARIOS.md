# Test scenarios

There are two layers of tests:

1. **Automated tests** (1481). Run them before every merge into `develop`. **CI** (GitHub Actions) runs all of them on every push and pull request.
2. **Manual scenarios** (below). Run these in real browsers on real job sites before a release.

## 1. Automated tests

| Command | What it runs | Time |
|---|---|---|
| `python3 tools/package.py --check` | Builds and verifies the four store packages (references, no test/doc files, per-store manifest rules) | ~2 s |
| `sh tests/check.sh` | Static checks: manifest valid, every referenced file exists, every script parses, no debug code | ~2 s |
| `./tests/run-tests.sh` | The **557** tests that need no browser: helpers, matcher, log redaction, AI output parsing, autofill rules. Uses Node, or macOS JavaScriptCore if Node isn't installed. | ~1 s |
| `./tests/run-browser-tests.sh` | All **1481** tests in headless Chrome. This is the full suite: the 722 above plus real forms, page reading, storage, background and end-to-end flows. | ~5 s |
| `DB=1 ./tests/run-browser-tests.sh` | The full suite again, with every test page acting as an extension page, so storage goes through the extension database as in the real extension (CI runs both) | |
| `./tests/run-browser-tests.sh autofill` | The same, but only tests whose name contains "autofill" | |
| Open `tests/test-runner.html` in any browser | The full browser suite, run visually. Works in Chrome, Edge, Firefox and Safari. For Safari, serve it first with `python3 tests/serve.py`. | |

The browser tests load the **real extension code** against an in-memory fake of the browser extension APIs (`tests/mocks/browser-mock.js`). Messages travel content script → background → content script exactly as they do in the extension.

### What the automated suite covers

| Area | File | Highlights |
|---|---|---|
| Core helpers | `unit/core.test.js` | Text normalization, deep merge, paths, one-at-a-time task queue, debounce |
| Matching | `unit/matcher.test.js` | Tricky skills (C++, C#, .NET, Node.js, CI/CD), no false matches ("go", "rest", "R&D"), aliases, Required / Preferred / "a plus" sections, salary parsing (incl. hourly), remote/hybrid/on-site detection, scores of 0%, 100% and none, required skills weighted above preferred, custom skills, AI-merged skills, speed on large job descriptions, work type / salary / location fit |
| Logging | `unit/logger.test.js` | Redaction of keys, tokens, passwords, email, phone, EEO answers and file data; long-string truncation; Error serialization; level filter; batching; a broken log store never crashes the app |
| Storage | `unit/storage.test.js` | Defaults, upgrading data saved by older versions, copies (not shared objects) returned, cache cleared on outside writes, **read/write race**, backup with and without API keys, restore, rejecting bad files, delete-all |
| AI | `unit/ai.test.js` | Request format for Gemini, Groq, OpenRouter and Ollama; Gemini key sent in a header, not the URL; errors for AI off / missing key / HTTP 429 / network failure / timeout; failures logged without the key; prompts forbid invented facts; **EEO data is never sent to the AI**; long inputs truncated |
| More AI providers | `unit/providers.test.js`, `unit/admin-screens.test.js` | Anthropic Claude (paid, optional): Messages API headers (key, version, browser access), default `claude-opus-5-5`, text blocks only, server-side fallback only on models that support it, JSON in the system prompt, refusal → `AJP-AI-REFUSED`, no credit → `AJP-AI-CREDIT` (no retry), wrong / missing key, retired model replaced from `/v1/models`, "Anthropic Claude · model" in Recent AI calls; Claude for tailoring only, with its own Tailoring model; NVIDIA NIM (JSON in the prompt, no `response_format`) and Mistral (JSON mode) request format, model discovery skipping non-chat models, rate limit; backups blank every key; logs mask `sk-ant-` / `nvapi-` keys; manifest hosts; model manager (next model on retired / deprecated 400 / slow / busy / server error / out of quota on one model (Gemini, Groq, NVIDIA), quota cooldown until reset, working model remembered across Admin saves and ranked first, up to 3 per call, cooldown and second chance, last working model remembered, daily shortlist refresh, empty list keeps the shortlist); OpenRouter: capable free models preferred over small ones, never a paid model, a model busy upstream → another free model once, your own daily limit → AJP-AI-429; Admin key fields, pay-per-use note, Tailoring model placeholder |
| Job Radar | `unit/radar.test.js`, `unit/radar-boards-bc.test.js`, `unit/radar-background.test.js`, `unit/admin-screens.test.js` | Entities / HTML / XML / RSS without DOMParser; every date style (ISO, ms, UTC text, RFC 822, Workday "Posted …"); salary from text (currencies, k, ranges, rejects); every remote flag; job shape + keys; quick filter (titles, General track, remote, locations, min salary); seen + pruning (60 / 30 days, 500 jobs); URL detection for all 11 boards + careers-page HTML; **all 11 adapters against captured live responses** (paging, details, merges, fallbacks, bad shapes → AJP-RADAR-FMT); scan engine with a fake network (filter, scoring = job page, skip-seen, interval, threshold, 404/429/500/timeout/network codes, one retry, pause after 5 failures, Lever EU / Personio .com fallback, lock + takeover, resume after a stop, request / page / detail budgets, Workday keyword searches); every radar.* message; permissions (per board, refused); notifications (per scan, daily summary, once each, click opens Job Radar); badge order; save → Applications; Admin (add, refuse, careers page, list, jobs, settings, menu count, prefill), popup box, panel "Watch this company"; per career track (titles, then the track's places / work types), eligibility from the job text (no sponsorship, sponsors, citizenship, clearance → blocked / check / ok against Auto-apply details), freshness and sorting, Workday keywords per track, blocked jobs out of alerts / badge / popup, Allow all boards; built-in directory (generated list valid, rotation per interval, skips own / hidden / not-allowed / failing companies, download budget, off switch, Greenhouse light list + details only for matches, hide / unhide, card) |
| Word resumes | `unit/docx.test.js` | Compressed and uncompressed .docx, special characters, invalid files |
| Autofill | `unit/form-filler.test.js` | 54 label→field rules; option matching incl. "decline to answer"; label detection (label tag, aria, Workday markup, placeholder, name); full form fill: text, select, radio, resume file, learned answers, free-text questions, unknown fields; **never fills password/hidden/disabled fields, never overwrites what the user typed, never submits**; React-style inputs; learning typed, select and radio answers; **never learns SSN or passwords**; ignores its own fills; respects the "learn answers" setting |
| Job page reading | `unit/jd-extractor.test.js` | Structured job data (JSON-LD, incl. @graph), Greenhouse, Lever, Workday, Indeed and LinkedIn layouts (on LinkedIn the job currently shown wins over stale data), fallback when a site changes its layout, fallback that ignores navigation and footer, no job description, look-alike domains |
| Panel | `unit/panel.test.js` | Score, skill chips, fit, **HTML from the job page cannot run inside the panel**, page CSS can't break it, buttons, busy state, autofill report |
| Tracker logic | `unit/tracker.test.js` | Same job across URLs for 8 sites; duplicate detection; saving rules (**automatic updates never move status backwards**, empty values never wipe data, Undo); confirmation and Submit wording incl. look-alikes that must NOT count; follow-up and interview reminders; stats; CSV escaping and formula-injection blocking |
| Tracker end-to-end | `unit/tracker-flow.test.js` | Submit + "Thank you" → applied with snapshot; normal form submit; confirmation-page URL; ignored on unknown sites; newsletter forms ignored; JD text mentioning submission ignored; "Did you submit?" Yes/No; auto-detect setting; job context passed to new tabs; tab cleanup; duplicate warning; reminder badge |
| Admin UI | `unit/admin.test.js` | Loads the real Admin page. Tracker: stats, board columns, drag & drop, search / due filters, table view, detail dialog saving (no lost edits, no timezone shift), "I followed up", HTML escaping, CSV export, empty state. Logs: error-code summary, click a trace id or code to filter, **Report an issue** download and copy summary, popup deep link, uncaught errors captured. Tailoring review: requirements and evidence, blocked edits with reasons (can't be ticked), the real-number prompt, escaping, rewriting a blocked line, accept/reject count, Create → new active resume with exactly the chosen changes |
| Support logging | `unit/errors-logging.test.js` | Every error code unique with a message and hint; HTTP status → code; value redaction (emails, Gemini/Groq/OpenRouter/OpenAI-style keys, bearer tokens, `?key=`, phone numbers, SSNs) without mangling dates, salaries or URLs; session ids; traces (start/done/slow/fail); flight recorder; **one trace id shared page → background → AI**; host-only sender logging; storage failure → `AJP-STORE`; error code and hint shown in the panel; issue report contents, **no personal data in the report**, log cap, summary text, dead-background detection |
| Resume rules engine | `unit/resume-engine.test.js` | Reading resumes (Markdown and plain text, roles, protected lines); **job numbers never copied** (10TB, 20+ APIs, <5%) while your own numbers are kept (2TB, 30%); invented numbers (including spelled out), skills, client names, copied job sentences, fake or missing evidence, protected targets all blocked; result-oriented warnings and the "add your real number" prompt; skills list rules; evidence and keyword coverage; final assembly + integrity check; strict prompts (rules, examples, data fencing, injection) |
| Resume tailoring end-to-end | `unit/enhance-flow.test.js` | Pipeline with a **fake AI that cheats** (copies job numbers, invents Kubernetes and Netflix, fakes evidence, edits the header, duplicates an edit): every attempt blocked, honest edits kept; JSON retry; error codes; creating the resume (original untouched, protected lines intact, user's real numbers accepted, blocked edits can't be forced, make active, resume-changed and missing-draft errors); panel summary and review link |
| Career tracks logic | `unit/tracks.test.js` | Implicit "General" track (no setup = existing profile), max 3, normalize; core + track skills; salary / work type / area overrides; the track's own resume; **every job scored against every track**; best track by score, job title breaks ties; title bonus never inflates the shown %; insights (evaluated, average, best-for, applied, interviews, top gaps); history (one entry per job, max 300); Track column in CSV |
| Career tracks end-to-end | `unit/tracks-flow.test.js` | Panel tabs with a % per track and ★ best; switching; job recorded per track; no tabs without tracks; **a new job resets a manual pick**; Mark applied / Autofill (resume file) / Tailor resume (resume + skills sent to AI) use the chosen track; "make active" sets the track's resume; Admin: insights, compare table, add/edit/max 3/delete, Applications filter by track |
| Problem reports (rules) | `unit/issue-report.test.js` | Pre-filled GitHub issue (template, title `[code] … (R-…)`, every field); **public text masks emails, phone numbers, keys and links; never logs**; crash code first; URL ≤ 7,500 chars with the report id kept; search URLs; status mapping (received / needs-info / fixing / fixed vX / duplicate / won't fix / closed / not submitted); crash-prompt rules (always for AJP-INTERNAL/STORE, 3× in 10 min, once a day, "don't ask again", setting off, **never for user-fixable codes**) |
| Problem reports (end-to-end) | `unit/issue-flow.test.js` | Panel crash prompt + "!" badge; Not now / Don't ask again / Report → Admin deep link; similar reports (incl. offline); report saved → received → fixed vX with ✓ badge until seen; final statuses not rechecked; max 5 lookups per run and every 10 min; offline = "couldn't check"; Admin: similar list then GitHub opens pre-filled, My reports rows, crash banner, Simulate a problem, deep link with code |
| Smarter matching | `unit/experience.test.js` | Years asked (7 phrasings, ranges, number words) and what to ignore (company history, ages, degrees, "past 10 years"); highest required ask wins; per-skill asks ("3+ years with Kafka", "4 years of Java experience", either-or); date formats; Experience-section roles only; overlapping jobs counted once; profile > work history > resume; years per skill incl. implied skills; seniority from 12 title styles, "Product Manager" not a level, fallback to years; fit rows (enough / close / short / unknown / stretch / below); implied skills (one-way), similar half credit, new aliases, **"Go" still not a word match**, score ignores years, **a crash in the check never breaks matching**, speed; B14 |
| Chrome built-in AI | `unit/local-ai.test.js` | Prompt fitting (instructions kept, long blocks shrunk proportionally); provider with a **fake Prompt API**: system prompt as the first prompt, session freed, **no network**, JSON via responseConstraint (and without it on older builds), older `ai.languageModel` shape, shrinking to the measured quota, QuotaExceeded → shorter retry → AJP-AI-LOCAL-LEN, downloadable/downloading/unavailable/no API/needs-a-click codes, timeout, logs without prompt text, **no EEO in prompts**, status, download progress, background message; Admin: provider listed, "Use it" banner, download with progress → Ready, unsupported browser, Test connection |
| Tailoring limits | `unit/tailoring-limits.test.js` | Limits + clamping; only the most important rewrites stay selected; jobs from the resume; default places (2 : 1, one job, 3+ jobs); simple wording; ceiling = your match + lift; prompt says "not a rewrite"; background refuses a low match **before any AI call**; setting respected; panel explains with the biggest gaps; skill options never pre-selected; skills go to the **chosen** job (AI line in the wrong job / invented number / AI down → simple wording); lines already rewritten not reused; unknown skills ignored, maxSkills and ceiling enforced; create: skill lines + Skills list, rewrites capped, protected lines intact; review: options, ceiling text, default spread + moving a skill, live meter, rewrite limit, add to draft |
| Admin screens & popup | `unit/admin-screens.test.js` | Navigation (+ unknown link → Profile), profile autosave and reload, skills (standard names, duplicates, level/years, remove, detect from resume, no-resume message), preferences (salary, work types, relocation, area chips), resumes (new, first is active, **rename + text both saved**, switch active, delete with confirm), auto-apply cards and answers incl. EEO, backup (export **without keys** by default / with keys, import, broken file → coded message, delete-all confirm), popup (status, warnings, AI label, due link, Admin / report links, Analyze, error display) |
| Repeatable entries | `unit/entries.test.js` (+ `fixtures/ats-mock.js`) | Dates into month select / year box / month input / MM/YYYY, "Present", year-only; **Greenhouse** blocks: Add another per item, searchable school/degree/discipline, years, company/title/month+year, current role (no end date), report, user's block kept and items placed after it, no items → nothing added, normal fields still fill; **SmartRecruiters** "+ Add" forms incl. month inputs, current, description, degree select; Add button broken → says how many; **never** a job post heading next to a form, Lever's "Current company", or Workday pages |
| Profile suggestions | `unit/profile-suggest.test.js` | Empty field → suggested; same value → nothing; different value only after twice; salary / years / yes-no normalised (ambiguous "150" skipped); **EEO, names, schools, cover letters never**; most used wins; dismissed per value; order; apply + unknown target error; Autofill and suggestions share the rules; Admin box + count, Save (and later edits don't undo it), Dismiss, Save all, empty state; popup line |
| PDF resumes | `unit/pdf.test.js` | Rebuilding lines from positioned text (order, spacing, paragraphs, 7 bullet glyphs → "- ", negative numbers kept, columns, uneven baselines); error mapping (locked → AJP-PDF-LOCKED, broken → AJP-RES-PARSE); **real pdf.js on generated PDFs** (resume, ready for tailoring, multi-page, scanned → AJP-PDF-NOTEXT, not-a-PDF, reader fails to load then recovers); Admin upload (text + file saved, bullet count message, scanned PDF message, "Read text from PDF" for older uploads) |
| The standard (errors / retries / conventions) | `unit/standard.test.js` | Temporary vs permanent codes; retry with backoff and Retry-After; `AJP.http` (JSON, 5xx retried, 4xx not, network, timeout, bad JSON, Retry-After); AI uses it (503 retried, 401 not); `AJP.guard` (coded log + trace, message shown, never throws); panel actions guarded; send/storage recover; **source scan**: no `throw new Error`, no raw fetch, error keys exist and are documented, no silent catch, no console, captureErrors on pages |
| Site adapters | `unit/ats.test.js` (+ `fixtures/ats-mock.js`) | Detection by host (look-alikes rejected) and by markup; site field names → profile values; location scoring; **Greenhouse** React-Select (yes/no, learned, EEO wording, async location search, user's choice kept, no menu left open, questions, learning from picks); **Greenhouse classic** select2 proxies, resume box left empty / pasted when no upload; **Lever** resume first then profile replaces the site's guesses (typed values kept), URLs, location from its list, radio cards, EEO selects, B15 labels; **Ashby** system fields, Yes/No buttons (profile, learned, user's choice kept, learning), comboboxes, EEO radios; **iCIMS** names, hidden dropdowns (TX → Texas, USA → United States), sign-in note; panel site + notes; widgets on unknown sites; one broken widget never stops the rest |
| Workday | `unit/workday.test.js` (+ `fixtures/workday-mock.js`) | Dates ("06/2019", "June 2019", "2019-06"…), Workday wording (TX → Texas, USA → United States of America, B.S. → Bachelor's Degree, decline → "I do not wish to answer"); detection (also on custom domains); against an **emulated Workday form**: text fields, pop-up dropdowns, search prompts with learned answers, unanswerable questions reported, user choices kept, no pop-up left open, **Save and Continue / Submit never clicked**, broken dropdown reported while the rest fills, learning from picked options; My Experience: one entry per job via Add, Month/Year dates, "currently work here", education prompts + degree; existing entries kept; EEO wording; multi-page "Autofill this page" in the panel |
| Resume PDFs | `unit/pdf-writer.test.js` | WinAnsi encoding (smart quotes, dashes, bullets; unsupported → "?" counted); wrapping by real Helvetica widths; resume structure; **valid PDF with exact xref offsets**; plain (uncompressed) text; escaping; multi-page; empty → AJP-PDF-CREATE; safe file names; **pdf.js reads our PDF back**; Autofill makes/uses a PDF (typed, old Word, own PDF kept); Admin Download / View, regenerate on edit, uploaded PDF never replaced, Word upload keeps the original. Plus: tailored resume gets its PDF (`enhance-flow`), Autofill uploads the one tailored for this job and the panel names it (`tracks-flow`) |
| Background + end-to-end | `unit/background.test.js` | Every message type; 20 simultaneous saves with no lost updates; application add/update; tailored resume saved as a new version (original untouched); log ring buffer (max 3,000 entries, max 200 per message); failed actions logged; **right-click → score**, **Autofill button → form filled → report → application tracked**, **Mark applied** |

### Adding a test

```js
// tests/unit/my-feature.test.js  (then add a <script> line in tests/test-runner.html)
(function () {
  const { describe, it, eq, ok } = globalThis.AJPTest;
  describe('my feature › thing', () => {
    it('does the thing', async () => { eq(1 + 1, 2); });
  }, { env: 'browser' }); // use env 'any' if it needs no DOM, so it also runs on the command line
})();
```

Rule: every bug fix comes with a test that fails without the fix.

---

## 2. Manual scenarios (real browsers)

Run these in Chrome first, then Edge, Firefox and Safari. Mark each one ✅ / ❌ with the browser version. If a scenario fails, use **Admin → Logs → Download logs** and attach the file to the issue.

### A. Install & setup
| ID | Steps | Expected |
|---|---|---|
| A1 | Load the extension unpacked (README → Install) | No errors on the extensions page. The Admin page opens automatically on the Profile section. |
| A2 | Click the toolbar icon | The popup shows skills, resumes and AI status, with a warning that the profile is incomplete |
| A3 | Firefox: allow the job-site permissions in the extension's Permissions tab | The badge appears on job sites after a page reload |
| A4 | Safari: convert with `safari-web-extension-converter`, build and enable it | Same as A1 and A2 |
| A6 | Desktop Chrome 138+: Admin → AI settings → Chrome built-in AI | Status Ready / needs download (⬇ button with progress) / can't run here, with the reason |
| A7 | After the download: Test connection, then AI deep analysis and Draft answer on a job page | "✅ Works"; AI results arrive without any key (note the speed) |
| A8 | Firefox or Safari: Chrome built-in AI | "This browser has no built-in AI"; choosing it anyway gives AJP-AI-LOCAL-NONE with a hint |
| A9 | `python3 tools/package.py`, then install each package: Chrome/Edge (unzip → Load unpacked), Firefox (about:debugging → Load Temporary Add-on → the zip) | Each loads without errors; badge, panel, Admin and Autofill work as with the source folder |
| A10 | `sh tools/safari.sh`, open the project in Xcode, Run, enable the extension in Safari | It appears in Safari → Settings → Extensions; Admin opens; the badge appears on a job site |
| A5 | Remove and reinstall the extension | All data is gone (expected). Restoring a backup brings it back. |

### B. Admin page
| ID | Steps | Expected |
|---|---|---|
| B1 | Fill in the profile, then reload the page | All values kept, and a "Saved" message appeared after each edit |
| B2 | Add the skills "k8s", "Kubernetes" and "reactjs" | Shows Kubernetes (the duplicate is rejected with "Already in your list") and React |
| B3 | Set a skill's level and years, remove a skill | Changes are kept after a reload |
| B4 | Add positions and areas (type, then press Enter), remove one | The chips update and are kept |
| B5 | Tick and untick the work types, set a salary range | Kept |
| B6 | Upload a .docx resume | The text appears in the editor and it becomes the active resume |
| B7 | Upload a PDF resume | The text is read automatically ("N bullet points read"), bullets start with "- "; the file is saved too |
| B19 | Upload a scanned (image-only) PDF | Saved, with a message: no selectable text (AJP-PDF-NOTEXT) and what to do |
| B20 | Select a PDF resume saved without text → 📄 Read text from PDF | The text is filled in |
| B8 | Click "Detect skills from my active resume" | The skills found in the resume are added to the skills list |
| B9 | Resume: rename it, make it active, 👁 View PDF, ⬇ Download PDF, delete it | Each action works. The PDF opens in a new tab and downloads as "<Your name> - Resume.pdf" |
| B13 | Upload a .docx resume, then look at the resume list | It shows "📎 <Name> - Resume.pdf (made from the text)"; Download PDF gives a clean one-column PDF |
| B14 | Edit the text of a typed/Word resume, wait 2 s, View PDF | The PDF shows the edit. An uploaded PDF is never replaced by edits |
| B15 | Open a downloaded PDF and copy its text (or upload it to a job site that parses resumes) | Text comes out in order, with bullets; name, sections and dates correct |
| B10 | Add two education entries and two experience entries, then remove one of each | Kept |
| B11 | Set the EEO answers | Kept. They don't appear in downloaded logs. |
| B12 | AI settings: choose Groq, enter a valid key, click Test connection | ✅ Works |
| B13 | Enter a wrong key, click Test | ❌ shows "HTTP 401" with a readable message |
| B14 | Choose Ollama while Ollama isn't running, click Test | ❌ shows a readable network error |
| B15 | Export a backup without keys, then delete all data, then import the backup | Everything comes back except the API keys |
| B16 | Import a random .json file | "Import failed: Not an Apply Job backup file" |
| B17 | Narrow the window to phone width | The layout stacks and nothing scrolls sideways |
| B18 | Use the browser in dark mode | The Admin page, popup and panel are all readable |

### C. Job page reading & match %
| ID | Steps | Expected |
|---|---|---|
| C1 | Open a LinkedIn job (`/jobs/view/...`) | A badge with the match % appears within about 2 s. Expanding it shows the right title and company. |
| C2 | On a LinkedIn job search page, click a different job in the list | The score updates for the new job without a reload |
| C3 | Indeed, Glassdoor, ZipRecruiter job pages | The badge appears with a sensible score |
| C4 | Greenhouse, Lever, Ashby, Workday, SmartRecruiters job pages | Same as C3 |
| C5 | A company careers page that isn't on the list → popup → Analyze | The panel opens with a score, or shows "Could not find a job description" |
| C6 | Select the job description text → right-click → "Apply Job: analyze selection" | The panel shows a score based only on the selected text |
| C7 | Compare the green and red skills with the job description | Matching skills are ones you have; gaps are skills mentioned that you don't have; nice-to-have gaps are shown in amber |
| C8 | Remote job vs. on-site job, with only Remote ticked | ✅ for remote, ⚠️ for on-site |
| C9 | A job listing a salary below your minimum | The salary row shows ⚠️ |
| C10 | AI deep analysis (with AI set up) | The summary appears and the score and gaps are recalculated |
| C11 | AI deep analysis with AI turned off | A clear error: "AI is turned off…" |
| C13 | A job asking "5+ years of experience" (fill Total years + Current title in Admin → Profile first) | Fit shows "Experience: 5+ yrs asked · you have N" with ✅ / 🟡 (one short) / ⚠️; company history ("founded 20 years ago") is ignored |
| C14 | A job asking "3+ years with <skill>" | A line under Experience with your years for that skill, from your dated jobs that mention it |
| C15 | A Senior, a Junior and a Director job | Level row: same level / a step up or down ✅; two or more apart ⚠️ |
| C16 | A job asking AWS while you only have Azure | Gap chip "AWS ≈ Azure", "(+1 similar)"; Next.js counts as React, PostgreSQL as SQL |
| C12 | Turn off "Show the match badge automatically" in Admin | No badge on job sites, but the popup's Analyze still works |
| C13 | Panel: drag it, minimize it, close it | Works. Closing removes it until the next Analyze. |
| C14 | Browser pages (`chrome://`, the Web Store, a PDF viewer) → popup → Analyze | A readable error: "This page cannot be accessed by extensions" |

### D. Resume tailoring (with a real free AI: Groq or Gemini)
Use your real resume, with one achievement per line starting with `-` or `•`, and 2–3 real job posts. One of the jobs should ask for specific numbers (e.g. "migrated 10TB", "20+ APIs", "under 5% defects").

| ID | Steps | Expected |
|---|---|---|
| D13 | Admin → AI settings: main provider Chrome built-in AI, **AI for resume tailoring** Gemini (or Groq) with its free key → **Test tailoring AI**, then tailor a job | "✅ Works (Google Gemini…)"; the review lists several separate requirements (not one broad one); with Groq a short pause and automatic retry is fine |
| D14 | AI settings: add a free **NVIDIA NIM** key (build.nvidia.com) → AI for resume tailoring = NVIDIA NIM → **Test tailoring AI**, then tailor a 70%+ job | "✅ Works (NVIDIA NIM · z-ai/glm-5.3-flash)"; the review lists several requirements; Recent AI calls shows NVIDIA NIM |
| D15 | Same with a free **Mistral** key (console.mistral.ai) | "✅ Works (Mistral · mistral-medium-latest)"; tailoring works; the Admin note about turning off training on your prompts is shown |
| D16 | (Optional, paid) Add an **Anthropic Claude** key with a few dollars of credit → AI for resume tailoring = Anthropic Claude | The 💳 "paid per use" note appears; Tailoring model placeholder `claude-opus-5-5`; Test tailoring AI → "✅ Works (Anthropic Claude · claude-opus-5-5)"; tailor a job; the review header says "tailored with Anthropic Claude · …"; the console.anthropic.com usage page shows the cost (cents) |
| D17 | Claude: type `claude-haiku-5-5` as Tailoring model and tailor again; then try a key with no credit (or a wrong key) | Recent AI calls shows `claude-haiku-5-5`; no credit → "no API credit left (AJP-AI-CREDIT)"; wrong key → AJP-AI-401; everyday tasks stay on your main provider throughout |
| D18 | OpenRouter with a free key → Test connection (try a few times across the day) | "✅ Works (OpenRouter · …)" with a capable free model (e.g. Llama 3.3 70B, gpt-oss-120b); when a free model is busy upstream it switches to another by itself; only your own daily limit shows AJP-AI-429 |
| D19 | Gemini: Test connection and Test tailoring AI (the default is now gemini-3.6-flash; Google deprecated 2.5-flash) | Either "✅ Works (Google Gemini · model)" or, within ~30 s, an error that names the model; AI settings says models are chosen automatically and shows "Now using …" (and anything set aside); no manual step is needed |
| D20 | Tailor while your AI is overloaded (AJP-AI-5XX), with another key saved | Within about 2 minutes the panel says it is busy and shows **Try with Groq** (etc.); nothing goes to another AI until you click; the click tailors this job only, and your saved AI stays the same |
| D21 | Admin → AI settings → **Check my AI setup** (real calls with each saved key, sample resume) | Each provider shows ✅ Ready with its model, or ❌ with the provider's exact reason; **Copy results** has no keys; **Use for tailoring** sets that provider |
| D22 | Tailor a job with a provider that shows Ready | The review opens; Recent AI calls shows that provider and a verified model; any failure shows the provider's own words and **Try with …** buttons |
| D23 | Run **Check my AI setup**, then tailor three different jobs with the provider that shows Ready. If a provider is busy, run the check again later | Tailoring completes, or moves to another verified model (see Recent AI calls). A busy provider shows **⏳ Busy now**, keeps its verified models and is still offered in **Try with** |
| D24 | After updating to this version: open Admin → AI settings, Logs, and Job Radar; tailor one job. Then open a job page | Your saved API keys, logs, Job Radar jobs, Filtered list and companies are all still there (moved once, automatically); tailoring works. The job page works as before |
| D25 | With 2+ jobs and schools in Admin → Auto-apply details, open a Greenhouse job-boards application (e.g. job-boards.greenhouse.io/embed/job_app?…) and click Autofill form | Each job gets its own Employment block (Add another is clicked for you): company, title, start/end month and year, Current role; each school gets an Education block. The panel lists what was filled and says "Resume attached" when it attached one |
| D26 | Admin → Auto-apply details, then autofill a Greenhouse application once with your base resume and once for a job you tailored a resume for | Admin lists the jobs and schools read from your base resume (title, company, place, dates; degree, field, school, years). The form gets the jobs and schools of the resume being sent; the panel says which resume they came from |
| D11 | Tailor on a job below 70% | The panel explains ("tailoring starts at 70%") and lists the biggest gaps; nothing is sent to the AI |
| D12 | Tailor a 70%+ job, tick 3 skills you have, keep the default jobs, then move one | 2 go to your current job and 1 to the previous by default; the moved one appears in the job you chose; the meter stops at your match + 15 |
| D1 | On a job page → panel → **📝 Tailor resume** | Within ~40 s: "N job requirements: x strong, y partial, z not in your resume · M suggested edits · keywords a% → b% · Review →" |
| D2 | Click **Review** | Admin → Resumes opens the review screen for this job |
| D3 | Check "What the job asks for" | The requirements make sense, with sensible must/should/nice; every evidence quote really is in your resume |
| D4 | Read every suggested change | **Nothing false**: no employer, title, date, degree, certification, tool or client you don't have |
| D5 | For the job that asks for specific numbers | None of the job's numbers (10TB, 20+, 5%…) appear in any ticked change. Any edit that tried is shown as **blocked**, with the number. |
| D6 | Lines where you already had a number | Your own number is kept exactly, even if smaller than the job asks |
| D7 | Lines without a number | Rewritten as action → impact in words; a 💡 asks for your real number. Type one (e.g. "saving ~6 hours a week") and the line becomes ticked. |
| D8 | Untick one change, edit another, tick "Make it my active resume" → **Create** | A new resume "Tailored — Company — Role" with exactly those changes; your original is unchanged; the new one is active |
| D9 | Open the new resume → View / save as PDF | Name, contact, roles, dates and education are identical to the original |
| D10 | Gaps section | Requirements you don't meet are listed with honest advice, and are **not** written into the resume |
| D11 | Edit your original resume, then click Create on an old draft | A clear message: "Your resume was edited after this draft was made (AJP-RES-CHANGED)" |
| D12 | Tailor resume with a resume that has no bullet points | "Could not find bullet points in your resume" with a how-to hint (AJP-RES-STRUCT) |
| D13 | Tailor resume with AI off, or with no resume | Clear messages (AJP-AI-OFF / AJP-RES-NONE) |

### E. Autofill & applying
| ID | Steps | Expected |
|---|---|---|
| E1 | Greenhouse application → Autofill form | Name, email, phone, LinkedIn and location filled (green outline); resume attached; work authorization and sponsorship answered |
| E2 | Lever application | Same as E1. The resume is attached first; Lever's guesses are replaced by your profile and the panel says so; location picked from Lever's list |
| E20 | Greenhouse searchable dropdowns and EEO | Work authorization, sponsorship, EEO answers and "Location (City)" picked from their lists; the panel heading says "Autofill · Greenhouse" |
| E21 | Ashby application | Yes/No buttons answered; location picked; resume attached |
| E22 | iCIMS application (sign-in page, then the form) | Sign-in page: a note to sign in yourself, password untouched. Form: name, address, State/Country dropdowns (TX → Texas) |
| E23 | Local emulations (`python3 tests/serve.py` → `/tests/fixtures/ats-sample.html`, switch sites at the top) | Same as E1, E2, E20–E22 |
| E3 | Workday application, My Information | Text fields, dropdowns (country, state, phone type, yes/no) and search boxes filled; nothing submitted |
| E14 | Workday: Save and Continue | The panel offers "⚡ Autofill this page" for the next page |
| E15 | Workday: My Experience → Autofill this page | One entry per job is added and filled (title, company, Month/Year dates, current job, description); education too |
| E16 | Workday: Voluntary Disclosures → Autofill this page | EEO answers in Workday's wording; Submit not clicked |
| E17 | Local Workday emulation (`python3 tests/serve.py` → `/tests/fixtures/workday-sample.html`) | Same as E3, E14–E16 |
| E18 | Tailor the resume for a job (D-scenarios) → Create, then Autofill **that** job's application | The file attached is "<Name> - Resume - <Company>.pdf"; the panel shows "📎 Resume attached: …" |
| E19 | Autofill a different job you did not tailor for | Your track's / active resume PDF is attached instead |
| E4 | SmartRecruiters and other applications | Text fields, native and searchable dropdowns filled |
| E5 | EEO section | Matches your Admin answers. "Decline to self-identify" maps to the site's wording. |
| E6 | A field you'd already typed into before clicking Autofill | Left unchanged |
| E7 | A "Why do you want to work here?" box → Draft answer with AI | Text inserted into that box; it's specific and uses only facts from your resume |
| E8 | Type answers into unknown questions, then open another application with the same question → Autofill | Filled from learned answers (purple outline). Admin → Learned answers shows it. |
| E24 | Type the same notice period / GitHub link into two forms (empty in Admin), then open Admin → Learned answers | 💡 box with the suggestion, count in the menu, popup line; Save to profile fills Profile / Auto-apply; Dismiss keeps it away; EEO answers never suggested |
| E25 | An application with Employment and Education sections with "Add another" (Greenhouse, SmartRecruiters, company sites) → Autofill | One block per job / school added and filled (dates, current job, degree); a block you filled yourself is kept |
| E26 | Apply from a job page → new tab → sign up / log in → form | The panel holds the job on the sign-up / login pages (Autofill off), turns Autofill on at the form, uploads the job's tailored resume; same job opened in another tab is recognised; after applying the hold ends; after 1 h idle a closable "tracking lost" alert |
| E27 | Admin → Backup & privacy → history period | Default 30 days; applications applied more than that many days ago, job history and logs are removed; within the period the duplicate warning and the saved job description work; 0 keeps everything |
| E9 | Type into a password or SSN field | It does **not** appear in Learned answers |
| E10 | After Autofill, check the page | **Nothing was submitted.** The panel says "Review everything, then submit yourself". |
| E11 | Click Mark applied | Admin → Applications shows the job with status "applied" and its score |
| E12 | Change the status in Admin → Applications, or delete the entry | Kept |
| E13 | An application form inside an iframe (a company site embedding Greenhouse) | Fields inside the iframe are filled |

### F. Logging & support
| ID | Steps | Expected |
|---|---|---|
| F1 | Do C1, then E1, then open Admin → Logs & support | Entries from `content`, `bg` and `admin`, each with a session id; panel actions have trace ids (`t…`) |
| F2 | Use a wrong AI key, then click AI deep analysis | The panel shows "The AI provider rejected the API key", a hint, and **(AJP-AI-401)**. The logs show the same code under one trace id from the content script, background and AI. No key appears anywhere. |
| F3 | Click a trace id in the logs | Only the entries for that one action are shown |
| F4 | Click an error-code chip in "Errors in stored logs" | The view filters to that code |
| F5 | Report an issue → type a description → Download report | `apply-job-report-R-….json` contains the description, browser, version, settings summary, counts, health and logs. Search it for your email, phone, name, API key and resume text: none should be found. |
| F6 | Report an issue → Copy summary | A short text with the report id, version, browser and error codes is copied |
| F7 | Toolbar popup → Report a problem | The Admin page opens with the report dialog already open |
| F8 | Set the log level to warn, cause an error (e.g. AI off → AI deep analysis) | The error entry is preceded by "(context before error)" detail entries |
| F9 | Open the browser console on a job page | Entries prefixed `[AJP][content][…]`, with `[AJP-…]` codes on errors |
| F10 | Filter by level / search / Clear | Works |

### G. Privacy & safety
| ID | Steps | Expected |
|---|---|---|
| G1 | With AI on, run C10, D1 and E7 and watch the Network tab | Requests go only to the chosen AI provider. No EEO data appears in the request bodies. |
| G2 | With AI off, use the extension normally | No network requests from the extension |
| G3 | Search the storage for passwords (DevTools → Application → Extension storage) | No job-site passwords stored |
| G4 | A job page whose title contains HTML, e.g. `<img onerror=…>` | Shown as plain text in the panel; nothing runs |

### I. Application tracker
| ID | Steps | Expected |
|---|---|---|
| I1 | Greenhouse: open a job → Autofill → submit the application | The panel says "Application … detected and saved as applied", with Undo. Admin → Applications shows it under Applied, marked **auto**. |
| I2 | Lever and Ashby: the same as I1 | Same |
| I3 | LinkedIn Easy Apply: submit | Detected from "Your application was sent" |
| I4 | LinkedIn job → **Apply** (opens the company Workday in a new tab) → finish the application | The job is saved with the **LinkedIn** title and company, not the Workday page's |
| I5 | Submit on a site that shows no confirmation | After about 30 s the panel asks "Did you submit your application…?". Yes → saved; No → nothing saved. |
| I6 | Subscribe to a newsletter on a careers site | Nothing is tracked |
| I7 | Click Undo right after a detection | It goes back to its previous status, or is removed if it was just added |
| I8 | Open a job you already applied to (same link, or the same job from another site) | A ⚠ "You already tracked this job…" banner appears in the panel |
| I9 | Admin → Applications: drag a card to Interviewing | It moves; the status history shows the change |
| I10 | Open a card: add notes, recruiter, interview date and next step; close and reopen | Everything is saved; the interview date shows exactly as you typed it |
| I11 | "Saved job description" in a card | The full posting text is there, even after the job is taken down |
| I12 | Set the follow-up days to 1 and wait a day (or edit a test record) | The toolbar icon shows a count, the popup shows "🔔 1 follow-up due", and the link opens the filtered list |
| I13 | "I followed up today" | The reminder clears |
| I14 | Export CSV and open it in Excel / Google Sheets | Columns line up; accents and commas are intact; nothing runs as a formula |
| I15 | Turn off "Detect submitted applications automatically" | No automatic detection; Mark applied still works |
| I16 | Stats tiles after 5+ applications with a few status changes | The numbers match the board (response rate = replies ÷ applied) |
| I17 | Click Autofill on a job that's already Applied | It stays Applied (this was a bug before) |

### K. Career tracks
| ID | Steps | Expected |
|---|---|---|
| K1 | Admin → Career tracks → add "AWS Cloud Architect" and "Java Architect" with titles and skills; reload | Kept |
| K2 | Add a third track, try a fourth; delete one | Button shows "Maximum 3 tracks"; delete works |
| K3 | Open a cloud job post | A tab per track with a %; the cloud track is ★ and selected |
| K4 | Open a Java job post (same tab, e.g. the next LinkedIn job) | The Java track is ★ and selected; an earlier manual pick doesn't carry over |
| K5 | Switch tracks in the panel | Score, chips and fit change |
| K6 | Tailor resume on a track | Draft shows the track; tailoring uses that track's resume and skills; "Use it as the … track's resume" sets the track's resume |
| K7 | Autofill on a track with its own resume file | That file is attached |
| K8 | Mark applied | The application shows the track; Applications filter by track works; CSV has a Track column |
| K9 | After 3+ jobs: Career tracks | Insights per track (evaluated, average, best-for, applied, interviews, top gaps); compare table with ★ |
| K10 | Delete all tracks | Panel shows a single score; everything works as before |

### L. Reporting problems on GitHub
| ID | Steps | Expected |
|---|---|---|
| L1 | Report an issue → Report on GitHub | GitHub opens with title `[code] … (R-…)` and every form field filled; no logs, emails or URLs in it |
| L2 | Submit the issue | Within about a minute, a "Thanks, received R-…" comment and the labels `bug`, `from-extension`, `needs-triage` and `code:…` appear |
| L3 | Admin → My reports → Check status | It shows "Received #N" |
| L4 | Maintainer closes it with `fixed-in:v0.2.0` | My reports shows "Fixed in v0.2.0"; the toolbar badge shows ✓ until Admin is opened |
| L5 | Logs & support → 🧪 Simulate a problem (or a real `AJP-INTERNAL` error) | The prompt or banner appears once, and the toolbar shows !; Report opens the dialog pre-filled; Not now hides it for the day |
| L6 | Report the same error code twice | "Similar open reports" lists the first issue |
| L7 | Go offline → Report on GitHub | It still opens GitHub; similar reports and status show "couldn't check" |
| L8 | Untick "Ask me to report problems…" | No prompts |

### M. Job Radar (one company per board wave, in each browser)
Use real companies whose careers pages run on these boards (for example a Greenhouse, a Lever and an Ashby company for wave A; one Workable / Recruitee / SmartRecruiters / Rippling company for wave B; one Personio / Teamtailor / Workday company for wave C). Your Profile should have target roles (or career tracks with target titles) so jobs are filtered and scored.

| ID | Steps | Expected |
|---|---|---|
| M1 | Admin → Job Radar → paste a Greenhouse careers link → **Add** | The browser asks for **Greenhouse only**; after Allow: "Watching <Company> (Greenhouse): N open jobs today"; it appears in the watchlist |
| M2 | Same with a Lever and an Ashby company | Each asks for its own board only; each is listed with its open-job count |
| M3 | Click **Scan now** | Within a minute: "Checked N companies: X new jobs"; New jobs lists them, highest match first, with company, location, work type, salary (when given) and posted date |
| M4 | Open a job from the list | Its posting opens; the panel's match % is the same as in the list |
| M5 | **Save to Applications** on one, **Dismiss** on another, Scan now again | The saved one is in Applications (with its description); the dismissed one never comes back |
| M6 | Wave B and C companies (one each: Workable, Recruitee, SmartRecruiters, Rippling, Personio, Teamtailor, Workday) | Each is added and scanned; SmartRecruiters / Rippling / Workday jobs get descriptions (no "title match only" label on the matches); Breezy HR jobs show "title match only" |
| M7 | Paste a company's **own careers page** (e.g. company.com/careers) that embeds a Greenhouse or Teamtailor board | The browser asks for that site; then "Found its <Board> job board … Allow and add"; after that click it is watched |
| M8 | Paste a LinkedIn or Indeed job link | "This careers page uses a job board Job Radar can't read yet (AJP-RADAR-UNSUP)"; no permission asked |
| M9 | Refuse the permission prompt when adding | "The browser did not allow access to this job board (AJP-RADAR-PERM)"; nothing saved |
| M10 | On a Greenhouse / Lever / Ashby job posting, open the panel → **Watch this company** | One click adds the company (or, without permission yet, Admin opens with the link filled in); then "You watch this company in Job Radar" |
| M11 | Settings: threshold 50%, alerts "After every scan", Scan now | A notification "N new jobs at 50%+ match: <companies>"; clicking it opens Job Radar; the toolbar icon shows a **blue** number |
| M12 | Open Job Radar (or the popup) | The blue number clears; the popup shows the new-match count, the top 5 and See all |
| M13 | Pause a company, Scan now; Resume it | Paused companies are skipped; Resume scans it again |
| M14 | Add a list of 5 links (2 supported, 1 duplicate, 1 LinkedIn, 1 typo) | "Added 2. Skipped 3" with a reason for each |
| M15 | Leave the browser open for a few hours | New jobs appear by themselves (scan every 3 hours by default); one summary notification a day |
| M16 | Safari: a Workday company (its search is a POST) | It scans without errors (confirms Safari allows the request) |
| M17 | Set up 2–3 career tracks with different titles (and one with its own area); Scan now | Job Radar shows "Looking for: …" per track; each job's card names its track; jobs outside a track's area aren't listed (remote ones are) |
| M18 | Auto-apply details: Require visa sponsorship = Yes; Scan a company whose posts say "unable to sponsor" | Those jobs sit under "Likely not eligible (N)" with the reason; no alert or blue number for them; others are tagged "Sponsors visas" when they say so |
| M19 | U.S. citizen = No; a company with "U.S. citizens only" / clearance posts | Set apart as likely not eligible; with U.S. citizen = Yes they return to the list (a clearance shows a "Check" label) |
| M20 | Sort **Newest first**; look at the labels | Jobs posted today show **Posted today**, this week **This week**; newest at the top |
| M21 | **Allow all 11 job boards** | One browser prompt; afterwards adding any company asks nothing |
| M22 | Fresh start (no companies added): Allow all job boards, then **Scan now** | The directory card says "Built-in company directory: 300+ companies · on"; New jobs fills with jobs from directory companies that fit your tracks and places |
| M23 | **Hide company** on a job | Its jobs disappear and that company isn't scanned again; the card counts it as hidden |
| M24 | Settings: untick "Scan the built-in company directory", Scan now | Only your own companies are checked |
| M25 | While a scan runs, click **■ Stop** | The scan ends within a moment; nothing resumes on its own |
| M26 | Change a track's titles or locations (or your work authorization), then open Job Radar | The list is already re-checked (jobs that no longer fit are gone) and **Restart search** is offered; it looks at every company again with the new preferences |
| M27 | Open a job from the list | Its card shows the same % and "N of M skills" as the panel on the job page; jobs without a description show "–" until their description arrives |
| M29 | With Data titles, look through New jobs after a scan | No facility ("Data Center … Engineer"), physical-security or other non-IT jobs: every listed job shares at least 2 of your technical skills (its card shows "N of M skills") |
| M30 | Profile: Total years = 15; tracks Data Architect / Senior Data Engineer; Restart search | Senior, Lead, Staff, Principal roles (cards say "asks 10+ yrs" etc.); no Junior, "II" or intern roles, no jobs asking for 3+ / 5+ or 20+ years; no Manager / Director roles until you add a track like "Data Engineering Manager" |
| M31 | With a US location (e.g. "NJ"), open a remote job listed only in Europe; then a remote US job and a "Remote - Worldwide" job | Europe: the location row says "remote: Listed for …: confirm they hire in the US", and the job stays in Job Radar with that note. The other two: ✅ and shown |
| M32 | With your location in NJ, find remote jobs saying "not available in NJ", "must live in CA, TX or WA", and "Remote Canada"; then one that excludes only another state | The first three are under Job Radar → **Filtered** → Remote restriction, each with its reason. The last one is in **Matched** |
| M33 | Job Radar → Restart search, then open **Filtered**: change the reason, page through, click **Move to Matched** on one job, change a preference | Every left-out job is listed with its reason; both tabs page 25 at a time; the moved job stays in Matched marked "Moved by you"; jobs that now fit return by themselves |
| M34 | In Job Radar, click a job hosted on a company's own site (not a job board). Allow the site. Open a second job there. Then repeat on another company and click Deny | Allowed: the assistant appears with the match, and the second job does not ask again. Other pages of that company site show nothing. Denied: the job still opens and a message explains the toolbar icon |
| M35 | Target title "Data Engineer"; open Job Radar settings; Scan now; look at New jobs and Filtered | Settings say "Related titles also used: ETL Developer, Analytics Engineer, …". Jobs such as "Analytics Engineer" or "ETL Developer" appear with a **Related title** label; a job with another title (e.g. "Streaming Engineer") appears only with an **Other title, your skills** label and a high match, otherwise it is under Filtered → Different role with "Other title; N of your technical skills, P% match" |
| M36 | Settings: "Skip job titles with these words" = Sales; Recruiter → Save; then untick "Include related job titles" → Save | Sales and recruiter jobs move to Filtered → **Title words you skip** ("Sales" in the title), but a "Salesforce Data Engineer" stays; with related titles off, ETL Developer / Analytics Engineer jobs leave the list and the settings say related titles are off |
| M28 | Career tracks: give one track its own locations (e.g. "Seattle, WA; Remote - US") | Saved; that track's jobs follow those places (on-site in Seattle, or remote in the US); "Remote Canada" jobs don't show for a US search |

### H. Performance
| ID | Steps | Expected |
|---|---|---|
| H1 | Time from opening a job page to the badge appearing | About 1.5 s or less (mostly the deliberate wait for the page to finish loading) |
| H2 | Match time shown in the panel ("· N ms") | Under 50 ms |
| H3 | Autofill on a 30-field form | Under 1 s |
| H4 | Use the extension for a day (hundreds of job pages) | No slowdown. The log stays at 3,000 entries or fewer. |
