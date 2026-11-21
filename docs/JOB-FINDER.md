# Job Finder architecture (Job Radar)

Implementation reference for **Job Radar**, the planned job-finding feature of Apply Job Assistant. It watches the
careers boards of companies you choose, finds new postings that fit your career tracks, scores them with the
existing matcher, and alerts you. Applying stays your action, through the existing panel and autofill.

Status: **built** on `feature/job-radar` (roadmap step 19): all 11 boards, Admin, popup, panel, alerts; **waiting on the manual browser pass** (J38) before merging. Build tasks and their status: [TRACKER.md §2b](TRACKER.md).
Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [PLAN.md](PLAN.md) · [SUPPORT.md](SUPPORT.md) · [TEST-SCENARIOS.md](TEST-SCENARIOS.md)

Last updated: 2026-11-21 · Branch for the build: `feature/job-radar` (off `develop`)

---

## 1. What it does

1. You keep a **watchlist** of companies, added by careers URL, from the job-page panel, or as a pasted list.
2. On a timer (default every 3 hours) the background worker reads each company's **public job feed**. These are
   the same no-key feeds the hiring systems publish for company career pages.
3. New postings are **filtered** by title (your tracks) and location/remote preferences, then **scored** with
   `AJP.tracks.analyzeAll`, which gives the same match % and best track you see on a job page today.
4. Jobs at or above your **threshold** (default 60%) raise an **alert**: a badge count, one browser notification
   per scan, and a "New jobs" list in the popup and Admin.
5. Opening a job takes you to the posting, where the existing panel, tailoring and autofill take over. "Save"
   adds it to the application tracker.

### Decisions (J01, 2026-11-21)

| Decision | Choice |
|---|---|
| Design | Approved |
| Boards in the first release | All 11, built in waves A → B → C |
| Scan interval | 3 hours (Admin: 1 h – 1 day); an hourly alarm scans only the companies that are due |
| Alert threshold | 60% match |
| Alerts | One summary a day by default; "after every scan" in settings |
| Badge order | `!` → `✓` → new matches (blue) → follow-ups (amber) |

## 2. Goals → design decisions

| Goal | Decision |
|---|---|
| Chrome, Edge, Firefox, Safari | Only standard WebExtension APIs: `alarms`, `fetch`, `storage`, `notifications`, `permissions`. Safari falls back to badge + lists where notifications are missing. |
| No database, all data local | Watchlist, seen jobs and results live in `storage.local` and are part of export/import. |
| Free only | No paid services. Scoring uses the local matcher, so there are no AI calls. Feeds are public and need no key. |
| Fast and light | Two-stage scan: cheap list requests for every company, detail requests only for jobs that pass the quick filter. Hard request budgets per company and per scan. |
| No build step | Plain IIFE files on `globalThis.AJP`, like the rest of the extension. |
| Never auto-submit | Job Radar only finds and alerts. |
| THE STANDARD ([ARCHITECTURE §9b](ARCHITECTURE.md)) | Coded `RADAR_*` errors, logged failures, retries with limits, no silent failures. |

## 3. Runtime view

```
 ┌──── Extension pages ─────────────────────┐   ┌──── Job page ───────────────────────┐
 │ Admin › Job Radar view (radar-view.js)   │   │ panel.js: "Watch this company"      │
 │   watchlist · settings · New jobs        │   │ radar-detect.js (board from URL/HTML)│
 │ Popup: new-jobs count + top 5            │   └──────────────┬──────────────────────┘
 └──────────────┬───────────────────────────┘                  │
        AJP.send('radar.*')                            AJP.send('radar.watch.add')
 ┌──────────────▼─────────────────────────────────────────────▼──────────────────────┐
 │ Background (service worker on Chrome/Edge · event page on Firefox/Safari)         │
 │   alarm 'ajp-radar' ─► radar-scan.js ─► radar-boards.js (11 adapters)             │
 │                         │   ▲              radar-core.js (normalize, parse, filter)│
 │                         │   └── AJP.tracks.analyzeAll (score)                      │
 │                         └──► notifications · badge · AJP.logger('radar')           │
 └──────────────┬───────────────────────────────────────────┬────────────────────────┘
                │ storage.local (radar* keys)               │ fetch (optional host permissions)
        ┌───────▼────────┐                         ┌────────▼─────────────────────┐
        │ storage.local  │                         │ Public job feeds (11 boards) │
        └────────────────┘                         └──────────────────────────────┘
```

