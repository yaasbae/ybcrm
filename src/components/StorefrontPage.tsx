import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { ExternalLink, Image as ImageIcon, LoaderCircle, Save, ShoppingBag, Upload } from 'lucide-react';
import { db, handleFirestoreError, OperationType, storage } from '../firebase';

type StorefrontSettings = {
  logoUrl: string;
  heroSlides: string[];
  featuredProductIds: string[];
  storeUrl: string;
};

const defaults: StorefrontSettings = {
  logoUrl: '',
  heroSlides: [
    '/figma/home-hero.png',
    '/figma/article-hero.png',
    '/figma/profile-cover.png',
    '/figma/order-item.png',
  ],
  featuredProductIds: [],
  storeUrl: 'https://yaasbae-store.dmitriiyng.chatgpt.site',
};

async function uploadStorefrontImage(file: File, slot: string) {
  const compressed = await imageCompression(file, {
    maxSizeMB: 2,
    maxWidthOrHeight: 2200,
    useWebWorker: true,
    initialQuality: 0.88,
    fileType: 'image/jpeg',
  });
  const target = ref(storage, `storefront/${slot}_${Date.now()}.jpg`);
  await uploadBytes(target, compressed, { contentType: 'image/jpeg' });
  return getDownloadURL(target);
}

function ImageUploader({ label, busy, onChange }: { label: string; busy: boolean; onChange: (file: File) => void }) {
  return <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400 active:scale-[.98] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
    {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}{busy ? 'Загрузка…' : label}
    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) onChange(file); event.target.value = ''; }} />
  </label>;
}

export const StorefrontPage: React.FC = () => {
  const [settings, setSettings] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => onSnapshot(doc(db, 'settings', 'storefront'), snapshot => {
    if (snapshot.exists()) setSettings({ ...defaults, ...snapshot.data() } as StorefrontSettings);
    setLoading(false);
  }, error => {
    setLoading(false);
    setNotice('Не удалось загрузить настройки витрины');
    console.error(error);
  }), []);

  const upload = async (file: File, slot: string, apply: (url: string) => void) => {
    setUploading(slot);
    setNotice('');
    try { apply(await uploadStorefrontImage(file, slot)); }
    catch (error) { setNotice('Не удалось загрузить изображение'); console.error(error); }
    finally { setUploading(null); }
  };

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      await setDoc(doc(db, 'settings', 'storefront'), { ...settings, updatedAt: new Date().toISOString() }, { merge: true });
      setNotice('Готово. Настройки магазина сохранены.');
    } catch (error) {
      setNotice('Не удалось сохранить настройки');
      try { handleFirestoreError(error, OperationType.WRITE, 'settings/storefront'); } catch { /* message is shown above */ }
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><LoaderCircle className="animate-spin text-zinc-400" /></div>;

  return <section className="mx-auto max-w-[1320px] space-y-5 px-4 pb-28 pt-8 sm:px-6 xl:px-8">
    <div className="grid gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm lg:grid-cols-[1fr_380px] lg:items-end lg:p-8">
      <div><p className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-400">Интернет-магазин</p><h1 className="text-4xl font-medium tracking-[-.055em] text-zinc-900 sm:text-6xl">Управление витриной</h1></div>
      <div className="space-y-4"><p className="text-sm leading-6 text-zinc-500">Цены и фотографии товаров магазин берёт из раздела «Склад». Здесь меняются логотип и первый экран.</p><a className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4" href={settings.storeUrl} target="_blank" rel="noreferrer">Открыть магазин <ExternalLink size={13} /></a></div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-[10px] font-bold">01</span><div><h2 className="font-semibold">Логотип</h2><p className="mt-1 text-xs text-zinc-400">По центру над главным меню.</p></div></div>
        <div className="mb-4 grid min-h-44 place-items-center overflow-hidden rounded-xl bg-zinc-950 p-6 text-white">{settings.logoUrl ? <img className="max-h-28 max-w-full object-contain" src={settings.logoUrl} alt="Логотип магазина" /> : <b className="text-3xl tracking-[-.06em]">YAASBAE</b>}</div>
        <div className="flex flex-wrap gap-2"><ImageUploader label="Загрузить логотип" busy={uploading === 'logo'} onChange={file => upload(file, 'logo', logoUrl => setSettings(current => ({ ...current, logoUrl })))} />{settings.logoUrl && <button className="h-10 rounded-lg px-3 text-[11px] text-zinc-500 hover:bg-zinc-50" onClick={() => setSettings(current => ({ ...current, logoUrl: '' }))}>Вернуть текст</button>}</div>
      </article>

      <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-[10px] font-bold">02</span><div><h2 className="font-semibold">Главный слайдер</h2><p className="mt-1 text-xs text-zinc-400">Четыре фотографии первого экрана.</p></div></div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{settings.heroSlides.map((url, index) => <div key={`${url}-${index}`} className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"><div className="aspect-[3/4] bg-zinc-100">{url ? <img className="h-full w-full object-cover" src={url} alt={`Слайд ${index + 1}`} /> : <div className="grid h-full place-items-center text-zinc-300"><ImageIcon /></div>}</div><div className="flex items-center gap-2 p-2"><b className="text-[10px] text-zinc-400">{String(index + 1).padStart(2, '0')}</b><ImageUploader label="Заменить" busy={uploading === `hero-${index}`} onChange={file => upload(file, `hero_${index}`, nextUrl => setSettings(current => ({ ...current, heroSlides: current.heroSlides.map((slide, i) => i === index ? nextUrl : slide) })))} /></div></div>)}</div>
      </article>
    </div>

    <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-950 text-white"><ShoppingBag size={17} /></span><div><h2 className="font-semibold">Каталог связан со складом</h2><p className="mt-1 text-xs leading-5 text-zinc-400">Название, стоимость и до пяти фотографий меняются в разделе «Склад» и автоматически появляются в магазине.</p></div></div><button onClick={save} disabled={saving} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-xs font-semibold text-white transition hover:bg-zinc-800 active:scale-[.98] disabled:opacity-50">{saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}{saving ? 'Сохраняем…' : 'Сохранить'}</button></article>
    {notice && <p className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-xs font-medium text-zinc-700 shadow-xl" role="status">{notice}</p>}
  </section>;
};
