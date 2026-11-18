# Architecture

## Goals → design decisions

| Goal | Decision |
|---|---|
| Runs in Chrome, Edge, Firefox and Safari | A single Manifest V3 extension built on standard WebExtension APIs. `background` declares both `service_worker` (Chrome/Edge) and `scripts` (Firefox/Safari). `AJP.api` picks `browser` or `chrome`. |
| Fast | No framework and no build step. The matcher is pure regex over a precompiled dictionary and takes a few ms per job description. Storage reads go through an in-memory cache that `storage.onChanged` invalidates. The panel uses Shadow DOM and renders once per state change. |
| No database; data stays local | `storage.local` with `unlimitedStorage`. Each top-level key is one document: `profile`, `settings`, `resumes`, `answers`, `applications`, `logs`. Backup and restore use a JSON export. |
| Free AI | Gemini, Groq and OpenRouter free tiers, or local Ollama. AI is optional, and matching works offline. |
| Learns about the user | `answers` maps a normalized question to the user's answer. It is written when the user changes a form field on a page where they used Autofill. Lookup tries an exact key first, then token Jaccard similarity ≥ 0.75. |
| Logs users can share | Every context logs through `AJP.logger(module)`. Entries are redacted, batched, and sent to the background, which is the single writer of a 3,000-entry ring buffer. Admin → Logs lets the user view, filter and download them. |

## Contexts and data flow

```
 ┌────────────── web page (each frame) ──────────────┐
 │ jd-extractor → matcher → panel (top frame only)   │
 │ form-filler (fills, learns)                       │
 └──────────────┬────────────────────────────────────┘
                │ runtime messages
 ┌──────────────▼──────────────┐      ┌───────────────────────────┐
 │ background                  │─────▶│ AI provider (HTTPS/local) │
 │  message router             │      └───────────────────────────┘
 │  AI tasks (keys stay here)  │
 │  writes: logs, answers,     │
 │    applications, tailored   │
 │    resumes                  │
 └──────────────┬──────────────┘
                │ storage.local
 ┌──────────────▼──────────────┐
 │ Admin page / popup          │  writes: profile, settings, resumes
 └─────────────────────────────┘
```

Single-writer rule: to avoid lost updates, every key has one owner. The background serializes its writes with `AJP.serial()`.

## Match score

Each skill mentioned in the job description gets a weight based on where it appears:

- **required** section: 3
- unlabeled: 2
- **preferred** or "nice to have": 1

A skill mentioned repeatedly gets a bonus of up to +0.5.

The user's skill set is the union of the skills in their profile and the skills detected in their active resume.

`score = round(100 × Σ weight(matched) / Σ weight(all JD skills))`

AI deep analysis adds the required and preferred skills the AI extracts, then re-scores.

## Job description extraction order

1. schema.org `JobPosting` JSON-LD. This is the most reliable source and is present on most applicant tracking system (ATS) pages.
2. Site-specific selectors, listed in `jd-extractor.js` under `SITES`. On LinkedIn these are tried first, because it is a single-page app (SPA).
3. A heuristic: the visible container with the highest density of job-description keywords.
4. Manual fallback: the user selects the text, right-clicks, and chooses **analyze selection**.

## Autofill

- Each field gets a label, taken in this order: `label[for]`, then `aria-labelledby` or `aria-label`, then a nearby label or legend, then the placeholder or name.
- `RULES` in `form-filler.js` maps label patterns to profile values. If no rule matches, the learned answers are checked. Long-text questions are sent to the panel, where the user can ask the AI to draft an answer.
- Values are set with the native value setter plus `input`, `change` and `blur` events, so React and Vue forms register them.
- Selects and radio buttons use fuzzy option scoring. This includes matching "decline to self-identify" equivalents.
- The resume file is attached through `DataTransfer`.
- **Never** submits the form, never overwrites a value the user typed, and never learns passwords, SSNs, bank details or dates of birth.

## Security & privacy notes

- API keys are used only in the background context and are never exposed to page scripts.
- EEO answers are used only to fill EEO fields. They are never sent to the AI and are redacted from logs.
- Job-site passwords are deliberately **not** stored. The browser's password manager should handle them.

## Roadmap (next feature branches)

1. `feature/pdf-text`: vendor pdf.js so text is extracted from PDF resumes automatically.
2. `feature/workday-widgets`: support Workday's custom dropdowns, date pickers, and the multi-page "My Experience" step (repeatable experience and education entries).
3. `feature/resume-export`: generate DOCX and PDF files from tailored resumes, so the tailored file is what gets attached.
4. `feature/site-adapters`: per-ATS adapters (Greenhouse, Lever, Ashby, iCIMS) for higher fill accuracy.
5. `feature/chrome-builtin-ai`: Chrome's on-device Gemini Nano (Prompt API) as a zero-key, private provider.
6. `feature/match-v2`: skill synonyms and embeddings, seniority and years-of-experience checks.
7. Packaging: store builds (Chrome Web Store, AMO, Edge Add-ons, Safari App Store) and CI that runs the tests.
