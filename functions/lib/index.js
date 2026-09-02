"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tochkaFindPayment = exports.tochkaCreatePayment = exports.tochkaOAuthCallback = exports.tochkaOAuthStart = exports.tochkaOAuthSaveClient = exports.tochkaOAuthStatus = exports.tochkaSaveToken = exports.tochkaStatus = exports.passkeyLoginVerify = exports.passkeyLoginOptions = exports.passkeyRegisterVerify = exports.passkeyRegisterOptions = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const server_1 = require("@simplewebauthn/server");
const firestore_1 = require("firebase-admin/firestore");
admin.initializeApp();
const db = (0, firestore_1.getFirestore)('production');
const TOCHKA_API = 'https://enter.tochka.com/uapi';
const TOCHKA_OAUTH_AUTHORIZE_URL = process.env.TOCHKA_OAUTH_AUTHORIZE_URL || 'https://enter.tochka.com/connect/authorize';
const TOCHKA_OAUTH_TOKEN_URL = process.env.TOCHKA_OAUTH_TOKEN_URL || 'https://enter.tochka.com/connect/token';
// ─── Helpers ────────────────────────────────────────────────────────────────
async function getTochkaSettings() {
    const snap = await db.doc('settings/tochka_api').get();
    return snap.exists ? snap.data() : null;
}
function decodeJwtPayload(token) {
    try {
        const payloadPart = String(token || '').split('.')[1];
        if (!payloadPart)
            return {};
        const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    }
    catch {
        return {};
    }
}
async function getTochkaOAuthSettings() {
    const snap = await db.doc('settings/tochka_oauth').get();
    return snap.exists ? snap.data() : {};
}
function getTochkaOAuthRedirectUrl(req, savedRedirectUrl) {
    if (savedRedirectUrl)
        return savedRedirectUrl;
    const configuredBase = process.env.SERVER_URL || process.env.TOCHKA_OAUTH_BASE_URL || '';
    if (configuredBase)
        return `${configuredBase.replace(/\/$/, '')}/api/tochka/oauth/callback`;
    const host = req?.get('host') || 'ybcrm.ru';
    const proto = req?.protocol || 'https';
    return `${proto}://${host}/api/tochka/oauth/callback`;
}
async function exchangeTochkaOAuthCode(settings, code, redirectUrl) {
    const tokenUrls = Array.from(new Set([
        settings.tokenUrl || TOCHKA_OAUTH_TOKEN_URL,
        'https://enter.tochka.com/connect/token',
        'https://enter.tochka.com/oauth/token',
    ]));
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirectUrl);
    params.set('client_id', settings.clientId);
    params.set('client_secret', settings.clientSecret);
    let lastError = null;
    for (const tokenUrl of tokenUrls) {
        try {
            const response = await axios_1.default.post(tokenUrl, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
                },
                timeout: 20000,
            });
            return { tokenUrl, data: response.data };
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
function normalizeTochkaList(data) {
    const candidates = [
        data?.Data, data?.data,
        data?.Data?.payments, data?.Data?.operations, data?.Data?.paymentOperations,
        data?.data?.payments, data?.data?.operations, data?.data?.paymentOperations,
        data?.payments, data?.operations, data?.paymentOperations, data?.result,
    ];
    return candidates.find(Array.isArray) || [];
}
function findTochkaValueByKeys(data, keys) {
    const wanted = new Set(keys.map(key => key.toLowerCase()));
    const seen = new Set();
    const walk = (value) => {
        if (!value || typeof value !== 'object' || seen.has(value))
            return null;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = walk(item);
                if (found !== null && found !== undefined && found !== '')
                    return found;
            }
            return null;
        }
        for (const [key, nestedValue] of Object.entries(value)) {
            if (wanted.has(key.toLowerCase()) && nestedValue !== null && nestedValue !== undefined && nestedValue !== '') {
                return nestedValue;
            }
        }
        for (const nestedValue of Object.values(value)) {
            const found = walk(nestedValue);
            if (found !== null && found !== undefined && found !== '')
                return found;
        }
        return null;
    };
    return walk(data);
}
function getTochkaPaymentUrl(data) {
    const value = findTochkaValueByKeys(data, [
        'paymentUrl',
        'paymentURL',
        'paymentLink',
        'paymentLinkUrl',
        'qrUrl',
        'qrcUrl',
        'qrcLink',
        'url',
        'link',
        'payload',
        'qrCode',
        'qrcode',
        'qrPayload',
        'sbpPayload',
    ]);
    return value ? String(value) : '';
}
function getTochkaPaymentId(data) {
    const value = findTochkaValueByKeys(data, [
        'operationId',
        'paymentId',
        'qrcId',
        'qrId',
        'id',
    ]);
    return value ? String(value) : '';
}
function getTochkaErrorMessage(error) {
    const data = error?.response?.data;
    if (!data)
        return error?.message || 'Неизвестная ошибка';
    return data?.message
        || data?.error_description
        || data?.error
        || data?.errors?.[0]?.message
        || data?.Errors?.[0]?.message
        || JSON.stringify(data).slice(0, 240);
}
async function fetchTochkaQrById(token, merchantId, accountId, qrId) {
    if (!qrId)
        return null;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const encodedMerchant = encodeURIComponent(merchantId);
    const encodedAccount = encodeURIComponent(accountId);
    const encodedQr = encodeURIComponent(qrId);
    const urls = [
        `${TOCHKA_API}/sbp/v1.0/qr-codes/${encodedQr}/payment-status`,
        `${TOCHKA_API}/sbp/v1.0/qr-code/${encodedQr}`,
        `${TOCHKA_API}/sbp/v1.0/qr-code/merchant/${encodedMerchant}/${encodedAccount}/${encodedQr}`,
        `${TOCHKA_API}/sbp/v1.0/qr-code/merchant/${encodedMerchant}/${encodedAccount}`,
    ];
    let lastError = null;
    for (const url of urls) {
        try {
            const response = await axios_1.default.get(url, {
                headers,
                params: { qrcId: qrId, qrId },
                timeout: 20000,
            });
            const paymentUrl = getTochkaPaymentUrl(response.data);
            const paymentStatus = getTochkaOperationStatus(response.data)
                || findTochkaValueByKeys(response.data, ['qrcStatus', 'qrStatus', 'status']);
            if (paymentUrl || paymentStatus)
                return { data: response.data, paymentUrl, paymentStatus };
            lastError = new Error('QR response has no payment url');
        }
        catch (error) {
            lastError = error;
        }
    }
    if (lastError)
        throw lastError;
    return null;
}
function getTochkaOperationId(op) {
    return op?.operationId || op?.OperationId || op?.id || op?.paymentId || '';
}
function getTochkaOperationStatus(op) {
    return op?.status || op?.Status || op?.paymentStatus || op?.state || '';
}
function getTochkaOperationAmount(op) {
    return op?.amount || op?.Amount || op?.sum || op?.paymentAmount || op?.totalAmount || 0;
}
function normalizeTochkaAmount(value) {
    const n = Number(value) || Number(String(value || '').replace(',', '.')) || 0;
    return n > 100000 ? n / 100 : n;
}
function isTochkaPaidStatus(status) {
    const s = String(status || '').toLowerCase();
    return ['paid', 'approved', 'accepted', 'completed', 'succeeded', 'success', 'done'].some(x => s.includes(x));
}
function getTochkaPaymentTarget(orderId, kind) {
    const paymentLinkId = orderId.trim();
    const suffixFinal = paymentLinkId.toLowerCase().endsWith('-final');
    const isFinal = String(kind || '').toLowerCase() === 'final' || suffixFinal;
    const cleanOrderId = suffixFinal ? paymentLinkId.slice(0, -6) : paymentLinkId;
    return { paymentLinkId, cleanOrderId, isFinal };
}
function buildTochkaPaymentFields(target, paymentId, paymentStatus, paymentAmount, operation) {
    const paidAt = new Date().toISOString();
    const isPaid = isTochkaPaidStatus(paymentStatus);
    if (target.isFinal) {
        return {
            ...(paymentId ? { finalPaymentId: paymentId } : {}),
            finalPaymentStatus: paymentStatus,
            ...(paymentAmount > 0 ? { finalPaymentAmount: paymentAmount } : {}),
            finalPaymentFoundAt: paidAt,
            ...(operation ? { finalPaymentData: JSON.stringify(operation).slice(0, 2000) } : {}),
            paymentAccountingVersion: 2,
            ...(isPaid ? { finalPaymentPaidAt: paidAt } : {}),
        };
    }
    return {
        ...(paymentId ? { paymentId } : {}),
        paymentStatus,
        ...(paymentAmount > 0 ? { paymentAmount } : {}),
        tochkaPaymentFoundAt: paidAt,
        ...(operation ? { tochkaPaymentData: JSON.stringify(operation).slice(0, 2000) } : {}),
        paymentAccountingVersion: 2,
        ...(paymentAmount > 0 ? { initialPaymentAmount: paymentAmount } : {}),
        ...(isPaid ? { paymentPaidAt: paidAt } : {}),
    };
}
async function findTochkaOperation(token, customerCode, orderId, amount) {
    if (!customerCode || !orderId)
        return null;
    const response = await axios_1.default.get(`${TOCHKA_API}/acquiring/v1.0/payments`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        params: { customerCode },
        timeout: 20000,
    });
    const operations = normalizeTochkaList(response.data);
    const cleanOrderId = orderId.trim().toLowerCase();
    const expectedAmount = Number(amount) || 0;
    const isCloseAmount = (value) => !expectedAmount || Math.abs(normalizeTochkaAmount(value) - expectedAmount) < 1;
    return operations.find((item) => {
        const haystack = JSON.stringify(item || {}).toLowerCase();
        const status = String(getTochkaOperationStatus(item)).toLowerCase();
        return haystack.includes(cleanOrderId)
            && (!status || status.includes('approved') || status.includes('paid'))
            && isCloseAmount(getTochkaOperationAmount(item));
    }) || operations.find((item) => JSON.stringify(item || {}).toLowerCase().includes(cleanOrderId)) || null;
}
function setCors(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function getRequestOrigin(req) {
    return req.get('origin') || `${req.protocol || 'https'}://${req.get('host') || 'ybcrm.ru'}`;
}
function getWebAuthnRpId(req) {
    const host = (req.get('x-forwarded-host') || req.get('host') || 'ybcrm.ru').split(':')[0];
    if (host === 'localhost' || host === '127.0.0.1')
        return 'localhost';
    if (host.endsWith('ybcrm.ru'))
        return 'ybcrm.ru';
    return host;
}
function getExpectedOrigins(req) {
    const origin = getRequestOrigin(req);
    return Array.from(new Set([
        origin,
        'https://ybcrm.ru',
        'https://www.ybcrm.ru',
        'http://localhost:3000',
        'http://localhost:5173',
    ]));
}
async function verifyFirebaseBearer(req) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token)
        throw new Error('Нет Firebase токена авторизации');
    return admin.auth().verifyIdToken(token);
}
function passkeyChallengeRef(id) {
    return db.collection('passkey_challenges').doc(id);
}
function passkeyRef(id) {
    return db.collection('passkeys').doc(id);
}
function uidToBytes(uid) {
    return new Uint8Array(Buffer.from(uid, 'utf8'));
}
function bytesToBase64Url(bytes) {
    return Buffer.from(bytes).toString('base64url');
}
function base64UrlToBytes(value) {
    return new Uint8Array(Buffer.from(value, 'base64url'));
}
async function deleteExpiredPasskeyChallenges() {
    const expired = await db.collection('passkey_challenges')
        .where('expiresAt', '<', Date.now())
        .limit(25)
        .get();
    await Promise.all(expired.docs.map(docSnap => docSnap.ref.delete()));
}
// ─── Passkeys / Face ID / Touch ID ─────────────────────────────────────────
exports.passkeyRegisterOptions = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const decoded = await verifyFirebaseBearer(req);
        const uid = decoded.uid;
        const email = decoded.email || `${uid}@ybcrm.local`;
        const existing = await db.collection('passkeys').where('uid', '==', uid).get();
        const options = await (0, server_1.generateRegistrationOptions)({
            rpName: 'YBCRM',
            rpID: getWebAuthnRpId(req),
            userID: uidToBytes(uid),
            userName: email,
            userDisplayName: decoded.name || email,
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            excludeCredentials: existing.docs.map(docSnap => ({
                id: docSnap.id,
                transports: (docSnap.data()?.transports || undefined),
            })),
        });
        const requestId = db.collection('passkey_challenges').doc().id;
        await passkeyChallengeRef(requestId).set({
            challenge: options.challenge,
            type: 'register',
            uid,
            email,
            rpID: getWebAuthnRpId(req),
            origin: getRequestOrigin(req),
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        void deleteExpiredPasskeyChallenges().catch(() => { });
        res.json({ requestId, options });
    }
    catch (e) {
        res.status(401).json({ error: e.message || 'Не удалось начать привязку Face ID' });
    }
});
exports.passkeyRegisterVerify = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const decoded = await verifyFirebaseBearer(req);
        const { requestId, response } = req.body || {};
        if (!requestId || !response) {
            res.status(400).json({ error: 'Нет данных passkey' });
            return;
        }
        const challengeDoc = await passkeyChallengeRef(requestId).get();
        const challenge = challengeDoc.data();
        if (!challenge || challenge.type !== 'register' || challenge.uid !== decoded.uid || challenge.expiresAt < Date.now()) {
            res.status(400).json({ error: 'Сессия привязки устарела, попробуйте ещё раз' });
            return;
        }
        const verification = await (0, server_1.verifyRegistrationResponse)({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: getExpectedOrigins(req),
            expectedRPID: challenge.rpID || getWebAuthnRpId(req),
            requireUserVerification: false,
        });
        if (!verification.verified || !verification.registrationInfo) {
            res.status(400).json({ error: 'Face ID не подтверждён устройством' });
            return;
        }
        const credential = verification.registrationInfo.credential;
        await passkeyRef(credential.id).set({
            uid: decoded.uid,
            email: decoded.email || challenge.email || '',
            credentialId: credential.id,
            credentialPublicKey: bytesToBase64Url(credential.publicKey),
            counter: credential.counter,
            transports: response.response?.transports || credential.transports || [],
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            origin: verification.registrationInfo.origin,
            rpID: verification.registrationInfo.rpID || challenge.rpID || getWebAuthnRpId(req),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsedAt: null,
        }, { merge: true });
        await challengeDoc.ref.delete();
        res.json({ success: true, email: decoded.email || challenge.email || '' });
    }
    catch (e) {
        res.status(400).json({ error: e.message || 'Не удалось привязать Face ID' });
    }
});
exports.passkeyLoginOptions = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID: getWebAuthnRpId(req),
            userVerification: 'preferred',
        });
        const requestId = db.collection('passkey_challenges').doc().id;
        await passkeyChallengeRef(requestId).set({
            challenge: options.challenge,
            type: 'login',
            rpID: getWebAuthnRpId(req),
            origin: getRequestOrigin(req),
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        void deleteExpiredPasskeyChallenges().catch(() => { });
        res.json({ requestId, options });
    }
    catch (e) {
        res.status(400).json({ error: e.message || 'Не удалось начать вход по Face ID' });
    }
});
exports.passkeyLoginVerify = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const { requestId, response } = req.body || {};
        if (!requestId || !response?.id) {
            res.status(400).json({ error: 'Нет данных passkey' });
            return;
        }
        const challengeDoc = await passkeyChallengeRef(requestId).get();
        const challenge = challengeDoc.data();
        if (!challenge || challenge.type !== 'login' || challenge.expiresAt < Date.now()) {
            res.status(400).json({ error: 'Сессия входа устарела, попробуйте ещё раз' });
            return;
        }
        const passkeyDoc = await passkeyRef(response.id).get();
        const passkey = passkeyDoc.data();
        if (!passkey?.uid || !passkey?.credentialPublicKey) {
            res.status(404).json({ error: 'Этот Face ID ещё не привязан к CRM' });
            return;
        }
        const credential = {
            id: passkey.credentialId || passkeyDoc.id,
            publicKey: base64UrlToBytes(passkey.credentialPublicKey),
            counter: Number(passkey.counter) || 0,
            transports: passkey.transports || undefined,
        };
        const verification = await (0, server_1.verifyAuthenticationResponse)({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: getExpectedOrigins(req),
            expectedRPID: challenge.rpID || passkey.rpID || getWebAuthnRpId(req),
            credential,
            requireUserVerification: false,
        });
        if (!verification.verified) {
            res.status(401).json({ error: 'Face ID не прошёл проверку' });
            return;
        }
        await passkeyDoc.ref.set({
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await challengeDoc.ref.delete();
        const customToken = await admin.auth().createCustomToken(passkey.uid);
        res.json({ success: true, customToken, email: passkey.email || '' });
    }
    catch (e) {
        res.status(400).json({ error: e.message || 'Не удалось войти по Face ID' });
    }
});
// ─── GET /api/tochka/status ──────────────────────────────────────────────────
exports.tochkaStatus = (0, https_1.onRequest)(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const settings = await getTochkaSettings();
        res.json({ configured: !!(settings?.jwtToken) });
    }
    catch (e) {
        res.status(500).json({ configured: false, error: e.message });
    }
});
// ─── POST /api/tochka/save-token ────────────────────────────────────────────
exports.tochkaSaveToken = (0, https_1.onRequest)(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { jwtToken, merchantId, accountId, paymentMode } = req.body || {};
    try {
        const current = (await getTochkaSettings()) || {};
        const finalToken = (jwtToken || '').trim() || current.jwtToken;
        if (!finalToken) {
            res.status(400).json({ error: 'Нужен jwtToken' });
            return;
        }
        const payload = JSON.parse(Buffer.from(finalToken.split('.')[1], 'base64').toString());
        const customerCode = payload.customerCode || payload.customer_code || current.customerCode || '';
        await db.doc('settings/tochka_api').set({
            jwtToken: finalToken, customerCode,
            merchantId: merchantId || '',
            accountId: accountId || '',
            paymentMode: Array.isArray(paymentMode) ? paymentMode : ['sbp'],
        }, { merge: true });
        res.json({ success: true, customerCode });
    }
    catch (e) {
        res.status(400).json({ error: e.message || 'Не удалось сохранить настройки Точки' });
    }
});
// ─── Новый OAuth Точки. Старый JWT-ввод выше остается рабочим. ───────────────
exports.tochkaOAuthStatus = (0, https_1.onRequest)(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const oauth = await getTochkaOAuthSettings();
        const tokenSettings = await getTochkaSettings();
        res.json({
            configured: !!(oauth.clientId && oauth.clientSecret),
            connected: !!(tokenSettings?.oauthConnected || tokenSettings?.oauthAccessToken),
            clientIdPreview: oauth.clientId ? `${String(oauth.clientId).slice(0, 6)}...${String(oauth.clientId).slice(-4)}` : '',
            redirectUrl: getTochkaOAuthRedirectUrl(req, oauth.redirectUrl),
            scope: oauth.scope || '',
            tokenUrl: oauth.tokenUrl || TOCHKA_OAUTH_TOKEN_URL,
            authorizeUrl: oauth.authorizeUrl || TOCHKA_OAUTH_AUTHORIZE_URL,
            connectedAt: tokenSettings?.oauthConnectedAt || '',
        });
    }
    catch (e) {
        res.status(500).json({ configured: false, connected: false, error: e.message });
    }
});
exports.tochkaOAuthSaveClient = (0, https_1.onRequest)(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const current = await getTochkaOAuthSettings();
        const clientId = String(req.body?.clientId || current.clientId || '').trim();
        const clientSecret = String(req.body?.clientSecret || current.clientSecret || '').trim();
        if (!clientId || !clientSecret) {
            res.status(400).json({ error: 'Нужны Client ID и Client Secret' });
            return;
        }
        const redirectUrl = String(req.body?.redirectUrl || current.redirectUrl || getTochkaOAuthRedirectUrl(req)).trim();
        await db.doc('settings/tochka_oauth').set({
            clientId,
            clientSecret,
            redirectUrl,
            scope: String(req.body?.scope || current.scope || '').trim(),
            authorizeUrl: String(req.body?.authorizeUrl || current.authorizeUrl || TOCHKA_OAUTH_AUTHORIZE_URL).trim(),
            tokenUrl: String(req.body?.tokenUrl || current.tokenUrl || TOCHKA_OAUTH_TOKEN_URL).trim(),
            updatedAt: new Date().toISOString(),
        }, { merge: true });
        res.json({ success: true, redirectUrl });
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Не удалось сохранить OAuth Точки' });
    }
});
exports.tochkaOAuthStart = (0, https_1.onRequest)(async (req, res) => {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const settings = await getTochkaOAuthSettings();
        if (!settings.clientId || !settings.clientSecret) {
            res.redirect('/integrations?tochka=oauth-missing');
            return;
        }
        const state = (0, crypto_1.randomBytes)(24).toString('hex');
        const redirectUrl = getTochkaOAuthRedirectUrl(req, settings.redirectUrl);
        await db.doc('settings/tochka_oauth_state').set({
            state,
            createdAt: new Date().toISOString(),
        }, { merge: true });
        const url = new URL(settings.authorizeUrl || TOCHKA_OAUTH_AUTHORIZE_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', settings.clientId);
        url.searchParams.set('redirect_uri', redirectUrl);
        url.searchParams.set('state', state);
        if (settings.scope)
            url.searchParams.set('scope', settings.scope);
        res.redirect(url.toString());
    }
    catch (e) {
        res.status(500).send(`Ошибка OAuth Точки: ${e.message || e}`);
    }
});
exports.tochkaOAuthCallback = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const error = String(req.query.error || '');
    if (error) {
        res.redirect(`/integrations?tochka=oauth-error&message=${encodeURIComponent(error)}`);
        return;
    }
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) {
        res.redirect('/integrations?tochka=oauth-empty');
        return;
    }
    try {
        const settings = await getTochkaOAuthSettings();
        const stateSnap = await db.doc('settings/tochka_oauth_state').get();
        const savedState = stateSnap.exists ? String(stateSnap.data()?.state || '') : '';
        if (!savedState || savedState !== state) {
            res.status(400).send('OAuth state не совпал. Запусти подключение заново.');
            return;
        }
        const redirectUrl = getTochkaOAuthRedirectUrl(req, settings.redirectUrl);
        const exchanged = await exchangeTochkaOAuthCode(settings, code, redirectUrl);
        const tokenData = exchanged.data || {};
        const accessToken = tokenData.access_token || tokenData.accessToken || tokenData.jwtToken || tokenData.token;
        if (!accessToken) {
            res.status(502).send('Точка не вернула access_token. Проверь OAuth права приложения.');
            return;
        }
        const current = (await getTochkaSettings()) || {};
        const payload = decodeJwtPayload(accessToken);
        const expiresIn = Number(tokenData.expires_in || tokenData.expiresIn || 0);
        await db.doc('settings/tochka_api').set({
            ...current,
            jwtToken: accessToken,
            oauthAccessToken: accessToken,
            oauthRefreshToken: tokenData.refresh_token || tokenData.refreshToken || '',
            oauthTokenType: tokenData.token_type || tokenData.tokenType || 'Bearer',
            oauthScope: tokenData.scope || settings.scope || '',
            oauthTokenUrl: exchanged.tokenUrl,
            oauthConnected: true,
            oauthConnectedAt: new Date().toISOString(),
            oauthExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
            customerCode: payload.customerCode || payload.customer_code || current.customerCode || '',
            merchantId: current.merchantId || '',
            accountId: current.accountId || '',
            paymentMode: current.paymentMode || ['sbp'],
        }, { merge: true });
        await db.doc('settings/tochka_oauth_state').set({ state: '', completedAt: new Date().toISOString() }, { merge: true });
        res.redirect('/integrations?tochka=connected');
    }
    catch (e) {
        const details = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
        res.status(e.response?.status || 500).send(`Не удалось подключить Точку: ${details}`);
    }
});
// ─── POST /api/tochka/create-payment ────────────────────────────────────────
exports.tochkaCreatePayment = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { orderId, amount, description } = req.body || {};
    const paymentAmount = Number(amount);
    if (!orderId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        res.status(400).json({ error: 'Нужны orderId и amount больше 0' });
        return;
    }
    try {
        const settings = await getTochkaSettings();
        if (!settings?.jwtToken) {
            res.status(400).json({ error: 'Токен Точки не настроен' });
            return;
        }
        const { jwtToken, customerCode, merchantId, accountId, paymentMode } = settings;
        const modes = Array.isArray(paymentMode) && paymentMode.length ? paymentMode : ['sbp'];
        await db.collection('tochka_logs').add({
            orderId, amount: paymentAmount, description: description || '',
            status: 'request', createdAt: new Date().toISOString(),
        }).catch(() => { });
        const headers = { Authorization: `Bearer ${jwtToken}`, 'Content-Type': 'application/json' };
        const paymentPurpose = description || `Оплата заказа ${orderId}`;
        const encodedMerchant = encodeURIComponent(String(merchantId || ''));
        const encodedAccount = encodeURIComponent(String(accountId || ''));
        const sbpBodies = [
            {
                Data: {
                    amount: Math.round(paymentAmount * 100) / 100,
                    paymentPurpose,
                    qrcType: '02',
                    currency: 'RUB',
                    sourceName: 'YBCRM',
                    ttl: 72 * 60,
                    imageParams: { width: 300, height: 300 },
                },
            },
            {
                Data: {
                    amount: Math.round(paymentAmount * 100),
                    paymentPurpose,
                    qrcType: '02',
                    currency: 'RUB',
                    sourceName: 'YBCRM',
                    ttl: 72 * 60,
                },
            },
            {
                Data: {
                    amount: String(Math.round(paymentAmount * 100) / 100),
                    paymentPurpose,
                    qrcType: '02',
                    currency: 'RUB',
                },
            },
        ];
        let paymentData = null;
        let paymentUrl = '';
        let paymentId = '';
        let lastPaymentError = null;
        if (merchantId && accountId) {
            for (const body of sbpBodies) {
                try {
                    const response = await axios_1.default.post(`${TOCHKA_API}/sbp/v1.0/qr-code/merchant/${encodedMerchant}/${encodedAccount}`, body, { headers, timeout: 20000 });
                    paymentData = response.data;
                    paymentUrl = getTochkaPaymentUrl(paymentData);
                    paymentId = getTochkaPaymentId(paymentData);
                    if (!paymentUrl && paymentId) {
                        const qrDetails = await fetchTochkaQrById(jwtToken, String(merchantId), String(accountId), paymentId).catch(() => null);
                        if (qrDetails?.paymentUrl) {
                            paymentUrl = qrDetails.paymentUrl;
                            paymentData = { initial: paymentData, qr: qrDetails.data };
                        }
                    }
                    if (paymentUrl)
                        break;
                    lastPaymentError = new Error('Точка создала QR, но не вернула payload/ссылку');
                }
                catch (error) {
                    lastPaymentError = error;
                }
            }
        }
        else {
            const response = await axios_1.default.post(`${TOCHKA_API}/acquiring/v1.0/payments`, {
                Data: {
                    customerCode, amount: Math.round(paymentAmount * 100) / 100,
                    purpose: paymentPurpose,
                    paymentMode: modes, paymentLinkId: orderId, ttl: 72 * 60,
                },
            }, { headers, timeout: 20000 });
            paymentData = response.data;
            paymentUrl = getTochkaPaymentUrl(paymentData);
            paymentId = getTochkaPaymentId(paymentData);
        }
        if (!paymentUrl) {
            await db.collection('tochka_logs').add({
                orderId, amount: paymentAmount, status: 'error',
                error: lastPaymentError ? getTochkaErrorMessage(lastPaymentError) : 'Точка не вернула paymentUrl',
                response: JSON.stringify(paymentData).slice(0, 1000),
                createdAt: new Date().toISOString(),
            }).catch(() => { });
            res.status(502).json({ error: 'Точка не вернула ссылку оплаты', details: paymentData, message: lastPaymentError ? getTochkaErrorMessage(lastPaymentError) : '' });
            return;
        }
        const target = getTochkaPaymentTarget(orderId);
        const createdAt = new Date().toISOString();
        const paymentFields = target.isFinal
            ? { finalPaymentUrl: paymentUrl, finalPaymentId: paymentId, finalPaymentStatus: 'pending', finalPaymentCreatedAt: createdAt, finalPaymentAmount: paymentAmount }
            : { paymentUrl, paymentId, paymentStatus: 'pending', paymentCreatedAt: createdAt, paymentAmount };
        await db.doc(`orders/${target.cleanOrderId}`).update(paymentFields).catch(() => { });
        await db.doc(`orders_new/${target.cleanOrderId}`).update(paymentFields).catch(() => { });
        await db.collection('tochka_logs').add({
            orderId, amount: paymentAmount, paymentId: paymentId || null,
            paymentUrl, status: 'success', createdAt: new Date().toISOString(),
        }).catch(() => { });
        res.json({ success: true, paymentUrl, paymentId, data: paymentData });
    }
    catch (e) {
        const errData = e.response?.data;
        await db.collection('tochka_logs').add({
            orderId, amount: paymentAmount, status: 'error',
            error: e.message, details: errData ? JSON.stringify(errData).slice(0, 1000) : '',
            createdAt: new Date().toISOString(),
        }).catch(() => { });
        res.status(e.response?.status || 500).json({ error: e.message, details: errData });
    }
});
// ─── GET /api/tochka/find-payment ───────────────────────────────────────────
exports.tochkaFindPayment = (0, https_1.onRequest)({ timeoutSeconds: 30 }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    const orderId = String(req.query.orderId || '').trim();
    const target = getTochkaPaymentTarget(orderId, req.query.kind);
    const amount = req.query.amount ? Number(req.query.amount) : undefined;
    if (!orderId) {
        res.status(400).json({ error: 'Нужен orderId' });
        return;
    }
    try {
        const settings = await getTochkaSettings();
        if (!settings?.jwtToken) {
            res.status(400).json({ error: 'Токен Точки не настроен' });
            return;
        }
        const { jwtToken, customerCode, merchantId, accountId } = settings;
        if (!customerCode) {
            res.status(400).json({ error: 'customerCode Точки не настроен' });
            return;
        }
        const primaryOrder = await db.doc(`orders_new/${target.cleanOrderId}`).get();
        const legacyOrder = primaryOrder.exists ? null : await db.doc(`orders/${target.cleanOrderId}`).get();
        const orderData = primaryOrder.exists ? primaryOrder.data() : legacyOrder?.data() || {};
        const storedPaymentId = String(target.isFinal ? orderData?.finalPaymentId || '' : orderData?.paymentId || '').trim();
        let operation = null;
        let operationId = '';
        if (storedPaymentId && merchantId && accountId) {
            const qrDetails = await fetchTochkaQrById(jwtToken, String(merchantId), String(accountId), storedPaymentId).catch(() => null);
            if (qrDetails?.data) {
                operation = { ...qrDetails.data, status: qrDetails.paymentStatus || getTochkaOperationStatus(qrDetails.data) };
                operationId = storedPaymentId;
            }
        }
        if (!operation) {
            operation = await findTochkaOperation(jwtToken, customerCode, target.paymentLinkId, amount)
                || (target.isFinal ? await findTochkaOperation(jwtToken, customerCode, target.cleanOrderId, amount) : null);
            operationId = getTochkaOperationId(operation);
        }
        if (!operation || !operationId) {
            res.status(404).json({ error: `Оплата по заказу ${orderId} в Точке не найдена` });
            return;
        }
        const paymentAmount = normalizeTochkaAmount(getTochkaOperationAmount(operation)) || amount || 0;
        const paymentStatus = getTochkaOperationStatus(operation) || 'found';
        const paymentFields = buildTochkaPaymentFields(target, operationId, paymentStatus, paymentAmount, operation);
        await db.doc(`orders/${target.cleanOrderId}`).update(paymentFields).catch(() => { });
        await db.doc(`orders_new/${target.cleanOrderId}`).update(paymentFields).catch(() => { });
        await db.collection('tochka_logs').add({
            orderId, paymentId: operationId, amount: paymentAmount,
            status: target.isFinal ? 'final_payment_found' : 'payment_found',
            response: JSON.stringify(operation).slice(0, 1000),
            createdAt: new Date().toISOString(),
        }).catch(() => { });
        res.json({
            success: true,
            kind: target.isFinal ? 'final' : 'main',
            paymentId: operationId,
            paymentStatus,
            paymentAmount,
            paymentPaidAt: isTochkaPaidStatus(paymentStatus) ? new Date().toISOString() : undefined,
            data: operation,
        });
    }
    catch (e) {
        const errData = e.response?.data;
        res.status(e.response?.status || 500).json({ error: e.message, details: errData });
    }
});
//# sourceMappingURL=index.js.map