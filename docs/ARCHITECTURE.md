# Architecture

Technical reference for **Apply Job Assistant**, the browser extension in this repo.

Last updated: 2026-11-18 · Version 0.1.0 · Branch `develop`. Related documents:
- [PLAN.md](PLAN.md): goals and roadmap
- [TRACKER.md](TRACKER.md): current status
- [TEST-SCENARIOS.md](TEST-SCENARIOS.md): tests
- [SUPPORT.md](SUPPORT.md): logs and error codes
- [JOB-FINDER.md](JOB-FINDER.md): Job Finder (Job Radar) design, planned roadmap step 19

---

## 1. What the system does

For any job posting the extension:
1. reads the job description
2. scores it against the user's skills, showing a match %, matching skills and gaps
3. checks fit on work type, salary and location
4. optionally uses a free AI to tailor the resume, through evidence-checked, result-oriented edits that you review, or to draft answers to application questions
5. autofills the application form, and learns from what the user types
6. detects that the application was submitted and tracks it on a pipeline board with reminders

Everything is stored locally in the browser. There is no server, database or account.

## 2. Goals → design decisions

| Goal | Decision |
|---|---|
| Runs in Chrome, Edge, Firefox and Safari | One **Manifest V3** extension built only on standard WebExtension APIs. `background` declares both `service_worker` (Chrome/Edge) and `scripts` (Firefox/Safari). `AJP.api` picks `browser` or `chrome`; both return promises. |
| Fast | No framework and **no build step**: plain ES2020, loaded as-is. The matcher is precompiled regex and takes a few ms per job description. Reads go through an in-memory cache that `storage.onChanged` invalidates. The panel uses Shadow DOM and renders on state change. Apply detection only watches the page for 2 minutes after a Submit. |
| No database; data stays local | `storage.local` with `unlimitedStorage`. Each top-level key is one "document" (§5). Backup and restore use a JSON export. |
| Free AI | Gemini, Groq and OpenRouter free tiers, or local Ollama. AI is **optional**: matching, autofill and tracking all work offline. |
| Learns about the user | Answers the user types are remembered per question and reused. Applications are tracked automatically. |
| Supportable | Every failure has an error code. Every user action has a trace id. A one-click issue report carries no personal data (§10). |
| Safe by default | Never submits a form. API keys stay in the background. EEO answers never go to the AI. Logs are redacted. Job-site passwords are not stored. |

## 3. Repository layout

```
manifest.json                 MV3 manifest (permissions, background, content scripts, popup, options)
icons/                        16/32/48/128 px PNGs
src/
  lib/                        shared modules, loaded in several contexts (namespace globalThis.AJP)
    core.js                   AJP namespace, browser API shim, helpers, AJP.send (messaging)
    logger.js                 structured logging, redaction, sessions, traces, flight recorder
    errors.js                 error catalog (AJP-… codes), AppError, toAppError
    storage.js                local "database": defaults, cache, versioned reads, backup/restore
    skills-dictionary.js      canonical skills + aliases
    matcher.js                offline match score, gaps, fit checks
    ai.js                     free AI providers + prompts (background only)
    tracker.js                application tracker logic (job identity, merge rules, reminders, stats, CSV)
    diagnostics.js            "Report an issue" bundle; captureErrors for extension pages
    resume-engine.js          resume enhancement v2: parse, strict prompts, edit validator, assembly, integrity check
    tracks.js                 career tracks: per-track profile/resume, score every job per track, best track, insights
    issue-report.js           problem reports on GitHub: pre-filled issue URL (public-safe), status mapping, crash-prompt rules
    docx.js                   .docx → text with zero dependencies (DecompressionStream)
    pdf.js                    PDF → text via Mozilla pdf.js (loaded on demand): lines, bullets → "- ", paragraphs
    experience.js             years of experience (asked vs. yours, per skill) and seniority level → fit rows
    field-rules.js            form question → profile value rules (shared by Autofill and profile suggestions)
    profile-suggest.js        learned answers → suggested profile updates
    pdf-writer.js             resume text → ATS-readable PDF (Helvetica, WinAnsi, Letter); the one file format we upload
  vendor/pdfjs/               pdf.js 4.10.38 legacy build (Apache-2.0), integrity-verified; see its README
  background/background.js    message router, AI calls, persistence, tab job memory, badge, context menu
  content/                    runs inside job pages (every frame)
    jd-extractor.js           find the job description (JSON-LD → site selectors → heuristic)
    form-filler.js            label detection, profile mapping, filling, learning
    workday.js                Workday adapter: pop-up dropdowns, search prompts, dates, Add entries, multi-page
    entries.js                repeatable Work experience / Education blocks on any site (Add another, dates, current job)
    ats.js                    Greenhouse / Lever / Ashby / iCIMS adapters + searchable dropdowns, Yes/No buttons, hidden selects
    apply-detector.js         notice Submit + confirmation to mark "applied"
    panel.js                  floating Shadow-DOM panel (pure view)
    content.js                per-page controller wiring everything together
  admin/                      Admin page (options page, opens in a tab)
    admin.html / .css / .js   profile, skills, preferences, resumes, auto-apply, AI, answers, logs, backup
    tracker-view.js           Applications: stats, board, table, detail dialog, CSV export
    enhance-view.js           Resumes → tailoring drafts: review requirements, evidence and edits; create the resume
    tracks-view.js            Career tracks: set up to 3 tracks, insights per track, compare recent jobs
  popup/                      toolbar popup (analyze, autofill, open Admin, report a problem)
tests/                        automated tests (see §12)
docs/                         this file, PLAN.md, TEST-SCENARIOS.md, SUPPORT.md
```

**Module pattern.** Every `src` file is an IIFE that attaches to `globalThis.AJP` and returns early if it's already loaded. This lets the same files load as content scripts, background scripts and `<script>` tags with no bundler, and makes re-injection safe.

## 4. Runtime contexts

```
 ┌──────────────── Job page (every frame) ─────────────────┐     ┌──────── Extension pages ────────┐
 │ content.js  controller                                   │     │ Admin page  (admin.js,          │
 │  ├ jd-extractor  → matcher  → panel (top frame only)     │     │              tracker-view.js)   │
 │  ├ form-filler   (fill + learn)                          │     │ Popup       (popup.js)          │
 │  └ apply-detector (submit + confirmation)                │     │                                 │
 └───────────────┬─────────────────────────────▲────────────┘     └──────┬───────────────▲──────────┘
     runtime.sendMessage                 tabs.sendMessage          runtime.sendMessage   │ storage.local
                 │                             │                         │               │ (direct reads,
 ┌───────────────▼─────────────────────────────┴─────────────────────────▼──────┐        │  own-key writes)
 │ Background (service worker on Chrome/Edge · event page on Firefox/Safari)    │        │
 │  router · AI tasks (keys here only) · logs writer · answers · applications   │        │
 │  tab job memory · follow-up badge (alarms) · context menu · injection        │        │
 └───────────────┬───────────────────────────────────────────┬─────────────────┘        │
                 │ fetch (HTTPS / localhost)                 │ storage.local ───────────┘
        ┌────────▼─────────┐                         ┌───────▼────────┐
        │ AI provider      │                         │ storage.local  │  (the only database)
        └──────────────────┘                         └────────────────┘
```

