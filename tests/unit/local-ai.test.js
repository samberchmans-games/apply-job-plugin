/*
 * Chrome built-in AI (Prompt API) provider: fitting prompts, the provider with a fake LanguageModel
 * (current and older API shapes), coded errors, the background status message and the Admin screen.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, rejects, beforeEach, afterEach, waitFor } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  describe('local ai › fitting prompts into the on-device window (pure)', () => {
    const fit = (p, n) => AJP.ai.local.fitPrompt(p, n);
    const RULES = 'RULES:\n1. Never invent facts.\n2. JSON only.';
    const big = (ch, n) => ch.repeat(n);
    it('short prompts are unchanged', () => eq(fit('hello', 100), 'hello'));
    it('long blocks shrink, instructions stay whole', () => {
      const p = `${RULES}\n\nRESUME:\n${big('r', 6000)}\n\nJOB DESCRIPTION:\n${big('j', 3000)}`;
      const out = fit(p, 4000);
      ok(out.length <= 4100, String(out.length));
      ok(out.startsWith(RULES), 'rules kept');
      includes(out, 'RESUME:');
      includes(out, '…[shortened]');
    });
    it('shrinks proportionally (the longer block loses more)', () => {
      const out = fit(`${big('r', 6000)}\n\n${big('j', 2000)}`, 4000).split('\n\n');
      ok(out[0].length > out[1].length);
      ok(out[0].length < 6000 && out[1].length < 2000);
    });
    it('no long blocks → plain cut', () => eq(fit(Array(50).fill('short line').join('\n\n'), 100).length, 100));
    it('the provider is listed, needs no key, and is marked local', () => {
      const p = AJP.ai.PROVIDERS.chrome;
      ok(p && p.local && !p.needsKey);
      includes(p.label, 'no key');
    });
  });

  // ---- Fake Prompt API ------------------------------------------------------------------------------
  function fakeLM({ state = 'available', reply = 'OK', quota = null, usage = (t) => Math.ceil(t.length / 4), failCreate = null, failPrompt = null, noConstraint = false, legacy = false } = {}) {
    const log = { creates: [], prompts: [], destroyed: 0, availOpts: null };
    const session = {
      inputQuota: quota,
      inputUsage: 0,
      measureInputUsage: quota ? async (t) => usage(t) : undefined,
      async prompt(t, o = {}) {
        log.prompts.push({ t, o });
        if (noConstraint && o.responseConstraint) throw new TypeError("Unknown option 'responseConstraint'");
        if (failPrompt) {
          const e = failPrompt(t, log.prompts.length);
          if (e) throw e;
        }
        return typeof reply === 'function' ? reply(t, o) : reply;
      },
      destroy() {
        log.destroyed++;
      },
    };
    const create = async (opts = {}) => {
      log.creates.push(opts);
      if (failCreate) throw failCreate;
      if (opts.monitor) {
        const m = new EventTarget();
        opts.monitor(m);
        for (const loaded of [0.25, 0.5, 1]) {
          const e = new Event('downloadprogress');
          e.loaded = loaded;
          m.dispatchEvent(e);
        }
      }
      return session;
    };
    if (legacy) {
      delete globalThis.LanguageModel;
      globalThis.ai = { languageModel: { capabilities: async () => ({ available: { available: 'readily', downloadable: 'after-download', unavailable: 'no' }[state] }), create } };
    } else {
      delete globalThis.ai;
      globalThis.LanguageModel = { availability: async (opts) => ((log.availOpts = opts), state), create };
    }
    return log;
  }
  const clearLM = () => {
    delete globalThis.LanguageModel;
    delete globalThis.ai;
  };
  const useChrome = () => AJP.store.update('settings', (s) => void (s.ai.provider = 'chrome'));

  describe('local ai › the provider', () => {
    let saved;
    beforeEach(async () => {
      await globalThis.browser.__reset();
      await useChrome();
      saved = { ...AJP.ai.CONFIG };
    });
    afterEach(() => {
      clearLM();
      Object.assign(AJP.ai.CONFIG, saved);
    });

    it('answers on-device: system prompt as the session\'s first prompt, user prompt asked, session freed', async () => {
      const lm = fakeLM({ reply: 'OK' });
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(lm.creates[0].initialPrompts, [{ role: 'system', content: 'Reply with one word.' }]);
      eq(lm.creates[0].expectedInputs[0].languages, ['en']);
      eq(lm.prompts[0].t, 'Say OK.');
      eq(lm.destroyed, 1);
    });
    it('no fetch is made (nothing leaves the computer)', async () => {
      fakeLM();
      const real = globalThis.fetch;
      let fetched = 0;
      globalThis.fetch = async () => (fetched++, new Response('{}'));
      try {
        await AJP.ai.tasks.test();
      } finally {
        globalThis.fetch = real;
      }
      eq(fetched, 0);
    });
    it('JSON tasks ask for a JSON object (responseConstraint) and parse the answer', async () => {
      const lm = fakeLM({ reply: '{"required_skills":["Java"],"preferred_skills":[]}' });
      const r = await AJP.ai.tasks.extractSkills({ jd: 'Java developer' });
      eq(r.required_skills, ['Java']);
      eq(lm.prompts[0].o.responseConstraint, { type: 'object' });
    });
    it('older builds without responseConstraint: asked again without it', async () => {
      const lm = fakeLM({ reply: '{"a":1}', noConstraint: true });
      eq(await AJP.ai.complete({ system: 's', prompt: 'p', json: true }), { a: 1 });
      eq(lm.prompts.length, 2);
      eq(lm.prompts[1].o.responseConstraint, undefined);
    });
    it('the older ai.languageModel API works too (systemPrompt)', async () => {
      const lm = fakeLM({ legacy: true });
      eq(await AJP.ai.tasks.test(), 'OK');
      eq(lm.creates[0].systemPrompt, 'Reply with one word.');
    });
    it('long prompts are shortened to fit the measured input quota', async () => {
      const lm = fakeLM({ quota: 1000, usage: (t) => Math.ceil(t.length / 4) });
      AJP.ai.CONFIG.localMaxChars = 100000;
      await AJP.ai.complete({ system: 's', prompt: `RULES: keep\n\nRESUME:\n${'x'.repeat(20000)}` });
      ok(lm.prompts[0].t.length / 4 <= 1000, String(lm.prompts[0].t.length));
      ok(lm.prompts[0].t.startsWith('RULES: keep'));
    });
    it('QuotaExceededError → shortened and asked again', async () => {
      const lm = fakeLM({ failPrompt: (t, n) => (n === 1 ? new DOMException('too long', 'QuotaExceededError') : null) });
      eq(await AJP.ai.complete({ system: 's', prompt: `A\n\n${'y'.repeat(3000)}` }), 'OK');
      ok(lm.prompts[1].t.length < lm.prompts[0].t.length);
    });
    it('still too long after shortening → AJP-AI-LOCAL-LEN', async () => {
      fakeLM({ failPrompt: () => new DOMException('too long', 'QuotaExceededError') });
      eq((await rejects(() => AJP.ai.complete({ system: 's', prompt: 'x'.repeat(5000) }))).code, 'AJP-AI-LOCAL-LEN');
    });
    for (const [state, code] of [['downloadable', 'AJP-AI-LOCAL-DL'], ['downloading', 'AJP-AI-LOCAL-DL'], ['unavailable', 'AJP-AI-LOCAL-OFF']])
      it(`model "${state}" → ${code} with a how-to hint`, async () => {
        fakeLM({ state });
        const e = await rejects(() => AJP.ai.tasks.test());
        eq(e.code, code);
        ok(e.hint.length > 20);
      });
    it('a browser without built-in AI → AJP-AI-LOCAL-NONE', async () => {
      clearLM();
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-LOCAL-NONE');
    });
    it('the browser wants a click (NotAllowedError) → AJP-AI-LOCAL-DL', async () => {
      fakeLM({ failCreate: new DOMException('needs activation', 'NotAllowedError') });
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-LOCAL-DL');
    });
    it('too slow → AJP-AI-TIME, and the session is freed', async () => {
      AJP.ai.CONFIG.timeoutMs = 50;
      const lm = fakeLM({ reply: (t, o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))) });
      eq((await rejects(() => AJP.ai.tasks.test())).code, 'AJP-AI-TIME');
      eq(lm.destroyed, 1);
    });
    it('failures are logged with the code and the provider, never the prompt text', async () => {
      fakeLM({ state: 'unavailable' });
      const got = [];
      const saved = AJP.getLogSink();
      AJP.setLogSink(async (e) => got.push(...e));
      try {
        await rejects(() => AJP.ai.complete({ system: 's', prompt: 'SECRET RESUME TEXT', task: 'probe' }));
        await AJP.flushLogs();
      } finally {
        AJP.setLogSink(saved);
      }
      const e = got.find((l) => /ai\.probe/.test(l.msg) && l.lvl === 'error');
      ok(e, 'logged');
      eq(e.code, 'AJP-AI-LOCAL-OFF');
      excludes(JSON.stringify(got), 'SECRET RESUME TEXT');
    });
    it('EEO answers are never in the prompt (same tasks, same rules)', async () => {
      const lm = fakeLM();
      const profile = AJP.clone(AJP.store.DEFAULTS.profile);
      profile.autoApply.eeo = { gender: 'Female', race: 'Asian', veteran: 'I am a protected veteran', disability: 'Yes', hispanic: 'No', pronouns: 'she/her' };
      await AJP.ai.tasks.draftAnswer({ question: 'Why us?', jd: 'jd', resumeText: 'resume', profile, job: {} });
      const all = JSON.stringify(lm.prompts) + JSON.stringify(lm.creates);
      for (const v of ['Asian', 'protected veteran', 'she/her']) excludes(all, v);
    });
    it('status: state and which API was found', async () => {
      fakeLM({ state: 'downloadable' });
      eq(await AJP.ai.local.status(), { state: 'downloadable', api: 'LanguageModel' });
      clearLM();
      eq((await AJP.ai.local.status()).state, 'unsupported');
    });
    it('download reports progress 0 → 1 and returns the new status', async () => {
      const lm = fakeLM({ state: 'available' });
      const seen = [];
      const st = await AJP.ai.local.download((p) => seen.push(p));
      eq(seen, [0.25, 0.5, 1]);
      eq(st.state, 'available');
      eq(lm.destroyed, 1);
    });
    it('the background answers ai.localStatus', async () => {
      fakeLM({ state: 'available' });
      eq((await AJP.send('ai.localStatus')).state, 'available');
    });
  }, { env: 'browser' });

  describe('local ai › Admin → AI settings', () => {
    let frame;
    let w;
    const $ = (s) => w.document.querySelector(s);
    afterEach(() => frame && frame.remove());
    async function loadAdmin(provider, state) {
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      html = html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>');
      // Headless Chrome may have its own built-in AI: remove it for the "unsupported" case.
      const fake = state === 'unsupported' ? '<script>try{delete window.LanguageModel}catch(e){};window.LanguageModel=undefined;try{delete window.ai}catch(e){}</script>' :
        `<script>window.__dl=0;window.LanguageModel={availability:async()=>window.__state,create:async(o)=>{if(o&&o.monitor){const m=new EventTarget();o.monitor(m);for(const l of [0.5,1]){const e=new Event('downloadprogress');e.loaded=l;m.dispatchEvent(e);}window.__dl++;window.__state='available';}return{prompt:async()=>'OK',destroy(){}}}};window.__state=${JSON.stringify(state)};</script>`;
      const seed = { settings: { ...AJP.clone(AJP.store.DEFAULTS.settings), ai: { ...AJP.clone(AJP.store.DEFAULTS.settings.ai), provider } } };
      const page = html.replace('<head>', '<head><base href="' + new URL('../src/admin/', location.href).href + '"><script>window.__SEED__=' + JSON.stringify(seed) + '</script>' + fake)
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = page;
      });
      w = frame.contentWindow;
      await waitFor(() => w.AJP && $('#ver') && $('#ver').textContent, { msg: 'admin' });
      w.location.hash = 'ai';
      await waitFor(() => $('#ai').classList.contains('on'), { msg: 'ai tab' });
    }

    it('the provider list offers Chrome built-in AI', async () => {
      await loadAdmin('none', 'available');
      ok([...$('#aiProvider').options].some((o) => o.value === 'chrome'));
    });
    it('ready but not chosen → a "Use it" banner that switches the provider', async () => {
      await loadAdmin('none', 'available');
      await waitFor(() => !$('#aiLocalOffer').hidden, { msg: 'banner' });
      $('#aiLocalUse').click();
      await waitFor(async () => (await w.AJP.store.get('settings')).ai.provider === 'chrome', { msg: 'switched' });
      await waitFor(() => !$('#aiLocal').hidden && /Ready/.test($('#aiLocalState').textContent), { msg: 'status shown' });
      ok($('#aiLocalOffer').hidden);
    });
    it('needs download → Download button with progress, then Ready', async () => {
      await loadAdmin('chrome', 'downloadable');
      await waitFor(() => !$('#aiLocalDownload').hidden, { msg: 'download button' });
      includes($('#aiLocalState').textContent, 'one-time');
      $('#aiLocalDownload').click();
      await waitFor(() => /Downloaded/.test($('#aiLocalOut').textContent), { msg: 'done' });
      eq([w.__dl, $('#aiLocalProgress').value], [1, 1]);
      await waitFor(() => /Ready/.test($('#aiLocalState').textContent) && $('#aiLocalDownload').hidden, { msg: 'ready' });
    });
    it('not supported in this browser → says so, no Download button, no banner', async () => {
      await loadAdmin('chrome', 'unsupported');
      await waitFor(() => /no built-in AI/.test($('#aiLocalState').textContent), { msg: 'unsupported text' });
      ok($('#aiLocalDownload').hidden);
      ok($('#aiLocalOffer').hidden);
    });
    it('Test connection works through the background', async () => {
      await loadAdmin('chrome', 'available');
      $('#aiTest').click();
      await waitFor(() => /Works/.test($('#aiTestOut').textContent), { msg: 'test ok' });
    });
  }, { env: 'browser' });
})();
