# Test scenarios

There are two layers of tests:

1. **Automated tests** (391). Run them before every merge into `develop`.
2. **Manual scenarios** (below). Run these in real browsers on real job sites before a release.

## 1. Automated tests

| Command | What it runs | Time |
|---|---|---|
| `./tests/run-tests.sh` | The **216** tests that need no browser: helpers, matcher, log redaction, AI output parsing, autofill rules. Uses Node, or macOS JavaScriptCore if Node isn't installed. | ~1 s |
| `./tests/run-browser-tests.sh` | All **391** tests in headless Chrome. This is the full suite: the 216 above plus real forms, page reading, storage, background and end-to-end flows. | ~5 s |
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
| Word resumes | `unit/docx.test.js` | Compressed and uncompressed .docx, special characters, invalid files |
| Autofill | `unit/form-filler.test.js` | 54 label→field rules; option matching incl. "decline to answer"; label detection (label tag, aria, Workday markup, placeholder, name); full form fill: text, select, radio, resume file, learned answers, free-text questions, unknown fields; **never fills password/hidden/disabled fields, never overwrites what the user typed, never submits**; React-style inputs; learning typed, select and radio answers; **never learns SSN or passwords**; ignores its own fills; respects the "learn answers" setting |
| Job page reading | `unit/jd-extractor.test.js` | Structured job data (JSON-LD, incl. @graph), Greenhouse, Lever, Workday, Indeed and LinkedIn layouts (on LinkedIn the job currently shown wins over stale data), fallback when a site changes its layout, fallback that ignores navigation and footer, no job description, look-alike domains |
| Panel | `unit/panel.test.js` | Score, skill chips, fit, **HTML from the job page cannot run inside the panel**, page CSS can't break it, buttons, busy state, autofill report |
| Tracker logic | `unit/tracker.test.js` | Same job across URLs for 8 sites; duplicate detection; saving rules (**automatic updates never move status backwards**, empty values never wipe data, Undo); confirmation and Submit wording incl. look-alikes that must NOT count; follow-up and interview reminders; stats; CSV escaping and formula-injection blocking |
| Tracker end-to-end | `unit/tracker-flow.test.js` | Submit + "Thank you" → applied with snapshot; normal form submit; confirmation-page URL; ignored on unknown sites; newsletter forms ignored; JD text mentioning submission ignored; "Did you submit?" Yes/No; auto-detect setting; job context passed to new tabs; tab cleanup; duplicate warning; reminder badge |
| Admin tracker UI | `unit/admin.test.js` | Loads the real Admin page: stats, board columns, drag & drop, search / due filters, table view, detail dialog saving (no lost edits, no timezone shift), "I followed up", HTML escaping, CSV export, empty state |
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
| B7 | Upload a PDF resume | Saved with a hint to paste the text; paste it, reload, and the text is kept |
| B8 | Click "Detect skills from my active resume" | The skills found in the resume are added to the skills list |
| B9 | Resume: rename it, make it active, View / save as PDF, download .md, delete it | Each action works. The PDF page prints cleanly. |
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
| C12 | Turn off "Show the match badge automatically" in Admin | No badge on job sites, but the popup's Analyze still works |
| C13 | Panel: drag it, minimize it, close it | Works. Closing removes it until the next Analyze. |
| C14 | Browser pages (`chrome://`, the Web Store, a PDF viewer) → popup → Analyze | A readable error: "This page cannot be accessed by extensions" |

### D. Resume tailoring
| ID | Steps | Expected |
|---|---|---|
| D1 | Panel → Tailor resume (with AI on and a resume saved) | "Saved 'Tailored — Company — Role'" with a link to it |
| D2 | Open it in Admin → Resumes | A new version with gap notes. Your original resume is unchanged and still active. |
| D3 | Read it carefully | No invented employers, dates, degrees, certifications or skills |
| D4 | Tailor resume with no resume saved | A clear error: "No resume text found…" |

### E. Autofill & applying
| ID | Steps | Expected |
|---|---|---|
| E1 | Greenhouse application → Autofill form | Name, email, phone, LinkedIn and location filled (green outline); resume attached; work authorization and sponsorship answered |
| E2 | Lever application | Same as E1 |
| E3 | Workday application, page 1 | Text fields filled. **Known gap:** Workday's custom dropdowns aren't filled yet. |
| E4 | Ashby, SmartRecruiters, iCIMS applications | Text fields and native dropdowns filled |
| E5 | EEO section | Matches your Admin answers. "Decline to self-identify" maps to the site's wording. |
| E6 | A field you'd already typed into before clicking Autofill | Left unchanged |
| E7 | A "Why do you want to work here?" box → Draft answer with AI | Text inserted into that box; it's specific and uses only facts from your resume |
| E8 | Type answers into unknown questions, then open another application with the same question → Autofill | Filled from learned answers (purple outline). Admin → Learned answers shows it. |
| E9 | Type into a password or SSN field | It does **not** appear in Learned answers |
| E10 | After Autofill, check the page | **Nothing was submitted.** The panel says "Review everything, then submit yourself". |
| E11 | Click Mark applied | Admin → Applications shows the job with status "applied" and its score |
| E12 | Change the status in Admin → Applications, or delete the entry | Kept |
| E13 | An application form inside an iframe (a company site embedding Greenhouse) | Fields inside the iframe are filled |

### F. Logging & support
| ID | Steps | Expected |
|---|---|---|
| F1 | Do C1, then E1, then open Admin → Logs | Entries from `content`, `bg` and `admin` with timestamps |
| F2 | Cause an AI error (wrong key), then look at the Logs | An `error` entry naming the provider, model and HTTP status, with **no key shown** |
| F3 | Download logs | The .json file contains version, browser and setup info plus the logs. Search it for your email, phone and API key: none of them should be found. |
| F4 | Set the log level to debug, repeat C1 | More detail is logged (timings, messages) |
| F5 | Filter by level / search / Clear | Works |
| F6 | Open the browser console on a job page | Entries prefixed `[AJP][content][…]` |

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

### H. Performance
| ID | Steps | Expected |
|---|---|---|
| H1 | Time from opening a job page to the badge appearing | About 1.5 s or less (mostly the deliberate wait for the page to finish loading) |
| H2 | Match time shown in the panel ("· N ms") | Under 50 ms |
| H3 | Autofill on a 30-field form | Under 1 s |
| H4 | Use the extension for a day (hundreds of job pages) | No slowdown. The log stays at 3,000 entries or fewer. |