| Context | Where it runs | Loaded files (in order) |
|---|---|---|
| Background | Service worker (`importScripts`) or background scripts (manifest list) | core, logger, errors, storage, skills-dictionary, matcher, ai, tracker, resume-engine, tracks, issue-report, background |
| Content | Declared on 12 job-site patterns (`all_frames`); injected on demand elsewhere via `activeTab` + `scripting` | core, logger, errors, storage, skills-dictionary, matcher, tracker, tracks, jd-extractor, form-filler, workday, apply-detector, panel, content |
| Admin | `src/admin/admin.html` (options page) | core, logger, errors, storage, skills-dictionary, matcher, ai, docx, pdf, tracker, resume-engine, tracks, issue-report, diagnostics, tracker-view, enhance-view, tracks-view, admin |
| Popup | `src/popup/popup.html` | core, logger, errors, storage, tracker, diagnostics, popup |

**Permissions:** `storage`, `unlimitedStorage`, `activeTab`, `scripting`, `contextMenus`, `alarms`. Host permissions cover only the AI endpoints (Gemini, Groq, OpenRouter, local Ollama) and `api.github.com` (read-only public issue search for problem-report status; no token). Content scripts are declared for LinkedIn, Indeed, Greenhouse, Lever, Workday (`myworkdayjobs`/`myworkdaysite`), Glassdoor, ZipRecruiter, Ashby, SmartRecruiters, iCIMS and Workable. Any other site works only when the user clicks the toolbar icon or uses the context menu.

## 5. Data model (`storage.local`)

| Key | Shape | Written by | Notes |
|---|---|---|---|
| `profile` | `{ personal{…}, skills[{name,level,years}] (core skills), tracks[≤3]{id,name,targetTitles,skills,resumeId,salary?,workTypes?}, targetRoles[], salary{min,max,currency,period}, areas[], workTypes{remote,hybrid,onsite}, willingToRelocate, autoApply{ education[], experience[], workAuthorized, requireSponsorship, noticePeriod, earliestStart, coverLetterTemplate, eeo{gender,race,hispanic,veteran,disability,pronouns} } }` | Admin | Defaults are deep-merged on read, so older data gains new fields |
| `settings` | `{ ai{provider,model,keys{gemini,groq,openrouter},ollamaUrl}, logLevel, autoAnalyze, learnAnswers, tracker{autoDetect,followUpDays} }` | Admin | Keys are never exported by default |
| `resumes` | `{ activeId, items[{id,name,text,file?{name,type,size,dataUrl},gaps?,basedOn?,enhancementId?,coverage?,job?,createdAt}] }` | Admin; background adds tailored versions | Files ≤ 5 MB, stored as data URLs |
| `enhancements` | `[{ id, createdAt, job, jd≤12k, resumeId, resumeName, baseHash, requirements[{id,text,jdQuote,type,priority,keywords,evidence[{quote,where}],match}], atsKeywords, edits[{id,target,kind,role,before,after,reason,requirementIds,evidence,ok,violations,warnings,needsMetric,accepted}], gaps[{requirementId,text,priority,advice}], coverage{evidence,atsBefore,atsAfter,atsMissingAfter}, stats, appliedResumeId? }]` | Background (create, apply); Admin (delete) | Resume tailoring drafts awaiting review; max 20 |
| `answers` | `{ [normKey]: {label,value,kind,count,lastUsed,hosts[≤10]} }` | Background | Values ≤ 5,000 chars |
| `applications` | `[{ id, jobKey, url, title, company, location, score, status, date, appliedAt, updatedAt, statusHistory[≤30], snapshot{jd≤20k,salary,workTypes,location,source,savedAt}, resumeId, resumeName, notes, recruiter, interviewAt, nextStep, lastFollowUpAt, detectedBy, host }]` | Background (saves); Admin (edits) | Max 2,000; newest first |
| `evaluations` | `[{ jobKey, url, title, company, at, bestTrackId, scores{trackId:n}, gaps{trackId:[skill]} }]` | Background | Last 300 analyzed jobs (one per job) — track insights & compare |
| `reports` | `[{ reportId, createdAt, codes, title, status, number?, url?, version?, checkedAt?, checkFailed?, seen? }]` | Background | Problem reports opened on GitHub (max 50) |
| `promptState` | `{ recent{code:[ts]}, last{code:ts}, never{code:true}, pending?{code,msg,at,tid} }` | Background only | **Internal**: crash-prompt bookkeeping |
| `logs` | `[{ t, lvl, ctx, sid, mod, msg, data?, tid?, code?, pre? }]` | Background only | Ring buffer of 3,000 entries |
| `tabJobs` | `{ [tabId]: { url, title, company, location, score, jobKey, snapshot, submittedAt?, appliedAt?, at } }` | Background only | **Internal**, never exported; at most 30 tabs |

**Write ownership.** Each key has one writer per change type, and the background serializes its writes with `AJP.serial()`. This avoids lost updates when many tabs act at once (a test sends 20 simultaneous saves).

**Cache correctness.** `storage.js` versions every key. A read that started before a write never caches the stale value. This was a real race, found by the test suite.

**Backup.** `exportAll` / `importAll` cover `profile`, `settings`, `resumes`, `answers`, `applications`, `enhancements`, `evaluations` and `reports`. `logs`, `tabJobs` and `promptState` are internal and are never imported.

## 6. Messages

All messages are `{ type, …payload, _tid? }`. A reply is `{ ok: true, tid, … }` or `{ ok: false, tid, error, hint, code }`.

### Page / extension pages → background (`runtime.sendMessage`)
| Type | Purpose |
|---|---|
| `log` | Persist a batch of log entries (max 200 per message) |
| `ping` | Health check: version, session id, uptime, log level |
| `analyzeTab` | Inject content scripts if needed, then open the panel (popup, context menu) |
| `autofillTab` | Inject, then send `doAutofill` to all frames, carrying the trace id and the career track |
| `autofillReport` | A frame finished filling → forward to the top frame |
| `fillQuestion` | Put an AI-drafted answer into a specific field (any frame) |
| `ai.extractSkills` / `ai.draftAnswer` / `ai.test` | AI tasks (§8.5) |
| `resume.enhance` | Resume enhancement pipeline → saves a draft (§8.7) |
| `resume.applyEnhancement` | Build the tailored resume from a reviewed draft: re-validate, assemble, integrity check |
| `openAdmin` (`#resumes?enh=<id>`) | Open the review screen for a draft |
| `learnAnswer` | Remember a question → answer pair |
| `recordEvaluation` | Store a job's score per career track (insights, compare) |
| `crashPromptAction` | Answer a crash prompt: `report` (opens Admin with the code) / `later` / `never` |
| `github.similar` | Open issues with the same error code (public search; never throws) |
| `report.saved` | Remember a report opened on GitHub |
| `github.status` | Look up each report's issue by report id → status (max 5 per run, every 10 min; daily alarm) |
| `reports.seen` | Clear the ✓ badge for newly fixed reports |
| `setTabJob` | "This tab is looking at job X" (used for apply detection and snapshots) |
| `recordApplication` | Insert or update an application (merge rules in §8.4) |
| `undoStatus` | Revert the last status change, or remove a just-added entry |
| `applicationSignal` | `submit` / `confirm` / `check` from the apply detector |
| `askApplied` | Ask the user in the top frame: "Did you submit?" |
| `openAdmin` | Open the Admin page at a section (`#applications?due=1`, `#logs?report=1`) |

