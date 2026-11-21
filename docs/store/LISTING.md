# Store listing — Apply Job Assistant

Copy these into the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO) forms.
Packages: `python3 tools/package.py` → `dist/apply-job-assistant-<version>-{chrome,edge,firefox}.zip`.
Images: `python3 tools/store_assets.py` → `docs/store/screenshots/`.

## Name and summary

- **Name:** Apply Job Assistant
- **Summary (≤ 132 characters, also the manifest description):**
  Match % and skill gaps for any job post, honest resume tailoring, and form autofill that learns. All data stays on your computer.
- **Category:** Chrome: Productivity → Tools · Edge: Productivity · Firefox: Other / Productivity (closest available)
- **Language:** English
- **Support / homepage:** https://github.com/samberchmans-games/apply-job-plugin (issues: …/issues)
- **Privacy policy URL:** https://github.com/samberchmans-games/apply-job-plugin/blob/main/docs/store/PRIVACY.md
  (merge to `main` first, or use the `develop` link until then)

## Description

> **Know your fit before you apply, and apply faster, without giving up your data.**
>
> Apply Job Assistant reads the job post you're looking at and compares it with your own profile:
>
> • **Match % and skill gaps:** skills you have (green), skills you're missing (red), and nice-to-haves (amber). Related skills count too: Next.js counts as React, Azure earns half credit for AWS.
> • **Fit at a glance:** work type, salary, location, years of experience and seniority level against your preferences.
> • **Honest resume tailoring (optional AI):** suggests targeted, result-oriented rewrites that are backed by your real resume. Numbers from the job post are never copied into your resume, and invented skills, employers or results are blocked. You review every change.
> • **Autofill that learns:** fills application forms from your profile on LinkedIn, Greenhouse, Lever, Workday, Ashby, iCIMS and more, including their custom dropdowns, and remembers the answers you type for next time. It never submits for you.
> • **Your resume as a PDF:** the version tailored for the job is uploaded automatically.
> • **Application tracker:** every application on a board, with follow-up reminders and CSV export.
> • **Career tracks:** looking for two kinds of roles? Each job is scored against each track.
>
> **Private by design.** Everything stays in your browser on your computer: no account, no server, no analytics. AI is optional. Use Chrome's built-in on-device AI (no key needed), Ollama on your computer, or a free API key from Google Gemini, Groq or OpenRouter. Text is sent to that provider only when you click an AI button, and your equal-opportunity answers are never sent.
>
> Free and open source (GPL-3.0).

## Screenshots (1280×800) and promo images

| File | Caption |
|---|---|
| `screenshots/1-match-and-gaps.png` | Match % and skill gaps on any job post |
| `screenshots/2-experience-level.png` | Years of experience, level and similar skills |
| `screenshots/3-tailoring-evidence.png` | Honest resume tailoring: every change backed by your resume |
| `screenshots/4-autofill.png` | Autofill from your profile; you review and submit |
| `screenshots/5-applications.png` | Track every application, with follow-up reminders |
| `screenshots/6-career-tracks.png` | One score per career track; the best fit is starred |
| `screenshots/promo-small-440x280.png` | Chrome Web Store small promo tile |
| `screenshots/promo-marquee-1400x560.png` | Chrome Web Store marquee (optional) |

Store icon: `icons/icon-128.png`.

## Single purpose (Chrome Web Store)

Help a job seeker evaluate job postings against their own profile and fill job application forms, with all data kept on their computer.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Saves the user's profile, resumes, learned answers, tracked applications and settings locally. |
| `unlimitedStorage` | Resumes are kept with their PDF files, plus support logs; together they can exceed the 10 MB default. |
| `activeTab` | Reads the job post on the current tab when the user clicks "Analyze this job page". |
| `scripting` | Injects the reader and the panel into the current tab (and its application-form frames) when the user asks, on sites not in the content-script list. |
| `contextMenus` | Adds "Apply Job: analyze selection" to the right-click menu. |
| `alarms` | Follow-up reminders for tracked applications; periodic status check of problems the user reported on GitHub. |
| Content scripts on job sites (LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, ZipRecruiter, Ashby, SmartRecruiters, iCIMS, Workable) | Show the match badge and fill application forms on those sites. |
| `generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, `integrate.api.nvidia.com`, `api.mistral.ai`, `api.anthropic.com` | Only when the user chooses that AI provider and adds their own key: send the job post and resume text for the AI features they click. |
| `localhost:11434` / `127.0.0.1:11434` | Ollama running on the user's own computer (optional AI). |
| `api.github.com` | Public search for a problem report's status and similar reports (error code / report id only). |

**Remote code:** none. All code ships in the package, including Mozilla pdf.js 4.10.38 (`src/vendor/pdfjs`, unmodified files from npm `pdfjs-dist`, used to read PDF resumes).

## Data use disclosures

The developer collects **no** data: there is no server. For the Chrome Web Store "Privacy practices" form, which also counts data the extension *handles* and sends to third parties at the user's request, the recommended answers are:

- **Personally identifiable information:** yes (name, email, phone, resume). Stored locally; sent only to the AI provider the user configures, when they click an AI feature.
- **Website content:** yes (the job post text). Same handling.
- **All other categories:** no. This covers health, financial and payment, authentication (job-site passwords are never stored), personal communications, location beyond what the user types in, web history, and user activity.
- **Certify:** data is not sold; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

Firefox (`data_collection_permissions`) is declared as `required: ["none"]`, because nothing is sent to the developer. If an AMO reviewer considers the user-initiated AI requests to be "transmission", change it to `optional: ["personallyIdentifyingInfo", "websiteContent"]` and ask for consent in AI settings before the first cloud request. See SUBMISSION.md, "Decisions".

## Notes for reviewers

- No account or login is needed. Install, open the Admin page (it opens by itself), and fill in a name, a few skills and a resume (paste any text with lines starting with "-").
- Open any public job post, for example on `boards.greenhouse.io` or `jobs.lever.co`. A match badge appears; click it for the panel.
- On an application form, click **⚡ Autofill form**. Fields are filled; **nothing is submitted**.
- AI features are optional and off by default. To try them without a key, choose **Chrome built-in AI** (Chrome 138+ on desktop) in Admin → AI settings.