## 4. Files

| File | Runs in | Responsibility | New / changed |
|---|---|---|---|
| `src/lib/radar-core.js` | Background, tests | Shared job shape + `normalize()`; HTML/XML/RSS text parsing; dates, salary, remote; `quickFilter`; skip-seen and pruning. `AJP.radar.core` | New |
| `src/lib/radar-boards.js` | Background, tests | The 11 board adapters (§6), registered in `AJP.radar.boards`. Pure functions: build requests, parse responses. No network code. | New |
| `src/lib/radar-detect.js` | Background, content, Admin, tests | Careers URL → `{ board, company, … }`; page HTML → board. `AJP.radar.detect` | New |
| `src/lib/radar-scan.js` | Background, tests | Scan engine (§8). Takes `fetch` as a parameter, so tests pass a fake. `AJP.radar.scan` | New |
| `src/background/background.js` | Background | Load the four files (`importScripts`); `ajp-radar` alarm; `radar.*` handlers; notifications; badge order | Changed |
| `src/lib/storage.js` | Everywhere | Defaults for the `radar*` keys (§10); export/import | Changed |
| `src/lib/errors.js` + `docs/SUPPORT.md` | Everywhere | `RADAR_*` codes (§12). SUPPORT.md must list every code (a convention test checks this) | Changed |
| `src/content/panel.js` | Job pages | "Watch this company" button when the page is on a supported board | Changed |
| `src/admin/radar-view.js`, `admin.html`, `admin.js` | Admin | Watchlist, settings, New jobs, permission requests; nav entry | New / changed |
| `src/popup/popup.*` | Popup | New-jobs count, top 5, "See all" | Changed |
| `manifest.json` | — | `notifications`; `optional_host_permissions` (§11); radar files in background `scripts`; `radar-detect.js` in content scripts before `panel.js` | Changed |
| `tests/unit/radar-*.test.js`, `tests/fixtures/radar/` | Tests | One captured sample response per board (list, plus detail where used); added to `tests/run-tests.sh` and `tests/test-runner.html` | New |

Reused unchanged: `AJP.tracks.analyzeAll`, `AJP.tracks.titleFit`, `AJP.tracker` (save), `AJP.logger`, `AJP.err`, `AJP.store`.

## 5. Supported job boards

Built in three waves, simplest first. Wave A = plain JSON with descriptions; wave B adds paging and detail calls;
wave C adds XML/RSS and Workday's POST search. Before each adapter is written, a live response is captured from a
real company board into `tests/fixtures/radar/`, which also confirms the endpoint still works.

