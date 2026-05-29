import { onRequest, Request } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { Response } from 'express';

admin.initializeApp();
const db = admin.firestore();

const TOCHKA_API = 'https://enter.tochka.com/uapi';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getTochkaSettings() {
  const snap = await db.doc('settings/tochka_api').get();
  return snap.exists ? (snap.data() as any) : null;
}

function normalizeTochkaList(data: any): any[] {
  const candidates = [
    data?.Data, data?.data,
    data?.Data?.payments, data?.Data?.operations, data?.Data?.paymentOperations,
    data?.data?.payments, data?.data?.operations, data?.data?.paymentOperations,
    data?.payments, data?.operations, data?.paymentOperations, data?.result,
  ];
  return candidates.find(Array.isArray) || [];
}

function getTochkaOperationId(op: any) {
  return op?.operationId || op?.OperationId || op?.id || op?.paymentId || '';
}

function getTochkaOperationStatus(op: any) {
  return op?.status || op?.Status || op?.paymentStatus || op?.state || '';
}

function getTochkaOperationAmount(op: any) {
  return op?.amount || op?.Amount || op?.sum || op?.paymentAmount || op?.totalAmount || 0;
}

function normalizeTochkaAmount(value: any) {
  const n = Number(value) || Number(String(value || '').replace(',', '.')) || 0;
  return n > 100000 ? n / 100 : n;
}

function isTochkaPaidStatus(status: any) {
  const s = String(status || '').toLowerCase();
  return ['paid', 'approved', 'completed', 'succeeded', 'success', 'done'].some(x => s.includes(x));
}

function getTochkaPaymentTarget(orderId: string, kind?: string) {
  const paymentLinkId = orderId.trim();
  const suffixFinal = paymentLinkId.toLowerCase().endsWith('-final');
  const isFinal = String(kind || '').toLowerCase() === 'final' || suffixFinal;
  const cleanOrderId = suffixFinal ? paymentLinkId.slice(0, -6) : paymentLinkId;
  return { paymentLinkId, cleanOrderId, isFinal };
}

function buildTochkaPaymentFields(target: any, paymentId: string, paymentStatus: string, paymentAmount: number, operation?: any) {
  const paidAt = new Date().toISOString();
  const isPaid = isTochkaPaidStatus(paymentStatus);
  if (target.isFinal) {
    return {
      ...(paymentId ? { finalPaymentId: paymentId } : {}),
      finalPaymentStatus: paymentStatus,
      ...(paymentAmount > 0 ? { finalPaymentAmount: paymentAmount } : {}),
      finalPaymentFoundAt: paidAt,
      ...(operation ? { finalPaymentData: JSON.stringify(operation).slice(0, 2000) } : {}),
      ...(isPaid ? { finalPaymentPaidAt: paidAt, status: 'Оплачен' } : {}),
    };
  }
  return {
    ...(paymentId ? { paymentId } : {}),
    paymentStatus,
    ...(paymentAmount > 0 ? { paymentAmount } : {}),
    tochkaPaymentFoundAt: paidAt,
    ...(operation ? { tochkaPaymentData: JSON.stringify(operation).slice(0, 2000) } : {}),
    ...(isPaid ? { paymentPaidAt: paidAt, status: 'Оплачен' } : {}),
  };
}

async function findTochkaOperation(token: string, customerCode: string, orderId: string, amount?: number) {
  if (!customerCode || !orderId) return null;
  const response = await axios.get(`${TOCHKA_API}/acquiring/v1.0/payments`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    params: { customerCode },
    timeout: 20000,
  });
  const operations = normalizeTochkaList(response.data);
  const cleanOrderId = orderId.trim().toLowerCase();
  const expectedAmount = Number(amount) || 0;
  const isCloseAmount = (value: unknown) =>
    !expectedAmount || Math.abs(normalizeTochkaAmount(value) - expectedAmount) < 1;

  return operations.find((item: any) => {
    const haystack = JSON.stringify(item || {}).toLowerCase();
    const status = String(getTochkaOperationStatus(item)).toLowerCase();
    return haystack.includes(cleanOrderId)
      && (!status || status.includes('approved') || status.includes('paid'))
      && isCloseAmount(getTochkaOperationAmount(item));
  }) || operations.find((item: any) =>
    JSON.stringify(item || {}).toLowerCase().includes(cleanOrderId)
  ) || null;
}