### Background → page (`tabs.sendMessage`)
| Type | Target | Purpose |
|---|---|---|
| `openPanel` | top frame | Analyze the page, or the selected text (`jdText`) |
| `doAutofill` | all frames | Fill the forms in this frame and report back |
| `autofillReport` | top frame | Combined fill report for the panel |
| `fillQuestion` | all frames | The frame that owns the field fills it |
| `appliedDetected` | top frame | Show "detected and saved as applied" with Undo |
| `askApplied` | top frame | Show the "Did you submit?" prompt |
| `crashPrompt` | top frame | "Something went wrong (AJP-…). Report it?" |

## 7. Key flows

### 7.1 Analyze a job page
```
content (top)                       background                  storage
 auto() on known site / openPanel
 jd.extract()  JSON-LD→site→heuristic
 matcher.analyze(profile, resume)  ─────────────────────────────▶ read profile/resumes (cache)
 tracker.findDuplicate(applications)
 send setTabJob {job, score, snapshot} ──▶ tabJobs[tabId] = job ─▶ write tabJobs
 panel.render(score, chips, fit, duplicate warning)
```

### 7.2 Autofill (multi-frame)
```
panel "Autofill" → startTrace(panel.autofill) → send autofillTab(_tid)
background: ensureInjected (probe → inject all frames) → tabs.sendMessage doAutofill {tid} → every frame
each frame: filler.fill() → startLearning() → send autofillReport ──▶ background ──▶ top frame panel (merged)
content (top): recordApplication {status:'in progress', auto:true}
```

### 7.3 AI task (e.g. draft an answer)
```
panel → startTrace → send ai.draftAnswer(_tid) → background router (same tid)
  → aiContext(profile, active resume) → ai.complete(startTrace ai.draftAnswer, same tid)
  → fetchJson (timeout 90 s) → provider → parse → reply {text}
  → panel → send fillQuestion → owning frame sets value (marked as "AI draft", not learned until edited)
Errors at any hop become AppError codes (AJP-AI-401/429/…); one tid connects all log lines.
```

### 7.4 Detecting a submitted application
```
apply-detector (any frame)
  Submit on an application-like form (file input or ≥ 4 fields; not newsletters)
    → applicationSignal submit → tabJobs[tab].submittedAt
    → start watching the DOM for 120 s;  in 30 s: applicationSignal check → if not applied → askApplied
  Confirmation seen (short heading/alert/dialog text, or /confirmation|/thanks URL on a job site)
    → applicationSignal confirm
background: requires job context (tab job) OR a known job site; otherwise ignored
  → saveApplication {status:'applied', auto:true, detectedBy, snapshot, resume used}
  → tabs.sendMessage appliedDetected → panel "✅ … saved as applied · Undo"
New tab opened from a job tab (LinkedIn "Apply" → company ATS): tabs.onCreated copies the opener's job context.
```

### 7.5 Follow-up reminders
`alarms` fires hourly. Applications change → `refreshBadge` (debounced) → `tracker.dueFollowUps(days)` → toolbar badge count. The popup shows "🔔 N follow-ups due", linking to `#applications?due=1`.

### 7.6a Tailor the resume (resume enhancement v2)
```
panel "📝 Tailor resume" → startTrace → send resume.enhance {jd, job}
background:
  parse(active resume) → bullets b1…bn, summary, skills; everything else protected   (no bullets → AJP-RES-STRUCT)
  AI #1 analyzeForResume → requirements[] (must/should/nice) + evidence quotes + ATS keywords
  CODE verifyRequirements → drop quotes not found word-for-word; no evidence ⇒ match "none"
  AI #2 proposeResumeEdits(supported requirements, gaps, keywords, skills, resume lines)
  CODE validateEdit(each) → blocked edits keep the original; duplicates blocked
  save draft in `enhancements` → reply summary
panel: "12 requirements: 7 strong, 3 partial, 2 gaps · 8 edits (2 blocked) · keywords 45% → 70% · Review →"
Admin #resumes?enh=<id>: user ticks/edits (typing real results) → resume.applyEnhancement
  → re-validate every accepted edit (user text: only placeholders/first-person/length) → assemble
  → verifyIntegrity (protected lines unchanged) → new resume version (optional: make active)
```

### 7.6 Report an issue
Admin (or the popup link → `#logs?report=1`) → `diagnostics.collect()`:
1. flush logs
2. read data → summarize as **counts only**
3. `ping` the background, check storage health
4. build the error summary and session list
5. take the last 2,000 log entries
6. `finalScrub` (mask emails, phone numbers, keys anywhere)
7. download `apply-job-report-R-YYYYMMDD-XXXXX.json` and/or copy the summary text

## 8. Subsystems

### 8.1 Job description extraction (`jd-extractor.js`)
1. **schema.org `JobPosting` JSON-LD**, including `@graph` and array `@type`. Gives title, company and location. This is the most reliable source.
2. **Site selectors** (`SITES`) for LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, ZipRecruiter, Ashby and SmartRecruiters. These are tried *first* on LinkedIn, because it's a single-page app and its JSON-LD can be stale.
3. **Heuristic:** the visible container (400–25,000 chars) with the highest density of job-description keywords.
4. **Manual:** select the text → context menu.

A result needs at least 200 chars. `extract({root, host, url})` can be pointed at any DOM, which is how the tests run it.

### 8.2 Matching (`matcher.js`)
- **Dictionary:** 199 canonical skills with aliases. Short tokens (`Go`, `R`, `C`, `js`) are case-sensitive, and boundaries respect `+ # .`, so `C++`, `C#`, `.NET` and `Node.js` work.
- **Sections:** each line is classified as *required* (weight 3), *unlabeled* (2) or *preferred* (1), from headings and inline phrases ("is a plus", "(preferred)"). A mention like "our preferred vendors" doesn't count.
- **User skills** = profile skills (canonicalized) ∪ skills detected in the active resume. Custom skills the dictionary doesn't know are matched too.
- **Score** = `round(100 × Σ weight(matched) / Σ weight(all JD skills))`. Repeated mentions add up to +0.5. AI-extracted skills can be merged in.
- **Fit checks:**
  - work type: remote / hybrid / on-site, with negations
  - salary: annual and hourly ranges compared with the user's range
  - location: the user's areas, or remote
  - **years of experience** (`experience.js`): reads "5+ years of experience", "3–5 years", "five or more years", "3+ years with Kafka", "4 years of Java experience"; ignores company history ("founded 20 years ago"), ages and "4 year degree"; preferred asks never raise the required one. The candidate's total = Admin → Profile total, else Auto-apply work history dates, else the resume's Experience-section date ranges (overlaps merged, education ignored). Years per skill = merged dates of roles mentioning the skill or a skill implying it. ✅ / 🟡 one year short / ⚠️
  - **seniority:** level from the job title (Intern → Junior → Mid → Senior → Staff/Lead/Principal or Manager → Director → Executive; "Engineer II/III"), else from the years asked; mine from my current title, else my years. Within one level = ✅
  - Years and seniority are **shown, never scored**: a wrong reading can't hide a good job, and the % stays a pure skills measure.
