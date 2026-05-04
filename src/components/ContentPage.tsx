import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Upload, Link, Image, Loader2, CheckCircle2, Trash2, Send, Settings, RefreshCw, Instagram, ChevronRight, Edit3, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface ContentItem {
  id: string;
  status: 'queue' | 'published';
  generatedUrl: string;
  modelUrl: string;
  lookUrl: string;
  caption: string;
  createdAt: string;
  publishedAt?: string;
  instagramPostId?: string;
}

export const ContentPage: React.FC = () => {
  const [tab, setTab] = useState<'create' | 'queue' | 'published' | 'settings'>('create');

  // Create tab
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelPreview, setModelPreview] = useState<string | null>(null);
  const [lookSource, setLookSource] = useState<'file' | 'pinterest'>('file');
  const [lookFile, setLookFile] = useState<File | null>(null);
  const [lookPreview, setLookPreview] = useState<string | null>(null);
  const [pinterestUrl, setPinterestUrl] = useState('');
  const [isLoadingPin, setIsLoadingPin] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStep, setProcessStep] = useState('');
  const [result, setResult] = useState<{ generatedBase64: string; caption: string } | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [isSavingQueue, setIsSavingQueue] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const lookInputRef = useRef<HTMLInputElement>(null);

  // Queue tab
  const [queue, setQueue] = useState<ContentItem[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState('');
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<{ [id: string]: string }>({});

  // Settings
  const [igToken, setIgToken] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadQueue = async () => {
    setIsLoadingQueue(true);
    try {
      const res = await fetch('/api/content/queue');
      const data = await res.json();
      if (Array.isArray(data)) setQueue(data);
    } catch {}
    setIsLoadingQueue(false);
  };

  useEffect(() => {
    if (tab === 'queue' || tab === 'published') loadQueue();
  }, [tab]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleModelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setModelFile(file);
    const reader = new FileReader();
    reader.onload = () => setModelPreview(reader.result as string);
    reader.readAsDataURL(file);
    setResult(null);
  };

  const handleLookFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLookFile(file);
    const reader = new FileReader();
    reader.onload = () => setLookPreview(reader.result as string);
    reader.readAsDataURL(file);
    setResult(null);
  };

  const loadPinterest = async () => {
    if (!pinterestUrl.trim()) return;
    setIsLoadingPin(true);
    try {
      const res = await fetch('/api/content/pinterest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pinterestUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLookPreview(data.imageUrl);
      setLookFile(null);
    } catch (e: any) { alert(e.message); }
    setIsLoadingPin(false);
  };

  const handleProcess = async () => {
    if (!modelFile) return alert('Загрузи фото модели');
    if (!lookPreview && !lookFile) return alert('Загрузи образ или укажи Pinterest ссылку');
    setIsProcessing(true);
    setResult(null);
    try {
      setProcessStep('Подготовка фото...');
      const modelBase64 = await fileToBase64(modelFile);
      let lookBase64: string;
      if (lookFile) {
        lookBase64 = await fileToBase64(lookFile);
      } else {
        // Fetch Pinterest image via server proxy
        setProcessStep('Загрузка образа...');
        const proxyRes = await fetch('/api/content/pinterest-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: lookPreview }),
        });
        const proxyData = await proxyRes.json();
        lookBase64 = proxyData.base64;
      }

      setProcessStep('AI генерирует примерку и текст...');
      const res = await fetch('/api/content/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelBase64, lookBase64 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      setEditCaption(data.caption);
    } catch (e: any) { alert('Ошибка: ' + e.message); }
    setIsProcessing(false);
    setProcessStep('');
  };

  const handleAddToQueue = async () => {
    if (!result) return;
    setIsSavingQueue(true);
    try {
      // Upload model photo to get URL
      let modelUrl = '';
      if (modelFile) {
        const sRef = ref(storage, `content/models/${Date.now()}_${modelFile.name}`);
        await uploadBytes(sRef, modelFile);
        modelUrl = await getDownloadURL(sRef);
      }

      const res = await fetch('/api/content/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generatedBase64: result.generatedBase64,
          caption: editCaption,
          modelUrl,
          lookUrl: lookPreview || '',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      setResult(null);
      setModelFile(null);
      setModelPreview(null);
      setLookFile(null);
      setLookPreview(null);
      setPinterestUrl('');
      setEditCaption('');
      if (modelInputRef.current) modelInputRef.current.value = '';
      if (lookInputRef.current) lookInputRef.current.value = '';
    } catch (e: any) { alert(e.message); }
    setIsSavingQueue(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить из очереди?')) return;
    await fetch(`/api/content/queue/${id}`, { method: 'DELETE' });
    loadQueue();
  };

  const handleSaveCaption = async (id: string) => {
    await fetch(`/api/content/queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: editingCaption }),
    });
    setEditingId(null);
    loadQueue();
  };

  const handlePublish = async (id: string) => {
    setPublishingId(id);
    setPublishError(prev => ({ ...prev, [id]: '' }));
    try {
      const res = await fetch(`/api/content/publish/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      loadQueue();
    } catch (e: any) {
      setPublishError(prev => ({ ...prev, [id]: e.message }));
    }
    setPublishingId(null);
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await fetch('/api/content/instagram-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: igToken, userId: igUserId }),
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch {}
    setIsSavingSettings(false);
  };

  const queueItems = queue.filter(q => q.status === 'queue');
  const publishedItems = queue.filter(q => q.status === 'published');

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 space-y-4 font-sans text-zinc-900">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-zinc-100 shadow-sm rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-500 rounded-xl shadow-lg shadow-rose-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1">Контент Студия</h3>
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">AI → Очередь → Instagram</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 border border-rose-100 rounded-full">
              <Instagram size={10} className="text-rose-500" />
              <span className="text-[9px] font-bold text-rose-600">Instagram</span>
            </div>
            {(tab === 'queue' || tab === 'published') && (
              <button onClick={loadQueue} className="p-1.5 text-zinc-400 hover:text-zinc-700 transition-colors">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 divide-x divide-zinc-100 border-b border-zinc-100">
          {[
            { label: 'В очереди', value: queueItems.length },
            { label: 'Опубликовано', value: publishedItems.length },
            { label: 'Всего создано', value: queue.length },
          ].map(s => (
            <div key={s.label} className="p-3 text-center">
              <p className="text-[18px] font-black text-zinc-900">{s.value}</p>
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-zinc-100 bg-zinc-50">
          {([
            { id: 'create', label: 'Создать' },
            { id: 'queue', label: `Очередь (${queueItems.length})` },
            { id: 'published', label: 'Опубликовано' },
            { id: 'settings', label: 'Instagram' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                tab === t.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"
              )}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">

          {/* ── CREATE ── */}
          {tab === 'create' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Model photo */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">1. Фото модели</p>
                  <label className={cn(
                    "flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl cursor-pointer transition-all overflow-hidden",
                    modelPreview ? "border-rose-200 p-0" : "border-zinc-200 hover:border-rose-300 p-6"
                  )}>
                    <input ref={modelInputRef} type="file" accept="image/*" className="hidden" onChange={handleModelFile} />
                    {modelPreview
                      ? <img src={modelPreview} className="w-full h-44 object-cover" />
                      : <><Upload size={20} className="text-zinc-300" /><span className="text-[10px] font-bold text-zinc-400 text-center">Фото модели</span></>
                    }
                  </label>
                </div>

                {/* Look photo */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">2. Образ / Лук</p>
                  <div className="flex gap-1 mb-1.5">
                    {(['file', 'pinterest'] as const).map(s => (
                      <button key={s} onClick={() => { setLookSource(s); setLookPreview(null); setLookFile(null); }}
                        className={cn("flex-1 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                          lookSource === s ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-400 hover:text-zinc-700")}>
                        {s === 'file' ? '📁 Файл' : '📌 Pinterest'}
                      </button>
                    ))}
                  </div>
                  {lookSource === 'file' ? (
                    <label className={cn(
                      "flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl cursor-pointer transition-all overflow-hidden",
                      lookPreview ? "border-rose-200 p-0" : "border-zinc-200 hover:border-rose-300 p-6"
                    )}>
                      <input ref={lookInputRef} type="file" accept="image/*" className="hidden" onChange={handleLookFile} />
                      {lookPreview
                        ? <img src={lookPreview} className="w-full h-36 object-cover" />
                        : <><Image size={20} className="text-zinc-300" /><span className="text-[10px] font-bold text-zinc-400 text-center">Фото образа</span></>
                      }
                    </label>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-1">
                        <input
                          value={pinterestUrl}
                          onChange={e => setPinterestUrl(e.target.value)}
                          placeholder="https://pinterest.com/pin/..."
                          className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-[10px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 transition-all"
                        />
                        <button onClick={loadPinterest} disabled={isLoadingPin || !pinterestUrl.trim()}
                          className="px-2.5 py-2 bg-rose-500 text-white rounded-lg text-[9px] font-black hover:bg-rose-600 transition-all disabled:opacity-40">
                          {isLoadingPin ? <Loader2 size={11} className="animate-spin" /> : <Link size={11} />}
                        </button>
                      </div>
                      {lookPreview && (
                        <img src={lookPreview} className="w-full h-32 object-cover rounded-xl border border-zinc-100" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button onClick={handleProcess}
                disabled={isProcessing || !modelFile || (!lookFile && !lookPreview)}
                className="w-full py-3 bg-rose-500 text-white rounded-xl text-[10px] font-black hover:bg-rose-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {isProcessing
                  ? <><Loader2 size={13} className="animate-spin" />{processStep}</>
                  : <><Sparkles size={13} />Создать контент</>
                }
              </button>

              {/* Result */}
              {result && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="space-y-3 p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                  <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Результат</p>
                  <img
                    src={`data:image/jpeg;base64,${result.generatedBase64}`}
                    className="w-full rounded-xl object-cover max-h-80"
                  />
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Текст поста</p>
                    <textarea
                      value={editCaption}
                      onChange={e => setEditCaption(e.target.value)}
                      rows={5}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 transition-all resize-y"
                    />
                  </div>
                  <button onClick={handleAddToQueue} disabled={isSavingQueue}
                    className="w-full py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                    {isSavingQueue ? <Loader2 size={12} className="animate-spin" /> : savedOk ? <CheckCircle2 size={12} /> : <ChevronRight size={12} />}
                    {savedOk ? 'Добавлено в очередь!' : 'Добавить в очередь на публикацию'}
                  </button>
                </motion.div>
              )}
            </div>
          )}

          {/* ── QUEUE ── */}
          {tab === 'queue' && (
            <div className="space-y-3">
              {isLoadingQueue ? (
                <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-zinc-300" /></div>
              ) : queueItems.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <Sparkles size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-[11px] font-bold">Очередь пустая</p>
                  <p className="text-[10px] mt-1">Создай контент на вкладке «Создать»</p>
                </div>
              ) : queueItems.map(item => (
                <div key={item.id} className="border border-zinc-100 rounded-xl overflow-hidden">
                  <img src={item.generatedUrl} className="w-full h-56 object-cover" />
                  <div className="p-3 space-y-2">
                    {editingId === item.id ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editingCaption}
                          onChange={e => setEditingCaption(e.target.value)}
                          rows={4}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 transition-all resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveCaption(item.id)}
                            className="flex-1 py-2 bg-zinc-900 text-white rounded-lg text-[9px] font-black">Сохранить</button>
                          <button onClick={() => setEditingId(null)}
                            className="px-3 py-2 bg-zinc-100 rounded-lg text-zinc-500">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-zinc-700 leading-relaxed whitespace-pre-wrap line-clamp-3">{item.caption}</p>
                    )}
                    <p className="text-[9px] text-zinc-400">{new Date(item.createdAt).toLocaleString('ru')}</p>
                    {publishError[item.id] && (
                      <p className="text-[10px] text-red-600 bg-red-50 rounded-lg px-2 py-1">{publishError[item.id]}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => handlePublish(item.id)} disabled={publishingId === item.id}
                        className="flex-1 py-2 bg-rose-500 text-white rounded-lg text-[9px] font-black hover:bg-rose-600 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5">
                        {publishingId === item.id ? <Loader2 size={11} className="animate-spin" /> : <Instagram size={11} />}
                        Опубликовать
                      </button>
                      <button onClick={() => { setEditingId(item.id); setEditingCaption(item.caption); }}
                        className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600 transition-all">
                        <Edit3 size={12} />
                      </button>
                      <button onClick={() => handleDelete(item.id)}
                        className="px-3 py-2 bg-red-50 hover:bg-red-100 rounded-lg text-red-400 transition-all">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── PUBLISHED ── */}
          {tab === 'published' && (
            <div className="space-y-3">
              {publishedItems.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">
                  <Instagram size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-[11px] font-bold">Ещё ничего не опубликовано</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {publishedItems.map(item => (
                    <div key={item.id} className="relative rounded-xl overflow-hidden border border-zinc-100 group">
                      <img src={item.generatedUrl} className="w-full h-40 object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="p-2 bg-white">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                          <span className="text-[9px] font-bold text-emerald-600">Опубликовано</span>
                        </div>
                        <p className="text-[9px] text-zinc-400 mt-0.5">{item.publishedAt ? new Date(item.publishedAt).toLocaleString('ru') : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SETTINGS ── */}
          {tab === 'settings' && (
            <div className="space-y-4">
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-[10px] text-rose-700 space-y-1 leading-relaxed">
                <p className="font-black">Как получить Access Token:</p>
                <p>1. Зайди в <strong>developers.facebook.com</strong> → My Apps → создай приложение</p>
                <p>2. Добавь продукт <strong>Instagram Graph API</strong></p>
                <p>3. В Graph API Explorer получи токен с правами: <code className="bg-rose-100 px-1 rounded">instagram_basic, instagram_content_publish</code></p>
                <p>4. Instagram аккаунт должен быть <strong>Business или Creator</strong></p>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Instagram User ID</label>
                <input
                  value={igUserId}
                  onChange={e => setIgUserId(e.target.value)}
                  placeholder="123456789"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Access Token</label>
                <input
                  value={igToken}
                  onChange={e => setIgToken(e.target.value)}
                  type="password"
                  placeholder="EAAG..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 transition-all"
                />
              </div>
              <button onClick={handleSaveSettings} disabled={isSavingSettings}
                className="w-full py-2.5 bg-zinc-900 text-white rounded-xl text-[10px] font-black hover:bg-zinc-800 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {isSavingSettings ? <Loader2 size={12} className="animate-spin" /> : settingsSaved ? <CheckCircle2 size={12} /> : <Settings size={12} />}
                {settingsSaved ? 'Сохранено!' : 'Сохранить'}
              </button>
            </div>
          )}

        </div>
      </motion.div>
    </div>
  );
};
