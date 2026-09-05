import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { initializeApp } from "firebase/app";
import { initializeFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where, orderBy } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes as fbUploadBytes, getDownloadURL as fbGetDownloadURL } from "firebase/storage";
import { initializeApp as initializeAdminApp, applicationDefault, getApps as getAdminApps } from "firebase-admin/app";
import { FieldValue, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import fs from "fs";
import https from "https";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createRequire } from "module";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { Telegraf, Markup } from "telegraf";
import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import webpush from "web-push";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { normalizeTelegramPhone, telegramDelivery, telegramAuthError } from "./src/lib/telegramAuth.ts";
import { normalizeBotSubscriberIds, validateBotBroadcastMessage } from "./src/lib/botBroadcast.ts";
import { resolveOrderActions, type OrderAction } from "./src/lib/orderPermissionConfig.ts";
import {
  findAcceptedSbpPaymentByQr,
  findSbpStatementPayment,
  formatTochkaRefundAmount,
  getTochkaRefundAccount,
} from "./src/lib/tochkaPayments.ts";
import { getTochkaFundName } from "./src/lib/tochkaFunds.ts";

const _require = createRequire(import.meta.url);
const Database = _require("better-sqlite3");

// DC server address map for Pyrogram sessions (no server_address column)
const TG_DC_SERVERS: Record<number, string> = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

function telethonSessionToStringSession(dcId: number, serverAddress: string, port: number, authKey: Buffer): string {
  // gramjs StringSession format: "1" + base64(dcId[1] + serverIPv4[4] + port[2] + authKey[256])
  // Total base64 input: 263 bytes → 352 base64 chars → session.length == 352 triggers "Telethon" path in gramjs
  const dcBuf = Buffer.alloc(1);
  dcBuf.writeUInt8(dcId);
  const serverParts = serverAddress.split(".").map(Number);
  const serverBuf = Buffer.from(serverParts); // 4 bytes IPv4
  const portBuf = Buffer.alloc(2);
  portBuf.writeInt16BE(port);
  const combined = Buffer.concat([dcBuf, serverBuf, portBuf, authKey]);
  return "1" + combined.toString("base64");
}

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const MCP_PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL || "https://ybcrm.ru").replace(/\/$/, "");
const MCP_UPSTREAM_URL = String(process.env.MCP_UPSTREAM_URL || "").replace(/\/$/, "");
const MCP_OAUTH_PIN = process.env.MCP_OAUTH_PIN || "ybcrm-mcp-2026-7f8c2a91d4e64bb8";
const MCP_TOKEN_SECRET = process.env.CRM_JWT_SECRET || process.env.MCP_TOKEN_SECRET || "ybcrm-local-mcp-secret-2026-change-me";

const TG_API_ID = Number(process.env.TG_API_ID || 2040);
const TG_API_HASH = process.env.TG_API_HASH || "b18441a1ff607e10a989891a5462e627";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const BROADCAST_MANAGER_BOT_URL = "https://t.me/YAASBAE_CLO_bot";
const BROADCAST_MANAGER_BUTTON_TEXT = "Узнать подробности в бот";
const DEFAULT_BROADCAST_DISPLAY_NAME = "YAASBAE Brand";
let WEB_PUSH_PUBLIC_KEY = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
let WEB_PUSH_PRIVATE_KEY = String(process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
const WEB_PUSH_SUBJECT = String(process.env.WEB_PUSH_SUBJECT || "https://ybcrm.ru").trim();

if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
}

type PendingTgLogin = { client: TelegramClient; phoneCodeHash: string; purpose: "manager" | "broadcast"; delivery: ReturnType<typeof telegramDelivery>; expiresAt: number };
const pendingTgClients = new Map<string, PendingTgLogin>();
const pendingTgRequests = new Set<string>();
const tgLoginCooldowns = new Map<string, number>();

function buildBroadcastMessageText(message: string, contactButton: boolean, fallbackUrl = false) {
  const cleanMessage = String(message || "").trim();
  if (!contactButton) return cleanMessage;
  const suffix = `${BROADCAST_MANAGER_BUTTON_TEXT}\n${BROADCAST_MANAGER_BOT_URL}`;
  return `${cleanMessage}\n\n${suffix}`;
}

async function sendBroadcastMessage(client: TelegramClient, entity: any, message: string, contactButton: boolean) {
  const preparedMessage = buildBroadcastMessageText(message, contactButton);
  const baseParams: any = {
    message: preparedMessage,
    linkPreview: false,
  };
  if (!contactButton) return client.sendMessage(entity, baseParams);

  try {
    return await client.sendMessage(entity, baseParams);
  } catch (error: any) {
    const msg = String(error?.message || error || "");
    if (msg.includes("ENTITY") || msg.includes("parse") || msg.includes("entities")) {
      return client.sendMessage(entity, {
        message: buildBroadcastMessageText(message, contactButton, true),
        linkPreview: false,
      } as any);
    }
    throw error;
  }
}

function normalizeBroadcastDisplayName(value?: string) {
  const clean = String(value || "").trim();
  return clean || DEFAULT_BROADCAST_DISPLAY_NAME;
}

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let db: any = null;
let adminDb: any = null;
let fbStorage: any = null;
let firebaseProjectId = "";
let firebaseDatabaseId = "production";

try {
  let firebaseConfig: any = null;
  if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  } else if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
  if (firebaseConfig) {
    firebaseProjectId = firebaseConfig.projectId || "";
    firebaseDatabaseId = firebaseConfig.firestoreDatabaseId || "(default)";
    const firebaseApp = initializeApp(firebaseConfig);
    db = initializeFirestore(firebaseApp, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId);
    fbStorage = getStorage(firebaseApp);
    console.log("Firebase initialized on server");
    try {
      const adminApp = getAdminApps()[0] || initializeAdminApp({
        credential: applicationDefault(),
        projectId: firebaseConfig.projectId,
      });
      adminDb = getAdminFirestore(adminApp, firebaseDatabaseId);
      console.log("Firebase Admin initialized on server");
    } catch (adminError: any) {
      console.warn("Firebase Admin init skipped:", adminError.message);
    }
  } else {
    console.warn("Firebase config not found");
  }
} catch (e: any) {
  console.error("Firebase init error:", e.message);
}

app.use(cors());
app.use(express.json({
  limit: '20mb',
  verify: (req: any, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(express.text({ type: ['text/*', 'application/jwt', 'application/octet-stream'], limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function getRequestOrigin(req: express.Request) {
  return req.get("origin") || `${req.protocol || "https"}://${req.get("host") || "ybcrm.ru"}`;
}

function getWebAuthnRpId(req: express.Request) {
  const host = (req.get("x-forwarded-host") || req.get("host") || "ybcrm.ru").split(":")[0];
  if (host === "localhost" || host === "127.0.0.1") return "localhost";
  if (host.endsWith("ybcrm.ru")) return "ybcrm.ru";
  return host;
}

function getExpectedOrigins(req: express.Request) {
  const origin = getRequestOrigin(req);
  return Array.from(new Set([
    origin,
    "https://ybcrm.ru",
    "https://www.ybcrm.ru",
    "http://localhost:3000",
    "http://localhost:5173",
  ]));
}

function passkeyChallengeRef(id: string) {
  if (!adminDb) throw new Error("Firebase Admin не инициализирован");
  return adminDb.collection("passkey_challenges").doc(id);
}

function passkeyRef(id: string) {
  if (!adminDb) throw new Error("Firebase Admin не инициализирован");
  return adminDb.collection("passkeys").doc(id);
}

function uidToBytes(uid: string) {
  return new Uint8Array(Buffer.from(uid, "utf8"));
}

function bytesToBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function verifyFirebaseBearer(req: express.Request) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Нет Firebase токена авторизации");
  return getAdminAuth().verifyIdToken(token);
}

async function deleteExpiredPasskeyChallenges() {
  if (!adminDb) return;
  const expired = await adminDb.collection("passkey_challenges")
    .where("expiresAt", "<", Date.now())
    .limit(25)
    .get();
  await Promise.all(expired.docs.map((docSnap: any) => docSnap.ref.delete()));
}

app.post("/api/passkeys/register/options", async (req, res) => {
  try {
    const decoded = await verifyFirebaseBearer(req);
    const uid = decoded.uid;
    const email = decoded.email || `${uid}@ybcrm.local`;
    const existing = await adminDb.collection("passkeys").where("uid", "==", uid).get();
    const options = await generateRegistrationOptions({
      rpName: "YBCRM",
      rpID: getWebAuthnRpId(req),
      userID: uidToBytes(uid),
      userName: email,
      userDisplayName: decoded.name || email,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: existing.docs.map((docSnap: any) => ({
        id: docSnap.id,
        transports: docSnap.data()?.transports || undefined,
      })),
    });
    const requestId = adminDb.collection("passkey_challenges").doc().id;
    await passkeyChallengeRef(requestId).set({
      challenge: options.challenge,
      type: "register",
      uid,
      email,
      rpID: getWebAuthnRpId(req),
      origin: getRequestOrigin(req),
      expiresAt: Date.now() + 5 * 60 * 1000,
      createdAt: FieldValue.serverTimestamp(),
    });
    void deleteExpiredPasskeyChallenges().catch(() => {});
    res.json({ requestId, options });
  } catch (e: any) {
    res.status(401).json({ error: e.message || "Не удалось начать привязку Face ID" });
  }
});

app.post("/api/passkeys/register/verify", async (req, res) => {
  try {
    const decoded = await verifyFirebaseBearer(req);
    const { requestId, response } = req.body || {} as { requestId?: string; response?: RegistrationResponseJSON };
    if (!requestId || !response) return res.status(400).json({ error: "Нет данных passkey" });
    const challengeDoc = await passkeyChallengeRef(requestId).get();
    const challenge = challengeDoc.data();
    if (!challenge || challenge.type !== "register" || challenge.uid !== decoded.uid || challenge.expiresAt < Date.now()) {
      return res.status(400).json({ error: "Сессия привязки устарела, попробуйте ещё раз" });
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: getExpectedOrigins(req),
      expectedRPID: challenge.rpID || getWebAuthnRpId(req),
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Face ID не подтверждён устройством" });
    }
    const credential = verification.registrationInfo.credential;
    await passkeyRef(credential.id).set({
      uid: decoded.uid,
      email: decoded.email || challenge.email || "",
      credentialId: credential.id,
      credentialPublicKey: bytesToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: response.response?.transports || credential.transports || [],
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      origin: verification.registrationInfo.origin,
      rpID: verification.registrationInfo.rpID || challenge.rpID || getWebAuthnRpId(req),
      createdAt: FieldValue.serverTimestamp(),
      lastUsedAt: null,
    }, { merge: true });
    await challengeDoc.ref.delete();
    res.json({ success: true, email: decoded.email || challenge.email || "" });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Не удалось привязать Face ID" });
  }
});

app.post("/api/passkeys/login/options", async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: getWebAuthnRpId(req),
      userVerification: "preferred",
    });
    const requestId = adminDb.collection("passkey_challenges").doc().id;
    await passkeyChallengeRef(requestId).set({
      challenge: options.challenge,
      type: "login",
      rpID: getWebAuthnRpId(req),
      origin: getRequestOrigin(req),
      expiresAt: Date.now() + 5 * 60 * 1000,
      createdAt: FieldValue.serverTimestamp(),
    });
    void deleteExpiredPasskeyChallenges().catch(() => {});
    res.json({ requestId, options });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Не удалось начать вход по Face ID" });
  }
});

app.post("/api/passkeys/login/verify", async (req, res) => {
  try {
    const { requestId, response } = req.body || {} as { requestId?: string; response?: AuthenticationResponseJSON };
    if (!requestId || !response?.id) return res.status(400).json({ error: "Нет данных passkey" });
    const challengeDoc = await passkeyChallengeRef(requestId).get();
    const challenge = challengeDoc.data();
    if (!challenge || challenge.type !== "login" || challenge.expiresAt < Date.now()) {
      return res.status(400).json({ error: "Сессия входа устарела, попробуйте ещё раз" });
    }
    const passkeyDoc = await passkeyRef(response.id).get();
    const passkey = passkeyDoc.data();
    if (!passkey?.uid || !passkey?.credentialPublicKey) {
      return res.status(404).json({ error: "Этот Face ID ещё не привязан к CRM" });
    }
    const credential: WebAuthnCredential = {
      id: passkey.credentialId || passkeyDoc.id,
      publicKey: base64UrlToBytes(passkey.credentialPublicKey),
      counter: Number(passkey.counter) || 0,
      transports: passkey.transports || undefined,
    };
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: getExpectedOrigins(req),
      expectedRPID: challenge.rpID || passkey.rpID || getWebAuthnRpId(req),
      credential,
      requireUserVerification: false,
    });
    if (!verification.verified) {
      return res.status(401).json({ error: "Face ID не прошёл проверку" });
    }
    await passkeyDoc.ref.set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await challengeDoc.ref.delete();
    const customToken = await getAdminAuth().createCustomToken(passkey.uid);
    res.json({ success: true, customToken, email: passkey.email || "" });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Не удалось войти по Face ID" });
  }
});

type PushEventType =
  | "order_created"
  | "instagram_message"
  | "payment_received"
  | "payment_refunded"
  | "cdek_status_changed"
  | "payment_due"
  | "order_overdue"
  | "manager_assigned"
  | "order_status_changed"
  | "manager_shift_started"
  | "production_changed"
  | "stock_changed";

type PushEventData = {
  orderId?: string;
  clientName?: string;
  manager?: string;
  amount?: number;
  status?: string;
  previousStatus?: string;
  managerEmail?: string;
  startedAt?: string;
  dateKey?: string;
  cdekNumber?: string;
  conversationId?: string;
  username?: string;
  message?: string;
  deadline?: string;
  action?: string;
  productName?: string;
  quantity?: number;
};

const PUSH_EVENT_TYPES = new Set<PushEventType>([
  "order_created", "instagram_message", "payment_received", "cdek_status_changed",
  "payment_refunded",
  "payment_due", "order_overdue", "manager_assigned",
  "order_status_changed", "manager_shift_started", "production_changed", "stock_changed",
]);

let webPushSetupPromise: Promise<boolean> | null = null;
async function ensureWebPushConfigured() {
  if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY && adminDb) {
    webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
    return true;
  }
  if (!adminDb) return false;
  if (!webPushSetupPromise) {
    webPushSetupPromise = (async () => {
      const ref = adminDb.collection("settings").doc("web_push");
      await adminDb.runTransaction(async (transaction: any) => {
        const snap = await transaction.get(ref);
        if (snap.exists && snap.data()?.publicKey && snap.data()?.privateKey) return;
        const keys = webpush.generateVAPIDKeys();
        transaction.set(ref, {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: WEB_PUSH_SUBJECT,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      const snap = await ref.get();
      WEB_PUSH_PUBLIC_KEY = String(snap.data()?.publicKey || "").trim();
      WEB_PUSH_PRIVATE_KEY = String(snap.data()?.privateKey || "").trim();
      if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) return false;
      webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
      return true;
    })().catch(error => {
      webPushSetupPromise = null;
      console.warn("[push] VAPID setup:", error?.message || error);
      return false;
    });
  }
  return webPushSetupPromise;
}
const pushOrderUrl = (orderId?: string) => `/orders${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`;

async function requireCrmUser(req: any, res: any) {
  const header = String(req.headers?.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Нужен вход в CRM" });
    return null;
  }
  try {
    return await getAdminAuth().verifyIdToken(token);
  } catch {
    res.status(401).json({ error: "Сессия CRM устарела. Войдите заново." });
    return null;
  }
}

async function writeAuditLog(input: {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  diff?: unknown;
  metadata?: Record<string, unknown>;
  actor?: Record<string, unknown>;
}) {
  const payload = stripUndefined({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    diff: input.diff,
    metadata: input.metadata || {},
    actor: input.actor || { type: "server" },
  });
  payload.createdAt = adminDb ? FieldValue.serverTimestamp() : serverTimestamp();

  try {
    if (adminDb) {
      await adminDb.collection("audit_logs").add(payload);
      return;
    }
    if (db) {
      await addDoc(collection(db, "audit_logs"), payload);
    }
  } catch (error: any) {
    console.warn("[audit] write skipped:", error?.message || error);
  }
}

const CRM_ACCESS_VIEWS = [
  "home", "calculator", "finance", "payroll", "analytics", "orders", "clients", "marketing",
  "products", "production", "storefront", "handbook", "cdek", "integrations", "social",
  "instagram", "bot", "content", "broadcast", "broadcast-v2", "studio", "ai-agent",
];
const CRM_NOTIFICATION_TOPICS = ["all", "orders", "payments", "cdek", "shifts", "social", "stock", "production"];
const CRM_ORDER_ACTIONS = ["create", "edit", "status", "exchange", "payments", "refund", "cdek", "delete", "export"];

function normalizedAllowedValues(value: unknown, allowed: string[]) {
  const allowedSet = new Set(allowed);
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || "").trim())
    .filter(item => allowedSet.has(item))));
}

async function requireCrmOrderAction(req: any, res: any, action: OrderAction) {
  const decoded: any = await requireCrmUser(req, res);
  if (!decoded) return null;
  const email = String(decoded.email || '').trim().toLowerCase();
  if (email === 'ndtiger86@gmail.com') return decoded;
  try {
    const snap = await adminDb.collection('crm_access_profiles').doc(decoded.uid).get();
    // Старые аккаунты до появления детальных прав продолжают работать как раньше.
    if (!snap.exists) return decoded;
    const profile = snap.data() || {};
    if (profile.active === false) {
      res.status(403).json({ error: 'Аккаунт отключён владельцем CRM', code: 'account_disabled' });
      return null;
    }
    const allowed = resolveOrderActions(profile.allowedOrderActions, profile.orderActionsConfigured);
    if (!allowed.includes(action)) {
      res.status(403).json({
        error: 'Действие запрещено настройками аккаунта в админке',
        code: 'order_action_denied',
        action,
      });
      return null;
    }
    return decoded;
  } catch (error: any) {
    console.error('[access] order action check:', error?.message || error);
    res.status(503).json({ error: 'Не удалось проверить права аккаунта' });
    return null;
  }
}

function decodeFirestoreRestValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreRestValue);
  if (value.mapValue) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decodeFirestoreRestValue(child)]),
  );
  return null;
}

async function readFirestoreCollectionAsUser(req: any, collectionName: string) {
  const authHeader = String(req.headers?.authorization || "");
  if (!authHeader.startsWith("Bearer ") || !firebaseProjectId) return [];
  const response = await axios.get(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents/${encodeURIComponent(collectionName)}`,
    {
      headers: { Authorization: authHeader },
      params: { pageSize: 1000 },
      timeout: 15_000,
    },
  );
  return (response.data?.documents || []).map((document: any) => ({
    id: String(document.name || "").split("/").pop() || "",
    data: Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreRestValue(value)]),
    ),
  }));
}

function accessAccount(uid: string, data: any, ownerEmail: string) {
  const email = String(data?.email || data?.managerEmail || "").trim().toLowerCase();
  const isOwner = email === ownerEmail;
  return {
    uid,
    email,
    displayName: String(data?.displayName || data?.managerName || ""),
    disabled: isOwner ? false : data?.active === false,
    createdAt: data?.createdAt || null,
    lastLoginAt: data?.lastLoginAt || null,
    configured: isOwner || Boolean(data?.role || data?.allowedViews),
    role: isOwner ? "owner" : String(data?.role || "legacy"),
    allowedViews: isOwner
      ? CRM_ACCESS_VIEWS
      : Array.isArray(data?.allowedViews) ? normalizedAllowedValues(data.allowedViews, CRM_ACCESS_VIEWS) : CRM_ACCESS_VIEWS,
    notificationTopics: isOwner
      ? ["all"]
      : Array.isArray(data?.notificationTopics) ? normalizedAllowedValues(data.notificationTopics, CRM_NOTIFICATION_TOPICS) : ["all"],
    allowedOrderActions: isOwner
      ? CRM_ORDER_ACTIONS
      : resolveOrderActions(data?.allowedOrderActions, data?.orderActionsConfigured),
    active: isOwner ? true : data?.active !== false,
  };
}

function firebaseAuthErrorMessage(error: any, fallback: string) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("email-already-exists")) return "Аккаунт с такой почтой уже существует";
  if (code.includes("invalid-password") || code.includes("password-too-short")) return "Пароль должен быть не короче 8 символов";
  if (code.includes("invalid-email")) return "Укажите корректную почту";
  if (code.includes("user-not-found")) return "Аккаунт не найден в Firebase Auth";
  return fallback;
}

app.get("/api/access/me", async (req, res) => {
  const decoded: any = await requireCrmUser(req, res);
  if (!decoded) return;
  const email = String(decoded.email || "").trim().toLowerCase();
  if (email === "ndtiger86@gmail.com") {
    return res.json({ configured: true, role: "owner", allowedViews: CRM_ACCESS_VIEWS, notificationTopics: ["all"], allowedOrderActions: CRM_ORDER_ACTIONS });
  }
  try {
    const snap = await adminDb.collection("crm_access_profiles").doc(decoded.uid).get();
    if (!snap.exists) return res.json({ configured: false, role: "legacy", allowedViews: null, notificationTopics: null, allowedOrderActions: CRM_ORDER_ACTIONS });
    const data = snap.data() || {};
    res.json({
      configured: true,
      role: String(data.role || "employee"),
      active: data.active !== false,
      allowedViews: normalizedAllowedValues(data.allowedViews, CRM_ACCESS_VIEWS),
      notificationTopics: normalizedAllowedValues(data.notificationTopics, CRM_NOTIFICATION_TOPICS),
      allowedOrderActions: resolveOrderActions(data.allowedOrderActions, data.orderActionsConfigured),
    });
  } catch (error: any) {
    console.error("[access] current profile:", error?.message || error);
    res.status(500).json({ error: "Не удалось загрузить права доступа" });
  }
});

app.get("/api/admin/accounts", async (req, res) => {
  const owner: any = await requireFinanceOwner(req, res);
  if (!owner) return;
  try {
    const ownerEmail = String(owner.email || "").trim().toLowerCase();
    let authUsers: any[] = [];
    let authListError = "";
    try {
      authUsers = (await getAdminAuth().listUsers(1000)).users;
    } catch (error: any) {
      authListError = String(error?.code || "firebase-auth-unavailable");
      console.warn("[admin] Firebase Auth account list fallback:", authListError, String(error?.message || "").slice(0, 500));
    }

    const profiles = new Map<string, any>();
    try {
      if (adminDb) {
        const snapshot = await adminDb.collection("crm_access_profiles").get();
        snapshot.docs.forEach((item: any) => profiles.set(item.id, item.data() || {}));
      }
    } catch (error: any) {
      console.warn("[admin] access profiles Admin read fallback:", error?.message || error);
      const rows = await readFirestoreCollectionAsUser(req, "crm_access_profiles").catch(() => []);
      rows.forEach((item: any) => profiles.set(item.id, item.data || {}));
    }

    let accounts = authUsers.map((account: any) => {
      const profile: any = profiles.get(account.uid) || null;
      const isOwner = String(account.email || "").trim().toLowerCase() === ownerEmail;
      return {
        uid: account.uid,
        email: account.email || "",
        displayName: account.displayName || "",
        disabled: Boolean(account.disabled),
        createdAt: account.metadata?.creationTime || null,
        lastLoginAt: account.metadata?.lastSignInTime || null,
        configured: isOwner || Boolean(profile),
        role: isOwner ? "owner" : String(profile?.role || "legacy"),
        allowedViews: isOwner ? CRM_ACCESS_VIEWS : (profile ? normalizedAllowedValues(profile.allowedViews, CRM_ACCESS_VIEWS) : CRM_ACCESS_VIEWS),
        notificationTopics: isOwner ? ["all"] : (profile ? normalizedAllowedValues(profile.notificationTopics, CRM_NOTIFICATION_TOPICS) : ["all"]),
        allowedOrderActions: isOwner
          ? CRM_ORDER_ACTIONS
          : resolveOrderActions(profile?.allowedOrderActions, profile?.orderActionsConfigured),
        active: isOwner ? true : profile?.active !== false,
      };
    });

    if (!accounts.length) {
      const managerRows = await readFirestoreCollectionAsUser(req, "manager_profiles").catch((error: any) => {
        console.warn("[admin] manager profiles fallback:", error?.message || error);
        return [];
      });
      const fallback = new Map<string, any>();
      fallback.set(owner.uid, accessAccount(owner.uid, {
        email: ownerEmail,
        displayName: owner.name || "Владелец",
        role: "owner",
        active: true,
      }, ownerEmail));
      profiles.forEach((data, uid) => fallback.set(uid, accessAccount(uid, data, ownerEmail)));
      managerRows.forEach((item: any) => {
        const current = fallback.get(item.id);
        fallback.set(item.id, accessAccount(item.id, { ...item.data, ...(current || {}) }, ownerEmail));
      });
      accounts = Array.from(fallback.values()).filter(account => account.email);
    }

    accounts.sort((a: any, b: any) => Number(b.role === "owner") - Number(a.role === "owner") || a.email.localeCompare(b.email));
    res.json({
      accounts,
      views: CRM_ACCESS_VIEWS,
      notificationTopics: CRM_NOTIFICATION_TOPICS,
      orderActions: CRM_ORDER_ACTIONS,
      degraded: Boolean(authListError),
    });
  } catch (error: any) {
    console.error("[admin] accounts list:", error?.message || error);
    res.status(500).json({ error: "Не удалось загрузить аккаунты CRM" });
  }
});

app.post("/api/admin/accounts", async (req, res) => {
  const owner: any = await requireFinanceOwner(req, res);
  if (!owner) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim().slice(0, 120);
  const role = String(req.body?.role || "employee").trim().slice(0, 60) || "employee";
  const allowedViews = normalizedAllowedValues(req.body?.allowedViews, CRM_ACCESS_VIEWS);
  const notificationTopics = normalizedAllowedValues(req.body?.notificationTopics, CRM_NOTIFICATION_TOPICS);
  const allowedOrderActions = Array.isArray(req.body?.allowedOrderActions)
    ? normalizedAllowedValues(req.body.allowedOrderActions, CRM_ORDER_ACTIONS)
    : CRM_ORDER_ACTIONS;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Укажите корректную почту" });
  if (password.length < 8) return res.status(400).json({ error: "Пароль должен быть не короче 8 символов" });
  if (!allowedViews.length) return res.status(400).json({ error: "Выберите хотя бы один раздел CRM" });
  try {
    const account = await getAdminAuth().createUser({ email, password, displayName: displayName || undefined });
    await adminDb.collection("crm_access_profiles").doc(account.uid).set({
      email,
      displayName,
      role,
      allowedViews,
      notificationTopics,
      allowedOrderActions,
      orderActionsConfigured: true,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: owner.email || owner.uid,
    }, { merge: true });
    await writeAuditLog({
      action: "account_created",
      entityType: "account",
      entityId: account.uid,
      after: { email, displayName, role, allowedViews, notificationTopics, allowedOrderActions, active: true },
      metadata: { label: `Создан аккаунт ${email}` },
      actor: { type: "crm_user", uid: owner.uid, email: owner.email || "", name: owner.name || "" },
    });
    res.status(201).json({ success: true, uid: account.uid, email });
  } catch (error: any) {
    console.error("[admin] account create:", error?.message || error);
    res.status(400).json({ error: firebaseAuthErrorMessage(error, "Не удалось создать аккаунт. Повторите попытку через минуту.") });
  }
});

app.patch("/api/admin/accounts/:uid", async (req, res) => {
  const owner: any = await requireFinanceOwner(req, res);
  if (!owner) return;
  const uid = String(req.params.uid || "").trim();
  if (!uid) return res.status(400).json({ error: "Не указан аккаунт" });
  const role = String(req.body?.role || "employee").trim().slice(0, 60) || "employee";
  const displayName = String(req.body?.displayName || "").trim().slice(0, 120);
  const allowedViews = normalizedAllowedValues(req.body?.allowedViews, CRM_ACCESS_VIEWS);
  const notificationTopics = normalizedAllowedValues(req.body?.notificationTopics, CRM_NOTIFICATION_TOPICS);
  const allowedOrderActions = Array.isArray(req.body?.allowedOrderActions)
    ? normalizedAllowedValues(req.body.allowedOrderActions, CRM_ORDER_ACTIONS)
    : CRM_ORDER_ACTIONS;
  const active = req.body?.active !== false;
  if (!allowedViews.length) return res.status(400).json({ error: "Выберите хотя бы один раздел CRM" });
  try {
    const account = await getAdminAuth().getUser(uid);
    if (String(account.email || "").trim().toLowerCase() === "ndtiger86@gmail.com") {
      return res.status(400).json({ error: "Права владельца CRM не ограничиваются" });
    }
    await Promise.all([
      getAdminAuth().updateUser(uid, { displayName: displayName || undefined, disabled: !active }),
      adminDb.collection("crm_access_profiles").doc(uid).set({
        email: account.email || "",
        displayName,
        role,
        allowedViews,
        notificationTopics,
        allowedOrderActions,
        orderActionsConfigured: true,
        active,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: owner.email || owner.uid,
      }, { merge: true }),
    ]);
    await writeAuditLog({
      action: "account_access_updated",
      entityType: "account",
      entityId: uid,
      after: { email: account.email || "", displayName, role, allowedViews, notificationTopics, allowedOrderActions, active },
      metadata: { label: `Обновлены права ${account.email || uid}` },
      actor: { type: "crm_user", uid: owner.uid, email: owner.email || "", name: owner.name || "" },
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[admin] account update:", error?.message || error);
    res.status(400).json({ error: firebaseAuthErrorMessage(error, "Не удалось обновить права аккаунта. Повторите попытку через минуту.") });
  }
});

app.post("/api/audit/log", async (req, res) => {
  try {
    const decoded = await requireCrmUser(req, res);
    if (!decoded) return;
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const entityType = String(body.entityType || "").trim();
    const entityId = String(body.entityId || "").trim();
    if (!action || !entityType || !entityId) {
      return res.status(400).json({ error: "Нужны action, entityType и entityId" });
    }

    const actorEmail = String(decoded.email || "").trim().toLowerCase();
    const actorManagerName = actorEmail === "yb1@ybcrm.ru"
      ? "Менеджер 1"
      : actorEmail === "yb2@ybcrm.ru"
        ? "Менеджер 2"
        : "";
    await writeAuditLog({
      action,
      entityType,
      entityId,
      before: body.before ?? null,
      after: body.after ?? null,
      diff: body.diff ?? null,
      metadata: {
        ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
        ip: req.ip,
      },
      actor: {
        type: "crm_user",
        uid: decoded.uid,
        email: decoded.email || "",
        name: actorManagerName || decoded.name || "",
        managerName: actorManagerName,
      },
    });
    res.json({ ok: true });
  } catch (error: any) {
    console.error("[audit] log error:", error?.message || error);
    res.status(500).json({ error: "Не удалось записать журнал действий" });
  }
});

function pushContent(type: PushEventType, data: PushEventData) {
  const order = data.orderId ? `заказ #${data.orderId}` : "заказ";
  const client = String(data.clientName || data.username || "").trim();
  const amount = Number(data.amount || 0);
  switch (type) {
    case "order_created": return { title: "Новый заказ", body: `${order}${client ? ` · ${client}` : ""}`, url: pushOrderUrl(data.orderId) };
    case "instagram_message": return { title: "Новое сообщение Instagram", body: `${client || "Клиент"}${data.message ? `: ${String(data.message).slice(0, 110)}` : ""}`, url: `/instagram${data.conversationId ? `?conversation=${encodeURIComponent(data.conversationId)}` : ""}` };
    case "payment_received": return { title: "Оплата получена", body: `${order}${amount ? ` · ${amount.toLocaleString("ru-RU")} ₽` : ""}`, url: pushOrderUrl(data.orderId) };
    case "payment_refunded": return { title: "Платёж возвращён", body: `${order}${amount ? ` · ${amount.toLocaleString("ru-RU")} ₽` : ""}`, url: pushOrderUrl(data.orderId) };
    case "cdek_status_changed": return { title: `СДЭК: ${data.status || "статус изменён"}`, body: `${order}${data.cdekNumber ? ` · накладная ${data.cdekNumber}` : ""}`, url: pushOrderUrl(data.orderId) };
    case "payment_due": return { title: "Нужна доплата", body: `${order}${amount ? ` · осталось ${amount.toLocaleString("ru-RU")} ₽` : ""}`, url: pushOrderUrl(data.orderId) };
    case "order_overdue": return { title: "Заказ просрочен", body: `${order}${data.deadline ? ` · срок ${data.deadline}` : ""}`, url: pushOrderUrl(data.orderId) };
    case "manager_assigned": return { title: "Назначен менеджер", body: `${order}${data.manager ? ` · ${data.manager}` : ""}`, url: pushOrderUrl(data.orderId) };
    case "order_status_changed": {
      const transition = data.previousStatus
        ? `${data.previousStatus} → ${data.status || "Без статуса"}`
        : (data.status || "Без статуса");
      return { title: `Статус заказа: ${data.status || "изменён"}`, body: `${order}${client ? ` · ${client}` : ""} · ${transition}`, url: pushOrderUrl(data.orderId) };
    }
    case "manager_shift_started": {
      const startTime = data.startedAt
        ? new Date(data.startedAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" })
        : "";
      return { title: "Менеджер начал смену", body: `${data.manager || data.managerEmail || "Менеджер"}${startTime ? ` · ${startTime}` : ""}`, url: "/orders" };
    }
    case "production_changed": return { title: "Изменение в производстве", body: `${data.action || "Обновлено"}${data.productName ? ` · ${data.productName}` : ""}${data.quantity ? ` · ${data.quantity} шт.` : ""}`, url: "/production" };
    case "stock_changed": return { title: "Изменение на складе", body: `${data.action || "Обновлено"}${data.productName ? ` · ${data.productName}` : ""}`, url: "/products" };
  }
}

async function dispatchPushEvent(type: PushEventType, eventId: string, data: PushEventData = {}) {
  if (!await ensureWebPushConfigured() || !PUSH_EVENT_TYPES.has(type) || !eventId) return { sent: 0, skipped: true };
  const eventKey = createHash("sha256").update(eventId).digest("hex");
  try {
    await adminDb.collection("push_events").doc(eventKey).create({ type, eventId, data, createdAt: FieldValue.serverTimestamp() });
  } catch (error: any) {
    if (String(error?.code || "").includes("already-exists") || Number(error?.code) === 6) return { sent: 0, duplicate: true };
    throw error;
  }

  const subscriptions = await adminDb.collection("push_subscriptions").where("enabled", "==", true).get();
  const eventTopic = type === "instagram_message"
    ? "social"
    : type === "production_changed"
      ? "production"
      : type === "stock_changed"
        ? "stock"
    : type === "payment_received" || type === "payment_refunded" || type === "payment_due"
      ? "payments"
      : type === "cdek_status_changed"
        ? "cdek"
        : type === "manager_shift_started"
          ? "shifts"
          : "orders";
  const subscriptionUids = Array.from(new Set(subscriptions.docs
    .map((item: any) => String(item.data()?.uid || "").trim())
    .filter(Boolean)));
  const accessSnapshots = subscriptionUids.length
    ? await adminDb.getAll(...subscriptionUids.map(uid => adminDb.collection("crm_access_profiles").doc(uid)))
    : [];
  const accessByUid = new Map(accessSnapshots.map((snap: any) => [snap.id, snap.exists ? snap.data() : null]));
  const payload = JSON.stringify({ ...pushContent(type, data), tag: eventId, type });
  let sent = 0;
  let failed = 0;
  const deliver = async (subscription: any) => {
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });
      } catch (error: any) {
        lastError = error;
        const status = Number(error?.statusCode || 0);
        const retryable = status === 0 || status === 429 || status >= 500;
        if (attempt === 2 || !retryable) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  };
  await Promise.all(subscriptions.docs.map(async (item: any) => {
    const subscriptionData = item.data() || {};
    const subscription = subscriptionData.subscription;
    if (!subscription?.endpoint) return;
    const subscriberEmail = String(subscriptionData.email || "").trim().toLowerCase();
    const access: any = accessByUid.get(String(subscriptionData.uid || "").trim());
    const topics = Array.isArray(access?.notificationTopics) ? access.notificationTopics.map((topic: unknown) => String(topic)) : null;
    const receivesEvent = subscriberEmail === "ndtiger86@gmail.com"
      || access === null
      || (!access && !topics)
      || (access?.active !== false && (topics?.includes("all") || topics?.includes(eventTopic)));
    if (!receivesEvent) return;
    try {
      await deliver(subscription);
      sent += 1;
      await item.ref.set({
        lastDeliveryAt: FieldValue.serverTimestamp(),
        lastDeliveryError: FieldValue.delete(),
      }, { merge: true }).catch(() => null);
    } catch (error: any) {
      failed += 1;
      if ([404, 410].includes(Number(error?.statusCode))) await item.ref.delete().catch(() => null);
      else {
        const errorMessage = String(error?.body || error?.message || error).slice(0, 500);
        await item.ref.set({
          lastDeliveryErrorAt: FieldValue.serverTimestamp(),
          lastDeliveryError: `${error?.statusCode || "error"}: ${errorMessage}`,
        }, { merge: true }).catch(() => null);
        console.warn("[push] delivery:", error?.statusCode || "error", errorMessage);
      }
    }
  }));
  return { sent, failed };
}

app.get("/api/push/vapid-public-key", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  if (!await ensureWebPushConfigured()) return res.status(503).json({ error: "Push-сервис ещё не настроен" });
  res.json({ publicKey: WEB_PUSH_PUBLIC_KEY });
});

app.post("/api/push/subscribe", async (req, res) => {
  const user: any = await requireCrmUser(req, res);
  if (!user) return;
  if (!await ensureWebPushConfigured()) return res.status(503).json({ error: "Push-сервис ещё не настроен" });
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return res.status(400).json({ error: "Некорректная push-подписка" });
  const id = createHash("sha256").update(String(subscription.endpoint)).digest("hex");
  await adminDb.collection("push_subscriptions").doc(id).set({
    subscription,
    enabled: true,
    uid: user.uid,
    email: user.email || "",
    name: user.name || "",
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    vapidPublicKey: WEB_PUSH_PUBLIC_KEY,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ success: true });
});

app.delete("/api/push/unsubscribe", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  const endpoint = String(req.body?.endpoint || "");
  if (endpoint && adminDb) await adminDb.collection("push_subscriptions").doc(createHash("sha256").update(endpoint).digest("hex")).delete().catch(() => null);
  res.json({ success: true });
});

app.post("/api/push/event", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  const type = String(req.body?.type || "") as PushEventType;
  const eventId = String(req.body?.eventId || "").slice(0, 240);
  if (!PUSH_EVENT_TYPES.has(type) || !eventId) return res.status(400).json({ error: "Некорректное событие" });
  const result = await dispatchPushEvent(type, eventId, req.body?.data || {});
  res.json({ success: true, ...result });
});

// Calendar fallback: a saved shift-start notification event is durable evidence
// that the manager pressed "Start shift", even if an older client failed to surface the
// corresponding manager_shifts document in the payroll view.
app.get("/api/manager-shifts/start-events", async (req, res) => {
  const user = await requireFinanceOwner(req, res);
  if (!user) return;
  if (!adminDb) return res.status(503).json({ error: "DB не подключена" });
  const month = String(req.query.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Нужен месяц YYYY-MM" });
  try {
    const [eventsSnapshot, profilesSnapshot] = await Promise.all([
      adminDb.collection("push_events").where("type", "==", "manager_shift_started").get(),
      adminDb.collection("manager_profiles").get(),
    ]);
    const aliases: Record<string, string> = {};
    aliases["yb1@ybcrm.ru"] = "Менеджер 1";
    aliases["yb2@ybcrm.ru"] = "Менеджер 2";
    profilesSnapshot.docs.forEach((item: any) => {
      const data = item.data() || {};
      const managerName = String(data.managerName || "").trim();
      if (!managerName) return;
      [item.id, data.managerId, data.managerEmail].forEach(value => {
        const key = String(value || "").trim().toLowerCase();
        if (key) aliases[key] = managerName;
      });
      aliases[managerName.toLowerCase()] = managerName;
    });
    const events = eventsSnapshot.docs.flatMap((item: any) => {
      const stored = item.data() || {};
      const data = stored.data || {};
      const dateKey = String(data.dateKey || data.startedAt || "").slice(0, 10);
      if (!dateKey.startsWith(month)) return [];
      const email = String(data.managerEmail || "").trim();
      const rawManager = String(data.manager || email || "Менеджер").trim();
      const managerName = aliases[email.toLowerCase()] || aliases[rawManager.toLowerCase()] || rawManager;
      return [{
        id: `push-${item.id}`,
        managerName,
        managerEmail: email || null,
        dateKey,
        startedAt: String(data.startedAt || ""),
        targetContacts: 100,
        basePay: 1000,
        status: "active",
        source: "push_event",
      }];
    });
    res.json({ events, aliases });
  } catch (error: any) {
    console.error("[manager-shifts] start events:", error?.message || error);
    res.status(500).json({ error: "Не удалось загрузить подтверждения начала смен" });
  }
});

const orderDateValue = (value: any) => {
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

app.post("/api/push/run-reminders", async (req, res) => {
  if (!adminDb) return res.status(503).json({ error: "DB не подключена" });
  const today = new Date();
  const dateKey = today.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const moscowHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    hour12: false,
  }).format(today));
  if (moscowHour !== 9) return res.json({ success: true, skipped: true, reason: "outside-reminder-window" });
  try {
    await adminDb.collection("push_jobs").doc(`reminders-${dateKey}`).create({
      type: "daily-reminders",
      startedAt: FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    if (String(error?.code || "").includes("already-exists") || Number(error?.code) === 6) {
      return res.json({ success: true, skipped: true, reason: "already-ran" });
    }
    throw error;
  }
  const snap = await adminDb.collection("orders_new").get();
  let due = 0;
  let overdue = 0;
  for (const item of snap.docs) {
    const data: any = item.data();
    const status = String(data.status || "");
    if (/доставлен|получен|вручен|возврат|отмен/i.test(status)) continue;
    const total = Number(data.revenue || 0) + Number(data.deliveryPrice || 0);
    const paid = Number(data.paidAmount || 0) + Number(data.finalPaymentAmount || 0);
    const balance = Math.max(0, total - paid);
    if (balance > 0 && /предоплат|prepaid/i.test(`${data.paymentType || ""} ${data.paymentStatus || ""}`)) {
      const result = await dispatchPushEvent("payment_due", `payment-due:${item.id}:${dateKey}`, { orderId: item.id, clientName: data.clientName, amount: balance });
      if (!result.duplicate) due += 1;
    }
    const deadline = orderDateValue(data.deadlineDate || data.shipmentDate);
    if (deadline && deadline.getTime() < today.getTime() && !/доставлен|получен|вручен|отгружен/i.test(status)) {
      const result = await dispatchPushEvent("order_overdue", `order-overdue:${item.id}:${dateKey}`, { orderId: item.id, clientName: data.clientName, deadline: deadline.toLocaleDateString("ru-RU") });
      if (!result.duplicate) overdue += 1;
    }
  }
  res.json({ success: true, due, overdue });
});

const MCP_PROXY_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/mcp",
]);

// ybcrm.ru is the stable public OAuth/MCP address used by ChatGPT, while the
// production MCP implementation is deployed as its own Cloud Run service.
// Forward the complete OAuth handshake and MCP traffic there. Without this
// bridge the public domain falls back to the legacy in-process implementation,
// where several tools are only placeholders.
app.use(async (req, res, next) => {
  if (!MCP_UPSTREAM_URL || !MCP_PROXY_PATHS.has(req.path)) return next();

  try {
    const forwardedHeaders: Record<string, string> = {};
    for (const name of [
      "authorization",
      "accept",
      "content-type",
      "mcp-protocol-version",
      "mcp-session-id",
      "last-event-id",
    ]) {
      const value = req.headers[name];
      if (typeof value === "string") forwardedHeaders[name] = value;
    }
    forwardedHeaders["x-forwarded-host"] = req.get("host") || "ybcrm.ru";
    forwardedHeaders["x-forwarded-proto"] = String(req.headers["x-forwarded-proto"] || req.protocol || "https");

    const upstream = await axios.request({
      method: req.method,
      url: `${MCP_UPSTREAM_URL}${req.path}`,
      params: req.query,
      data: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      headers: forwardedHeaders,
      maxRedirects: 0,
      responseType: "arraybuffer",
      timeout: 120_000,
      validateStatus: () => true,
    });

    for (const name of ["content-type", "location", "www-authenticate", "mcp-session-id"]) {
      const value = upstream.headers[name];
      if (value) res.setHeader(name, String(value));
    }
    res.status(upstream.status);
    if (req.method === "HEAD" || upstream.status === 204 || upstream.status === 304) return res.end();
    return res.send(Buffer.from(upstream.data));
  } catch (error: any) {
    console.error("[mcp proxy]", error?.message || error);
    return res.status(502).json({
      error: "MCP_UPSTREAM_UNAVAILABLE",
      message: "Отдельный MCP-сервис временно недоступен",
    });
  }
});

function mcpBaseUrl() {
  return MCP_PUBLIC_BASE_URL;
}

function mcpBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function mcpSign(payload: Record<string, any>) {
  const body = mcpBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", MCP_TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function mcpVerify(token: string) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", MCP_TOKEN_SECRET).update(body).digest("base64url");
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function mcpVerifyPkce(verifier: string, challenge: string, method = "plain") {
  if (method === "S256") {
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
  }
  return verifier === challenge;
}

function mcpEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mcpHtml(body: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>YBCRM MCP</title><style>body{margin:0;background:#f6f7f9;color:#1f2937;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:520px;margin:8vh auto;padding:32px;background:#fff;border:1px solid #e6e9ef;border-radius:18px;box-shadow:0 16px 40px rgba(31,41,55,.08)}h1{font-size:28px;line-height:1.15;margin:0 0 12px}p{color:#6b7280;line-height:1.5}input,button{width:100%;height:52px;border-radius:12px;font-size:16px}input{border:1px solid #dce1ea;padding:0 14px;box-sizing:border-box}button{margin-top:14px;border:0;background:#111827;color:white;font-weight:700;cursor:pointer}.hint{font-size:13px;color:#9ca3af}</style></head><body><main>${body}</main></body></html>`;
}

function mcpUnauthorized(res: express.Response) {
  const base = mcpBaseUrl();
  res
    .status(401)
    .setHeader("WWW-Authenticate", `Bearer realm="ybcrm-mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`)
    .json({ error: "unauthorized" });
}

function mcpAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = mcpVerify(token);
  if (!payload || payload.type !== "access") return mcpUnauthorized(res);
  (req as any).mcp = payload;
  return next();
}

function mcpOAuthMetadata(_req: express.Request, res: express.Response) {
  const base = mcpBaseUrl();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["crm.read", "crm.write"],
    service_documentation: `${base}/docs`,
  });
}

app.get("/.well-known/oauth-authorization-server", mcpOAuthMetadata);
app.get("/.well-known/oauth-authorization-server/mcp", mcpOAuthMetadata);

app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
  const base = mcpBaseUrl();
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["crm.read", "crm.write"],
  });
});

app.post("/oauth/register", (req, res) => {
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
  res.status(201).json({
    client_id: `ybcrm_${randomBytes(12).toString("hex")}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

app.all("/oauth/authorize", (req, res) => {
  const query = { ...req.query, ...req.body } as Record<string, any>;
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const scope = query.scope || "crm.read crm.write";
  if (!clientId || !redirectUri) {
    res.status(400).send(mcpHtml("<h1>Не хватает данных</h1><p>ChatGPT не передал client_id или redirect_uri.</p>"));
    return;
  }
  if (MCP_OAUTH_PIN && query.pin !== MCP_OAUTH_PIN) {
    const hidden = Object.entries(query)
      .filter(([key]) => key !== "pin")
      .map(([key, value]) => `<input type="hidden" name="${mcpEscape(key)}" value="${mcpEscape(value)}"/>`)
      .join("");
    res
      .status(query.pin ? 401 : 200)
      .send(
        mcpHtml(`<h1>Подключение YBCRM</h1><p>Введите PIN доступа, чтобы подключить ChatGPT к CRM.</p><form method="get" action="/oauth/authorize">${hidden}<input name="pin" autocomplete="one-time-code" placeholder="PIN доступа" autofocus/><button type="submit">Подключить</button></form><p class="hint">PIN нужен только при первом подключении MCP.</p>`),
      );
    return;
  }
  const code = mcpSign({
    type: "code",
    clientId,
    redirectUri,
    scope,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const url = new URL(String(redirectUri));
  url.searchParams.set("code", code);
  if (query.state) url.searchParams.set("state", String(query.state));
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  const codePayload = mcpVerify(String(req.body?.code || ""));
  if (req.body?.grant_type !== "authorization_code" || !codePayload || codePayload.type !== "code") {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (String(codePayload.redirectUri) !== String(req.body?.redirect_uri || "")) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (codePayload.codeChallenge) {
    const verifier = String(req.body?.code_verifier || "");
    if (!mcpVerifyPkce(verifier, String(codePayload.codeChallenge), String(codePayload.codeChallengeMethod || "plain"))) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }
  }
  const accessToken = mcpSign({
    type: "access",
    sub: "chatgpt",
    scope: codePayload.scope || "crm.read crm.write",
    exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
  });
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 31_536_000,
    scope: codePayload.scope || "crm.read crm.write",
  });
});

const mcpTools = [
  "orders.list",
  "orders.get",
  "orders.update",
  "orders.create",
  "clients.search",
  "analytics.sales",
  "instagram.stats",
  "content.analytics",
  "finance.summary",
  "tasks.create",
  "dashboard",
].map((name) => ({
  name,
  description: `YBCRM tool: ${name}`,
  inputSchema: { type: "object", additionalProperties: true },
}));

function mcpToNumber(value: any): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mcpDateString(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function mcpOrderItems(data: any) {
  const namesRaw = Array.isArray(data?.items) ? data.items : Array.isArray(data?.products) ? data.products : [];
  const prices = Array.isArray(data?.itemPrices) ? data.itemPrices : [];
  const colors = Array.isArray(data?.itemColors) ? data.itemColors : [];
  const sizes = Array.isArray(data?.itemSizes) ? data.itemSizes : [];
  const heights = Array.isArray(data?.itemHeights) ? data.itemHeights : [];

  if (namesRaw.length) {
    return namesRaw
      .map((item: any, index: number) => {
        if (typeof item === "string") {
          return {
            name: item,
            price: mcpToNumber(prices[index]),
            quantity: 1,
            color: colors[index] || "",
            size: sizes[index] || "",
            height: heights[index] || "",
          };
        }
        return {
          name: String(item?.name || item?.product || item?.title || item?.item || "Изделие"),
          price: mcpToNumber(item?.price ?? item?.amount ?? item?.cost ?? prices[index]),
          quantity: Math.max(1, mcpToNumber(item?.quantity ?? item?.qty ?? 1) || 1),
          color: item?.color || colors[index] || "",
          size: item?.size || sizes[index] || "",
          height: item?.height || item?.growth || heights[index] || "",
          label: item?.label || item?.tag || "",
        };
      })
      .filter((item: any) => item.name.trim());
  }

  const name = data?.item || data?.productName || data?.itemName || data?.product || data?.name;
  if (!name) return [];
  return [{
    name: String(name),
    price: mcpToNumber(data?.price ?? data?.revenue ?? data?.amountTotal ?? data?.total),
    quantity: Math.max(1, mcpToNumber(data?.quantity ?? 1) || 1),
    color: data?.color || "",
    size: data?.size || "",
    height: data?.height || data?.growth || "",
  }];
}

function mcpNormalizeOrder(id: string, data: any) {
  const items = mcpOrderItems(data);
  const itemsTotal = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const revenue = mcpToNumber(data?.revenue ?? data?.amountTotal ?? data?.totalAmount ?? data?.total ?? itemsTotal);
  const deliveryPrice = mcpToNumber(data?.deliveryPrice ?? data?.deliveryCost ?? data?.shippingCost);
  const paidAmount = mcpToNumber(data?.paidAmount ?? data?.prepaymentAmount ?? data?.prepaidAmount ?? data?.paymentAmount ?? data?.paid);
  const dueAmount = Math.max(0, revenue + deliveryPrice - paidAmount);
  return {
    id,
    orderId: String(data?.orderId || data?.id || id),
    date: mcpDateString(data?.date || data?.orderDate || data?.createdAt),
    status: data?.status || "",
    clientName: data?.clientName || data?.customerName || data?.name || "",
    phone: data?.clientPhone || data?.phone || data?.customerPhone || "",
    instagram: data?.clientInsta || data?.instagram || data?.clientInstagram || "",
    city: data?.clientCity || data?.city || "",
    manager: data?.manager || data?.managerName || "",
    blogger: data?.blogger || data?.bloggerName || "",
    source: data?.source || "",
    delivery: data?.delivery || data?.deliveryMethod || data?.deliveryType || "",
    paymentType: data?.paymentType || data?.invoiceType || data?.payment || data?.prepaymentType || "",
    revenue,
    deliveryPrice,
    paidAmount,
    dueAmount,
    items,
  };
}

function mcpFindOrderDoc(id: string) {
  const cleanId = String(id || "").replace(/^#+/, "").trim();
  return (async () => {
    const direct = await adminDb.collection("orders_new").doc(cleanId).get();
    if (direct.exists) return direct;
    const byOrder = await adminDb.collection("orders_new").where("orderId", "==", cleanId).limit(1).get();
    if (!byOrder.empty) return byOrder.docs[0];
    const byHashOrder = await adminDb.collection("orders_new").where("orderId", "==", `#${cleanId}`).limit(1).get();
    if (!byHashOrder.empty) return byHashOrder.docs[0];
    return null;
  })();
}

function mcpInvoiceAmount(revenue: number, deliveryPrice: number, invoiceType: string, explicitPaid: any) {
  if (explicitPaid !== undefined && explicitPaid !== null && explicitPaid !== "") return mcpToNumber(explicitPaid);
  const type = String(invoiceType || "").toLowerCase();
  const total = revenue + deliveryPrice;
  if (type.includes("полная") || type.includes("full")) return total;
  if (type.includes("пример") || type.includes("fitting")) return 2000;
  if (type.includes("50") || type.includes("предоплат") || type.includes("prepay")) return Math.round(total / 2);
  return 0;
}

function mcpBuildOrderDoc(args: any) {
  const items = mcpOrderItems(args);
  const names = items.map((item: any) => item.name);
  const revenue = mcpToNumber(args?.revenue ?? args?.amountTotal ?? args?.totalAmount ?? args?.total)
    || items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const deliveryPrice = mcpToNumber(args?.deliveryPrice ?? args?.deliveryCost ?? args?.shippingCost);
  const paymentType = String(args?.paymentType || args?.invoiceType || args?.payment || "Предоплата 50%");
  const paidAmount = mcpInvoiceAmount(revenue, deliveryPrice, paymentType, args?.paidAmount ?? args?.prepaymentAmount);
  const orderId = String(args?.orderId || args?.id || `MCP-${Date.now().toString(36).toUpperCase()}`).replace(/^#+/, "");
  const date = mcpDateString(args?.date || args?.orderDate) || new Date().toISOString().slice(0, 10);
  return {
    orderId,
    id: orderId,
    date,
    clientName: args?.clientName || args?.customerName || args?.name || "",
    clientPhone: normalizeCrmPhone(args?.phone || args?.clientPhone || args?.customerPhone || ""),
    clientInsta: args?.instagram || args?.clientInstagram || args?.clientInsta || "",
    clientCity: args?.city || args?.clientCity || "",
    item: names.join(", "),
    items: names,
    itemPrices: items.map((item: any) => item.price),
    itemColors: items.map((item: any) => item.color || ""),
    itemSizes: items.map((item: any) => item.size || ""),
    itemHeights: items.map((item: any) => item.height || ""),
    revenue,
    deliveryPrice,
    paidAmount,
    paymentType,
    invoiceType: paymentType,
    source: args?.source || "",
    deliveryMethod: args?.deliveryMethod || args?.delivery || args?.deliveryType || "",
    manager: args?.manager || "",
    blogger: args?.blogger || args?.bloggerName || "",
    status: args?.status || "Новый",
    createdBy: "mcp",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function mcpToolResult(name: string, args: any) {
  if (name === "orders.list" && adminDb) {
    const page = Math.max(1, Number(args?.page || 1));
    const pageSize = Math.max(1, Math.min(200, Number(args?.pageSize || 50)));
    const snap = await adminDb.collection("orders_new").orderBy("createdAt", "desc").limit(5000).get();
    let orders = snap.docs
      .map((doc: any) => mcpNormalizeOrder(doc.id, doc.data()))
      .filter((order: any) => order.deleted !== true);
    const dateFrom = mcpDateString(args?.date_from || args?.dateFrom);
    const dateTo = mcpDateString(args?.date_to || args?.dateTo);
    if (dateFrom) orders = orders.filter((order: any) => !order.date || order.date >= dateFrom);
    if (dateTo) orders = orders.filter((order: any) => !order.date || order.date <= dateTo);
    if (args?.status) orders = orders.filter((order: any) => String(order.status || "").toLowerCase().includes(String(args.status).toLowerCase()));
    if (args?.manager) orders = orders.filter((order: any) => String(order.manager || "").toLowerCase().includes(String(args.manager).toLowerCase()));
    if (args?.blogger) orders = orders.filter((order: any) => String(order.blogger || "").toLowerCase().includes(String(args.blogger).toLowerCase()));
    const total = orders.length;
    const start = (page - 1) * pageSize;
    return { page, pageSize, total, orders: orders.slice(start, start + pageSize) };
  }
  if (name === "orders.get" && adminDb && args?.id) {
    const snap = await mcpFindOrderDoc(String(args.id));
    return snap?.exists ? mcpNormalizeOrder(snap.id, snap.data()) : null;
  }
  if (name === "orders.update" && adminDb && args?.id) {
    const snap = await mcpFindOrderDoc(String(args.id));
    if (!snap?.exists) return { ok: false, error: `Заказ ${args.id} не найден` };
    const previousOrder = snap.data() || {};
    const patch: any = { updatedAt: FieldValue.serverTimestamp() };
    for (const key of ["status", "manager", "blogger", "source", "paymentType", "deliveryMethod", "clientName", "clientPhone", "clientInsta", "clientCity"]) {
      if (args?.[key] !== undefined) patch[key] = args[key];
    }
    if (patch.clientPhone !== undefined) patch.clientPhone = normalizeCrmPhone(patch.clientPhone);
    if (args?.delivery !== undefined) patch.deliveryMethod = args.delivery;
    if (args?.deliveryPrice !== undefined || args?.deliveryCost !== undefined) patch.deliveryPrice = mcpToNumber(args.deliveryPrice ?? args.deliveryCost);
    if (args?.paidAmount !== undefined) patch.paidAmount = mcpToNumber(args.paidAmount);
    if (args?.items !== undefined || args?.products !== undefined || args?.item !== undefined) {
      const items = mcpOrderItems(args);
      patch.items = items.map((item: any) => item.name);
      patch.item = patch.items.join(", ");
      patch.itemPrices = items.map((item: any) => item.price);
      patch.itemColors = items.map((item: any) => item.color || "");
      patch.itemSizes = items.map((item: any) => item.size || "");
      patch.itemHeights = items.map((item: any) => item.height || "");
      patch.revenue = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    }
    await adminDb.collection("orders_new").doc(snap.id).set(patch, { merge: true });
    await writeAuditLog({
      action: "order_updated",
      entityType: "order",
      entityId: snap.id,
      before: previousOrder,
      after: { ...previousOrder, ...patch },
      metadata: { source: "mcp", tool: "orders.update" },
      actor: { type: "mcp" },
    });
    if (patch.manager && String(patch.manager) !== String(previousOrder.manager || "")) {
      await dispatchPushEvent("manager_assigned", `manager-assigned:${snap.id}:${patch.manager}`, {
        orderId: snap.id,
        clientName: previousOrder.clientName,
        manager: patch.manager,
      }).catch(error => console.warn("[push] MCP manager:", error?.message || error));
    }
    if (patch.status !== undefined && String(patch.status || "") !== String(previousOrder.status || "")) {
      await dispatchPushEvent("order_status_changed", `order-status:${snap.id}:${String(patch.status)}:${Date.now()}`, {
        orderId: snap.id,
        clientName: previousOrder.clientName,
        previousStatus: String(previousOrder.status || ""),
        status: String(patch.status || ""),
      }).catch(error => console.warn("[push] MCP order status:", error?.message || error));
    }
    const updated = await adminDb.collection("orders_new").doc(snap.id).get();
    return { ok: true, order: mcpNormalizeOrder(updated.id, updated.data()) };
  }
  if (name === "orders.create" && adminDb) {
    const payload = mcpBuildOrderDoc(args || {});
    const beforeSnap = await adminDb.collection("orders_new").doc(payload.orderId).get();
    const before = beforeSnap.exists ? beforeSnap.data() : null;
    await adminDb.collection("orders_new").doc(payload.orderId).set(payload, { merge: true });
    await writeAuditLog({
      action: before ? "order_upserted" : "order_created",
      entityType: "order",
      entityId: payload.orderId,
      before,
      after: payload,
      metadata: { source: "mcp", tool: "orders.create" },
      actor: { type: "mcp" },
    });
    await dispatchPushEvent("order_created", `order-created:${payload.orderId}`, {
      orderId: payload.orderId,
      clientName: payload.clientName,
    }).catch(error => console.warn("[push] MCP order:", error?.message || error));
    const created = await adminDb.collection("orders_new").doc(payload.orderId).get();
    return { ok: true, order: mcpNormalizeOrder(created.id, created.data()) };
  }
  if (name === "analytics.sales" && adminDb) {
    const snap = await adminDb.collection("orders_new").orderBy("createdAt", "desc").limit(5000).get();
    const orders = snap.docs
      .map((doc: any) => mcpNormalizeOrder(doc.id, doc.data()))
      .filter((order: any) => order.deleted !== true);
    const now = new Date();
    const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterday = yesterdayDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    const weekStartDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const weekStart = weekStartDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    const monthStart = `${today.slice(0, 7)}-01`;
    const saleOrders = orders.filter((order: any) => !String(order.status || "").toLowerCase().match(/возврат|отмена/));
    const sumPaid = (list: any[]) => list.reduce((sum, order) => sum + mcpToNumber(order.paidAmount), 0);
    const todayOrders = saleOrders.filter((order: any) => order.date === today);
    const yesterdayOrders = saleOrders.filter((order: any) => order.date === yesterday);
    const weekOrders = saleOrders.filter((order: any) => order.date && order.date >= weekStart && order.date <= today);
    const monthOrders = saleOrders.filter((order: any) => order.date && order.date >= monthStart && order.date <= today);
    const monthRevenue = sumPaid(monthOrders);
    return {
      today: sumPaid(todayOrders),
      yesterday: sumPaid(yesterdayOrders),
      week: sumPaid(weekOrders),
      month: monthRevenue,
      averageCheck: monthOrders.length ? Math.round(monthRevenue / monthOrders.length) : 0,
      ordersCount: monthOrders.length,
      conversion: monthOrders.length ? 100 : 0,
      period: { today, yesterday, week_from: weekStart, month_from: monthStart },
    };
  }
  return {
    ok: true,
    tool: name,
    message: "MCP подключен к YBCRM. Для этого инструмента будет добавлена детальная логика CRM.",
    args: args || {},
  };
}

app.get("/mcp", mcpAuth, (_req, res) => {
  res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint expects POST requests." });
});

app.post("/mcp", mcpAuth, async (req, res) => {
  const body = req.body || {};
  const id = body.id ?? null;
  try {
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ybcrm", version: "1.0.0" },
        },
      });
      return;
    }
    if (body.method === "tools/list") {
      res.json({ jsonrpc: "2.0", id, result: { tools: mcpTools } });
      return;
    }
    if (body.method === "tools/call") {
      const result = await mcpToolResult(String(body.params?.name || ""), body.params?.arguments || {});
      res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
      return;
    }
    if (body.method === "notifications/initialized") {
      res.status(202).end();
      return;
    }
    res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error: any) {
    res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: error?.message || "MCP error" } });
  }
});

app.get("/api/ping", (req, res) => {
  res.send("ybcrm-system 2.0 - Claude AI + ManyChat v8");
});

async function readTgAccounts(): Promise<any[]> {
  if (adminDb) {
    try {
      const snap = await adminDb.collection("settings").doc("tg_accounts").get();
      return snap.exists ? (snap.data()?.accounts || []) : [];
    } catch (e: any) {
      console.warn("Firebase Admin tg_accounts read fallback:", e.message);
    }
  }
  if (!db) return [];
  const snap = await getDoc(doc(db, "settings", "tg_accounts"));
  return snap.exists() ? (snap.data().accounts || []) : [];
}

function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    const fields = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toFirestoreValue(child)])
    );
    return { mapValue: { fields } };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

async function saveTgAccountsWithGcloud(accounts: any[]): Promise<void> {
  if (!firebaseProjectId || !firebaseDatabaseId) throw new Error("Firebase project не настроен");
  const accessToken = execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!accessToken) throw new Error("gcloud не вернул access token");
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firebaseDatabaseId}/documents/settings/tg_accounts?updateMask.fieldPaths=accounts`;
  await axios.patch(
    url,
    { fields: { accounts: toFirestoreValue(accounts) } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

async function saveTgAccounts(accounts: any[]): Promise<void> {
  if (adminDb) {
    try {
      await adminDb.collection("settings").doc("tg_accounts").set({ accounts }, { merge: true });
      return;
    } catch (e: any) {
      console.warn("Firebase Admin tg_accounts write fallback:", e.message);
    }
  }
  try {
    await saveTgAccountsWithGcloud(accounts);
    return;
  } catch (e: any) {
    console.warn("Firebase REST tg_accounts write fallback:", e.message);
  }
  if (!db) throw new Error("БД не подключена");
  await setDoc(doc(db, "settings", "tg_accounts"), { accounts });
}

async function upsertTgAccount(entry: any): Promise<void> {
  const accounts = await readTgAccounts();
  const idx = accounts.findIndex((a: any) => a.phone === entry.phone);
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...entry };
  else accounts.push(entry);
  await saveTgAccounts(accounts);
}

app.get("/api/sheet/export", async (req, res) => {
  try {
    const sheetId = String(req.query.sheetId || "").trim();
    const gid = req.query.gid ? String(req.query.gid).trim() : "";

    if (!/^[a-zA-Z0-9-_]+$/.test(sheetId)) {
      return res.status(400).json({ error: "Invalid sheetId" });
    }

    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
    url.searchParams.set("format", "csv");
    if (gid) url.searchParams.set("gid", gid);
    url.searchParams.set("t", String(Date.now()));

    const response = await axios.get(url.toString(), {
      responseType: "text",
      timeout: 60000,
      headers: {
        "User-Agent": "Mozilla/5.0 YBCRM Sheet Loader",
      },
      transformResponse: [(data) => data],
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(response.data);
  } catch (error: any) {
    console.error("Sheet export error:", error.response?.status, error.message);
    res.status(error.response?.status || 500).json({
      error: "Не удалось загрузить таблицу",
      message: error.message,
    });
  }
});

const IS_TEST = process.env.CDEK_IS_TEST === "true";
const CDEK_BASE_URL = IS_TEST ? "https://api.edu.cdek.ru/v2" : "https://api.cdek.ru/v2";
let cdekToken: string | null = null;
let tokenExpiry: number = 0;
let cdekTokenKey: string | null = null;
const cdekDeliveryPointsCache = new Map<number, { expiresAt: number; points: any[] }>();
let cdekCitiesIndexCache: {
  baseUrl: string;
  expiresAt: number;
  cities: any[];
} | null = null;
let cdekCitiesIndexPromise: Promise<any[]> | null = null;

const normalizeCdekCitySearch = (value: unknown) => String(value || "")
  .trim()
  .toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е")
  .replace(/^(?:г(?:ород)?\.?\s+)/, "")
  .replace(/[‐‑‒–—−-]+/g, " ")
  .replace(/[^a-zа-я0-9\s]/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const CDEK_CITY_ALIASES = new Map<string, string>([
  ["спб", "Санкт-Петербург"],
  ["питер", "Санкт-Петербург"],
  ["петербург", "Санкт-Петербург"],
  ["санкт", "Санкт-Петербург"],
  ["санкт пет", "Санкт-Петербург"],
  ["санкт петербург", "Санкт-Петербург"],
  ["санкт петрбург", "Санкт-Петербург"],
  ["мск", "Москва"],
  ["екб", "Екатеринбург"],
  ["екат", "Екатеринбург"],
  ["екатерин", "Екатеринбург"],
  ["нск", "Новосибирск"],
  ["новосиб", "Новосибирск"],
  ["нн", "Нижний Новгород"],
  ["нижний", "Нижний Новгород"],
  ["краснояр", "Красноярск"],
  ["владивост", "Владивосток"],
  ["калининг", "Калининград"],
  ["ростов на дону", "Ростов-на-Дону"],
  ["ростов", "Ростов-на-Дону"],
  ["йошкар ола", "Йошкар-Ола"],
  ["улан удэ", "Улан-Удэ"],
  ["ханты мансийск", "Ханты-Мансийск"],
]);

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        substitution,
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

async function loadCdekCitiesIndex(token: string, baseUrl: string) {
  if (
    cdekCitiesIndexCache
    && cdekCitiesIndexCache.baseUrl === baseUrl
    && cdekCitiesIndexCache.expiresAt > Date.now()
  ) {
    return cdekCitiesIndexCache.cities;
  }
  if (cdekCitiesIndexPromise) return cdekCitiesIndexPromise;

  cdekCitiesIndexPromise = (async () => {
    const cities: any[] = [];
    const pageSize = 1000;
    const concurrency = 8;
    for (let firstPage = 0; firstPage < 100; firstPage += concurrency) {
      const pageResults = await Promise.all(
        Array.from({ length: concurrency }, (_, offset) => firstPage + offset).map(async page => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const response = await axios.get(`${baseUrl}/location/cities`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { country_codes: "RU", size: pageSize, page },
                timeout: 20_000,
              });
              return {
                success: true,
                batch: Array.isArray(response.data) ? response.data : [],
              };
            } catch (error) {
              if (attempt === 1) return { success: false, batch: [] };
            }
          }
          return { success: false, batch: [] };
        }),
      );
      for (const result of pageResults) {
        if (result.success) cities.push(...result.batch);
      }
      if (pageResults.some(result => result.success && result.batch.length < pageSize)) break;
    }
    const uniqueCities = Array.from(
      new Map(
        cities
          .filter(city => city?.code && city?.city)
          .map(city => [
            String(city.code),
            {
              code: city.code,
              city: city.city,
              region: city.region || "",
            },
          ]),
      ).values(),
    );
    cdekCitiesIndexCache = {
      baseUrl,
      expiresAt: Date.now() + 1000 * 60 * 60 * 6,
      cities: uniqueCities,
    };
    return uniqueCities;
  })().finally(() => {
    cdekCitiesIndexPromise = null;
  });
  return cdekCitiesIndexPromise;
}

function rankCdekCities(cities: any[], query: string) {
  const normalizedQuery = normalizeCdekCitySearch(query);
  if (!normalizedQuery) return [];
  const queryTokens = normalizedQuery.split(" ");
  return cities
    .map(city => {
      const cityName = normalizeCdekCitySearch(city.city);
      const regionName = normalizeCdekCitySearch(city.region);
      const searchable = `${cityName} ${regionName}`.trim();
      let score = Number.POSITIVE_INFINITY;
      if (cityName === normalizedQuery) score = 0;
      else if (cityName.startsWith(normalizedQuery)) score = 10 + (cityName.length - normalizedQuery.length);
      else if (cityName.includes(normalizedQuery)) score = 30 + cityName.indexOf(normalizedQuery);
      else if (queryTokens.every(token => searchable.includes(token))) score = 45;
      else if (normalizedQuery.length >= 5) {
        const distance = levenshteinDistance(cityName, normalizedQuery);
        const allowedDistance = Math.max(1, Math.min(3, Math.floor(normalizedQuery.length * 0.22)));
        if (distance <= allowedDistance) score = 60 + distance * 5;
      }
      if (!Number.isFinite(score)) return null;
      if (cityName === regionName) score -= 2;
      return { city, score };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => left.score - right.score || String(left.city.city).localeCompare(String(right.city.city), "ru"))
    .slice(0, 20)
    .map((entry: any) => entry.city);
}

async function getCdekSettings() {
  let saved: any = {};
  if (adminDb) {
    const snap = await adminDb.collection("settings").doc("cdek_api").get().catch(() => null);
    saved = snap?.exists ? snap.data() : {};
  } else if (db) {
    const snap = await getDoc(doc(db, "settings", "cdek_api")).catch(() => null);
    saved = snap?.exists?.() ? snap.data() : {};
  }
  const isTest = typeof saved?.isTest === "boolean" ? saved.isTest : IS_TEST;
  return {
    clientId: saved?.clientId || process.env.CDEK_CLIENT_ID || "",
    clientSecret: saved?.clientSecret || process.env.CDEK_CLIENT_SECRET || "",
    isTest,
    baseUrl: isTest ? "https://api.edu.cdek.ru/v2" : "https://api.cdek.ru/v2",
    senderCityCode: Number(saved?.senderCityCode || process.env.CDEK_SENDER_CITY_CODE || 44),
    senderCity: saved?.senderCity || process.env.CDEK_SENDER_CITY || "",
    senderAddress: saved?.senderAddress || process.env.CDEK_SENDER_ADDRESS || "",
    senderName: saved?.senderName || process.env.CDEK_SENDER_NAME || "",
    senderPhone: saved?.senderPhone || process.env.CDEK_SENDER_PHONE || "",
    shipmentPoint: saved?.shipmentPoint || process.env.CDEK_SHIPMENT_POINT || "",
  };
}

async function getCdekToken() {
  const settings = await getCdekSettings();
  const key = `${settings.baseUrl}:${settings.clientId}`;
  if (cdekToken && Date.now() < tokenExpiry && cdekTokenKey === key) return cdekToken;
  const clientId = settings.clientId;
  const clientSecret = settings.clientSecret;
  if (!clientId || !clientSecret) throw new Error("CDEK credentials not configured");
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  const response = await axios.post(`${settings.baseUrl}/oauth/token`, null, {
    params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  cdekToken = response.data.access_token;
  cdekTokenKey = key;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cdekToken;
}

function getCdekError(error: any) {
  return {
    status: error.response?.status || 500,
    message: error.message,
    details: error.response?.data || null,
  };
}

function stripUndefined(value: any): any {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
}

app.get("/api/cdek/status", async (_req, res) => {
  try {
    const settings = await getCdekSettings();
    const clientIdPreview = settings.clientId
      ? `${settings.clientId.slice(0, 4)}...${settings.clientId.slice(-4)}`
      : "";
    res.json({
      configured: Boolean(settings.clientId && settings.clientSecret),
      clientIdPreview,
      isTest: settings.isTest,
      senderCityCode: settings.senderCityCode,
      senderCity: settings.senderCity,
      senderAddress: settings.senderAddress,
      senderName: settings.senderName,
      senderPhone: settings.senderPhone,
      shipmentPoint: settings.shipmentPoint,
    });
  } catch (error: any) {
    res.status(500).json({ configured: false, error: error.message });
  }
});

app.post("/api/cdek/save-settings", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "Firebase not configured" });
    const currentSnap = await getDoc(doc(db, "settings", "cdek_api")).catch(() => null);
    const current = currentSnap?.exists?.() ? currentSnap.data() : {};
    const {
      clientId,
      clientSecret,
      isTest,
      senderCityCode,
      senderCity,
      senderAddress,
      senderName,
      senderPhone,
      shipmentPoint,
    } = req.body || {};

    const payload = {
      clientId: String(clientId || current.clientId || "").trim(),
      clientSecret: String(clientSecret || current.clientSecret || "").trim(),
      isTest: Boolean(isTest),
      senderCityCode: Number(senderCityCode || current.senderCityCode || process.env.CDEK_SENDER_CITY_CODE || 44),
      senderCity: String(senderCity || current.senderCity || "").trim(),
      senderAddress: String(senderAddress || current.senderAddress || "").trim(),
      senderName: String(senderName || current.senderName || "").trim(),
      senderPhone: String(senderPhone || current.senderPhone || "").trim(),
      shipmentPoint: String(shipmentPoint || current.shipmentPoint || "").trim(),
      updatedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "settings", "cdek_api"), payload, { merge: true });
    cdekToken = null;
    tokenExpiry = 0;
    cdekTokenKey = null;
    cdekCitiesIndexCache = null;
    cdekCitiesIndexPromise = null;
    res.json({ success: true, configured: Boolean(payload.clientId && payload.clientSecret) });
  } catch (error: any) {
    res.status(500).json({ error: "Не удалось сохранить настройки СДЭК", message: error.message });
  }
});

app.get("/api/cdek/diagnostics", async (_req, res) => {
  try {
    const settings = await getCdekSettings();
    const token = await getCdekToken();
    res.json({
      configured: Boolean(settings.clientId && settings.clientSecret),
      isTest: settings.isTest,
      baseUrl: settings.baseUrl,
      auth: "ok",
      tokenPreview: token ? `${token.slice(0, 8)}...` : null,
    });
  } catch (error: any) {
    const cdekError = getCdekError(error);
    res.status(cdekError.status).json({
      configured: true,
      auth: "failed",
      ...cdekError,
    });
  }
});

app.get("/api/cdek/cities", async (req, res) => {
  try {
    const rawQuery = String(req.query.q || "").trim();
    if (rawQuery.length < 2) return res.json([]);
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const normalizedQuery = normalizeCdekCitySearch(rawQuery);
    const canonicalQuery = CDEK_CITY_ALIASES.get(normalizedQuery) || rawQuery;
    const directResponse = await axios.get(`${settings.baseUrl}/location/cities`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { city: canonicalQuery, size: 20, country_codes: "RU" },
      timeout: 15_000,
    });
    const directCities = Array.isArray(directResponse.data) ? directResponse.data : [];
    const rankedDirectCities = rankCdekCities(directCities, canonicalQuery);
    const canonicalNormalized = normalizeCdekCitySearch(canonicalQuery);
    const hasExactDirectCity = directCities.some(
      city => normalizeCdekCitySearch(city?.city) === canonicalNormalized,
    );
    const hasPrefixDirectCity = rankedDirectCities.some(
      city => normalizeCdekCitySearch(city?.city).startsWith(canonicalNormalized),
    );
    if (hasExactDirectCity || hasPrefixDirectCity) {
      return res.json(rankedDirectCities.slice(0, 10));
    }

    const allCities = await loadCdekCitiesIndex(token, settings.baseUrl);
    const mergedCities = Array.from(
      new Map([...directCities, ...allCities].filter(city => city?.code).map(city => [String(city.code), city])).values(),
    );
    res.json(rankCdekCities(mergedCities, canonicalQuery).slice(0, 10));
  } catch (error: any) {
    const cdekError = getCdekError(error);
    res.status(cdekError.status).json({ error: "Ошибка поиска СДЭК", ...cdekError });
  }
});

app.post("/api/cdek/calculate", async (req, res) => {
  try {
    const { from_city_code, to_city_code, packages } = req.body;
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const response = await axios.post(`${settings.baseUrl}/calculator/tarifflist`, {
      from_location: { code: from_city_code || settings.senderCityCode },
      to_location: { code: to_city_code },
      packages: packages || [{ weight: 700, length: 30, width: 20, height: 10 }]
    }, { headers: { Authorization: `Bearer ${token}` } });
    res.json(response.data);
  } catch (error: any) {
    const cdekError = getCdekError(error);
    res.status(cdekError.status).json({ error: "Ошибка расчета СДЭК", ...cdekError });
  }
});

app.get("/api/cdek/deliverypoints", async (req, res) => {
  try {
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const cityCode = Number(req.query.city_code || 0);
    if (!cityCode) return res.status(400).json({ error: "Нужен city_code" });
    const cached = cdekDeliveryPointsCache.get(cityCode);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.points);
    }
    const response = await axios.get(`${settings.baseUrl}/deliverypoints`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { city_code: cityCode, type: "PVZ", size: 1000 },
      timeout: 20_000,
    });
    const points = Array.isArray(response.data) ? response.data : [];
    cdekDeliveryPointsCache.set(cityCode, {
      expiresAt: Date.now() + 1000 * 60 * 30,
      points,
    });
    res.json(points);
  } catch (error: any) {
    const cdekError = getCdekError(error);
    res.status(cdekError.status).json({ error: "Ошибка поиска ПВЗ СДЭК", ...cdekError });
  }
});

app.get("/api/cdek/deliverypoint", async (req, res) => {
  try {
    const pointCode = String(req.query.code || "").trim();
    if (!pointCode) return res.status(400).json({ error: "Нужен код ПВЗ" });
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const response = await axios.get(`${settings.baseUrl}/deliverypoints`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { code: pointCode },
      timeout: 15_000,
    });
    const points = Array.isArray(response.data) ? response.data : [];
    const exactPoint = points.find(point => String(point?.code || "").toLowerCase() === pointCode.toLowerCase())
      || points[0]
      || null;
    if (!exactPoint) return res.status(404).json({ error: "ПВЗ СДЭК не найден" });
    res.json(exactPoint);
  } catch (error: any) {
    const cdekError = getCdekError(error);
    res.status(cdekError.status).json({ error: "Ошибка поиска ПВЗ СДЭК", ...cdekError });
  }
});

type CdekWaybillResult = {
  pdf?: Buffer;
  printUuid: string;
  pending: boolean;
  status?: string;
  orderUuid: string;
  cdekNumber?: string | null;
  recovered?: boolean;
};

const getCdekEntityStatus = (entity: any, fallback = "PROCESSING") => {
  const statuses = Array.isArray(entity?.statuses) ? entity.statuses : [];
  const latest = statuses.reduce((current: any, candidate: any) => {
    if (!current) return candidate;
    const currentTime = Date.parse(String(current?.date_time || "")) || 0;
    const candidateTime = Date.parse(String(candidate?.date_time || "")) || 0;
    return candidateTime >= currentTime ? candidate : current;
  }, null);
  return String(latest?.code || entity?.status?.code || entity?.status || fallback).toUpperCase();
};

const getCdekCrmStatusPatch = (cdekStatus: string, currentStatus?: string) => {
  const normalized = String(cdekStatus || "").toUpperCase();
  const protectedStatus = /возврат|отмен/i.test(String(currentStatus || ""));
  if (protectedStatus) return {};
  if (normalized === "DELIVERED") {
    return {
      status: "Получен",
      isShipped: true,
      cdekDeliveredAt: new Date().toISOString(),
    };
  }
  if (normalized === "RECEIVED_AT_SHIPMENT_WAREHOUSE") {
    return {
      status: "Принят СДЭК",
      isShipped: true,
      cdekAcceptedAt: new Date().toISOString(),
    };
  }
  if (normalized === "READY_FOR_SHIPMENT_IN_SENDER_CITY") {
    return { status: "Отгружен", isShipped: true };
  }
  if (normalized === "ACCEPTED_AT_PICK_UP_POINT") {
    return { status: "Доставлен", isShipped: true };
  }
  if (
    normalized.startsWith("SENT_") ||
    normalized.startsWith("TAKEN_") ||
    normalized.startsWith("ACCEPTED_IN_") ||
    normalized.startsWith("ACCEPTED_AT_") ||
    normalized === "IN_TRANSIT" ||
    normalized.startsWith("RECEIVED_AT_")
  ) {
    return { status: "В пути", isShipped: true };
  }
  return {};
};

const getCdekStatusLabel = (status: string) => {
  const normalized = String(status || "").toUpperCase();
  const labels: Record<string, string> = {
    CREATED: "Накладная создана",
    ACCEPTED: "Заказ принят системой СДЭК",
    RECEIVED_AT_SHIPMENT_WAREHOUSE: "Принят СДЭК",
    READY_FOR_SHIPMENT_IN_SENDER_CITY: "Готов к отправке",
    TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: "В пути из города отправителя",
    SENT_TO_TRANSIT_CITY: "Отправлен в транзитный город",
    ACCEPTED_IN_TRANSIT_CITY: "Прибыл в транзитный город",
    ACCEPTED_AT_TRANSIT_WAREHOUSE: "Принят на транзитном складе",
    SENT_TO_RECIPIENT_CITY: "Направлен в город получателя",
    ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: "Прибыл на склад города получателя",
    ACCEPTED_AT_PICK_UP_POINT: "Готов к выдаче в ПВЗ",
    ACCEPTED_BY_COURIER: "Передан курьеру",
    DELIVERED: "Получен",
  };
  return labels[normalized] || normalized.replace(/_/g, " ");
};

const getCdekRequestError = (data: any) => {
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const invalidRequest = requests.find((request: any) =>
    String(request?.state || "").toUpperCase() === "INVALID" ||
    (Array.isArray(request?.errors) && request.errors.length > 0));
  if (!invalidRequest) return "";
  const messages = (invalidRequest.errors || [])
    .map((error: any) => String(error?.message || error?.code || "").trim())
    .filter(Boolean);
  return messages.join("; ") || "СДЭК отклонил запрос";
};

async function findCdekOrderByNumber(orderNumber: string, token: string, baseUrl: string) {
  if (!orderNumber) return null;
  const response = await axios.get(`${baseUrl}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { im_number: orderNumber },
  });
  const entity = response.data?.entity || response.data?.entities?.[0] || null;
  const requestError = getCdekRequestError(response.data);
  const status = getCdekEntityStatus(entity, "");
  if (!entity?.uuid || requestError || status === "INVALID") return null;
  return {
    uuid: String(entity.uuid),
    number: String(entity.cdek_number || entity.cdekNumber || "").trim() || null,
    status: status || "CREATED",
    data: response.data,
  };
}

async function resolveCdekOrder(orderUuid: string, orderNumber: string, token: string, baseUrl: string) {
  let storedOrderValid = false;
  if (orderUuid) {
    try {
      const response = await axios.get(`${baseUrl}/orders/${orderUuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const entity = response.data?.entity || response.data;
      storedOrderValid = Boolean(entity?.uuid) && !getCdekRequestError(response.data) && getCdekEntityStatus(entity, "") !== "INVALID";
      if (storedOrderValid) {
        return {
          uuid: String(entity.uuid),
          number: String(entity.cdek_number || entity.cdekNumber || "").trim() || null,
          status: getCdekEntityStatus(entity, "CREATED"),
          data: response.data,
          recovered: false,
        };
      }
    } catch {
      storedOrderValid = false;
    }
  }
  const recovered = await findCdekOrderByNumber(orderNumber, token, baseUrl);
  return recovered ? { ...recovered, recovered: true } : null;
}

async function createCdekWaybillPdf(
  orderUuid: string,
  existingPrintUuid = "",
  orderNumber = "",
  maxWaitMs = 14_000,
): Promise<CdekWaybillResult> {
  const token = await getCdekToken();
  const settings = await getCdekSettings();
  let printUuid = String(existingPrintUuid || "").trim();
  let pdfUrl = "";
  const resolvedOrder = await resolveCdekOrder(orderUuid, orderNumber, token, settings.baseUrl);
  if (!resolvedOrder) throw new Error("Заказ СДЭК не найден или был отклонён. Пересоздайте накладную.");
  if (resolvedOrder.uuid !== orderUuid) printUuid = "";
  orderUuid = resolvedOrder.uuid;

  if (!printUuid) {
    const createResponse = await axios.post(`${settings.baseUrl}/print/orders`, {
      orders: [{ order_uuid: orderUuid }],
      copy_count: 1,
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const printEntity = createResponse.data?.entity || createResponse.data;
    printUuid = String(printEntity?.uuid || createResponse.data?.entity_uuid || "").trim();
    pdfUrl = String(printEntity?.url || "").trim();
    if (!printUuid) throw new Error("СДЭК не вернул ID печатной формы");
  }

  const deadline = Date.now() + Math.max(0, maxWaitMs);
  let status = "PROCESSING";
  do {
    const statusResponse = await axios.get(`${settings.baseUrl}/print/orders/${printUuid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusEntity = statusResponse.data?.entity || statusResponse.data;
    pdfUrl = String(statusEntity?.url || "").trim();
    status = getCdekEntityStatus(statusEntity, "PROCESSING");
    const requestError = getCdekRequestError(statusResponse.data);
    if (!pdfUrl && requestError) throw new Error(`СДЭК не сформировал накладную: ${requestError}`);
    if (!pdfUrl && ["INVALID", "ERROR", "REMOVED"].includes(status)) {
      throw new Error("СДЭК не смог сформировать печатную накладную");
    }
    if (!pdfUrl && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1_000));
  } while (!pdfUrl && Date.now() < deadline);

  if (!pdfUrl) return {
    printUuid,
    pending: true,
    status,
    orderUuid,
    cdekNumber: resolvedOrder.number,
    recovered: resolvedOrder.recovered,
  };

  const pdfResponse = await axios.get(pdfUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    pdf: Buffer.from(pdfResponse.data),
    printUuid,
    pending: false,
    status: "READY",
    orderUuid,
    cdekNumber: resolvedOrder.number,
    recovered: resolvedOrder.recovered,
  };
}

app.post("/api/cdek/create-order", async (req, res) => {
  if (!await requireCrmOrderAction(req, res, req.body?.exchange === true ? 'exchange' : 'cdek')) return;
  try {
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const body = req.body || {};
    const orderId = String(body.orderId || "").trim();
    const recreate = Boolean(body.recreate);
    const requestedShipmentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.shipmentDate || ""))
      ? String(body.shipmentDate)
      : "";
    const requestedRecipientName = String(body.recipientName || "").trim();
    const requestedRecipientPhone = String(body.recipientPhone || "").trim();
    const tariffCode = Number(body.tariffCode || 136);
    const deliveryType = String(body.deliveryType || "pvz");
    let toCityCode = Number(body.toCityCode || 0);
    const deliveryPoint = String(body.deliveryPoint || "").trim();
    let toAddress = String(body.toAddress || "").trim();
    const requestedItemName = String(body.itemName || "Заказ YBCRM").trim();
    const itemCost = Math.max(0, Math.round(Number(body.itemCost || 0) * 100) / 100);
    // Declared value is used by CDEK only to calculate insurance. It must not
    // inherit the retail price of the CRM order unless explicitly requested.
    const declaredCost = Math.max(0, Math.round(Number(body.declaredCost ?? 0) * 100) / 100);
    const codAmount = Math.max(0, Math.round(Number(body.codAmount || 0) * 100) / 100);
    const deliveryCost = Math.max(0, Math.round(Number(body.deliveryCost || 0) * 100) / 100);
    const weight = Math.max(1, Number(body.weight || 700));
    const length = Math.max(1, Number(body.length || 30));
    const width = Math.max(1, Number(body.width || 20));
    const height = Math.max(1, Number(body.height || 10));
    const warehouseOriginTariffs = new Set([136, 137]);
    const doorOriginTariffs = new Set([138, 139]);

    if (!orderId) return res.status(400).json({ error: "Нужен номер заказа CRM для поля Номер ИМ в СДЭК" });

    // The CRM order is the source of truth for the recipient and the goods.
    // Values from the browser may be stale when several orders are edited in
    // succession, so they must never silently rename a CDEK waybill.
    const existingSnapshot: any = await getOrderSnapshot(orderId).catch(() => null);
    const existingSnapshotFound = existingSnapshot &&
      (typeof existingSnapshot.exists === "function" ? existingSnapshot.exists() : Boolean(existingSnapshot.exists));
    const existingData = existingSnapshotFound ? existingSnapshot.data() : null;
    const currentAttempt = Math.max(1, Number(existingData?.cdekShipmentAttempt || 1));
    const shipmentAttempt = recreate ? currentAttempt + 1 : currentAttempt;
    // An exchange already receives a new CRM suffix (…E), so that number is
    // unique in CDEK and should stay readable without an additional -R2.
    const externalOrderNumber = recreate && !body.exchange ? `${orderId}-R${shipmentAttempt}` : orderId;
    const savedItems = Array.isArray(existingData?.items)
      ? existingData.items.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : [];
    const savedItemName = savedItems.length
      ? savedItems.join(", ")
      : String(existingData?.item || "").trim();
    const recipientName = String(existingData?.clientName || requestedRecipientName).trim();
    const recipientPhone = String(existingData?.clientPhone || requestedRecipientPhone).trim();
    const itemName = savedItemName || requestedItemName;

    if (!recipientName || !recipientPhone) return res.status(400).json({ error: "Нужны ФИО и телефон получателя" });
    if (!toCityCode && !deliveryPoint) return res.status(400).json({ error: "Нужен город получателя или код ПВЗ" });
    if (deliveryType === "pvz" && !deliveryPoint) return res.status(400).json({ error: "Для ПВЗ нужен код пункта СДЭК" });
    if (deliveryType === "door" && !toAddress) return res.status(400).json({ error: "Для курьера нужен адрес получателя" });
    if (warehouseOriginTariffs.has(tariffCode) && !settings.shipmentPoint) {
      return res.status(400).json({ error: "Для тарифа от склада нужен код ПВЗ отправки в настройках СДЭК" });
    }
    if (doorOriginTariffs.has(tariffCode) && !settings.senderAddress) {
      return res.status(400).json({ error: "Для тарифа от двери нужен адрес отправителя в настройках СДЭК" });
    }

    let deliveryPointAddress = String(body.deliveryPointAddress || "").trim();
    let canonicalCity = String(body.toCity || "").trim();
    if (deliveryType === "pvz") {
      const pointResponse = await axios.get(`${settings.baseUrl}/deliverypoints`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { code: deliveryPoint },
        timeout: 15_000,
      });
      const pointCandidates = Array.isArray(pointResponse.data) ? pointResponse.data : [];
      const exactPoint = pointCandidates.find(point =>
        String(point?.code || "").toLowerCase() === deliveryPoint.toLowerCase(),
      ) || null;
      if (!exactPoint) {
        return res.status(400).json({ error: "Выбранный ПВЗ СДЭК не найден. Выберите город и ПВЗ заново." });
      }
      const pointCityCode = Number(exactPoint?.location?.city_code || 0);
      if (toCityCode && pointCityCode && toCityCode !== pointCityCode) {
        return res.status(400).json({
          error: "ПВЗ относится к другому городу. Выберите город и ПВЗ заново.",
          details: `Код выбранного города ${toCityCode}, код города ПВЗ ${pointCityCode}`,
        });
      }
      if (pointCityCode) toCityCode = pointCityCode;
      const pointCity = String(exactPoint?.location?.city || "").trim();
      const pointRegion = String(exactPoint?.location?.region || "").trim();
      if (pointCity) canonicalCity = `${pointCity}${pointRegion ? `, ${pointRegion}` : ""}`;
      const pointName = String(exactPoint?.name || exactPoint?.code || deliveryPoint).trim();
      const pointAddress = String(exactPoint?.location?.address || exactPoint?.address || "").trim();
      deliveryPointAddress = `${pointName}${pointAddress ? ` · ${pointAddress}` : ""}`;
      // A PVZ order is addressed by delivery_point. Keeping an old door
      // address beside it is misleading and caused mixed CRM addresses.
      toAddress = "";
    }

    const packageNumber = externalOrderNumber;
    const payload: any = {
      type: 1,
      number: packageNumber,
      shipment_date: requestedShipmentDate || undefined,
      tariff_code: tariffCode,
      comment: String(body.comment || "").trim() || undefined,
      recipient: {
        name: recipientName,
        phones: [{ number: recipientPhone }],
      },
      sender: settings.senderName || settings.senderPhone ? {
        name: settings.senderName || undefined,
        phones: settings.senderPhone ? [{ number: settings.senderPhone }] : undefined,
      } : undefined,
      packages: [{
        number: "1",
        weight,
        length,
        width,
        height,
        comment: String(body.packageComment || "").trim() || undefined,
        items: [{
          name: itemName,
          ware_key: String(body.wareKey || externalOrderNumber),
          payment: { value: codAmount },
          cost: declaredCost,
          amount: 1,
          weight,
        }],
      }],
    };

    if (settings.shipmentPoint) {
      payload.shipment_point = settings.shipmentPoint;
    } else {
      payload.from_location = {
        code: settings.senderCityCode,
        city: settings.senderCity || undefined,
        address: settings.senderAddress || undefined,
      };
    }

    if (deliveryType === "pvz") {
      payload.delivery_point = deliveryPoint;
    } else {
      payload.to_location = { code: toCityCode, address: toAddress };
    }

    const cdekPayload = stripUndefined(payload);
    const resolvedExisting = recreate ? null : await resolveCdekOrder(
      String(existingData?.cdekUuid || ""),
      externalOrderNumber,
      token,
      settings.baseUrl,
    ).catch(() => null);

    if (resolvedExisting) {
      const updatePayload = stripUndefined({
        ...cdekPayload,
        uuid: resolvedExisting.uuid,
      });
      const updateResponse = await axios.patch(`${settings.baseUrl}/orders`, updatePayload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updateError = getCdekRequestError(updateResponse.data);
      const updateEntity = updateResponse.data?.entity || updateResponse.data?.entities?.[0] || updateResponse.data;
      if (updateError || getCdekEntityStatus(updateEntity, "") === "INVALID") {
        throw new Error(`СДЭК не разрешил изменить накладную: ${updateError || "некорректные данные"}`);
      }

      const updatedUuid = String(
        updateEntity?.uuid || updateEntity?.entity_uuid || resolvedExisting.uuid,
      ).trim();
      const updatedNumber = String(
        updateEntity?.cdek_number || updateEntity?.cdekNumber || resolvedExisting.number || "",
      ).trim() || null;
      const updatedFields = stripUndefined({
        cdekUuid: updatedUuid,
        cdekNumber: updatedNumber,
        cdekStatus: getCdekEntityStatus(updateEntity, resolvedExisting.status || "CREATED"),
        cdekPrintUuid: null,
        cdekPrintStatus: null,
        cdekPrintCreatedAt: null,
        cdekUpdatedAt: new Date().toISOString(),
        cdekLastCheckedAt: new Date().toISOString(),
        cdekPayload: {
          tariffCode,
          deliveryType,
          toCityCode,
          deliveryPoint,
          deliveryPointAddress,
          toCity: canonicalCity,
          toAddress,
          recipientName,
          recipientPhone,
          itemName,
          weight,
          length,
          width,
          height,
          itemCost,
          declaredCost,
          codAmount,
          deliveryCost,
        },
      });
      await persistOrderPatch(orderId, updatedFields);
      await dispatchPushEvent("cdek_status_changed", `cdek-updated:${orderId}:${Date.now()}`, {
        orderId,
        clientName: existingData?.clientName,
        status: "Накладная обновлена",
        cdekNumber: String(updatedNumber || ""),
      }).catch(error => console.warn("[push] cdek update:", error?.message || error));

      if (db) {
        await addDoc(collection(db, "cdek_logs"), {
          orderId,
          cdekUuid: updatedUuid,
          cdekNumber: updatedNumber,
          action: "update",
          request: updatePayload,
          response: stripUndefined(updateResponse.data),
          createdAt: serverTimestamp(),
        }).catch((logError: any) => {
          console.warn("[cdek] update log write skipped:", logError?.message || logError);
        });
      }
      await writeAuditLog({
        action: "cdek_waybill_updated",
        entityType: "order",
        entityId: orderId,
        before: existingData || null,
        after: { ...(existingData || {}), ...updatedFields },
        metadata: {
          source: "cdek",
          cdekUuid: updatedUuid,
          cdekNumber: updatedNumber,
          recovered: resolvedExisting.recovered,
        },
        actor: { type: "server", service: "cdek" },
      });

      return res.json({
        success: true,
        existing: true,
        updated: true,
        recovered: resolvedExisting.recovered,
        cdekUuid: updatedUuid,
        cdekNumber: updatedNumber,
        data: updateResponse.data,
      });
    }

    const response = await axios.post(`${settings.baseUrl}/orders`, cdekPayload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let entity = response.data?.entity || response.data?.entities?.[0] || response.data;
    let cdekUuid = entity?.uuid || entity?.entity_uuid || response.data?.entity_uuid || null;
    let cdekNumber = entity?.cdek_number || entity?.cdekNumber || null;
    let cdekOrderDetails: any = null;
    const createError = getCdekRequestError(response.data);
    if (createError || getCdekEntityStatus(entity, "") === "INVALID") {
      const recovered = await findCdekOrderByNumber(externalOrderNumber, token, settings.baseUrl).catch(() => null);
      if (!recovered) throw new Error(`СДЭК отклонил создание заказа: ${createError || "некорректный заказ"}`);
      entity = recovered.data?.entity || entity;
      cdekUuid = recovered.uuid;
      cdekNumber = recovered.number;
      cdekOrderDetails = recovered.data;
    }
    if (!cdekNumber && cdekUuid) {
      try {
        const detailResponse = await axios.get(`${settings.baseUrl}/orders/${cdekUuid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        cdekOrderDetails = detailResponse.data;
        const detailEntity = detailResponse.data?.entity || detailResponse.data;
        cdekNumber = detailEntity?.cdek_number || detailEntity?.cdekNumber || null;
      } catch (detailsError: any) {
        console.warn("[cdek] number lookup skipped:", detailsError?.response?.data || detailsError?.message || detailsError);
      }
    }
    const previousWaybills = Array.isArray(existingData?.cdekWaybillHistory)
      ? existingData.cdekWaybillHistory.slice(-19)
      : [];
    const cdekFields = {
      cdekUuid,
      cdekNumber,
      cdekStatus: "created",
      cdekCreatedAt: new Date().toISOString(),
      cdekShipmentAttempt: shipmentAttempt,
      cdekExternalNumber: externalOrderNumber,
      ...(recreate && existingData?.cdekUuid ? {
        cdekRepeatedAt: new Date().toISOString(),
        cdekWaybillHistory: [...previousWaybills, stripUndefined({
          uuid: existingData.cdekUuid,
          number: existingData.cdekNumber || null,
          externalNumber: existingData.cdekExternalNumber || orderId,
          status: existingData.cdekStatus || null,
          replacedAt: new Date().toISOString(),
        })],
      } : {}),
      cdekPayload: {
        tariffCode,
        deliveryType,
        toCityCode,
        deliveryPoint,
        deliveryPointAddress,
        toCity: canonicalCity,
        toAddress,
        recipientName,
        recipientPhone,
        itemName,
        weight,
        length,
        width,
        height,
        itemCost,
        declaredCost,
        codAmount,
        deliveryCost,
        shipmentDate: requestedShipmentDate || null,
        externalOrderNumber,
      },
    };

    if (orderId) await persistOrderPatch(orderId, cdekFields);
    await dispatchPushEvent("cdek_status_changed", `cdek-status:${orderId}:CREATED`, {
      orderId,
      clientName: existingData?.clientName,
      status: recreate ? "Повторная накладная создана" : "Накладная создана",
      cdekNumber: String(cdekNumber || ""),
    }).catch(error => console.warn("[push] cdek create:", error?.message || error));

    if (db) {
      try {
        await addDoc(collection(db, "cdek_logs"), {
          orderId: orderId || null,
          cdekUuid,
          cdekNumber,
          request: cdekPayload,
          response: stripUndefined(response.data),
          createdAt: serverTimestamp(),
        });
      } catch (logError: any) {
        console.warn("[cdek] log write skipped:", logError?.message || logError);
      }
    }
    await writeAuditLog({
      action: recreate ? "cdek_waybill_recreated" : "cdek_waybill_created",
      entityType: "order",
      entityId: orderId,
      before: existingData || null,
      after: { ...(existingData || {}), ...cdekFields },
      metadata: {
        source: "cdek",
        cdekUuid,
        cdekNumber,
      },
      actor: { type: "server", service: "cdek" },
    });

    res.json({ success: true, recreated: recreate, cdekUuid, cdekNumber, data: response.data, details: cdekOrderDetails });
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[cdek] create-order error:", JSON.stringify(details, null, 2));
    res.status(error.response?.status || 500).json({ error: "Не удалось создать заказ СДЭК", details });
  }
});

app.get("/api/cdek/order/:uuid", async (req, res) => {
  try {
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const uuid = String(req.params.uuid || "").trim();
    const orderId = String(req.query.orderId || "").trim();
    if (!uuid) return res.status(400).json({ error: "Нужен uuid заказа СДЭК" });

    const response = await axios.get(`${settings.baseUrl}/orders/${uuid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const entity = response.data?.entity || response.data;
    const cdekNumber = entity?.cdek_number || entity?.cdekNumber || entity?.number || null;
    const cdekStatus = getCdekEntityStatus(entity, "CREATED");
    const existingSnapshot = orderId ? await getOrderSnapshot(orderId).catch(() => null) : null;
    const existingOrder = existingSnapshot?.data?.() || {};
    const patch = stripUndefined({
      cdekUuid: uuid,
      cdekNumber,
      cdekStatus,
      cdekLastCheckedAt: new Date().toISOString(),
      ...getCdekCrmStatusPatch(cdekStatus, existingOrder.status),
    });

    if (orderId) {
      await persistOrderPatch(orderId, patch);
      if (String(cdekStatus) !== String(existingOrder.cdekStatus || "")) {
        await dispatchPushEvent("cdek_status_changed", `cdek-status:${orderId}:${cdekStatus}`, {
          orderId,
          clientName: existingOrder.clientName,
          status: getCdekStatusLabel(cdekStatus),
          cdekNumber: String(cdekNumber || ""),
        }).catch(error => console.warn("[push] cdek lookup:", error?.message || error));
      }
    }

    res.json({
      success: true,
      cdekUuid: uuid,
      cdekNumber,
      cdekStatus,
      crmStatus: patch.status || existingOrder.status || "",
      data: response.data,
    });
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[cdek] order lookup error:", JSON.stringify(details, null, 2));
    res.status(error.response?.status || 500).json({ error: "Не удалось получить заказ СДЭК", details });
  }
});

app.post("/api/cdek/sync-statuses", async (_req, res) => {
  try {
    if (!adminDb && !db) return res.status(503).json({ error: "DB не подключена" });
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const allOrders: Array<{ id: string; data: any }> = [];
    if (adminDb) {
      const snap = await adminDb.collection("orders_new").get();
      snap.docs.forEach((item: any) => allOrders.push({ id: item.id, data: item.data() }));
    } else if (db) {
      const snap = await getDocs(collection(db, "orders_new"));
      snap.docs.forEach((item: any) => allOrders.push({ id: item.id, data: item.data() }));
    }

    const staleBefore = Date.now() - 10 * 60 * 1000;
    const candidates = allOrders
      .filter(({ data }) => {
        if (!String(data?.cdekUuid || "").trim()) return false;
        if (/доставлен|получен|вручен|возврат|отмен/i.test(String(data?.status || ""))) return false;
        const lastChecked = Date.parse(String(data?.cdekLastCheckedAt || "")) || 0;
        return lastChecked < staleBefore;
      })
      .slice(0, 30);

    const updated: any[] = [];
    for (let index = 0; index < candidates.length; index += 4) {
      const batch = candidates.slice(index, index + 4);
      const results = await Promise.all(batch.map(async ({ id, data }) => {
        try {
          const response = await axios.get(`${settings.baseUrl}/orders/${encodeURIComponent(data.cdekUuid)}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15_000,
          });
          const entity = response.data?.entity || response.data;
          const cdekStatus = getCdekEntityStatus(entity, data.cdekStatus || "CREATED");
          const cdekNumber = entity?.cdek_number || entity?.cdekNumber || entity?.number || data.cdekNumber || null;
          const crmPatch = getCdekCrmStatusPatch(cdekStatus, data.status);
          const patch = stripUndefined({
            cdekStatus,
            cdekNumber,
            cdekLastCheckedAt: new Date().toISOString(),
            ...crmPatch,
          });
          await persistOrderPatch(id, patch);
          if (String(cdekStatus) !== String(data.cdekStatus || "")) {
            await dispatchPushEvent("cdek_status_changed", `cdek-status:${id}:${cdekStatus}`, {
              orderId: id,
              clientName: data.clientName,
              status: getCdekStatusLabel(cdekStatus),
              cdekNumber: String(cdekNumber || ""),
            }).catch(error => console.warn("[push] cdek:", error?.message || error));
          }
          return { orderId: id, cdekStatus, status: crmPatch.status || data.status, delivered: crmPatch.status === "Получен" };
        } catch (error: any) {
          console.warn(`[cdek] status sync failed order=${id}:`, error?.response?.data || error?.message || error);
          return null;
        }
      }));
      updated.push(...results.filter(Boolean));
    }

    res.json({
      success: true,
      checked: candidates.length,
      delivered: updated.filter(item => item.delivered).length,
      updated,
    });
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[cdek] statuses sync error:", details);
    res.status(error.response?.status || 500).json({ error: "Не удалось синхронизировать статусы СДЭК", details });
  }
});

async function getOrderSnapshot(orderId: string): Promise<any> {
  if (adminDb) {
    try {
      const direct = await adminDb.collection("orders_new").doc(orderId).get();
      if (direct.exists) return direct;
      const matched = await adminDb.collection("orders_new").where("orderId", "==", orderId).limit(1).get();
      if (!matched.empty) return matched.docs[0];
      return direct;
    } catch (error: any) {
      console.warn("[orders] Admin Firestore unavailable, using client connection:", error?.message || error);
    }
  }
  if (!db) throw new Error("Firestore не настроен");
  const direct = await getDoc(doc(db, "orders_new", orderId));
  if (direct.exists()) return direct;
  const matched = await getDocs(query(collection(db, "orders_new"), where("orderId", "==", orderId)));
  return matched.docs[0] || direct;
}

async function persistOrderPatch(orderId: string, patch: Record<string, unknown>): Promise<void> {
  let adminError: unknown = null;
  if (adminDb) {
    try {
      const snapshot = await getOrderSnapshot(orderId);
      const exists = snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists);
      if (!exists) {
        console.warn(`[orders] Patch skipped because CRM order ${orderId} does not exist`);
        return;
      }
      await adminDb.collection("orders_new").doc(snapshot.id).update(patch);
      return;
    } catch (error: any) {
      adminError = error;
      console.warn("[orders] Admin Firestore write unavailable, using client connection:", error?.message || error);
    }
  }
  if (db) {
    try {
      const snapshot = await getOrderSnapshot(orderId);
      if (!snapshot?.exists?.()) {
        console.warn(`[orders] Patch skipped because CRM order ${orderId} does not exist`);
        return;
      }
      await updateDoc(doc(db, "orders_new", snapshot.id), patch);
      return;
    } catch (error: any) {
      throw new Error(`Не удалось сохранить заказ ${orderId}: ${error?.message || error}`);
    }
  }
  throw adminError || new Error("Firestore не настроен");
}

app.get("/api/cdek/order/:uuid/waybill.pdf", async (req, res) => {
  try {
    const orderUuid = String(req.params.uuid || "").trim();
    const orderId = String(req.query.orderId || "").trim();
    if (!orderUuid) return res.status(400).json({ error: "Нужен uuid заказа СДЭК" });
    let existingPrintUuid = String(req.query.printUuid || "").trim();
    if (!existingPrintUuid && orderId) {
      const snapshot: any = await getOrderSnapshot(orderId);
      const exists = snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : Boolean(snapshot.exists));
      if (exists) existingPrintUuid = String(snapshot.data()?.cdekPrintUuid || "").trim();
    }
    const result = await createCdekWaybillPdf(orderUuid, existingPrintUuid, orderId);
    const printPatch = stripUndefined({
      cdekUuid: result.orderUuid,
      cdekNumber: result.cdekNumber || undefined,
      cdekPrintUuid: result.printUuid,
      cdekPrintCreatedAt: new Date().toISOString(),
      cdekPrintStatus: result.pending ? result.status || "PROCESSING" : "READY",
    });
    if (orderId) await persistOrderPatch(orderId, printPatch);
    if (result.pending || !result.pdf) {
      res.setHeader("Retry-After", "2");
      return res.status(202).json({
        pending: true,
        printUuid: result.printUuid,
        status: result.status || "PROCESSING",
        retryAfterMs: 2_000,
        message: "СДЭК готовит накладную. CRM продолжит ожидание автоматически.",
      });
    }
    const safeOrderId = (orderId || "order").replace(/[^a-zA-Z0-9_-]/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cdek-${safeOrderId}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(result.pdf);
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[cdek] waybill print error:", JSON.stringify(details, null, 2));
    return res.status(error.response?.status || 500).json({ error: "Не удалось получить печатную накладную СДЭК", details });
  }
});

const escapeDocumentXml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const splitDocumentLines = (value: unknown, max = 54, maxLines = 3) => {
  const words = String(value || "—").trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      if (lines.length >= maxLines - 1) {
        const remainder = words.slice(index).join(" ");
        current = remainder.length > max ? `${remainder.slice(0, Math.max(1, max - 1)).trim()}…` : remainder;
        break;
      }
      current = word;
    } else current = next;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ["—"];
};

app.get("/api/orders/:orderId/document.pdf", async (req, res) => {
  try {
    const orderId = String(req.params.orderId || "").trim();
    if (!orderId || !db) return res.status(400).json({ error: "Нужен номер заказа" });
    const snapshot: any = await getOrderSnapshot(orderId);
    const orderExists = typeof snapshot.exists === "function" ? snapshot.exists() : Boolean(snapshot.exists);
    if (!orderExists) return res.status(404).json({ error: "Заказ не найден" });
    const order: any = snapshot.data();
    const items = Array.isArray(order.items) && order.items.length
      ? order.items.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : String(order.item || "Заказ").split(",").map((item: string) => item.trim()).filter(Boolean);
    const prices = Array.isArray(order.itemPrices) ? order.itemPrices : [];
    const colors = Array.isArray(order.itemColors) ? order.itemColors : [];
    const sizes = Array.isArray(order.itemSizes) ? order.itemSizes : [];
    const heights = Array.isArray(order.itemHeights) ? order.itemHeights : [];
    const revenue = Number(order.revenue) || 0;
    const deliveryPrice = Number(order.deliveryPrice) || 0;
    const total = revenue + deliveryPrice;
    const invoiceAmount = Number(order.paidAmount) || total;
    const rawDate = order.date?.toDate ? order.date.toDate() : new Date(order.date || Date.now());
    const orderDate = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
    const instagram = String(order.clientInsta || "")
      .replace(/^@/, "")
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .split(/[/?#]/)[0];
    const address = order.clientAddress || order.cdekPayload?.toAddress || order.cdekPayload?.deliveryPoint || order.clientCity || "—";
    const paymentUrl = order.paymentUrl || `${String(process.env.SERVER_URL || "https://ybcrm.ru").replace(/\/$/, "")}/pay/${encodeURIComponent(orderId)}`;
    const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

    const normalizedClientPhone = normalizeCrmPhone(order.clientPhone || "");
    const formattedClientPhone = normalizedClientPhone ? `+${normalizedClientPhone}` : "";
    const clientLines = [order.clientName || "—", formattedClientPhone || "—", instagram ? `@${instagram}` : ""]
      .filter(Boolean)
      .map((line, index) => `<text x="84" y="${420 + index * 34}" class="value">${escapeDocumentXml(line)}</text>`)
      .join("");
    const addressLines = splitDocumentLines(address, 30, 3)
      .map((line, index) => `<text x="664" y="${420 + index * 34}" class="value">${escapeDocumentXml(line)}</text>`)
      .join("");
    const itemRows = (items.length ? items : ["Заказ"]).slice(0, 6).map((item: string, index: number) => {
      const y = 690 + index * 82;
      const meta = [colors[index], sizes[index], heights[index]].filter(Boolean).join(" · ") || "—";
      const price = Number(prices[index]) || (items.length === 1 ? revenue : 0);
      return `<line x1="70" x2="1170" y1="${y + 48}" y2="${y + 48}" stroke="#E5E7EB"/><text x="84" y="${y}" class="item">${escapeDocumentXml(item)}</text><text x="84" y="${y + 28}" class="meta">${escapeDocumentXml(meta)}</text><text x="1040" y="${y + 12}" text-anchor="end" class="item">${escapeDocumentXml(rub(price))}</text><text x="1135" y="${y + 12}" text-anchor="end" class="meta">× 1</text>`;
    }).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
      <rect width="1240" height="1754" fill="#FFFFFF"/>
      <style>.brand{font:900 34px Arial,sans-serif;letter-spacing:8px;fill:#111827}.title{font:700 52px Arial,sans-serif;fill:#111827}.label{font:700 15px Arial,sans-serif;letter-spacing:2px;fill:#9CA3AF}.value{font:600 24px Arial,sans-serif;fill:#374151}.item{font:700 23px Arial,sans-serif;fill:#1F2937}.meta{font:500 18px Arial,sans-serif;fill:#6B7280}.money{font:800 28px Arial,sans-serif;fill:#111827}.small{font:500 16px Arial,sans-serif;fill:#6B7280}</style>
      <text x="70" y="92" class="brand">YAASBAE</text><text x="1170" y="78" text-anchor="end" class="item">ЗАКАЗ № ${escapeDocumentXml(orderId)}</text><text x="1170" y="108" text-anchor="end" class="small">${escapeDocumentXml(orderDate.toLocaleDateString("ru-RU"))}</text>
      <line x1="70" x2="1170" y1="145" y2="145" stroke="#111827" stroke-width="3"/>
      <text x="70" y="235" class="title">Документ заказа</text><text x="70" y="278" class="small">Состав заказа, доставка и сумма к оплате</text>
      <rect x="70" y="340" width="530" height="200" rx="18" fill="#FAFAFA" stroke="#E5E7EB"/><text x="84" y="382" class="label">КЛИЕНТ</text>${clientLines}
      <rect x="650" y="340" width="520" height="200" rx="18" fill="#FAFAFA" stroke="#E5E7EB"/><text x="664" y="382" class="label">ДОСТАВКА</text>${addressLines}<text x="664" y="518" class="small">${escapeDocumentXml(order.cdekNumber ? `СДЭК № ${order.cdekNumber}` : order.deliveryMethod || "—")}</text>
      <text x="84" y="625" class="label">НАИМЕНОВАНИЕ</text><text x="1135" y="625" text-anchor="end" class="label">СТОИМОСТЬ</text>${itemRows}
      <rect x="650" y="1240" width="520" height="260" rx="18" fill="#F7F7FF" stroke="#D7D7F5"/>
      <text x="680" y="1290" class="small">Изделия</text><text x="1135" y="1290" text-anchor="end" class="item">${escapeDocumentXml(rub(revenue))}</text>
      <text x="680" y="1345" class="small">Доставка</text><text x="1135" y="1345" text-anchor="end" class="item">${escapeDocumentXml(rub(deliveryPrice))}</text><line x1="680" x2="1135" y1="1380" y2="1380" stroke="#111827" stroke-width="2"/>
      <text x="680" y="1430" class="money">Итого</text><text x="1135" y="1430" text-anchor="end" class="money">${escapeDocumentXml(rub(total))}</text><text x="680" y="1472" class="small">Счёт к оплате: ${escapeDocumentXml(rub(invoiceAmount))}</text>
      <text x="70" y="1550" class="label">ССЫЛКА НА ОПЛАТУ</text><text x="70" y="1585" class="small">${escapeDocumentXml(paymentUrl)}</text>
      <line x1="70" x2="1170" y1="1650" y2="1650" stroke="#E5E7EB"/><text x="70" y="1690" class="small">YAASBAE · документ сформирован в CRM</text><text x="1170" y="1690" text-anchor="end" class="small">${escapeDocumentXml(new Date().toLocaleString("ru-RU"))}</text>
    </svg>`;

    const coverPng = await sharp(Buffer.from(svg)).png().toBuffer();
    const pdfDocument = await PDFDocument.create();
    const coverImage = await pdfDocument.embedPng(coverPng);
    const itemSummary = (items.length ? items : ["Заказ"]).slice(0, 2).join(", ");
    const itemMeta = [colors[0], sizes[0], heights[0]].filter(Boolean).join(" · ") || "—";
    const paymentStatus = /paid|succeeded|оплач/i.test(String(order.paymentStatus || order.status || ""))
      ? "Оплачено онлайн"
      : String(order.paymentType || "Счёт на оплату");
    const compactAddressLines = splitDocumentLines(address, 30, 2);
    const compactAddressSvg = compactAddressLines
      .map((line, index) => `<text x="410" y="${348 + index * 29}" class="${index === 0 ? "value" : "small"}">${escapeDocumentXml(line)}</text>`)
      .join("");
    const compactSummarySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="560" viewBox="0 0 1240 560">
      <rect width="1240" height="560" rx="28" fill="#F8F7FF"/>
      <rect x="1" y="1" width="1238" height="558" rx="27" fill="none" stroke="#D9D3FF" stroke-width="2"/>
      <style>.brand{font:900 28px Arial,sans-serif;letter-spacing:7px;fill:#4F36E8}.order{font:800 27px Arial,sans-serif;fill:#111827}.label{font:700 13px Arial,sans-serif;letter-spacing:1.5px;fill:#8B93A5}.value{font:650 20px Arial,sans-serif;fill:#1F2937}.small{font:500 17px Arial,sans-serif;fill:#667085}.total{font:800 28px Arial,sans-serif;fill:#4F36E8}</style>
      <text x="38" y="58" class="brand">YAASBAE</text><text x="1200" y="56" text-anchor="end" class="order">ЗАКАЗ № ${escapeDocumentXml(orderId)}</text>
      <line x1="38" x2="1200" y1="82" y2="82" stroke="#D9D3FF" stroke-width="2"/>
      <text x="38" y="126" class="label">КЛИЕНТ</text><text x="38" y="162" class="value">${escapeDocumentXml(order.clientName || "—")}</text><text x="38" y="194" class="small">${escapeDocumentXml(instagram ? `@${instagram}` : formattedClientPhone || "—")}</text>
      <text x="410" y="126" class="label">ТОВАР</text><text x="410" y="162" class="value">${escapeDocumentXml(itemSummary)}</text><text x="410" y="194" class="small">${escapeDocumentXml(itemMeta)}</text>
      <rect x="850" y="104" width="350" height="132" rx="18" fill="#FFFFFF" stroke="#DED9FF"/>
      <text x="878" y="140" class="small">Товар</text><text x="1170" y="140" text-anchor="end" class="value">${escapeDocumentXml(rub(revenue))}</text>
      <text x="878" y="177" class="small">Доставка</text><text x="1170" y="177" text-anchor="end" class="value">${escapeDocumentXml(rub(deliveryPrice))}</text>
      <line x1="878" x2="1170" y1="194" y2="194" stroke="#D9D3FF"/><text x="878" y="225" class="value">Итого</text><text x="1170" y="225" text-anchor="end" class="total">${escapeDocumentXml(rub(total))}</text>
      <line x1="38" x2="1200" y1="270" y2="270" stroke="#E2E4EA"/>
      <text x="38" y="312" class="label">ДОСТАВКА</text><text x="38" y="348" class="value">${escapeDocumentXml(order.deliveryMethod || "СДЭК")} · ${escapeDocumentXml(rub(deliveryPrice))}</text>
      <text x="410" y="312" class="label">АДРЕС</text>${compactAddressSvg}
      <text x="850" y="312" class="label">ОПЛАТА</text><text x="850" y="348" class="value">${escapeDocumentXml(paymentStatus)}</text>
      <rect x="38" y="398" width="1162" height="106" rx="16" fill="#FFFFFF" stroke="#E2E4EA"/>
      <text x="62" y="438" class="label">СЧЁТ И ДОКУМЕНТЫ ЗАКАЗА</text><text x="62" y="477" class="small">${escapeDocumentXml(paymentUrl)}</text>
      <text x="1170" y="466" text-anchor="end" class="small">Объявленная стоимость: ${escapeDocumentXml(rub(revenue))}</text>
    </svg>`;
    // Opaque JPEG avoids soft-mask/transparency layers that some office printer
    // drivers show in PDF preview but omit on paper.
    const compactSummaryJpg = await sharp(Buffer.from(compactSummarySvg))
      .flatten({ background: '#FFFFFF' })
      .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
      .toBuffer();

    const shouldIncludeCdekWaybill = Boolean(
      order.cdekUuid ||
      order.cdekNumber ||
      /сдэк|cdek/i.test(String(order.deliveryMethod || order.delivery || "")),
    );

    if (shouldIncludeCdekWaybill) {
      const cdekResult = await createCdekWaybillPdf(
        String(order.cdekUuid || ""),
        String(order.cdekPrintUuid || ""),
        orderId,
      );
      const printPatch = stripUndefined({
        cdekUuid: cdekResult.orderUuid,
        cdekNumber: cdekResult.cdekNumber || undefined,
        cdekPrintUuid: cdekResult.printUuid,
        cdekPrintCreatedAt: new Date().toISOString(),
        cdekPrintStatus: cdekResult.pending ? cdekResult.status || "PROCESSING" : "READY",
      });
      await persistOrderPatch(orderId, printPatch);
      if (cdekResult.pending || !cdekResult.pdf) {
        res.setHeader("Retry-After", "2");
        return res.status(202).json({
          pending: true,
          printUuid: cdekResult.printUuid,
          status: cdekResult.status || "PROCESSING",
          retryAfterMs: 2_000,
          message: "СДЭК готовит накладную. CRM продолжит ожидание автоматически.",
        });
      }
      const cdekPdf = cdekResult.pdf;
      const [embeddedCdekPage] = await pdfDocument.embedPdf(cdekPdf, [0]);
      const sourceSize = { width: embeddedCdekPage.width, height: embeddedCdekPage.height };
      const cdekPage = pdfDocument.addPage([sourceSize.width, sourceSize.height]);
      const summaryImage = await pdfDocument.embedJpg(compactSummaryJpg);
      // Render the original CDEK form and CRM order block into one new page.
      // This prevents printer drivers from dropping an appended PDF content layer.
      cdekPage.drawPage(embeddedCdekPage, {
        x: 0,
        y: 0,
        width: sourceSize.width,
        height: sourceSize.height,
      });
      const printMargin = 28.35; // 10 mm safe area for non-borderless A4 printers.
      const summaryWidth = sourceSize.width - printMargin * 2;
      const summaryHeight = summaryWidth * (560 / 1240);
      cdekPage.drawImage(summaryImage, {
        x: printMargin,
        y: printMargin,
        width: summaryWidth,
        height: summaryHeight,
      });
    } else {
      // Orders without CDEK keep the standalone CRM order document.
      const coverPage = pdfDocument.addPage([595.28, 841.89]);
      coverPage.drawImage(coverImage, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }

    const bytes = await pdfDocument.save();
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="YAASBAE-order-${safeOrderId}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(Buffer.from(bytes));
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[orders] document pdf error:", JSON.stringify(details, null, 2));
    return res.status(error.response?.status || 500).json({ error: "Не удалось сформировать комплект документов", details });
  }
});

app.get("/api/products/:id/image", async (req, res) => {
  const { id } = req.params;
  try {
    const productDoc = await getDoc(doc(db, "products", id));
    if (!productDoc.exists()) return res.status(404).send("Product not found");
    const product = productDoc.data();
    if (!product.photos || product.photos.length === 0) return res.status(404).send("No photos");
    const photoData = product.photos[0];
    if (photoData.startsWith("data:image")) {
      const matches = photoData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        res.set("Content-Type", matches[1]);
        return res.send(Buffer.from(matches[2], "base64"));
      }
    }
    if (photoData.startsWith("http")) {
      try {
        const parsed = new URL(photoData);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return res.status(400).send("Invalid image URL");
        }
      } catch {
        return res.status(400).send("Invalid image URL");
      }
      return res.redirect(photoData);
    }
    res.status(400).send("Invalid image data");
  } catch (error) {
    res.status(500).send("Internal server error");
  }
});

app.get("/api/chat/manychat", (req, res) => {
  res.send("ManyChat API is active. Use POST request to communicate. Version: 1.1");
});

// Simple in-memory rate limiter: max 20 requests per minute per user_id
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

function normalizeBroadcastPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

function normalizeCrmPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `7${digits}`;
  return digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

function toTelegramPhone(value: string): string {
  const normalized = normalizeBroadcastPhone(value);
  return normalized ? `+${normalized}` : "";
}

// API для получения списка товаров (для внешних проектов)
app.get("/api/products", async (req, res) => {
  try {
    const productsSnapshot = await getDocs(collection(db, "products"));
    const products = productsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.json({ success: true, products });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/broadcast/telegram", async (req, res) => {
  const { phones, message, apiLogin, apiPassword, imageBase64, imageName } = req.body;

  if (!phones?.length || !message || !apiLogin || !apiPassword) {
    return res.status(400).json({ error: "Не все поля заполнены" });
  }

  try {
    const credentials = Buffer.from(`${apiLogin}:${apiPassword}`).toString("base64");

    if (imageBase64 && imageName) {
      // Multipart запрос с картинкой
      const { default: FormData } = await import("form-data");
      const form = new FormData();
      form.append("type", "USERNAMES_PHONES");
      phones.forEach((p: string) => form.append("phones", p));
      form.append("message", message);
      const imgBuffer = Buffer.from(imageBase64, "base64");
      const ext = imageName.split(".").pop()?.toLowerCase() || "jpg";
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
      form.append("files[0]", imgBuffer, { filename: imageName, contentType: mime });
      const response = await axios.post("https://3seller.com/api/v1/distribution/start", form, {
        headers: { Authorization: `Basic ${credentials}`, ...form.getHeaders() }
      });
      res.json(response.data);
    } else {
      // JSON запрос без картинки
      const response = await axios.post(
        "https://3seller.com/api/v1/distribution/start-json",
        { type: "USERNAMES_PHONES", phones, message },
        { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" } }
      );
      res.json(response.data);
    }
  } catch (error: any) {
    const errData = error.response?.data || error.message;
    console.error("3seller error:", errData);
    res.status(500).json({ error: errData });
  }
});

app.get("/api/broadcast/status", async (req, res) => {
  const { id, apiLogin, apiPassword } = req.query as Record<string, string>;

  if (!id || !apiLogin || !apiPassword) {
    return res.status(400).json({ error: "Нет параметров" });
  }

  try {
    const credentials = Buffer.from(`${apiLogin}:${apiPassword}`).toString("base64");
    const response = await axios.get(
      `https://3seller.com/api/v1/distribution/status?id=${id}`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

function buildProxyOpts(acc: any) {
  if (!acc?.proxy?.ip) return {};
  return { proxy: { ip: acc.proxy.ip, port: Number(acc.proxy.port), username: acc.proxy.username || undefined, password: acc.proxy.password || undefined, socksType: 5 as const } };
}

function keepPendingTgLogin(phone: string, pending: PendingTgLogin) {
  pendingTgClients.set(phone, pending);
  setTimeout(() => {
    // An older attempt's timer must not erase a newer login attempt.
    if (pendingTgClients.get(phone) !== pending) return;
    pendingTgClients.delete(phone);
    pending.client.disconnect().catch(() => {});
  }, Math.max(0, pending.expiresAt - Date.now()));
}

function respondTgLoginError(res: express.Response, phone: string, error: any) {
  const result = telegramAuthError(error);
  if (result.restartRequired) {
    const pending = pendingTgClients.get(phone);
    pendingTgClients.delete(phone);
    pending?.client.disconnect().catch(() => {});
  }
  if (result.retryAfterSeconds) {
    tgLoginCooldowns.set(phone, Date.now() + result.retryAfterSeconds * 1000);
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
  }
  // Do not log the RPC object: it may contain the code, password or auth key.
  const rpcCode = String(error?.errorMessage || '');
  console.warn('[telegram-auth] request failed', { code: /^[A-Z_]+(?:_\d+)?$/.test(rpcCode) ? rpcCode : 'TRANSPORT_ERROR', status: result.status, retryAfterSeconds: result.retryAfterSeconds || 0 });
  return res.status(result.status).json(result);
}

app.post("/api/tg/auth/send-code", async (req, res) => {
  const phone = normalizeTelegramPhone(req.body?.phone);
  const purpose = req.body?.purpose === "manager" ? "manager" : "broadcast";
  if (!phone) return res.status(400).json({ error: "Укажите корректный номер телефона с кодом страны" });
  const cooldown = Math.ceil(((tgLoginCooldowns.get(phone) || 0) - Date.now()) / 1000);
  if (cooldown > 0) return res.status(429).json({ error: 'Telegram ограничил повторные запросы.', retryAfterSeconds: cooldown });
  if (pendingTgRequests.has(phone)) return res.status(409).json({ error: 'Запрос для этого номера уже выполняется. Дождитесь ответа.' });
  const existing = pendingTgClients.get(phone);
  if (existing && existing.expiresAt > Date.now()) {
    if (!existing.delivery.supported) return res.status(409).json({ error: existing.delivery.deliveryMessage });
    existing.purpose = purpose;
    return res.json({ success: true, phone, ...existing.delivery, reused: true });
  }
  pendingTgRequests.add(phone);
  let client: TelegramClient | undefined;
  let retained = false;
  try {
    client = new TelegramClient(new StringSession(""), TG_API_ID, TG_API_HASH, { connectionRetries: 3, floodSleepThreshold: 0 });
    await client.connect();
    // The convenience sendCode() drops type, nextType and timeout. Read the
    // actual Telegram response so CRM never guesses SMS/app/email delivery.
    const result = await client.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: TG_API_ID, apiHash: TG_API_HASH, settings: new Api.CodeSettings({}) }));
    if (!(result instanceof Api.auth.SentCode)) return res.status(409).json({ error: 'Telegram вернул другой сценарий входа. Подключение по коду не подтверждено.' });
    const delivery = telegramDelivery(result);
    console.info('[telegram-auth] code request result', { deliveryType: delivery.deliveryType, canResend: delivery.canResend });
    if (!delivery.supported) return res.status(409).json({ error: delivery.deliveryMessage });
    keepPendingTgLogin(phone, { client, phoneCodeHash: result.phoneCodeHash, purpose, delivery, expiresAt: Date.now() + 5 * 60_000 });
    retained = true;
    return res.json({ success: true, phone, ...delivery });
  } catch (e: any) {
    return respondTgLoginError(res, phone, e);
  } finally {
    pendingTgRequests.delete(phone);
    if (client && !retained) await client.disconnect().catch(() => {});
  }
});

app.post("/api/tg/auth/resend-code", async (req, res) => {
  const phone = normalizeTelegramPhone(req.body?.phone);
  const pending = pendingTgClients.get(phone);
  if (!pending || pending.expiresAt <= Date.now()) return res.status(400).json({ error: 'Сессия подключения истекла или сервер перезапустился. Начните заново.', restartRequired: true });
  if (pendingTgRequests.has(phone)) return res.status(409).json({ error: 'Запрос уже выполняется. Дождитесь ответа.' });
  const retryAfterSeconds = Math.ceil((Math.max(pending.delivery.resendAt, tgLoginCooldowns.get(phone) || 0) - Date.now()) / 1000);
  if (retryAfterSeconds > 0) return res.status(429).json({ error: 'Telegram ещё не разрешил повторный запрос.', retryAfterSeconds });
  if (!pending.delivery.canResend) return res.status(409).json({ error: 'Telegram не предложил другой способ доставки. Принудительная отправка SMS недоступна.' });
  pendingTgRequests.add(phone);
  try {
    const result = await pending.client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash: pending.phoneCodeHash }));
    if (!(result instanceof Api.auth.SentCode)) return res.status(409).json({ error: 'Telegram не подтвердил повторную отправку кода.' });
    const delivery = telegramDelivery(result);
    // Save the replacement hash even when Telegram chooses an unsupported flow.
    keepPendingTgLogin(phone, { ...pending, phoneCodeHash: result.phoneCodeHash, delivery, expiresAt: Date.now() + 5 * 60_000 });
    console.info('[telegram-auth] resend result', { deliveryType: delivery.deliveryType, canResend: delivery.canResend });
    if (!delivery.supported) {
      pendingTgClients.delete(phone);
      await pending.client.disconnect().catch(() => {});
      return res.status(409).json({ error: delivery.deliveryMessage, restartRequired: true });
    }
    return res.json({ success: true, phone, ...delivery });
  } catch (e: any) {
    return respondTgLoginError(res, phone, e);
  } finally {
    pendingTgRequests.delete(phone);
  }
});

app.post("/api/tg/auth/sign-in", async (req, res) => {
  const phone = normalizeTelegramPhone(req.body?.phone);
  const { code, twoFaPassword } = req.body;
  const cooldown = Math.ceil(((tgLoginCooldowns.get(phone) || 0) - Date.now()) / 1000);
  if (cooldown > 0) return res.status(429).json({ error: 'Telegram ограничил повторные попытки входа.', retryAfterSeconds: cooldown });
  const pending = pendingTgClients.get(phone);
  if (!pending || pending.expiresAt <= Date.now()) return res.status(400).json({ error: "Сессия подключения истекла или сервер перезапустился. Начните заново.", restartRequired: true });
  if (pendingTgRequests.has(phone)) return res.status(409).json({ error: 'Запрос уже выполняется. Дождитесь ответа.' });
  pendingTgRequests.add(phone);
  const { client, phoneCodeHash, purpose } = pending as any;
  try {
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
    } catch (e: any) {
      const needs2FA = e.errorMessage === "SESSION_PASSWORD_NEEDED" ||
        e.message?.includes("SESSION_PASSWORD_NEEDED");
      if (needs2FA) {
        if (!twoFaPassword) return res.json({ requires2FA: true });
        const { computeCheck } = await import("telegram/Password");
        const passwordSrp = await client.invoke(new Api.account.GetPassword());
        const inputCheck = await computeCheck(passwordSrp as any, twoFaPassword);
        await client.invoke(new Api.auth.CheckPassword({ password: inputCheck }));
      } else {
        throw e;
      }
    }
    const sessionString = client.session.save() as unknown as string;
    await upsertTgAccount({
      phone,
      sessionString,
      addedAt: new Date().toISOString(),
      active: true,
      ...(purpose === "manager" ? { inboxEnabled: true, purpose: "manager" } : {}),
    });
    pendingTgClients.delete(phone);
    await client.disconnect().catch(() => {});
    res.json({ success: true, phone });
  } catch (e: any) {
    if (String(e.errorMessage || e.message).includes('PHONE_CODE_EXPIRED')) {
      pendingTgClients.delete(phone);
      await client.disconnect().catch(() => {});
    }
    return respondTgLoginError(res, phone, e);
  } finally {
    pendingTgRequests.delete(phone);
  }
});

app.get("/api/tg/auth/status", async (req, res) => {
  try {
    const accounts = (await readTgAccounts()).filter((a: any) => a.sessionString);
    // Fallback: old single session
    if (accounts.length === 0) {
      const old = await getDoc(doc(db, "settings", "tg_session"));
      if (old.exists() && old.data().sessionString) {
        accounts.push({ phone: old.data().phone, addedAt: old.data().savedAt, active: true });
      }
    }
    const pub = accounts.map((a: any) => ({ phone: a.phone, addedAt: a.addedAt, active: a.active !== false, proxy: a.proxy || null, inboxEnabled: a.inboxEnabled === true, purpose: a.purpose || "broadcast" }));
    res.json({ authorized: accounts.length > 0, accounts: pub });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/accounts/add-session", async (req, res) => {
  const { sessionString } = req.body;
  if (!sessionString) return res.status(400).json({ error: "Нужна строка сессии" });
  try {
    const client = new TelegramClient(new StringSession(sessionString.trim()), TG_API_ID, TG_API_HASH, {
      connectionRetries: 3,
    });
    await client.connect();
    const me = await client.getMe() as any;
    const phone = me.phone ? `+${me.phone}` : (me.username ? `@${me.username}` : `id${me.id}`);
    await client.disconnect();
    await upsertTgAccount({ phone, sessionString: sessionString.trim(), addedAt: new Date().toISOString(), active: true });
    res.json({ success: true, phone });
  } catch (e: any) {
    console.error("add-session error:", e);
    res.status(400).json({ error: "Сессия недействительна: " + e.message });
  }
});

app.post("/api/tg/accounts/bulk-add-sessions", async (req, res) => {
  const { sessions } = req.body; // string[]
  if (!sessions?.length) return res.status(400).json({ error: "Нужен массив sessions" });
  const existing: any[] = await readTgAccounts();
  const added: string[] = [], failed: string[] = [];
  for (const sessionString of sessions) {
    const s = sessionString.trim();
    if (!s) continue;
    try {
      const client = new TelegramClient(new StringSession(s), TG_API_ID, TG_API_HASH, { connectionRetries: 2 });
      await client.connect();
      const me = await client.getMe();
      const phone = (me as any).phone ? `+${(me as any).phone}` : `id${(me as any).id}`;
      await client.disconnect();
      if (!existing.find((a: any) => a.phone === phone)) {
        existing.push({ phone, sessionString: s, addedAt: new Date().toISOString(), active: true });
        added.push(phone);
      }
    } catch (e: any) {
      failed.push(s.slice(0, 20) + "...");
    }
  }
  await saveTgAccounts(existing);
  res.json({ success: true, added: added.length, failed: failed.length, addedPhones: added });
});

app.post("/api/tg/accounts/upload-session-file", async (req, res) => {
  const { fileBase64, fileName } = req.body;
  if (!fileBase64) return res.status(400).json({ error: "Нужен файл" });
  let tmpPath: string | null = null;
  try {
    const fileBuffer = Buffer.from(fileBase64, "base64");
    const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
    let sessionString: string;

    if (fileBuffer.slice(0, 16).equals(SQLITE_MAGIC)) {
      // Telethon or Pyrogram .session (SQLite)
      tmpPath = path.join(tmpdir(), `tg_${randomBytes(8).toString("hex")}.session`);
      fs.writeFileSync(tmpPath, fileBuffer);
      const sqliteDb = new Database(tmpPath, { readonly: true });
      let row: any = null;
      let serverAddress: string;
      let port: number;
      try {
        // Telethon format
        row = sqliteDb.prepare("SELECT dc_id, server_address, port, auth_key FROM sessions WHERE auth_key IS NOT NULL ORDER BY dc_id DESC LIMIT 1").get();
        if (row) {
          serverAddress = row.server_address;
          port = row.port;
        }
      } catch {}
      if (!row) {
        // Pyrogram format (no server_address column)
        row = sqliteDb.prepare("SELECT dc_id, auth_key FROM sessions WHERE auth_key IS NOT NULL ORDER BY rowid DESC LIMIT 1").get();
        if (row) {
          serverAddress = TG_DC_SERVERS[row.dc_id] || TG_DC_SERVERS[4];
          port = 443;
        }
      }
      sqliteDb.close();
      if (!row) throw new Error("Сессия не найдена в .session файле");
      const authKey = Buffer.isBuffer(row.auth_key) ? row.auth_key : Buffer.from(row.auth_key);
      sessionString = telethonSessionToStringSession(row.dc_id, serverAddress!, port!, authKey);
    } else {
      // JSON format
      const json = JSON.parse(fileBuffer.toString("utf-8"));

      // Helper: try to extract StringSession from a single session object
      function extractFromSessionObj(obj: any): string | null {
        // Ready StringSession string in various field names
        const ready = obj.string || obj.session || obj.session_string || obj.string_session || obj.auth_string || obj.tg_session;
        if (ready && typeof ready === "string" && ready.length > 50) return ready;
        // Raw auth_key + dc_id
        const rawKey = obj.auth_key || obj.authKey || obj.key;
        if (rawKey) {
          const dcId: number = obj.dc_id || obj.dc || 4;
          const authKey = typeof rawKey === "string"
            ? Buffer.from(rawKey, rawKey.length === 512 ? "hex" : "base64")
            : Buffer.from(Object.values(rawKey) as number[]);
          const serverAddress: string = obj.server || obj.server_address || TG_DC_SERVERS[dcId] || TG_DC_SERVERS[4];
          const port: number = obj.port || 443;
          return telethonSessionToStringSession(dcId, serverAddress, port, authKey);
        }
        return null;
      }

      // Try root object first
      let extracted = extractFromSessionObj(json);

      // Try json.sessions (array or single object from seller export)
      if (!extracted && json.sessions) {
        const sessArr = Array.isArray(json.sessions) ? json.sessions : [json.sessions];
        for (const s of sessArr) {
          const r = typeof s === "string" ? (s.length > 50 ? s : null) : extractFromSessionObj(s);
          if (r) { extracted = r; break; }
        }
      }

      if (!extracted) {
        const keys = Object.keys(json).join(", ");
        throw new Error(`Неизвестный формат JSON. Поля: ${keys}`);
      }
      sessionString = extracted;
    }

    // Validate with gramjs
    const tgClient = new TelegramClient(new StringSession(sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3 });
    await tgClient.connect();
    const me = await tgClient.getMe() as any;
    const phone = me.phone ? `+${me.phone}` : (me.username ? `@${me.username}` : `id${me.id}`);
    await tgClient.disconnect();

    await upsertTgAccount({ phone, sessionString, addedAt: new Date().toISOString(), active: true });
    res.json({ success: true, phone });
  } catch (e: any) {
    console.error("upload-session-file error:", e);
    res.status(400).json({ error: "Не удалось загрузить сессию: " + e.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

app.get("/api/tg/broadcast/config", async (req, res) => {
  try {
    if (!db) return res.json({});
    const snap = await getDoc(doc(db, "settings", "broadcast_config"));
    res.json(snap.exists() ? snap.data() : {});
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/broadcast/config", async (req, res) => {
  const { displayName } = req.body;
  try {
    if (db) await setDoc(doc(db, "settings", "broadcast_config"), { displayName }, { merge: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/accounts/remove", async (req, res) => {
  const { phone } = req.body;
  try {
    const accounts = await readTgAccounts();
    await saveTgAccounts(accounts.filter((a: any) => a.phone !== phone));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/accounts/set-active", async (req, res) => {
  const { phone, active, onlyThis } = req.body;
  try {
    const accounts = await readTgAccounts();
    const updated = accounts.map((a: any) => {
      if (onlyThis) return { ...a, active: a.phone === phone };
      return a.phone === phone ? { ...a, active: !!active } : a;
    });
    await saveTgAccounts(updated);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/accounts/set-proxy", async (req, res) => {
  const { phone, proxy } = req.body;
  try {
    const accounts = await readTgAccounts();
    const updated = accounts.map((a: any) => a.phone === phone ? { ...a, proxy: proxy || null } : a);
    await saveTgAccounts(updated);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/accounts/set-photo", async (req, res) => {
  const { photoBase64 } = req.body;
  if (!photoBase64) return res.status(400).json({ error: "Нужен photoBase64" });
  if (!db) return res.status(500).json({ error: "DB not connected" });
  try {
    const accounts = (await readTgAccounts()).filter((a: any) => a.sessionString && a.active !== false);
    if (accounts.length === 0) return res.status(400).json({ error: "Нет активных аккаунтов" });
    const { CustomFile } = await import("telegram/client/uploads");
    const buf = Buffer.from(photoBase64, "base64");
    let ok = 0, failed = 0;
    for (const acc of accounts) {
      try {
        const c = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3, autoReconnect: false, ...buildProxyOpts(acc) });
        await c.connect();
        const uploaded = await c.uploadFile({ file: new CustomFile("photo.jpg", buf.length, "", buf), workers: 1 });
        await c.invoke(new Api.photos.UploadProfilePhoto({ file: uploaded }));
        await c.disconnect().catch(() => {});
        ok++;
      } catch { failed++; }
    }
    res.json({ success: true, ok, failed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const tgInboxClients = new Map<string, TelegramClient>();

async function getTelegramInboxAccount(phone: string) {
  const accounts = (await readTgAccounts()).filter((account: any) => account.sessionString && account.active !== false && account.inboxEnabled === true);
  const account = accounts.find((item: any) => String(item.phone) === String(phone));
  if (!account) throw new Error(`Telegram-аккаунт ${phone} не найден или выключен`);
  return account;
}

async function getTelegramInboxClient(account: any) {
  const key = String(account.phone || "");
  const cached = tgInboxClients.get(key);
  if (cached) {
    try {
      if (!(cached as any).connected) await cached.connect();
      return cached;
    } catch {
      await cached.disconnect().catch(() => {});
      tgInboxClients.delete(key);
    }
  }
  const client = new TelegramClient(new StringSession(account.sessionString), TG_API_ID, TG_API_HASH, {
    connectionRetries: 3,
    autoReconnect: true,
    ...buildProxyOpts(account),
  });
  await client.connect();
  tgInboxClients.set(key, client);
  return client;
}

function telegramInboxDate(value: any) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const numeric = Number(value);
  const parsed = numeric > 0 ? new Date(numeric * 1000) : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function telegramInboxPeer(dialog: any) {
  const entity: any = dialog?.entity || {};
  const peerId = String(entity?.id ?? dialog?.id ?? "");
  const name = [entity?.firstName, entity?.lastName].filter(Boolean).join(" ") || entity?.username || dialog?.title || `Telegram ${peerId}`;
  return { entity, peerId, name, username: entity?.username || "" };
}

app.get("/api/tg-inbox/conversations", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  const accounts = (await readTgAccounts()).filter((account: any) => account.sessionString && account.active !== false && account.inboxEnabled === true);
  const groups = await Promise.all(accounts.map(async (account: any) => {
    try {
      const client = await getTelegramInboxClient(account);
      const dialogs: any[] = await client.getDialogs({ limit: Math.min(100, Math.max(10, Number(req.query.limit || 60))) }) as any;
      return dialogs.flatMap((dialog: any) => {
        const { entity, peerId, name, username } = telegramInboxPeer(dialog);
        const className = String(entity?.className || "");
        const isPerson = className === "User" || Boolean(entity?.firstName || entity?.lastName || entity?.phone);
        if (!peerId || !isPerson || entity?.self) return [];
        const message: any = dialog?.message || {};
        return [{
          id: `${encodeURIComponent(String(account.phone))}:${peerId}`,
          channel: "telegram_account",
          accountPhone: String(account.phone || ""),
          peerId,
          name,
          username,
          updatedAt: telegramInboxDate(message?.date || dialog?.date),
          unreadCount: Number(dialog?.unreadCount || 0),
          lastMessage: {
            id: String(message?.id || ""),
            text: String(message?.message || ""),
            createdAt: telegramInboxDate(message?.date || dialog?.date),
            direction: message?.out ? "outgoing" : "incoming",
          },
        }];
      });
    } catch (error: any) {
      console.warn(`[tg-inbox] ${account.phone}:`, error?.message || error);
      return [];
    }
  }));
  const conversations = groups.flat().sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ conversations, accounts: accounts.map((account: any) => ({ phone: account.phone })) });
});

async function telegramInboxEntity(client: TelegramClient, peerId: string) {
  const dialogs: any[] = await client.getDialogs({ limit: 150 }) as any;
  const dialog = dialogs.find((item: any) => String(item?.entity?.id ?? item?.id ?? "") === String(peerId));
  if (!dialog?.entity) throw new Error("Диалог Telegram не найден");
  return dialog.entity;
}

app.get("/api/tg-inbox/messages", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  try {
    const accountPhone = String(req.query.accountPhone || "");
    const peerId = String(req.query.peerId || "");
    if (!accountPhone || !peerId) return res.status(400).json({ error: "Нужны accountPhone и peerId" });
    const account = await getTelegramInboxAccount(accountPhone);
    const client = await getTelegramInboxClient(account);
    const entity = await telegramInboxEntity(client, peerId);
    const rows: any[] = await client.getMessages(entity, { limit: 100 }) as any;
    const messages = rows.map((message: any) => ({
      id: String(message?.id || ""),
      text: String(message?.message || ""),
      createdAt: telegramInboxDate(message?.date),
      direction: message?.out ? "outgoing" : "incoming",
      attachments: message?.media ? [{ type: String(message.media?.className || "media") }] : [],
    })).reverse();
    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Не удалось загрузить Telegram" });
  }
});

app.post("/api/tg-inbox/messages", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  try {
    const accountPhone = String(req.body?.accountPhone || "");
    const peerId = String(req.body?.peerId || "");
    const text = String(req.body?.text || "").trim();
    if (!accountPhone || !peerId || !text) return res.status(400).json({ error: "Нужны аккаунт, диалог и текст" });
    const account = await getTelegramInboxAccount(accountPhone);
    const client = await getTelegramInboxClient(account);
    const entity = await telegramInboxEntity(client, peerId);
    const sent: any = await client.sendMessage(entity, { message: text });
    res.json({ message: { id: String(sent?.id || `local-${Date.now()}`), text, createdAt: telegramInboxDate(sent?.date), direction: "outgoing" } });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Не удалось отправить Telegram" });
  }
});

// Фоновая проверка наличия Telegram — запускается на сервере, не зависит от браузера
let tgCheckJob: { status: 'idle' | 'running' | 'done' | 'error'; total: number; checked: number; noTgFound: number; startedAt: string; finishedAt?: string; error?: string } = {
  status: 'idle', total: 0, checked: 0, noTgFound: 0, startedAt: ''
};

async function runTgCheckJob(phones: string[]) {
  if (!db) return;
  tgCheckJob = { status: 'running', total: phones.length, checked: 0, noTgFound: 0, startedAt: new Date().toISOString() };
  await setDoc(doc(db, 'settings', 'tg_check_job'), { ...tgCheckJob }).catch(() => {});
  let client: TelegramClient | null = null;
  try {
    const accounts = (await readTgAccounts()).filter((a: any) => a.sessionString && a.active !== false);
    if (!accounts.length) throw new Error('Нет активных аккаунтов');

    client = new TelegramClient(new StringSession(accounts[0].sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3, ...buildProxyOpts(accounts[0]) });
    await client.connect();

    const noTgSnap = await getDoc(doc(db, 'settings', 'no_telegram')).catch(() => null);
    const existingNoTg: Array<{ phone: string; addedAt: string }> = noTgSnap?.exists() ? (noTgSnap.data().phones || []) : [];
    const existingSet = new Set(existingNoTg.map((p: any) => p.phone));
    const newNoTg: Array<{ phone: string; addedAt: string }> = [];
    const now = new Date().toISOString();

    for (let i = 0; i < phones.length; i++) {
      const rawPhone = phones[i];
      const digits = String(rawPhone).replace(/\D/g, '');
      const phone = digits.length === 11 && digits.startsWith('8') ? `+7${digits.slice(1)}` : (String(rawPhone).startsWith('+') ? String(rawPhone) : `+${digits}`);
      const cleanPhone = digits;
      let hasTg = false;
      try {
        const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch(() => null) as any;
        hasTg = !!(resolved?.users?.[0]);
        if (!hasTg) {
          const imported = await client.invoke(new Api.contacts.ImportContacts({
            contacts: [new Api.InputPhoneContact({ clientId: BigInt(i + 1) as any, phone, firstName: 'U', lastName: '' })]
          })).catch(() => null) as any;
          const userId = imported?.importedContacts?.[0]?.userId;
          hasTg = !!(imported?.users?.[0]) || (userId && Number(userId) > 0);
        }
      } catch {}

      if (!hasTg && !existingSet.has(cleanPhone)) {
        existingSet.add(cleanPhone);
        newNoTg.push({ phone: cleanPhone, addedAt: now });
        tgCheckJob.noTgFound++;
      }
      tgCheckJob.checked = i + 1;

      // Сохраняем прогресс и накопленные номера каждые 50 проверок
      if ((i + 1) % 50 === 0 || i === phones.length - 1) {
        await setDoc(doc(db, 'settings', 'tg_check_job'), { ...tgCheckJob }).catch(() => {});
        if (newNoTg.length > 0) {
          await setDoc(doc(db, 'settings', 'no_telegram'), { phones: [...existingNoTg, ...newNoTg] }).catch(() => {});
        }
      }
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
    }
    await client.disconnect().catch(() => {});
    tgCheckJob.status = 'done';
    tgCheckJob.finishedAt = new Date().toISOString();
    await setDoc(doc(db, 'settings', 'tg_check_job'), { ...tgCheckJob }).catch(() => {});
  } catch (e: any) {
    await client?.disconnect().catch(() => {});
    tgCheckJob.status = 'error';
    tgCheckJob.error = e.message;
    tgCheckJob.finishedAt = new Date().toISOString();
    await setDoc(doc(db, 'settings', 'tg_check_job'), { ...tgCheckJob }).catch(() => {});
  }
}

// Генерация 9 вариантов сообщения через Claude
app.post('/api/ai/generate-variants', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Нужен message' });

  const prompt = `Перепиши это сообщение 9 разными способами для рассылки клиентам. Сохрани смысл, эмодзи и стиль, но измени структуру и формулировки чтобы каждый вариант был уникальным. Отвечай ТОЛЬКО пронумерованным списком 1-9, каждый вариант с новой строки, без пояснений:\n\n${message}`;

  let geminiKey: string | null = process.env.GEMINI_API_KEY || null;
  let claudeKey: string | null = process.env.ANTHROPIC_API_KEY || null;
  if (db) {
    const cfg = await getDoc(doc(db, 'settings', 'ai_config')).catch(() => null);
    if (cfg?.exists()) {
      if (cfg.data().geminiKey) geminiKey = cfg.data().geminiKey;
      if (cfg.data().claudeKey) claudeKey = cfg.data().claudeKey;
    }
  }

  const parseVariants = (text: string) => {
    const numbered = text.split('\n')
      .filter(l => /^\d+[.)]\s/.test(l.trim()))
      .map(l => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    if (numbered.length > 0) return numbered.slice(0, 9);
    return text.split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 9);
  };

  try {
    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const result = await ai.models.generateContent({
          model: GEMINI_TEXT_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const variants = parseVariants(text);
        if (!variants.length) throw new Error('AI вернул пустой список вариантов');
        return res.json({ success: true, variants, engine: 'gemini' });
      } catch (geminiError: any) {
        if (!claudeKey) {
          const message = String(geminiError?.message || geminiError);
          if (message.includes('User location is not supported')) {
            throw new Error('Gemini не работает с текущего IP/локации. Включи VPN/прокси для Google API или добавь Claude ключ.');
          }
          throw geminiError;
        }
        console.warn('[ai/generate-variants] Gemini failed, trying Claude:', geminiError?.message || geminiError);
      }
    }
    if (claudeKey) {
      const anthropic = new Anthropic({ apiKey: claudeKey });
      const result = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      const variants = parseVariants(text);
      if (!variants.length) throw new Error('AI вернул пустой список вариантов');
      return res.json({ success: true, variants, engine: 'claude' });
    }
    throw new Error('Нет API ключа — добавь Gemini или Claude ключ в Настройках рассылки');
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Фоновая рассылка: 1 аккаунт → до 20 номеров → выбранная пауза между отправками → следующий аккаунт
type StealthJobStatus = 'idle'|'running'|'sleeping'|'waiting_accounts'|'stopped'|'done'|'error';
let stealthJob: {
  status: StealthJobStatus;
  total: number; sent: number; failed: number; checked: number; currentIndex: number;
  currentAccount: string;
  delayMinutes?: number;
  activeFromHour?: number;
  activeToHour?: number;
  wakeAt?: string;
  startedAt: string; finishedAt?: string; error?: string;
  stopRequested: boolean;
  log: Array<{phone:string;name:string;status:string;error?:string;account?:string}>;
} = {
  status: 'idle', total: 0, sent: 0, failed: 0, checked: 0, currentIndex: 0,
  currentAccount: '', delayMinutes: 2, activeFromHour: 8, activeToHour: 21, startedAt: '', stopRequested: false, log: []
};

const saveStealthProgress = async () => {
  if (!db) return;
  await setDoc(doc(db, 'settings', 'stealth_job'), { ...stealthJob, log: stealthJob.log.slice(-500) }).catch(() => {});
};

const MOSCOW_TZ = 'Europe/Moscow';

function getMoscowMinutesOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function msUntilMoscowHour(hour: number) {
  const currentMinutes = getMoscowMinutesOfDay();
  const targetMinutes = hour * 60;
  const minutesUntil = currentMinutes < targetMinutes
    ? targetMinutes - currentMinutes
    : (24 * 60 - currentMinutes) + targetMinutes;
  return minutesUntil * 60 * 1000;
}

async function waitForBroadcastWindow(activeFromHour = 8, activeToHour = 21) {
  const fromMinutes = activeFromHour * 60;
  const toMinutes = activeToHour * 60;

  while (!stealthJob.stopRequested) {
    const currentMinutes = getMoscowMinutesOfDay();
    if (currentMinutes >= fromMinutes && currentMinutes < toMinutes) {
      if (stealthJob.status === 'sleeping') {
        stealthJob.status = 'running';
        stealthJob.wakeAt = undefined;
        await saveStealthProgress();
      }
      return;
    }

    const waitMs = msUntilMoscowHour(activeFromHour);
    stealthJob.status = 'sleeping';
    stealthJob.wakeAt = new Date(Date.now() + waitMs).toISOString();
    await saveStealthProgress();
    console.log(`[stealth] outside send window ${activeFromHour}:00-${activeToHour}:00 MSK, sleeping ${Math.ceil(waitMs / 60000)} min`);

    const waitSteps = Math.ceil(waitMs / 30000);
    for (let w = 0; w < waitSteps && !stealthJob.stopRequested; w++) {
      await new Promise(r => setTimeout(r, Math.min(30000, waitMs - w * 30000)));
    }
  }
}

async function runStealthBroadcast(phones: string[], messageVariants: string[], contactButton: boolean, imageFiles: Array<{base64:string;name:string}>, startFrom = 0, delayMinutes = 2, activeFromHour = 8, activeToHour = 21, displayName = "") {
  if (!db) return;

  const MESSAGES_PER_ACCOUNT = 20;
  const CONTACT_LOOKUP_DELAY_MS = 2000;
  const MAX_NO_TG_STREAK = 30;
  const safeDelayMinutes = [2, 5, 10].includes(Number(delayMinutes)) ? Number(delayMinutes) : 2;
  const safeActiveFromHour = Number.isFinite(Number(activeFromHour)) ? Math.min(23, Math.max(0, Number(activeFromHour))) : 8;
  const safeActiveToHour = Number.isFinite(Number(activeToHour)) ? Math.min(24, Math.max(1, Number(activeToHour))) : 21;
  const DELAY_BETWEEN_SENDS = safeDelayMinutes * 60 * 1000;

  if (startFrom === 0) {
    stealthJob = { status: 'running', total: phones.length, sent: 0, failed: 0, checked: 0, currentIndex: 0, currentAccount: '', delayMinutes: safeDelayMinutes, activeFromHour: safeActiveFromHour, activeToHour: safeActiveToHour, startedAt: new Date().toISOString(), stopRequested: false, log: [] };
    await setDoc(doc(db, 'settings', 'stealth_job_data'), { phones, messageVariants, contactButton, imageFiles, delayMinutes: safeDelayMinutes, activeFromHour: safeActiveFromHour, activeToHour: safeActiveToHour, displayName: normalizeBroadcastDisplayName(displayName) }).catch((e) => {
      console.warn('[stealth] could not persist job data:', e?.message || e);
    });
  } else {
    stealthJob.status = 'running';
    stealthJob.stopRequested = false;
    stealthJob.currentIndex = startFrom;
    stealthJob.delayMinutes = safeDelayMinutes;
    stealthJob.activeFromHour = safeActiveFromHour;
    stealthJob.activeToHour = safeActiveToHour;
    stealthJob.wakeAt = undefined;
  }
  await saveStealthProgress();

  // Загрузка аккаунтов
  const accounts: any[] = (await readTgAccounts()).filter((a: any) => a.sessionString && a.active !== false);
  if (!accounts.length) { stealthJob.status = 'waiting_accounts'; await saveStealthProgress(); return; }

  const configSnap = await getDoc(doc(db, 'settings', 'broadcast_config')).catch(() => null);
  const broadcastDisplayName = normalizeBroadcastDisplayName(displayName || (configSnap?.exists() ? configSnap.data()?.displayName : ""));

  // Загружаем no_telegram
  const noTgSnap = await getDoc(doc(db, 'settings', 'no_telegram')).catch(() => null);
  const savedNoTg: Array<{phone:string;addedAt:string}> = noTgSnap?.exists() ? (noTgSnap.data().phones || []) : [];
  const noTgSet = new Set(savedNoTg.map((p:any) => normalizeBroadcastPhone(p.phone)));
  const newNoTg: Array<{phone:string;addedAt:string}> = [];

  // Загружаем уже отправленные
  const sentSnap = await getDoc(doc(db, 'settings', 'stealth_sent')).catch(() => null);
  const ALWAYS_TESTABLE = new Set(['79196977790', '79991640290']);
  const savedSentArr: Array<any> = sentSnap?.exists() ? (sentSnap.data().phones || []) : [];
  const sentSet = new Set<string>();
  const sentDateMap = new Map<string, string>();
  savedSentArr.forEach((p: any) => {
    const raw = typeof p === 'string' ? p : p?.phone;
    if (!raw) return;
    const ph = normalizeBroadcastPhone(raw);
    if (!ALWAYS_TESTABLE.has(ph)) {
      sentSet.add(ph);
      if (typeof p === 'object' && p.sentAt) sentDateMap.set(ph, p.sentAt);
    }
  });
  const newSent: string[] = [];

  const markAccountDead = async (acc: any) => {
    const allAccs = await readTgAccounts().catch(() => []);
    if (allAccs.length) {
      await saveTgAccounts(allAccs.map((a:any) => a.phone === acc.phone ? {...a, active: false, bannedAt: new Date().toISOString()} : a)).catch(() => {});
    }
  };

  const saveNoTgAndSent = async () => {
    if (newNoTg.length > 0) await setDoc(doc(db!, 'settings', 'no_telegram'), { phones: [...savedNoTg, ...newNoTg] }).catch(() => {});
    if (newSent.length > 0) {
      const sentArr = Array.from(sentSet).map(p => ({ phone: p, sentAt: sentDateMap.get(p) || new Date().toISOString() }));
      await setDoc(doc(db!, 'settings', 'stealth_sent'), { phones: sentArr }).catch(() => {});
    }
  };

  let phoneIdx = startFrom;
  const deadAccounts = new Set<string>(); // навсегда мёртвые (AUTH_KEY и тд)
  const limitedAccounts = new Set<string>(); // временно упёрлись в PEER_FLOOD в этой рассылке
  let roundIdx = 0;
  const phoneFloodTries = new Map<number, number>(); // phoneIdx → кол-во PEER_FLOOD попыток
  const lastSentAtByAccount = new Map<string, number>();
  let noTgStreak = 0;
  let sentVariantIndex = stealthJob.sent || 0;
  let lastSuccessfulSendAt = 0;
  const isTelegramNetworkError = (err: string) => {
    const upper = String(err || '').toUpperCase();
    return upper.includes('TIMEOUT') || upper.includes('NETWORK') || upper.includes('CONNECTION') || upper.includes('ECONNRESET');
  };
  const pauseForTelegramLookupError = async (rawPhone: string, error: string, account?: string) => {
    stealthJob.status = 'waiting_accounts';
    stealthJob.log.push({
      phone: rawPhone,
      name: rawPhone,
      status: 'error',
      error: `Telegram не ответил при проверке номера: ${error || 'timeout'}`,
      account
    });
    await saveStealthProgress();
  };

  while (phoneIdx < phones.length && !stealthJob.stopRequested) {
    await waitForBroadcastWindow(safeActiveFromHour, safeActiveToHour);
    if (stealthJob.stopRequested) break;

    const availableAccountCount = accounts.filter(a => !deadAccounts.has(a.phone)).length;
    const liveAccounts = accounts.filter(a => !deadAccounts.has(a.phone) && !limitedAccounts.has(a.phone));
    if (!liveAccounts.length) break; // все аккаунты мёртвые

    const acc = liveAccounts[roundIdx % liveAccounts.length];
    roundIdx++;
    stealthJob.currentAccount = acc.phone || '';

    // Подключаем аккаунт
    const client = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3, autoReconnect: false, ...buildProxyOpts(acc) });
    await client.connect().catch(() => {});
    if (broadcastDisplayName) {
      const parts = broadcastDisplayName.trim().split(' ');
      await client.invoke(new Api.account.UpdateProfile({ firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' })).catch(() => {});
    }

    let sentByThisAccount = 0;
    let accountBanned = false;

    while (sentByThisAccount < MESSAGES_PER_ACCOUNT && phoneIdx < phones.length) {
      if (stealthJob.stopRequested) break;

      // Пауза действует между отправками одного и того же аккаунта.
      const accountKey = acc.phone || String(roundIdx);
      const lastSentAt = lastSentAtByAccount.get(accountKey) || 0;
      const waitMs = Math.max(0, DELAY_BETWEEN_SENDS - (Date.now() - lastSentAt));
      if (waitMs > 0 && !stealthJob.stopRequested) {
        console.log(`[stealth] ${acc.phone} waiting ${Math.ceil(waitMs / 60000)} min before next send from same account`);
        const waitSteps = Math.ceil(waitMs / 10000);
        for (let w = 0; w < waitSteps && !stealthJob.stopRequested; w++) {
          await new Promise(r => setTimeout(r, Math.min(10000, waitMs - w * 10000)));
        }
      }
      if (stealthJob.stopRequested) break;

      const rawPhone = String(phones[phoneIdx]);
      const cleanPhone = normalizeBroadcastPhone(rawPhone);
      const phone = toTelegramPhone(rawPhone);

      stealthJob.currentIndex = phoneIdx;

      // Пропускаем уже отправленные
      if (sentSet.has(cleanPhone)) {
        phoneIdx++;
        stealthJob.checked++;
        stealthJob.currentIndex = phoneIdx;
        await saveStealthProgress();
        continue;
      }

      try {
        let resolveErr = '';
        let importErr = '';
        const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch((e:any) => { resolveErr = e?.message||String(e); return null; }) as any;
        let entity = resolved?.users?.[0] ?? null;

        // Мёртвый/заблокированный аккаунт (PEER_FLOOD = рейт-лимит, не бан — просто пробуем следующий аккаунт)
        const isTrulyDead = resolveErr.includes('AUTH_KEY_UNREGISTERED') || resolveErr.includes('USER_DEACTIVATED') || resolveErr.includes('SESSION_REVOKED');
        if (isTrulyDead) {
          console.log(`[stealth] account ${acc.phone} dead: ${resolveErr}`);
          await markAccountDead(acc);
          deadAccounts.add(acc.phone);
          accountBanned = true;
          break;
        }
        if (resolveErr.includes('PEER_FLOOD')) {
          console.log(`[stealth] account ${acc.phone} PEER_FLOOD on resolve, switching account`);
          limitedAccounts.add(acc.phone);
          const tries = (phoneFloodTries.get(phoneIdx) || 0) + 1;
          phoneFloodTries.set(phoneIdx, tries);
          if (tries >= availableAccountCount) {
            console.log(`[stealth] all accounts PEER_FLOOD at index ${phoneIdx}, pausing job`);
            stealthJob.status = 'waiting_accounts';
            stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: 'Все аккаунты упёрлись в лимит Telegram', account: acc.phone });
            await saveStealthProgress();
            accountBanned = true;
            break;
          }
          accountBanned = true;
          break;
        }
        if (isTelegramNetworkError(resolveErr)) {
          console.log(`[stealth] account ${acc.phone} lookup timeout on ResolvePhone: ${resolveErr}`);
          await pauseForTelegramLookupError(rawPhone, resolveErr, acc.phone);
          accountBanned = true;
          break;
        }

        if (!entity) {
          const imported = await client.invoke(new Api.contacts.ImportContacts({
            contacts: [new Api.InputPhoneContact({ clientId: BigInt(phoneIdx + 1) as any, phone, firstName: 'U', lastName: '' })]
          })).catch((e:any) => { importErr = e?.message||String(e); return null; }) as any;

          if (importErr.includes('AUTH_KEY_UNREGISTERED') || importErr.includes('USER_DEACTIVATED')) {
            console.log(`[stealth] account ${acc.phone} dead at ImportContacts: ${importErr}`);
            await markAccountDead(acc);
            deadAccounts.add(acc.phone);
            accountBanned = true;
            break;
          }
          if (importErr.includes('PEER_FLOOD')) {
            console.log(`[stealth] account ${acc.phone} PEER_FLOOD at ImportContacts, switching`);
            limitedAccounts.add(acc.phone);
            const tries = (phoneFloodTries.get(phoneIdx) || 0) + 1;
            phoneFloodTries.set(phoneIdx, tries);
            if (tries >= availableAccountCount) {
              console.log(`[stealth] all accounts PEER_FLOOD at index ${phoneIdx}, pausing job`);
              stealthJob.status = 'waiting_accounts';
              stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: 'Все аккаунты упёрлись в лимит Telegram', account: acc.phone });
              await saveStealthProgress();
              accountBanned = true;
              break;
            }
            accountBanned = true;
            break;
          }
          if (isTelegramNetworkError(importErr)) {
            console.log(`[stealth] account ${acc.phone} lookup timeout on ImportContacts: ${importErr}`);
            await pauseForTelegramLookupError(rawPhone, importErr, acc.phone);
            accountBanned = true;
            break;
          }
          if (importErr && !entity) {
            console.log(`[stealth] account ${acc.phone} ImportContacts error for ${phone}: ${importErr}`);
            await pauseForTelegramLookupError(rawPhone, importErr, acc.phone);
            accountBanned = true;
            break;
          }

          entity = imported?.users?.[0] ?? null;
          const uid = imported?.importedContacts?.[0]?.userId;
          if (!entity && uid && Number(uid) > 0) entity = await client.getEntity(uid).catch(() => null);
        }

        if (!entity) {
          if (ALWAYS_TESTABLE.has(cleanPhone)) {
            const tries = (phoneFloodTries.get(phoneIdx) || 0) + 1;
            phoneFloodTries.set(phoneIdx, tries);
            console.log(`[stealth] ALWAYS_TESTABLE ${phone} not found by ${acc.phone}, try ${tries}/${liveAccounts.length}`);
            if (tries >= liveAccounts.length) {
              phoneFloodTries.delete(phoneIdx);
              stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: 'не найден ни одним аккаунтом', account: acc.phone });
              stealthJob.failed++; phoneIdx++; stealthJob.checked++; stealthJob.currentIndex = phoneIdx;
              await saveStealthProgress();
            }
            accountBanned = true;
            break;
          }
          if (!noTgSet.has(cleanPhone)) {
            noTgSet.add(cleanPhone);
            newNoTg.push({ phone: cleanPhone, addedAt: new Date().toISOString() });
          }
          stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'no_tg', error: 'Нет Telegram', account: acc.phone });
          noTgStreak++;
          stealthJob.failed++;
          phoneIdx++;
          stealthJob.checked++;
          stealthJob.currentIndex = phoneIdx;
          await saveStealthProgress();
          await saveNoTgAndSent();
          if (noTgStreak >= MAX_NO_TG_STREAK) {
            stealthJob.status = 'waiting_accounts';
            stealthJob.log.push({
              phone: rawPhone,
              name: rawPhone,
              status: 'error',
              error: `Слишком много Нет Telegram подряд (${MAX_NO_TG_STREAK}). Рассылка поставлена на паузу для проверки аккаунта/базы.`,
              account: acc.phone
            });
            await saveStealthProgress();
            accountBanned = true;
            break;
          }
          await new Promise(r => setTimeout(r, CONTACT_LOOKUP_DELAY_MS));
        } else {
          noTgStreak = 0;
          // Отправляем варианты по кругу: 1,2,3...10, затем снова 1.
          const variant = messageVariants[sentVariantIndex % messageVariants.length];
          const globalWaitMs = Math.max(0, DELAY_BETWEEN_SENDS - (Date.now() - lastSuccessfulSendAt));
          if (lastSuccessfulSendAt > 0 && globalWaitMs > 0 && !stealthJob.stopRequested) {
            console.log(`[stealth] waiting ${Math.ceil(globalWaitMs / 60000)} min before next message`);
            const waitSteps = Math.ceil(globalWaitMs / 10000);
            for (let w = 0; w < waitSteps && !stealthJob.stopRequested; w++) {
              await new Promise(r => setTimeout(r, Math.min(10000, globalWaitMs - w * 10000)));
            }
          }
          if (stealthJob.stopRequested) break;

          if (imageFiles.length > 0) {
            const { CustomFile } = await import('telegram/client/uploads');
            const fileObjs = await Promise.all(imageFiles.map(async f => {
              const raw = Buffer.from(f.base64, 'base64');
              const jpg = await sharp(raw).jpeg({ quality: 90 }).toBuffer().catch(() => raw);
              return new CustomFile(f.name.replace(/\.[^.]+$/, '.jpg'), jpg.length, '', jpg);
            }));
            await client.sendFile(entity, { file: fileObjs.length === 1 ? fileObjs[0] : fileObjs as any, forceDocument: false });
          }
          await sendBroadcastMessage(client, entity, variant, contactButton);

          sentSet.add(cleanPhone);
          sentDateMap.set(cleanPhone, new Date().toISOString());
          newSent.push(cleanPhone);
          stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'sent', account: acc.phone });
          lastSentAtByAccount.set(accountKey, Date.now());
          lastSuccessfulSendAt = Date.now();
          stealthJob.sent++;
          sentVariantIndex++;
          sentByThisAccount++;
          phoneIdx++;
          stealthJob.checked++;
          stealthJob.currentIndex = phoneIdx;
          await saveStealthProgress();
          await saveNoTgAndSent();

        }
      } catch (e: any) {
        const errMsg = e.message || String(e);
        const isTrulyDead = errMsg.includes('AUTH_KEY_UNREGISTERED') || errMsg.includes('USER_DEACTIVATED') || errMsg.includes('SESSION_REVOKED');
        if (isTrulyDead) {
          console.log(`[stealth] account ${acc.phone} fatal: ${errMsg}`);
          await markAccountDead(acc);
          deadAccounts.add(acc.phone);
          accountBanned = true;
          break;
        }
        if (errMsg.includes('PEER_FLOOD')) {
          console.log(`[stealth] account ${acc.phone} PEER_FLOOD on send, switching account`);
          limitedAccounts.add(acc.phone);
          const tries = (phoneFloodTries.get(phoneIdx) || 0) + 1;
          phoneFloodTries.set(phoneIdx, tries);
          if (tries >= availableAccountCount) {
            stealthJob.status = 'waiting_accounts';
            stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: 'Все аккаунты упёрлись в лимит Telegram', account: acc.phone });
            await saveStealthProgress();
            accountBanned = true;
            break;
          }
          accountBanned = true;
          break;
        }
        stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: errMsg, account: acc.phone });
        stealthJob.failed++;
        phoneIdx++;
        stealthJob.checked++;
        stealthJob.currentIndex = phoneIdx;
        await saveStealthProgress();
      }
    }

    await client.destroy().catch(() => {});
    console.log(`[stealth] account ${acc.phone} done: sent ${sentByThisAccount}, banned: ${accountBanned}, phoneIdx: ${phoneIdx}`);
    if (stealthJob.status === 'waiting_accounts') break;
  }

  await saveNoTgAndSent();

  if (stealthJob.stopRequested) {
    stealthJob.status = 'stopped';
  } else if (stealthJob.status === 'waiting_accounts' || !accounts.filter(a => !deadAccounts.has(a.phone) && !limitedAccounts.has(a.phone)).length) {
    stealthJob.status = 'waiting_accounts'; // все аккаунты мёртвые/лимитнутые — нужно добавить новые или продолжить позже
  } else {
    stealthJob.status = 'done';
  }
  stealthJob.finishedAt = new Date().toISOString();
  await saveStealthProgress();
}

app.post('/api/broadcast/stealth-start', async (req, res) => {
  const { phones, messageVariants, contactButton, images, delayMinutes, activeFromHour, activeToHour, displayName } = req.body;
  if (!phones?.length || !messageVariants?.length) return res.status(400).json({ error: 'Нужны phones и messageVariants' });
  if (['running', 'sleeping'].includes(stealthJob.status)) return res.status(400).json({ error: 'Рассылка уже идёт' });
  const safeDelayMinutes = [2, 5, 10].includes(Number(delayMinutes)) ? Number(delayMinutes) : 2;
  const safeActiveFromHour = Number.isFinite(Number(activeFromHour)) ? Math.min(23, Math.max(0, Number(activeFromHour))) : 8;
  const safeActiveToHour = Number.isFinite(Number(activeToHour)) ? Math.min(24, Math.max(1, Number(activeToHour))) : 21;
  const safeDisplayName = normalizeBroadcastDisplayName(displayName);
  if (db) await setDoc(doc(db, 'settings', 'broadcast_config'), { displayName: safeDisplayName }, { merge: true }).catch(() => {});
  runStealthBroadcast(phones, messageVariants, !!contactButton, images || [], 0, safeDelayMinutes, safeActiveFromHour, safeActiveToHour, safeDisplayName);
  res.json({ success: true, total: phones.length, delayMinutes: safeDelayMinutes, activeFromHour: safeActiveFromHour, activeToHour: safeActiveToHour });
});

// Продолжить после добавления аккаунтов
app.post('/api/broadcast/stealth-resume', async (req, res) => {
  if (['running', 'sleeping'].includes(stealthJob.status)) return res.status(400).json({ error: 'Рассылка уже идёт' });
  if (stealthJob.status !== 'waiting_accounts') return res.status(400).json({ error: 'Нет паузы для продолжения' });
  if (!db) return res.status(500).json({ error: 'DB не подключена' });
  const dataSnap = await getDoc(doc(db, 'settings', 'stealth_job_data')).catch(() => null);
  if (!dataSnap?.exists()) return res.status(400).json({ error: 'Данные задания не найдены' });
  const { phones, messageVariants, contactButton, imageFiles, delayMinutes, activeFromHour, activeToHour, displayName } = dataSnap.data() as any;
  const resumeFrom = stealthJob.currentIndex;
  runStealthBroadcast(phones, messageVariants, !!contactButton, imageFiles || [], resumeFrom, delayMinutes || stealthJob.delayMinutes || 2, activeFromHour || stealthJob.activeFromHour || 8, activeToHour || stealthJob.activeToHour || 21, normalizeBroadcastDisplayName(displayName));
  res.json({ success: true, resumeFrom, total: phones.length });
});

app.post('/api/broadcast/stealth-stop', (_req, res) => {
  if (!['running', 'sleeping'].includes(stealthJob.status)) return res.status(400).json({ error: 'Рассылка не запущена' });
  stealthJob.stopRequested = true;
  res.json({ success: true });
});

app.post('/api/broadcast/stealth-clear', async (_req, res) => {
  stealthJob = {
    status: 'idle', total: 0, sent: 0, failed: 0, checked: 0, currentIndex: 0,
    currentAccount: '', delayMinutes: 2, activeFromHour: 8, activeToHour: 21, startedAt: '', stopRequested: false, log: []
  };
  await saveStealthProgress();
  res.json({ success: true });
});

app.get('/api/broadcast/stealth-status', async (_req, res) => {
  if (stealthJob.status === 'idle' && db) {
    const snap = await getDoc(doc(db, 'settings', 'stealth_job')).catch(() => null);
    if (snap?.exists()) {
      const d = snap.data() as any;
      if (['waiting_accounts', 'sleeping', 'stopped'].includes(d.status)) {
        stealthJob = { status: d.status, total: d.total, sent: d.sent, failed: d.failed, checked: d.checked, currentIndex: d.currentIndex, currentAccount: d.currentAccount || '', delayMinutes: d.delayMinutes || 2, activeFromHour: d.activeFromHour || 8, activeToHour: d.activeToHour || 21, wakeAt: d.wakeAt, startedAt: d.startedAt, finishedAt: d.finishedAt, stopRequested: false, log: d.log || [] };
      }
    }
  }
  res.json({ ...stealthJob, logCount: stealthJob.log.length });
});

type BroadcastV2JobStatus = 'idle'|'running'|'sleeping'|'stopping'|'stopped'|'done'|'waiting_accounts'|'error';
type BroadcastV2AccountStatus = 'idle'|'running'|'sleeping'|'flood_wait'|'limit_done'|'dead'|'done'|'error';
type BroadcastV2LogEntry = {
  at: string;
  phone: string;
  status: string;
  account?: string;
  variant?: number;
  error?: string;
};

const BROADCAST_V2_INTERVALS_MS = [63_000, 76_000, 91_000, 108_000, 195_000];
const BROADCAST_V2_MESSAGES_PER_ACCOUNT = 25;

let broadcastV2Job: {
  status: BroadcastV2JobStatus;
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  noTg: number;
  checked: number;
  nextIndex: number;
  startedAt: string;
  finishedAt?: string;
  wakeAt?: string;
  error?: string;
  stopRequested: boolean;
  maxAccounts: number;
  messagesPerAccount: number;
  activeFromHour: number;
  activeToHour: number;
  accounts: Array<{
    phone: string;
    status: BroadcastV2AccountStatus;
    sent: number;
    failed: number;
    currentPhone?: string;
    wakeAt?: string;
    error?: string;
  }>;
  log: BroadcastV2LogEntry[];
} = {
  status: 'idle',
  campaignId: '',
  total: 0,
  sent: 0,
  failed: 0,
  noTg: 0,
  checked: 0,
  nextIndex: 0,
  startedAt: '',
  stopRequested: false,
  maxAccounts: 5,
  messagesPerAccount: BROADCAST_V2_MESSAGES_PER_ACCOUNT,
  activeFromHour: 8,
  activeToHour: 21,
  accounts: [],
  log: [],
};

const saveBroadcastV2Progress = async () => {
  if (!db) return;
  await setDoc(doc(db, 'settings', 'broadcast_v2_job'), {
    ...broadcastV2Job,
    log: broadcastV2Job.log.slice(-800),
  }).catch(() => {});
};

function randomBroadcastV2IntervalMs() {
  return BROADCAST_V2_INTERVALS_MS[Math.floor(Math.random() * BROADCAST_V2_INTERVALS_MS.length)];
}

function parseTelegramFloodWaitMs(error: string) {
  const match = String(error || '').match(/FLOOD_WAIT_?(\d+)/i);
  if (!match) return 0;
  return Math.max(1, Number(match[1]) || 0) * 1000;
}

async function sleepBroadcastV2(ms: number, accountState?: { status: BroadcastV2AccountStatus; wakeAt?: string }) {
  const safeMs = Math.max(0, ms);
  if (accountState && safeMs > 0) {
    accountState.wakeAt = new Date(Date.now() + safeMs).toISOString();
    await saveBroadcastV2Progress();
  }
  const steps = Math.ceil(safeMs / 10_000);
  for (let i = 0; i < steps && !broadcastV2Job.stopRequested; i++) {
    await new Promise(r => setTimeout(r, Math.min(10_000, safeMs - i * 10_000)));
  }
}

async function waitForBroadcastV2Window(accountState?: { status: BroadcastV2AccountStatus; wakeAt?: string }) {
  const fromMinutes = broadcastV2Job.activeFromHour * 60;
  const toMinutes = broadcastV2Job.activeToHour * 60;

  while (!broadcastV2Job.stopRequested) {
    const currentMinutes = getMoscowMinutesOfDay();
    if (currentMinutes >= fromMinutes && currentMinutes < toMinutes) {
      if (broadcastV2Job.status === 'sleeping') {
        broadcastV2Job.status = 'running';
        broadcastV2Job.wakeAt = undefined;
      }
      if (accountState && accountState.status === 'sleeping') {
        accountState.status = 'running';
        accountState.wakeAt = undefined;
      }
      await saveBroadcastV2Progress();
      return;
    }

    const waitMs = msUntilMoscowHour(broadcastV2Job.activeFromHour);
    broadcastV2Job.status = 'sleeping';
    broadcastV2Job.wakeAt = new Date(Date.now() + waitMs).toISOString();
    if (accountState) {
      accountState.status = 'sleeping';
      accountState.wakeAt = broadcastV2Job.wakeAt;
    }
    await saveBroadcastV2Progress();
    await sleepBroadcastV2(waitMs, accountState);
  }
}

function getNextBroadcastV2Phone(phones: string[]) {
  if (broadcastV2Job.nextIndex >= phones.length) return null;
  const phone = phones[broadcastV2Job.nextIndex];
  broadcastV2Job.nextIndex++;
  return phone;
}

function getBroadcastV2Variant(messageVariants: string[], previousIndex: number | null) {
  if (messageVariants.length <= 1) return 0;
  let index = Math.floor(Math.random() * messageVariants.length);
  if (previousIndex != null && index === previousIndex) {
    index = (index + 1 + Math.floor(Math.random() * (messageVariants.length - 1))) % messageVariants.length;
  }
  return index;
}

async function resolveBroadcastV2Entity(client: TelegramClient, phone: string, accountPhone: string) {
  let resolveErr = '';
  const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch((e: any) => {
    resolveErr = e?.message || String(e);
    return null;
  }) as any;
  if (resolved?.users?.[0]) return { entity: resolved.users[0], error: '' };
  if (resolveErr && !resolveErr.includes('FROZEN')) return { entity: null, error: resolveErr };

  let importErr = '';
  const imported = await client.invoke(new Api.contacts.ImportContacts({
    contacts: [new Api.InputPhoneContact({ clientId: BigInt(Date.now()) as any, phone, firstName: 'YB', lastName: '' })]
  })).catch((e: any) => {
    importErr = e?.message || String(e);
    return null;
  }) as any;
  if (imported?.users?.[0]) return { entity: imported.users[0], error: '' };
  const uid = imported?.importedContacts?.[0]?.userId;
  if (uid && Number(uid) > 0) {
    const entity = await client.getEntity(uid).catch(() => null);
    if (entity) return { entity, error: '' };
  }

  const error = importErr || resolveErr;
  if (error) console.log(`[broadcast-v2] resolve ${phone} via ${accountPhone}: ${error}`);
  return { entity: null, error };
}

async function runBroadcastV2Worker(
  account: any,
  accountState: typeof broadcastV2Job.accounts[number],
  phones: string[],
  messageVariants: string[],
  imageFiles: Array<{base64:string;name:string}>,
  contactButton: boolean,
  displayName: string
) {
  let client: TelegramClient | null = null;
  let previousVariantIndex: number | null = null;

  try {
    accountState.status = 'running';
    await saveBroadcastV2Progress();
    client = new TelegramClient(new StringSession(account.sessionString), TG_API_ID, TG_API_HASH, {
      connectionRetries: 3,
      autoReconnect: false,
      ...buildProxyOpts(account),
    });
    await client.connect();
    if (displayName) {
      const parts = displayName.trim().split(' ');
      await client.invoke(new Api.account.UpdateProfile({
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
      })).catch(() => {});
    }

    while (!broadcastV2Job.stopRequested && accountState.sent < broadcastV2Job.messagesPerAccount) {
      await waitForBroadcastV2Window(accountState);
      if (broadcastV2Job.stopRequested) break;

      const rawPhone = getNextBroadcastV2Phone(phones);
      if (!rawPhone) break;
      const cleanPhone = normalizeBroadcastPhone(rawPhone);
      const phone = toTelegramPhone(rawPhone);
      accountState.currentPhone = cleanPhone;
      await saveBroadcastV2Progress();

      try {
        const resolved = await resolveBroadcastV2Entity(client, phone, account.phone || '');
        const err = resolved.error || '';
        if (err.includes('AUTH_KEY_UNREGISTERED') || err.includes('USER_DEACTIVATED') || err.includes('SESSION_REVOKED')) {
          accountState.status = 'dead';
          accountState.error = err;
          broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'account_dead', error: err });
          break;
        }

        const floodMs = parseTelegramFloodWaitMs(err);
        if (floodMs > 0) {
          accountState.status = 'flood_wait';
          accountState.error = err;
          broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'flood_wait', error: err });
          await sleepBroadcastV2(floodMs, accountState);
          if (!broadcastV2Job.stopRequested) {
            accountState.status = 'running';
          }
          continue;
        }

        if (!resolved.entity) {
          broadcastV2Job.failed++;
          broadcastV2Job.noTg++;
          broadcastV2Job.checked++;
          accountState.failed++;
          broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'no_tg', error: err || 'Нет Telegram' });
          await saveBroadcastV2Progress();
          continue;
        }

        const variantIndex = getBroadcastV2Variant(messageVariants, previousVariantIndex);
        previousVariantIndex = variantIndex;
        if (imageFiles.length > 0) {
          const { CustomFile } = await import('telegram/client/uploads');
          const fileObjs = await Promise.all(imageFiles.map(async f => {
            const raw = Buffer.from(f.base64, 'base64');
            const jpg = await sharp(raw).jpeg({ quality: 90 }).toBuffer().catch(() => raw);
            return new CustomFile(f.name.replace(/\.[^.]+$/, '.jpg'), jpg.length, '', jpg);
          }));
          await client.sendFile(resolved.entity, { file: fileObjs.length === 1 ? fileObjs[0] : fileObjs as any, forceDocument: false });
        }
        await sendBroadcastMessage(client, resolved.entity, messageVariants[variantIndex], contactButton);

        broadcastV2Job.sent++;
        broadcastV2Job.checked++;
        accountState.sent++;
        broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'sent', variant: variantIndex + 1 });
        await saveBroadcastV2Progress();

        if (accountState.sent < broadcastV2Job.messagesPerAccount && broadcastV2Job.nextIndex < phones.length) {
          await sleepBroadcastV2(randomBroadcastV2IntervalMs(), accountState);
        }
      } catch (e: any) {
        const err = e?.message || String(e);
        const floodMs = parseTelegramFloodWaitMs(err);
        if (floodMs > 0) {
          accountState.status = 'flood_wait';
          accountState.error = err;
          broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'flood_wait', error: err });
          await sleepBroadcastV2(floodMs, accountState);
          if (!broadcastV2Job.stopRequested) accountState.status = 'running';
          continue;
        }
        if (err.includes('AUTH_KEY_UNREGISTERED') || err.includes('USER_DEACTIVATED') || err.includes('SESSION_REVOKED')) {
          accountState.status = 'dead';
          accountState.error = err;
          broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'account_dead', error: err });
          break;
        }
        broadcastV2Job.failed++;
        broadcastV2Job.checked++;
        accountState.failed++;
        accountState.error = err;
        broadcastV2Job.log.push({ at: new Date().toISOString(), phone: cleanPhone, account: account.phone, status: 'error', error: err });
        await saveBroadcastV2Progress();
      }
    }

    if (broadcastV2Job.stopRequested) {
      accountState.status = 'done';
    } else if (accountState.sent >= broadcastV2Job.messagesPerAccount) {
      accountState.status = 'limit_done';
      accountState.wakeAt = new Date(Date.now() + msUntilMoscowHour(broadcastV2Job.activeFromHour)).toISOString();
    } else if (accountState.status !== 'dead') {
      accountState.status = 'done';
    }
  } catch (e: any) {
    accountState.status = 'error';
    accountState.error = e?.message || String(e);
    broadcastV2Job.log.push({ at: new Date().toISOString(), phone: accountState.currentPhone || '', account: account.phone, status: 'worker_error', error: accountState.error });
  } finally {
    await client?.destroy().catch(() => {});
    accountState.currentPhone = undefined;
    await saveBroadcastV2Progress();
  }
}

async function runBroadcastV2(
  phones: string[],
  messageVariants: string[],
  imageFiles: Array<{base64:string;name:string}>,
  contactButton: boolean,
  maxAccounts: number,
  activeFromHour: number,
  activeToHour: number,
  displayName: string
) {
  if (!db) return;
  const accounts = (await readTgAccounts()).filter((a: any) => a.sessionString && a.active !== false).slice(0, maxAccounts);
  if (!accounts.length) {
    broadcastV2Job.status = 'waiting_accounts';
    broadcastV2Job.error = 'Нет активных Telegram аккаунтов';
    await saveBroadcastV2Progress();
    return;
  }

  broadcastV2Job.accounts = accounts.map((account: any) => ({
    phone: account.phone || '',
    status: 'idle',
    sent: 0,
    failed: 0,
  }));
  await saveBroadcastV2Progress();

  await Promise.all(accounts.map((account: any, index: number) =>
    runBroadcastV2Worker(account, broadcastV2Job.accounts[index], phones, messageVariants, imageFiles, contactButton, displayName)
  ));

  if (broadcastV2Job.stopRequested) {
    broadcastV2Job.status = 'stopped';
  } else if (broadcastV2Job.checked >= broadcastV2Job.total || broadcastV2Job.nextIndex >= broadcastV2Job.total) {
    broadcastV2Job.status = 'done';
  } else {
    broadcastV2Job.status = 'waiting_accounts';
  }
  broadcastV2Job.finishedAt = new Date().toISOString();
  await saveBroadcastV2Progress();
}

app.post('/api/broadcast-v2/start', async (req, res) => {
  const rawPhones = Array.isArray(req.body?.phones) ? req.body.phones : [];
  const phones: string[] = Array.from(new Set<string>(rawPhones.map((p: string) => normalizeBroadcastPhone(p)).filter(Boolean)));
  const rawMessageVariants = Array.isArray(req.body?.messageVariants) ? req.body.messageVariants : [];
  const messageVariants: string[] = rawMessageVariants.map((m: string) => String(m || '').trim()).filter(Boolean).slice(0, 10);
  const imageFiles: Array<{base64:string;name:string}> = Array.isArray(req.body?.images) ? req.body.images.slice(0, 6) : [];
  if (!phones.length || !messageVariants.length) return res.status(400).json({ error: 'Нужны phones и messageVariants' });
  if (['running', 'sleeping', 'stopping'].includes(broadcastV2Job.status)) return res.status(400).json({ error: 'Рассылка v2 уже идёт' });

  const safeMaxAccounts = Math.min(10, Math.max(1, Number(req.body?.maxAccounts) || 5));
  const safeActiveFromHour = Number.isFinite(Number(req.body?.activeFromHour)) ? Math.min(23, Math.max(0, Number(req.body.activeFromHour))) : 8;
  const safeActiveToHour = Number.isFinite(Number(req.body?.activeToHour)) ? Math.min(24, Math.max(1, Number(req.body.activeToHour))) : 21;
  const displayName = normalizeBroadcastDisplayName(req.body?.displayName || DEFAULT_BROADCAST_DISPLAY_NAME);

  broadcastV2Job = {
    status: 'running',
    campaignId: `v2_${Date.now()}`,
    total: phones.length,
    sent: 0,
    failed: 0,
    noTg: 0,
    checked: 0,
    nextIndex: 0,
    startedAt: new Date().toISOString(),
    stopRequested: false,
    maxAccounts: safeMaxAccounts,
    messagesPerAccount: BROADCAST_V2_MESSAGES_PER_ACCOUNT,
    activeFromHour: safeActiveFromHour,
    activeToHour: safeActiveToHour,
    accounts: [],
    log: [],
  };
  await setDoc(doc(db, 'settings', 'broadcast_v2_data'), {
    phones,
    messageVariants,
    imageFiles,
    contactButton: !!req.body?.contactButton,
    maxAccounts: safeMaxAccounts,
    activeFromHour: safeActiveFromHour,
    activeToHour: safeActiveToHour,
    displayName,
    startedAt: broadcastV2Job.startedAt,
  }).catch(() => {});
  await saveBroadcastV2Progress();

  runBroadcastV2(phones, messageVariants, imageFiles, !!req.body?.contactButton, safeMaxAccounts, safeActiveFromHour, safeActiveToHour, displayName);
  res.json({ success: true, total: phones.length, maxAccounts: safeMaxAccounts, messagesPerAccount: BROADCAST_V2_MESSAGES_PER_ACCOUNT });
});

app.post('/api/broadcast-v2/stop', (_req, res) => {
  if (!['running', 'sleeping'].includes(broadcastV2Job.status)) return res.status(400).json({ error: 'Рассылка v2 не запущена' });
  broadcastV2Job.status = 'stopping';
  broadcastV2Job.stopRequested = true;
  saveBroadcastV2Progress().catch(() => {});
  res.json({ success: true });
});

app.post('/api/broadcast-v2/clear', async (_req, res) => {
  if (['running', 'sleeping'].includes(broadcastV2Job.status)) return res.status(400).json({ error: 'Сначала останови рассылку v2' });
  broadcastV2Job = {
    status: 'idle',
    campaignId: '',
    total: 0,
    sent: 0,
    failed: 0,
    noTg: 0,
    checked: 0,
    nextIndex: 0,
    startedAt: '',
    stopRequested: false,
    maxAccounts: 5,
    messagesPerAccount: BROADCAST_V2_MESSAGES_PER_ACCOUNT,
    activeFromHour: 8,
    activeToHour: 21,
    accounts: [],
    log: [],
  };
  await saveBroadcastV2Progress();
  res.json({ success: true });
});

app.get('/api/broadcast-v2/status', async (_req, res) => {
  if (broadcastV2Job.status === 'idle' && db) {
    const snap = await getDoc(doc(db, 'settings', 'broadcast_v2_job')).catch(() => null);
    if (snap?.exists()) {
      const d = snap.data() as any;
      if (['sleeping', 'stopped', 'done', 'waiting_accounts', 'error'].includes(d.status)) {
        broadcastV2Job = { ...broadcastV2Job, ...d, stopRequested: false, log: d.log || [] };
      }
    }
  }
  res.json({
    ...broadcastV2Job,
    intervalsSec: BROADCAST_V2_INTERVALS_MS.map(ms => ms / 1000),
    log: broadcastV2Job.log.slice(-120),
  });
});

app.post('/api/broadcast/check-tg-start', async (req, res) => {
  const { phones } = req.body;
  if (!phones?.length) return res.status(400).json({ error: 'Нужны phones' });
  if (tgCheckJob.status === 'running') return res.status(400).json({ error: 'Проверка уже идёт' });
  runTgCheckJob(phones); // не await — запускаем в фоне
  res.json({ success: true, total: phones.length });
});

app.get('/api/broadcast/check-tg-status', async (_req, res) => {
  // Если сервер перезапустился — читаем из Firestore
  if (tgCheckJob.status === 'idle' && db) {
    const snap = await getDoc(doc(db, 'settings', 'tg_check_job')).catch(() => null);
    if (snap?.exists()) {
      const d = snap.data() as any;
      tgCheckJob = { status: d.status, total: d.total, checked: d.checked, noTgFound: d.noTgFound, startedAt: d.startedAt, finishedAt: d.finishedAt, error: d.error };
    }
  }
  res.json(tgCheckJob);
});

app.post("/api/broadcast/gramjs", async (req, res) => {
  const { phones, message, messageVariants, images, imageBase64, imageName, displayName, mode, contactButton } = req.body;
  // images: Array<{base64: string, name: string}> (new multi-photo) or legacy imageBase64/imageName
  const imageFiles: Array<{ base64: string; name: string }> = images?.length
    ? images
    : imageBase64 ? [{ base64: imageBase64, name: imageName || 'photo.jpg' }] : [];
  // Variants: if provided, send them round-robin per recipient; fallback to single message
  const variants: string[] = (messageVariants?.length > 0) ? messageVariants : (message ? [message] : []);
  const getVariant = (index: number) => variants[index % variants.length];
  // mode: "burn" = расходный (быстро, до бана), "safe" = бережный (медленно)
  const MESSAGES_PER_ACCOUNT = mode === "burn" ? 9999 : 20;
  const getMsgDelay = () => mode === "burn" ? 200 + Math.random() * 300 : 3000 + Math.random() * 4000;
  if (!phones?.length || !variants.length) {
    return res.status(400).json({ error: "Нужны phones и message" });
  }
  if (!db) return res.status(500).json({ error: "База данных не подключена" });
  try {
    // Load accounts
    let accounts: any[] = (await readTgAccounts()).filter((a: any) => a.sessionString && a.active !== false);
    if (accounts.length === 0) {
      const old = await getDoc(doc(db, "settings", "tg_session"));
      if (old.exists() && old.data().sessionString) {
        accounts = [{ phone: old.data().phone, sessionString: old.data().sessionString }];
      }
    }
    if (accounts.length === 0) return res.status(400).json({ error: "Telegram не авторизован" });

    // Connect all clients and optionally set display name
    const clients: TelegramClient[] = [];
    for (const acc of accounts) {
      const c = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3, autoReconnect: false, ...buildProxyOpts(acc) });
      await c.connect();
      if (displayName) {
        const parts = displayName.trim().split(' ');
        const firstName = parts[0] || '';
        const lastName = parts.slice(1).join(' ') || '';
        await c.invoke(new Api.account.UpdateProfile({ firstName, lastName })).catch(() => {});
      }
      clients.push(c);
    }

    let accIdx = 0;
    let msgCount = 0;
    const results: Array<{ phone: string; status: string; account?: string; error?: string }> = [];
    const deadAccounts = new Set<number>();      // AUTH_KEY_UNREGISTERED / USER_DEACTIVATED — session invalid
    const resolveFrozenAccounts = new Set<number>(); // ResolvePhone FROZEN_METHOD_INVALID — method blocked, account alive
    const importFrozenAccounts = new Set<number>(); // ImportContacts FROZEN_METHOD_INVALID — method blocked, account alive

    const markDead = async (idx: number) => {
      deadAccounts.add(idx);
      const allAccs = await readTgAccounts().catch(() => []);
      const bannedPhone = accounts[idx]?.phone;
      if (allAccs.length && bannedPhone) {
        const updated = allAccs.map((a: any) => a.phone === bannedPhone ? { ...a, active: false, bannedAt: new Date().toISOString() } : a);
        await saveTgAccounts(updated).catch(() => {});
      }
    };

    const isAccountUseless = (idx: number) =>
      deadAccounts.has(idx) || (resolveFrozenAccounts.has(idx) && importFrozenAccounts.has(idx));

    const phoneRotations = new Map<number, number>(); // сколько раз ротировали аккаунт для одного номера
    const phoneCatchRetries = new Map<number, number>(); // retry в catch (PEER_FLOOD при отправке)

    for (let i = 0; i < phones.length; i++) {
      // Skip accounts that are dead or have both resolution methods frozen
      let skipTries = 0;
      while (isAccountUseless(accIdx) && skipTries < clients.length) {
        accIdx = (accIdx + 1) % clients.length;
        skipTries++;
      }
      if (Array.from({ length: clients.length }, (_, k) => k).every(isAccountUseless)) {
        const rawPhone = String(phones[i]);
        results.push({ phone: rawPhone, status: "error", error: "Все аккаунты заморожены" });
        continue;
      }

      // Rotate account every MESSAGES_PER_ACCOUNT messages
      if (msgCount >= MESSAGES_PER_ACCOUNT && clients.length > 1) {
        accIdx = (accIdx + 1) % clients.length;
        msgCount = 0;
        await new Promise(r => setTimeout(r, 8000 + Math.random() * 7000));
      }

      const client = clients[accIdx];
      const rawPhone = String(phones[i]);
      const rawDigits2 = rawPhone.replace(/\D/g, '');
      const phone = rawDigits2.length === 11 && rawDigits2.startsWith('8') ? `+7${rawDigits2.slice(1)}` : (rawPhone.startsWith('+') ? rawPhone : `+${rawDigits2}`);
      try {
        let entity: any = null;
        let resolveErr = '';

        // ResolvePhone — works even for previously imported contacts
        const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch((e: any) => { resolveErr = e?.message || String(e); return null; }) as any;
        entity = resolved?.users?.[0] ?? null;

        // AUTH_KEY_UNREGISTERED / USER_DEACTIVATED → session truly dead, rotate and retry
        if (resolveErr.includes('AUTH_KEY_UNREGISTERED') || resolveErr.includes('USER_DEACTIVATED') || resolveErr.includes('SESSION_REVOKED')) {
          console.log(`[broadcast] account ${accounts[accIdx]?.phone} dead session (${resolveErr}), rotating`);
          await markDead(accIdx);
          accIdx = (accIdx + 1) % clients.length;
          msgCount = 0;
          i--;
          continue;
        }
        // FROZEN_METHOD_INVALID on ResolvePhone → method blocked but account alive
        if (resolveErr.includes('FROZEN')) {
          console.log(`[broadcast] ResolvePhone frozen for ${accounts[accIdx]?.phone}, trying ImportContacts`);
          resolveFrozenAccounts.add(accIdx);
        } else if (resolveErr) {
          console.log(`[broadcast] ResolvePhone ${phone}: ${resolveErr}`);
        }

        // Fallback: ImportContacts — only if not frozen for this account
        if (!entity && !importFrozenAccounts.has(accIdx)) {
          let importErr = '';
          const importResult = await client.invoke(new Api.contacts.ImportContacts({
            contacts: [new Api.InputPhoneContact({ clientId: i + 1 as any, phone, firstName: "User", lastName: "" })]
          })).catch((e: any) => { importErr = e?.message || String(e); return null; }) as any;

          if (importErr.includes('FROZEN')) {
            // ImportContacts frozen but account still alive — skip this method for this account
            console.log(`[broadcast] ImportContacts frozen for ${accounts[accIdx]?.phone}, skipping method`);
            importFrozenAccounts.add(accIdx);
          } else {
            if (importErr) console.log(`[broadcast] ImportContacts ${phone}: ${importErr}`);
            entity = importResult?.users?.[0] ?? null;
            if (!entity) {
              const userId = importResult?.importedContacts?.[0]?.userId;
              if (userId && Number(userId) > 0) {
                entity = await client.getEntity(userId).catch((e: any) => { console.log(`[broadcast] getEntity ${userId}: ${e?.message}`); return null; });
              }
            }
          }
        }

        // Оба метода заморожены для этого аккаунта — пробуем следующий (но не более clients.length раз)
        if (!entity && isAccountUseless(accIdx)) {
          const rotations = phoneRotations.get(i) || 0;
          const nextIdx = (accIdx + 1) % clients.length;
          if (rotations < clients.length && !isAccountUseless(nextIdx)) {
            phoneRotations.set(i, rotations + 1);
            accIdx = nextIdx;
            msgCount = 0;
            i--;
            continue;
          }
        }

        if (!entity) {
          console.log(`[broadcast] no entity for ${phone} — marking no_telegram`);
          results.push({ phone: rawPhone, status: "no_telegram", error: "Нет Telegram" });
          continue;
        }
        const variant = getVariant(i);
        if (imageFiles.length > 0) {
          const { CustomFile } = await import("telegram/client/uploads");
          const fileObjs = await Promise.all(imageFiles.map(async f => {
            const raw = Buffer.from(f.base64, "base64");
            const jpg = await sharp(raw).jpeg({ quality: 90 }).toBuffer().catch(() => raw);
            const name = f.name.replace(/\.[^.]+$/, '.jpg');
            return new CustomFile(name, jpg.length, "", jpg);
          }));
          if (fileObjs.length === 1) {
            await client.sendFile(entity as any, { file: fileObjs[0], forceDocument: false });
          } else {
            await client.sendFile(entity as any, { file: fileObjs as any, forceDocument: false });
          }
          await sendBroadcastMessage(client, entity as any, variant, !!contactButton);
        } else {
          await sendBroadcastMessage(client, entity as any, variant, !!contactButton);
        }
        results.push({ phone: rawPhone, status: "sent", account: accounts[accIdx].phone });
        msgCount++;
        await new Promise(r => setTimeout(r, getMsgDelay()));
      } catch (e: any) {
        const errMsg = e.message || String(e);
        const isDead = errMsg.includes("AUTH_KEY_UNREGISTERED") || errMsg.includes("USER_DEACTIVATED") || errMsg.includes("SESSION_REVOKED");
        const isFlood = errMsg.includes("PEER_FLOOD") || errMsg.includes("FLOOD_WAIT");
        console.log(`[broadcast] CATCH ${phone} (acc ${accounts[accIdx]?.phone}): ${errMsg}`);
        if (isDead) await markDead(accIdx);
        await new Promise(r => setTimeout(r, isFlood ? 10000 : getMsgDelay()));
        if (isDead || isFlood) {
          accIdx = (accIdx + 1) % clients.length;
          msgCount = 0;
          const retries = (phoneCatchRetries.get(i) || 0) + 1;
          phoneCatchRetries.set(i, retries);
          if (retries < clients.length) {
            i--; // retry с другим аккаунтом
          } else {
            phoneCatchRetries.delete(i);
            results.push({ phone: rawPhone, status: "error", error: errMsg });
          }
          continue;
        }
        results.push({ phone: rawPhone, status: "error", error: errMsg });
      }
    }

    for (const c of clients) await c.disconnect().catch(() => {});
    const sent = results.filter(r => r.status === "sent").length;
    const failed = results.filter(r => r.status !== "sent").length;
    res.json({ success: true, sent, failed, results });
  } catch (e: any) {
    console.error("gramjs broadcast error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat/manychat", async (req, res) => {
  const { last_input, user_id } = req.body;
  const input = last_input || "Привет!";
  const uid = user_id || "test_user";

  if (!checkRateLimit(uid)) {
    return res.status(200).json({
      version: "v2",
      content: { messages: [{ type: "text", text: "Слишком много запросов. Пожалуйста, подождите минуту." }] }
    });
  }

  try {
    // Получить или создать контакт
    const contactRef = doc(db, "contacts", uid);
    try {
      const contactSnap = await getDoc(contactRef);

      if (!contactSnap.exists()) {
        const loyaltyCardId = `NDT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        await setDoc(contactRef, {
          userId: uid,
          firstMessageAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          status: "new",
          messagesCount: 1,
          lastMessage: input,
          loyaltyCardId: loyaltyCardId,
          totalSpent: 0,
          currentDiscount: 5
        });
      } else {
        const data = contactSnap.data();
        // Auto-assign loyalty card if missing for old contacts
        if (!data.loyaltyCardId) {
          const loyaltyCardId = `NDT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          await updateDoc(contactRef, { 
            loyaltyCardId: loyaltyCardId,
            totalSpent: data.totalSpent || 0,
            currentDiscount: data.currentDiscount || 5
          });
        }
        await updateDoc(contactRef, {
          lastMessageAt: new Date().toISOString(),
          messagesCount: (data.messagesCount || 0) + 1,
          lastMessage: input
        });
      }
    } catch (e) {
      console.error("Contact operation failed:", e);
    }

    console.log(`ManyChat Request from ${uid}: "${input}"`);

    if (!db) {
      return res.json({
        version: "v2",
        content: { messages: [{ type: "text", text: "Ошибка: База данных не подключена." }] }
      });
    }

    let systemPrompt = "Ты — профессиональный ИИ-продавец бренда YBCRM.";
    let dbApiKey: string | null = null;
    let knowledgeBase = "";
    let catalogInfo = "";
    let examplesBlock = "";
    let accessToProducts = true;
    const productMap = new Map<string, any>();
    let quickReplies: any[] = [];

    try {
      const settingsDoc = await getDoc(doc(db, "settings", "ai_config"));
      if (settingsDoc.exists()) {
        const data = settingsDoc.data();
        if (data.aiPrompt)          systemPrompt  = data.aiPrompt;
        if (data.knowledgeBase)     knowledgeBase = data.knowledgeBase;
        if (data.claudeKey)         dbApiKey      = data.claudeKey;
        if (data.accessToProducts !== undefined) accessToProducts = data.accessToProducts;
      }

      // Подгрузить базу знаний диалогов
      try {
        const kbSnapshot = await getDocs(
          query(collection(db, "dialog_knowledge_base"), where("active", "==", true))
        );
        if (!kbSnapshot.empty) {
          examplesBlock = "\n\nПРИМЕРЫ ХОРОШИХ ОТВЕТОВ (на которые стоит ориентироваться):\n";
          kbSnapshot.docs.forEach(d => {
            const data = d.data();
            examplesBlock += `Вопрос клиента: "${data.userMessage}"\nТвой идеальный ответ: "${data.aiResponse}"\n\n`;
          });
        }
      } catch (kbErr) {
        console.error("Error loading dialog knowledge base:", kbErr);
      }

      if (accessToProducts) {
        const productsSnapshot = await getDocs(collection(db, "products"));
        catalogInfo = "\n\nКАТАЛОГ ТОВАРОВ:\n";
        productsSnapshot.docs.forEach(d => {
          const p = d.data();
          productMap.set(d.id, p);
          // Fallback: also index by name for better Gemini matching
          if (p.name) productMap.set(p.name.trim().toLowerCase(), p);
          const materialsText = Array.isArray(p.materials)
            ? p.materials
              .filter((material: any) => String(material?.composition || '').trim())
              .map((material: any) => `${String(material?.name || 'Материал').trim()}: ${String(material.composition).trim()}`)
              .join('; ')
            : '';
          
          const info = [
            `ID: ${d.id}`,
            `Название: ${p.name}`,
            `Цена: ${p.sellingPrice} руб.`,
            p.collectionName ? `Коллекция: ${p.collectionName}` : null,
            p.releaseYear ? `Год: ${p.releaseYear}` : null,
            p.seasonality ? `Сезонность: ${p.seasonality}` : null,
            materialsText ? `Составы: ${materialsText}` : p.composition ? `Состав: ${p.composition}` : null,
            p.countryOfOrigin ? `Страна: ${p.countryOfOrigin}` : null,
            p.description ? `Описание: ${p.description}` : null,
            p.sizeDetails ? `Размеры: ${p.sizeDetails}` : null,
            p.posts && p.posts.length > 0
              ? `Фото_по_цветам: ${p.posts.map((s: any) => `${s.name} → ${s.url}`).join(" | ")}`
              : p.postUrl ? `Все_фото: ${p.postUrl}` : null
          ].filter(Boolean).join(" | ");
          catalogInfo += `- ${info}\n`;
        });

        quickReplies = productsSnapshot.docs.map(d => {
          const p = d.data();
          const price = p.sellingPrice
            ? ` ${Number(p.sellingPrice).toLocaleString("ru")}₽`
            : "";
          const caption = `${p.name}${price}`.slice(0, 20);
          return { type: "text", title: caption, payload: p.name };
        });
      }
    } catch (err) {
      console.error("Firestore Error:", err);
    }

    const fullSystemPrompt = `ДАННЫЕ О БРЕНДЕ:
${knowledgeBase}

КАТАЛОГ (ID для SHOW_IMAGE):
${catalogInfo}
${examplesBlock}

ГЛАВНАЯ ИНСТРУКЦИЯ:
${systemPrompt}`;

    console.log("Full System Prompt Length:", fullSystemPrompt.length);
    console.log("Using systemPrompt from DB:", systemPrompt.slice(0, 50) + "...");

    const apiKey = dbApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан");

    const anthropic = new Anthropic({ apiKey });
    let rawText = "";

    console.log(`Attempting Claude API call...`);
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: fullSystemPrompt,
      messages: [{ role: "user", content: input }]
    });
    rawText = message.content[0].type === "text" ? message.content[0].text : "";
    if (!rawText) throw new Error("Пустой ответ от Claude");

    console.log(`Claude success! Response length: ${rawText.length}`);

    const imageMatch = rawText.match(/\[SHOW_IMAGE:\s*([^\]]+)\]/i);
    const cleanText = rawText
      .replace(/\[SHOW_IMAGE:\s*[^\]]+\]/gi, "")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$2") // убрать markdown ссылки
      .trim();

    const messages: any[] = [{ type: "text", text: cleanText }];
    let imageUrl: string | null = null;
    let productName: string | null = null;

    if (imageMatch) {
      const productIdOrName = imageMatch[1].trim();
      let product = productMap.get(productIdOrName);
      
      // Try name-based lookup if direct ID lookup failed
      if (!product) {
        product = productMap.get(productIdOrName.toLowerCase());
      }

      productName = product?.name || null;

      if (productName) {
        await updateDoc(contactRef, {
          lastProduct: productName
        }).catch(() => {});
      }

      console.log(`Image tag found: "${productIdOrName}". Product found:`, !!product);

      // Add buttons if the product has multi-post links
      if (product?.posts && product.posts.length > 0) {
        // ManyChat/Instagram support up to 3 buttons in a single message
        const buttons = product.posts.slice(0, 3).map((p: any) => ({
          type: "url",
          caption: p.name.slice(0, 20),
          url: p.url
        }));
        
        // Attach buttons to the text message
        messages[0].buttons = buttons;
      }

      if (product?.photos?.length > 0) {
        const directUrl = product.photos.find((p: string) =>
          p.startsWith("http") || p.startsWith("data:image")
        );
        if (directUrl) {
          if (directUrl.startsWith("http")) {
            imageUrl = directUrl;
          } else {
            const protocol = req.headers["x-forwarded-proto"] || req.protocol;
            const host = req.headers["x-forwarded-host"] || req.get("host");
            // Use product.id to ensure we use the actual Firestore ID
            imageUrl = `${protocol}://${host}/api/products/${product.id}/image`;
          }
        }
      }
      if (!imageUrl) console.warn(`Product matched but has no valid photo URL`);
    }

    // Сохранить лог в базу
    try {
      await addDoc(collection(db, "ai_logs"), {
        userId: uid,
        input: input,
        response: cleanText,
        productMentioned: productName || null,
        timestamp: new Date().toISOString(),
        status: "success"
      });
    } catch (logErr) {
      console.error("Failed to save log:", logErr);
    }

    const showCatalogButtons =
      input.length < 20 ||
      /цена|каталог|ассортимент|что есть|покажи|привет|здравствуй|добрый|хочу|интересует/i.test(input);

    const hasButtons = messages.some((m: any) => m.buttons && m.buttons.length > 0);

    const responseData: any = {
      version: "v2",
      content: {
        messages,
        actions: productName ? [
          {action: "set_field", field_name: "ai_product", value: productName}
        ] : [],
        quick_replies: (hasButtons || !showCatalogButtons || quickReplies.length === 0) ? undefined : quickReplies
      },
      type: "success",
      debug_v: "v2.0_logs_and_contacts"
    };

    if (imageUrl) responseData.photo_url = imageUrl;

    console.log("ManyChat response:", JSON.stringify(responseData, null, 2));

    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify(responseData));

  } catch (error: any) {
    console.error("API Error:", error);
    
    try {
      await addDoc(collection(db, "ai_logs"), {
        userId: uid,
        input: input,
        response: error.message,
        timestamp: new Date().toISOString(),
        status: "error"
      });
    } catch {}

    return res.status(200).json({
      version: "v2",
      content: {
        messages: [{ type: "text", text: "Ошибка ИИ: " + (error.message || "неизвестная ошибка") }]
      }
    });
  }
});

app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global error:", err);
  res.status(500).json({ error: `Ошибка сервера: ${err.message}` });
});

// ─── Costume catalog API ─────────────────────────────────────────────────────

app.get("/api/bot/costumes", async (req, res) => {
  try {
    if (!db) return res.json([]);
    const snap = await getDocs(collection(db, "costumes"));
    const costumes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(costumes);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/bot/costumes", async (req, res) => {
  const { name, imageUrl, imageUrls, category } = req.body;
  if (!name || (!imageUrl && !imageUrls?.length)) return res.status(400).json({ error: "Нужны name и imageUrls" });
  try {
    if (!db) return res.status(500).json({ error: "DB not connected" });
    const urls: string[] = imageUrls?.length ? imageUrls : [imageUrl];
    const docRef = await addDoc(collection(db, "costumes"), {
      name, imageUrl: urls[0], imageUrls: urls, category: category || "Костюм",
      addedAt: new Date().toISOString(),
    });
    costumesCache = null; // invalidate cache
    res.json({ success: true, id: docRef.id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/bot/costumes/:id", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "DB not connected" });
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "costumes", req.params.id));
    costumesCache = null;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.put("/api/bot/costumes/:id", async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "DB not connected" });
    const { name, imageUrls } = req.body;
    const updates: any = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (imageUrls?.length) { updates.imageUrls = imageUrls; updates.imageUrl = imageUrls[0]; }
    await setDoc(doc(db, "costumes", req.params.id), updates, { merge: true });
    costumesCache = null;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Bot API endpoints ───────────────────────────────────────────────────────

let botBroadcastRunning = false;

app.post("/api/bot/broadcast", async (req, res) => {
  const validated = validateBotBroadcastMessage(req.body?.message);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (!botInstance) return res.status(503).json({ error: "Бот не запущен" });

  let userIds = normalizeBotSubscriberIds(req.body?.userIds);
  if (req.body?.audience === "all" || userIds.length === 0) {
    try {
      if (adminDb) {
        const subscribersSnap = await adminDb.collection("bot_subscribers").get();
        userIds = normalizeBotSubscriberIds(subscribersSnap.docs.map((item: any) => item.id));
      } else if (db) {
        const subscribersSnap = await getDocs(collection(db, "bot_subscribers"));
        userIds = normalizeBotSubscriberIds(subscribersSnap.docs.map(item => item.id));
      } else {
        return res.status(500).json({ error: "База подписчиков недоступна" });
      }
    } catch (error) {
      console.error("[bot-broadcast] subscribers load failed", error);
      return res.status(500).json({ error: "Не удалось загрузить подписчиков бота" });
    }
  }
  if (userIds.length === 0) return res.status(400).json({ error: "У бота пока нет подписчиков" });
  if (botBroadcastRunning) return res.status(409).json({ error: "Предыдущая рассылка ещё выполняется" });

  botBroadcastRunning = true;
  try {
    let sent = 0, failed = 0;
    for (const uid of userIds) {
      try {
        await botInstance.telegram.sendMessage(uid, validated.message);
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch { failed++; }
    }

    const historyItem = {
      message: validated.message,
      audience: "all",
      recipientCount: userIds.length,
      sent,
      failed,
      createdAt: new Date().toISOString(),
      status: failed === 0 ? "sent" : sent > 0 ? "partial" : "failed",
    };
    let id = "";
    try {
      if (adminDb) id = (await adminDb.collection("bot_broadcasts").add(historyItem)).id;
      else if (db) id = (await addDoc(collection(db, "bot_broadcasts"), historyItem)).id;
    } catch (error) {
      console.error("[bot-broadcast] history save failed", error);
    }
    res.json({ success: true, id, sent, failed, total: userIds.length, createdAt: historyItem.createdAt });
  } finally {
    botBroadcastRunning = false;
  }
});

app.get("/api/bot/broadcasts", async (_req, res) => {
  try {
    if (adminDb) {
      const snapshot = await adminDb.collection("bot_broadcasts").orderBy("createdAt", "desc").limit(20).get();
      return res.json(snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() })));
    }
    if (!db) return res.status(500).json({ error: "База рассылок недоступна" });
    const snapshot = await getDocs(query(collection(db, "bot_broadcasts"), orderBy("createdAt", "desc")));
    res.json(snapshot.docs.slice(0, 20).map(item => ({ id: item.id, ...item.data() })));
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Не удалось загрузить историю рассылок" });
  }
});

app.post("/api/bot/config", async (req, res) => {
  const { welcomeText } = req.body;
  if (welcomeText) {
    botCfg.welcomeText = welcomeText; // update in-memory immediately
    if (db) await setDoc(doc(db, "settings", "bot_config"), { welcomeText }, { merge: true });
  }
  res.json({ success: true });
});

app.get("/api/bot/buttons", async (_req, res) => {
  res.json({ ...botCfg, buttons: cleanBotButtons(botCfg.buttons) });
});

app.post("/api/bot/buttons", async (req, res) => {
  const { buttons, welcomeText, managerChatIds } = req.body;
  if (buttons) botCfg.buttons = cleanBotButtons(buttons);
  if (welcomeText !== undefined) botCfg.welcomeText = welcomeText;
  if (managerChatIds !== undefined) botCfg.managerChatIds = parseManagerChatIds(managerChatIds);
  if (db) await setDoc(doc(db, "settings", "bot_buttons"), { buttons: botCfg.buttons, welcomeText: botCfg.welcomeText, managerChatIds: botCfg.managerChatIds }, { merge: true });
  res.json({ success: true });
});

app.get("/api/bot/manager-config", async (_req, res) => {
  res.json({ managerChatIds: botCfg.managerChatIds || [] });
});

app.post("/api/bot/manager-config", async (req, res) => {
  const managerChatIds = parseManagerChatIds(req.body?.managerChatIds);
  botCfg.managerChatIds = managerChatIds;
  if (db) await setDoc(doc(db, "settings", "bot_manager_config"), { managerChatIds }, { merge: true });
  res.json({ success: true });
});

app.post("/api/bot/reply", async (req, res) => {
  const { userId, message } = req.body;
  if (!botInstance) return res.status(503).json({ error: "Бот не запущен" });
  try {
    await botInstance.telegram.sendMessage(userId, message);
    if (adminDb) {
      await adminDb.collection("bot_messages").add({
        userId: String(userId),
        text: String(message),
        direction: "outgoing",
        receivedAt: new Date().toISOString(),
        replied: true,
      });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Content Studio ─────────────────────────────────────────────────────────

// Pinterest: extract og:image from pin URL
app.post("/api/content/pinterest", async (req, res) => {
  const { url } = req.body;
  try {
    const html = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      timeout: 10000,
    }).then(r => r.data as string);
    const match = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (!match) return res.status(404).json({ error: "Не удалось найти изображение на Pinterest" });
    res.json({ imageUrl: match[1] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy: download external image and return as base64 (for Pinterest og:image URLs)
app.post("/api/content/pinterest-image", async (req, res) => {
  const { url } = req.body;
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const base64 = Buffer.from(resp.data).toString("base64");
    res.json({ base64 });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Process: generate try-on image + caption via Gemini
app.post("/api/content/process", async (req, res) => {
  const { modelBase64, lookBase64 } = req.body;
  if (!modelBase64 || !lookBase64) return res.status(400).json({ error: "Нужны оба фото" });
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY не задан" });
    const ai = new GoogleGenAI({ apiKey });

    // Generate try-on image
    const imgResp = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [{ role: "user", parts: [
        { text: "You are a virtual try-on AI. Replace the clothing on the person in the SECOND image with the exact garment from the FIRST image. Keep face, pose, background, lighting identical. Only swap the clothing. Photorealistic result." },
        { inlineData: { mimeType: "image/jpeg", data: lookBase64 } },
        { inlineData: { mimeType: "image/jpeg", data: modelBase64 } },
      ] as any }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    let generatedBase64: string | null = null;
    for (const part of (imgResp as any).candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        const buf = await sharp(Buffer.from(part.inlineData.data, "base64"))
          .resize(1080, 1350, { fit: "cover", position: "center" })
          .jpeg({ quality: 95 }).toBuffer();
        generatedBase64 = buf.toString("base64");
        break;
      }
    }
    if (!generatedBase64) return res.status(500).json({ error: "Gemini не сгенерировал изображение" });

    // Generate caption + hashtags
    const captionResp = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: "user", parts: [
        { text: "Ты SMM-специалист fashion-бренда YB Studio. Создай цепляющий пост для Instagram на русском языке для этого образа. Формат: 2-3 строки текста + 10-15 хэштегов. Только текст поста, без пояснений." },
        { inlineData: { mimeType: "image/jpeg", data: lookBase64 } },
      ] as any }],
    });
    const caption = (captionResp as any).candidates?.[0]?.content?.parts?.[0]?.text || "";

    res.json({ generatedBase64, caption });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Save to content queue
app.post("/api/content/queue", async (req, res) => {
  const { generatedBase64, caption, modelUrl, lookUrl } = req.body;
  if ((!adminDb && !db) || !fbStorage) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    // Upload generated image to Firebase Storage
    const imgBuf = Buffer.from(generatedBase64, "base64");
    const sRef = storageRef(fbStorage, `content/${Date.now()}_generated.jpg`);
    await fbUploadBytes(sRef, imgBuf, { contentType: "image/jpeg" });
    const generatedUrl = await fbGetDownloadURL(sRef);

    const payload = {
      status: "queue",
      generatedUrl,
      modelUrl: modelUrl || "",
      lookUrl: lookUrl || "",
      caption,
      createdAt: new Date().toISOString(),
    };
    const docRef = adminDb
      ? await adminDb.collection("content_queue").add(payload)
      : await addDoc(collection(db, "content_queue"), payload);
    res.json({ id: docRef.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get queue
app.get("/api/content/queue", async (_req, res) => {
  if (!adminDb && !db) return res.json([]);
  try {
    const snap = adminDb
      ? await adminDb.collection("content_queue").orderBy("createdAt", "desc").get()
      : await getDocs(query(collection(db, "content_queue"), orderBy("createdAt", "desc")));
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Update caption
app.patch("/api/content/queue/:id", async (req, res) => {
  if (!adminDb && !db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    if (adminDb) await adminDb.collection("content_queue").doc(req.params.id).set({ caption: req.body.caption }, { merge: true });
    else await updateDoc(doc(db, "content_queue", req.params.id), { caption: req.body.caption });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Delete from queue
app.delete("/api/content/queue/:id", async (req, res) => {
  if (!adminDb && !db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    if (adminDb) await adminDb.collection("content_queue").doc(req.params.id).delete();
    else await deleteDoc(doc(db, "content_queue", req.params.id));
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Publish to Instagram
app.post("/api/content/publish/:id", async (req, res) => {
  if (!adminDb && !db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    const snap = adminDb
      ? await adminDb.collection("content_queue").doc(req.params.id).get()
      : await getDoc(doc(db, "content_queue", req.params.id));
    if (!snap.exists()) return res.status(404).json({ error: "Не найдено" });
    const item = snap.data() as any;

    // Get Instagram settings
    const cfgSnap = adminDb
      ? await adminDb.collection("settings").doc("instagram").get()
      : await getDoc(doc(db, "settings", "instagram"));
    const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
    const accessToken = cfg.accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
    const igUserId = cfg.userId || process.env.INSTAGRAM_USER_ID;
    if (!accessToken || !igUserId) return res.status(400).json({ error: "Instagram не настроен. Добавь Access Token и User ID в настройках." });

    // Step 1: Create media container
    const createResp = await axios.post(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/${igUserId}/media`,
      { image_url: item.generatedUrl, caption: item.caption, access_token: accessToken }
    );
    const creationId = createResp.data.id;

    // Step 2: Publish
    const publishResp = await axios.post(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/${igUserId}/media_publish`,
      { creation_id: creationId, access_token: accessToken }
    );
    const instagramPostId = publishResp.data.id;

    const publishedPatch = {
      status: "published",
      instagramPostId,
      publishedAt: new Date().toISOString(),
    };
    if (adminDb) await adminDb.collection("content_queue").doc(req.params.id).set(publishedPatch, { merge: true });
    else await updateDoc(doc(db, "content_queue", req.params.id), publishedPatch);
    res.json({ success: true, instagramPostId });
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Save Instagram settings
app.post("/api/content/instagram-settings", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  const { accessToken, userId } = req.body;
  try {
    await setDoc(doc(db, "settings", "instagram"), { accessToken, userId }, { merge: true });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Instagram Graph / Meta OAuth ───────────────────────────────────────────

// Meta's current Instagram API examples return v23.0. Older v21 responses can
// silently omit newer Insights fields and behave incorrectly on Instagram
// Login conversation edges.
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const META_DEFAULT_PAGE_ID = process.env.META_FACEBOOK_PAGE_ID || "125330923998398";
const META_DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_insights",
  "instagram_content_publish",
].join(",");
const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
  "instagram_business_content_publish",
].join(",");
const INSTAGRAM_GRAPH_BASE_URL = "https://graph.instagram.com";
const INSTAGRAM_WEBHOOK_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "ybcrm-instagram-2026";

function publicBaseUrl(req?: any) {
  const fromEnv = process.env.WEBHOOK_URL || process.env.SERVER_URL || process.env.PUBLIC_BASE_URL || MCP_PUBLIC_BASE_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");
  if (req) {
    const proto = req.headers?.["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "https://ybcrm.ru";
}

function safeInstagramSettings(raw: any) {
  const data = raw || {};
  return {
    configured: Boolean((data.appId && data.appSecret) || data.accessToken),
    connected: Boolean(data.instagramUserId && data.accessToken),
    authMode: data.authMode || (data.accessToken && !data.appId ? "token" : "oauth"),
    apiMode: data.apiMode || (String(data.accessToken || "").startsWith("IG") ? "instagram_login" : "facebook_login"),
    appIdPreview: data.appId ? `${String(data.appId).slice(0, 5)}...${String(data.appId).slice(-4)}` : "",
    tokenPreview: data.accessToken ? `${String(data.accessToken).slice(0, 8)}...${String(data.accessToken).slice(-6)}` : "",
    redirectUri: data.redirectUri || `${publicBaseUrl()}/api/instagram/oauth/callback`,
    scopes: data.scopes || (data.apiMode === "instagram_login" ? INSTAGRAM_LOGIN_SCOPES : META_DEFAULT_SCOPES),
    pageId: data.pageId || "",
    pageName: data.pageName || "",
    instagramUserId: data.instagramUserId || "",
    instagramUsername: data.instagramUsername || "",
    followersCount: Number(data.followersCount || 0),
    mediaCount: Number(data.mediaCount || 0),
    tokenExpiresAt: data.tokenExpiresAt || "",
    connectedAt: data.connectedAt || "",
    lastCheckAt: data.lastCheckAt || "",
  };
}

async function getInstagramGraphSettings() {
  if (adminDb) {
    const snap = await adminDb.collection("settings").doc("instagram_graph").get();
    return snap.exists ? snap.data() : {};
  }
  if (!db) return {};
  const snap = await getDoc(doc(db, "settings", "instagram_graph"));
  return snap.exists() ? snap.data() : {};
}

async function saveInstagramGraphSettings(data: any) {
  if (adminDb) {
    await adminDb.collection("settings").doc("instagram_graph").set(data, { merge: true });
    return;
  }
  if (!db) throw new Error("Firebase не инициализирован");
  await setDoc(doc(db, "settings", "instagram_graph"), data, { merge: true });
}

async function saveInstagramContentSettings(data: any) {
  if (adminDb) {
    await adminDb.collection("settings").doc("instagram").set(data, { merge: true });
    return;
  }
  if (!db) throw new Error("Firebase не инициализирован");
  await setDoc(doc(db, "settings", "instagram"), data, { merge: true });
}

function graphErrorMessage(error: any) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "Ошибка Instagram Graph";
}

async function findInstagramPage(accessToken: string, preferredPageId = META_DEFAULT_PAGE_ID) {
  const fields = "id,name,access_token,instagram_business_account{id,username}";
  const { data } = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`, {
    params: { access_token: accessToken, fields, limit: 100 },
  });
  const pages = Array.isArray(data?.data) ? data.data : [];
  const managedPage = pages.find((item: any) => item.instagram_business_account);
  if (managedPage?.instagram_business_account?.id) return managedPage;

  // Some Business Portfolio tokens can open an assigned Page directly while
  // /me/accounts still returns an empty list. Use the configured Page as fallback.
  if (preferredPageId) {
    const pageResponse = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${preferredPageId}`, {
      params: { access_token: accessToken, fields },
    });
    if (pageResponse.data?.instagram_business_account?.id) return pageResponse.data;
  }
  return null;
}

async function resolveInstagramByToken(accessToken: string, preferredPageId = META_DEFAULT_PAGE_ID) {
  const token = accessToken
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  const errors: string[] = [];
  const connectedAt = new Date().toISOString();

  const buildResult = (source: string, account: any, tokenForContent = token, page?: any) => ({
    source,
    tokenForContent,
    payload: {
      authMode: "token",
      apiMode: source === "instagram_token" ? "instagram_login" : "facebook_login",
      source,
      accessToken: token,
      pageAccessToken: page?.access_token || "",
      pageId: page?.id || "",
      pageName: page?.name || "",
      instagramUserId: account.user_id || account.id,
      instagramUsername: account.username || account.name || "",
      profilePictureUrl: account.profile_picture_url || "",
      followersCount: Number(account.followers_count || 0),
      mediaCount: Number(account.media_count || 0),
      accountType: account.account_type || "",
      scopes: source === "instagram_token" ? INSTAGRAM_LOGIN_SCOPES : META_DEFAULT_SCOPES,
      tokenExpiresAt: "",
      connectedAt,
      lastCheckAt: connectedAt,
    },
    account,
  });

  // New Instagram Login tokens (IGAA...) use graph.instagram.com.
  for (const endpoint of [
    `https://graph.instagram.com/${META_GRAPH_VERSION}/me`,
    "https://graph.instagram.com/me",
  ]) {
    try {
      const { data } = await axios.get(endpoint, {
        params: { fields: "id,user_id,username,account_type", access_token: token },
      });
      if (data?.user_id || data?.id) return buildResult("instagram_token", data);
    } catch (error) {
      errors.push(`Instagram Login: ${graphErrorMessage(error)}`);
    }
  }

  // Classic Instagram Graph tokens can resolve /me directly to the IG account.
  try {
    const { data: identity } = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/me`, {
      params: { fields: "id,name", access_token: token },
    });
    if (identity?.id) {
      try {
        const { data: account } = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${identity.id}`, {
          params: {
            fields: "id,username,name,followers_count,media_count",
            access_token: token,
          },
        });
        if (account?.id && account?.username) return buildResult("instagram_graph_token", account);
      } catch (error) {
        errors.push(`Instagram Graph account: ${graphErrorMessage(error)}`);
      }
    }
  } catch (error) {
    errors.push(`Facebook Graph identity: ${graphErrorMessage(error)}`);
  }

  // Facebook user tokens expose Instagram through a managed Facebook Page.
  try {
    const page = await findInstagramPage(token, preferredPageId);
    if (page?.instagram_business_account?.id) {
      const contentToken = page.access_token || token;
      let account = page.instagram_business_account;
      try {
        const accountResponse = await axios.get(
          `https://graph.facebook.com/${META_GRAPH_VERSION}/${account.id}`,
          { params: { access_token: contentToken, fields: "id,username,name,followers_count,media_count" } },
        );
        account = { ...account, ...accountResponse.data };
      } catch (metricsError) {
        errors.push(`Instagram metrics: ${graphErrorMessage(metricsError)}`);
      }
      return buildResult("facebook_page_token", account, contentToken, page);
    }
    errors.push("Facebook Page: Instagram Business аккаунт не найден");
  } catch (error) {
    errors.push(`Facebook Page: ${graphErrorMessage(error)}`);
  }

  throw new Error(errors.join(". "));
}

app.get("/api/instagram/status", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    const settings = await getInstagramGraphSettings();
    const status = safeInstagramSettings(settings);
    if (!settings.redirectUri) status.redirectUri = `${publicBaseUrl(req)}/api/instagram/oauth/callback`;
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/instagram/save-app", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  const appId = String(req.body?.appId || "").trim();
  const redirectUri = String(req.body?.redirectUri || "").trim() || `${publicBaseUrl(req)}/api/instagram/oauth/callback`;
  const scopes = String(req.body?.scopes || "").trim() || META_DEFAULT_SCOPES;
  const existing: any = await getInstagramGraphSettings();
  const appSecret = String(req.body?.appSecret || "").trim() || existing.appSecret || "";
  if (!appId || !appSecret) return res.status(400).json({ error: "Нужны Meta App ID и App Secret" });
  try {
    const nextSettings = {
      ...existing,
      appId,
      appSecret,
      redirectUri,
      scopes,
      updatedAt: new Date().toISOString(),
    };
    await saveInstagramGraphSettings({
      appId,
      appSecret,
      redirectUri,
      scopes,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, ...safeInstagramSettings(nextSettings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/instagram/save-token", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  const accessToken = String(req.body?.accessToken || "").trim();
  if (!accessToken) return res.status(400).json({ error: "Вставь Instagram Access Token" });
  try {
    const existing: any = await getInstagramGraphSettings();
    const resolved = await resolveInstagramByToken(accessToken, existing.pageId || META_DEFAULT_PAGE_ID);
    await saveInstagramGraphSettings({
      ...resolved.payload,
      updatedAt: new Date().toISOString(),
    });
    await saveInstagramContentSettings({
      accessToken: resolved.tokenForContent,
      userId: resolved.payload.instagramUserId,
      source: resolved.source,
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true, source: resolved.source, account: resolved.account, ...safeInstagramSettings(resolved.payload) });
  } catch (e: any) {
    res.status(500).json({ error: graphErrorMessage(e) });
  }
});

app.get("/api/instagram/oauth/start", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    const settings: any = await getInstagramGraphSettings();
    const appId = settings.appId || process.env.META_APP_ID;
    const appSecret = settings.appSecret || process.env.META_APP_SECRET;
    const redirectUri = settings.redirectUri || `${publicBaseUrl(req)}/api/instagram/oauth/callback`;
    const scopes = settings.scopes || META_DEFAULT_SCOPES;
    if (!appId || !appSecret) return res.status(400).json({ error: "Сначала сохрани Meta App ID и App Secret" });
    const state = randomBytes(18).toString("hex");
    await saveInstagramGraphSettings({ oauthState: state, oauthStateCreatedAt: new Date().toISOString(), redirectUri, scopes });
    const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("response_type", "code");
    res.json({ url: url.toString(), redirectUri, scopes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/instagram/oauth/callback", async (req, res) => {
  if (!db) return res.status(503).send("Firebase не инициализирован");
  try {
    const settings: any = await getInstagramGraphSettings();
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code) throw new Error("Meta не вернула code");
    if (settings.oauthState && state !== settings.oauthState) throw new Error("OAuth state не совпал. Попробуй подключить заново.");

    const appId = settings.appId || process.env.META_APP_ID;
    const appSecret = settings.appSecret || process.env.META_APP_SECRET;
    const redirectUri = settings.redirectUri || `${publicBaseUrl(req)}/api/instagram/oauth/callback`;
    if (!appId || !appSecret) throw new Error("Meta App ID / Secret не настроены");

    const shortTokenResp = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
      params: { client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code },
    });
    const shortToken = shortTokenResp.data?.access_token;
    if (!shortToken) throw new Error("Meta не вернула access_token");

    let longToken = shortToken;
    let expiresIn = Number(shortTokenResp.data?.expires_in || 0);
    try {
      const longTokenResp = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        },
      });
      longToken = longTokenResp.data?.access_token || shortToken;
      expiresIn = Number(longTokenResp.data?.expires_in || expiresIn || 0);
    } catch (exchangeError) {
      console.warn("[instagram] long token exchange skipped:", graphErrorMessage(exchangeError));
    }

    const page = await findInstagramPage(longToken, settings.pageId || META_DEFAULT_PAGE_ID);
    if (!page?.instagram_business_account?.id) {
      throw new Error("У подключенных Facebook-страниц не найден Instagram Business аккаунт. Проверь, что Instagram привязан к Page и аккаунт Business/Creator.");
    }

    const ig = page.instagram_business_account;
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : "";
    const payload = {
      appId,
      appSecret,
      redirectUri,
      scopes: settings.scopes || META_DEFAULT_SCOPES,
      accessToken: longToken,
      pageAccessToken: page.access_token || longToken,
      tokenExpiresAt,
      pageId: page.id,
      pageName: page.name || "",
      instagramUserId: ig.id,
      instagramUsername: ig.username || "",
      profilePictureUrl: ig.profile_picture_url || "",
      followersCount: Number(ig.followers_count || 0),
      mediaCount: Number(ig.media_count || 0),
      oauthState: "",
      connectedAt: new Date().toISOString(),
      lastCheckAt: new Date().toISOString(),
    };
    await saveInstagramGraphSettings(payload);
    await saveInstagramContentSettings({
      accessToken: payload.pageAccessToken,
      userId: payload.instagramUserId,
      source: "instagram_graph",
      updatedAt: new Date().toISOString(),
    });

    res.send(`
      <!doctype html>
      <html lang="ru">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram подключен</title></head>
        <body style="font-family:Inter,Arial,sans-serif;background:#f6f7f9;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0">
          <main style="background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:28px;max-width:520px;box-shadow:0 16px 40px rgba(31,41,55,.08)">
            <p style="letter-spacing:.16em;text-transform:uppercase;color:#2EBA7F;font-weight:700;font-size:12px">Instagram Graph</p>
            <h1 style="margin:8px 0 10px;font-size:28px">Подключено</h1>
            <p style="color:#6B7280;line-height:1.5">Аккаунт @${payload.instagramUsername || payload.instagramUserId} привязан к CRM. Можно закрыть это окно и вернуться на страницу интеграций.</p>
            <a href="/integrations" style="display:inline-flex;margin-top:18px;background:#1f2937;color:#fff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">Вернуться в CRM</a>
          </main>
        </body>
      </html>
    `);
  } catch (e: any) {
    res.status(500).send(`
      <!doctype html>
      <html lang="ru">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram ошибка</title></head>
        <body style="font-family:Inter,Arial,sans-serif;background:#f6f7f9;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0">
          <main style="background:#fff;border:1px solid #fee2e2;border-radius:14px;padding:28px;max-width:560px;box-shadow:0 16px 40px rgba(31,41,55,.08)">
            <p style="letter-spacing:.16em;text-transform:uppercase;color:#F06B6B;font-weight:700;font-size:12px">Instagram Graph</p>
            <h1 style="margin:8px 0 10px;font-size:28px">Не подключилось</h1>
            <p style="color:#6B7280;line-height:1.5">${graphErrorMessage(e)}</p>
            <a href="/integrations" style="display:inline-flex;margin-top:18px;background:#1f2937;color:#fff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700">Вернуться в CRM</a>
          </main>
        </body>
      </html>
    `);
  }
});

app.post("/api/instagram/test", async (_req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    const settings: any = await getInstagramGraphSettings();
    const accessToken = settings.pageAccessToken || settings.accessToken;
    const igUserId = settings.instagramUserId;
    if (!accessToken || !igUserId) return res.status(400).json({ error: "Instagram Graph еще не подключен" });
    let data: any;
    try {
      const resp = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${igUserId}`, {
        params: {
          fields: "id,username,name,followers_count,media_count",
          access_token: accessToken,
        },
      });
      data = resp.data;
    } catch (facebookError) {
      const resp = await axios.get("https://graph.instagram.com/me", {
        params: {
          fields: "id,username,name,account_type,media_count",
          access_token: accessToken,
        },
      });
      data = resp.data;
    }
    await saveInstagramGraphSettings({
      instagramUsername: data.username || settings.instagramUsername || "",
      followersCount: Number(data.followers_count || 0),
      mediaCount: Number(data.media_count || 0),
      lastCheckAt: new Date().toISOString(),
    });
    res.json({ success: true, account: data });
  } catch (e: any) {
    res.status(500).json({ error: graphErrorMessage(e) });
  }
});

app.post("/api/instagram/disconnect", async (_req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    await saveInstagramGraphSettings({
      accessToken: "",
      pageAccessToken: "",
      tokenExpiresAt: "",
      pageId: "",
      pageName: "",
      instagramUserId: "",
      instagramUsername: "",
      profilePictureUrl: "",
      followersCount: 0,
      mediaCount: 0,
      connectedAt: "",
      lastCheckAt: "",
      disconnectedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Instagram Direct inbox ────────────────────────────────────────────────

function normalizeInstagramHandle(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

async function instagramInboxCredentials() {
  const settings: any = await getInstagramGraphSettings();
  const mainAccessToken = String(settings.accessToken || "").trim();
  const apiMode: "instagram_login" | "facebook_login" = settings.apiMode === "instagram_login" || settings.source === "instagram_token" || /^IG/i.test(mainAccessToken)
    ? "instagram_login"
    : "facebook_login";
  const instagramUserId = String(settings.instagramUserId || "").trim();

  if (apiMode === "instagram_login") {
    if (!mainAccessToken || !instagramUserId) {
      throw new Error("Instagram Login не подключен. Вставь токен IGAA… в разделе API.");
    }
    return {
      settings,
      apiMode,
      accessTokens: [mainAccessToken],
      pageId: "",
      instagramUserId,
    };
  }

  // A valid Facebook user token is not necessarily enabled for Instagram
  // Direct. Meta otherwise returns a misleading "Page Access Token" error.
  if (mainAccessToken) {
    try {
      const permissionsResponse = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`, {
        params: { access_token: mainAccessToken },
        timeout: 10_000,
      });
      const granted = new Set((permissionsResponse.data?.data || [])
        .filter((item: any) => item?.status === "granted")
        .map((item: any) => String(item?.permission || "")));
      const missing = ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"]
        .filter((permission) => !granted.has(permission));
      if (missing.length) {
        throw new Error(`Токен обновлён, но для Instagram Direct не выданы разрешения: ${missing.join(", ")}. Создай токен с этими разрешениями и сохрани его заново.`);
      }
    } catch (error: any) {
      // Preserve our actionable permission error. A failed diagnostic request
      // itself should not replace the actual Graph request below.
      if (String(error?.message || "").startsWith("Токен обновлён")) throw error;
    }
  }

  // Keep both tokens. A Page token can expire independently while the
  // long-lived user token is still valid, so Direct requests must be able to
  // fall back instead of failing just because pageAccessToken was saved first.
  const tokenCandidates = [settings.pageAccessToken, mainAccessToken];
  const pageId = settings.pageId || META_DEFAULT_PAGE_ID;

  // /me/accounts may be empty for Business Portfolio tokens. Refresh the Page
  // token directly from the known Page before every inbox sync.
  if (mainAccessToken && pageId) {
    try {
      const pageResponse = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}`, {
        params: { access_token: mainAccessToken, fields: "access_token" },
        timeout: 10_000,
      });
      if (pageResponse.data?.access_token) tokenCandidates.unshift(pageResponse.data.access_token);
    } catch (error) {
      console.warn("[instagram] page token refresh:", graphErrorMessage(error));
    }
  }

  const accessTokens = [...new Set(tokenCandidates
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!accessTokens.length || !pageId || !instagramUserId) {
    throw new Error("Instagram Direct не подключен. Сначала подключи Instagram Graph в разделе API.");
  }
  return { settings, apiMode, accessTokens, pageId, instagramUserId };
}

async function withInstagramTokenFallback<T>(accessTokens: string[], request: (accessToken: string) => Promise<T>) {
  let lastError: any;
  let pageTokenError: any;
  for (const accessToken of accessTokens) {
    try {
      return await request(accessToken);
    } catch (error) {
      lastError = error;
      const message = graphErrorMessage(error);
      if (!/must be called with a Page Access Token/i.test(message)) pageTokenError ||= error;
    }
  }
  throw pageTokenError || lastError || new Error("Meta не приняла сохранённые токены Instagram");
}

type InstagramGraphContext = {
  apiMode: "instagram_login" | "facebook_login";
  accessTokens: string[];
  instagramUserId: string;
  baseUrl: string;
};

async function instagramGraphContext(): Promise<InstagramGraphContext> {
  const { apiMode, accessTokens, instagramUserId } = await instagramInboxCredentials();
  return {
    apiMode,
    accessTokens,
    instagramUserId,
    baseUrl: apiMode === "instagram_login" ? INSTAGRAM_GRAPH_BASE_URL : "https://graph.facebook.com",
  };
}

async function instagramGraphGet<T = any>(
  context: InstagramGraphContext,
  path: string,
  params: Record<string, any> = {},
): Promise<T> {
  return withInstagramTokenFallback(context.accessTokens, async (accessToken) => {
    const response = await axios.get(`${context.baseUrl}/${META_GRAPH_VERSION}/${path.replace(/^\//, "")}`, {
      params: { ...params, access_token: accessToken },
      timeout: 25_000,
    });
    return response.data as T;
  });
}

async function socialHubSettings() {
  if (!adminDb) return {} as Record<string, any>;
  const snapshot = await adminDb.collection("settings").doc("social_hub").get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

app.get("/api/social/channels", async (_req, res) => {
  try {
    const instagram = safeInstagramSettings(await getInstagramGraphSettings());
    const settings = await socialHubSettings();
    const telegramAccounts = (await readTgAccounts()).filter((account: any) => account.sessionString && account.active !== false && account.inboxEnabled === true);
    res.json({
      channels: [
        {
          id: "instagram",
          name: "Instagram",
          connected: Boolean(instagram.connected),
          username: instagram.instagramUsername || "",
          canPublish: Boolean(instagram.connected),
          canMessage: Boolean(instagram.connected),
        },
        {
          id: "telegram",
          name: "Telegram",
          connected: Boolean(process.env.TG_BOT_TOKEN),
          username: settings.telegramChannelName || "",
          destination: settings.telegramChatId || "",
          canPublish: Boolean(process.env.TG_BOT_TOKEN && settings.telegramChatId),
          canMessage: Boolean(process.env.TG_BOT_TOKEN),
        },
        {
          id: "telegram_account",
          name: "Telegram менеджера",
          connected: telegramAccounts.length > 0,
          username: telegramAccounts.map((account: any) => account.phone).join(", "),
          canPublish: false,
          canMessage: telegramAccounts.length > 0,
        },
        { id: "whatsapp", name: "WhatsApp", connected: false, canPublish: false, canMessage: false },
        { id: "vk", name: "VK", connected: false, canPublish: false, canMessage: false },
        { id: "max", name: "MAX", connected: false, canPublish: false, canMessage: false },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Не удалось проверить соцсети" });
  }
});

app.post("/api/social/settings", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  if (!adminDb) return res.status(503).json({ error: "Серверная база не подключена" });
  const telegramChatId = String(req.body?.telegramChatId || "").trim();
  const telegramChannelName = String(req.body?.telegramChannelName || "").trim();
  await adminDb.collection("settings").doc("social_hub").set({
    telegramChatId,
    telegramChannelName,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ success: true });
});

app.post("/api/social/publish", async (req, res) => {
  const user: any = await requireCrmUser(req, res);
  if (!user) return;
  const text = String(req.body?.text || "").trim();
  const imageUrl = String(req.body?.imageUrl || "").trim();
  const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String) : [];
  if (!text && !imageUrl) return res.status(400).json({ error: "Добавь текст или изображение" });
  if (!channels.length) return res.status(400).json({ error: "Выбери хотя бы одну соцсеть" });

  const results: Array<{ channel: string; success: boolean; id?: string; error?: string }> = [];
  if (channels.includes("instagram")) {
    if (!imageUrl) {
      results.push({ channel: "instagram", success: false, error: "Для публикации в Instagram нужно изображение" });
    } else {
      try {
        const context = await instagramGraphContext();
        const response = await withInstagramTokenFallback(context.accessTokens, async (accessToken) => {
          const create = await axios.post(
            `${context.baseUrl}/${META_GRAPH_VERSION}/${context.instagramUserId}/media`,
            { image_url: imageUrl, caption: text },
            { params: { access_token: accessToken }, timeout: 30_000 },
          );
          return axios.post(
            `${context.baseUrl}/${META_GRAPH_VERSION}/${context.instagramUserId}/media_publish`,
            { creation_id: create.data.id },
            { params: { access_token: accessToken }, timeout: 30_000 },
          );
        });
        results.push({ channel: "instagram", success: true, id: String(response.data?.id || "") });
      } catch (error: any) {
        results.push({ channel: "instagram", success: false, error: graphErrorMessage(error) });
      }
    }
  }

  if (channels.includes("telegram")) {
    try {
      const settings = await socialHubSettings();
      const chatId = String(settings.telegramChatId || "").trim();
      const token = String(process.env.TG_BOT_TOKEN || "").trim();
      if (!token || !chatId) throw new Error("Укажи Telegram-канал в разделе «Подключения»");
      const method = imageUrl ? "sendPhoto" : "sendMessage";
      const payload = imageUrl
        ? { chat_id: chatId, photo: imageUrl, caption: text }
        : { chat_id: chatId, text };
      const response = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 30_000 });
      results.push({ channel: "telegram", success: true, id: String(response.data?.result?.message_id || "") });
    } catch (error: any) {
      results.push({ channel: "telegram", success: false, error: error?.response?.data?.description || error.message });
    }
  }

  if (adminDb) {
    await adminDb.collection("social_publications").add({
      text,
      imageUrl,
      channels,
      results,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: { uid: user.uid, email: user.email || "" },
    });
  }
  const success = results.some(item => item.success);
  res.status(success ? 200 : 502).json({ success, results });
});

function validSiteChatId(value: string) {
  return /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}

function siteChatTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

app.post("/api/site-chat/conversations/:id/messages", async (req, res) => {
  if (!adminDb) return res.status(503).json({ error: "Чат временно недоступен" });
  const conversationId = String(req.params.id || "");
  const token = String(req.body?.token || "");
  const text = String(req.body?.text || "").trim().slice(0, 4000);
  if (!validSiteChatId(conversationId) || token.length < 16 || !text) return res.status(400).json({ error: "Некорректное сообщение" });
  try {
    const conversationRef = adminDb.collection("site_chat_conversations").doc(conversationId);
    const hash = siteChatTokenHash(token);
    await adminDb.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(conversationRef);
      if (snapshot.exists && snapshot.data()?.tokenHash !== hash) throw new Error("CHAT_TOKEN_INVALID");
      const now = new Date().toISOString();
      transaction.set(conversationRef, {
        tokenHash: hash,
        channel: "website",
        visitorName: String(req.body?.visitorName || "").trim().slice(0, 120),
        visitorPhone: String(req.body?.visitorPhone || "").trim().slice(0, 40),
        pageUrl: String(req.body?.pageUrl || "").slice(0, 500),
        utm: req.body?.utm && typeof req.body.utm === "object" ? req.body.utm : {},
        lastMessage: { text, createdAt: now, direction: "incoming" },
        createdAt: snapshot.exists ? snapshot.data()?.createdAt || now : now,
        updatedAt: now,
        unreadCount: FieldValue.increment(1),
      }, { merge: true });
    });
    const messageRef = await conversationRef.collection("messages").add({
      text,
      direction: "incoming",
      createdAt: new Date().toISOString(),
    });
    res.json({ message: { id: messageRef.id, text, direction: "incoming", createdAt: new Date().toISOString() } });
  } catch (error: any) {
    if (error.message === "CHAT_TOKEN_INVALID") return res.status(403).json({ error: "Сессия чата недействительна" });
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

app.get("/api/site-chat/conversations/:id/messages", async (req, res) => {
  if (!adminDb) return res.status(503).json({ error: "Чат временно недоступен" });
  const conversationId = String(req.params.id || "");
  const token = String(req.query.token || "");
  if (!validSiteChatId(conversationId) || token.length < 16) return res.status(400).json({ error: "Некорректная сессия" });
  try {
    const conversationRef = adminDb.collection("site_chat_conversations").doc(conversationId);
    const snapshot = await conversationRef.get();
    if (!snapshot.exists) return res.json({ messages: [] });
    if (snapshot.data()?.tokenHash !== siteChatTokenHash(token)) return res.status(403).json({ error: "Сессия чата недействительна" });
    const messages = await conversationRef.collection("messages").orderBy("createdAt", "asc").limit(300).get();
    res.json({ messages: messages.docs.map((item: any) => ({ id: item.id, ...item.data() })) });
  } catch {
    res.status(500).json({ error: "Не удалось загрузить сообщения" });
  }
});

app.get("/api/site-chat/conversations", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  if (!adminDb) return res.status(503).json({ error: "Серверная база не подключена" });
  const snapshot = await adminDb.collection("site_chat_conversations").orderBy("updatedAt", "desc").limit(300).get();
  res.json({ conversations: snapshot.docs.map((item: any) => {
    const data = item.data();
    const { tokenHash: _tokenHash, ...safe } = data;
    return { id: item.id, ...safe };
  }) });
});

app.get("/api/site-chat/inbox/:id/messages", async (req, res) => {
  if (!await requireCrmUser(req, res)) return;
  if (!adminDb) return res.status(503).json({ error: "Серверная база не подключена" });
  const conversationRef = adminDb.collection("site_chat_conversations").doc(String(req.params.id));
  const messages = await conversationRef.collection("messages").orderBy("createdAt", "asc").limit(300).get();
  await conversationRef.set({ unreadCount: 0 }, { merge: true });
  res.json({ messages: messages.docs.map((item: any) => ({ id: item.id, ...item.data() })) });
});

app.post("/api/site-chat/inbox/:id/messages", async (req, res) => {
  const user: any = await requireCrmUser(req, res);
  if (!user) return;
  if (!adminDb) return res.status(503).json({ error: "Серверная база не подключена" });
  const text = String(req.body?.text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "Напиши сообщение" });
  const conversationRef = adminDb.collection("site_chat_conversations").doc(String(req.params.id));
  const createdAt = new Date().toISOString();
  const messageRef = await conversationRef.collection("messages").add({
    text,
    direction: "outgoing",
    createdAt,
    manager: user.email || user.name || user.uid,
  });
  await conversationRef.set({ lastMessage: { text, createdAt, direction: "outgoing" }, updatedAt: createdAt }, { merge: true });
  res.json({ message: { id: messageRef.id, text, direction: "outgoing", createdAt } });
});

async function instagramProfile(context: InstagramGraphContext) {
  const richFields = "id,user_id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,account_type";
  try {
    return await instagramGraphGet(context, context.instagramUserId, { fields: richFields });
  } catch (error) {
    // A few profile fields vary between Instagram Login and Facebook Login.
    // Keep the whole hub working even if Meta does not expose one optional field.
    const basic = await instagramGraphGet<any>(context, context.instagramUserId, {
      fields: "id,user_id,username,name,profile_picture_url,followers_count,media_count,account_type",
    });
    return { ...basic, warning: graphErrorMessage(error) };
  }
}

async function instagramMedia(context: InstagramGraphContext, limit = 24) {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username,comments_count,like_count,children{id,media_type,media_url,thumbnail_url}";
  const result = await instagramGraphGet<any>(context, `${context.instagramUserId}/media`, {
    fields,
    limit: Math.min(Math.max(limit, 1), 50),
  });
  return Array.isArray(result?.data) ? result.data : [];
}

async function instagramStories(context: InstagramGraphContext) {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username,comments_count,like_count";
  const result = await instagramGraphGet<any>(context, `${context.instagramUserId}/stories`, { fields, limit: 100 });
  return Array.isArray(result?.data) ? result.data : [];
}

function normalizeInstagramInsight(row: any) {
  const values = Array.isArray(row?.values)
    ? row.values.map((item: any) => ({ value: item?.value ?? 0, endTime: item?.end_time || "" }))
    : [];
  const totalValue = row?.total_value?.value;
  return {
    name: String(row?.name || ""),
    title: String(row?.title || row?.name || ""),
    description: String(row?.description || ""),
    period: String(row?.period || ""),
    values,
    totalValue: typeof totalValue === "number" ? totalValue : null,
    breakdowns: Array.isArray(row?.total_value?.breakdowns) ? row.total_value.breakdowns : [],
  };
}

async function instagramAccountInsights(context: InstagramGraphContext, days = 30) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.min(Math.max(days, 7), 90) * 24 * 60 * 60;
  const metrics = [
    "reach",
    "profile_views",
    "accounts_engaged",
    "total_interactions",
    "follower_count",
    "website_clicks",
    "profile_links_taps",
    "views",
    "likes",
    "comments",
    "shares",
    "saves",
    "replies",
    "content_views",
  ];
  const attempts = await Promise.all(metrics.map(async (metric) => {
    const variants = [
      { metric, period: "day", since, until },
      { metric, period: "day", metric_type: "total_value", since, until },
      { metric, period: "total_over_range", metric_type: "total_value", since, until },
    ];
    let lastError = "";
    for (const params of variants) {
      try {
        const result = await instagramGraphGet<any>(context, `${context.instagramUserId}/insights`, params);
        if (result?.data?.[0]) {
          return { metric, insight: normalizeInstagramInsight(result.data[0]), error: "" };
        }
      } catch (error) {
        lastError = graphErrorMessage(error);
      }
    }
    return { metric, insight: null, error: lastError };
  }));

  // Audience metrics use different periods and breakdown parameters from the
  // ordinary counters. Querying them separately prevents one unsupported
  // combination from hiding all otherwise available Insights.
  const audienceQueries = [
    { metric: "online_followers", variants: [
      { period: "lifetime" },
      { period: "day", since, until },
    ] },
    { metric: "follows_and_unfollows", variants: [
      { period: "day", metric_type: "total_value", breakdown: "follow_type", since, until },
      { period: "total_over_range", metric_type: "total_value", breakdown: "follow_type", since, until },
      { period: "day", metric_type: "total_value", since, until },
    ] },
    ...["follower_demographics", "reached_audience_demographics", "engaged_audience_demographics"]
      .flatMap((metric) => ["country", "city", "age", "gender"].map((breakdown) => ({
        metric: `${metric}:${breakdown}`,
        sourceMetric: metric,
        variants: [
          { period: "lifetime", metric_type: "total_value", breakdown, timeframe: "last_90_days" },
          { period: "lifetime", metric_type: "total_value", breakdown },
          { period: "total_over_range", metric_type: "total_value", breakdown, since, until },
        ],
      }))),
  ];
  const audienceAttempts = await Promise.all(audienceQueries.map(async (query: any) => {
    let lastError = "";
    for (const variant of query.variants) {
      try {
        const result = await instagramGraphGet<any>(context, `${context.instagramUserId}/insights`, {
          metric: query.sourceMetric || query.metric,
          ...variant,
        });
        if (result?.data?.[0]) {
          return {
            metric: query.metric,
            insight: { ...normalizeInstagramInsight(result.data[0]), queryBreakdown: variant.breakdown || "" },
            error: "",
          };
        }
      } catch (error) {
        lastError = graphErrorMessage(error);
      }
    }
    return { metric: query.metric, insight: null, error: lastError };
  }));
  const allAttempts = [...attempts, ...audienceAttempts];
  return {
    days: Math.min(Math.max(days, 7), 90),
    metrics: allAttempts.filter((item) => item.insight).map((item) => item.insight),
    unavailable: allAttempts.filter((item) => !item.insight).map(({ metric, error }) => ({ metric, error })),
  };
}

async function instagramMediaInsights(context: InstagramGraphContext, media: any[]) {
  const rows: any[] = [];
  const selected = media.slice(0, 24);
  for (let offset = 0; offset < selected.length; offset += 4) {
    const chunkRows = await Promise.all(selected.slice(offset, offset + 4).map(async (item: any) => {
    const productType = String(item?.media_product_type || "").toUpperCase();
    const metricNames = productType === "REELS"
      ? ["reach", "views", "impressions", "total_interactions", "likes", "comments", "shares", "saved", "plays", "ig_reels_video_view_total_time", "ig_reels_avg_watch_time", "clips_replays_count", "ig_reels_aggregated_all_plays_count", "reels_skip_rate", "facebook_views", "crossposted_views"]
      : productType === "STORY"
        ? ["reach", "views", "impressions", "replies", "navigation", "profile_visits", "follows", "profile_activity", "shares", "total_interactions"]
        : ["reach", "views", "impressions", "total_interactions", "likes", "comments", "shares", "saved", "profile_visits", "follows", "profile_activity"];
    const found = new Map<string, any>();
    const errors: string[] = [];
    // Meta rejects a whole comma-separated request when just one metric is not
    // supported by a media type. Try the fast grouped form first, then recover
    // every supported metric individually.
    try {
      const result = await instagramGraphGet<any>(context, `${item.id}/insights`, { metric: metricNames.join(",") });
      for (const row of Array.isArray(result?.data) ? result.data : []) found.set(String(row?.name || ""), row);
    } catch (groupError) {
      errors.push(graphErrorMessage(groupError));
      const individual = await Promise.all(metricNames.map(async (metric) => {
        try {
          const result = await instagramGraphGet<any>(context, `${item.id}/insights`, { metric });
          return result?.data?.[0] || null;
        } catch {
          return null;
        }
      }));
      for (const row of individual.filter(Boolean)) found.set(String(row?.name || ""), row);
    }
    return {
      mediaId: String(item.id),
      metrics: [...found.values()].map(normalizeInstagramInsight),
      error: found.size ? "" : errors[0] || "Meta не вернула Insights для этой публикации",
    };
    }));
    rows.push(...chunkRows);
  }
  return rows;
}

async function instagramCommentsForMedia(context: InstagramGraphContext, media: any[]) {
  const rows = await Promise.all(media.slice(0, 24).map(async (item: any) => {
    const richFields = "id,text,timestamp,like_count,hidden,from,replies.limit(20){id,text,timestamp,like_count,from}";
    let comments: any[] = [];
    let error = "";
    try {
      const result = await instagramGraphGet<any>(context, `${item.id}/comments`, { fields: richFields, limit: 100 });
      comments = Array.isArray(result?.data) ? result.data : [];
    } catch (richError) {
      try {
        const result = await instagramGraphGet<any>(context, `${item.id}/comments`, {
          fields: "id,text,timestamp,from,replies.limit(20){id,text,timestamp,from}",
          limit: 100,
        });
        comments = Array.isArray(result?.data) ? result.data : [];
      } catch (fallbackError) {
        error = graphErrorMessage(fallbackError || richError);
      }
    }
    // Some Instagram Login responses expose the comments connection through
    // field expansion even when the direct /comments edge returns an empty
    // page. Try that documented Graph form before concluding there is no data.
    if (!comments.length && Number(item?.comments_count || 0) > 0) {
      try {
        const expanded = await instagramGraphGet<any>(context, item.id, {
          fields: `comments.limit(100){${richFields}}`,
        });
        const expandedRows = expanded?.comments?.data;
        if (Array.isArray(expandedRows)) comments = expandedRows;
      } catch (expandedError) {
        error ||= graphErrorMessage(expandedError);
      }
    }
    return {
      media: {
        id: item.id,
        caption: item.caption || "",
        mediaType: item.media_type || "",
        thumbnailUrl: item.thumbnail_url || item.media_url || "",
        permalink: item.permalink || "",
        timestamp: item.timestamp || "",
      },
      comments,
      error,
    };
  }));
  return rows;
}

app.get("/api/instagram/profile", async (_req, res) => {
  try {
    const context = await instagramGraphContext();
    res.json({ profile: await instagramProfile(context), apiMode: context.apiMode });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/diagnostics", async (_req, res) => {
  try {
    const context = await instagramGraphContext();
    const permissions: any[] = [];
    let permissionsError = "";
    for (const path of ["me/permissions", `${context.instagramUserId}/permissions`]) {
      try {
        const result = await instagramGraphGet<any>(context, path);
        if (Array.isArray(result?.data)) permissions.push(...result.data);
        if (permissions.length) break;
      } catch (error) {
        permissionsError = graphErrorMessage(error);
      }
    }

    const conversationVariants: any[] = [];
    for (const path of [`${context.instagramUserId}/conversations`, "me/conversations"]) {
      for (const platform of [false, true]) {
        try {
          const result = await instagramGraphGet<any>(context, path, {
            limit: 100,
            ...(platform ? { platform: "instagram" } : {}),
          });
          conversationVariants.push({
            path,
            platform,
            count: Array.isArray(result?.data) ? result.data.length : 0,
            hasNext: Boolean(result?.paging?.next),
            cursors: result?.paging?.cursors || null,
          });
        } catch (error) {
          conversationVariants.push({ path, platform, count: 0, hasNext: false, error: graphErrorMessage(error) });
        }
      }
    }

    let subscriptions: any = null;
    let subscriptionsError = "";
    try {
      subscriptions = await instagramGraphGet<any>(context, `${context.instagramUserId}/subscribed_apps`);
    } catch (error) {
      subscriptionsError = graphErrorMessage(error);
    }

    res.json({
      apiVersion: META_GRAPH_VERSION,
      apiMode: context.apiMode,
      instagramUserId: context.instagramUserId,
      permissions,
      permissionsError,
      conversationVariants,
      subscriptions,
      subscriptionsError,
      webhook: {
        callbackUrl: `${publicBaseUrl()}/api/instagram/webhook`,
      },
    });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/webhook", (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  if (mode === "subscribe" && token === INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/api/instagram/webhook", async (req, res) => {
  try {
    const settings: any = await getInstagramGraphSettings();
    const signature = String(req.headers["x-hub-signature-256"] || "");
    if (settings?.appSecret) {
      const expected = `sha256=${createHmac("sha256", String(settings.appSecret))
        .update((req as any).rawBody || Buffer.from(JSON.stringify(req.body || {})))
        .digest("hex")}`;
      const actualBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);
      if (!signature || actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return res.sendStatus(403);
      }
    }
    // Acknowledge Meta quickly. Duplicate event IDs are merged in Firestore.
    res.status(200).send("EVENT_RECEIVED");
    const body: any = req.body || {};
    if (body.object !== "instagram" || !adminDb) return;
    const context = await instagramGraphContext().catch(() => null);
    const entries = Array.isArray(body.entry) ? body.entry : [];
    console.info("[instagram] webhook received", JSON.stringify({
      object: String(body.object || ""),
      entries: entries.length,
      messaging: entries.reduce((sum: number, entry: any) => sum + (Array.isArray(entry?.messaging) ? entry.messaging.length : 0), 0),
      standby: entries.reduce((sum: number, entry: any) => sum + (Array.isArray(entry?.standby) ? entry.standby.length : 0), 0),
      changeFields: entries.flatMap((entry: any) => Array.isArray(entry?.changes) ? entry.changes.map((change: any) => String(change?.field || "")) : []),
    }));
    // Full payload, so an event Meta delivers but CRM ignores can be identified
    // from the logs instead of guessing at its shape.
    console.info("[instagram] webhook payload", JSON.stringify(body).slice(0, 4000));
    for (const entry of entries) {
      const ownerId = String(entry?.id || "");
      // Meta moves events into `standby` when another app (ManyChat and the like)
      // is the primary receiver of the thread under the handover protocol.
      const messaging = [
        ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
        ...(Array.isArray(entry?.standby) ? entry.standby : []),
      ];
      for (const event of messaging) {
        const senderId = String(event?.sender?.id || "");
        const recipientId = String(event?.recipient?.id || "");
        const ownIds = new Set([ownerId, String(context?.instagramUserId || "")].filter(Boolean));
        const incoming = Boolean(senderId) && !ownIds.has(senderId);
        const customerId = incoming ? senderId : recipientId;
        if (!customerId) continue;
        const rawMessage = event?.message || event?.message_edit || {};
        // Seen receipts, reactions and postbacks arrive in the same `messaging`
        // array. They must not create blank chat messages.
        if (!rawMessage?.mid && !rawMessage?.text && !rawMessage?.attachments) {
          console.info("[instagram] webhook event skipped", JSON.stringify({
            keys: Object.keys(event || {}),
            senderId,
            recipientId,
          }));
          continue;
        }
        const message = {
          id: String(rawMessage?.mid || `webhook-${customerId}-${event?.timestamp || Date.now()}`),
          text: String(rawMessage?.text || ""),
          createdAt: event?.timestamp ? new Date(Number(event.timestamp)).toISOString() : new Date().toISOString(),
          from: { id: senderId },
          to: [{ id: recipientId }],
          attachments: rawMessage?.attachments || [],
          direction: incoming ? "incoming" : "outgoing",
          source: "instagram_webhook",
        };
        const conversationId = `webhook-${customerId}`;
        const customer: any = { id: customerId };
        // Persist the message before the optional profile request. If Meta's
        // profile edge is slow or unavailable, the dialogue still appears in CRM.
        await saveInstagramMessages(conversationId, [message], { customerId });
        await adminDb.collection("instagram_conversations").doc(conversationId).set({
          id: conversationId,
          updatedAt: message.createdAt,
          participants: [customer],
          customer,
          lastMessage: message,
          source: "instagram_webhook",
          syncedAt: new Date().toISOString(),
        }, { merge: true });
        if (context) {
          try {
            const enrichedCustomer = await instagramGraphGet<any>(context, customerId, {
              fields: "id,name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user",
            });
            await adminDb.collection("instagram_conversations").doc(conversationId).set({
              participants: [enrichedCustomer],
              customer: enrichedCustomer,
            }, { merge: true });
            Object.assign(customer, enrichedCustomer);
          } catch (profileError) {
            console.warn("[instagram] webhook profile:", graphErrorMessage(profileError));
          }
        }
        console.info("[instagram] message saved", JSON.stringify({ conversationId, messageId: message.id, direction: message.direction, hasText: Boolean(message.text), attachments: message.attachments.length }));
        if (incoming) {
          await dispatchPushEvent("instagram_message", `instagram-message:${message.id}`, {
            conversationId,
            username: String(customer?.username || customer?.name || customerId),
            message: message.text || (message.attachments?.length ? "Вложение" : "Новое сообщение"),
          }).catch(error => console.warn("[push] instagram:", error?.message || error));
        }
      }

      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (!["comments", "live_comments"].includes(String(change?.field || ""))) continue;
        const value = change?.value || {};
        const commentId = String(value?.id || "");
        if (!commentId) continue;
        await adminDb.collection("instagram_comments").doc(commentId).set({
          ...value,
          id: commentId,
          field: change.field,
          receivedAt: new Date().toISOString(),
        }, { merge: true });
      }
    }
  } catch (error) {
    console.error("[instagram] webhook:", graphErrorMessage(error));
    if (!res.headersSent) res.status(500).send("WEBHOOK_ERROR");
  }
});

app.post("/api/instagram/subscriptions/ensure", async (_req, res) => {
  try {
    const context = await instagramGraphContext();
    const subscribedFields = [
      "messages",
      "messaging_postbacks",
      "messaging_seen",
      "messaging_referral",
      "message_reactions",
      "comments",
      "live_comments",
      "mentions",
      "story_insights",
    ];
    const result = await withInstagramTokenFallback(context.accessTokens, async (accessToken) => {
      const response = await axios.post(
        `${context.baseUrl}/${META_GRAPH_VERSION}/${context.instagramUserId}/subscribed_apps`,
        { subscribed_fields: subscribedFields },
        { params: { access_token: accessToken }, timeout: 25_000 },
      );
      return response.data;
    });
    const subscriptions = await instagramGraphGet<any>(context, `${context.instagramUserId}/subscribed_apps`);
    res.json({ success: Boolean(result?.success), subscribedFields, subscriptions });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/insights", async (req, res) => {
  try {
    const context = await instagramGraphContext();
    const days = Number(req.query.days || 30);
    res.json(await instagramAccountInsights(context, days));
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/media", async (req, res) => {
  try {
    const context = await instagramGraphContext();
    const media = await instagramMedia(context, Number(req.query.limit || 24));
    const insights = req.query.insights === "0" ? [] : await instagramMediaInsights(context, media);
    res.json({ media, insights });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/stories", async (_req, res) => {
  try {
    const context = await instagramGraphContext();
    const stories = await instagramStories(context);
    const insights = await instagramMediaInsights(context, stories);
    res.json({ stories, insights });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/comments", async (req, res) => {
  try {
    const context = await instagramGraphContext();
    const media = await instagramMedia(context, Number(req.query.mediaLimit || 24));
    const groups = await instagramCommentsForMedia(context, media);
    const knownCommentCount = media.reduce((sum: number, item: any) => sum + Number(item?.comments_count || 0), 0);
    const returnedCommentCount = groups.reduce((sum: number, group: any) => sum + Number(group?.comments?.length || 0), 0);
    const warning = knownCommentCount > 0 && returnedCommentCount === 0
      ? `Instagram показывает ${knownCommentCount} комментариев в счётчиках публикаций, но не передал их тексты через API. Токен принят, однако доступ к комментариям ограничен режимом тестирования или уровнем доступа приложения Meta.`
      : "";
    res.json({ groups, knownCommentCount, returnedCommentCount, warning });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.post("/api/instagram/comments/:id/replies", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Напиши текст ответа" });
  try {
    const context = await instagramGraphContext();
    const data = await withInstagramTokenFallback(context.accessTokens, async (accessToken) => {
      const response = await axios.post(
        `${context.baseUrl}/${META_GRAPH_VERSION}/${req.params.id}/replies`,
        { message },
        { params: { access_token: accessToken }, timeout: 20_000 },
      );
      return response.data;
    });
    res.json({ success: true, id: data?.id || "" });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.post("/api/instagram/comments/:id/visibility", async (req, res) => {
  const hidden = Boolean(req.body?.hidden);
  try {
    const context = await instagramGraphContext();
    await withInstagramTokenFallback(context.accessTokens, async (accessToken) => {
      const response = await axios.post(
        `${context.baseUrl}/${META_GRAPH_VERSION}/${req.params.id}`,
        { hide: hidden },
        { params: { access_token: accessToken }, timeout: 20_000 },
      );
      return response.data;
    });
    res.json({ success: true, hidden });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

function normalizeInstagramMessage(item: any, ownIds: string[] = []) {
  const fromId = String(item?.from?.id || "");
  const isOutgoing = ownIds.includes(fromId);
  return {
    id: String(item?.id || ""),
    text: String(item?.message || item?.text || ""),
    createdAt: item?.created_time || item?.timestamp || new Date().toISOString(),
    from: item?.from || null,
    to: item?.to?.data || item?.to || [],
    attachments: item?.attachments?.data || item?.attachments || [],
    direction: isOutgoing ? "outgoing" : "incoming",
  };
}

async function saveInstagramMessages(conversationId: string, messages: any[], extra: any = {}) {
  if (!adminDb) return;
  const batch = adminDb.batch();
  messages.forEach((message: any) => {
    if (!message?.id) return;
    batch.set(adminDb.collection("instagram_messages").doc(message.id), {
      ...message,
      conversationId,
      ...extra,
      syncedAt: new Date().toISOString(),
    }, { merge: true });
  });
  await batch.commit();
}

async function getContactsForInstagramSearch(search = "") {
  if (!adminDb) return [];
  const snap = await adminDb.collection("contacts").get();
  const needle = String(search || "").trim().toLowerCase();
  return snap.docs.map((entry: any) => ({ id: entry.id, ...entry.data() })).filter((client: any) => {
    if (!needle) return true;
    return [client.fullName, client.name, client.phone, client.insta, client.instagram, client.email]
      .some((value) => String(value || "").toLowerCase().includes(needle));
  });
}

async function findClientByInstagram(participants: any[], linkedClientId = "", prefetchedClients?: any[]) {
  if (!adminDb) return null;
  if (linkedClientId) {
    const linked = await adminDb.collection("contacts").doc(linkedClientId).get();
    if (linked.exists) return { id: linked.id, ...linked.data() };
  }
  const handles = participants
    .flatMap((participant: any) => [participant?.username, participant?.name])
    .map(normalizeInstagramHandle)
    .filter(Boolean);
  if (!handles.length) return null;
  const clients = prefetchedClients || await getContactsForInstagramSearch();
  return clients.find((client: any) => {
    const clientHandles = [client.insta, client.instagram, client.instagramUsername]
      .map(normalizeInstagramHandle)
      .filter(Boolean);
    return clientHandles.some((handle: string) => handles.includes(handle));
  }) || null;
}

async function fetchInstagramConversationMessages(
  conversationId: string,
  accessToken: string,
  ownIds: string[],
  apiMode: "instagram_login" | "facebook_login" = "facebook_login",
) {
  const fields = "id,message,from,to,created_time,attachments";
  const baseUrl = apiMode === "instagram_login" ? INSTAGRAM_GRAPH_BASE_URL : "https://graph.facebook.com";
  const endpoint = apiMode === "instagram_login"
    ? `${baseUrl}/${META_GRAPH_VERSION}/${conversationId}`
    : `${baseUrl}/${META_GRAPH_VERSION}/${conversationId}/messages`;
  const response = await axios.get(endpoint, {
    params: {
      access_token: accessToken,
      fields: apiMode === "instagram_login" ? `messages{${fields}}` : fields,
      ...(apiMode === "facebook_login" ? { limit: 100 } : {}),
    },
    timeout: 20_000,
  });
  const rows = apiMode === "instagram_login" ? response.data?.messages?.data : response.data?.data;
  return (Array.isArray(rows) ? rows : [])
    .map((item: any) => normalizeInstagramMessage(item, ownIds))
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function participantsFromInstagramMessages(messages: any[], ownIds: string[]) {
  const participants = new Map<string, any>();
  messages.forEach((message: any) => {
    const actors = [message?.from, ...(Array.isArray(message?.to) ? message.to : [])];
    actors.forEach((actor: any) => {
      const id = String(actor?.id || "");
      if (id && !ownIds.includes(id)) participants.set(id, actor);
    });
  });
  return [...participants.values()];
}

async function hydrateInstagramConversations(
  rows: any[],
  options: {
    apiMode: "instagram_login" | "facebook_login";
    accessToken: string;
    pageId: string;
    instagramUserId: string;
    contacts: any[];
  },
) {
  const ownIds = [String(options.pageId), String(options.instagramUserId)];
  const results: any[] = [];
  // Keep concurrency bounded: an account can have thousands of conversations
  // and Cloud Run/Meta should not receive hundreds of message calls at once.
  for (let offset = 0; offset < rows.length; offset += 8) {
    const chunk = rows.slice(offset, offset + 8);
    const hydrated = await Promise.all(chunk.map(async (row: any) => {
      const stored = adminDb ? await adminDb.collection("instagram_conversations").doc(row.id).get().catch(() => null) : null;
      const storedData: any = stored?.exists ? stored.data() : {};
      let messages: any[] = Array.isArray(row?.messages?.data)
        ? row.messages.data
          .map((item: any) => normalizeInstagramMessage(item, ownIds))
          .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        : [];
      let historyLimited = false;
      if (!messages.length) {
        try {
          messages = await fetchInstagramConversationMessages(row.id, options.accessToken, ownIds, options.apiMode);
        } catch (messageError) {
          historyLimited = true;
          console.warn("[instagram] conversation messages:", graphErrorMessage(messageError));
        }
      }
      const participants = row?.participants?.data?.length
        ? row.participants.data
        : participantsFromInstagramMessages(messages, ownIds);
      const customer = participants.find((item: any) => !ownIds.includes(String(item?.id || ""))) || participants[0] || null;
      if (messages.length) await saveInstagramMessages(row.id, messages, { customerId: customer?.id || "" });
      const lastMessage = messages[messages.length - 1] || null;
      const linkedClient = await findClientByInstagram(participants, storedData?.clientId || "", options.contacts);
      const result = {
        id: row.id,
        updatedAt: row.updated_time || lastMessage?.createdAt || "",
        participants,
        customer,
        lastMessage,
        linkedClient,
        importedMessageCount: messages.length,
        historyLimited: historyLimited || (options.apiMode === "instagram_login" && messages.length >= 20),
      };
      if (adminDb) await adminDb.collection("instagram_conversations").doc(row.id).set({
        ...result,
        linkedClient: linkedClient || null,
        clientId: linkedClient?.id || storedData?.clientId || "",
        syncedAt: new Date().toISOString(),
      }, { merge: true });
      return result;
    }));
    results.push(...hydrated);
  }
  return results;
}

app.get("/api/instagram/conversations", async (req, res) => {
  try {
    const { apiMode, accessTokens, pageId, instagramUserId } = await instagramInboxCredentials();
    const requestedLimit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
    const fields = apiMode === "instagram_login" ? "" : "id,updated_time,participants";
    const ownerId = apiMode === "instagram_login" ? instagramUserId : pageId;
    const baseUrl = apiMode === "instagram_login" ? INSTAGRAM_GRAPH_BASE_URL : "https://graph.facebook.com";
    const { response, accessToken, discoveryPath } = await withInstagramTokenFallback(accessTokens, async (token) => {
      const params = {
        access_token: token,
        ...(apiMode === "facebook_login" ? { platform: "instagram", fields } : {}),
        limit: Math.min(requestedLimit, 100),
      };
      const candidates = apiMode === "instagram_login"
        ? [`${ownerId}/conversations`, "me/conversations"]
        : [`${ownerId}/conversations`];
      let firstResponse: any = null;
      let firstPath = candidates[0];
      for (const path of candidates) {
        const candidate = await axios.get(`${baseUrl}/${META_GRAPH_VERSION}/${path}`, { params, timeout: 20_000 });
        firstResponse ||= candidate;
        if (candidate.data?.data?.length) return { accessToken: token, response: candidate, discoveryPath: path };
      }
      return { accessToken: token, response: firstResponse, discoveryPath: firstPath };
    });
    const rows = Array.isArray(response.data?.data) ? [...response.data.data] : [];
    let paging = response.data?.paging || null;
    let pagesScanned = 1;
    // Normal inbox refresh stays cheap; the dedicated history-sync endpoint
    // walks every cursor in persistent batches.
    const maxPages = req.query.deep === "1" ? 50 : 1;

    // Instagram can return an empty page together with a valid `next` cursor
    // (for example when the current slice contains no Instagram conversations).
    // Keep walking the cursor until we find dialogs or exhaust a bounded number
    // of pages. Never pass Meta's `next` URL to the browser because it embeds the
    // access token.
    while (rows.length < requestedLimit && paging?.next && pagesScanned < maxPages) {
      const nextResponse = await axios.get(paging.next, { timeout: 20_000 });
      const nextRows = Array.isArray(nextResponse.data?.data) ? nextResponse.data.data : [];
      rows.push(...nextRows);
      paging = nextResponse.data?.paging || null;
      pagesScanned += 1;
    }
    if (rows.length > requestedLimit) rows.length = requestedLimit;
    // Read the client database once for the entire sync, not once per dialog.
    const contacts = adminDb ? await getContactsForInstagramSearch() : [];
    const graphConversations = await hydrateInstagramConversations(rows, {
      apiMode, accessToken, pageId: String(pageId), instagramUserId: String(instagramUserId), contacts,
    });
    const conversations = [...graphConversations];
    if (adminDb) {
      try {
        const cached = await adminDb.collection("instagram_conversations")
          .orderBy("updatedAt", "desc")
          .limit(requestedLimit)
          .get();
        const knownIds = new Set(conversations.map((item: any) => String(item.id)));
        for (const entry of cached.docs) {
          if (knownIds.has(entry.id)) continue;
          const cachedConversation: any = { id: entry.id, ...entry.data() };
          const participants = Array.isArray(cachedConversation.participants) ? cachedConversation.participants : [];
          cachedConversation.linkedClient = await findClientByInstagram(
            participants,
            cachedConversation.clientId || "",
            contacts,
          );
          conversations.push(cachedConversation);
        }
      } catch (cacheError) {
        console.warn("[instagram] cached conversations:", graphErrorMessage(cacheError));
      }
    }
    conversations.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({
      conversations,
      paging: { hasNext: Boolean(paging?.next), pagesScanned, discoveryPath },
      notice: !conversations.length
        ? (paging?.next
          ? `Meta вернула ${pagesScanned} пустых страниц Direct, хотя курсор продолжения существует. Подписка CRM на новые сообщения уже включена; старая история скрыта режимом тестирования Meta.`
          : "Meta не вернула доступных Instagram-диалогов для этого токена.")
        : "",
    });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.post("/api/instagram/conversations/sync", async (req, res) => {
  try {
    const { apiMode, accessTokens, pageId, instagramUserId } = await instagramInboxCredentials();
    const ownerId = apiMode === "instagram_login" ? instagramUserId : pageId;
    const baseUrl = apiMode === "instagram_login" ? INSTAGRAM_GRAPH_BASE_URL : "https://graph.facebook.com";
    const stateRef = adminDb?.collection("instagram_meta").doc("conversation_history_sync") || null;
    const stateSnap = stateRef ? await stateRef.get().catch(() => null) : null;
    const savedState: any = stateSnap?.exists ? stateSnap.data() : {};
    const reset = Boolean(req.body?.reset);
    const lastCompleteAt = savedState?.lastCompleteAt ? new Date(savedState.lastCompleteAt).getTime() : 0;
    if (!reset && savedState?.complete && lastCompleteAt && Date.now() - lastCompleteAt < 15 * 60 * 1000) {
      return res.json({
        imported: 0,
        nextCursor: "",
        complete: true,
        cached: true,
        historyLimit: "Meta разрешает получить список прошлых диалогов, но тексты только 20 последних сообщений каждого диалога.",
      });
    }
    const requestedCursor = reset ? "" : String(req.body?.cursor || savedState?.cursor || "");
    const contacts = adminDb ? await getContactsForInstagramSearch() : [];

    const result = await withInstagramTokenFallback(accessTokens, async (accessToken) => {
      const commonParams: any = {
        access_token: accessToken,
        limit: 50,
        ...(requestedCursor ? { after: requestedCursor } : {}),
        ...(apiMode === "facebook_login" ? { platform: "instagram", fields: "id,updated_time,participants" } : {}),
      };
      const candidates = apiMode === "instagram_login"
        ? [`${ownerId}/conversations`, "me/conversations"]
        : [`${ownerId}/conversations`];
      let response: any = null;
      let discoveryPath = candidates[0];
      for (const path of candidates) {
        const candidate = await axios.get(`${baseUrl}/${META_GRAPH_VERSION}/${path}`, { params: commonParams, timeout: 25_000 });
        response ||= candidate;
        if (candidate.data?.data?.length) {
          response = candidate;
          discoveryPath = path;
          break;
        }
      }
      const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
      const conversations = await hydrateInstagramConversations(rows, {
        apiMode,
        accessToken,
        pageId: String(pageId),
        instagramUserId: String(instagramUserId),
        contacts,
      });
      return {
        conversations,
        nextCursor: String(response?.data?.paging?.cursors?.after || ""),
        hasNext: Boolean(response?.data?.paging?.next),
        discoveryPath,
      };
    });

    const complete = !result.hasNext || !result.nextCursor || result.nextCursor === requestedCursor;
    if (stateRef) {
      await stateRef.set({
        cursor: complete ? "" : result.nextCursor,
        complete,
        importedInLastBatch: result.conversations.length,
        lastBatchAt: new Date().toISOString(),
        ...(complete ? { lastCompleteAt: new Date().toISOString() } : {}),
      }, { merge: true });
    }
    res.json({
      imported: result.conversations.length,
      nextCursor: complete ? "" : result.nextCursor,
      complete,
      discoveryPath: result.discoveryPath,
      historyLimit: "Meta разрешает получить список прошлых диалогов, но тексты только 20 последних сообщений каждого диалога.",
    });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/conversations/:id/messages", async (req, res) => {
  try {
    if (req.params.id.startsWith("webhook-") && adminDb) {
      const snapshot = await adminDb.collection("instagram_messages")
        .where("conversationId", "==", req.params.id)
        .get();
      const messages = snapshot.docs
        .map((entry: any) => ({ id: entry.id, ...entry.data() }))
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return res.json({ messages });
    }
    const { apiMode, accessTokens, pageId, instagramUserId } = await instagramInboxCredentials();
    const graphMessages = await withInstagramTokenFallback(accessTokens, (accessToken) =>
      fetchInstagramConversationMessages(req.params.id, accessToken, [String(pageId), String(instagramUserId)], apiMode));
    await saveInstagramMessages(req.params.id, graphMessages);
    const byId = new Map(graphMessages.map((message: any) => [String(message.id), message]));
    if (adminDb) {
      const snapshot = await adminDb.collection("instagram_messages")
        .where("conversationId", "==", req.params.id)
        .get();
      snapshot.docs.forEach((entry: any) => byId.set(entry.id, { id: entry.id, ...entry.data() }));
    }
    const messages = [...byId.values()]
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    res.json({
      messages,
      historyLimited: apiMode === "instagram_login" && graphMessages.length >= 20,
      historyNotice: apiMode === "instagram_login" && graphMessages.length >= 20
        ? "Meta отдаёт содержимое только 20 последних сообщений этого старого диалога. Новые сообщения дальше сохраняются в CRM без этого ограничения."
        : "",
    });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.post("/api/instagram/conversations/:id/messages", async (req, res) => {
  const recipientId = String(req.body?.recipientId || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!recipientId || !text) return res.status(400).json({ error: "Нужны получатель и текст сообщения" });
  try {
    const { apiMode, accessTokens, pageId, instagramUserId } = await instagramInboxCredentials();
    let response: any;
    let lastError: any;
    for (const accessToken of accessTokens) {
      const senderIds = apiMode === "instagram_login" ? [instagramUserId] : [pageId, instagramUserId];
      const baseUrl = apiMode === "instagram_login" ? INSTAGRAM_GRAPH_BASE_URL : "https://graph.facebook.com";
      for (const senderId of senderIds) {
        try {
          response = await axios.post(`${baseUrl}/${META_GRAPH_VERSION}/${senderId}/messages`, {
            recipient: { id: recipientId },
            message: { text },
            ...(apiMode === "facebook_login" ? { messaging_type: "RESPONSE" } : {}),
          }, {
            params: { access_token: accessToken },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20_000,
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (response) break;
    }
    if (!response) throw lastError || new Error("Meta не приняла сообщение");
    const message = {
      id: String(response.data?.message_id || `local-${Date.now()}`),
      text,
      createdAt: new Date().toISOString(),
      from: { id: instagramUserId },
      to: [{ id: recipientId }],
      attachments: [],
      direction: "outgoing",
      source: "manager",
    };
    await saveInstagramMessages(req.params.id, [message]);
    if (adminDb) {
      const conversation = await adminDb.collection("instagram_conversations").doc(req.params.id).get();
      const conversationData: any = conversation.exists ? conversation.data() : {};
      await adminDb.collection("ai_sales_knowledge").add({
        channel: "instagram",
        conversationId: req.params.id,
        clientId: conversationData?.clientId || "",
        customerHandle: conversationData?.customer?.username || conversationData?.customer?.name || "",
        customerMessage: String(req.body?.contextMessage || ""),
        managerResponse: text,
        status: "approved",
        source: "manager_reply",
        createdAt: new Date().toISOString(),
      });
      await adminDb.collection("instagram_conversations").doc(req.params.id).set({
        lastMessage: message,
        updatedAt: message.createdAt,
      }, { merge: true });
    }
    res.json({ success: true, message, meta: response.data });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: graphErrorMessage(error) });
  }
});

app.get("/api/instagram/client-search", async (req, res) => {
  try {
    const clients = (await getContactsForInstagramSearch(String(req.query.q || ""))).slice(0, 30);
    res.json({ clients });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/instagram/conversations/:id/link-client", async (req, res) => {
  const clientId = String(req.body?.clientId || "").trim();
  if (!adminDb) return res.status(503).json({ error: "Серверная база не подключена" });
  if (!clientId) return res.status(400).json({ error: "Выбери клиента" });
  try {
    const client = await adminDb.collection("contacts").doc(clientId).get();
    if (!client.exists) return res.status(404).json({ error: "Клиент не найден" });
    const linkedClient = { id: client.id, ...client.data() };
    await adminDb.collection("instagram_conversations").doc(req.params.id).set({
      clientId,
      linkedClient,
      linkedAt: new Date().toISOString(),
    }, { merge: true });
    res.json({ success: true, linkedClient });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Точка Банк API ─────────────────────────────────────────────────────────

const TOCHKA_API = 'https://enter.tochka.com/uapi';
const TOCHKA_HOST = 'enter.tochka.com';
const TOCHKA_CA_PATH = path.join(process.cwd(), 'certs', 'russian-trusted-root-ca.pem');
const TOCHKA_HTTPS_AGENT = new https.Agent({
  ca: fs.readFileSync(TOCHKA_CA_PATH, 'utf8'),
  rejectUnauthorized: true,
});
axios.interceptors.request.use(config => {
  try {
    if (config.url && new URL(config.url).hostname === TOCHKA_HOST) {
      config.httpsAgent = TOCHKA_HTTPS_AGENT;
    }
  } catch {
    // Relative URLs are not used for Tochka requests.
  }
  return config;
});
const FINANCE_OWNER_EMAIL = 'ndtiger86@gmail.com';
const TOCHKA_KNOWN_CARDS = [
  { mask: '5316', label: 'Пластиковая карта', kind: 'card' },
  { mask: '8690', label: 'Платежный стикер', kind: 'sticker' },
  { mask: '9259', label: 'Корпоративная карта', kind: 'corporate' },
];

async function requireFinanceOwner(req: any, res: any) {
  const authHeader = String(req.headers?.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Нужен вход в аккаунт владельца' });
    return null;
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const email = String(decoded.email || '').toLowerCase();
    if (email !== FINANCE_OWNER_EMAIL) {
      res.status(403).json({ error: 'Финансовая аналитика доступна только владельцу' });
      return null;
    }
    return decoded;
  } catch (error: any) {
    res.status(401).json({ error: 'Сессия входа устарела. Войдите заново.' });
    return null;
  }
}

async function requireRefundOwner(req: any, res: any) {
  const decoded: any = await requireCrmUser(req, res);
  if (!decoded) return null;
  const email = String(decoded.email || '').trim().toLowerCase();
  if (email !== FINANCE_OWNER_EMAIL) {
    res.status(403).json({
      error: 'Возврат платежей доступен только владельцу CRM',
      code: 'refund_owner_only',
    });
    return null;
  }
  return decoded;
}

function decodeJwtPayload(token: string) {
  try {
    const payloadPart = String(token || '').split('.')[1];
    if (!payloadPart) return {};
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function getTochkaToken(): Promise<string | null> {
  const settings = await readTochkaSettingsDoc('tochka_api');
  return settings?.jwtToken || null;
}

async function readTochkaSettingsDoc(id: string): Promise<any> {
  if (adminDb) {
    const snap = await adminDb.collection('settings').doc(id).get();
    return snap.exists ? snap.data() : {};
  }
  if (!db) return {};
  const snap = await getDoc(doc(db, 'settings', id)).catch(() => null);
  return snap?.exists() ? snap.data() : {};
}

async function writeTochkaSettingsDoc(id: string, payload: Record<string, any>) {
  if (adminDb) {
    await adminDb.collection('settings').doc(id).set(payload, { merge: true });
    return;
  }
  if (!db) throw new Error('DB не подключена');
  await setDoc(doc(db, 'settings', id), payload, { merge: true });
}

async function writeTochkaLog(payload: Record<string, any>) {
  const cleanPayload = stripUndefined(payload);
  if (adminDb) {
    await adminDb.collection('tochka_logs').add(cleanPayload);
    return;
  }
  if (db) await addDoc(collection(db, 'tochka_logs'), cleanPayload);
}

function buildTochkaCacheId(...parts: string[]) {
  return Buffer.from(parts.map(part => String(part || '')).join('|'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readTochkaStatementCache(customerCode: string, accountId: string, dateFrom: string, dateTo: string) {
  const id = buildTochkaCacheId(customerCode, accountId, dateFrom, dateTo);
  if (adminDb) {
    const snap = await adminDb.collection('tochka_statements').doc(id).get().catch(() => null);
    return snap?.exists ? { id, ...(snap.data() || {}) } : { id };
  }
  if (!db) return { id };
  const snap = await getDoc(doc(db, 'tochka_statements', id)).catch(() => null);
  return snap?.exists() ? { id, ...(snap.data() || {}) } : { id };
}

async function writeTochkaStatementCache(customerCode: string, accountId: string, dateFrom: string, dateTo: string, payload: Record<string, any>) {
  const id = buildTochkaCacheId(customerCode, accountId, dateFrom, dateTo);
  const row = {
    customerCode,
    accountId,
    dateFrom,
    dateTo,
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  if (adminDb) {
    await adminDb.collection('tochka_statements').doc(id).set(row, { merge: true }).catch(() => {});
    return;
  }
  if (!db) return;
  await setDoc(doc(db, 'tochka_statements', id), row, { merge: true }).catch(() => {});
}

function normalizeTochkaList(data: any): any[] {
  const candidates = [
    data?.Data,
    data?.Data?.Transaction,
    data?.Data?.Transactions,
    data?.Data?.transaction,
    data?.Data?.transactions,
    data?.Data?.Operation,
    data?.Data?.Operations,
    data?.Data?.operation,
    data?.Data?.Statement,
    data?.Data?.Statements,
    data?.Data?.statement,
    data?.Data?.Statement?.Transaction,
    data?.Data?.Statement?.Transactions,
    data?.Data?.Statement?.Operation,
    data?.Data?.Statement?.Operations,
    data?.data,
    data?.data?.transactions,
    data?.data?.Transactions,
    data?.data?.Transaction,
    data?.data?.Operation,
    data?.data?.Operations,
    data?.data?.Statement,
    data?.data?.statement,
    data?.data?.statement?.transactions,
    data?.data?.statement?.operations,
    data?.Data?.payments,
    data?.Data?.Payments,
    data?.Data?.operations,
    data?.Data?.paymentOperations,
    data?.data?.payments,
    data?.data?.operations,
    data?.data?.paymentOperations,
    data?.payments,
    data?.operations,
    data?.transactions,
    data?.Transactions,
    data?.Transaction,
    data?.Operation,
    data?.Operations,
    data?.paymentOperations,
    data?.result,
    data?.result?.transactions,
    data?.result?.operations,
  ];
  const list = candidates.find(Array.isArray);
  if (list) return list;
  const single = candidates.find(candidate => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && (
      candidate.Amount
      || candidate.amount
      || candidate.TransactionId
      || candidate.transactionId
      || candidate.OperationId
      || candidate.operationId
      || candidate.bookingDateTime
      || candidate.operationDate
    )
  ));
  return single ? [single] : [];
}

function looksLikeTochkaOperation(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).map(key => key.toLowerCase());
  const joinedKeys = keys.join('|');
  const hasAmount = /(^|[|_.-])(amount|sum|transactionamount|operationamount|paymentamount|totalamount)($|[|_.-])/.test(joinedKeys)
    || Boolean(value?.Amount || value?.amount || value?.TransactionAmount || value?.transactionAmount);
  const hasDate = keys.some(key => /date|datetime|created|booking|value/.test(key));
  const hasOperationMarker = keys.some(key => /transaction|operation|payment|entry|statement|creditdebitindicator|counterparty|merchant|remittance/.test(key));
  return hasAmount && (hasDate || hasOperationMarker);
}

function extractTochkaOperationRows(data: any): any[] {
  const rows: any[] = [];
  const seenObjects = new Set<any>();
  const seenKeys = new Set<string>();
  const push = (item: any) => {
    if (!looksLikeTochkaOperation(item)) return;
    const stableKey = String(
      item?.transactionId
      || item?.TransactionId
      || item?.operationId
      || item?.OperationId
      || item?.entryReference
      || item?.EntryReference
      || JSON.stringify(item).slice(0, 500)
    );
    if (seenKeys.has(stableKey)) return;
    seenKeys.add(stableKey);
    rows.push(item);
  };

  for (const item of normalizeTochkaList(data)) push(item);

  const walk = (value: any, keyHint = '', depth = 0) => {
    if (!value || depth > 7) return;
    if (typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      const isOperationArray = /(transaction|operation|payment|entry|statement|row|item|movement|posting)/i.test(keyHint);
      for (const item of value) {
        if (isOperationArray || looksLikeTochkaOperation(item)) push(item);
        walk(item, keyHint, depth + 1);
      }
      return;
    }

    push(value);
    for (const [key, nestedValue] of Object.entries(value)) {
      walk(nestedValue, key, depth + 1);
    }
  };

  walk(data);
  return rows.length ? rows : normalizeTochkaList(data);
}

function getTochkaJwtExpiresAt(payload: any) {
  const exp = Number(payload?.exp || payload?.expiresAt || 0);
  if (!exp) return null;
  return exp > 100000000000 ? exp : exp * 1000;
}

function getTochkaErrorMessage(error: any) {
  const data = error?.response?.data;
  if (!data) return error?.message || 'Неизвестная ошибка';
  return data?.message
    || data?.error_description
    || data?.error
    || data?.errors?.[0]?.message
    || data?.Errors?.[0]?.message
    || JSON.stringify(data).slice(0, 240);
}

function findTochkaValueByKeys(data: any, keys: string[]) {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  const seen = new Set<any>();
  const walk = (value: any): any => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found !== null && found !== undefined && found !== '') return found;
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
      if (found !== null && found !== undefined && found !== '') return found;
    }
    return null;
  };
  return walk(data);
}

function getTochkaPaymentUrl(data: any) {
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

async function fetchTochkaQrById(token: string, merchantId: string, accountId: string, qrId: string) {
  if (!qrId) return null;
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
  let lastError: any = null;
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        headers,
        params: { qrcId: qrId, qrId },
        timeout: 20000,
      });
      const paymentUrl = getTochkaPaymentUrl(response.data);
      const paymentStatus = getTochkaOperationStatus(response.data)
        || findTochkaValueByKeys(response.data, ['qrcStatus', 'qrStatus', 'status']);
      if (paymentUrl || paymentStatus) return { data: response.data, paymentUrl, paymentStatus };
      lastError = new Error('QR response has no payment url');
    } catch (error: any) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function getTochkaPaymentId(data: any) {
  const value = findTochkaValueByKeys(data, [
    'operationId',
    'paymentId',
    'qrcId',
    'qrId',
    'id',
  ]);
  return value ? String(value) : '';
}

function getTochkaLegalId(data: any) {
  const value = findTochkaValueByKeys(data, [
    'legalId',
    'legal_id',
    'LegalId',
    'legalEntityId',
    'LegalEntityId',
  ]);
  return value ? String(value) : '';
}

function compactTochkaData(data: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function isValidTochkaAccountId(accountId: string) {
  return /^\d+\/\d+$/.test(String(accountId || '').trim());
}

async function fetchTochkaOpenBankingAccounts(token: string, customerCode = '') {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await axios.get(`${TOCHKA_API}/open-banking/v1.0/accounts`, {
    headers,
    params: customerCode ? { customerCode } : {},
    timeout: 15000,
  });
  return extractTochkaAccounts(response.data);
}

async function resolveTochkaSbpAccount(token: string, customerCode: string, configuredAccountId: string) {
  const currentAccountId = String(configuredAccountId || '').trim();
  if (isValidTochkaAccountId(currentAccountId)) {
    return { customerCode, accountId: currentAccountId };
  }

  const accounts = await fetchTochkaOpenBankingAccounts(token, customerCode).catch(() => []);
  const account = accounts.find((item: any) => isValidTochkaAccountId(item?.accountId || item?.AccountId || item?.id));
  return {
    customerCode: String(account?.customerCode || account?.CustomerCode || account?.customer_code || customerCode || ''),
    accountId: String(account?.accountId || account?.AccountId || account?.id || currentAccountId || ''),
  };
}

async function discoverTochkaLegalId(token: string, customerCode: string, merchantId: string, accountId: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const bankCode = String(accountId || '').split('/')[1] || '';
  const candidates = [
    {
      url: `${TOCHKA_API}/sbp/v1.0/merchant/${encodeURIComponent(merchantId)}`,
      params: customerCode ? { customerCode } : {},
    },
    {
      url: `${TOCHKA_API}/sbp/v1.0/merchant`,
      params: compactTochkaData({ customerCode, merchantId }),
    },
    {
      url: `${TOCHKA_API}/sbp/v1.0/customer/${encodeURIComponent(customerCode)}/${encodeURIComponent(bankCode)}`,
      params: {},
    },
  ].filter(candidate => candidate.url && !candidate.url.includes('//sbp') && !candidate.url.endsWith('/customer//'));

  for (const candidate of candidates) {
    try {
      const response = await axios.get(candidate.url, { headers, params: candidate.params, timeout: 15000 });
      const legalId = getTochkaLegalId(response.data);
      if (legalId) return legalId;
    } catch {
      // LegalId is optional for some Tochka tenants, keep trying known read endpoints.
    }
  }
  return '';
}

function getTochkaOperationId(operation: any) {
  return operation?.operationId
    || operation?.OperationId
    || operation?.operationID
    || operation?.transactionId
    || operation?.TransactionId
    || operation?.transactionID
    || operation?.entryReference
    || operation?.EntryReference
    || operation?.statementEntryId
    || operation?.StatementEntryId
    || operation?.documentNumber
    || operation?.DocumentNumber
    || operation?.id
    || operation?.paymentId
    || '';
}

function getTochkaOperationStatus(operation: any) {
  return operation?.status
    || operation?.Status
    || operation?.paymentStatus
    || operation?.state
    || '';
}

function getTochkaOperationAmount(operation: any) {
  return operation?.amount
    || operation?.Amount
    || operation?.Amount?.Amount
    || operation?.Amount?.amount
    || operation?.sum
    || operation?.transactionAmount
    || operation?.TransactionAmount
    || operation?.TransactionAmount?.Amount
    || operation?.TransactionAmount?.amount
    || operation?.paymentAmount
    || operation?.totalAmount
    || 0;
}

function normalizeTochkaAmount(value: any) {
  const normalized = Number(value) || Number(String(value || '').replace(',', '.')) || 0;
  return normalized > 100000 ? normalized / 100 : normalized;
}

function toTochkaMinorAmount(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function extractTochkaAccounts(data: any): any[] {
  return [
    ...(data?.Data?.Account || []),
    ...(data?.Data?.Accounts || []),
    ...(data?.data?.accounts || []),
    ...(data?.accounts || []),
  ].filter(Boolean);
}

function extractTochkaBalances(data: any): any[] {
  return [
    ...(data?.Data?.Balance || []),
    ...(data?.Data?.Balances || []),
    ...(data?.data?.balances || []),
    ...(data?.balances || []),
  ].filter(Boolean);
}

function extractTochkaCards(data: any): any[] {
  return [
    ...(data?.Data?.Card || []),
    ...(data?.Data?.Cards || []),
    ...(data?.Data?.card || []),
    ...(data?.Data?.cards || []),
    ...(data?.data?.cards || []),
    ...(data?.cards || []),
    ...(data?.Cards || []),
  ].filter(Boolean);
}

function getBalanceAccountId(balance: any) {
  return String(
    balance?.accountId
    || balance?.AccountId
    || balance?.account
    || balance?.Account
    || ''
  );
}

function getBalanceType(balance: any) {
  return String(balance?.balanceType || balance?.BalanceType || balance?.type || balance?.Type || '').toLowerCase();
}

function getBalanceAmount(balance: any) {
  const raw = balance?.Amount?.amount
    ?? balance?.Amount?.Amount
    ?? balance?.amount?.amount
    ?? balance?.amount?.Amount
    ?? balance?.amount
    ?? balance?.Amount
    ?? balance?.balance
    ?? balance?.Balance
    ?? balance?.value
    ?? 0;
  // Open Banking /balances returns RUB amounts, not kopecks. The generic
  // payment normalizer divides large minor-unit payment values by 100 and
  // must not be used here (140450 ₽ used to become 1404.50 ₽).
  return Number(raw) || Number(String(raw || '').replace(',', '.')) || 0;
}

function maskAccountId(accountId: string) {
  const clean = String(accountId || '');
  const [accountNumber, bankCode] = clean.split('/');
  if (accountNumber && accountNumber.length > 10) {
    return `${accountNumber.slice(0, 4)}…${accountNumber.slice(-6)}${bankCode ? ` / ${bankCode.slice(-3)}` : ''}`;
  }
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function classifyPaymentSource(order: any) {
  const raw = [
    order?.paymentSource,
    order?.paymentType,
    order?.paymentMethod,
    order?.invoiceType,
    order?.payment,
    order?.paymentLabel,
  ].filter(Boolean).join(' ').toLowerCase();
  if (raw.includes('долями') || raw.includes('dolyami')) return 'dolyami';
  if (raw.includes('сплит') || raw.includes('split')) return 'split';
  if (raw.includes('qr') || raw.includes('сбп') || raw.includes('sbp')) return 'qr';
  return 'other';
}

function getFinanceOrderPaidAmount(order: any) {
  const tracked = Boolean(order?.paymentUrl || order?.paymentId || order?.paymentStatus || order?.finalPaymentUrl || order?.finalPaymentId || order?.finalPaymentStatus || Number(order?.paymentAccountingVersion) >= 2);
  if (tracked) {
    const main = isTochkaPaidStatus(order?.paymentStatus)
      ? Number(order?.paymentAmount ?? order?.initialPaymentAmount ?? order?.paidAmount ?? 0) || 0
      : 0;
    const finalPayment = isTochkaPaidStatus(order?.finalPaymentStatus)
      ? Number(order?.finalPaymentAmount ?? order?.dopaymentAmount ?? 0) || 0
      : 0;
    return main + finalPayment;
  }
  return Number(order?.paidAmount ?? order?.prepaymentAmount ?? order?.prepaidAmount ?? 0) || 0;
}

function getFinanceOrderTotal(order: any) {
  const itemTotal = Array.isArray(order?.itemPrices)
    ? order.itemPrices.reduce((sum: number, value: any) => sum + (Number(value) || 0), 0)
    : Number(order?.revenue ?? order?.price ?? 0) || 0;
  return itemTotal + (Number(order?.deliveryPrice ?? order?.shippingCost ?? 0) || 0);
}

function isFinanceActiveOrder(order: any) {
  const status = String(order?.status || '').toLowerCase();
  return getFinanceOrderTotal(order) > 0 && !status.includes('возврат') && !status.includes('отмена');
}

function getTochkaText(...values: any[]) {
  return values
    .filter(Boolean)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => {
      if (typeof value === 'object') {
        return getTochkaText(
          value?.text,
          value?.Text,
          value?.name,
          value?.Name,
          value?.unstructured,
          value?.Unstructured,
          value?.information,
          value?.Information,
          value?.description,
          value?.Description
        );
      }
      return String(value).trim();
    })
    .filter(Boolean)
    .join(' · ');
}

function classifyExpenseCategory(text: string) {
  const raw = String(text || '').toLowerCase();
  const checks: Array<[string, string[]]> = [
    ['ФОТ / наличные', ['выдача наличных', 'выдача наличных денег', 'atm ', 'банкомат', 'cash withdrawal', 'cash advance', 'снятие налич']],
    ['Топливо', ['азс', 'azs', 'лукойл', 'lukoil', 'газпром', 'gazprom', 'gpn', 'роснефть', 'rosneft', 'татнефть', 'tatneft', 'ирбис', 'irbis', 'таиф', 'taif', 'glushko', 'глушко', 'топлив', 'fuel', 'benz', 'бензин']],
    ['Продукты', ['пятероч', 'pyateroch', 'пятёроч', 'верный', 'verny', 'магнит', 'magnit', 'перекресток', 'perekrestok', 'вкусвилл', 'vkusvill', 'самокат', 'samokat', 'lavka', 'лавка', 'ozon fresh', 'доставка из пятероч', 'dostavka iz pyateroch', 'продукт', 'produkty', 'produktovyj', 'food', 'metro', 'spar', 'лента', 'lenta', 'магазин 4087', 'magazin 4087', 'gorizont']],
    ['Кафе / питание', ['кафе', 'kafe', 'coffee', 'skuratov', 'столовая', 'stolovaya', 'pitpol', 'rest ', 'restaurant', 'turgaj', 'шашлык', 'shashlyk', 'myaso', 'пирог', 'pirog', 'gruzinskie istorii', 'татарской кухни', 'tatarskoj kukhni', 'zhar svezhar']],
    ['Парковки / дороги', ['parkomatica', 'парков', 'parking', 'платн дор', 'platn dor', 'оплата пр по платн', 'spp 250']],
    ['Транспорт', ['yandex*', 'яндекс', 'drive', 'такси', 'taxi', 'каршеринг', 'carsharing']],
    ['Покупки / маркетплейсы', ['wildberries', 'wb', 'ozon', 'gold apple', 'gloria jeans', 'lemanapro', 'lemana', 'avito', 'авито', 'smile park', 'almaz sinema', 'kino', 'кино']],
    ['Сервисы / подписки', ['ddx fitness', 'fitness', 'telegram', 'boosty', 'yandex plus', 'яндекс плюс', 'prodmaus', 'prodamus', 'gosuslugi', 'госуслуг', 'md.*gosuslugi', 'sellego']],
    ['Маркетинг', ['instagram', 'vk ', 'яндекс директ', 'direct', 'реклама', 'target', 'meta', 'google ads']],
    ['Аренда', ['аренд', 'rent']],
    ['ФОТ', ['зарплат', 'аванс', 'сотрудник', 'salary', 'самозанят']],
    ['Логистика', ['сдэк', 'cdek', 'почта', 'boxberry', 'достав', 'курьер']],
    ['Производство / материалы', ['ткан', 'фурнитур', 'типограф', 'печать', 'материал', 'шелкограф', 'лекал', 'vellteks', 'iris', 'ирис']],
    ['Налоги', ['налог', 'фнс', 'казнач', 'пенсион', 'страхов']],
    ['Банк / комиссии', ['комисс', 'обслуживание счета', 'банк точка', 'эквайринг', 'bank fee']],
    ['Переводы', ['перевод', 'sbp', 'сбп']],
  ];
  return checks.find(([, keywords]) => keywords.some(keyword => raw.includes(keyword)))?.[0] || 'Другое';
}

function detectCardMask(text: string) {
  const raw = String(text || '');
  const candidates = [
    ...Array.from(raw.matchAll(/(?:карта|card)\D*(?:\d{4,6}[\s*хx•-]+)?(\d{4})(?!\d)/gi)).map(match => match[1]),
    ...Array.from(raw.matchAll(/(?:\*{2,}|x{2,}|х{2,}|•{2,})\s*(\d{4})(?!\d)/gi)).map(match => match[1]),
  ];
  return candidates.find(mask => TOCHKA_KNOWN_CARDS.some(card => card.mask === mask)) || '';
}

function extractTochkaTerminalName(text: string) {
  const raw = String(text || '');
  const terminalMatch = raw.match(/терминал:\s*([^)]*?)(?:,\s*дата операции|,\s*на сумму|,\s*карта|\))/i);
  if (!terminalMatch?.[1]) return '';
  const parts = terminalMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^(ru|rus|russia)$/i.test(part));
  return parts.slice(0, 2).join(', ');
}

function cleanTochkaDescription(rawDescription: string, operation: any, cardMask = '') {
  const raw = String(rawDescription || '').replace(/\s+/g, ' ').trim();
  const counterparty = getTochkaText(
    operation?.counterpartyName,
    operation?.CounterpartyName,
    operation?.Counterparty?.name,
    operation?.Counterparty?.Name,
    operation?.counterparty?.name,
    operation?.merchantName,
    operation?.MerchantName,
    operation?.MerchantDetails?.MerchantName,
    operation?.merchantDetails?.merchantName,
    operation?.CreditorParty?.name,
    operation?.CreditorParty?.Name,
    operation?.creditorParty?.name,
    operation?.DebtorParty?.name,
    operation?.DebtorParty?.Name,
    operation?.debtorParty?.name,
    operation?.debtorName,
    operation?.DebtorName,
    operation?.creditorName,
    operation?.CreditorName
  );
  const terminalName = extractTochkaTerminalName(raw);
  if (/покупка товара|purchase/i.test(raw)) {
    return `Покупка: ${terminalName || counterparty || (cardMask ? `карта *${cardMask}` : 'карта')}`;
  }
  if (/комисс|обслуживание счета|банк точка/i.test(raw)) {
    return 'Банк: комиссия / обслуживание';
  }
  if (counterparty && counterparty !== raw) {
    const purpose = raw
      .replace(/\([^)]*\)/g, '')
      .replace(/^(плат[её]жное поручение|банковский ордер)\s*/i, '')
      .trim();
    return purpose ? `${counterparty} · ${purpose}`.slice(0, 180) : counterparty;
  }
  return raw || 'Операция Точки';
}

function normalizeFinancePartyName(value: any) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownOwnAccountTransfer(operation: any, configuredNames: any[] = []) {
  const directionalParty = operation?.direction === 'income'
    ? operation?.debtorName
    : operation?.creditorName;
  const text = normalizeFinancePartyName(directionalParty || operation?.counterparty);
  if (!text) return false;

  const ownPartyNames = [
    'индивидуальный предприниматель никифорова анна юрьевна',
    'ип никифорова анна юрьевна',
    ...configuredNames,
  ]
    .map(normalizeFinancePartyName)
    .filter(Boolean);

  // Не используем одно только ФИО: клиент с таким же именем не должен
  // случайно исчезнуть из доходов. Нужен полный признак собственного ИП.
  return ownPartyNames.some(name => text.includes(name));
}

function isTochkaRefundOperation(operation: any) {
  if (operation?.direction !== 'expense') return false;
  const text = normalizeFinancePartyName([
    operation?.counterparty,
    operation?.description,
    operation?.rawDescription,
  ].filter(Boolean).join(' '));
  return [
    'возврат покупателю',
    'возврат клиенту',
    'возврат оплаты',
    'возврат денежных средств',
    'refund',
  ].some(marker => text.includes(normalizeFinancePartyName(marker)));
}

function getTochkaStatementId(raw: any) {
  const value = findTochkaValueByKeys(raw, [
    'statementId',
    'StatementId',
    'id',
  ]);
  return value ? String(value) : '';
}

function getTochkaStatementStatus(raw: any) {
  const value = findTochkaValueByKeys(raw, [
    'status',
    'Status',
    'statementStatus',
  ]);
  return value ? String(value) : '';
}

function normalizeTochkaOperation(operation: any, fallbackAccountId = '') {
  const json = JSON.stringify(operation || '');
  const amount = normalizeTochkaAmount(
    operation?.Amount?.amount
    ?? operation?.Amount?.Amount
    ?? operation?.amount?.amount
    ?? operation?.amount?.Amount
    ?? operation?.TransactionAmount?.Amount
    ?? operation?.TransactionAmount?.amount
    ?? operation?.transactionAmount?.Amount
    ?? operation?.transactionAmount?.amount
    ?? operation?.amount
    ?? operation?.sum
    ?? operation?.transactionAmount
    ?? operation?.operationAmount
    ?? operation?.paymentAmount
    ?? operation?.totalAmount
    ?? operation?.value
    ?? 0
  );
  const indicator = String(
    operation?.creditDebitIndicator
    || operation?.CreditDebitIndicator
    || operation?.direction
    || operation?.type
    || ''
  ).toLowerCase();
  const signedAmount = indicator.includes('debit') || indicator.includes('out')
    || indicator.includes('расход')
    || indicator.includes('спис')
    ? -Math.abs(amount)
    : indicator.includes('credit') || indicator.includes('in')
      || indicator.includes('приход')
      || indicator.includes('зачис')
      ? Math.abs(amount)
      : Number(operation?.amount ?? operation?.Amount?.Amount ?? operation?.Amount?.amount) < 0
        ? -Math.abs(amount)
        : amount;
  const rawDescription = getTochkaText(
    operation?.description,
    operation?.Description,
    operation?.purpose,
    operation?.Purpose,
    operation?.paymentPurpose,
    operation?.PaymentPurpose,
    operation?.transactionInformation,
    operation?.TransactionInformation,
    operation?.remittanceInformation,
    operation?.RemittanceInformation,
    operation?.remittanceInformation?.unstructured,
    operation?.RemittanceInformation?.Unstructured,
    operation?.merchantName,
    operation?.MerchantName,
    operation?.MerchantDetails?.MerchantName,
    operation?.merchantDetails?.merchantName,
    operation?.counterpartyName,
    operation?.CounterpartyName,
    operation?.Counterparty?.name,
    operation?.Counterparty?.Name,
    operation?.counterparty?.name,
    operation?.debtorName,
    operation?.DebtorName,
    operation?.creditorName,
    operation?.CreditorName,
    operation?.Data?.purpose
  ) || 'Операция Точки';
  const cardMask = detectCardMask(json);
  const description = cleanTochkaDescription(rawDescription, operation, cardMask);
  const dateRaw = operation?.dateTime
    || operation?.DateTime
    || operation?.bookingDateTime
    || operation?.BookingDateTime
    || operation?.valueDateTime
    || operation?.ValueDateTime
    || operation?.transactionDate
    || operation?.TransactionDate
    || operation?.operationDate
    || operation?.OperationDate
    || operation?.operationDateTime
    || operation?.OperationDateTime
    || operation?.documentDate
    || operation?.DocumentDate
    || operation?.documentProcessDate
    || operation?.DocumentProcessDate
    || operation?.date
    || operation?.Date
    || operation?.createdAt
    || operation?.CreatedAt;
  const date = dateRaw ? new Date(dateRaw) : new Date();
  const accountId = String(
    operation?.accountId
    || operation?.AccountId
    || operation?.Account?.Identification
    || operation?.Account?.accountId
    || operation?.account?.identification
    || operation?.account?.accountId
    || operation?.DebtorAccount?.Identification
    || operation?.CreditorAccount?.Identification
    || fallbackAccountId
    || ''
  );
  const isExpense = signedAmount < 0;
  return {
    id: getTochkaOperationId(operation) || `${accountId}-${date.toISOString()}-${Math.abs(signedAmount)}-${description}`.slice(0, 140),
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    accountId,
    maskedAccountId: maskAccountId(accountId),
    cardMask,
    sourceType: cardMask ? 'card' : 'account',
    amount: signedAmount,
    absAmount: Math.abs(signedAmount),
    direction: isExpense ? 'expense' : 'income',
    category: isExpense ? classifyExpenseCategory(`${rawDescription} ${description}`) : 'Доходы',
    description,
    rawDescription,
    debtorName: getTochkaText(
      operation?.DebtorParty?.name,
      operation?.DebtorParty?.Name,
      operation?.debtorParty?.name,
      operation?.debtorName,
      operation?.DebtorName
    ),
    creditorName: getTochkaText(
      operation?.CreditorParty?.name,
      operation?.CreditorParty?.Name,
      operation?.creditorParty?.name,
      operation?.creditorName,
      operation?.CreditorName
    ),
    counterparty: getTochkaText(
      operation?.counterpartyName,
      operation?.CounterpartyName,
      operation?.Counterparty?.name,
      operation?.Counterparty?.Name,
      operation?.counterparty?.name,
      operation?.merchantName,
      operation?.MerchantName,
      operation?.MerchantDetails?.MerchantName,
      operation?.debtorName,
      operation?.creditorName
    ),
  };
}

async function fetchTochkaOperations(token: string, customerCode: string, accountId: string, dateFrom: string, dateTo: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const params = {
    customerCode,
    accountId,
    dateFrom,
    dateTo,
    from: dateFrom,
    to: dateTo,
    startDate: dateFrom,
    endDate: dateTo,
    dateStart: dateFrom,
    dateEnd: dateTo,
    fromDate: dateFrom,
    toDate: dateTo,
  };
  const encodedAccount = encodeURIComponent(accountId);
  const candidates = [
    { key: 'account_transactions', url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/transactions`, params },
    { key: 'account_operations', url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/operations`, params },
    { key: 'account_statement', url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statement`, params },
    { key: 'account_statements', url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements`, params },
    { key: 'transactions', url: `${TOCHKA_API}/open-banking/v1.0/transactions`, params },
    { key: 'operations', url: `${TOCHKA_API}/open-banking/v1.0/operations`, params },
    { key: 'statement', url: `${TOCHKA_API}/open-banking/v1.0/statement`, params },
    { key: 'statements', url: `${TOCHKA_API}/open-banking/v1.0/statements`, params },
  ];

  const errors: any[] = [];
  const normalizeRows = (raw: any) => extractTochkaOperationRows(raw)
    .map((item: any) => normalizeTochkaOperation(item, accountId))
    .filter((item: any) => Number(item.absAmount) > 0);
  const getStatementIds = (raw: any) => {
    const ids = new Set<string>();
    const directId = getTochkaStatementId(raw);
    if (directId) ids.add(directId);
    for (const item of normalizeTochkaList(raw)) {
      const id = getTochkaStatementId(item);
      if (id) ids.add(id);
    }
    return Array.from(ids);
  };
  const getResponseLinks = (raw: any) => {
    const links = raw?.Links || raw?.links || raw?.Data?.Links || raw?.data?.links || {};
    return Object.values(links)
      .flat()
      .map((value: any) => (typeof value === 'string' ? value : value?.href || value?.url || ''))
      .filter((value: string) => value && value.startsWith('http'));
  };
  const buildStatementFollowUrls = (raw: any) => Array.from(new Set([
    ...getResponseLinks(raw),
    ...getStatementIds(raw).flatMap(id => [
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(id)}`,
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(id)}/transactions`,
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(id)}/operations`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(id)}`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(id)}/transactions`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(id)}/operations`,
    ]),
  ])).slice(0, 16);
  const fetchStatementRows = async (raw: any, source: string) => {
    const directRows = normalizeRows(raw);
    if (directRows.length) return { rows: directRows, source };
    const status = getTochkaStatementStatus(raw);
    const statementId = getTochkaStatementId(raw);
    if (statementId) {
      await writeTochkaStatementCache(customerCode, accountId, dateFrom, dateTo, {
        statementId,
        status: status || '',
        source,
      });
    }
    const followUrls = buildStatementFollowUrls(raw);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0 && statementId) await wait(5500);
      for (const followUrl of followUrls) {
        try {
          const followResponse = await axios.get(followUrl, { headers, params, timeout: 20000 });
          const rows = normalizeRows(followResponse.data);
          if (rows.length) {
            await writeTochkaStatementCache(customerCode, accountId, dateFrom, dateTo, {
              statementId: getTochkaStatementId(followResponse.data) || statementId || '',
              status: getTochkaStatementStatus(followResponse.data) || 'Ready',
              source: `statement_link:${followUrl}`,
            });
            return { rows, source: `statement_link:${followUrl}` };
          }
          const followStatus = getTochkaStatementStatus(followResponse.data);
          errors.push({
            source: `statement_link:${followUrl}`,
            status: followResponse.status,
            message: followStatus
              ? `Выписка в статусе ${followStatus}, операций пока нет`
              : 'Выписка создана, но строк операций в ответе нет',
          });
        } catch (followError: any) {
          errors.push({ source: `statement_link:${followUrl}`, status: followError?.response?.status || null, message: getTochkaErrorMessage(followError) });
        }
      }
      const lastStatus = errors.slice().reverse().find(item => String(item?.message || '').includes('Выписка в статусе'))?.message || '';
      if (!statementId || (!/Created|Processing|Pending/i.test(lastStatus) && attempt > 0)) break;
    }
    if (status) errors.push({ source, status: 200, message: `Выписка в статусе ${status}, операции появятся в Ready` });
    return { rows: [], source: '' };
  };

  const cachedStatement = await readTochkaStatementCache(customerCode, accountId, dateFrom, dateTo);
  const cachedStatementId = String(cachedStatement?.statementId || '');
  if (cachedStatementId) {
    const cachedUrls = [
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(cachedStatementId)}`,
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(cachedStatementId)}/transactions`,
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(cachedStatementId)}/operations`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(cachedStatementId)}`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(cachedStatementId)}/transactions`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(cachedStatementId)}/operations`,
    ];
    for (const cachedUrl of cachedUrls) {
      try {
        const response = await axios.get(cachedUrl, { headers, params, timeout: 20000 });
        const rows = normalizeRows(response.data);
        const status = getTochkaStatementStatus(response.data);
        if (rows.length) {
          await writeTochkaStatementCache(customerCode, accountId, dateFrom, dateTo, {
            statementId: cachedStatementId,
            status: status || 'Ready',
            source: `cached_statement:${cachedUrl}`,
          });
          return { ok: true, source: `cached_statement:${cachedUrl}`, operations: rows, errors };
        }
        errors.push({
          source: `cached_statement:${cachedUrl}`,
          status: response.status,
          message: status ? `Выписка ${cachedStatementId} пока в статусе ${status}` : `Выписка ${cachedStatementId} пока без операций`,
        });
      } catch (error: any) {
        errors.push({ source: `cached_statement:${cachedUrl}`, status: error?.response?.status || null, message: getTochkaErrorMessage(error) });
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const response = await axios.get(candidate.url, { headers, params: candidate.params, timeout: 15000 });
      const rows = normalizeRows(response.data);
      if (rows.length) return { ok: true, source: candidate.key, operations: rows, errors };
      const statementRows = await fetchStatementRows(response.data, candidate.key);
      if (statementRows.rows.length) return { ok: true, source: statementRows.source, operations: statementRows.rows, errors };
      errors.push({ source: candidate.key, status: response.status, message: 'Операций нет в ответе' });
    } catch (error: any) {
      errors.push({ source: candidate.key, status: error?.response?.status || null, message: getTochkaErrorMessage(error) });
    }
  }

  const fromDateTime = `${dateFrom}T00:00:00+03:00`;
  const toDateTime = `${dateTo}T23:59:59+03:00`;
  const statementBodies = [
    { Data: { Statement: { accountId, customerCode, startDateTime: dateFrom, endDateTime: dateTo } } },
    { Data: { Statement: { accountId, customerCode, dateFrom, dateTo } } },
    { Data: { Statement: { accountId, customerCode, from: dateFrom, to: dateTo } } },
    { Data: { Statement: { accountId, customerCode, startDate: dateFrom, endDate: dateTo } } },
    { Data: { Statement: { accountId, customerCode, fromBookingDateTime: fromDateTime, toBookingDateTime: toDateTime } } },
    { Data: { Statement: { AccountId: accountId, CustomerCode: customerCode, FromBookingDateTime: fromDateTime, ToBookingDateTime: toDateTime } } },
    { Data: { AccountId: accountId, CustomerCode: customerCode, FromBookingDateTime: fromDateTime, ToBookingDateTime: toDateTime } },
    { Data: { customerCode, accountId, dateFrom, dateTo } },
    { Data: { customerCode, accountId, from: dateFrom, to: dateTo } },
    { Data: { customerCode, accountId, startDate: dateFrom, endDate: dateTo } },
    { Data: { customerCode, accountId, fromBookingDateTime: fromDateTime, toBookingDateTime: toDateTime } },
    { Data: { customerCode, accountId, statementPeriod: { from: dateFrom, to: dateTo } } },
    { Data: { customerCode, accountId, period: { dateFrom, dateTo } } },
    { customerCode, accountId, fromBookingDateTime: fromDateTime, toBookingDateTime: toDateTime },
    { customerCode, accountId, dateFrom, dateTo },
  ];
  const statementUrls = [
    `${TOCHKA_API}/open-banking/v1.0/statements`,
    `${TOCHKA_API}/open-banking/v1.0/statement`,
    `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements`,
  ];

  for (const statementUrl of statementUrls) {
    for (const body of statementBodies) {
      try {
        const response = await axios.post(statementUrl, body, { headers, timeout: 20000 });
        const statementRows = await fetchStatementRows(response.data, `post_statement:${statementUrl}`);
        if (statementRows.rows.length) return { ok: true, source: statementRows.source || `post_statement:${statementUrl}`, operations: statementRows.rows, errors };
        const statementStatus = getTochkaStatementStatus(response.data);
        const statementId = getTochkaStatementId(response.data);
        errors.push({
          source: `post_statement:${statementUrl}`,
          status: response.status,
          message: statementId
            ? `Выписка ${statementId} создана${statementStatus ? `, статус ${statementStatus}` : ''}. Нажми обновить через минуту.`
            : 'Выписка создана/принята, но операции не вернулись сразу',
        });
      } catch (error: any) {
        errors.push({ source: `post_statement:${statementUrl}`, status: error?.response?.status || null, message: getTochkaErrorMessage(error) });
      }
    }
  }
  return { ok: false, source: '', operations: [], errors };
}

async function fetchTochkaCardOperations(token: string, customerCode: string, dateFrom: string, dateTo: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const baseParams = {
    customerCode,
    dateFrom,
    dateTo,
    from: dateFrom,
    to: dateTo,
    startDate: dateFrom,
    endDate: dateTo,
    dateStart: dateFrom,
    dateEnd: dateTo,
    fromDate: dateFrom,
    toDate: dateTo,
  };
  const errors: any[] = [];
  const cardListCandidates = [
    { key: 'cards', url: `${TOCHKA_API}/cards/v1.0/cards`, params: baseParams },
    { key: 'corporate_cards', url: `${TOCHKA_API}/corporate-cards/v1.0/cards`, params: baseParams },
    { key: 'open_banking_cards', url: `${TOCHKA_API}/open-banking/v1.0/cards`, params: baseParams },
    { key: 'banking_cards', url: `${TOCHKA_API}/banking/v1.0/cards`, params: baseParams },
  ];

  const foundCards: Array<{ id: string; mask: string; label: string }> = [];
  for (const candidate of cardListCandidates) {
    try {
      const response = await axios.get(candidate.url, { headers, params: candidate.params, timeout: 15000 });
      const cards = extractTochkaCards(response.data);
      for (const card of cards) {
        const raw = JSON.stringify(card || '');
        const mask = detectCardMask(raw)
          || String(card?.panTail || card?.last4 || card?.cardMask || card?.maskedPan || '').slice(-4);
        const id = String(card?.cardId || card?.id || card?.cardToken || card?.maskedPan || mask || '').trim();
        if (!id && !mask) continue;
        if (!TOCHKA_KNOWN_CARDS.some(known => known.mask === mask)) continue;
        foundCards.push({
          id: id || mask,
          mask: mask || id.slice(-4),
          label: String(card?.name || card?.cardName || card?.type || 'Карта'),
        });
      }
      errors.push({ source: candidate.key, status: response.status, message: cards.length ? `Найдено карт: ${cards.length}` : 'Список карт пуст' });
    } catch (error: any) {
      errors.push({ source: candidate.key, status: error?.response?.status || null, message: getTochkaErrorMessage(error) });
    }
  }

  for (const known of TOCHKA_KNOWN_CARDS) {
    if (!foundCards.some(card => card.mask === known.mask)) {
      foundCards.push({ id: known.mask, mask: known.mask, label: known.label });
    }
  }

  const operations: any[] = [];
  const uniqueCards = Array.from(new Map(foundCards.map(card => [`${card.id}-${card.mask}`, card])).values());
  const normalizeCardRows = (raw: any, card: { id: string; mask: string; label: string }) => extractTochkaOperationRows(raw)
    .map((item: any) => {
      const row = normalizeTochkaOperation(item, `card:${card.mask}`);
      if (!row.cardMask || row.cardMask !== card.mask) return null;
      return {
        ...row,
        sourceType: 'card',
        sourceLabel: card.label,
        cardMask: row.cardMask,
        accountId: row.accountId?.startsWith('card:') ? row.accountId : (row.accountId || `card:${row.cardMask}`),
        maskedAccountId: `*${row.cardMask}`,
      };
    })
    .filter(Boolean)
    .filter((item: any) => Number(item.absAmount) > 0);

  for (const card of uniqueCards) {
    const encodedCard = encodeURIComponent(card.id);
    const cardParams = { ...baseParams, cardId: card.id, cardMask: card.mask, panTail: card.mask, last4: card.mask };
    const candidates = [
      { key: `card_transactions_${card.mask}`, url: `${TOCHKA_API}/cards/v1.0/cards/${encodedCard}/transactions`, params: cardParams },
      { key: `card_operations_${card.mask}`, url: `${TOCHKA_API}/cards/v1.0/cards/${encodedCard}/operations`, params: cardParams },
      { key: `corporate_card_transactions_${card.mask}`, url: `${TOCHKA_API}/corporate-cards/v1.0/cards/${encodedCard}/transactions`, params: cardParams },
      { key: `corporate_card_operations_${card.mask}`, url: `${TOCHKA_API}/corporate-cards/v1.0/cards/${encodedCard}/operations`, params: cardParams },
      { key: `open_banking_card_transactions_${card.mask}`, url: `${TOCHKA_API}/open-banking/v1.0/cards/${encodedCard}/transactions`, params: cardParams },
      { key: `open_banking_card_operations_${card.mask}`, url: `${TOCHKA_API}/open-banking/v1.0/cards/${encodedCard}/operations`, params: cardParams },
      { key: `cards_transactions_${card.mask}`, url: `${TOCHKA_API}/cards/v1.0/transactions`, params: cardParams },
      { key: `cards_operations_${card.mask}`, url: `${TOCHKA_API}/cards/v1.0/operations`, params: cardParams },
    ];

    for (const candidate of candidates) {
      try {
        const response = await axios.get(candidate.url, { headers, params: candidate.params, timeout: 15000 });
        const rows = normalizeCardRows(response.data, card);
        if (rows.length) {
          operations.push(...rows);
          errors.push({ source: candidate.key, status: response.status, message: `Операций: ${rows.length}` });
          break;
        }
        errors.push({ source: candidate.key, status: response.status, message: 'Операций нет в ответе' });
      } catch (error: any) {
        errors.push({ source: candidate.key, status: error?.response?.status || null, message: getTochkaErrorMessage(error) });
      }
    }
  }

  return { ok: operations.length > 0, source: operations.length ? 'card_operations' : '', operations, errors };
}

async function loadAllOrdersForFinance() {
  const docs: any[] = [];
  if (adminDb) {
    const snap = await adminDb.collection('orders_new').get();
    snap.forEach((docSnap: any) => docs.push({ id: docSnap.id, ...docSnap.data() }));
  } else if (db) {
    const snap = await getDocs(collection(db, 'orders_new'));
    snap.docs.forEach((docSnap: any) => docs.push({ id: docSnap.id, ...docSnap.data() }));
  }

  return docs;
}

async function loadOrdersForFinanceMonth(monthKey: string) {
  const docs = await loadAllOrdersForFinance();
  return docs.filter((order: any) => {
    const rawDate = order?.date || order?.orderDate || order?.createdAt;
    const date = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate || Date.now());
    if (Number.isNaN(date.getTime())) return false;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return key === monthKey;
  });
}

function getFinanceMonthKey(value: any) {
  const rawDate = value?.toDate ? value.toDate() : new Date(value || 0);
  if (Number.isNaN(rawDate.getTime())) return '';
  return `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}`;
}

function operationIsWithinDates(operation: any, dateFrom: string, dateTo: string) {
  const key = String(operation?.date || '').slice(0, 10);
  return Boolean(key && key >= dateFrom && key <= dateTo);
}

function formatFinanceDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function findFinanceOrderForOperation(operation: any, orders: any[]) {
  const haystack = `${operation?.description || ''} ${operation?.rawDescription || ''}`.toLowerCase();
  if (!haystack.trim()) return null;
  return orders.find(order => {
    const candidates = [order?.id, order?.orderId, order?.orderNumber]
      .map(value => String(value || '').replace(/^#/, '').trim().toLowerCase())
      .filter(value => value.length >= 4);
    return candidates.some(value => haystack.includes(value));
  }) || null;
}

function isTochkaPaidStatus(status: any) {
  const normalized = String(status || '').toLowerCase();
  return ['paid', 'approved', 'accepted', 'completed', 'succeeded', 'success', 'done'].some(item => normalized.includes(item));
}

function isRefundCompletedStatus(status: any) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['accepted', 'refunded', 'completed', 'succeeded', 'success', 'done'].includes(normalized);
}

function isRefundRejectedStatus(status: any) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['rejected', 'failed', 'error', 'cancelled', 'canceled'].includes(normalized);
}

function getOrderStatusForRefund(status: any) {
  if (isRefundCompletedStatus(status)) return 'Вернули платёж';
  if (isRefundRejectedStatus(status)) return 'Ошибка возврата';
  return 'Возврат ожидает подтверждения';
}

function getTochkaPaymentTarget(orderId: any, kind?: any) {
  const paymentLinkId = String(orderId || '').trim();
  const explicitFinal = String(kind || '').toLowerCase() === 'final';
  const suffixFinal = paymentLinkId.toLowerCase().endsWith('-final');
  const isFinal = explicitFinal || suffixFinal;
  const withoutFinalSuffix = suffixFinal ? paymentLinkId.slice(0, -6) : paymentLinkId;
  const cleanOrderId = withoutFinalSuffix.replace(/^#+\s*/, '').trim();
  return { paymentLinkId, cleanOrderId, isFinal };
}

function buildTochkaPaymentFields(target: { isFinal: boolean }, paymentId: string, paymentStatus: string, paymentAmount: number, operation?: any) {
  const paidAt = new Date().toISOString();
  const isPaid = isTochkaPaidStatus(paymentStatus);
  const trxId = operation ? findTochkaValueByKeys(operation, ['trxId', 'operationId']) : '';
  const refTransactionId = operation ? findTochkaValueByKeys(operation, ['refTransactionId']) : '';
  const qrcId = operation ? findTochkaValueByKeys(operation, ['qrcId', 'qrId']) : '';
  if (target.isFinal) {
    return {
      ...(paymentId ? { finalPaymentId: paymentId } : {}),
      ...(qrcId ? { finalPaymentQrcId: String(qrcId) } : {}),
      ...(trxId ? { finalPaymentTrxId: String(trxId) } : {}),
      ...(refTransactionId ? { finalPaymentRefTransactionId: String(refTransactionId) } : {}),
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
    ...(qrcId ? { paymentQrcId: String(qrcId) } : {}),
    ...(trxId ? { paymentTrxId: String(trxId) } : {}),
    ...(refTransactionId ? { paymentRefTransactionId: String(refTransactionId) } : {}),
    paymentStatus,
    ...(paymentAmount > 0 ? { paymentAmount } : {}),
    tochkaPaymentFoundAt: paidAt,
    ...(operation ? { tochkaPaymentData: JSON.stringify(operation).slice(0, 2000) } : {}),
    paymentAccountingVersion: 2,
    ...(paymentAmount > 0 ? { initialPaymentAmount: paymentAmount } : {}),
    ...(isPaid ? { paymentPaidAt: paidAt } : {}),
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
  const cleanOrderId = String(orderId).trim().toLowerCase();
  const expectedAmount = Number(amount) || 0;
  const isCloseAmount = (value: unknown) => {
    if (!expectedAmount) return true;
    const normalizedRub = normalizeTochkaAmount(value);
    return Math.abs(normalizedRub - expectedAmount) < 1;
  };
  const operation = operations.find((item: any) => {
    const haystack = JSON.stringify(item || {}).toLowerCase();
    const status = String(getTochkaOperationStatus(item)).toLowerCase();
    const operationAmount = getTochkaOperationAmount(item);
    return haystack.includes(cleanOrderId)
      && (!status || status.includes('approved') || status.includes('paid'))
      && isCloseAmount(operationAmount);
  }) || operations.find((item: any) => JSON.stringify(item || {}).toLowerCase().includes(cleanOrderId));

  return operation || null;
}

async function findTochkaOperationId(token: string, customerCode: string, orderId: string, amount?: number) {
  const operation = await findTochkaOperation(token, customerCode, orderId, amount);
  return getTochkaOperationId(operation);
}

async function findTochkaSbpPaymentInStatement(
  token: string,
  customerCode: string,
  accountId: string,
  qrcId: string,
  amount: number,
  paymentCreatedAt?: string,
) {
  if (!customerCode || !accountId || !qrcId || amount <= 0) return null;
  const parsedCreated = new Date(paymentCreatedAt || Date.now());
  const start = Number.isNaN(parsedCreated.getTime()) ? new Date() : parsedCreated;
  start.setDate(start.getDate() - 1);
  const dateFrom = formatFinanceDate(start);
  const dateTo = formatFinanceDate(new Date());
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await axios.post(`${TOCHKA_API}/open-banking/v1.0/statements`, {
    Data: {
      Statement: {
        accountId,
        customerCode,
        startDateTime: dateFrom,
        endDateTime: dateTo,
      },
    },
  }, { headers, timeout: 20000 });
  const statementId = getTochkaStatementId(response.data);
  if (!statementId) return null;
  const statementUrl = `${TOCHKA_API}/open-banking/v1.0/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await wait(1500);
    const statementResponse = await axios.get(statementUrl, { headers, timeout: 20000 });
    const transactions = extractTochkaOperationRows(statementResponse.data);
    const match = findSbpStatementPayment(transactions, qrcId, amount);
    if (match) return match;
    if (!/created|processing|pending/i.test(getTochkaStatementStatus(statementResponse.data))) break;
  }
  return null;
}

async function findTochkaSbpPaymentByQr(
  token: string,
  customerCode: string,
  qrcId: string,
  paymentCreatedAt?: string,
) {
  if (!customerCode || !qrcId) return null;
  const parsedCreated = new Date(paymentCreatedAt || Date.now());
  const fromDate = formatFinanceDate(Number.isNaN(parsedCreated.getTime()) ? new Date() : parsedCreated);
  const response = await axios.get(`${TOCHKA_API}/sbp/v1.0/get-sbp-payments`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    params: { customer_code: customerCode, fromDate },
    timeout: 20000,
  });
  return findAcceptedSbpPaymentByQr(normalizeTochkaList(response.data), qrcId);
}

async function getTochkaRefundData(token: string, requestId: string) {
  const response = await axios.get(`${TOCHKA_API}/sbp/v1.0/refund/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return response.data || {};
}

// Сохранить JWT токен Точки
app.post('/api/tochka/save-token', async (req, res) => {
  const { jwtToken, merchantId, accountId, legalId, paymentMode } = req.body;
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const current = await readTochkaSettingsDoc('tochka_api');
    const finalToken = jwtToken?.trim() || current.jwtToken;
    if (!finalToken) return res.status(400).json({ error: 'Нужен jwtToken' });

    const payload: any = decodeJwtPayload(finalToken);
    const customerCode = payload.customerCode || payload.customer_code || current.customerCode || '';
    const savePromise = writeTochkaSettingsDoc('tochka_api', {
      jwtToken: finalToken,
      customerCode,
      merchantId: String(merchantId || '').trim() || current.merchantId || '',
      accountId: String(accountId || '').trim() || current.accountId || '',
      legalId: String(legalId || '').trim() || current.legalId || '',
      paymentMode: Array.isArray(paymentMode) ? paymentMode : ['sbp'],
    });
    await Promise.race([
      savePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Сохранение заняло больше 15 секунд. Проверь интернет и повтори.')), 15000)),
    ]);
    res.json({ success: true, customerCode });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Не удалось сохранить настройки Точки' });
  }
});

app.all('/api/tochka/oauth*', (_req, res) => {
  res.status(410).json({
    error: 'OAuth Точки отключен. Используется только старый JWT / API token.',
  });
});

const YANDEX_PAY_DEFAULT_MERCHANT_ID = String(
  process.env.YANDEX_PAY_MERCHANT_ID || '1488c401-6dde-4296-93d0-282768ab0251'
).trim();
const YANDEX_PAY_ENV_API_KEY = String(process.env.YANDEX_PAY_API_KEY || '').trim();
const YANDEX_PAY_ENV_SANDBOX = /^(1|true|yes)$/i.test(String(process.env.YANDEX_PAY_SANDBOX || ''));
const YANDEX_PAY_PRODUCTION_JWKS = createRemoteJWKSet(new URL('https://pay.yandex.ru/api/jwks'));
const YANDEX_PAY_SANDBOX_JWKS = createRemoteJWKSet(new URL('https://sandbox.pay.yandex.ru/api/jwks'));

type YandexPayCredentials = {
  merchantId: string;
  apiKey: string;
  sandbox: boolean;
};

async function getYandexPayCredentials(): Promise<YandexPayCredentials> {
  const saved = await readTochkaSettingsDoc('yandex_pay').catch(() => ({}));
  return {
    merchantId: String(saved?.merchantId || YANDEX_PAY_DEFAULT_MERCHANT_ID).trim(),
    apiKey: String(saved?.apiKey || YANDEX_PAY_ENV_API_KEY).trim(),
    sandbox: typeof saved?.sandbox === 'boolean' ? saved.sandbox : YANDEX_PAY_ENV_SANDBOX,
  };
}

function getYandexPayBaseUrl(sandbox: boolean) {
  return sandbox ? 'https://sandbox.pay.yandex.ru/api/merchant' : 'https://pay.yandex.ru/api/merchant';
}

function getYandexPayCallbackUrl() {
  return `${String(process.env.SERVER_URL || 'https://ybcrm.ru').replace(/\/$/, '')}/api/yandex-pay/v1/webhook`;
}

function getYandexPaymentTarget(orderId: string) {
  const raw = String(orderId || '').trim();
  const isFinal = /-final$/i.test(raw);
  return { cleanOrderId: raw.replace(/-final$/i, ''), isFinal };
}

function getYandexPayOrderId(orderId: string) {
  const target = getYandexPaymentTarget(orderId);
  const digest = createHash('sha256').update(`${target.cleanOrderId}:${target.isFinal ? 'final' : 'main'}`).digest('hex').slice(0, 24);
  return `ybcrm-${digest}${target.isFinal ? '-final' : ''}`;
}

function yandexPayHeaders(requestId: string, apiKey: string) {
  return {
    Authorization: `Api-Key ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
    'X-Request-Timeout': '10000',
    'X-Request-Attempt': '0',
  };
}

function asMoney(value: unknown) {
  return Math.max(0, Number(value) || 0).toFixed(2);
}

function orderSnapshotExists(snapshot: any) {
  return typeof snapshot?.exists === 'function' ? snapshot.exists() : Boolean(snapshot?.exists);
}

function allocateMoney(total: number, weights: number[], count: number) {
  const totalCents = Math.round(Math.max(0, total) * 100);
  const safeCount = Math.max(1, count);
  const safeWeights = Array.from({ length: safeCount }, (_, index) => Math.max(0, Number(weights[index]) || 0));
  const weightTotal = safeWeights.reduce((sum, value) => sum + value, 0);
  let remaining = totalCents;
  return safeWeights.map((weight, index) => {
    const cents = index === safeCount - 1
      ? remaining
      : Math.min(remaining, Math.round(weightTotal > 0 ? totalCents * (weight / weightTotal) : totalCents / safeCount));
    remaining -= cents;
    return cents / 100;
  });
}

function buildYandexPayCart(orderId: string, order: any, amount: number) {
  const rawItems = Array.isArray(order.items) && order.items.length ? order.items : [order.item || `Заказ #${orderId}`];
  const prices = Array.isArray(order.itemPrices) ? order.itemPrices.map((value: unknown) => Number(value) || 0) : [];
  const revenue = Math.max(0, Number(order.revenue) || 0);
  const positivePrices = rawItems.map((_: unknown, index: number) => Math.max(0, prices[index] || 0));
  const knownTotal = positivePrices.reduce((sum: number, value: number) => sum + value, 0);
  const productTotal = revenue || knownTotal;
  const normalizedPrices = allocateMoney(productTotal, knownTotal > 0 ? positivePrices : rawItems.map(() => 1), rawItems.length);
  const delivery = Math.max(0, Number(order.deliveryPrice) || 0);
  const expectedTotal = productTotal + delivery;
  if (Math.abs(expectedTotal - amount) > 0.02) {
    throw new Error(`Для Сплита нужна полная сумма заказа ${asMoney(expectedTotal)} ₽, сейчас передано ${asMoney(amount)} ₽`);
  }
  const items = rawItems.map((title: unknown, index: number) => ({
    productId: `${orderId}-item-${index + 1}`,
    skuId: `${orderId}-${index + 1}`,
    title: String(title || `Товар ${index + 1}`).slice(0, 2048),
    quantity: { count: '1' },
    unitPrice: asMoney(normalizedPrices[index]),
    subtotal: asMoney(normalizedPrices[index]),
    total: asMoney(normalizedPrices[index]),
  }));
  if (delivery > 0) {
    items.push({
      productId: `${orderId}-delivery`,
      skuId: `${orderId}-delivery`,
      title: `Доставка ${String(order.deliveryMethod || '').trim() || 'заказа'}`,
      quantity: { count: '1' },
      unitPrice: asMoney(delivery),
      subtotal: asMoney(delivery),
      total: asMoney(delivery),
    });
  }
  return { externalId: orderId, items, total: { amount: asMoney(amount) } };
}

app.get('/api/yandex-pay/status', async (_req, res) => {
  try {
    const credentials = await getYandexPayCredentials();
    res.json({
      configured: Boolean(credentials.merchantId && credentials.apiKey),
      merchantId: credentials.merchantId,
      merchantIdPreview: credentials.merchantId ? `${credentials.merchantId.slice(0, 8)}…${credentials.merchantId.slice(-4)}` : '',
      apiKeySet: Boolean(credentials.apiKey),
      sandbox: credentials.sandbox,
      callbackUrl: getYandexPayCallbackUrl(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Не удалось прочитать настройки Яндекс Пэй' });
  }
});

app.post('/api/yandex-pay/save-settings', async (req, res) => {
  try {
    const current = await getYandexPayCredentials();
    const merchantId = String(req.body?.merchantId || current.merchantId).trim();
    const apiKey = String(req.body?.apiKey || current.apiKey).trim();
    const sandbox = Boolean(req.body?.sandbox);
    if (!merchantId) return res.status(400).json({ error: 'Укажите Merchant ID Яндекс Пэй' });
    if (!apiKey) return res.status(400).json({ error: 'Выпустите и вставьте Merchant API key' });
    await writeTochkaSettingsDoc('yandex_pay', {
      merchantId,
      apiKey,
      sandbox,
      updatedAt: new Date().toISOString(),
    });
    res.json({
      success: true,
      configured: true,
      merchantId,
      merchantIdPreview: `${merchantId.slice(0, 8)}…${merchantId.slice(-4)}`,
      apiKeySet: true,
      sandbox,
      callbackUrl: getYandexPayCallbackUrl(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Не удалось сохранить настройки Яндекс Пэй' });
  }
});

app.post('/api/yandex-pay/test', async (_req, res) => {
  try {
    const credentials = await getYandexPayCredentials();
    if (!credentials.merchantId || !credentials.apiKey) return res.status(503).json({ error: 'Сначала сохраните Merchant ID и Merchant API key' });
    try {
      await axios.get(`${getYandexPayBaseUrl(credentials.sandbox)}/v1/orders/ybcrm-connection-check`, {
        headers: yandexPayHeaders(randomBytes(16).toString('hex'), credentials.apiKey),
        timeout: 12000,
      });
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      if (status === 401 || status === 403) {
        return res.status(status).json({ error: 'Яндекс отклонил Merchant API key. Проверьте ключ и режим тестовых данных.' });
      }
      if (!error?.response || ![400, 404, 409, 422].includes(status)) throw error;
    }
    res.json({ success: true, message: `Подключение работает (${credentials.sandbox ? 'тестовый' : 'боевой'} режим)` });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: error?.response?.data?.message || error?.message || 'Не удалось проверить Яндекс Пэй' });
  }
});

app.post('/api/yandex-pay/create-payment', async (req, res) => {
  if (!await requireCrmOrderAction(req, res, 'payments')) return;
  const { orderId, amount, description } = req.body || {};
  const paymentAmount = Number(amount);
  if (!orderId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) return res.status(400).json({ error: 'Нужны orderId и сумма больше 0' });
  try {
    const credentials = await getYandexPayCredentials();
    if (!credentials.merchantId || !credentials.apiKey) return res.status(503).json({ error: 'Яндекс Сплит ещё не активирован: сохраните Merchant API key на странице API' });
    const target = getYandexPaymentTarget(String(orderId));
    const snapshot = await getOrderSnapshot(target.cleanOrderId);
    if (!orderSnapshotExists(snapshot)) return res.status(404).json({ error: `Заказ ${target.cleanOrderId} не найден` });
    const order = snapshot.data() || {};
    const existingProvider = target.isFinal ? order.finalPaymentProvider : order.paymentProvider;
    const existingUrl = target.isFinal ? order.finalPaymentUrl : order.paymentUrl;
    const existingAmount = Number(target.isFinal ? order.finalPaymentAmount : order.paymentAmount);
    if (existingProvider === 'yandex_split' && existingUrl && Math.abs(existingAmount - paymentAmount) < 0.01) {
      return res.json({ success: true, existing: true, paymentUrl: existingUrl, paymentId: target.isFinal ? order.finalPaymentId : order.paymentId, provider: 'yandex_split' });
    }
    const yandexOrderId = getYandexPayOrderId(String(orderId));
    const requestId = randomBytes(16).toString('hex');
    const phone = String(order.clientPhone || '').replace(/\D/g, '');
    const baseUrl = String(process.env.SERVER_URL || 'https://ybcrm.ru').replace(/\/$/, '');
    const body = {
      orderId: yandexOrderId,
      currencyCode: 'RUB',
      availablePaymentMethods: ['CARD', 'SPLIT'],
      preferredPaymentMethod: 'SPLIT',
      orderSource: 'CRM',
      billingPhone: phone || undefined,
      purpose: String(description || `Оплата заказа #${target.cleanOrderId}`).slice(0, 1000),
      metadata: JSON.stringify({ crmOrderId: target.cleanOrderId, kind: target.isFinal ? 'final' : 'main' }),
      ttl: 604800,
      redirectUrls: {
        onSuccess: `${baseUrl}/pay/${encodeURIComponent(target.cleanOrderId)}?yandex=success`,
        onAbort: `${baseUrl}/pay/${encodeURIComponent(target.cleanOrderId)}?yandex=abort`,
        onError: `${baseUrl}/pay/${encodeURIComponent(target.cleanOrderId)}?yandex=error`,
      },
      cart: buildYandexPayCart(target.cleanOrderId, order, paymentAmount),
    };
    const response = await axios.post(`${getYandexPayBaseUrl(credentials.sandbox)}/v1/orders`, body, { headers: yandexPayHeaders(requestId, credentials.apiKey), timeout: 12000 });
    const paymentUrl = String(response.data?.data?.paymentUrl || '');
    if (!paymentUrl) throw new Error('Яндекс Пэй не вернул ссылку на оплату');
    const now = new Date().toISOString();
    const patch = target.isFinal ? {
      finalPaymentUrl: paymentUrl,
      finalPaymentId: yandexOrderId,
      finalPaymentStatus: 'PENDING',
      finalPaymentProvider: 'yandex_split',
      finalPaymentCreatedAt: now,
      finalPaymentAmount: paymentAmount,
      paymentAccountingVersion: 2,
    } : {
      paymentUrl,
      paymentId: yandexOrderId,
      paymentStatus: 'PENDING',
      paymentProvider: 'yandex_split',
      paymentCreatedAt: now,
      paymentAmount,
      initialPaymentAmount: paymentAmount,
      paymentAccountingVersion: 2,
    };
    await persistOrderPatch(target.cleanOrderId, patch);
    res.json({ success: true, paymentUrl, paymentId: yandexOrderId, provider: 'yandex_split' });
  } catch (error: any) {
    const details = error?.response?.data || error?.message;
    console.error('[yandex-pay] create-payment:', details);
    res.status(error?.response?.status || 500).json({ error: error?.response?.data?.message || error?.message || 'Не удалось создать Сплит', details });
  }
});

app.get('/api/yandex-pay/find-payment', async (req, res) => {
  if (!await requireCrmOrderAction(req, res, 'payments')) return;
  const orderId = String(req.query.orderId || '').trim();
  if (!orderId) return res.status(400).json({ error: 'Нужен orderId' });
  try {
    const credentials = await getYandexPayCredentials();
    if (!credentials.apiKey) return res.status(503).json({ error: 'Яндекс Сплит не настроен' });
    const target = getYandexPaymentTarget(orderId);
    const snapshot = await getOrderSnapshot(target.cleanOrderId);
    const order = snapshot?.data?.() || {};
    const yandexOrderId = String(target.isFinal ? order.finalPaymentId : order.paymentId) || getYandexPayOrderId(orderId);
    const response = await axios.get(`${getYandexPayBaseUrl(credentials.sandbox)}/v1/orders/${encodeURIComponent(yandexOrderId)}`, {
      headers: yandexPayHeaders(randomBytes(16).toString('hex'), credentials.apiKey),
      timeout: 12000,
    });
    const remoteOrder = response.data?.data?.order || {};
    const status = String(remoteOrder.paymentStatus || 'PENDING').toUpperCase();
    const paid = ['CAPTURED', 'CONFIRMED'].includes(status);
    const patch = target.isFinal ? {
      finalPaymentStatus: status,
      finalPaymentProvider: 'yandex_split',
      finalPaymentPaidAt: paid ? String(remoteOrder.updated || new Date().toISOString()) : order.finalPaymentPaidAt || null,
    } : {
      paymentStatus: status,
      paymentProvider: 'yandex_split',
      paymentPaidAt: paid ? String(remoteOrder.updated || new Date().toISOString()) : order.paymentPaidAt || null,
    };
    await persistOrderPatch(target.cleanOrderId, patch);
    res.json({ success: true, paymentStatus: status, paymentId: yandexOrderId, paymentUrl: remoteOrder.paymentUrl || '', paymentPaidAt: paid ? remoteOrder.updated : null });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({ error: error?.response?.data?.message || error?.message || 'Не удалось проверить Сплит', details: error?.response?.data });
  }
});

app.post('/api/yandex-pay/refund-payment', async (req, res) => {
  const actor: any = await requireRefundOwner(req, res);
  if (!actor) return;
  const orderId = String(req.body?.orderId || '').trim();
  const target = getYandexPaymentTarget(orderId);
  const reason = String(req.body?.reason || 'Клиенту не подошёл товар').trim().slice(0, 500);
  if (!orderId) return res.status(400).json({ error: 'Нужен orderId' });

  try {
    const credentials = await getYandexPayCredentials();
    if (!credentials.apiKey) return res.status(503).json({ error: 'Яндекс Сплит не настроен' });
    const snapshot = await getOrderSnapshot(target.cleanOrderId);
    if (!orderSnapshotExists(snapshot)) return res.status(404).json({ error: `Заказ ${target.cleanOrderId} не найден` });
    const order = snapshot.data() || {};
    const yandexOrderId = String(target.isFinal ? order.finalPaymentId : order.paymentId || '').trim();
    const storedAmount = Number(target.isFinal ? order.finalPaymentAmount : (order.paymentAmount || order.initialPaymentAmount)) || 0;
    const refundAmount = Number(req.body?.amount) || storedAmount;
    const hasScopedRefunds = Boolean(order.mainRefundStatus || order.finalRefundStatus);
    const existingRefundStatus = String(
      (target.isFinal ? order.finalRefundStatus : order.mainRefundStatus)
      || (!hasScopedRefunds ? order.refundStatus : '')
      || '',
    ).trim();
    if (!yandexOrderId) return res.status(409).json({ error: 'У платежа Яндекс Сплита не найден идентификатор' });
    if (!Number.isFinite(refundAmount) || refundAmount < 1 || refundAmount > storedAmount) {
      return res.status(400).json({ error: `Сумма возврата должна быть от 1 ₽ до ${storedAmount.toFixed(2)} ₽` });
    }
    if (existingRefundStatus && !/fail/i.test(existingRefundStatus)) {
      return res.status(409).json({ error: 'Возврат этого платежа уже создан' });
    }

    const externalOperationId = `ybcrm-refund-${createHash('sha256')
      .update(`${target.cleanOrderId}:${target.isFinal ? 'final' : 'main'}:${refundAmount.toFixed(2)}`)
      .digest('hex').slice(0, 24)}`;
    const response = await axios.post(
      `${getYandexPayBaseUrl(credentials.sandbox)}/v2/orders/${encodeURIComponent(yandexOrderId)}/refund`,
      {
        refundAmount: refundAmount.toFixed(2),
        externalOperationId,
        motive: reason,
        managerId: String(actor.uid || '').slice(0, 2048),
      },
      { headers: yandexPayHeaders(randomBytes(16).toString('hex'), credentials.apiKey), timeout: 20000 },
    );
    const operation = response.data?.data?.operation || response.data?.data || {};
    const refundStatus = String(operation.status || 'PENDING');
    const refundId = String(operation.operationId || externalOperationId);
    const previousScopedRefunds = (Number(order.mainRefundAmount) || 0) + (Number(order.finalRefundAmount) || 0);
    const previousRefundAmount = previousScopedRefunds || Number(order.refundAmount) || 0;
    const refundedAt = new Date().toISOString();
    const scopedPatch = target.isFinal ? {
      finalRefundAmount: refundAmount,
      finalRefundStatus: refundStatus,
      finalRefundId: refundId,
      finalRefundedAt: refundedAt,
    } : {
      mainRefundAmount: refundAmount,
      mainRefundStatus: refundStatus,
      mainRefundId: refundId,
      mainRefundedAt: refundedAt,
    };
    const patch = {
      ...scopedPatch,
      status: getOrderStatusForRefund(refundStatus),
      refundAmount: previousRefundAmount + refundAmount,
      refundStatus,
      refundId,
      refundPaymentId: yandexOrderId,
      refundReason: reason,
      refundedAt,
      paymentAccountingVersion: 2,
    };
    await persistOrderPatch(target.cleanOrderId, patch);
    if (isRefundCompletedStatus(refundStatus)) {
      await dispatchPushEvent('payment_refunded', `yandex-refund:${refundId}:${refundStatus}`, {
        orderId: target.cleanOrderId,
        clientName: order.clientName,
        amount: refundAmount,
        status: refundStatus,
      }).catch(() => null);
    }
    await writeAuditLog({
      action: 'yandex_payment_refunded',
      entityType: 'order',
      entityId: target.cleanOrderId,
      after: patch,
      metadata: { label: `Возврат Яндекс Сплит: заказ ${target.cleanOrderId}`, amount: refundAmount, kind: target.isFinal ? 'final' : 'main' },
      actor: { type: 'crm_user', uid: actor.uid, email: actor.email || '', name: actor.name || '' },
    });
    res.json({ success: true, refundId, refundStatus, refundAmount, kind: target.isFinal ? 'final' : 'main' });
  } catch (error: any) {
    const details = error?.response?.data;
    console.error('[yandex-pay] refund-payment:', details || error?.message || error);
    res.status(error?.response?.status || 500).json({
      error: details?.message || details?.reason || error?.message || 'Не удалось оформить возврат Яндекс Сплита',
      details,
    });
  }
});

async function handleYandexPayWebhook(req: any, res: any) {
  try {
    const credentials = await getYandexPayCredentials();
    const token = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '').trim();
    if (!token) return res.status(400).json({ reasonCode: 'EMPTY_BODY' });
    const { payload } = await jwtVerify(token, credentials.sandbox ? YANDEX_PAY_SANDBOX_JWKS : YANDEX_PAY_PRODUCTION_JWKS, { algorithms: ['ES256'] });
    if (String(payload.merchantId || '') !== credentials.merchantId) return res.status(401).json({ reasonCode: 'MERCHANT_ID_MISMATCH' });
    const yandexOrderId = String((payload as any).order?.orderId || '');
    const status = String((payload as any).order?.paymentStatus || '').toUpperCase();
    if (!yandexOrderId || !status || !adminDb) return res.status(200).json({ status: 'success' });
    const main = await adminDb.collection('orders_new').where('paymentId', '==', yandexOrderId).limit(1).get();
    const final = main.empty ? await adminDb.collection('orders_new').where('finalPaymentId', '==', yandexOrderId).limit(1).get() : null;
    const document = !main.empty ? main.docs[0] : final && !final.empty ? final.docs[0] : null;
    if (document) {
      const paid = ['CAPTURED', 'CONFIRMED'].includes(status);
      const isFinal = Boolean(final && !final.empty);
      await document.ref.set(isFinal ? {
        finalPaymentStatus: status,
        finalPaymentProvider: 'yandex_split',
        ...(paid ? { finalPaymentPaidAt: new Date().toISOString() } : {}),
      } : {
        paymentStatus: status,
        paymentProvider: 'yandex_split',
        ...(paid ? { paymentPaidAt: new Date().toISOString() } : {}),
      }, { merge: true });
      if (paid) await dispatchPushEvent('payment_received', `yandex:${yandexOrderId}:${status}`, { orderId: document.id, status }).catch(() => {});
    }
    res.json({ status: 'success' });
  } catch (error: any) {
    console.warn('[yandex-pay] invalid webhook:', error?.message || error);
    res.status(401).json({ reasonCode: 'INVALID_TOKEN' });
  }
}

app.post('/api/yandex-pay/v1/webhook', handleYandexPayWebhook);
// Backward compatibility: older Yandex cabinet setup could point to /api/yandex-pay.
app.post('/api/yandex-pay', handleYandexPayWebhook);

// Создать ссылку/QR на оплату
app.post('/api/tochka/create-payment', async (req, res) => {
  if (!await requireCrmOrderAction(req, res, 'payments')) return;
  const { orderId, amount, description } = req.body;
  const paymentAmount = Number(amount);
  if (!orderId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) return res.status(400).json({ error: 'Нужны orderId и amount больше 0' });
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const paymentTarget = getTochkaPaymentTarget(String(orderId));
    const existingOrder = await getOrderSnapshot(paymentTarget.cleanOrderId).catch(() => null);
    const existingPaymentUrl = paymentTarget.isFinal
      ? existingOrder?.data()?.finalPaymentUrl
      : existingOrder?.data()?.paymentUrl;
    const existingPaymentId = paymentTarget.isFinal
      ? existingOrder?.data()?.finalPaymentId
      : existingOrder?.data()?.paymentId;
    const existingPaymentAmount = Number(paymentTarget.isFinal
      ? existingOrder?.data()?.finalPaymentAmount
      : existingOrder?.data()?.paymentAmount);
    if (existingPaymentUrl && (!existingPaymentAmount || Math.abs(existingPaymentAmount - paymentAmount) < 0.01)) {
      return res.json({
        success: true,
        existing: true,
        paymentUrl: existingPaymentUrl,
        paymentId: existingPaymentId || '',
      });
    }
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const tochkaSettings = await readTochkaSettingsDoc('tochka_api');
    let customerCode = tochkaSettings.customerCode;
    const merchantId = tochkaSettings.merchantId;
    let accountId = tochkaSettings.accountId;
    const configuredLegalId = String(tochkaSettings.legalId || '').trim();
    const paymentMode = Array.isArray(tochkaSettings.paymentMode) && tochkaSettings.paymentMode.length
      ? tochkaSettings.paymentMode
      : ['sbp'];
    const webhookUrl = process.env.SERVER_URL ? `${process.env.SERVER_URL}/api/tochka/webhook` : null;
    console.log(`[tochka] create-payment start order=${orderId} amount=${paymentAmount}`);
    await writeTochkaLog({
      orderId,
      amount: paymentAmount,
      description: description || '',
      status: 'request',
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const paymentPurpose = description || `Оплата заказа ${orderId}`;
    if (merchantId && accountId) {
      const resolvedAccount = await resolveTochkaSbpAccount(token, String(customerCode || ''), String(accountId || ''));
      customerCode = resolvedAccount.customerCode || customerCode;
      accountId = resolvedAccount.accountId || accountId;
    }
    const encodedMerchant = encodeURIComponent(String(merchantId || ''));
    const encodedAccount = encodeURIComponent(String(accountId || ''));
    const legalId = merchantId && accountId
      ? configuredLegalId || await discoverTochkaLegalId(token, String(customerCode || ''), String(merchantId), String(accountId))
      : '';
    const baseSbpData = compactTochkaData({
      merchantId,
      legalId,
      customerCode,
      paymentPurpose,
      currency: 'RUB',
      sourceName: 'YBCRM',
      ttl: 72 * 60,
      redirectUrl: process.env.SERVER_URL ? `${process.env.SERVER_URL}/pay/${orderId}` : undefined,
      imageParams: { width: 300, height: 300 },
    });
    const sbpAmount = toTochkaMinorAmount(paymentAmount);
    const sbpBodies = [
      {
        Data: compactTochkaData({
          ...baseSbpData,
          amount: sbpAmount,
          qrcType: '02',
        }),
      },
      {
        Data: compactTochkaData({
          ...baseSbpData,
          amount: sbpAmount,
          qrcType: '02',
          imageParams: undefined,
        }),
      },
      {
        Data: compactTochkaData({
          ...baseSbpData,
          amount: String(sbpAmount),
          qrcType: '02',
        }),
      },
      {
        Data: compactTochkaData({
          ...baseSbpData,
          amount: sbpAmount,
          qrcType: '01',
        }),
      },
    ];

    let paymentData: any = null;
    let paymentUrl = '';
    let paymentId = '';
    let lastPaymentError: any = null;

    if (merchantId && accountId) {
      for (const body of sbpBodies) {
        try {
          const response = await axios.post(
            `${TOCHKA_API}/sbp/v1.0/qr-code/merchant/${encodedMerchant}/${encodedAccount}`,
            body,
            { headers, timeout: 20000 }
          );
          paymentData = response.data;
          paymentUrl = getTochkaPaymentUrl(paymentData);
          paymentId = getTochkaPaymentId(paymentData);
          if (!paymentUrl && paymentId) {
            const qrDetails = await fetchTochkaQrById(token, String(merchantId), String(accountId), paymentId).catch(() => null);
            if (qrDetails?.paymentUrl) {
              paymentUrl = qrDetails.paymentUrl;
              paymentData = { initial: paymentData, qr: qrDetails.data };
            }
          }
          if (paymentUrl) break;
          lastPaymentError = new Error('Точка создала QR, но не вернула payload/ссылку');
        } catch (error: any) {
          lastPaymentError = error;
        }
      }
    } else {
      const response = await axios.post(
        `${TOCHKA_API}/acquiring/v1.0/payments`,
        {
          Data: {
            customerCode,
            amount: Math.round(paymentAmount * 100) / 100,
            purpose: paymentPurpose,
            paymentMode,
            paymentLinkId: orderId,
            redirectUrl: process.env.SERVER_URL ? `${process.env.SERVER_URL}/pay/${orderId}` : undefined,
            ttl: 72 * 60, // 72 часа
          },
        },
        { headers, timeout: 20000 }
      );
      paymentData = response.data;
      paymentUrl = getTochkaPaymentUrl(paymentData);
      paymentId = getTochkaPaymentId(paymentData);
    }

    if (!paymentUrl) {
      console.error('[tochka] create-payment no paymentUrl:', JSON.stringify(paymentData).slice(0, 500));
      const tochkaErrorData = lastPaymentError?.response?.data || null;
      await writeTochkaLog({
        orderId,
        amount: paymentAmount,
        status: 'error',
        error: lastPaymentError ? getTochkaErrorMessage(lastPaymentError) : 'Точка не вернула paymentUrl/payload',
        statusCode: lastPaymentError?.response?.status || null,
        response: JSON.stringify(paymentData).slice(0, 1000),
        details: tochkaErrorData ? JSON.stringify(tochkaErrorData).slice(0, 1000) : '',
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return res.status(502).json({
        error: 'Точка не вернула ссылку или payload QR',
        details: paymentData,
        message: lastPaymentError ? getTochkaErrorMessage(lastPaymentError) : '',
        statusCode: lastPaymentError?.response?.status || null,
        tochkaDetails: tochkaErrorData,
        legalId: legalId ? 'задан' : 'не найден',
      });
    }

    // Сохраняем ссылку оплаты в основной заказ CRM.
    // orderId с суффиксом -final означает отдельный счет на доплату.
    if (orderId && paymentUrl) {
      const target = getTochkaPaymentTarget(orderId);
      const createdAt = new Date().toISOString();
      const paymentFields = target.isFinal
        ? {
            finalPaymentUrl: paymentUrl,
            finalPaymentId: paymentId,
            finalPaymentStatus: 'pending',
            finalPaymentCreatedAt: createdAt,
            finalPaymentAmount: paymentAmount,
            paymentAccountingVersion: 2,
          }
        : {
            paymentUrl,
            paymentId,
            paymentStatus: 'pending',
            paymentCreatedAt: createdAt,
            paymentAmount,
            initialPaymentAmount: paymentAmount,
            paymentAccountingVersion: 2,
          };
      await persistOrderPatch(target.cleanOrderId, paymentFields);
    }
    console.log(`[tochka] create-payment success order=${orderId} paymentId=${paymentId || 'n/a'}`);
    await writeTochkaLog({
      orderId,
      amount: paymentAmount,
      paymentId: paymentId || null,
      paymentUrl,
      status: 'success',
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    res.json({ success: true, paymentUrl, paymentId, data: paymentData });
  } catch (e: any) {
    const errData = e.response?.data;
    console.error('[tochka] create-payment error:', errData || e.message);
    await writeTochkaLog({
      orderId,
      amount: paymentAmount,
      status: 'error',
      error: e.message,
      details: errData ? JSON.stringify(errData).slice(0, 1000) : '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    res.status(500).json({ error: e.message, details: errData });
  }
});

// Найти оплату в Точке по номеру заказа и привязать operationId к заказу.
app.get('/api/tochka/find-payment', async (req, res) => {
  if (!await requireCrmOrderAction(req, res, 'payments')) return;
  const orderId = String(req.query.orderId || '').trim();
  const target = getTochkaPaymentTarget(orderId, req.query.kind);
  const amount = req.query.amount ? Number(req.query.amount) : undefined;
  const requestedPaymentId = String(req.query.paymentId || '').trim();
  if (!orderId) return res.status(400).json({ error: 'Нужен orderId' });
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });

  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const settings = await readTochkaSettingsDoc('tochka_api');
    const customerCode = settings?.customerCode;
    if (!customerCode) return res.status(400).json({ error: 'customerCode Точки не настроен' });

    const orderSnapshot = await getOrderSnapshot(target.cleanOrderId).catch(() => null);
    const orderData = orderSnapshot?.data?.() || {};
    const storedPaymentId = requestedPaymentId
      || String(target.isFinal ? orderData.finalPaymentId : orderData.paymentId || '').trim();
    let operation: any = null;
    let operationId = '';

    if (storedPaymentId && settings?.merchantId && settings?.accountId) {
      const qrDetails = await fetchTochkaQrById(
        token,
        String(settings.merchantId),
        String(settings.accountId),
        storedPaymentId,
      ).catch(() => null);
      if (qrDetails?.data) {
        operation = {
          ...qrDetails.data,
          status: qrDetails.paymentStatus || getTochkaOperationStatus(qrDetails.data),
        };
        operationId = storedPaymentId;
      }
    }

    if (!operation) {
      operation = await findTochkaOperation(token, customerCode, target.paymentLinkId, amount)
        || (target.isFinal ? await findTochkaOperation(token, customerCode, target.cleanOrderId, amount) : null);
      operationId = getTochkaOperationId(operation);
    }
    if (!operation || !operationId) {
      return res.status(404).json({ error: `Оплата по заказу ${orderId} в Точке не найдена` });
    }

    const paymentAmount = normalizeTochkaAmount(getTochkaOperationAmount(operation)) || amount || 0;
    const paymentStatus = getTochkaOperationStatus(operation) || 'found';
    const paymentFields = buildTochkaPaymentFields(target, operationId, paymentStatus, paymentAmount, operation);

    await persistOrderPatch(target.cleanOrderId, paymentFields);
    await writeTochkaLog({
      orderId,
      paymentId: operationId,
      amount: paymentAmount,
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
    const errData = e.response?.data;
    console.error('[tochka] find-payment error:', errData || e.message);
    // Any 403 here is from Tochka: CRM access was already checked before this
    // try block. The current consent can create SBP QR codes but cannot list
    // acquiring operations, so offer an explicit verified fallback.
    const consentForbidden = e.response?.status === 403;
    res.status(consentForbidden ? 409 : (e.response?.status || 500)).json({
      error: consentForbidden
        ? 'Точка не разрешает CRM проверить оплату автоматически. Сверьте поступление в банке и подтвердите предоплату вручную.'
        : e.message,
      code: consentForbidden ? 'tochka_consent_required' : 'tochka_payment_lookup_failed',
      manualConfirmationAllowed: consentForbidden,
      details: errData,
    });
  }
});

// Explicit fallback for a bank consent that allows QR creation but not payment
// lookup. It is guarded by the payment permission and only works when a payment
// link or bank id has already been created for the order.
app.post('/api/tochka/confirm-payment', async (req, res) => {
  const actor: any = await requireCrmOrderAction(req, res, 'payments');
  if (!actor) return;
  const orderId = String(req.body?.orderId || '').trim();
  const target = getTochkaPaymentTarget(orderId, req.body?.kind);
  if (!orderId) return res.status(400).json({ error: 'Нужен orderId' });

  try {
    const orderSnapshot = await getOrderSnapshot(target.cleanOrderId);
    const orderExists = typeof orderSnapshot?.exists === 'function'
      ? orderSnapshot.exists()
      : Boolean(orderSnapshot?.exists);
    if (!orderExists) return res.status(404).json({ error: `Заказ ${target.cleanOrderId} не найден` });
    const orderData = orderSnapshot.data() || {};
    const paymentUrl = String(target.isFinal ? orderData.finalPaymentUrl : orderData.paymentUrl || '').trim();
    const paymentId = String(target.isFinal ? orderData.finalPaymentId : orderData.paymentId || '').trim();
    if (!paymentUrl && !paymentId) {
      return res.status(409).json({ error: 'Сначала создайте ссылку оплаты для этого заказа' });
    }

    const requestedAmount = Number(req.body?.amount) || 0;
    const storedAmount = Number(target.isFinal
      ? orderData.finalPaymentAmount
      : (orderData.paymentAmount || orderData.initialPaymentAmount)) || 0;
    const paymentAmount = storedAmount || requestedAmount;
    if (paymentAmount <= 0) return res.status(400).json({ error: 'Сумма оплаты не определена' });

    const confirmedAt = new Date().toISOString();
    const patch = target.isFinal
      ? {
          finalPaymentStatus: 'manual_confirmed',
          finalPaymentPaidAt: confirmedAt,
          finalPaymentAmount: paymentAmount,
          paymentAccountingVersion: 2,
        }
      : {
          paymentStatus: 'manual_confirmed',
          paymentPaidAt: confirmedAt,
          paymentAmount,
          initialPaymentAmount: paymentAmount,
          paymentAccountingVersion: 2,
        };
    await persistOrderPatch(target.cleanOrderId, patch);
    await writeAuditLog({
      action: target.isFinal ? 'final_payment_manually_confirmed' : 'payment_manually_confirmed',
      entityType: 'order',
      entityId: target.cleanOrderId,
      after: patch,
      metadata: { label: `Оплата подтверждена вручную: заказ ${target.cleanOrderId}`, amount: paymentAmount },
      actor: { type: 'crm_user', uid: actor.uid, email: actor.email || '', name: actor.name || '' },
    });
    res.json({
      success: true,
      kind: target.isFinal ? 'final' : 'main',
      paymentStatus: 'manual_confirmed',
      paymentPaidAt: confirmedAt,
      paymentAmount,
    });
  } catch (e: any) {
    console.error('[tochka] manual payment confirmation:', e?.message || e);
    res.status(500).json({ error: 'Не удалось сохранить подтверждение оплаты' });
  }
});

// Фоновая сверка выставленных счетов. Webhook остается основным способом,
// а этот маршрут закрывает пропущенные уведомления банка.
app.post('/api/tochka/reconcile-payments', async (_req, res) => {
  if (!adminDb && !db) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const token = await getTochkaToken();
    const settings = await readTochkaSettingsDoc('tochka_api');
    if (!token || !settings?.merchantId || !settings?.accountId) {
      return res.status(400).json({ error: 'Для сверки нужны token, merchantId и accountId Точки' });
    }
    const orders: Array<{ id: string; data: any }> = [];
    if (adminDb) {
      const snapshot = await adminDb.collection('orders_new').get();
      snapshot.docs.forEach((item: any) => orders.push({ id: item.id, data: item.data() }));
    } else if (db) {
      const snapshot = await getDocs(collection(db, 'orders_new'));
      snapshot.docs.forEach((item: any) => orders.push({ id: item.id, data: item.data() }));
    }
    const candidates = orders.filter(({ data }) => (
      (data?.paymentId && !isTochkaPaidStatus(data?.paymentStatus)) ||
      (data?.finalPaymentId && !isTochkaPaidStatus(data?.finalPaymentStatus))
    )).slice(0, 60);
    const paymentsResponse = settings.customerCode
      ? await axios.get(`${TOCHKA_API}/acquiring/v1.0/payments`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: { customerCode: settings.customerCode },
          timeout: 20_000,
        }).catch(() => null)
      : null;
    const bankOperations = paymentsResponse ? normalizeTochkaList(paymentsResponse.data) : [];
    const sbpPaymentsResponse = settings.customerCode
      ? await axios.get(`${TOCHKA_API}/sbp/v1.0/get-sbp-payments`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: {
            customer_code: settings.customerCode,
            fromDate: `${new Date().getFullYear()}-01-01`,
          },
          timeout: 20_000,
        }).catch(() => null)
      : null;
    const sbpPayments = sbpPaymentsResponse ? normalizeTochkaList(sbpPaymentsResponse.data) : [];
    const results: any[] = [];
    for (const { id, data } of candidates) {
      const patch: Record<string, any> = { paymentAccountingVersion: 2 };
      for (const isFinal of [false, true]) {
        const paymentId = String(isFinal ? data.finalPaymentId || '' : data.paymentId || '').trim();
        if (!paymentId) continue;
        const details = await fetchTochkaQrById(token, String(settings.merchantId), String(settings.accountId), paymentId).catch(() => null);
        const expectedAmount = Number(isFinal ? data.finalPaymentAmount : data.paymentAmount) || 0;
        const orderMarker = `${String(id).toLowerCase()}${isFinal ? '-final' : ''}`;
        const cleanOrderMarker = orderMarker.replace(/^#/, '');
        const bankOperation = bankOperations.find((item: any) => {
          const haystack = JSON.stringify(item || {}).toLowerCase();
          const amount = normalizeTochkaAmount(getTochkaOperationAmount(item));
          return (haystack.includes(orderMarker) || haystack.includes(cleanOrderMarker))
            && (!expectedAmount || Math.abs(amount - expectedAmount) < 1);
        });
        const sbpPayment = findAcceptedSbpPaymentByQr(sbpPayments, paymentId);
        const source = bankOperation || sbpPayment || details?.data;
        if (!source) continue;
        const status = getTochkaOperationStatus(bankOperation)
          || getTochkaOperationStatus(sbpPayment)
          || details?.paymentStatus
          || getTochkaOperationStatus(source)
          || 'found';
        const amount = normalizeTochkaAmount(getTochkaOperationAmount(source)) || expectedAmount;
        Object.assign(patch, buildTochkaPaymentFields({ isFinal }, paymentId, status, amount, source));
      }
      if (Object.keys(patch).length > 1) {
        await persistOrderPatch(id, patch);
        if (isTochkaPaidStatus(patch.paymentStatus) && !isTochkaPaidStatus(data.paymentStatus)) {
          await dispatchPushEvent('payment_received', `payment-reconcile:${id}:${data.paymentId}`, {
            orderId: id,
            clientName: data.clientName,
            amount: Number(patch.paymentAmount || data.paymentAmount || 0),
          }).catch(() => null);
        }
        if (isTochkaPaidStatus(patch.finalPaymentStatus) && !isTochkaPaidStatus(data.finalPaymentStatus)) {
          await dispatchPushEvent('payment_received', `payment-reconcile:${id}:${data.finalPaymentId}`, {
            orderId: id,
            clientName: data.clientName,
            amount: Number(patch.finalPaymentAmount || data.finalPaymentAmount || 0),
          }).catch(() => null);
        }
        results.push({ orderId: id, paymentStatus: patch.paymentStatus, finalPaymentStatus: patch.finalPaymentStatus });
      }
    }
    const refundCandidates = orders.filter(({ data }) => {
      const refundId = String(data?.refundId || '').trim();
      const status = data?.refundStatus;
      return refundId && !isRefundCompletedStatus(status) && !isRefundRejectedStatus(status);
    }).slice(0, 60);
    const refundResults: any[] = [];
    for (const { id, data } of refundCandidates) {
      const refundId = String(data.refundId || '').trim();
      const statusData = await getTochkaRefundData(token, refundId).catch(() => null);
      if (!statusData) continue;
      const refundStatus = statusData.status || statusData.data?.status || statusData.Data?.status || data.refundStatus;
      if (!refundStatus || refundStatus === data.refundStatus) continue;
      const confirmedAt = new Date().toISOString();
      const patch: Record<string, any> = {
        refundStatus,
        status: getOrderStatusForRefund(refundStatus),
        refundResponse: JSON.stringify(statusData).slice(0, 2000),
        ...(isRefundCompletedStatus(refundStatus) ? { refundConfirmedAt: confirmedAt } : {}),
      };
      if (String(data.mainRefundId || '') === refundId) patch.mainRefundStatus = refundStatus;
      if (String(data.finalRefundId || '') === refundId) patch.finalRefundStatus = refundStatus;
      await persistOrderPatch(id, patch);
      if (isRefundCompletedStatus(refundStatus)) {
        await dispatchPushEvent('payment_refunded', `tochka-refund:${refundId}:${refundStatus}`, {
          orderId: id,
          clientName: data.clientName,
          amount: Number(data.refundAmount) || 0,
          status: refundStatus,
        }).catch(() => null);
      }
      refundResults.push({ orderId: id, refundId, refundStatus });
    }
    res.json({
      success: true,
      checked: candidates.length,
      updated: results.length,
      results,
      refundChecked: refundCandidates.length,
      refundUpdated: refundResults.length,
      refundResults,
    });
  } catch (e: any) {
    res.status(e.response?.status || 500).json({ error: e.message, details: e.response?.data });
  }
});

// Возврат оплаты через СБП Точки по QR и идентификатору исходной транзакции.
app.post('/api/tochka/refund-payment', async (req, res) => {
  const actor: any = await requireRefundOwner(req, res);
  if (!actor) return;
  const { orderId, operationId, amount, reason, kind } = req.body || {};
  const refundAmount = Number(amount);
  const target = getTochkaPaymentTarget(String(orderId || ''), kind);
  const cleanOrderId = target.cleanOrderId;
  let cleanOperationId = String(operationId || '').trim();

  if (!cleanOrderId) return res.status(400).json({ error: 'Нужен orderId' });
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) return res.status(400).json({ error: 'Нужна сумма возврата больше 0' });
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });

  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const settings = await readTochkaSettingsDoc('tochka_api');
    let customerCode = String(settings?.customerCode || '');
    const orderSnapshot = await getOrderSnapshot(cleanOrderId);
    if (!orderSnapshotExists(orderSnapshot)) return res.status(404).json({ error: `Заказ ${cleanOrderId} не найден` });
    const order = orderSnapshot.data() || {};
    const storedPaymentAmount = Number(target.isFinal
      ? order.finalPaymentAmount
      : (order.paymentAmount || order.initialPaymentAmount)) || 0;
    const hasScopedRefunds = Boolean(order.mainRefundStatus || order.finalRefundStatus);
    const existingRefundStatus = String(
      (target.isFinal ? order.finalRefundStatus : order.mainRefundStatus)
      || (!hasScopedRefunds ? order.refundStatus : '')
      || '',
    ).trim();
    if (storedPaymentAmount > 0 && refundAmount > storedPaymentAmount) {
      return res.status(400).json({ error: `Сумма возврата больше платежа ${storedPaymentAmount.toFixed(2)} ₽` });
    }
    if (existingRefundStatus && !/fail|error/i.test(existingRefundStatus)) {
      return res.status(409).json({ error: 'Возврат этого платежа уже создан' });
    }
    const qrcId = String(
      (target.isFinal ? order.finalPaymentQrcId : order.paymentQrcId)
      || (target.isFinal ? order.finalPaymentId : order.paymentId)
      || cleanOperationId,
    ).trim();
    if (!qrcId) return res.status(409).json({ error: 'У платежа не найден идентификатор QR Точки' });
    if (!settings?.merchantId || !settings?.accountId) {
      return res.status(503).json({ error: 'В настройках Точки не указаны merchantId или accountId' });
    }
    const resolvedBankAccount = await resolveTochkaSbpAccount(token, customerCode, String(settings.accountId));
    customerCode = resolvedBankAccount.customerCode || customerCode;
    const accountId = resolvedBankAccount.accountId || String(settings.accountId);
    const qrDetails = await fetchTochkaQrById(
      token,
      String(settings.merchantId),
      accountId,
      qrcId,
    ).catch(() => null);
    let paymentData = qrDetails?.data || {};
    let trxId = String(
      (target.isFinal ? order.finalPaymentTrxId : order.paymentTrxId)
      || findTochkaValueByKeys(paymentData, ['trxId', 'operationId'])
      || '',
    ).trim();
    let refTransactionId = String(
      (target.isFinal ? order.finalPaymentRefTransactionId : order.paymentRefTransactionId)
      || findTochkaValueByKeys(paymentData, ['refTransactionId'])
      || '',
    ).trim();
    if (!refTransactionId && customerCode) {
      const sbpPayment = await findTochkaSbpPaymentByQr(
        token,
        customerCode,
        qrcId,
        String(order.paymentCreatedAt || order.date || ''),
      ).catch(() => null);
      if (sbpPayment) {
        paymentData = sbpPayment;
        trxId = String(sbpPayment.trxId || sbpPayment.operationId || trxId || '').trim();
        refTransactionId = String(sbpPayment.refTransactionId || '').trim();
      }
    }
    if (!trxId && !refTransactionId && customerCode) {
      const statementMatch = await findTochkaSbpPaymentInStatement(
        token,
        customerCode,
        accountId,
        qrcId,
        refundAmount,
        String(order.paymentCreatedAt || order.date || ''),
      ).catch(() => null);
      if (statementMatch) {
        paymentData = statementMatch.transaction;
        trxId = statementMatch.trxId;
      }
    }
    if (!trxId && !refTransactionId && customerCode) {
      const paymentMarker = target.isFinal ? `${cleanOrderId}-final` : cleanOrderId;
      const matchedOperation = await findTochkaOperation(token, String(customerCode), paymentMarker, refundAmount)
        .catch(() => null);
      if (matchedOperation) {
        paymentData = matchedOperation;
        trxId = String(findTochkaValueByKeys(matchedOperation, ['trxId', 'operationId', 'transactionId']) || '').trim();
        refTransactionId = String(findTochkaValueByKeys(matchedOperation, ['refTransactionId']) || '').trim();
      }
    }
    if (!trxId && !refTransactionId) {
      return res.status(409).json({ error: 'Точка не нашла подтверждённую оплату по этому QR. Деньги не списаны. Проверьте поступление в банке и повторите возврат.' });
    }

    cleanOperationId = trxId || refTransactionId;
    const refundAccount = getTochkaRefundAccount(accountId, String(settings.bankCode || ''));
    if (!refundAccount.accountCode || !refundAccount.bankCode) {
      return res.status(503).json({ error: 'В настройках Точки не удалось определить расчётный счёт или БИК' });
    }
    console.log(`[tochka] refund start order=${cleanOrderId} qrc=${qrcId} transaction=${cleanOperationId} amount=${refundAmount}`);
    await writeTochkaLog({
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      amount: refundAmount,
      status: 'refund_request',
      reason: reason || '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    const response = await axios.post(
      `${TOCHKA_API}/sbp/v1.0/refund`,
      {
        Data: {
          bankCode: refundAccount.bankCode,
          accountCode: refundAccount.accountCode,
          amount: formatTochkaRefundAmount(refundAmount),
          qrcId,
          ...(refTransactionId ? { refTransactionId } : { trxId }),
          purpose: reason || `Возврат заказа ${cleanOrderId}`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    let refundData = response.data || {};
    const refundId = refundData.requestId
      || refundData.Data?.requestId
      || refundData.operationId
      || refundData.refundOperationId
      || refundData.data?.operationId
      || refundData.Data?.operationId
      || refundData.Data?.refundOperationId
      || null;
    let refundStatus = refundData.status || refundData.data?.status || refundData.Data?.status || 'refund_requested';
    if (refundId && !isRefundCompletedStatus(refundStatus) && !isRefundRejectedStatus(refundStatus)) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await wait(800);
        const statusData = await getTochkaRefundData(token, String(refundId)).catch(() => null);
        if (!statusData) continue;
        refundData = statusData;
        refundStatus = statusData.status || statusData.data?.status || statusData.Data?.status || refundStatus;
        if (isRefundCompletedStatus(refundStatus) || isRefundRejectedStatus(refundStatus)) break;
      }
    }
    const refundedAt = new Date().toISOString();
    const previousScopedRefunds = (Number(order.mainRefundAmount) || 0) + (Number(order.finalRefundAmount) || 0);
    const previousRefundAmount = previousScopedRefunds || Number(order.refundAmount) || 0;
    const scopedFields = target.isFinal ? {
      finalRefundAmount: refundAmount,
      finalRefundStatus: refundStatus,
      finalRefundId: refundId,
      finalRefundedAt: refundedAt,
    } : {
      mainRefundAmount: refundAmount,
      mainRefundStatus: refundStatus,
      mainRefundId: refundId,
      mainRefundedAt: refundedAt,
    };
    const refundFields = {
      ...scopedFields,
      status: getOrderStatusForRefund(refundStatus),
      refundAmount: previousRefundAmount + refundAmount,
      refundStatus,
      refundId,
      refundPaymentId: cleanOperationId,
      refundQrcId: qrcId,
      refundReason: reason || '',
      refundedAt,
      refundResponse: JSON.stringify(refundData).slice(0, 2000),
      paymentAccountingVersion: 2,
    };

    await persistOrderPatch(cleanOrderId, refundFields);
    if (isRefundCompletedStatus(refundStatus)) {
      await dispatchPushEvent('payment_refunded', `tochka-refund:${refundId}:${refundStatus}`, {
        orderId: cleanOrderId,
        clientName: order.clientName,
        amount: refundAmount,
        status: refundStatus,
      }).catch(() => null);
    }
    await writeTochkaLog({
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      refundId,
      amount: refundAmount,
      status: 'refund_success',
      response: JSON.stringify(refundData).slice(0, 1000),
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    await writeAuditLog({
      action: 'tochka_payment_refunded',
      entityType: 'order',
      entityId: cleanOrderId,
      after: refundFields,
      metadata: { label: `Возврат Точка: заказ ${cleanOrderId}`, amount: refundAmount, kind: target.isFinal ? 'final' : 'main' },
      actor: { type: 'crm_user', uid: actor.uid, email: actor.email || '', name: actor.name || '' },
    });

    res.json({ success: true, refundId, refundStatus, refundAmount, kind: target.isFinal ? 'final' : 'main', data: refundData });
  } catch (e: any) {
    const errData = e.response?.data;
    console.error('[tochka] refund error:', errData || e.message);
    await writeTochkaLog({
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      amount: refundAmount,
      status: 'refund_error',
      error: e.message,
      details: errData ? JSON.stringify(errData).slice(0, 1000) : '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    res.status(e.response?.status || 500).json({ error: getTochkaErrorMessage(e) || e.message, details: errData });
  }
});

app.get('/api/tochka/retailers', async (_req, res) => {
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const settings = await readTochkaSettingsDoc('tochka_api');
    const customerCode = settings?.customerCode;
    const response = await axios.get(
      `${TOCHKA_API}/acquiring/v1.0/retailers`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        params: { customerCode },
        timeout: 20000,
      }
    );
    res.json(response.data);
  } catch (e: any) {
    const errData = e.response?.data;
    console.error('[tochka] retailers error:', errData || e.message);
    res.status(e.response?.status || 500).json({ error: e.message, details: errData });
  }
});

// Webhook — уведомление об оплате от Точки
app.post('/api/tochka/webhook', async (req, res) => {
  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(Buffer.from(req.body.split('.')[1] || '', 'base64').toString())
      : req.body?.token
        ? JSON.parse(Buffer.from(String(req.body.token).split('.')[1] || '', 'base64').toString())
        : req.body;
    console.log('[tochka] webhook:', JSON.stringify(body).slice(0, 200));
    // Найти заказ по operationId и обновить статус
    if ((adminDb || db) && (body.operationId || body.paymentLinkId)) {
      const status = ['Paid', 'paid', 'APPROVED'].includes(body.status) ? 'paid' : body.status;
      if (body.paymentLinkId) {
        const target = getTochkaPaymentTarget(body.paymentLinkId);
        const patch = buildTochkaPaymentFields(target, body.qrcId || body.operationId || '', status, normalizeTochkaAmount(body.amount), body);
        await persistOrderPatch(target.cleanOrderId, patch);
        if (isTochkaPaidStatus(status)) {
          await dispatchPushEvent('payment_received', `payment:${body.operationId || body.paymentLinkId}`, {
            orderId: target.cleanOrderId,
            amount: normalizeTochkaAmount(body.amount),
          }).catch(error => console.warn('[push] tochka:', error?.message || error));
        }
      }
      if (body.operationId) {
        const updateMatches = async (field: 'paymentId' | 'finalPaymentId', isFinal: boolean) => {
          const patch = buildTochkaPaymentFields(
            { isFinal },
            body.operationId,
            status,
            normalizeTochkaAmount(body.amount),
            body,
          );
          if (adminDb) {
            const snap = await adminDb.collection('orders_new').where(field, '==', body.operationId).get();
            await Promise.all(snap.docs.map((d: any) => d.ref.set(patch, { merge: true })));
            if (isTochkaPaidStatus(status)) {
              await Promise.all(snap.docs.map((d: any) => dispatchPushEvent('payment_received', `payment:${body.operationId}:${d.id}`, {
                orderId: d.id,
                clientName: d.data()?.clientName,
                amount: normalizeTochkaAmount(body.amount),
              }).catch(() => null)));
            }
            return snap.size;
          }
          if (!db) return 0;
          const snap = await getDocs(query(collection(db, 'orders_new'), where(field, '==', body.operationId)));
          await Promise.all(snap.docs.map((d: any) => updateDoc(d.ref, patch)));
          return snap.size;
        };
        await updateMatches('paymentId', false);
        await updateMatches('finalPaymentId', true);
      }
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Статус токена Точки
app.get('/api/tochka/status', async (_req, res) => {
  if (!db && !adminDb) return res.json({ configured: false });
  const settings = await readTochkaSettingsDoc('tochka_api').catch(() => ({}));
  res.json({
    configured: Boolean(settings?.jwtToken),
    customerCode: settings?.customerCode || '',
    merchantConfigured: Boolean(settings?.merchantId),
    accountConfigured: Boolean(settings?.accountId),
  });
});

// Google Cloud does not expose transaction-level billing history through the
// Cloud Billing Account API. Until Billing Export to BigQuery is connected,
// this endpoint serves the last verified snapshot from Firestore and adds the
// payment schedule calculated for the current date.
app.get('/api/google-cloud-billing/summary', async (req, res) => {
  const owner = await requireFinanceOwner(req, res);
  if (!owner) return;

  const verifiedSnapshot = {
    billingAccountId: '013564-6559B0-059C19',
    projectId: 'gen-lang-client-0565901030',
    currency: 'TRY',
    billingAccountOpen: true,
    currentPeriod: {
      from: '2026-09-01',
      through: '2026-09-03',
      expense: 91.04,
      openingBalance: 858.81,
      balanceBeforeLatestPayment: 949.85,
    },
    previousPeriod: {
      from: '2026-08-01',
      through: '2026-08-31',
      expense: 1112.86,
    },
    latestPayment: {
      reportedAt: '2026-09-04',
      status: 'pending_history_sync',
    },
    verifiedAt: '2026-09-04T08:35:00+03:00',
    source: 'Google Cloud Billing transaction history',
  };

  try {
    let stored: any = {};
    if (adminDb) {
      const snap = await adminDb.collection('settings').doc('google_cloud_billing').get();
      stored = snap.exists ? snap.data() || {} : {};
    }
    const snapshot = {
      ...verifiedSnapshot,
      ...stored,
      currentPeriod: { ...verifiedSnapshot.currentPeriod, ...(stored.currentPeriod || {}) },
      previousPeriod: { ...verifiedSnapshot.previousPeriod, ...(stored.previousPeriod || {}) },
      latestPayment: { ...verifiedSnapshot.latestPayment, ...(stored.latestPayment || {}) },
    };

    const now = new Date();
    const nextMonthlyCharge = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const verifiedAtMs = Date.parse(String(snapshot.verifiedAt || ''));
    const stale = !Number.isFinite(verifiedAtMs) || Date.now() - verifiedAtMs > 48 * 60 * 60 * 1000;

    res.json({
      configured: true,
      ...snapshot,
      stale,
      schedule: {
        monthlyChargeDay: 1,
        nextMonthlyChargeDate: nextMonthlyCharge.toISOString().slice(0, 10),
        thresholdAmount: 500,
        rule: 'Списание при достижении порога 500 TRY или в месячную дату — что наступит раньше',
      },
      sync: {
        mode: stored.sync?.mode || 'verified_snapshot',
        automatic: stored.sync?.automatic === true,
        note: stored.sync?.automatic === true
          ? 'Расходы обновляются из настроенного Billing Export'
          : 'Для автоматических расходов требуется Cloud Billing Export в BigQuery',
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Не удалось получить расходы Google Cloud' });
  }
});

// Безопасная диагностика JWT: ничего не списывает и не создает счет.
app.get('/api/tochka/jwt-diagnostics', async (_req, res) => {
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const settings = await readTochkaSettingsDoc('tochka_api');
    const token = settings?.jwtToken || '';
    if (!token) return res.status(400).json({ configured: false, error: 'Токен Точки не настроен' });

    const payload: any = decodeJwtPayload(token);
    const expiresAtMs = getTochkaJwtExpiresAt(payload);
    const expiresAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : '';
    const expired = expiresAtMs ? expiresAtMs <= Date.now() : false;
    const customerCode = settings?.customerCode || payload?.customerCode || payload?.customer_code || '';
    const sbpConfigured = Boolean(settings?.merchantId && settings?.accountId);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const tests: any[] = [
      {
        key: 'payload',
        name: 'JWT payload',
        ok: Boolean(Object.keys(payload || {}).length),
        message: Object.keys(payload || {}).length ? 'Токен читается сервером' : 'Payload не читается',
      },
      {
        key: 'expires',
        name: 'Срок токена',
        ok: !expiresAtMs || !expired,
        message: expiresAt ? (expired ? `Истек ${expiresAt}` : `Действует до ${expiresAt}`) : 'В токене нет exp',
      },
      {
        key: 'customerCode',
        name: 'customerCode',
        ok: Boolean(customerCode),
        message: customerCode ? 'Код клиента найден' : 'customerCode не найден в настройках/токене',
      },
      {
        key: 'sbp_config',
        name: 'СБП QR',
        ok: sbpConfigured,
        message: sbpConfigured
          ? 'Merchant и Account заданы, CRM будет создавать QR через СБП'
          : 'Для QR через СБП нужны Merchant и Account',
      },
    ];

    if (customerCode) {
      try {
        const response = await axios.get(`${TOCHKA_API}/acquiring/v1.0/retailers`, {
          headers,
          params: { customerCode },
          timeout: 15000,
        });
        tests.push({
          key: 'retailers',
          name: 'Магазины / retailers',
          ok: true,
          status: response.status,
          count: normalizeTochkaList(response.data).length,
          message: 'Доступ к acquiring retailers есть',
        });
      } catch (error: any) {
        tests.push({
          key: 'retailers',
          name: 'Магазины / retailers',
          ok: false,
          optional: sbpConfigured,
          status: error?.response?.status || null,
          message: sbpConfigured
            ? `${getTochkaErrorMessage(error)}. Для СБП QR это не критично, но нужно для acquiring-платежных ссылок.`
            : getTochkaErrorMessage(error),
        });
      }

      try {
        const response = await axios.get(`${TOCHKA_API}/acquiring/v1.0/payments`, {
          headers,
          params: { customerCode },
          timeout: 15000,
        });
        tests.push({
          key: 'payments',
          name: 'Платежи / payments',
          ok: true,
          status: response.status,
          count: normalizeTochkaList(response.data).length,
          message: 'Доступ к списку платежей есть',
        });
      } catch (error: any) {
        tests.push({
          key: 'payments',
          name: 'Платежи / payments',
          ok: false,
          optional: sbpConfigured,
          status: error?.response?.status || null,
          message: sbpConfigured
            ? `${getTochkaErrorMessage(error)}. Для СБП QR это не критично, но нужно для поиска acquiring-платежей.`
            : getTochkaErrorMessage(error),
        });
      }
    }

    res.json({
      configured: true,
      customerCode,
      expiresAt,
      expired,
      merchantConfigured: Boolean(settings?.merchantId),
      accountConfigured: Boolean(settings?.accountId),
      paymentMode: Array.isArray(settings?.paymentMode) ? settings.paymentMode : ['sbp'],
      claims: {
        aud: payload?.aud || '',
        iss: payload?.iss || '',
        scope: payload?.scope || payload?.scopes || '',
        permissions: payload?.permissions || payload?.roles || '',
        subPreview: payload?.sub ? `${String(payload.sub).slice(0, 8)}...` : '',
      },
      tests,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Не удалось проверить JWT Точки' });
  }
});

app.get('/api/tochka/accounts-diagnostics', async (_req, res) => {
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const settings = await readTochkaSettingsDoc('tochka_api');
    const token = settings?.jwtToken || '';
    if (!token) return res.status(400).json({ configured: false, error: 'Токен Точки не настроен' });

    const payload: any = decodeJwtPayload(token);
    const customerCode = settings?.customerCode || payload?.customerCode || payload?.customer_code || '';
    const accountId = settings?.accountId || '';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 30);
    const dateFrom = from.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);

    const tests: any[] = [];
    let discoveredAccounts: any[] = [];

    try {
      const response = await axios.get(`${TOCHKA_API}/open-banking/v1.0/accounts`, {
        headers,
        params: customerCode ? { customerCode } : {},
        timeout: 15000,
      });
      discoveredAccounts = [
        ...(response.data?.Data?.Account || []),
        ...(response.data?.data?.accounts || []),
        ...(response.data?.accounts || []),
      ].filter(Boolean);
      tests.push({
        key: 'accounts_open_banking',
        name: 'Счета / open-banking accounts',
        ok: true,
        status: response.status,
        count: discoveredAccounts.length,
        sample: JSON.stringify(response.data).slice(0, 1200),
        message: 'Доступ есть',
      });
    } catch (error: any) {
      tests.push({
        key: 'accounts_open_banking',
        name: 'Счета / open-banking accounts',
        ok: false,
        status: error?.response?.status || null,
        message: getTochkaErrorMessage(error),
      });
    }

    const discoveredAccountIds = discoveredAccounts
      .map((account: any) => account?.accountId || account?.AccountId || account?.id)
      .filter(Boolean)
      .map(String);
    const discoveredCustomerCode = discoveredAccounts
      .map((account: any) => account?.customerCode || account?.CustomerCode || account?.customer_code)
      .filter(Boolean)
      .map(String)[0] || '';
    const effectiveCustomerCode = discoveredCustomerCode || customerCode;
    const configuredAccountMismatch = Boolean(
      accountId && discoveredAccountIds.length && !discoveredAccountIds.includes(String(accountId))
    );
    const accountIds = Array.from(new Set([
      ...discoveredAccountIds,
      ...(discoveredAccountIds.length ? [] : [accountId]),
    ].filter(Boolean))).slice(0, 4);

    const candidates: Array<{
      key: string;
      name: string;
      method?: 'get' | 'post';
      url?: string;
      params?: Record<string, any>;
      data?: Record<string, any>;
      skip?: boolean;
      skippedMessage?: string;
    }> = [
      {
        key: 'balances_list',
        name: 'Список остатков / open-banking balances',
        url: `${TOCHKA_API}/open-banking/v1.0/balances`,
        params: effectiveCustomerCode ? { customerCode: effectiveCustomerCode } : {},
      },
      {
        key: 'accounts_customer',
        name: 'Счета клиента / customer accounts',
        url: `${TOCHKA_API}/open-banking/v1.0/customers/${encodeURIComponent(effectiveCustomerCode)}/accounts`,
        params: {},
        skip: !effectiveCustomerCode,
      },
      ...accountIds.flatMap((id, index) => ([
        {
          key: `account_requisites_${index + 1}`,
          name: `Реквизиты счета ${index + 1}`,
          url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodeURIComponent(id)}`,
          params: effectiveCustomerCode ? { customerCode: effectiveCustomerCode } : {},
        },
        {
          key: `account_balances_${index + 1}`,
          name: `Остаток по счету ${index + 1}`,
          url: `${TOCHKA_API}/open-banking/v1.0/accounts/${encodeURIComponent(id)}/balances`,
          params: effectiveCustomerCode ? { customerCode: effectiveCustomerCode } : {},
        },
      ])),
      {
        key: 'statements',
        name: 'Выписка / statements',
        skip: true,
        skippedMessage: 'Выписка в API Точки создается через POST /open-banking/v1.0/statements, диагностика не создает документы автоматически.',
      },
    ];

    for (const candidate of candidates) {
      if (candidate.skip) {
        tests.push({
          key: candidate.key,
          name: candidate.name,
          ok: false,
          skipped: true,
          message: candidate.skippedMessage || 'Пропущено: не задан customerCode или accountId',
        });
        continue;
      }
      try {
        const response = await axios.get(candidate.url!, {
          headers,
          params: candidate.params,
          timeout: 15000,
        });
        tests.push({
          key: candidate.key,
          name: candidate.name,
          ok: true,
          status: response.status,
          count: normalizeTochkaList(response.data).length,
          sample: JSON.stringify(response.data).slice(0, 1200),
          message: 'Доступ есть',
        });
      } catch (error: any) {
        tests.push({
          key: candidate.key,
          name: candidate.name,
          ok: false,
          status: error?.response?.status || null,
          message: getTochkaErrorMessage(error),
        });
      }
    }

    res.json({
      configured: true,
      customerCode,
      effectiveCustomerCode,
      accountIdConfigured: Boolean(accountId),
      configuredAccountMismatch,
      discoveredAccounts: discoveredAccounts.map((account: any) => ({
        customerCode: account?.customerCode || '',
        accountId: account?.accountId || '',
        status: account?.status || '',
        currency: account?.currency || '',
      })),
      period: { dateFrom, dateTo },
      tests,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Не удалось проверить счета Точки' });
  }
});

app.get('/api/tochka/finance-summary', async (req, res) => {
  if (!db && !adminDb) return res.status(503).json({ error: 'DB не подключена' });
  const owner = await requireFinanceOwner(req, res);
  if (!owner) return;

  try {
    const settings = await readTochkaSettingsDoc('tochka_api');
    const token = settings?.jwtToken || '';
    if (!token) return res.status(400).json({ configured: false, error: 'Токен Точки не настроен' });

    const payload: any = decodeJwtPayload(token);
    const customerCode = settings?.customerCode || payload?.customerCode || payload?.customer_code || '';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const accountsResponse = await axios.get(`${TOCHKA_API}/open-banking/v1.0/accounts`, {
      headers,
      params: customerCode ? { customerCode } : {},
      timeout: 15000,
    });
    const accountsRaw = extractTochkaAccounts(accountsResponse.data);
    const discoveredCustomerCode = accountsRaw
      .map((account: any) => account?.customerCode || account?.CustomerCode || account?.customer_code)
      .filter(Boolean)
      .map(String)[0] || '';
    const effectiveCustomerCode = discoveredCustomerCode || customerCode;

    const balancesResponse = await axios.get(`${TOCHKA_API}/open-banking/v1.0/balances`, {
      headers,
      params: effectiveCustomerCode ? { customerCode: effectiveCustomerCode } : {},
      timeout: 15000,
    });
    const balancesRaw = extractTochkaBalances(balancesResponse.data);
    const balancesByAccount = new Map<string, any>();
    for (const balance of balancesRaw) {
      const accountId = getBalanceAccountId(balance);
      if (!accountId) continue;
      const row = balancesByAccount.get(accountId) || {
        openingAvailable: 0,
        closingAvailable: 0,
        expected: 0,
      };
      const type = getBalanceType(balance);
      const amount = getBalanceAmount(balance);
      if (type.includes('opening')) row.openingAvailable = amount;
      else if (type.includes('expected')) row.expected = amount;
      else if (type.includes('closing') || type.includes('available')) row.closingAvailable = amount;
      else row.closingAvailable = amount;
      balancesByAccount.set(accountId, row);
    }

    const accounts = accountsRaw.map((account: any) => {
      const accountId = String(account?.accountId || account?.AccountId || account?.id || '');
      const balances = balancesByAccount.get(accountId) || { openingAvailable: 0, closingAvailable: 0, expected: 0 };
      const fundName = getTochkaFundName(accountId);
      return {
        accountId,
        maskedAccountId: maskAccountId(accountId),
        label: fundName || 'Операционный счёт',
        role: fundName ? 'reserved' : 'operating',
        customerCode: account?.customerCode || account?.CustomerCode || '',
        status: account?.status || account?.Status || '',
        currency: account?.currency || account?.Currency || 'RUB',
        balances,
      };
    });

    const totalBalance = accounts.reduce((sum: number, account: any) => sum + (Number(account.balances.closingAvailable) || 0), 0);
    const operatingBalance = accounts.filter((account: any) => account.role !== 'reserved').reduce((sum: number, account: any) => sum + (Number(account.balances.closingAvailable) || 0), 0);
    const reservedBalance = accounts.filter((account: any) => account.role === 'reserved').reduce((sum: number, account: any) => sum + (Number(account.balances.closingAvailable) || 0), 0);
    const totalExpected = accounts.reduce((sum: number, account: any) => sum + (Number(account.balances.expected) || 0), 0);

    const now = new Date();
    const monthKey = String(req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    const period = ['month', 'quarter', 'halfYear', 'year'].includes(String(req.query.period))
      ? String(req.query.period)
      : 'month';
    const [yearPart, monthPart] = monthKey.split('-').map(Number);
    const selectedYear = yearPart || now.getFullYear();
    const selectedMonthIndex = Math.max(0, Math.min(11, (monthPart || now.getMonth() + 1) - 1));
    let rangeStartMonth = selectedMonthIndex;
    let rangeEndMonth = selectedMonthIndex;
    if (period === 'quarter') {
      rangeStartMonth = Math.floor(selectedMonthIndex / 3) * 3;
      rangeEndMonth = rangeStartMonth + 2;
    } else if (period === 'halfYear') {
      rangeStartMonth = selectedMonthIndex < 6 ? 0 : 6;
      rangeEndMonth = rangeStartMonth + 5;
    } else if (period === 'year') {
      rangeStartMonth = 0;
      rangeEndMonth = 11;
    }
    const rangeStart = new Date(selectedYear, rangeStartMonth, 1);
    const rangeEnd = new Date(selectedYear, rangeEndMonth + 1, 0);
    const dateFrom = formatFinanceDate(rangeStart);
    const dateTo = formatFinanceDate(rangeEnd);
    const comparisonStart = new Date(selectedYear, selectedMonthIndex - 2, 1);
    const fetchDateFrom = comparisonStart < rangeStart ? formatFinanceDate(comparisonStart) : dateFrom;
    const allOrders = await loadAllOrdersForFinance().catch(() => []);
    const monthOrders = allOrders.filter((order: any) => getFinanceMonthKey(order?.date || order?.orderDate || order?.createdAt) === monthKey);
    const sourceMap: Record<string, { key: string; label: string; amount: number; count: number }> = {
      qr: { key: 'qr', label: 'QR / СБП', amount: 0, count: 0 },
      dolyami: { key: 'dolyami', label: 'Долями', amount: 0, count: 0 },
      split: { key: 'split', label: 'Сплиты', amount: 0, count: 0 },
      other: { key: 'other', label: 'Другое', amount: 0, count: 0 },
    };
    for (const order of monthOrders) {
      const status = String(order?.status || '').toLowerCase();
      if (status.includes('возврат') || status.includes('отмена')) continue;
      const amount = getFinanceOrderPaidAmount(order);
      if (amount <= 0) continue;
      const key = classifyPaymentSource(order);
      sourceMap[key].amount += amount;
      sourceMap[key].count += 1;
    }

    const operationFetches = await Promise.all(accounts.map((account: any) =>
      fetchTochkaOperations(token, account.customerCode || effectiveCustomerCode, account.accountId, fetchDateFrom, dateTo)
        .then(result => ({ account, result }))
        .catch(error => ({ account, result: { ok: false, source: '', operations: [], errors: [{ message: getTochkaErrorMessage(error) }] } }))
    ));
    const cardOperationFetch = await fetchTochkaCardOperations(token, effectiveCustomerCode, fetchDateFrom, dateTo)
      .catch(error => ({ ok: false, source: '', operations: [], errors: [{ message: getTochkaErrorMessage(error) }] }));
    const operationMap = new Map<string, any>();
    for (const operation of [
      ...operationFetches.flatMap(item => item.result.operations || []),
      ...(cardOperationFetch.operations || []),
    ]) {
      operationMap.set(String(operation.id || `${operation.date}-${operation.accountId}-${operation.amount}-${operation.description}`), operation);
    }
    const comparisonOperations = Array.from(operationMap.values())
      .filter((operation: any) => operationIsWithinDates(operation, fetchDateFrom, dateTo))
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const ownCounterpartyNames = Array.isArray(settings?.ownCounterpartyNames)
      ? settings.ownCounterpartyNames
      : [];
    for (let index = 0; index < comparisonOperations.length; index += 1) {
      const operation = comparisonOperations[index];
      const pair = comparisonOperations.find((candidate: any, candidateIndex: number) => (
        candidateIndex !== index
        && candidate.accountId !== operation.accountId
        && candidate.direction !== operation.direction
        && candidate.absAmount === operation.absAmount
        && String(candidate.date).slice(0, 10) === String(operation.date).slice(0, 10)
      ));
      if (pair) {
        operation.isInternalTransfer = true;
        operation.internalTransferReason = 'matched_account_pair';
      } else if (isKnownOwnAccountTransfer(operation, ownCounterpartyNames)) {
        operation.isInternalTransfer = true;
        operation.internalTransferReason = 'own_legal_entity';
      }
      operation.isRefund = !operation.isInternalTransfer && isTochkaRefundOperation(operation);
    }
    const operations = comparisonOperations.filter((operation: any) => operationIsWithinDates(operation, dateFrom, dateTo));

    const monthlyComparisonMap = new Map<string, any>();
    for (let offset = -2; offset <= 0; offset += 1) {
      const date = new Date(selectedYear, selectedMonthIndex + offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const ordersForMonth = allOrders.filter((order: any) => getFinanceMonthKey(order?.date || order?.orderDate || order?.createdAt) === key && isFinanceActiveOrder(order));
      monthlyComparisonMap.set(key, {
        monthKey: key,
        sales: ordersForMonth.reduce((sum: number, order: any) => sum + getFinanceOrderTotal(order), 0),
        orders: ordersForMonth.length,
        income: 0,
        expenses: 0,
        net: 0,
        currentOrderReceipts: 0,
        priorOrderReceipts: 0,
        unmatchedIncome: 0,
        refunds: 0,
      });
    }
    for (const operation of comparisonOperations) {
      const key = getFinanceMonthKey(operation.date);
      const row = monthlyComparisonMap.get(key);
      if (!row) continue;
      if (operation.isInternalTransfer) continue;
      if (operation.direction === 'expense') {
        if (operation.isRefund) row.refunds += operation.absAmount;
        else row.expenses += operation.absAmount;
      }
      else {
        row.income += operation.absAmount;
        const matchedOrder = findFinanceOrderForOperation(operation, allOrders);
        if (!matchedOrder) row.unmatchedIncome += operation.absAmount;
        else if (getFinanceMonthKey(matchedOrder?.date || matchedOrder?.orderDate || matchedOrder?.createdAt) === key) row.currentOrderReceipts += operation.absAmount;
        else row.priorOrderReceipts += operation.absAmount;
      }
      row.net = row.income - row.expenses - row.refunds;
    }

    // Старые возвраты могли быть записаны в CRM, но отсутствовать в доступной
    // банковской выписке. Используем их только как резервный источник, чтобы не
    // задвоить возврат, который уже найден среди операций Точки.
    const crmRefundsByMonth = new Map<string, number>();
    for (const order of allOrders) {
      const refundAmount = Number(order?.refundAmount) || 0;
      if (refundAmount <= 0) continue;
      const refundMonthKey = getFinanceMonthKey(order?.refundedAt || order?.refundDate || order?.updatedAt);
      if (!refundMonthKey) continue;
      crmRefundsByMonth.set(refundMonthKey, (crmRefundsByMonth.get(refundMonthKey) || 0) + refundAmount);
    }
    for (const [key, row] of monthlyComparisonMap.entries()) {
      if (!row.refunds) row.refunds = crmRefundsByMonth.get(key) || 0;
      row.net = row.income - row.expenses - row.refunds;
    }
    const monthlyComparison = Array.from(monthlyComparisonMap.values());
    const selectedComparison = monthlyComparisonMap.get(monthKey) || {};
    const expenses = operations.filter((operation: any) => operation.direction === 'expense' && !operation.isInternalTransfer && !operation.isRefund);
    const refunds = operations.filter((operation: any) => operation.direction === 'expense' && !operation.isInternalTransfer && operation.isRefund);
    const incomes = operations.filter((operation: any) => operation.direction === 'income' && !operation.isInternalTransfer);
    const expenseCategoryMap = new Map<string, { category: string; amount: number; count: number }>();
    for (const operation of expenses) {
      const row = expenseCategoryMap.get(operation.category) || { category: operation.category, amount: 0, count: 0 };
      row.amount += operation.absAmount;
      row.count += 1;
      expenseCategoryMap.set(operation.category, row);
    }
    const accountExpenseMap = new Map<string, { accountId: string; maskedAccountId: string; amount: number; operations: any[] }>();
    const cardExpenseMap = new Map<string, { mask: string; label: string; kind: string; expenses: number; operations: any[] }>();
    for (const card of TOCHKA_KNOWN_CARDS) {
      cardExpenseMap.set(card.mask, { ...card, expenses: 0, operations: [] });
    }
    for (const operation of expenses) {
      const accountRow = accountExpenseMap.get(operation.accountId) || {
        accountId: operation.accountId,
        maskedAccountId: operation.maskedAccountId,
        amount: 0,
        operations: [],
      };
      accountRow.amount += operation.absAmount;
      accountRow.operations.push(operation);
      accountExpenseMap.set(operation.accountId, accountRow);

      if (operation.cardMask) {
        const knownCard = TOCHKA_KNOWN_CARDS.find(card => card.mask === operation.cardMask);
        const cardRow = cardExpenseMap.get(operation.cardMask) || {
          mask: operation.cardMask,
          label: knownCard?.label || 'Карта',
          kind: knownCard?.kind || 'card',
          expenses: 0,
          operations: [],
        };
        cardRow.expenses += operation.absAmount;
        cardRow.operations.push(operation);
        cardExpenseMap.set(operation.cardMask, cardRow);
      }
    }

    res.json({
      configured: true,
      ownerEmail: FINANCE_OWNER_EMAIL,
      customerCode,
      effectiveCustomerCode,
      monthKey,
      period,
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      totalBalance,
      operatingBalance,
      reservedBalance,
      totalExpected,
      accounts,
      incomingSources: Object.values(sourceMap),
      paymentBreakdown: {
        salesAmount: Number(selectedComparison.sales) || 0,
        salesCount: Number(selectedComparison.orders) || 0,
        actualIncome: Number(selectedComparison.income) || 0,
        currentMonthOrderReceipts: Number(selectedComparison.currentOrderReceipts) || 0,
        priorMonthDopayments: Number(selectedComparison.priorOrderReceipts) || 0,
        unmatchedIncome: Number(selectedComparison.unmatchedIncome) || 0,
        refunds: Number(selectedComparison.refunds) || 0,
        remainingForSelectedOrders: monthOrders.filter(isFinanceActiveOrder).reduce((sum: number, order: any) => sum + Math.max(0, getFinanceOrderTotal(order) - getFinanceOrderPaidAmount(order)), 0),
        remainingFromSelectedMonth: monthOrders.filter(isFinanceActiveOrder).reduce((sum: number, order: any) => sum + Math.max(0, getFinanceOrderTotal(order) - getFinanceOrderPaidAmount(order)), 0),
      },
      monthlyComparison,
      actualIncome: incomes.reduce((sum: number, operation: any) => sum + operation.absAmount, 0),
      actualExpenses: expenses.reduce((sum: number, operation: any) => sum + operation.absAmount, 0),
      actualRefunds: (Number(selectedComparison.refunds) || refunds.reduce((sum: number, operation: any) => sum + operation.absAmount, 0)),
      accountExpenses: Array.from(accountExpenseMap.values()),
      cards: Array.from(cardExpenseMap.values()),
      expenseCategories: Array.from(expenseCategoryMap.values()).sort((a, b) => b.amount - a.amount),
      operations: operations.slice(0, 1000),
      cardExpenses: expenses.filter((operation: any) => operation.cardMask),
      operationFetches: operationFetches.map(item => ({
        account: item.account.maskedAccountId,
        ok: item.result.ok,
        source: item.result.source,
        errors: item.result.errors?.slice(0, 3) || [],
      })).concat([{
        account: 'Карты Точки',
        ok: cardOperationFetch.ok,
        source: cardOperationFetch.source,
        errors: cardOperationFetch.errors?.slice(0, 6) || [],
      }]),
      operationsStatus: operations.length ? 'connected' : 'no_operations',
      message: operations.length
        ? 'Операции Точки загружены и разложены по счетам, картам и категориям.'
        : 'Баланс читается из Точки. Операции по счетам и картам за месяц не пришли через доступные методы API — проверь права на получение выписок/операций.',
    });
  } catch (error: any) {
    res.status(error?.response?.status || 500).json({
      error: getTochkaErrorMessage(error) || 'Не удалось получить финансовую сводку Точки',
    });
  }
});

// ─── Chatwoot ───────────────────────────────────────────────────────────────
// Связь карточки клиента в Chatwoot с его заказами из CRM.
// Chatwoot шлёт вебхук (contact_created / conversation_created) → ищем клиента
// в Firestore по телефону → пишем заказы обратно в Chatwoot через REST API.

const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || "").replace(/\/$/, "");
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "";
const CHATWOOT_WEBHOOK_SECRET = process.env.CHATWOOT_WEBHOOK_SECRET || "";

function chatwootApi(accountId: string) {
  return axios.create({
    baseURL: `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}`,
    headers: { api_access_token: CHATWOOT_API_TOKEN, "Content-Type": "application/json" },
    timeout: 15000,
  });
}

// Собрать сводку по клиенту из Firestore по нормализованному телефону
async function buildChatwootClientSummary(phone: string) {
  if (!db || !phone) return null;
  const contactSnap = await getDoc(doc(db, "contacts", phone)).catch(() => null);
  const ordersSnap = await getDocs(
    query(collection(db, "orders_new"), where("clientPhone", "==", phone))
  ).catch(() => null);

  const contact = contactSnap?.exists() ? contactSnap.data() : null;
  const orders = ordersSnap
    ? ordersSnap.docs
        .map(d => ({ orderId: d.id, ...(d.data() as any) }))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    : [];

  if (!contact && orders.length === 0) return null;

  const attributes: Record<string, any> = {};
  if (contact?.loyaltyCardId) attributes.loyalty_card = contact.loyaltyCardId;
  if (contact?.totalSpent != null) attributes.total_spent = contact.totalSpent;
  attributes.orders_count = contact?.ordersCount ?? orders.length;
  if (contact?.currentDiscount != null) attributes.discount = contact.currentDiscount;
  if (contact?.city) attributes.city = contact.city;

  const lines: string[] = [];
  lines.push(`🧾 Клиент из CRM${contact?.fullName ? `: ${contact.fullName}` : ""}`);
  if (contact?.loyaltyCardId) lines.push(`Карта лояльности: ${contact.loyaltyCardId}`);
  if (contact?.totalSpent != null) lines.push(`Всего потрачено: ${contact.totalSpent} ₽`);
  if (orders.length) {
    lines.push(`\nПоследние заказы (${orders.length}):`);
    for (const o of orders.slice(0, 5)) {
      const parts = [o.orderId, o.status, o.revenue != null ? `${o.revenue} ₽` : null, o.deliveryMethod, o.date]
        .filter(Boolean)
        .join(" · ");
      lines.push(`• ${parts}`);
    }
  } else {
    lines.push("\nЗаказов в CRM пока нет.");
  }

  return { attributes, note: lines.join("\n") };
}

// Извлечь телефон из разных форматов payload Chatwoot
function extractChatwootPhone(payload: any): string {
  const raw =
    payload?.phone_number ||
    payload?.sender?.phone_number ||
    payload?.meta?.sender?.phone_number ||
    payload?.contact?.phone_number ||
    payload?.contact_inbox?.contact?.phone_number ||
    "";
  return normalizeBroadcastPhone(raw);
}

app.post("/api/chatwoot/webhook", async (req, res) => {
  // Опциональная защита: Chatwoot не подписывает вебхуки, поэтому секрет
  // передаём в query (?token=...) при настройке URL в Chatwoot.
  if (CHATWOOT_WEBHOOK_SECRET && req.query.token !== CHATWOOT_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // Сразу отвечаем Chatwoot — обогащение делаем асинхронно, чтобы не держать вебхук.
  res.json({ success: true });

  try {
    const body = req.body || {};
    const event = body.event;
    if (event !== "contact_created" && event !== "conversation_created") return;
    if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN) {
      console.warn("[chatwoot] webhook: CHATWOOT_BASE_URL/API_TOKEN не заданы — пропускаю");
      return;
    }

    const accountId = String(CHATWOOT_ACCOUNT_ID || body.account?.id || body.account_id || "");
    const phone = extractChatwootPhone(body);
    console.log(`[chatwoot] webhook: event=${event} phone=${phone || "—"} account=${accountId || "—"}`);
    if (!accountId || !phone) return;

    const summary = await buildChatwootClientSummary(phone);
    if (!summary) {
      console.log(`[chatwoot] webhook: клиент ${phone} не найден в CRM`);
      return;
    }

    const api = chatwootApi(accountId);

    // Обновить атрибуты контакта (id есть и в contact, и в conversation событиях)
    const contactId =
      body.id && event === "contact_created"
        ? body.id
        : body.meta?.sender?.id || body.sender?.id || body.contact?.id;
    if (contactId) {
      await api
        .put(`/contacts/${contactId}`, { custom_attributes: summary.attributes })
        .catch((e: any) => console.error("[chatwoot] update contact:", e.response?.data || e.message));
    }

    // Для беседы — добавить приватную заметку со списком заказов
    if (event === "conversation_created" && body.id) {
      await api
        .post(`/conversations/${body.id}/messages`, {
          content: summary.note,
          message_type: "outgoing",
          private: true,
        })
        .catch((e: any) => console.error("[chatwoot] add note:", e.response?.data || e.message));
    }
  } catch (e: any) {
    console.error("[chatwoot] webhook error:", e.message);
  }
});

// ─── Telegram Bot ───────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
function parseManagerChatIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(id => id.trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\s]+/)
    .map(id => id.trim())
    .filter(Boolean);
}

const DEFAULT_MANAGER_CHAT_IDS = parseManagerChatIds(process.env.MANAGER_CHAT_IDS || process.env.MANAGER_CHAT_ID || "");
let botInstance: any = null;

// try-on state stored in Firestore — survives deploys and multiple instances
type TryOnState = {
  costumeUrls: string[];
  costumeName: string;
  frontFileId?: string;
  phone?: string;
};

type TryOnPhotoInput = {
  label: string;
  userFileId: string;
  costumeUrl: string;
};

const DAILY_TRYON_LIMIT = 10;

async function setTryOnState(userId: string, data: TryOnState) {
  if (!db) return;
  await setDoc(doc(db, "tryon_state", userId), { ...data, updatedAt: new Date().toISOString() });
}
async function getTryOnState(userId: string): Promise<TryOnState | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, "tryon_state", userId)).catch(() => null);
  if (!snap?.exists()) return null;
  return snap.data() as any;
}
async function deleteTryOnState(userId: string) {
  if (!db) return;
  await deleteDoc(doc(db, "tryon_state", userId)).catch(() => {});
}

async function setTryOnOrder(userId: string, data: any) {
  if (!db) return;
  await setDoc(doc(db, "tryon_orders", userId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

async function getTryOnOrder(userId: string): Promise<any | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, "tryon_orders", userId)).catch(() => null);
  if (!snap?.exists()) return null;
  return snap.data();
}

function normalizePhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function looksLikePhone(value: string): boolean {
  const digits = normalizePhone(value);
  return digits.length >= 10 && digits.length <= 15;
}

function tryOnUsageKey(userId: string, phone?: string): string {
  const normalized = normalizePhone(phone || "");
  return normalized ? `phone_${normalized}` : `tg_${userId}`;
}

function tryOnUsageDocId(key: string, date = new Date()): string {
  return `${date.toISOString().slice(0, 10)}_${key}`;
}

function managerThreadDocId(chatId: string, messageId: string | number): string {
  return `${chatId.replace(/[^\w-]/g, "_")}_${messageId}`;
}

// Costumes cache — refreshed every 5 minutes to avoid Firestore reads on every catalog open
let costumesCache: any[] | null = null;
let costumesCacheAt = 0;
async function getCostumes(): Promise<any[]> {
  if (costumesCache && Date.now() - costumesCacheAt < 5 * 60 * 1000) return costumesCache;
  if (!db) return [];
  const snap = await Promise.race([
    getDocs(collection(db, "costumes")),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("costumes timeout")), 3500))
  ]).catch(() => null) as any;
  if (!snap) return costumesCache || [];
  costumesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  costumesCacheAt = Date.now();
  return costumesCache;
}

async function getCostumeById(costumeId: string): Promise<any | null> {
  const cached = costumesCache?.find(c => c.id === costumeId);
  if (cached) return cached;
  if (!db) return null;

  const snap = await Promise.race([
    getDoc(doc(db, "costumes", costumeId)),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("costume timeout")), 3500))
  ]).catch(() => null) as any;
  if (!snap?.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

async function downloadTelegramPhoto(url: string, index: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`photo fetch ${response.status}`);
    const input = Buffer.from(await response.arrayBuffer());
    const jpeg = await sharp(input)
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { source: jpeg, filename: `costume-${index + 1}.jpg` };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendCostumePhotos(ctx: any, costumeName: string, urls: string[]) {
  const cleanUrls = urls.filter(Boolean);
  let sent = 0;
  for (let i = 0; i < cleanUrls.length; i += 1) {
    const url = cleanUrls[i];
    try {
      const photo = await downloadTelegramPhoto(url, i);
      await ctx.replyWithPhoto(photo, i === 0 ? { caption: costumeName } : undefined);
      sent += 1;
    } catch (e: any) {
      console.error(`costume photo ${i + 1} error:`, e.message);
      try {
        await ctx.replyWithPhoto({ url }, i === 0 ? { caption: costumeName } : undefined);
        sent += 1;
      } catch (fallbackError: any) {
        console.error(`costume photo ${i + 1} fallback error:`, fallbackError.message);
      }
    }
  }
  return sent;
}

// Bot button config — editable from CRM
interface BotButton { id: string; label: string; response: string; }
interface BotCfg { welcomeText: string; buttons: BotButton[]; managerChatIds: string[]; }
const DEFAULT_PHOTO_CATALOG_BUTTON: BotButton = {
  id: "catalog_photos",
  label: "📸 Смотреть фото",
  response: "👗 *Каталог YB Studio*\n\nВыбери модель чтобы посмотреть фото 👇",
};
const PHOTO_CATALOG_BUTTON_RE = /(смотреть\s*фото|фото\s*каталог|каталог\s*фото)/i;
const visibleBotButton = (button: BotButton) => button.id !== "tryon";
const cleanBotButton = (button: BotButton): BotButton => ({ ...button, label: (button.label || "").trim() });
const isPhotoCatalogButton = (button: BotButton) => button.id === "catalog_photos" || PHOTO_CATALOG_BUTTON_RE.test(button.label || "");
// Old text-catalog button — removed entirely from the menu
const isTextCatalogButton = (button: BotButton) =>
  !isPhotoCatalogButton(button) &&
  (button.id === "catalog_text" || button.id === "catalog" || /^👗?\s*Каталог$/i.test(button.label || ""));
const cleanBotButtons = (buttons: BotButton[]) => {
  const cleaned: BotButton[] = [];
  buttons.filter(visibleBotButton).forEach(rawButton => {
    const button = cleanBotButton(rawButton);
    if (!button.label) return;
    if (isTextCatalogButton(button)) return; // drop the old "Каталог" text button completely
    cleaned.push(button);
  });
  const hasPhotoCatalog = cleaned.some(isPhotoCatalogButton);
  return hasPhotoCatalog ? cleaned : [DEFAULT_PHOTO_CATALOG_BUTTON, ...cleaned];
};

const DEFAULT_BOT_CFG: BotCfg = {
  welcomeText: "Привет, {name}! 👋\n\nДобро пожаловать в *YB Studio* — твой личный стилист.\n\n✨ Здесь ты можешь:\n👗 Посмотреть каталог\n🎁 Получить персональную скидку\n🆕 Первым узнавать о новинках\n\n*Специально для тебя — скидка 10% на первый заказ!*\nВыбери что тебя интересует 👇",
  buttons: [
    DEFAULT_PHOTO_CATALOG_BUTTON,
    { id: "bonuses", label: "🎁 Мои бонусы",          response: "🎁 *Твои бонусы*\n\nОтправь свой номер телефона чтобы проверить баланс." },
    { id: "news",    label: "🆕 Новинки",             response: "🆕 *Новинки YB Studio*\n\nСледи за обновлениями — скоро здесь появятся новые коллекции!" },
    { id: "contact", label: "📞 Связаться с нами",    response: "📞 *Связь с нами*\n\nНапиши своё сообщение — менеджер ответит в течение нескольких минут 🙏" },
  ],
  managerChatIds: DEFAULT_MANAGER_CHAT_IDS,
};

let botCfg: BotCfg = JSON.parse(JSON.stringify(DEFAULT_BOT_CFG));

async function loadBotCfg() {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, "settings", "bot_buttons"));
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data.buttons) botCfg.buttons = cleanBotButtons(data.buttons);
      if (data.welcomeText) botCfg.welcomeText = data.welcomeText;
      if (data.managerChatIds) botCfg.managerChatIds = parseManagerChatIds(data.managerChatIds);
    }
    const cfgSnap = await getDoc(doc(db, "settings", "bot_config"));
    if (cfgSnap.exists() && cfgSnap.data().welcomeText) botCfg.welcomeText = cfgSnap.data().welcomeText;
    const managerSnap = await getDoc(doc(db, "settings", "bot_manager_config"));
    if (managerSnap.exists()) botCfg.managerChatIds = parseManagerChatIds((managerSnap.data() as any).managerChatIds);
  } catch {}
}

async function resizeToBase64(b64: string, maxPx = 768): Promise<string> {
  try {
    const buf = Buffer.from(b64, "base64");
    const resized = await sharp(buf).resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return resized.toString("base64");
  } catch { return b64; }
}

async function runGeminiTryOn(
  userPhotoBase64: string,
  costumeBase64: string,
  attempt = 1,
  allCostumeBase64s?: string[],
  viewLabel = "front"
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задан");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120000 } });

  // Use only first costume photo — multiple photos don't improve quality but slow Gemini significantly
  const costumePhoto = (allCostumeBase64s?.length ? allCostumeBase64s[0] : costumeBase64) || costumeBase64;
  const [resizedUser, resizedCostume] = await Promise.all([
    resizeToBase64(userPhotoBase64, 768),
    resizeToBase64(costumePhoto, 768),
  ]);
  let response: any;
  try {
  response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{
      role: "user",
      parts: [
        { text: `Virtual try-on, front view only.

IMAGE 1 is the garment reference. Use ONLY the clothing from IMAGE 1: exact garment type, color, fabric texture, print, pattern, cut, seams, silhouette, proportions, details, logos, buttons, zippers, pockets, cuffs, waistline, collar and all design elements. Do not redesign, recolor, simplify, stylize, crop, replace, or alter the garment in any way.

IMAGE 2 is the client/person reference. Keep everything from IMAGE 2 except the original clothing: the same face, hair, skin tone, body shape, body volume, height proportions, pose, hands, legs, camera angle, lighting, shadows, background, framing, image quality and realism.

Generate a photorealistic image of the person from IMAGE 2 wearing the exact garment from IMAGE 1. Only replace the clothing. The final image must look like the original photo of the client, with the garment naturally fitted to her body.` },
        { inlineData: { mimeType: "image/jpeg", data: resizedCostume } },
        { inlineData: { mimeType: "image/jpeg", data: resizedUser } },
      ] as any
    }],
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });
  } catch (e: any) {
    const message = e.message || "";
    const isTimeoutLike = message.includes("aborted") || message.includes("CANCELLED") || message.includes("DEADLINE_EXCEEDED") || message.includes("Deadline expired") || message.includes("timeout");
    const isRetryable = !isTimeoutLike && (
      message.includes("502") ||
      message.includes("503") ||
      message.includes("500") ||
      message.includes("429") ||
      message.includes("fetch failed")
    );
    if (isRetryable && attempt < 2) {
      const delay = 2500;
      console.log(`Gemini error "${e.message?.slice(0, 50)}" — retry ${attempt}/2 через ${delay/1000}s`);
      await new Promise(r => setTimeout(r, delay));
      return runGeminiTryOn(userPhotoBase64, costumeBase64, attempt + 1, allCostumeBase64s, viewLabel);
    }
    throw e;
  }
  const parts = (response as any).candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const imgBuf = Buffer.from(part.inlineData.data, "base64");
      const resized = await sharp(imgBuf)
        .resize(1080, 1350, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      return resized.toString("base64");
    }
  }
  return null;
}

function startTelegramBot() {
  if (!BOT_TOKEN) { console.warn("TG_BOT_TOKEN не задан — бот не запущен"); return; }
  if (process.env.BOT_DISABLED === "true") { console.log("BOT_DISABLED=true — бот не запущен локально"); return; }

  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 600_000 });

  const getMainMenu = () => {
    const rows: string[][] = [];
    for (let i = 0; i < botCfg.buttons.length; i += 2) {
      rows.push(botCfg.buttons.slice(i, i + 2).map(b => b.label));
    }
    return Markup.keyboard(rows).resize();
  };

  const getManagerChatIds = () => botCfg.managerChatIds?.length ? botCfg.managerChatIds : DEFAULT_MANAGER_CHAT_IDS;

  const isManagerChat = (ctx: any) => getManagerChatIds().includes(String(ctx.chat?.id || ""));

  const formatClientName = (from: any) => {
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
    const username = from?.username ? `@${from.username}` : "";
    return [name, username].filter(Boolean).join(" ") || "Клиент";
  };

  const notifyManagers = async (ctx: any, messageText: string, type = "message", messageDocId?: string) => {
    const managerChatIds = getManagerChatIds();
    if (!managerChatIds.length || !ctx.from) return;

    const userId = String(ctx.from.id);
    const title = type === "order_request" ? "Заявка из бота" : "Новое сообщение в боте";
    const body = [
      `📩 ${title}`,
      `Клиент: ${formatClientName(ctx.from)}`,
      `Telegram ID: ${userId}`,
      "",
      messageText,
      "",
      "Чтобы ответить клиенту, нажми Reply на это сообщение и отправь текст."
    ].join("\n");

    await Promise.all(managerChatIds.map(async managerChatId => {
      try {
        const sent = await bot.telegram.sendMessage(managerChatId, body);
        if (db) {
          await setDoc(doc(db, "bot_manager_threads", managerThreadDocId(managerChatId, sent.message_id)), {
            managerChatId,
            managerMessageId: sent.message_id,
            userId,
            messageDocId: messageDocId || "",
            type,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        console.error("manager notify error:", e.message);
      }
    }));
  };

  const handleManagerReply = async (ctx: any): Promise<boolean> => {
    if (!isManagerChat(ctx)) return false;
    const message = ctx.message as any;
    const text = message?.text || "";
    if (text.startsWith("/")) return false;

    const replyToMessageId = message?.reply_to_message?.message_id;
    if (!replyToMessageId) {
      await ctx.reply("Чтобы ответить клиенту, нажми Reply на его сообщение из бота.");
      return true;
    }

    if (!db) {
      await ctx.reply("База данных недоступна, не могу найти клиента для ответа.");
      return true;
    }

    const managerChatId = String(ctx.chat.id);
    const snap = await getDoc(doc(db, "bot_manager_threads", managerThreadDocId(managerChatId, replyToMessageId))).catch(() => null);
    if (!snap?.exists()) {
      await ctx.reply("Не нашёл клиента для этого сообщения. Ответь именно на уведомление, которое прислал бот.");
      return true;
    }

    const thread = snap.data() as any;
    const userId = String(thread.userId || "");
    if (!userId) {
      await ctx.reply("В привязке нет Telegram ID клиента.");
      return true;
    }

    try {
      if (message.text) {
        await bot.telegram.sendMessage(userId, message.text);
      } else {
        await (bot.telegram as any).copyMessage(userId, managerChatId, message.message_id);
      }

      if (thread.messageDocId) {
        await updateDoc(doc(db, "bot_messages", thread.messageDocId), {
          replied: true,
          repliedAt: new Date().toISOString(),
          repliedFromManagerChatId: managerChatId,
        }).catch(() => {});
      }

      await ctx.reply("Отправлено клиенту ✅");
    } catch (e: any) {
      await ctx.reply(`Не получилось отправить клиенту: ${e.message}`);
    }
    return true;
  };

  bot.use(async (ctx: any, next: any) => {
    if (ctx.message && await handleManagerReply(ctx)) return;
    return next();
  });

  bot.command("myid", async (ctx) => {
    await ctx.reply([
      `chat_id: ${ctx.chat.id}`,
      `user_id: ${ctx.from.id}`,
      getManagerChatIds().includes(String(ctx.chat.id))
        ? "Этот чат подключен как менеджерский."
        : "Добавь chat_id на странице Бот -> Настройки, чтобы получать сообщения клиентов здесь."
    ].join("\n"));
  });

  const saveSubscriber = async (ctx: any) => {
    if (!db) return;
    try {
      await setDoc(doc(db, "bot_subscribers", String(ctx.from.id)), {
        userId: String(ctx.from.id),
        firstName: ctx.from.first_name || "",
        lastName: ctx.from.last_name || "",
        username: ctx.from.username || "",
        subscribedAt: new Date().toISOString(),
        active: true,
      }, { merge: true });
    } catch {}
  };

  const getSubscriberPhone = async (userId: string): Promise<string> => {
    if (!db) return "";
    const snap = await getDoc(doc(db, "bot_subscribers", userId)).catch(() => null);
    const rawPhone = snap?.exists() ? String((snap.data() as any).phone || "") : "";
    return normalizePhone(rawPhone);
  };

  const saveSubscriberPhone = async (ctx: any, phone: string) => {
    const normalized = normalizePhone(phone);
    if (!db || !normalized) return;
    await setDoc(doc(db, "bot_subscribers", String(ctx.from.id)), {
      userId: String(ctx.from.id),
      firstName: ctx.from.first_name || "",
      lastName: ctx.from.last_name || "",
      username: ctx.from.username || "",
      phone: normalized,
      phoneSavedAt: new Date().toISOString(),
      subscribedAt: new Date().toISOString(),
      active: true,
    }, { merge: true }).catch(() => {});
  };

  const getTryOnUsage = async (key: string) => {
    if (!db || !key) return { used: 0, remaining: DAILY_TRYON_LIMIT };
    const snap = await getDoc(doc(db, "tryon_usage", tryOnUsageDocId(key))).catch(() => null);
    const used = snap?.exists() ? Number((snap.data() as any).count) || 0 : 0;
    return { used, remaining: Math.max(0, DAILY_TRYON_LIMIT - used) };
  };

  const reserveTryOnUsage = async (key: string, amount: number) => {
    if (!db || !key) return { ok: true, remaining: DAILY_TRYON_LIMIT };
    const id = tryOnUsageDocId(key);
    const refDoc = doc(db, "tryon_usage", id);
    const snap = await getDoc(refDoc).catch(() => null);
    const used = snap?.exists() ? Number((snap.data() as any).count) || 0 : 0;
    const remaining = Math.max(0, DAILY_TRYON_LIMIT - used);
    if (remaining < amount) return { ok: false, remaining };
    const nextCount = used + amount;
    await setDoc(refDoc, {
      key,
      date: new Date().toISOString().slice(0, 10),
      count: nextCount,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { ok: true, remaining: Math.max(0, DAILY_TRYON_LIMIT - nextCount) };
  };

  const downloadUrl = async (url: string): Promise<string> => {
    const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    return Buffer.from(resp.data).toString("base64");
  };

  const runTryOnGeneration = async (ctx: any, state: TryOnState, inputs: TryOnPhotoInput[], processingMessageId: number) => {
    const totalStartedAt = Date.now();
    const phone = normalizePhone(state.phone || await getSubscriberPhone(String(ctx.from.id)));
    const usageKey = tryOnUsageKey(String(ctx.from.id), phone);
    const usage = await reserveTryOnUsage(usageKey, inputs.length);
    if (!usage.ok) {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMessageId).catch(() => {});
      await ctx.reply(
        `Лимит онлайн-примерок на сегодня закончился. На один Telegram-аккаунт доступно ${DAILY_TRYON_LIMIT} примерок в сутки.`
      );
      return;
    }

    const results = await Promise.all(inputs.map(async (input) => {
      const t0 = Date.now();
      const [fileLink, costumeBase64] = await Promise.all([
        ctx.telegram.getFileLink(input.userFileId),
        downloadUrl(input.costumeUrl),
      ]);
      const userPhotoBase64 = await downloadUrl(fileLink.href);
      console.log(`[tryon:${input.label}] download: ${Date.now() - t0}ms`);

      const t1 = Date.now();
      const resultBase64 = await runGeminiTryOn(userPhotoBase64, costumeBase64, 1, undefined, input.label);
      console.log(`[tryon:${input.label}] gemini: ${Date.now() - t1}ms`);
      if (!resultBase64) throw new Error(`Gemini не вернул изображение (${input.label})`);
      return { label: input.label, base64: resultBase64 };
    }));

    await setTryOnOrder(String(ctx.from.id), {
      costumeName: state.costumeName,
      views: results.map(r => r.label),
      phone: phone || "",
      usageKey,
      remainingToday: usage.remaining,
      firstName: ctx.from.first_name || "",
      username: ctx.from.username || "",
      createdAt: new Date().toISOString(),
      status: "tryon_ready",
    }).catch(() => {});

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMessageId).catch(() => {});

    if (results.length > 1) {
      await ctx.replyWithMediaGroup(
        results.map((result, index) => ({
          type: "photo" as const,
          media: { source: Buffer.from(result.base64, "base64") },
          ...(index === 0 ? { caption: `✨ Примерка *${state.costumeName}*: спереди и сзади`, parse_mode: "Markdown" as const } : {}),
        }))
      );
      await ctx.reply(
        `Понравилось? Оставь заявку — менеджер быстро оформит заказ 👇\n\nОсталось примерок сегодня: ${usage.remaining}`,
        Markup.inlineKeyboard([Markup.button.callback("🛍 Заказать", "order_tryon")])
      );
    } else {
      await ctx.replyWithPhoto(
        { source: Buffer.from(results[0].base64, "base64") },
        {
          caption: `✨ Вот как ты выглядишь в *${state.costumeName}*!\n\nПонравилось? Оформи заказ 👇\n\nОсталось примерок сегодня: ${usage.remaining}`,
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([Markup.button.callback("🛍 Заказать", "order_tryon")])
        }
      );
    }

    console.log(`[tryon] total: ${Date.now() - totalStartedAt}ms, views=${results.map(r => r.label).join(",")}`);
  };

  bot.start(async (ctx) => {
    saveSubscriber(ctx).catch(() => {});
    const name = ctx.from?.first_name || "друг";
    const welcome = botCfg.welcomeText.replace("{name}", name);
    await ctx.reply(welcome, { parse_mode: "Markdown", ...getMainMenu() }).catch((error: any) => {
      // A delayed Telegram update may arrive after the user has blocked the bot.
      // Treat delivery errors as a failed update, not as a fatal server error.
      console.warn("Telegram /start reply skipped:", error?.message || error);
    });
  });

  // Callback when user picks a costume
  bot.action(/^catalog_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      const costumeId = ctx.match[1];
      if (!db) return ctx.reply("База данных недоступна, попробуй позже").catch(() => {});
      const c = await getCostumeById(costumeId);
      if (!c) return ctx.reply("Модель не найдена, попробуй ещё раз").catch(() => {});
      const urls: string[] = c.imageUrls?.length ? c.imageUrls : [c.imageUrl];

      const sentPhotos = await sendCostumePhotos(ctx, c.name, urls);
      if (!sentPhotos) {
        await ctx.reply("Не смогла отправить фото сейчас. Попробуй ещё раз или напиши менеджеру 🙏").catch(() => {});
      }

      await ctx.reply(
        `*${c.name}*\n\nЧтобы оформить заказ — напиши менеджеру 🙏`,
        { parse_mode: "Markdown" }
      );
    } catch (e: any) {
      console.error("catalog action error:", e.message);
    }
  });

  bot.action(/^tryon_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      const costumeId = ctx.match[1];
      if (!db) return ctx.reply("База данных недоступна, попробуй позже").catch(() => {});
      const costume = await getCostumeById(costumeId);
      if (!costume) return ctx.reply("Костюм не найден, попробуй выбрать снова").catch(() => {});
      const urls: string[] = costume.imageUrls?.length ? costume.imageUrls : [costume.imageUrl];
      const userId = String(ctx.from!.id);
      const phone = await getSubscriberPhone(userId);
      await setTryOnState(userId, { costumeUrls: urls, costumeName: costume.name, phone });
      const usage = await getTryOnUsage(tryOnUsageKey(userId, phone));
      if (usage.remaining <= 0) {
        await ctx.reply(`Лимит онлайн-примерок на сегодня закончился. На один Telegram-аккаунт доступно ${DAILY_TRYON_LIMIT} примерок в сутки.`);
        return;
      }
      await ctx.reply(
        `Отлично! Ты выбрала *${costume.name}* 👗\n\nОсталось примерок сегодня: ${usage.remaining}/${DAILY_TRYON_LIMIT}\n\nПришли *одно фото спереди в полный рост* — я сделаю примерку.\n\n📸 Загрузи фото 👇`,
        { parse_mode: "Markdown" }
      );
    } catch (e: any) {
      console.error("tryon action error:", e.message);
    }
  });

  bot.on("contact", async (ctx) => {
    try {
      const contact = (ctx.message as any).contact;
      const phone = normalizePhone(contact?.phone_number || "");
      if (!phone) return ctx.reply("Не получилось прочитать номер. Нажми кнопку отправки номера ещё раз.").catch(() => {});

      await saveSubscriberPhone(ctx, phone);
      const userId = String(ctx.from.id);
      const state = await getTryOnState(userId);
      const usage = await getTryOnUsage(tryOnUsageKey(userId, phone));

      if (state) {
        await setTryOnState(userId, { ...state, phone });
        if (usage.remaining <= 0) {
          await ctx.reply(`Лимит онлайн-примерок на сегодня закончился. На один Telegram-аккаунт доступно ${DAILY_TRYON_LIMIT} примерок в сутки.`, getMainMenu());
          return;
        }
        await ctx.reply(
          `Номер подтверждён ✅\n\nОсталось примерок сегодня: ${usage.remaining}/${DAILY_TRYON_LIMIT}\n\nТеперь пришли *фото спереди в полный рост* 👇`,
          { parse_mode: "Markdown", ...getMainMenu() }
        );
        return;
      }

      await ctx.reply(`Номер подтверждён ✅\nСегодня доступно примерок: ${usage.remaining}/${DAILY_TRYON_LIMIT}`, getMainMenu());
    } catch (e: any) {
      console.error("contact handler error:", e.message);
      await ctx.reply("Не получилось сохранить номер. Попробуй ещё раз.").catch(() => {});
    }
  });

  bot.action("generate_one_tryon", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      const userId = String(ctx.from!.id);
      const state = await getTryOnState(userId);
      if (!state?.frontFileId) return ctx.reply("Сначала пришли фото спереди 👇").catch(() => {});
      const phone = normalizePhone(state.phone || await getSubscriberPhone(userId));
      state.phone = phone;
      await deleteTryOnState(userId);
      const processing = await ctx.reply("⏳ Создаю примерку... Обычно это 20-40 секунд.");
      const firstCostumeUrl = state.costumeUrls[0];
      if (!firstCostumeUrl) throw new Error("У костюма нет фото");
      await runTryOnGeneration(ctx, state, [{ label: "front", userFileId: state.frontFileId, costumeUrl: firstCostumeUrl }], processing.message_id);
    } catch (e: any) {
      console.error("tryon one-photo action error:", e.message);
      await ctx.reply("😔 Не удалось сделать примерку. Пришли фото ещё раз или выбери другой костюм.").catch(() => {});
    }
  });

  bot.action("order_tryon", async (ctx) => {
    try {
      await ctx.answerCbQuery("Заявка отправлена менеджеру").catch(() => {});
      const userId = String(ctx.from!.id);
      const order = await getTryOnOrder(userId);
      const costumeName = order?.costumeName || "костюм после примерки";
      const requestText = [
        "🛍 Заявка на заказ из бота",
        `Костюм: ${costumeName}`,
        `Клиент: ${ctx.from?.first_name || ""}${ctx.from?.username ? ` @${ctx.from.username}` : ""}`,
        `Telegram ID: ${userId}`,
        order?.views?.length ? `Примерки: ${order.views.join(", ")}` : "",
      ].filter(Boolean).join("\n");

      let messageDocId = "";
      if (db) {
        try {
          const messageRef = await addDoc(collection(db, "bot_messages"), {
            userId,
            username: ctx.from?.username || "",
            firstName: ctx.from?.first_name || "",
            text: requestText,
            receivedAt: new Date().toISOString(),
            replied: false,
            type: "order_request",
            costumeName,
          });
          messageDocId = messageRef.id;
        } catch {}
      }
      await notifyManagers(ctx, requestText, "order_request", messageDocId);

      await setTryOnOrder(userId, { ...order, status: "order_requested", requestedAt: new Date().toISOString() }).catch(() => {});
      await ctx.reply(
        `Готово! Заявка на *${costumeName}* отправлена менеджеру 🖤\n\nСкоро напишем тебе, уточним размер и оформим заказ.`,
        { parse_mode: "Markdown", ...getMainMenu() }
      );
    } catch (e: any) {
      console.error("order tryon error:", e.message);
      await ctx.reply("Не получилось отправить заявку. Напиши сообщение менеджеру прямо сюда — мы увидим его в CRM.").catch(() => {});
    }
  });

  bot.action("contact_manager", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(
        "Напиши сообщение прямо сюда — менеджер получит его и ответит в этом чате 🙏",
        getMainMenu()
      );
    } catch (e: any) {
      console.error("contact manager action error:", e.message);
    }
  });

  // Photo handler — virtual try-on
  bot.on("photo", async (ctx) => {
    const userId = String(ctx.from.id);
    const state = await getTryOnState(userId);
    if (!state) {
      return ctx.reply("Сначала выбери костюм для примерки 👗\nНажми *«Примерить онлайн»*", { parse_mode: "Markdown" });
    }

    const photos = (ctx.message as any).photo;
    const fileId = photos[photos.length - 1].file_id;
    const costumeUrls = state.costumeUrls || [];
    const costumeName = state.costumeName;
    const phone = normalizePhone(state.phone || await getSubscriberPhone(userId));

    await deleteTryOnState(userId);
    const processing = await ctx.reply("⏳ Создаю примерку... Обычно это 20-40 секунд.");

    // Run Gemini in background — don't await so Telegraf handler returns immediately
    (async () => {
      try {
        const frontCostumeUrl = costumeUrls[0];
        if (!frontCostumeUrl) throw new Error("У костюма нет фото");
        await runTryOnGeneration(ctx, state, [
          { label: "front", userFileId: fileId, costumeUrl: frontCostumeUrl },
        ], processing.message_id);
      } catch (e: any) {
        console.error("tryon photo error:", e.message, e.cause?.message || "");
        // Restore state so user can retry without reselecting costume
        await setTryOnState(userId, { costumeUrls, costumeName, phone });
        await ctx.telegram.deleteMessage(ctx.chat.id, processing.message_id).catch(() => {});
        const isOverload = e.message?.includes("502") || e.message?.includes("503") || e.message?.includes("429") || e.message?.includes("fetch failed") || e.message?.includes("aborted") || e.message?.includes("CANCELLED");
        await ctx.reply(
          isOverload
            ? `⚠️ AI сервис сейчас перегружен. Просто пришли фото ещё раз — попробуем снова 🔄`
            : `😔 Не удалось сделать примерку. Пришли фото ещё раз или выбери другой костюм.`
        ).catch(() => {});
      }
    })();
  });

  // Text messages — handles both menu buttons and free text
  bot.on("text", async (ctx) => {
    try {
      const text = (ctx.message as any).text as string;
      if (text.startsWith("/")) return;

      const pendingTryOn = await getTryOnState(String(ctx.from.id));
      if (pendingTryOn && !pendingTryOn.phone && looksLikePhone(text)) {
        const phone = normalizePhone(text);
        await saveSubscriberPhone(ctx, phone);
        const usage = await getTryOnUsage(tryOnUsageKey(String(ctx.from.id), phone));
        await setTryOnState(String(ctx.from.id), { ...pendingTryOn, phone });
        if (usage.remaining <= 0) {
          await ctx.reply(`Лимит онлайн-примерок на сегодня закончился. На один Telegram-аккаунт доступно ${DAILY_TRYON_LIMIT} примерок в сутки.`, getMainMenu());
          return;
        }
        await ctx.reply(
          `Номер подтверждён ✅\n\nОсталось примерок сегодня: ${usage.remaining}/${DAILY_TRYON_LIMIT}\n\nТеперь пришли *фото спереди в полный рост* 👇`,
          { parse_mode: "Markdown", ...getMainMenu() }
        );
        return;
      }

      // Check if text matches any menu button label
      const btn = botCfg.buttons.find(b => b.label === text);
      if (btn) {
        if (isPhotoCatalogButton(btn)) {
          // Show catalog as list of model name buttons
          saveSubscriber(ctx).catch(() => {});
          const costumes = await getCostumes();
          if (!costumes.length) return ctx.reply("Каталог костюмов пока пустой — скоро добавим! 👗");

          const modelButtons = costumes.map((c: any) =>
            [Markup.button.callback(`👗 ${c.name}`, `catalog_${c.id}`)]
          );
          await ctx.reply(
            btn.response || "👗 *Каталог YB Studio*\n\nВыбери модель чтобы посмотреть фото 👇",
            { parse_mode: "Markdown", ...Markup.inlineKeyboard(modelButtons) }
          );
        } else if (btn.id === "contact") {
          await ctx.reply(
            "📞 *Связаться с нами*\n\nНажми кнопку ниже и напиши сообщение — менеджер ответит в этом чате 👇",
            {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([[Markup.button.callback("💬 Написать менеджеру", "contact_manager")]])
            }
          );
        } else if (btn.response) {
          await ctx.reply(btn.response, { parse_mode: "Markdown" });
        }
        return;
      }

      // Free text — save as message and reply
      await ctx.reply("Спасибо! Менеджер ответит в ближайшее время 🙏", getMainMenu());
      let messageDocId = "";
      if (db) {
        try {
          const messageRef = await addDoc(collection(db, "bot_messages"), {
            userId: String(ctx.from.id),
            username: ctx.from.username || "",
            firstName: ctx.from.first_name || "",
            text,
            receivedAt: new Date().toISOString(),
            replied: false,
          });
          messageDocId = messageRef.id;
        } catch {}
      }
      await notifyManagers(ctx, text, "message", messageDocId);
    } catch (e: any) { console.error("text handler error:", e.message); }
  });

  botInstance = bot;
  const webhookUrl = process.env.WEBHOOK_URL || process.env.SERVER_URL;

  if (webhookUrl) {
    // Webhook mode for Cloud Run
    const webhookPath = "/tg-webhook-" + BOT_TOKEN.split(":")[0];
    bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`)
      .then(() => bot.telegram.getMe())
      .then(me => console.log(`Telegram бот запущен (webhook): @${me.username}`))
      .catch(e => console.error("Webhook setup error:", e.message));
    app.post(webhookPath, (req, res) => {
      bot.handleUpdate(req.body, res).catch((error: any) => {
        console.error("Telegram webhook update error:", error?.message || error);
        if (!res.headersSent) res.sendStatus(200);
      });
    });
  } else if (process.env.K_SERVICE) {
    console.warn("WEBHOOK_URL не задан в Cloud Run — polling основного бота отключён, чтобы не ловить Telegram 409");
    return;
  } else {
    // Polling mode for local dev
    bot.telegram.deleteWebhook().catch(() => {});
    bot.telegram.getMe()
      .then(me => {
        console.log(`Telegram бот запущен (polling): @${me.username}`);
        (bot as any).startPolling();
      })
      .catch(e => console.error("Ошибка запуска бота:", e.message));
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }

  getCostumes().catch(() => {});
}

loadBotCfg().then(() => startTelegramBot());

// ─── КОНТЕНТ-БОТ ──────────────────────────────────────────────────────────────
const CONTENT_BOT_TOKEN = process.env.CONTENT_BOT_TOKEN || "";
const FAL_API_KEY = process.env.FAL_API_KEY || "";
const CONTENT_GEMINI_KEY = process.env.GEMINI_API_KEY || "";

type CntState =
  | { type: 'idle' }
  | { type: 'waiting_img_input'; photos: Array<{base64: string; mimeType: string}> }
  | { type: 'waiting_img_quality'; photos: Array<{base64: string; mimeType: string}>; prompt: string }
  | { type: 'waiting_img_format'; photos: Array<{base64: string; mimeType: string}>; prompt: string; imageSize: '1K' | '2K' | '4K' }
  | { type: 'waiting_vid_image' }
  | { type: 'waiting_vid_prompt'; imageBase64: string }
  | { type: 'waiting_vid_duration'; imageBase64: string; prompt: string }
  | { type: 'waiting_custom_prompt' };

const cntStates = new Map<number, CntState>();

const CONTENT_MENU = Markup.keyboard([
  ['🖼 Сгенерировать картинку', '🎬 Видео из картинки'],
  ['✏️ Написать промпт'],
]).resize();

async function falGenerateVideo(
  prompt: string,
  imageUrl?: string,
  duration: "5" | "10" = "5",
  aspectRatio: "16:9" | "9:16" | "1:1" = "16:9",
  mode: "fast" | "standard" = "standard",
): Promise<string> {
  if (!FAL_API_KEY) throw new Error("FAL_API_KEY не задан");
  const base = mode === "fast"
    ? "https://queue.fal.run/bytedance/seedance-2.0/fast/image-to-video"
    : "https://queue.fal.run/bytedance/seedance-2.0/image-to-video";
  const body: any = { prompt, duration: parseInt(duration), aspect_ratio: aspectRatio };
  if (imageUrl) body.image_url = imageUrl;
  const sub = await fetch(base, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const subText = await sub.text();
  if (!sub.ok) throw new Error(`fal.ai Seedance submit ${sub.status}: ${subText.slice(0, 300)}`);
  let subData: any;
  try {
    subData = JSON.parse(subText);
  } catch {
    throw new Error(`fal.ai Seedance: неверный ответ запуска ${subText.slice(0, 200)}`);
  }
  const request_id = subData.request_id;
  if (!request_id) throw new Error(`fal.ai Seedance: ${JSON.stringify(subData)}`);
  console.log(`[seedance] submitted request_id=${request_id}, mode=${mode}, duration=${duration}, ratio=${aspectRatio}`);
  const statusUrl = subData.status_url || `${base}/requests/${request_id}/status`;
  const resultUrl = subData.response_url || `${base}/requests/${request_id}`;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Key ${FAL_API_KEY}` } });
    const statusText = await statusRes.text();
    if (!statusRes.ok) throw new Error(`Seedance status ${statusRes.status}: ${statusText.slice(0, 300)}`);
    const statusData = JSON.parse(statusText) as any;
    if (statusData.status === "FAILED") throw new Error("Seedance: генерация провалилась");
    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, { headers: { "Authorization": `Key ${FAL_API_KEY}` } });
      const resultText = await resultRes.text();
      if (!resultRes.ok) throw new Error(`Seedance result ${resultRes.status}: ${resultText.slice(0, 300)}`);
      const result = JSON.parse(resultText) as any;
      const videoUrl = result.video?.url ?? result.output?.video?.url ?? result.output?.url ?? result.data?.video?.url ?? result.data?.url ?? "";
      if (!videoUrl) throw new Error(`Seedance: нет URL видео. Ответ: ${JSON.stringify(result).slice(0, 200)}`);
      console.log(`[seedance] completed request_id=${request_id}, videoUrl=${String(videoUrl).slice(0, 160)}`);
      return videoUrl;
    }
  }
  throw new Error("Seedance: timeout 6 мин");
}


async function geminiGenerateImage(
  prompt: string,
  images?: Array<{base64: string; mimeType: string}>,
  imageSize: '1K' | '2K' | '4K' = '1K',
  aspectRatio: string = '1:1',
): Promise<Buffer> {
  if (!CONTENT_GEMINI_KEY) throw new Error("GEMINI_API_KEY не задан");
  const hasReferenceImages = (images?.length ?? 0) > 0;
  // img2img: короткий таймаут — если Gemini не берёт запрос, он висит до таймаута, потом retry
  const timeoutMs = hasReferenceImages ? 90000 : 240000;
  const ai = new GoogleGenAI({ apiKey: CONTENT_GEMINI_KEY, httpOptions: { timeout: timeoutMs } });

  const parts: any[] = [{ text: prompt }];
  for (const img of images ?? []) {
    const buf = Buffer.from(img.base64, 'base64');
    const resized = await sharp(buf).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: resized.toString('base64') } });
  }

  // aspectRatio не поддерживается в img2img режиме, imageSize — да
  const imgConfig = hasReferenceImages ? { imageSize } : { imageSize, aspectRatio };

  let lastError: Error = new Error("Gemini не вернул картинку");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[gemini-image] attempt ${attempt}, images=${images?.length ?? 0}, size=${imageSize}, ratio=${hasReferenceImages ? 'n/a(img2img)' : aspectRatio}, timeout=${timeoutMs / 1000}s`);
      const imgRes = await ai.models.generateContent({
        model: "gemini-3.1-flash-image-preview",
        contents: [{ role: "user", parts }],
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT], imageConfig: imgConfig },
      });
      console.log(`[gemini-image] response ok`);
      for (const part of (imgRes as any).candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
      }
      const txt = (imgRes as any).candidates?.[0]?.content?.parts?.filter((p: any) => p.text)?.map((p: any) => p.text).join(' ');
      console.warn(`[gemini-image] no image. text="${txt?.slice(0, 200)}"`);
      throw new Error("Gemini не вернул картинку");
    } catch (e: any) {
      lastError = e;
      const msg = e?.message || '';
      console.error(`[gemini-image] attempt ${attempt} error: ${msg.slice(0, 200)}`);
      // "aborted" — API нестабилен, retry обычно помогает (подтверждено логами)
      const isRetriable = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('aborted');
      if (isRetriable && attempt < 3) {
        await new Promise(r => setTimeout(r, 5000 * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

async function geminiWritePrompt(userText: string, mode: 'image' | 'video'): Promise<string> {
  if (!CONTENT_GEMINI_KEY) throw new Error("GEMINI_API_KEY не задан");
  const ai = new GoogleGenAI({ apiKey: CONTENT_GEMINI_KEY, httpOptions: { timeout: 25000 } });
  const instruction = mode === 'image'
    ? `Write a detailed photorealistic image generation prompt in English for: "${userText}". Only the prompt, max 80 words.`
    : `Write a short cinematic video prompt in English for: "${userText}". Only the prompt, max 50 words.`;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout — попробуй ещё раз')), 25000));
  const res = await Promise.race([
    ai.models.generateContent({ model: "gemini-3.1-flash-image-preview", contents: instruction }),
    timeout,
  ]);
  return (res as any).candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? userText;
}

async function geminiWriteBroadcastCopy(userText: string): Promise<string> {
  if (!CONTENT_GEMINI_KEY) throw new Error("GEMINI_API_KEY не задан");
  const ai = new GoogleGenAI({ apiKey: CONTENT_GEMINI_KEY, httpOptions: { timeout: 25000 } });
  const instruction = `Напиши один короткий продающий текст для клиентской рассылки в Telegram или мессенджере.
Требования:
- русский язык
- до 160 символов
- живой тон без канцелярита
- без агрессивного спама и кликбейта
- можно 1-2 эмодзи
- ответь только готовым текстом, без пояснений

Тема: ${userText}`;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout — попробуй ещё раз')), 25000));
  const res = await Promise.race([
    ai.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: instruction }),
    timeout,
  ]);
  return (res as any).candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? userText;
}

function startContentBot() {
  if (process.env.BOT_DISABLED === "true") return;

  const bot = new Telegraf(CONTENT_BOT_TOKEN, { handlerTimeout: 600_000 });

  const sendMenu = (ctx: any) => ctx.reply("Выбери действие:", CONTENT_MENU);

  bot.start(async (ctx) => {
    cntStates.set(ctx.from.id, { type: 'idle' });
    await ctx.reply("Привет! 👋 Я генерирую контент через Gemini Flash 3.1 и Seedance 2.0", CONTENT_MENU);
  });

  // ── Кнопки меню ──
  bot.hears('🖼 Сгенерировать картинку', async (ctx) => {
    cntStates.set(ctx.from.id, { type: 'waiting_img_input', photos: [] });
    await ctx.reply("Отправь 1-3 фото (для редактирования/объединения) или сразу напиши тему:");
  });

  bot.hears('🎬 Видео из картинки', async (ctx) => {
    cntStates.set(ctx.from.id, { type: 'waiting_vid_image' });
    await ctx.reply("Отправь картинку:");
  });

  bot.hears('✏️ Написать промпт', async (ctx) => {
    cntStates.set(ctx.from.id, { type: 'waiting_custom_prompt' });
    await ctx.reply("Введи тему — сгенерирую промпт для картинки и видео:");
  });

  // ── Фото ──
  bot.on('photo', async (ctx) => {
    const state = cntStates.get(ctx.from.id) ?? { type: 'idle' };
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const imgBuf = Buffer.from(await (await fetch(fileUrl.toString())).arrayBuffer());
    const base64 = imgBuf.toString("base64");

    if (state.type === 'waiting_img_input') {
      const photos = [...state.photos, { base64, mimeType: 'image/jpeg' }];
      if (photos.length >= 3) {
        cntStates.set(ctx.from.id, { type: 'waiting_img_input', photos });
        await ctx.reply(`📸 Фото ${photos.length}/3 получено. Максимум достигнут — напиши промпт:`);
      } else {
        cntStates.set(ctx.from.id, { type: 'waiting_img_input', photos });
        await ctx.reply(`📸 Фото ${photos.length}/3 получено. Ещё фото или напиши промпт:`);
      }
      return;
    }

    if (state.type === 'waiting_vid_image') {
      cntStates.set(ctx.from.id, { type: 'waiting_vid_prompt', imageBase64: base64 });
      await ctx.reply("Картинка получена! Теперь введи тему или промпт для видео:");
      return;
    }

    return sendMenu(ctx);
  });

  // ── Фото как файл (без сжатия) ──
  bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith('image/')) return;
    const state = cntStates.get(ctx.from.id) ?? { type: 'idle' };
    const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
    const imgBuf = Buffer.from(await (await fetch(fileUrl.toString())).arrayBuffer());
    const base64 = imgBuf.toString("base64");

    if (state.type === 'waiting_img_input') {
      const photos = [...state.photos, { base64, mimeType: doc.mime_type || 'image/jpeg' }];
      cntStates.set(ctx.from.id, { type: 'waiting_img_input', photos });
      if (photos.length >= 3) {
        await ctx.reply(`📸 Фото ${photos.length}/3 получено. Максимум — напиши промпт:`);
      } else {
        await ctx.reply(`📸 Фото ${photos.length}/3 получено. Ещё фото или напиши промпт:`);
      }
      return;
    }
    if (state.type === 'waiting_vid_image') {
      cntStates.set(ctx.from.id, { type: 'waiting_vid_prompt', imageBase64: base64 });
      await ctx.reply("Картинка получена! Теперь введи тему или промпт для видео:");
      return;
    }
    return sendMenu(ctx);
  });

  // ── Текст ──
  bot.on('text', async (ctx) => {
    const state = cntStates.get(ctx.from.id) ?? { type: 'idle' };
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    // Картинка — получили промпт, спрашиваем качество
    if (state.type === 'waiting_img_input') {
      cntStates.set(ctx.from.id, { type: 'waiting_img_quality', photos: state.photos, prompt: text });
      const photoNote = state.photos.length > 0 ? ` (${state.photos.length} фото)` : '';
      await ctx.reply(`📝 Промпт${photoNote}:\n${text}\n\nВыбери качество:`,
        Markup.keyboard([['🖼 1K (быстро)', '🖼 2K', '🖼 4K']]).resize());
      return;
    }

    // Выбор качества → спрашиваем формат
    if (state.type === 'waiting_img_quality') {
      const imageSize: '1K' | '2K' | '4K' = text.includes('4K') ? '4K' : text.includes('2K') ? '2K' : '1K';
      cntStates.set(ctx.from.id, { type: 'waiting_img_format', photos: state.photos, prompt: state.prompt, imageSize });
      await ctx.reply(`Качество: ${imageSize}\n\nВыбери формат:`,
        Markup.keyboard([['1:1', '4:5'], ['9:16', '16:9']]).resize());
      return;
    }

    // Выбор формата → генерация картинки
    if (state.type === 'waiting_img_format') {
      const aspectRatio = ['1:1', '4:5', '9:16', '16:9'].find(r => text.includes(r)) ?? '1:1';
      cntStates.set(ctx.from.id, { type: 'idle' });
      const label = `${state.imageSize} ${aspectRatio}`;
      const msg = await ctx.reply(`⏳ Генерирую картинку ${label}...`, CONTENT_MENU);
      try {
        const imgBuf = await geminiGenerateImage(state.prompt, state.photos.length > 0 ? state.photos : undefined, state.imageSize, aspectRatio);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        await ctx.replyWithDocument(
          { source: imgBuf, filename: `image_${state.imageSize}.jpg` },
          { caption: `📝 ${state.prompt} (${label})`, ...CONTENT_MENU }
        );
      } catch (e: any) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        await ctx.reply(`❌ Ошибка генерации: ${(e as Error).message}`, CONTENT_MENU);
      }
      return;
    }

    // Видео промпт — спрашиваем режим + длительность
    if (state.type === 'waiting_vid_prompt') {
      cntStates.set(ctx.from.id, { type: 'waiting_vid_duration', imageBase64: state.imageBase64, prompt: text });
      await ctx.reply(`📝 Промпт:\n${text}\n\nВыбери режим и длительность:`,
        Markup.keyboard([
          ['⚡ 5 сек (Fast)', '⚡ 10 сек (Fast)'],
          ['🎬 5 сек (Standard)', '🎬 10 сек (Standard)'],
        ]).resize());
      return;
    }

    // Выбор режима/длительности → генерация видео
    if (state.type === 'waiting_vid_duration') {
      const mode: "fast" | "standard" = text.includes('Fast') ? 'fast' : 'standard';
      const duration: "5" | "10" = text.includes('10') ? "10" : "5";
      cntStates.set(ctx.from.id, { type: 'idle' });
      const timeLabel = mode === 'fast' ? '~30 сек' : '~2 мин';
      const msg = await ctx.reply(`⏳ Генерирую видео ${duration} сек (${mode}, ${timeLabel})...`, CONTENT_MENU);
      try {
        const imageDataUrl = `data:image/jpeg;base64,${state.imageBase64}`;
        const videoUrl = await falGenerateVideo(state.prompt, imageDataUrl, duration, "9:16", mode);
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error(`Не удалось скачать готовое видео: ${videoRes.status}`);
        const videoBuf = Buffer.from(await videoRes.arrayBuffer());
        console.log(`[content-bot] downloaded seedance video bytes=${videoBuf.length}, type=${videoRes.headers.get('content-type') || 'unknown'}`);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        await ctx.replyWithVideo(
          { source: videoBuf, filename: `seedance-${duration}s.mp4` },
          { caption: `📝 ${state.prompt}`, ...CONTENT_MENU },
        );
      } catch (e: any) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        await ctx.reply(`❌ Ошибка видео: ${(e as any).message}`, CONTENT_MENU);
      }
      return;
    }

    // Написать промпт
    if (state.type === 'waiting_custom_prompt') {
      cntStates.set(ctx.from.id, { type: 'idle' });
      const msg = await ctx.reply("⏳ Генерирую промпты...");
      try {
        const [imgPrompt, vidPrompt] = await Promise.all([
          geminiWritePrompt(text, 'image'),
          geminiWritePrompt(text, 'video'),
        ]);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
          `🖼 Промпт для картинки:\n${imgPrompt}\n\n🎬 Промпт для видео:\n${vidPrompt}`);
      } catch (e: any) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ ${e.message}`).catch(() => {});
      }
      return;
    }

    return sendMenu(ctx);
  });

  const webhookUrl = process.env.WEBHOOK_URL || process.env.SERVER_URL;
  if (webhookUrl) {
    const webhookPath = "/content-tg-webhook-" + CONTENT_BOT_TOKEN.split(":")[0];
    bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`)
      .then(() => bot.telegram.getMe())
      .then(me => console.log(`[content-bot] запущен (webhook): @${me.username}`))
      .catch(e => console.error("[content-bot] webhook setup error:", e.message));
    app.post(webhookPath, (req, res) => {
      bot.handleUpdate(req.body, res).catch((error: any) => {
        console.error("Content Telegram webhook update error:", error?.message || error);
        if (!res.headersSent) res.sendStatus(200);
      });
    });
  } else if (process.env.K_SERVICE) {
    console.warn("[content-bot] WEBHOOK_URL не задан в Cloud Run — polling отключён, чтобы не ловить Telegram 409");
  } else {
    bot.launch().catch((e: any) => {
      if (e.message?.includes('409')) {
        console.log('[content-bot] 409 Conflict — другой инстанс уже опрашивает Telegram, polling пропущен');
      } else {
        console.error('[content-bot] launch error:', e.message);
      }
    });
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
    console.log("[content-bot] запущен (polling)");
  }
}

startContentBot();

// ── Content Studio API ────────────────────────────────────────────────────────

app.post("/api/content-studio/prompt", async (req, res) => {
  try {
    const { text, mode } = req.body as { text: string; mode: 'image' | 'video' };
    if (!text || !mode) return res.status(400).json({ error: "text and mode required" });
    const prompt = await geminiWritePrompt(text, mode);
    res.json({ prompt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/content-studio/broadcast-copy", async (req, res) => {
  try {
    const { text } = req.body as { text: string };
    if (!text?.trim()) return res.status(400).json({ error: "text required" });
    const message = await geminiWriteBroadcastCopy(text.trim());
    res.json({ message });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/content-studio/image", async (req, res) => {
  try {
    const { prompt, imageBase64, imageMimeType, images, quality, aspectRatio } = req.body as {
      prompt: string;
      imageBase64?: string; imageMimeType?: string;
      images?: Array<{base64: string; mimeType: string}>;
      quality?: '1k' | '2k' | '4k';
      aspectRatio?: string;
    };
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const imgArray = images ?? (imageBase64 ? [{ base64: imageBase64, mimeType: imageMimeType || 'image/jpeg' }] : undefined);
    const imageSize = quality === '4k' ? '4K' : quality === '2k' ? '2K' : '1K';
    const buf = await geminiGenerateImage(prompt, imgArray, imageSize, aspectRatio || '1:1');
    res.set("Content-Type", "image/jpeg").send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/content-studio/video", async (req, res) => {
  try {
    const { prompt, imageBase64, imageMimeType, duration, aspectRatio, mode } = req.body as {
      prompt: string; imageBase64?: string; imageMimeType?: string;
      duration?: "5" | "10"; aspectRatio?: "16:9" | "9:16" | "1:1"; mode?: "fast" | "standard";
    };
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    if (!imageBase64) return res.status(400).json({ error: "image required" });
    const imageUrl = imageBase64 ? `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` : undefined;
    const videoUrl = await falGenerateVideo(prompt, imageUrl, duration || "5", aspectRatio || "16:9", mode || "standard");
    res.json({ videoUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
      },
      appType: "spa",
    });
    app.get("/product/*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html") || filePath.endsWith("push-sw.js")) {
          res.setHeader("Cache-Control", "no-store, max-age=0");
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("App Version: 1.3");
  });
}

startServer();
