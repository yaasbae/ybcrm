import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import {
  Check, ExternalLink, FileText, Image as ImageIcon, Images, Info,
  LayoutDashboard, LoaderCircle, Menu, Newspaper, Plus, Save, Search,
  Settings2, ShoppingBag, Trash2, Upload,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType, storage } from '../firebase';
import { createStudioCutout } from '../lib/studioImage';

type HeroSlide = {
  id: string;
  imageUrl: string;
  eyebrow: string;
  title: string;
  buttonLabel: string;
  buttonUrl: string;
  enabled: boolean;
};

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: string;
  imageUrl: string;
  body: string;
  published: boolean;
};

type ContentPage = {
  title: string;
  intro: string;
  body: string;
};

type StorefrontSettings = {
  storeUrl: string;
  logoUrl: string;
  announcementText: string;
  announcementEnabled: boolean;
  menu: { about: string; catalog: string; offers: string; contacts: string };
  heroSlides: string[];
  heroItems: HeroSlide[];
  lookbook: { eyebrow: string; title: string; description: string; images: string[] };
  popular: { eyebrow: string; title: string; linkLabel: string };
  about: { eyebrow: string; title: string; body: string; buttonLabel: string; buttonUrl: string; imageUrl: string };
  campaign: { eyebrow: string; title: string; buttonLabel: string; buttonUrl: string; backgroundImage: string };
  articlesTitle: string;
  articles: Article[];
  pages: {
    about: ContentPage;
    delivery: ContentPage;
    returns: ContentPage;
    privacy: ContentPage;
    offer: ContentPage;
  };
  footer: { email: string; phone: string; address: string; telegram: string; vk: string; instagram: string; legalName: string };
  seo: { title: string; description: string; ogImage: string; keywords: string };
  featuredProductIds: string[];
};

const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const defaultSlides: HeroSlide[] = [
  { id: 'hero-1', imageUrl: '/assets/hero.webp', eyebrow: 'New Drop SS24', title: 'flames olympiya', buttonLabel: 'Смотреть коллекцию', buttonUrl: '/catalog', enabled: true },
  { id: 'hero-2', imageUrl: '/figma/editorial-5.webp', eyebrow: 'YAASBAE / 02', title: 'choose yourself', buttonLabel: 'В каталог', buttonUrl: '/catalog', enabled: true },
  { id: 'hero-3', imageUrl: '/figma/article-2.webp', eyebrow: 'People / 03', title: 'freedom to be seen', buttonLabel: 'Истории бренда', buttonUrl: '/articles', enabled: true },
];

const defaultArticles: Article[] = [
  { id: 'flames', slug: 'flames', title: 'Flames: как рождается символ свободы', excerpt: 'История принта, который стал нашим знаком.', category: 'История', readTime: '7 минут', imageUrl: '/figma/editorial-3.webp', body: '', published: true },
  { id: 'people', slug: 'people', title: 'People of YAASBAE', excerpt: 'Герои, которые не боятся быть заметными.', category: 'Люди', readTime: '5 минут', imageUrl: '/figma/editorial-4.webp', body: '', published: true },
  { id: 'oversize', slug: 'oversize', title: 'Как носить oversize', excerpt: 'Пять образов и ни одного правила.', category: 'Гид', readTime: '4 минуты', imageUrl: '/figma/editorial-5.webp', body: '', published: true },
];

