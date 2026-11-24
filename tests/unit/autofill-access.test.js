/*
 * "Autofill form" clicked in the panel on a job site (report: Greenhouse embed page answered AJP-PAGE-ACCESS).
 * The page already runs our scripts; re-injecting needs broader access the browser may refuse, and must not block it.
 */
(function () {
  const { describe, it, eq, ok, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  let realExec;
  const refused = async () => {
    throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
  };

  describe('autofill › the browser refuses re-injection', () => {
    beforeEach(async () => {
      await mock.__reset();
      realExec = mock.scripting.executeScript;
      mock.scripting.executeScript = refused;
    });
    afterEach(() => {
      mock.scripting.executeScript = realExec;
    });
    it('from the panel on a job site: the form is still filled', async () => {
      mock.__senderUrl = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1';
      const r = await AJP.send('autofillTab', {});
      ok(r.ok !== false, JSON.stringify(r));
      ok(mock.__tabMsgs.some((m) => m.msg.type === 'doAutofill'), 'fill request sent to the page');
    });
    it('from the toolbar on a page without our scripts: the clear error stays', async () => {
      const r = await AJP.send('autofillTab', { tabId: 7 });
      eq(r.code, 'AJP-PAGE-ACCESS');
    });
  }, { env: 'browser' });
})();