function setCors(res: Response) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── GET /api/tochka/status ──────────────────────────────────────────────────

export const tochkaStatus = onRequest(async (req: Request, res: Response) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const settings = await getTochkaSettings();
    res.json({ configured: !!(settings?.jwtToken) });
  } catch (e: any) {
    res.status(500).json({ configured: false, error: e.message });
  }
});

// ─── POST /api/tochka/save-token ────────────────────────────────────────────

export const tochkaSaveToken = onRequest(async (req: Request, res: Response) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { jwtToken, merchantId, accountId, paymentMode } = req.body || {};
  try {
    const current = (await getTochkaSettings()) || {};
    const finalToken = (jwtToken || '').trim() || current.jwtToken;
    if (!finalToken) { res.status(400).json({ error: 'Нужен jwtToken' }); return; }

    const payload = JSON.parse(Buffer.from(finalToken.split('.')[1], 'base64').toString());
    const customerCode = payload.customerCode || payload.customer_code || current.customerCode || '';
    await db.doc('settings/tochka_api').set({
      jwtToken: finalToken, customerCode,
      merchantId: merchantId || '',
      accountId: accountId || '',
      paymentMode: Array.isArray(paymentMode) ? paymentMode : ['sbp'],
    }, { merge: true });
    res.json({ success: true, customerCode });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Не удалось сохранить настройки Точки' });
  }
});

// ─── POST /api/tochka/create-payment ────────────────────────────────────────

