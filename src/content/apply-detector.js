/*
 * apply-detector.js — notices when the user actually submits an application.
 *
 * Signals (sent to the background, which decides and saves):
 *   'submit'   user pressed Submit/Apply on something that looks like an application form
 *   'confirm'  the page shows a confirmation ("Thank you for applying", /confirmation URL, ...)
 *
 * Only short headings / alerts / dialogs are checked for confirmation text, so a job
 * description that *mentions* "once your application has been submitted…" does not count.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.detector) return;
  const log = AJP.logger('detector');
  const T = AJP.tracker;

  const CONFIG = { askAfterMs: 30000, watchMs: 120000 };
  const CONFIRM_SEL = [
    'h1', 'h2', 'h3', 'h4', '[role="alert"]', '[role="status"]', '[role="dialog"] h2', '[role="dialog"] h3',
    '[class*="confirm" i]', '[class*="success" i]', '[class*="thank" i]', '[id*="confirm" i]',
    '[data-automation-id*="confirm" i]', '[data-test*="success" i]', '.artdeco-modal h2', '.artdeco-modal h3',
  ].join(',');
  const FIELD_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), select, textarea';

  function looksLikeApplication(root) {
    const scope = root || document;
    if (scope.querySelector('input[type=file]')) return true;
    return scope.querySelectorAll(FIELD_SEL).length >= 4;
  }

  function findConfirmation(root = document) {
    if (T.isConfirmationUrl(location.href) && T.isJobHost(location.hostname)) return 'url';
    for (const el of root.querySelectorAll(CONFIRM_SEL)) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (T.isConfirmationText(t)) return 'confirmation';
    }
    return null;
  }

  let started = false;
  let confirmed = false;
  let observer = null;
  let handlers = { onSubmit() {}, onConfirm() {} };

  function fireConfirm(how) {
    if (confirmed) return;
    confirmed = true;
    log.info('Application confirmation detected', { how, host: location.hostname });
    handlers.onConfirm(how);
  }

  function check() {
    if (confirmed) return;
    const how = findConfirmation();
    if (how) fireConfirm(how);
  }

  // Watch the page for a while after Submit (SPA forms swap in a "thank you" without navigating).
  let watchTimer = null;
  function watch() {
    if (!observer) {
      let pending = false;
      observer = new MutationObserver(() => {
        if (pending || confirmed) return;
        pending = true;
        setTimeout(() => {
          pending = false;
          check();
        }, 300);
      });
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => observer.disconnect(), CONFIG.watchMs);
  }

  function submitted(form, via) {
    if (!looksLikeApplication(form)) return;
    log.info('Application submit pressed', { via, host: location.hostname });
    confirmed = false; // a new submission can be confirmed again
    handlers.onSubmit();
    watch();
  }

  // Safe to call again: listeners are attached once, handlers are replaced.
  function start(h) {
    handlers = { ...handlers, ...h };
    confirmed = false;
    if (started) return check();
    started = true;
    // Confirmation pages that load after a normal form post: check now and once more after late rendering.
    check();
    setTimeout(check, 2000);

    document.addEventListener('submit', (e) => submitted(e.target, 'form'), true);
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target instanceof Element && e.target.closest('button, input[type=submit], [role=button], a');
        if (!btn) return;
        const label = btn.tagName === 'INPUT' ? btn.value : btn.getAttribute('aria-label') || btn.textContent;
        if (!T.isSubmitLabel(label)) return;
        // Native form submits are handled by the 'submit' listener; this catches JS-driven forms.
        if (btn.form && (btn.type === 'submit' || btn.tagName === 'BUTTON' && !btn.getAttribute('type'))) return;
        submitted(btn.closest('form') || document, 'button');
      },
      true
    );
  }

  AJP.detector = { CONFIG, start, findConfirmation, looksLikeApplication, check };
})();
