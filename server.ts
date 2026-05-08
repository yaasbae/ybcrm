import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { initializeApp } from "firebase/app";
import { initializeFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where, orderBy } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes as fbUploadBytes, getDownloadURL as fbGetDownloadURL } from "firebase/storage";
import fs from "fs";
import https from "https";
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

const pendingTgClients = new Map<string, { client: TelegramClient; phoneCodeHash: string }>();

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let db: any = null;
let fbStorage: any = null;

try {
  let firebaseConfig: any = null;
  if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  } else if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
  if (firebaseConfig) {
    const firebaseApp = initializeApp(firebaseConfig);
    db = initializeFirestore(firebaseApp, { experimentalForceLongPolling: true }, firebaseConfig.firestoreDatabaseId);
    fbStorage = getStorage(firebaseApp);
    console.log("Firebase initialized on server");
  } else {
    console.warn("Firebase config not found");
  }
} catch (e: any) {
  console.error("Firebase init error:", e.message);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get("/api/ping", (req, res) => {
  res.send("ybcrm-system 2.0 - Claude AI + ManyChat v8");
});

const IS_TEST = process.env.CDEK_IS_TEST === "true";
const CDEK_BASE_URL = IS_TEST ? "https://api.edu.cdek.ru/v2" : "https://api.cdek.ru/v2";
let cdekToken: string | null = null;
let tokenExpiry: number = 0;

async function getCdekToken() {
  if (cdekToken && Date.now() < tokenExpiry) return cdekToken;
  const clientId = process.env.CDEK_CLIENT_ID;
  const clientSecret = process.env.CDEK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("CDEK credentials not configured");
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  const response = await axios.post(`${CDEK_BASE_URL}/oauth/token`, params);
  cdekToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cdekToken;
}

app.get("/api/cdek/cities", async (req, res) => {
  try {
    const { q } = req.query;
    const token = await getCdekToken();
    const response = await axios.get(`${CDEK_BASE_URL}/location/cities`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { cityName: q, size: 20, country_codes: "RU" }
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
    res.status(error.response?.status || 500).json({ error: "Ошибка поиска СДЭК", message: error.message });
  }
});

app.post("/api/cdek/calculate", async (req, res) => {
  try {
    const { from_city_code, to_city_code, packages } = req.body;
    const token = await getCdekToken();
    const response = await axios.post(`${CDEK_BASE_URL}/calculator/tarifflist`, {
      from_location: { code: from_city_code || (process.env.CDEK_SENDER_CITY_CODE ? Number(process.env.CDEK_SENDER_CITY_CODE) : 44) },
      to_location: { code: to_city_code },
      packages: packages || [{ weight: 700, length: 30, width: 20, height: 10 }]
    }, { headers: { Authorization: `Bearer ${token}` } });
    res.json(response.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
    if (db) {
      const accountsSnap = await getDoc(doc(db, "settings", "tg_accounts"));
      const accounts = accountsSnap.exists() ? accountsSnap.data().accounts || [] : [];
      const idx = accounts.findIndex((a: any) => a.phone === phone);
      const entry = { phone, sessionString, addedAt: new Date().toISOString(), active: true };
      if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
      await setDoc(doc(db, "settings", "tg_accounts"), { accounts });
    }
    pendingTgClients.delete(phone);
    res.json({ success: true, phone });
  } catch (e: any) {
    console.error("TG sign-in error:", e);
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/tg/auth/status", async (req, res) => {
  try {
    if (!db) return res.json({ authorized: false, accounts: [] });
    const snap = await getDoc(doc(db, "settings", "tg_accounts"));
    const accounts = snap.exists() ? (snap.data().accounts || []).filter((a: any) => a.sessionString) : [];
    // Fallback: old single session
    if (accounts.length === 0) {
      const old = await getDoc(doc(db, "settings", "tg_session"));
      if (old.exists() && old.data().sessionString) {
        accounts.push({ phone: old.data().phone, addedAt: old.data().savedAt, active: true });
      }
    }
    const pub = accounts.map((a: any) => ({ phone: a.phone, addedAt: a.addedAt, active: a.active !== false }));
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
    if (db) {
      const snap = await getDoc(doc(db, "settings", "tg_accounts"));
      const accounts = snap.exists() ? snap.data().accounts || [] : [];
      const idx = accounts.findIndex((a: any) => a.phone === phone);
      const entry = { phone, sessionString: sessionString.trim(), addedAt: new Date().toISOString(), active: true };
      if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
      await setDoc(doc(db, "settings", "tg_accounts"), { accounts });
    }
    res.json({ success: true, phone });
  } catch (e: any) {
    console.error("add-session error:", e);
    res.status(400).json({ error: "Сессия недействительна: " + e.message });
  }
});

app.post("/api/tg/accounts/bulk-add-sessions", async (req, res) => {
  const { sessions } = req.body; // string[]
  if (!sessions?.length) return res.status(400).json({ error: "Нужен массив sessions" });
  if (!db) return res.status(500).json({ error: "БД не подключена" });
  const snap = await getDoc(doc(db, "settings", "tg_accounts"));
  const existing: any[] = snap.exists() ? snap.data().accounts || [] : [];
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
  await setDoc(doc(db, "settings", "tg_accounts"), { accounts: existing });
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

    if (db) {
      const snap = await getDoc(doc(db, "settings", "tg_accounts"));
      const accounts = snap.exists() ? snap.data().accounts || [] : [];
      const idx = accounts.findIndex((a: any) => a.phone === phone);
      const entry = { phone, sessionString, addedAt: new Date().toISOString(), active: true };
      if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
      await setDoc(doc(db, "settings", "tg_accounts"), { accounts });
    }
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
    if (!db) return res.status(500).json({ error: "DB not connected" });
    const snap = await getDoc(doc(db, "settings", "tg_accounts"));
    const accounts = snap.exists() ? snap.data().accounts || [] : [];
    await setDoc(doc(db, "settings", "tg_accounts"), { accounts: accounts.filter((a: any) => a.phone !== phone) });
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
    const snap = await getDoc(doc(db, "settings", "tg_accounts"));
    const accounts = snap.exists() ? (snap.data().accounts || []).filter((a: any) => a.sessionString && a.active !== false) : [];
    if (accounts.length === 0) return res.status(400).json({ error: "Нет активных аккаунтов" });
    const { CustomFile } = await import("telegram/client/uploads");
    const buf = Buffer.from(photoBase64, "base64");
    let ok = 0, failed = 0;
    for (const acc of accounts) {
      try {
        const c = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3 });
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
  try {
    let accounts: any[] = [];
    const snap = await getDoc(doc(db, 'settings', 'tg_accounts'));
    if (snap.exists()) accounts = (snap.data().accounts || []).filter((a: any) => a.sessionString && a.active !== false);
    if (!accounts.length) throw new Error('Нет активных аккаунтов');

    const client = new TelegramClient(new StringSession(accounts[0].sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3 });
    await client.connect();

    const noTgSnap = await getDoc(doc(db, 'settings', 'no_telegram')).catch(() => null);
    const existingNoTg: Array<{ phone: string; addedAt: string }> = noTgSnap?.exists() ? (noTgSnap.data().phones || []) : [];
    const existingSet = new Set(existingNoTg.map((p: any) => p.phone));
    const newNoTg: Array<{ phone: string; addedAt: string }> = [];
    const now = new Date().toISOString();

    for (let i = 0; i < phones.length; i++) {
      const rawPhone = phones[i];
      const phone = String(rawPhone).startsWith('+') ? String(rawPhone) : `+${rawPhone}`;
      const cleanPhone = String(rawPhone).replace(/\D/g, '');
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

  const geminiKey: string | null = process.env.GEMINI_API_KEY || null;
  let claudeKey: string | null = process.env.ANTHROPIC_API_KEY || null;
  if (db) {
    const cfg = await getDoc(doc(db, 'settings', 'ai_config')).catch(() => null);
    if (cfg?.exists() && cfg.data().claudeKey) claudeKey = cfg.data().claudeKey;
  }

  const parseVariants = (text: string) =>
    text.split('\n')
      .filter(l => /^\d+[.)]\s/.test(l.trim()))
      .map(l => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 9);

  try {
    if (geminiKey) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const variants = parseVariants(text);
      return res.json({ success: true, variants, engine: 'gemini' });
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
      return res.json({ success: true, variants, engine: 'claude' });
    }
    throw new Error('Нет API ключа — добавь Gemini или Claude ключ в Настройках рассылки');
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Умная фоновая рассылка: 30 мин между сообщениями, auto-resume, ожидание новых аккаунтов
type StealthJobStatus = 'idle'|'running'|'waiting_accounts'|'done'|'error';
let stealthJob: { status: StealthJobStatus; total: number; sent: number; failed: number; checked: number; currentIndex: number; startedAt: string; finishedAt?: string; error?: string; log: Array<{phone:string;name:string;status:string;error?:string}> } = {
  status: 'idle', total: 0, sent: 0, failed: 0, checked: 0, currentIndex: 0, startedAt: '', log: []
};

const saveStealthProgress = async () => {
  if (!db) return;
  await setDoc(doc(db, 'settings', 'stealth_job'), { ...stealthJob, log: stealthJob.log.slice(-200) }).catch(() => {});
};

async function runStealthBroadcast(phones: string[], messageVariants: string[], contactButton: boolean, imageFiles: Array<{base64:string;name:string}>, startFrom = 0) {
  if (!db) return;
  const isResume = startFrom > 0;
  if (!isResume) {
    stealthJob = { status: 'running', total: phones.length, sent: 0, failed: 0, checked: startFrom, currentIndex: startFrom, startedAt: new Date().toISOString(), log: [] };
    // Сохраняем телефоны и варианты для возможности resume
    await setDoc(doc(db, 'settings', 'stealth_job_data'), { phones, messageVariants, contactButton, imageFiles: imageFiles.map(f => ({ base64: f.base64.slice(0, 100), name: f.name })) }).catch(() => {});
  } else {
    stealthJob.status = 'running';
    stealthJob.currentIndex = startFrom;
  }
  await saveStealthProgress();

  const DELAY_MS = 30 * 60 * 1000;

  // Загрузка и подключение аккаунтов
  const loadClients = async () => {
    const snap = await getDoc(doc(db!, 'settings', 'tg_accounts'));
    const accs = snap.exists() ? (snap.data().accounts || []).filter((a: any) => a.sessionString && a.active !== false) : [];
    const cls: TelegramClient[] = [];
    for (const acc of accs) {
      const c = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3 });
      await c.connect().catch(() => {});
      if (acc.displayName) {
        const parts = acc.displayName.trim().split(' ');
        await c.invoke(new Api.account.UpdateProfile({ firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' })).catch(() => {});
      }
      cls.push(c);
    }
    return { accs, cls };
  };

  let { accs: accounts, cls: clients } = await loadClients();
  if (!clients.length) {
    stealthJob.status = 'waiting_accounts';
    await saveStealthProgress();
    return;
  }

  const deadIdxs = new Set<number>();
  const accountLastSent = new Map<number, number>();

  // Загружаем no_telegram для накопления
  const noTgSnap = await getDoc(doc(db, 'settings', 'no_telegram')).catch(() => null);
  const savedNoTg: Array<{phone:string;addedAt:string}> = noTgSnap?.exists() ? (noTgSnap.data().phones || []) : [];
  const noTgSet = new Set(savedNoTg.map((p:any) => p.phone));
  const newNoTg: Array<{phone:string;addedAt:string}> = [];

  for (let i = startFrom; i < phones.length; i++) {
    stealthJob.currentIndex = i;

    // Все живые аккаунты
    const liveIdxs = clients.map((_, j) => j).filter(j => !deadIdxs.has(j));

    if (liveIdxs.length === 0) {
      // Все аккаунты забанены — сохраняем и ждём новых
      stealthJob.status = 'waiting_accounts';
      stealthJob.currentIndex = i;
      await saveStealthProgress();
      if (newNoTg.length > 0) await setDoc(doc(db, 'settings', 'no_telegram'), { phones: [...savedNoTg, ...newNoTg] }).catch(() => {});
      for (const c of clients) await c.disconnect().catch(() => {});
      return;
    }

    // Найти аккаунт готовый к отправке
    let readyIdx = -1;
    let minWait = Infinity;
    for (const j of liveIdxs) {
      const waitMs = (accountLastSent.get(j) || 0) + DELAY_MS - Date.now();
      if (waitMs <= 0) { readyIdx = j; break; }
      if (waitMs < minWait) minWait = waitMs;
    }
    if (readyIdx === -1) {
      await new Promise(r => setTimeout(r, Math.min(minWait + 1000, 60000)));
      i--;
      continue;
    }

    const rawPhone = String(phones[i]);
    const phone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
    const client = clients[readyIdx];
    const variant = messageVariants[Math.floor(Math.random() * messageVariants.length)];
    const textMsg = contactButton ? `${variant}\n\nhttps://t.me/yaasbae_ru` : variant;

    try {
      // Resolve entity
      let resolveErr = '';
      const resolved = await client.invoke(new Api.contacts.ResolvePhone({ phone })).catch((e:any) => { resolveErr = e?.message||String(e); return null; }) as any;
      let entity = resolved?.users?.[0] ?? null;

      if (!entity && !resolveErr.includes('FROZEN')) {
        const imported = await client.invoke(new Api.contacts.ImportContacts({
          contacts: [new Api.InputPhoneContact({ clientId: BigInt(i+1) as any, phone, firstName: 'U', lastName: '' })]
        })).catch(() => null) as any;
        entity = imported?.users?.[0] ?? null;
        const uid = imported?.importedContacts?.[0]?.userId;
        if (!entity && uid && Number(uid) > 0) entity = await client.getEntity(uid).catch(() => null);
      }

      // Аккаунт мёртв
      if (resolveErr.includes('AUTH_KEY_UNREGISTERED') || resolveErr.includes('USER_DEACTIVATED') || resolveErr.includes('SESSION_REVOKED')) {
        console.log(`[stealth] account ${accounts[readyIdx]?.phone} dead, removing`);
        deadIdxs.add(readyIdx);
        await client.disconnect().catch(() => {});
        // Помечаем в Firestore
        const aSnap = await getDoc(doc(db, 'settings', 'tg_accounts')).catch(() => null);
        if (aSnap?.exists()) {
          const allAccs = aSnap.data().accounts || [];
          const bannedPhone = accounts[readyIdx]?.phone;
          await setDoc(doc(db, 'settings', 'tg_accounts'), { accounts: allAccs.map((a:any) => a.phone === bannedPhone ? {...a, active: false, bannedAt: new Date().toISOString()} : a) }).catch(() => {});
        }
        i--; // повторить этот номер с другим аккаунтом
        continue;
      }

      if (!entity) {
        // Нет Telegram — сохраняем
        const cleanPhone = rawPhone.replace(/\D/g, '');
        if (!noTgSet.has(cleanPhone)) {
          noTgSet.add(cleanPhone);
          newNoTg.push({ phone: cleanPhone, addedAt: new Date().toISOString() });
        }
        stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'no_tg', error: 'Нет Telegram' });
        stealthJob.failed++;
      } else {
        // Отправляем
        if (imageFiles.length > 0) {
          const { CustomFile } = await import('telegram/client/uploads');
          const fileObjs = await Promise.all(imageFiles.map(async f => {
            const raw = Buffer.from(f.base64, 'base64');
            const jpg = await sharp(raw).jpeg({ quality: 90 }).toBuffer().catch(() => raw);
            return new CustomFile(f.name.replace(/\.[^.]+$/, '.jpg'), jpg.length, '', jpg);
          }));
          await client.sendFile(entity, { file: fileObjs.length === 1 ? fileObjs[0] : fileObjs as any, forceDocument: false });
        }
        await client.sendMessage(entity, { message: textMsg });
        accountLastSent.set(readyIdx, Date.now());
        stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'sent' });
        stealthJob.sent++;
      }
    } catch (e: any) {
      const errMsg = e.message || String(e);
      const isDead = errMsg.includes('AUTH_KEY_UNREGISTERED') || errMsg.includes('USER_DEACTIVATED');
      if (isDead) {
        deadIdxs.add(readyIdx);
        await client.disconnect().catch(() => {});
        i--;
        continue;
      }
      stealthJob.log.push({ phone: rawPhone, name: rawPhone, status: 'error', error: errMsg });
      stealthJob.failed++;
    }

    stealthJob.checked = i + 1;
    // Сохраняем прогресс и no_telegram каждые 10 отправок
    if ((i + 1) % 10 === 0) {
      await saveStealthProgress();
      if (newNoTg.length > 0) await setDoc(doc(db, 'settings', 'no_telegram'), { phones: [...savedNoTg, ...newNoTg] }).catch(() => {});
    }
  }

  // Готово
  if (newNoTg.length > 0) await setDoc(doc(db, 'settings', 'no_telegram'), { phones: [...savedNoTg, ...newNoTg] }).catch(() => {});
  for (const c of clients) await c.disconnect().catch(() => {});
  stealthJob.status = 'done';
  stealthJob.finishedAt = new Date().toISOString();
  await saveStealthProgress();
}

app.post('/api/broadcast/stealth-start', async (req, res) => {
  const { phones, messageVariants, contactButton, images } = req.body;
  if (!phones?.length || !messageVariants?.length) return res.status(400).json({ error: 'Нужны phones и messageVariants' });
  if (stealthJob.status === 'running') return res.status(400).json({ error: 'Рассылка уже идёт' });
  runStealthBroadcast(phones, messageVariants, !!contactButton, images || []);
  res.json({ success: true, total: phones.length });
});

// Продолжить после добавления аккаунтов
app.post('/api/broadcast/stealth-resume', async (req, res) => {
  if (stealthJob.status === 'running') return res.status(400).json({ error: 'Рассылка уже идёт' });
  if (stealthJob.status !== 'waiting_accounts') return res.status(400).json({ error: 'Нет паузы для продолжения' });
  if (!db) return res.status(500).json({ error: 'DB не подключена' });
  const dataSnap = await getDoc(doc(db, 'settings', 'stealth_job_data')).catch(() => null);
  if (!dataSnap?.exists()) return res.status(400).json({ error: 'Данные задания не найдены' });
  const { phones, messageVariants, contactButton, imageFiles } = dataSnap.data() as any;
  const resumeFrom = stealthJob.currentIndex;
  runStealthBroadcast(phones, messageVariants, !!contactButton, imageFiles || [], resumeFrom);
  res.json({ success: true, resumeFrom, total: phones.length });
});

app.get('/api/broadcast/stealth-status', async (_req, res) => {
  if (stealthJob.status === 'idle' && db) {
    const snap = await getDoc(doc(db, 'settings', 'stealth_job')).catch(() => null);
    if (snap?.exists()) {
      const d = snap.data() as any;
      if (d.status === 'waiting_accounts') {
        stealthJob = { status: d.status, total: d.total, sent: d.sent, failed: d.failed, checked: d.checked, currentIndex: d.currentIndex, startedAt: d.startedAt, finishedAt: d.finishedAt, log: d.log || [] };
      }
    }
  }
  res.json({ ...stealthJob, logCount: stealthJob.log.length });
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
  // Variants: if provided, pick random per recipient; fallback to single message
  const variants: string[] = (messageVariants?.length > 0) ? messageVariants : (message ? [message] : []);
  const getVariant = () => variants[Math.floor(Math.random() * variants.length)];
  // mode: "burn" = расходный (быстро, до бана), "safe" = бережный (медленно)
  const MESSAGES_PER_ACCOUNT = mode === "burn" ? 9999 : 20;
  const getMsgDelay = () => mode === "burn" ? 200 + Math.random() * 300 : 3000 + Math.random() * 4000;
  if (!phones?.length || !variants.length) {
    return res.status(400).json({ error: "Нужны phones и message" });
  }
  if (!db) return res.status(500).json({ error: "База данных не подключена" });
  try {
    // Load accounts
    let accounts: any[] = [];
    const snap = await getDoc(doc(db, "settings", "tg_accounts"));
    if (snap.exists()) {
      accounts = (snap.data().accounts || []).filter((a: any) => a.sessionString && a.active !== false);
    }
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
      const c = new TelegramClient(new StringSession(acc.sessionString), TG_API_ID, TG_API_HASH, { connectionRetries: 3 });
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
      if (!db) return;
      const accSnap = await getDoc(doc(db, "settings", "tg_accounts")).catch(() => null);
      if (accSnap?.exists()) {
        const allAccs = accSnap.data().accounts || [];
        const bannedPhone = accounts[idx]?.phone;
        const updated = allAccs.map((a: any) => a.phone === bannedPhone ? { ...a, active: false, bannedAt: new Date().toISOString() } : a);
        await setDoc(doc(db, "settings", "tg_accounts"), { accounts: updated }).catch(() => {});
      }
    };

    const isAccountUseless = (idx: number) =>
      deadAccounts.has(idx) || (resolveFrozenAccounts.has(idx) && importFrozenAccounts.has(idx));

    const phoneRotations = new Map<number, number>(); // сколько раз ротировали аккаунт для одного номера

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
      const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
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
        if (imageFiles.length > 0) {
          const { CustomFile } = await import("telegram/client/uploads");
          // Convert all images to JPEG (handles HEIC, PNG, etc — Telegram only accepts JPEG/PNG)
          const fileObjs = await Promise.all(imageFiles.map(async f => {
            const raw = Buffer.from(f.base64, "base64");
            const jpg = await sharp(raw).jpeg({ quality: 90 }).toBuffer().catch(() => raw);
            const name = f.name.replace(/\.[^.]+$/, '.jpg');
            return new CustomFile(name, jpg.length, "", jpg);
          }));
          // Send photo(s) without caption
          if (fileObjs.length === 1) {
            await client.sendFile(entity as any, { file: fileObjs[0], forceDocument: false });
          } else {
            await client.sendFile(entity as any, { file: fileObjs as any, forceDocument: false });
          }
          const textMsg = contactButton ? `${getVariant()}\n\nhttps://t.me/yaasbae_ru` : getVariant();
          await client.sendMessage(entity as any, { message: textMsg });
        } else {
          const textMsg = contactButton ? `${getVariant()}\n\nhttps://t.me/yaasbae_ru` : getVariant();
          await client.sendMessage(entity as any, { message: textMsg });
        }
        results.push({ phone: rawPhone, status: "sent", account: accounts[accIdx].phone });
        msgCount++;
        await new Promise(r => setTimeout(r, getMsgDelay()));
      } catch (e: any) {
        const errMsg = e.message || String(e);
        const isDead = errMsg.includes("AUTH_KEY_UNREGISTERED") || errMsg.includes("USER_DEACTIVATED") || errMsg.includes("SESSION_REVOKED");
        const isFlood = errMsg.includes("PEER_FLOOD") || errMsg.includes("FLOOD_WAIT");
        results.push({ phone: rawPhone, status: "error", error: errMsg });
        if (isDead) await markDead(accIdx);
        // Always delay after error too, longer on flood
        await new Promise(r => setTimeout(r, isFlood ? 10000 : getMsgDelay()));
        if (isDead || isFlood) {
          accIdx = (accIdx + 1) % clients.length;
          msgCount = 0;
        }
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
  res.json(botCfg);
});

app.post("/api/bot/buttons", async (req, res) => {
  const { buttons, welcomeText } = req.body;
  if (buttons) botCfg.buttons = buttons;
  if (welcomeText !== undefined) botCfg.welcomeText = welcomeText;
  if (db) await setDoc(doc(db, "settings", "bot_buttons"), { buttons: botCfg.buttons, welcomeText: botCfg.welcomeText }, { merge: true });
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
      model: "gemini-2.0-flash",
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

const TOCHKA_API = 'https://enter.tochka.com';

async function getTochkaToken(): Promise<string | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'settings', 'tochka_api')).catch(() => null);
  return snap?.exists() ? snap.data().jwtToken : null;
}

// Сохранить JWT токен Точки
app.post('/api/tochka/save-token', async (req, res) => {
  const { jwtToken } = req.body;
  if (!jwtToken?.trim()) return res.status(400).json({ error: 'Нужен jwtToken' });
  if (!db) return res.status(503).json({ error: 'DB не подключена' });
  // Декодируем customerCode из JWT
  try {
    const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString());
    const customerCode = payload.customer_code || '';
    await setDoc(doc(db, 'settings', 'tochka_api'), { jwtToken, customerCode });
    res.json({ success: true, customerCode });
  } catch (e: any) {
    res.status(400).json({ error: 'Невалидный JWT: ' + e.message });
  }
});

// Создать ссылку/QR на оплату
app.post('/api/tochka/create-payment', async (req, res) => {
  const { orderId, amount, description } = req.body;
  if (!amount || !orderId) return res.status(400).json({ error: 'Нужны orderId и amount' });
  if (!db) return res.status(503).json({ error: 'DB не подключена' });
  try {
    const token = await getTochkaToken();
    if (!token) return res.status(400).json({ error: 'Токен Точки не настроен' });
    const snap = await getDoc(doc(db, 'settings', 'tochka_api'));
    const customerCode = snap?.data()?.customerCode;
    const webhookUrl = process.env.SERVER_URL ? `${process.env.SERVER_URL}/api/tochka/webhook` : null;

    const response = await axios.post(
      `${TOCHKA_API}/acquiring/v1.0/payments`,
      {
        customerCode,
        amount: Math.round(parseFloat(amount) * 100) / 100,
        purpose: description || `Оплата заказа ${orderId}`,
        redirectUrl: process.env.SERVER_URL ? `${process.env.SERVER_URL}/pay/success` : undefined,
        ttl: 72 * 60, // 72 часа
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    const paymentData = response.data;
    const paymentUrl = paymentData.paymentUrl || paymentData.data?.paymentUrl;

    // Сохраняем ссылку оплаты в заказ
    if (orderId && paymentUrl) {
      await updateDoc(doc(db, 'orders', orderId), {
        paymentUrl,
        paymentId: paymentData.operationId || paymentData.data?.operationId,
        paymentStatus: 'pending',
        paymentCreatedAt: new Date().toISOString(),
        paymentAmount: amount,
      }).catch(() => {});
    }

    res.json({ success: true, paymentUrl, data: paymentData });
  } catch (e: any) {
    const errData = e.response?.data;
    console.error('[tochka] create-payment error:', errData || e.message);
    res.status(500).json({ error: e.message, details: errData });
  }
});

// Webhook — уведомление об оплате от Точки
app.post('/api/tochka/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('[tochka] webhook:', JSON.stringify(body).slice(0, 200));
    // Найти заказ по operationId и обновить статус
    if (db && body.operationId) {
      const ordersSnap = await getDocs(query(collection(db, 'orders'), where('paymentId', '==', body.operationId)));
      for (const d of ordersSnap.docs) {
        const status = body.status === 'Paid' || body.status === 'paid' ? 'paid' : body.status;
        await updateDoc(d.ref, { paymentStatus: status, paymentPaidAt: new Date().toISOString() });
      }
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Статус токена Точки
app.get('/api/tochka/status', async (_req, res) => {
  if (!db) return res.json({ configured: false });
  const snap = await getDoc(doc(db, 'settings', 'tochka_api')).catch(() => null);
  res.json({ configured: !!snap?.exists(), customerCode: snap?.data()?.customerCode });
});

// ─── Telegram Bot ───────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
let botInstance: any = null;

// try-on state stored in Firestore — survives deploys and multiple instances
async function setTryOnState(userId: string, data: { costumeUrls: string[]; costumeName: string }) {
  if (!db) return;
  await setDoc(doc(db, "tryon_state", userId), { ...data, updatedAt: new Date().toISOString() });
}
async function getTryOnState(userId: string): Promise<{ costumeUrls: string[]; costumeName: string } | null> {
  if (!db) return null;
  const snap = await getDoc(doc(db, "tryon_state", userId)).catch(() => null);
  if (!snap?.exists()) return null;
  return snap.data() as any;
}
async function deleteTryOnState(userId: string) {
  if (!db) return;
  await deleteDoc(doc(db, "tryon_state", userId)).catch(() => {});
}

// Costumes cache — refreshed every 5 minutes to avoid Firestore reads on every catalog open
let costumesCache: any[] | null = null;
let costumesCacheAt = 0;
async function getCostumes(): Promise<any[]> {
  if (costumesCache && Date.now() - costumesCacheAt < 5 * 60 * 1000) return costumesCache;
  if (!db) return [];
  const snap = await getDocs(collection(db, "costumes")).catch(() => null);
  if (!snap) return costumesCache || [];
  costumesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  costumesCacheAt = Date.now();
  return costumesCache;
}

// Bot button config — editable from CRM
interface BotButton { id: string; label: string; response: string; }
interface BotCfg { welcomeText: string; buttons: BotButton[]; }

const DEFAULT_BOT_CFG: BotCfg = {
  welcomeText: "Привет, {name}! 👋\n\nДобро пожаловать в *YB Studio* — твой личный стилист.\n\n✨ Здесь ты можешь:\n👗 Примерить любой костюм онлайн\n🎁 Получить персональную скидку\n🆕 Первым узнавать о новинках\n\n*Специально для тебя — скидка 10% на первый заказ!*\nВыбери что тебя интересует 👇",
  buttons: [
    { id: "catalog", label: "👗 Каталог",             response: "👗 *Каталог YB Studio*\n\nПосмотреть все модели можно на нашем сайте и в Instagram.\n\nЕсли хочешь примерить понравившийся костюм онлайн — нажми кнопку ниже 👇" },
    { id: "tryon",   label: "✨ Примерить онлайн",    response: "" },
    { id: "bonuses", label: "🎁 Мои бонусы",          response: "🎁 *Твои бонусы*\n\nОтправь свой номер телефона чтобы проверить баланс." },
    { id: "news",    label: "🆕 Новинки",             response: "🆕 *Новинки YB Studio*\n\nСледи за обновлениями — скоро здесь появятся новые коллекции!" },
    { id: "contact", label: "📞 Связаться с нами",    response: "📞 *Связь с нами*\n\nНапиши своё сообщение — менеджер ответит в течение нескольких минут 🙏" },
  ],
};

let botCfg: BotCfg = JSON.parse(JSON.stringify(DEFAULT_BOT_CFG));

async function loadBotCfg() {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, "settings", "bot_buttons"));
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data.buttons) botCfg.buttons = data.buttons;
      if (data.welcomeText) botCfg.welcomeText = data.welcomeText;
    }
    const cfgSnap = await getDoc(doc(db, "settings", "bot_config"));
    if (cfgSnap.exists() && cfgSnap.data().welcomeText) botCfg.welcomeText = cfgSnap.data().welcomeText;
  } catch {}
}

async function resizeToBase64(b64: string, maxPx = 768): Promise<string> {
  try {
    const buf = Buffer.from(b64, "base64");
    const resized = await sharp(buf).resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return resized.toString("base64");
  } catch { return b64; }
}

async function runGeminiTryOn(userPhotoBase64: string, costumeBase64: string, attempt = 1, allCostumeBase64s?: string[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задан");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 600000 } });

  // Use only first costume photo — multiple photos don't improve quality but slow Gemini significantly
  const costumePhoto = (allCostumeBase64s?.length ? allCostumeBase64s[0] : costumeBase64) || costumeBase64;
  const [resizedUser, resizedCostume] = await Promise.all([
    resizeToBase64(userPhotoBase64, 1024),
    resizeToBase64(costumePhoto, 1024),
  ]);
  let response: any;
  try {
  response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [{
      role: "user",
      parts: [
        { text: `Virtual try-on: FIRST image is the garment, SECOND image is the person. Generate a photorealistic image of the person wearing the garment. Copy face, hair, skin, pose, background EXACTLY from the SECOND image. Only change the clothing. Photorealistic, same framing.` },
        { inlineData: { mimeType: "image/jpeg", data: resizedCostume } },
        { inlineData: { mimeType: "image/jpeg", data: resizedUser } },
      ] as any
    }],
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });
  } catch (e: any) {
    const isRetryable = e.message?.includes("502") || e.message?.includes("503") || e.message?.includes("500") || e.message?.includes("429") || e.message?.includes("fetch failed") || e.message?.includes("aborted") || e.message?.includes("CANCELLED");
    if (isRetryable && attempt < 3) {
      const delay = attempt * 15000;
      console.log(`Gemini error "${e.message?.slice(0, 50)}" — retry ${attempt}/3 через ${delay/1000}s`);
      await new Promise(r => setTimeout(r, delay));
      return runGeminiTryOn(userPhotoBase64, costumeBase64, attempt + 1, allCostumeBase64s);
    }
    throw e;
  }
  const parts = (response as any).candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const imgBuf = Buffer.from(part.inlineData.data, "base64");
      const resized = await sharp(imgBuf)
        .resize(1440, 2560, { fit: "cover", position: "center" })
        .jpeg({ quality: 95 })
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

  bot.start(async (ctx) => {
    await saveSubscriber(ctx);
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
      const snap = await Promise.race([
        getDoc(doc(db, "costumes", costumeId)),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))
      ]).catch(() => null) as any;
      if (!snap?.exists()) return ctx.reply("Модель не найдена, попробуй ещё раз").catch(() => {});
      const c = snap.data() as any;
      const urls: string[] = c.imageUrls?.length ? c.imageUrls : [c.imageUrl];

      // Send photos album — pass URLs directly, Telegram downloads them
      try {
        if (urls.length === 1) {
          await ctx.replyWithPhoto({ url: urls[0] }, { caption: c.name });
        } else {
          await ctx.replyWithMediaGroup(
            urls.map((url, j) => ({
              type: "photo" as const,
              media: url,
              ...(j === 0 ? { caption: c.name } : {}),
            }))
          );
        }
      } catch (e: any) {
        await ctx.replyWithPhoto({ url: c.imageUrl }, { caption: c.name }).catch(() => {});
      }

      // Show try-on button
      await ctx.reply(
        `*${c.name}*\n\nХочешь примерить эту модель онлайн?`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("✨ Примерить онлайн", `tryon_${costumeId}`)]]) }
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
      const snap = await Promise.race([
        getDoc(doc(db, "costumes", costumeId)),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))
      ]).catch(() => null) as any;
      if (!snap?.exists()) return ctx.reply("Костюм не найден, попробуй выбрать снова").catch(() => {});
      const costume = snap.data() as any;
      const urls: string[] = costume.imageUrls?.length ? costume.imageUrls : [costume.imageUrl];
      await setTryOnState(String(ctx.from!.id), { costumeUrls: urls, costumeName: costume.name });
      await ctx.reply(
        `Отлично! Ты выбрала *${costume.name}* 👗\n\nТеперь пришли *своё фото в полный рост* — и я сделаю примерку через ИИ!\n\n📸 Загрузи фотографию 👇`,
        { parse_mode: "Markdown" }
      );
    } catch (e: any) {
      console.error("tryon action error:", e.message);
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
    await deleteTryOnState(userId);

    // Get file link BEFORE background task — ctx.telegram works here
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const processing = await ctx.reply("⏳ Создаю примерку... Это занимает 3-7 минут. Не уходи! 🙏");

    const downloadUrl = async (url: string): Promise<string> => {
      const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
      return Buffer.from(resp.data).toString("base64");
    };

    // Run Gemini in background — don't await so Telegraf handler returns immediately
    (async () => {
      try {
        const t0 = Date.now();
        const [userPhotoBase64, ...costumeBase64s] = await Promise.all([
          downloadUrl(fileLink.href),
          ...costumeUrls.map(downloadUrl),
        ]);
        console.log(`[tryon] download: ${Date.now() - t0}ms`);

        const t1 = Date.now();
        const resultBase64 = await runGeminiTryOn(userPhotoBase64, costumeBase64s[0] || "", 1, costumeBase64s);
        console.log(`[tryon] gemini: ${Date.now() - t1}ms`);
        if (!resultBase64) throw new Error("Gemini не вернул изображение");

        await ctx.telegram.deleteMessage(ctx.chat.id, processing.message_id).catch(() => {});
        await ctx.replyWithPhoto(
          { source: Buffer.from(resultBase64, "base64") },
          {
            caption: `✨ Вот как ты выглядишь в *${costumeName}*!\n\nПонравилось? Оформи заказ 👇`,
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([Markup.button.url("🛍 Заказать", "https://t.me/YAASBAE_CLO_bot")])
          }
        );
      } catch (e: any) {
        console.error("tryon photo error:", e.message, e.cause?.message || "");
        // Restore state so user can retry without reselecting costume
        await setTryOnState(userId, { costumeUrls, costumeName });
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

    // Check if text matches any menu button label
    const btn = botCfg.buttons.find(b => b.label === text);
    if (btn) {
      if (btn.id === "catalog" || btn.id === "tryon") {
        // Show catalog as list of model name buttons
        await saveSubscriber(ctx);
        const costumes = await getCostumes();
        if (!costumes.length) return ctx.reply("Каталог костюмов пока пустой — скоро добавим! 👗");

        const modelButtons = costumes.map((c: any) =>
          [Markup.button.callback(`👗 ${c.name}`, `catalog_${c.id}`)]
        );
        await ctx.reply(
          btn.id === "tryon"
            ? "✨ *Онлайн примерка* _(тестовый режим)_\n\nВыбери модель для примерки 👇"
            : "👗 *Каталог YB Studio*\n\nВыбери модель чтобы посмотреть фото 👇",
          { parse_mode: "Markdown", ...Markup.inlineKeyboard(modelButtons) }
        );
      } else if (btn.id === "contact") {
        await ctx.reply(
          "📞 *Связаться с нами*\n\nНажми кнопку ниже — откроется чат с менеджером 👇",
          {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.url("💬 Написать менеджеру", "https://t.me/yaasbae_ru")]])
          }
        );
      } else if (btn.response) {
        await ctx.reply(btn.response, { parse_mode: "Markdown" });
      }
      return;
    }

    // Free text — save as message and reply
    if (db) {
      try {
        await addDoc(collection(db, "bot_messages"), {
          userId: String(ctx.from.id),
          username: ctx.from.username || "",
          firstName: ctx.from.first_name || "",
          text,
          receivedAt: new Date().toISOString(),
          replied: false,
        });
      } catch {}
    }
    await ctx.reply("Спасибо! Менеджер ответит в ближайшее время 🙏", getMainMenu());
    } catch (e: any) { console.error("text handler error:", e.message); }
  });

  botInstance = bot;
  const webhookUrl = process.env.WEBHOOK_URL;

  if (webhookUrl) {
    // Webhook mode for Cloud Run
    const webhookPath = "/tg-webhook-" + BOT_TOKEN.split(":")[0];
    bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`)
      .then(() => bot.telegram.getMe())
      .then(me => console.log(`Telegram бот запущен (webhook): @${me.username}`))
      .catch(e => console.error("Webhook setup error:", e.message));
    app.post(webhookPath, (req, res) => bot.handleUpdate(req.body, res));
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
}

loadBotCfg().then(() => startTelegramBot());

// ────────────────────────────────────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
