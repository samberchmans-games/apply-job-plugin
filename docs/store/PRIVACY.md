# Privacy policy — Apply Job Assistant

_Last updated: 18 November 2026 · applies to version 0.1.0 and later_

Apply Job Assistant is a browser extension that helps you judge job posts against your own profile, tailor your resume honestly, and fill application forms. It is built so that **your data stays on your computer**.

## What the extension stores, and where

Everything you enter or the extension learns is stored **only in your browser's extension storage on this computer**:

- your profile (contact details, skills, salary and job preferences, work and education history, optional equal-opportunity (EEO) answers)
- your resumes and their PDF files
- answers it learned from forms you filled
- the applications you tracked
- your settings, including any AI API keys you added
- technical logs for support

The developer has **no server** and receives **none** of this. There is no account, no analytics, no tracking and no advertising.

## When anything leaves your computer

Only in these cases, and only after you set them up or click:

| When | What is sent | To whom |
|---|---|---|
| You choose a **cloud AI provider** (Google Gemini, Groq, OpenRouter) in AI settings, add **your own** API key, and click an AI button (AI deep analysis, Tailor resume, Draft answer, Test connection) | The job description, your resume text, your skills, and the question being answered. **Never** your EEO answers, passwords or API keys of other providers | The AI provider you chose, under their terms and privacy policy |
| You choose **Ollama** or **Chrome built-in AI** | The same text, but it is processed **on your computer**. Nothing leaves it | Nobody |
| You click **Report on GitHub** and submit the form yourself | A short summary you can read and edit first: the error code, browser and extension version. Emails, phone numbers, links and keys are removed. Logs are never included in public issues | GitHub (public issue on the project) |
| You open **My reports** or the report dialog | A search for the error code or report id (no personal data) | GitHub's public API |

Job sites you visit receive only what you submit yourself. The extension **never submits an application for you**, and **never stores job-site passwords**.

## Your control

- **See and edit** everything in the extension's Admin page.
- **Export** a backup (API keys are excluded unless you choose to include them).
- **Delete** everything: Admin → Backup & privacy → Delete all data, or remove the extension.
- **Turn off** answer learning in AI settings → Behaviour.

## Permissions and why they're needed

- **storage, unlimitedStorage:** keep your data on your computer; resumes with PDF files and logs can exceed the default 10 MB.
- **activeTab, scripting:** read the job post on the current tab and fill forms when you click; show the panel on sites that are not in the list.
- **contextMenus:** "Analyze selection" on the right-click menu.
- **alarms:** follow-up reminders for your applications, and checking the status of problems you reported.
- **Job sites** (LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, ZipRecruiter, Ashby, SmartRecruiters, iCIMS, Workable): show the match badge and autofill.
- **AI provider addresses and localhost:** contact only the AI provider you set up, or Ollama on your own computer.
- **api.github.com:** the public problem-report status lookups described above.

## Children

The extension is meant for job seekers and is not directed at children under 13.

## Changes and contact

Changes to this policy are published in the project repository with the release that introduces them.
Questions: open an issue at https://github.com/samberchmans-games/apply-job-plugin/issues