- **Synonyms** (`skills-dictionary.js`): `SKILL_IMPLIES` (transitive, full credit: Next.js → React → JavaScript, PostgreSQL → SQL, Spring → Java) and `SKILL_SIMILAR` groups (half credit, the gap chip says "≈ you have Azure"). Groups are kept tight: only skills a recruiter would accept as transferable.
- **Bullets are never headings** in `sectionize` (B14).

### 8.3 Autofill and learning (`form-filler.js`)
- **Label** for each field, taken in this order:
  1. `label[for]`
  2. `aria-labelledby` / `aria-label`
  3. a nearby label or legend (including Workday `data-automation-id` labels)
  4. placeholder, then name

  Radio and checkbox groups use their fieldset legend or `role=radiogroup`.
- **Value:**
  - `RULES` maps 55 label patterns (question-style rules such as work authorization are checked before short field rules like country) (name, contact details, location, links, work authorization, sponsorship, EEO, education, salary, …) to profile values
  - if no rule matches, learned answers are checked (exact key, then token Jaccard ≥ 0.75)
  - long-text questions go to the panel for an **AI draft**
- **Setting values:**
  - the native value setter plus `input`/`change`/`blur` events, so React and Vue forms register them
  - fuzzy option scoring for selects and radio buttons, including "decline to self-identify" equivalents
  - the resume file is attached via `DataTransfer`
- **Never:** submits, overwrites a field the user filled, or touches password, hidden or disabled fields.
- **Learning:** a capture-phase `change` listener records user edits. It skips the extension's own fills (a `filling` flag and `data-ajp-value`), AI drafts that haven't been edited, and sensitive labels (SSN, password, card, bank, date of birth).

### 8.3b Site adapters: Greenhouse, Lever, Ashby, iCIMS (`ats.js`)
`AJP.ats.detect` finds the site by host (`*.greenhouse.io`, `*.lever.co`, `*.ashbyhq.com`, `*.icims.com`) or, when embedded on a company domain, by its markup. Then:
- **Field names first:** each site's own names map to profile rules before the label is read (Lever `name`/`org`/`urls[LinkedIn]`/`eeo[…]`, Ashby `_systemfield_*`, iCIMS `PersonProfileFields.*`, Greenhouse `first_name`).
- **Files first:** file inputs are handled before anything else. On Lever, which reads the uploaded resume and fills fields itself, the filler snapshots the empty fields, waits for the site (≤ 1.5 s), and treats what the site filled as replaceable by profile values (`data-ajp-site-filled`). Anything the user typed is never replaced.
- **Widgets pass** (after the generic loop; also on unknown sites): searchable dropdowns (`role=combobox` / React-Select: open, pick without typing when the list is short, else type and wait; success = a single-value element or the picked text), location autocompletes (city must match, state preferred), Yes/No button pairs (Ashby), hidden `<select>`s behind a custom dropdown (select2, iCIMS: set the select + `change`). Each widget is isolated: a failure is logged with its code and listed, never stops the rest.
- **Wording:** native dropdowns everywhere now try the site's wording too ("TX" → "Texas", "USA" → "United States of America", "B.S." → "Bachelor's Degree", veteran status variants).
- **"Paste your resume" boxes** get the resume text only when no file could be attached; they are never AI questions.
- **iCIMS sign-in pages:** a note to sign in yourself; password fields are never touched.
- **Learning:** options the user picks in searchable dropdowns and Yes/No buttons are learned like native answers.
- Selectors live in `SITES` / `SEL`, built against emulations (`tests/fixtures/ats-mock.js`, `ats-sample.html`): verify on real pages.

### 8.3a Workday adapter (`workday.js`)
Workday widgets aren't native form fields. The generic filler skips the fields the adapter owns; then `AJP.workday.fill` runs.

**Widget types:**
- **Dropdown:** `button[aria-haspopup=listbox]`. The adapter clicks it, waits for `[role=listbox]`, scores the options and clicks the best one. If nothing matches, it presses Escape.
- **Search prompt:** `multiSelectContainer`. It types the value, presses Enter, then picks a `promptOption`.
- **Date:** `dateInputWrapper` with Month/Day/Year spinbuttons. It accepts formats like "06/2019", "2019-06", "June 2019" and "2019". "Present" means no end date.
- **Entries:** in the Work Experience and Education sections, it clicks **Add** until there is one entry per profile item (max 5), then fills each field by its `formField-<key>`.

**Matching the value to Workday's wording:**
- the same rules and learned answers as the generic filler
- Workday's own wording: US state codes become names, USA becomes "United States of America", degree abbreviations become full names, and "decline" becomes "I do not wish to answer"

**Safety and multi-page behavior:**
- It never overwrites a value the user chose.
- It never clicks Save and Continue or Submit.
- A page change (the progress bar's active step) after Autofill triggers the panel's "⚡ Autofill this page" offer.
- Options the user picks are learned.

**Selectors:** all live in `SEL`. The adapter was built against `tests/fixtures/workday-mock.js`, an emulation using Workday's `data-automation-id` names, and must be verified on real Workday pages. Misses are reported as "not filled", logged, and reportable.

### 8.3d Repeatable entries (`entries.js`)
For sites other than Workday. A section = a heading ("Employment", "Experience", "Work history", "Education"…) whose block (≤ 3 levels up) holds an **anchor** field (Company / Employer; School / University, never "Current company") or an Add button, and **no** name/email/phone fields (so a job post's "Experience" heading next to a form is never a section). One entry per anchor. Entries that already have a value are kept, and profile items they already cover are skipped. "Add another" / "+ Add" is clicked until there is one entry per remaining item (max 5, waiting for the new block). Fields are matched by label within each entry (description and the "current" checkbox before title; dates into month selects / year boxes / `type=month` / "MM/YYYY"; searchable school/degree via `ats.pickCombo`; degree wording via the shared candidates). The generic loop and the widgets pass skip fields inside entry sections. Each field is isolated; a section failure is logged with its code and listed.

### 8.3c Profile suggestions (`profile-suggest.js`, `field-rules.js`)
- The label → profile rules moved to `field-rules.js` so Autofill (content scripts) and Admin read a question the same way.
- `profileSuggest.list(profile, answers, dismissed)`: each learned answer whose label maps to a profile field (email, phone, links, address, current company/title, years, minimum salary, notice period, start date, relocate, sponsorship, work authorization) and whose normalised value differs from the profile. Empty field → suggested after one answer; a different existing value → after two. One suggestion per field (most used, then most recent). **Never** EEO, names, education/experience lists or cover letters.
- Admin → Learned answers shows the box (Save to profile / Dismiss / Save all) and a count in the menu; the popup shows "💡 N profile suggestions". Saving writes Admin's in-memory profile first (so later edits can't undo it), then storage. Dismissals are stored per value in `suggestions.dismissed`.

### 8.3e Holding an application across pages
`tabJobs[tabId]` keeps the job a tab is applying for. It reaches a new tab by `openerTabId`, by an **Apply click** (`applyClicked` stores `__pending` for 20 s; a tab created without an opener in that window adopts it), or by **job identity** (`tabJob.get` with the page URL finds the same `jobKey` held in another tab). On a page without a job description the panel shows the held job and follows the step (`applyPhase`: login / sign-up = password fields around a "create account" text; form = a file input or 3+ fields; else waiting): Autofill is off on login/sign-up and on when the form appears; tracking, Autofill's tailored resume and apply detection use the held job. Each visit is activity; **1 hour** without activity → dropped, and the panel shows a closable "Tracking of this job was lost". **Applied** (Mark applied, detection, Admin) → `offboardJob` removes the job details from tab memory (an `appliedAt` marker stays so "Did you submit?" isn't asked twice); Applications keeps the record. Passwords are never read or stored.

