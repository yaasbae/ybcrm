import React, { useState, useEffect } from 'react';
import {
  Send, CheckCircle2, XCircle,
  Loader2, ChevronDown, ChevronUp,
  AlertCircle, LogOut, Smartphone, Search, Image
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { collection, getDocs, addDoc } from 'firebase/firestore';

interface TgAccount {
  phone: string;
  addedAt: string;
  active: boolean;
}

interface TgStatus {
  authorized: boolean;
  accounts: TgAccount[];
}

export const BroadcastPage: React.FC = () => {
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'compose' | 'settings'>('compose');
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [showAllClients, setShowAllClients] = useState(false);
  const [search, setSearch] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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
  const [displayName, setDisplayName] = useState('');
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
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingFile(true);
    setFileUploadError('');
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
      await loadTgStatus();
    } catch (err: any) {
      setFileUploadError(err.message);
    } finally {
      setIsUploadingFile(false);
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
        const snap = await getDocs(collection(db, 'contacts'));
        const data = snap.docs
          .map(d => {
            const docData = d.data() as any;
            const phone = docData.phone || d.id;
            return { ...docData, id: d.id, phone } as any;
          })
          .filter(c => {
            if (!/^7\d{10}$/.test(String(c.phone))) return false;
            const name = c.fullName || c.name || '';
            if (!name) return false;
            const hasCyrillic = /[а-яёА-ЯЁ]/.test(name);
            const hasDigits = /\d/.test(name);
            return hasCyrillic && !hasDigits;
          })
          .sort((a, b) => (a.fullName || a.name || '').localeCompare(b.fullName || b.name || '', 'ru'));
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
    const file = e.target.files?.[0] || null;
    setImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
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
    try {
      const phones = Array.from(selected);
      let imageBase64: string | null = null;
      let imageName: string | null = null;
      if (image) {
        const reader = new FileReader();
        imageBase64 = await new Promise(res => {
          reader.onload = () => res((reader.result as string).split(',')[1]);
          reader.readAsDataURL(image);
        });
        imageName = image.name;
      }
      const response = await fetch('/api/broadcast/gramjs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones, message, imageBase64, imageName, displayName: displayName.trim() || null })
      });
      const data = await response.json();
      setResult(data);
      await addDoc(collection(db, 'broadcasts'), {
        phones,
        message,
        sentAt: new Date().toISOString(),
        result: data,
        count: phones.length
      });
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setIsSending(false);
    }
  };

  const filteredClients = clients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (c.fullName || c.name || '').toLowerCase();
    const phone = String(c.phone || '');
    return name.includes(q) || phone.includes(q);
  });
  const visibleClients = showAllClients ? filteredClients : filteredClients.slice(0, 10);
  const charCount = message.length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 space-y-4 font-sans text-zinc-900">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="tg-card bg-white border border-zinc-100 shadow-sm overflow-hidden"
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

            {/* .session файл — Telethon/Pyrogram */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Добавить покупной аккаунт (.session файл)</label>
              <p className="text-[9px] text-zinc-400 ml-1">Загрузи .session файл от купленного аккаунта (Telethon / Pyrogram)</p>
              <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${isUploadingFile ? 'border-blue-300 bg-blue-50' : 'border-zinc-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                <input
                  type="file"
                  accept=".session,.json"
                  className="hidden"
                  onChange={handleSessionFileUpload}
                  disabled={isUploadingFile}
                />
                {isUploadingFile
                  ? <><Loader2 size={14} className="animate-spin text-blue-500" /><span className="text-[10px] font-bold text-blue-500">Загружаю...</span></>
                  : <><Smartphone size={14} className="text-zinc-400" /><span className="text-[10px] font-bold text-zinc-500">Выбрать .session или .json файл</span></>
                }
              </label>
              {fileUploadError && (
                <p className="text-[10px] text-red-500 font-medium ml-1">{fileUploadError}</p>
              )}
            </div>

            {/* StringSession — добавить купленный аккаунт */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Или вставить StringSession строку</label>
              <p className="text-[9px] text-zinc-400 ml-1">Вставь строку сессии от купленного аккаунта</p>
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
          <div className="p-4 space-y-4">

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

            {/* Картинка */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">Фото (необязательно)</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border border-zinc-200 border-dashed rounded-xl cursor-pointer hover:bg-zinc-100 transition-all text-[10px] font-bold text-zinc-500">
                  <Image size={14} className="text-zinc-400" />
                  {image ? image.name : 'Выбрать фото'}
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
                {imagePreview && (
                  <div className="relative">
                    <img src={imagePreview} alt="preview" className="w-12 h-12 rounded-xl object-cover border border-zinc-200" />
                    <button onClick={() => { setImage(null); setImagePreview(null); }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center">
                      <XCircle size={10} />
                    </button>
                  </div>
                )}
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
                  {visibleClients.map((client, i) => {
                    const phone = client.phone || client.userId;
                    const isSelected = selected.has(phone);
                    return (
                      <div
                        key={i}
                        onClick={() => handleToggle(phone)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-zinc-50 last:border-b-0",
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
                          <p className="text-[11px] font-bold text-zinc-900 truncate">{client.fullName || client.name || 'Без имени'}</p>
                          <p className="text-[10px] text-zinc-400 font-mono">+{phone}</p>
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

            <button
              onClick={handleSend}
              disabled={isSending || selected.size === 0 || !message.trim() || !tgStatus.authorized}
              className="w-full py-3 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {isSending ? 'Отправляем...' : `Отправить ${selected.size > 0 ? `(${selected.size} чел.)` : ''}`}
            </button>

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

          </div>
        )}
      </motion.div>
    </div>
  );
};