const defaults: StorefrontSettings = {
  storeUrl: 'https://yaasbae.store',
  logoUrl: '',
  announcementText: 'Бесплатная доставка от 15 000 ₽',
  announcementEnabled: false,
  menu: { about: 'О нас', catalog: 'Каталог', offers: 'Акции', contacts: 'Контакты' },
  heroSlides: defaultSlides.map(item => item.imageUrl),
  heroItems: defaultSlides,
  lookbook: { eyebrow: 'Community / 01', title: 'Нам доверяют', description: 'YAASBAE — женский бренд для тех, кто создаёт собственный стиль каждый день.', images: ['/figma/blogger-1.webp', '/figma/blogger-2.webp', '/figma/blogger-3.webp', '/figma/blogger-4.webp', '/figma/blogger-5.webp'] },
  popular: { eyebrow: 'Shop / 02', title: 'Популярные товары', linkLabel: 'Смотреть каталог' },
  about: { eyebrow: 'Бренд / 01', title: 'Вещи, которые говорят за тебя', body: 'Мы соединяем свободный крой, узнаваемые детали и ощущение внутренней силы. YAASBAE — не про правила, а про право быть собой.', buttonLabel: 'Читать историю', buttonUrl: '/articles/flames', imageUrl: '/figma/home-look-1.webp' },
  campaign: { eyebrow: 'Новая женская коллекция', title: 'Одежда для тех, кто выбирает себя.', buttonLabel: 'Перейти в каталог', buttonUrl: '/catalog', backgroundImage: '' },
  articlesTitle: 'Истории YAASBAE',
  articles: defaultArticles,
  pages: {
    about: { title: 'О бренде', intro: 'YAASBAE — одежда для тех, кто выбирает себя.', body: 'Расскажите здесь историю бренда, его ценности и подход к созданию коллекций.' },
    delivery: { title: 'Доставка и оплата', intro: 'Доставляем заказы по России службой СДЭК.', body: 'Стоимость и срок рассчитываются при оформлении заказа. Оплата проходит на защищённой странице банка.' },
    returns: { title: 'Обмен и возврат', intro: 'Вернуть товар можно в течение 7 дней после получения.', body: 'Товар должен сохранить товарный вид, бирки и оригинальную упаковку. Опишите здесь подробный порядок возврата.' },
    privacy: { title: 'Политика конфиденциальности', intro: 'Мы бережно относимся к персональным данным.', body: 'Укажите здесь полную редакцию политики обработки персональных данных.' },
    offer: { title: 'Публичная оферта', intro: 'Условия продажи товаров в интернет-магазине YAASBAE.', body: 'Укажите здесь полную редакцию публичной оферты.' },
  },
  footer: { email: 'hello@yaasbae.com', phone: '8 800 555 35 35', address: 'Россия', telegram: 'https://t.me/yaasbae', vk: 'https://vk.com/yaasbae', instagram: 'https://instagram.com/yaasbae', legalName: 'ООО «ЯСБЭЙ»' },
  seo: { title: 'YAASBAE — женская одежда', description: 'Женская одежда YAASBAE: свободный крой, узнаваемые детали и доставка по России.', ogImage: '/og.jpg', keywords: 'женская одежда, YAASBAE, oversize, олимпийки' },
  featuredProductIds: [],
};

type SectionId = 'overview' | 'home' | 'articles' | 'pages' | 'navigation' | 'seo';

const sections: { id: SectionId; label: string; description: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Обзор', description: 'Что подключено', icon: LayoutDashboard },
  { id: 'home', label: 'Главная', description: 'Слайдер и блоки', icon: Images },
  { id: 'articles', label: 'Статьи', description: 'Карточки и тексты', icon: Newspaper },
  { id: 'pages', label: 'Страницы', description: 'О нас и документы', icon: FileText },
  { id: 'navigation', label: 'Меню и контакты', description: 'Шапка и подвал', icon: Menu },
  { id: 'seo', label: 'SEO и соцсети', description: 'Поиск и превью', icon: Search },
];

function mergeSettings(value: Partial<StorefrontSettings>): StorefrontSettings {
  const legacySlides = Array.isArray(value.heroSlides) && value.heroSlides.length ? value.heroSlides : defaults.heroSlides;
  const heroItems = Array.isArray(value.heroItems) && value.heroItems.length
    ? value.heroItems.map((item, index) => ({ ...defaultSlides[index % defaultSlides.length], ...item, id: item.id || id() }))
    : legacySlides.map((imageUrl, index) => ({ ...defaultSlides[index % defaultSlides.length], id: `hero-${index + 1}`, imageUrl }));
  return {
    ...defaults,
    ...value,
    menu: { ...defaults.menu, ...(value.menu || {}) },
    heroItems,
    heroSlides: heroItems.filter(item => item.enabled).map(item => item.imageUrl).filter(Boolean),
    lookbook: { ...defaults.lookbook, ...(value.lookbook || {}) },
    popular: { ...defaults.popular, ...(value.popular || {}) },
    about: { ...defaults.about, ...(value.about || {}) },
    campaign: { ...defaults.campaign, ...(value.campaign || {}) },
    articles: Array.isArray(value.articles) && value.articles.length ? value.articles.map(item => ({ ...defaultArticles[0], ...item, id: item.id || id() })) : defaults.articles,
    pages: {
      about: { ...defaults.pages.about, ...(value.pages?.about || {}) },
      delivery: { ...defaults.pages.delivery, ...(value.pages?.delivery || {}) },
      returns: { ...defaults.pages.returns, ...(value.pages?.returns || {}) },
      privacy: { ...defaults.pages.privacy, ...(value.pages?.privacy || {}) },
      offer: { ...defaults.pages.offer, ...(value.pages?.offer || {}) },
    },
    footer: { ...defaults.footer, ...(value.footer || {}) },
    seo: { ...defaults.seo, ...(value.seo || {}) },
  };
}

