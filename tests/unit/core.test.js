(function () {
  const { describe, it, eq, ok, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;

  describe('core › helpers', () => {
    it('norm lowercases and collapses whitespace', () => eq(AJP.norm('  Hello   World \n'), 'hello world'));
    it('norm handles null/undefined/numbers', () => {
      eq(AJP.norm(null), '');
      eq(AJP.norm(undefined), '');
      eq(AJP.norm(42), '42');
    });
    it('normKey strips punctuation, asterisks and question marks', () =>
      eq(AJP.normKey('  Are you legally authorized to work in the US? *'), 'are you legally authorized to work in the us'));
    it('normKey treats differently punctuated labels as the same question', () =>
      eq(AJP.normKey('Desired Salary:'), AJP.normKey('desired salary')));
    it('normKey caps length at 160', () => ok(AJP.normKey('x'.repeat(500)).length <= 160));
    it('uid is unique and prefixed', () => {
      const a = AJP.uid('res');
      const b = AJP.uid('res');
      ok(a.startsWith('res_'));
      ok(a !== b);
    });
    it('clone deep-copies', () => {
      const o = { a: { b: [1, 2] } };
      const c = AJP.clone(o);
      c.a.b.push(3);
      eq(o.a.b, [1, 2]);
    });
    it('deepMerge merges nested objects and keeps defaults', () => {
      const out = AJP.deepMerge({ a: 1, n: { x: 1, y: 2 }, arr: [1] }, { n: { y: 9 }, arr: [5, 6] });
      eq(out, { a: 1, n: { x: 1, y: 9 }, arr: [5, 6] });
    });
    it('deepMerge ignores non-object source', () => eq(AJP.deepMerge({ a: 1 }, null), { a: 1 }));
    it('getPath / setPath with dotted paths', () => {
      const o = {};
      AJP.setPath(o, 'a.b.c', 5);
      eq(AJP.getPath(o, 'a.b.c'), 5);
      eq(AJP.getPath(o, 'a.x.y'), undefined);
    });
    it('isPlainObject', () => {
      ok(AJP.isPlainObject({}));
      ok(!AJP.isPlainObject([]));
      ok(!AJP.isPlainObject(null));
    });
  });

  describe('core › async helpers', () => {
    it('serial runs tasks one at a time, in order', async () => {
      const run = AJP.serial();
      const order = [];
      await Promise.all([
        run(async () => { await sleep(30); order.push(1); }),
        run(async () => { order.push(2); }),
        run(async () => { await sleep(5); order.push(3); }),
      ]);
      eq(order, [1, 2, 3]);
    });
    it('serial keeps going after a task fails', async () => {
      const run = AJP.serial();
      const p1 = run(async () => { throw new Error('boom'); }).catch(() => 'caught');
      const p2 = run(async () => 'ok');
      eq(await p1, 'caught');
      eq(await p2, 'ok');
    });
    it('debounce collapses rapid calls into one', async () => {
      let n = 0;
      let last;
      const d = AJP.debounce((v) => { n++; last = v; }, 30);
      d(1); d(2); d(3);
      await sleep(60);
      eq(n, 1);
      eq(last, 3);
    });
  }, { env: 'browser' });
})();
