import React, { useState, useEffect, useRef } from 'react';
import heic2any from 'heic2any';
import { Bot, Users, MessageSquare, Settings, RefreshCw, Send, CheckCircle2, Loader2, Shirt, Trash2, Plus, Image, Layout, Pencil, X, Megaphone, AlertTriangle, Clock3 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { db, storage } from '../firebase';
import { collection, getDocs, orderBy, query, limit, doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { TELEGRAM_BOT_MESSAGE_LIMIT, validateBotBroadcastMessage } from '../lib/botBroadcast';

interface Subscriber {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
  subscribedAt: string;
}

interface BotMessage {
  id: string;
  userId: string;
  firstName: string;
  username: string;
  text: string;
  receivedAt: string;
  replied: boolean;
}

interface BotButton {
  id: string;
  label: string;
  response: string;
}

interface BotBroadcastHistory {
  id: string;
  message: string;
  recipientCount: number;
  sent: number;
  failed: number;
  createdAt: string;
  status: 'sent' | 'partial' | 'failed';
}

const hideBotButton = (button: BotButton) => button.id !== 'tryon';

export const BotPage: React.FC = () => {
  const [tab, setTab] = useState<'subscribers' | 'broadcast' | 'messages' | 'catalog' | 'settings'>('subscribers');
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [welcomeText, setWelcomeText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [managerChatIds, setManagerChatIds] = useState('');
  const [isSavingManagers, setIsSavingManagers] = useState(false);
  const [managersSavedOk, setManagersSavedOk] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  const [broadcastConfirmed, setBroadcastConfirmed] = useState(false);
  const [broadcastHistory, setBroadcastHistory] = useState<BotBroadcastHistory[]>([]);

  // Button editor state
  const [botButtons, setBotButtons] = useState<BotButton[]>([]);
  const [isSavingButtons, setIsSavingButtons] = useState(false);
  const [buttonsSavedOk, setButtonsSavedOk] = useState(false);

  // Reply state
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  // Catalog state
  const [costumes, setCostumes] = useState<any[]>([]);
  const [costumeName, setCostumeName] = useState('');
  const [costumeFiles, setCostumeFiles] = useState<File[]>([]);
  const [costumePreviews, setCostumePreviews] = useState<string[]>([]);
  const [isUploadingCostume, setIsUploadingCostume] = useState(false);
  const costumeInputRef = useRef<HTMLInputElement>(null);

  // Edit costume state
  const [editingCostume, setEditingCostume] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [editPreviews, setEditPreviews] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setIsLoading(true);
    const [subResult, msgResult, cfgResult, costumeResult, btnResult, managerResult, broadcastResult] = await Promise.allSettled([
      getDocs(query(collection(db, 'bot_subscribers'), orderBy('subscribedAt', 'desc'))),
      getDocs(query(collection(db, 'bot_messages'), orderBy('receivedAt', 'desc'), limit(50))),
      getDoc(doc(db, 'settings', 'bot_config')),
      fetch('/api/bot/costumes').then(r => r.ok ? r.json() : []),
      fetch('/api/bot/buttons').then(r => r.ok ? r.json() : null),
      fetch('/api/bot/manager-config').then(r => r.ok ? r.json() : null),
      fetch('/api/bot/broadcasts').then(r => r.ok ? r.json() : []),
    ]);

    if (subResult.status === 'fulfilled') {
      setSubscribers(subResult.value.docs.map(d => ({ userId: d.id, ...d.data() } as Subscriber)));
    }
    if (msgResult.status === 'fulfilled') {
      setMessages(msgResult.value.docs.map(d => ({ id: d.id, ...d.data() } as BotMessage)));
    }
    if (cfgResult.status === 'fulfilled' && cfgResult.value.exists() && cfgResult.value.data().welcomeText) {
      setWelcomeText(cfgResult.value.data().welcomeText);
    }
    if (costumeResult.status === 'fulfilled' && Array.isArray(costumeResult.value)) {
      setCostumes(costumeResult.value);
    }
    if (btnResult.status === 'fulfilled' && btnResult.value?.buttons) {
      setBotButtons(btnResult.value.buttons.filter(hideBotButton));
    }
    if (managerResult.status === 'fulfilled' && Array.isArray(managerResult.value?.managerChatIds)) {
      setManagerChatIds(managerResult.value.managerChatIds.join('\n'));
    }
    if (broadcastResult.status === 'fulfilled' && Array.isArray(broadcastResult.value)) {
      setBroadcastHistory(broadcastResult.value);
    }
    setIsLoading(false);
  };

  const toJpegFile = async (file: File): Promise<File> => {
    const isHeic = /\.(heic|heif)$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';
    if (isHeic) {
      try {
        const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }) as Blob;
        return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      } catch { return file; }
    }
    return file;
  };

  const handleCostumeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (!files.length) return;
    setCostumeFiles(files);
    if (!costumeName) setCostumeName(files[0].name.replace(/\.[^.]+$/, ''));
    setCostumePreviews(files.map(f => URL.createObjectURL(f)));
  };

  const handleUploadCostume = async () => {
    if (!costumeFiles.length || !costumeName.trim()) return;
    setIsUploadingCostume(true);
    try {
      const jpegFiles = await Promise.all(costumeFiles.map(toJpegFile));
      const imageUrls = await Promise.all(jpegFiles.map(async (file) => {
        const storageRef = ref(storage, `costumes/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        return getDownloadURL(storageRef);
      }));
      const r = await fetch('/api/bot/costumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: costumeName.trim(), imageUrls }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setCostumeName('');
      setCostumeFiles([]);
      setCostumePreviews([]);
      if (costumeInputRef.current) costumeInputRef.current.value = '';
      await loadData();
    } catch (e: any) { alert(e.message); }
    setIsUploadingCostume(false);
  };

  const handleDeleteCostume = async (id: string, name: string) => {
    if (!confirm(`Удалить «${name}»?`)) return;
    await fetch(`/api/bot/costumes/${id}`, { method: 'DELETE' });
    await loadData();
  };

  const openEdit = (c: any) => {
    setEditingCostume(c);
    setEditName(c.name);
    setEditFiles([]);
    setEditPreviews(c.imageUrls?.length ? c.imageUrls : [c.imageUrl]);
  };

  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (!files.length) return;
    setEditFiles(files);
    setEditPreviews(files.map(f => URL.createObjectURL(f)));
  };

  const handleSaveEdit = async () => {
    if (!editingCostume || !editName.trim()) return;
    setIsSavingEdit(true);
    try {
      let imageUrls = editingCostume.imageUrls || [editingCostume.imageUrl];
      if (editFiles.length) {
        const jpegFiles = await Promise.all(editFiles.map(toJpegFile));
        imageUrls = await Promise.all(jpegFiles.map(async (file) => {
          const sRef = ref(storage, `costumes/${Date.now()}_${file.name}`);
          await uploadBytes(sRef, file);
          return getDownloadURL(sRef);
        }));
      }
      await fetch(`/api/bot/costumes/${editingCostume.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), imageUrls }),
      });
      setEditingCostume(null);
      await loadData();
    } catch (e: any) { alert(e.message); }
    setIsSavingEdit(false);
  };

  useEffect(() => { loadData(); }, []);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'bot_config'), { welcomeText }, { merge: true });
      await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcomeText }),
      });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch {}
    setIsSaving(false);
  };

  const sendReply = async (userId: string) => {
    if (!replyText.trim()) return;
    setIsSendingReply(true);
    try {
      const res = await fetch('/api/bot/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: replyText }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReplyingTo(null);
      setReplyText('');
    } catch (e: any) { alert(e.message); }
    setIsSendingReply(false);
  };

  const addButton = () => {
    setBotButtons(prev => [...prev, { id: `btn_${Date.now()}`, label: '🔘 Новая кнопка', response: '' }]);
  };

  const removeButton = (id: string) => {
    setBotButtons(prev => prev.filter(b => b.id !== id));
  };

  const saveButtons = async () => {
    setIsSavingButtons(true);
    try {
      await fetch('/api/bot/buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buttons: botButtons.filter(hideBotButton) }),
      });
      setButtonsSavedOk(true);
      setTimeout(() => setButtonsSavedOk(false), 2000);
    } catch {}
    setIsSavingButtons(false);
  };

  const saveManagers = async () => {
    setIsSavingManagers(true);
    try {
      const ids = managerChatIds.split(/[\s,]+/).map(id => id.trim()).filter(Boolean);
      await fetch('/api/bot/manager-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerChatIds: ids }),
      });
      setManagerChatIds(ids.join('\n'));
      setManagersSavedOk(true);
      setTimeout(() => setManagersSavedOk(false), 2000);
    } catch {}
    setIsSavingManagers(false);
  };

  const sendBotBroadcast = async () => {
    const validation = validateBotBroadcastMessage(broadcastMsg);
    if (validation.error || subscribers.length === 0 || !broadcastConfirmed) return;
    setIsBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await fetch('/api/bot/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: validation.message, audience: 'all' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Не удалось отправить рассылку');
      setBroadcastResult(data);
      setBroadcastMsg('');
      setBroadcastConfirmed(false);
      await loadData();
    } catch (e: any) {
      setBroadcastResult({ error: e.message });
    }
    setIsBroadcasting(false);
  };

  const broadcastValidation = validateBotBroadcastMessage(broadcastMsg);
  const broadcastReady = !broadcastValidation.error && subscribers.length > 0 && broadcastConfirmed && !isBroadcasting;

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 space-y-4 font-sans text-zinc-900">

      {/* Edit costume modal */}
      {editingCostume && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-black text-zinc-900">Редактировать костюм</p>
              <button onClick={() => setEditingCostume(null)} className="p-1 text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
            <input value={editName} onChange={e => setEditName(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400" placeholder="Название" />
            <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-zinc-200 rounded-xl cursor-pointer p-3 hover:border-violet-300 transition-colors">
              <input ref={editInputRef} type="file" accept="image/*,image/heic,image/heif,.heic,.heif" multiple className="hidden" onChange={handleEditFileChange} />
              <div className="grid grid-cols-4 gap-1 w-full">
                {editPreviews.map((p, i) => (
                  <img key={i} src={p} className="w-full h-16 object-cover rounded-lg" onError={e => (e.currentTarget.style.display='none')} />
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">Нажми чтобы заменить фото</p>
            </label>
            <button onClick={handleSaveEdit} disabled={isSavingEdit || !editName.trim()}
              className="w-full py-2.5 bg-violet-500 text-white rounded-xl text-[11px] font-black hover:bg-violet-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {isSavingEdit ? <Loader2 size={12} className="animate-spin" /> : null}
              {isSavingEdit ? 'Сохраняю...' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-zinc-100 shadow-sm rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500 rounded-xl shadow-lg shadow-violet-500/20">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1">Telegram Бот</h3>
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">@YAASBAE_CLO_bot</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-100 rounded-full">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-600">Активен</span>
            </div>
            <button onClick={loadData} className="p-1.5 text-zinc-400 hover:text-zinc-700 transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 divide-x divide-zinc-100 border-b border-zinc-100">
          {[
            { label: 'Подписчиков', value: subscribers.length },
            { label: 'Сообщений', value: messages.length },
            { label: 'Сегодня', value: messages.filter(m => m.receivedAt?.startsWith(new Date().toISOString().slice(0, 10))).length },
          ].map(s => (
            <div key={s.label} className="p-3 text-center">
              <p className="text-[18px] font-black text-zinc-900">{s.value}</p>
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto p-2 border-b border-zinc-100 bg-zinc-50">
          {([
            { id: 'subscribers', label: 'Подписчики', icon: Users },
            { id: 'broadcast', label: 'Рассылка', icon: Megaphone },
            { id: 'messages', label: 'Сообщения', icon: MessageSquare },
            { id: 'catalog', label: 'Каталог', icon: Shirt },
            { id: 'settings', label: 'Настройки', icon: Settings },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                tab === t.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"
              )}>
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-zinc-300" />
            </div>
          ) : (
            <>
              {/* Подписчики */}
              {tab === 'subscribers' && (
                <div className="space-y-3">
                  {subscribers.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400">
                      <Users size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-[11px] font-bold">Пока нет подписчиков</p>
                      <p className="text-[10px] mt-1">Когда кто-то напишет /start — появится здесь</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                        {subscribers.map(s => (
                          <div key={s.userId} className="flex items-center gap-3 px-3 py-2.5 bg-zinc-50 rounded-xl">
                            <div className="w-8 h-8 bg-violet-100 rounded-full flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-black text-violet-600">
                                {(s.firstName || s.username || '?')[0].toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold text-zinc-900">
                                {s.firstName} {s.lastName}
                                {s.username && <span className="text-zinc-400 font-normal ml-1">@{s.username}</span>}
                              </p>
                              <p className="text-[9px] text-zinc-400">{new Date(s.subscribedAt).toLocaleDateString('ru')}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                  )}
                </div>
              )}

              {/* Рассылка */}
              {tab === 'broadcast' && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
                  <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-[12px] font-black text-zinc-900"><Megaphone size={15} className="text-violet-500" /> Новая рассылка</p>
                        <p className="mt-1 text-[10px] leading-4 text-zinc-500">Сообщение получат все, кто запускал @YAASBAE_CLO_bot.</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-[9px] font-black text-violet-600">{subscribers.length} получателей</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="bot-broadcast-message" className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Текст сообщения</label>
                        <span className={cn('text-[9px] font-bold', broadcastMsg.length > TELEGRAM_BOT_MESSAGE_LIMIT ? 'text-red-600' : 'text-zinc-400')}>
                          {broadcastMsg.length} / {TELEGRAM_BOT_MESSAGE_LIMIT}
                        </span>
                      </div>
                      <textarea
                        id="bot-broadcast-message"
                        value={broadcastMsg}
                        onChange={event => { setBroadcastMsg(event.target.value); setBroadcastConfirmed(false); setBroadcastResult(null); }}
                        placeholder="Например: Новая коллекция уже доступна. Нажмите кнопку в меню бота, чтобы посмотреть модели."
                        rows={8}
                        maxLength={TELEGRAM_BOT_MESSAGE_LIMIT + 500}
                        className="min-h-40 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-[12px] leading-5 text-zinc-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
                      />
                      {broadcastMsg && broadcastValidation.error && (
                        <p className="flex items-center gap-1.5 text-[10px] font-medium text-red-600"><AlertTriangle size={12} />{broadcastValidation.error}</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-zinc-400">Предпросмотр в Telegram</p>
                      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-3 py-2.5 text-[11px] leading-5 text-zinc-800 shadow-sm">
                        {broadcastMsg.trim() || <span className="text-zinc-400">Здесь появится текст сообщения</span>}
                      </div>
                    </div>

                    <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition', broadcastConfirmed ? 'border-violet-200 bg-violet-50' : 'border-zinc-200 bg-white hover:bg-zinc-50')}>
                      <input
                        type="checkbox"
                        checked={broadcastConfirmed}
                        onChange={event => setBroadcastConfirmed(event.target.checked)}
                        disabled={!broadcastMsg.trim() || subscribers.length === 0 || Boolean(broadcastValidation.error)}
                        className="mt-0.5 h-4 w-4 accent-violet-600"
                      />
                      <span className="text-[10px] font-semibold leading-4 text-zinc-700">Подтверждаю отправку сообщения всем подписчикам бота: {subscribers.length} чел.</span>
                    </label>

                    <button
                      type="button"
                      onClick={sendBotBroadcast}
                      disabled={!broadcastReady}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-[11px] font-black text-white transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isBroadcasting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {isBroadcasting ? 'Отправляю...' : `Отправить ${subscribers.length} подписчикам`}
                    </button>

                    {broadcastResult && (
                      <div role="status" className={cn('rounded-xl p-3 text-[10px] font-semibold', broadcastResult.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                        {broadcastResult.error || `Рассылка завершена. Доставлено: ${broadcastResult.sent} из ${broadcastResult.total}. Ошибок: ${broadcastResult.failed}.`}
                      </div>
                    )}
                  </section>

                  <aside className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-[11px] font-black text-zinc-900"><Clock3 size={14} className="text-zinc-400" /> История</p>
                      <span className="text-[9px] font-bold text-zinc-400">Последние 20</span>
                    </div>
                    {broadcastHistory.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-3 py-8 text-center text-[10px] text-zinc-400">Рассылок пока не было</div>
                    ) : (
                      <div className="space-y-2">
                        {broadcastHistory.map(item => (
                          <div key={item.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn('rounded-full px-2 py-0.5 text-[8px] font-black uppercase', item.failed === 0 ? 'bg-emerald-50 text-emerald-600' : item.sent > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600')}>
                                {item.failed === 0 ? 'Отправлено' : item.sent > 0 ? 'Частично' : 'Ошибка'}
                              </span>
                              <span className="text-[8px] text-zinc-400">{item.createdAt ? new Date(item.createdAt).toLocaleString('ru') : '—'}</span>
                            </div>
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-4 text-zinc-700">{item.message}</p>
                            <p className="mt-2 text-[9px] font-bold text-zinc-400">Доставлено {item.sent} из {item.recipientCount || item.sent + item.failed}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </aside>
                </div>
              )}

              {/* Сообщения */}
              {tab === 'messages' && (
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400">
                      <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-[11px] font-bold">Сообщений пока нет</p>
                    </div>
                  ) : messages.map(m => (
                    <div key={m.id} className="bg-zinc-50 rounded-xl overflow-hidden">
                      <div className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-zinc-700">
                            {m.firstName || 'Неизвестный'}
                            {m.username && <span className="text-zinc-400 font-normal ml-1">@{m.username}</span>}
                          </span>
                          <span className="text-[9px] text-zinc-400">{new Date(m.receivedAt).toLocaleString('ru')}</span>
                        </div>
                        <p className="text-[11px] text-zinc-800">{m.text}</p>
                        <button
                          onClick={() => { setReplyingTo(replyingTo === m.userId ? null : m.userId); setReplyText(''); }}
                          className="text-[9px] font-bold text-violet-500 hover:text-violet-700 transition-colors"
                        >
                          {replyingTo === m.userId ? '✕ Отмена' : '↩ Ответить'}
                        </button>
                      </div>
                      {replyingTo === m.userId && (
                        <div className="px-3 pb-3 flex gap-2">
                          <input
                            autoFocus
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && sendReply(m.userId)}
                            placeholder="Введи ответ..."
                            className="flex-1 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                          />
                          <button onClick={() => sendReply(m.userId)} disabled={isSendingReply || !replyText.trim()}
                            className="px-3 py-1.5 bg-violet-500 text-white rounded-lg text-[10px] font-black hover:bg-violet-600 transition-all disabled:opacity-40 flex items-center gap-1">
                            {isSendingReply ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Каталог костюмов */}
              {tab === 'catalog' && (
                <div className="space-y-4">
                  {/* Upload form */}
                  <div className="space-y-2 p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Добавить костюм</p>
                    <p className="text-[9px] text-zinc-400 ml-0.5">Выбери 2-4 фото изделия для лучшего результата примерки</p>
                    <label className={cn(
                      "flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl cursor-pointer transition-all overflow-hidden",
                      costumePreviews.length ? "border-violet-200 p-2" : "border-zinc-200 hover:border-violet-300 p-6"
                    )}>
                      <input ref={costumeInputRef} type="file" accept="image/*,image/heic,image/heif,.heic,.heif" multiple className="hidden" onChange={handleCostumeFileChange} />
                      {costumePreviews.length > 0
                        ? <div className="grid grid-cols-4 gap-1 w-full">
                            {costumePreviews.map((p, i) => (
                              <div key={i} className="relative">
                                <img src={p} className="w-full h-20 object-cover rounded-lg" />
                                <span className="absolute top-0.5 left-0.5 bg-violet-500 text-white text-[8px] font-black rounded px-1">{i + 1}</span>
                              </div>
                            ))}
                          </div>
                        : <><Image size={24} className="text-zinc-300" /><span className="text-[10px] font-bold text-zinc-400">Нажми чтобы выбрать 2-4 фото</span></>
                      }
                    </label>
                    <input
                      type="text"
                      value={costumeName}
                      onChange={e => setCostumeName(e.target.value)}
                      placeholder="Название костюма..."
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                    />
                    <button onClick={handleUploadCostume} disabled={isUploadingCostume || !costumeFiles.length || !costumeName.trim()}
                      className="w-full py-2.5 bg-violet-500 text-white rounded-xl text-[10px] font-black hover:bg-violet-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                      {isUploadingCostume ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      {isUploadingCostume ? `Загружаю ${costumeFiles.length} фото...` : 'Добавить в каталог'}
                    </button>
                  </div>

                  {/* Costumes list */}
                  {costumes.length === 0 ? (
                    <div className="text-center py-8 text-zinc-400">
                      <Shirt size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-[11px] font-bold">Каталог пуст</p>
                      <p className="text-[10px] mt-1">Добавь первый костюм выше</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {costumes.map(c => {
                        const imgs: string[] = c.imageUrls?.length ? c.imageUrls : [c.imageUrl];
                        return (
                          <div key={c.id} className="relative rounded-xl overflow-hidden border border-zinc-100 group bg-white">
                            <div className={cn("grid gap-1 p-1", imgs.length === 1 ? "grid-cols-1" : imgs.length === 2 ? "grid-cols-2" : "grid-cols-4")}>
                              {imgs.map((url, i) => (
                                <img key={i} src={url} className={cn("object-cover rounded-lg", imgs.length === 1 ? "w-full h-48" : "w-full h-24")} />
                              ))}
                            </div>
                            <div className="px-3 py-2 flex items-center justify-between">
                              <div>
                                <p className="text-[11px] font-bold text-zinc-800">{c.name}</p>
                                <p className="text-[9px] text-zinc-400">{imgs.length} фото</p>
                              </div>
                              <div className="flex gap-1">
                                <button onClick={() => openEdit(c)}
                                  className="p-1.5 bg-violet-50 text-violet-500 rounded-lg hover:bg-violet-100 transition-colors">
                                  <Pencil size={11} />
                                </button>
                                <button onClick={() => handleDeleteCostume(c.id, c.name)}
                                  className="p-1.5 bg-red-50 text-red-400 rounded-lg hover:bg-red-100 transition-colors">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Настройки */}
              {tab === 'settings' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Текст приветствия (/start)</label>
                    <textarea
                      value={welcomeText}
                      onChange={e => setWelcomeText(e.target.value)}
                      placeholder="Привет! Добро пожаловать в YB Studio..."
                      rows={6}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all resize-none"
                    />
                    <button onClick={saveSettings} disabled={isSaving}
                      className="w-full py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                      {isSaving ? <Loader2 size={12} className="animate-spin" /> : savedOk ? <CheckCircle2 size={12} /> : null}
                      {savedOk ? 'Сохранено!' : 'Сохранить приветствие'}
                    </button>
                  </div>

                  <div className="space-y-2 p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                    <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Чаты менеджеров для ответов</label>
                    <p className="text-[9px] text-zinc-400">
                      Менеджер пишет боту /myid, копируешь chat_id сюда. Можно несколько — каждый с новой строки.
                    </p>
                    <textarea
                      value={managerChatIds}
                      onChange={e => setManagerChatIds(e.target.value)}
                      placeholder="123456789&#10;-1009876543210"
                      rows={3}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all resize-y"
                    />
                    <button onClick={saveManagers} disabled={isSavingManagers}
                      className="w-full py-2.5 bg-violet-500 text-white rounded-xl text-[10px] font-black hover:bg-violet-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                      {isSavingManagers ? <Loader2 size={12} className="animate-spin" /> : managersSavedOk ? <CheckCircle2 size={12} /> : <MessageSquare size={12} />}
                      {managersSavedOk ? 'Менеджеры сохранены!' : 'Сохранить чаты менеджеров'}
                    </button>
                  </div>

                  {/* Button editor */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layout size={11} className="text-zinc-400" />
                        <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Кнопки главного меню</label>
                      </div>
                      <button onClick={addButton}
                        className="flex items-center gap-1 px-2.5 py-1 bg-violet-50 border border-violet-200 text-violet-600 rounded-lg text-[9px] font-black hover:bg-violet-100 transition-all">
                        <Plus size={10} /> Добавить кнопку
                      </button>
                    </div>
                    <div className="space-y-3">
                      {botButtons.map((btn, i) => (
                        <div key={btn.id} className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={btn.label}
                              onChange={e => {
                                const updated = [...botButtons];
                                updated[i] = { ...updated[i], label: e.target.value };
                                setBotButtons(updated);
                              }}
                              className="flex-1 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                              placeholder="Название кнопки..."
                            />
                            <button onClick={() => removeButton(btn.id)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all shrink-0">
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <textarea
                            value={btn.response}
                            onChange={e => {
                              const updated = [...botButtons];
                              updated[i] = { ...updated[i], response: e.target.value };
                              setBotButtons(updated);
                            }}
                            rows={3}
                            placeholder="Текст ответа когда нажимают эту кнопку..."
                            className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all resize-y overflow-y-auto"
                          />
                        </div>
                      ))}
                    </div>
                    <button onClick={saveButtons} disabled={isSavingButtons || botButtons.length === 0}
                      className="w-full py-2.5 bg-violet-500 text-white rounded-xl text-[10px] font-black hover:bg-violet-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                      {isSavingButtons ? <Loader2 size={12} className="animate-spin" /> : buttonsSavedOk ? <CheckCircle2 size={12} /> : <Layout size={12} />}
                      {buttonsSavedOk ? 'Кнопки сохранены!' : 'Сохранить кнопки'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};
