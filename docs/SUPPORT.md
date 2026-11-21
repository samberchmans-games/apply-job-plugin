# Support guide

How to help a user who reports a problem.

## 0. Where reports arrive
Problem reports arrive as **GitHub issues** (form: *Problem report*), with an automatic acknowledgement and labels. The triage and fix workflow is in [ISSUE-REPORTING.md §7](ISSUE-REPORTING.md#7-maintainer-workflow-how-we-take-it-and-fix-it). Users without GitHub email the report file; file an issue for them with the same form.

## 1. What to ask the user for
Ask them to go to **Admin → Logs & support → 🆘 Report an issue** (or **Report a problem** in the toolbar popup). There they:
1. describe what happened, which site, and what they expected
2. click **Download report** and send you the file `apply-job-report-R-YYYYMMDD-XXXXX.json`
3. optionally, click **Copy summary** and paste it into their message

If the problem repeats, ask them to first set **Log level → debug**, reproduce the problem once, and then report it.

The report is safe to share. Passwords, API keys, emails, phone numbers, SSNs, EEO answers and resume content are never included. Keys are removed by name, and values are masked by pattern as a final step.

## 2. Reading a report
| Field | What it tells you |
|---|---|
| `reportId` | Quote it in replies |
| `description` | The user's own words |
| `environment` | Extension version, browser and version, OS, language, time zone |
| `settings` | AI provider and model, whether a key is set (true/false only), log level, auto-detect and learning switches |
| `data` | **Counts only**: which profile fields are filled, number of skills, resumes (has text? has file?), learned answers, applications by status |
| `health.background` | `ok: false` means the background script isn't responding. Ask the user to reload the extension. |
| `health.storage` | `ok: false` means browser storage is blocked or full |
| `errors.byCode` | Error counts by code. Start here. |
| `errors.last` | The last 20 errors, with full detail |
| `sessions` | One row per page or background run (`sid`), with entry and error counts |
| `logs` | Recent entries, oldest first |

### Log entry fields
`t` time · `lvl` level · `ctx` where it ran (`bg` background, `content` job page, `frame` iframe on the page, `admin`, `popup`) · `sid` session · `mod` module · `msg` · `data` · `code` · `tid` · `pre`

- **`tid` (trace id)** follows **one user action** from start to finish: the panel button, the background message, the AI call, and the result. Filter on a `tid` to see the whole story. In Admin → Logs, clicking a trace id does this.
- **`pre: true`** marks detail entries that were below the log level but were kept because an error followed (the "flight recorder"). These show what happened just before an error, even when the user's log level is `info`.
- Actions that take longer than expected are logged as `warn` with a message ending in `slow`, including `ms`.

## 3. Error codes
| Code | Meaning | Usual fix |
|---|---|---|
| `AJP-AI-OFF` | AI is turned off | Pick a provider in Admin → AI settings |
| `AJP-AI-KEY` | No API key saved for the chosen provider | Add the key, then Test connection |
| `AJP-AI-401` | The provider rejected the key (401/403) | Copy the key again from the provider; check for extra spaces |
| `AJP-AI-429` | Free-tier rate limit reached | Wait a minute, or switch provider (e.g. Groq ↔ Gemini) |
| `AJP-AI-404` | Model not found, and no other usable model was found (the extension already tried the provider's current models by itself) | If you typed a model in Model / Tailoring model, clear it; otherwise the provider has no usable model for your key right now: try another provider |
| `AJP-AI-5XX` | The provider had a server error | Retry later |
| `AJP-AI-HTTP` | Other HTTP error | See `details.status` / `details.body` in the log |
| `AJP-AI-TIME` | No answer within 90 s (30 s for Test connection), even after trying the next model. The message names the provider · model | Retry; very long job descriptions or resumes are slower. Slow models are set aside for 6 h and the next best is used by itself (AI settings shows what's in use; **Re-check models now** is optional). Still slow → try another provider |
| `AJP-AI-NET` | Couldn't reach the provider | Internet or firewall. Ollama: is it running, and started with `OLLAMA_ORIGINS="*"`? |
| `AJP-AI-FMT` | Couldn't understand the AI's answer | Retry, or use a larger model |
| `AJP-AI-BILLING` | The provider says the free tier isn't available for this key's account / project (Gemini: "set up billing", "location not supported", quota "limit: 0") | Use Groq (free, no card), another personal Google account, or enable billing with the provider |
| `AJP-AI-CREDIT` | Anthropic Claude (paid, optional): "Your credit balance is too low". Claude API keys are billed per use from prepaid credit; a Claude.ai / Claude Code subscription doesn't cover them | Add credit at console.anthropic.com → Billing, or switch to a free provider (Groq, Gemini, NVIDIA NIM, Mistral) in Admin → AI settings |
| `AJP-AI-REFUSED` | The AI declined the request (Claude: `stop_reason: "refusal"`; the category, e.g. `cyber`, is in the log). Rare for resume work | Try again; if it repeats, choose another model (Admin → AI settings → Tailoring model) or provider |
| `AJP-AI-LOCAL-NONE` | The browser has no built-in AI (Firefox, Safari, older Chrome) | Use desktop Chrome 138+ or another free provider |
| `AJP-AI-LOCAL-OFF` | Chrome's on-device model can't run (hardware, disk space, policy, unsupported language). `details.name/reason` say why | Check chrome://on-device-internals; about 22 GB free disk space; or another provider |
| `AJP-AI-LOCAL-DL` | The on-device model isn't downloaded yet (`details.state`: downloadable / downloading), or the browser wanted a click | Admin → AI settings → "Download the on-device model", wait for 100%, then retry |
| `AJP-AI-LOCAL-LEN` | Resume + job post too long for the on-device model even after shortening | Shorten the resume or use Gemini / Groq for that job |
| `AJP-TAILOR-LOW` | Tailor resume was asked for a job below the minimum match (`details.score` / `details.min`) | Expected: tailoring is for close matches. Change the limit in Admin → AI settings → Tailoring limits if really needed |
| `AJP-PAGE-ACCESS` | The extension can't read this page | Browser pages, stores and PDF viewers are off-limits |
| `AJP-JD-NONE` | No job description found on the page | User can select the text → right-click → analyze. If it's a common site, add a selector in `jd-extractor.js` (see `data.host`). |
| `AJP-RES-NONE` | No resume text | Add or paste resume text in Admin → Resumes |
| `AJP-RES-PARSE` | Couldn't read a .docx | See `details.reason`; the user can paste the text instead |
| `AJP-PDF-CREATE` | The resume's PDF could not be generated (`details.reason`) | Usually empty text; add text, or upload a PDF |
| `AJP-PDF-NOTEXT` | The PDF has no selectable text (usually a scan) | Upload the .docx, or paste the text |
| `AJP-PDF-LOCKED` | The PDF is password-protected | Re-save it without a password (Print → Save as PDF), or upload the .docx |
| `AJP-RES-STRUCT` | Resume tailoring found no bullet points | Ask the user to put each achievement on its own line starting with `-` or `•` |
| `AJP-RES-DRAFT` | A tailoring draft (or its original resume) no longer exists | Run Tailor resume again |
| `AJP-RES-CHANGED` | The resume was edited after the draft was made | Run Tailor resume again so line ids match |
| `AJP-FILE-SIZE` | Resume file over 5 MB | Use a smaller file |
| `AJP-BACKUP` | Import file isn't a backup | Use a file from Admin → Backup → Export |
| `AJP-STORE` | Browser storage write failed (quota or blocked) | Export a backup; clear old logs; check browser site-data settings |
| `AJP-TAB` | No tab available | Start from the extension icon on the job page |
| `AJP-NET` | Couldn't reach a service (e.g. GitHub), even after retrying | Internet or firewall; it retries automatically, so a lasting `AJP-NET` means the connection is down |
| `AJP-HTTP` | A service returned an error (see `details.status`); 5xx errors were retried | Retry later; report it if it persists |
| `AJP-INTERNAL` | Unexpected bug | Check `details.original` and the `pre` entries before it, then file a bug with the report attached |

New codes are added in `src/lib/errors.js`. Every code needs a message and a hint, and a test checks this.

## 4. Common patterns
- **The match badge doesn't appear on a site.** Look for `AJP-JD-NONE` with `data.host`, and check `settings.autoAnalyze`. On Firefox, the user may not have granted site permissions.
- **Autofill missed fields.** Find the `frame.autofill done` entry (`filled`, `learned`, `unknown`, `questions`, `host`). A high `unknown` count on a common ATS means a new label rule is needed in `form-filler.js`.
- **Workday fields missed.** Find `Workday fill done` (`step`, `filled`, `unknown`) and `Workday field failed` / `Workday entry field failed` warnings (with `key`). Missing widgets usually mean a different `data-automation-id` on that company's Workday: adjust `SEL` in `src/content/workday.js` and add the case to `tests/fixtures/workday-mock.js`.
- **An application wasn't marked applied.** Look for `Submit seen` and `Application confirmation detected` / `Application auto-detected as applied`, or `Confirmation ignored (no job context, unknown site)`.
- **The AI is slow.** Look for `ai.<task> slow` warnings, with `ms`.
- **Resume tailoring suggested few changes.** Find `Resume enhancement drafted`: `blocked` and `blockedBy` (e.g. `{"JD_NUMBER":2,"NEW_NAME":1}`) show which safety rules fired, and `droppedQuotes` shows how many fake evidence quotes the AI made up. Many blocks usually means a small free model; suggest a larger one.
