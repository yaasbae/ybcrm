import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import {
  Send, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp,
  AlertCircle, LogOut, Smartphone, Search, Image
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { collection, getDocs, addDoc, query, orderBy } from 'firebase/firestore';

interface TgAccount {
  phone: string;
  addedAt: string;
  active: boolean;
}

interface TgStatus {
  authorized: boolean;
  accounts: TgAccount[];
}

interface Props { sheetId?: string; }

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

export const BroadcastPage: React.FC<Props> = ({ sheetId }) => {
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState<'burn' | 'safe'>('safe');
  const [clientRevenue, setClientRevenue] = useState<Map<string, number>>(new Map());
  const [clientOrders, setClientOrders] = useState<Map<string, number>>(new Map());
  const [sentPhones, setSentPhones] = useState<Set<string>>(new Set());
  const [broadcastHistory, setBroadcastHistory] = useState<Array<{ id: string; sentAt: string; phones: string[]; message: string; sentCount: number }>>([]);
  const [selectedBroadcast, setSelectedBroadcast] = useState<string | null>(null);
  const [sendLog, setSendLog] = useState<Array<{ phone: string; name: string; status: 'sent' | 'error'; error?: string }>>([]);
  const [result, setResult] = useState<any>(null);
  const [noTelegramPhones, setNoTelegramPhones] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'compose' | 'settings'>('compose');
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [showAllClients, setShowAllClients] = useState(false);
  const [search, setSearch] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [contactButton, setContactButton] = useState(true);
  const [clientFilter, setClientFilter] = useState<'unsent' | 'sent' | 'no_tg'>('unsent');

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

  const loadTgStatus = async () => {
    try {
      const res = await fetch('/api/tg/auth/status');
      const data = await res.json();
      setTgStatus({ authorized: data.authorized, accounts: data.accounts || [] });
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

  const handleSaveDisplayName = async () => {
    setIsSavingName(true);
    try {
      await fetch('/api/tg/broadcast/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName })
      });
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

  useEffect(() => {
    const loadData = async () => {
      try {
        const [contactsSnap, broadcastsSnap] = await Promise.all([
          getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc'))),
          getDocs(collection(db, 'broadcasts')),
        ]);

        // Only count broadcasts that actually sent messages (sentCount > 0 or phones saved from real sends)
        const sent = new Set<string>();
        const history: typeof broadcastHistory = [];
        broadcastsSnap.docs.forEach(d => {
          const b = d.data() as any;
            if (b.sentCount === undefined) return; // old broadcast saved before fix — skip
          if (b.sentCount === 0) return; // failed broadcast
          (b.phones || []).forEach((p: string) => sent.add(String(p).replace(/\D/g, '')));
          history.push({ id: d.id, sentAt: b.sentAt, phones: b.phones || [], message: b.message || '', sentCount: b.sentCount || b.phones?.length || 0 });
        });
        history.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
        setSentPhones(sent);
        setBroadcastHistory(history);

        // Клиентская база — коллекция contacts, отсортирована по totalSpent
        const revMap = new Map<string, number>();
        const ordMap = new Map<string, number>();
        const data = contactsSnap.docs.map(d => {
          const c = d.data() as any;
          const phone = String(c.phone || d.id || '').replace(/\D/g, '');
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
  }, []);

  const handleSelectFirst20 = () => {
    const first20 = clients.slice(0, 20).map(c => c.phone || c.userId);
    setSelected(new Set(first20));
  };

  const handleSelectAll = () => {
    if (selected.size === clients.length) setSelected(new Set());
    else setSelected(new Set(clients.map(c => c.phone || c.userId)));
  };

  const handleToggle = (phone: string) => {
    const next = new Set(selected);
    if (next.has(phone)) next.delete(phone);
    else next.add(phone);
    setSelected(next);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImages(prev => [...prev, ...files]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setImagePreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    e.target.value = '';
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


  const handleSend = async () => {
    if (!message.trim() || selected.size === 0 || !tgStatus?.authorized) return;
    setIsSending(true);
    setResult(null);
    setSendLog([]);
    try {
      const phones = Array.from(selected);
      const imageFiles: Array<{ base64: string; name: string }> = [];
      for (const img of images) {
        const base64 = await new Promise<string>(res => {
          const canvas = document.createElement('canvas');
          const imgEl = new window.Image();
          const url = URL.createObjectURL(img);
          imgEl.onload = () => {
            const MAX = 1280;
            let w = imgEl.width, h = imgEl.height;
            if (w > MAX || h > MAX) {
              if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
              else { w = Math.round(w * MAX / h); h = MAX; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d')!.drawImage(imgEl, 0, 0, w, h);
            URL.revokeObjectURL(url);
            res(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
          };
          imgEl.src = url;
        });
        imageFiles.push({ base64, name: img.name.replace(/\.[^.]+$/, '.jpg') });
      }
      const response = await fetch('/api/broadcast/gramjs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones, message, images: imageFiles, displayName: displayName.trim() || null, mode: broadcastMode, contactButton })
      });
      const data = await response.json();
      setResult(data);
      if (data.results) {
        const log = data.results.map((r: any) => {
          const client = clients.find(c => String(c.phone) === String(r.phone).replace('+', ''));
          return { phone: r.phone, name: client?.fullName || client?.name || r.phone, status: r.status, error: r.error };
        });
        setSendLog(log);
        setSentPhones(prev => { const next = new Set(prev); log.filter((l: any) => l.status === 'sent').forEach((l: any) => next.add(String(l.phone).replace(/\D/g, ''))); return next; });
        setNoTelegramPhones(prev => { const next = new Set(prev); log.filter((l: any) => l.error === 'Нет Telegram').forEach((l: any) => next.add(String(l.phone).replace(/\D/g, ''))); return next; });
      }
      const sentList = (data.results || []).filter((r: any) => r.status === 'sent').map((r: any) => String(r.phone).replace(/\D/g, ''));
      if (sentList.length > 0) {
        await addDoc(collection(db, 'broadcasts'), {
          phones: sentList,
          message,
          sentAt: new Date().toISOString(),
          sentCount: sentList.length,
          totalAttempted: phones.length,
        });
      }
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setIsSending(false);
    }
  };

  const activeSentSet = selectedBroadcast
    ? new Set((broadcastHistory.find(b => b.id === selectedBroadcast)?.phones || []).map(p => String(p).replace(/\D/g, '')))
    : sentPhones;

  const filteredClients = clients.filter(c => {
    const phone = String(c.phone || '').replace(/\D/g, '');
    const wasSent = activeSentSet.has(phone);
    const noTg = noTelegramPhones.has(phone);
    if (clientFilter === 'unsent' && (wasSent || noTg)) return false;
    if (clientFilter === 'sent' && !wasSent) return false;
    if (clientFilter === 'no_tg' && !noTg) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (c.fullName || c.name || '').toLowerCase();
    return name.includes(q) || phone.includes(q);
  });
  const visibleClients = showAllClients ? filteredClients : filteredClients.slice(0, 10);
  const charCount = message.length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 font-sans text-zinc-900">
      <div className="flex gap-4 items-start">
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
              <button key={tab} onClick={() => setActiveTab(tab)}
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
                  Telegram аккаунты ({tgStatus.accounts.length})
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
                    <div key={acc.phone} className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-50 last:border-b-0">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-black text-blue-600">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-zinc-900 font-mono">{acc.phone}</p>
                        <p className="text-[9px] text-zinc-400">{new Date(acc.addedAt).toLocaleDateString('ru')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-black text-emerald-500 uppercase">активен</span>
                        <button onClick={() => handleRemoveAccount(acc.phone)}
                          className="text-red-400 hover:text-red-600 transition-colors">
                          <XCircle size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Имя отправителя */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Имя отправителя</label>
              <p className="text-[9px] text-zinc-400 ml-1">Все аккаунты получат это имя перед рассылкой</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="YB Studio"
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                />
                <button onClick={handleSaveDisplayName} disabled={isSavingName || !displayName.trim()}
                  className="px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center gap-1.5">
                  {isSavingName ? <Loader2 size={12} className="animate-spin" /> : null}
                  Сохранить
                </button>
              </div>
            </div>

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
          </div>
        )}

        {/* Рассылка */}
        {activeTab === 'compose' && (
          <div className="space-y-4">

            {/* Sticky кнопка отправить */}
            <div className="sticky top-0 z-10 bg-white border-b border-zinc-100 px-4 py-3 flex items-center gap-3">
              <button
                onClick={handleSend}
                disabled={isSending || selected.size === 0 || !message.trim() || !tgStatus.authorized}
                className="flex-1 py-2.5 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-500/20"
              >
                {isSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {isSending ? 'Отправляем...' : `Отправить${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
              <div className="flex gap-1">
                <button onClick={() => setBroadcastMode('safe')}
                  className={`px-2.5 py-2 rounded-lg text-[8px] font-black uppercase transition-all border ${broadcastMode === 'safe' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-zinc-400 border-zinc-200'}`}>
                  🐢
                </button>
                <button onClick={() => setBroadcastMode('burn')}
                  className={`px-2.5 py-2 rounded-lg text-[8px] font-black uppercase transition-all border ${broadcastMode === 'burn' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-zinc-400 border-zinc-200'}`}>
                  🔥
                </button>
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

            {/* Кнопка под сообщением */}
            <div className="flex items-center justify-between px-1">
              <div>
                <p className="text-[10px] font-bold text-zinc-700">Кнопка "Написать менеджеру"</p>
                <p className="text-[9px] text-zinc-400">Ссылка на @yaasbae_ru под каждым сообщением</p>
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
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                  Клиенты ({selected.size} выбрано из {filteredClients.length}{search ? ` / ${clients.length}` : ''})
                </label>
                <div className="flex gap-2">
                  <button onClick={handleSelectFirst20} className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">
                    Первые 20
                  </button>
                  <span className="text-zinc-200">|</span>
                  <button onClick={handleSelectAll} className="text-[9px] font-black text-zinc-400 hover:text-zinc-700 uppercase tracking-widest">
                    {selected.size === clients.length ? 'Снять всё' : 'Все'}
                  </button>
                </div>
              </div>

              {/* Фильтр: не отправляли / отправляли */}
              <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl w-fit">
                <button onClick={() => { setClientFilter('unsent'); setSelectedBroadcast(null); setSelected(new Set()); }}
                  className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    clientFilter === 'unsent' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                  Не отправляли
                </button>
                <button onClick={() => { setClientFilter('sent'); setSelectedBroadcast(null); setSelected(new Set()); }}
                  className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                    clientFilter === 'sent' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                  Отправляли
                </button>
                {noTelegramPhones.size > 0 && (
                  <button onClick={() => { setClientFilter('no_tg'); setSelected(new Set()); }}
                    className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                      clientFilter === 'no_tg' ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700")}>
                    Нет TG ({noTelegramPhones.size})
                  </button>
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
                  onChange={e => { setSearch(e.target.value); setShowAllClients(true); }}
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
                    <div className="w-4 shrink-0" />
                    <div className="flex-1 text-[8px] font-black text-zinc-400 uppercase tracking-widest">Клиент</div>
                    <div className="w-20 text-right text-[8px] font-black text-zinc-400 uppercase tracking-widest">Сумма</div>
                    <div className="w-16 text-right text-[8px] font-black text-zinc-400 uppercase tracking-widest">Отправляли</div>
                  </div>
                  {visibleClients.map((client, i) => {
                    const phone = client.phone || client.userId;
                    const isSelected = selected.has(phone);
                    const key = String(phone).replace(/\D/g, '').slice(-10);
                    const rev = clientRevenue.get(key) || 0;
                    const ords = clientOrders.get(key) || 0;
                    const wasSent = activeSentSet.has(String(phone).replace(/\D/g, ''));
                    return (
                      <div
                        key={i}
                        onClick={() => handleToggle(phone)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-zinc-100 last:border-b-0",
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
                          {wasSent
                            ? <span className="text-[9px] font-black text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md">✓ было</span>
                            : <span className="text-[9px] text-zinc-200">—</span>
                          }
                        </div>
                      </div>
                    );
                  })}
                  {clients.length > 10 && (
                    <button
                      onClick={() => setShowAllClients(!showAllClients)}
                      className="w-full py-2.5 text-[9px] font-black text-zinc-400 hover:text-zinc-700 uppercase tracking-widest flex items-center justify-center gap-1 bg-zinc-50"
                    >
                      {showAllClients ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {showAllClients ? 'Скрыть' : `Показать ещё ${clients.length - 10}`}
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
      <div className="w-72 shrink-0 sticky top-4 self-start space-y-3">
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
                {l.error && <p className="text-[9px] text-red-400 mt-0.5 ml-4 truncate">{friendlyError(l.error)}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Контакты без Telegram */}
        {noTelegramPhones.size > 0 && (
          <div className="bg-white border border-zinc-100 shadow-sm rounded-2xl overflow-hidden">
            <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
              <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Нет Telegram</span>
              <span className="text-[9px] font-black text-amber-500">{noTelegramPhones.size}</span>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-zinc-50">
              {clients.filter(c => noTelegramPhones.has(String(c.phone).replace(/\D/g, ''))).map((c, i) => (
                <div key={i} className="px-3 py-2">
                  <p className="text-[10px] font-bold text-zinc-600 truncate">{c.fullName || c.name}</p>
                  <p className="text-[9px] text-zinc-400 font-mono">+{c.phone}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      </div>{/* /flex */}
    </div>
  );
};
