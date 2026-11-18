/*
 * stage.js — runs inside a scene page (the REAL extension page + browser mock) while headless Chrome
 * takes the screenshot. It seeds data, performs the scene's actions, then draws the overlay:
 * a caption bar, a "Check x.y" badge, and a highlight ring around the element the step is about.
 *
 * The scene config is window.__SCENE__ = { seed, actions: "js source", highlight: "css selector",
 *   caption, check, part, partTitle, step, total }.
 * Overlays use the popover top layer so they sit above modal dialogs.
 */
(function () {
  'use strict';
  const S = window.__SCENE__ || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);

  // Helpers available to scene actions.
  const H = {
    $,
    sleep,
    async waitFor(fn, timeout = 4000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await sleep(50);
      }
      return null;
    },
    fill(sel, value) {
      const el = typeof sel === 'string' ? $(sel) : sel;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el;
    },
    click(sel) {
      const el = typeof sel === 'string' ? $(sel) : sel;
      el.click();
      return el;
    },
    pin(sel) {
      // Keep a transient element (toast) visible for the screenshot.
      const el = $(sel);
      if (el) el.style.setProperty('opacity', '0.95', 'important');
    },
    go(hash) {
      location.hash = hash;
    },
    shadow() {
      const host = document.querySelector('ajp-panel');
      return host && host.shadowRoot;
    },
    fakeAI(answers) {
      let i = 0;
      window.fetch = async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: typeof answers[Math.min(i, answers.length - 1)] === 'string' ? answers[Math.min(i++, answers.length - 1)] : JSON.stringify(answers[Math.min(i++, answers.length - 1)]) } }] }));
    },
  };
  window.H = H;

  const CSS = `
    .ajp-v-bar{position:fixed;left:0;right:0;bottom:0;margin:0;border:0;padding:18px 28px;width:100%;box-sizing:border-box;
      background:rgba(15,23,42,.92);color:#fff;font:600 22px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      display:flex;gap:18px;align-items:center;inset:auto 0 0 0}
    .ajp-v-bar .part{font-size:15px;font-weight:600;background:#2563eb;border-radius:999px;padding:5px 12px;white-space:nowrap}
    .ajp-v-bar .cap{flex:1}
    .ajp-v-bar .chk{font-size:16px;background:#f59e0b;color:#111827;border-radius:999px;padding:5px 12px;white-space:nowrap}
    .ajp-v-bar .num{font-size:14px;opacity:.7;white-space:nowrap}
    .ajp-v-ring{position:fixed;margin:0;padding:0;border:4px solid #f59e0b;border-radius:12px;background:transparent;
      box-shadow:0 0 0 6px rgba(245,158,11,.25),0 0 28px rgba(245,158,11,.55);pointer-events:none;overflow:visible}
  `;

  function topLayer(el) {
    el.setAttribute('popover', 'manual');
    document.body.appendChild(el);
    try {
      el.showPopover();
    } catch (_) {
      el.style.zIndex = 2147483647;
    }
  }

  function drawOverlay() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    if (S.highlight) {
      const targets = [].concat(S.highlight).map((sel) => {
        if (sel.startsWith('shadow:')) {
          const sh = H.shadow();
          return sh && sh.querySelector(sel.slice(7));
        }
        return document.querySelector(sel);
      });
      for (const t of targets.filter(Boolean)) {
        t.scrollIntoView({ block: 'center' });
      }
      for (const t of targets.filter(Boolean)) {
        const r = t.getBoundingClientRect();
        const ring = document.createElement('div');
        ring.className = 'ajp-v-ring';
        const pad = 8;
        Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
        topLayer(ring);
      }
    }
    if (S.caption) {
      const bar = document.createElement('div');
      bar.className = 'ajp-v-bar';
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      bar.innerHTML = `<span class="part">Part ${esc(S.part)} · ${esc(S.partTitle)}</span><span class="cap">${esc(S.caption)}</span>` +
        (S.check ? `<span class="chk">Check ${esc(S.check)}</span>` : '') + `<span class="num">${esc(S.step)}/${esc(S.total)}</span>`;
      topLayer(bar);
    }
    document.documentElement.dataset.stageReady = '1';
  }

  async function run() {
    try {
      // eslint-disable-next-line no-new-func
      if (S.actions) await new Function('H', '$', 'sleep', `return (async () => { ${S.actions} })();`)(H, $, sleep);
    } catch (e) {
      console.error('[stage] action failed', e);
      document.title = 'STAGE ERROR: ' + e.message;
    }
    await sleep(S.settle || 400);
    drawOverlay();
  }

  // Seed storage before the page's own scripts read it (mock is loaded first).
  if (S.seed && globalThis.browser) globalThis.browser.storage.local.set(JSON.parse(JSON.stringify(S.seed)));
  window.addEventListener('load', () => setTimeout(run, S.startDelay || 600));
})();
