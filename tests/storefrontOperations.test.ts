import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorefrontOperations } from '../src/lib/storefrontOperations.ts';

test('only in-process invocation grants service identity, not forged headers or body', async () => {
  const operations = createStorefrontOperations();
  let captured: object;
  const handler = operations.register('/test', async (req, res) => {
    captured = req;
    res.json({ trusted: operations.isInternal(req) });
  });
  assert.equal(operations.isInternal({ headers: { 'x-storefront-signature': 'anything' }, body: { service: true } }), false);
  const result = await operations.invoke('/test', {});
  assert.equal(result.data.trusted, true);
  assert.equal(operations.isInternal(captured!), false);
  let publicResult: any;
  await handler({ headers: {}, body: {} }, { json: (data: any) => { publicResult = data; } });
  assert.equal(publicResult.trusted, false);
});

test('unknown routes, unsuccessful and missing responses fail explicitly', async () => {
  const operations = createStorefrontOperations();
  await assert.rejects(operations.invoke('/unknown', {}));
  operations.register('/error', async (_req, res) => res.status(409).json({ error: 'test conflict' }));
  await assert.rejects(operations.invoke('/error', {}), { statusCode: 409 });
  operations.register('/empty', async () => {});
  await assert.rejects(operations.invoke('/empty', {}), /не вернула результат/);
});
