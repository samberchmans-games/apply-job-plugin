# Apply Job Assistant (apply-job-plugin)

[![CI](https://github.com/samberchmans-games/apply-job-plugin/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/samberchmans-games/apply-job-plugin/actions/workflows/ci.yml)

A browser extension that runs in Chrome, Edge, Firefox and Safari. For any job posting it:

1. **Reads the job description** and calculates a **match % (0–100)** against your skills. Related skills count too: Next.js counts as React, and Azure gives half credit for AWS.
2. Shows **matching vs. missing skills** (gaps), plus work-type, salary, location, **years of experience** (overall and per skill) and **seniority level** fit.
3. **Tailors your resume** to the job with a free AI, using only truthful changes:
   - It lists the job's requirements and finds proof for each one in **your own resume text**.
   - It suggests targeted, **result-oriented** edits (action → what → result).
   - It **never copies the job's numbers** ("10TB", "20+ APIs", "<5% defects"), never invents numbers, skills or employers, and never changes names, titles or dates.
   - These rules are checked in code, not just requested in the prompt.
   - You review every change and add your real results before anything is created.
4. **Autofills application forms** (Greenhouse, Lever, Ashby and iCIMS including their searchable dropdowns and Yes/No buttons; Workday incl. its dropdowns, dates and multi-page experience entries; work experience and education "Add another" sections on any site; and more) from your profile, attaches your resume, and uses AI to draft answers to free-text questions such as "Why do you want to work here?".
5. **Learns** from what you type into forms, so the same question gets filled automatically next time.
6. **Career tracks:** looking in two or three directions (e.g. AWS Cloud Architect and Java Architect)? Every job is scored against each track, the best one is picked automatically, and tailoring, autofill and applications use that track's skills and resume.
7. **Tracks your applications.** It notices when you submit, keeps a copy of each job description, and gives you a pipeline board, follow-up reminders, stats, and CSV export.

It **never submits** an application. You always review and click submit yourself.

All data stays on your computer, in the browser's local extension storage. There is no server, no database and no account. The only data that leaves your machine is the text you choose to send to the AI provider you configure.

---

## Install (developer mode)

Clone the repo, then load the folder that contains `manifest.json`. No build step is needed.

| Browser | Steps |
|---|---|
| **Chrome** | `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the repo folder |
| **Edge** | `edge://extensions` → **Developer mode** → **Load unpacked** → select the repo folder |
| **Firefox** (121+) | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json`. Then open the extension's **Permissions** tab and allow the job sites (Firefox MV3 treats host permissions as opt-in). |
| **Safari** (macOS) | `sh tools/safari.sh` (needs Xcode) → open `dist/safari-project/…/Apply Job Assistant.xcodeproj` → pick your team under Signing → Run → Safari → Settings → Extensions → enable it (for unsigned builds also *Develop → Allow Unsigned Extensions*). |

After installing, the **Admin** page opens automatically. You can reopen it from the toolbar popup at any time, using **⚙ Open Admin**.

### Store packages

`python3 tools/package.py` builds `dist/apply-job-assistant-<version>-{chrome,edge,firefox,safari}.zip`, each with the manifest that store expects, and checks them. CI builds the same zips on every push (download them from the run's **store-packages** artifact). Listing texts, screenshots, privacy policy and the submission checklist are in [docs/store/](docs/store/).
Quick test of a package: Firefox → `about:debugging` → This Firefox → **Load Temporary Add-on** → pick the firefox zip. Chrome/Edge: unzip the chrome zip, then **Load unpacked**.

## First-time setup (Admin page)

1. **Profile**: name, contact details, links, current role.
2. **Skills**: add your key skills, with an optional level and years. Aliases are normalized, so `k8s` becomes Kubernetes.
3. **Job preferences**: target positions, salary range, locations, and remote/hybrid/on-site.
4. **Resumes**: upload a `.pdf`, `.docx`, `.txt` or `.md` file. The text is read automatically; check it in the box (scanned, image-only PDFs need the text pasted). Your skills are picked up from it automatically, with years and level estimated from your job dates (check them in **Skills**; anything you remove is not added back, anything you set yourself is kept). Applications always get a **PDF**: your own PDF as uploaded, or a clean PDF made from the text (⬇ Download PDF / 👁 View PDF). Tailored resumes get their own PDF, and Autofill uploads the one tailored for the job you're on.
5. **Auto-apply details**: work authorization, sponsorship, education, experience, optional EEO answers, and a cover letter template.
6. **AI settings** (optional): pick a free provider and click **Test connection**.

## Using it

- **On known job sites**, a small match badge appears automatically. Click it to expand the panel. Known sites: LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, ZipRecruiter, Ashby, SmartRecruiters, iCIMS and Workable.
- **On any other site**, click the toolbar icon, then **Analyze this job page**.
- **Anywhere**, select the job description text, right-click, and choose **Apply Job: analyze selection as job description**.
- In the panel you can use **AI deep analysis**, **Tailor resume**, **Autofill form** and **Mark applied**.
  - **Tailor resume** shows a summary, then opens **Admin → Resumes** for review: what the job asks for and your evidence, each change before → after, blocked changes and why, and gaps with honest advice. Tick the changes you want, type your real numbers where asked, then click **Create tailored resume**. For best results, put one achievement per line, starting with `-` or `•`.
  - Green outlines show fields filled from your profile. Purple outlines show fields filled from learned answers.
  - Free-text questions get a **Draft answer with AI** button.
- **When you submit an application**, the confirmation page is detected and the job is saved as *applied*, with an Undo option. If a site shows no confirmation, the panel asks you.
- **Job Radar (Admin → Job Radar)** finds new jobs that fit you. It comes with a **built-in directory of 300+ companies** (Greenhouse, Lever, Ashby; checked a slice at a time, all of them about once a day; click **Allow all 11 job boards** once to start), and you can add your own: paste a careers link (Greenhouse, Lever, Ashby, Workable, Recruitee, Breezy HR, SmartRecruiters, Rippling, Personio, Teamtailor or Workday; or the company's own careers page that embeds one), or click **Watch this company** in the job panel. Every few hours (default 3) it reads each company's public job board, scores new jobs like a job page, and shows them by match; it looks for each of your career tracks (up to 3: their titles first, then their places and work types); jobs posted today or this week are marked (apply early), with a **Newest first** sort; jobs whose text conflicts with your work authorization ("no visa sponsorship", "U.S. citizens only", clearances; set in Auto-apply details) are shown apart with the reason and never alerted. Matches from 60% raise a blue number on the toolbar icon and a notification (one summary a day by default). **Save** adds a job to Applications with its description; **Dismiss** hides it for good. The browser asks once per job board for permission to read it. LinkedIn, Indeed, Glassdoor, ZipRecruiter and iCIMS have no public feed, so they aren't watched (the panel still scores their job pages).
- **In Admin → Applications** you get a board (drag cards between statuses), notes and interview dates, the saved job description, stats, and **Export CSV**. A number on the toolbar icon tells you when follow-ups are due.

## Free AI options

| Provider | Cost | Get a key |
|---|---|---|
| **Chrome built-in AI** | Free, no key, runs on your computer | Desktop Chrome 138+: Admin → AI settings → Chrome built-in AI → Download the on-device model (one time) |
| Google Gemini | Free tier | https://aistudio.google.com/apikey |
| Groq | Free tier | https://console.groq.com/keys |
| OpenRouter | Free `:free` models | https://openrouter.ai/keys |
| Ollama | Free, runs locally, fully private | https://ollama.com, then start it with `OLLAMA_ORIGINS="*" ollama serve` |
| NVIDIA NIM | Free API key (NVIDIA Developer account) | https://build.nvidia.com |
| Mistral | Free plan API key (turn off training on your prompts in its privacy settings) | https://console.mistral.ai/api-keys |
| Anthropic Claude | **Paid, optional**: per use from prepaid API credit (a Claude.ai / Claude Code plan doesn't cover it). Default `claude-opus-5-5`; `claude-sonnet-5-5` or `claude-haiku-5-5` cost less | https://console.anthropic.com/settings/keys |

The extension does **not** log into the free ChatGPT, Claude or Gemini chat websites. Automating those consumer apps violates their terms, and it breaks whenever their UI changes. Free API keys are the supported route. API keys are stored locally and are used only from the background script, never inside web pages.

## Getting help (logs & issue reports)

To report a problem, go to **Admin → Logs & support → 🆘 Report an issue**, or click **Report a problem** in the toolbar popup.
1. Describe what happened.
2. Click **Download report**.
3. Send the file. You can also use **Copy summary** to paste a short version into a message.

What's in the logs and reports:
- **Every error has a code**, for example `AJP-AI-429` (free AI limit reached). The panel shows the code along with a hint on how to fix it.
- **Each action has a trace id**, so one problem can be followed from the job page through the background to the AI and back.
- **Slow steps are flagged** with their duration.
- **The details just before an error are kept**, even at the normal log level.
- **Nothing personal is included.** API keys, passwords, emails, phone numbers, SSNs, EEO answers and resume content are removed automatically.

**Report it on GitHub from the extension:** in the report dialog click **🐙 Report on GitHub**. The form opens pre-filled (summary only); you review it and submit. **My reports** then shows its status (received, being fixed, fixed in vX). If something fails in the background, the extension asks whether to report it, and never sends anything without you. You can also [open a problem report](https://github.com/samberchmans-games/apply-job-plugin/issues/new?template=bug_report.yml). The form asks for the report id and error code, and you'll get an automatic acknowledgement. Fixes are tracked on the issue; see [docs/ISSUE-REPORTING.md](docs/ISSUE-REPORTING.md). No GitHub account? Email the report file to the person who invited you.

If you handle support, see [docs/SUPPORT.md](docs/SUPPORT.md) for how to read a report, plus the full list of error codes.

## Development

```
manifest.json            MV3, cross-browser source manifest (tools/package.py writes the per-store versions)
tools/                   package.py (store zips), store_assets.py (screenshots), safari.sh (Xcode project)
docs/store/              store listing, privacy policy, submission checklist, screenshots
src/lib/                 shared, framework-free modules (namespace: globalThis.AJP)
  core.js                helpers, browser API shim
  logger.js              structured, redacted logging: sessions, trace ids, timings, flight recorder
  errors.js              error codes (AJP-…) with user messages and hints
  diagnostics.js         "Report an issue" bundle (environment, counts, health, error summary, logs)
  resume-engine.js       resume tailoring: strict prompts, edit validator (truth rules), assembly
  storage.js             local "database" (storage.local + in-memory cache)
  skills-dictionary.js   canonical skills + aliases
  matcher.js             offline match % / gaps / fit
  experience.js          years of experience & seniority checks
  ai.js                  free AI providers + prompts (background only)
  docx.js                .docx text extraction, zero dependencies
  tracker.js             application tracker logic (job identity, saving rules, reminders, stats, CSV)
src/background/          message hub, AI calls, log persistence, learning
src/content/             JD extractor, form filler, on-page panel, controller
src/admin/               Admin page (local UI)
src/popup/               toolbar popup
tests/                   automated tests (harness, browser mock, unit + end-to-end), sample job page
docs/                    TRACKER.md (status), PLAN.md (roadmap), ARCHITECTURE.md, TEST-SCENARIOS.md, SUPPORT.md
```

- **Checks:** `sh tests/check.sh` (manifest, files, syntax). **CI** runs checks + all tests on every push (badge above).
- **Tests:** `./tests/run-browser-tests.sh` runs the full suite (1305) in headless Chrome. `./tests/run-tests.sh` runs the 638 that need no browser.
- **Workday emulation:** `python3 tests/serve.py`, then open `http://127.0.0.1:8765/tests/fixtures/workday-sample.html` to try Workday autofill locally.
- **Greenhouse / Lever / Ashby / iCIMS emulations:** same server, open `http://127.0.0.1:8765/tests/fixtures/ats-sample.html` and switch sites at the top.
- **Tester videos:** `python3 video/build.py [part]` renders the walkthrough parts to `video/out/` (needs Chrome, ffmpeg, macOS `say`). You can also open `tests/test-runner.html` in any browser. See [docs/TEST-SCENARIOS.md](docs/TEST-SCENARIOS.md) for what's covered and the manual checklist.
- **Manual check:** run `python3 tests/serve.py`, open `http://127.0.0.1:8765/tests/fixtures/sample-job.html`, click the extension icon, then **Analyze**, then **Autofill**.
- Branching: `develop` is the integration branch. New work goes on `feature/<name>`, which is merged into `develop` through a PR.

## License

GPL-3.0. See [LICENSE](LICENSE).
