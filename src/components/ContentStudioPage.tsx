import React, { useState, useRef } from 'react';
import { Wand2, Image, Video, FileText, Download, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

type Tab = 'image' | 'video' | 'prompt';

export const ContentStudioPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('image');

  // ── Image tab ──
  const [imgText, setImgText] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgSourceImage, setImgSourceImage] = useState<{ file: File; base64: string; mimeType: string } | null>(null);
  const [imgPreviewUrl, setImgPreviewUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState<'prompt' | 'image' | null>(null);
  const [imgResult, setImgResult] = useState<string | null>(null);
  const [imgAspectRatio, setImgAspectRatio] = useState<'1:1' | '4:5' | '9:16' | '16:9'>('1:1');
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
  const vidFileRef = useRef<HTMLInputElement>(null);

  // ── Prompt tab ──
  const [prmText, setPrmText] = useState('');
  const [prmLoading, setPrmLoading] = useState(false);
  const [prmImageResult, setPrmImageResult] = useState('');
  const [prmVideoResult, setPrmVideoResult] = useState('');

  function compressImage(file: File, maxPx = 1920): Promise<{ base64: string; mimeType: string; objectUrl: string }> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
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
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, mimeType, objectUrl } = await compressImage(file);
      if (imgPreviewUrl) URL.revokeObjectURL(imgPreviewUrl);
      setImgPreviewUrl(objectUrl);
      setImgSourceImage({ file, base64, mimeType });
      setImgResult(null);
    } catch (e: any) {
      alert('Ошибка загрузки фото: ' + e.message);
    }
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
      if (!r.ok) throw new Error(await r.text());
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
    const ratioHint: Record<string, string> = { '1:1': 'square 1:1 format', '4:5': 'portrait 4:5 format', '9:16': 'vertical 9:16 portrait format', '16:9': 'horizontal 16:9 landscape format' };
    const prompt = `${basePrompt}. Generate in ${ratioHint[imgAspectRatio]}.`;
    setImgLoading('image');
    setImgResult(null);
    try {
      const r = await fetch('/api/content-studio/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageBase64: imgSourceImage?.base64, imageMimeType: imgSourceImage?.mimeType }),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = text;
        try { const j = JSON.parse(text); msg = j.error || text; } catch {}
        if (msg.includes('high demand') || msg.includes('UNAVAILABLE') || msg.includes('503'))
          msg = 'Gemini перегружен, попробуй через минуту';
        throw new Error(msg);
      }
      const blob = await r.blob();
      setImgResult(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    }
    setImgLoading(null);
  }

  async function handleGenerateVideo() {
    const prompt = vidPrompt || vidText;
    if (!prompt.trim()) return;
    setVidLoading('video');
    setVidResult(null);
    try {
      const r = await fetch('/api/content-studio/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageBase64: vidImage?.base64, imageMimeType: vidImage?.mimeType, duration: vidDuration, aspectRatio: vidAspectRatio }),
      });
      let d: any;
      try { d = await r.json(); } catch { throw new Error('Сервер не ответил — вероятно таймаут. Попробуй ещё раз.'); }
      if (!r.ok) throw new Error(d?.error || `Ошибка сервера ${r.status}`);
      if (!d.videoUrl) throw new Error(d.error || 'Нет ссылки на видео');
      setVidResult(d.videoUrl);
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'image', label: 'Картинка', icon: <Image size={14} /> },
    { id: 'video', label: 'Видео', icon: <Video size={14} /> },
    { id: 'prompt', label: 'Промпт', icon: <FileText size={14} /> },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Wand2 size={20} className="text-purple-500" />
        <h1 className="text-xl font-semibold">Студия</h1>
        <span className="text-xs text-slate-400 ml-1">Gemini Flash 3.1 + Kling v1.6 Pro</span>
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

            {/* Исходное фото (опционально) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Исходное фото (для редактирования)</label>
              {imgSourceImage && imgPreviewUrl ? (
                <div className="relative w-fit">
                  <img src={imgPreviewUrl} alt="source" className="h-36 rounded-xl object-cover" />
                  <button
                    onClick={() => { URL.revokeObjectURL(imgPreviewUrl); setImgPreviewUrl(null); setImgSourceImage(null); if (imgFileRef.current) imgFileRef.current.value = ''; }}
                    className="absolute -top-2 -right-2 bg-white border border-slate-200 rounded-full p-0.5 shadow hover:bg-red-50 transition-colors"
                  >
                    <X size={12} className="text-slate-500" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => imgFileRef.current?.click()}
                  className="flex items-center gap-2 border border-dashed border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-400 hover:border-purple-400 hover:text-purple-500 transition-colors w-full justify-center"
                >
                  <Upload size={14} /> Загрузить фото для редактирования
                </button>
              )}
              <input ref={imgFileRef} type="file" accept="image/*,image/heic,image/heif" className="hidden" onChange={handleImgFileChange} />
            </div>

            {/* Промпт */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {imgSourceImage ? 'Что сделать с фото' : 'Тема или промпт'}
              </label>
              <textarea
                value={imgText}
                onChange={e => { setImgText(e.target.value); setImgPrompt(''); }}
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder={imgSourceImage
                  ? 'Например: поменяй фон на пустыню, розовый на чёрный'
                  : 'Например: красивый закат над горами'}
              />
            </div>

            <button
              onClick={() => improvePrompt(imgText, 'image', setImgPrompt, setImgLoading)}
              disabled={!!imgLoading || !imgText.trim()}
              className="flex items-center gap-1.5 text-xs text-purple-600 font-medium hover:text-purple-800 disabled:opacity-40 transition-colors"
            >
              {imgLoading === 'prompt' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Улучшить промпт через Gemini 2.0
            </button>

            {imgPrompt && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800 border border-purple-100">
                <span className="font-semibold block mb-1">Улучшенный промпт:</span>
                {imgPrompt}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Формат</label>
              <div className="flex gap-2">
                {(['1:1', '4:5', '9:16', '16:9'] as const).map(r => (
                  <button key={r} onClick={() => setImgAspectRatio(r)}
                    className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      imgAspectRatio === r ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerateImage}
              disabled={!!imgLoading || (!imgText.trim() && !imgPrompt.trim())}
              className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {imgLoading === 'image'
                ? <><Loader2 size={14} className="animate-spin" /> Генерирую...</>
                : <><Image size={14} /> {imgSourceImage ? 'Редактировать фото' : 'Сгенерировать картинку'}</>}
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
              Улучшить промпт через Gemini 2.0
            </button>

            {vidPrompt && (
              <div className="bg-purple-50 rounded-xl p-3 text-xs text-purple-800 border border-purple-100">
                <span className="font-semibold block mb-1">Улучшенный промпт:</span>
                {vidPrompt}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
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
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Формат</label>
                <div className="flex gap-1.5">
                  {([['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setVidAspectRatio(val)}
                      className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                        vidAspectRatio === val ? 'bg-purple-600 text-white border-purple-600' : 'border-slate-200 text-slate-600 hover:border-purple-300')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerateVideo}
              disabled={!!vidLoading || !vidImage || (!vidText.trim() && !vidPrompt.trim())}
              className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {vidLoading === 'video'
                ? <><Loader2 size={14} className="animate-spin" /> Генерирую видео (~3 мин)...</>
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
    </div>
  );
};
