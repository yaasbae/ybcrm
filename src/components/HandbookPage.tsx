import React, { useState, useEffect } from 'react';
import {
  BookOpen, ShoppingBag, X, Palette, Layout,
  TrendingUp, FileText, Truck, UserCircle, Star, Award, CreditCard, CheckCircle2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { YAASBAE_BLOGGERS } from '../data/bloggersYaasbae';

const DEFAULT_PAYMENT_TYPES = ["QR код", "Сплитами", "Долями", "Наличкой", "Наложенный СДЭК"];
const DEFAULT_STATUSES = ["Новый", "В работе", "Оплачен", "Упакован", "Отгружен", "Доставлен", "Возврат", "Отмена", "Обмен"];
const IMPORTED_BLOGGER_NAMES = Array.from(new Set(
  YAASBAE_BLOGGERS.map((blogger) => blogger.name.trim()).filter(Boolean)
));

export const HandbookPage: React.FC = () => {
  const [handbookProducts, setHandbookProducts] = useState<string[]>([]);
  const [handbookColors, setHandbookColors] = useState<string[]>([]);
  const [handbookSizes, setHandbookSizes] = useState<string[]>([]);
  const [handbookHeights, setHandbookHeights] = useState<string[]>([]);
  const [handbookCompositions, setHandbookCompositions] = useState<string[]>([]);
  const [handbookStatuses, setHandbookStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [handbookSources, setHandbookSources] = useState<string[]>([]);
  const [handbookLabels, setHandbookLabels] = useState<string[]>([]);
  const [handbookDeliveries, setHandbookDeliveries] = useState<string[]>([]);
  const [handbookPaymentTypes, setHandbookPaymentTypes] = useState<string[]>(DEFAULT_PAYMENT_TYPES);
  const [handbookManagers, setHandbookManagers] = useState<string[]>([]);
  const [handbookBloggers, setHandbookBloggers] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'handbook'), (snap) => {
      setSaveError('');
      if (snap.exists()) {
        const d = snap.data();
        if (d.productNames) setHandbookProducts(d.productNames);
        if (d.colors) setHandbookColors(d.colors);
        if (d.sizes) setHandbookSizes(d.sizes);
        if (d.heights) setHandbookHeights(d.heights);
        if (d.compositions) setHandbookCompositions(d.compositions);
        if (d.statuses) setHandbookStatuses(d.statuses);
        if (d.sources) setHandbookSources(d.sources);
        if (d.labels) setHandbookLabels(d.labels);
        if (d.deliveries) setHandbookDeliveries(d.deliveries);
        if (d.paymentTypes) setHandbookPaymentTypes(d.paymentTypes);
        if (d.managers) setHandbookManagers(d.managers);
        const currentBloggers = Array.isArray(d.bloggers) ? d.bloggers : [];
        const mergedBloggers = Array.from(new Set([...currentBloggers, ...IMPORTED_BLOGGER_NAMES]));
        setHandbookBloggers(mergedBloggers);
        if (mergedBloggers.length !== currentBloggers.length) {
          setDoc(doc(db, 'settings', 'handbook'), { bloggers: mergedBloggers }, { merge: true }).catch((err) => {
            console.error(err);
            setSaveError('Не удалось добавить блогеров из маркетинга в справочник.');
          });
        }
      }
    }, (error) => {
      console.error(error);
      setSaveError('Не удалось загрузить справочник. Проверьте вход в CRM.');
    });
    return () => unsub();
  }, []);

  const saveHandbook = async (key: string, list: string[]) => {
    try {
      await setDoc(doc(db, 'settings', 'handbook'), { [key]: list }, { merge: true });
      setSaveError('');
    } catch (err) {
      console.error(err);
      setSaveError('Справочник не сохранился. Проверьте, что вы вошли в CRM.');
    }
  };

  const ListSection = ({
    icon: Icon,
    iconColor,
    title,
    items,
    setItems,
    saveKey,
    placeholder,
  }: {
    icon: React.ElementType;
    iconColor: string;
    title: string;
    items: string[];
    setItems: (v: string[]) => void;
    saveKey: string;
    placeholder: string;
  }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const addValue = (input: HTMLInputElement | null) => {
      const val = input?.value.trim();
      if (!val) return;
      if (!items.includes(val)) {
        const nl = [val, ...items];
        setItems(nl);
        saveHandbook(saveKey, nl);
      }
      if (input) input.value = '';
    };

    return (
      <div className="w-48 flex-shrink-0 space-y-3 border-r border-zinc-100 pr-6 last:border-r-0">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("w-3 h-3", iconColor)} />
          <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{title}</h4>
        </div>
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addValue(e.currentTarget);
              }
            }}
          />
          <button
            type="button"
            onClick={() => addValue(inputRef.current)}
            className="w-10 rounded-xl bg-zinc-900 text-white text-lg leading-none shadow-sm hover:bg-zinc-700 transition-colors"
            title={`Добавить: ${title}`}
          >
            +
          </button>
        </div>
        {saveKey === 'bloggers' && (
          <div className="rounded-xl border border-purple-100 bg-purple-50 px-3 py-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-purple-600">
              Из маркетинга: {IMPORTED_BLOGGER_NAMES.length}
            </p>
            <p className="mt-1 text-[8px] font-semibold text-purple-400">
              Нового блогера добавляй через +
            </p>
          </div>
        )}
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div key={idx} className="group flex items-center justify-between p-2 hover:bg-white rounded-lg border border-transparent hover:border-zinc-200 transition-all">
              <input
                value={item}
                onChange={(e) => {
                  const nl = [...items];
                  nl[idx] = e.target.value;
                  setItems(nl);
                }}
                onBlur={() => saveHandbook(saveKey, items)}
                className="flex-1 bg-transparent text-[10px] font-bold text-zinc-700 outline-none w-full"
              />
              <button
                onClick={() => {
                  if (window.confirm('Удалить?')) {
                    const nl = items.filter((_, i) => i !== idx);
                    setItems(nl);
                    saveHandbook(saveKey, nl);
                  }
                }}
                className="p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 font-sans text-zinc-900">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="tg-card bg-white border border-zinc-100 shadow-sm overflow-hidden"
      >
        <div className="p-4 border-b border-zinc-100 flex items-center gap-3">
          <div className="p-2 bg-zinc-900 rounded-xl shadow-lg shadow-zinc-900/20">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1">Глобальные справочники</h3>
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Номенклатура, Цвета, Размеры, Рост, Состав, Источники, Метки, Доставка, Оплата</p>
          </div>
        </div>
        {saveError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-[11px] font-bold text-red-600">
            {saveError}
          </div>
        )}

        <div className="p-4 overflow-x-auto bg-zinc-50/30">
          <div className="flex gap-6 min-w-max pb-4">
            <ListSection icon={ShoppingBag} iconColor="text-blue-500" title="Номенклатура" items={handbookProducts} setItems={setHandbookProducts} saveKey="productNames" placeholder="Добавить изделие..." />
            <ListSection icon={Palette} iconColor="text-indigo-500" title="Цвета" items={handbookColors} setItems={setHandbookColors} saveKey="colors" placeholder="Добавить цвет..." />
            <ListSection icon={Layout} iconColor="text-emerald-500" title="Размеры" items={handbookSizes} setItems={setHandbookSizes} saveKey="sizes" placeholder="Добавить..." />
            <ListSection icon={TrendingUp} iconColor="text-amber-500" title="Рост" items={handbookHeights} setItems={setHandbookHeights} saveKey="heights" placeholder="Рост..." />
            <ListSection icon={FileText} iconColor="text-sky-500" title="Состав" items={handbookCompositions} setItems={setHandbookCompositions} saveKey="compositions" placeholder="Состав..." />
            <ListSection icon={CheckCircle2} iconColor="text-zinc-500" title="Статусы" items={handbookStatuses} setItems={setHandbookStatuses} saveKey="statuses" placeholder="Статус..." />
            <ListSection icon={Layout} iconColor="text-purple-500" title="Источники" items={handbookSources} setItems={setHandbookSources} saveKey="sources" placeholder="Источник..." />
            <ListSection icon={Award} iconColor="text-rose-500" title="Метки" items={handbookLabels} setItems={setHandbookLabels} saveKey="labels" placeholder="Метка..." />
            <ListSection icon={Truck} iconColor="text-emerald-500" title="Доставка" items={handbookDeliveries} setItems={setHandbookDeliveries} saveKey="deliveries" placeholder="Доставка..." />
            <ListSection icon={CreditCard} iconColor="text-zinc-500" title="Вид оплаты" items={handbookPaymentTypes} setItems={setHandbookPaymentTypes} saveKey="paymentTypes" placeholder="Вид оплаты..." />
            <ListSection icon={UserCircle} iconColor="text-emerald-500" title="Менеджеры" items={handbookManagers} setItems={setHandbookManagers} saveKey="managers" placeholder="Менеджер..." />
            <ListSection icon={Star} iconColor="text-purple-500" title="Блогеры" items={handbookBloggers} setItems={setHandbookBloggers} saveKey="bloggers" placeholder="Блогер..." />
          </div>

        </div>
      </motion.div>
    </div>
  );
};
