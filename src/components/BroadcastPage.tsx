import React, { useState, useEffect, useMemo } from 'react';
import {
  Send, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp,
  AlertCircle, Smartphone, Search, Image
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, limit, setDoc, doc, getDoc } from 'firebase/firestore';

interface TgAccount {
  phone: string;
  addedAt: string;
  active: boolean;
  proxy?: { ip: string; port: number; username?: string; password?: string; };
}

interface TgStatus {
  authorized: boolean;
  accounts: TgAccount[];
}

interface Props {
  sheetId?: string;
  initialTab?: 'compose' | 'settings';
}

function friendlyError(err: string): string {
  if (!err) return '';
  if (err.includes('FROZEN_METHOD_INVALID') || err.includes('FROZEN')) return 'Метод заблокирован антиспамом';
  if (err.includes('PEER_FLOOD')) return 'Лимит — слишком много сообщений';
  if (err.includes('FLOOD_WAIT')) return 'Пауза — Telegram просит подождать';
  if (err.includes('AUTH_KEY_UNREGISTERED')) return 'Сессия сброшена — нужно заново войти';
  if (err.includes('USER_DEACTIVATED')) return 'Аккаунт заблокирован Telegram';
  if (err.includes('SESSION_REVOKED')) return 'Сессия отозвана';
  if (err.includes('PHONE_NUMBER_INVALID')) return 'Неверный номер телефона';
  if (err.includes('USERNAME_NOT_OCCUPIED')) return 'Пользователь не найден';
  if (err.includes('PRIVACY_KEY_INVALID') || err.includes('INPUT_USER_DEACTIVATED')) return 'Пользователь ограничил входящие';
  if (err.includes('USER_IS_BLOCKED')) return 'Пользователь заблокировал нас';
  if (err.includes('Нет Telegram')) return 'Нет Telegram';
  if (err.includes('Все аккаунты заморожены')) return 'Все аккаунты заморожены';
  if (err.includes('ALLOW_PAYMENT_REQUIRED')) return 'Требуется подписка Telegram Premium';
  return err.slice(0, 40);
}

function normalizeBroadcastPhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

function isHeicFile(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function fileToJpegData(file: File): Promise<{ base64: string; dataUrl: string; name: string }> {
  let source: Blob = file;
  if (isHeicFile(file)) {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    source = Array.isArray(converted) ? converted[0] : converted;
  }

  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const imgEl = new window.Image();
    const url = URL.createObjectURL(source);
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error(`Фото "${file.name}" не прочиталось. Попробуй JPG/PNG или отправь без фото.`));
    }, 15000);

    imgEl.onload = () => {
      try {
        window.clearTimeout(timeout);
        const MAX = 1280;
        let w = imgEl.width;
        let h = imgEl.height;
        if (w > MAX || h > MAX) {
          if (w > h) {
            h = Math.round(h * MAX / w);
            w = MAX;
          } else {
            w = Math.round(w * MAX / h);
            h = MAX;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas недоступен');
        ctx.drawImage(imgEl, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          base64: dataUrl.split(',')[1],
          dataUrl,
          name: file.name.replace(/\.[^.]+$/, '.jpg'),
        });
      } catch (err: any) {
        URL.revokeObjectURL(url);
        reject(new Error(`Не удалось подготовить фото "${file.name}": ${err.message}`));
      }
    };

    imgEl.onerror = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error(`Не удалось прочитать фото "${file.name}". Попробуй JPG/PNG или отправь без фото.`));
    };
    imgEl.src = url;
  });
}

const SenderNameField = React.memo(function SenderNameField({
  initialValue,
  isSaving,
  onSave,
}: {
  initialValue: string;
  isSaving: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className="space-y-2">
      <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Имя отправителя</label>
      <p className="text-[9px] text-zinc-400 ml-1">Все аккаунты получат это имя перед рассылкой</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="YB Studio"
          className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
        />
        <button
          onClick={() => onSave(value)}
          disabled={isSaving || !value.trim()}
          className="px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center gap-1.5"
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
          Сохранить
        </button>
      </div>
    </div>
  );
});

