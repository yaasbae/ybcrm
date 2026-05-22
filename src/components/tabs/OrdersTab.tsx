import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import {
  TrendingUp, Users, ShoppingBag,
  Calendar, Award, AlertCircle, Search, Plus,
  X, MapPin, Star, RefreshCcw,
  Tag, Trash2, Phone, UserCircle, ChevronRight, QrCode as QrCodeIcon,
  CheckCircle2, Copy, Send, Truck
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { OrderData } from '../AnalyticsDashboard';
import { db } from '../../firebase';
import { collection, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';

const STATUS_OPTIONS = ['Новый', 'В работе', 'Оплачен', 'Отгружен', 'Доставлен', 'Возврат', 'Отмена', 'Обмен'];
const DELIVERY_OPTIONS = ['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS'];
const SOURCE_OPTIONS = ['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный'];
const PAYMENT_TYPE_OPTIONS = ['QR код', 'Сплитами', 'Долями', 'Наличкой', 'Наложенный СДЭК'];
const RAW_COLOR_INDEX = 1;
const RAW_SIZE_INDEX = 8;
const RAW_REVENUE_INDEX = 14;
const RAW_DELIVERY_INDEX = 15;
const RAW_PAID_INDEX = 16;

interface ProductCatalogItem {
  id: string;
  name: string;
  color?: string;
  sizeGrid?: string;
  height?: string;
  weight?: string;
  sellingPrice?: number;
}

type CdekCityOption = {
  code: number;
  city: string;
  region?: string;
};

type CdekDeliveryPoint = {
  code: string;
  name?: string;
  address?: string;
  location?: { address?: string };
};

const CDEK_TARIFFS = [
  { code: '136', label: 'Склад → ПВЗ' },
  { code: '137', label: 'Склад → дверь' },
  { code: '138', label: 'Дверь → ПВЗ' },
  { code: '139', label: 'Дверь → дверь' },
];

const normalizeProductName = (value: string) => value.trim().toLowerCase();

const getProductForOrder = (products: ProductCatalogItem[], itemName: string) =>
  products.find(p => normalizeProductName(p.name) === normalizeProductName(itemName || ''));

const parsePackageNumber = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).replace(',', '.').match(/\d+(\.\d+)?/)?.[0];
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed <= 20 ? Math.round(parsed * 1000) : Math.round(parsed);
};

const getApiErrorMessage = (data: any, fallback: string): string => {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.details?.error_description) {
    const description = String(data.details.error_description);
    if (description === 'No such account secure') {
      return 'СДЭК не принял Account / Secure password. Проверьте ключи в настройках СДЭК';
    }
    return description;
  }
  if (data.details?.error) return String(data.details.error);
  if (data.details?.message) return String(data.details.message);
  if (data.message) return String(data.message);
  if (data.error) return String(data.error);
  const requestErrors = data.details?.requests?.flatMap((request: any) => request.errors || []);
  if (requestErrors?.length) {
    return requestErrors
      .map((item: any) => item.message || item.code || JSON.stringify(item))
      .filter(Boolean)
      .join('; ');
  }
  if (Array.isArray(data.details?.errors) && data.details.errors[0]?.message) return String(data.details.errors[0].message);
  return fallback;
};

function getOrderPaymentDue(order: Partial<Pick<OrderData, 'revenue' | 'deliveryPrice' | 'paidAmount' | 'paymentStatus' | 'status'>>): number {
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const orderStatus = String(order.status || '').toLowerCase();
  if (paymentStatus === 'paid' || orderStatus.includes('оплачен')) return 0;

  const fullAmount = Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));
  const prepayment = Math.max(0, Number(order.paidAmount) || 0);

  if (prepayment > 0) return prepayment;
  return fullAmount;
}

function buildPaymentPageUrl(orderId: string): string {
  return `${window.location.origin}/pay/${orderId}`;
}

function buildOrderShareText(order: Partial<OrderData>, paymentUrl: string): string {
  const amount = getOrderPaymentDue({
    revenue: order.revenue || 0,
    deliveryPrice: order.deliveryPrice || 0,
    paidAmount: order.paidAmount || 0,
  });
  const color = order.rawRow?.[RAW_COLOR_INDEX] || '';
  const size = order.rawRow?.[RAW_SIZE_INDEX] || '';
  const lines = [
    `Здравствуйте! Счет на оплату заказа #${order.orderId || ''}`,
    '',
    order.item ? `Модель: ${order.item}` : '',
    color ? `Цвет: ${color}` : '',
    size ? `Размер: ${size}` : '',
    order.height ? `Рост: ${order.height}` : '',
    order.deliveryMethod ? `Доставка: ${order.deliveryMethod}` : '',
    order.clientName ? `ФИО: ${order.clientName}` : '',
    order.clientPhone ? `Телефон: ${order.clientPhone}` : '',
    '',
    `Сумма: ${formatCurrency(amount)}`,
    `Ссылка на оплату СБП: ${paymentUrl}`,
  ];

  return lines.filter((line, index, arr) => line || arr[index - 1]).join('\n').trim();
}

function openMessengerShare(messenger: 'telegram' | 'whatsapp', text: string, url: string): void {
  const href = messenger === 'telegram'
    ? `https://t.me/share/url?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(href, '_blank', 'noopener,noreferrer');
}

async function shareOrder(text: string, url: string): Promise<void> {
  if (navigator.share) {
    await navigator.share({ title: 'Счет на оплату заказа', text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function createPngFileFromSvg(svg: SVGSVGElement, orderId: string): Promise<File> {
  const svgText = new XMLSerializer().serializeToString(svg);
  const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
    });

    const sourceWidth = image.naturalWidth || svg.viewBox.baseVal.width || 300;
    const sourceHeight = image.naturalHeight || svg.viewBox.baseVal.height || 300;
    const scale = Math.max(1, Math.ceil(900 / Math.max(sourceWidth, sourceHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth * scale;
    canvas.height = sourceHeight * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить QR');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось создать PNG')), 'image/png');
    });

    return new File([blob], `qr-order-${orderId}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function shareQrImage(svg: SVGSVGElement | null, orderId: string, text: string): Promise<void> {
  if (!svg) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const file = await createPngFileFromSvg(svg, orderId);
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData & { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };

  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: `QR-код заказа #${orderId}`, text, files: [file] });
    return;
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  await navigator.clipboard.writeText(text);
}

const PaymentRowBlock: React.FC<{ order: OrderData; updateOrderData: (id: string, field: string, value: any) => void }> = ({ order, updateOrderData }) => {
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(order.paymentUrl || null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState('');
  const qrRef = useRef<HTMLDivElement>(null);

  const pageUrl = buildPaymentPageUrl(order.orderId);
  const targetPaymentUrl = paymentUrl || pageUrl;
  const shareText = buildOrderShareText(order, targetPaymentUrl);

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const amount = getOrderPaymentDue(order);
      if (amount <= 0) throw new Error('Остаток к оплате 0 ₽');
      const res = await fetch('/api/tochka/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          amount,
          description: `Заказ #${order.orderId} ${order.item || ''}`,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось создать счёт');
      if (data.paymentUrl) {
        setPaymentUrl(data.paymentUrl);
        updateOrderData(order.orderId, 'paymentUrl', data.paymentUrl);
      }
    } catch (e: any) {
      setError(e.message || 'Не удалось создать счёт');
    }
    finally { setLoading(false); }
  };

  const handleCopy = (text = pageUrl) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!paymentUrl) {
    return (
      <div className="mt-1.5">
        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full text-[8px] font-black py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {loading ? <RefreshCcw size={8} className="animate-spin" /> : <QrCodeIcon size={8} />}
          {loading ? 'Создаём...' : 'Создать счёт'}
        </button>
        {error && <p className="mt-1 text-[8px] font-bold text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1">
        <button
          onClick={() => handleCopy(shareText)}
          className="flex-1 text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-all flex items-center justify-center gap-1"
        >
          <Copy size={8} />
          {copied ? 'Скопировано!' : 'Скопировать'}
        </button>
        <button
          onClick={() => shareOrder(shareText, targetPaymentUrl).catch(() => navigator.clipboard.writeText(shareText))}
          className="flex-1 text-[8px] font-black py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all flex items-center justify-center gap-1"
        >
          <Send size={8} /> Поделиться
        </button>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => openMessengerShare('telegram', shareText, targetPaymentUrl)}
          className="flex-1 text-[8px] font-black py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-all"
        >
          Telegram
        </button>
        <button
          onClick={() => openMessengerShare('whatsapp', shareText, targetPaymentUrl)}
          className="flex-1 text-[8px] font-black py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all"
        >
          WhatsApp
        </button>
      </div>
      <button
        onClick={() => setShowQr(v => !v)}
        className="w-full text-[8px] font-black py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 transition-all flex items-center justify-center gap-1"
      >
        <QrCodeIcon size={8} /> {showQr ? 'Скрыть QR' : 'QR код'}
      </button>
      {showQr && (
        <div className="space-y-1">
          <div ref={qrRef} className="flex justify-center p-2 bg-white border border-zinc-100 rounded-lg">
            <QRCodeSVG value={targetPaymentUrl} size={100} />
          </div>
          <button
            onClick={() => shareQrImage(qrRef.current?.querySelector('svg') || null, order.orderId, shareText).catch(() => navigator.clipboard.writeText(shareText))}
            className="w-full text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-all"
          >
            Отправить QR
          </button>
        </div>
      )}
    </div>
  );
};

