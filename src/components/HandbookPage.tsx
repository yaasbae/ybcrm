import React, { useState, useEffect } from 'react';
import {
  BookOpen, ShoppingBag, X, Palette, Layout,
  TrendingUp, FileText, Truck, UserCircle, Star, Award
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

export const HandbookPage: React.FC = () => {
  const [handbookProducts, setHandbookProducts] = useState<string[]>([]);
  const [handbookColors, setHandbookColors] = useState<string[]>([]);
  const [handbookSizes, setHandbookSizes] = useState<string[]>([]);
  const [handbookHeights, setHandbookHeights] = useState<string[]>([]);
  const [handbookCompositions, setHandbookCompositions] = useState<string[]>([]);
  const [handbookSources, setHandbookSources] = useState<string[]>([]);
  const [handbookLabels, setHandbookLabels] = useState<string[]>([]);
  const [handbookDeliveries, setHandbookDeliveries] = useState<string[]>([]);
  const [handbookManagers, setHandbookManagers] = useState<string[]>([]);
  const [handbookBloggers, setHandbookBloggers] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'handbook'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.productNames) setHandbookProducts(d.productNames);
        if (d.colors) setHandbookColors(d.colors);
        if (d.sizes) setHandbookSizes(d.sizes);
        if (d.heights) setHandbookHeights(d.heights);
        if (d.compositions) setHandbookCompositions(d.compositions);
        if (d.sources) setHandbookSources(d.sources);
        if (d.labels) setHandbookLabels(d.labels);
        if (d.deliveries) setHandbookDeliveries(d.deliveries);
        if (d.managers) setHandbookManagers(d.managers);
        if (d.bloggers) setHandbookBloggers(d.bloggers);
      }
    });
    return () => unsub();
  }, []);

  const saveHandbook = async (key: string, list: string[]) => {
    try {
      await setDoc(doc(db, 'settings', 'handbook'), { [key]: list }, { merge: true });
    } catch (err) {
      console.error(err);
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
  }) => (
    <div className="w-48 flex-shrink-0 space-y-3 border-r border-zinc-100 pr-6 last:border-r-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-3 h-3", iconColor)} />
        <h4 className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{title}</h4>
      </div>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value) {
            const val = e.currentTarget.value;
            if (!items.includes(val)) {
              const nl = [val, ...items];
              setItems(nl);
              saveHandbook(saveKey, nl);
              e.currentTarget.value = '';
            }
          }
        }}
      />
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
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Номенклатура, Цвета, Размеры, Рост, Состав, Источники, Метки, Доставка</p>
          </div>
        </div>

        <div className="p-4 overflow-x-auto bg-zinc-50/30">
          <div className="flex gap-6 min-w-max pb-4">
            <ListSection icon={ShoppingBag} iconColor="text-blue-500" title="Номенклатура" items={handbookProducts} setItems={setHandbookProducts} saveKey="productNames" placeholder="Добавить изделие..." />
            <ListSection icon={Palette} iconColor="text-indigo-500" title="Цвета" items={handbookColors} setItems={setHandbookColors} saveKey="colors" placeholder="Добавить цвет..." />
            <ListSection icon={Layout} iconColor="text-emerald-500" title="Размеры" items={handbookSizes} setItems={setHandbookSizes} saveKey="sizes" placeholder="Добавить..." />
            <ListSection icon={TrendingUp} iconColor="text-amber-500" title="Рост" items={handbookHeights} setItems={setHandbookHeights} saveKey="heights" placeholder="Рост..." />
            <ListSection icon={FileText} iconColor="text-sky-500" title="Состав" items={handbookCompositions} setItems={setHandbookCompositions} saveKey="compositions" placeholder="Состав..." />
            <ListSection icon={Layout} iconColor="text-purple-500" title="Источники" items={handbookSources} setItems={setHandbookSources} saveKey="sources" placeholder="Источник..." />
            <ListSection icon={Award} iconColor="text-rose-500" title="Метки" items={handbookLabels} setItems={setHandbookLabels} saveKey="labels" placeholder="Метка..." />
            <ListSection icon={Truck} iconColor="text-emerald-500" title="Доставка" items={handbookDeliveries} setItems={setHandbookDeliveries} saveKey="deliveries" placeholder="Доставка..." />
            <ListSection icon={UserCircle} iconColor="text-emerald-500" title="Менеджеры" items={handbookManagers} setItems={setHandbookManagers} saveKey="managers" placeholder="Менеджер..." />
            <ListSection icon={Star} iconColor="text-purple-500" title="Блогеры" items={handbookBloggers} setItems={setHandbookBloggers} saveKey="bloggers" placeholder="Блогер..." />
          </div>

          <div className="pt-4 border-t border-zinc-100 flex justify-end">
            <button
              onClick={() => {
                if (window.confirm('Инициализировать справочники стандартными значениями?')) {
                  const dc = ["Лаванда свет.", "Бежевый", "Бежевый меланж", "Белый", "Брауни", "Вери Пери", "Голубой", "Голубой с молочным", "Графит", "Графит меланж", "Джинсовый", "Зеленый", "Какао", "Капучино с молочным", "Карамель", "Карибу", "Красный", "Лаванда", "Лиловый", "Меланж", "Молочный", "Пудра", "Розовый", "Розовый меланж", "Светло-розовый", "Серый", "Серый меланж", "Синий", "Темный хаки", "Фисташковый", "Хаки", "Цветной", "Черный", "Черный с белым", "Капучино", "Желтый", "Оливковый с молочным", "Барби"];
                  const ds = ["XS", "S", "M", "L", "XL", "XXL", "OVER", "OVER 100", "OVER 200", "OVER XS/S", "OVER M/L"];
                  const dh = ["150-155", "160-165", "170-175", "180-185"];
                  const dcomp = ["Хлопок 100%", "Хлопок 95%, Лайкра 5%", "Лен", "Шерсть", "Футер"];
                  const dsrc = ["Instagram", "WhatsApp", "Telegram", "Повторный заказ", "Блогер"];
                  const dlbl = ["Приоритет", "VIP", "Скидка", "Оптовик"];
                  const ddel = ["СДЭК", "Почта РФ", "Курьер", "Самовывоз"];

                  setHandbookColors(dc); setHandbookSizes(ds); setHandbookHeights(dh);
                  setHandbookCompositions(dcomp); setHandbookSources(dsrc); setHandbookLabels(dlbl); setHandbookDeliveries(ddel);

                  saveHandbook('colors', dc); saveHandbook('sizes', ds); saveHandbook('heights', dh);
                  saveHandbook('compositions', dcomp); saveHandbook('sources', dsrc); saveHandbook('labels', dlbl); saveHandbook('deliveries', ddel);
                }
              }}
              className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-600 transition-colors bg-blue-50 px-3 py-2 rounded-lg"
            >
              Загрузить стандарты
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