| Board | Careers URL | Public endpoint | Format | Paging | Description in list | Wave |
|---|---|---|---|---|---|---|
| Greenhouse | `boards.greenhouse.io/{slug}` | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=false` ([docs](https://docs.greenhouse.io/job-board.html)) | JSON | none | no (light list) → detail `/jobs/{id}` (HTML, double-encoded) for jobs that pass the filter | A |
| Lever | `jobs.lever.co/{slug}` | `GET api.lever.co/v0/postings/{slug}?mode=json`; EU: `api.eu.lever.co` ([docs](https://github.com/lever/postings-api)) | JSON | none | yes | A |
| Ashby | `jobs.ashbyhq.com/{slug}` | `GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` ([docs](https://developers.ashbyhq.com/docs/public-job-posting-api)) | JSON | none | yes | A |
| Workable | `apply.workable.com/{slug}` | `GET apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | JSON | none | yes (HTML) | B |
| Recruitee | `{slug}.recruitee.com` | `GET {slug}.recruitee.com/api/offers/` | JSON | none | yes | B |
| Breezy HR | `{slug}.breezy.hr` | `GET {slug}.breezy.hr/json` | JSON | none | **no** | B |
| SmartRecruiters | `jobs.smartrecruiters.com/{slug}` | `GET api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset=N` | JSON | offset, ≤100 | no → detail `/postings/{id}` | B |
| Rippling | `ats.rippling.com/{slug}/jobs` | `GET ats.rippling.com/api/v2/board/{slug}/jobs?page=N` | JSON | page (20) | no → detail `GET api.rippling.com/platform/api/ats/v1/board/{slug}/jobs/{id}` (the `ats.rippling.com` detail path answers 404) | B |
| Personio | `{slug}.jobs.personio.de` / `.com` | `GET {slug}.jobs.personio.de/xml?language=en` | XML | none | yes (CDATA HTML) | C |
| Teamtailor | `{slug}.teamtailor.com` or custom domain | `GET {careers-domain}/jobs.rss` | RSS | none | yes (escaped HTML) | C |
| Workday | `{tenant}.wd{N}.myworkdayjobs.com/{site}` | `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | JSON | offset, ≤20 | no → detail `GET …/{site}{externalPath}` | C |

Out of scope (no free public feed): LinkedIn, Indeed, Glassdoor, ZipRecruiter, iCIMS. The existing panel still
scores their job pages when you open them.

## 6. Board adapters

### 6.1 Contract

```js
AJP.radar.boards.register({
  id: 'smartrecruiters',                         // stable; first part of every job key
  label: 'SmartRecruiters',
  wave: 'B',
  hosts: ['https://api.smartrecruiters.com/*'],  // optional host permissions to request
  responseType: 'json',                          // 'json' | 'text' (XML/RSS parsed by radar-core)
  listRequest(entry, ctx),    // -> { url, method: 'GET'|'POST', headers?, body? }; ctx.keywords from tracks
  parseList(body, entry, ctx, req), // -> { jobs: [partial job], next: request|null, total?: number } (req: the request sent, for Workday paging)
  listRequests?(entry, ctx), // optional: several first requests (Workday: one search per keyword)
  detailRequest(job, entry),  // optional -> request (omit when the list has descriptions)
  parseDetail(body, job)      // optional -> partial job (description, salary, dates, locations)
});
```

- `entry` = watchlist entry `{ board, company, site?, region?, wd?, domain? }` (§9).
- Adapters never call `fetch`, never touch storage, never throw on a missing field: they return what they have,
  and `radar-core.normalize()` fills defaults. A response that isn't the expected shape → `RADAR_BAD_RESPONSE`.

### 6.2 Per-board rules

| Board | Job ID (key) | Title · locations · link · date | Must handle |
|---|---|---|---|
| Greenhouse | `id` | `title` · `location.name` · `absolute_url` · `first_published` ‖ `updated_at` | `content` is double-encoded: `decodeEntities` twice, then `htmlToText`. `absolute_url` may be the company's own site: keep it. Salary only from text. |
| Lever | `id` | `text` · `categories.location` + `allLocations` · `hostedUrl` · `createdAt` (ms) | 404 on `api.lever.co` → retry `api.eu.lever.co`, save `region: 'eu'`. `salaryRange` when present; `workplaceType` → remote. |
| Ashby | `id` | `title` · `location` + `secondaryLocations` · `jobUrl` · `publishedAt` | Skip `isListed: false`. Salary from `compensation.summaryComponents` (`minValue`, `maxValue`, `currencyCode`, `interval`). `isRemote` / `workplaceType`. |
| Workable | `shortcode` | `title` · `city`/`state`/`country` or `locations[]` · `url` · `published_on` | `telecommuting: true` → remote. Description is HTML. |
| Recruitee | `id` | `title` · `location` or `city`+`country_code` · `careers_url` · `published_at` | Date is `YYYY-MM-DD HH:MM:SS UTC` (not ISO). Description = `description` + `requirements`. `salary{min,max,period,currency}`; `remote`/`hybrid`/`on_site`. |
| Breezy HR | `id` | `name` · `location` / `locations[]` · `url` · `published_date` | No description: `descriptionLevel: 'title'`, scored on title. `salary` is free text → `salaryFromText`. `location.is_remote`. |
| SmartRecruiters | `id` | `name` · `location.fullLocation` · `https://jobs.smartrecruiters.com/{company}/{id}` · `releasedDate` | Page by `offset` until `totalFound` or the cap. Company ID is case-sensitive: keep it exactly. Detail: `jobAd.sections.{jobDescription,qualifications,additionalInformation}.text`. |
| Rippling | `id` | `name` · `locations[].name` · `url` · detail `createdOn` | Page by `page` until `totalPages`. A job with several locations is listed once per location: merged by `id`. No date in the list: `postedAt = null` until detail. Detail (`api.rippling.com`) `description` (object of HTML parts), `workLocations`, `payRangeDetails[]` → salary. |
| Personio | `<id>` | `<name>` · `<office>` + `additionalOffices` · `https://{slug}.jobs.personio.de/job/{id}` · `<createdAt>` | XML. 404 on `.de` → try `.com`; save `domain`. Description = every `jobDescriptions/jobDescription/value` joined. |
| Teamtailor | `<guid>` | `<title>` · `tt:locations/tt:location/tt:name` · `<link>` · `<pubDate>` | RSS. Custom domains are common: entry stores `domain`, permission asked for that domain. `remoteStatus`: `fully` → remote, `hybrid` → hybrid. |
| Workday | `externalPath` | `title` · `locationsText` · careers URL + `externalPath` · `postedOn` | POST `{"limit":20,"offset":N,"searchText":"…","appliedFacets":{}}` with `Content-Type: application/json`. `total` reliable on page 1 only. `postedOn` is text ("Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago" → 30 days, `postedAtExact: false`). `locationsText` may be "2 Locations" → detail gives the list. Site name is case-sensitive; strip locale segments (`/en-US/`). One search per track keyword (max 3) instead of paging every job. |

