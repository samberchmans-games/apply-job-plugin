# Store submission checklist

The **build** is automated (`python3 tools/package.py`; CI also builds and checks the packages on every push).
The **submission** needs your developer accounts, so it is your side. Expect 1–7 days of review per store.

## Before every release

1. Bump `version` in `manifest.json` (x.y.z, higher than the published one).
2. `sh tests/check.sh && sh tests/run-tests.sh && sh tests/run-browser-tests.sh`: all green (CI shows the same).
3. `python3 tools/package.py`: three zips in `dist/`, each line says `ok`.
4. If screens changed: `python3 tools/store_assets.py` (new screenshots).
5. Merge `develop` into `main` and tag it `vX.Y.Z`, so the privacy-policy link on `main` is current.

## Chrome Web Store

1. **Account:** https://chrome.google.com/webstore/devconsole. There is a one-time registration fee (US$5 at the time of writing), and you must verify your email.
2. **New item:** upload `dist/apply-job-assistant-<v>-chrome.zip`.
3. **Store listing:** fill it from `LISTING.md`: description, category, screenshots, small promo tile, icon (taken from the package), support URL.
4. **Privacy practices:** single purpose, permission justifications and data-use answers from `LISTING.md`. Remote code: **No**. Privacy policy URL.
5. **Distribution:** start as **Unlisted**. Share the link with your testers, then switch to Public after their feedback.
6. Submit for review.

## Microsoft Edge Add-ons

1. **Account:** Partner Center → Microsoft Edge program (free): https://partner.microsoft.com/dashboard/microsoftedge
2. **New extension:** upload `dist/apply-job-assistant-<v>-edge.zip`.
3. **Listing:** the same texts and screenshots. **Properties:** category, privacy policy URL, support URL.
4. **Availability:** Hidden, for testers first, if you like. Submit.

## Firefox Add-ons (AMO)

1. **Account:** https://addons.mozilla.org/developers/ (free; Firefox account with two-step authentication).
2. **Submit a New Add-on:** On this site (listed), or On your own (self-distributed, signed, not listed).
3. Upload `dist/apply-job-assistant-<v>-firefox.zip`. The validator runs automatically. CI already runs `web-ext lint` on the same package.
4. **Source code:** asked because `src/vendor/pdfjs/*.min.mjs` are minified. Answer that they are unmodified files from npm `pdfjs-dist@4.10.38` (link: https://www.npmjs.com/package/pdfjs-dist/v/4.10.38). Everything else is unminified source.
5. **Listing:** the same texts and screenshots; license **GPL-3.0**; privacy policy (paste the text or the link).
6. **Note for users:** in Firefox, job-site permissions are optional. After installing, open the extension's **Permissions** tab and allow the sites (README → Install, scenario A3).

## Safari

Separate path (Xcode + Apple Developer Program): see README → Safari, and `tools/safari.sh`.

## Decisions for you before the first public release

- [ ] **Firefox data declaration:** keep `required: ["none"]` (recommended: nothing reaches the developer), or declare `optional` categories plus a consent prompt (see LISTING.md).
- [ ] **Firefox add-on id:** `apply-job-assistant@samberchmans-games.github.io` (in `tools/package.py`). It can't change after the first AMO upload.
- [ ] **Public or unlisted** for the first release (unlisted recommended while testers try it).
- [ ] **Publisher name** shown in the stores. It comes from your developer accounts, not from the code.