**Retention:** `pruneHistory` (on start + daily alarm) removes applications applied more than `settings.retentionDays` ago (default 30; counted from the apply date — the record exists to prevent applying twice and to re-read the job description; 0 = keep), and job history, tailoring drafts and logs older than that.

### 8.4 Application tracker (`tracker.js`, `apply-detector.js`, `tracker-view.js`)
- **Job identity (`jobKey`):** the same job is recognized across URLs:
  - LinkedIn: `currentJobId`, `/jobs/view/<id>`
  - Indeed: `jk`/`vjk`
  - Greenhouse: `gh_jid`, `/jobs/<id>`
  - Lever and Ashby: UUID
  - Workday: `_R12345`
  - SmartRecruiters and Glassdoor: their job IDs
  - anything else: host + path, without query, hash or `/apply`
- **Merge rules (`upsert`):**
  - *automatic* updates never move status backwards (status rank: started < applied < interviewing < offer/rejected/withdrawn)
  - empty values never wipe saved data
  - the status history is appended on each change
  - `appliedAt` is set once
  - the snapshot is kept
- **Undo:** reverts the last status change. If the entry was created by that change, Undo removes it.
- **Detection safety:**
  - Confirmation text is checked only in short headings, alerts and dialogs (< 300 chars).
  - Instructional text such as "Once your application has been submitted…" is rejected.
  - On unknown sites, detection needs job context from the tab.
- **Duplicate warning:** the same `jobKey`, or the same normalized company + title similarity ≥ 0.8.
- **Reminders:** status `applied` with no activity for N days (default 7, and "I followed up" resets it), or an interview within 48 h.
- **Stats:** tracked, applied, per week (8 weeks), response rate, interview rate (counts jobs that reached interviews even if later rejected), and average match % of interviewed vs. other jobs.
- **CSV:** UTF-8 BOM, RFC-4180 quoting, and a `'` prefix on cells starting with `= + - @` (blocks formula injection).

### 8.5 AI (`ai.js`)
| Provider | Endpoint | Auth | Default model |
|---|---|---|---|
| Gemini | `generativelanguage.googleapis.com/v1beta/models/{m}:generateContent` | `x-goog-api-key` header (never in the URL) | `gemini-2.5-flash` |
| Groq | `api.groq.com/openai/v1/chat/completions` | Bearer | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | Bearer | `meta-llama/llama-3.3-70b-instruct:free` |
| Ollama | `{ollamaUrl}/api/chat` | none (local) | `llama3.1` |
| Chrome built-in AI | Prompt API in the browser (`LanguageModel`, or older `ai.languageModel`); no network | none | on-device (Gemini Nano in Chrome) |

**Chrome built-in AI** (`provider: 'chrome'`):
- Runs in the background service worker, like the other providers (Chrome exposes `LanguageModel` to extension workers).
- `availability()` decides: `available` → `create({ initialPrompts: [system], expectedInputs/Outputs: en })` → `prompt(text, { responseConstraint: {type:'object'} for JSON, signal })` → `destroy()`. `downloadable`/`downloading` → `AJP-AI-LOCAL-DL`; `unavailable` → `AJP-AI-LOCAL-OFF`; no API → `AJP-AI-LOCAL-NONE`.
- **Download** needs a user gesture, so it runs in the Admin page (`AJP.ai.local.download(onProgress)`, from a click), with a progress bar. Admin shows the background's view of the status (where AI runs) and offers "Use it" when the model is ready but another provider is chosen.
- **Small input window:** `fitPrompt` shrinks the long blocks (resume, job post) proportionally and keeps instructions whole; with `measureInputUsage`/`inputQuota` it shrinks until the prompt fits; a `QuotaExceededError` shrinks and retries (max 3), then `AJP-AI-LOCAL-LEN`.
- Older builds without `responseConstraint` are asked again without it. Timeouts abort the prompt (`AJP-AI-TIME`); the session is always destroyed.
- Same prompts and rules as the cloud providers (EEO never included); nothing leaves the computer.

**Tasks:**
- `extractSkills` (JSON)
- `analyzeForResume` (JSON): resume enhancement stage 1 (§8.7)
- `proposeResumeEdits` (JSON): stage 3 (§8.7)
- `draftAnswer`
- `test`

JSON tasks get **one automatic retry**, with a firm reminder, if the model replies with invalid JSON.

**Prompt rules:**
- never invent employers, dates, degrees, certifications or skills
- use placeholders for missing facts
- inputs are clipped (job description 6–14k chars, resume 12–15k)
- **EEO data is never included**, and a test enforces this

Every call is traced. HTTP status, timeout, network and parse failures map to `AJP-AI-*` codes.

### 8.6 Panel (`panel.js`)
- A custom element with an **open Shadow DOM**, so page CSS can't affect it.
- All page-derived text is escaped, so job pages can't inject HTML.
- It's draggable and can be minimized.
- It's a pure view: `content.js` owns the state and passes callbacks via `data-act` attributes.

### 8.7 Resume enhancement v2 (`resume-engine.js`, `background.js`, `enhance-view.js`)
**Principle:** the AI *suggests*, the code *decides*. The AI never writes the final resume. Code assembles it from the original text plus edits that passed validation, and the user approves each one.

**What's editable:** bullets in Experience, Projects and other sections; the summary; and the order of the skills list. **Protected** (never changed): the header (name, contact), headings, role/company/date lines, education, certifications, and anything that isn't a bullet. If the resume has no summary, one can be inserted.

**Validator rules** (`validateEdit`). Any violation blocks the edit:

| Code | Rule |
|---|---|
| `JD_NUMBER` | The line contains a number that appears in the job description but not in the original line ("10TB", "20+", "5%") |
| `NEW_NUMBER` | Any other number, including spelled-out ones ("three", "dozens"), that isn't in the original line. For the summary, numbers elsewhere in the resume are allowed. |
| `UNEVIDENCED_SKILL` | A skill or tool not in the resume, the profile skills or the skills section |
| `NEW_NAME` | A capitalized name (employer, client, product) not found in the resume |
| `COPIED_JD` | 6 or more consecutive words copied from the job description (the prompt asks for ≤ 4) |
| `NO_EVIDENCE` | No cited quote exists word for word in the resume |
| `BAD_TARGET` / `DUPLICATE` | Not an editable line, or a second edit to the same line |
| `TOO_LONG`, `FIRST_PERSON`, `PLACEHOLDER`, `EMPTY` | Style and safety |

**Warnings** (shown, never block):
- `NO_RESULT`: no impact stated.
- `WEAK_START`: doesn't start with an action verb.
- `NEEDS_METRIC`: neither the original nor the new line has a number. The user is asked for a **real** one.

**Text the user types** is treated as their own claim, so their real numbers are allowed. Placeholders, first person and length are still checked.