## 7. Shared job shape and normalizers

### 7.1 Job shape (`radarJobs` entries)

| Field | Type | Notes |
|---|---|---|
| `key` | string | `{board}:{company}:{job ID}`, e.g. `lever:acme:5f2c…`; unique; skip-seen key |
| `board`, `company`, `companyName` | string | `companyName` for display |
| `title` | string | trimmed, whitespace collapsed |
| `locations` | string[] | may be empty when unknown |
| `remote` | `'remote'` · `'hybrid'` · `'onsite'` · `null` | `null` = unknown; the location filter lets unknown through |
| `employmentType`, `department` | string \| null | when given |
| `url` | string | the posting page (panel + autofill run there) |
| `postedAt`, `postedAtExact` | ISO date \| null, boolean | `false` for Workday text and estimates |
| `salary` | `{min,max,currency,period,source}` \| null | `source`: `'field'` or `'text'` |
| `description` | string | plain text, ≤ 12,000 chars (same limit as saved job descriptions) |
| `descriptionLevel` | `'full'` · `'title'` | `'title'` = scored on title only |
| `score`, `bestTrackId` | number, string | from `AJP.tracks.analyzeAll` |
| `foundAt`, `status` | ISO, `'new'` · `'saved'` · `'dismissed'` | |

### 7.2 Normalizers (`radar-core.js`)

Chrome's background service worker has **no `DOMParser`**, and the command-line tests run in JavaScriptCore,
which has none either. So every parser is plain string code, covered by fixtures.