async function uploadStorefrontImage(file: File, slot: string, removeBackground = false) {
  const prepared = removeBackground ? await createStudioCutout(file) : file;
  const compressed = await imageCompression(prepared, {
    maxSizeMB: 2,
    maxWidthOrHeight: 2200,
    useWebWorker: true,
    initialQuality: 0.88,
    fileType: removeBackground ? 'image/webp' : 'image/jpeg',
  });
  const extension = removeBackground ? 'webp' : 'jpg';
  const contentType = removeBackground ? 'image/webp' : 'image/jpeg';
  const target = ref(storage, `storefront/${slot}_${Date.now()}.${extension}`);
  await uploadBytes(target, compressed, { contentType });
  return getDownloadURL(target);
}

const fieldClass = 'h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-300 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100';
const textareaClass = 'min-h-28 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-sm leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-300 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100';

function Field({ label, hint, value, onChange, placeholder = '', type = 'text' }: { label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-zinc-600">{label}{hint && <small className="font-normal text-zinc-400">{hint}</small>}</span><input type={type} className={fieldClass} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
}

function Textarea({ label, hint, value, onChange, rows = 5 }: { label: string; hint?: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-zinc-600">{label}{hint && <small className="font-normal text-zinc-400">{hint}</small>}</span><textarea rows={rows} className={textareaClass} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-zinc-600"><input className="peer sr-only" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="relative h-6 w-10 rounded-full bg-zinc-200 transition peer-checked:bg-zinc-900 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />{label}</label>;
}

function ImageUploader({ label = 'Загрузить', busy, onChange }: { label?: string; busy: boolean; onChange: (file: File) => void }) {
  return <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400 active:scale-[.98] ${busy ? 'pointer-events-none opacity-50' : ''}`}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}{busy ? 'Загрузка…' : label}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) onChange(file); event.target.value = ''; }} /></label>;
}

function Card({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(24,24,27,.035)] sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold tracking-[-.02em] text-zinc-900">{title}</h2>{description && <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{description}</p>}</div>{action}</div>{children}</article>;
}

function ImageField({ value, slot, uploading, onUpload, onClear, ratio = 'aspect-[16/8]' }: { value: string; slot: string; uploading: string | null; onUpload: (file: File) => void; onClear: () => void; ratio?: string }) {
  return <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"><div className={`${ratio} grid place-items-center overflow-hidden bg-zinc-100`}>{value ? <img className="h-full w-full object-cover" src={value} alt="" /> : <ImageIcon className="text-zinc-300" />}</div><div className="flex flex-wrap items-center gap-2 p-2"><ImageUploader label={value ? 'Заменить' : 'Добавить'} busy={uploading === slot} onChange={onUpload} />{value && <button type="button" onClick={onClear} className="h-10 rounded-xl px-3 text-[11px] text-zinc-500 transition hover:bg-white hover:text-red-600">Удалить</button>}</div></div>;
}

export const StorefrontPage: React.FC = () => {
  const [settings, setSettings] = useState<StorefrontSettings>(defaults);
  const [active, setActive] = useState<SectionId>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'settings', 'storefront'), snapshot => {
    setSettings(snapshot.exists() ? mergeSettings(snapshot.data() as Partial<StorefrontSettings>) : defaults);
    setLoading(false);
    setDirty(false);
  }, error => { setLoading(false); setNotice('Не удалось загрузить настройки витрины'); console.error(error); }), []);

  const change = (updater: (current: StorefrontSettings) => StorefrontSettings) => { setSettings(updater); setDirty(true); };
  const upload = async (file: File, slot: string, apply: (url: string) => void, removeBackground = false) => {
    setUploading(slot);
    setNotice('');
    try { apply(await uploadStorefrontImage(file, slot, removeBackground)); setDirty(true); }
    catch (error) { setNotice('Не удалось загрузить изображение'); console.error(error); }
    finally { setUploading(null); }
  };

  const save = async () => {
    setSaving(true); setNotice('');
    const normalized = { ...settings, heroSlides: settings.heroItems.filter(item => item.enabled).map(item => item.imageUrl).filter(Boolean), updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(db, 'settings', 'storefront'), normalized, { merge: true });
      setSettings(current => ({ ...current, heroSlides: normalized.heroSlides }));
      setDirty(false); setNotice('Готово. Изменения сохранены и доступны витрине.');
    } catch (error) {
      setNotice('Не удалось сохранить настройки');
      try { handleFirestoreError(error, OperationType.WRITE, 'settings/storefront'); } catch { /* notice already shown */ }
    } finally { setSaving(false); }
  };

  const completeness = useMemo(() => {
    const checks = [settings.logoUrl, settings.heroItems.some(item => item.imageUrl && item.enabled), settings.about.title, settings.articles.some(item => item.published), settings.pages.delivery.body, settings.pages.returns.body, settings.footer.email, settings.seo.title, settings.seo.description];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }, [settings]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><LoaderCircle className="animate-spin text-zinc-400" /></div>;

  return <section className="mx-auto max-w-[1480px] px-4 pb-28 pt-8 sm:px-6 xl:px-8">
    <header className="mb-5 flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.2em] text-zinc-400">Интернет-магазин / CMS</p><h1 className="text-3xl font-medium tracking-[-.05em] text-zinc-900 sm:text-5xl">Управление сайтом</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">Весь текстовый и визуальный контент YAASBAE в одном месте. Товары, цены и остатки по-прежнему редактируются в разделе «Склад».</p></div>
      <div className="flex flex-wrap items-center gap-2"><a href={settings.storeUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400">Открыть сайт <ExternalLink size={14} /></a><button type="button" onClick={save} disabled={saving || !dirty} className="inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-950 px-5 text-xs font-semibold text-white transition hover:bg-zinc-800 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40">{saving ? <LoaderCircle size={15} className="animate-spin" /> : dirty ? <Save size={15} /> : <Check size={15} />}{saving ? 'Сохраняем…' : dirty ? 'Сохранить изменения' : 'Всё сохранено'}</button></div>
    </header>

    <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm lg:sticky lg:top-4">
        {sections.map(section => <button type="button" key={section.id} onClick={() => setActive(section.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${active === section.id ? 'bg-zinc-950 text-white' : 'text-zinc-700 hover:bg-zinc-50'}`}><section.icon size={17} className={active === section.id ? 'text-white' : 'text-zinc-400'} /><span className="min-w-0"><b className="block text-xs font-semibold">{section.label}</b><small className={`mt-0.5 block text-[10px] ${active === section.id ? 'text-zinc-400' : 'text-zinc-400'}`}>{section.description}</small></span></button>)}
        <div className="m-2 mt-4 rounded-xl bg-zinc-50 p-3"><div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-zinc-500"><span>Заполнено</span><span>{completeness}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-200"><div className="h-full rounded-full bg-zinc-900 transition-all" style={{ width: `${completeness}%` }} /></div></div>
      </aside>

      <div className="min-w-0 space-y-5">
        {active === 'overview' && <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {([
              ['Главная страница', `${settings.heroItems.filter(item => item.enabled).length} слайда · ${settings.lookbook.images.length} фото`, Images],
              ['Статьи', `${settings.articles.filter(item => item.published).length} опубликовано`, Newspaper],
              ['Служебные страницы', 'О нас · доставка · возврат · документы', FileText],
            ] as [string, string, React.ElementType][]).map(([title, text, Icon]) => <button type="button" key={String(title)} onClick={() => setActive(title === 'Главная страница' ? 'home' : title === 'Статьи' ? 'articles' : 'pages')} className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-400"><span className="mb-8 grid h-10 w-10 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><Icon size={18} /></span><b className="block text-sm text-zinc-900">{title}</b><small className="mt-1 block text-xs text-zinc-400">{text}</small></button>)}
          </div>
          <Card title="Статус витрины" description="Основные связи сайта и CRM.">
            <div className="divide-y divide-zinc-100">{[
              ['Каталог и цены', 'Раздел «Склад»', true], ['СДЭК', 'Расчёт и пункты выдачи', true], ['Точка Банк', 'Оплата заказа', true], ['Контент сайта', `Заполнено на ${completeness}%`, completeness === 100],
            ].map(([title, text, ready]) => <div key={String(title)} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><div className="flex items-center gap-3"><span className={`grid h-8 w-8 place-items-center rounded-full ${ready ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{ready ? <Check size={14} /> : <Info size={14} />}</span><div><b className="block text-xs text-zinc-800">{title}</b><small className="text-[11px] text-zinc-400">{text}</small></div></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{ready ? 'Готово' : 'Заполнить'}</span></div>)}</div>
          </Card>
          <Card title="Каталог связан со складом" description="Название, описание, размеры, стоимость и фотографии товара меняются в «Складе» и автоматически появляются на сайте."><div className="flex items-center gap-3 rounded-xl bg-zinc-950 p-4 text-white"><ShoppingBag size={18} /><p className="text-xs leading-5 text-zinc-300">Не создавайте карточки товаров здесь повторно — это приведёт к расхождению остатков.</p></div></Card>
        </>}

        {active === 'home' && <>
          <Card title="Главный слайдер" description="Фон загруженной фотографии удаляется автоматически: модель появится прямо на белом фоне сайта. Можно добавлять, скрывать и заменять слайды." action={<button type="button" onClick={() => change(current => ({ ...current, heroItems: [...current.heroItems, { id: id(), imageUrl: '', eyebrow: 'New story', title: 'Название слайда', buttonLabel: 'Смотреть', buttonUrl: '/catalog', enabled: true }] }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-[10px] font-semibold text-white"><Plus size={13} /> Добавить</button>}>
            <div className="space-y-4">{settings.heroItems.map((slide, index) => <div key={slide.id} className="grid gap-4 rounded-2xl border border-zinc-200 p-3 sm:p-4 xl:grid-cols-[210px_minmax(0,1fr)]"><ImageField value={slide.imageUrl} slot={`hero-${slide.id}`} uploading={uploading} ratio="aspect-[4/5]" onUpload={file => upload(file, `hero_${slide.id}`, imageUrl => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, imageUrl } : item) })), true)} onClear={() => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, imageUrl: '' } : item) }))} /><div className="space-y-3"><div className="flex items-center justify-between gap-3"><b className="text-xs text-zinc-500">Слайд {String(index + 1).padStart(2, '0')}</b><div className="flex items-center gap-3"><Toggle checked={slide.enabled} label={slide.enabled ? 'Показывается' : 'Скрыт'} onChange={enabled => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, enabled } : item) }))} /><button type="button" disabled={settings.heroItems.length < 2} onClick={() => change(current => ({ ...current, heroItems: current.heroItems.filter(item => item.id !== slide.id) }))} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={15} /></button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Надпись над заголовком" value={slide.eyebrow} onChange={eyebrow => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, eyebrow } : item) }))} /><Field label="Заголовок" value={slide.title} onChange={title => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, title } : item) }))} /><Field label="Текст кнопки" value={slide.buttonLabel} onChange={buttonLabel => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, buttonLabel } : item) }))} /><Field label="Ссылка кнопки" value={slide.buttonUrl} onChange={buttonUrl => change(current => ({ ...current, heroItems: current.heroItems.map(item => item.id === slide.id ? { ...item, buttonUrl } : item) }))} /></div></div></div>)}</div>
          </Card>
          <Card title="Блок «Нам доверяют»" description="Текст и фотографии сообщества или медийных лиц."><div className="grid gap-4 lg:grid-cols-2"><Field label="Метка" value={settings.lookbook.eyebrow} onChange={eyebrow => change(current => ({ ...current, lookbook: { ...current.lookbook, eyebrow } }))} /><Field label="Заголовок" value={settings.lookbook.title} onChange={title => change(current => ({ ...current, lookbook: { ...current.lookbook, title } }))} /><div className="lg:col-span-2"><Textarea label="Описание" rows={3} value={settings.lookbook.description} onChange={description => change(current => ({ ...current, lookbook: { ...current.lookbook, description } }))} /></div></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{settings.lookbook.images.map((imageUrl, index) => <ImageField key={`${imageUrl}-${index}`} value={imageUrl} slot={`lookbook-${index}`} uploading={uploading} ratio="aspect-[3/4]" onUpload={file => upload(file, `lookbook_${index}`, url => change(current => ({ ...current, lookbook: { ...current.lookbook, images: current.lookbook.images.map((item, i) => i === index ? url : item) } })))} onClear={() => change(current => ({ ...current, lookbook: { ...current.lookbook, images: current.lookbook.images.filter((_, i) => i !== index) } }))} />)}<label className="grid min-h-48 cursor-pointer place-items-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-center text-[11px] font-semibold text-zinc-500 transition hover:border-zinc-500"><span><Plus className="mx-auto mb-2" size={18} />Добавить фото</span><input className="sr-only" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) upload(file, `lookbook_${id()}`, url => change(current => ({ ...current, lookbook: { ...current.lookbook, images: [...current.lookbook.images, url] } }))); event.target.value = ''; }} /></label></div></Card>
          <Card title="Популярные товары" description="Сами товары и цены берутся из «Склада»."><div className="grid gap-4 sm:grid-cols-3"><Field label="Метка" value={settings.popular.eyebrow} onChange={eyebrow => change(current => ({ ...current, popular: { ...current.popular, eyebrow } }))} /><Field label="Заголовок" value={settings.popular.title} onChange={title => change(current => ({ ...current, popular: { ...current.popular, title } }))} /><Field label="Текст ссылки" value={settings.popular.linkLabel} onChange={linkLabel => change(current => ({ ...current, popular: { ...current.popular, linkLabel } }))} /></div></Card>
          <Card title="Блок «О бренде»" description="Имиджевый переход между каталогом и историей бренда."><div className="grid gap-5 xl:grid-cols-[280px_1fr]"><ImageField value={settings.about.imageUrl} slot="about" uploading={uploading} ratio="aspect-[4/5]" onUpload={file => upload(file, 'about', imageUrl => change(current => ({ ...current, about: { ...current.about, imageUrl } })))} onClear={() => change(current => ({ ...current, about: { ...current.about, imageUrl: '' } }))} /><div className="grid content-start gap-3 sm:grid-cols-2"><Field label="Метка" value={settings.about.eyebrow} onChange={eyebrow => change(current => ({ ...current, about: { ...current.about, eyebrow } }))} /><Field label="Заголовок" value={settings.about.title} onChange={title => change(current => ({ ...current, about: { ...current.about, title } }))} /><div className="sm:col-span-2"><Textarea label="Текст" rows={4} value={settings.about.body} onChange={body => change(current => ({ ...current, about: { ...current.about, body } }))} /></div><Field label="Текст ссылки" value={settings.about.buttonLabel} onChange={buttonLabel => change(current => ({ ...current, about: { ...current.about, buttonLabel } }))} /><Field label="Ссылка" value={settings.about.buttonUrl} onChange={buttonUrl => change(current => ({ ...current, about: { ...current.about, buttonUrl } }))} /></div></div></Card>
          <Card title="Промо-блок коллекции" description="Большой призыв к действию перед статьями."><div className="grid gap-4 sm:grid-cols-2"><Field label="Метка" value={settings.campaign.eyebrow} onChange={eyebrow => change(current => ({ ...current, campaign: { ...current.campaign, eyebrow } }))} /><Field label="Заголовок" value={settings.campaign.title} onChange={title => change(current => ({ ...current, campaign: { ...current.campaign, title } }))} /><Field label="Текст кнопки" value={settings.campaign.buttonLabel} onChange={buttonLabel => change(current => ({ ...current, campaign: { ...current.campaign, buttonLabel } }))} /><Field label="Ссылка кнопки" value={settings.campaign.buttonUrl} onChange={buttonUrl => change(current => ({ ...current, campaign: { ...current.campaign, buttonUrl } }))} /></div></Card>
        </>}

        {active === 'articles' && <>
          <Card title="Раздел статей" description="Управление заголовком блока на главной и материалами." action={<button type="button" onClick={() => change(current => ({ ...current, articles: [...current.articles, { id: id(), slug: `article-${current.articles.length + 1}`, title: 'Новая статья', excerpt: '', category: 'История', readTime: '5 минут', imageUrl: '', body: '', published: false }] }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-950 px-3 text-[10px] font-semibold text-white"><Plus size={13} /> Новая статья</button>}><Field label="Заголовок раздела" value={settings.articlesTitle} onChange={articlesTitle => change(current => ({ ...current, articlesTitle }))} /></Card>
          {settings.articles.map((article, index) => <Card key={article.id} title={`${String(index + 1).padStart(2, '0')} · ${article.title || 'Без названия'}`} action={<div className="flex items-center gap-3"><Toggle checked={article.published} label={article.published ? 'Опубликована' : 'Черновик'} onChange={published => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, published } : item) }))} /><button type="button" onClick={() => change(current => ({ ...current, articles: current.articles.filter(item => item.id !== article.id) }))} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button></div>}><div className="grid gap-5 xl:grid-cols-[260px_1fr]"><ImageField value={article.imageUrl} slot={`article-${article.id}`} uploading={uploading} ratio="aspect-[4/3]" onUpload={file => upload(file, `article_${article.id}`, imageUrl => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, imageUrl } : item) })))} onClear={() => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, imageUrl: '' } : item) }))} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Заголовок" value={article.title} onChange={title => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, title } : item) }))} /><Field label="Адрес статьи" hint="латиницей" value={article.slug} onChange={slug => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') } : item) }))} /><Field label="Категория" value={article.category} onChange={category => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, category } : item) }))} /><Field label="Время чтения" value={article.readTime} onChange={readTime => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, readTime } : item) }))} /><div className="sm:col-span-2"><Textarea label="Краткое описание" rows={3} value={article.excerpt} onChange={excerpt => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, excerpt } : item) }))} /></div><div className="sm:col-span-2"><Textarea label="Полный текст статьи" hint="Абзацы разделяйте пустой строкой" rows={10} value={article.body} onChange={body => change(current => ({ ...current, articles: current.articles.map(item => item.id === article.id ? { ...item, body } : item) }))} /></div></div></div></Card>)}
        </>}

        {active === 'pages' && <>{([
          ['about', 'О бренде'], ['delivery', 'Доставка и оплата'], ['returns', 'Обмен и возврат'], ['privacy', 'Политика конфиденциальности'], ['offer', 'Публичная оферта'],
        ] as [keyof StorefrontSettings['pages'], string][]).map(([key, label]) => <Card key={key} title={label} description="Изменения сохраняются в общий документ сайта."><div className="grid gap-3"><Field label="Заголовок страницы" value={settings.pages[key].title} onChange={title => change(current => ({ ...current, pages: { ...current.pages, [key]: { ...current.pages[key], title } } }))} /><Textarea label="Короткое вступление" rows={3} value={settings.pages[key].intro} onChange={intro => change(current => ({ ...current, pages: { ...current.pages, [key]: { ...current.pages[key], intro } } }))} /><Textarea label="Основной текст" hint="Можно вставить полный юридический текст" rows={10} value={settings.pages[key].body} onChange={body => change(current => ({ ...current, pages: { ...current.pages, [key]: { ...current.pages[key], body } } }))} /></div></Card>)}</>}

        {active === 'navigation' && <>
          <Card title="Логотип и адрес сайта" description="Логотип показывается по центру над главным меню."><div className="grid gap-5 lg:grid-cols-[320px_1fr]"><div><div className="mb-2 grid min-h-36 place-items-center overflow-hidden rounded-xl bg-zinc-950 p-5 text-white">{settings.logoUrl ? <img className="max-h-24 max-w-full object-contain" src={settings.logoUrl} alt="Логотип" /> : <b className="text-3xl tracking-[-.06em]">YAASBAE</b>}</div><div className="flex gap-2"><ImageUploader label="Загрузить логотип" busy={uploading === 'logo'} onChange={file => upload(file, 'logo', logoUrl => change(current => ({ ...current, logoUrl })))} />{settings.logoUrl && <button type="button" onClick={() => change(current => ({ ...current, logoUrl: '' }))} className="h-10 rounded-xl px-3 text-[11px] text-zinc-500 hover:bg-zinc-50">Вернуть текст</button>}</div></div><div className="space-y-4"><Field label="Адрес магазина" type="url" value={settings.storeUrl} onChange={storeUrl => change(current => ({ ...current, storeUrl }))} /><Toggle checked={settings.announcementEnabled} label="Показывать информационную строку" onChange={announcementEnabled => change(current => ({ ...current, announcementEnabled }))} /><Field label="Текст информационной строки" value={settings.announcementText} onChange={announcementText => change(current => ({ ...current, announcementText }))} /></div></div></Card>
          <Card title="Главное меню" description="Меняются подписи пунктов; ссылки остаются привязанными к соответствующим разделам."><div className="grid gap-4 sm:grid-cols-2"><Field label="О бренде" value={settings.menu.about} onChange={about => change(current => ({ ...current, menu: { ...current.menu, about } }))} /><Field label="Каталог" value={settings.menu.catalog} onChange={catalog => change(current => ({ ...current, menu: { ...current.menu, catalog } }))} /><Field label="Акции" value={settings.menu.offers} onChange={offers => change(current => ({ ...current, menu: { ...current.menu, offers } }))} /><Field label="Контакты" value={settings.menu.contacts} onChange={contacts => change(current => ({ ...current, menu: { ...current.menu, contacts } }))} /></div></Card>
          <Card title="Контакты и социальные сети" description="Информация показывается в подвале и на служебных страницах."><div className="grid gap-4 sm:grid-cols-2"><Field label="Юридическое название" value={settings.footer.legalName} onChange={legalName => change(current => ({ ...current, footer: { ...current.footer, legalName } }))} /><Field label="Адрес" value={settings.footer.address} onChange={address => change(current => ({ ...current, footer: { ...current.footer, address } }))} /><Field label="Электронная почта" type="email" value={settings.footer.email} onChange={email => change(current => ({ ...current, footer: { ...current.footer, email } }))} /><Field label="Телефон" value={settings.footer.phone} onChange={phone => change(current => ({ ...current, footer: { ...current.footer, phone } }))} /><Field label="Telegram" value={settings.footer.telegram} onChange={telegram => change(current => ({ ...current, footer: { ...current.footer, telegram } }))} /><Field label="VK" value={settings.footer.vk} onChange={vk => change(current => ({ ...current, footer: { ...current.footer, vk } }))} /><Field label="Instagram" value={settings.footer.instagram} onChange={instagram => change(current => ({ ...current, footer: { ...current.footer, instagram } }))} /></div></Card>
        </>}

        {active === 'seo' && <>
          <Card title="Поисковые системы" description="Заголовок и описание, которые увидят покупатели в Яндексе и Google."><div className="grid gap-4"><Field label="SEO-заголовок" hint={`${settings.seo.title.length}/60`} value={settings.seo.title} onChange={title => change(current => ({ ...current, seo: { ...current.seo, title } }))} /><Textarea label="SEO-описание" hint={`${settings.seo.description.length}/160`} rows={3} value={settings.seo.description} onChange={description => change(current => ({ ...current, seo: { ...current.seo, description } }))} /><Field label="Ключевые слова" hint="через запятую" value={settings.seo.keywords} onChange={keywords => change(current => ({ ...current, seo: { ...current.seo, keywords } }))} /></div><div className="mt-5 rounded-xl border border-zinc-200 p-4"><small className="text-xs text-emerald-700">yaasbae.store</small><h3 className="mt-1 text-lg font-medium text-blue-800">{settings.seo.title || 'Заголовок сайта'}</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">{settings.seo.description || 'Описание сайта для поисковой выдачи.'}</p></div></Card>
          <Card title="Изображение для ссылок" description="Показывается при отправке сайта в Telegram, VK и других сервисах."><div className="max-w-xl"><ImageField value={settings.seo.ogImage} slot="seo-og" uploading={uploading} ratio="aspect-[1.91/1]" onUpload={file => upload(file, 'seo_og', ogImage => change(current => ({ ...current, seo: { ...current.seo, ogImage } })))} onClear={() => change(current => ({ ...current, seo: { ...current.seo, ogImage: '' } }))} /></div></Card>
          <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-900"><Settings2 className="mt-0.5 shrink-0" size={17} /><p className="text-xs leading-5">После изменения SEO поисковым системам может потребоваться несколько дней, чтобы обновить информацию в выдаче.</p></div>
        </>}
      </div>
    </div>

    {dirty && <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white shadow-2xl"><span className="hidden text-xs text-zinc-300 sm:block">Есть несохранённые изменения</span><button type="button" onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-[11px] font-semibold text-zinc-950">{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}Сохранить</button></div>}
    {notice && <p className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-zinc-200 bg-white px-5 py-3 text-xs font-medium text-zinc-700 shadow-xl" role="status">{notice}</p>}
  </section>;
};
