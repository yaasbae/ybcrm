import React, { useState, useRef } from 'react';
import { Wand2, Image, Video, FileText, Download, Loader2, Sparkles, Upload, X, Send, Copy, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

type Tab = 'image' | 'video' | 'prompt' | 'broadcast';

export const ContentStudioPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('image');

  // ── Image tab ──
  const [imgText, setImgText] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgSourceImages, setImgSourceImages] = useState<Array<{ base64: string; mimeType: string; objectUrl: string }>>([]);
  const [imgLoading, setImgLoading] = useState<'prompt' | 'image' | null>(null);
  const [imgResult, setImgResult] = useState<string | null>(null);
  const [imgAspectRatio, setImgAspectRatio] = useState<'1:1' | '4:5' | '9:16' | '16:9'>('1:1');
  const [imgQuality, setImgQuality] = useState<'1k' | '2k' | '4k'>('1k');
  const imgFileRef = useRef<HTMLInputElement>(null);

  // ── Video tab ──
  const [vidText, setVidText] = useState('');
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidImage, setVidImage] = useState<{ file: File; base64: string; mimeType: string } | null>(null);
  const [vidPreviewUrl, setVidPreviewUrl] = useState<string | null>(null);
  const [vidLoading, setVidLoading] = useState<'prompt' | 'video' | null>(null);
  const [vidResult, setVidResult] = useState<string | null>(null);
  const [vidDuration, setVidDuration] = useState<'5' | '10'>('5');
  const [vidAspectRatio, setVidAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [vidMode, setVidMode] = useState<'fast' | 'standard'>('standard');
  const vidFileRef = useRef<HTMLInputElement>(null);

  // ── Prompt tab ──
  const [prmText, setPrmText] = useState('');
  const [prmLoading, setPrmLoading] = useState(false);
  const [prmImageResult, setPrmImageResult] = useState('');
  const [prmVideoResult, setPrmVideoResult] = useState('');

  // ── Broadcast tab ──
  const [brText, setBrText] = useState('');
  const [brResult, setBrResult] = useState('');
  const [brVariants, setBrVariants] = useState<string[]>([]);
  const [brLoading, setBrLoading] = useState<'copy' | 'variants' | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  async function normalizeImageFile(file: File): Promise<Blob> {
    const isHeic = /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (!isHeic) return file;
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(converted) ? converted[0] : converted;
  }

  function getApiError(text: string, fallback = 'Ошибка сервера') {
    try {
      const json = JSON.parse(text);
      return json.error || json.message || text || fallback;
    } catch {
      return text || fallback;
    }
  }

  async function compressImage(file: File, maxPx = 1920): Promise<{ base64: string; mimeType: string; objectUrl: string }> {
    const source = await normalizeImageFile(file);
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(source);
      const img = new window.Image();
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', objectUrl });
      };
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      img.src = objectUrl;
    });
  }

  async function handleImgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 3 - imgSourceImages.length);
    if (!files.length) return;
    try {
      const compressed = await Promise.all(files.map(file => compressImage(file)));
      setImgSourceImages(prev => [...prev, ...compressed].slice(0, 3));
      setImgResult(null);
    } catch (err: any) {
      alert('Ошибка загрузки фото: ' + err.message);
    }
    e.target.value = '';
  }

  function removeImgPhoto(idx: number) {
    setImgSourceImages(prev => {
      URL.revokeObjectURL(prev[idx].objectUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleVidFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, mimeType, objectUrl } = await compressImage(file);
      if (vidPreviewUrl) URL.revokeObjectURL(vidPreviewUrl);
      setVidPreviewUrl(objectUrl);
      setVidImage({ file, base64, mimeType });
    } catch (e: any) {
      alert('Ошибка загрузки фото: ' + e.message);
    }
  }

  async function improvePrompt(text: string, mode: 'image' | 'video', setPrompt: (s: string) => void, setLoading: (v: any) => void) {
    if (!text.trim()) return;
    setLoading('prompt');
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 28000);
    try {
      const r = await fetch('/api/content-studio/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(getApiError(await r.text()));
      const d = await r.json();
      if (d.prompt) setPrompt(d.prompt);
    } catch (e: any) {
      const msg = e.name === 'AbortError' ? 'Gemini не ответил за 28 сек, попробуй ещё раз' : e.message;
      alert('Не удалось улучшить промпт: ' + msg);
    } finally {
      clearTimeout(tid);
    }
    setLoading(null);
  }

  async function handleGenerateImage() {
    const basePrompt = imgPrompt || imgText;
    if (!basePrompt.trim()) return;
    const prompt = basePrompt;
    setImgLoading('image');
    setImgResult(null);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 240000);
    try {
      const r = await fetch('/api/content-studio/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, images: imgSourceImages.map(i => ({ base64: i.base64, mimeType: i.mimeType })), quality: imgQuality, aspectRatio: imgAspectRatio }),
        signal: controller.signal,
      });
      if (!r.ok) {
        let msg = getApiError(await r.text());
        if (msg.includes('high demand') || msg.includes('UNAVAILABLE') || msg.includes('503'))
          msg = 'Gemini перегружен, попробуй через минуту';
        throw new Error(msg);
      }
      const blob = await r.blob();
      setImgResult(URL.createObjectURL(blob));
    } catch (e: any) {
      const msg = (e as any).name === 'AbortError' ? 'Timeout: слишком долго, попробуй ещё раз' : e.message;
      alert('Ошибка: ' + msg);
    } finally {
      clearTimeout(tid);
    }
    setImgLoading(null);
  }

  async function handleGenerateVideo() {
    const prompt = vidPrompt || vidText;
    if (!prompt.trim()) return;
    setVidLoading('video');
    setVidResult(null);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 480000);
    try {
      const r = await fetch('/api/content-studio/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageBase64: vidImage?.base64, imageMimeType: vidImage?.mimeType, duration: vidDuration, aspectRatio: vidAspectRatio, mode: vidMode }),
        signal: controller.signal,
      });
      let d: any;
      try { d = await r.json(); } catch { throw new Error('Сервер не ответил — вероятно таймаут. Попробуй ещё раз.'); }
      if (!r.ok) throw new Error(d?.error || `Ошибка сервера ${r.status}`);
      if (!d.videoUrl) throw new Error(d.error || 'Нет ссылки на видео');
      setVidResult(d.videoUrl);
    } catch (e: any) {
      const msg = e.name === 'AbortError' ? 'Видео генерируется слишком долго. Попробуй Fast или 5 секунд.' : e.message;
      alert('Ошибка: ' + msg);
    } finally {
      clearTimeout(tid);
    }
    setVidLoading(null);
  }

  async function handleWritePrompts() {
    if (!prmText.trim()) return;
    setPrmLoading(true);
    setPrmImageResult('');
    setPrmVideoResult('');
    try {
      const [imgR, vidR] = await Promise.all([
        fetch('/api/content-studio/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prmText, mode: 'image' }) }).then(r => r.json()),
        fetch('/api/content-studio/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: prmText, mode: 'video' }) }).then(r => r.json()),
      ]);
      if (imgR.prompt) setPrmImageResult(imgR.prompt);
      if (vidR.prompt) setPrmVideoResult(vidR.prompt);
    } catch { /* ignore */ }
    setPrmLoading(false);
  }

  async function handleWriteBroadcast() {
    if (!brText.trim()) return;
    setBrLoading('copy');
    setBrResult('');
    setBrVariants([]);
    try {
      const r = await fetch('/api/content-studio/broadcast-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: brText }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (d.message) setBrResult(d.message);
    } catch (e: any) {
      alert('Не удалось написать текст рассылки: ' + e.message);
    } finally {
      setBrLoading(null);
    }
  }

  async function handleWriteBroadcastVariants() {
    const base = brResult || brText;
    if (!base.trim()) return;
    setBrLoading('variants');
    try {
      const r = await fetch('/api/ai/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: base }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setBrVariants(d.variants || []);
    } catch (e: any) {
      alert('Не удалось сделать варианты: ' + e.message);
    } finally {
      setBrLoading(null);
    }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedText(key);
    window.setTimeout(() => setCopiedText(current => current === key ? null : current), 1200);
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'image', label: 'Картинка', icon: <Image size={14} /> },
    { id: 'video', label: 'Видео', icon: <Video size={14} /> },
    { id: 'prompt', label: 'Промпт', icon: <FileText size={14} /> },
    { id: 'broadcast', label: 'Рассылка', icon: <Send size={14} /> },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Wand2 size={20} className="text-purple-500" />
        <h1 className="text-xl font-semibold">Студия</h1>
        <span className="text-xs text-slate-400 ml-1">Gemini Flash 3.1 + Seedance 2.0</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Image Tab ── */}
      {tab === 'image' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">

            {/* Исходные фото (до 3, опционально) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Фото для редактирования <span className="text-slate-400 font-normal normal-case">(до 3 шт.)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {imgSourceImages.map((img, idx) => (
                  <div key={idx} className="relative">
                    <img src={img.objectUrl} alt={`фото ${idx + 1}`} className="h-24 w-24 rounded-xl object-cover" />
                    <button onClick={() => removeImgPhoto(idx)}
                      className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-red-50 transition-colors">
                      <X size={12} className="text-slate-500" />
                    </button>
                  </div>
                ))}
                {imgSourceImages.length < 3 && (
                  <button onClick={() => imgFileRef.current?.click()}
                    className="h-24 w-24 flex flex-col items-center justify-center gap-1 border border-dashed border-slate-300 rounded-xl text-slate-400 hover:border-purple-400 hover:text-purple-500 transition-colors text-xs">
                    <Upload size={16} /> Добавить
                  </button>
                )}
              </div>
              <input ref={imgFileRef} type="file" accept="image/*,image/heic,image/heif" multiple className="hidden" onChange={handleImgFileChange} />
            </div>

            {/* Промпт */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {imgSourceImages.length > 0 ? 'Что сделать с фото' : 'Тема или промпт'}
              </label>
              <textarea
                value={imgText}
                onChange={e => { setImgText(e.target.value); setImgPrompt(''); }}
                rows={2}
                inputMode="text"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder={imgSourceImages.length > 0
                  ? 'Например: поменяй фон на пустыню, объедини в один образ'
                  : 'Например: красивый закат над горами'}
              />
            </div>

            <button
              onClick={() => improvePrompt(imgText, 'image', setImgPrompt, setImgLoading)}
              disabled={!!imgLoading || !imgText.trim()}
              className="flex items-center gap-1.5 text-xs text-purple-600 font-medium hover:text-purple-800 disabled:opacity-40 transition-colors"
            >
              {imgLoading === 'prompt' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Улучшить промпт через Gemini 3.1
            </button>

            {imgPrompt && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800 border border-purple-100">
                <span className="font-semibold block mb-1">Улучшенный промпт:</span>
                {imgPrompt}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Качество</label>
                <div className="flex gap-1.5">
                  {(['1k', '2k', '4k'] as const).map(q => (
                    <button key={q} onClick={() => setImgQuality(q)}
                      className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                        imgQuality === q ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                      {q.toUpperCase()}
                    </button>
                  ))}
                </div>
                {imgQuality !== '1k' && <p className="text-xs text-slate-400">Нативное качество Gemini</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Формат</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['1:1', '4:5', '9:16', '16:9'] as const).map(r => (
                    <button key={r} onClick={() => setImgAspectRatio(r)} disabled={imgSourceImages.length > 0}
                      className={cn('py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                        imgAspectRatio === r && imgSourceImages.length === 0 ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300',
                          imgSourceImages.length > 0 && 'opacity-40 cursor-not-allowed')}>
                      {r}
                    </button>
                  ))}
                </div>
                {imgSourceImages.length > 0 && <p className="text-xs text-slate-400">Формат работает только без фото</p>}
              </div>
            </div>

            <button
              onClick={handleGenerateImage}
              disabled={!!imgLoading || (!imgText.trim() && !imgPrompt.trim())}
              className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {imgLoading === 'image'
                ? <><Loader2 size={14} className="animate-spin" /> Генерирую...</>
                : <><Image size={14} /> {imgSourceImages.length > 0 ? 'Редактировать фото' : 'Сгенерировать картинку'}</>}
            </button>
          </div>

          {imgResult && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <img src={imgResult} alt="result" className="w-full" />
              <div className="p-3 flex justify-end">
                <a href={imgResult} download="studio-image.jpg" className="flex items-center gap-1.5 text-xs text-slate-600 font-medium hover:text-slate-900 transition-colors">
                  <Download size={13} /> Скачать
                </a>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── Video Tab ── */}
      {tab === 'video' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Картинка <span className="text-red-400">*</span></label>
              {vidImage && vidPreviewUrl ? (
                <div className="relative w-fit">
                  <img src={vidPreviewUrl} alt="uploaded" className="h-28 rounded-xl object-cover" />
                  <button onClick={() => { URL.revokeObjectURL(vidPreviewUrl); setVidPreviewUrl(null); setVidImage(null); if (vidFileRef.current) vidFileRef.current.value = ''; }} className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-red-50 transition-colors">
                    <X size={12} className="text-slate-500" />
                  </button>
                </div>
              ) : (
                <button onClick={() => vidFileRef.current?.click()} className="flex items-center gap-2 border border-dashed border-purple-300 rounded-xl px-4 py-3 text-sm text-purple-400 hover:border-purple-500 hover:text-purple-600 transition-colors w-full justify-center">
                  <Upload size={14} /> Загрузить картинку для видео
                </button>
              )}
              <input ref={vidFileRef} type="file" accept="image/*,image/heic,image/heif" className="hidden" onChange={handleVidFileChange} />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Тема или промпт</label>
              <textarea
                value={vidText}
                onChange={e => { setVidText(e.target.value); setVidPrompt(''); }}
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="Например: плавное движение камеры вдоль горного хребта"
              />
            </div>

            <button
              onClick={() => improvePrompt(vidText, 'video', setVidPrompt, setVidLoading)}
              disabled={!!vidLoading || !vidText.trim()}
              className="flex items-center gap-1.5 text-xs text-purple-600 font-medium hover:text-purple-800 disabled:opacity-40 transition-colors"
            >
              {vidLoading === 'prompt' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Улучшить промпт через Gemini 3.1
            </button>

            {vidPrompt && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800 border border-purple-100">
                <span className="font-semibold block mb-1">Улучшенный промпт:</span>
                {vidPrompt}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Длительность</label>
              <div className="flex gap-2">
                {(['5', '10'] as const).map(d => (
                  <button key={d} onClick={() => setVidDuration(d)}
                    className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      vidDuration === d ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                    {d} сек
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Режим</label>
              <div className="flex gap-2">
                <button onClick={() => setVidMode('fast')}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                    vidMode === 'fast' ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                  ⚡ Fast (~30 сек)
                </button>
                <button onClick={() => setVidMode('standard')}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                    vidMode === 'standard' ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                  🎬 Standard (~2 мин)
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Формат</label>
              <div className="flex gap-2">
                {(['16:9', '9:16', '1:1'] as const).map(r => (
                  <button key={r} onClick={() => setVidAspectRatio(r)}
                    className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      vidAspectRatio === r ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerateVideo}
              disabled={!!vidLoading || !vidImage || (!vidText.trim() && !vidPrompt.trim())}
              className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {vidLoading === 'video'
                ? <><Loader2 size={14} className="animate-spin" /> Генерирую видео ({vidMode === 'fast' ? '~30 сек' : '~2 мин'})...</>
                : <><Video size={14} /> Сгенерировать видео</>}
            </button>
          </div>

          {vidResult && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <video src={vidResult} controls className="w-full" />
              <div className="p-3 flex justify-end">
                <a href={vidResult} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-slate-600 font-medium hover:text-slate-900 transition-colors">
                  <Download size={13} /> Скачать / Открыть
                </a>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── Prompt Tab ── */}
      {tab === 'prompt' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Тема</label>
              <textarea
                value={prmText}
                onChange={e => setPrmText(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="Например: продукт в стиле минимализм"
              />
            </div>

            <button
              onClick={handleWritePrompts}
              disabled={prmLoading || !prmText.trim()}
              className="w-full bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              {prmLoading ? <><Loader2 size={14} className="animate-spin" /> Генерирую...</> : <><Sparkles size={14} /> Написать промпты</>}
            </button>
          </div>

          {(prmImageResult || prmVideoResult) && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              {prmImageResult && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
                    <Image size={12} /> Промпт для картинки
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{prmImageResult}</p>
                  <button onClick={() => navigator.clipboard.writeText(prmImageResult)} className="text-xs text-purple-600 hover:text-purple-800 font-medium transition-colors">
                    Скопировать
                  </button>
                </div>
              )}
              {prmVideoResult && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
                    <Video size={12} /> Промпт для видео
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{prmVideoResult}</p>
                  <button onClick={() => navigator.clipboard.writeText(prmVideoResult)} className="text-xs text-purple-600 hover:text-purple-800 font-medium transition-colors">
                    Скопировать
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── Broadcast Tab ── */}
      {tab === 'broadcast' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Тема рассылки</label>
                <span className="text-xs text-slate-400">{(brResult || brText).length}/160</span>
              </div>
              <textarea
                value={brText}
                onChange={e => { setBrText(e.target.value); setBrResult(''); setBrVariants([]); }}
                rows={3}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="Например: новая коллекция, осталось мало размеров, предложить написать менеджеру"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={handleWriteBroadcast}
                disabled={!!brLoading || !brText.trim()}
                className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-40 transition-colors"
              >
                {brLoading === 'copy' ? <><Loader2 size={14} className="animate-spin" /> Пишу...</> : <><Sparkles size={14} /> Написать текст</>}
              </button>
              <button
                onClick={handleWriteBroadcastVariants}
                disabled={!!brLoading || !(brResult || brText).trim()}
                className="w-full bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-40 transition-colors"
              >
                {brLoading === 'variants' ? <><Loader2 size={14} className="animate-spin" /> Генерирую...</> : <><Send size={14} /> 9 вариантов</>}
              </button>
            </div>
          </div>

          {brResult && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
                  <Send size={12} /> Готовый текст
                </div>
                <button onClick={() => copyText(brResult, 'main')} className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium transition-colors">
                  {copiedText === 'main' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedText === 'main' ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{brResult}</p>
            </motion.div>
          )}

          {brVariants.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
                <Sparkles size={12} /> Варианты для ротации
              </div>
              <div className="space-y-2">
                {brVariants.map((variant, i) => (
                  <div key={`${variant}-${i}`} className="flex items-start gap-2 rounded-xl bg-violet-50 border border-violet-100 p-3">
                    <span className="text-xs font-bold text-violet-500 w-5 shrink-0">{i + 1}</span>
                    <p className="text-xs text-slate-700 leading-relaxed flex-1">{variant}</p>
                    <button onClick={() => copyText(variant, `variant-${i}`)} className="text-violet-500 hover:text-violet-700 transition-colors shrink-0">
                      {copiedText === `variant-${i}` ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
};
