# Apply Job Assistant (apply-job-plugin)

A browser extension that runs in Chrome, Edge, Firefox and Safari. For any job posting it:

1. **Reads the job description** and calculates a **match % (0–100)** against your skills.
2. Shows **matching vs. missing skills** (gaps), plus work-type, salary and location fit.
3. **Tailors your resume** to the job with a free AI model, using only truthful changes. It never invents skills.
4. **Autofills application forms** (Greenhouse, Lever, Workday, Ashby, …) from your profile, attaches your resume, and uses AI to draft answers to free-text questions such as "Why do you want to work here?".
5. **Learns** from what you type into forms, so the same question gets filled automatically next time.

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
| **Safari** (macOS) | `xcrun safari-web-extension-converter /path/to/apply-job-plugin` → open the generated Xcode project → Run → Safari → Settings → Extensions → enable it (also enable *Develop → Allow Unsigned Extensions*). |

After installing, the **Admin** page opens automatically. You can reopen it from the toolbar popup at any time, using **⚙ Open Admin**.

## First-time setup (Admin page)

1. **Profile**: name, contact details, links, current role.
2. **Skills**: add your key skills, with an optional level and years. Aliases are normalized, so `k8s` becomes Kubernetes.
3. **Job preferences**: target positions, salary range, locations, and remote/hybrid/on-site.
4. **Resumes**: upload a `.pdf`, `.docx`, `.txt` or `.md` file. For PDFs, also paste the text in. Then click **Detect skills from my active resume**.
5. **Auto-apply details**: work authorization, sponsorship, education, experience, optional EEO answers, and a cover letter template.
6. **AI settings** (optional): pick a free provider and click **Test connection**.

## Using it

- **On known job sites**, a small match badge appears automatically. Click it to expand the panel. Known sites: LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, ZipRecruiter, Ashby, SmartRecruiters, iCIMS and Workable.
- **On any other site**, click the toolbar icon, then **Analyze this job page**.
- **Anywhere**, select the job description text, right-click, and choose **Apply Job: analyze selection as job description**.
- In the panel you can use **AI deep analysis**, **Tailor resume**, **Autofill form** and **Mark applied**.
  - Green outlines show fields filled from your profile. Purple outlines show fields filled from learned answers.
  - Free-text questions get a **Draft answer with AI** button.

## Free AI options

| Provider | Cost | Get a key |
|---|---|---|
| Google Gemini | Free tier | https://aistudio.google.com/apikey |
| Groq | Free tier | https://console.groq.com/keys |
| OpenRouter | Free `:free` models | https://openrouter.ai/keys |
| Ollama | Free, runs locally, fully private | https://ollama.com, then start it with `OLLAMA_ORIGINS="*" ollama serve` |

The extension does **not** log into the free ChatGPT, Claude or Gemini chat websites. Automating those consumer apps violates their terms, and it breaks whenever their UI changes. Free API keys are the supported route. API keys are stored locally and are used only from the background script, never inside web pages.

## Logs (for support requests)

Go to **Admin → Logs → Download logs** and attach the `.json` file to your issue.

- The logs record what happened (page extraction, match timings, autofill counts, AI errors), with context and timestamps.
- API keys, email, phone and EEO answers are **redacted automatically**.
- Set the log level to **debug** before you reproduce a problem to get more detail.
- In the browser console, every entry is prefixed with `[AJP][context][module]`.

## Development

```
manifest.json            MV3, cross-browser (service_worker for Chrome/Edge, scripts for Firefox/Safari)
src/lib/                 shared, framework-free modules (namespace: globalThis.AJP)
  core.js                helpers, browser API shim
  logger.js              structured + redacted logging
  storage.js             local "database" (storage.local + in-memory cache)
  skills-dictionary.js   canonical skills + aliases
  matcher.js             offline match % / gaps / fit
  ai.js                  free AI providers + prompts (background only)
  docx.js                .docx text extraction, zero dependencies
src/background/          message hub, AI calls, log persistence, learning
src/content/             JD extractor, form filler, on-page panel, controller
src/admin/               Admin page (local UI) + printable resume view
src/popup/               toolbar popup
tests/                   automated tests (harness, browser mock, unit + end-to-end), sample job page
docs/ARCHITECTURE.md     design notes and roadmap
```

- **Tests:** `./tests/run-browser-tests.sh` runs the full suite (279) in headless Chrome. `./tests/run-tests.sh` runs the 139 that need no browser. You can also open `tests/test-runner.html` in any browser. See [docs/TEST-SCENARIOS.md](docs/TEST-SCENARIOS.md) for what's covered and the manual checklist.
- **Manual check:** run `python3 tests/serve.py`, open `http://127.0.0.1:8765/tests/fixtures/sample-job.html`, click the extension icon, then **Analyze**, then **Autofill**.
- Branching: `develop` is the integration branch. New work goes on `feature/<name>`, which is merged into `develop` through a PR.

## License

GPL-3.0. See [LICENSE](LICENSE).