const ProxyField = React.memo(function ProxyField({
  phone,
  initialValue,
  hasProxy,
  isSaving,
  onSave,
}: {
  phone: string;
  initialValue: string;
  hasProxy: boolean;
  isSaving: boolean;
  onSave: (phone: string, value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className="flex items-center gap-2 px-3 pb-2.5">
      <input
        type="text"
        placeholder="прокси: ip:port:user:pass"
        value={value}
        onChange={e => setValue(e.target.value)}
        className={`flex-1 bg-zinc-50 border rounded-lg px-2 py-1 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500/30 ${hasProxy ? 'border-emerald-300' : 'border-zinc-200'}`}
      />
      <button
        onClick={() => onSave(phone, value)}
        disabled={isSaving}
        className="px-2 py-1 bg-zinc-800 text-white rounded-lg text-[9px] font-black hover:bg-zinc-700 transition-all disabled:opacity-40 shrink-0"
      >
        {isSaving ? '...' : 'OK'}
      </button>
    </div>
  );
});

export const BroadcastPage: React.FC<Props> = ({ sheetId, initialTab = 'compose' }) => {
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendDebug, setSendDebug] = useState('');
  const [sendIntervalMinutes, setSendIntervalMinutes] = useState<2 | 5 | 10>(2);
  const [messageVariants, setMessageVariants] = useState<string[]>([]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const [showVariants, setShowVariants] = useState(false);
  const [stealthStatus, setStealthStatus] = useState<{status:string;sent:number;failed:number;checked:number;total:number;delayMinutes?:number;currentIndex?:number;currentAccount?:string;log?:Array<{phone:string;name:string;status:string;error?:string;account?:string}>} | null>(null);
  const [clientRevenue, setClientRevenue] = useState<Map<string, number>>(new Map());
  const [clientOrders, setClientOrders] = useState<Map<string, number>>(new Map());
  const [sentPhones, setSentPhones] = useState<Set<string>>(new Set());
  const [sentDates, setSentDates] = useState<Map<string, string>>(new Map());
  const [broadcastHistory, setBroadcastHistory] = useState<Array<{ id: string; sentAt: string; phones: string[]; message: string; sentCount: number }>>([]);
  const [selectedBroadcast, setSelectedBroadcast] = useState<string | null>(null);
  const [sendLog, setSendLog] = useState<Array<{ phone: string; name: string; status: 'sent' | 'error'; error?: string }>>([]);
  const [result, setResult] = useState<any>(null);
  const [noTelegramPhones, setNoTelegramPhones] = useState<Map<string, string>>(new Map()); // phone → addedAt ISO
  const [accountStats, setAccountStats] = useState<Map<string, number>>(new Map()); // phone → sent count
  const [activeTab, setActiveTab] = useState<'compose' | 'settings'>(initialTab);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [visibleClientCount, setVisibleClientCount] = useState(50);
  const [lastSelectedClientIndex, setLastSelectedClientIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [contactButton, setContactButton] = useState(true);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [clientFilter, setClientFilter] = useState<'all' | 'unsent' | 'sent' | 'no_tg'>('unsent');

  // Telegram auth state
  const [tgStatus, setTgStatus] = useState<TgStatus>({ authorized: false, accounts: [] });
  const [authPhone, setAuthPhone] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authTwoFa, setAuthTwoFa] = useState('');
  const [authStep, setAuthStep] = useState<'idle' | 'code_sent' | 'needs_2fa'>('idle');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const [isAddingSession, setIsAddingSession] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileUploadError, setFileUploadError] = useState('');
  const [bulkSessions, setBulkSessions] = useState('');
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [bulkResult, setBulkResult] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSettingPhoto, setIsSettingPhoto] = useState(false);
  const [photoResult, setPhotoResult] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [proxyInputs, setProxyInputs] = useState<Record<string, string>>({});
  const [savingProxy, setSavingProxy] = useState<string | null>(null);
  const [savingActiveAccount, setSavingActiveAccount] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Tochka Bank settings
  const [tochkaToken, setTochkaToken] = useState('');
  const [tochkaMerchantId, setTochkaMerchantId] = useState('');
  const [isSavingTochka, setIsSavingTochka] = useState(false);
  const [tochkaSaveResult, setTochkaSaveResult] = useState('');
  const [tochkaConfigured, setTochkaConfigured] = useState(false);

  // AI settings
  const [geminiKey, setGeminiKey] = useState('');
  const [isSavingGemini, setIsSavingGemini] = useState(false);
  const [geminiSaveResult, setGeminiSaveResult] = useState('');
  const [geminiConfigured, setGeminiConfigured] = useState(false);

  const loadTgStatus = async () => {
    try {
      const res = await fetch('/api/tg/auth/status');
      const data = await res.json();
      const accs: TgAccount[] = data.accounts || [];
      setTgStatus({ authorized: data.authorized, accounts: accs });
      setProxyInputs(prev => {
        const next = { ...prev };
        accs.forEach(a => {
          if (!(a.phone in next) && a.proxy) {
            const p = a.proxy;
            next[a.phone] = [p.ip, p.port, p.username || '', p.password || ''].filter((v, i) => i < 2 || v).join(':');
          }
        });
        return next;
      });
    } catch {}
  };

  const handleAddSession = async () => {
    if (!sessionInput.trim()) return;
    setIsAddingSession(true);
    setSessionError('');
    try {
      const res = await fetch('/api/tg/accounts/add-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionString: sessionInput.trim() })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSessionInput('');
      await loadTgStatus();
    } catch (e: any) {
      setSessionError(e.message);
    } finally {
      setIsAddingSession(false);
    }
  };

  const handleSessionFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsUploadingFile(true);
    setFileUploadError('');
    let added = 0, failed = 0;
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const res = await fetch('/api/tg/accounts/upload-session-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileBase64: base64, fileName: file.name })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        added++;
      } catch (err: any) {
        failed++;
        setFileUploadError(`${file.name}: ${err.message}`);
      }
    }
    if (added > 0) await loadTgStatus();
    if (files.length > 1) setFileUploadError(prev => `Добавлено: ${added}, ошибок: ${failed}` + (prev ? `. ${prev}` : ''));
    setIsUploadingFile(false);
    e.target.value = '';
  };

  const handleSetPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSettingPhoto(true);
    setPhotoResult('');
    try {
      const base64 = await new Promise<string>(res => {
        const canvas = document.createElement('canvas');
        const img = new window.Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const SIZE = 512;
          canvas.width = SIZE; canvas.height = SIZE;
          const s = Math.min(img.width, img.height);
          const ox = (img.width - s) / 2, oy = (img.height - s) / 2;
          canvas.getContext('2d')!.drawImage(img, ox, oy, s, s, 0, 0, SIZE, SIZE);
          URL.revokeObjectURL(url);
          res(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
        };
        img.src = url;
      });
      const resp = await fetch('/api/tg/accounts/set-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoBase64: base64 })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setPhotoResult(`Готово: ${data.ok} аккаунт(ов) обновлено`);
    } catch (e: any) {
      setPhotoResult('Ошибка: ' + e.message);
    } finally {
      setIsSettingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSaveDisplayName = async (nextDisplayName = displayName) => {
    setIsSavingName(true);
    try {
      await fetch('/api/tg/broadcast/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: nextDisplayName })
      });
      setDisplayName(nextDisplayName);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleBulkAddSessions = async () => {
    const sessions = bulkSessions.split('\n').map(s => s.trim()).filter(Boolean);
    if (!sessions.length) return;
    setIsBulkAdding(true);
    setBulkResult('');
    try {
      const res = await fetch('/api/tg/accounts/bulk-add-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBulkResult(`Добавлено: ${data.added}, Ошибок: ${data.failed}`);
      if (data.added > 0) { setBulkSessions(''); await loadTgStatus(); }
    } catch (e: any) {
      setBulkResult('Ошибка: ' + e.message);
    } finally {
      setIsBulkAdding(false);
    }
  };

  const handleRemoveAccount = async (phone: string) => {
    if (!confirm(`Удалить аккаунт ${phone}?`)) return;
    await fetch('/api/tg/accounts/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    await loadTgStatus();
  };

  const handleSetAccountActive = async (phone: string, active: boolean, onlyThis = false) => {
    setSavingActiveAccount(phone);
    try {
      await fetch('/api/tg/accounts/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, active, onlyThis })
      });
      await loadTgStatus();
    } finally {
      setSavingActiveAccount(null);
    }
  };

  const handleSaveProxy = async (phone: string, value = proxyInputs[phone] || '') => {
    const raw = value.trim();
    let proxy: { ip: string; port: number; username?: string; password?: string; } | null = null;
    if (raw) {
      const parts = raw.split(':');
      if (parts.length < 2) return alert('Формат: ip:port или ip:port:user:pass');
      proxy = { ip: parts[0], port: Number(parts[1]), username: parts[2] || undefined, password: parts[3] || undefined };
    }
    setSavingProxy(phone);
    await fetch('/api/tg/accounts/set-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, proxy })
    });
    setProxyInputs(prev => ({ ...prev, [phone]: raw }));
    setSavingProxy(null);
    await loadTgStatus();
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [contactsSnap, broadcastsSnap, noTgSnap, stealthSentSnap] = await Promise.all([
          getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc'))),
          getDocs(query(collection(db, 'broadcasts'), orderBy('sentAt', 'desc'), limit(30))),
          getDoc(doc(db, 'settings', 'no_telegram')),
          getDoc(doc(db, 'settings', 'stealth_sent')),
        ]);

        // Load saved no-telegram phones
        if (noTgSnap.exists()) {
          const map = new Map<string, string>();
          (noTgSnap.data().phones || []).forEach((p: { phone: string; addedAt: string }) => map.set(normalizeBroadcastPhone(p.phone), p.addedAt));
          setNoTelegramPhones(map);
        }

        // Only count broadcasts that actually sent messages (sentCount > 0 or phones saved from real sends)
        const sent = new Set<string>();
        const history: typeof broadcastHistory = [];
        let latestLog: Array<{ phone: string; name: string; status: 'sent' | 'error'; error?: string }> = [];
        let latestAt = '';
        const accStats = new Map<string, number>();
        broadcastsSnap.docs.forEach(d => {
          const b = d.data() as any;
          if (b.sentCount === undefined) return;
          if (b.sentCount === 0) return;
          (b.phones || []).forEach((p: string) => sent.add(normalizeBroadcastPhone(p)));
          history.push({ id: d.id, sentAt: b.sentAt, phones: b.phones || [], message: b.message || '', sentCount: b.sentCount || b.phones?.length || 0 });
          if (b.sentAt > latestAt && b.log?.length) { latestAt = b.sentAt; latestLog = b.log; }
          (b.log || []).forEach((entry: any) => {
            if (entry.account && entry.status === 'sent') {
              const phone = entry.account.replace('+', '');
              accStats.set(phone, (accStats.get(phone) || 0) + 1);
            }
          });
        });
        setAccountStats(accStats);
        history.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
        setBroadcastHistory(history);
        if (latestLog.length > 0) setSendLog(latestLog);

        // Загружаем даты отправки из stealth_sent
        if (stealthSentSnap.exists()) {
          const datesMap = new Map<string, string>();
          (stealthSentSnap.data().phones || []).forEach((p: any) => {
            const ph = typeof p === 'string' ? p : p?.phone;
            if (ph) {
              const normalized = normalizeBroadcastPhone(ph);
              sent.add(normalized);
              if (p?.sentAt) datesMap.set(normalized, p.sentAt);
            }
          });
          setSentDates(datesMap);
        }
        setSentPhones(sent);

        // Клиентская база — коллекция contacts, отсортирована по totalSpent
        const revMap = new Map<string, number>();
        const ordMap = new Map<string, number>();
        const data = contactsSnap.docs.map(d => {
          const c = d.data() as any;
          const phone = normalizeBroadcastPhone(c.phone || d.id || '');
          const rev = c.totalSpent || 0;
          const ords = c.ordersCount || 0;
          revMap.set(phone.slice(-10), rev);
          ordMap.set(phone.slice(-10), ords);
          return { ...c, id: d.id, phone, fullName: c.fullName || c.name || '' };
        }).filter(c => c.phone.length >= 10 && c.fullName);
        setClientRevenue(revMap);
        setClientOrders(ordMap);
        setClients(data);
      } finally {
        setIsLoadingClients(false);
      }
    };
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/tg/broadcast/config');
        const data = await res.json();
        if (data.displayName) setDisplayName(data.displayName);
      } catch {}
    };
    loadData();
    loadTgStatus();
    loadConfig();
    fetch('/api/tochka/status').then(r => r.json()).then(d => setTochkaConfigured(!!d.configured)).catch(() => {});
    getDoc(doc(db, 'settings', 'ai_config')).then(snap => {
      if (snap.exists() && snap.data().geminiKey) setGeminiConfigured(true);
    }).catch(() => {});
    // Загружаем сохранённые варианты и настройки
    getDoc(doc(db, 'settings', 'broadcast_config')).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.messageVariants?.length) setMessageVariants(d.messageVariants);
      if (d.message) setMessage(d.message);
      if (typeof d.contactButton === 'boolean') setContactButton(d.contactButton);
      if ([2, 5, 10].includes(d.sendIntervalMinutes)) setSendIntervalMinutes(d.sendIntervalMinutes);
    }).catch(() => {}).finally(() => setIsConfigLoaded(true));
  }, []);

  // Авто-сохранение настроек рассылки в Firestore (дебаунс 1.5 сек)
  useEffect(() => {
    if (!isConfigLoaded) return;
    const timer = setTimeout(() => {
      setDoc(doc(db, 'settings', 'broadcast_config'), { message, messageVariants, contactButton, sendIntervalMinutes }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [isConfigLoaded, message, messageVariants, contactButton, sendIntervalMinutes]);

  const handleSelectFirst = (count: number) => {
    setSelected(new Set(filteredPhones.slice(0, count)));
  };

  const handleSelectAll = () => {
    if (allFilteredSelected) setSelected(new Set());
    else setSelected(new Set(filteredPhones));
  };

  const handleToggle = (phone: string, index: number, shiftKey = false) => {
    if (shiftKey && lastSelectedClientIndex !== null) {
      const start = Math.min(lastSelectedClientIndex, index);
      const end = Math.max(lastSelectedClientIndex, index);
      const rangePhones = filteredPhones.slice(start, end + 1);
      setSelected(prev => {
        const next = new Set(prev);
        rangePhones.forEach(p => next.add(p));
        return next;
      });
      setLastSelectedClientIndex(index);
      return;
    }

    const next = new Set(selected);
    if (next.has(phone)) next.delete(phone);
    else next.add(phone);
    setSelected(next);
    setLastSelectedClientIndex(index);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    for (const file of files) {
      try {
        const prepared = await fileToJpegData(file);
        const normalizedFile = new File(
          [Uint8Array.from(atob(prepared.base64), c => c.charCodeAt(0))],
          prepared.name,
          { type: 'image/jpeg' }
        );
        setImages(prev => [...prev, normalizedFile]);
        setImagePreviews(prev => [...prev, prepared.dataUrl]);
      } catch (err: any) {
        setResult({ error: err.message });
      }
    }
  };

  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSendCode = async () => {
    if (!authPhone) return;
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/tg/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: authPhone })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAuthStep('code_sent');
    } catch (e: any) {
      setAuthError(e.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignIn = async () => {
    if (!authCode) return;
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const body: any = { phone: authPhone, code: authCode };
      if (authStep === 'needs_2fa') body.twoFaPassword = authTwoFa;
      const res = await fetch('/api/tg/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)

      });
      const data = await res.json();
      if (data.error) {
        if (data.error.includes('не найдена')) setAuthStep('idle');
        throw new Error(data.error);
      }
      if (data.requires2FA) {
        setAuthStep('needs_2fa');
        return;
      }
      await loadTgStatus();
      setAuthStep('idle');
      setAuthPhone('');
      setAuthCode('');
      setAuthTwoFa('');
    } catch (e: any) {
      setAuthError(e.message);
    } finally {
      setIsAuthLoading(false);
    }
  };


  const [isCheckingTg, setIsCheckingTg] = useState(false);
  const [checkTgProgress, setCheckTgProgress] = useState('');

  // Polling статуса фоновой проверки
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const res = await fetch('/api/broadcast/check-tg-status');
        const data = await res.json();
        if (data.status === 'running') {
          setIsCheckingTg(true);
          setCheckTgProgress(`${data.checked} / ${data.total}`);
        } else if (data.status === 'done') {
          setIsCheckingTg(false);
          setCheckTgProgress(`Готово — без TG: ${data.noTgFound}`);
          clearInterval(timer);
          // Перезагружаем список no_telegram из Firestore
          const noTgSnap = await getDoc(doc(db, 'settings', 'no_telegram'));
          if (noTgSnap.exists()) {
            const map = new Map<string, string>();
            (noTgSnap.data().phones || []).forEach((p: { phone: string; addedAt: string }) => map.set(normalizeBroadcastPhone(p.phone), p.addedAt));
            setNoTelegramPhones(map);
          }
        } else if (data.status === 'error') {
          setIsCheckingTg(false);
          setCheckTgProgress('Ошибка: ' + data.error);
          clearInterval(timer);
        }
      } catch {}
    };
    poll(); // проверяем сразу при загрузке (вдруг шла проверка)
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleGenerateVariants = async () => {
    if (!message.trim()) return;
    setIsGeneratingVariants(true);
    setVariantsError('');
    try {
      const res = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.variants?.length) throw new Error('AI не вернул варианты');
      setMessageVariants(data.variants || []);
      setShowVariants(true);
    } catch (e: any) {
      const message = String(e.message || e);
      if (message.includes('reported as leaked') || message.includes('PERMISSION_DENIED')) {
        setVariantsError('Gemini ключ заблокирован Google как скомпрометированный. Создай новый ключ в AI Studio и сохрани его в Настройках.');
      } else if (message.includes('Нет API ключа')) {
        setVariantsError('Нет AI ключа. Добавь Gemini API ключ во вкладке Настройки.');
      } else {
        setVariantsError('Ошибка генерации: ' + message);
      }
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  // Polling stealth статуса
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const poll = async () => {
      try {
        const res = await fetch('/api/broadcast/stealth-status');
        const data = await res.json();
        if (data.status !== 'idle') {
          setStealthStatus(data);
          if (data.log?.length) {
            setSentPhones(prev => {
              const next = new Set(prev);
              data.log.filter((l: any) => l.status === 'sent').forEach((l: any) => next.add(normalizeBroadcastPhone(l.phone)));
              return next;
            });
            setNoTelegramPhones(prev => {
              const next = new Map(prev);
              data.log.filter((l: any) => l.status === 'no_tg').forEach((l: any) => {
                const phone = normalizeBroadcastPhone(l.phone);
                if (phone && !next.has(phone)) next.set(phone, new Date().toISOString());
              });
              return next;
            });
          }
          if (['done', 'stopped', 'waiting_accounts', 'error'].includes(data.status)) {
            setIsSending(false);
            if (data.status === 'done') clearInterval(timer);
          }
        }
      } catch {}
    };
    poll();
    timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleCheckTg = async () => {
    const phonesToCheck = clients
      .filter(c => !noTelegramPhones.has(normalizeBroadcastPhone(c.phone)))
      .map(c => c.phone);
    if (!phonesToCheck.length || !tgStatus.authorized) return;
    setIsCheckingTg(true);
    setCheckTgProgress('Запускаем...');
    try {
      const res = await fetch('/api/broadcast/check-tg-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones: phonesToCheck })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCheckTgProgress(`0 / ${data.total}`);
    } catch (e: any) {
      setCheckTgProgress('Ошибка: ' + e.message);
      setIsCheckingTg(false);
    }
  };

  const handleSend = async () => {
    if (!message.trim() || selected.size === 0 || !tgStatus?.authorized) return;
    setIsSending(true);
    setSendDebug(`Готовлю рассылку: ${selected.size} клиентов, фото: ${images.length}`);
    setResult(null);
    setSendLog([]);

    const TEST_PHONE = '89196977790'; // всегда получает тест
    const TEST_NORM = normalizeBroadcastPhone(TEST_PHONE);

    try {
      const phones = [TEST_PHONE, ...Array.from(selected).filter(p => normalizeBroadcastPhone(p) !== TEST_NORM)];
      const allVariants = [message, ...messageVariants].filter(Boolean);
      const imageFiles: Array<{ base64: string; name: string }> = [];
      for (const img of images) {
        setSendDebug(`Обрабатываю фото: ${img.name}`);
        const prepared = await fileToJpegData(img);
        imageFiles.push({ base64: prepared.base64, name: prepared.name });
      }
      setSendDebug(`Запускаю API: ${phones.length} номеров`);
      const response = await fetch('/api/broadcast/stealth-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones, messageVariants: allVariants, images: imageFiles, contactButton, delayMinutes: sendIntervalMinutes })
      });
      const raw = await response.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Сервер вернул не JSON: ${raw.slice(0, 160) || response.status}`);
      }
      if (!response.ok) throw new Error(data.error || `Ошибка API ${response.status}`);
      if (data.error) throw new Error(data.error);
      setStealthStatus({ status: 'running', sent: 0, failed: 0, checked: 0, total: data.total, delayMinutes: data.delayMinutes || sendIntervalMinutes });
      setSendDebug(`Запущено: ${data.total} номеров`);
    } catch (e: any) {
      setResult({ error: e.message });
      setSendDebug(`Ошибка: ${e.message}`);
      setIsSending(false);
    } finally {
      // Фоновая рассылка сама обновит состояние через polling.
    }
  };

  const activeSentSet = useMemo(() => (
    selectedBroadcast
      ? new Set((broadcastHistory.find(b => b.id === selectedBroadcast)?.phones || []).map(p => normalizeBroadcastPhone(p)))
      : sentPhones
  ), [broadcastHistory, selectedBroadcast, sentPhones]);

  const filteredClients = useMemo(() => clients.filter(c => {
    const phone = normalizeBroadcastPhone(c.phone || '');
    const wasSent = activeSentSet.has(phone);
    const noTg = noTelegramPhones.has(phone);
    if (clientFilter === 'unsent' && (wasSent || noTg)) return false;
    if (clientFilter === 'sent' && !wasSent) return false;
    if (clientFilter === 'no_tg' && !noTg) return false;
    // 'all' — без фильтрации
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (c.fullName || c.name || '').toLowerCase();
    return name.includes(q) || phone.includes(q);
  }), [activeSentSet, clientFilter, clients, noTelegramPhones, search]);

  const filteredPhones = useMemo(() => filteredClients.map(c => c.phone || c.userId), [filteredClients]);
  const selectedFilteredCount = useMemo(
    () => filteredPhones.reduce((count, phone) => count + (selected.has(phone) ? 1 : 0), 0),
    [filteredPhones, selected]
  );
  const allFilteredSelected = filteredPhones.length > 0 && selectedFilteredCount === filteredPhones.length;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;
  const visibleClients = useMemo(() => filteredClients.slice(0, visibleClientCount), [filteredClients, visibleClientCount]);
  const sendDisabledReason = useMemo(() => {
    if (!tgStatus.authorized) return 'Сначала подключи Telegram аккаунт';
    if (!message.trim()) return 'Напиши текст сообщения';
    if (selected.size === 0) return 'Выбери клиентов для рассылки';
    if (isSending) return 'Рассылка уже идет';
    return '';
  }, [isSending, message, selected.size, tgStatus.authorized]);
  const clientByPhone = useMemo(() => {
    const map = new Map<string, any>();
    clients.forEach(client => {
      const normalized = normalizeBroadcastPhone(client.phone || client.userId || '');
      if (normalized) map.set(normalized, client);
    });
    return map;
  }, [clients]);
  const charCount = message.length;
  const stealthAccountStats = Array.from(
    (stealthStatus?.log || []).reduce((map, entry) => {
      if (entry.status === 'sent' && entry.account) map.set(entry.account, (map.get(entry.account) || 0) + 1);
      return map;
    }, new Map<string, number>())
  );
  const lastStealthErrors = (stealthStatus?.log || [])
    .filter(entry => entry.status !== 'sent' && entry.error)
    .slice(-3);
  const formatLogContact = (phone: string, fallbackName?: string) => {
    const normalized = normalizeBroadcastPhone(phone);
    const client = clientByPhone.get(normalized);
    const name = client?.fullName || client?.name || fallbackName || 'Без имени';
    return { name, phone: normalized || phone };
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 font-sans text-zinc-900">
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="tg-card bg-white border border-zinc-100 shadow-sm overflow-hidden flex-1 min-w-0"
      >
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500 rounded-xl shadow-lg shadow-blue-500/20">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1">Рассылки</h3>
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Telegram напрямую</p>
            </div>
          </div>
          <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl">
            {(['compose', 'settings'] as const).map(tab => (
              <button key={tab} onClick={() => {
                setActiveTab(tab);
                const path = tab === 'settings' ? '/broadcast/settings' : '/broadcast';
                if (window.location.pathname !== path) window.history.pushState({}, '', path);
              }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  activeTab === tab ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"
                )}
              >
                {tab === 'compose' ? 'Рассылка' : 'Настройки'}
              </button>
            ))}
          </div>
        </div>

        {/* Настройки — авторизация Telegram */}
        {activeTab === 'settings' && (
          <div className="p-4 space-y-4">

            {/* Список аккаунтов */}
            <div className="space-y-1">
              <div className="flex items-center justify-between ml-1 mb-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">
                  Telegram аккаунты ({tgStatus.accounts.filter(a => a.active).length}/{tgStatus.accounts.length} вкл)
                </label>
                {tgStatus.accounts.length > 0 && (
                  <span className="text-[9px] text-zinc-400">каждые 20 сообщений — смена аккаунта</span>
                )}
              </div>
              {tgStatus.accounts.length === 0 ? (
                <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-center text-[10px] text-zinc-400">
                  Нет аккаунтов — добавь первый
                </div>
              ) : (
                <div className="border border-zinc-100 rounded-xl overflow-hidden">
                  {tgStatus.accounts.map((acc, i) => (
                    <div key={acc.phone} className="border-b border-zinc-50 last:border-b-0">
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-black text-blue-600">{i + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-zinc-900 font-mono">{acc.phone}</p>
                          <p className="text-[9px] text-zinc-400">{new Date(acc.addedAt).toLocaleDateString('ru')}</p>
                          {(() => {
                            const sentCount = accountStats.get(acc.phone.replace('+', '')) || 0;
                            if (sentCount > 0) return (
                              <p className="text-[9px] text-zinc-400">
                                📤 {sentCount} отпр.{(acc as any).bannedAt ? ` · 🔒 ${new Date((acc as any).bannedAt).toLocaleDateString('ru')}` : ''}
                              </p>
                            );
                            if ((acc as any).bannedAt) return (
                              <p className="text-[9px] text-red-400">🔒 Заморожен {new Date((acc as any).bannedAt).toLocaleDateString('ru')}</p>
                            );
                            return null;
                          })()}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("text-[8px] font-black uppercase", acc.active ? "text-emerald-500" : "text-zinc-300")}>
                            {acc.active ? 'активен' : 'выкл'}
                          </span>
                          <button
                            onClick={() => handleSetAccountActive(acc.phone, true, true)}
                            disabled={savingActiveAccount === acc.phone}
                            className="px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-[8px] font-black uppercase hover:bg-blue-100 transition-all disabled:opacity-40"
                            title="Оставить включенным только этот аккаунт"
                          >
                            Только
                          </button>
                          <button
                            onClick={() => handleSetAccountActive(acc.phone, !acc.active)}
                            disabled={savingActiveAccount === acc.phone}
                            className={cn(
                              "px-2 py-1 rounded-md text-[8px] font-black uppercase transition-all disabled:opacity-40",
                              acc.active ? "bg-zinc-100 text-zinc-500 hover:bg-zinc-200" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                            )}
                          >
                            {savingActiveAccount === acc.phone ? '...' : acc.active ? 'Выкл' : 'Вкл'}
                          </button>
                          <button onClick={() => handleRemoveAccount(acc.phone)}
                            className="text-red-400 hover:text-red-600 transition-colors">
                            <XCircle size={14} />
                          </button>
                        </div>
                      </div>
                      <ProxyField
                        phone={acc.phone}
                        initialValue={proxyInputs[acc.phone] || ''}
                        hasProxy={!!acc.proxy}
                        isSaving={savingProxy === acc.phone}
                        onSave={handleSaveProxy}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Имя отправителя */}
            <SenderNameField
              initialValue={displayName}
              isSaving={isSavingName}
              onSave={handleSaveDisplayName}
            />

            {/* Фото профиля аккаунтов */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Фото профиля аккаунтов</label>
              <p className="text-[9px] text-zinc-400 ml-1">Загрузи фото — поставится на все активные аккаунты</p>
              <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${isSettingPhoto ? 'border-blue-300 bg-blue-50' : 'border-zinc-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                <input type="file" accept="image/*" className="hidden" onChange={handleSetPhoto} disabled={isSettingPhoto} />
                {isSettingPhoto
                  ? <><Loader2 size={14} className="animate-spin text-blue-500" /><span className="text-[10px] font-bold text-blue-500">Устанавливаю...</span></>
                  : <><Image size={14} className="text-zinc-400" /><span className="text-[10px] font-bold text-zinc-500">Выбрать фото профиля</span></>
                }
              </label>
              {photoResult && (
                <p className="text-[10px] font-medium ml-1" style={{ color: photoResult.includes('Ошибка') ? '#ef4444' : '#22c55e' }}>{photoResult}</p>
              )}
            </div>

            {/* .session файл — Telethon/Pyrogram */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Добавить покупной аккаунт (.session файл)</label>
              <p className="text-[9px] text-zinc-400 ml-1">Загрузи .session файл от купленного аккаунта (Telethon / Pyrogram)</p>
              <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${isUploadingFile ? 'border-blue-300 bg-blue-50' : 'border-zinc-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                <input
                  type="file"
                  accept=".session,.json"
                  className="hidden"
                  multiple
                  onChange={handleSessionFileUpload}
                  disabled={isUploadingFile}
                />
                {isUploadingFile
                  ? <><Loader2 size={14} className="animate-spin text-blue-500" /><span className="text-[10px] font-bold text-blue-500">Загружаю...</span></>
                  : <><Smartphone size={14} className="text-zinc-400" /><span className="text-[10px] font-bold text-zinc-500">Выбрать .session файлы (можно несколько)</span></>
                }
              </label>
              {fileUploadError && (
                <p className="text-[10px] text-red-500 font-medium ml-1">{fileUploadError}</p>
              )}
            </div>

            {/* Массовая загрузка сессий */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Массовая загрузка аккаунтов</label>
              <p className="text-[9px] text-zinc-400 ml-1">Вставь несколько StringSession строк — каждая с новой строки</p>
              <textarea
                value={bulkSessions}
                onChange={e => setBulkSessions(e.target.value)}
                placeholder={"1AgAOMTQ5LjE1NC4xNjcuNDEB...\n1BgAOMTQ5LjE1NC4xNjcuNDEC...\n1CgAOMTQ5LjE1NC4xNjcuNDED..."}
                rows={5}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all resize-none"
              />
              {bulkResult && (
                <p className="text-[10px] font-medium ml-1" style={{ color: bulkResult.includes('Добавлено') ? '#22c55e' : '#ef4444' }}>{bulkResult}</p>
              )}
              <button onClick={handleBulkAddSessions} disabled={isBulkAdding || !bulkSessions.trim()}
                className="w-full py-2.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black hover:bg-emerald-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {isBulkAdding ? <Loader2 size={12} className="animate-spin" /> : null}
                {isBulkAdding ? 'Проверяю...' : 'Загрузить все аккаунты'}
              </button>
            </div>

            {/* StringSession — добавить купленный аккаунт */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Или вставить одну StringSession строку</label>
              <textarea
                value={sessionInput}
                onChange={e => setSessionInput(e.target.value)}
                placeholder="1AgAOMTQ5LjE1NC4xNjcuNDEB..."
                rows={3}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all resize-none"
              />
              {sessionError && (
                <p className="text-[10px] text-red-500 font-medium ml-1">{sessionError}</p>
              )}
              <button onClick={handleAddSession} disabled={isAddingSession || !sessionInput.trim()}
                className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-[10px] font-black hover:bg-blue-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {isAddingSession ? <Loader2 size={12} className="animate-spin" /> : null}
                Добавить аккаунт
              </button>
            </div>

            {/* Добавить аккаунт через телефон */}
            <div className="space-y-3">
              <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                {tgStatus.accounts.length === 0 ? 'Или авторизовать свой номер' : 'Или добавить свой номер'}
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Номер телефона</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={authPhone}
                      onChange={e => setAuthPhone(e.target.value)}
                      placeholder="+79001234567"
                      disabled={authStep !== 'idle'}
                      className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all disabled:opacity-50"
                    />
                    <button
                      onClick={handleSendCode}
                      disabled={isAuthLoading || authStep !== 'idle' || !authPhone}
                      className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-[10px] font-black hover:bg-blue-600 transition-all disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {isAuthLoading && authStep === 'idle' ? <Loader2 size={12} className="animate-spin" /> : null}
                      Получить код
                    </button>
                  </div>
                </div>

                {authStep === 'code_sent' && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Код из Telegram</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={authCode}
                        onChange={e => setAuthCode(e.target.value)}
                        placeholder="12345"
                        className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                      />
                      <button
                        onClick={handleSignIn}
                        disabled={isAuthLoading || !authCode}
                        className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black hover:bg-emerald-600 transition-all disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {isAuthLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                        Войти
                      </button>
                    </div>
                  </div>
                )}

                {authStep === 'needs_2fa' && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Пароль двухфакторной аутентификации</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={authTwoFa}
                        onChange={e => setAuthTwoFa(e.target.value)}
                        placeholder="••••••••"
                        className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                      />
                      <button
                        onClick={handleSignIn}
                        disabled={isAuthLoading || !authTwoFa}
                        className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black hover:bg-emerald-600 transition-all disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {isAuthLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                        Подтвердить
                      </button>
                    </div>
                  </div>
                )}

                {authError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex gap-2">
                    <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-700 font-medium">{authError}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Gemini API ключ */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Google Gemini · Генерация вариантов</label>
                {geminiConfigured && <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">✓ настроен</span>}
              </div>
              <p className="text-[9px] text-zinc-400 ml-1">API ключ из <span className="font-bold">aistudio.google.com</span> — бесплатно, используется для генерации 9 вариантов сообщений</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                />
                <button
                  onClick={async () => {
                    if (!geminiKey.trim()) return;
                    setIsSavingGemini(true);
                    setGeminiSaveResult('');
                    try {
                      await setDoc(doc(db, 'settings', 'ai_config'), { geminiKey: geminiKey.trim() }, { merge: true });
                      setGeminiSaveResult('Сохранено!');
                      setGeminiConfigured(true);
                      setGeminiKey('');
                    } catch (e: any) {
                      setGeminiSaveResult('Ошибка: ' + e.message);
                    } finally {
                      setIsSavingGemini(false);
                    }
                  }}
                  disabled={isSavingGemini || !geminiKey.trim()}
                  className="px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isSavingGemini ? <Loader2 size={12} className="animate-spin" /> : null}
                  Сохранить
                </button>
              </div>
              {geminiSaveResult && (
                <p className="text-[10px] font-medium ml-1" style={{ color: geminiSaveResult.includes('Ошибка') ? '#ef4444' : '#22c55e' }}>{geminiSaveResult}</p>
              )}
            </div>

            {/* Точка Банк — JWT токен */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Точка Банк · QR-оплата</label>
                {tochkaConfigured && <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">✓ настроен</span>}
              </div>
              <p className="text-[9px] text-zinc-400 ml-1">Вставь JWT токен из личного кабинета Точки для создания QR-ссылок при оформлении заказов</p>
              <textarea
                value={tochkaToken}
                onChange={e => setTochkaToken(e.target.value)}
                placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6..."
                rows={3}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all resize-none"
              />
              <input
                value={tochkaMerchantId}
                onChange={e => setTochkaMerchantId(e.target.value)}
                placeholder="merchantId, если торговых точек несколько"
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
              />
              {tochkaSaveResult && (
                <p className="text-[10px] font-medium ml-1" style={{ color: tochkaSaveResult.includes('Ошибка') ? '#ef4444' : '#22c55e' }}>{tochkaSaveResult}</p>
              )}
              <button
                onClick={async () => {
                  if (!tochkaToken.trim()) return;
                  setIsSavingTochka(true);
                  setTochkaSaveResult('');
                  try {
                    const res = await fetch('/api/tochka/save-token', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        jwtToken: tochkaToken.trim(),
                        merchantId: tochkaMerchantId.trim(),
                        paymentMode: ['sbp'],
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Ошибка');
                    setTochkaSaveResult(`Сохранено! Код клиента: ${data.customerCode}`);
                    setTochkaConfigured(true);
                    setTochkaToken('');
                    setTochkaMerchantId('');
                  } catch (e: any) {
                    setTochkaSaveResult(`Ошибка: ${e.message}`);
                  } finally {
                    setIsSavingTochka(false);
                  }
                }}
                disabled={isSavingTochka || !tochkaToken.trim()}
                className="w-full py-2.5 bg-violet-600 text-white rounded-xl text-[10px] font-black hover:bg-violet-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {isSavingTochka ? <><span className="animate-spin">⟳</span> Сохраняем...</> : 'Сохранить токен'}
              </button>
            </div>
          </div>
        )}

        {/* Рассылка */}
        {activeTab === 'compose' && (
          <div className="space-y-4">

            {/* Sticky кнопка отправить */}
            <div className="sticky top-12 z-10 bg-white border-b border-zinc-100 px-4 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 space-y-1">
                <button
                  onClick={handleSend}
                  disabled={!!sendDisabledReason}
                  className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-500/20"
                >
                  {isSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {isSending ? 'Отправляем...' : `Отправить${selected.size > 0 ? ` (${selected.size})` : ''}`}
                </button>
                {sendDisabledReason && !isSending && (
                  <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-600">
                    <AlertCircle size={11} />
                    {sendDisabledReason}
                  </div>
                )}
                {sendDebug && (
                  <div className={cn(
                    "flex items-center gap-1.5 text-[9px] font-bold",
                    sendDebug.startsWith('Ошибка') ? "text-red-500" : "text-blue-500"
                  )}>
                    {isSending && !sendDebug.startsWith('Ошибка') ? <Loader2 size={11} className="animate-spin" /> : <AlertCircle size={11} />}
                    {sendDebug}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 sm:flex sm:shrink-0 p-1 bg-zinc-100 rounded-xl">
                {([2, 5, 10] as const).map(minutes => (
                  <button
                    key={minutes}
                    onClick={() => setSendIntervalMinutes(minutes)}
                    title={`Пауза ${minutes} мин между отправками с одного аккаунта`}
                    className={cn(
                      "px-3 py-2 rounded-lg text-[9px] font-black uppercase transition-all",
                      sendIntervalMinutes === minutes ? "bg-violet-500 text-white shadow-sm" : "bg-white text-zinc-500 hover:text-zinc-800"
                    )}
                  >
                    {minutes} мин
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 space-y-4">

            <div className="space-y-1">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Текст сообщения</label>
                <span className={cn("text-[9px] font-black", charCount > 160 ? "text-amber-500" : "text-zinc-300")}>
                  {charCount}/160
                </span>
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Привет! У нас новая коллекция — смотри в Instagram 🤍"
                rows={4}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all resize-none"
              />
            </div>

            {/* 9 вариантов сообщений */}
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ml-1">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">
                  Варианты сообщений (1–9) — при рассылке каждому отправится случайный
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateVariants}
                    disabled={isGeneratingVariants || !message.trim()}
                    title={!message.trim() ? 'Сначала напиши текст сообщения' : 'Сгенерировать 9 вариантов'}
                    className="flex items-center gap-1 px-2 py-1 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                  >
                    {isGeneratingVariants ? <Loader2 size={9} className="animate-spin" /> : '✨'}
                    {isGeneratingVariants ? 'Генерация...' : 'Авто AI'}
                  </button>
                  <button
                    onClick={() => setMessageVariants(Array(9).fill(''))}
                    className="px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all"
                  >
                    Очистить
                  </button>
                </div>
              </div>
              {variantsError && (
                <div className="ml-1 p-2 bg-red-50 border border-red-100 rounded-lg text-[10px] font-semibold text-red-600">
                  {variantsError}
                </div>
              )}
              <div className="space-y-1.5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-[8px] font-black text-violet-400 shrink-0 mt-2.5 w-3 text-right">{i + 1}</span>
                    <textarea
                      value={messageVariants[i] || ''}
                      onChange={e => setMessageVariants(prev => {
                        const next = [...prev];
                        while (next.length <= i) next.push('');
                        next[i] = e.target.value;
                        return next;
                      })}
                      rows={2}
                      placeholder={`Вариант ${i + 1}...`}
                      className="flex-1 bg-violet-50 border border-violet-100 rounded-lg px-2 py-1.5 text-[10px] resize-none focus:outline-none focus:ring-1 focus:ring-violet-300 placeholder:text-zinc-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Кнопка под сообщением */}
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <p className="text-[10px] font-bold text-zinc-700">Кнопка "Написать менеджеру"</p>
                <p className="text-[9px] text-zinc-400">Ссылка на @YAASBAE_CLO_bot под каждым сообщением</p>
              </div>
              <button onClick={() => setContactButton(v => !v)}
                className={cn("w-10 h-6 rounded-full transition-all relative shrink-0", contactButton ? "bg-blue-500" : "bg-zinc-200")}>
                <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all", contactButton ? "left-5" : "left-1")} />
              </button>
            </div>

            {/* Фото — несколько */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Фото (необязательно, можно несколько)</label>
              <div className="flex items-center gap-2 flex-wrap">
                {imagePreviews.map((src, idx) => (
                  <div key={idx} className="relative">
                    <img src={src} alt="" className="w-14 h-14 rounded-xl object-cover border border-zinc-200" />
                    <button onClick={() => handleRemoveImage(idx)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center">
                      <XCircle size={10} />
                    </button>
                  </div>
                ))}
                <label className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 border-dashed rounded-xl cursor-pointer hover:bg-zinc-100 transition-all text-[10px] font-bold text-zinc-500">
                  <Image size={14} className="text-zinc-400" />
                  {images.length === 0 ? 'Добавить фото' : '+ ещё'}
                  <input type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                  Клиенты ({selected.size} выбрано · {filteredClients.length} в фильтре{search ? ` / ${clients.length}` : ''})
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <button onClick={() => handleSelectFirst(10)} className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">
                    Выбрать 10
                  </button>
                  <button onClick={() => handleSelectFirst(20)} className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">
                    Выбрать 20
                  </button>
                  <span className="text-zinc-200">|</span>
                  <button onClick={handleSelectAll} className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">
                    {allFilteredSelected ? 'Снять всё' : `Весь фильтр (${filteredClients.length})`}
                  </button>
                </div>
              </div>

              {/* Фильтр: не отправляли / отправляли */}
              <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-xl w-full sm:w-fit">
                <button onClick={() => { setClientFilter('all'); setSelectedBroadcast(null); setSelected(new Set()); setVisibleClientCount(50); setLastSelectedClientIndex(null); }}
                  className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    clientFilter === 'all' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                  Все ({clients.length})
                </button>
                <button onClick={() => { setClientFilter('unsent'); setSelectedBroadcast(null); setSelected(new Set()); setVisibleClientCount(50); setLastSelectedClientIndex(null); }}
                  className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    clientFilter === 'unsent' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                  Не отправляли
                </button>
                <button onClick={() => { setClientFilter('sent'); setSelectedBroadcast(null); setSelected(new Set()); setVisibleClientCount(50); setLastSelectedClientIndex(null); }}
                  className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    clientFilter === 'sent' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                  Отправляли
                </button>
                {noTelegramPhones.size > 0 && (
                  <button onClick={() => { setClientFilter('no_tg'); setSelected(new Set()); setVisibleClientCount(50); setLastSelectedClientIndex(null); }}
                    className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                      clientFilter === 'no_tg' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                    Нет TG ({noTelegramPhones.size})
                  </button>
                )}
              </div>
              {/* Кнопка проверки TG */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCheckTg}
                  disabled={isCheckingTg || !tgStatus.authorized}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                >
                  {isCheckingTg ? <Loader2 size={10} className="animate-spin" /> : <Smartphone size={10} />}
                  Проверить TG
                </button>
                {checkTgProgress && (
                  <span className="text-[9px] text-zinc-400">{checkTgProgress}</span>
                )}
              </div>

              {/* История рассылок — timeline */}
              {clientFilter === 'sent' && broadcastHistory.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">История рассылок</p>
                  <div className="flex flex-col gap-1">
                    {broadcastHistory.map(b => {
                      const daysAgo = Math.floor((Date.now() - new Date(b.sentAt).getTime()) / 86400000);
                      const label = daysAgo === 0 ? 'Сегодня' : daysAgo === 1 ? '1 день назад' : `${daysAgo} дней назад`;
                      const isActive = selectedBroadcast === b.id;
                      return (
                        <button key={b.id} onClick={() => setSelectedBroadcast(isActive ? null : b.id)}
                          className={cn("flex items-center justify-between px-3 py-2 rounded-xl border text-left transition-all",
                            isActive ? "bg-blue-50 border-blue-200" : "bg-zinc-50 border-zinc-100 hover:border-zinc-200")}>
                          <div>
                            <p className={cn("text-[11px] font-bold", isActive ? "text-blue-700" : "text-zinc-700")}>{label}</p>
                            <p className="text-[9px] text-zinc-400 truncate max-w-xs">{b.message.slice(0, 50)}{b.message.length > 50 ? '…' : ''}</p>
                          </div>
                          <span className={cn("text-[10px] font-black shrink-0 ml-2", isActive ? "text-blue-500" : "text-zinc-400")}>
                            {b.sentCount} чел.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {clientFilter === 'sent' && broadcastHistory.length === 0 && (
                <p className="text-[10px] text-zinc-400 ml-1">Рассылок ещё не было</p>
              )}

              {/* Поиск */}
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setVisibleClientCount(50); setLastSelectedClientIndex(null); }}
                  placeholder="Поиск по имени или телефону..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-4 py-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                />
              </div>

              {isLoadingClients ? (
                <div className="py-8 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-zinc-300" />
                </div>
              ) : (
                <div className="border border-zinc-100 rounded-xl overflow-hidden">
                  {/* Заголовок колонок */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border-b border-zinc-100">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded shrink-0 accent-blue-500 cursor-pointer"
                      checked={allFilteredSelected}
                      ref={el => { if (el) el.indeterminate = someFilteredSelected; }}
                      onChange={e => {
                        setSelected(e.target.checked ? new Set(filteredPhones) : new Set());
                      }}
                    />
                    <div className="flex-1 text-[8px] font-black text-zinc-400 uppercase tracking-widest">Клиент</div>
                    <div className="w-20 text-right text-[8px] font-black text-zinc-400 uppercase tracking-widest">Сумма</div>
                    <div className="w-16 text-right text-[8px] font-black text-zinc-400 uppercase tracking-widest">Отправляли</div>
                  </div>
                  {visibleClients.map((client, i) => {
                    const phone = client.phone || client.userId;
                    const clientIndex = i;
                    const isSelected = selected.has(phone);
                    const key = normalizeBroadcastPhone(phone).slice(-10);
                    const rev = clientRevenue.get(key) || 0;
                    const ords = clientOrders.get(key) || 0;
                    const wasSent = activeSentSet.has(normalizeBroadcastPhone(phone));
                    return (
                      <div
                        key={phone}
                        onClick={e => handleToggle(phone, clientIndex, e.shiftKey)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors border-b border-zinc-100 last:border-b-0",
                          isSelected ? "bg-blue-50" : "hover:bg-zinc-50"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                          isSelected ? "bg-blue-500 border-blue-500" : "border-zinc-200"
                        )}>
                          {isSelected && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-zinc-900 truncate">{client.fullName || client.name || 'Без имени'}</p>
                          <p className="text-[10px] text-zinc-400 font-mono mt-0.5">+{phone}</p>
                        </div>
                        {/* Колонка: сумма */}
                        <div className="flex flex-col items-end gap-0.5 shrink-0 w-20 text-right">
                          {rev > 0 ? (
                            <>
                              <span className="text-[11px] font-black text-zinc-900">{rev.toLocaleString('ru')} ₽</span>
                              <span className="text-[9px] text-zinc-400">{ords} {ords === 1 ? 'заказ' : ords < 5 ? 'заказа' : 'заказов'}</span>
                            </>
                          ) : (
                            <span className="text-[10px] text-zinc-300">нет заказов</span>
                          )}
                        </div>
                        {/* Колонка: уже отправляли */}
                        <div className="shrink-0 w-16 flex justify-end">
                          {wasSent ? (() => {
                            const sentAt = sentDates.get(normalizeBroadcastPhone(phone));
                            const daysAgo = sentAt ? Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000) : null;
                            const label = daysAgo === null ? '✓ было' : daysAgo === 0 ? 'сегодня' : `${daysAgo} д.`;
                            return <span className="text-[9px] font-black text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md">{label}</span>;
                          })()
                            : <span className="text-[9px] text-zinc-200">—</span>
                          }
                        </div>
                      </div>
                    );
                  })}
                  {filteredClients.length > 50 && (
                    <button
                      onClick={() => {
                        if (visibleClientCount >= filteredClients.length) setVisibleClientCount(50);
                        else setVisibleClientCount(prev => Math.min(prev + 50, filteredClients.length));
                      }}
                      className="w-full py-2.5 text-[9px] font-black text-zinc-400 hover:text-zinc-700 uppercase tracking-widest flex items-center justify-center gap-1 bg-zinc-50"
                    >
                      {visibleClientCount >= filteredClients.length ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {visibleClientCount >= filteredClients.length
                        ? 'Свернуть до 50'
                        : `Показать ещё ${Math.min(50, filteredClients.length - visibleClientCount)}`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {!tgStatus.authorized && (
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex gap-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-700 font-bold">Сначала добавь Telegram аккаунт во вкладке "Настройки"</p>
              </div>
            )}

            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-4 rounded-xl border space-y-3",
                    result.error ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-100"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {result.error
                      ? <XCircle size={16} className="text-red-500" />
                      : <CheckCircle2 size={16} className="text-emerald-500" />
                    }
                    <p className="text-[11px] font-black">
                      {result.error ? 'Ошибка' : `Отправлено: ${result.sent} / Ошибок: ${result.failed}`}
                    </p>
                  </div>
                  {result.error && (
                    <p className="text-[10px] text-red-600 font-mono">{JSON.stringify(result.error)}</p>
                  )}
                  {result.results && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {result.results.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          {r.status === 'sent'
                            ? <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                            : <XCircle size={10} className="text-red-400 shrink-0" />
                          }
                          <span className="font-mono text-zinc-500">+{r.phone}</span>
                          {r.error && <span className="text-red-400 truncate">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            </div>{/* /px-4 */}
          </div>
        )}
      </motion.div>

      {/* Боковой sticky лог */}
      <div className="w-full lg:w-72 shrink-0 lg:sticky lg:top-16 self-start space-y-3">

        {/* Stealth прогресс */}
        {stealthStatus && stealthStatus.status !== 'idle' && (
          <div className="bg-white border border-violet-100 shadow-sm rounded-2xl overflow-hidden">
            <div className="px-3 py-2.5 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
              <span className="text-[9px] font-black text-violet-600 uppercase tracking-widest">Рассылка</span>
              <div className="flex items-center gap-2">
                {stealthStatus.status === 'running' && <Loader2 size={12} className="animate-spin text-violet-400" />}
                {stealthStatus.status === 'done' && <span className="text-[9px] font-black text-emerald-500">Готово</span>}
                {stealthStatus.status === 'stopped' && <span className="text-[9px] font-black text-zinc-500">Остановлено</span>}
                {stealthStatus.status === 'waiting_accounts' && <span className="text-[9px] font-black text-amber-500">Пауза</span>}
                {stealthStatus.status === 'error' && <span className="text-[9px] font-black text-red-500">Ошибка</span>}
                {stealthStatus.status === 'running' && (
                  <button onClick={async () => {
                    await fetch('/api/broadcast/stealth-stop', { method: 'POST' }).catch(() => {});
                    setStealthStatus(prev => prev ? { ...prev, status: 'stopped' } : prev);
                  }} className="px-2 py-0.5 bg-red-500 text-white rounded text-[8px] font-black hover:bg-red-600">
                    Стоп
                  </button>
                )}
              </div>
            </div>
            <div className="px-3 py-3 space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-zinc-500">Обработано</span>
                <span className="font-black">{stealthStatus.checked} / {stealthStatus.total}</span>
              </div>
              <div className="w-full bg-zinc-100 rounded-full h-1.5">
                <div className="bg-violet-500 h-1.5 rounded-full transition-all" style={{ width: `${stealthStatus.total ? (stealthStatus.checked / stealthStatus.total) * 100 : 0}%` }} />
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-emerald-500 font-black">{stealthStatus.sent}✓ отправлено</span>
                <span className="text-red-400 font-black">{stealthStatus.failed}✗</span>
              </div>
              {stealthAccountStats.length > 0 && (
                <div className="border-t border-violet-50 pt-2 space-y-1">
                  <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest text-center">Отправлено с аккаунтов</p>
                  {stealthAccountStats.map(([account, count]) => (
                    <div key={account} className="flex items-center justify-between gap-2 text-[9px]">
                      <span className="font-mono text-zinc-500 truncate">{account}</span>
                      <span className="font-black text-violet-600 shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
              )}
              {stealthStatus.status === 'running' && stealthStatus.currentAccount && (
                <p className="text-[8px] text-zinc-400 text-center">
                  Аккаунт: {stealthStatus.currentAccount} · {stealthStatus.delayMinutes || sendIntervalMinutes} мин между отправками
                </p>
              )}
              {stealthStatus.status === 'waiting_accounts' && (
                <div className="space-y-2">
                  <p className="text-[9px] text-amber-600 font-bold text-center">Все аккаунты забанены</p>
                  <p className="text-[8px] text-zinc-400 text-center">Добавь новые аккаунты в Настройки</p>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch('/api/broadcast/stealth-resume', { method: 'POST' });
                        const d = await r.json();
                        if (d.error) alert(d.error);
                        else setStealthStatus(prev => prev ? { ...prev, status: 'running' } : prev);
                      } catch {}
                    }}
                    className="w-full py-1.5 bg-violet-500 text-white rounded-lg text-[9px] font-black hover:bg-violet-600 transition-all"
                  >
                    Продолжить с позиции {stealthStatus.checked}
                  </button>
                </div>
              )}
              {lastStealthErrors.length > 0 && (
                <div className="border-t border-violet-50 pt-2 space-y-1">
                  <p className="text-[8px] font-black text-red-400 uppercase tracking-widest text-center">Последние ошибки</p>
                  {lastStealthErrors.map((entry, idx) => (
                    <div key={idx} className="rounded-lg bg-red-50 px-2 py-1 text-[8px] font-semibold text-red-500">
                      +{normalizeBroadcastPhone(entry.phone)} · {friendlyError(entry.error || '')}
                    </div>
                  ))}
                </div>
              )}
              {['done', 'stopped', 'error'].includes(stealthStatus.status) && (
                <button
                  onClick={async () => {
                    await fetch('/api/broadcast/stealth-clear', { method: 'POST' }).catch(() => {});
                    setStealthStatus(null);
                    setSendLog([]);
                  }}
                  className="w-full py-1.5 bg-zinc-100 text-zinc-500 rounded-lg text-[9px] font-black hover:bg-zinc-200 transition-all"
                >
                  Очистить статус
                </button>
              )}
              {stealthStatus.log && stealthStatus.log.length > 0 && (
                <div className="border-t border-violet-50 pt-2 space-y-1 max-h-48 overflow-y-auto">
                  {[...stealthStatus.log].reverse().map((l, idx) => {
                    const contact = formatLogContact(l.phone, l.name);
                    return (
                      <div key={idx} className={cn("px-2 py-1.5 rounded-lg text-[9px]", l.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                        <div className="flex items-center gap-1">
                          <span className="font-black shrink-0">{l.status === 'sent' ? '✓' : '✗'}</span>
                          <span className="font-bold truncate">{contact.name}</span>
                        </div>
                        <div className="ml-4 mt-0.5 flex items-center gap-1 text-[8px] text-zinc-400">
                          <span className="font-mono truncate">+{contact.phone}</span>
                          {l.account && <span className="shrink-0">через {l.account}</span>}
                        </div>
                        {l.error && <div className="text-[8px] text-red-400 mt-0.5 ml-4 truncate">{friendlyError(l.error)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Лог отправки — всегда виден */}
        <div className="bg-white border border-zinc-100 shadow-sm rounded-2xl overflow-hidden">
          <div className="px-3 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Лог отправки</span>
            {sendLog.length > 0 ? (
              <span className="text-[9px] font-black">
                <span className="text-emerald-500">{sendLog.filter(l => l.status === 'sent').length}✓</span>
                <span className="text-zinc-300 mx-1">/</span>
                <span className="text-red-400">{sendLog.filter(l => l.status !== 'sent').length}✗</span>
              </span>
            ) : isSending ? (
              <Loader2 size={12} className="animate-spin text-blue-400" />
            ) : (
              <span className="text-[9px] text-zinc-300">пусто</span>
            )}
          </div>
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-zinc-50">
            {sendLog.length === 0 && isSending && (
              <div className="px-3 py-4 text-center text-[10px] text-zinc-400">Отправляем...</div>
            )}
            {sendLog.length === 0 && !isSending && (
              <div className="px-3 py-6 text-center text-[10px] text-zinc-300">Здесь появятся результаты</div>
            )}
            {sendLog.map((l, i) => (
              <div key={i} className={cn("px-3 py-2", l.status === 'sent' ? 'bg-white' : 'bg-red-50/50')}>
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[10px] font-black shrink-0", l.status === 'sent' ? 'text-emerald-500' : 'text-red-400')}>
                    {l.status === 'sent' ? '✓' : '✗'}
                  </span>
                  <span className="text-[10px] font-bold text-zinc-700 truncate">{l.name}</span>
                </div>
                <p className="text-[9px] text-zinc-400 mt-0.5 ml-4 font-mono truncate">+{normalizeBroadcastPhone(l.phone)}</p>
                {l.error && <p className="text-[9px] text-red-400 mt-0.5 ml-4 truncate">{friendlyError(l.error)}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Контакты без Telegram — всегда виден */}
        <div className="bg-white border border-zinc-100 shadow-sm rounded-2xl overflow-hidden">
          <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Нет Telegram</span>
            {noTelegramPhones.size > 0
              ? <span className="text-[9px] font-black text-amber-500">{noTelegramPhones.size}</span>
              : <span className="text-[9px] text-amber-300">пусто</span>
            }
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-zinc-50">
            {noTelegramPhones.size === 0 && (
              <div className="px-3 py-5 text-center text-[10px] text-zinc-300">Здесь появятся контакты без TG</div>
            )}
            {clients.filter(c => noTelegramPhones.has(normalizeBroadcastPhone(c.phone))).map((c, i) => {
              const phone = normalizeBroadcastPhone(c.phone);
              const addedAt = noTelegramPhones.get(phone);
              const dateStr = addedAt ? new Date(addedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
              return (
                <div key={i} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[10px] font-bold text-zinc-600 truncate">{c.fullName || c.name}</p>
                    {dateStr && <span className="text-[8px] text-zinc-300 shrink-0">{dateStr}</span>}
                  </div>
                  <p className="text-[9px] text-zinc-400 font-mono">+{c.phone}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      </div>{/* /flex */}
    </div>
  );
};