| Function | Behaviour |
|---|---|
| `decodeEntities(s)` | named + numeric entities (`&amp;`, `&lt;`, `&#39;`, `&#x27;`, `&nbsp;` …) |
| `htmlToText(s)` | `<br>`, `</p>`, `</li>`, `</h*>` → newlines; `<li>` → "- "; drop `<script>`/`<style>` blocks; strip tags; collapse whitespace |
| `xmlItems(text, tag)` | returns the inner text of each `<tag>…</tag>` (non-greedy, tag names may have a namespace prefix) |
| `xmlValue(item, path)` | reads `a/b/c` child values; unwraps `<![CDATA[…]]>`; decodes entities; `xmlValues` for repeated children |
| `parseDate(v)` | ISO strings · millisecond numbers · `YYYY-MM-DD HH:MM:SS UTC` · RFC 822 (`pubDate`) · Workday "Posted …" text. Returns `{ iso, exact }` or `null` |
| `salaryFromText(s)` | currency range regex (`$`, `€`, `£`, `US$`, `CA$`, `A$`; `k` suffix; `-`, `–`, `—`, `to`); period from nearby words (hour, year, month); rejects yearly < 10,000 and hourly > 1,000 |
| `remoteFrom(raw)` | `workplaceType`, `isRemote`, `telecommuting`, `remote`/`hybrid`/`on_site`, `is_remote`, `location.remote`/`hybrid`, `remoteStatus` → one value |
| `normalize(partial, entry)` | builds the key, applies the above, cuts lengths, fills defaults |
| `quickFilter(job, settings, tracks)` | `AJP.tracks.titleFit` ≥ 0.34 on any track (share of a target title's words found in the job title, e.g. one word in three); tracks without target titles (the implicit "General" track) fall back to `profile.targetRoles`, and with no titles at all every job passes to scoring. Then location/remote preference and optional minimum salary (jobs with no salary pass) |
| `markSeen` / `prune` | seen keys pruned after 60 days; dismissed jobs after 30 days; `radarJobs` capped at 500 newest |

### 7.3 Career tracks, eligibility, freshness (2026-11-21)

- **Per track (up to 3):** `quickFilter` keeps a job when it fits one track's **titles** (titleFit ≥ 0.34; tracks without titles use `profile.targetRoles`), then **that track's** places (`track.areas`, else `profile.areas`; city or full area found in a job location) and work types (`track.workTypes`, else `profile.workTypes`). Remote jobs fit any place; unknown values pass. Job Radar settings (locations, work type) narrow further only when set. The fitting track is reported; scoring still picks the best track (`analyzeAll`). Workday keyword searches take one title per track first.
- **Eligibility** (`eligibility(text, profile)`): flags in the job text: *no sponsorship* ("unable to sponsor", "without current or future sponsorship", "not eligible for sponsorship"…), *sponsors* ("visa sponsorship is available"…), *citizenship* ("must be a U.S. citizen", "citizens only", ITAR / export control), *clearance* (Secret, TS/SCI, public trust). Against Auto-apply details (`requireSponsorship`, new `citizen`): conflicts → `blocked` (listed apart with the reason, left out of matches, alerts, badge and the popup); possibly relevant → `check` (a label); nothing → `ok`. Jobs are never deleted for it: when unsure, the user decides.
- **Freshness:** `today` (< 24 h), `week` (< 7 days), `older`, `unknown`, shown as labels; `radar.jobs` takes `sort: 'match' | 'newest'` and `eligible`.
- **All boards at once:** Admin → Job Radar → "Allow all 11 job boards" requests every board host in one prompt.

### 7.4 Built-in company directory (2026-11-21)

These boards have no "search everything" feed (each lists one company), so Job Radar ships a **directory** of companies
whose public board answered with open jobs: `src/lib/radar-directory.js` (`[board, company, name]`, 322 at the first
build: Greenhouse 192, Ashby 104, Lever 26), generated by `tools/build_radar_directory.py` from
`tools/radar_candidates.txt` (add names, re-run; it uses `curl`, a few requests at a time).

- **On by default** (`radarSettings.directory`); scanned **only on boards the browser allows** (Admin → "Allow all 11 job
  boards"). Your own watchlist companies are scanned on their interval as before and are skipped in the directory.
- **Rotation:** one slice per interval (and per Scan now), after your companies: `max(30, ceil(N × interval / 24 h))`
  companies from `radarScanState.dirCursor`, so the whole directory is covered about once a day.
- **Quiet failures:** directory errors don't show in the summary; a company failing 3 scans in a row is skipped
  (`dirFail`). **Download budget:** 50 MB per scan; the rest of the slice waits for the next scan.
- **Light lists:** Greenhouse lists are requested without descriptions (`content=false`, ~100× smaller); the detail call
  (`/jobs/{id}`) fetches the description only for jobs that pass the quick filter (≤ 25 per company).
- **Hide a company:** `radar.company.hide` (from a job card) adds it to `radarSettings.excluded` and removes its new jobs;
  `radar.directory` reports size per board, boards allowed, hidden and failing counts.

### 7.5 Accuracy and control (2026-11-21)

- **Title rule:** a job title must contain most words of a target title (`ceil(60%)`: both words of "Data Engineer",
  2 of 3…), word forms counted ("engineer" ~ "engineering", "Sr" = "Senior").
- **Places:** whole-word matching; areas with "Remote" apply only to remote jobs; a remote job limited to other
  countries ("Remote Canada", "EMEA") doesn't fit when your places name a country (US states count as the US).
- **Scores:** title-only jobs get no score ("–") and never alert; scored jobs store `skillsMatched` / `skillsTotal`
  (the panel's "N of M skills"). **Backfill:** each scan fetches descriptions for up to 20 listed title-only jobs.
- **Track locations:** `track.areas` (Career tracks → "Locations for this track"; blank = Job preferences defaults).
- **Preferences change:** the background re-checks the listed jobs at once (titles, places, work type, eligibility) and
  sets `prefsChangedAt`; Admin offers **Restart search** (stop, forget seen jobs except listed / dismissed ones, rescan).
  **■ Stop** ends a running scan after the request in flight (`AJP.radar.scan.cancel`).
- **Duplicates:** the same title at the same company posted per location shows as one card with every location.

## 8. Scan engine (`radar-scan.js`)

Two stages: a cheap **list** stage for every due company, then **detail** calls only for jobs that pass the quick
filter. Most companies cost one or two requests per scan.

1. **Start**: alarm `ajp-radar` fires (hourly; only companies past their interval are scanned), or "Scan now". Lock in `radarScanState.lockedAt`; a lock older than
   10 minutes is stale and taken over. A second start while locked returns "already running".
2. **Queue**: entries not paused and with `lastScanAt` older than the interval, oldest first. Saved in
   `radarScanState.queue` + `position`, so a worker stopped mid-scan resumes on the next alarm.
3. **List stage** (3 companies at a time; requests to one host 1 s apart): `listRequest` → `parseList`, following
   `next` until null or the page cap. Workday: one search per track keyword (max 3).
4. **Normalize + filter**: `normalize`; drop keys already in `radarSeen`; `quickFilter`. Filtered-out jobs are still
   marked seen, so they are not re-checked every scan.
5. **Detail stage** (SmartRecruiters, Rippling, Workday): best title fit first, up to the per-company budget. Jobs
   over budget keep `descriptionLevel: 'title'`.
6. **Score**: `AJP.tracks.analyzeAll({ jdText: description || title, jobTitle, jobLocation, profile, resumes })`.
7. **Save after each company**: jobs → `radarJobs` (`status: 'new'`), keys → `radarSeen`, entry →
   `lastScanAt`, `lastError`, `failuresInRow`, `openJobs`. Five failures in a row → `paused` + `RADAR_PAUSED`.
8. **Alert**: if the scan found jobs ≥ threshold → one notification ("3 new jobs at 70%+: Acme, Globex…"),
   refresh the badge. One log line: companies, requests, listed, new, matches, errors, duration.
9. **Clean up**: release the lock; `prune`.

### 8.1 Budgets and HTTP rules (constants in `radar-scan.js`)

| Rule | Default |
|---|---|
| Companies at once | 3 |
| Pause between requests to the same host | 1,000 ms |
| Request timeout | 15 s (`AbortController`) |
| List pages per company per scan | 5 (Workday: 5 per keyword) |
| Workday keyword searches per company | 3 |
| Detail calls per company per scan | 25 |
| Requests per scan, all companies | 400 (rest wait for the next scan) |
| Minimum scan interval | 1 hour |
| HTTP 404 | `RADAR_BOARD_NOT_FOUND`; Lever retries the EU host once, Personio retries `.com` once |
| HTTP 429 / 5xx | one retry after `Retry-After` (≤ 60 s), else skip the company this scan (`RADAR_RATE_LIMIT` / `RADAR_SERVER`) |
| Network error / timeout | skip this scan (`RADAR_NETWORK` / `RADAR_TIMEOUT`), counts toward failures in a row |

Browsers don't let extensions set `User-Agent`; low request rates and the budgets above keep the client polite.

## 9. Adding companies (`radar-detect.js`)

Every route ends with the same check: fetch the board once, show the company name and open-job count, then save.

1. **Admin → Job Radar → Add**: paste a careers URL. Matched against the patterns below. If it is the company's own
   site (e.g. `example.com/careers`), the browser is asked for that one site, the page is read once, and the same
   patterns are searched in its HTML (links, iframes, script sources; Teamtailor by `teamtailor-cdn` /
   `assets.teamtailor`). If no board is found, choose the board and type the company ID by hand.
2. **"Watch this company" in the job-page panel**: the content script runs detection on the page URL and HTML
   (no extra permission needed to read the open page) and sends `radar.watch.add`. If the board's permission is
   still missing, it opens Admin with the URL filled in, because `permissions.request` must come from a click on an
   extension page.
3. **Add a list**: paste careers URLs, one per line, or upload a `.txt` / `.csv` file of them. Each line goes through
   route 1. The result lists what was added and what was skipped, with the reason.

| Board | URL pattern (host / path) | Saved entry |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/{slug}`, `job-boards.greenhouse.io/{slug}`, `…/embed/job_board?for={slug}` | `company` |
| Lever | `jobs.lever.co/{slug}`, `jobs.eu.lever.co/{slug}` | `company`, `region` |
| Ashby | `jobs.ashbyhq.com/{slug}` | `company` |
| Workable | `apply.workable.com/{slug}` | `company` |
| Recruitee | `{slug}.recruitee.com` | `company` |
| Personio | `{slug}.jobs.personio.de`, `{slug}.jobs.personio.com` | `company`, `domain` |
| SmartRecruiters | `jobs.smartrecruiters.com/{slug}`, `careers.smartrecruiters.com/{slug}` | `company` (case kept) |
| Workday | `{tenant}.wd{N}.myworkdayjobs.com/[{locale}/]{site}` | `company` = tenant, `wd` = N, `site` |
| Breezy HR | `{slug}.breezy.hr` | `company` |
| Teamtailor | `{slug}.teamtailor.com`, or any domain whose page loads Teamtailor assets | `company`, `domain` |
| Rippling | `ats.rippling.com/{slug}/jobs` | `company` |

## 10. Data model (`storage.local`)

| Key | Shape | Limits | Export |
|---|---|---|---|
| `radarSettings` | `{ enabled, intervalHours: 3, threshold: 60, locations[], remote: 'any'\|'remote'\|'hybrid'\|'onsite', minSalary?, notify: 'perScan'\|'digest' }` | small | yes |
| `radarWatchlist` | `[{ key, board, company, companyName, site?, region?, wd?, domain?, paused, addedAt, lastScanAt, lastError?, failuresInRow, openJobs }]` | expect < 300 | yes |
| `radarJobs` | `[job]` (§7.1) | 500 newest; dismissed pruned after 30 days | yes |
| `radarSeen` | `{ [key]: firstSeenISODate }` | pruned after 60 days | yes |
| `radarScanState` | `{ lockedAt?, queue[], position, lastSummary }` | small | **no** (internal, like `logs`) |

Writes go through the background with `AJP.serial()`, like every other key.

## 11. Permissions and cross-browser notes

New permission: `notifications`. Feed hosts are **`optional_host_permissions`**, requested when the first company
on that board is added. You grant only the boards you use, and install shows no extra warnings.

| Board | Optional host pattern(s) |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/*` |
| Lever | `https://api.lever.co/*`, `https://api.eu.lever.co/*` |
| Ashby | `https://api.ashbyhq.com/*` |
| Workable | `https://apply.workable.com/*` |
| Recruitee | `https://*.recruitee.com/*` |
| Personio | `https://*.jobs.personio.de/*`, `https://*.jobs.personio.com/*` |
| SmartRecruiters | `https://api.smartrecruiters.com/*` |
| Workday | `https://*.myworkdayjobs.com/*` |
| Breezy HR | `https://*.breezy.hr/*` |
| Teamtailor | `https://*.teamtailor.com/*` + `https://{custom domain}/*` per company |
| Rippling | `https://ats.rippling.com/*`, `https://api.rippling.com/*` |
| Company careers page (detection only) | `https://{domain}/*`, once |

- With the host permission granted, background `fetch` is not blocked by CORS (covers Workday's POST) in Chrome,
  Edge and Firefox. **Safari must be confirmed in the manual test.**
- `notifications` is feature-checked; where missing, badge + lists only.
- Firefox MV3 treats host permissions as user-granted anyway; the same request flow works.
- The four radar files are added to both `importScripts` (Chrome/Edge) and the manifest background `scripts`
  (Firefox/Safari). `tests/check.sh` already verifies both lists point to real files.

## 12. Errors (`errors.js` + SUPPORT.md)

| Key | Code | Message | Hint |
|---|---|---|---|
| `RADAR_UNSUPPORTED` | `AJP-RADAR-UNSUP` | This careers page uses a job board Job Radar can't read yet. | Supported: Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters, Workday, Breezy HR, Teamtailor, Rippling. |
| `RADAR_BOARD_NOT_FOUND` | `AJP-RADAR-404` | No job board was found for this company. | Check the company name in the careers URL; SmartRecruiters and Workday names are case-sensitive. |
| `RADAR_PERMISSION` | `AJP-RADAR-PERM` | The browser did not allow access to this job board. | Add the company again in Admin → Job Radar and click Allow. |
| `RADAR_RATE_LIMIT` | `AJP-RADAR-429` | The job board asked us to slow down. | Nothing to do; it is retried on the next scan. |
| `RADAR_SERVER` | `AJP-RADAR-5XX` | The job board had a server error. | It is retried on the next scan. |
| `RADAR_NETWORK` | `AJP-RADAR-NET` | Could not reach the job board. | Check your internet connection. |
| `RADAR_TIMEOUT` | `AJP-RADAR-TIME` | The job board took too long to answer. | It is retried on the next scan. |
| `RADAR_BAD_RESPONSE` | `AJP-RADAR-FMT` | The job board's answer could not be read. | The board may have changed its format; please report it from Logs & support. |
| `RADAR_PAUSED` | `AJP-RADAR-PAUSED` | This company was paused after 5 failed scans in a row. | Check its URL, then resume it in the watchlist. |
| `RADAR_LIST` | `AJP-RADAR-LIST` | Some lines in the list could not be added. | Each skipped line shows the reason; check the URL or add it by hand. |

Logging: `AJP.logger('radar')`; one summary line per scan; per-company errors with code, board, company and HTTP
status. Job descriptions are never logged.

## 13. Messages (`AJP.send(type, payload)`)

| Type | From | Payload | Reply |
|---|---|---|---|
| `radar.status` | popup, Admin | — | enabled, last scan + summary, running, new count |
| `radar.detect` | Admin, panel | `{ url, html? }` | `{ board, company, site?, region?, wd?, domain? }` or `AJP-RADAR-UNSUP` |
| `radar.watch.add` | Admin, panel | `{ url }` or entry fields | entry + live `openJobs`, or `AJP-RADAR-404` / `AJP-RADAR-PERM` |
| `radar.watch.update` | Admin | `{ key, paused?, companyName? }` | entry |
| `radar.watch.remove` | Admin | `{ key }` | ok (its new jobs removed; seen keys kept) |
| `radar.watch.list` | Admin | — | entries |
| `radar.watch.addList` | Admin | `{ text }` | `{ added[], skipped[{ line, reason }] }` |
| `radar.scanNow` | Admin | `{ key? }` | scan summary |
| `radar.jobs` | popup, Admin | `{ status, limit? }` | jobs, highest score first |
| `radar.job.update` | popup, Admin | `{ key, status }` | job; `saved` also creates a tracker entry via `AJP.tracker` |
| `radar.settings.get` / `.save` | Admin | settings | settings; alarm re-created when the interval changes |

## 14. Badge

Current order in `refreshBadge()`: `!` (problem to report) → `✓` (fixed report) → follow-ups due (amber).
New order: `!` → `✓` → **new jobs (blue)** → follow-ups (amber). The popup shows both counts.

## 15. Testing

- **Unit (CLI + browser runners):** every normalizer; every adapter against its captured fixture; URL detection
  table; quick filter; skip-seen and pruning; scan engine with a fake `fetch` (200/404/429/500/timeout, paging
  caps, budgets, lock, resume after a stop); storage export/import round trip; error codes present in SUPPORT.md.
- **Browser runner:** `radar.*` messages end to end with a fake fetch; Admin view and popup UI tests.
- **Manual (TEST-SCENARIOS.md section M, added with the build):** one company per wave in each browser; permission
  prompt; notification click; "Watch this company"; save to tracker; Safari CORS for Workday's POST.

## 16. Known limits

- No free feed for LinkedIn, Indeed, Glassdoor, ZipRecruiter or iCIMS.
- Breezy HR has no descriptions, so its jobs are scored on title only.
- Workday dates are approximate ("Posted 30+ Days Ago").
- A board can change its public feed at any time; the fixture test and `AJP-RADAR-FMT` make that visible fast.
- Companies whose careers page shows no sign of its board must be added by hand (board + company ID).