const CdekOrderBlock: React.FC<{
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  productCatalog: ProductCatalogItem[];
  mobile?: boolean;
}> = ({ order, updateOrderData, productCatalog, mobile = false }) => {
  const product = getProductForOrder(productCatalog, order.item);
  const saved = order.cdekPayload || {};
  const initialDeliveryType = String(saved.deliveryType || '').trim()
    || (String(order.deliveryMethod || '').toLowerCase().includes('курьер') ? 'door' : 'pvz');
  const [deliveryType, setDeliveryType] = useState(initialDeliveryType);
  const [cityQuery, setCityQuery] = useState(String(saved.toCity || order.clientCity || ''));
  const [toCityCode, setToCityCode] = useState(String(saved.toCityCode || ''));
  const [deliveryPoint, setDeliveryPoint] = useState(String(saved.deliveryPoint || ''));
  const [toAddress, setToAddress] = useState(String(saved.toAddress || ''));
  const [weight, setWeight] = useState(String(saved.weight || parsePackageNumber(product?.weight, 700)));
  const [length, setLength] = useState(String(saved.length || 30));
  const [width, setWidth] = useState(String(saved.width || 20));
  const [height, setHeight] = useState(String(saved.height || 10));
  const [tariffCode, setTariffCode] = useState(String(saved.tariffCode || (initialDeliveryType === 'door' ? 139 : 138)));
  const [cities, setCities] = useState<CdekCityOption[]>([]);
  const [points, setPoints] = useState<CdekDeliveryPoint[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [settingsChecked, setSettingsChecked] = useState(false);

  useEffect(() => {
    fetch('/api/cdek/status')
      .then(r => r.json())
      .then(data => {
        if (!data.configured) {
          setError('СДЭК API не настроен: нужны Account и Secure password в разделе СДЭК');
        }
      })
      .catch(() => setError('Не удалось проверить настройки СДЭК'))
      .finally(() => setSettingsChecked(true));
  }, []);

  useEffect(() => {
    if (saved.weight || !product?.weight) return;
    setWeight(String(parsePackageNumber(product.weight, 700)));
  }, [product?.weight, saved.weight]);

  useEffect(() => {
    const q = cityQuery.trim();
    if (q.length < 2) {
      setCities([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoadingCities(true);
      setError('');
      try {
        const res = await fetch(`/api/cdek/cities?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(data, 'СДЭК не вернул города'));
        setCities(Array.isArray(data) ? data.slice(0, 6) : []);
        if (Array.isArray(data) && data.length === 0) setError('СДЭК не нашел такой город');
      } catch (e: any) {
        setCities([]);
        setError(e.message || 'Ошибка поиска города СДЭК');
      } finally {
        setLoadingCities(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cityQuery]);

  useEffect(() => {
    if (!toCityCode || deliveryType !== 'pvz') {
      setPoints([]);
      return;
    }
    const loadPoints = async () => {
      setLoadingPoints(true);
      setError('');
      try {
        const res = await fetch(`/api/cdek/deliverypoints?city_code=${encodeURIComponent(toCityCode)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(data, 'СДЭК не вернул ПВЗ'));
        setPoints(Array.isArray(data) ? data.slice(0, 80) : []);
        if (Array.isArray(data) && data.length === 0) setError('В этом городе СДЭК не вернул ПВЗ');
      } catch (e: any) {
        setPoints([]);
        setError(e.message || 'Ошибка загрузки ПВЗ СДЭК');
      } finally {
        setLoadingPoints(false);
      }
    };
    loadPoints();
  }, [toCityCode, deliveryType]);

  useEffect(() => {
    if (toCityCode || cities.length === 0) return;
    const normalizedQuery = cityQuery.split(',')[0].trim().toLowerCase();
    const exactCity = cities.find(city => city.city.trim().toLowerCase() === normalizedQuery);
    if (exactCity) selectCity(exactCity);
  }, [cities, cityQuery, toCityCode]);

  const selectCity = (city: CdekCityOption) => {
    setToCityCode(String(city.code));
    setCityQuery(`${city.city}${city.region ? `, ${city.region}` : ''}`);
    setDeliveryPoint('');
    setCities([]);
  };

  const persistPayload = (patch: Record<string, any>) => {
    updateOrderData(order.orderId, 'cdekPayload', { ...saved, ...patch });
  };

  const createCdekOrder = async () => {
    setSubmitting(true);
    setError('');
    setStatusText('');
    try {
      const payload = {
        orderId: order.orderId,
        recipientName: order.clientName,
        recipientPhone: order.clientPhone,
        itemName: order.item || `Заказ ${order.orderId}`,
        itemCost: Number(order.revenue) || 0,
        codAmount: String(order.paymentType || '').toLowerCase().includes('налож') ? getOrderPaymentDue(order) : 0,
        tariffCode,
        deliveryType,
        toCityCode,
        toCity: cityQuery,
        deliveryPoint,
        toAddress,
        weight,
        length,
        width,
        height,
        comment: `CRM заказ #${order.orderId}`,
      };
      if (!payload.recipientName || !payload.recipientPhone) throw new Error('Нужны ФИО и телефон клиента');
      if (deliveryType === 'pvz' && !toCityCode) throw new Error('Выберите город СДЭК из подсказки');
      if (deliveryType === 'pvz' && !deliveryPoint) throw new Error('Выберите ПВЗ СДЭК');
      if (deliveryType === 'door' && !toAddress) throw new Error('Укажите адрес доставки');

      persistPayload(payload);
      const res = await fetch('/api/cdek/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details?.message || data.error || 'СДЭК не принял заказ');

      if (data.cdekUuid) updateOrderData(order.orderId, 'cdekUuid', data.cdekUuid);
      if (data.cdekNumber) updateOrderData(order.orderId, 'cdekNumber', data.cdekNumber);
      updateOrderData(order.orderId, 'cdekStatus', 'created');
      setStatusText(data.cdekNumber ? `Создан: ${data.cdekNumber}` : 'Создан, номер появится позже');
    } catch (e: any) {
      setError(e.message || 'Не удалось создать СДЭК');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = mobile
    ? 'w-full rounded-lg border border-zinc-100 bg-white px-2 py-2 text-[10px] font-bold text-zinc-700 outline-none focus:border-blue-200'
    : 'w-full rounded-lg border border-zinc-100 bg-white px-3 py-2 text-[10px] font-bold text-zinc-700 outline-none focus:border-blue-200';

  return (
    <div className={cn(
      mobile ? 'rounded-xl border border-zinc-100 bg-zinc-50/60 p-2.5 space-y-2' : 'mt-2 w-[320px] rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 space-y-2'
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Truck className={cn(mobile ? 'w-3.5 h-3.5' : 'w-3 h-3', 'text-zinc-500')} />
          <p className={cn(mobile ? 'text-[8px]' : 'text-[7px]', 'font-black uppercase tracking-widest text-zinc-500')}>СДЭК</p>
        </div>
        {(order.cdekNumber || order.cdekUuid || statusText) && (
          <span className="text-[7px] font-black uppercase text-emerald-600">
            {order.cdekNumber || statusText || 'Создан'}
          </span>
        )}
      </div>

      <div className={cn('grid gap-1.5', mobile ? 'grid-cols-2' : 'grid-cols-[120px_1fr]')}>
        <select
          value={deliveryType}
          onChange={(e) => {
            const next = e.target.value;
            setDeliveryType(next);
            setTariffCode(next === 'door' ? '139' : '138');
          }}
          className={inputClass}
        >
          <option value="pvz">До ПВЗ</option>
          <option value="door">Курьером</option>
        </select>
        <select value={tariffCode} onChange={e => setTariffCode(e.target.value)} className={inputClass} title="Тариф СДЭК">
          {CDEK_TARIFFS.map(tariff => (
            <option key={tariff.code} value={tariff.code}>{tariff.label}</option>
          ))}
        </select>
      </div>

      <div className="relative">
        <input
          value={cityQuery}
          onChange={e => {
            setCityQuery(e.target.value);
            setToCityCode('');
          }}
          placeholder="Город получателя"
          className={inputClass}
        />
        {(loadingCities || cities.length > 0) && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-zinc-100 bg-white shadow-xl overflow-hidden">
            {loadingCities && <div className="px-2 py-1.5 text-[8px] font-bold text-zinc-400">Ищу город...</div>}
            {cities.map(city => (
              <button
                key={city.code}
                type="button"
                onClick={() => selectCity(city)}
              className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-700 hover:bg-zinc-50"
            >
              {city.city}{city.region ? `, ${city.region}` : ''} <span className="text-zinc-300">#{city.code}</span>
            </button>
            ))}
          </div>
        )}
      </div>

      {deliveryType === 'pvz' ? (
        toCityCode ? (
          <select value={deliveryPoint} onChange={e => setDeliveryPoint(e.target.value)} disabled={loadingPoints} className={inputClass}>
            <option value="">{loadingPoints ? 'Загружаю ПВЗ...' : 'ПВЗ СДЭК'}</option>
            {points.map(point => (
              <option key={point.code} value={point.code}>
                {point.name || point.code} · {point.address || point.location?.address || point.code}
              </option>
            ))}
          </select>
        ) : null
      ) : (
        <input value={toAddress} onChange={e => setToAddress(e.target.value)} placeholder="Адрес доставки" className={inputClass} />
      )}

      <div className={cn('grid gap-1.5', mobile ? 'grid-cols-2' : 'grid-cols-4')}>
        {[
          { label: 'Вес, г', value: weight, setValue: setWeight, placeholder: '700' },
          { label: 'Длина, см', value: length, setValue: setLength, placeholder: '30' },
          { label: 'Ширина, см', value: width, setValue: setWidth, placeholder: '20' },
          { label: 'Высота, см', value: height, setValue: setHeight, placeholder: '10' },
        ].map(field => (
          <label key={field.label} className="space-y-1">
            <span className="block px-1 text-[7px] font-black uppercase tracking-widest text-zinc-400">{field.label}</span>
            <input
              value={field.value}
              onChange={e => field.setValue(e.target.value)}
              placeholder={field.placeholder}
              className={cn(inputClass, mobile ? 'min-h-[38px]' : 'min-h-[42px]')}
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={createCdekOrder}
        disabled={submitting || !settingsChecked}
        className={cn(
          'w-full rounded-lg border border-zinc-200 bg-white font-black uppercase tracking-widest text-zinc-700 hover:bg-zinc-900 hover:text-white transition-all flex items-center justify-center gap-1.5 disabled:opacity-60',
          mobile ? 'py-2.5 text-[8px]' : 'py-1.5 text-[7px]'
        )}
      >
        {submitting ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        {submitting ? 'Создаю...' : 'Создать накладную'}
      </button>
      {error && <p className="text-[8px] font-bold text-red-500">{error}</p>}
      {statusText && <p className="text-[8px] font-bold text-emerald-600">{statusText}</p>}
    </div>
  );
};

const OrderRow = React.memo(({
  order,
  updateOrderData,
  onDelete,
  handbookSources,
  handbookDeliveries,
  handbookSizes,
  handbookColors,
  handbookHeights,
  handbookLabels,
  handbookManagers,
  handbookBloggers,
  productCatalog,
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
  handbookSources: string[];
  handbookDeliveries: string[];
  handbookSizes: string[];
  handbookColors: string[];
  handbookHeights: string[];
  handbookLabels: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
  productCatalog: ProductCatalogItem[];
}) => {
  const nameParts = (order.clientName || '').split(/\s+/);
  const surname = nameParts[0] || '';
  const otherNames = nameParts.slice(1).join(' ');

  const statusColor =
    order.status?.toLowerCase().includes('оплачен') ? 'text-emerald-700 bg-emerald-50 border-emerald-100' :
    order.status?.toLowerCase().includes('отгружен') || order.status?.toLowerCase().includes('доставлен') ? 'text-blue-700 bg-blue-50 border-blue-100' :
    order.status?.toLowerCase().includes('возврат') || order.status?.toLowerCase().includes('отмена') ? 'text-red-600 bg-red-50 border-red-100' :
    'text-zinc-500 bg-zinc-50 border-zinc-100';

  const fieldInput = (label: string, value: string, list: string, onChange: (v: string) => void) => (
    <div key={label} className="flex flex-col gap-0.5 min-w-[72px]">
      <span className="text-[8px] font-black text-zinc-300 uppercase tracking-wider leading-none px-1">{label}</span>
      <input
        type="text"
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="bg-zinc-50 border border-zinc-100 rounded-md px-2 py-1 text-[10px] text-zinc-700 font-medium focus:bg-white focus:border-blue-200 focus:ring-1 focus:ring-blue-100 outline-none w-full"
      />
    </div>
  );

  const applyProductCharacteristics = (value: string) => {
    updateOrderData(order.orderId, 'item', value);

    const product = productCatalog.find(p => normalizeProductName(p.name) === normalizeProductName(value));
    if (!product) return;

    if (product.color) updateOrderData(order.orderId, `rawRow[${RAW_COLOR_INDEX}]`, product.color);
    if (product.sizeGrid) updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, product.sizeGrid);
    if (product.height) updateOrderData(order.orderId, 'height', product.height);
  };

  return (
    <tr className={cn(
      "group border-b border-zinc-100 transition-colors",
      order.isOverdue && !order.isShipped ? "bg-red-50/40" : "hover:bg-zinc-50/60"
    )}>

      {/* Дата / ID */}
      <td className="px-3 py-3 align-top w-[90px]">
        <input
          type="text"
          value={order.date.toLocaleDateString('ru-RU')}
          onChange={(e) => {
            const parts = e.target.value.split('.');
            if (parts.length === 3) {
              const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
              if (!isNaN(d.getTime())) updateOrderData(order.orderId, 'date', d);
            }
          }}
          className="bg-transparent text-[9px] text-zinc-400 font-semibold focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mb-1"
        />
        <div className="flex items-center gap-1.5">
          {order.isFirebase && (
            <div title="Заказ из CRM" className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          )}
          <input
            type="text"
            value={order.orderId}
            onChange={(e) => updateOrderData(order.orderId, 'orderId', e.target.value)}
            className="bg-transparent text-[11px] font-black text-zinc-900 tracking-tight focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full"
          />
        </div>
      </td>

      {/* Клиент */}
      <td className="px-2 py-3 align-top w-[150px]">
        <input
          type="text"
          value={surname}
          onChange={(e) => {
            const n = [e.target.value, otherNames].filter(Boolean).join(' ');
            updateOrderData(order.orderId, 'clientName', n);
          }}
          placeholder="ФАМИЛИЯ"
          className="bg-transparent text-[11px] font-black text-zinc-900 uppercase tracking-tight focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full leading-tight"
        />
        <input
          type="text"
          value={otherNames}
          onChange={(e) => {
            const n = [surname, e.target.value].filter(Boolean).join(' ');
            updateOrderData(order.orderId, 'clientName', n);
          }}
          placeholder="Имя Отчество"
          className="bg-transparent text-[9px] font-medium text-zinc-500 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mt-0.5"
        />
        <input
          type="text"
          value={order.clientPhone}
          onChange={(e) => updateOrderData(order.orderId, 'clientPhone', e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="телефон"
          className="bg-transparent font-mono text-[9px] text-zinc-400 focus:text-zinc-900 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none w-full mt-1"
        />
      </td>

      {/* Статус / Доставка */}
      <td className="px-2 py-3 align-top w-[340px]">
        <select
          value={order.status}
          onChange={(e) => updateOrderData(order.orderId, 'status', e.target.value)}
          className={cn(
            "w-full text-[10px] font-black px-2 py-1.5 rounded-lg border uppercase tracking-wide outline-none cursor-pointer mb-2",
            statusColor
          )}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <div className="flex gap-1 mb-2">
          <select
            value={order.source}
            onChange={(e) => updateOrderData(order.orderId, 'source', e.target.value)}
            className="flex-1 bg-amber-50 border border-amber-100 text-[9px] font-bold text-amber-700 outline-none cursor-pointer rounded-md px-1 py-1 truncate"
          >
            <option value="">Источник</option>
            {(handbookSources.length ? handbookSources : SOURCE_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <select
            value={order.deliveryMethod}
            onChange={(e) => updateOrderData(order.orderId, 'deliveryMethod', e.target.value)}
            className="flex-1 bg-blue-50 border border-blue-100 text-[9px] font-bold text-blue-700 outline-none cursor-pointer rounded-md px-1 py-1 truncate"
          >
            <option value="">Доставка</option>
            {(handbookDeliveries.length ? handbookDeliveries : DELIVERY_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => updateOrderData(order.orderId, 'isRecommended', order.isRecommended ? null : true)}
            className={cn(
              "flex-1 text-[8px] font-black py-1 rounded-md border transition-all uppercase tracking-tight",
              order.isRecommended
                ? "bg-zinc-800 border-zinc-800 text-white"
                : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
            )}
          >
            ★ Реком.
          </button>
        </div>

        {/* QR / Отправить счёт */}
        <PaymentRowBlock order={order} updateOrderData={updateOrderData} />
        {String(order.deliveryMethod || '').toLowerCase().includes('сдэк') && (
          <CdekOrderBlock order={order} updateOrderData={updateOrderData} productCatalog={productCatalog} />
        )}
      </td>

      {/* Финансы */}
      <td className="px-3 py-3 align-top w-[120px] text-right">
        <div className="space-y-1.5">
          <div>
            <div className="text-[8px] font-bold text-zinc-300 uppercase tracking-widest mb-0.5">Стоимость 100%</div>
            <input
              type="number"
              value={order.revenue ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'revenue', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[13px] font-black text-zinc-900 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
          <div>
            <div className="text-[8px] font-bold text-zinc-300 uppercase tracking-widest mb-0.5">Доставка</div>
            <input
              type="number"
              value={order.deliveryPrice ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'deliveryPrice', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[11px] font-semibold text-zinc-500 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
          <div className="border-t border-zinc-100 pt-1.5">
            <div className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5">Предоплата 50%</div>
            <input
              type="number"
              value={order.paidAmount ?? ''}
              onChange={(e) => updateOrderData(order.orderId, 'paidAmount', parseFloat(e.target.value) || 0)}
              className="w-full bg-transparent text-[13px] font-black text-emerald-600 text-right focus:bg-white focus:ring-1 focus:ring-blue-100 rounded px-1 outline-none"
            />
          </div>
        </div>
      </td>

      {/* Изделие */}
      <td className="px-3 py-3 align-top">
        <input
          type="text"
          list="product-list"
          value={order.item}
          onChange={(e) => applyProductCharacteristics(e.target.value)}
          placeholder="Название изделия..."
          className="w-full bg-transparent text-[12px] font-bold text-zinc-900 focus:bg-white focus:ring-1 focus:ring-blue-100 rounded-md px-2 py-1 outline-none mb-2 border border-transparent hover:border-zinc-100"
        />
        <div className="flex gap-2 mb-2">
          {fieldInput('Цвет',   order.rawRow?.[RAW_COLOR_INDEX] || '', 'color-list',  (v) => updateOrderData(order.orderId, `rawRow[${RAW_COLOR_INDEX}]`, v))}
          {fieldInput('Размер', order.rawRow?.[RAW_SIZE_INDEX] || '', 'size-list',   (v) => updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, v))}
          {fieldInput('Рост',   order.height  || '',     'height-list', (v) => updateOrderData(order.orderId, 'height', v))}
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
          {fieldInput('Метка',    order.label   || '', 'label-list',   (v) => updateOrderData(order.orderId, 'label', v))}
          {fieldInput('Менеджер', order.manager || '', 'manager-list', (v) => updateOrderData(order.orderId, 'manager', v))}
          {fieldInput('Блогер',   order.blogger || '', 'blogger-list', (v) => updateOrderData(order.orderId, 'blogger', v))}
          {fieldInput('Оплата',   order.paymentType || '', 'payment-type-list', (v) => updateOrderData(order.orderId, 'paymentType', v))}
        </div>
      </td>

      {/* Срок / Удалить */}
      <td className="px-3 py-3 align-top w-[60px]">
        <div className="flex flex-col items-center gap-1">
          <span className={cn(
            "text-[10px] font-black px-2 py-1 rounded-lg w-full text-center",
            order.isOverdue && !order.isShipped
              ? "bg-red-500 text-white animate-pulse shadow-sm shadow-red-200"
              : order.isShipped
                ? "bg-zinc-100 text-zinc-400"
                : "bg-blue-50 text-blue-600 border border-blue-100"
          )}>
            {order.deadlineDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
          </span>
          {order.isOverdue && !order.isShipped && (
            <span className="text-[7px] font-black text-red-500 uppercase tracking-tight">просрочен</span>
          )}
          {order.paymentUrl && (
            <a
              href={order.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 w-full flex items-center justify-center gap-0.5 py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-500 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all"
              title="Открыть ссылку СБП"
            >
              <QrCodeIcon size={10} />
            </a>
          )}
          {order.isFirebase && (
            <button
              onClick={() => {
                if (window.confirm(`Удалить заказ ${order.orderId}?`)) onDelete(order.orderId);
              }}
              className="mt-1 w-full flex items-center justify-center gap-0.5 py-1 rounded-md border border-red-100 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
              title="Удалить заказ"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </td>

    </tr>
  );
});

const OrderCard = React.memo(({
  order,
  updateOrderData,
  onDelete,
  productCatalog,
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
  productCatalog: ProductCatalogItem[];
}) => {
  const [copied, setCopied] = useState(false);
  const [mobilePaymentUrl, setMobilePaymentUrl] = useState(order.paymentUrl || '');
  const [mobilePaymentLoading, setMobilePaymentLoading] = useState(false);
  const [mobilePaymentError, setMobilePaymentError] = useState('');
  const [showMobileQr, setShowMobileQr] = useState(false);
  const mobileQrRef = useRef<HTMLDivElement>(null);
  const paymentUrl = mobilePaymentUrl;
  const dueAmount = getOrderPaymentDue(order);
  const shareText = paymentUrl ? buildOrderShareText(order, paymentUrl) : '';
  const chipItems = [
    ['Цвет', order.rawRow?.[RAW_COLOR_INDEX]],
    ['Размер', order.rawRow?.[RAW_SIZE_INDEX]],
    ['Рост', order.height],
    ['Доставка', order.deliveryMethod],
    ['Оплата', order.paymentType],
    ['Источник', order.source],
    ['Метка', order.label],
    ['Менеджер', order.manager],
    ['Блогер', order.blogger],
  ].filter(([, value]) => value);

  const copyPaymentText = () => {
    if (!shareText) return;
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    setMobilePaymentUrl(order.paymentUrl || '');
  }, [order.paymentUrl]);

  const createMobilePayment = async () => {
    setMobilePaymentLoading(true);
    setMobilePaymentError('');
    try {
      const amount = getOrderPaymentDue(order);
      if (amount <= 0) throw new Error('Сумма к оплате 0 ₽');

      const res = await fetch('/api/tochka/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          amount,
          description: `Заказ #${order.orderId} ${order.item || ''}`,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось создать счёт');
      if (!data.paymentUrl) throw new Error('Точка не вернула ссылку оплаты');

      setMobilePaymentUrl(data.paymentUrl);
      setShowMobileQr(true);
      updateOrderData(order.orderId, 'paymentUrl', data.paymentUrl);
    } catch (e: any) {
      setMobilePaymentError(e.message || 'Не удалось создать счёт');
    } finally {
      setMobilePaymentLoading(false);
    }
  };

  return (
    <div className={cn(
      "p-4 flex flex-col gap-3 transition-colors",
      order.isOverdue && !order.isShipped ? "bg-red-50/30" : "bg-white"
    )}>
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black text-zinc-900 tracking-tighter uppercase flex items-center gap-1.5">
              {order.isFirebase && <div title="Заказ из БД" className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />}
              {order.orderId}
            </span>
            <span className={cn(
              "text-[8px] font-black px-1.5 py-0.5 rounded uppercase",
              order.status?.toLowerCase().includes('оплачен') ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20" :
              order.status?.toLowerCase().includes('возврат') ? "bg-red-500 text-white shadow-sm shadow-red-500/20" :
              "bg-zinc-100 text-zinc-500"
            )}>
              {order.status}
            </span>
          </div>
          <p className="text-[9px] font-medium text-zinc-400 mt-0.5">{order.date.toLocaleDateString('ru-RU')}</p>
        </div>
        <div className="flex flex-col items-end">
          <p className="text-[11px] font-black text-zinc-900">{formatCurrency(order.revenue)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter">Срок:</p>
            <p className={cn(
              "text-[9px] font-black",
              order.isOverdue && !order.isShipped ? "text-red-500" : "text-blue-500"
            )}>
              {order.deadlineDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
            </p>
          </div>
        </div>
      </div>

      {/* Client Info Mobile */}
      <div className="bg-zinc-50/60 p-3 rounded-xl border border-zinc-100 space-y-1.5">
        <div className="flex items-center gap-2">
          <Users className="w-3 h-3 text-zinc-400" />
          <p className="text-[10px] font-black text-zinc-900 uppercase tracking-tight truncate flex-1">{order.clientName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="w-2.5 h-2.5 text-zinc-300" />
          <p className="text-[9px] font-mono text-zinc-400">+{order.clientPhone}</p>
        </div>
      </div>

      {/* Product Details Mobile */}
      <div className="rounded-xl border border-zinc-100 p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Модель</span>
            </div>
            <p className="text-[12px] font-black text-zinc-900 leading-tight">{order.item || '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Стоимость 100%</p>
            <p className="text-[13px] font-black text-zinc-900">{formatCurrency(order.revenue)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {chipItems.map(([label, value]) => (
            <div key={label} className="px-2 py-1 bg-white border border-zinc-100 rounded-md text-[8px] font-black text-zinc-600 uppercase tracking-tight">
              <span className="text-zinc-300">{label}: </span>{value}
            </div>
          ))}
        </div>
      </div>

      {/* Finance Mobile */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-2">
          <p className="text-[7px] font-black text-zinc-400 uppercase tracking-tight">Доставка</p>
          <p className="text-[10px] font-black text-zinc-800">{formatCurrency(order.deliveryPrice || 0)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2">
          <p className="text-[7px] font-black text-emerald-500 uppercase tracking-tight">Предоплата 50%</p>
          <p className="text-[10px] font-black text-emerald-700">{formatCurrency(order.paidAmount || 0)}</p>
        </div>
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-2">
          <p className="text-[7px] font-black text-blue-500 uppercase tracking-tight">К оплате</p>
          <p className="text-[10px] font-black text-blue-700">{formatCurrency(dueAmount)}</p>
        </div>
      </div>

      {/* Payment Mobile */}
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[8px] font-black text-violet-500 uppercase tracking-widest">СБП оплата</p>
            <p className="text-[8px] font-bold text-zinc-400">{paymentUrl ? 'Ссылка создана' : 'Ссылка еще не создана'}</p>
          </div>
          {paymentUrl && (
            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[8px] font-black uppercase tracking-wider"
            >
              Открыть
            </a>
          )}
        </div>

        {paymentUrl ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={copyPaymentText}
              className="py-2 rounded-lg bg-white border border-violet-100 text-[8px] font-black text-violet-600 uppercase"
            >
              {copied ? 'Готово' : 'Копия'}
            </button>
            <button
              onClick={() => openMessengerShare('telegram', shareText, paymentUrl)}
              className="py-2 rounded-lg bg-blue-50 border border-blue-100 text-[8px] font-black text-blue-600 uppercase"
            >
              Telegram
            </button>
            <button
              onClick={() => openMessengerShare('whatsapp', shareText, paymentUrl)}
              className="py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[8px] font-black text-emerald-600 uppercase"
            >
              WhatsApp
            </button>
            </div>
            <button
              onClick={() => setShowMobileQr(v => !v)}
              className="w-full py-2 rounded-lg bg-white border border-violet-100 text-[8px] font-black text-violet-600 uppercase"
            >
              {showMobileQr ? 'Скрыть QR' : 'Показать QR'}
            </button>
            {showMobileQr && (
              <div className="space-y-2">
                <div ref={mobileQrRef} className="flex justify-center p-3 bg-white border border-zinc-100 rounded-xl">
                  <QRCodeSVG value={paymentUrl} size={180} />
                </div>
                <button
                  onClick={() => shareQrImage(mobileQrRef.current?.querySelector('svg') || null, order.orderId, shareText).catch(() => navigator.clipboard.writeText(shareText))}
                  className="w-full py-2 rounded-lg bg-zinc-900 text-white text-[8px] font-black uppercase tracking-wider"
                >
                  Отправить QR
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              onClick={createMobilePayment}
              disabled={mobilePaymentLoading}
              className="w-full py-2 rounded-lg border border-violet-200 bg-violet-50 text-violet-600 text-[8px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {mobilePaymentLoading ? <RefreshCcw size={11} className="animate-spin" /> : <QrCodeIcon size={11} />}
              {mobilePaymentLoading ? 'Создаём...' : 'Создать счёт'}
            </button>
            {mobilePaymentError && (
              <p className="text-[9px] font-bold text-red-500">{mobilePaymentError}</p>
            )}
          </div>
        )}
      </div>

      {String(order.deliveryMethod || '').toLowerCase().includes('сдэк') && (
        <CdekOrderBlock order={order} updateOrderData={updateOrderData} productCatalog={productCatalog} mobile />
      )}

      {/* Quick Actions Mobile */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => updateOrderData(order.orderId, 'isShipped', !order.isShipped)}
          className={cn(
            "flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all",
            order.isShipped ? "bg-zinc-800 border-black text-white" : "bg-white border-zinc-200 text-zinc-400"
          )}
        >
          Отгрузить
        </button>
        <button
          onClick={() => updateOrderData(order.orderId, 'isRecommended', order.isRecommended ? null : true)}
          className={cn(
            "flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-widest border transition-all",
            order.isRecommended ? "bg-zinc-800 border-black text-white" : "bg-white border-zinc-200 text-zinc-400"
          )}
        >
          Реком.
        </button>
        {order.isFirebase && (
          <button
            onClick={() => {
              if (window.confirm(`Удалить заказ ${order.orderId}?`)) onDelete(order.orderId);
            }}
            className="w-11 py-2 rounded-lg text-red-500 bg-red-50 border border-red-100 transition-all active:bg-red-100 flex items-center justify-center"
            title="Удалить заказ"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

interface OrdersTabProps {
  data: OrderData[];
  stats: any;
  filteredOrders: OrderData[];
  pagedOrders: OrderData[];
  displayCount: number;
  setDisplayCount: (n: number) => void;
  ordersFilterMonth: number;
  setOrdersFilterMonth: (n: number) => void;
  slaFilterMonth: number;
  setSlaFilterMonth: (n: number) => void;
  filteredSlaStats: any;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  updateOrderData: (id: string, field: string, value: any) => void;
  deleteOrder: (id: string) => void;
  newOrder: Partial<OrderData>;
  setNewOrder: (o: Partial<OrderData>) => void;
  handleCreateOrder: () => Promise<string | null>;
  handbookProducts: string[];
  handbookColors: string[];
  handbookSizes: string[];
  handbookHeights: string[];
  handbookCompositions: string[];
  handbookSources: string[];
  handbookLabels: string[];
  handbookDeliveries: string[];
  handbookPaymentTypes: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
  exportToCsv: () => void;
  refreshing: boolean;
  lastUpdated: Date | null;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  fetchData: (isManual?: boolean) => void;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  data,
  stats,
  filteredOrders,
  pagedOrders,
  displayCount,
  setDisplayCount,
  ordersFilterMonth,
  setOrdersFilterMonth,
  slaFilterMonth,
  setSlaFilterMonth,
  filteredSlaStats,
  searchTerm,
  setSearchTerm,
  updateOrderData,
  deleteOrder,
  newOrder,
  setNewOrder,
  handleCreateOrder,
  handbookProducts,
  handbookColors,
  handbookSizes,
  handbookHeights,
  handbookCompositions,
  handbookSources,
  handbookLabels,
  handbookDeliveries,
  handbookPaymentTypes,
  handbookManagers,
  handbookBloggers,
  exportToCsv,
  refreshing,
  lastUpdated,
  autoRefresh,
  setAutoRefresh,
  fetchData,
}) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [clientQuery, setClientQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState('');
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const phoneSuggestionsRef = useRef<HTMLDivElement>(null);

  // QR / payment state after order creation
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdPaymentUrl, setCreatedPaymentUrl] = useState<string | null>(null);
  const [createdShareText, setCreatedShareText] = useState('');
  const [createdPaymentError, setCreatedPaymentError] = useState('');
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [tochkaConfigured, setTochkaConfigured] = useState(false);
  const [productCatalog, setProductCatalog] = useState<ProductCatalogItem[]>([]);
  const createdQrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/tochka/status').then(r => r.json()).then(d => setTochkaConfigured(!!d.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'products'), orderBy('name', 'asc')),
      snap => setProductCatalog(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCatalogItem))),
      () => setProductCatalog([])
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc')))
      .then(snap => setContacts(snap.docs.map(d => d.data())))
      .catch(() => {});
  }, []);

  const clientSuggestions = useMemo(() => {
    if (!clientQuery || clientQuery.length < 2) return [];
    const q = clientQuery.toLowerCase();
    return contacts.filter(c =>
      (c.fullName || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    ).slice(0, 8);
  }, [contacts, clientQuery]);

  const phoneSuggestions = useMemo(() => {
    if (!phoneQuery || phoneQuery.length < 2) return [];
    return contacts.filter(c =>
      (c.phone || '').includes(phoneQuery)
    ).slice(0, 8);
  }, [contacts, phoneQuery]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (phoneSuggestionsRef.current && !phoneSuggestionsRef.current.contains(e.target as Node)) {
        setShowPhoneSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectClient = (client: any) => {
    setNewOrder({
      ...newOrder,
      clientName: client.fullName || client.name || '',
      clientPhone: client.phone || '',
    });
    setClientQuery(client.fullName || client.name || '');
    setPhoneQuery(client.phone || '');
    setShowSuggestions(false);
    setShowPhoneSuggestions(false);
  };

  const productOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...productCatalog.map(p => p.name), ...handbookProducts]
      .filter(Boolean)
      .filter(name => {
        const key = normalizeProductName(name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [productCatalog, handbookProducts]);

  const applyNewOrderProduct = (value: string) => {
    const product = productCatalog.find(p => normalizeProductName(p.name) === normalizeProductName(value));
    const rawRow = [...(newOrder.rawRow || Array(30).fill(''))];
    while (rawRow.length < 30) rawRow.push('');

    if (product?.color) rawRow[RAW_COLOR_INDEX] = product.color;
    if (product?.sizeGrid) rawRow[RAW_SIZE_INDEX] = product.sizeGrid;

    setNewOrder({
      ...newOrder,
      item: value,
      rawRow,
      height: product?.height || newOrder.height || '',
      revenue: !newOrder.revenue && product?.sellingPrice ? product.sellingPrice : newOrder.revenue,
    });
  };

  return (
    <div className="space-y-4">
      <span className="text-[6px] font-bold text-zinc-300 block">[YB-VIEW-ORDERS]</span>
      {/* Compact Unified Orders Summary with 2026 Monthly Breakdown */}
      <div className="tg-card bg-white overflow-hidden">
        <div className="p-3 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-zinc-900" />
            <h3 className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">Аналитика по месяцам 2026</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tight">Всего заказов</span>
              <span className="text-[11px] font-black text-zinc-900 tracking-tight">{stats.totalOrders}</span>
            </div>
            <div className="w-[1px] h-6 bg-zinc-200" />
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-tight">Всего предоплат</span>
              <span className="text-[11px] font-black text-emerald-600 tracking-tight">{formatCurrency(stats.totalActualPayments)}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="flex p-3 gap-3 min-w-max">
            {stats.chartData
              .filter((d: any) => d.year === 2026)
              .reverse()
              .map((m: any, i: number) => (
              <div key={i} className="flex-shrink-0 w-44 p-3 bg-zinc-50 border border-zinc-100 rounded-xl relative group hover:border-zinc-300 transition-all">
                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-[7px] font-black text-zinc-400 uppercase tracking-tighter">
                  {m.year}
                </div>
                <p className="text-[10px] font-black text-zinc-900 uppercase mb-2 group-hover:text-blue-600 transition-colors">
                  {m.monthName}
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-zinc-500 uppercase">Заказы:</span>
                    <span className="text-[9px] font-bold text-zinc-900">{m.orders}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-zinc-500 uppercase">Выручка:</span>
                    <span className="text-[9px] font-black text-zinc-900">{formatCurrency(m.revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-medium text-emerald-600/70 uppercase">Предоплата:</span>
                    <span className="text-[9px] font-black text-emerald-600">{formatCurrency(m.paid)}</span>
                  </div>
                  <div className="pt-1.5 border-t border-zinc-200/50 flex items-center justify-between">
                    <span className="text-[8px] font-bold text-amber-600 uppercase">Доплата:</span>
                    <span className={cn(
                      "text-[9px] font-black",
                      m.dueExtra > 0 ? "text-amber-600" : "text-zinc-300"
                    )}>
                      {formatCurrency(m.dueExtra)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {stats.chartData.filter((d: any) => d.year === 2026).length === 0 && (
              <div className="w-full py-6 flex flex-col items-center justify-center text-zinc-400 gap-2">
                <Calendar className="w-6 h-6 opacity-20" />
                <p className="text-[9px] font-bold uppercase tracking-widest">Нет данных за 2026 год</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SLA Deadline Tracking Card */}
      <div className="tg-card p-3 bg-white border border-zinc-100 flex flex-col md:flex-row gap-6 items-center shadow-sm">
        <div className="flex-1 w-full space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-black text-zinc-900 uppercase tracking-widest flex items-center gap-2 mb-1">
                <AlertCircle className="w-3.5 h-3.5 text-blue-500" />
                Мониторинг исполнения заказов
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-[8px] text-zinc-400 font-medium uppercase tracking-tight">Целевой срок: 10 рабочих дней</p>
                <div className="w-[1px] h-2 bg-zinc-200" />
                <select
                  value={slaFilterMonth}
                  onChange={(e) => setSlaFilterMonth(parseInt(e.target.value))}
                  className="text-[9px] font-black text-blue-600 bg-transparent focus:outline-none cursor-pointer uppercase tracking-tight border-b border-blue-200"
                >
                  <option value={-1}>Все месяцы</option>
                  {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </select>
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-tight">2026</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[12px] font-black text-zinc-900 tracking-tighter">
                {filteredSlaStats?.onTimeRate.toFixed(1)}% <span className="text-[8px] font-bold text-zinc-400">SLA</span>
              </span>
            </div>
          </div>

          <div className="h-4 w-full bg-zinc-100 rounded-full overflow-hidden flex shadow-inner">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.onTime || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                В работе (в срок): {filteredSlaStats?.onTime}
              </div>
            </div>
            <div
              className="h-full bg-zinc-300 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.shipped || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                Отгружено: {filteredSlaStats?.shipped}
              </div>
            </div>
            <div
              className="h-full bg-red-500 transition-all duration-500 relative group/bar"
              style={{ width: `${(filteredSlaStats?.overdue || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
            >
              <div className="hidden group-hover/bar:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 text-white text-[7px] rounded whitespace-nowrap z-10">
                Просрочено: {filteredSlaStats?.overdue}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="p-2 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
              <p className="text-[7px] font-bold text-emerald-600 uppercase tracking-tighter mb-0.5">В производстве</p>
              <p className="text-[11px] font-black text-emerald-700">{filteredSlaStats?.onTime}</p>
            </div>
            <div className="p-2 bg-zinc-50 rounded-xl border border-zinc-100">
              <p className="text-[7px] font-bold text-zinc-500 uppercase tracking-tighter mb-0.5">Отгружено</p>
              <p className="text-[11px] font-black text-zinc-700">{filteredSlaStats?.shipped}</p>
            </div>
            <div className="p-2 bg-red-50/50 rounded-xl border border-red-100/50">
              <p className="text-[7px] font-bold text-red-600 uppercase tracking-tighter mb-0.5">Просрали сроки</p>
              <div className="flex items-center gap-1">
                <p className="text-[11px] font-black text-red-700">{filteredSlaStats?.overdue}</p>
                {filteredSlaStats && filteredSlaStats.overdue > 0 && <span className="flex h-1 w-1 rounded-full bg-red-500 animate-pulse" />}
              </div>
            </div>
            <div className="p-2 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[7px] font-bold text-amber-600 uppercase tracking-tighter mb-0.5">Упущенная задержка</p>
              <p className="text-[11px] font-black text-amber-700">{formatCurrency(filteredSlaStats?.lostRevenue || 0)}</p>
            </div>
          </div>
        </div>

        <div className="w-full md:w-56 h-32 flex flex-col items-center justify-center border-l border-zinc-100 pl-6 hidden md:flex">
          {(!filteredSlaStats || (filteredSlaStats.onTime === 0 && filteredSlaStats.shipped === 0 && filteredSlaStats.overdue === 0)) ? (
            <div className="flex-1 flex items-center justify-center w-full h-full text-[9px] text-zinc-400 font-bold uppercase tracking-widest text-center">
              Нет данных<br/>за месяц
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'В срок', value: filteredSlaStats.onTime || 0, color: '#10b981' },
                    { name: 'Отгружено', value: filteredSlaStats.shipped || 0, color: '#d4d4d8' },
                    { name: 'Просрочено', value: filteredSlaStats.overdue || 0, color: '#ef4444' }
                  ]}
                  innerRadius={28}
                  outerRadius={45}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell key="cell-0" fill="#10b981" />
                  <Cell key="cell-1" fill="#d4d4d8" />
                  <Cell key="cell-2" fill="#ef4444" />
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <p className="text-[7px] font-black text-zinc-400 uppercase mt-1 tracking-tighter text-center">{['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][slaFilterMonth]} готовность</p>
        </div>
      </div>

      {/* New Order Form Block */}
      <div className="tg-card p-4 sm:p-6 bg-white border border-zinc-200 text-zinc-900 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-zinc-900 rounded-2xl shadow-lg shadow-zinc-200">
            <Plus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] leading-none mb-1.5">Новый заказ</h3>
            <p className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Добавить запись в список</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">

            {/* Group: Basic Info */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <Calendar className="w-3 h-3 text-zinc-500" /> Дата и ID
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="date"
                  value={newOrder.date ? newOrder.date.toISOString().split('T')[0] : ''}
                  onChange={(e) => setNewOrder({...newOrder, date: new Date(e.target.value)})}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                />
                <input
                  type="text"
                  placeholder="ID заказа"
                  value={newOrder.orderId || ''}
                  onChange={(e) => setNewOrder({...newOrder, orderId: e.target.value.toUpperCase()})}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Group: Client Info */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <Users className="w-3 h-3 text-zinc-500" /> Клиент
              </label>
              <div className="flex flex-col gap-2">
                <div className="relative" ref={suggestionsRef}>
                <input
                  type="text"
                  placeholder="ФИО клиента"
                  value={clientQuery || newOrder.clientName || ''}
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setNewOrder({...newOrder, clientName: e.target.value});
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                  autoComplete="off"
                />
                <AnimatePresence>
                  {showSuggestions && clientSuggestions.length > 0 && (
                    <motion.div
                      ref={suggestionsRef}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden"
                    >
                      {clientSuggestions.map((client, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onMouseDown={() => selectClient(client)}
                          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-50 text-left border-b border-zinc-50 last:border-b-0 transition-colors"
                        >
                          <UserCircle size={14} className="text-zinc-300 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-zinc-900 truncate">{client.fullName || client.name}</p>
                            <p className="text-[9px] text-zinc-400 font-mono">+{client.phone}</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
                <div className="relative" ref={phoneSuggestionsRef}>
                  <input
                    type="text"
                    placeholder="Телефон"
                    value={phoneQuery || newOrder.clientPhone || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setPhoneQuery(val);
                      setNewOrder({...newOrder, clientPhone: val});
                      setShowPhoneSuggestions(true);
                    }}
                    onFocus={() => setShowPhoneSuggestions(true)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                    autoComplete="off"
                  />
                  <AnimatePresence>
                    {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden"
                      >
                        {phoneSuggestions.map((client, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onMouseDown={() => selectClient(client)}
                            className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-50 text-left border-b border-zinc-50 last:border-b-0 transition-colors"
                          >
                            <UserCircle size={14} className="text-zinc-300 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold text-zinc-900 truncate">{client.fullName || client.name}</p>
                              <p className="text-[9px] text-zinc-400 font-mono">+{client.phone}</p>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Group: Product Details */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <ShoppingBag className="w-3 h-3 text-zinc-500" /> Изделие
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  list="product-list"
                  placeholder="Наименование"
                  value={newOrder.item || ''}
                  onChange={(e) => applyNewOrderProduct(e.target.value)}
                  className="col-span-2 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                />
                <div className="relative">
                  <select
                    value={newOrder.rawRow?.[RAW_COLOR_INDEX] || ''}
                    onChange={(e) => {
                      const nr = [...(newOrder.rawRow || Array(25).fill(''))];
                      nr[RAW_COLOR_INDEX] = e.target.value;
                      setNewOrder({...newOrder, rawRow: nr});
                    }}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.rawRow?.[RAW_COLOR_INDEX] ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Цвет</option>
                    {handbookColors.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={newOrder.rawRow?.[RAW_SIZE_INDEX] || ''}
                    onChange={(e) => {
                      const nr = [...(newOrder.rawRow || Array(25).fill(''))];
                      nr[RAW_SIZE_INDEX] = e.target.value;
                      setNewOrder({...newOrder, rawRow: nr});
                    }}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.rawRow?.[RAW_SIZE_INDEX] ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Размер</option>
                    {handbookSizes.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Group: Logistics */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2 mb-1">
                <MapPin className="w-3 h-3 text-zinc-500" /> Логистика
              </label>
              <div className="grid grid-cols-1 gap-2">
                <div className="relative">
                  <select
                    value={newOrder.deliveryMethod || ''}
                    onChange={(e) => setNewOrder({...newOrder, deliveryMethod: e.target.value})}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.deliveryMethod ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Доставка</option>
                    {(handbookDeliveries.length ? handbookDeliveries : DELIVERY_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={newOrder.paymentType || ''}
                    onChange={(e) => setNewOrder({...newOrder, paymentType: e.target.value})}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.paymentType ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Вид оплаты</option>
                    {(handbookPaymentTypes.length ? handbookPaymentTypes : PAYMENT_TYPE_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
                <div className="relative">
                  <select
                    value={newOrder.source || ''}
                    onChange={(e) => setNewOrder({...newOrder, source: e.target.value})}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.source ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Источник</option>
                    {(handbookSources.length ? handbookSources : SOURCE_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
              </div>
            </div>

          </div>

          {/* Row 2: Extra params */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 -mt-2">
            {[
              { label: 'Рост',     value: newOrder.height  || '', opts: handbookHeights,  onChange: (v: string) => setNewOrder({...newOrder, height: v})  },
              { label: 'Метка',    value: newOrder.label   || '', opts: handbookLabels,   onChange: (v: string) => setNewOrder({...newOrder, label: v})   },
              { label: 'Менеджер', value: newOrder.manager || '', opts: handbookManagers, onChange: (v: string) => setNewOrder({...newOrder, manager: v}) },
              { label: 'Блогер',   value: newOrder.blogger || '', opts: handbookBloggers, onChange: (v: string) => setNewOrder({...newOrder, blogger: v}) },
            ].map(({ label, value, opts, onChange }) => (
              <div key={label} className="relative">
                <select
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className={cn(
                    "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                    value ? "text-zinc-900" : "text-zinc-400"
                  )}
                >
                  <option value="">{label}</option>
                  {opts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400 rotate-90 pointer-events-none" />
              </div>
            ))}
          </div>

          {/* Footer Section: Finance & Action */}
          <div className="pt-6 border-t border-zinc-200 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="w-full md:w-auto grid grid-cols-2 sm:flex gap-3 sm:gap-4 items-end">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest pl-1">Стоимость 100%</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.revenue) ? "" : newOrder.revenue || ""}
                    onChange={(e) => setNewOrder({...newOrder, revenue: parseFloat(e.target.value) || 0})}
                    className="w-full sm:w-36 bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-4 py-2.5 text-[11px] font-black text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest pl-1">Предоплата 50%</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.paidAmount) ? "" : newOrder.paidAmount || ""}
                    onChange={(e) => setNewOrder({...newOrder, paidAmount: parseFloat(e.target.value) || 0})}
                    className="w-full sm:w-36 bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-4 py-2.5 text-[11px] font-black text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                const orderSnapshot = { ...newOrder, rawRow: [...(newOrder.rawRow || [])] };
                const orderId = await handleCreateOrder();
                if (!orderId) return;
                const paymentPageUrl = buildPaymentPageUrl(orderId);
                setCreatedOrderId(orderId);
                setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, paymentPageUrl));
                setCreatedPaymentUrl(null);
                setCreatedPaymentError('');
                if (tochkaConfigured) {
                  setIsCreatingQr(true);
                  try {
                    const amount = getOrderPaymentDue({
                      revenue: newOrder.revenue || 0,
                      deliveryPrice: newOrder.deliveryPrice || 0,
                      paidAmount: newOrder.paidAmount || 0,
                    });
                    if (amount <= 0) throw new Error('Остаток к оплате 0 ₽');
                    const res = await fetch('/api/tochka/create-payment', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        orderId,
                        amount,
                        description: `Заказ #${orderId} ${orderSnapshot.item || ''}`,
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Не удалось создать счёт');
                    if (data.paymentUrl) {
                      setCreatedPaymentUrl(data.paymentUrl);
                      setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, data.paymentUrl));
                    }
                  } catch (e: any) {
                    setCreatedPaymentError(e.message || 'Не удалось создать счёт');
                  }
                  finally { setIsCreatingQr(false); }
                }
              }}
              className="w-full md:w-64 bg-zinc-900 text-white py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg shadow-zinc-200"
            >
              <span>Создать заказ</span>
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* QR Panel — появляется после создания заказа */}
        <AnimatePresence>
          {createdOrderId && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 p-4 bg-white border border-emerald-100 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle2 size={16} />
                  <span className="text-[11px] font-black uppercase tracking-widest">Заказ создан!</span>
                </div>
                <button onClick={() => { setCreatedOrderId(null); setCreatedPaymentUrl(null); setCreatedShareText(''); }} className="text-zinc-300 hover:text-zinc-500">
                  <X size={14} />
                </button>
              </div>

              {isCreatingQr && (
                <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                  <RefreshCcw size={12} className="animate-spin" />
                  Создаём ссылку оплаты...
                </div>
              )}

              {createdPaymentUrl && (
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <div ref={createdQrRef} className="p-3 bg-white border border-zinc-200 rounded-xl inline-block">
                      <QRCodeSVG value={createdPaymentUrl} size={160} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdShareText || createdPaymentUrl);
                        setQrCopied(true);
                        setTimeout(() => setQrCopied(false), 2000);
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-[10px] font-black text-zinc-700 hover:bg-zinc-50 flex items-center justify-center gap-1.5"
                    >
                      {qrCopied ? '✓ Скопировано!' : <><Copy size={11} /> Копировать текст</>}
                    </button>
                    <button
                      onClick={() => shareOrder(createdShareText, createdPaymentUrl).catch(() => navigator.clipboard.writeText(createdShareText))}
                      className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-[10px] font-black hover:bg-blue-600 flex items-center justify-center gap-1.5"
                    >
                      <Send size={11} /> Поделиться
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openMessengerShare('telegram', createdShareText, createdPaymentUrl)}
                      className="py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-600 text-[10px] font-black hover:bg-blue-500 hover:text-white transition-colors"
                    >
                      Telegram
                    </button>
                    <button
                      onClick={() => openMessengerShare('whatsapp', createdShareText, createdPaymentUrl)}
                      className="py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 text-[10px] font-black hover:bg-emerald-500 hover:text-white transition-colors"
                    >
                      WhatsApp
                    </button>
                  </div>
                  <button
                    onClick={() => shareQrImage(createdQrRef.current?.querySelector('svg') || null, createdOrderId, createdShareText).catch(() => navigator.clipboard.writeText(createdShareText))}
                    className="w-full py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-600 text-[10px] font-black hover:bg-violet-500 hover:text-white transition-colors flex items-center justify-center gap-1.5"
                  >
                    <QrCodeIcon size={11} /> Отправить QR картинкой
                  </button>
                  <a
                    href={createdPaymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-[9px] text-zinc-400 hover:text-violet-600 underline"
                  >
                    Открыть ссылку СБП
                  </a>
                </div>
              )}

              {!isCreatingQr && !createdPaymentUrl && !tochkaConfigured && (
                <p className="text-[10px] text-zinc-400">
                  Настрой Точка Банк в Рассылки → Настройки, чтобы автоматически создавать QR
                </p>
              )}
              {!isCreatingQr && !createdPaymentUrl && tochkaConfigured && (
                <p className="text-[10px] text-amber-600">{createdPaymentError || 'Не удалось создать ссылку оплаты'}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Orders List Table */}
      <div className="tg-card overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[10px] font-semibold text-zinc-900 uppercase tracking-widest">Список заказов</h3>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-50 border border-zinc-100 rounded-md">
              <Calendar className="w-2.5 h-2.5 text-zinc-400" />
              <select
                value={ordersFilterMonth}
                onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
                className="text-[9px] font-bold text-blue-600 bg-transparent focus:outline-none cursor-pointer uppercase tracking-tight"
              >
                <option value={-1}>Все месяцы</option>
                {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-300" />
            <input
              type="text"
              placeholder="Поиск..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 pr-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-lg text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-200 transition-all w-full sm:w-48"
            />
          </div>
        </div>
        <div className="overflow-x-auto print:overflow-visible">
          {/* Desktop Table View */}
          <table className="w-full text-left border-collapse hidden md:table">
            <thead>
              <tr className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-50/50">
                <th className="px-2 py-2 border-none w-20">Дата/ID</th>
                <th className="px-2 py-2 border-none w-48">Клиент / Контакт</th>
                <th className="px-2 py-2 border-none w-32">Статус / Доставка</th>
                <th className="px-2 py-2 border-none w-40 text-right">Финансы</th>
                <th className="px-2 py-2 border-none">Изделие и Доп. (A-X)</th>
                <th className="px-2 py-2 border-none w-16">Срок</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {pagedOrders.map((order, i) => (
                <OrderRow
                  key={`${order.orderId}-${i}`}
                  order={order}
                  updateOrderData={updateOrderData}
                  onDelete={deleteOrder}
                  handbookSources={handbookSources}
                  handbookDeliveries={handbookDeliveries}
                  handbookSizes={handbookSizes}
                  handbookColors={handbookColors}
                  handbookHeights={handbookHeights}
                  handbookLabels={handbookLabels}
                  handbookManagers={handbookManagers}
                  handbookBloggers={handbookBloggers}
                  productCatalog={productCatalog}
                />
              ))}
            </tbody>
          </table>

          {filteredOrders.length > displayCount && (
            <div className="p-4 flex justify-center bg-zinc-50/30 border-t border-zinc-100">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:bg-zinc-50 transition-all shadow-sm flex items-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Показать еще ({filteredOrders.length - displayCount})
              </button>
            </div>
          )}
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden flex flex-col divide-y divide-zinc-100">
          {pagedOrders.map((order, i) => (
            <OrderCard
              key={`${order.orderId}-${i}`}
              order={order}
              updateOrderData={updateOrderData}
              onDelete={deleteOrder}
              productCatalog={productCatalog}
            />
          ))}

          {filteredOrders.length > displayCount && (
            <div className="p-6 flex justify-center bg-zinc-50/30 border-t border-zinc-100">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="w-full py-4 bg-white border border-zinc-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:bg-zinc-50 transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Показать еще ({filteredOrders.length - displayCount})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Global Datalists */}
      <datalist id="product-list">
        {productOptions.map((p, idx) => (
          <option key={`hp-${idx}`} value={p} />
        ))}
      </datalist>
      <datalist id="color-list">
        {handbookColors.map((c, idx) => (
          <option key={`hc-${idx}`} value={c} />
        ))}
      </datalist>
      <datalist id="size-list">
        {handbookSizes.map((s, idx) => (
          <option key={`hs-${idx}`} value={s} />
        ))}
      </datalist>
      <datalist id="promo-list">
        {stats.uniquePromotions.map((p: string) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="source-list">
        {stats.uniqueSources.map((s: string) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="category-list">
        {stats.uniqueCategories.map((c: string) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="height-list">
        {handbookHeights.map((h, idx) => (
          <option key={`hh-${idx}`} value={h} />
        ))}
      </datalist>
      <datalist id="label-list">
        {handbookLabels.map((l, idx) => (
          <option key={`hl-${idx}`} value={l} />
        ))}
      </datalist>
      <datalist id="payment-type-list">
        {(handbookPaymentTypes.length ? handbookPaymentTypes : PAYMENT_TYPE_OPTIONS).map((p, idx) => (
          <option key={`hpay-${idx}`} value={p} />
        ))}
      </datalist>
      <datalist id="manager-list">
        {handbookManagers.map((m, idx) => (
          <option key={`hm-${idx}`} value={m} />
        ))}
      </datalist>
      <datalist id="blogger-list">
        {handbookBloggers.map((b, idx) => (
          <option key={`hb-${idx}`} value={b} />
        ))}
      </datalist>
    </div>
  );
};
