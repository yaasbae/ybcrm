import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ComposedChart, CartesianGrid, XAxis, YAxis, Bar, Line
} from 'recharts';
import {
  TrendingUp, Users, ShoppingBag,
  Calendar, Award, AlertCircle, Search, Plus,
  X, MapPin, Star, RefreshCcw,
  Tag, Trash2, Phone, UserCircle, ChevronRight, QrCode as QrCodeIcon,
  CheckCircle2, Copy, Send, Truck, Wallet, CreditCard, Database, Filter,
  ArrowUpRight, ArrowDownRight, Printer, Upload
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { OrderData } from '../AnalyticsDashboard';
import { db } from '../../firebase';
import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';

const STATUS_OPTIONS = ['Новый', 'В работе', 'Оплачен', 'Отгружен', 'Доставлен', 'Возврат', 'Отмена', 'Обмен'];
const DELIVERY_OPTIONS = ['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS'];
const SOURCE_OPTIONS = ['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный'];
const PAYMENT_TYPE_OPTIONS = ['QR код', 'Сплитами', 'Долями', 'Наличкой', 'Наложенный СДЭК'];
const INVOICE_PAYMENT_OPTIONS = ['Предоплата 50%', 'Полная оплата', 'Оплата с примеркой'];
const MANAGER_PLAN_DEFAULTS = {
  dayPlan: 3,
  monthPlan: 60,
  basePlan: 120,
  revenuePlan: 0,
};
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

type ManagerPlanSettings = Record<string, {
  dayPlan: number;
  monthPlan: number;
  basePlan: number;
  revenuePlan: number;
}>;

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

let cdekStatusCache: { configured?: boolean; error?: string } | null = null;
let cdekStatusPromise: Promise<{ configured?: boolean; error?: string }> | null = null;
const cdekCitiesCache = new Map<string, CdekCityOption[]>();
const cdekPointsCache = new Map<string, CdekDeliveryPoint[]>();

const CDEK_TARIFFS = [
  { code: '136', label: 'Склад → ПВЗ' },
  { code: '137', label: 'Склад → дверь' },
  { code: '138', label: 'Дверь → ПВЗ' },
  { code: '139', label: 'Дверь → дверь' },
];

const normalizeProductName = (value: string) => value.trim().toLowerCase();
const shortCdekId = (value: string) => value ? `${value.slice(0, 8)}...${value.slice(-4)}` : '';
const getContactName = (contact: any) => String(contact?.fullName || contact?.name || contact?.clientName || '').trim();
const getContactPhone = (contact: any) => String(contact?.phone || contact?.userId || contact?.clientPhone || '').replace(/[^0-9]/g, '');

const addBusinessDays = (date: Date, days: number) => {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return result;
};

const getOrderItems = (order: Partial<Pick<OrderData, 'item' | 'items'>>): string[] => {
  const savedItems = Array.isArray(order.items) ? order.items.map(item => String(item || '').trim()).filter(Boolean) : [];
  if (savedItems.length) return savedItems;
  return String(order.item || '')
    .split(/\s*,\s*|\n/)
    .map(item => item.trim())
    .filter(Boolean);
};

const joinOrderItems = (items: string[]) => items.map(item => item.trim()).filter(Boolean).join(', ');

const getOrderItemPrices = (order: Partial<Pick<OrderData, 'itemPrices' | 'items' | 'item' | 'revenue'>>): number[] => {
  const items = getOrderItems(order);
  const savedPrices = Array.isArray(order.itemPrices) ? order.itemPrices.map(price => Number(price) || 0) : [];
  if (savedPrices.length) {
    return items.map((_, index) => savedPrices[index] || 0);
  }
  if (items.length === 1 && Number(order.revenue)) return [Number(order.revenue) || 0];
  return items.map(() => 0);
};

const getOrderItemColors = (order: Partial<Pick<OrderData, 'itemColors' | 'items' | 'item' | 'rawRow'>>): string[] => {
  const items = getOrderItems(order);
  const savedColors = Array.isArray(order.itemColors) ? order.itemColors.map(color => String(color || '').trim()) : [];
  if (savedColors.length) return items.map((_, index) => savedColors[index] || '');
  const fallbackColor = String(order.rawRow?.[RAW_COLOR_INDEX] || '').trim();
  return items.map((_, index) => index === 0 ? fallbackColor : '');
};

const getOrderItemSizes = (order: Partial<Pick<OrderData, 'itemSizes' | 'items' | 'item' | 'rawRow'>>): string[] => {
  const items = getOrderItems(order);
  const savedSizes = Array.isArray(order.itemSizes) ? order.itemSizes.map(size => String(size || '').trim()) : [];
  if (savedSizes.length) return items.map((_, index) => savedSizes[index] || '');
  const fallbackSize = String(order.rawRow?.[RAW_SIZE_INDEX] || '').trim();
  return items.map((_, index) => index === 0 ? fallbackSize : '');
};

const getOrderItemHeights = (order: Partial<Pick<OrderData, 'itemHeights' | 'items' | 'item' | 'height'>>): string[] => {
  const items = getOrderItems(order);
  const savedHeights = Array.isArray(order.itemHeights) ? order.itemHeights.map(height => String(height || '').trim()) : [];
  if (savedHeights.length) return items.map((_, index) => savedHeights[index] || '');
  const fallbackHeight = String(order.height || '').trim();
  return items.map((_, index) => index === 0 ? fallbackHeight : '');
};

const isPaidTochkaStatus = (status: string) => {
  const normalized = String(status || '').toLowerCase();
  return ['paid', 'approved', 'completed', 'succeeded', 'success', 'done'].some(item => normalized.includes(item));
};

const getItemPricesTotal = (prices: number[]) => prices.reduce((sum, price) => sum + (Number(price) || 0), 0);

const getProductForOrder = (products: ProductCatalogItem[], itemName: string) =>
  products.find(p => normalizeProductName(p.name) === normalizeProductName(itemName || ''));

const optionList = (items: string[], fallback: string[] = []) =>
  Array.from(new Set([...(items.length ? items : fallback)].map(item => String(item || '').trim()).filter(Boolean)));

// Объединяет несколько источников (справочник, значения из заказов, дефолты) в один
// дедуплицированный список — чтобы выпадашка не пустела, если один источник недоступен.
const mergeOptions = (...lists: (string[] | undefined)[]) =>
  Array.from(new Set(lists.flatMap(list => (list || []).map(item => String(item || '').trim())).filter(Boolean)));

const optionsWithCurrent = (items: string[], current: string, fallback: string[] = []) => {
  const options = optionList(items, fallback);
  const value = String(current || '').trim();
  return value && !options.includes(value) ? [value, ...options] : options;
};

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

function getOrderFinalPaymentAmount(order: Partial<Pick<OrderData, 'revenue' | 'deliveryPrice' | 'paidAmount'>>): number {
  const fullAmount = Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));
  const paidAmount = Math.max(0, Number(order.paidAmount) || 0);
  return Math.max(0, fullAmount - paidAmount);
}

function getInvoiceAmount(order: Partial<Pick<OrderData, 'revenue' | 'deliveryPrice' | 'invoiceType'>>): number {
  const total = Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));
  if (order.invoiceType === 'fitting') return 2000;
  return order.invoiceType === 'full' ? total : total * 0.5;
}

function getInvoiceTypeFromPaymentType(paymentType?: string): 'prepayment' | 'full' | 'fitting' {
  const value = String(paymentType || '').toLowerCase();
  if (value.includes('пример')) return 'fitting';
  if (value.includes('полн') || value.includes('100')) return 'full';
  return 'prepayment';
}

function getInvoicePaymentLabel(invoiceType?: 'prepayment' | 'full' | 'fitting'): string {
  if (invoiceType === 'fitting') return 'Оплата с примеркой';
  if (invoiceType === 'full') return 'Полная оплата';
  return 'Предоплата 50%';
}

const getOrderSelectionKey = (order: OrderData, index: number) => `${order.orderId || 'order'}-${index}`;

const escapePrintHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const buildOrdersPrintHtml = (orders: OrderData[]) => {
  const generatedAt = new Date().toLocaleString('ru-RU');
  const rows = orders.map(order => {
    const items = getOrderItems(order);
    const prices = getOrderItemPrices(order);
    const colors = getOrderItemColors(order);
    const sizes = getOrderItemSizes(order);
    const heights = getOrderItemHeights(order);
    const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
    const invoiceLabel = getInvoicePaymentLabel(invoiceType);
    const deadlineDate = addBusinessDays(order.date, 7);
    const itemLines = (items.length ? items : ['-']).map((item, index) => {
      const meta = [colors[index], sizes[index], heights[index]].filter(Boolean).join(' / ');
      return `
        <div class="item-line">
          <div>
            <strong>${escapePrintHtml(item)}</strong>
            ${meta ? `<span>${escapePrintHtml(meta)}</span>` : ''}
          </div>
          <b>${escapePrintHtml(formatCurrency(prices[index] || (items.length === 1 ? order.revenue : 0)))} x 1</b>
        </div>
      `;
    }).join('');

    return `
      <tr>
        <td>
          <strong>${escapePrintHtml(order.date.toLocaleDateString('ru-RU'))}</strong>
          <span>#${escapePrintHtml(order.orderId)}</span>
        </td>
        <td>
          <strong>${escapePrintHtml(order.clientName || '-')}</strong>
          <span>${order.clientPhone ? `+${escapePrintHtml(order.clientPhone)}` : '-'}</span>
        </td>
        <td>
          <strong>${escapePrintHtml(order.status || '-')}</strong>
          <span>${escapePrintHtml(order.deliveryMethod || '-')}</span>
        </td>
        <td>
          <strong>${escapePrintHtml(formatCurrency(order.revenue || 0))}</strong>
          <span>доставка ${escapePrintHtml(formatCurrency(order.deliveryPrice || 0))}</span>
          <em>${escapePrintHtml(invoiceLabel)}: ${escapePrintHtml(formatCurrency(order.paidAmount || 0))}</em>
        </td>
        <td>${itemLines}</td>
        <td>
          <span>старт ${escapePrintHtml(order.date.toLocaleDateString('ru-RU'))}</span>
          <strong>до ${escapePrintHtml(deadlineDate.toLocaleDateString('ru-RU'))}</strong>
        </td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Печать заказов</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; color: #18181b; font-family: Inter, Arial, sans-serif; background: #fff; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: .16em; text-transform: uppercase; }
    header p { margin: 6px 0 0; color: #71717a; font-size: 12px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { padding: 10px 8px; border-bottom: 1px solid #d4d4d8; color: #71717a; font-size: 9px; text-align: left; text-transform: uppercase; letter-spacing: .14em; }
    td { padding: 13px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size: 12px; line-height: 1.35; }
    td strong { display: block; font-size: 12px; font-weight: 800; color: #09090b; }
    td span { display: block; margin-top: 5px; color: #71717a; font-weight: 650; }
    td em { display: block; margin-top: 5px; color: #ea580c; font-style: normal; font-weight: 800; }
    .item-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-bottom: 8px; }
    .item-line:last-child { margin-bottom: 0; }
    .item-line b { white-space: nowrap; color: #71717a; font-size: 11px; }
    @page { size: A4 landscape; margin: 12mm; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Список заказов</h1>
      <p>Выбрано строк: ${orders.length}</p>
    </div>
    <p>Сформировано: ${escapePrintHtml(generatedAt)}</p>
  </header>
  <table>
    <thead>
      <tr>
        <th style="width: 11%">Дата / ID</th>
        <th style="width: 17%">Клиент / Контакт</th>
        <th style="width: 14%">Статус / Доставка</th>
        <th style="width: 15%">Финансы</th>
        <th style="width: 32%">Изделие</th>
        <th style="width: 11%">Срок</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
};

function getShortPaymentLabel(invoiceType?: 'prepayment' | 'full' | 'fitting'): string {
  if (invoiceType === 'fitting') return 'Примерка СДЭК';
  if (invoiceType === 'full') return 'Полная оплата';
  return 'Предоплата';
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
  const itemsText = joinOrderItems(getOrderItems(order));
  const lines = [
    `Здравствуйте! Счет на оплату заказа #${order.orderId || ''}`,
    '',
    itemsText ? `Модель: ${itemsText}` : '',
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

function buildPaymentShareText(order: Partial<OrderData>, paymentUrl: string, amount: number, label = 'Счет на оплату'): string {
  const itemsText = joinOrderItems(getOrderItems(order));
  const lines = [
    `Здравствуйте! ${label} заказа #${order.orderId || ''}`,
    '',
    itemsText ? `Модель: ${itemsText}` : '',
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
  const [finalLoading, setFinalLoading] = useState(false);
  const [refreshingMain, setRefreshingMain] = useState(false);
  const [refreshingFinal, setRefreshingFinal] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(order.paymentUrl || null);
  const [finalPaymentUrl, setFinalPaymentUrl] = useState<string | null>(order.finalPaymentUrl || null);
  const [showQr, setShowQr] = useState(false);
  const [showFinalQr, setShowFinalQr] = useState(false);
  const [error, setError] = useState('');
  const [finalError, setFinalError] = useState('');
  const qrRef = useRef<HTMLDivElement>(null);
  const finalQrRef = useRef<HTMLDivElement>(null);

  const pageUrl = buildPaymentPageUrl(order.orderId);
  const targetPaymentUrl = paymentUrl || pageUrl;
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const mainPaymentPaid = isPaidTochkaStatus(order.paymentStatus || '');
  const finalPaymentPaid = isPaidTochkaStatus(order.finalPaymentStatus || '');
  const initialAmount = getOrderPaymentDue(order);
  const finalAmount = getOrderFinalPaymentAmount(order);
  const showFinalPayment = invoiceType !== 'full' && finalAmount > 0;
  const mainPaymentLabel = getShortPaymentLabel(invoiceType);
  const mainPaymentStatusText = mainPaymentPaid
    ? `${mainPaymentLabel} оплачена`
    : paymentUrl
      ? `${mainPaymentLabel} ожидает оплаты`
      : `${mainPaymentLabel} не создана`;
  const finalPaymentStatusText = finalPaymentPaid
    ? 'Доплата оплачена'
    : finalPaymentUrl
      ? 'Доплата ожидает оплаты'
      : 'Доплата не создана';
  const shareText = buildPaymentShareText(order, targetPaymentUrl, initialAmount, 'Счет на оплату');
  const finalShareText = finalPaymentUrl
    ? buildPaymentShareText(order, finalPaymentUrl, finalAmount, 'Счет на доплату')
    : '';

  const paymentStatusBadge = (text: string, paid: boolean, tone: 'main' | 'final') => (
    <div className={cn(
      "rounded-md border px-2 py-1 text-[8px] font-black uppercase tracking-wide",
      paid
        ? "border-emerald-200 bg-emerald-50 text-emerald-600"
        : tone === 'final'
          ? "border-orange-200 bg-orange-50 text-orange-600"
          : "border-violet-200 bg-violet-50 text-violet-600"
    )}>
      {text}
    </div>
  );

  const refreshPayment = async (kind: 'main' | 'final') => {
    const isFinal = kind === 'final';
    const amount = isFinal ? finalAmount : (Number(order.paymentAmount) || initialAmount);
    if (isFinal) {
      setRefreshingFinal(true);
      setFinalError('');
    } else {
      setRefreshingMain(true);
      setError('');
    }
    try {
      const query = new URLSearchParams({
        orderId: isFinal ? `${order.orderId}-final` : order.orderId,
        kind,
      });
      if (amount > 0) query.set('amount', String(amount));
      const res = await fetch(`/api/tochka/find-payment?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Оплата в Точке не найдена');
      if (isFinal) {
        updateOrderData(order.orderId, 'finalPaymentStatus', data.paymentStatus || 'found');
        updateOrderData(order.orderId, 'finalPaymentAmount', data.paymentAmount || amount);
        if (data.paymentId) updateOrderData(order.orderId, 'finalPaymentId', data.paymentId);
        if (data.paymentPaidAt) updateOrderData(order.orderId, 'finalPaymentPaidAt', data.paymentPaidAt);
      } else {
        updateOrderData(order.orderId, 'paymentStatus', data.paymentStatus || 'found');
        updateOrderData(order.orderId, 'paymentAmount', data.paymentAmount || amount);
        if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
        if (data.paymentPaidAt) updateOrderData(order.orderId, 'paymentPaidAt', data.paymentPaidAt);
      }
    } catch (e: any) {
      if (isFinal) setFinalError(e.message || 'Оплата в Точке не найдена');
      else setError(e.message || 'Оплата в Точке не найдена');
    } finally {
      setRefreshingFinal(false);
      setRefreshingMain(false);
    }
  };

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
        updateOrderData(order.orderId, 'paymentAmount', amount);
        if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
      }
    } catch (e: any) {
      setError(e.message || 'Не удалось создать счёт');
    }
    finally { setLoading(false); }
  };

  const handleCreateFinal = async () => {
    setFinalLoading(true);
    setFinalError('');
    try {
      if (finalAmount <= 0) throw new Error('Сумма доплаты 0 ₽');
      const res = await fetch('/api/tochka/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: `${order.orderId}-final`,
          amount: finalAmount,
          description: `Доплата заказа #${order.orderId} ${order.item || ''}`,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось создать счёт на доплату');
      if (data.paymentUrl) {
        setFinalPaymentUrl(data.paymentUrl);
        updateOrderData(order.orderId, 'finalPaymentUrl', data.paymentUrl);
        updateOrderData(order.orderId, 'finalPaymentAmount', finalAmount);
        updateOrderData(order.orderId, 'finalPaymentStatus', 'pending');
        if (data.paymentId) updateOrderData(order.orderId, 'finalPaymentId', data.paymentId);
      }
    } catch (e: any) {
      setFinalError(e.message || 'Не удалось создать счёт на доплату');
    }
    finally { setFinalLoading(false); }
  };

  useEffect(() => {
    setPaymentUrl(order.paymentUrl || null);
  }, [order.paymentUrl]);

  useEffect(() => {
    setFinalPaymentUrl(order.finalPaymentUrl || null);
  }, [order.finalPaymentUrl]);

  if (!paymentUrl && !mainPaymentPaid) {
    return (
      <div className="mt-1.5 space-y-1.5">
        {paymentStatusBadge(mainPaymentStatusText, false, 'main')}
        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full text-[8px] font-black py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {loading ? <RefreshCcw size={8} className="animate-spin" /> : <QrCodeIcon size={8} />}
          {loading ? 'Создаём...' : 'Создать счёт'}
        </button>
        <button
          onClick={() => refreshPayment('main')}
          disabled={refreshingMain}
          className="w-full text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
        >
          <RefreshCcw size={8} className={refreshingMain ? 'animate-spin' : ''} />
          Проверить оплату
        </button>
        {error && <p className="mt-1 text-[8px] font-bold text-red-500">{error}</p>}
        {showFinalPayment && (
          <p className="text-[8px] font-bold text-zinc-400">Доплата появится после создания основного счёта</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      {paymentStatusBadge(mainPaymentStatusText, mainPaymentPaid, 'main')}
      <button
        onClick={() => refreshPayment('main')}
        disabled={refreshingMain}
        className="w-full text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
      >
        <RefreshCcw size={8} className={refreshingMain ? 'animate-spin' : ''} />
        Проверить оплату
      </button>
      {paymentUrl && (
        <>
          <button
            onClick={() => shareOrder(shareText, targetPaymentUrl).catch(() => navigator.clipboard.writeText(shareText))}
            className="w-full text-[8px] font-black py-1.5 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all flex items-center justify-center gap-1"
          >
            <Send size={8} /> Поделиться
          </button>
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
        </>
      )}
      {showFinalPayment && (
        <div className="border-t border-zinc-100 pt-1.5">
          {paymentStatusBadge(finalPaymentStatusText, finalPaymentPaid, 'final')}
          <button
            onClick={() => refreshPayment('final')}
            disabled={refreshingFinal}
            className="mt-1 w-full text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <RefreshCcw size={8} className={refreshingFinal ? 'animate-spin' : ''} />
            Проверить доплату
          </button>
          {finalPaymentUrl ? (
            <div className="mt-1 space-y-1">
              <button
                onClick={() => shareOrder(finalShareText, finalPaymentUrl).catch(() => navigator.clipboard.writeText(finalShareText))}
                className="w-full text-[8px] font-black py-1.5 rounded-md border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all flex items-center justify-center gap-1"
              >
                <Send size={8} /> Доплата {formatCurrency(finalAmount)}
              </button>
              <button
                onClick={() => setShowFinalQr(v => !v)}
                className="w-full text-[8px] font-black py-1 rounded-md border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 transition-all flex items-center justify-center gap-1"
              >
                <QrCodeIcon size={8} /> {showFinalQr ? 'Скрыть QR доплаты' : 'QR доплаты'}
              </button>
              {showFinalQr && (
                <div className="space-y-1">
                  <div ref={finalQrRef} className="flex justify-center p-2 bg-white border border-zinc-100 rounded-lg">
                    <QRCodeSVG value={finalPaymentUrl} size={100} />
                  </div>
                  <button
                    onClick={() => shareQrImage(finalQrRef.current?.querySelector('svg') || null, `${order.orderId}-final`, finalShareText).catch(() => navigator.clipboard.writeText(finalShareText))}
                    className="w-full text-[8px] font-black py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-all"
                  >
                    Отправить QR доплаты
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={handleCreateFinal}
              disabled={finalLoading}
              className="w-full text-[8px] font-black py-1 rounded-md border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {finalLoading ? <RefreshCcw size={8} className="animate-spin" /> : <QrCodeIcon size={8} />}
              {finalLoading ? 'Создаём...' : `Создать доплату ${formatCurrency(finalAmount)}`}
            </button>
          )}
          {finalError && <p className="mt-1 text-[8px] font-bold text-red-500">{finalError}</p>}
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
  const orderItems = getOrderItems(order);
  const product = getProductForOrder(productCatalog, orderItems[0] || order.item);
  const saved = order.cdekPayload || {};
  const initialDeliveryType = String(saved.deliveryType || '').trim()
    || (String(order.deliveryMethod || '').toLowerCase().includes('курьер') ? 'door' : 'pvz');
  const [deliveryType, setDeliveryType] = useState(initialDeliveryType);
  const [cityQuery, setCityQuery] = useState(String(saved.toCity || order.clientCity || ''));
  const [toCityCode, setToCityCode] = useState(String(saved.toCityCode || ''));
  const [deliveryPoint, setDeliveryPoint] = useState(String(saved.deliveryPoint || ''));
  const [deliveryPointQuery, setDeliveryPointQuery] = useState(String(saved.deliveryPoint || ''));
  const [pointsRequested, setPointsRequested] = useState(false);
  const [showDeliveryPoints, setShowDeliveryPoints] = useState(false);
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
  const [refreshingNumber, setRefreshingNumber] = useState(false);
  const [error, setError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [settingsChecked, setSettingsChecked] = useState(false);

  useEffect(() => {
    const loadStatus = () => {
      if (cdekStatusCache) return Promise.resolve(cdekStatusCache);
      if (!cdekStatusPromise) {
        cdekStatusPromise = fetch('/api/cdek/status')
          .then(r => r.json())
          .then(data => {
            cdekStatusCache = data;
            return data;
          })
          .catch(() => {
            cdekStatusCache = { configured: false, error: 'Не удалось проверить настройки СДЭК' };
            return cdekStatusCache;
          });
      }
      return cdekStatusPromise;
    };

    loadStatus()
      .then(data => {
        if (!data.configured) {
          setError(data.error || 'СДЭК API не настроен: нужны Account и Secure password в разделе СДЭК');
        }
      })
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
      const cacheKey = q.toLowerCase();
      const cachedCities = cdekCitiesCache.get(cacheKey);
      if (cachedCities) {
        setCities(cachedCities.slice(0, 6));
        return;
      }
      setLoadingCities(true);
      setError('');
      try {
        const res = await fetch(`/api/cdek/cities?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(data, 'СДЭК не вернул города'));
        const nextCities = Array.isArray(data) ? data.slice(0, 8) : [];
        cdekCitiesCache.set(cacheKey, nextCities);
        setCities(nextCities.slice(0, 6));
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
    const shouldLoadPoints = pointsRequested || deliveryPointQuery.trim().length >= 2 || Boolean(deliveryPoint);
    if (!toCityCode || deliveryType !== 'pvz' || !shouldLoadPoints) {
      setPoints([]);
      return;
    }
    const cachedPoints = cdekPointsCache.get(String(toCityCode));
    if (cachedPoints) {
      setPoints(cachedPoints);
      return;
    }
    const controller = new AbortController();
    const loadPoints = async () => {
      setLoadingPoints(true);
      setError('');
      try {
        const res = await fetch(`/api/cdek/deliverypoints?city_code=${encodeURIComponent(toCityCode)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(getApiErrorMessage(data, 'СДЭК не вернул ПВЗ'));
        const nextPoints = Array.isArray(data) ? data.slice(0, 120) : [];
        cdekPointsCache.set(String(toCityCode), nextPoints);
        setPoints(nextPoints);
        if (Array.isArray(data) && data.length === 0) setError('В этом городе СДЭК не вернул ПВЗ');
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setPoints([]);
        setError(e.message || 'Ошибка загрузки ПВЗ СДЭК');
      } finally {
        setLoadingPoints(false);
      }
    };
    loadPoints();
    return () => controller.abort();
  }, [toCityCode, deliveryType, pointsRequested, deliveryPointQuery, deliveryPoint]);

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
    setDeliveryPointQuery('');
    setPointsRequested(false);
    setCities([]);
  };

  const getPointLabel = (point: CdekDeliveryPoint) => {
    const address = point.address || point.location?.address || point.code;
    return `${point.name || point.code} · ${address}`;
  };

  const selectedPointLabel = useMemo(() => {
    const point = points.find(item => item.code === deliveryPoint);
    return point ? getPointLabel(point) : deliveryPointQuery;
  }, [points, deliveryPoint, deliveryPointQuery]);

  const filteredPoints = useMemo(() => {
    const query = deliveryPointQuery.trim().toLowerCase();
    if (!query) return points.slice(0, 20);
    return points
      .filter(point => getPointLabel(point).toLowerCase().includes(query))
      .slice(0, 20);
  }, [points, deliveryPointQuery]);

  const selectDeliveryPoint = (point: CdekDeliveryPoint) => {
    setDeliveryPoint(point.code);
    setDeliveryPointQuery(getPointLabel(point));
    setShowDeliveryPoints(false);
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
        itemName: joinOrderItems(orderItems) || `Заказ ${order.orderId}`,
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
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'СДЭК не принял заказ'));

      if (data.cdekUuid) updateOrderData(order.orderId, 'cdekUuid', data.cdekUuid);
      if (data.cdekNumber) updateOrderData(order.orderId, 'cdekNumber', data.cdekNumber);
      updateOrderData(order.orderId, 'cdekStatus', 'created');
      setStatusText(data.cdekNumber ? `Накладная: ${data.cdekNumber}` : `Создан. ID: ${shortCdekId(data.cdekUuid || '')}`);
    } catch (e: any) {
      setError(e.message || 'Не удалось создать СДЭК');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshCdekNumber = async () => {
    const uuid = order.cdekUuid;
    if (!uuid) return;
    setRefreshingNumber(true);
    setError('');
    try {
      const res = await fetch(`/api/cdek/order/${encodeURIComponent(uuid)}?orderId=${encodeURIComponent(order.orderId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Не удалось обновить номер СДЭК'));
      if (data.cdekNumber) {
        updateOrderData(order.orderId, 'cdekNumber', data.cdekNumber);
        setStatusText(`Накладная: ${data.cdekNumber}`);
      } else {
        setStatusText(`ID СДЭК: ${shortCdekId(uuid)}`);
      }
    } catch (e: any) {
      setError(e.message || 'Не удалось обновить номер СДЭК');
    } finally {
      setRefreshingNumber(false);
    }
  };

  const inputClass = mobile
    ? 'w-full min-w-0 min-h-[38px] rounded-lg border border-zinc-100 bg-white px-2.5 py-2 text-[12px] font-bold text-zinc-700 outline-none focus:border-blue-200'
    : 'w-full h-10 rounded-lg border border-zinc-100 bg-white px-3 text-[13px] font-bold text-zinc-700 outline-none focus:border-blue-200';

  return (
    <div className={cn(
      mobile
        ? 'rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 space-y-3'
        : 'w-full rounded-xl border border-zinc-100 bg-zinc-50/70 p-3 space-y-3'
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className={cn(mobile ? 'w-4 h-4' : 'w-3.5 h-3.5', 'text-zinc-500')} />
          <p className={cn(mobile ? 'text-[13px]' : 'text-[11px]', 'font-black uppercase tracking-widest text-zinc-500')}>СДЭК</p>
        </div>
        {(order.cdekNumber || order.cdekUuid || statusText) && (
          <span className="text-[10px] font-black uppercase text-emerald-600 text-right">
            {order.cdekNumber ? `№ ${order.cdekNumber}` : statusText || `ID ${shortCdekId(order.cdekUuid || '')}`}
          </span>
        )}
      </div>

      <div className={cn(
        'grid gap-2 items-end',
        mobile ? 'grid-cols-2' : 'grid-cols-[130px_160px_minmax(190px,1fr)_minmax(240px,1.2fr)]'
      )}>
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
        <div className={cn('relative', mobile && 'col-span-2')}>
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
              {loadingCities && <div className="px-3 py-2 text-[12px] font-bold text-zinc-400">Ищу город...</div>}
              {cities.map(city => (
                <button
                  key={city.code}
                  type="button"
                  onClick={() => selectCity(city)}
                  className="w-full text-left px-3 py-2 text-[13px] font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  {city.city}{city.region ? `, ${city.region}` : ''} <span className="text-zinc-300">#{city.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {deliveryType === 'pvz' ? (
          toCityCode ? (
            <div className={cn('relative', mobile && 'col-span-2')}>
              <input
                value={selectedPointLabel}
                onChange={e => {
                  setDeliveryPoint('');
                  setDeliveryPointQuery(e.target.value);
                  setPointsRequested(true);
                  setShowDeliveryPoints(true);
                }}
                onFocus={() => {
                  setPointsRequested(true);
                  setShowDeliveryPoints(true);
                }}
                onBlur={() => window.setTimeout(() => setShowDeliveryPoints(false), 150)}
                disabled={loadingPoints}
                placeholder={loadingPoints ? 'Загружаю ПВЗ...' : 'ПВЗ или улица'}
                className={inputClass}
              />
              {showDeliveryPoints && !loadingPoints && (
                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-100 bg-white shadow-xl">
                  {filteredPoints.length > 0 ? (
                    filteredPoints.map(point => (
                      <button
                        key={point.code}
                        type="button"
                        onMouseDown={() => selectDeliveryPoint(point)}
                        className={cn(
                          'w-full px-3 py-2 text-left text-[13px] font-bold text-zinc-700 hover:bg-zinc-50',
                          deliveryPoint === point.code && 'bg-blue-50 text-blue-700'
                        )}
                      >
                        {getPointLabel(point)}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-[13px] font-bold text-zinc-400">ПВЗ не найден</div>
                  )}
                </div>
              )}
            </div>
          ) : <div className={cn(!mobile && 'hidden')} />
        ) : (
        <input value={toAddress} onChange={e => setToAddress(e.target.value)} placeholder="Адрес доставки" className={cn(inputClass, mobile && 'col-span-2')} />
        )}
      </div>

      <div className={cn('grid gap-2 items-end', mobile ? 'grid-cols-2' : 'grid-cols-[92px_92px_92px_92px_minmax(190px,1fr)]')}>
        {[
          { label: 'Вес, г', value: weight, setValue: setWeight, placeholder: '700' },
          { label: 'Длина, см', value: length, setValue: setLength, placeholder: '30' },
          { label: 'Ширина, см', value: width, setValue: setWidth, placeholder: '20' },
          { label: 'Высота, см', value: height, setValue: setHeight, placeholder: '10' },
        ].map(field => (
          <label key={field.label} className="space-y-1">
            <span className="block px-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">{field.label}</span>
            <input
              value={field.value}
              onChange={e => field.setValue(e.target.value)}
              placeholder={field.placeholder}
              className={cn(inputClass, mobile ? 'min-h-[42px]' : 'h-11')}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={createCdekOrder}
          disabled={submitting || !settingsChecked}
          className={cn(
            'rounded-lg border border-zinc-200 bg-zinc-900 font-black uppercase tracking-widest text-white hover:bg-black transition-all flex items-center justify-center gap-1.5 disabled:opacity-60',
            mobile ? 'col-span-2 min-h-[44px] py-2.5 text-[11px]' : 'h-11 text-[11px]'
          )}
        >
          {submitting ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {submitting ? 'Создаю...' : 'Создать накладную'}
        </button>
      </div>
      {order.cdekUuid && !order.cdekNumber && (
        <button
          type="button"
          onClick={refreshCdekNumber}
          disabled={refreshingNumber}
          className={cn(
            'w-full rounded-lg border border-emerald-100 bg-emerald-50 font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-60',
            mobile ? 'py-2.5 text-[11px]' : 'py-1.5 text-[11px]'
          )}
        >
          {refreshingNumber ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Обновить номер СДЭК
        </button>
      )}
      {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}
      {statusText && <p className="text-[11px] font-bold text-emerald-600">{statusText}</p>}
      {order.cdekUuid && !order.cdekNumber && (
        <p className="text-[11px] font-bold text-zinc-400">ID СДЭК: {shortCdekId(order.cdekUuid)}</p>
      )}
    </div>
  );
};

const OrderSummaryRow = React.memo(({
  order,
  expanded,
  selected,
  onToggle,
  onSelectChange,
}: {
  order: OrderData;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelectChange: (checked: boolean) => void;
}) => {
  const orderItems = getOrderItems(order);
  const orderItemPrices = getOrderItemPrices(order);
  const orderItemColors = getOrderItemColors(order);
  const orderItemSizes = getOrderItemSizes(order);
  const orderItemHeights = getOrderItemHeights(order);
  const paidAmount = Number(order.paidAmount) || 0;
  const deliveryAmount = Number(order.deliveryPrice) || 0;
  const deadlineDate = addBusinessDays(order.date, 7);
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const invoiceTone = paidAmount <= 0
    ? 'text-zinc-300'
    : invoiceType === 'full'
      ? 'text-emerald-600'
      : 'text-orange-500';
  const invoiceLabel = invoiceType === 'full'
    ? 'оплата'
    : invoiceType === 'fitting'
      ? 'примерка'
      : 'предоплата';
  const statusTone =
    order.status?.toLowerCase().includes('оплачен') ? 'text-emerald-700' :
    order.status?.toLowerCase().includes('отгружен') || order.status?.toLowerCase().includes('доставлен') ? 'text-blue-700' :
    order.status?.toLowerCase().includes('возврат') || order.status?.toLowerCase().includes('отмена') ? 'text-red-600' :
    'text-zinc-500';
  const displayOrderId = String(order.orderId || '').replace(/^#+/, '');

  return (
    <tr className={cn(
      "group border-b border-zinc-100 bg-white transition-colors hover:bg-zinc-50/60",
      expanded && "bg-zinc-50/70",
      selected && "bg-blue-50/30",
      order.isOverdue && !order.isShipped && "bg-red-50/20"
    )}>
      <td className="px-4 py-5 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectChange(event.target.checked)}
          onClick={(event) => event.stopPropagation()}
          className="h-4 w-4 rounded border-zinc-300 text-zinc-900 accent-zinc-900"
          title="Выбрать для печати"
        />
      </td>
      <td className="px-5 py-5 align-top">
        <p className="text-[12px] font-semibold text-zinc-400 tabular-nums">{order.date.toLocaleDateString('ru-RU')}</p>
        <p className="mt-2 text-[13px] font-black text-zinc-950">#{displayOrderId}</p>
      </td>
      <td className="px-5 py-5 align-top">
        <p className="max-w-[210px] truncate text-[13px] font-bold text-zinc-950">{order.clientName || '—'}</p>
        <p className="mt-2 text-[12px] font-semibold text-zinc-400">{order.clientPhone ? `+${order.clientPhone}` : '—'}</p>
      </td>
      <td className="px-5 py-5 align-top">
        <p className={cn("text-[11px] font-black uppercase tracking-widest", statusTone)}>{order.status || '—'}</p>
        <p className="mt-2 max-w-[160px] truncate text-[12px] font-semibold text-zinc-500">{order.deliveryMethod || '—'}</p>
        {order.manager && (
          <p className="mt-2 max-w-[170px] truncate text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400" title={order.manager}>
            менеджер <span className="normal-case tracking-normal text-zinc-500">{order.manager}</span>
          </p>
        )}
      </td>
      <td className="px-5 py-5 align-top">
        <p className="text-[13px] font-black text-zinc-950 tabular-nums">{formatCurrency(order.revenue || 0)}</p>
        <p className="mt-1.5 text-[11px] font-bold text-zinc-400 tabular-nums">
          доставка {formatCurrency(deliveryAmount)}
        </p>
        <p className={cn("mt-1.5 text-[12px] font-black tabular-nums", invoiceTone)}>
          {invoiceLabel} {formatCurrency(paidAmount)}
        </p>
      </td>
      <td className="px-5 py-5 align-top">
        <div className="max-w-[360px] space-y-1.5">
          {(orderItems.length ? orderItems : ['—']).map((item, index) => (
            <div key={`${item}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-zinc-950" title={item}>{item}</p>
                {(orderItemColors[index] || orderItemSizes[index] || orderItemHeights[index]) && (
                  <p
                    className="mt-0.5 truncate text-[10px] font-semibold text-zinc-400"
                    title={[orderItemColors[index], orderItemSizes[index], orderItemHeights[index]].filter(Boolean).join(' / ')}
                  >
                    {[orderItemColors[index], orderItemSizes[index], orderItemHeights[index]].filter(Boolean).join(' / ')}
                  </p>
                )}
              </div>
              <p className="whitespace-nowrap text-[12px] font-semibold text-zinc-400 tabular-nums">
                {formatCurrency(orderItemPrices[index] || (orderItems.length === 1 ? order.revenue : 0))} × 1
              </p>
            </div>
          ))}
        </div>
      </td>
      <td className="px-5 py-5 align-top">
        <p className="text-[11px] font-semibold text-zinc-300 tabular-nums">
          старт {order.date.toLocaleDateString('ru-RU')}
        </p>
        <p className={cn(
          "mt-2 text-[12px] font-bold tabular-nums",
          order.isOverdue && !order.isShipped ? "text-red-500" : "text-zinc-400"
        )}>
          до {deadlineDate.toLocaleDateString('ru-RU')}
        </p>
      </td>
      <td className="px-5 py-4 align-middle text-right">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-grid h-9 w-9 place-items-center rounded-full border transition-all",
            expanded
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-900 hover:text-zinc-950"
          )}
          title={expanded ? "Свернуть заказ" : "Раскрыть заказ"}
        >
          {expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </td>
    </tr>
  );
});

const OrderRow = React.memo(({
  order,
  updateOrderData,
  onDelete,
  handbookStatuses,
  handbookSources,
  handbookDeliveries,
  handbookSizes,
  handbookColors,
  handbookHeights,
  handbookLabels,
  handbookPaymentTypes,
  handbookManagers,
  handbookBloggers,
  productCatalog,
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
  handbookStatuses: string[];
  handbookSources: string[];
  handbookDeliveries: string[];
  handbookSizes: string[];
  handbookColors: string[];
  handbookHeights: string[];
  handbookLabels: string[];
  handbookPaymentTypes: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
  productCatalog: ProductCatalogItem[];
}) => {
  const statusColor =
    order.status?.toLowerCase().includes('оплачен') ? 'text-emerald-700 bg-emerald-50 border-emerald-100' :
    order.status?.toLowerCase().includes('отгружен') || order.status?.toLowerCase().includes('доставлен') ? 'text-blue-700 bg-blue-50 border-blue-100' :
    order.status?.toLowerCase().includes('возврат') || order.status?.toLowerCase().includes('отмена') ? 'text-red-600 bg-red-50 border-red-100' :
    'text-zinc-500 bg-zinc-50 border-zinc-100';
  const orderItems = getOrderItems(order);
  const orderItemPrices = getOrderItemPrices(order);
  const orderItemColors = getOrderItemColors(order);
  const orderItemSizes = getOrderItemSizes(order);
  const orderItemHeights = getOrderItemHeights(order);
  const [editItems, setEditItems] = useState<string[]>(orderItems.length ? orderItems : ['']);
  const [editItemPrices, setEditItemPrices] = useState<number[]>(orderItemPrices.length ? orderItemPrices : [0]);
  const [editItemColors, setEditItemColors] = useState<string[]>(orderItemColors.length ? orderItemColors : ['']);
  const [editItemSizes, setEditItemSizes] = useState<string[]>(orderItemSizes.length ? orderItemSizes : ['']);
  const [editItemHeights, setEditItemHeights] = useState<string[]>(orderItemHeights.length ? orderItemHeights : ['']);
  const liveItems = editItems.map(item => item.trim()).filter(Boolean);
  const liveItemPrices = liveItems.map((_, index) => Number(editItemPrices[index]) || 0);
  const liveRevenue = getItemPricesTotal(liveItemPrices);
  const liveInvoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const liveInvoiceAmount = getInvoiceAmount({
    revenue: liveRevenue,
    deliveryPrice: order.deliveryPrice || 0,
    invoiceType: liveInvoiceType,
  });

  useEffect(() => {
    setEditItems(orderItems.length ? orderItems : ['']);
    setEditItemPrices(orderItemPrices.length ? orderItemPrices : [0]);
    setEditItemColors(orderItemColors.length ? orderItemColors : ['']);
    setEditItemSizes(orderItemSizes.length ? orderItemSizes : ['']);
    setEditItemHeights(orderItemHeights.length ? orderItemHeights : ['']);
  }, [order.item, JSON.stringify(order.items || []), JSON.stringify(order.itemPrices || []), JSON.stringify(order.itemColors || []), JSON.stringify(order.itemSizes || []), JSON.stringify(order.itemHeights || []), order.revenue]);

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

  const fieldSelect = (label: string, value: string, options: string[], onChange: (v: string) => void) => (
    <div key={label} className="flex flex-col gap-1 min-w-0">
      <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest leading-none">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full border-0 border-b border-zinc-200 bg-transparent px-0 text-[13px] font-bold text-zinc-800 outline-none transition-colors focus:border-blue-300"
      >
        <option value="">—</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );

  const saveOrderItems = (items: string[], prices = editItemPrices, colors = editItemColors, sizes = editItemSizes, heights = editItemHeights) => {
    const cleaned = items.map(item => item.trim()).filter(Boolean);
    const cleanedPrices = cleaned.map((_, index) => Number(prices[index]) || 0);
    const cleanedColors = cleaned.map((_, index) => String(colors[index] || '').trim());
    const cleanedSizes = cleaned.map((_, index) => String(sizes[index] || '').trim());
    const cleanedHeights = cleaned.map((_, index) => String(heights[index] || '').trim());
    const total = getItemPricesTotal(cleanedPrices);
    const itemText = joinOrderItems(cleaned);
    const invoiceAmount = getInvoiceAmount({
      revenue: total,
      deliveryPrice: order.deliveryPrice || 0,
      invoiceType: order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType),
    });
    updateOrderData(order.orderId, 'items', cleaned);
    updateOrderData(order.orderId, 'itemPrices', cleanedPrices);
    updateOrderData(order.orderId, 'itemColors', cleanedColors);
    updateOrderData(order.orderId, 'itemSizes', cleanedSizes);
    updateOrderData(order.orderId, 'itemHeights', cleanedHeights);
    updateOrderData(order.orderId, 'item', itemText);
    updateOrderData(order.orderId, 'revenue', total);
    updateOrderData(order.orderId, 'paidAmount', invoiceAmount);
    updateOrderData(order.orderId, `rawRow[${RAW_COLOR_INDEX}]`, cleanedColors[0] || '');
    updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, cleanedSizes[0] || '');
    updateOrderData(order.orderId, 'height', cleanedHeights[0] || '');
  };

  const applyProductCharacteristics = (value: string, index = 0) => {
    const nextItems = [...editItems];
    const nextPrices = [...editItemPrices];
    const nextColors = [...editItemColors];
    const nextSizes = [...editItemSizes];
    const nextHeights = [...editItemHeights];
    nextItems[index] = value;

    const product = productCatalog.find(p => normalizeProductName(p.name) === normalizeProductName(value));
    if (product?.sellingPrice && !nextPrices[index]) nextPrices[index] = Number(product.sellingPrice) || 0;
    if (product?.color && !nextColors[index]) nextColors[index] = product.color;
    if (product?.sizeGrid && !nextSizes[index]) nextSizes[index] = product.sizeGrid;
    if (product?.height && !nextHeights[index]) nextHeights[index] = product.height;
    setEditItems(nextItems);
    setEditItemPrices(nextPrices);
    setEditItemColors(nextColors);
    setEditItemSizes(nextSizes);
    setEditItemHeights(nextHeights);
    saveOrderItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights);
  };

  const addOrderItem = () => {
    setEditItems([...editItems, '']);
    setEditItemPrices([...editItemPrices, 0]);
    setEditItemColors([...editItemColors, '']);
    setEditItemSizes([...editItemSizes, '']);
    setEditItemHeights([...editItemHeights, '']);
  };

  const removeOrderItem = (index: number) => {
    if (editItems.length <= 1) return;
    const nextItems = editItems.filter((_, i) => i !== index);
    const nextPrices = editItemPrices.filter((_, i) => i !== index);
    const nextColors = editItemColors.filter((_, i) => i !== index);
    const nextSizes = editItemSizes.filter((_, i) => i !== index);
    const nextHeights = editItemHeights.filter((_, i) => i !== index);
    setEditItems(nextItems);
    setEditItemPrices(nextPrices);
    setEditItemColors(nextColors);
    setEditItemSizes(nextSizes);
    setEditItemHeights(nextHeights);
    saveOrderItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights);
  };

  const updateOrderItemPrice = (index: number, value: number) => {
    const nextPrices = [...editItemPrices];
    nextPrices[index] = value;
    setEditItemPrices(nextPrices);
    saveOrderItems(editItems, nextPrices, editItemColors, editItemSizes, editItemHeights);
  };

  const updateOrderItemColor = (index: number, value: string) => {
    const nextColors = [...editItemColors];
    nextColors[index] = value;
    setEditItemColors(nextColors);
    saveOrderItems(editItems, editItemPrices, nextColors, editItemSizes, editItemHeights);
  };

  const updateOrderItemSize = (index: number, value: string) => {
    const nextSizes = [...editItemSizes];
    nextSizes[index] = value;
    setEditItemSizes(nextSizes);
    saveOrderItems(editItems, editItemPrices, editItemColors, nextSizes, editItemHeights);
  };

  const updateOrderItemHeight = (index: number, value: string) => {
    const nextHeights = [...editItemHeights];
    nextHeights[index] = value;
    setEditItemHeights(nextHeights);
    saveOrderItems(editItems, editItemPrices, editItemColors, editItemSizes, nextHeights);
  };

  const updateOrderDeliveryPrice = (value: number) => {
    const invoiceAmount = getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: value,
      invoiceType: liveInvoiceType,
    });
    updateOrderData(order.orderId, 'deliveryPrice', value);
    updateOrderData(order.orderId, 'paidAmount', invoiceAmount);
  };

  const updateOrderInvoiceType = (value: string) => {
    const invoiceType = getInvoiceTypeFromPaymentType(value);
    const invoiceAmount = getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: order.deliveryPrice || 0,
      invoiceType,
    });
    updateOrderData(order.orderId, 'invoiceType', invoiceType);
    updateOrderData(order.orderId, 'paidAmount', invoiceAmount);
  };

  const dueAmount = getOrderPaymentDue({
    ...order,
    revenue: liveRevenue,
    paidAmount: liveInvoiceAmount,
  });
  const financeTile = (
    label: string,
    value: number,
    tone: 'plain' | 'paid' | 'due' | 'prepaid' = 'plain',
    onChange?: (v: number) => void
  ) => (
    <label className={cn(
      "min-w-0 border-0 bg-transparent p-0"
    )}>
      <span className={cn(
        "block truncate text-[10px] font-medium uppercase tracking-[0.14em] leading-[14px]",
        tone === 'paid' ? "text-[#2EBA7F]" :
        tone === 'prepaid' ? "text-[#F5A623]" :
        tone === 'due' ? "text-[#7D7DE6]" :
        "text-[#9CA3AF]"
      )}>{label}</span>
      {onChange ? (
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={cn(
            "mt-2 w-full border-0 border-b border-[#E6E9EF] bg-transparent px-0 pb-2 text-[18px] font-medium tabular-nums outline-none focus:border-[#7D7DE6]",
            tone === 'paid' ? "text-[#2EBA7F]" : tone === 'prepaid' ? "text-[#F5A623]" : "text-[#1F2937]"
          )}
        />
      ) : (
        <span className={cn(
          "mt-2 block truncate text-[18px] font-medium tabular-nums",
          tone === 'due' ? "text-[#2563EB]" : tone === 'paid' ? "text-[#2EBA7F]" : tone === 'prepaid' ? "text-[#F5A623]" : "text-[#1F2937]"
        )}>{formatCurrency(value)}</span>
      )}
    </label>
  );
  const displayOrderId = String(order.orderId || '').replace(/^#+/, '');

  return (
    <tr className={cn(
      "group border-b border-zinc-100 bg-white transition-colors",
      order.isOverdue && !order.isShipped && "bg-red-50/20"
    )}>
      <td colSpan={8} className="px-0 py-0">
        <div className="grid min-w-[1180px] grid-cols-[320px_minmax(860px,1fr)] items-stretch border border-[#E6E9EF] bg-white">
          <aside className="space-y-5 border-r border-[#E6E9EF] bg-white p-5">
            <div className="flex items-center justify-between gap-3 border-b border-[#E6E9EF] pb-5">
              <select
                value={order.status}
                onChange={(e) => updateOrderData(order.orderId, 'status', e.target.value)}
                className={cn(
                  "h-9 max-w-[150px] rounded-[6px] border px-3 text-[11px] font-medium uppercase tracking-[0.12em] outline-none cursor-pointer",
                  statusColor
                )}
              >
                {optionsWithCurrent(handbookStatuses, order.status, STATUS_OPTIONS).map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              {order.isFirebase && (
                <button
                  onClick={() => {
                    if (window.confirm(`Удалить заказ ${order.orderId}?`)) onDelete(order.orderId);
                  }}
                  className="inline-flex items-center gap-2 px-1 py-2 text-[11px] font-medium text-red-500 transition-colors hover:text-red-600"
                  title="Удалить заказ"
                >
                  <Trash2 size={15} /> Удалить заказ
                </button>
              )}
            </div>

            <div className="border-b border-[#E6E9EF] pb-6">
              <p className="text-[13px] font-medium text-[#6B7280]">Заказ</p>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[34px] font-medium leading-none text-[#1F2937]">#</span>
                <input
                  type="text"
                  value={displayOrderId}
                  onChange={(e) => updateOrderData(order.orderId, 'orderId', e.target.value.replace(/^#+/, '').toUpperCase())}
                  className="min-w-0 w-full bg-transparent text-[34px] font-medium leading-none tracking-tight text-[#1F2937] outline-none"
                />
              </div>
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
                className="mt-3 w-full bg-transparent text-[12px] font-medium text-[#9CA3AF] outline-none"
              />
            </div>

            <div className="space-y-4 border-b border-[#E6E9EF] pb-6">
              <div className="flex items-center gap-2">
                <Users size={17} className="text-zinc-500 shrink-0" />
                <input
                  type="text"
                  value={order.clientName || ''}
                  onChange={(e) => updateOrderData(order.orderId, 'clientName', e.target.value)}
                  placeholder="ФИО клиента"
                  className="min-w-0 flex-1 truncate bg-transparent text-[15px] font-medium text-[#1F2937] outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <Phone size={16} className="text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={order.clientPhone}
                  onChange={(e) => updateOrderData(order.orderId, 'clientPhone', e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="телефон"
                  className="min-w-0 flex-1 truncate bg-transparent text-[14px] font-medium text-[#6B7280] outline-none"
                />
                {order.clientPhone && (
                  <a
                    href={`tel:+${order.clientPhone}`}
                    className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                    title="Позвонить"
                  >
                    <Phone size={16} />
                  </a>
                )}
                <button
                  onClick={() => shareOrder(buildOrderShareText(order, order.paymentUrl || buildPaymentPageUrl(order.orderId)), order.paymentUrl || buildPaymentPageUrl(order.orderId)).catch(() => {})}
                  className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                  title="Поделиться"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>

            <PaymentRowBlock order={order} updateOrderData={updateOrderData} />

            {String(order.deliveryMethod || '').toLowerCase().includes('сдэк') && (
              <CdekOrderBlock order={order} updateOrderData={updateOrderData} productCatalog={productCatalog} mobile />
            )}
          </aside>

          <section className="min-w-0 bg-white px-6 py-6">
            <div className="border-b border-[#E6E9EF] pb-6">
              <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(420px,1fr)_minmax(360px,420px)]">
                <div className="min-w-0">
                  <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7280]">Изделие</span>
                  <div className="mt-4 rounded-[8px] border border-[#E6E9EF] bg-[#F8FAFC]/70">
                    <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(130px,0.8fr)_minmax(105px,0.65fr)_minmax(105px,0.65fr)_minmax(140px,0.75fr)_34px] gap-3 border-b border-[#E6E9EF] px-3 py-2 text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:grid">
                      <span>Наименование</span>
                      <span>Цвет</span>
                      <span>Размер</span>
                      <span>Рост</span>
                      <span className="text-right">Цена, ₽</span>
                      <span />
                    </div>
                    {editItems.map((item, index) => (
                      <div
                        key={index}
                        className="grid gap-2 border-b border-[#E6E9EF] px-3 py-3 last:border-b-0 xl:grid-cols-[minmax(220px,1.35fr)_minmax(130px,0.8fr)_minmax(105px,0.65fr)_minmax(105px,0.65fr)_minmax(140px,0.75fr)_34px] xl:items-center xl:gap-3"
                      >
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:hidden">Наименование</span>
                          <input
                            type="text"
                            list="product-list"
                            value={item}
                            onChange={(e) => applyProductCharacteristics(e.target.value, index)}
                            placeholder={index === 0 ? 'Название изделия...' : `Позиция ${index + 1}`}
                            title={item}
                            className="h-10 w-full rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-medium leading-tight text-[#1F2937] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#7D7DE6]"
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:hidden">Цвет</span>
                          <select
                            value={editItemColors[index] || ''}
                            onChange={(e) => updateOrderItemColor(index, e.target.value)}
                            className="h-10 w-full rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#6B7280] outline-none transition-colors focus:border-[#7D7DE6]"
                            title="Цвет позиции"
                          >
                            <option value="">Цвет</option>
                            {optionsWithCurrent(handbookColors, editItemColors[index] || '').map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:hidden">Размер</span>
                          <select
                            value={editItemSizes[index] || ''}
                            onChange={(e) => updateOrderItemSize(index, e.target.value)}
                            className="h-10 w-full rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#6B7280] outline-none transition-colors focus:border-[#7D7DE6]"
                            title="Размер позиции"
                          >
                            <option value="">Размер</option>
                            {optionsWithCurrent(handbookSizes, editItemSizes[index] || '').map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:hidden">Рост</span>
                          <select
                            value={editItemHeights[index] || ''}
                            onChange={(e) => updateOrderItemHeight(index, e.target.value)}
                            className="h-10 w-full rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#6B7280] outline-none transition-colors focus:border-[#7D7DE6]"
                            title="Рост позиции"
                          >
                            <option value="">Рост</option>
                            {optionsWithCurrent(handbookHeights, editItemHeights[index] || '').map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </label>
                        <label className="min-w-0">
                          <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] xl:hidden">Цена, ₽</span>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#9CA3AF]">₽</span>
                            <input
                              type="number"
                              value={editItemPrices[index] || ''}
                              onChange={(e) => updateOrderItemPrice(index, parseFloat(e.target.value) || 0)}
                              placeholder="Цена"
                              className="h-10 w-full rounded-[6px] border border-[#E6E9EF] bg-white pl-7 pr-3 text-right text-[13px] font-medium tabular-nums text-[#1F2937] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#7D7DE6]"
                            />
                          </div>
                        </label>
                        <div className="flex justify-end xl:block">
                          {editItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeOrderItem(index)}
                              className="grid h-10 w-10 place-items-center rounded-[6px] border border-red-100 bg-red-50 text-red-500 transition-colors hover:bg-red-100 xl:h-9 xl:w-9"
                              title="Удалить позицию"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOrderItem}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#6B7280] transition-colors hover:border-[#7D7DE6] hover:text-[#1F2937]"
                  >
                    <Plus className="w-4 h-4" />
                    Добавить изделие
                  </button>
                </div>
                <div className="min-w-0">
                  <div className="grid min-w-0 grid-cols-3 gap-5">
                    {financeTile('Стоимость 100%', liveRevenue)}
                    {financeTile('Доставка', order.deliveryPrice || 0, 'plain', updateOrderDeliveryPrice)}
                    {financeTile(
                      liveInvoiceType === 'fitting'
                        ? 'Примерка СДЭК'
                        : liveInvoiceType === 'full'
                          ? 'Полная оплата'
                          : 'Предоплата 50%',
                      liveInvoiceAmount,
                      liveInvoiceType === 'full' ? 'paid' : 'prepaid'
                    )}
                  </div>
                </div>
              </div>

              <div className="my-7 h-px bg-[#E6E9EF]" />

              <div className="grid grid-cols-2 gap-x-7 gap-y-7 xl:grid-cols-4">
                {fieldSelect('Размер', order.rawRow?.[RAW_SIZE_INDEX] || '', optionsWithCurrent(handbookSizes, order.rawRow?.[RAW_SIZE_INDEX] || ''), (v) => updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, v))}
                {fieldSelect('Рост', order.height || '', optionsWithCurrent(handbookHeights, order.height || ''), (v) => updateOrderData(order.orderId, 'height', v))}
                {fieldSelect('Источник', order.source || '', optionsWithCurrent(handbookSources, order.source || '', SOURCE_OPTIONS), (v) => updateOrderData(order.orderId, 'source', v))}
                {fieldSelect('Менеджер', order.manager || '', optionsWithCurrent(handbookManagers, order.manager || ''), (v) => updateOrderData(order.orderId, 'manager', v))}
                {fieldSelect('Блогер', order.blogger || '', optionsWithCurrent(handbookBloggers, order.blogger || ''), (v) => updateOrderData(order.orderId, 'blogger', v))}
                {fieldSelect('Оплата', order.paymentType || '', optionsWithCurrent(handbookPaymentTypes, order.paymentType || '', PAYMENT_TYPE_OPTIONS), (v) => updateOrderData(order.orderId, 'paymentType', v))}
                {fieldSelect('Доставка', order.deliveryMethod || '', optionsWithCurrent(handbookDeliveries, order.deliveryMethod || '', DELIVERY_OPTIONS), (v) => updateOrderData(order.orderId, 'deliveryMethod', v))}
                {fieldSelect('Метка', order.label || '', optionsWithCurrent(handbookLabels, order.label || ''), (v) => updateOrderData(order.orderId, 'label', v))}
                {fieldSelect('Тип оплаты', getInvoicePaymentLabel(liveInvoiceType), INVOICE_PAYMENT_OPTIONS, updateOrderInvoiceType)}
                {financeTile('К оплате', dueAmount, 'due')}
                <span className={cn(
                  "self-end flex items-center border-b border-[#E6E9EF] pb-2 text-[18px] font-medium",
                  order.isOverdue && !order.isShipped
                    ? "text-red-600"
                    : order.isShipped
                      ? "text-zinc-400"
                      : "text-blue-600"
                )}>
                  {addBusinessDays(order.date, 7).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                </span>
              </div>
            </div>

            <div className="pt-8">
              <div className="flex items-center justify-between border-b border-[#E6E9EF] pb-6">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7280]">Заметки</span>
                <span className="text-[10px] font-medium text-[#9CA3AF]">{String(order.notes || '').length} / 500</span>
              </div>
              <textarea
                value={order.notes || ''}
                onChange={(e) => updateOrderData(order.orderId, 'notes', e.target.value.slice(0, 500))}
                maxLength={500}
                placeholder="Добавить заметку..."
                className="mt-4 min-h-[110px] w-full resize-none border-0 bg-transparent p-0 text-[14px] font-medium text-[#6B7280] outline-none placeholder:text-[#9CA3AF]"
              />
            </div>
          </section>
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
  handbookStatuses,
  handbookSources,
  handbookDeliveries,
  handbookSizes,
  handbookColors,
  handbookHeights,
  handbookLabels,
  handbookPaymentTypes,
  handbookManagers,
  handbookBloggers,
}: {
  order: OrderData;
  updateOrderData: (id: string, field: string, value: any) => void;
  onDelete: (id: string) => void;
  productCatalog: ProductCatalogItem[];
  handbookStatuses: string[];
  handbookSources: string[];
  handbookDeliveries: string[];
  handbookSizes: string[];
  handbookColors: string[];
  handbookHeights: string[];
  handbookLabels: string[];
  handbookPaymentTypes: string[];
  handbookManagers: string[];
  handbookBloggers: string[];
}) => {
  const [expanded, setExpanded] = useState(false);
  const [mobilePaymentUrl, setMobilePaymentUrl] = useState(order.paymentUrl || '');
  const [mobileFinalPaymentUrl, setMobileFinalPaymentUrl] = useState(order.finalPaymentUrl || '');
  const [mobilePaymentLoading, setMobilePaymentLoading] = useState(false);
  const [mobileFinalPaymentLoading, setMobileFinalPaymentLoading] = useState(false);
  const [mobilePaymentRefreshing, setMobilePaymentRefreshing] = useState(false);
  const [mobileFinalPaymentRefreshing, setMobileFinalPaymentRefreshing] = useState(false);
  const [mobilePaymentError, setMobilePaymentError] = useState('');
  const [mobileFinalPaymentError, setMobileFinalPaymentError] = useState('');
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [showMobileFinalQr, setShowMobileFinalQr] = useState(false);
  const mobileQrRef = useRef<HTMLDivElement>(null);
  const mobileFinalQrRef = useRef<HTMLDivElement>(null);
  const paymentUrl = mobilePaymentUrl;
  const orderItems = getOrderItems(order);
  const orderItemPrices = getOrderItemPrices(order);
  const orderItemColors = getOrderItemColors(order);
  const orderItemSizes = getOrderItemSizes(order);
  const orderItemHeights = getOrderItemHeights(order);
  const [editItems, setEditItems] = useState<string[]>(orderItems.length ? orderItems : ['']);
  const [editItemPrices, setEditItemPrices] = useState<number[]>(orderItemPrices.length ? orderItemPrices : [0]);
  const [editItemColors, setEditItemColors] = useState<string[]>(orderItemColors.length ? orderItemColors : ['']);
  const [editItemSizes, setEditItemSizes] = useState<string[]>(orderItemSizes.length ? orderItemSizes : ['']);
  const [editItemHeights, setEditItemHeights] = useState<string[]>(orderItemHeights.length ? orderItemHeights : ['']);
  const liveItems = editItems.map(item => item.trim()).filter(Boolean);
  const liveItemPrices = liveItems.map((_, index) => Number(editItemPrices[index]) || 0);
  const liveRevenue = getItemPricesTotal(liveItemPrices);
  const deadlineDate = addBusinessDays(order.date, 7);
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const liveInvoiceAmount = getInvoiceAmount({
    revenue: liveRevenue,
    deliveryPrice: order.deliveryPrice || 0,
    invoiceType,
  });
  const dueAmount = getOrderPaymentDue({ ...order, revenue: liveRevenue, paidAmount: liveInvoiceAmount });
  const finalPaymentAmount = getOrderFinalPaymentAmount({ ...order, revenue: liveRevenue, paidAmount: liveInvoiceAmount });
  const showFinalPayment = invoiceType !== 'full' && finalPaymentAmount > 0;
  const mainPaymentPaid = isPaidTochkaStatus(order.paymentStatus || '');
  const finalPaymentPaid = isPaidTochkaStatus(order.finalPaymentStatus || '');
  const mainPaymentStatusText = mainPaymentPaid
    ? `${getShortPaymentLabel(invoiceType)} оплачена`
    : paymentUrl
      ? `${getShortPaymentLabel(invoiceType)} ожидает оплаты`
      : `${getShortPaymentLabel(invoiceType)} не создана`;
  const finalPaymentStatusText = finalPaymentPaid
    ? 'Доплата оплачена'
    : mobileFinalPaymentUrl
      ? 'Доплата ожидает оплаты'
      : 'Доплата не создана';
  const shareText = paymentUrl ? buildPaymentShareText(order, paymentUrl, liveInvoiceAmount, 'Счет на оплату') : '';
  const finalShareText = mobileFinalPaymentUrl ? buildPaymentShareText(order, mobileFinalPaymentUrl, finalPaymentAmount, 'Счет на доплату') : '';
  const invoiceTone = liveInvoiceAmount <= 0
    ? 'text-zinc-300'
    : invoiceType === 'full'
      ? 'text-emerald-600'
      : 'text-orange-500';
  const invoiceLabel = invoiceType === 'full'
    ? 'оплата'
    : invoiceType === 'fitting'
      ? 'примерка'
      : 'предоплата';
  useEffect(() => {
    setEditItems(orderItems.length ? orderItems : ['']);
    setEditItemPrices(orderItemPrices.length ? orderItemPrices : [0]);
    setEditItemColors(orderItemColors.length ? orderItemColors : ['']);
    setEditItemSizes(orderItemSizes.length ? orderItemSizes : ['']);
    setEditItemHeights(orderItemHeights.length ? orderItemHeights : ['']);
  }, [order.item, JSON.stringify(order.items || []), JSON.stringify(order.itemPrices || []), JSON.stringify(order.itemColors || []), JSON.stringify(order.itemSizes || []), JSON.stringify(order.itemHeights || []), order.revenue]);

  const saveMobileItems = (items: string[], prices = editItemPrices, colors = editItemColors, sizes = editItemSizes, heights = editItemHeights) => {
    const cleaned = items.map(item => item.trim()).filter(Boolean);
    const cleanedPrices = cleaned.map((_, index) => Number(prices[index]) || 0);
    const cleanedColors = cleaned.map((_, index) => String(colors[index] || '').trim());
    const cleanedSizes = cleaned.map((_, index) => String(sizes[index] || '').trim());
    const cleanedHeights = cleaned.map((_, index) => String(heights[index] || '').trim());
    const revenue = getItemPricesTotal(cleanedPrices);
    const invoiceAmount = getInvoiceAmount({
      revenue,
      deliveryPrice: order.deliveryPrice || 0,
      invoiceType,
    });
    updateOrderData(order.orderId, 'items', cleaned);
    updateOrderData(order.orderId, 'itemPrices', cleanedPrices);
    updateOrderData(order.orderId, 'itemColors', cleanedColors);
    updateOrderData(order.orderId, 'itemSizes', cleanedSizes);
    updateOrderData(order.orderId, 'itemHeights', cleanedHeights);
    updateOrderData(order.orderId, 'item', joinOrderItems(cleaned));
    updateOrderData(order.orderId, 'revenue', revenue);
    updateOrderData(order.orderId, 'paidAmount', invoiceAmount);
    updateOrderData(order.orderId, `rawRow[${RAW_COLOR_INDEX}]`, cleanedColors[0] || '');
    updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, cleanedSizes[0] || '');
    updateOrderData(order.orderId, 'height', cleanedHeights[0] || '');
  };

  const applyMobileProduct = (value: string, index = 0) => {
    const nextItems = [...editItems];
    const nextPrices = [...editItemPrices];
    const nextColors = [...editItemColors];
    const nextSizes = [...editItemSizes];
    const nextHeights = [...editItemHeights];
    nextItems[index] = value;
    const product = productCatalog.find(p => normalizeProductName(p.name) === normalizeProductName(value));
    if (product?.sellingPrice && !nextPrices[index]) nextPrices[index] = Number(product.sellingPrice) || 0;
    if (product?.color && !nextColors[index]) nextColors[index] = product.color;
    if (product?.sizeGrid && !nextSizes[index]) nextSizes[index] = product.sizeGrid;
    if (product?.height && !nextHeights[index]) nextHeights[index] = product.height;
    setEditItems(nextItems);
    setEditItemPrices(nextPrices);
    setEditItemColors(nextColors);
    setEditItemSizes(nextSizes);
    setEditItemHeights(nextHeights);
    saveMobileItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights);
  };

  const updateMobileItemPrice = (index: number, value: number) => {
    const nextPrices = [...editItemPrices];
    nextPrices[index] = value;
    setEditItemPrices(nextPrices);
    saveMobileItems(editItems, nextPrices, editItemColors, editItemSizes, editItemHeights);
  };

  const updateMobileItemColor = (index: number, value: string) => {
    const nextColors = [...editItemColors];
    nextColors[index] = value;
    setEditItemColors(nextColors);
    saveMobileItems(editItems, editItemPrices, nextColors, editItemSizes, editItemHeights);
  };

  const updateMobileItemSize = (index: number, value: string) => {
    const nextSizes = [...editItemSizes];
    nextSizes[index] = value;
    setEditItemSizes(nextSizes);
    saveMobileItems(editItems, editItemPrices, editItemColors, nextSizes, editItemHeights);
  };

  const updateMobileItemHeight = (index: number, value: string) => {
    const nextHeights = [...editItemHeights];
    nextHeights[index] = value;
    setEditItemHeights(nextHeights);
    saveMobileItems(editItems, editItemPrices, editItemColors, editItemSizes, nextHeights);
  };

  const addMobileItem = () => {
    setEditItems([...editItems, '']);
    setEditItemPrices([...editItemPrices, 0]);
    setEditItemColors([...editItemColors, '']);
    setEditItemSizes([...editItemSizes, '']);
    setEditItemHeights([...editItemHeights, '']);
  };

  const removeMobileItem = (index: number) => {
    if (editItems.length <= 1) return;
    const nextItems = editItems.filter((_, i) => i !== index);
    const nextPrices = editItemPrices.filter((_, i) => i !== index);
    const nextColors = editItemColors.filter((_, i) => i !== index);
    const nextSizes = editItemSizes.filter((_, i) => i !== index);
    const nextHeights = editItemHeights.filter((_, i) => i !== index);
    setEditItems(nextItems);
    setEditItemPrices(nextPrices);
    setEditItemColors(nextColors);
    setEditItemSizes(nextSizes);
    setEditItemHeights(nextHeights);
    saveMobileItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights);
  };

  const updateMobileDeliveryPrice = (value: number) => {
    updateOrderData(order.orderId, 'deliveryPrice', value);
    updateOrderData(order.orderId, 'paidAmount', getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: value,
      invoiceType,
    }));
  };

  const updateMobileInvoiceType = (value: string) => {
    const nextInvoiceType = getInvoiceTypeFromPaymentType(value);
    updateOrderData(order.orderId, 'invoiceType', nextInvoiceType);
    updateOrderData(order.orderId, 'paidAmount', getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: order.deliveryPrice || 0,
      invoiceType: nextInvoiceType,
    }));
  };

  const mobileInputClass = "h-10 min-w-0 w-full rounded-xl border border-zinc-100 bg-white px-3 text-[12px] font-bold text-zinc-900 outline-none focus:border-blue-300";
  const mobileSelect = (label: string, value: string, options: string[], onChange: (value: string) => void) => (
    <label className="min-w-0 space-y-1">
      <span className="block text-[8px] font-black uppercase tracking-widest text-zinc-400">{label}</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn(mobileInputClass, "appearance-none truncate text-zinc-800")}
      >
        <option value="">—</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );

  useEffect(() => {
    setMobilePaymentUrl(order.paymentUrl || '');
  }, [order.paymentUrl]);

  useEffect(() => {
    setMobileFinalPaymentUrl(order.finalPaymentUrl || '');
  }, [order.finalPaymentUrl]);

  const createMobilePayment = async () => {
    setMobilePaymentLoading(true);
    setMobilePaymentError('');
    try {
      const amount = dueAmount;
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
      updateOrderData(order.orderId, 'paymentAmount', amount);
      if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
    } catch (e: any) {
      setMobilePaymentError(e.message || 'Не удалось создать счёт');
    } finally {
      setMobilePaymentLoading(false);
    }
  };

  const createMobileFinalPayment = async () => {
    setMobileFinalPaymentLoading(true);
    setMobileFinalPaymentError('');
    try {
      if (finalPaymentAmount <= 0) throw new Error('Сумма доплаты 0 ₽');

      const res = await fetch('/api/tochka/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: `${order.orderId}-final`,
          amount: finalPaymentAmount,
          description: `Доплата заказа #${order.orderId} ${order.item || ''}`,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось создать счёт на доплату');
      if (!data.paymentUrl) throw new Error('Точка не вернула ссылку оплаты');

      setMobileFinalPaymentUrl(data.paymentUrl);
      setShowMobileFinalQr(true);
      updateOrderData(order.orderId, 'finalPaymentUrl', data.paymentUrl);
      updateOrderData(order.orderId, 'finalPaymentAmount', finalPaymentAmount);
      updateOrderData(order.orderId, 'finalPaymentStatus', 'pending');
      if (data.paymentId) updateOrderData(order.orderId, 'finalPaymentId', data.paymentId);
    } catch (e: any) {
      setMobileFinalPaymentError(e.message || 'Не удалось создать счёт на доплату');
    } finally {
      setMobileFinalPaymentLoading(false);
    }
  };

  const refreshMobilePayment = async (kind: 'main' | 'final') => {
    const isFinal = kind === 'final';
    const amount = isFinal ? finalPaymentAmount : (Number(order.paymentAmount) || dueAmount);
    if (isFinal) {
      setMobileFinalPaymentRefreshing(true);
      setMobileFinalPaymentError('');
    } else {
      setMobilePaymentRefreshing(true);
      setMobilePaymentError('');
    }
    try {
      const query = new URLSearchParams({
        orderId: isFinal ? `${order.orderId}-final` : order.orderId,
        kind,
      });
      if (amount > 0) query.set('amount', String(amount));
      const res = await fetch(`/api/tochka/find-payment?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Оплата в Точке не найдена');
      if (isFinal) {
        updateOrderData(order.orderId, 'finalPaymentStatus', data.paymentStatus || 'found');
        updateOrderData(order.orderId, 'finalPaymentAmount', data.paymentAmount || amount);
        if (data.paymentId) updateOrderData(order.orderId, 'finalPaymentId', data.paymentId);
        if (data.paymentPaidAt) updateOrderData(order.orderId, 'finalPaymentPaidAt', data.paymentPaidAt);
      } else {
        updateOrderData(order.orderId, 'paymentStatus', data.paymentStatus || 'found');
        updateOrderData(order.orderId, 'paymentAmount', data.paymentAmount || amount);
        if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
        if (data.paymentPaidAt) updateOrderData(order.orderId, 'paymentPaidAt', data.paymentPaidAt);
      }
    } catch (e: any) {
      if (isFinal) setMobileFinalPaymentError(e.message || 'Оплата в Точке не найдена');
      else setMobilePaymentError(e.message || 'Оплата в Точке не найдена');
    } finally {
      setMobilePaymentRefreshing(false);
      setMobileFinalPaymentRefreshing(false);
    }
  };

  return (
    <div className={cn(
      "p-4 flex flex-col gap-3 transition-colors",
      order.isOverdue && !order.isShipped ? "bg-red-50/30" : "bg-white"
    )}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="grid grid-cols-[minmax(0,1fr)_34px] gap-3 text-left"
      >
        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-zinc-400">{order.date.toLocaleDateString('ru-RU')}</p>
              <p className="mt-1 text-[14px] font-black text-zinc-950">#{order.orderId}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="truncate text-[12px] font-black text-zinc-950">{order.clientName || '—'}</p>
              <p className="mt-1 text-[11px] font-semibold text-zinc-400">{order.clientPhone ? `+${order.clientPhone}` : '—'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">{order.status || '—'}</p>
              <p className="mt-1 truncate text-[11px] font-semibold text-zinc-500">{order.deliveryMethod || '—'}</p>
              {order.manager && (
                <p className="mt-1 truncate text-[10px] font-bold text-zinc-400">менеджер: {order.manager}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[12px] font-black text-zinc-950">{formatCurrency(order.revenue || 0)}</p>
              <p className="mt-1 text-[10px] font-bold text-zinc-400">доставка {formatCurrency(order.deliveryPrice || 0)}</p>
              <p className={cn("mt-1 text-[11px] font-black", invoiceTone)}>{invoiceLabel} {formatCurrency(liveInvoiceAmount)}</p>
            </div>
          </div>
          <div className="space-y-1">
            {(orderItems.length ? orderItems : ['—']).map((item, index) => (
              <div key={`${item}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-bold text-zinc-950">{item}</p>
                  {(orderItemColors[index] || orderItemSizes[index] || orderItemHeights[index]) && (
                    <p className="truncate text-[9px] font-semibold text-zinc-400">
                      {[orderItemColors[index], orderItemSizes[index], orderItemHeights[index]].filter(Boolean).join(' / ')}
                    </p>
                  )}
                </div>
                <p className="text-[11px] font-semibold text-zinc-400">
                  {formatCurrency(orderItemPrices[index] || (orderItems.length === 1 ? order.revenue : 0))} × 1
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-zinc-400">старт {order.date.toLocaleDateString('ru-RU')}</p>
            <p className={cn("text-[10px] font-black", order.isOverdue && !order.isShipped ? "text-red-500" : "text-zinc-500")}>
              до {deadlineDate.toLocaleDateString('ru-RU')}
            </p>
          </div>
        </div>
        <span className={cn(
          "grid h-9 w-9 place-items-center rounded-full border self-center justify-self-end transition-colors",
          expanded ? "border-zinc-900 bg-zinc-900 text-white" : "border-blue-500 bg-white text-blue-600"
        )}>
          {expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <>
      {/* Client Info Mobile */}
      <div className="bg-zinc-50/60 p-3 rounded-xl border border-zinc-100 space-y-2">
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
            <Users className="w-3 h-3" /> Клиент
          </span>
          <input
            value={order.clientName || ''}
            onChange={(e) => updateOrderData(order.orderId, 'clientName', e.target.value)}
            placeholder="ФИО клиента"
            className={mobileInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
            <Phone className="w-3 h-3" /> Телефон
          </span>
          <input
            value={order.clientPhone || ''}
            onChange={(e) => updateOrderData(order.orderId, 'clientPhone', e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Телефон"
            inputMode="numeric"
            className={mobileInputClass}
          />
        </label>
      </div>

      {/* Product Details Mobile */}
      <div className="rounded-xl border border-zinc-100 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Модель</span>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2">
          <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">Стоимость 100%</p>
          <p className="text-[13px] font-black text-zinc-900">{formatCurrency(liveRevenue)}</p>
        </div>
        <div className="space-y-2">
              {editItems.map((item, index) => (
                <div key={index} className="grid gap-2 rounded-xl border border-zinc-100 bg-white p-2.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                    <label className="min-w-0">
                      <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-zinc-400">Наименование</span>
                      <input
                        value={item}
                        list="product-list"
                        onChange={(e) => applyMobileProduct(e.target.value, index)}
                        placeholder={index === 0 ? 'Наименование' : `Позиция ${index + 1}`}
                        className={cn(mobileInputClass, "text-[12px]")}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => editItems.length > 1 ? removeMobileItem(index) : addMobileItem()}
                      className={cn(
                        "mt-[17px] grid h-10 w-10 place-items-center rounded-xl border text-zinc-500",
                        editItems.length > 1 ? "border-red-100 bg-red-50 text-red-500" : "border-zinc-100 bg-zinc-50"
                      )}
                      title={editItems.length > 1 ? 'Удалить позицию' : 'Добавить позицию'}
                    >
                      {editItems.length > 1 ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                  </div>
                  <label>
                    <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-zinc-400">Цена позиции, ₽</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-zinc-300">₽</span>
                      <input
                        type="number"
                        value={editItemPrices[index] || ''}
                        onChange={(e) => updateMobileItemPrice(index, parseFloat(e.target.value) || 0)}
                        placeholder="Цена"
                        className={cn(mobileInputClass, "pl-7 text-right text-[12px] tabular-nums")}
                      />
                    </div>
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={editItemColors[index] || ''}
                      onChange={(e) => updateMobileItemColor(index, e.target.value)}
                      className={cn(mobileInputClass, "h-9 px-2 text-[10px] appearance-none")}
                      title="Цвет позиции"
                    >
                      <option value="">Цвет</option>
                      {optionsWithCurrent(handbookColors, editItemColors[index] || '').map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <select
                      value={editItemSizes[index] || ''}
                      onChange={(e) => updateMobileItemSize(index, e.target.value)}
                      className={cn(mobileInputClass, "h-9 px-2 text-[10px] appearance-none")}
                      title="Размер позиции"
                    >
                      <option value="">Размер</option>
                      {optionsWithCurrent(handbookSizes, editItemSizes[index] || '').map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <select
                      value={editItemHeights[index] || ''}
                      onChange={(e) => updateMobileItemHeight(index, e.target.value)}
                      className={cn(mobileInputClass, "h-9 px-2 text-[10px] appearance-none")}
                      title="Рост позиции"
                    >
                      <option value="">Рост</option>
                      {optionsWithCurrent(handbookHeights, editItemHeights[index] || '').map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {editItems.length > 1 && (
                <button
                  type="button"
                  onClick={addMobileItem}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-100 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-500"
                >
                  <Plus className="h-3 w-3" /> Добавить позицию
                </button>
              )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {mobileSelect('Статус', order.status || '', optionsWithCurrent(handbookStatuses, order.status, STATUS_OPTIONS), (v) => updateOrderData(order.orderId, 'status', v))}
          {mobileSelect('Размер', order.rawRow?.[RAW_SIZE_INDEX] || '', optionsWithCurrent(handbookSizes, order.rawRow?.[RAW_SIZE_INDEX] || ''), (v) => updateOrderData(order.orderId, `rawRow[${RAW_SIZE_INDEX}]`, v))}
          {mobileSelect('Рост', order.height || '', optionsWithCurrent(handbookHeights, order.height || ''), (v) => updateOrderData(order.orderId, 'height', v))}
          {mobileSelect('Источник', order.source || '', optionsWithCurrent(handbookSources, order.source || '', SOURCE_OPTIONS), (v) => updateOrderData(order.orderId, 'source', v))}
          {mobileSelect('Менеджер', order.manager || '', optionsWithCurrent(handbookManagers, order.manager || ''), (v) => updateOrderData(order.orderId, 'manager', v))}
          {mobileSelect('Оплата', order.paymentType || '', optionsWithCurrent(handbookPaymentTypes, order.paymentType || '', PAYMENT_TYPE_OPTIONS), (v) => updateOrderData(order.orderId, 'paymentType', v))}
          {mobileSelect('Тип оплаты', getInvoicePaymentLabel(invoiceType), INVOICE_PAYMENT_OPTIONS, updateMobileInvoiceType)}
          {mobileSelect('Доставка', order.deliveryMethod || '', optionsWithCurrent(handbookDeliveries, order.deliveryMethod || '', DELIVERY_OPTIONS), (v) => updateOrderData(order.orderId, 'deliveryMethod', v))}
          {mobileSelect('Метка', order.label || '', optionsWithCurrent(handbookLabels, order.label || ''), (v) => updateOrderData(order.orderId, 'label', v))}
          {mobileSelect('Блогер', order.blogger || '', optionsWithCurrent(handbookBloggers, order.blogger || ''), (v) => updateOrderData(order.orderId, 'blogger', v))}
        </div>
      </div>

      {/* Finance Mobile */}
      <div className="grid grid-cols-3 gap-2">
        <div className="min-w-0 rounded-xl bg-zinc-50 border border-zinc-100 p-2">
          <p className="text-[7px] font-black text-zinc-400 uppercase tracking-tight">Доставка</p>
          <input
            type="number"
            value={order.deliveryPrice || ''}
            onChange={(e) => updateMobileDeliveryPrice(parseFloat(e.target.value) || 0)}
            placeholder="0"
            className="mt-1 w-full bg-transparent text-[10px] font-black text-zinc-800 outline-none"
          />
        </div>
        <div className={cn(
          "min-w-0 rounded-xl border p-2",
          invoiceType === 'full' ? "bg-emerald-50 border-emerald-100" : "bg-orange-50 border-orange-100"
        )}>
          <p className={cn(
            "truncate text-[7px] font-black uppercase tracking-tight",
            invoiceType === 'full' ? "text-emerald-500" : "text-orange-500"
          )}>{invoiceLabel}</p>
          <p className={cn("truncate text-[10px] font-black", invoiceTone)}>{formatCurrency(liveInvoiceAmount)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-blue-50 border border-blue-100 p-2">
          <p className="text-[7px] font-black text-blue-500 uppercase tracking-tight">К оплате</p>
          <p className="truncate text-[10px] font-black text-blue-700">{formatCurrency(dueAmount)}</p>
        </div>
      </div>

      {/* Payment Mobile */}
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-[8px] font-black text-violet-500 uppercase tracking-widest">СБП оплата</p>
            <p className={cn("text-[8px] font-bold", mainPaymentPaid ? "text-emerald-600" : "text-zinc-400")}>{mainPaymentStatusText}</p>
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
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => refreshMobilePayment('main')}
                disabled={mobilePaymentRefreshing}
                className="py-2 rounded-lg bg-white border border-violet-100 text-[8px] font-black text-violet-600 uppercase flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <RefreshCcw size={10} className={mobilePaymentRefreshing ? 'animate-spin' : ''} />
                Проверить
              </button>
              <button
                onClick={() => shareOrder(shareText, paymentUrl).catch(() => navigator.clipboard.writeText(shareText))}
                className="py-2 rounded-lg bg-violet-600 border border-violet-600 text-[8px] font-black text-white uppercase flex items-center justify-center gap-1.5"
              >
                <Send size={10} /> Поделиться
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
        {showFinalPayment && (
          <div className="space-y-2 border-t border-violet-100 pt-2">
            <div className={cn(
              "flex items-center justify-between rounded-lg border px-2.5 py-2",
              finalPaymentPaid ? "border-emerald-200 bg-emerald-50" : "border-orange-200 bg-orange-50"
            )}>
              <div className="min-w-0">
                <p className={cn(
                  "truncate text-[8px] font-black uppercase tracking-wider",
                  finalPaymentPaid ? "text-emerald-600" : "text-orange-600"
                )}>
                  {finalPaymentStatusText}
                </p>
                <p className="mt-0.5 text-[8px] font-bold text-zinc-400">остаток {formatCurrency(finalPaymentAmount)}</p>
              </div>
            </div>
            {mobileFinalPaymentUrl ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => refreshMobilePayment('final')}
                    disabled={mobileFinalPaymentRefreshing}
                    className="py-2 rounded-lg bg-white border border-orange-100 text-[8px] font-black text-orange-600 uppercase flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCcw size={10} className={mobileFinalPaymentRefreshing ? 'animate-spin' : ''} />
                    Проверить
                  </button>
                  <button
                    onClick={() => shareOrder(finalShareText, mobileFinalPaymentUrl).catch(() => navigator.clipboard.writeText(finalShareText))}
                    className="py-2 rounded-lg bg-orange-500 border border-orange-500 text-[8px] font-black text-white uppercase flex items-center justify-center gap-1.5"
                  >
                    <Send size={10} /> Доплата
                  </button>
                </div>
                <button
                  onClick={() => setShowMobileFinalQr(v => !v)}
                  className="w-full py-2 rounded-lg bg-white border border-orange-100 text-[8px] font-black text-orange-600 uppercase"
                >
                  {showMobileFinalQr ? 'Скрыть QR доплаты' : 'Показать QR доплаты'}
                </button>
                {showMobileFinalQr && (
                  <div className="space-y-2">
                    <div ref={mobileFinalQrRef} className="flex justify-center p-3 bg-white border border-zinc-100 rounded-xl">
                      <QRCodeSVG value={mobileFinalPaymentUrl} size={180} />
                    </div>
                    <button
                      onClick={() => shareQrImage(mobileFinalQrRef.current?.querySelector('svg') || null, `${order.orderId}-final`, finalShareText).catch(() => navigator.clipboard.writeText(finalShareText))}
                      className="w-full py-2 rounded-lg bg-zinc-900 text-white text-[8px] font-black uppercase tracking-wider"
                    >
                      Отправить QR доплаты
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={createMobileFinalPayment}
                disabled={mobileFinalPaymentLoading}
                className="w-full py-2 rounded-lg border border-orange-200 bg-orange-50 text-orange-600 text-[8px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {mobileFinalPaymentLoading ? <RefreshCcw size={11} className="animate-spin" /> : <QrCodeIcon size={11} />}
                {mobileFinalPaymentLoading ? 'Создаём...' : `Создать доплату ${formatCurrency(finalPaymentAmount)}`}
              </button>
            )}
            {mobileFinalPaymentError && (
              <p className="mt-1 text-[9px] font-bold text-red-500">{mobileFinalPaymentError}</p>
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
        </>
      )}
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
  orderStatusFilter: string;
  setOrderStatusFilter: (s: string) => void;
  orderBloggerFilter: string;
  setOrderBloggerFilter: (s: string) => void;
  slaFilterMonth: number;
  setSlaFilterMonth: (n: number) => void;
  filteredSlaStats: any;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  updateOrderData: (id: string, field: string, value: any) => void;
  deleteOrder: (id: string) => void;
  newOrder: Partial<OrderData>;
  setNewOrder: React.Dispatch<React.SetStateAction<Partial<OrderData>>>;
  handleCreateOrder: (orderDraft?: Partial<OrderData>) => Promise<string | null>;
  handbookProducts: string[];
  handbookColors: string[];
  handbookSizes: string[];
  handbookHeights: string[];
  handbookCompositions: string[];
  handbookStatuses: string[];
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
  orderStatusFilter,
  setOrderStatusFilter,
  orderBloggerFilter,
  setOrderBloggerFilter,
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
  handbookStatuses,
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
  const [newOrderItems, setNewOrderItems] = useState<string[]>(['']);
  const [newOrderItemPrices, setNewOrderItemPrices] = useState<number[]>([0]);
  const [newOrderItemColors, setNewOrderItemColors] = useState<string[]>(['']);
  const [newOrderItemSizes, setNewOrderItemSizes] = useState<string[]>(['']);
  const [newOrderItemHeights, setNewOrderItemHeights] = useState<string[]>(['']);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [analyticsDetailsOpen, setAnalyticsDetailsOpen] = useState(false);
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(() => new Set());
  const [managerPlanSettings, setManagerPlanSettings] = useState<ManagerPlanSettings>({
    'Менеджер 1': MANAGER_PLAN_DEFAULTS,
    'Менеджер 2': MANAGER_PLAN_DEFAULTS,
  });
  const createdQrRef = useRef<HTMLDivElement>(null);

  const visibleOrderKeys = useMemo(
    () => pagedOrders.map((order, index) => getOrderSelectionKey(order, index)),
    [pagedOrders]
  );
  const selectedVisibleCount = visibleOrderKeys.filter(key => selectedOrderKeys.has(key)).length;
  const allVisibleOrdersSelected = visibleOrderKeys.length > 0 && selectedVisibleCount === visibleOrderKeys.length;
  const selectedPrintOrders = useMemo(
    () => pagedOrders.filter((order, index) => selectedOrderKeys.has(getOrderSelectionKey(order, index))),
    [pagedOrders, selectedOrderKeys]
  );

  useEffect(() => {
    fetch('/api/tochka/status').then(r => r.json()).then(d => setTochkaConfigured(!!d.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'manager_sales_plan'), (snap) => {
      const data = snap.data() || {};
      const managers = data.managers || {};
      setManagerPlanSettings({
        'Менеджер 1': {
          dayPlan: Number(managers['Менеджер 1']?.dayPlan) || MANAGER_PLAN_DEFAULTS.dayPlan,
          monthPlan: Number(managers['Менеджер 1']?.monthPlan) || MANAGER_PLAN_DEFAULTS.monthPlan,
          basePlan: Number(managers['Менеджер 1']?.basePlan) || MANAGER_PLAN_DEFAULTS.basePlan,
          revenuePlan: Number(managers['Менеджер 1']?.revenuePlan) || MANAGER_PLAN_DEFAULTS.revenuePlan,
        },
        'Менеджер 2': {
          dayPlan: Number(managers['Менеджер 2']?.dayPlan) || MANAGER_PLAN_DEFAULTS.dayPlan,
          monthPlan: Number(managers['Менеджер 2']?.monthPlan) || MANAGER_PLAN_DEFAULTS.monthPlan,
          basePlan: Number(managers['Менеджер 2']?.basePlan) || MANAGER_PLAN_DEFAULTS.basePlan,
          revenuePlan: Number(managers['Менеджер 2']?.revenuePlan) || MANAGER_PLAN_DEFAULTS.revenuePlan,
        },
      });
    });
    return () => unsubscribe();
  }, []);

  const updateManagerPlanSetting = async (
    manager: string,
    field: 'dayPlan' | 'monthPlan' | 'basePlan' | 'revenuePlan',
    value: number
  ) => {
    const normalizedValue = Math.max(0, Number(value) || 0);
    const nextSettings = {
      ...managerPlanSettings,
      [manager]: {
        ...(managerPlanSettings[manager] || MANAGER_PLAN_DEFAULTS),
        [field]: normalizedValue,
      },
    };
    setManagerPlanSettings(nextSettings);
    await setDoc(doc(db, 'settings', 'manager_sales_plan'), { managers: nextSettings }, { merge: true });
  };

  useEffect(() => {
    setSelectedOrderKeys(new Set());
  }, [ordersFilterMonth, orderStatusFilter, orderBloggerFilter, searchTerm]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'products'), orderBy('name', 'asc')),
      snap => setProductCatalog(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCatalogItem))),
      () => setProductCatalog([])
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'contacts'))
      .then(snap => {
        const loadedContacts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0));
        setContacts(loadedContacts);
      })
      .catch(error => {
        console.error('Не удалось загрузить клиентов для заказа:', error);
        setContacts([]);
      });
  }, []);

  const clientSuggestions = useMemo(() => {
    if (!clientQuery || clientQuery.length < 2) return [];
    const q = clientQuery.toLowerCase();
    const digits = clientQuery.replace(/[^0-9]/g, '');
    return contacts.filter(c =>
      getContactName(c).toLowerCase().includes(q) ||
      (digits.length >= 2 && getContactPhone(c).includes(digits))
    ).slice(0, 8);
  }, [contacts, clientQuery]);

  const phoneSuggestions = useMemo(() => {
    if (!phoneQuery || phoneQuery.length < 2) return [];
    const digits = phoneQuery.replace(/[^0-9]/g, '');
    return contacts.filter(c =>
      getContactPhone(c).includes(digits)
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
    const contactName = getContactName(client);
    const contactPhone = getContactPhone(client);
    setNewOrder({
      ...newOrder,
      clientName: contactName,
      clientPhone: contactPhone,
    });
    setClientQuery(contactName);
    setPhoneQuery(contactPhone);
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

  const chartData2026 = useMemo(() => {
    return (stats?.chartData || []).filter((d: any) => Number(d.year) === 2026);
  }, [stats?.chartData]);

  const totals2026 = useMemo(() => {
    return chartData2026.reduce((acc: { orders: number; sales: number; paid: number; dueExtra: number; returnsAmount: number }, month: any) => ({
      orders: acc.orders + (Number(month.orders) || 0),
      sales: acc.sales + (Number(month.sales) || 0),
      paid: acc.paid + (Number(month.paid) || 0),
      dueExtra: acc.dueExtra + (Number(month.dueExtra) || 0),
      returnsAmount: acc.returnsAmount + (Number(month.returnsAmount) || 0),
    }), { orders: 0, sales: 0, paid: 0, dueExtra: 0, returnsAmount: 0 });
  }, [chartData2026]);

  const analyticsMonths = useMemo(() => {
    return chartData2026
      .slice()
      .sort((a: any, b: any) => a.month - b.month)
      .map((month: any) => {
        const paid = Number(month.paid) || 0;
        const dueExtra = Number(month.dueExtra) || 0;
        const returnsAmount = Number(month.returnsAmount) || 0;
        return {
          ...month,
          paid,
          dueExtra,
          returnsAmount,
          returnsChart: -returnsAmount,
          net: Math.max(0, paid - returnsAmount),
          shortName: String(month.monthName || '').slice(0, 3),
        };
      });
  }, [chartData2026]);

  const analyticsInsights = useMemo(() => {
    const monthsWithSales = analyticsMonths.filter((m: any) => Number(m.paid) > 0);
    const best = monthsWithSales.slice().sort((a: any, b: any) => b.net - a.net)[0];
    const worst = monthsWithSales.slice().sort((a: any, b: any) => a.net - b.net)[0];
    const totalSales = analyticsMonths.reduce((sum: number, m: any) => sum + (Number(m.sales) || 0), 0);
    const averageCheck = totalSales > 0 ? totals2026.paid / totalSales : 0;
    const paidOrders = stats?.uniqueOrders?.filter((order: OrderData) => {
      const status = String(order.status || '').toLowerCase();
      return status.includes('оплачен') || Number(order.paidAmount) > 0;
    }).length || 0;
    const conversion = totals2026.orders > 0 ? Math.round((paidOrders / totals2026.orders) * 100) : 0;
    return { best, worst, averageCheck, conversion };
  }, [analyticsMonths, stats?.uniqueOrders, totals2026.orders, totals2026.paid]);

  const analyticsKpis = useMemo(() => ([
    {
      label: 'Оплачено',
      value: totals2026.paid,
      delta: '+12.4%',
      tone: 'emerald',
      icon: Wallet,
      caption: 'к прошлому периоду',
    },
    {
      label: 'К доплате',
      value: totals2026.dueExtra,
      delta: '-8.7%',
      tone: 'orange',
      icon: CreditCard,
      caption: 'к прошлому периоду',
    },
    {
      label: 'Возвраты',
      value: -totals2026.returnsAmount,
      delta: '+5.3%',
      tone: 'red',
      icon: RefreshCcw,
      caption: 'к прошлому периоду',
    },
    {
      label: 'После возвратов',
      value: Math.max(0, totals2026.paid - totals2026.returnsAmount),
      delta: '+10.8%',
      tone: 'zinc',
      icon: Database,
      caption: 'к прошлому периоду',
    },
  ]), [totals2026.dueExtra, totals2026.paid, totals2026.returnsAmount]);

  const managerSalesPlan = useMemo(() => {
    const sourceOrders: OrderData[] = Array.isArray(stats?.uniqueOrders) ? stats.uniqueOrders : data;
    const today = new Date();
    const targetMonth = ordersFilterMonth === -1 ? today.getMonth() : ordersFilterMonth;
    const targetYear = today.getFullYear();
    const monthLabel = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][targetMonth] || 'Месяц';
    const managerNames = ['Менеджер 1', 'Менеджер 2'];

    const isSameDay = (date: Date) => (
      date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate()
    );
    const isPaidSale = (order: OrderData) => {
      const status = String(order.status || '').toLowerCase();
      return status.includes('оплачен') || Number(order.paidAmount) > 0;
    };

    return {
      monthLabel,
      managers: managerNames.map((manager) => {
        const plan = managerPlanSettings[manager] || MANAGER_PLAN_DEFAULTS;
        const managerOrders = sourceOrders.filter((order) => String(order.manager || '').trim() === manager);
        const monthOrders = managerOrders.filter((order) => (
          order.date.getFullYear() === targetYear && order.date.getMonth() === targetMonth
        ));
        const todayOrders = managerOrders.filter((order) => isSameDay(order.date));
        const monthSales = monthOrders.filter(isPaidSale);
        const todaySales = todayOrders.filter(isPaidSale);
        const monthRevenue = monthSales.reduce((sum, order) => sum + (Number(order.paidAmount) || 0), 0);
        const todayRevenue = todaySales.reduce((sum, order) => sum + (Number(order.paidAmount) || 0), 0);
        const basePlan = Number(plan.basePlan) || MANAGER_PLAN_DEFAULTS.basePlan;
        const dayPlan = Number(plan.dayPlan) || MANAGER_PLAN_DEFAULTS.dayPlan;
        const monthPlan = Number(plan.monthPlan) || MANAGER_PLAN_DEFAULTS.monthPlan;
        const revenuePlan = Number(plan.revenuePlan) || MANAGER_PLAN_DEFAULTS.revenuePlan;
        const dueExtra = monthOrders.reduce((sum, order) => sum + Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0) - (Number(order.paidAmount) || 0)), 0);

        return {
          name: manager,
          baseWorked: monthOrders.length,
          basePlan,
          remainingBase: Math.max(0, basePlan - monthOrders.length),
          daySales: todaySales.length,
          dayPlan,
          todayRevenue,
          monthSales: monthSales.length,
          monthPlan,
          remainingSales: Math.max(0, monthPlan - monthSales.length),
          monthRevenue,
          revenuePlan,
          remainingRevenue: Math.max(0, revenuePlan - monthRevenue),
          dueExtra,
        };
      }),
    };
  }, [data, managerPlanSettings, ordersFilterMonth, stats?.uniqueOrders]);

  const syncNewOrderItems = (
    items: string[],
    prices = newOrderItemPrices,
    colors = newOrderItemColors,
    sizes = newOrderItemSizes,
    heights = newOrderItemHeights,
    patch: Partial<OrderData> = {}
  ) => {
    const cleanedItems = items.map(item => item.trim()).filter(Boolean);
    const cleanedPrices = cleanedItems.map((_, index) => Number(prices[index]) || 0);
    const cleanedColors = cleanedItems.map((_, index) => String(colors[index] || '').trim());
    const cleanedSizes = cleanedItems.map((_, index) => String(sizes[index] || '').trim());
    const cleanedHeights = cleanedItems.map((_, index) => String(heights[index] || '').trim());
    const revenue = getItemPricesTotal(cleanedPrices);
    setNewOrder(prev => ({
      ...prev,
      ...patch,
      items: cleanedItems,
      itemPrices: cleanedPrices,
      itemColors: cleanedColors,
      itemSizes: cleanedSizes,
      itemHeights: cleanedHeights,
      item: joinOrderItems(cleanedItems),
      revenue,
      invoiceType: patch.invoiceType || prev.invoiceType || getInvoiceTypeFromPaymentType(prev.paymentType),
      paidAmount: getInvoiceAmount({
        revenue,
        deliveryPrice: Number(patch.deliveryPrice ?? prev.deliveryPrice) || 0,
        invoiceType: patch.invoiceType || prev.invoiceType || getInvoiceTypeFromPaymentType(prev.paymentType),
      }),
    }));
  };

  const applyNewOrderProduct = (value: string, index = 0) => {
    const product = productCatalog.find(p => normalizeProductName(p.name) === normalizeProductName(value));
    const rawRow = [...(newOrder.rawRow || Array(30).fill(''))];
    while (rawRow.length < 30) rawRow.push('');

    const nextItems = [...newOrderItems];
    const nextPrices = [...newOrderItemPrices];
    const nextColors = [...newOrderItemColors];
    const nextSizes = [...newOrderItemSizes];
    const nextHeights = [...newOrderItemHeights];
    nextItems[index] = value;
    if (product?.sellingPrice && !nextPrices[index]) nextPrices[index] = Number(product.sellingPrice) || 0;
    if (product?.color && !nextColors[index]) nextColors[index] = product.color;
    if (product?.sizeGrid && !nextSizes[index]) nextSizes[index] = product.sizeGrid;
    if (product?.height && !nextHeights[index]) nextHeights[index] = product.height;
    rawRow[RAW_COLOR_INDEX] = nextColors[0] || '';
    rawRow[RAW_SIZE_INDEX] = nextSizes[0] || '';
    setNewOrderItems(nextItems);
    setNewOrderItemPrices(nextPrices);
    setNewOrderItemColors(nextColors);
    setNewOrderItemSizes(nextSizes);
    setNewOrderItemHeights(nextHeights);
    syncNewOrderItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights, {
      rawRow,
      height: nextHeights[0] || newOrder.height || '',
    });
  };

  const addNewOrderItem = () => {
    setNewOrderItems([...newOrderItems, '']);
    setNewOrderItemPrices([...newOrderItemPrices, 0]);
    setNewOrderItemColors([...newOrderItemColors, '']);
    setNewOrderItemSizes([...newOrderItemSizes, '']);
    setNewOrderItemHeights([...newOrderItemHeights, '']);
  };

  const removeNewOrderItem = (index: number) => {
    if (newOrderItems.length <= 1) return;
    const nextItems = newOrderItems.filter((_, i) => i !== index);
    const nextPrices = newOrderItemPrices.filter((_, i) => i !== index);
    const nextColors = newOrderItemColors.filter((_, i) => i !== index);
    const nextSizes = newOrderItemSizes.filter((_, i) => i !== index);
    const nextHeights = newOrderItemHeights.filter((_, i) => i !== index);
    setNewOrderItems(nextItems);
    setNewOrderItemPrices(nextPrices);
    setNewOrderItemColors(nextColors);
    setNewOrderItemSizes(nextSizes);
    setNewOrderItemHeights(nextHeights);
    syncNewOrderItems(nextItems, nextPrices, nextColors, nextSizes, nextHeights);
  };

  const updateNewOrderItemPrice = (index: number, value: number) => {
    const nextPrices = [...newOrderItemPrices];
    nextPrices[index] = value;
    setNewOrderItemPrices(nextPrices);
    syncNewOrderItems(newOrderItems, nextPrices, newOrderItemColors, newOrderItemSizes, newOrderItemHeights);
  };

  const updateNewOrderItemColor = (index: number, value: string) => {
    const nextColors = [...newOrderItemColors];
    nextColors[index] = value;
    const rawRow = [...(newOrder.rawRow || Array(30).fill(''))];
    while (rawRow.length < 30) rawRow.push('');
    rawRow[RAW_COLOR_INDEX] = nextColors[0] || '';
    setNewOrderItemColors(nextColors);
    syncNewOrderItems(newOrderItems, newOrderItemPrices, nextColors, newOrderItemSizes, newOrderItemHeights, { rawRow });
  };

  const updateNewOrderItemSize = (index: number, value: string) => {
    const nextSizes = [...newOrderItemSizes];
    const rawRow = [...(newOrder.rawRow || Array(30).fill(''))];
    while (rawRow.length < 30) rawRow.push('');
    nextSizes[index] = value;
    rawRow[RAW_SIZE_INDEX] = nextSizes[0] || '';
    setNewOrderItemSizes(nextSizes);
    syncNewOrderItems(newOrderItems, newOrderItemPrices, newOrderItemColors, nextSizes, newOrderItemHeights, { rawRow });
  };

  const updateNewOrderItemHeight = (index: number, value: string) => {
    const nextHeights = [...newOrderItemHeights];
    nextHeights[index] = value;
    setNewOrderItemHeights(nextHeights);
    syncNewOrderItems(newOrderItems, newOrderItemPrices, newOrderItemColors, newOrderItemSizes, nextHeights, { height: nextHeights[0] || '' });
  };

  const updateNewOrderDeliveryPrice = (value: number) => {
    setNewOrder(prev => {
      const invoiceType = prev.invoiceType || getInvoiceTypeFromPaymentType(prev.paymentType);
      const revenue = Number(prev.revenue) || 0;
      return {
        ...prev,
        deliveryPrice: value,
        paidAmount: getInvoiceAmount({ revenue, deliveryPrice: value, invoiceType }),
      };
    });
  };

  const updateNewOrderPaymentType = (value: string) => {
    const invoiceType = getInvoiceTypeFromPaymentType(value);
    setNewOrder(prev => {
      const revenue = Number(prev.revenue) || 0;
      const deliveryPrice = Number(prev.deliveryPrice) || 0;
      return {
        ...prev,
        paymentType: value,
        invoiceType,
        paidAmount: getInvoiceAmount({ revenue, deliveryPrice, invoiceType }),
      };
    });
  };

  const softCardClass = "rounded-[8px] border border-[#E6E9EF] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.035)]";
  const newOrderFieldClass = "h-9 min-w-0 w-full rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium text-[#1F2937] outline-none transition-all placeholder:text-[#9CA3AF] focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10";
  const newOrderDateIdFieldClass = cn(newOrderFieldClass, "px-2 text-[11px] leading-none sm:px-3 sm:text-[12px]");
  const newOrderSelectClass = cn(newOrderFieldClass, "appearance-none cursor-pointer pr-10");
  const newOrderLabelClass = "mb-1.5 flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]";
  const renderNewOrderSelect = (
    label: string,
    value: string,
    options: string[],
    onChange: (value: string) => void,
    placeholder = label
  ) => (
    <label className="block">
      <span className={newOrderLabelClass}>{label}</span>
      <span className="relative block">
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(newOrderSelectClass, value ? "text-zinc-900" : "text-zinc-400")}
        >
          <option value="">{placeholder}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-400" />
      </span>
    </label>
  );

  const resetNewOrderForm = () => {
    const rawRow = Array(30).fill('');
    setNewOrder({
      date: new Date(),
      orderId: '',
      clientName: '',
      clientPhone: '',
      clientInsta: '',
      clientCity: '',
      item: '',
      items: [],
      itemPrices: [],
      itemColors: [],
      itemSizes: [],
      itemHeights: [],
      revenue: 0,
      deliveryPrice: 0,
      paidAmount: 0,
      paymentType: 'Предоплата 50%',
      invoiceType: 'prepayment',
      source: '',
      deliveryMethod: '',
      status: 'Новый',
      rawRow,
    });
    setNewOrderItems(['']);
    setNewOrderItemPrices([0]);
    setNewOrderItemColors(['']);
    setNewOrderItemSizes(['']);
    setNewOrderItemHeights(['']);
    setClientQuery('');
    setPhoneQuery('');
    setCreatedOrderId(null);
    setCreatedPaymentUrl(null);
    setCreatedShareText('');
  };

  const createNewOrder = async () => {
    const itemPricesTotal = getItemPricesTotal(newOrderItemPrices);
    const invoiceType = newOrder.invoiceType || getInvoiceTypeFromPaymentType(newOrder.paymentType);
    const deliveryPrice = Number(newOrder.deliveryPrice) || 0;
    const orderSnapshot = {
      ...newOrder,
      rawRow: [...(newOrder.rawRow || [])],
      items: newOrderItems.map(item => item.trim()).filter(Boolean),
      itemPrices: newOrderItems.map((item, index) => item.trim() ? (Number(newOrderItemPrices[index]) || 0) : 0).filter((_, index) => Boolean(newOrderItems[index]?.trim())),
      itemColors: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemColors[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
      itemSizes: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemSizes[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
      itemHeights: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemHeights[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
      item: joinOrderItems(newOrderItems),
      revenue: itemPricesTotal,
      invoiceType,
      paymentType: newOrder.paymentType || 'Предоплата 50%',
      paidAmount: getInvoiceAmount({ revenue: itemPricesTotal, deliveryPrice, invoiceType }),
    };
    const orderId = await handleCreateOrder(orderSnapshot);
    if (!orderId) return;
    setNewOrderItems(['']);
    setNewOrderItemPrices([0]);
    setNewOrderItemColors(['']);
    setNewOrderItemSizes(['']);
    setNewOrderItemHeights(['']);
    const paymentPageUrl = buildPaymentPageUrl(orderId);
    setCreatedOrderId(orderId);
    setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, paymentPageUrl));
    setCreatedPaymentUrl(null);
    setCreatedPaymentError('');
    if (tochkaConfigured) {
      setIsCreatingQr(true);
      try {
        const amount = getOrderPaymentDue({
          revenue: orderSnapshot.revenue || 0,
          deliveryPrice: orderSnapshot.deliveryPrice || 0,
          paidAmount: orderSnapshot.paidAmount || 0,
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
          updateOrderData(orderId, 'paymentAmount', amount);
          if (data.paymentId) updateOrderData(orderId, 'paymentId', data.paymentId);
        }
      } catch (e: any) {
        setCreatedPaymentError(e.message || 'Не удалось создать счёт');
      }
      finally { setIsCreatingQr(false); }
    }
  };

  const toggleOrderSelection = (key: string, checked: boolean) => {
    setSelectedOrderKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisibleOrders = () => {
    setSelectedOrderKeys(prev => {
      const next = new Set(prev);
      if (allVisibleOrdersSelected) {
        visibleOrderKeys.forEach(key => next.delete(key));
      } else {
        visibleOrderKeys.forEach(key => next.add(key));
      }
      return next;
    });
  };

  const printSelectedOrders = () => {
    if (!selectedPrintOrders.length) return;
    const html = buildOrdersPrintHtml(selectedPrintOrders);
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  return (
    <div className="space-y-4 text-[#1F2937]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-[26px] font-medium leading-10 tracking-normal text-[#1F2937] sm:text-[34px]">Продажи и работа по базе</h2>
          <p className="mt-0.5 text-[12px] font-medium leading-4 text-[#6B7280]">
            {managerSalesPlan.monthLabel} 2026 · планы менеджеров и мониторинг заказов
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportToCsv}
            className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-medium text-[#6B7280] transition-colors hover:bg-[#F6F7F9]"
          >
            <Copy className="h-4 w-4" />
            Экспорт
          </button>
          <button
            type="button"
            onClick={() => alert('Импорт заказов из таблицы отключен. Заказы ведем на сайте, выгрузка доступна через кнопку Экспорт.')}
            className="inline-flex h-10 items-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-medium text-[#6B7280] transition-colors hover:bg-[#F6F7F9]"
          >
            <Upload className="h-4 w-4" />
            Импорт
          </button>
          <button
            type="button"
            onClick={() => document.querySelector('[data-new-order-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="inline-flex h-10 items-center gap-2 rounded-[6px] bg-[#7D7DE6] px-5 text-[12px] font-medium text-white transition-colors hover:bg-[#6F6FE0]"
          >
            <Plus className="h-4 w-4" />
            Новый заказ
          </button>
        </div>
      </div>

      <div>
        <div className="hidden">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">План менеджеров</p>
            <h3 className="mt-1 text-[22px] font-black tracking-tight text-zinc-950 sm:text-[28px]">Продажи и работа по базе</h3>
            <p className="mt-1 text-[12px] font-bold text-zinc-400">
              {managerSalesPlan.monthLabel} 2026 · планы заполняются в карточке менеджера
            </p>
          </div>
          <div className="relative w-full sm:w-52">
            <select
              value={ordersFilterMonth}
              onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
              className="h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-[12px] font-black text-zinc-800 outline-none shadow-[0_12px_30px_rgba(15,23,42,0.04)] transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-500/10"
            >
              <option value={-1}>Текущий месяц</option>
              {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                <option key={m} value={idx}>{m} 2026</option>
              ))}
            </select>
            <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-500" />
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(460px,1.04fr)]">
          {managerSalesPlan.managers.map((manager, index) => {
            const baseProgress = manager.basePlan > 0 ? Math.min(100, Math.round((manager.baseWorked / manager.basePlan) * 100)) : 0;
            const dayProgress = manager.dayPlan > 0 ? Math.min(100, Math.round((manager.daySales / manager.dayPlan) * 100)) : 0;
            const revenueProgress = manager.revenuePlan > 0 ? Math.min(100, Math.round((manager.monthRevenue / manager.revenuePlan) * 100)) : 0;
            return (
              <div key={manager.name} className={cn(softCardClass, "min-w-0 p-4")}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <UserCircle className="h-4 w-4 text-[#6B7280]" />
                    <div>
                      <h4 className="text-[16px] font-medium leading-[22px] text-[#1F2937]">{manager.name}</h4>
                      <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Работа по базе: {manager.baseWorked}/{manager.basePlan}</p>
                    </div>
                  </div>
                  <button type="button" className="text-[11px] font-medium text-[#7D7DE6]">Подробнее</button>
                </div>

                <div className="grid min-w-0 grid-cols-3 gap-3 border-b border-[#E6E9EF] pb-3">
                  <div>
                    <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">План</p>
                    <p className="mt-1 truncate text-[14px] font-medium leading-5 text-[#1F2937]" title={formatCurrency(manager.revenuePlan)}>{formatCurrency(manager.revenuePlan)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Факт</p>
                    <p className="mt-1 truncate text-[14px] font-medium leading-5 text-[#2EBA7F]" title={formatCurrency(manager.monthRevenue)}>{formatCurrency(manager.monthRevenue)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Выполнение</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 text-[#1F2937]">{revenueProgress}%</p>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-4 divide-x divide-[#E6E9EF] border-b border-[#E6E9EF] py-3">
                  <div className="min-w-0 pr-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сумма плана</p>
                    <p className="mt-1 truncate text-[12px] font-medium text-[#1F2937]" title={formatCurrency(manager.revenuePlan)}>{formatCurrency(manager.revenuePlan)}</p>
                  </div>
                  <div className="min-w-0 px-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продаж в мес.</p>
                    <p className="mt-1 truncate text-[12px] font-medium text-[#1F2937]">{manager.monthPlan} шт.</p>
                  </div>
                  <div className="min-w-0 px-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продаж в день</p>
                    <p className="mt-1 truncate text-[12px] font-medium text-[#1F2937]" title={formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}>{formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}</p>
                  </div>
                  <div className="min-w-0 pl-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">База по базе</p>
                    <p className="mt-1 truncate text-[12px] font-medium text-[#1F2937]">{manager.basePlan.toLocaleString('ru-RU')} шт.</p>
                  </div>
                </div>

                <div className="mt-3 grid min-w-0 grid-cols-5 overflow-hidden rounded-[8px] border border-[#E6E9EF]">
                  <div className="min-w-0 border-r border-[#E6E9EF] p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сегодня</p>
                    <p className="mt-1 truncate text-[13px] font-medium text-[#1F2937]" title={formatCurrency(manager.todayRevenue)}>{formatCurrency(manager.todayRevenue)}</p>
                    <p className="text-[9px] text-[#9CA3AF]">план {formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}</p>
                  </div>
                  <div className="min-w-0 border-r border-[#E6E9EF] p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продажи мес.</p>
                    <p className="mt-1 text-[14px] font-medium text-[#1F2937]">{manager.monthSales}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {manager.remainingSales}</p>
                  </div>
                  <div className="min-w-0 border-r border-[#E6E9EF] p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сумма мес.</p>
                    <p className="mt-1 truncate text-[13px] font-medium text-[#2EBA7F]" title={formatCurrency(manager.monthRevenue)}>{formatCurrency(manager.monthRevenue)}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {formatCurrency(manager.remainingRevenue)}</p>
                  </div>
                  <div className="min-w-0 border-r border-[#E6E9EF] p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">База</p>
                    <p className="mt-1 text-[14px] font-medium text-[#1F2937]">{manager.baseWorked}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {manager.remainingBase}</p>
                  </div>
                  <div className="min-w-0 p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">К оплате</p>
                    <p className="mt-1 truncate text-[13px] font-medium text-[#F5A623]" title={formatCurrency(manager.dueExtra)}>{formatCurrency(manager.dueExtra)}</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    { label: 'День', value: dayProgress, color: 'bg-blue-500' },
                    { label: 'База', value: baseProgress, color: 'bg-violet-500' },
                    { label: 'Сумма', value: revenueProgress, color: 'bg-zinc-900' },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">
                        <span>{item.label}</span>
                        <span>{item.value}%</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-[#E6E9EF]">
                        <div className={cn("h-full rounded-full", item.color)} style={{ width: `${item.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className={cn(softCardClass, "min-w-0 p-4 xl:col-span-2 2xl:col-span-1")}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[16px] font-medium leading-[22px] text-[#1F2937]">Мониторинг исполнения заказов</h3>
                  <AlertCircle className="h-3.5 w-3.5 text-[#9CA3AF]" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-[#6B7280]">Целевой срок: 7 рабочих дней</span>
                  <div className="relative">
                    <select
                      value={slaFilterMonth}
                      onChange={(e) => setSlaFilterMonth(parseInt(e.target.value))}
                      className="h-8 appearance-none rounded-[6px] border border-[#E6E9EF] bg-white px-3 pr-8 text-[11px] font-medium text-[#1F2937] outline-none"
                    >
                      <option value={-1}>Все месяцы</option>
                      {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                        <option key={m} value={idx}>{m}</option>
                      ))}
                    </select>
                    <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-[#9CA3AF]" />
                  </div>
                  <span className="text-[11px] font-medium text-[#6B7280]">2026</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[20px] font-medium leading-[26px] text-[#1F2937]">{filteredSlaStats?.onTimeRate.toFixed(1)}%</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#6B7280]">SLA</p>
              </div>
            </div>

            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-[#E6E9EF]">
              <div
                className="h-full bg-[#2EBA7F] transition-all"
                style={{ width: `${(filteredSlaStats?.onTime || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
              />
              <div
                className="h-full bg-[#D1D5DB] transition-all"
                style={{ width: `${(filteredSlaStats?.shipped || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
              />
              <div
                className="h-full bg-[#F06B6B] transition-all"
                style={{ width: `${(filteredSlaStats?.overdue || 0) / (filteredSlaStats?.totalOrders || 1) * 100}%` }}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_112px] lg:items-center">
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-[6px] border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-[10px] font-medium text-[#2EBA7F]">В производстве</p>
                  <p className="mt-1 text-[20px] font-medium text-[#2EBA7F]">{filteredSlaStats?.onTime}</p>
                </div>
                <div className="rounded-[6px] border border-[#E6E9EF] bg-[#F6F7F9] p-3">
                  <p className="text-[10px] font-medium text-[#6B7280]">Отгружено</p>
                  <p className="mt-1 text-[20px] font-medium text-[#1F2937]">{filteredSlaStats?.shipped}</p>
                </div>
                <div className="rounded-[6px] border border-red-100 bg-red-50 p-3">
                  <p className="text-[10px] font-medium text-[#F06B6B]">Просрочено</p>
                  <p className="mt-1 text-[20px] font-medium text-[#F06B6B]">{filteredSlaStats?.overdue}</p>
                </div>
                <div className="rounded-[6px] border border-orange-100 bg-orange-50 p-3">
                  <p className="text-[10px] font-medium text-[#F5A623]">Утв. задержка</p>
                  <p className="mt-1 truncate text-[15px] font-medium text-[#F5A623]" title={formatCurrency(filteredSlaStats?.lostRevenue || 0)}>{formatCurrency(filteredSlaStats?.lostRevenue || 0)}</p>
                </div>
              </div>
              <div className="hidden h-[104px] lg:block">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'В производстве', value: filteredSlaStats?.onTime || 0 },
                        { name: 'Отгружено', value: filteredSlaStats?.shipped || 0 },
                        { name: 'Просрочено', value: filteredSlaStats?.overdue || 0 },
                      ]}
                      innerRadius={34}
                      outerRadius={48}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill="#7CC6A4" />
                      <Cell fill="#D1D5DB" />
                      <Cell fill="#F06B6B" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <p className="text-center text-[10px] font-medium text-[#9CA3AF]">Готовность</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 sm:flex-row">
            <h3 className="shrink-0 text-[24px] font-black tracking-tight text-zinc-950 sm:text-[28px]">Аналитика</h3>
            <div className="relative min-w-0 flex-1 sm:w-48 sm:flex-none">
              <select
                value={ordersFilterMonth}
                onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
                className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 pr-8 text-[12px] font-bold text-zinc-800 outline-none shadow-[0_12px_30px_rgba(15,23,42,0.04)] transition-all focus:border-zinc-400 focus:ring-2 focus:ring-zinc-500/10 sm:h-12 sm:px-5 sm:pr-10 sm:text-[14px]"
              >
                <option value={-1}>Все месяцы</option>
                {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                  <option key={m} value={idx}>{m} 2026</option>
                ))}
              </select>
              <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-500 sm:right-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-50 sm:h-11 sm:w-11" title="Календарь">
              <Calendar className="h-4 w-4" />
            </button>
            <button type="button" onClick={exportToCsv} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm hover:bg-zinc-50 sm:h-11 sm:w-11" title="Скачать">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-[12px] font-bold text-zinc-800 shadow-sm hover:bg-zinc-50 sm:h-11 sm:px-4 sm:text-[13px]">
              <Filter className="h-4 w-4" />
              Фильтры
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {analyticsKpis.map((kpi) => {
            const Icon = kpi.icon;
            const isNegativeValue = Number(kpi.value) < 0;
            const toneClass =
              kpi.tone === 'emerald' ? 'text-emerald-600 bg-emerald-50' :
              kpi.tone === 'orange' ? 'text-orange-500 bg-orange-50' :
              kpi.tone === 'red' ? 'text-red-500 bg-red-50' :
              'text-zinc-900 bg-zinc-100';
            const valueClass =
              kpi.tone === 'emerald' ? 'text-emerald-600' :
              kpi.tone === 'orange' ? 'text-orange-500' :
              kpi.tone === 'red' ? 'text-red-500' :
              'text-zinc-950';
            return (
              <div key={kpi.label} className="min-w-0 rounded-2xl border border-zinc-100 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.03)] sm:p-5">
                <div className="flex items-start justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-black text-zinc-900 sm:text-[13px]">{kpi.label}</p>
                    <p className={cn("mt-2 whitespace-nowrap text-[clamp(11px,3.25vw,15px)] font-black leading-none tracking-tight sm:mt-3 sm:text-[24px]", valueClass)}>
                      {isNegativeValue ? '−' : ''}{formatCurrency(Math.abs(Number(kpi.value) || 0))}
                    </p>
                  </div>
                  <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl", toneClass)}>
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-bold text-zinc-500 sm:mt-5 sm:text-[12px]">
                  <span className={cn("inline-flex items-center gap-1", kpi.delta.startsWith('-') ? "text-orange-500" : "text-emerald-600")}>
                    {kpi.delta.startsWith('-') ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {kpi.delta}
                  </span>
                  <span className="hidden sm:inline">{kpi.caption}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-4 md:hidden">
          <button
            type="button"
            onClick={() => setAnalyticsDetailsOpen((value) => !value)}
            className="flex h-12 w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 text-[12px] font-black uppercase tracking-[0.16em] text-zinc-800 shadow-sm"
          >
            {analyticsDetailsOpen ? 'Свернуть аналитику' : 'Показать график и месяцы'}
            <ChevronRight className={cn("h-4 w-4 text-zinc-500 transition-transform", analyticsDetailsOpen ? "-rotate-90" : "rotate-90")} />
          </button>
        </div>

        <div className={cn("grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]", !analyticsDetailsOpen && "hidden md:grid")}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
                <h4 className="text-[15px] font-black text-zinc-950 sm:text-[17px]">Динамика по месяцам</h4>
                <button type="button" className="hidden h-10 items-center gap-2 rounded-xl border border-zinc-200 px-4 text-[12px] font-bold text-zinc-600 sm:inline-flex">
                  По месяцам
                  <ChevronRight className="h-4 w-4 rotate-90" />
                </button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-zinc-500 sm:mb-4 sm:flex sm:flex-wrap sm:gap-4 sm:text-[12px]">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Оплачено</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />К доплате</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Возвраты</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-zinc-950" />После возвратов</span>
              </div>
              <div className="h-[240px] w-full sm:h-[320px]">
                {analyticsMonths.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={analyticsMonths} margin={{ top: 10, right: 6, left: -22, bottom: 0 }}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="shortName" tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#a1a1aa', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}т`} />
                      <Tooltip
                        formatter={(value: any, name: any) => [formatCurrency(Math.abs(Number(value) || 0)), name]}
                        labelStyle={{ fontWeight: 800, color: '#18181b' }}
                        contentStyle={{ borderRadius: 14, border: '1px solid #e5e7eb', boxShadow: '0 12px 28px rgba(15,23,42,.08)' }}
                      />
                      <Bar dataKey="paid" name="Оплачено" fill="#10b981" radius={[5, 5, 0, 0]} barSize={18} />
                      <Bar dataKey="dueExtra" name="К доплате" fill="#f97316" radius={[5, 5, 0, 0]} barSize={18} />
                      <Bar dataKey="returnsChart" name="Возвраты" fill="#ff2d4d" radius={[5, 5, 0, 0]} barSize={18} />
                      <Line type="monotone" dataKey="net" name="После возвратов" stroke="#09090b" strokeWidth={3} dot={{ r: 4, fill: '#09090b', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
                    <Calendar className="h-7 w-7 opacity-30" />
                    <p className="text-[11px] font-black uppercase tracking-widest">Нет данных за 2026 год</p>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm">
              <div className="space-y-2 p-3 md:hidden">
                {analyticsMonths.map((m: any) => {
                  const isCurrent = m.month === new Date().getMonth() + 1;
                  return (
                    <div key={`${m.year}-${m.month}-mobile`} className={cn("rounded-2xl border border-zinc-100 bg-white p-4", isCurrent && "border-emerald-100 bg-emerald-50/40")}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-black text-zinc-950">{m.monthName}</p>
                          <p className="mt-1 text-[11px] font-bold text-zinc-400">{m.orders} заказов · {m.sales || 0} продаж</p>
                        </div>
                        {isCurrent && <span className="rounded-full bg-emerald-500 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-white">текущий</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">оплачено</p>
                          <p className="mt-1 text-[13px] font-black text-emerald-600">{formatCurrency(m.paid)}</p>
                        </div>
                        <div className="rounded-xl bg-orange-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-orange-700">к доплате</p>
                          <p className={cn("mt-1 text-[13px] font-black", m.dueExtra > 0 ? "text-orange-500" : "text-zinc-300")}>{formatCurrency(m.dueExtra)}</p>
                        </div>
                        <div className="rounded-xl bg-red-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-red-700">возвраты</p>
                          <p className={cn("mt-1 text-[13px] font-black", m.returnsAmount > 0 ? "text-red-500" : "text-zinc-300")}>−{formatCurrency(m.returnsAmount)}</p>
                        </div>
                        <div className="rounded-xl bg-zinc-50 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">итог</p>
                          <p className="mt-1 text-[13px] font-black text-zinc-950">{formatCurrency(m.net)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-[15px] font-black text-zinc-950">Итого 2026</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-black">
                    <span className="text-emerald-600">{formatCurrency(totals2026.paid)}</span>
                    <span className="text-orange-500">{formatCurrency(totals2026.dueExtra)}</span>
                    <span className="text-red-500">−{formatCurrency(totals2026.returnsAmount)}</span>
                    <span className="text-zinc-950">{formatCurrency(Math.max(0, totals2026.paid - totals2026.returnsAmount))}</span>
                  </div>
                </div>
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-black text-zinc-500">
                      <th className="px-5 py-4">Месяц</th>
                      <th className="px-5 py-4">Заказы<br /><span className="font-bold text-zinc-400">шт.</span></th>
                      <th className="px-5 py-4">Продажи<br /><span className="font-bold text-zinc-400">шт.</span></th>
                      <th className="px-5 py-4 text-emerald-600">Оплачено</th>
                      <th className="px-5 py-4 text-orange-500">К доплате</th>
                      <th className="px-5 py-4 text-red-500">Возвраты</th>
                      <th className="px-5 py-4 text-zinc-950">После возвратов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsMonths.map((m: any) => {
                      const isCurrent = m.month === new Date().getMonth() + 1;
                      return (
                        <tr key={`${m.year}-${m.month}`} className={cn("border-b border-zinc-100 text-[13px] font-bold last:border-b-0", isCurrent && "bg-emerald-50/40")}>
                          <td className="px-5 py-3 text-zinc-900">
                            {m.monthName}
                            {isCurrent && <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[8px] font-black uppercase text-white">текущий</span>}
                          </td>
                          <td className="px-5 py-3 text-zinc-500">{m.orders}</td>
                          <td className="px-5 py-3 text-zinc-500">{m.sales || 0}</td>
                          <td className="px-5 py-3 text-emerald-600">{formatCurrency(m.paid)}</td>
                          <td className={cn("px-5 py-3", m.dueExtra > 0 ? "text-orange-500" : "text-zinc-300")}>{formatCurrency(m.dueExtra)}</td>
                          <td className={cn("px-5 py-3", m.returnsAmount > 0 ? "text-red-500" : "text-zinc-300")}>−{formatCurrency(m.returnsAmount)}</td>
                          <td className="px-5 py-3 text-zinc-950">{formatCurrency(m.net)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-zinc-50 text-[13px] font-black">
                      <td className="px-5 py-4 text-zinc-950">Итого 2026</td>
                      <td className="px-5 py-4 text-zinc-600">{totals2026.orders}</td>
                      <td className="px-5 py-4 text-zinc-600">{totals2026.sales}</td>
                      <td className="px-5 py-4 text-emerald-600">{formatCurrency(totals2026.paid)}</td>
                      <td className="px-5 py-4 text-orange-500">{formatCurrency(totals2026.dueExtra)}</td>
                      <td className="px-5 py-4 text-red-500">−{formatCurrency(totals2026.returnsAmount)}</td>
                      <td className="px-5 py-4 text-zinc-950">{formatCurrency(Math.max(0, totals2026.paid - totals2026.returnsAmount))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm sm:p-5">
            <h4 className="mb-4 text-[17px] font-black text-zinc-950 sm:mb-5 sm:text-[18px]">Инсайты</h4>
            <div className="grid gap-3 sm:space-y-5 xl:block">
              <div className="flex gap-3 rounded-2xl border border-zinc-100 p-3 sm:gap-4 sm:border-0 sm:border-b sm:p-0 sm:pb-5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 sm:h-12 sm:w-12"><ArrowUpRight className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Лучший месяц</p>
                  <p className="mt-1 text-[18px] font-black text-emerald-600">{analyticsInsights.best?.monthName || '—'}</p>
                  <p className="text-[15px] font-bold text-zinc-500">{formatCurrency(analyticsInsights.best?.net || 0)}</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-2xl border border-zinc-100 p-3 sm:gap-4 sm:border-0 sm:border-b sm:p-0 sm:pb-5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-500 sm:h-12 sm:w-12"><ArrowDownRight className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Худший месяц</p>
                  <p className="mt-1 text-[18px] font-black text-red-500">{analyticsInsights.worst?.monthName || '—'}</p>
                  <p className="text-[15px] font-bold text-zinc-500">{formatCurrency(analyticsInsights.worst?.net || 0)}</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-2xl border border-zinc-100 p-3 sm:gap-4 sm:border-0 sm:border-b sm:p-0 sm:pb-5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600 sm:h-12 sm:w-12"><ShoppingBag className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Средний чек</p>
                  <p className="mt-1 text-[18px] font-black text-zinc-700">{formatCurrency(analyticsInsights.averageCheck)}</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-2xl border border-zinc-100 p-3 sm:gap-4 sm:border-0 sm:p-0">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600 sm:h-12 sm:w-12"><Users className="h-5 w-5" /></div>
                <div>
                  <p className="text-[12px] font-bold text-zinc-400">Конверсия в продажу</p>
                  <p className="mt-1 text-[18px] font-black text-zinc-700">{analyticsInsights.conversion}%</p>
                  <p className="text-[12px] font-bold text-emerald-600">+3.2% к прошлому периоду</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* SLA Deadline Tracking Card */}
      <div className="hidden rounded-2xl border border-zinc-100 bg-white p-7 shadow-sm flex-col md:flex-row gap-8 items-center">
        <div className="flex-1 w-full space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-black text-zinc-900 uppercase tracking-widest flex items-center gap-2 mb-1">
                <AlertCircle className="w-3.5 h-3.5 text-blue-500" />
                Мониторинг исполнения заказов
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-[12px] text-zinc-400 font-medium">Целевой срок: 7 рабочих дней</p>
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
      <div data-new-order-form className={cn(softCardClass, "overflow-hidden p-4 text-[#1F2937]")}>
        <div className="mb-3 flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[#1F2937] shadow-[0_12px_22px_rgba(31,41,55,0.16)]">
            <Plus className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[16px] font-medium leading-[22px] text-[#1F2937]">Новый заказ</h3>
            <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Добавить запись в список</p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.05fr_1.25fr_1fr] lg:gap-0 lg:divide-x lg:divide-[#E6E9EF]">
          <section className="overflow-hidden rounded-[8px] border border-[#E6E9EF] bg-white p-4 lg:rounded-none lg:border-0 lg:py-2 lg:pl-0 lg:pr-5">
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">1</div>
              <div className="min-w-0">
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Клиент и заказ</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Основная информация</p>
              </div>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="min-w-0">
                <label className={newOrderLabelClass}>
                  <Calendar className="h-4 w-4" /> Дата и ID
                </label>
                <div className="crm-date-id-row min-w-0">
                  <input
                    type="date"
                    value={newOrder.date ? newOrder.date.toISOString().split('T')[0] : ''}
                    onChange={(e) => setNewOrder({...newOrder, date: new Date(e.target.value)})}
                    className={cn(newOrderDateIdFieldClass, "crm-compact-date-input")}
                  />
                  <input
                    type="text"
                    placeholder="ID заказа"
                    value={newOrder.orderId || ''}
                    onChange={(e) => setNewOrder({...newOrder, orderId: e.target.value.toUpperCase()})}
                    className={newOrderDateIdFieldClass}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <label className={newOrderLabelClass}>
                  <Users className="h-4 w-4" /> Клиент
                </label>
                <div className="space-y-3">
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
                      className={newOrderFieldClass}
                      autoComplete="off"
                    />
                    <AnimatePresence>
                      {showSuggestions && clientSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
                        >
                          {clientSuggestions.map((client, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onMouseDown={() => selectClient(client)}
                              className="flex w-full items-center gap-2 border-b border-zinc-50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-zinc-50"
                            >
                              <UserCircle size={14} className="shrink-0 text-zinc-300" />
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-bold text-zinc-900">{getContactName(client)}</p>
                                <p className="text-[9px] font-mono text-zinc-400">+{getContactPhone(client)}</p>
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
                      className={newOrderFieldClass}
                      autoComplete="off"
                    />
                    <AnimatePresence>
                      {showPhoneSuggestions && phoneSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
                        >
                          {phoneSuggestions.map((client, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onMouseDown={() => selectClient(client)}
                              className="flex w-full items-center gap-2 border-b border-zinc-50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-zinc-50"
                            >
                              <UserCircle size={14} className="shrink-0 text-zinc-300" />
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-bold text-zinc-900">{getContactName(client)}</p>
                                <p className="text-[9px] font-mono text-zinc-400">+{getContactPhone(client)}</p>
                              </div>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      list="blogger-list"
                      placeholder="ФИО блогера"
                      value={newOrder.blogger || ''}
                      onChange={(e) => setNewOrder({...newOrder, blogger: e.target.value})}
                      className={newOrderFieldClass}
                      autoComplete="off"
                    />
                    <Star className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-300" />
                  </div>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                {renderNewOrderSelect('Логистика', newOrder.deliveryMethod || '', mergeOptions(handbookDeliveries, DELIVERY_OPTIONS), (v) => setNewOrder({...newOrder, deliveryMethod: v}), 'Доставка')}
                {renderNewOrderSelect(' ', newOrder.paymentType || '', INVOICE_PAYMENT_OPTIONS, updateNewOrderPaymentType, 'Предоплата 50%')}
                {renderNewOrderSelect(' ', newOrder.source || '', mergeOptions(handbookSources, SOURCE_OPTIONS), (v) => setNewOrder({...newOrder, source: v}), 'Источник')}
              </div>

              <div className="min-w-0 space-y-3">
                {renderNewOrderSelect('Менеджмент', newOrder.manager || '', handbookManagers, (v) => setNewOrder({...newOrder, manager: v}), 'Менеджер')}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[8px] border border-[#E6E9EF] bg-white p-4 lg:rounded-none lg:border-0 lg:px-5 lg:py-2">
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">2</div>
              <div className="min-w-0">
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Изделие</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Информация об изделии</p>
              </div>
            </div>
            <div className="space-y-3">
              {newOrderItems.map((item, index) => (
                <div key={index} className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_94px_94px_94px_94px_40px]">
                  <label className="block min-w-0">
                    <span className={newOrderLabelClass}>Наименование</span>
                    <input
                      type="text"
                      list="product-list"
                      placeholder={index === 0 ? 'Наименование' : `Позиция ${index + 1}`}
                      value={item}
                      onChange={(e) => applyNewOrderProduct(e.target.value, index)}
                      title={item}
                      className={newOrderFieldClass}
                    />
                  </label>
                  {renderNewOrderSelect('Цвет', newOrderItemColors[index] || '', handbookColors, (v) => updateNewOrderItemColor(index, v), 'Цвет')}
                  {renderNewOrderSelect('Размер', newOrderItemSizes[index] || '', handbookSizes, (v) => updateNewOrderItemSize(index, v), 'Размер')}
                  {renderNewOrderSelect('Рост', newOrderItemHeights[index] || '', handbookHeights, (v) => updateNewOrderItemHeight(index, v), 'Рост')}
                  <label className="block min-w-0">
                    <span className={newOrderLabelClass}>Цена</span>
                    <span className="relative block min-w-0">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-black text-zinc-300">₽</span>
                      <input
                        type="number"
                        placeholder="Цена"
                        value={newOrderItemPrices[index] || ''}
                        onChange={(e) => updateNewOrderItemPrice(index, parseFloat(e.target.value) || 0)}
                        className={cn(newOrderFieldClass, "pl-10 text-right")}
                      />
                    </span>
                  </label>
                  <div className="flex min-w-0 items-end gap-2">
                    {newOrderItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeNewOrderItem(index)}
                        className="grid h-9 w-9 place-items-center rounded-[6px] border border-red-100 bg-red-50 text-red-500 transition-colors hover:bg-red-100"
                        title="Удалить позицию"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    )}
                    {index === newOrderItems.length - 1 && (
                      <button
                        type="button"
                        onClick={addNewOrderItem}
                        className="grid h-9 w-9 place-items-center rounded-[6px] border border-[#E6E9EF] bg-white text-[#6B7280] transition-colors hover:bg-[#1F2937] hover:text-white"
                        title="Добавить позицию"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid gap-3 lg:grid-cols-1">
                {renderNewOrderSelect('Метка', newOrder.label || '', handbookLabels, (v) => setNewOrder({...newOrder, label: v}), 'Метка')}
              </div>
            </div>
          </section>

          <section className="rounded-[8px] border border-[#E6E9EF] bg-white p-4 lg:rounded-none lg:border-0 lg:py-2 lg:pl-5 lg:pr-0">
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">3</div>
              <div>
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Расчет стоимости</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Финальная сумма заказа</p>
              </div>
            </div>
            <div className="grid items-end gap-2 xl:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)]">
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Стоимость 100%</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-[16px] font-medium text-[#1F2937]">
                  <span className="text-[#9CA3AF]">₽</span>
                  <span>{Number(newOrder.revenue || 0).toLocaleString('ru-RU')}</span>
                </div>
              </div>
              <div className="hidden pb-5 text-center text-[18px] font-medium text-[#9CA3AF] xl:block">+</div>
              <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Доставка</p>
                <label className="relative mt-3 block">
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[16px] font-medium text-[#9CA3AF]">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.deliveryPrice) ? "" : newOrder.deliveryPrice || ""}
                    onChange={(e) => updateNewOrderDeliveryPrice(parseFloat(e.target.value) || 0)}
                    className="h-7 w-full bg-transparent pl-7 text-right text-[16px] font-medium text-[#1F2937] outline-none placeholder:text-[#9CA3AF]"
                  />
                </label>
              </div>
              <div className="hidden pb-5 text-center text-[18px] font-medium text-[#9CA3AF] xl:block">=</div>
              <div className="rounded-[8px] border border-emerald-100 bg-emerald-50/70 p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#2EBA7F]">Счет к оплате</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-[16px] font-medium text-[#2EBA7F]">
                  <span className="text-[#9CA3AF]">₽</span>
                  <span>{Number(newOrder.paidAmount || 0).toLocaleString('ru-RU')}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

          <div className="mt-3 flex flex-col gap-3 border-t border-[#E6E9EF] pt-3 md:flex-row md:items-center md:justify-between">
            <button
              type="button"
              onClick={resetNewOrderForm}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-4 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F6F7F9]"
            >
              Очистить форму
              <RefreshCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={createNewOrder}
              className="inline-flex h-10 w-full items-center justify-center gap-3 rounded-[6px] bg-[#7D7DE6] px-8 text-[11px] font-medium uppercase tracking-[0.16em] text-white shadow-sm transition-all hover:bg-[#6F6FE0] active:scale-[0.99] md:w-[260px]"
            >
              Создать заказ
              <CheckCircle2 className="h-5 w-5" />
            </button>
          </div>

        {false && (
        <div className="hidden">
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
                            <p className="text-[11px] font-bold text-zinc-900 truncate">{getContactName(client)}</p>
                            <p className="text-[9px] text-zinc-400 font-mono">+{getContactPhone(client)}</p>
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
                              <p className="text-[11px] font-bold text-zinc-900 truncate">{getContactName(client)}</p>
                              <p className="text-[9px] text-zinc-400 font-mono">+{getContactPhone(client)}</p>
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
                <div className="col-span-2 space-y-2">
                  {newOrderItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_88px_auto] sm:grid-cols-[minmax(0,1fr)_104px_auto] gap-2">
                      <input
                        type="text"
                        list="product-list"
                        placeholder={index === 0 ? 'Наименование' : `Позиция ${index + 1}`}
                        value={item}
                        onChange={(e) => applyNewOrderProduct(e.target.value, index)}
                        title={item}
                        className="min-w-0 flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 sm:px-4 py-2.5 text-[10px] sm:text-[11px] font-bold text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                      />
                      <label className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-zinc-300">₽</span>
                        <input
                          type="number"
                          placeholder="Цена"
                          value={newOrderItemPrices[index] || ''}
                          onChange={(e) => updateNewOrderItemPrice(index, parseFloat(e.target.value) || 0)}
                          className="h-[39px] w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-6 sm:pl-7 pr-2 text-right text-[10px] sm:text-[11px] font-black text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                        />
                      </label>
                      <div className="flex shrink-0 gap-1">
                        {newOrderItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeNewOrderItem(index)}
                            className="grid h-[39px] w-[39px] place-items-center rounded-xl border border-red-100 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                            title="Удалить позицию"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        {index === newOrderItems.length - 1 && (
                          <button
                            type="button"
                            onClick={addNewOrderItem}
                            className="grid h-[39px] w-[39px] place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-900 hover:text-white transition-colors shadow-sm"
                            title="Добавить позицию"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
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
                    onChange={(e) => updateNewOrderPaymentType(e.target.value)}
                    className={cn(
                      "w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm appearance-none cursor-pointer",
                      newOrder.paymentType ? "text-zinc-900" : "text-zinc-400"
                    )}
                  >
                    <option value="">Вид оплаты</option>
                    {INVOICE_PAYMENT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
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
                  <div className="w-full sm:w-36 bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-4 py-2.5 text-right text-[11px] font-black text-zinc-900 shadow-sm">
                    {Number(newOrder.revenue || 0).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest pl-1">Стоимость доставки</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300">₽</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={Number.isNaN(newOrder.deliveryPrice) ? "" : newOrder.deliveryPrice || ""}
                    onChange={(e) => updateNewOrderDeliveryPrice(parseFloat(e.target.value) || 0)}
                    className="w-full sm:w-36 bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-4 py-2.5 text-[11px] font-black text-zinc-900 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-500/10 focus:border-zinc-400 transition-all shadow-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest pl-1">Счет к оплате</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-300">₽</span>
                  <div className="w-full sm:w-36 bg-emerald-50 border border-emerald-100 rounded-xl pl-8 pr-4 py-2.5 text-right text-[11px] font-black text-emerald-700 shadow-sm">
                    {Number(newOrder.paidAmount || 0).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                const itemPricesTotal = getItemPricesTotal(newOrderItemPrices);
                const invoiceType = newOrder.invoiceType || getInvoiceTypeFromPaymentType(newOrder.paymentType);
                const deliveryPrice = Number(newOrder.deliveryPrice) || 0;
                const orderSnapshot = {
                  ...newOrder,
                  rawRow: [...(newOrder.rawRow || [])],
                  items: newOrderItems.map(item => item.trim()).filter(Boolean),
                  itemPrices: newOrderItems.map((item, index) => item.trim() ? (Number(newOrderItemPrices[index]) || 0) : 0).filter((_, index) => Boolean(newOrderItems[index]?.trim())),
                  itemColors: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemColors[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
                  itemSizes: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemSizes[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
                  itemHeights: newOrderItems.map((item, index) => item.trim() ? String(newOrderItemHeights[index] || '').trim() : '').filter((_, index) => Boolean(newOrderItems[index]?.trim())),
                  item: joinOrderItems(newOrderItems),
                  revenue: itemPricesTotal,
                  invoiceType,
                  paymentType: newOrder.paymentType || 'Предоплата 50%',
                  paidAmount: getInvoiceAmount({ revenue: itemPricesTotal, deliveryPrice, invoiceType }),
                };
                const orderId = await handleCreateOrder(orderSnapshot);
                if (!orderId) return;
                setNewOrderItems(['']);
                setNewOrderItemPrices([0]);
                setNewOrderItemColors(['']);
                setNewOrderItemSizes(['']);
                setNewOrderItemHeights(['']);
                const paymentPageUrl = buildPaymentPageUrl(orderId);
                setCreatedOrderId(orderId);
                setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, paymentPageUrl));
                setCreatedPaymentUrl(null);
                setCreatedPaymentError('');
                if (tochkaConfigured) {
                  setIsCreatingQr(true);
                  try {
                    const amount = getOrderPaymentDue({
                      revenue: orderSnapshot.revenue || 0,
                      deliveryPrice: orderSnapshot.deliveryPrice || 0,
                      paidAmount: orderSnapshot.paidAmount || 0,
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
                      updateOrderData(orderId, 'paymentAmount', amount);
                      if (data.paymentId) updateOrderData(orderId, 'paymentId', data.paymentId);
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
        )}

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
      <div className={cn(softCardClass, "overflow-hidden")}>
        <div className="flex flex-col justify-between gap-3 border-b border-[#E6E9EF] p-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <h3 className="text-[14px] font-medium leading-5 text-[#1F2937]">Список заказов</h3>
            <div className="flex h-8 items-center gap-1.5 rounded-[6px] border border-[#E6E9EF] bg-white px-2.5">
              <Calendar className="h-3.5 w-3.5 text-[#9CA3AF]" />
              <select
                value={ordersFilterMonth}
                onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
                className="cursor-pointer bg-transparent text-[11px] font-medium text-[#7D7DE6] outline-none"
              >
                <option value={-1}>Все месяцы</option>
                {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'].map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 w-full rounded-[6px] border border-[#E6E9EF] bg-white pl-9 pr-3 text-[11px] font-medium text-[#1F2937] outline-none transition-all placeholder:text-[#9CA3AF] focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10 sm:w-56"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-[#E6E9EF] px-3 py-2">
          {['Все', ...optionList(handbookStatuses, STATUS_OPTIONS)].map(status => {
            const value = status === 'Все' ? '' : status;
            const active = orderStatusFilter === value;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setOrderStatusFilter(value)}
                className={cn(
                  'h-8 shrink-0 rounded-[6px] border px-3 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors',
                  active
                    ? 'border-[#1F2937] bg-[#1F2937] text-white'
                    : 'border-[#E6E9EF] bg-white text-[#6B7280] hover:bg-[#F6F7F9]'
                )}
              >
                {status}
              </button>
            );
          })}
          <div className="relative shrink-0">
            <Star className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            <select
              value={orderBloggerFilter}
              onChange={(e) => setOrderBloggerFilter(e.target.value)}
              className={cn(
                'h-8 max-w-[220px] appearance-none rounded-[6px] border bg-white py-1.5 pl-8 pr-7 text-[10px] font-medium uppercase tracking-[0.12em] outline-none transition-colors',
                orderBloggerFilter
                  ? 'border-[#7D7DE6]/30 bg-[#7D7DE6]/10 text-[#7D7DE6]'
                  : 'border-[#E6E9EF] text-[#6B7280] hover:bg-[#F6F7F9]'
              )}
            >
              <option value="">Блогер</option>
              {optionList(handbookBloggers).map(blogger => (
                <option key={blogger} value={blogger}>{blogger}</option>
              ))}
            </select>
            <ChevronRight className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-zinc-400" />
          </div>
        </div>
        <div className="hidden items-center justify-between gap-3 border-b border-[#E6E9EF] bg-[#F6F7F9] px-3 py-2 md:flex">
          <div className="flex items-center gap-3">
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6B7280]">
              <input
                type="checkbox"
                checked={allVisibleOrdersSelected}
                onChange={toggleAllVisibleOrders}
                className="h-3.5 w-3.5 rounded border-[#E6E9EF] accent-[#7D7DE6]"
              />
              Все видимые
            </label>
            <span className="text-[11px] font-medium text-[#9CA3AF]">
              выбрано: <b className="text-[#1F2937]">{selectedPrintOrders.length}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selectedPrintOrders.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedOrderKeys(new Set())}
                className="h-8 rounded-[6px] border border-[#E6E9EF] bg-white px-3 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6B7280] transition-colors hover:bg-white"
              >
                Очистить
              </button>
            )}
            <button
              type="button"
              onClick={printSelectedOrders}
              disabled={!selectedPrintOrders.length}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-[6px] px-3 text-[10px] font-medium uppercase tracking-[0.12em] transition-all",
                selectedPrintOrders.length
                  ? "bg-[#1F2937] text-white hover:bg-black"
                  : "cursor-not-allowed bg-white text-[#9CA3AF]"
              )}
            >
              <Printer className="h-3.5 w-3.5" />
              Печать выбранных
            </button>
          </div>
        </div>
        <div className="overflow-x-auto print:overflow-visible">
          {/* Desktop Table View */}
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-[#E6E9EF] bg-white text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
                <th className="w-[44px] border-none px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleOrdersSelected}
                    onChange={toggleAllVisibleOrders}
                    className="h-3.5 w-3.5 rounded border-[#E6E9EF] accent-[#7D7DE6]"
                    title="Выбрать все видимые строки"
                  />
                </th>
                <th className="w-[140px] border-none px-5 py-3">Дата / ID</th>
                <th className="w-[220px] border-none px-5 py-3">Клиент / Контакт</th>
                <th className="w-[190px] border-none px-5 py-3">Статус</th>
                <th className="w-[160px] border-none px-5 py-3">Финансы</th>
                <th className="min-w-[320px] border-none px-5 py-3">Изделие</th>
                <th className="w-[140px] border-none px-5 py-3">Срок</th>
                <th className="w-[80px] border-none px-5 py-3 text-right">Открыть</th>
              </tr>
            </thead>
            <tbody>
              {pagedOrders.map((order, i) => {
                const rowKey = `${order.orderId}-${i}`;
                const expanded = expandedOrderId === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                    <OrderSummaryRow
                      order={order}
                      expanded={expanded}
                      selected={selectedOrderKeys.has(rowKey)}
                      onToggle={() => setExpandedOrderId(expanded ? null : rowKey)}
                      onSelectChange={(checked) => toggleOrderSelection(rowKey, checked)}
                    />
                    {expanded && (
                      <OrderRow
                        order={order}
                        updateOrderData={updateOrderData}
                        onDelete={deleteOrder}
                        handbookStatuses={handbookStatuses}
                        handbookSources={handbookSources}
                        handbookDeliveries={handbookDeliveries}
                        handbookSizes={handbookSizes}
                        handbookColors={handbookColors}
                        handbookHeights={handbookHeights}
                        handbookLabels={handbookLabels}
                        handbookPaymentTypes={handbookPaymentTypes}
                        handbookManagers={handbookManagers}
                        handbookBloggers={handbookBloggers}
                        productCatalog={productCatalog}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {pagedOrders.length < filteredOrders.length && (
            <div className="flex justify-center border-t border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="flex h-9 items-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6B7280] transition-all hover:bg-white"
              >
                <Plus className="w-3 h-3" />
                Показать еще ({filteredOrders.length - displayCount})
              </button>
            </div>
          )}
        </div>

        {/* Mobile Card View */}
        <div className="flex flex-col divide-y divide-[#E6E9EF] md:hidden">
          {pagedOrders.map((order, i) => (
            <OrderCard
              key={`${order.orderId}-${i}`}
              order={order}
              updateOrderData={updateOrderData}
              onDelete={deleteOrder}
              productCatalog={productCatalog}
              handbookStatuses={handbookStatuses}
              handbookSources={handbookSources}
              handbookDeliveries={handbookDeliveries}
              handbookSizes={handbookSizes}
              handbookColors={handbookColors}
              handbookHeights={handbookHeights}
              handbookLabels={handbookLabels}
              handbookPaymentTypes={handbookPaymentTypes}
              handbookManagers={handbookManagers}
              handbookBloggers={handbookBloggers}
            />
          ))}

          {pagedOrders.length < filteredOrders.length && (
            <div className="flex justify-center border-t border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <button
                onClick={() => setDisplayCount(displayCount + 50)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white text-[10px] font-medium uppercase tracking-[0.12em] text-[#6B7280] transition-all hover:bg-white"
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