export const tochkaCreatePayment = onRequest({ timeoutSeconds: 30 }, async (req: Request, res: Response) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { orderId, amount, description } = req.body || {};
  const paymentAmount = Number(amount);
  if (!orderId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    res.status(400).json({ error: 'Нужны orderId и amount больше 0' }); return;
  }

  try {
    const settings = await getTochkaSettings();
    if (!settings?.jwtToken) { res.status(400).json({ error: 'Токен Точки не настроен' }); return; }
    const { jwtToken, customerCode, merchantId, accountId, paymentMode } = settings;
    const modes = Array.isArray(paymentMode) && paymentMode.length ? paymentMode : ['sbp'];

    await db.collection('tochka_logs').add({
      orderId, amount: paymentAmount, description: description || '',
      status: 'request', createdAt: new Date().toISOString(),
    }).catch(() => {});

    const response = merchantId && accountId
      ? await axios.post(
        `${TOCHKA_API}/sbp/v1.0/qr-code/merchant/${merchantId}/${accountId}`,
        {
          Data: {
            amount: Math.round(paymentAmount * 100),
            paymentPurpose: description || `Оплата заказа ${orderId}`,
            qrcType: '02', currency: 'RUB', sourceName: 'YBCRM',
            ttl: 72 * 60, imageParams: { width: 300, height: 300 },
          },
        },
        { headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      )
      : await axios.post(
        `${TOCHKA_API}/acquiring/v1.0/payments`,
        {
          Data: {
            customerCode, amount: Math.round(paymentAmount * 100) / 100,
            purpose: description || `Оплата заказа ${orderId}`,
            paymentMode: modes, paymentLinkId: orderId, ttl: 72 * 60,
          },
        },
        { headers: { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );

    const paymentData = response.data;
    const paymentUrl = paymentData.paymentUrl || paymentData.data?.paymentUrl
      || paymentData.Data?.paymentUrl || paymentData.Data?.payload;
    const paymentId = paymentData.operationId || paymentData.data?.operationId
      || paymentData.Data?.operationId || paymentData.Data?.qrcId;

    if (!paymentUrl) {
      await db.collection('tochka_logs').add({
        orderId, amount: paymentAmount, status: 'error',
        error: 'Точка не вернула paymentUrl',
        response: JSON.stringify(paymentData).slice(0, 1000),
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      res.status(502).json({ error: 'Точка не вернула ссылку оплаты', details: paymentData }); return;
    }

    const target = getTochkaPaymentTarget(orderId);
    const createdAt = new Date().toISOString();
    const paymentFields = target.isFinal
      ? { finalPaymentUrl: paymentUrl, finalPaymentId: paymentId, finalPaymentStatus: 'pending', finalPaymentCreatedAt: createdAt, finalPaymentAmount: paymentAmount }
      : { paymentUrl, paymentId, paymentStatus: 'pending', paymentCreatedAt: createdAt, paymentAmount };
    await db.doc(`orders/${target.cleanOrderId}`).update(paymentFields).catch(() => {});
    await db.doc(`orders_new/${target.cleanOrderId}`).update(paymentFields).catch(() => {});

    await db.collection('tochka_logs').add({
      orderId, amount: paymentAmount, paymentId: paymentId || null,
      paymentUrl, status: 'success', createdAt: new Date().toISOString(),
    }).catch(() => {});

    res.json({ success: true, paymentUrl, paymentId, data: paymentData });
  } catch (e: any) {
    const errData = (e as any).response?.data;
    await db.collection('tochka_logs').add({
      orderId, amount: paymentAmount, status: 'error',
      error: e.message, details: errData ? JSON.stringify(errData).slice(0, 1000) : '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    res.status((e as any).response?.status || 500).json({ error: e.message, details: errData });
  }
});

// ─── GET /api/tochka/find-payment ───────────────────────────────────────────

export const tochkaFindPayment = onRequest({ timeoutSeconds: 30 }, async (req: Request, res: Response) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const orderId = String(req.query.orderId || '').trim();
  const target = getTochkaPaymentTarget(orderId, req.query.kind as string);
  const amount = req.query.amount ? Number(req.query.amount) : undefined;

  if (!orderId) { res.status(400).json({ error: 'Нужен orderId' }); return; }

  try {
    const settings = await getTochkaSettings();
    if (!settings?.jwtToken) { res.status(400).json({ error: 'Токен Точки не настроен' }); return; }
    const { jwtToken, customerCode } = settings;
    if (!customerCode) { res.status(400).json({ error: 'customerCode Точки не настроен' }); return; }

    const operation = await findTochkaOperation(jwtToken, customerCode, target.paymentLinkId, amount)
      || (target.isFinal ? await findTochkaOperation(jwtToken, customerCode, target.cleanOrderId, amount) : null);

    const operationId = getTochkaOperationId(operation);
    if (!operation || !operationId) {
      res.status(404).json({ error: `Оплата по заказу ${orderId} в Точке не найдена` }); return;
    }

    const paymentAmount = normalizeTochkaAmount(getTochkaOperationAmount(operation)) || amount || 0;
    const paymentStatus = getTochkaOperationStatus(operation) || 'found';
    const paymentFields = buildTochkaPaymentFields(target, operationId, paymentStatus, paymentAmount, operation);

    await db.doc(`orders/${target.cleanOrderId}`).update(paymentFields).catch(() => {});
    await db.doc(`orders_new/${target.cleanOrderId}`).update(paymentFields).catch(() => {});
    await db.collection('tochka_logs').add({
      orderId, paymentId: operationId, amount: paymentAmount,
      status: target.isFinal ? 'final_payment_found' : 'payment_found',
      response: JSON.stringify(operation).slice(0, 1000),
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    res.json({
      success: true,
      kind: target.isFinal ? 'final' : 'main',
      paymentId: operationId,
      paymentStatus,
      paymentAmount,
      paymentPaidAt: isTochkaPaidStatus(paymentStatus) ? new Date().toISOString() : undefined,
      data: operation,
    });
  } catch (e: any) {
    const errData = (e as any).response?.data;
    res.status((e as any).response?.status || 500).json({ error: e.message, details: errData });
  }
});
