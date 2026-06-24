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
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import fs from "fs";
import https from "https";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { createRequire } from "module";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { Telegraf, Markup } from "telegraf";
import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";

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

const TG_API_ID = Number(process.env.TG_API_ID || 2040);
const TG_API_HASH = process.env.TG_API_HASH || "b18441a1ff607e10a989891a5462e627";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const BROADCAST_MANAGER_BOT_URL = "https://t.me/YAASBAE_CLO_bot";
const BROADCAST_MANAGER_BUTTON_TEXT = "Узнать подробности в бот";
const DEFAULT_BROADCAST_DISPLAY_NAME = "YAASBAE Brand";

const pendingTgClients = new Map<string, { client: TelegramClient; phoneCodeHash: string }>();

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
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ type: ['text/*', 'application/jwt'], limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

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
  if (idx >= 0) accounts[idx] = entry;
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

async function getCdekSettings() {
  const snap = db ? await getDoc(doc(db, "settings", "cdek_api")).catch(() => null) : null;
  const saved = snap?.exists?.() ? snap.data() : {};
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
    const { q } = req.query;
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const response = await axios.get(`${settings.baseUrl}/location/cities`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { city: q, size: 20, country_codes: "RU" }
    });
    const sortedCities = response.data.sort((a: any, b: any) => {
      const searchLower = String(q).toLowerCase();
      const aName = a.city.toLowerCase();
      const bName = b.city.toLowerCase();
      if (aName === searchLower && bName !== searchLower) return -1;
      if (bName === searchLower && aName !== searchLower) return 1;
      const aIsMain = a.region === a.city;
      const bIsMain = b.region === b.city;
      if (aIsMain && !bIsMain) return -1;
      if (bIsMain && !aIsMain) return 1;
      return 0;
    }).slice(0, 10);
    res.json(sortedCities);
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
      params: { city_code: cityCode, type: "PVZ", size: 50 },
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