**Result-oriented by design:**
- The prompt requires *action verb + what + result*.
- An existing result is kept and made prominent.
- Otherwise the impact is described in words that follow from the original, with no figures, and the review screen asks for a real number.

**Coverage reported:**
- *Backed by your resume*: requirements weighted must 3 / should 2 / nice 1; strong 1 / partial 0.5.
- *Job keywords present*: before vs. after the accepted edits.

**Safety:**
- The job description and resume are fenced as data, and closing tags inside them are stripped, so a page can't break out of the fence.
- EEO data is never included.
- A content hash detects a resume edited after drafting (`AJP-RES-CHANGED`).
- Blocked AI edits can't be forced through without being rewritten.

## 9. Logging, errors and diagnostics

| Piece | Design |
|---|---|
| Entry | `{ t, lvl, ctx, sid, mod, msg, data?, tid?, code?, pre? }` |
| Session (`sid`) | One id per page or background lifetime |
| Trace (`tid`) | One id per user action. `AJP.startTrace(name)` creates it; `AJP.send(type, payload, trace)` carries it as `_tid`; the background router and `ai.complete` reuse it. The result is a single id across page → background → AI → page. |
| Timing | `trace.end()` logs `ms`. Above `slowMs` it logs a `… slow` warning instead. |
| Flight recorder | The last 60 entries below the log level are held in memory and written only if an error follows (`pre: true`) |
| Errors | `errors.js`: 23 codes, each with a message and a hint. `AJP.err(key, details)`. `toAppError` normalizes anything thrown, or a failed reply. The UI shows message + hint + `(AJP-…)`. |
| Redaction | By **key** (`apiKey`, `token`, `password`, `email`, `phone`, `eeo`, `race`, `veteran`, `disability`, `gender`, `dataUrl`, …) and by **value pattern** (emails, Gemini/Groq/OpenRouter/OpenAI-style keys, Bearer tokens, `?key=`, phone numbers, SSNs). Applied to messages, data and error stacks. |
| Transport | Contexts batch entries (700 ms; 50 ms after an error) → `log` message → the background writes the ring buffer (3,000 entries) |
| Capture | `AJP.captureErrors` on the Admin page, popup and resume view. Content scripts log only errors from extension files. The background logs `error` and `unhandledrejection`. |
| Report | `diagnostics.collect()`: §7.6; contents described in [SUPPORT.md](SUPPORT.md) |

