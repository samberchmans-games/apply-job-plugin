/*
 * ai-check-view.js — Admin → AI settings → "Check my AI setup": runs the real check for every saved key (one provider
 * at a time), shows Ready or the provider's exact reason, and offers "Use for tailoring" and "Copy results".
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STEP = { short: 'Reply', json: 'JSON', full: 'Full size' };
  let ui = { toast() {} };
  let running = false;
  let last = [];

  const name = (k) => (AJP.ai.PROVIDERS[k] ? AJP.ai.PROVIDERS[k].label.replace(/\s*\(.*$/, '') : k);
  function row(r) {
    if (r.status === 'running') return `<tr><td><b>${esc(r.label)}</b></td><td colspan="3" class="hint">⏳ Checking… (real calls, up to a few minutes)</td></tr>`;
    const best = r.models.find((m) => m.ok) || r.models[r.models.length - 1];
    const steps = best ? best.steps.map((s) => `${s.ok ? '✅' : '❌'} ${STEP[s.name]} ${(s.ms / 1000).toFixed(1)}s`).join(' · ') : '';
    const result = r.status === 'ready' ? '<b>✅ Ready</b>' : r.status === 'nokey' ? 'No key' : '<b>❌ Failed</b>';
    const detail = r.status === 'ready' ? `${esc(r.verified.join(', '))}<br><span class="hint">${esc(steps)}</span>` : `${esc(r.reason || 'No model passed')}${r.code ? ` <span class="hint">(${esc(r.code)})</span>` : ''}${steps ? `<br><span class="hint">${esc(best.model)}: ${esc(steps)}</span>` : ''}`;
    const use = r.status === 'ready' ? `<button data-use="${esc(r.provider)}">Use for tailoring</button>` : '';
    return `<tr><td><b>${esc(r.label)}</b></td><td>${result}</td><td>${detail}</td><td>${use}</td></tr>`;
  }
  function paint(rows) {
    $('#aiCheckOut').innerHTML = rows.length
      ? `<table class="tbl"><thead><tr><th>Provider</th><th>Result</th><th>Model · details</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`
      : '<p class="hint">No API keys saved yet. Add one above, then run the check.</p>';
    $('#aiCheckCopy').hidden = running || !rows.some((r) => r.status !== 'running');
  }
  async function runAll() {
    if (running) return;
    const cfg = (await AJP.store.get('settings')).ai;
    const paid = $('#aiCheckPaid').checked;
    const ids = Object.keys(AJP.ai.PROVIDERS).filter((k) => {
      const p = AJP.ai.PROVIDERS[k];
      return p.needsKey && cfg.keys && cfg.keys[k] && (!p.paid || paid);
    });
    running = true;
    $('#aiCheckRun').disabled = true;
    const rows = ids.map((k) => ({ provider: k, label: name(k), status: 'running', models: [], verified: [] }));
    paint(rows);
    try {
      for (let i = 0; i < ids.length; i++) {
        const r = await AJP.send('ai.check', { provider: ids[i] });
        rows[i] = r && r.ok !== false ? r.result : { provider: ids[i], label: name(ids[i]), status: 'failed', models: [], verified: [], code: r && r.code, reason: (r && r.error) || 'No answer from the extension background' };
        paint(rows);
      }
      last = rows;
    } finally {
      running = false;
      $('#aiCheckRun').disabled = false;
      paint(rows);
    }
  }
  async function render() {
    if (running) return;
    const checks = await AJP.store.get('aiChecks');
    last = Object.values(checks || {});
    if (last.length) paint(last);
  }
  function init(opts = {}) {
    ui = { ...ui, ...opts };
    const g = (n, fn) => AJP.guard(`aiCheck.${n}`, fn, { mod: 'admin', onError: (d) => ui.toast(`${d.message} (${d.code})`) });
    $('#aiCheckRun').addEventListener('click', g('run', runAll));
    $('#aiCheckCopy').addEventListener('click', g('copy', async () => {
      const r = await AJP.send('ai.check.report', { results: last });
      await navigator.clipboard.writeText(r.text);
      ui.toast('Results copied (no keys, no resume)');
    }));
    $('#aiCheckOut').addEventListener('click', (e) => {
      const b = e.target.closest('[data-use]');
      if (!b) return;
      const sel = $('#aiTailor');
      sel.value = b.dataset.use;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      ui.toast(`Resume tailoring now uses ${name(b.dataset.use)}`);
    });
  }
  AJP.aiCheckView = { init, render };
})();