app.post("/api/cdek/create-order", async (req, res) => {
  try {
    const token = await getCdekToken();
    const settings = await getCdekSettings();
    const body = req.body || {};
    const orderId = String(body.orderId || "").trim();
    const recipientName = String(body.recipientName || "").trim();
    const recipientPhone = String(body.recipientPhone || "").trim();
    const tariffCode = Number(body.tariffCode || 136);
    const deliveryType = String(body.deliveryType || "pvz");
    const toCityCode = Number(body.toCityCode || 0);
    const deliveryPoint = String(body.deliveryPoint || "").trim();
    const toAddress = String(body.toAddress || "").trim();
    const itemName = String(body.itemName || "Заказ YBCRM").trim();
    const itemCost = Math.max(0, Math.round(Number(body.itemCost || 0) * 100) / 100);
    const codAmount = Math.max(0, Math.round(Number(body.codAmount || 0) * 100) / 100);
    const weight = Math.max(1, Number(body.weight || 700));
    const length = Math.max(1, Number(body.length || 30));
    const width = Math.max(1, Number(body.width || 20));
    const height = Math.max(1, Number(body.height || 10));
    const warehouseOriginTariffs = new Set([136, 137]);
    const doorOriginTariffs = new Set([138, 139]);

    if (!orderId) return res.status(400).json({ error: "Нужен номер заказа CRM для поля Номер ИМ в СДЭК" });
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

    const packageNumber = orderId;
    const payload: any = {
      type: 1,
      number: packageNumber,
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
          ware_key: String(body.wareKey || orderId),
          payment: { value: codAmount },
          cost: itemCost || codAmount || 1,
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
    const response = await axios.post(`${settings.baseUrl}/orders`, cdekPayload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const entity = response.data?.entity || response.data?.entities?.[0] || response.data;
    const cdekUuid = entity?.uuid || entity?.entity_uuid || response.data?.entity_uuid || null;
    let cdekNumber = entity?.cdek_number || entity?.cdekNumber || null;
    let cdekOrderDetails: any = null;
    if (!cdekNumber && cdekUuid) {
      try {
        const detailResponse = await axios.get(`${settings.baseUrl}/orders/${cdekUuid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        cdekOrderDetails = detailResponse.data;
        const detailEntity = detailResponse.data?.entity || detailResponse.data;
        cdekNumber = detailEntity?.cdek_number || detailEntity?.cdekNumber || detailEntity?.number || null;
      } catch (detailsError: any) {
        console.warn("[cdek] number lookup skipped:", detailsError?.response?.data || detailsError?.message || detailsError);
      }
    }
    const cdekFields = {
      cdekUuid,
      cdekNumber,
      cdekStatus: "created",
      cdekCreatedAt: new Date().toISOString(),
      cdekPayload: {
        tariffCode,
        deliveryType,
        toCityCode,
        deliveryPoint,
        toAddress,
        weight,
        length,
        width,
        height,
      },
    };

    if (db && orderId) {
      await updateDoc(doc(db, "orders_new", orderId), cdekFields).catch(() => {});
    }

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

    res.json({ success: true, cdekUuid, cdekNumber, data: response.data, details: cdekOrderDetails });
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
    const cdekStatus = entity?.statuses?.[0]?.code || entity?.status?.code || entity?.status || "created";
    const patch = stripUndefined({
      cdekUuid: uuid,
      cdekNumber,
      cdekStatus,
      cdekLastCheckedAt: new Date().toISOString(),
    });

    if (db && orderId) {
      await updateDoc(doc(db, "orders_new", orderId), patch).catch(() => {});
    }

    res.json({ success: true, cdekUuid: uuid, cdekNumber, cdekStatus, data: response.data });
  } catch (error: any) {
    const details = error.response?.data || error.message;
    console.error("[cdek] order lookup error:", JSON.stringify(details, null, 2));
    res.status(error.response?.status || 500).json({ error: "Не удалось получить заказ СДЭК", details });
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

app.post("/api/tg/auth/send-code", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Нужен номер телефона" });
  try {
    const client = new TelegramClient(new StringSession(""), TG_API_ID, TG_API_HASH, {
      connectionRetries: 3,
    });
    await client.connect();
    const result = await client.sendCode({ apiId: TG_API_ID, apiHash: TG_API_HASH }, phone);
    pendingTgClients.set(phone, { client, phoneCodeHash: result.phoneCodeHash });
    // Авто-отключение через 5 минут если авторизация не завершена
    setTimeout(() => {
      const p = pendingTgClients.get(phone);
      if (p) { p.client.disconnect().catch(() => {}); pendingTgClients.delete(phone); }
    }, 5 * 60 * 1000);
    res.json({ success: true });
  } catch (e: any) {
    console.error("TG send-code error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tg/auth/sign-in", async (req, res) => {
  const { phone, code, twoFaPassword } = req.body;
  const pending = pendingTgClients.get(phone);
  if (!pending) return res.status(400).json({ error: "Сессия не найдена, начните заново" });
  const { client, phoneCodeHash } = pending;
  try {
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
    } catch (e: any) {
      const needs2FA = e.errorMessage === "SESSION_PASSWORD_NEEDED" ||
        e.message?.includes("SESSION_PASSWORD_NEEDED") ||
        e.code === 401;
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
    await upsertTgAccount({ phone, sessionString, addedAt: new Date().toISOString(), active: true });
    pendingTgClients.delete(phone);
    res.json({ success: true, phone });
  } catch (e: any) {
    console.error("TG sign-in error:", e);
    res.status(400).json({ error: e.message });
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
    const pub = accounts.map((a: any) => ({ phone: a.phone, addedAt: a.addedAt, active: a.active !== false, proxy: a.proxy || null }));
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
          
          const info = [
            `ID: ${d.id}`,
            `Название: ${p.name}`,
            `Цена: ${p.sellingPrice} руб.`,
            p.composition ? `Состав: ${p.composition}` : null,
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

app.post("/api/bot/broadcast", async (req, res) => {
  const { message, userIds } = req.body;
  if (!message || !userIds?.length) return res.status(400).json({ error: "Нужны message и userIds" });
  if (!botInstance) return res.status(500).json({ error: "Бот не запущен" });
  let sent = 0, failed = 0;
  for (const uid of userIds) {
    try {
      await botInstance.telegram.sendMessage(uid, message);
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch { failed++; }
  }
  res.json({ success: true, sent, failed });
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
  if (!db || !fbStorage) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    // Upload generated image to Firebase Storage
    const imgBuf = Buffer.from(generatedBase64, "base64");
    const sRef = storageRef(fbStorage, `content/${Date.now()}_generated.jpg`);
    await fbUploadBytes(sRef, imgBuf, { contentType: "image/jpeg" });
    const generatedUrl = await fbGetDownloadURL(sRef);

    const docRef = await addDoc(collection(db, "content_queue"), {
      status: "queue",
      generatedUrl,
      modelUrl: modelUrl || "",
      lookUrl: lookUrl || "",
      caption,
      createdAt: new Date().toISOString(),
    });
    res.json({ id: docRef.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get queue
app.get("/api/content/queue", async (_req, res) => {
  if (!db) return res.json([]);
  try {
    const snap = await getDocs(query(collection(db, "content_queue"), orderBy("createdAt", "desc")));
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Update caption
app.patch("/api/content/queue/:id", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    await updateDoc(doc(db, "content_queue", req.params.id), { caption: req.body.caption });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Delete from queue
app.delete("/api/content/queue/:id", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    await deleteDoc(doc(db, "content_queue", req.params.id));
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Publish to Instagram
app.post("/api/content/publish/:id", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Firebase не инициализирован" });
  try {
    const snap = await getDoc(doc(db, "content_queue", req.params.id));
    if (!snap.exists()) return res.status(404).json({ error: "Не найдено" });
    const item = snap.data() as any;

    // Get Instagram settings
    const cfgSnap = await getDoc(doc(db, "settings", "instagram"));
    const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
    const accessToken = cfg.accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
    const igUserId = cfg.userId || process.env.INSTAGRAM_USER_ID;
    if (!accessToken || !igUserId) return res.status(400).json({ error: "Instagram не настроен. Добавь Access Token и User ID в настройках." });

    // Step 1: Create media container
    const createResp = await axios.post(
      `https://graph.instagram.com/v21.0/${igUserId}/media`,
      { image_url: item.generatedUrl, caption: item.caption, access_token: accessToken }
    );
    const creationId = createResp.data.id;

    // Step 2: Publish
    const publishResp = await axios.post(
      `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
      { creation_id: creationId, access_token: accessToken }
    );
    const instagramPostId = publishResp.data.id;

    await updateDoc(doc(db, "content_queue", req.params.id), {
      status: "published",
      instagramPostId,
      publishedAt: new Date().toISOString(),
    });
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

// ─── Точка Банк API ─────────────────────────────────────────────────────────

const TOCHKA_API = 'https://enter.tochka.com/uapi';
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

function buildTochkaCacheId(...parts: string[]) {
  return Buffer.from(parts.map(part => String(part || '')).join('|'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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
      if (paymentUrl) return { data: response.data, paymentUrl };
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
    || operation?.sum
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
  return normalizeTochkaAmount(
    balance?.Amount?.amount
    ?? balance?.amount?.amount
    ?? balance?.amount
    ?? balance?.Amount
    ?? balance?.balance
    ?? balance?.Balance
    ?? balance?.value
    ?? 0
  );
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
  const paid = Number(order?.paidAmount ?? order?.paymentAmount ?? 0) || 0;
  const prepayment = Number(order?.prepaymentAmount ?? order?.prepaidAmount ?? 0) || 0;
  const finalPayment = Number(order?.finalPaymentAmount ?? order?.dopaymentAmount ?? 0) || 0;
  return paid || (prepayment + finalPayment);
}

function getTochkaText(...values: any[]) {
  return values
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean)
    .join(' · ');
}

function classifyExpenseCategory(text: string) {
  const raw = String(text || '').toLowerCase();
  const checks: Array<[string, string[]]> = [
    ['Продукты', ['пятероч', 'магнит', 'перекресток', 'вкусвилл', 'самокат', 'лавка', 'ozon fresh', 'продукт', 'food']],
    ['Топливо', ['азс', 'лукойл', 'газпром', 'роснефть', 'топлив', 'fuel', 'benz', 'gpn']],
    ['Маркетинг', ['instagram', 'vk ', 'яндекс директ', 'direct', 'реклама', 'target', 'meta', 'google ads', 'авито']],
    ['Аренда', ['аренд', 'rent']],
    ['ФОТ', ['зарплат', 'аванс', 'сотрудник', 'salary', 'самозанят']],
    ['Логистика', ['сдэк', 'cdek', 'почта', 'boxberry', 'достав', 'курьер']],
    ['Материалы', ['ткан', 'фурнитур', 'типограф', 'печать', 'материал']],
    ['Налоги', ['налог', 'фнс', 'пенсион', 'страхов']],
    ['Комиссии банка', ['комисс', 'обслуживание счета', 'банк']],
    ['Переводы', ['перевод', 'sbp', 'сбп']],
  ];
  return checks.find(([, keywords]) => keywords.some(keyword => raw.includes(keyword)))?.[0] || 'Другое';
}

function detectCardMask(text: string) {
  const raw = String(text || '');
  const known = TOCHKA_KNOWN_CARDS.find(card => raw.includes(card.mask));
  if (known) return known.mask;
  const match = raw.match(/(?:\*|x{2,}|•{2,}|карта\s*)?(\d{4})(?!\d)/i);
  return match?.[1] || '';
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
    ?? operation?.amount?.amount
    ?? operation?.amount
    ?? operation?.sum
    ?? operation?.transactionAmount
    ?? operation?.operationAmount
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
    ? -Math.abs(amount)
    : indicator.includes('credit') || indicator.includes('in')
      ? Math.abs(amount)
      : Number(operation?.amount) < 0
        ? -Math.abs(amount)
        : amount;
  const description = getTochkaText(
    operation?.description,
    operation?.purpose,
    operation?.paymentPurpose,
    operation?.remittanceInformation,
    operation?.merchantName,
    operation?.counterpartyName,
    operation?.Counterparty?.name,
    operation?.Data?.purpose
  ) || 'Операция Точки';
  const dateRaw = operation?.dateTime || operation?.bookingDateTime || operation?.operationDate || operation?.date || operation?.createdAt;
  const date = dateRaw ? new Date(dateRaw) : new Date();
  const accountId = String(operation?.accountId || operation?.AccountId || fallbackAccountId || '');
  const cardMask = detectCardMask(json);
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
    category: isExpense ? classifyExpenseCategory(description) : 'Доходы',
    description,
    counterparty: getTochkaText(operation?.counterpartyName, operation?.Counterparty?.name, operation?.merchantName),
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
  const normalizeRows = (raw: any) => normalizeTochkaList(raw)
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
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(id)}`,
    ]),
  ])).slice(0, 10);
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
    if (status) errors.push({ source, status: 200, message: `Выписка в статусе ${status}, операции появятся в Ready` });
    return { rows: [], source: '' };
  };

  const cachedStatement = await readTochkaStatementCache(customerCode, accountId, dateFrom, dateTo);
  const cachedStatementId = String(cachedStatement?.statementId || '');
  if (cachedStatementId) {
    const cachedUrls = [
      `${TOCHKA_API}/open-banking/v1.0/accounts/${encodedAccount}/statements/${encodeURIComponent(cachedStatementId)}`,
      `${TOCHKA_API}/open-banking/v1.0/statements/${encodeURIComponent(cachedStatementId)}`,
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

  const statementBodies = [
    { Data: { Statement: { accountId, customerCode, dateFrom, dateTo } } },
    { Data: { Statement: { accountId, customerCode, from: dateFrom, to: dateTo } } },
    { Data: { Statement: { accountId, customerCode, startDate: dateFrom, endDate: dateTo } } },
    { Data: { customerCode, accountId, dateFrom, dateTo } },
    { Data: { customerCode, accountId, from: dateFrom, to: dateTo } },
    { Data: { customerCode, accountId, startDate: dateFrom, endDate: dateTo } },
    { Data: { customerCode, accountId, statementPeriod: { from: dateFrom, to: dateTo } } },
    { Data: { customerCode, accountId, period: { dateFrom, dateTo } } },
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
  const normalizeCardRows = (raw: any, card: { id: string; mask: string; label: string }) => normalizeTochkaList(raw)
    .map((item: any) => {
      const row = normalizeTochkaOperation(item, `card:${card.mask}`);
      return {
        ...row,
        sourceType: 'card',
        sourceLabel: card.label,
        cardMask: row.cardMask || card.mask,
        accountId: row.accountId?.startsWith('card:') ? row.accountId : (row.accountId || `card:${card.mask}`),
        maskedAccountId: `*${row.cardMask || card.mask}`,
      };
    })
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

async function loadOrdersForFinanceMonth(monthKey: string) {
  const docs: any[] = [];
  if (adminDb) {
    const snap = await adminDb.collection('orders_new').get();
    snap.forEach((docSnap: any) => docs.push({ id: docSnap.id, ...docSnap.data() }));
  } else if (db) {
    const snap = await getDocs(collection(db, 'orders_new'));
    snap.docs.forEach((docSnap: any) => docs.push({ id: docSnap.id, ...docSnap.data() }));
  }

  return docs.filter((order: any) => {
    const rawDate = order?.date || order?.orderDate || order?.createdAt;
    const date = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate || Date.now());
    if (Number.isNaN(date.getTime())) return false;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return key === monthKey;
  });
}

function isTochkaPaidStatus(status: any) {
  const normalized = String(status || '').toLowerCase();
  return ['paid', 'approved', 'completed', 'succeeded', 'success', 'done'].some(item => normalized.includes(item));
}

function getTochkaPaymentTarget(orderId: any, kind?: any) {
  const paymentLinkId = String(orderId || '').trim();
  const explicitFinal = String(kind || '').toLowerCase() === 'final';
  const suffixFinal = paymentLinkId.toLowerCase().endsWith('-final');
  const isFinal = explicitFinal || suffixFinal;
  const cleanOrderId = suffixFinal ? paymentLinkId.slice(0, -6) : paymentLinkId;
  return { paymentLinkId, cleanOrderId, isFinal };
}

function buildTochkaPaymentFields(target: { isFinal: boolean }, paymentId: string, paymentStatus: string, paymentAmount: number, operation?: any) {
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

// Создать ссылку/QR на оплату
app.post('/api/tochka/create-payment', async (req, res) => {
  const { orderId, amount, description } = req.body;
  const paymentAmount = Number(amount);
  if (!orderId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) return res.status(400).json({ error: 'Нужны orderId и amount больше 0' });
  if (!db) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const snap = await getDoc(doc(db, 'settings', 'tochka_api'));
    const tochkaSettings = snap?.data() || {};
    let customerCode = tochkaSettings.customerCode;
    const merchantId = tochkaSettings.merchantId;
    let accountId = tochkaSettings.accountId;
    const configuredLegalId = String(tochkaSettings.legalId || '').trim();
    const paymentMode = Array.isArray(tochkaSettings.paymentMode) && tochkaSettings.paymentMode.length
      ? tochkaSettings.paymentMode
      : ['sbp'];
    const webhookUrl = process.env.SERVER_URL ? `${process.env.SERVER_URL}/api/tochka/webhook` : null;
    console.log(`[tochka] create-payment start order=${orderId} amount=${paymentAmount}`);
    await addDoc(collection(db, 'tochka_logs'), {
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
      await addDoc(collection(db, 'tochka_logs'), {
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
          }
        : {
            paymentUrl,
            paymentId,
            paymentStatus: 'pending',
            paymentCreatedAt: createdAt,
            paymentAmount,
          };
      await updateDoc(doc(db, 'orders_new', target.cleanOrderId), paymentFields).catch(() => {});
    }
    console.log(`[tochka] create-payment success order=${orderId} paymentId=${paymentId || 'n/a'}`);
    await addDoc(collection(db, 'tochka_logs'), {
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
    await addDoc(collection(db, 'tochka_logs'), {
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
  const orderId = String(req.query.orderId || '').trim();
  const target = getTochkaPaymentTarget(orderId, req.query.kind);
  const amount = req.query.amount ? Number(req.query.amount) : undefined;
  if (!orderId) return res.status(400).json({ error: 'Нужен orderId' });
  if (!db) return res.status(503).json({ error: 'DB не подключена' });

  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const snap = await getDoc(doc(db, 'settings', 'tochka_api'));
    const customerCode = snap?.data()?.customerCode;
    if (!customerCode) return res.status(400).json({ error: 'customerCode Точки не настроен' });

    const operation = await findTochkaOperation(token, customerCode, target.paymentLinkId, amount)
      || (target.isFinal ? await findTochkaOperation(token, customerCode, target.cleanOrderId, amount) : null);
    const operationId = getTochkaOperationId(operation);
    if (!operation || !operationId) {
      return res.status(404).json({ error: `Оплата по заказу ${orderId} в Точке не найдена` });
    }

    const paymentAmount = normalizeTochkaAmount(getTochkaOperationAmount(operation)) || amount || 0;
    const paymentStatus = getTochkaOperationStatus(operation) || 'found';
    const paymentFields = buildTochkaPaymentFields(target, operationId, paymentStatus, paymentAmount, operation);

    await updateDoc(doc(db, 'orders_new', target.cleanOrderId), paymentFields).catch(() => {});
    await addDoc(collection(db, 'tochka_logs'), {
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
    res.status(e.response?.status || 500).json({ error: e.message, details: errData });
  }
});

// Возврат оплаты через Точку по operationId. Для этого метода в документации
// Точки нет отдельного шага отправки SMS-кода: доступ контролируется токеном.
app.post('/api/tochka/refund-payment', async (req, res) => {
  const { orderId, operationId, amount, reason } = req.body || {};
  const refundAmount = Number(amount);
  const cleanOrderId = String(orderId || '').trim();
  let cleanOperationId = String(operationId || '').trim();

  if (!cleanOrderId) return res.status(400).json({ error: 'Нужен orderId' });
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) return res.status(400).json({ error: 'Нужна сумма возврата больше 0' });
  if (!db) return res.status(503).json({ error: 'DB не подключена' });

  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const snap = await getDoc(doc(db, 'settings', 'tochka_api'));
    const customerCode = snap?.data()?.customerCode;
    if (!cleanOperationId) {
      cleanOperationId = await findTochkaOperationId(token, customerCode, cleanOrderId, refundAmount);
    }
    if (!cleanOperationId) {
      return res.status(400).json({ error: 'Не нашёл operationId платежа в Точке. У старого заказа нужно вручную привязать paymentId.' });
    }

    console.log(`[tochka] refund start order=${cleanOrderId} operation=${cleanOperationId} amount=${refundAmount}`);
    await addDoc(collection(db, 'tochka_logs'), {
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      amount: refundAmount,
      status: 'refund_request',
      reason: reason || '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    const response = await axios.post(
      `${TOCHKA_API}/acquiring/v1.0/payments/${encodeURIComponent(cleanOperationId)}/refund`,
      {
        Data: {
          amount: Math.round(refundAmount * 100) / 100,
          reason: reason || `Возврат заказа ${cleanOrderId}`,
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

    const refundData = response.data || {};
    const refundId = refundData.operationId
      || refundData.refundOperationId
      || refundData.data?.operationId
      || refundData.Data?.operationId
      || refundData.Data?.refundOperationId
      || null;
    const refundStatus = refundData.status || refundData.data?.status || refundData.Data?.status || 'refund_requested';
    const refundFields = {
      status: 'Возврат',
      refundAmount,
      refundStatus,
      refundId,
      refundPaymentId: cleanOperationId,
      refundReason: reason || '',
      refundedAt: new Date().toISOString(),
      refundResponse: JSON.stringify(refundData).slice(0, 2000),
    };

    await updateDoc(doc(db, 'orders_new', cleanOrderId), refundFields).catch(() => {});
    await addDoc(collection(db, 'tochka_logs'), {
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      refundId,
      amount: refundAmount,
      status: 'refund_success',
      response: JSON.stringify(refundData).slice(0, 1000),
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    res.json({ success: true, refundId, refundStatus, data: refundData });
  } catch (e: any) {
    const errData = e.response?.data;
    console.error('[tochka] refund error:', errData || e.message);
    await addDoc(collection(db, 'tochka_logs'), {
      orderId: cleanOrderId,
      paymentId: cleanOperationId,
      amount: refundAmount,
      status: 'refund_error',
      error: e.message,
      details: errData ? JSON.stringify(errData).slice(0, 1000) : '',
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    res.status(e.response?.status || 500).json({ error: e.message, details: errData });
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
    if (db && (body.operationId || body.paymentLinkId)) {
      const status = ['Paid', 'paid', 'APPROVED'].includes(body.status) ? 'paid' : body.status;
      if (body.paymentLinkId) {
        const target = getTochkaPaymentTarget(body.paymentLinkId);
        const patch = buildTochkaPaymentFields(target, body.operationId || '', status, normalizeTochkaAmount(body.amount));
        await updateDoc(doc(db, 'orders_new', target.cleanOrderId), patch).catch(() => {});
      }
      if (body.operationId) {
        const ordersSnap = await getDocs(query(collection(db, 'orders_new'), where('paymentId', '==', body.operationId)));
        for (const d of ordersSnap.docs) {
          const patch = buildTochkaPaymentFields({ isFinal: false }, body.operationId, status, normalizeTochkaAmount(body.amount));
          await updateDoc(d.ref, patch);
        }
        const legacyOrdersSnap = ordersSnap.empty
          ? await getDocs(query(collection(db, 'orders'), where('paymentId', '==', body.operationId))).catch(() => null)
          : null;
        if (legacyOrdersSnap) {
          for (const d of legacyOrdersSnap.docs) {
            const patch = buildTochkaPaymentFields({ isFinal: false }, body.operationId, status, normalizeTochkaAmount(body.amount));
            await updateDoc(doc(db, 'orders_new', d.id), patch).catch(() => {});
          }
        }

        const finalSnap = await getDocs(query(collection(db, 'orders_new'), where('finalPaymentId', '==', body.operationId)));
        for (const d of finalSnap.docs) {
          const patch = buildTochkaPaymentFields({ isFinal: true }, body.operationId, status, normalizeTochkaAmount(body.amount));
          await updateDoc(d.ref, patch);
        }
        const legacyFinalSnap = finalSnap.empty
          ? await getDocs(query(collection(db, 'orders'), where('finalPaymentId', '==', body.operationId))).catch(() => null)
          : null;
        if (legacyFinalSnap) {
          for (const d of legacyFinalSnap.docs) {
            const patch = buildTochkaPaymentFields({ isFinal: true }, body.operationId, status, normalizeTochkaAmount(body.amount));
            await updateDoc(doc(db, 'orders_new', d.id), patch).catch(() => {});
          }
        }
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
      return {
        accountId,
        maskedAccountId: maskAccountId(accountId),
        customerCode: account?.customerCode || account?.CustomerCode || '',
        status: account?.status || account?.Status || '',
        currency: account?.currency || account?.Currency || 'RUB',
        balances,
      };
    });

    const totalBalance = accounts.reduce((sum: number, account: any) => sum + (Number(account.balances.closingAvailable) || 0), 0);
    const totalExpected = accounts.reduce((sum: number, account: any) => sum + (Number(account.balances.expected) || 0), 0);

    const now = new Date();
    const monthKey = String(req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    const [yearPart, monthPart] = monthKey.split('-').map(Number);
    const monthStart = new Date(yearPart || now.getFullYear(), (monthPart || now.getMonth() + 1) - 1, 1);
    const monthEnd = new Date(yearPart || now.getFullYear(), monthPart || now.getMonth() + 1, 0);
    const dateFrom = monthStart.toISOString().slice(0, 10);
    const dateTo = monthEnd.toISOString().slice(0, 10);
    const monthOrders = await loadOrdersForFinanceMonth(monthKey).catch(() => []);
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
      fetchTochkaOperations(token, account.customerCode || effectiveCustomerCode, account.accountId, dateFrom, dateTo)
        .then(result => ({ account, result }))
        .catch(error => ({ account, result: { ok: false, source: '', operations: [], errors: [{ message: getTochkaErrorMessage(error) }] } }))
    ));
    const cardOperationFetch = await fetchTochkaCardOperations(token, effectiveCustomerCode, dateFrom, dateTo)
      .catch(error => ({ ok: false, source: '', operations: [], errors: [{ message: getTochkaErrorMessage(error) }] }));
    const operationMap = new Map<string, any>();
    for (const operation of [
      ...operationFetches.flatMap(item => item.result.operations || []),
      ...(cardOperationFetch.operations || []),
    ]) {
      operationMap.set(String(operation.id || `${operation.date}-${operation.accountId}-${operation.amount}-${operation.description}`), operation);
    }
    const operations = Array.from(operationMap.values())
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const expenses = operations.filter((operation: any) => operation.direction === 'expense');
    const incomes = operations.filter((operation: any) => operation.direction === 'income');
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
      generatedAt: new Date().toISOString(),
      totalBalance,
      totalExpected,
      accounts,
      incomingSources: Object.values(sourceMap),
      actualIncome: incomes.reduce((sum: number, operation: any) => sum + operation.absAmount, 0),
      actualExpenses: expenses.reduce((sum: number, operation: any) => sum + operation.absAmount, 0),
      accountExpenses: Array.from(accountExpenseMap.values()),
      cards: Array.from(cardExpenseMap.values()),
      expenseCategories: Array.from(expenseCategoryMap.values()).sort((a, b) => b.amount - a.amount),
      operations: operations.slice(0, 100),
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
    await ctx.reply(welcome, { parse_mode: "Markdown", ...getMainMenu() });
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
    app.post(webhookPath, (req, res) => bot.handleUpdate(req.body, res));
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
    app.post(webhookPath, (req, res) => bot.handleUpdate(req.body, res));
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
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("App Version: 1.3");
  });
}

startServer();