**Limits (a light touch for close matches, never a rewrite)** — `settings.tailoring` (Admin → AI settings → Tailoring limits), read by `resumeEngine.limits()`:
- **Only close matches:** below `minMatch` (default 70%) the panel explains, lists the biggest gaps and makes no AI call; the background also refuses (`AJP-TAILOR-LOW`) when given a lower `score`.
- **Few rewrites:** the AI is asked for at most `maxEdits` (6) edits; `limitEdits` keeps only the `maxEdits` most important valid rewrites selected (must > should > nice), the rest are shown as unselected "extra ideas"; the review won't tick more, and `applyEnhancement` skips extras (`LIMIT`). The skills-order edit doesn't count.
- **Skills only if the user confirms them, where they choose:** the draft lists `skillOptions` (job skills the *resume* doesn't show, required first; never pre-ticked) and the resume's `roles`. Ticked skills get a job each — default spread by `placeSkill` (2 : 1 current : previous; a 6th goes to the third job; one job → all there). `resume.addSkills` writes each skill into one free line of the chosen job (AI wording validated like any edit, with the confirmed skill allowed; a line in another job, a changed number, or AI off → simple editable wording "…, using X"), never reusing a line already changed by a selected rewrite. Confirmed skills are also appended to the Skills line on create.
- **One tailored resume per job:** `applyEnhancement` replaces the existing tailored resume for the same job (job identity via `tracker.jobKey`), keeps its id, and names the PDF "<Name> - Resume - <Company> - <Job title>.pdf". The panel scores the job with its tailored resume (`state.tailored`), re-scores live when that resume changes (signature check, nothing else triggers it), and offers ⬇ Download PDF. Admin groups tailored resumes in a collapsed "Tailored for jobs" list.
- **Wrapped lines:** `AJP.continuesLine` (core) joins a line to the previous one when it starts in lower case, the previous ends with ","/"and"/…, or the previous is long and unfinished — never a bullet, a heading, a "Label:" line, a job line or a line starting with an action verb. The parser folds continuations into their bullet (replaced together on edit); the PDF writer folds them into their paragraph / bullet.
- **Ceiling:** the resume-only match (what a recruiter / ATS reads) may reach at most `liftCeiling` = your real match (panel %) + `maxLift` (15), and at most `maxSkills` (4) skills; the review disables skills that would pass it and the background drops them (`lift` / `limit`).

### 9b. THE STANDARD: errors, failure capture and retries (applies to every change)
Every part of the plugin handles failure the same way. **Convention tests scan the source** (`tests/unit/standard.test.js`), so a change that breaks a rule fails the build.

| Rule | How | Enforced by |
|---|---|---|
| 1. A failure the user can see has a **code, message and hint** | `throw AJP.err('KEY', details)`. Add new keys to `errors.js` **and** to SUPPORT.md's table. | No `throw new Error(` in the source; every `AJP.err` key exists; every code is documented |
| 2. **Temporary failures retry; permanent ones fail fast** | `AJP.retry(fn)`: up to 3 tries, backoff 0.4 s → 0.8 s (+ jitter), or the server's `Retry-After` (≤ 10 s). Temporary means: `AJP-AI-5XX`, `AJP-AI-NET`, `AJP-NET`, `AJP-HTTP` with a 5xx status, `AJP-STORE`, and a 429 with a short `Retry-After`. Not retried: wrong key, missing data, bad input, timeouts (each already waited). | Unit tests per code |
| 3. **The network is called only through `AJP.http`** | Timeout, coded errors (`statusKey` / `networkKey` / `timeoutKey`), retries. AI and GitHub both use it. | No raw `fetch(` outside `errors.js` (local `data:` URLs excepted) |
| 4. **Every user action is guarded** | `AJP.guard(name, fn, { onError })`: trace + timing + log with code + a clear message; never throws. All panel actions are wrapped centrally in `content.js`; the background router does the same for every message. | Panel-crash test |
| 5. **Nothing fails silently** | Extension pages call `AJP.captureErrors(mod, { notify })`: uncaught errors are logged as `AJP-INTERNAL` and shown ("message (code)"). Empty `catch {}` blocks must explain why in a comment. | Scan for empty catches; captureErrors on every page |
| 6. **Every failure is captured for support** | Coded errors are logged with their trace id (`tid`); the flight recorder keeps the context before them; `AJP-INTERNAL` / `AJP-STORE` / repeated codes raise the crash prompt → GitHub report. | Logging + issue-report tests |
| 7. **Logging only through `AJP.logger`** | Redaction, sessions and traces apply everywhere. | No `console.*` outside `logger.js` |
| 8. **Messaging recovers** | `AJP.send` retries once while the MV3 background is starting ("Receiving end does not exist"); storage writes retry once. | Unit tests |

### 9a. Problem reports on GitHub (option A)
Full spec: [ISSUE-REPORTING.md](ISSUE-REPORTING.md).

- **Watching for errors:** the background watches every error entry (its own and those forwarded from pages) with `issues.shouldPrompt`. A prompt appears for `AJP-INTERNAL` / `AJP-STORE`, or for the same code 3 times in 10 minutes; never for codes users can fix themselves; at most once per code per day.
- **Surfaces:** the job page's panel, the Admin banner, and a red `!` badge.
- **Badge priority:** `!` (problem to report), then `✓` (a report got fixed), then the follow-up count.
- **Report on GitHub:**
  1. Builds the diagnostics bundle.
  2. Checks `github.similar` for open issues with the same code.
  3. `issues.buildIssueUrl` produces the public-safe, pre-filled form URL: summary fields only, scrubbed, no links, ≤ 7,500 chars.
  4. Opens it with `window.open`, then `report.saved`.
- **Status:** `github.status` searches by report id (public API, no token) and maps labels and state to received / fixing / fixed vX / … for **My reports**.
- **Repo side:** `.github/ISSUE_TEMPLATE/bug_report.yml` (form) and `.github/workflows/issue-ack.yml` (acknowledgement comment + labels, using the repo's own `GITHUB_TOKEN`).

## 10. Security & privacy

| Risk | Mitigation |
|---|---|
| API key leakage | Keys are used only in the background. The Gemini key goes in a header. Keys are redacted from logs by key and by pattern. They're excluded from backups by default and never included in issue reports (`hasKey: true/false` only). |
| Sensitive personal data | EEO answers are used only to fill EEO fields; they're never sent to the AI, never logged, and never in reports. Reports contain counts, not content. |
| Script injection from job pages | All page text is escaped in the panel and Admin. The panel uses Shadow DOM. CSV cells are protected against formula injection. |
| Unwanted actions | The extension never submits forms or clicks Submit. Automatic tracker updates only move status forward. Undo is always offered. |
| Credentials | Job-site passwords are not stored (the browser's password manager handles them). Password, SSN, bank and date-of-birth fields are never learned. |
| Third-party code | pdf.js is vendored at a fixed version, verified against npm's sha512, newer than the CVE-2024-4367 fix, run with `isEvalSupported: false`, and only loaded when a PDF is uploaded |
| Over-broad access | Content scripts are declared only on job sites; elsewhere they run only after a user gesture (`activeTab`). Host permissions are limited to the AI endpoints. |
| Third-party chat sites | Not automated (terms of service and reliability). Free official APIs are used instead. |
| Public GitHub issues | Only a scrubbed summary is pre-filled (no logs, links or personal data). The user reviews and submits it. No token in the extension; status lookups are read-only public searches. |

## 11. Performance budgets

| Operation | Budget | How |
|---|---|---|
| Match a job description | < 50 ms (typically 2–10 ms) | Precompiled regex; a test enforces < 150 ms on a 40× job description |
| Badge after page load | ~1.5 s | A deliberate 1.2 s delay for late-rendered pages |
| Autofill a 30-field form | < 1 s | A single DOM pass |
| Storage reads | ~0 ms (cached) | Versioned in-memory cache |
| Apply detection cost | 0 when idle | MutationObserver active only for 120 s after Submit |
| Log writes | Batched | 700 ms batching; one writer |

## 12. Testing architecture

```
tests/
  harness.js              tiny framework: describe/it/eq/…; runSync (CLI) and run (browser)
  mocks/browser-mock.js   in-memory WebExtension APIs: storage + onChanged, runtime/tabs messaging
                          (routes to background vs content listeners like real browsers), scripting,
                          tabs.onCreated/onRemoved, alarms, action badge, contextMenus
  mocks/url-polyfill.js   URL for the macOS JavaScriptCore CLI runner only
  unit/*.test.js          90 suites: core, matcher, logger, storage, ai, docx, pdf, form-filler, workday, jd-extractor,
                          panel, background, tracker, tracker-flow, admin, errors-logging,
                          resume-engine, enhance-flow, tracks, tracks-flow, issue-report, issue-flow, standard
  test-runner.html        loads the REAL extension code + mock + suites; shows results
  run-tests.sh            CLI: 557 tests that need no DOM (Node, or macOS JavaScriptCore)
  run-browser-tests.sh    headless Chrome, real time: all 1081 tests; results POSTed to serve.py
                          (BY_SUITE=--by-suite prints counts per suite)
  serve.py                dev server (no-cache; accepts POST /__results)
  fixtures/sample-job.html  manual test page (JSON-LD job + application form)
  fixtures/workday-mock.js  emulated Workday widgets (tests, videos); workday-sample.html = multi-page demo
video/                    tester walkthrough videos: parts.py (scenes per part), stage.js (captions,
                          highlights, scripted actions in the real pages), build.py (Chrome + say + ffmpeg)
```

- **End-to-end tests** run the real `background.js` and `content.js` together. Messages flow content → background → content through the mock.
- **Admin tests** load the real `admin.html` in an iframe with its own mock, and drive the UI (drag & drop, dialogs, downloads). When a flow needs it, the real background script runs inside the frame too.
- **Adversarial AI tests:** resume enhancement is tested with a fake AI that deliberately cheats. It copies the job's numbers, invents a client and a skill, fakes evidence, targets a protected line and duplicates an edit. The tests prove the code blocks each attempt.
- **Rule:** every bug fix comes with a test that fails without it. Manual browser scenarios live in [TEST-SCENARIOS.md](TEST-SCENARIOS.md).

### CI (GitHub Actions)
`.github/workflows/ci.yml` runs on every push and pull request to `develop` / `main` (and on demand):
- **checks** — `tests/check.sh`: manifest is valid JSON with an x.y.z version, every file it names (and every `importScripts` / injected file in the background) exists, every script parses (`node --check`), no `debugger` / `console.log` left in `src/`.
- **cli-tests** — `tests/run-tests.sh` with Node.
- **browser-tests** — `tests/run-browser-tests.sh` in the runner's Google Chrome (`CHROME_FLAGS=--no-sandbox`), per-suite counts printed.
Run all three locally before pushing: `sh tests/check.sh && sh tests/run-tests.sh && sh tests/run-browser-tests.sh`.

### Packaging (`tools/package.py`)
One source tree, one source `manifest.json` (with both `service_worker` and `scripts`). The packager writes each store's manifest: Chrome/Edge keep only `service_worker` and drop Firefox settings; Firefox keeps only `scripts` plus `gecko` id / minimum version / `data_collection_permissions`; Safari keeps `service_worker` (16.4+). It packs only `manifest.json`, `src/`, `icons/`, `LICENSE` (never tests, docs, video, tools, dotfiles), with fixed timestamps for reproducible zips, then verifies each zip: every manifest / background / page reference is inside, no remote scripts, nothing that must not ship, description ≤ 132 chars, and the Firefox background list loads every library the service worker imports. `tools/safari.sh` turns the Safari variant into an Xcode project and builds it. CI runs the packager and Mozilla's `web-ext lint`, and keeps the zips as a run artifact.

## 13. Cross-browser notes

| Topic | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Background | Service worker (`importScripts`) | Event page (`scripts`) | Event page (`scripts`) |
| Host permissions | Granted at install | **Opt-in**: the user must allow job sites in the add-on's Permissions tab | Prompted per site |
| Install for development | Load unpacked | `about:debugging` → temporary add-on | `xcrun safari-web-extension-converter` → Xcode |
| `getBytesInUse` | ✅ | ❌ (the report omits it) | ❌ |
| `DecompressionStream('deflate-raw')` (.docx) | 103+ | 113+ | 16.4+ |
| Minimum versions | MV3 | 121 (`strict_min_version`) | 16.4+ recommended |

## 14. Extending the system

| Task | Where | Steps |
|---|---|---|
| Support a new job site's description | `jd-extractor.js` `SITES` | Add `{name, host, jd[], title[], company[]}`; add a test in `jd-extractor.test.js`; add the host to `manifest.json` content-script matches and to `tracker.js` `JOB_HOSTS` |
| Recognize a site's job ids | `tracker.js` `jobKey` | Add a branch; add "same job, different URLs" tests |
| Fill a new kind of field | `form-filler.js` `RULES` | Add `{key, re, v}` in priority order; add label→key cases in `form-filler.test.js` |
| Add an AI provider | `ai.js` `PROVIDERS` + `CALLERS` | Add the endpoint to `host_permissions`; add request-format tests in `ai.test.js` |
| Add an error | `errors.js` `ERRORS` | `[code, message, hint]`; throw with `AJP.err(KEY, details)`; add it to the table in `SUPPORT.md` |
| Add a message type | `background.js` `handlers` | Handlers receive `(msg, sender, {tid, log})`; list it in §6 |
| Add a stored key | `storage.js` `DEFAULTS` | Add a default; mark it `INTERNAL` if it must not be exported |

## 15. Career tracks

**Model** (`tracks.js`):
- `profile.tracks` holds up to 3 tracks: `{ id, name, targetTitles[], skills[], resumeId, salary?, workTypes? }`.
- `profile.skills` holds the **core** skills that every track shares.
- **No migration needed:** with no tracks configured, `tracks.list()` returns one implicit "General" track built from the profile as it is, so behavior is unchanged until the user adds tracks.

**How a job is scored per track:**
- `effectiveProfile(profile, track)` = core + track skills (deduplicated), with the track's salary / work types / areas overriding the profile's only when set, and its titles as the target roles.
- `resumeFor(track)` = the track's own resume, else the active resume.
- `analyzeAll()` runs the matcher once per track.
- The **best track** = the highest `score + 15 × titleFit`. `titleFit` (0–1) measures how much of a target title appears in the job title, treating "Sr" as "Senior". The bonus only chooses between tracks; it never changes the % shown.

**Flow:**
```
content.analyze → tracks.analyzeAll → panel tabs (★ best, selected unless the user picked one FOR THIS JOB;
a different job resets the pick) → recordEvaluation {scores, gaps, bestTrackId} → evaluations (last 300)
selected track → setTabJob / recordApplication {trackId, trackName}
               → resume.enhance {trackId}: aiContext(trackId) = effective profile + track resume
                 apply "make active" on a track draft = that track's resumeId (global active unchanged)
               → autofillTab {trackId} → doAutofill: the track's effective profile + resume file
Admin → Career tracks: edit (normalize), insights(trackId) from evaluations + applications, compare table
Admin → Applications: filter by track; CSV "Track" column
```

## 16. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-18 | No build step, IIFE modules on `globalThis.AJP` | Fast iteration; the same files run in every context and in tests |
| 2026-11-18 | Free AI via official APIs, not chat-site automation | Terms of service, reliability, security |
| 2026-11-18 | Never auto-submit applications | The user stays in control; avoids wrong submissions |
| 2026-11-18 | Don't store job-site passwords | The browser's password manager is safer |
| 2026-11-18 | Background is the single writer for shared keys; versioned cache | Prevents lost updates and stale reads (both found by tests) |
| 2026-11-18 | Track applications without email access | Keeps the "all local" promise; email sync stays optional and later |
| 2026-11-18 | Automatic tracker updates only move status forward | Autofill used to downgrade "applied" (bug) |
| 2026-11-18 | Error codes + trace ids + scrubbed issue reports | Users can share diagnostics safely; support can find causes quickly |
| 2026-11-18 | Workday via a dedicated adapter + an emulated Workday fixture | Workday widgets are not form fields; an emulation makes the behaviour testable without live accounts |
| 2026-11-19 | **Tailoring limits: close matches only, a capped light touch, skills placed by the user** | A 40% match tailored into a fit misleads recruiters and the user; a few honest, well-placed changes help a close match get noticed |
| 2026-11-18 | **Per-store manifests are generated at packaging time**, the repo keeps one cross-browser manifest | Load-unpacked keeps working in every browser during development; each store still gets exactly the keys it accepts |
| 2026-11-18 | **Chrome built-in AI runs in the background**, its download in Admin | AI calls stay in one place (keys, logs, traces, retries); the browser only requires a click for the one-time download |
| 2026-11-18 | **Site adapters = field names + reusable widget handlers**, not one script per site; the widget pass also runs on unknown sites | Most ATSs share a few widget kinds (React-Select, select2, Yes/No buttons); handling the kind helps every site using it, and site configs stay small and easy to fix |
| 2026-11-18 | **Years & seniority are fit rows, not part of the %**; synonyms via a hand-kept implies/similar table, not embeddings | Parsing years from free text is heuristic, so it informs instead of scoring; embeddings would need a model download or a server, against "fast, offline, no database" |
| 2026-11-18 | **One resume format: PDF.** A small built-in writer (no library) makes a text-based PDF for every resume that has no uploaded PDF; tailored resumes get one on creation; Autofill uploads the resume tailored for the current job, else the track's / active one | PDF is what every ATS accepts and keeps the layout; one format is simpler for users and for us; uncompressed standard-font text is read back exactly by ATS parsers (tested with pdf.js) |
| 2026-11-18 | PDF text via vendored, integrity-verified pdf.js loaded on demand (not a hand-written parser) | Resume PDFs use embedded fonts/CMaps a small parser gets wrong; on-demand loading keeps Admin fast |
| 2026-11-18 | Problem reports via pre-filled GitHub issues the user submits (option A); acknowledgement by a GitHub Action | No server or token in the extension; the user sees what is posted |
| 2026-11-18 | Career tracks via an implicit "General" track, not a data migration | No risk to existing data; users without tracks see no change |
| 2026-11-18 | Resume tailoring = evidence-checked targeted edits assembled by code, not an AI rewrite | Prompts alone can't guarantee truth; the code validator can. Never copy the job's numbers; keep results first. |

## 17. Known limitations

- **Scanned PDF resumes** (images) have no text: the user pastes it or uploads the .docx (`AJP-PDF-NOTEXT`).
- **Workday:** supported (step 9) but built against an emulation; real tenants may differ: report misses.
- **Resume PDFs we make** use the standard Helvetica font: characters outside Western European (e.g. Chinese names, emoji) show as "?" (Admin says how many). Upload your own PDF to keep a custom design; it is never replaced.
- **Resume tailoring with a real AI:** not yet tried with live free models; quality depends on the model (the safety rules hold regardless).
- **Career tracks:** at most 3; the compare view shows the last 15 jobs.
- **Resume structure:** tailoring works line by line, so achievements must be one per line, starting with `-` or `•` (otherwise `AJP-RES-STRUCT`).
- **Real-browser testing:** not done yet (on the user's side). Site selectors for LinkedIn, Indeed and Glassdoor may need updates.
- **Firefox:** job-site permissions must be granted manually after install.
