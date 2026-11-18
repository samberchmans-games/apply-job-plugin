# Support guide

How to help a user who reports a problem.

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
| `AJP-AI-404` | Model name not found | Clear the Model field to use the default |
| `AJP-AI-5XX` | The provider had a server error | Retry later |
| `AJP-AI-HTTP` | Other HTTP error | See `details.status` / `details.body` in the log |
| `AJP-AI-TIME` | No answer within 90 s | Retry; very long job descriptions or resumes are slower |
| `AJP-AI-NET` | Couldn't reach the provider | Internet or firewall. Ollama: is it running, and started with `OLLAMA_ORIGINS="*"`? |
| `AJP-AI-FMT` | Couldn't understand the AI's answer | Retry, or use a larger model |
| `AJP-PAGE-ACCESS` | The extension can't read this page | Browser pages, stores and PDF viewers are off-limits |
| `AJP-JD-NONE` | No job description found on the page | User can select the text → right-click → analyze. If it's a common site, add a selector in `jd-extractor.js` (see `data.host`). |
| `AJP-RES-NONE` | No resume text | Add or paste resume text in Admin → Resumes |
| `AJP-RES-PARSE` | Couldn't read a .docx | See `details.reason`; the user can paste the text instead |
| `AJP-RES-STRUCT` | Resume tailoring found no bullet points | Ask the user to put each achievement on its own line starting with `-` or `•` |
| `AJP-RES-DRAFT` | A tailoring draft (or its original resume) no longer exists | Run Tailor resume again |
| `AJP-RES-CHANGED` | The resume was edited after the draft was made | Run Tailor resume again so line ids match |
| `AJP-FILE-SIZE` | Resume file over 5 MB | Use a smaller file |
| `AJP-BACKUP` | Import file isn't a backup | Use a file from Admin → Backup → Export |
| `AJP-STORE` | Browser storage write failed (quota or blocked) | Export a backup; clear old logs; check browser site-data settings |
| `AJP-TAB` | No tab available | Start from the extension icon on the job page |
| `AJP-INTERNAL` | Unexpected bug | Check `details.original` and the `pre` entries before it, then file a bug with the report attached |

New codes are added in `src/lib/errors.js`. Every code needs a message and a hint, and a test checks this.

## 4. Common patterns
- **The match badge doesn't appear on a site.** Look for `AJP-JD-NONE` with `data.host`, and check `settings.autoAnalyze`. On Firefox, the user may not have granted site permissions.
- **Autofill missed fields.** Find the `frame.autofill done` entry (`filled`, `learned`, `unknown`, `questions`, `host`). A high `unknown` count on a common ATS means a new label rule is needed in `form-filler.js`.
- **An application wasn't marked applied.** Look for `Submit seen` and `Application confirmation detected` / `Application auto-detected as applied`, or `Confirmation ignored (no job context, unknown site)`.
- **The AI is slow.** Look for `ai.<task> slow` warnings, with `ms`.
- **Resume tailoring suggested few changes.** Find `Resume enhancement drafted`: `blocked` and `blockedBy` (e.g. `{"JD_NUMBER":2,"NEW_NAME":1}`) show which safety rules fired, and `droppedQuotes` shows how many fake evidence quotes the AI made up. Many blocks usually means a small free model; suggest a larger one.
