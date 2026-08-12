import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ComposedChart, CartesianGrid, XAxis, YAxis, Bar, Line
} from 'recharts';
import {
  TrendingUp, Users, ShoppingBag,
  Calendar, Award, AlertCircle, Search, Plus,
  X, MapPin, Star, RefreshCcw,
  Tag, Trash2, Phone, UserCircle, ChevronRight, ChevronLeft, QrCode as QrCodeIcon,
  CheckCircle2, Copy, Send, Truck, Wallet, CreditCard, Database, Filter,
  ArrowUpRight, ArrowDownRight, Printer, Upload, Instagram, FileText, Pencil, Download,
  MoreVertical, Share2, ExternalLink, Pin, Clock
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency, cn } from '../../lib/utils';
import { PREPAYMENT_FILTER_VALUE } from '../../lib/orderFilters';
import {
  getConfirmedPaidAmount,
  getInitialInvoiceAmount,
  getOrderTotalAmount,
  getOutstandingPaymentAmount,
  getPlannedFinalPaymentAmount,
  isConfirmedPaymentStatus,
} from '../../lib/orderPayments';
import { motion, AnimatePresence } from 'motion/react';
import { OrderData } from '../AnalyticsDashboard';
import { auth, db } from '../../firebase';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';

const STATUS_OPTIONS = ['Черновик', 'Новый', 'В работе', 'Оплачен', 'Упакован', 'Принят СДЭК', 'Отгружен', 'Доставлен', 'Возврат', 'Отмена', 'Обмен'];
const DELIVERY_OPTIONS = ['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS'];
const SOURCE_OPTIONS = ['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный'];
const PAYMENT_TYPE_OPTIONS = ['QR код', 'Сплитами', 'Долями', 'Наличкой', 'Наложенный СДЭК'];
const INVOICE_PAYMENT_OPTIONS = ['Предоплата 50%', 'Полная оплата', 'Оплата с примеркой', 'Сплитами'];
const SplitMark = ({ className = '' }: { className?: string }) => (
  <span className={cn('relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center', className)} aria-hidden="true">
    <span className="absolute h-2.5 w-2.5 rounded-full bg-[#F43F5E]" />
    <span className="absolute h-2.5 w-2.5 translate-x-1.5 translate-y-1 rounded-full bg-[#22C55E] mix-blend-multiply" />
  </span>
);
const MANAGER_PLAN_DEFAULTS = {
  dayPlan: 3,
  monthPlan: 60,
  basePlan: 120,
  revenuePlan: 0,
};
const SHIFT_TARGET_CONTACTS = 100;
const SHIFT_BASE_PAY = 1000;
const SHIFT_START_TIME = '09:00';
const SHIFT_END_TIME = '22:00';
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
  photos?: string[];
}

type ManagerPlanSettings = Record<string, {
  dayPlan: number;
  monthPlan: number;
  basePlan: number;
  revenuePlan: number;
}>;

type ManagerContactEntry = {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  clientPhone?: string;
  clientName?: string;
  date?: string;
  status?: string;
};

type ManagerShiftRecord = {
  id: string;
  managerName?: string;
  managerId?: string;
  managerEmail?: string;
  dateKey?: string;
  startedAt?: string;
  plannedStart?: string;
  plannedEnd?: string;
  targetContacts?: number;
  basePay?: number;
  status?: 'active' | 'closed';
};

type ManagerProfile = {
  managerName?: string;
  managerId?: string;
  managerEmail?: string | null;
  displayName?: string | null;
};

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
const normalizeInstagramUsername = (value: unknown) => {
  let clean = String(value || '').trim();
  if (!clean) return '';
  clean = clean.replace(/^@/, '');
  if (/instagram\.com/i.test(clean)) {
    clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    clean = clean.replace(/^instagram\.com\//i, '');
  }
  return clean.split(/[/?#]/)[0].replace(/^@/, '').trim();
};
const getInstagramProfileUrl = (value: unknown) => {
  const username = normalizeInstagramUsername(value);
  return username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : '';
};
const getContactName = (contact: any) => String(contact?.fullName || contact?.name || contact?.clientName || '').trim();
const getContactPhone = (contact: any) => String(contact?.phone || contact?.userId || contact?.clientPhone || '').replace(/[^0-9]/g, '');
const getContactInsta = (contact: any) => normalizeInstagramUsername(contact?.insta || contact?.instagram || contact?.clientInsta || '');
const getContactCity = (contact: any) => String(contact?.city || contact?.clientCity || '').trim();
const getContactAddress = (contact: any) => String(contact?.address || contact?.clientAddress || '').trim();
const inferCdekPointCode = (value: unknown) => String(value || '').trim().match(/^([A-ZА-Я]{2,8}\d{1,5})(?:\s|,|·)/i)?.[1] || '';

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

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const managerDocKey = (value: string) => String(value || 'manager')
  .trim()
  .toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, '_')
  .replace(/^_+|_+$/g, '') || 'manager';

const normalizeAuthEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const parseContactDate = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate();
  if (typeof maybeTimestamp.seconds === 'number') return new Date(maybeTimestamp.seconds * 1000);
  return null;
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

const isPaidTochkaStatus = isConfirmedPaymentStatus;

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
  const options = mergeOptions(items, fallback);
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

function getOrderPaymentDue(order: Partial<OrderData>): number {
  return getInitialInvoiceAmount(order);
}

function getOrderFinalPaymentAmount(order: Partial<OrderData>): number {
  const stored = Number(order.finalPaymentAmount) || 0;
  return order.finalPaymentUrl && stored > 0 ? stored : getPlannedFinalPaymentAmount(order);
}

function hasIssuedMainInvoice(order: Partial<OrderData>): boolean {
  return Boolean(order.paymentUrl || order.paymentId);
}

function updatePlannedInvoiceAmount(
  order: Partial<OrderData>,
  updateOrderData: (id: string, field: string, value: any) => void,
  amount: number,
) {
  if (!order.orderId || hasIssuedMainInvoice(order)) return;
  updateOrderData(order.orderId, 'paidAmount', amount);
  updateOrderData(order.orderId, 'initialPaymentAmount', amount);
  updateOrderData(order.orderId, 'paymentAccountingVersion', 2);
}

function getInvoiceAmount(order: Partial<Pick<OrderData, 'revenue' | 'deliveryPrice' | 'invoiceType'>>): number {
  const total = Math.max(0, (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0));
  if (order.invoiceType === 'fitting') return 2000;
  return order.invoiceType === 'full' ? total : total * 0.5;
}

function getInvoiceTypeFromPaymentType(paymentType?: string): 'prepayment' | 'full' | 'fitting' {
  const value = String(paymentType || '').toLowerCase();
  if (value.includes('пример')) return 'fitting';
  if (value.includes('полн') || value.includes('100') || value.includes('сплит')) return 'full';
  return 'prepayment';
}

function isYandexSplitPayment(paymentType?: string): boolean {
  return String(paymentType || '').toLowerCase().includes('сплит');
}

function getPaymentCreateEndpoint(paymentType?: string): string {
  return isYandexSplitPayment(paymentType) ? '/api/yandex-pay/create-payment' : '/api/tochka/create-payment';
}

function getPaymentFindEndpoint(paymentType?: string): string {
  return isYandexSplitPayment(paymentType) ? '/api/yandex-pay/find-payment' : '/api/tochka/find-payment';
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

const buildCustomerOrderDocumentHtml = (order: OrderData) => {
  const items = getOrderItems(order);
  const prices = getOrderItemPrices(order);
  const colors = getOrderItemColors(order);
  const sizes = getOrderItemSizes(order);
  const heights = getOrderItemHeights(order);
  const instagram = normalizeInstagramUsername(order.clientInsta);
  const total = (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0);
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const invoiceAmount = Number(order.paidAmount) || getInvoiceAmount({
    revenue: Number(order.revenue) || 0,
    deliveryPrice: Number(order.deliveryPrice) || 0,
    invoiceType,
  });
  const rows = (items.length ? items : ['Заказ']).map((item, index) => `
    <tr>
      <td>
        <strong>${escapePrintHtml(item)}</strong>
        <span>${escapePrintHtml([colors[index], sizes[index], heights[index]].filter(Boolean).join(' · ') || '—')}</span>
      </td>
      <td>1</td>
      <td>${escapePrintHtml(formatCurrency(prices[index] || (items.length === 1 ? order.revenue : 0)))}</td>
    </tr>
  `).join('');
  const paymentUrl = order.paymentUrl || buildPaymentPageUrl(order.orderId);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Заказ ${escapePrintHtml(order.orderId)} · YAASBAE</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#f5f5f7;color:#1f2937;font-family:Inter,Arial,sans-serif}
    .sheet{width:210mm;min-height:297mm;margin:20px auto;padding:18mm;background:#fff}
    header{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid #1f2937;padding-bottom:18px}
    .brand{font-size:28px;font-weight:900;letter-spacing:.18em}.muted{color:#6b7280}.right{text-align:right}
    h1{margin:28px 0 6px;font-size:34px;letter-spacing:-.03em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}
    .card{border:1px solid #e5e7eb;border-radius:12px;padding:14px}.label{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af}
    .value{margin-top:7px;font-size:14px;font-weight:700;line-height:1.45}.value a{color:#6262d9;text-decoration:none}
    table{width:100%;border-collapse:collapse;margin-top:24px}th{padding:10px 8px;border-bottom:1px solid #d1d5db;text-align:left;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#9ca3af}
    td{padding:14px 8px;border-bottom:1px solid #e5e7eb;font-size:13px}td:nth-child(2),td:nth-child(3),th:nth-child(2),th:nth-child(3){text-align:right}td span{display:block;margin-top:4px;color:#6b7280;font-size:11px}
    .totals{width:310px;margin:24px 0 0 auto}.line{display:flex;justify-content:space-between;padding:8px 0;font-size:13px}.line.total{margin-top:6px;border-top:2px solid #1f2937;padding-top:14px;font-size:18px;font-weight:900}
    .payment{margin-top:28px;border:1px solid #d7d7f5;border-radius:12px;background:#f5f5ff;padding:16px}.payment a{color:#4f46e5;font-weight:800;word-break:break-all}
    footer{margin-top:36px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10px;display:flex;justify-content:space-between}
    @page{size:A4;margin:0}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none}}
  </style>
</head>
<body><main class="sheet">
  <header><div><div class="brand">YAASBAE</div><div class="muted">Документ заказа</div></div><div class="right"><strong>№ ${escapePrintHtml(order.orderId)}</strong><div class="muted">${escapePrintHtml(order.date.toLocaleDateString('ru-RU'))}</div></div></header>
  <h1>Заказ клиента</h1><div class="muted">Состав, доставка и сумма к оплате</div>
  <section class="grid">
    <div class="card"><div class="label">Клиент</div><div class="value">${escapePrintHtml(order.clientName || '—')}<br>${order.clientPhone ? `+${escapePrintHtml(order.clientPhone)}` : '—'}${instagram ? `<br><a href="${getInstagramProfileUrl(instagram)}">@${escapePrintHtml(instagram)}</a>` : ''}</div></div>
    <div class="card"><div class="label">Доставка</div><div class="value">${escapePrintHtml(order.deliveryMethod || '—')}<br>${escapePrintHtml(order.clientAddress || order.clientCity || '—')}${order.cdekNumber ? `<br>Накладная СДЭК № ${escapePrintHtml(order.cdekNumber)}` : ''}</div></div>
  </section>
  <table><thead><tr><th>Наименование</th><th>Количество</th><th>Стоимость</th></tr></thead><tbody>${rows}</tbody></table>
  <section class="totals"><div class="line"><span>Изделия</span><strong>${escapePrintHtml(formatCurrency(order.revenue || 0))}</strong></div><div class="line"><span>Доставка</span><strong>${escapePrintHtml(formatCurrency(order.deliveryPrice || 0))}</strong></div><div class="line total"><span>Итого</span><span>${escapePrintHtml(formatCurrency(total))}</span></div><div class="line"><span>${escapePrintHtml(getInvoicePaymentLabel(invoiceType))}</span><strong>${escapePrintHtml(formatCurrency(invoiceAmount))}</strong></div></section>
  <section class="payment"><div class="label">Ссылка на оплату</div><div class="value"><a href="${escapePrintHtml(paymentUrl)}">${escapePrintHtml(paymentUrl)}</a></div></section>
  <footer><span>YAASBAE · заказ сформирован в CRM</span><span>${escapePrintHtml(new Date().toLocaleString('ru-RU'))}</span></footer>
</main></body></html>`;
};

const printCustomerOrderDocument = (order: OrderData) => {
  const printWindow = window.open('', '_blank', 'width=920,height=900');
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(buildCustomerOrderDocumentHtml(order));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 300);
};

const shareCustomerOrderDocument = async (order: OrderData) => {
  const html = buildCustomerOrderDocumentHtml(order);
  const file = new File([html], `YAASBAE-order-${order.orderId}.html`, { type: 'text/html' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData & { files?: File[] }) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: `YAASBAE · заказ ${order.orderId}`, text: `Документ заказа № ${order.orderId}`, files: [file] });
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
};

const fetchPreparedPdf = async (
  url: string,
  fallbackError: string,
  onStatus?: (message: string) => void,
): Promise<Blob> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: 'application/pdf, application/json' } });
    if (response.status === 202) {
      const payload = await response.json().catch(() => null);
      onStatus?.(payload?.message || 'СДЭК готовит накладную…');
      await new Promise(resolve => window.setTimeout(resolve, Number(payload?.retryAfterMs) || 2000));
      continue;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(getApiErrorMessage(payload, fallbackError));
    }
    const blob = await response.blob();
    if (!blob.type.includes('pdf')) throw new Error(fallbackError);
    return blob;
  }
  throw new Error('СДЭК всё ещё готовит накладную. Попробуйте ещё раз через минуту.');
};

const downloadPdfBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const printPdfBlob = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.src = url;
  frame.onload = () => {
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 250);
  };
  document.body.appendChild(frame);
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
};

const fetchCustomerOrderPdfById = (
  orderId: string,
  onStatus?: (message: string) => void,
) => fetchPreparedPdf(
  `/api/orders/${encodeURIComponent(orderId)}/document.pdf`,
  'Не удалось сформировать PDF',
  onStatus,
);

const downloadCustomerOrderPdfById = async (
  orderId: string,
  onStatus?: (message: string) => void,
) => {
  const blob = await fetchCustomerOrderPdfById(orderId, onStatus);
  downloadPdfBlob(blob, `YAASBAE-order-${orderId}.pdf`);
};

const printCustomerOrderPdfById = async (
  orderId: string,
  onStatus?: (message: string) => void,
) => {
  const blob = await fetchCustomerOrderPdfById(orderId, onStatus);
  printPdfBlob(blob);
};

const shareCustomerOrderPdfById = async (
  orderId: string,
  onStatus?: (message: string) => void,
  paymentText = '',
) => {
  const blob = await fetchCustomerOrderPdfById(orderId, onStatus);
  const file = new File([blob], `YAASBAE-order-${orderId}.pdf`, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData & { files?: File[] }) => boolean };
  const canShareFile = Boolean(nav.share && nav.canShare?.({ files: [file] }));

  if (canShareFile && nav.share) {
    onStatus?.('Выберите Telegram и отправьте PDF…');
    await nav.share({ files: [file] });
    if (paymentText) {
      onStatus?.('Теперь отправьте клиенту текст оплаты…');
      try {
        await nav.share({ text: paymentText });
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        await navigator.clipboard?.writeText(paymentText).catch(() => {});
        onStatus?.('PDF отправлен. Текст оплаты скопирован — вставьте его следующим сообщением.');
      }
    }
    return;
  }

  downloadPdfBlob(file, file.name);
  if (paymentText && nav.share) {
    onStatus?.('PDF скачан. Отправьте клиенту текст оплаты…');
    await nav.share({ text: paymentText });
    return;
  }
  if (paymentText) {
    await navigator.clipboard?.writeText(paymentText).catch(() => {});
    onStatus?.('PDF скачан, текст оплаты скопирован.');
  }
};

const shareCustomerOrderPdf = async (order: OrderData, onStatus?: (message: string) => void) => {
  const paymentUrl = order.paymentUrl || buildPaymentPageUrl(order.orderId);
  return shareCustomerOrderPdfById(order.orderId, onStatus, buildOrderShareText(order, paymentUrl));
};

function getShortPaymentLabel(invoiceType?: 'prepayment' | 'full' | 'fitting'): string {
  if (invoiceType === 'fitting') return 'Примерка СДЭК';
  if (invoiceType === 'full') return 'Полная оплата';
  return 'Предоплата';
}

function buildPaymentPageUrl(orderId: string): string {
  return `${window.location.origin}/pay/${orderId}`;
}

function getOrderInstagramShareUrl(order: Partial<OrderData>): string {
  const username = normalizeInstagramUsername(order.clientInsta);
  return username ? getInstagramProfileUrl(username) : '';
}

function getOrderCdekShareAddress(order: Partial<OrderData>): string {
  if (!String(order.deliveryMethod || '').toLowerCase().includes('сдэк')) return '';
  const payload = order.cdekPayload || {};
  const address = String(
    order.clientAddress
    || payload.deliveryPointAddress
    || payload.toAddress
    || '',
  ).trim();
  const city = String(order.clientCity || payload.toCity || '').trim();
  if (!address) return city;
  if (!city || address.toLowerCase().includes(city.toLowerCase())) return address;
  return `${city}, ${address}`;
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
  const instagramUrl = getOrderInstagramShareUrl(order);
  const cdekAddress = getOrderCdekShareAddress(order);
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
    instagramUrl ? `Instagram: ${instagramUrl}` : '',
    cdekAddress ? `Адрес СДЭК: ${cdekAddress}` : '',
    '',
    `Сумма: ${formatCurrency(amount)}`,
    `Ссылка на оплату ${isYandexSplitPayment(order.paymentType) ? 'Яндекс Сплит' : 'СБП'}: ${paymentUrl}`,
  ];

  return lines.filter((line, index, arr) => line || arr[index - 1]).join('\n').trim();
}

function buildPaymentShareText(order: Partial<OrderData>, paymentUrl: string, amount: number, label = 'Счет на оплату'): string {
  const itemsText = joinOrderItems(getOrderItems(order));
  const instagramUrl = getOrderInstagramShareUrl(order);
  const cdekAddress = getOrderCdekShareAddress(order);
  const lines = [
    `Здравствуйте! ${label} заказа #${order.orderId || ''}`,
    '',
    itemsText ? `Модель: ${itemsText}` : '',
    order.deliveryMethod ? `Доставка: ${order.deliveryMethod}` : '',
    order.clientName ? `ФИО: ${order.clientName}` : '',
    order.clientPhone ? `Телефон: ${order.clientPhone}` : '',
    instagramUrl ? `Instagram: ${instagramUrl}` : '',
    cdekAddress ? `Адрес СДЭК: ${cdekAddress}` : '',
    '',
    `Сумма: ${formatCurrency(amount)}`,
    `Ссылка на оплату ${isYandexSplitPayment(order.paymentType) ? 'Яндекс Сплит' : 'СБП'}: ${paymentUrl}`,
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
  const isSplitPayment = isYandexSplitPayment(order.paymentType);
  const paymentProviderLabel = isSplitPayment ? 'Яндекс Сплит' : 'СБП';
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const mainPaymentPaid = isPaidTochkaStatus(order.paymentStatus || '');
  const finalPaymentPaid = isPaidTochkaStatus(order.finalPaymentStatus || '');
  const initialAmount = getOrderPaymentDue(order);
  const finalAmount = getOrderFinalPaymentAmount(order);
  const showFinalPayment = finalAmount > 0 && (
    invoiceType !== 'full' || Boolean(order.finalPaymentUrl) || getInitialInvoiceAmount(order) < getOrderTotalAmount(order)
  );
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
  const invoiceMissingFields = useMemo(() => {
    const missing: string[] = [];
    const items = getOrderItems(order);
    const colors = getOrderItemColors(order);
    const sizes = getOrderItemSizes(order);
    const heights = getOrderItemHeights(order);
    if (!String(order.orderId || '').trim()) missing.push('ID заказа');
    if (!String(order.clientName || '').trim()) missing.push('ФИО');
    if (getContactPhone({ phone: order.clientPhone }).length < 10) missing.push('телефон');
    if (!String(order.manager || '').trim()) missing.push('менеджер');
    if (!String(order.source || '').trim()) missing.push('источник');
    if (!String(order.deliveryMethod || '').trim()) missing.push('доставка');
    if (!String(order.paymentType || '').trim()) missing.push('тип оплаты');
    if (!items.length) missing.push('изделие');
    if (items.some((_, index) => !colors[index])) missing.push('цвет');
    if (items.some((_, index) => !sizes[index])) missing.push('размер');
    if (items.some((_, index) => !heights[index])) missing.push('рост');
    if ((Number(order.revenue) || 0) <= 0) missing.push('стоимость');
    if (String(order.deliveryMethod || '').toLowerCase().includes('сдэк')) {
      if (!String(order.clientCity || order.cdekPayload?.toCity || '').trim()) missing.push('город СДЭК');
      if (!String(order.clientAddress || order.cdekPayload?.deliveryPoint || order.cdekPayload?.toAddress || '').trim()) missing.push('адрес или ПВЗ');
      if (!order.cdekUuid && !order.cdekNumber) missing.push('накладная СДЭК');
    }
    return Array.from(new Set(missing));
  }, [order]);

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
      const res = await fetch(`${getPaymentFindEndpoint(order.paymentType)}?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Оплата в ${paymentProviderLabel} не найдена`);
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
      if (isFinal) setFinalError(e.message || `Оплата в ${paymentProviderLabel} не найдена`);
      else setError(e.message || `Оплата в ${paymentProviderLabel} не найдена`);
    } finally {
      setRefreshingFinal(false);
      setRefreshingMain(false);
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      if (invoiceMissingFields.length) throw new Error(`Заполните: ${invoiceMissingFields.join(', ')}`);
      const amount = getOrderPaymentDue(order);
      if (amount <= 0) throw new Error('Остаток к оплате 0 ₽');
      const res = await fetch(getPaymentCreateEndpoint(order.paymentType), {
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
        updateOrderData(order.orderId, 'initialPaymentAmount', amount);
        updateOrderData(order.orderId, 'paymentAccountingVersion', 2);
        if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
        if (data.provider) updateOrderData(order.orderId, 'paymentProvider', data.provider);
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
      if (invoiceMissingFields.length) throw new Error(`Заполните: ${invoiceMissingFields.join(', ')}`);
      if (!mainPaymentPaid) throw new Error('Сначала дождитесь подтверждения первой оплаты');
      if (finalAmount <= 0) throw new Error('Сумма доплаты 0 ₽');
      const res = await fetch(getPaymentCreateEndpoint(order.paymentType), {
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
        if (data.provider) updateOrderData(order.orderId, 'finalPaymentProvider', data.provider);
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
          disabled={loading || invoiceMissingFields.length > 0}
          title={invoiceMissingFields.length ? `Заполните: ${invoiceMissingFields.join(', ')}` : 'Создать счёт'}
          className="w-full text-[8px] font-black py-1 rounded-md border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {loading ? <RefreshCcw size={8} className="animate-spin" /> : <QrCodeIcon size={8} />}
          {loading ? 'Создаём...' : 'Создать счёт'}
        </button>
        {invoiceMissingFields.length > 0 && (
          <p className="text-[8px] font-bold leading-3 text-amber-600">Заполните: {invoiceMissingFields.join(', ')}</p>
        )}
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
            className={cn(
              "w-full rounded-md border py-1.5 text-[8px] font-black uppercase tracking-wide transition-all flex items-center justify-center gap-1",
              isSplitPayment
                ? "border-zinc-900 bg-zinc-950 text-white hover:bg-black"
                : "border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-500 hover:text-white hover:border-violet-500"
            )}
          >
            {isSplitPayment ? <SplitMark /> : <Send size={8} />} {isSplitPayment ? 'Яндекс Сплит' : 'Отправить ссылку СБП'}
          </button>
          <button
            onClick={() => setShowQr(v => !v)}
            className="w-full text-[8px] font-black py-1 rounded-md border border-[#6B4DFF]/20 bg-[#6B4DFF] text-white hover:bg-[#5738F3] transition-all flex items-center justify-center gap-1"
          >
            <QrCodeIcon size={8} /> {showQr ? 'Скрыть QR' : 'QR-код Точка'}
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
              disabled={finalLoading || invoiceMissingFields.length > 0 || !mainPaymentPaid}
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
  const [deliveryPoint, setDeliveryPoint] = useState(String(saved.deliveryPoint || inferCdekPointCode(order.clientAddress)));
  const [deliveryPointQuery, setDeliveryPointQuery] = useState(String(order.clientAddress || saved.deliveryPoint || ''));
  const [pointsRequested, setPointsRequested] = useState(false);
  const [showDeliveryPoints, setShowDeliveryPoints] = useState(false);
  const [toAddress, setToAddress] = useState(String(saved.toAddress || order.clientAddress || ''));
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
  const [documentLoading, setDocumentLoading] = useState(false);
  const [waybillLoading, setWaybillLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [settingsChecked, setSettingsChecked] = useState(false);
  const [editing, setEditing] = useState(false);
  const autoCreateAttemptedRef = useRef(false);
  const clientCitySyncedRef = useRef(false);
  const syncedPointCodeRef = useRef('');
  const pointLookupAttemptRef = useRef('');
  const savedPayloadRef = useRef<Record<string, any>>(saved);

  useEffect(() => {
    savedPayloadRef.current = saved;
  }, [saved]);

  useEffect(() => {
    const nextDeliveryType = String(saved.deliveryType || initialDeliveryType || 'pvz');
    setDeliveryType(nextDeliveryType);
    setCityQuery(String(saved.toCity || order.clientCity || ''));
    setToCityCode(String(saved.toCityCode || ''));
    setDeliveryPoint(String(saved.deliveryPoint || inferCdekPointCode(order.clientAddress)));
    setDeliveryPointQuery(String(order.clientAddress || saved.deliveryPoint || ''));
    setToAddress(String(saved.toAddress || order.clientAddress || ''));
    setWeight(String(saved.weight || parsePackageNumber(product?.weight, 700)));
    setLength(String(saved.length || 30));
    setWidth(String(saved.width || 20));
    setHeight(String(saved.height || 10));
    setTariffCode(String(saved.tariffCode || (nextDeliveryType === 'door' ? 139 : 138)));
  }, [
    initialDeliveryType, order.clientAddress, order.clientCity, product?.weight,
    saved.deliveryPoint, saved.deliveryType, saved.height, saved.length, saved.tariffCode,
    saved.toAddress, saved.toCity, saved.toCityCode, saved.weight, saved.width,
  ]);

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
    if (q.length < 2 || toCityCode) {
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
  }, [cityQuery, toCityCode]);

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
        const nextPoints = Array.isArray(data) ? data : [];
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
    const cityLabel = `${city.city}${city.region ? `, ${city.region}` : ''}`;
    setToCityCode(String(city.code));
    setCityQuery(cityLabel);
    setDeliveryPoint('');
    setDeliveryPointQuery('');
    setToAddress('');
    syncedPointCodeRef.current = '';
    pointLookupAttemptRef.current = '';
    setPointsRequested(false);
    setCities([]);
    updateOrderData(order.orderId, 'clientCity', cityLabel);
    updateOrderData(order.orderId, 'clientAddress', '');
    persistPayload({
      toCityCode: String(city.code),
      toCity: cityLabel,
      deliveryPoint: '',
      deliveryPointAddress: '',
      toAddress: '',
    });
  };

  const getPointLabel = (point: CdekDeliveryPoint) => {
    const address = point.address || point.location?.address || point.code;
    return `${point.name || point.code} · ${address}`;
  };

  const selectedPoint = useMemo(
    () => points.find(item => item.code === deliveryPoint),
    [points, deliveryPoint],
  );
  const selectedPointLabel = selectedPoint ? getPointLabel(selectedPoint) : deliveryPointQuery;

  const filteredPoints = useMemo(() => {
    const query = deliveryPointQuery.trim().toLowerCase();
    if (!query) return points.slice(0, 20);
    return points
      .filter(point => getPointLabel(point).toLowerCase().includes(query))
      .slice(0, 20);
  }, [points, deliveryPointQuery]);

  const selectDeliveryPoint = (point: CdekDeliveryPoint) => {
    const pointLabel = getPointLabel(point);
    setDeliveryPoint(point.code);
    setDeliveryPointQuery(pointLabel);
    setShowDeliveryPoints(false);
    syncedPointCodeRef.current = point.code;
    updateOrderData(order.orderId, 'clientCity', cityQuery);
    updateOrderData(order.orderId, 'clientAddress', pointLabel);
    persistPayload({
      toCityCode,
      toCity: cityQuery,
      deliveryPoint: point.code,
      deliveryPointAddress: pointLabel,
      toAddress: '',
    });
  };

  const persistPayload = (patch: Record<string, any>) => {
    const nextPayload = { ...savedPayloadRef.current, ...patch };
    savedPayloadRef.current = nextPayload;
    updateOrderData(order.orderId, 'cdekPayload', nextPayload);
  };

  useEffect(() => {
    if (!deliveryPoint || selectedPoint || pointLookupAttemptRef.current === deliveryPoint) return;
    pointLookupAttemptRef.current = deliveryPoint;
    const controller = new AbortController();
    fetch(`/api/cdek/deliverypoint?code=${encodeURIComponent(deliveryPoint)}`, { signal: controller.signal })
      .then(async response => {
        const point = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(point, 'ПВЗ СДЭК не найден'));
        setPoints(current => {
          if (current.some(item => item.code === point.code)) return current;
          const next = [point, ...current];
          if (toCityCode) cdekPointsCache.set(String(toCityCode), next);
          return next;
        });
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setError(error.message || 'Не удалось получить адрес ПВЗ СДЭК');
      });
    return () => controller.abort();
  }, [deliveryPoint, selectedPoint, toCityCode]);

  useEffect(() => {
    if (clientCitySyncedRef.current) return;
    clientCitySyncedRef.current = true;
    const savedCity = String(saved.toCity || '').trim();
    if (savedCity && savedCity !== String(order.clientCity || '').trim()) {
      updateOrderData(order.orderId, 'clientCity', savedCity);
    }
  }, [order.clientCity, order.orderId, saved.toCity, updateOrderData]);

  useEffect(() => {
    if (!selectedPoint || !deliveryPoint) return;
    if (syncedPointCodeRef.current === deliveryPoint) return;
    syncedPointCodeRef.current = deliveryPoint;
    const pointLabel = getPointLabel(selectedPoint);
    if (pointLabel !== String(order.clientAddress || '').trim()) {
      setDeliveryPointQuery(pointLabel);
      updateOrderData(order.orderId, 'clientAddress', pointLabel);
      persistPayload({ deliveryPointAddress: pointLabel });
    }
  }, [deliveryPoint, order.clientAddress, order.orderId, selectedPoint, updateOrderData]);

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
        deliveryCost: Number(order.deliveryPrice) || 0,
        tariffCode,
        deliveryType,
        toCityCode,
        toCity: cityQuery,
        deliveryPoint,
        deliveryPointAddress: deliveryType === 'pvz' ? selectedPointLabel : '',
        toAddress,
        weight,
        length,
        width,
        height,
        comment: `CRM заказ #${order.orderId}. Товар: ${formatCurrency(Number(order.revenue) || 0)}. Доставка: ${formatCurrency(Number(order.deliveryPrice) || 0)}. ${String(order.paymentType || '').toLowerCase().includes('налож') ? 'Оплата при получении' : 'Оплачивается онлайн'}`,
      };
      if (!payload.recipientName || !payload.recipientPhone) throw new Error('Нужны ФИО и телефон клиента');
      if (deliveryType === 'pvz' && !toCityCode) throw new Error('Выберите город СДЭК из подсказки');
      if (deliveryType === 'pvz' && !deliveryPoint) throw new Error('Выберите ПВЗ СДЭК');
      if (deliveryType === 'door' && !toAddress) throw new Error('Укажите адрес доставки');

      updateOrderData(order.orderId, 'clientCity', cityQuery);
      updateOrderData(
        order.orderId,
        'clientAddress',
        deliveryType === 'pvz' ? selectedPointLabel : toAddress,
      );
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
      updateOrderData(order.orderId, 'cdekStatus', data.updated ? 'updated' : 'created');
      let nextStatusText = data.updated
        ? `Накладная № ${data.cdekNumber || order.cdekNumber || shortCdekId(data.cdekUuid || order.cdekUuid || '')} обновлена`
        : data.cdekNumber
          ? `Накладная: ${data.cdekNumber}`
          : `Создан. ID: ${shortCdekId(data.cdekUuid || '')}`;
      if (!order.paymentUrl) {
        try {
          const amount = getOrderPaymentDue(order);
          if (amount > 0) {
            const paymentResponse = await fetch(getPaymentCreateEndpoint(order.paymentType), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: order.orderId,
                amount,
                description: `Заказ #${order.orderId} ${order.item || ''}`,
              }),
            });
            const paymentData = await paymentResponse.json();
            if (paymentResponse.ok && paymentData.paymentUrl) {
              updateOrderData(order.orderId, 'paymentUrl', paymentData.paymentUrl);
              updateOrderData(order.orderId, 'paymentAmount', amount);
              if (paymentData.paymentId) updateOrderData(order.orderId, 'paymentId', paymentData.paymentId);
              nextStatusText += ' · счёт создан';
            }
          }
        } catch {
          // Накладная уже создана; счёт можно повторно создать отдельной кнопкой в блоке оплаты.
        }
      }
      setStatusText(nextStatusText);
      setEditing(false);
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

  const handleShareDocuments = async () => {
    setDocumentLoading(true);
    setError('');
    setStatusText('Формируем комплект документов…');
    try {
      await shareCustomerOrderPdf(order, message => setStatusText(message));
      setStatusText('Комплект документов готов');
    } catch (e: any) {
      setError(e.message || 'Не удалось сформировать комплект документов');
      setStatusText('');
    } finally {
      setDocumentLoading(false);
    }
  };

  const handleDownloadWaybill = async () => {
    if (!order.cdekUuid) return;
    setWaybillLoading(true);
    setError('');
    setStatusText('СДЭК готовит накладную…');
    try {
      const blob = await fetchPreparedPdf(
        `/api/cdek/order/${encodeURIComponent(order.cdekUuid)}/waybill.pdf?orderId=${encodeURIComponent(order.orderId)}`,
        'Не удалось получить накладную СДЭК',
        message => setStatusText(message),
      );
      downloadPdfBlob(blob, `cdek-${order.orderId}.pdf`);
      setStatusText('Накладная СДЭК готова');
    } catch (e: any) {
      setError(e.message || 'Не удалось получить накладную СДЭК');
      setStatusText('');
    } finally {
      setWaybillLoading(false);
    }
  };

  const handlePrintWaybill = async () => {
    if (!order.cdekUuid) return;
    setWaybillLoading(true);
    setError('');
    setStatusText('СДЭК готовит накладную к печати…');
    try {
      const blob = await fetchPreparedPdf(
        `/api/cdek/order/${encodeURIComponent(order.cdekUuid)}/waybill.pdf?orderId=${encodeURIComponent(order.orderId)}`,
        'Не удалось получить накладную СДЭК',
        message => setStatusText(message),
      );
      printPdfBlob(blob);
      setStatusText('Открыто окно печати накладной');
    } catch (e: any) {
      setError(e.message || 'Не удалось распечатать накладную СДЭК');
      setStatusText('');
    } finally {
      setWaybillLoading(false);
    }
  };

  const hasPreparedData = Boolean(
    toCityCode
    && (deliveryType === 'pvz' ? deliveryPoint : toAddress)
    && Number(weight) > 0
  );

  useEffect(() => {
    if (!settingsChecked || order.cdekUuid || !hasPreparedData || autoCreateAttemptedRef.current) return;
    const timer = window.setTimeout(() => {
      autoCreateAttemptedRef.current = true;
      void createCdekOrder();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [settingsChecked, order.cdekUuid, hasPreparedData]);

  if (!editing && (order.cdekUuid || hasPreparedData)) {
    const destination = deliveryType === 'pvz'
      ? (order.clientAddress || deliveryPointQuery || deliveryPoint)
      : (toAddress || order.clientAddress);
    return (
      <div className={cn(
        'rounded-xl border border-zinc-100 bg-zinc-50/70 p-3',
        mobile ? 'space-y-3' : 'space-y-2.5'
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Truck className="h-4 w-4 shrink-0 text-zinc-500" />
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-widest text-zinc-600">Доставка СДЭК</p>
              <p className="mt-0.5 truncate text-[11px] font-bold text-zinc-400">
                {order.cdekNumber ? `Накладная № ${order.cdekNumber}` : order.cdekUuid ? `ID ${shortCdekId(order.cdekUuid)}` : submitting ? 'Создаём накладную автоматически…' : 'Данные готовы'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[10px] font-bold text-zinc-600 transition-colors hover:bg-zinc-100"
          >
            <Pencil className="h-3.5 w-3.5" /> Изменить
          </button>
        </div>

        <div className="rounded-lg border border-zinc-100 bg-white px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
            {deliveryType === 'pvz' ? 'До ПВЗ' : 'Курьером'} · {CDEK_TARIFFS.find(item => item.code === tariffCode)?.label || `тариф ${tariffCode}`}
          </p>
          <p className="mt-1.5 text-[12px] font-bold leading-5 text-zinc-700">{cityQuery || order.clientCity || '—'}</p>
          <p className="text-[11px] font-medium leading-5 text-zinc-500">{destination || '—'}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-2.5">
            <div>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-400">Вес</p>
              <p className="mt-1 text-[11px] font-bold text-zinc-700">{weight} г</p>
            </div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-400">Габариты</p>
              <p className="mt-1 text-[11px] font-bold text-zinc-700">{length}×{width}×{height}</p>
            </div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-wider text-zinc-400">Доставка</p>
              <p className="mt-1 text-[11px] font-bold text-zinc-700">{formatCurrency(order.deliveryPrice || 0)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <button
            type="button"
            onClick={handleShareDocuments}
            disabled={documentLoading || waybillLoading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#7D7DE6] px-3 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-[#6F6FE0] disabled:opacity-60"
          >
            {documentLoading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {documentLoading ? 'Готовим документы…' : 'Поделиться комплектом'}
          </button>
          {order.cdekUuid ? (
            <>
              <button
                type="button"
                onClick={handleDownloadWaybill}
                disabled={documentLoading || waybillLoading}
                className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60"
                title="Скачать накладную СДЭК"
              >
                {waybillLoading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={handlePrintWaybill}
                disabled={documentLoading || waybillLoading}
                className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60"
                title="Распечатать накладную СДЭК"
              >
                {waybillLoading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={createCdekOrder}
              disabled={submitting || !settingsChecked}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-black disabled:opacity-50"
            >
              {submitting ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Создаём…' : 'Повторить создание'}
            </button>
          )}
        </div>
        {error && <p className="text-[11px] font-bold leading-4 text-red-500">{error}</p>}
        {statusText && <p className="text-[11px] font-bold text-emerald-600">{statusText}</p>}
      </div>
    );
  }

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
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-900">Отмена</button>
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
              const nextCity = e.target.value;
              setCityQuery(nextCity);
              setToCityCode('');
              setDeliveryPoint('');
              setDeliveryPointQuery('');
              setToAddress('');
              setPoints([]);
              setPointsRequested(false);
              syncedPointCodeRef.current = '';
              pointLookupAttemptRef.current = '';
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
        <input
          value={toAddress}
          onChange={e => {
            const nextAddress = e.target.value;
            setToAddress(nextAddress);
            updateOrderData(order.orderId, 'clientCity', cityQuery);
            updateOrderData(order.orderId, 'clientAddress', nextAddress);
            persistPayload({
              toCityCode,
              toCity: cityQuery,
              deliveryPoint: '',
              deliveryPointAddress: '',
              toAddress: nextAddress,
            });
          }}
          placeholder="Адрес доставки"
          className={cn(inputClass, mobile && 'col-span-2')}
        />
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
          {submitting
            ? order.cdekUuid ? 'Обновляю...' : 'Создаю...'
            : order.cdekUuid ? 'Сохранить изменения' : 'Создать накладную'}
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
  onTogglePin,
  onSelectChange,
  updateOrderData,
  handbookStatuses,
}: {
  order: OrderData;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  onSelectChange: (checked: boolean) => void;
  updateOrderData: (id: string, field: string, value: any) => void;
  handbookStatuses: string[];
}) => {
  const [cdekCopied, setCdekCopied] = useState(false);
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
  const cdekAddress = getOrderCdekShareAddress(order);
  const cdekNumber = String(order.cdekNumber || '').trim();
  const cdekClientText = [
    `Заказ #${displayOrderId}`,
    cdekNumber ? `Накладная СДЭК № ${cdekNumber}` : '',
    cdekAddress ? `Адрес доставки: ${cdekAddress}` : '',
    cdekNumber ? `Отследить: https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(cdekNumber)}` : '',
  ].filter(Boolean).join('\n');

  const copyCdekClientText = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!cdekClientText) return;
    await navigator.clipboard.writeText(cdekClientText);
    setCdekCopied(true);
    window.setTimeout(() => setCdekCopied(false), 1800);
  };

  return (
    <tr className={cn(
      "yb-order-row group border-b border-zinc-100 bg-white transition-colors hover:bg-zinc-50/60",
      order.isPinned && "bg-amber-50/40 hover:bg-amber-50/60",
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
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600">
            {String(order.clientName || 'К').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="max-w-[180px] truncate text-[13px] font-semibold text-zinc-950">{order.clientName || '—'}</p>
            <p className="mt-1 text-[11px] font-medium text-zinc-400">{order.clientPhone ? `+${order.clientPhone}` : '—'}</p>
            {normalizeInstagramUsername(order.clientInsta) && (
              <a
                href={getInstagramProfileUrl(order.clientInsta)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex max-w-[180px] items-center gap-1 truncate text-[10px] font-medium text-violet-600 hover:underline"
              >
                <Instagram className="h-3 w-3 shrink-0" /> @{normalizeInstagramUsername(order.clientInsta)}
              </a>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-5 align-top">
        <select
          value={order.status || 'Новый'}
          onChange={(event) => updateOrderData(order.orderId, 'status', event.target.value)}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "h-8 w-full max-w-[165px] cursor-pointer rounded-[8px] border border-[#E6E9EF] bg-white px-2.5 text-[10px] font-black uppercase tracking-[0.08em] outline-none transition-colors focus:border-[#5638F4] focus:ring-2 focus:ring-[#5638F4]/10",
            statusTone,
          )}
          aria-label={`Статус заказа ${displayOrderId}`}
        >
          {optionsWithCurrent(handbookStatuses, order.status, STATUS_OPTIONS).map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
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
        {cdekNumber || cdekAddress ? (
          <div className="max-w-[250px]">
            <p className="truncate text-[11px] font-bold text-zinc-700" title={cdekNumber}>
              {cdekNumber ? `Накладная № ${cdekNumber}` : 'Накладная формируется'}
            </p>
            <p className="mt-1.5 line-clamp-2 text-[10px] font-medium leading-4 text-zinc-400" title={cdekAddress}>
              {cdekAddress || 'Адрес не указан'}
            </p>
            <button
              type="button"
              onClick={copyCdekClientText}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#E6E9EF] bg-white px-2 py-1 text-[9px] font-bold text-[#667085] transition-colors hover:border-[#7D7DE6] hover:text-[#5638F4]"
              title="Скопировать данные СДЭК для клиента"
            >
              {cdekCopied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {cdekCopied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        ) : (
          <span className="text-[11px] font-medium text-zinc-300">—</span>
        )}
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
        <div className="inline-flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg border border-transparent transition-colors",
              order.isPinned
                ? "bg-amber-100 text-amber-600 hover:bg-amber-200"
                : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600"
            )}
            title={order.isPinned ? "Открепить важный заказ" : "Закрепить важный заказ"}
            aria-label={order.isPinned ? `Открепить заказ ${displayOrderId}` : `Закрепить заказ ${displayOrderId}`}
            aria-pressed={Boolean(order.isPinned)}
          >
            <Pin className={cn("h-4 w-4", order.isPinned && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "yb-order-expand inline-flex min-h-9 items-center justify-end gap-1.5 rounded-lg border border-transparent px-2 text-zinc-400 transition-all",
              expanded
                ? "bg-zinc-100 text-zinc-950"
                : "hover:bg-zinc-100 hover:text-zinc-950"
            )}
            title={expanded ? "Свернуть заказ" : "Раскрыть заказ"}
          >
            <span className="hidden text-[10px] font-medium xl:inline">{expanded ? 'Свернуть' : 'Открыть'}</span>
            {expanded ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </td>
    </tr>
  );
});

const OrderDetailView: React.FC<{
  order: OrderData;
  productCatalog: ProductCatalogItem[];
  updateOrderData: (id: string, field: string, value: any) => void;
  onEdit: () => void;
  onDone?: () => void;
  onDelete?: (id: string) => void;
  onBack?: () => void;
  mobile?: boolean;
  editing?: boolean;
}> = ({ order, productCatalog, updateOrderData, onEdit, onDone, onDelete, onBack, mobile = false, editing = false }) => {
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const items = getOrderItems(order);
  const prices = getOrderItemPrices(order);
  const colors = getOrderItemColors(order);
  const sizes = getOrderItemSizes(order);
  const heights = getOrderItemHeights(order);
  const revenue = Number(order.revenue) || getItemPricesTotal(prices);
  const deliveryPrice = Number(order.deliveryPrice) || 0;
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const invoiceAmount = getInvoiceAmount({ revenue, deliveryPrice, invoiceType });
  const dueAmount = getOrderPaymentDue({ ...order, revenue, paidAmount: invoiceAmount });
  const saved = order.cdekPayload || {};
  const tariffCode = String(saved.tariffCode || '138');
  const tariff = CDEK_TARIFFS.find(item => item.code === tariffCode)?.label || 'Дверь → ПВЗ';
  const deliveryType = String(saved.deliveryType || '').toLowerCase() === 'door' ? 'До двери' : 'До ПВЗ';
  const plannedDate = addBusinessDays(order.date, 7).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const firstProduct = getProductForOrder(productCatalog, items[0] || order.item);
  const displayOrderId = String(order.orderId || '').replace(/^#+/, '');
  const statusLabel = order.status || 'Новый';
  const statusBadgeClass =
    statusLabel.toLowerCase().includes('оплачен') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
    statusLabel.toLowerCase().includes('отгружен') || statusLabel.toLowerCase().includes('доставлен') ? 'border-blue-200 bg-blue-50 text-blue-700' :
    statusLabel.toLowerCase().includes('возврат') || statusLabel.toLowerCase().includes('отмена') ? 'border-red-200 bg-red-50 text-red-600' :
    'border-violet-200 bg-violet-50 text-violet-700';
  const cardClass = 'rounded-[14px] border border-[#E6E9EF] bg-white shadow-[0_2px_12px_rgba(31,41,55,0.04)]';
  const editControlClass = 'h-10 w-full rounded-[9px] border border-[#D8DCE6] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none transition-colors focus:border-[#5638F4] focus:ring-2 focus:ring-[#5638F4]/10';

  const editField = (field: string, value: unknown, placeholder: string, type: 'text' | 'number' = 'text') => (
    <input
      type={type}
      value={String(value ?? '')}
      placeholder={placeholder}
      onChange={event => updateOrderData(order.orderId, field, type === 'number' ? Number(event.target.value) || 0 : event.target.value)}
      className={editControlClass}
    />
  );

  const editSelect = (field: string, value: unknown, options: string[]) => (
    <select value={String(value || '')} onChange={event => updateOrderData(order.orderId, field, event.target.value)} className={editControlClass}>
      {optionsWithCurrent(options, String(value || '')).map(option => <option key={option} value={option}>{option || '—'}</option>)}
    </select>
  );

  const editInvoiceTypeSelect = () => (
    <select
      value={invoiceType}
      onChange={event => updateOrderData(order.orderId, 'invoiceType', event.target.value)}
      className={editControlClass}
    >
      <option value="full">Полная оплата</option>
      <option value="prepayment">Предоплата 50%</option>
      <option value="fitting">Примерка</option>
    </select>
  );

  const updateItemValue = (field: 'items' | 'itemColors' | 'itemSizes' | 'itemHeights' | 'itemPrices', index: number, value: string | number) => {
    const source = field === 'items' ? items : field === 'itemColors' ? colors : field === 'itemSizes' ? sizes : field === 'itemHeights' ? heights : prices;
    const next = [...source] as Array<string | number>;
    next[index] = value;
    updateOrderData(order.orderId, field, next);
    if (field === 'items') updateOrderData(order.orderId, 'item', joinOrderItems(next.map(String)));
    if (field === 'itemPrices') updateOrderData(order.orderId, 'revenue', getItemPricesTotal(next.map(Number)));
  };

  const addOrderItem = () => {
    const currentItems = items.length ? items : [''];
    const nextItems = [...currentItems, ''];
    const nextPrices = [...currentItems.map((_, index) => Number(prices[index]) || 0), 0];
    const nextColors = [...currentItems.map((_, index) => colors[index] || ''), ''];
    const nextSizes = [...currentItems.map((_, index) => sizes[index] || ''), ''];
    const nextHeights = [...currentItems.map((_, index) => heights[index] || ''), ''];
    updateOrderData(order.orderId, 'items', nextItems);
    updateOrderData(order.orderId, 'itemPrices', nextPrices);
    updateOrderData(order.orderId, 'itemColors', nextColors);
    updateOrderData(order.orderId, 'itemSizes', nextSizes);
    updateOrderData(order.orderId, 'itemHeights', nextHeights);
    updateOrderData(order.orderId, 'item', joinOrderItems(nextItems));
  };

  const removeOrderItem = (indexToRemove: number) => {
    if (items.length <= 1) return;
    const nextItems = items.filter((_, index) => index !== indexToRemove);
    const nextPrices = items.map((_, index) => Number(prices[index]) || 0).filter((_, index) => index !== indexToRemove);
    const nextColors = items.map((_, index) => colors[index] || '').filter((_, index) => index !== indexToRemove);
    const nextSizes = items.map((_, index) => sizes[index] || '').filter((_, index) => index !== indexToRemove);
    const nextHeights = items.map((_, index) => heights[index] || '').filter((_, index) => index !== indexToRemove);
    updateOrderData(order.orderId, 'items', nextItems);
    updateOrderData(order.orderId, 'itemPrices', nextPrices);
    updateOrderData(order.orderId, 'itemColors', nextColors);
    updateOrderData(order.orderId, 'itemSizes', nextSizes);
    updateOrderData(order.orderId, 'itemHeights', nextHeights);
    updateOrderData(order.orderId, 'item', joinOrderItems(nextItems));
    updateOrderData(order.orderId, 'revenue', getItemPricesTotal(nextPrices));
  };

  const handleShare = async () => {
    setDocumentLoading(true);
    setDocumentError('');
    try {
      await shareCustomerOrderPdf(order);
    } catch (error: any) {
      setDocumentError(error?.message || 'Не удалось подготовить документ');
    } finally {
      setDocumentLoading(false);
    }
  };

  const handlePrint = async () => {
    const popup = window.open('', '_blank');
    setDocumentLoading(true);
    setDocumentError('');
    try {
      const blob = await fetchPreparedPdf(
        `/api/orders/${encodeURIComponent(order.orderId)}/document.pdf`,
        'Не удалось подготовить документ',
      );
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.href = url;
      else downloadPdfBlob(blob, `YAASBAE-order-${order.orderId}.pdf`);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      popup?.close();
      setDocumentError(error?.message || 'Не удалось подготовить документ');
    } finally {
      setDocumentLoading(false);
    }
  };

  const sectionTitle = (icon: React.ReactNode, title: string, editable = false) => (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#F1EEFF] text-[#5638F4]">{icon}</span>
        <h3 className="text-[16px] font-semibold text-[#111827]">{title}</h3>
      </div>
      {editable && !mobile && !editing && (
        <button type="button" onClick={onEdit} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[9px] border border-[#E6E9EF] bg-white px-4 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5638F4]/25">
          <Pencil className="h-3.5 w-3.5" /> Изменить
        </button>
      )}
      {mobile && <ChevronRight className="h-5 w-5 text-[#667085]" />}
    </div>
  );

  const valueRow = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[22px_112px_minmax(0,1fr)] items-start gap-2 text-[13px] sm:grid-cols-[22px_118px_minmax(0,1fr)]">
      <span className="mt-0.5 text-[#667085]">{icon}</span>
      <span className="text-[#667085]">{label}</span>
      <span className="min-w-0 font-medium leading-5 text-[#111827]">{value || '—'}</span>
    </div>
  );

  return (
    <div className={cn('bg-[#F7F8FC]', mobile ? 'min-h-screen px-3 pb-5 pt-3' : 'p-4')}>
      {mobile ? (
        <div className="mb-3 flex h-12 items-center justify-between px-1">
          <button type="button" onClick={onBack} className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl text-[#667085] hover:bg-white" aria-label="Назад">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h2 className="text-[17px] font-semibold text-[#111827]">Заказ #{displayOrderId}</h2>
          <button type="button" className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl border border-[#E6E9EF] bg-white text-[#111827]" aria-label="Ещё">
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="mb-4 flex h-11 items-center gap-3 rounded-[12px] border border-[#E6E9EF] bg-white px-5 text-[12px] text-[#667085]">
          <ChevronLeft className="h-4 w-4" /><span>Заказы</span><ChevronRight className="h-3.5 w-3.5 text-[#B6BBC5]"/><span className="font-medium text-[#344054]">#{displayOrderId}</span>
        </div>
      )}

      <div className={cn(cardClass, mobile ? 'border-[#DCD5FF] bg-gradient-to-br from-[#F8F6FF] to-white p-3' : 'flex items-center justify-between gap-5 px-6 py-4')}>
        <div className={cn('flex items-center gap-4', mobile && 'gap-3 px-0 py-0')}>
          <span className={cn('grid shrink-0 place-items-center bg-[#F1EEFF] text-[#5638F4]', mobile ? 'h-12 w-12 rounded-[14px]' : 'h-14 w-14 rounded-[16px]')}>
            <ShoppingBag className={cn(mobile ? 'h-6 w-6' : 'h-7 w-7')} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className={cn('font-semibold tracking-tight text-[#0F172A]', mobile ? 'text-[26px] leading-none' : 'text-[30px] leading-none')}>#{displayOrderId}</h2>
              {editing ? (
                <select
                  value={statusLabel}
                  onChange={event => updateOrderData(order.orderId, 'status', event.target.value)}
                  className={cn('h-8 min-w-[132px] rounded-full border px-3 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[#5638F4]/15', statusBadgeClass)}
                  aria-label="Статус заказа"
                >
                  {optionsWithCurrent(STATUS_OPTIONS, statusLabel).map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              ) : (
                <span className={cn('inline-flex h-7 items-center gap-2 rounded-full border px-3 text-[11px] font-medium', statusBadgeClass)}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" /> {statusLabel}
                </span>
              )}
            </div>
            <p className={cn('mt-1 text-[#667085]', mobile ? 'text-[12px]' : 'text-[13px]')}>Дата заказа: {order.date.toLocaleDateString('ru-RU')}</p>
          </div>
        </div>
        <div className={cn('flex items-center gap-3', mobile && 'mt-3 grid grid-cols-2 gap-2')}>
          <button type="button" onClick={handlePrint} disabled={documentLoading} className={cn('inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#E6E9EF] bg-white px-5 text-[13px] font-medium text-[#111827] transition-colors hover:bg-[#F8FAFC] disabled:opacity-60', mobile && 'order-2 h-10 px-3 text-[12px]')}>
            <Printer className="h-4 w-4" /> Печать
          </button>
          <button type="button" onClick={handleShare} disabled={documentLoading} className={cn('inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[#E6E9EF] bg-white px-5 text-[13px] font-medium text-[#111827] transition-colors hover:bg-[#F8FAFC] disabled:opacity-60', mobile && 'order-1 h-10 px-3 text-[12px]')}>
            <Share2 className="h-4 w-4" /> Поделиться
          </button>
          <button type="button" onClick={editing ? onDone : onEdit} className={cn('inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#5638F4] to-[#4422DC] px-6 text-[13px] font-semibold text-white shadow-[0_6px_18px_rgba(86,56,244,0.22)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5638F4]/30', mobile && 'order-first col-span-2 h-11 text-[13px]')}>
            {editing ? <CheckCircle2 className="h-4 w-4" /> : <Pencil className="h-4 w-4" />} {editing ? 'Готово' : 'Изменить заказ'}
          </button>
          {onDelete && order.isFirebase && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Удалить заказ ${order.orderId}?`)) onDelete(order.orderId);
              }}
              className={cn(
                'inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-red-200 bg-white px-4 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200',
                mobile && 'order-last col-span-2 h-10 bg-red-50/60',
              )}
              title="Удалить заказ"
            >
              <Trash2 className="h-4 w-4" /> Удалить заказ
            </button>
          )}
          {!mobile && <button type="button" className="grid h-11 w-11 cursor-pointer place-items-center rounded-[10px] border border-[#E6E9EF] bg-white text-[#111827]" aria-label="Ещё"><MoreVertical className="h-5 w-5" /></button>}
        </div>
        {documentError && <p className="col-span-full mt-2 text-[11px] font-medium text-red-500">{documentError}</p>}
      </div>

      <div className={cn('mt-4 grid gap-4', mobile ? 'grid-cols-1' : 'grid-cols-[1.05fr_1fr_1.05fr]')}>
        <section className={cn(cardClass, 'p-5')}>
          {sectionTitle(<Users className="h-4 w-4" />, 'Клиент', true)}
          <div className="mt-5 space-y-4">
            {valueRow(<UserCircle className="h-4 w-4" />, 'ФИО', editing ? editField('clientName', order.clientName, 'ФИО клиента') : order.clientName)}
            {valueRow(<Phone className="h-4 w-4" />, 'Телефон', editing ? editField('clientPhone', order.clientPhone, 'Телефон') : <span className="flex items-center justify-between gap-2"><span>{order.clientPhone || '—'}</span>{order.clientPhone && <a href={`tel:+${order.clientPhone}`} className="text-[#667085]"><Phone className="h-4 w-4" /></a>}</span>)}
            {valueRow(<Instagram className="h-4 w-4" />, 'Instagram', editing ? editField('clientInsta', order.clientInsta, 'Ссылка или @username') : normalizeInstagramUsername(order.clientInsta) ? <a href={getInstagramProfileUrl(order.clientInsta)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-[#5638F4] hover:underline"><span>@{normalizeInstagramUsername(order.clientInsta)}</span><ExternalLink className="h-4 w-4 text-[#667085]" /></a> : '—')}
            {valueRow(<MapPin className="h-4 w-4" />, 'Город', editing ? editField('clientCity', order.clientCity, 'Город') : order.clientCity)}
            {valueRow(<MapPin className="h-4 w-4" />, 'Адрес', editing ? editField('clientAddress', order.clientAddress, 'Адрес доставки') : order.clientAddress)}
          </div>
        </section>

        <section className={cn(cardClass, 'p-5')}>
          {sectionTitle(<ShoppingBag className="h-4 w-4" />, 'Товар', true)}
          <div className="mt-5 space-y-4">
            {(items.length ? items : ['—']).map((item, index) => {
              const product = getProductForOrder(productCatalog, item);
              return (
                <div key={`${item}-${index}`} className="flex gap-4 border-b border-[#EEF0F4] pb-4 last:border-0 last:pb-0">
                  <div className="h-[126px] w-[126px] shrink-0 overflow-hidden rounded-[12px] bg-[#F5F5F7]">
                    {product ? <img src={`/api/products/${encodeURIComponent(product.id)}/image`} alt={item} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-[#B6BBC5]"><ShoppingBag className="h-8 w-8" /></div>}
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    {editing ? (
                      <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                        <input list="order-product-options" value={item === '—' ? '' : item} onChange={event => updateItemValue('items', index, event.target.value)} placeholder="Наименование товара" className={editControlClass} />
                        <button
                          type="button"
                          onClick={() => removeOrderItem(index)}
                          disabled={items.length <= 1}
                          className="grid h-10 w-10 place-items-center rounded-[9px] border border-red-100 bg-red-50 text-red-500 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:border-[#E6E9EF] disabled:bg-[#F8FAFC] disabled:text-[#B6BBC5]"
                          title={items.length <= 1 ? 'В заказе должен остаться хотя бы один товар' : 'Удалить товар'}
                          aria-label={`Удалить товар ${index + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : <p className="text-[15px] font-semibold leading-5 text-[#111827]">{item}</p>}
                    <dl className="mt-4 grid grid-cols-[70px_minmax(0,1fr)] gap-y-2 text-[13px]">
                      <dt className="text-[#667085]">Цвет</dt><dd className="font-medium text-[#111827]">{editing ? <input value={colors[index] || ''} onChange={event => updateItemValue('itemColors', index, event.target.value)} className={editControlClass} /> : colors[index] || '—'}</dd>
                      <dt className="text-[#667085]">Размер</dt><dd className="font-medium text-[#111827]">{editing ? <input value={sizes[index] || ''} onChange={event => updateItemValue('itemSizes', index, event.target.value)} className={editControlClass} /> : sizes[index] || '—'}</dd>
                      <dt className="text-[#667085]">Рост</dt><dd className="font-medium text-[#111827]">{editing ? <input value={heights[index] || ''} onChange={event => updateItemValue('itemHeights', index, event.target.value)} className={editControlClass} /> : heights[index] || '—'}</dd>
                      {editing && <><dt className="text-[#667085]">Цена</dt><dd><input type="number" value={prices[index] || ''} onChange={event => updateItemValue('itemPrices', index, Number(event.target.value) || 0)} className={editControlClass} /></dd></>}
                    </dl>
                  </div>
                </div>
              );
            })}
            {editing && (
              <button
                type="button"
                onClick={addOrderItem}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#B9AEFF] bg-[#F8F6FF] px-4 text-[12px] font-semibold text-[#5638F4] transition-colors hover:border-[#7D7DE6] hover:bg-[#F1EEFF]"
              >
                <Plus className="h-4 w-4" /> Добавить ещё товар
              </button>
            )}
          </div>
          <datalist id="order-product-options">{productCatalog.map(product => <option key={product.id} value={product.name} />)}</datalist>
        </section>

        <section className={cn(cardClass, 'p-5')}>
          {sectionTitle(<Wallet className="h-4 w-4" />, 'Оплата и сумма', true)}
          <div className={cn('mt-5 grid', mobile ? 'grid-cols-1 gap-y-5' : 'grid-cols-2 gap-x-6')}>
            <div>
              <div className="flex items-center justify-between gap-3 text-[13px]"><span className="text-[#667085]">Цена товара</span><b className="font-semibold text-[#111827]">{formatCurrency(revenue)}</b></div>
              <div className="mt-3 flex items-center justify-between gap-3 text-[13px]"><span className="text-[#667085]">Доставка</span>{editing ? <div className="w-32">{editField('deliveryPrice', deliveryPrice, 'Доставка', 'number')}</div> : <b className="font-semibold text-[#111827]">{formatCurrency(deliveryPrice)}</b>}</div>
              <div className="my-4 h-px bg-[#E6E9EF]" />
              <div className="flex items-center justify-between text-[17px] font-semibold text-[#5638F4]"><span>К оплате</span><span>{formatCurrency(dueAmount || invoiceAmount)}</span></div>
            </div>
            <dl className={cn(
              'grid grid-cols-[92px_minmax(0,1fr)] content-start gap-y-2 text-[12px]',
              mobile ? 'border-t border-[#E6E9EF] pt-5' : 'border-l border-[#E6E9EF] pl-6',
            )}>
              <dt className="text-[#667085]">Оплата:</dt><dd className="font-medium text-[#111827]">{editing ? editSelect('paymentType', order.paymentType, PAYMENT_TYPE_OPTIONS) : order.paymentType || getInvoicePaymentLabel(invoiceType)}</dd>
              <dt className="text-[#667085]">Тип оплаты:</dt><dd className="font-medium text-[#111827]">{editing ? editInvoiceTypeSelect() : getInvoicePaymentLabel(invoiceType)}</dd>
              <dt className="text-[#667085]">Источник:</dt><dd className="font-medium text-[#111827]">{editing ? editSelect('source', order.source, SOURCE_OPTIONS) : order.source || '—'}</dd>
              <dt className="text-[#667085]">Менеджер:</dt><dd className="font-medium text-[#111827]">{editing ? editField('manager', order.manager, 'Менеджер') : order.manager || '—'}</dd>
              <dt className="text-[#667085]">Блогер:</dt><dd className="font-medium text-[#111827]">{editing ? editField('blogger', order.blogger, 'Блогер') : order.blogger || '—'}</dd>
              <dt className="text-[#667085]">Метка:</dt><dd className="font-medium text-[#111827]">{editing ? editField('label', order.label, 'Метка') : order.label || '—'}</dd>
            </dl>
          </div>
          <div className="mt-5 border-t border-[#E6E9EF] pt-4 [&_button]:!min-h-10 [&_button]:!text-[11px] [&_button]:!font-semibold [&_button]:!rounded-[9px] [&_div]:!text-[10px]">
            <PaymentRowBlock order={order} updateOrderData={updateOrderData} />
          </div>
        </section>
      </div>

      <section className={cn(cardClass, 'mt-4 p-5')}>
        {sectionTitle(<Truck className="h-4 w-4" />, 'Доставка и отгрузка', true)}
        {editing && (
          <div className="mt-5 space-y-4 border-b border-[#E6E9EF] pb-5">
            <div className="grid gap-3">
              <label className="space-y-1.5"><span className="text-[11px] font-medium text-[#667085]">Способ доставки</span>{editSelect('deliveryMethod', order.deliveryMethod, DELIVERY_OPTIONS)}</label>
            </div>
            {String(order.deliveryMethod || '').toLowerCase().includes('сдэк') && (
              <CdekOrderBlock order={order} updateOrderData={updateOrderData} productCatalog={productCatalog} mobile={mobile} />
            )}
          </div>
        )}
        <div className={cn('mt-5 grid gap-0', mobile ? 'grid-cols-1' : 'grid-cols-5')}>
          {[
            ['Способ доставки', order.deliveryMethod || '—'],
            ['Маршрут', `${deliveryType === 'До ПВЗ' ? 'ДО ПВЗ' : 'ДО ДВЕРИ'} · ${tariff.toUpperCase()}`],
            ['Тип доставки', deliveryType],
            ['Плановая дата / дата отгрузки', plannedDate],
            ['Стоимость доставки', formatCurrency(deliveryPrice)],
          ].map(([label, value]) => (
            <div key={label} className={cn('border-[#E6E9EF] py-3', mobile ? 'grid grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] gap-3 border-b last:border-b-0' : 'border-r px-5 first:pl-0 last:border-r-0')}>
              <p className="text-[11px] leading-4 text-[#667085]">{label}</p><p className="mt-2 text-[13px] font-medium text-[#111827]">{value}</p>
            </div>
          ))}
        </div>
        <div className={cn('mt-1 grid border-t border-[#E6E9EF] pt-4', mobile ? 'grid-cols-2 gap-4' : 'grid-cols-[1fr_1.5fr_.7fr_.9fr]')}>
          <div><p className="text-[11px] text-[#667085]">Накладная</p><p className="mt-2 text-[13px] font-medium text-[#111827]">{order.cdekNumber || '—'}</p></div>
          <div><p className="text-[11px] text-[#667085]">Адрес доставки</p><p className="mt-2 whitespace-pre-line text-[13px] font-medium leading-5 text-[#111827]">{order.clientCity ? `${order.clientCity}\n` : ''}{order.clientAddress || '—'}</p></div>
          <div><p className="text-[11px] text-[#667085]">Вес</p><p className="mt-2 text-[13px] font-medium text-[#111827]">{parsePackageNumber(saved.weight || firstProduct?.weight, 700)} г</p></div>
          <div><p className="text-[11px] text-[#667085]">Габариты</p><p className="mt-2 text-[13px] font-medium text-[#111827]">{saved.length || 30}×{saved.width || 20}×{saved.height || 10}</p></div>
        </div>
      </section>

      <section className={cn(cardClass, 'mt-4 px-5 py-4')}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#F1EEFF] text-[#5638F4]"><FileText className="h-4 w-4" /></span><h3 className="text-[14px] font-semibold text-[#111827]">Заметки</h3></div>
          <span className="text-[11px] tabular-nums text-[#667085]">{String(order.notes || '').length} / 500</span>
        </div>
        <textarea value={order.notes || ''} onChange={(event) => updateOrderData(order.orderId, 'notes', event.target.value.slice(0, 500))} maxLength={500} rows={mobile ? 2 : 1} placeholder="Добавить заметку..." className="mt-3 min-h-10 w-full resize-y rounded-[9px] border border-[#E6E9EF] bg-white px-3 py-2.5 text-[13px] text-[#344054] outline-none placeholder:text-[#98A2B3] focus:border-[#5638F4] focus:ring-2 focus:ring-[#5638F4]/10" />
      </section>
    </div>
  );
};

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
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
    updatePlannedInvoiceAmount(order, updateOrderData, invoiceAmount);
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
    updatePlannedInvoiceAmount(order, updateOrderData, invoiceAmount);
  };

  const updateOrderInvoiceType = (value: string) => {
    const invoiceType = getInvoiceTypeFromPaymentType(value);
    const invoiceAmount = getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: order.deliveryPrice || 0,
      invoiceType,
    });
    updateOrderData(order.orderId, 'invoiceType', invoiceType);
    updatePlannedInvoiceAmount(order, updateOrderData, invoiceAmount);
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
    <tr className="border-b border-[#E6E9EF] bg-white">
      <td colSpan={9} className="p-0">
        <div className="min-w-[1180px]">
          <OrderDetailView
            order={order}
            productCatalog={productCatalog}
            updateOrderData={updateOrderData}
            onEdit={() => setIsEditing(true)}
            onDone={() => setIsEditing(false)}
            onDelete={onDelete}
            editing={isEditing}
          />
        </div>
      </td>
    </tr>
  );

  /* Legacy editor retained temporarily for rollback safety; the active editor above uses the unified card layout. */
  /* istanbul ignore next */
  if (false) return null;

  return (
    <tr className={cn(
      "group border-b border-zinc-100 bg-white transition-colors",
      order.isOverdue && !order.isShipped && "bg-red-50/20"
    )}>
      <td colSpan={9} className="px-0 py-0">
        <div className="grid min-w-[1240px] grid-cols-[360px_minmax(880px,1fr)] items-stretch border border-[#E6E9EF] bg-white">
          <aside className="space-y-4 border-r border-[#E6E9EF] bg-[#FCFCFD] p-5">
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[6px] bg-[#5638F4] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#4422DC]"
                >
                  <CheckCircle2 className="h-4 w-4" /> Готово
                </button>
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
              <div className="flex items-center gap-2">
                <Instagram size={16} className="shrink-0 text-zinc-400" />
                {normalizeInstagramUsername(order.clientInsta) ? (
                  <a
                    href={getInstagramProfileUrl(order.clientInsta)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#6262D9] hover:underline"
                    title="Открыть Instagram"
                  >
                    @{normalizeInstagramUsername(order.clientInsta)}
                  </a>
                ) : <span className="min-w-0 flex-1 text-[13px] font-medium text-zinc-400">Instagram не указан</span>}
                <button
                  type="button"
                  onClick={() => {
                    const value = window.prompt('Вставьте ссылку Instagram или @username', order.clientInsta || '');
                    if (value !== null) updateOrderData(order.orderId, 'clientInsta', normalizeInstagramUsername(value));
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-50 text-[#7D7DE6] hover:bg-violet-100"
                  title="Изменить Instagram"
                >
                  <Pencil size={15} />
                </button>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 text-zinc-400" />
                <textarea
                  value={order.clientAddress || ''}
                  onChange={(e) => updateOrderData(order.orderId, 'clientAddress', e.target.value)}
                  placeholder="Адрес клиента или ПВЗ"
                  rows={2}
                  className="min-w-0 flex-1 resize-none bg-transparent text-[13px] font-medium text-[#6B7280] outline-none"
                />
              </div>
            </div>

            <PaymentRowBlock order={order} updateOrderData={updateOrderData} />

            {String(order.deliveryMethod || '').toLowerCase().includes('сдэк') && (
              <CdekOrderBlock order={order} updateOrderData={updateOrderData} productCatalog={productCatalog} mobile />
            )}
          </aside>

          <section className="min-w-0 bg-white px-5 py-5">
            <div className="border-b border-[#E6E9EF] pb-6">
              <div className="grid grid-cols-1 items-start gap-4">
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
                <div className="min-w-0 rounded-[8px] border border-[#E6E9EF] bg-[#F8FAFC]/70 px-4 py-3">
                  <div className="grid min-w-0 grid-cols-3 gap-8">
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

              <div className="my-5 h-px bg-[#E6E9EF]" />

              <div className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-[10px] border border-[#E6E9EF] bg-[#F8FAFC]/60 p-3 xl:grid-cols-5">
                {fieldSelect('Источник', order.source || '', optionsWithCurrent(handbookSources, order.source || '', SOURCE_OPTIONS), (v) => updateOrderData(order.orderId, 'source', v))}
                {fieldSelect('Менеджер', order.manager || '', optionsWithCurrent(handbookManagers, order.manager || ''), (v) => updateOrderData(order.orderId, 'manager', v))}
                {fieldSelect('Блогер', order.blogger || '', optionsWithCurrent(handbookBloggers, order.blogger || ''), (v) => updateOrderData(order.orderId, 'blogger', v))}
                {fieldSelect('Оплата', order.paymentType || '', optionsWithCurrent(handbookPaymentTypes, order.paymentType || '', PAYMENT_TYPE_OPTIONS), (v) => updateOrderData(order.orderId, 'paymentType', v))}
                {fieldSelect('Доставка', order.deliveryMethod || '', optionsWithCurrent(handbookDeliveries, order.deliveryMethod || '', DELIVERY_OPTIONS), (v) => updateOrderData(order.orderId, 'deliveryMethod', v))}
                {fieldSelect('Метка', order.label || '', optionsWithCurrent(handbookLabels, order.label || ''), (v) => updateOrderData(order.orderId, 'label', v))}
                {fieldSelect('Тип оплаты', getInvoicePaymentLabel(liveInvoiceType), INVOICE_PAYMENT_OPTIONS, updateOrderInvoiceType)}
                {financeTile('К оплате', dueAmount, 'due')}
                <div className="min-w-0 self-end">
                  <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] leading-[14px] text-[#9CA3AF]">Срок</span>
                  <span className={cn(
                    "mt-2 block border-b border-[#E6E9EF] pb-2 text-[18px] font-medium tabular-nums",
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
            </div>

            <div className="mt-3 border-t border-[#E6E9EF] pt-3">
              <button
                type="button"
                onClick={() => setNotesExpanded(value => !value)}
                className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-[8px] px-2 text-left transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]/30"
                aria-expanded={notesExpanded}
              >
                <FileText className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6B7280]">Заметка</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#9CA3AF]">
                  {order.notes || 'Добавить заметку к заказу'}
                </span>
                <span className="text-[10px] tabular-nums text-[#B6BBC5]">{String(order.notes || '').length}/500</span>
                <ChevronRight className={cn('h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform', notesExpanded && 'rotate-90')} />
              </button>
              {notesExpanded && (
                <textarea
                  autoFocus
                  value={order.notes || ''}
                  onChange={(e) => updateOrderData(order.orderId, 'notes', e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={3}
                  placeholder="Добавить заметку..."
                  className="mt-2 min-h-[72px] w-full resize-y rounded-[8px] border border-[#E6E9EF] bg-[#F8FAFC]/70 px-3 py-2.5 text-[13px] font-medium leading-5 text-[#4B5563] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#7D7DE6] focus:bg-white"
                />
              )}
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
  onTogglePin,
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
  onTogglePin: () => void;
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
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobilePaymentUrl, setMobilePaymentUrl] = useState(order.paymentUrl || '');
  const [mobileFinalPaymentUrl, setMobileFinalPaymentUrl] = useState(order.finalPaymentUrl || '');
  const [mobilePaymentLoading, setMobilePaymentLoading] = useState(false);
  const [mobileFinalPaymentLoading, setMobileFinalPaymentLoading] = useState(false);
  const [mobilePaymentRefreshing, setMobilePaymentRefreshing] = useState(false);
  const [mobileFinalPaymentRefreshing, setMobileFinalPaymentRefreshing] = useState(false);
  const [mobilePaymentError, setMobilePaymentError] = useState('');
  const [mobileFinalPaymentError, setMobileFinalPaymentError] = useState('');
  const [mobileCdekCopied, setMobileCdekCopied] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [showMobileFinalQr, setShowMobileFinalQr] = useState(false);
  const mobileQrRef = useRef<HTMLDivElement>(null);
  const mobileFinalQrRef = useRef<HTMLDivElement>(null);
  const paymentUrl = mobilePaymentUrl;
  const isMobileSplitPayment = isYandexSplitPayment(order.paymentType);
  const mobilePaymentProviderLabel = isMobileSplitPayment ? 'Яндекс Сплит' : 'СБП';
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
  const mobileCdekAddress = getOrderCdekShareAddress(order);
  const mobileCdekNumber = String(order.cdekNumber || '').trim();
  const mobileCdekText = [
    `Заказ #${String(order.orderId || '').replace(/^#+/, '')}`,
    mobileCdekNumber ? `Накладная СДЭК № ${mobileCdekNumber}` : '',
    mobileCdekAddress ? `Адрес доставки: ${mobileCdekAddress}` : '',
    mobileCdekNumber ? `Отследить: https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(mobileCdekNumber)}` : '',
  ].filter(Boolean).join('\n');
  const invoiceType = order.invoiceType || getInvoiceTypeFromPaymentType(order.paymentType);
  const liveInvoiceAmount = getInvoiceAmount({
    revenue: liveRevenue,
    deliveryPrice: order.deliveryPrice || 0,
    invoiceType,
  });
  const dueAmount = getOrderPaymentDue({ ...order, revenue: liveRevenue, paidAmount: liveInvoiceAmount });
  const finalPaymentAmount = getOrderFinalPaymentAmount({ ...order, revenue: liveRevenue, paidAmount: liveInvoiceAmount });
  const showFinalPayment = finalPaymentAmount > 0 && (
    invoiceType !== 'full' || Boolean(order.finalPaymentUrl) || getInitialInvoiceAmount(order) < getOrderTotalAmount(order)
  );
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
    updatePlannedInvoiceAmount(order, updateOrderData, invoiceAmount);
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
    updatePlannedInvoiceAmount(order, updateOrderData, getInvoiceAmount({
      revenue: liveRevenue,
      deliveryPrice: value,
      invoiceType,
    }));
  };

  const updateMobileInvoiceType = (value: string) => {
    const nextInvoiceType = getInvoiceTypeFromPaymentType(value);
    updateOrderData(order.orderId, 'invoiceType', nextInvoiceType);
    updatePlannedInvoiceAmount(order, updateOrderData, getInvoiceAmount({
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

      const res = await fetch(getPaymentCreateEndpoint(order.paymentType), {
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
      if (!data.paymentUrl) throw new Error(`${mobilePaymentProviderLabel} не вернул ссылку оплаты`);

      setMobilePaymentUrl(data.paymentUrl);
      setShowMobileQr(true);
      updateOrderData(order.orderId, 'paymentUrl', data.paymentUrl);
      updateOrderData(order.orderId, 'paymentAmount', amount);
      updateOrderData(order.orderId, 'initialPaymentAmount', amount);
      updateOrderData(order.orderId, 'paymentAccountingVersion', 2);
      if (data.paymentId) updateOrderData(order.orderId, 'paymentId', data.paymentId);
      if (data.provider) updateOrderData(order.orderId, 'paymentProvider', data.provider);
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
      if (!mainPaymentPaid) throw new Error('Сначала дождитесь подтверждения предоплаты в Точке');
      if (finalPaymentAmount <= 0) throw new Error('Сумма доплаты 0 ₽');

      const res = await fetch(getPaymentCreateEndpoint(order.paymentType), {
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
      if (!data.paymentUrl) throw new Error(`${mobilePaymentProviderLabel} не вернул ссылку оплаты`);

      setMobileFinalPaymentUrl(data.paymentUrl);
      setShowMobileFinalQr(true);
      updateOrderData(order.orderId, 'finalPaymentUrl', data.paymentUrl);
      updateOrderData(order.orderId, 'finalPaymentAmount', finalPaymentAmount);
      updateOrderData(order.orderId, 'finalPaymentStatus', 'pending');
      if (data.paymentId) updateOrderData(order.orderId, 'finalPaymentId', data.paymentId);
      if (data.provider) updateOrderData(order.orderId, 'finalPaymentProvider', data.provider);
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
      const res = await fetch(`${getPaymentFindEndpoint(order.paymentType)}?${query.toString()}`);
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

  if (expanded) {
    return (
      <OrderDetailView
        order={order}
        productCatalog={productCatalog}
        updateOrderData={updateOrderData}
        onBack={() => {
          setExpanded(false);
          setMobileEditing(false);
        }}
        onEdit={() => setMobileEditing(true)}
        onDone={() => setMobileEditing(false)}
        onDelete={onDelete}
        mobile
        editing={mobileEditing}
      />
    );
  }

  return (
    <div className={cn(
      "yb-order-mobile-card m-3 flex flex-col gap-3 rounded-2xl border border-zinc-200/80 p-4 transition-colors",
      order.isPinned
        ? "border-amber-200 bg-amber-50/40"
        : order.isOverdue && !order.isShipped
          ? "bg-red-50/30"
          : "bg-white"
    )}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          setExpanded(v => !v);
          if (expanded) setMobileEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded(v => !v);
          }
        }}
        className="text-left"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-[9px] font-medium transition-colors",
              order.isPinned
                ? "bg-amber-100 text-amber-700"
                : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            )}
            aria-label={order.isPinned ? "Открепить важный заказ" : "Закрепить важный заказ"}
            aria-pressed={Boolean(order.isPinned)}
          >
            <Pin className={cn("h-3.5 w-3.5", order.isPinned && "fill-current")} />
            {order.isPinned ? 'Закреплён' : 'Закрепить'}
          </button>
          <label
            className="inline-flex min-w-[108px] max-w-[138px] items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[9px] font-semibold text-zinc-500 shadow-sm"
            onClick={event => event.stopPropagation()}
          >
            <span className="text-[8px] font-light text-zinc-400">Статус</span>
            <select
              value={order.status || 'Новый'}
              onChange={(event) => updateOrderData(order.orderId, 'status', event.target.value)}
              className="min-w-0 flex-1 cursor-pointer bg-transparent text-[9px] font-black uppercase tracking-wide text-zinc-700 outline-none"
              aria-label={`Поменять статус заказа ${order.orderId}`}
            >
              {optionsWithCurrent(handbookStatuses, order.status || 'Новый', STATUS_OPTIONS).map(status => (
                <option key={status} value={status}>{status || '—'}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 text-zinc-300">
            <span className="text-[8px] font-light tracking-wide">Развернуть заказ</span>
            <Plus className="h-3.5 w-3.5 stroke-[1.25]" />
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-zinc-400">{order.date.toLocaleDateString('ru-RU')}</p>
              <p className="mt-1 text-[14px] font-black text-zinc-950">#{order.orderId}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="truncate text-[12px] font-black text-zinc-950">{order.clientName || '—'}</p>
              <p className="mt-1 text-[11px] font-semibold text-zinc-400">{order.clientPhone ? `+${order.clientPhone}` : '—'}</p>
              {normalizeInstagramUsername(order.clientInsta) && (
                <a
                  href={getInstagramProfileUrl(order.clientInsta)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={event => event.stopPropagation()}
                  className="mt-1 inline-block max-w-[150px] truncate text-[10px] font-semibold text-[#7D7DE6] hover:underline"
                >
                  @{normalizeInstagramUsername(order.clientInsta)}
                </a>
              )}
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
          {(mobileCdekNumber || mobileCdekAddress) && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-[#E6E9EF] bg-[#F8FAFC] px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold text-[#344054]">
                  {mobileCdekNumber ? `СДЭК № ${mobileCdekNumber}` : 'СДЭК · накладная формируется'}
                </p>
                <p className="mt-1 line-clamp-2 text-[9px] font-medium leading-4 text-[#667085]">
                  {mobileCdekAddress || 'Адрес доставки не указан'}
                </p>
              </div>
              <button
                type="button"
                onClick={async event => {
                  event.stopPropagation();
                  await navigator.clipboard.writeText(mobileCdekText);
                  setMobileCdekCopied(true);
                  window.setTimeout(() => setMobileCdekCopied(false), 1800);
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#E6E9EF] bg-white px-2 text-[9px] font-bold text-[#667085]"
                aria-label="Скопировать данные СДЭК для клиента"
              >
                {mobileCdekCopied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {mobileCdekCopied ? 'Готово' : 'Копировать'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-zinc-400">старт {order.date.toLocaleDateString('ru-RU')}</p>
            <p className={cn("text-[10px] font-black", order.isOverdue && !order.isShipped ? "text-red-500" : "text-zinc-500")}>
              до {deadlineDate.toLocaleDateString('ru-RU')}
            </p>
          </div>
        </div>
      </div>

      {expanded && (
        <>
      <button
        type="button"
        onClick={() => setMobileEditing(false)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5638F4] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(86,56,244,0.18)]"
      >
        <CheckCircle2 className="h-4 w-4" /> Сохранить и вернуться
      </button>
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
      <div className="grid grid-cols-3 gap-1.5">
        <div className="min-w-0 rounded-lg bg-zinc-50 border border-zinc-100 p-2">
          <p className="text-[7px] font-bold text-zinc-400 uppercase">Доставка</p>
          <input
            type="number"
            value={order.deliveryPrice || ''}
            onChange={(e) => updateMobileDeliveryPrice(parseFloat(e.target.value) || 0)}
            placeholder="0"
            className="mt-1 w-full bg-transparent text-[11px] font-black text-zinc-800 outline-none"
          />
        </div>
        <div className={cn(
          "min-w-0 rounded-lg border p-2",
          invoiceType === 'full' ? "bg-emerald-50 border-emerald-100" : "bg-orange-50 border-orange-100"
        )}>
          <p className={cn(
            "truncate text-[7px] font-bold uppercase",
            invoiceType === 'full' ? "text-emerald-500" : "text-orange-500"
          )}>{invoiceLabel}</p>
          <p className={cn("truncate text-[11px] font-black", invoiceTone)}>{formatCurrency(liveInvoiceAmount)}</p>
        </div>
        <div className="min-w-0 rounded-lg bg-blue-50 border border-blue-100 p-2">
          <p className="text-[7px] font-bold text-blue-500 uppercase">К оплате</p>
          <p className="truncate text-[11px] font-black text-blue-700">{formatCurrency(dueAmount)}</p>
        </div>
      </div>

      {/* Payment Mobile */}
      <div className="rounded-xl border border-zinc-200 bg-white p-2.5 space-y-2 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-black text-zinc-800">{mobilePaymentProviderLabel}</p>
            <p className={cn("mt-0.5 truncate text-[9px] font-bold", mainPaymentPaid ? "text-emerald-600" : "text-zinc-400")}>{mainPaymentStatusText}</p>
          </div>
          {paymentUrl && (
            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-[9px] font-bold"
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
                className="py-2 rounded-lg bg-white border border-zinc-200 text-[10px] font-bold text-zinc-600 flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <RefreshCcw size={10} className={mobilePaymentRefreshing ? 'animate-spin' : ''} />
                Проверить
              </button>
              <button
                onClick={() => shareOrder(shareText, paymentUrl).catch(() => navigator.clipboard.writeText(shareText))}
                className={cn(
                  "py-2 rounded-lg border text-[10px] font-bold flex items-center justify-center gap-1.5",
                  isMobileSplitPayment
                    ? "border-zinc-950 bg-zinc-950 text-white active:bg-black"
                    : "border-violet-600 bg-violet-600 text-white"
                )}
              >
                {isMobileSplitPayment ? <SplitMark /> : <Send size={10} />}
                {isMobileSplitPayment ? 'Яндекс Сплит' : 'Поделиться'}
              </button>
            </div>
            <button
              onClick={() => setShowMobileQr(v => !v)}
              className="w-full py-2 rounded-lg bg-[#6B4DFF] border border-[#6B4DFF] text-[10px] font-bold text-white"
            >
              {showMobileQr ? 'Скрыть QR' : 'QR-код Точка'}
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
              className="w-full py-2 rounded-lg border border-violet-200 bg-violet-50 text-violet-600 text-[10px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
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
                disabled={mobileFinalPaymentLoading || !mainPaymentPaid}
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
  const [createdShowQr, setCreatedShowQr] = useState(false);
  const [createdDocumentLoading, setCreatedDocumentLoading] = useState(false);
  const [createdDocumentStatus, setCreatedDocumentStatus] = useState('');
  const [tochkaConfigured, setTochkaConfigured] = useState(false);
  const [productCatalog, setProductCatalog] = useState<ProductCatalogItem[]>([]);
  const [newOrderItems, setNewOrderItems] = useState<string[]>(['']);
  const [newOrderItemPrices, setNewOrderItemPrices] = useState<number[]>([0]);
  const [newOrderItemColors, setNewOrderItemColors] = useState<string[]>(['']);
  const [newOrderItemSizes, setNewOrderItemSizes] = useState<string[]>(['']);
  const [newOrderItemHeights, setNewOrderItemHeights] = useState<string[]>(['']);
  const [newCdekDeliveryType, setNewCdekDeliveryType] = useState<'pvz' | 'door'>('pvz');
  const [newCdekTariffCode, setNewCdekTariffCode] = useState('138');
  const [newCdekCityQuery, setNewCdekCityQuery] = useState('');
  const [newCdekCityCode, setNewCdekCityCode] = useState('');
  const [newCdekCities, setNewCdekCities] = useState<CdekCityOption[]>([]);
  const [newCdekPoints, setNewCdekPoints] = useState<CdekDeliveryPoint[]>([]);
  const [newCdekPoint, setNewCdekPoint] = useState('');
  const [newCdekPointQuery, setNewCdekPointQuery] = useState('');
  const [newCdekShowPoints, setNewCdekShowPoints] = useState(false);
  const [newCdekLoadingCities, setNewCdekLoadingCities] = useState(false);
  const [newCdekLoadingPoints, setNewCdekLoadingPoints] = useState(false);
  const [newCdekCalculating, setNewCdekCalculating] = useState(false);
  const [newCdekWeight, setNewCdekWeight] = useState('700');
  const [newCdekLength, setNewCdekLength] = useState('30');
  const [newCdekWidth, setNewCdekWidth] = useState('20');
  const [newCdekHeight, setNewCdekHeight] = useState('10');
  const [newOrderFormError, setNewOrderFormError] = useState('');
  const [newOrderSubmitting, setNewOrderSubmitting] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [analyticsDetailsOpen, setAnalyticsDetailsOpen] = useState(false);
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Set<string>>(() => new Set());
  const [managerContacts, setManagerContacts] = useState<ManagerContactEntry[]>([]);
  const [managerShifts, setManagerShifts] = useState<ManagerShiftRecord[]>([]);
  const [selectedShiftManager, setSelectedShiftManager] = useState('');
  const [currentManagerProfile, setCurrentManagerProfile] = useState<ManagerProfile | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftError, setShiftError] = useState('');
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
  const pinnedOrderCount = useMemo(
    () => new Set(data.filter(order => order.isPinned).map(order => order.orderId)).size,
    [data]
  );

  const toggleOrderPin = (order: OrderData) => {
    if (!order.isPinned && pinnedOrderCount >= 5) {
      window.alert('Можно закрепить не более 5 важных заказов. Сначала открепите один из них.');
      return;
    }
    updateOrderData(order.orderId, 'isPinned', !order.isPinned);
  };

  useEffect(() => {
    fetch('/api/tochka/status').then(r => r.json()).then(d => setTochkaConfigured(!!d.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    const reconcile = () => fetch('/api/tochka/reconcile-payments', { method: 'POST' }).catch(() => null);
    reconcile();
    const interval = window.setInterval(reconcile, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const syncCdekStatuses = async () => {
      try {
        const response = await fetch('/api/cdek/sync-statuses', { method: 'POST' });
        if (!response.ok || !active) return;
        await response.json();
      } catch {
        // Фоновая синхронизация не должна мешать работе страницы заказов.
      }
    };
    syncCdekStatuses();
    const interval = window.setInterval(syncCdekStatuses, 10 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'manager_contacts'), orderBy('date', 'desc'), limit(700)),
      snap => {
        setManagerContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as ManagerContactEntry)));
        setShiftError('');
      },
      error => {
        console.error('Не удалось загрузить касания менеджеров:', error);
        setManagerContacts([]);
        setShiftError('Не удалось загрузить касания клиентов. Проверьте доступ Firestore.');
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'manager_shifts'), orderBy('startedAt', 'desc'), limit(100)),
      snap => {
        setManagerShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as ManagerShiftRecord)));
      },
      error => {
        console.error('Не удалось загрузить смены менеджеров:', error);
        setManagerShifts([]);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user?.uid) {
      setCurrentManagerProfile(null);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'manager_profiles', user.uid),
      snap => {
        const data = snap.data() as ManagerProfile | undefined;
        setCurrentManagerProfile(data ? { ...data, managerId: user.uid, managerEmail: user.email || data.managerEmail || null } : null);
      },
      error => {
        console.error('Не удалось загрузить профиль менеджера:', error);
        setCurrentManagerProfile(null);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (currentManagerProfile?.managerName && selectedShiftManager !== currentManagerProfile.managerName) {
      setSelectedShiftManager(currentManagerProfile.managerName);
      return;
    }
    if (selectedShiftManager) return;
    const firstManager = handbookManagers.find(manager => String(manager || '').trim()) || 'Менеджер 1';
    setSelectedShiftManager(firstManager);
  }, [currentManagerProfile?.managerName, handbookManagers, selectedShiftManager]);

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

  const isNewOrderCdek = String(newOrder.deliveryMethod || '').toLowerCase().includes('сдэк');

  useEffect(() => {
    const value = newCdekCityQuery.trim();
    if (!isNewOrderCdek || value.length < 2 || newCdekCityCode) {
      setNewCdekCities([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const cacheKey = value.toLowerCase();
      const cached = cdekCitiesCache.get(cacheKey);
      if (cached) {
        setNewCdekCities(cached.slice(0, 6));
        return;
      }
      setNewCdekLoadingCities(true);
      try {
        const response = await fetch(`/api/cdek/cities?q=${encodeURIComponent(value)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, 'СДЭК не вернул города'));
        const next = Array.isArray(payload) ? payload.slice(0, 8) : [];
        cdekCitiesCache.set(cacheKey, next);
        setNewCdekCities(next.slice(0, 6));
      } catch (error: any) {
        setNewOrderFormError(error.message || 'Не удалось найти город СДЭК');
        setNewCdekCities([]);
      } finally {
        setNewCdekLoadingCities(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isNewOrderCdek, newCdekCityCode, newCdekCityQuery]);

  useEffect(() => {
    if (!isNewOrderCdek || newCdekDeliveryType !== 'pvz' || !newCdekCityCode) {
      setNewCdekPoints([]);
      return;
    }
    const cached = cdekPointsCache.get(newCdekCityCode);
    if (cached) {
      setNewCdekPoints(cached);
      return;
    }
    const controller = new AbortController();
    setNewCdekLoadingPoints(true);
    fetch(`/api/cdek/deliverypoints?city_code=${encodeURIComponent(newCdekCityCode)}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, 'СДЭК не вернул ПВЗ'));
        const next = Array.isArray(payload) ? payload : [];
        cdekPointsCache.set(newCdekCityCode, next);
        setNewCdekPoints(next);
      })
      .catch((error: any) => {
        if (error?.name !== 'AbortError') setNewOrderFormError(error.message || 'Не удалось загрузить ПВЗ СДЭК');
      })
      .finally(() => setNewCdekLoadingPoints(false));
    return () => controller.abort();
  }, [isNewOrderCdek, newCdekCityCode, newCdekDeliveryType]);

  const newCdekFilteredPoints = useMemo(() => {
    const value = newCdekPointQuery.trim().toLowerCase();
    const getLabel = (point: CdekDeliveryPoint) => `${point.name || point.code} · ${point.address || point.location?.address || point.code}`;
    return newCdekPoints
      .filter(point => !value || getLabel(point).toLowerCase().includes(value))
      .slice(0, 20);
  }, [newCdekPointQuery, newCdekPoints]);

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
      clientInsta: getContactInsta(client),
      clientCity: getContactCity(client),
      clientAddress: getContactAddress(client),
    });
    setClientQuery(contactName);
    setPhoneQuery(contactPhone);
    const contactCity = getContactCity(client);
    if (contactCity) {
      setNewCdekCityQuery(contactCity);
      setNewCdekCityCode('');
    }
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
      return status.includes('оплачен') || getConfirmedPaidAmount(order) > 0;
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
      return status.includes('оплачен') || getConfirmedPaidAmount(order) > 0;
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
        const monthRevenue = monthSales.reduce((sum, order) => sum + getConfirmedPaidAmount(order), 0);
        const todayRevenue = todaySales.reduce((sum, order) => sum + getConfirmedPaidAmount(order), 0);
        const basePlan = Number(plan.basePlan) || MANAGER_PLAN_DEFAULTS.basePlan;
        const dayPlan = Number(plan.dayPlan) || MANAGER_PLAN_DEFAULTS.dayPlan;
        const monthPlan = Number(plan.monthPlan) || MANAGER_PLAN_DEFAULTS.monthPlan;
        const revenuePlan = Number(plan.revenuePlan) || MANAGER_PLAN_DEFAULTS.revenuePlan;
        const dueExtra = monthOrders.reduce((sum, order) => sum + getOutstandingPaymentAmount(order), 0);

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

  const shiftManagers = useMemo(() => {
    const names = handbookManagers.filter(manager => String(manager || '').trim());
    return names.length ? names : ['Менеджер 1', 'Менеджер 2'];
  }, [handbookManagers]);

  const managerShiftState = useMemo(() => {
    const todayKey = getLocalDateKey();
    const user = auth.currentUser;
    const manager = currentManagerProfile?.managerName || selectedShiftManager || shiftManagers[0] || 'Менеджер 1';
    const profileUid = currentManagerProfile?.managerId || user?.uid || '';
    const profileEmail = normalizeAuthEmail(currentManagerProfile?.managerEmail || user?.email || '');
    const contactsToday = managerContacts.filter(entry => {
      const contactDate = parseContactDate(entry.date);
      const entryUid = String(entry.managerId || '').trim();
      const entryEmail = normalizeAuthEmail(entry.managerEmail || '');
      const entryName = String(entry.managerName || '').trim();
      const belongsToCurrentProfile = profileUid
        ? entryUid === profileUid || (!!profileEmail && entryEmail === profileEmail)
        : entryName === manager;
      return getLocalDateKey(contactDate || new Date(0)) === todayKey
        && belongsToCurrentProfile
        && String(entry.status || '').trim() !== 'в работе';
    });
    const uniqueClients = new Set(contactsToday.map(entry => (
      String(entry.clientPhone || entry.clientName || entry.id || '').trim()
    )).filter(Boolean));
    const progress = Math.min(100, Math.round((uniqueClients.size / SHIFT_TARGET_CONTACTS) * 100));
    const todayShift = managerShifts.find(shift => (
      shift.dateKey === todayKey && (
        profileUid
          ? String(shift.managerId || '').trim() === profileUid
          : String(shift.managerName || '').trim() === manager
      )
    ));
    const completed = uniqueClients.size >= SHIFT_TARGET_CONTACTS;
    const earned = todayShift && completed ? SHIFT_BASE_PAY : 0;
    const active = Boolean(todayShift?.startedAt && todayShift.status !== 'closed');
    return {
      todayKey,
      manager,
      managerId: profileUid,
      managerEmail: profileEmail,
      isProfileBound: Boolean(currentManagerProfile?.managerName && profileUid),
      contactsCount: uniqueClients.size,
      progress,
      shift: todayShift,
      completed,
      earned,
      active,
      remaining: Math.max(0, SHIFT_TARGET_CONTACTS - uniqueClients.size),
    };
  }, [currentManagerProfile, managerContacts, managerShifts, selectedShiftManager, shiftManagers]);

  const bindCurrentLoginToManager = async () => {
    const user = auth.currentUser;
    const manager = selectedShiftManager || shiftManagers[0] || 'Менеджер 1';
    if (!user?.uid || !manager) return;
    setProfileSaving(true);
    setShiftError('');
    try {
      await setDoc(doc(db, 'manager_profiles', user.uid), {
        managerName: manager,
        managerId: user.uid,
        managerEmail: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      setSelectedShiftManager(manager);
    } catch (error: any) {
      console.error('Не удалось привязать логин менеджера:', error);
      setShiftError(error?.message || 'Не удалось привязать логин. Проверьте права доступа.');
    } finally {
      setProfileSaving(false);
    }
  };

  const startManagerShift = async () => {
    if (!managerShiftState.isProfileBound) {
      setShiftError('Сначала привяжите этот логин к менеджеру. Потом смена будет считаться именно под этим аккаунтом.');
      return;
    }
    const manager = managerShiftState.manager;
    if (!manager) return;
    setShiftSaving(true);
    setShiftError('');
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'manager_shifts', `${managerShiftState.todayKey}_${managerDocKey(manager)}`), {
        managerName: manager,
        managerId: user?.uid || managerShiftState.managerId || null,
        managerEmail: user?.email || managerShiftState.managerEmail || null,
        startedBy: user?.email || user?.displayName || manager,
        dateKey: managerShiftState.todayKey,
        startedAt: new Date().toISOString(),
        plannedStart: SHIFT_START_TIME,
        plannedEnd: SHIFT_END_TIME,
        targetContacts: SHIFT_TARGET_CONTACTS,
        basePay: SHIFT_BASE_PAY,
        status: 'active',
      }, { merge: true });
    } catch (error: any) {
      console.error('Не удалось начать смену:', error);
      setShiftError(error?.message || 'Не удалось начать смену. Проверьте соединение и права доступа.');
    } finally {
      setShiftSaving(false);
    }
  };

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

  const calculateNewCdekDelivery = async () => {
    setNewOrderFormError('');
    if (!newCdekCityCode) {
      setNewOrderFormError('Сначала выберите город СДЭК из подсказки.');
      return;
    }
    setNewCdekCalculating(true);
    try {
      const response = await fetch('/api/cdek/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_city_code: Number(newCdekCityCode),
          packages: [{
            weight: Number(newCdekWeight) || 700,
            length: Number(newCdekLength) || 30,
            width: Number(newCdekWidth) || 20,
            height: Number(newCdekHeight) || 10,
          }],
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, 'Не удалось рассчитать доставку СДЭК'));
      const tariffs = Array.isArray(payload?.tariff_codes) ? payload.tariff_codes : [];
      const selected = tariffs.find((item: any) => String(item.tariff_code) === String(newCdekTariffCode));
      const fallback = tariffs.slice().sort((a: any, b: any) => (Number(a.delivery_sum) || Infinity) - (Number(b.delivery_sum) || Infinity))[0];
      const deliveryPrice = Number((selected || fallback)?.delivery_sum) || 0;
      if (deliveryPrice <= 0) throw new Error('СДЭК не вернул стоимость выбранного тарифа');
      if (!selected && fallback?.tariff_code) setNewCdekTariffCode(String(fallback.tariff_code));
      updateNewOrderDeliveryPrice(deliveryPrice);
    } catch (error: any) {
      setNewOrderFormError(error.message || 'Не удалось рассчитать доставку СДЭК');
    } finally {
      setNewCdekCalculating(false);
    }
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
      clientAddress: '',
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
    setNewCdekDeliveryType('pvz');
    setNewCdekTariffCode('138');
    setNewCdekCityQuery('');
    setNewCdekCityCode('');
    setNewCdekCities([]);
    setNewCdekPoints([]);
    setNewCdekPoint('');
    setNewCdekPointQuery('');
    setNewCdekShowPoints(false);
    setNewCdekWeight('700');
    setNewCdekLength('30');
    setNewCdekWidth('20');
    setNewCdekHeight('10');
    setNewCdekCalculating(false);
    setNewOrderFormError('');
    setClientQuery('');
    setPhoneQuery('');
    setCreatedOrderId(null);
    setCreatedPaymentUrl(null);
    setCreatedShareText('');
  };

  const buildNewOrderSnapshot = (status = 'Новый') => {
    const itemPricesTotal = getItemPricesTotal(newOrderItemPrices);
    const invoiceType = newOrder.invoiceType || getInvoiceTypeFromPaymentType(newOrder.paymentType);
    const deliveryPrice = Number(newOrder.deliveryPrice) || 0;
    const cdekAddress = newCdekDeliveryType === 'pvz' ? newCdekPointQuery : String(newOrder.clientAddress || '').trim();
    return {
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
      clientCity: isNewOrderCdek ? newCdekCityQuery : String(newOrder.clientCity || '').trim(),
      clientAddress: isNewOrderCdek ? cdekAddress : String(newOrder.clientAddress || '').trim(),
      status,
      ...(isNewOrderCdek ? { cdekPayload: {
        tariffCode: newCdekTariffCode,
        deliveryType: newCdekDeliveryType,
        toCityCode: newCdekCityCode,
        toCity: newCdekCityQuery,
        deliveryPoint: newCdekPoint,
        toAddress: newCdekDeliveryType === 'door' ? String(newOrder.clientAddress || '').trim() : '',
        weight: newCdekWeight,
        length: newCdekLength,
        width: newCdekWidth,
        height: newCdekHeight,
      } } : {}),
    };
  };

  const newOrderMissingFields = useMemo(() => {
    const missing: string[] = [];
    if (!String(newOrder.orderId || '').trim()) missing.push('ID заказа');
    if (!String(newOrder.clientName || '').trim()) missing.push('ФИО клиента');
    if (getContactPhone({ phone: newOrder.clientPhone }).length < 10) missing.push('телефон');
    if (!String(newOrder.manager || '').trim()) missing.push('менеджер');
    if (!String(newOrder.source || '').trim()) missing.push('источник');
    if (!String(newOrder.deliveryMethod || '').trim()) missing.push('доставка');
    if (!String(newOrder.paymentType || '').trim()) missing.push('тип оплаты');
    if (String(newOrder.source || '').toLowerCase().includes('блогер') && !String(newOrder.blogger || '').trim()) missing.push('блогер');
    newOrderItems.forEach((item, index) => {
      const position = newOrderItems.length > 1 ? ` (позиция ${index + 1})` : '';
      if (!String(item || '').trim()) missing.push(`изделие${position}`);
      if (!String(newOrderItemColors[index] || '').trim()) missing.push(`цвет${position}`);
      if (!String(newOrderItemSizes[index] || '').trim()) missing.push(`размер${position}`);
      if (!String(newOrderItemHeights[index] || '').trim()) missing.push(`рост${position}`);
      if ((Number(newOrderItemPrices[index]) || 0) <= 0) missing.push(`цена${position}`);
    });
    if (isNewOrderCdek) {
      if (!newCdekCityCode) missing.push('город СДЭК из подсказки');
      if (newCdekDeliveryType === 'pvz' && !newCdekPoint) missing.push('ПВЗ СДЭК');
      if (newCdekDeliveryType === 'door' && !String(newOrder.clientAddress || '').trim()) missing.push('адрес доставки');
      if ((Number(newCdekWeight) || 0) <= 0) missing.push('вес отправления');
      if ((Number(newOrder.deliveryPrice) || 0) <= 0) missing.push('стоимость доставки СДЭК');
    } else if (!String(newOrder.clientCity || '').trim() || !String(newOrder.clientAddress || '').trim()) {
      missing.push('город и адрес клиента');
    }
    return Array.from(new Set(missing));
  }, [
    isNewOrderCdek, newCdekCityCode, newCdekDeliveryType, newCdekPoint, newCdekWeight,
    newOrder, newOrderItemColors, newOrderItemHeights, newOrderItemPrices, newOrderItemSizes, newOrderItems,
  ]);

  const persistNewOrderContact = async (orderSnapshot: Partial<OrderData>) => {
    const contactId = getContactPhone({ phone: orderSnapshot.clientPhone }) || String(orderSnapshot.clientName || '').trim();
    if (!contactId) return;
    await setDoc(doc(db, 'contacts', contactId), {
      userId: contactId,
      fullName: orderSnapshot.clientName || '',
      phone: orderSnapshot.clientPhone || '',
      insta: orderSnapshot.clientInsta || '',
      city: orderSnapshot.clientCity || '',
      address: orderSnapshot.clientAddress || '',
      saleSource: orderSnapshot.source || '',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  };

  const saveNewOrderDraft = async () => {
    setNewOrderFormError('');
    const missingDraft = [
      !String(newOrder.orderId || '').trim() ? 'ID заказа' : '',
      !String(newOrder.clientName || '').trim() ? 'ФИО клиента' : '',
    ].filter(Boolean);
    if (missingDraft.length) {
      setNewOrderFormError(`Для черновика заполните: ${missingDraft.join(', ')}`);
      return;
    }
    setNewOrderSubmitting(true);
    try {
      const snapshot = buildNewOrderSnapshot('Черновик');
      const orderId = await handleCreateOrder(snapshot);
      if (!orderId) return;
      await persistNewOrderContact(snapshot);
      setCreatedOrderId(orderId);
      setCreatedPaymentUrl(null);
      setCreatedShareText('');
      setCreatedPaymentError('Черновик сохранён. Счёт и накладная не создавались.');
      resetNewOrderForm();
      setCreatedOrderId(orderId);
      setCreatedPaymentError('Черновик сохранён. Счёт и накладная не создавались.');
    } catch (error: any) {
      setNewOrderFormError(error.message || 'Не удалось сохранить черновик');
    } finally {
      setNewOrderSubmitting(false);
    }
  };

  const createNewOrder = async () => {
    setNewOrderFormError('');
    if (newOrderMissingFields.length) {
      setNewOrderFormError(`Заполните: ${newOrderMissingFields.join(', ')}`);
      return;
    }
    setNewOrderSubmitting(true);
    let orderSnapshot: Partial<OrderData>;
    let orderId: string | null;
    try {
      orderSnapshot = buildNewOrderSnapshot('Новый');
      orderId = await handleCreateOrder(orderSnapshot);
      if (!orderId) {
        setNewOrderSubmitting(false);
        return;
      }
      await persistNewOrderContact(orderSnapshot);
    } catch (error: any) {
      setNewOrderFormError(error.message || 'Не удалось сохранить заказ');
      setNewOrderSubmitting(false);
      return;
    }
    const paymentPageUrl = buildPaymentPageUrl(orderId);
    let generatedPaymentUrl: string | null = null;
    let generatedPaymentError = '';
    setCreatedOrderId(orderId);
    setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, paymentPageUrl));
    setCreatedPaymentUrl(null);
    setCreatedPaymentError('');

    if (isNewOrderCdek) {
      try {
        const response = await fetch('/api/cdek/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            recipientName: orderSnapshot.clientName,
            recipientPhone: orderSnapshot.clientPhone,
            itemName: orderSnapshot.item || `Заказ ${orderId}`,
            itemCost: Number(orderSnapshot.revenue) || 0,
            codAmount: String(orderSnapshot.paymentType || '').toLowerCase().includes('налож') ? Number(orderSnapshot.paidAmount) || 0 : 0,
            deliveryCost: Number(orderSnapshot.deliveryPrice) || 0,
            tariffCode: newCdekTariffCode,
            deliveryType: newCdekDeliveryType,
            toCityCode: newCdekCityCode,
            toCity: newCdekCityQuery,
            deliveryPoint: newCdekPoint,
            toAddress: newCdekDeliveryType === 'door' ? String(orderSnapshot.clientAddress || '') : '',
            weight: newCdekWeight,
            length: newCdekLength,
            width: newCdekWidth,
            height: newCdekHeight,
            comment: `CRM заказ #${orderId}. Товар: ${formatCurrency(Number(orderSnapshot.revenue) || 0)}. Доставка: ${formatCurrency(Number(orderSnapshot.deliveryPrice) || 0)}. ${String(orderSnapshot.paymentType || '').toLowerCase().includes('налож') ? 'Оплата при получении' : 'Оплачивается онлайн'}`,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(getApiErrorMessage(payload, 'СДЭК не принял заказ'));
      } catch (error: any) {
        setCreatedPaymentError(`Заказ сохранён, но счёт не создан: ${error.message || 'не удалось создать накладную СДЭК'}`);
        setNewOrderFormError('Счёт заблокирован: сначала исправьте данные СДЭК и создайте накладную в карточке заказа.');
        setNewOrderSubmitting(false);
        return;
      }
    }

    if (tochkaConfigured || isYandexSplitPayment(orderSnapshot.paymentType)) {
      setIsCreatingQr(true);
      try {
        const amount = getOrderPaymentDue({
          revenue: orderSnapshot.revenue || 0,
          deliveryPrice: orderSnapshot.deliveryPrice || 0,
          paidAmount: orderSnapshot.paidAmount || 0,
        });
        if (amount <= 0) throw new Error('Остаток к оплате 0 ₽');
        const res = await fetch(getPaymentCreateEndpoint(orderSnapshot.paymentType), {
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
          generatedPaymentUrl = data.paymentUrl;
          setCreatedPaymentUrl(data.paymentUrl);
          setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, data.paymentUrl));
          updateOrderData(orderId, 'paymentAmount', amount);
          if (data.paymentId) updateOrderData(orderId, 'paymentId', data.paymentId);
        }
      } catch (e: any) {
        generatedPaymentError = e.message || 'Не удалось создать счёт';
        setCreatedPaymentError(generatedPaymentError);
      }
      finally { setIsCreatingQr(false); }
    }
    resetNewOrderForm();
    setCreatedOrderId(orderId);
    setCreatedPaymentUrl(generatedPaymentUrl);
    setCreatedPaymentError(generatedPaymentError);
    setCreatedShareText(buildOrderShareText({ ...orderSnapshot, orderId }, generatedPaymentUrl || paymentPageUrl));
    setNewOrderSubmitting(false);
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

  const orderWorkspaceSummary = useMemo(() => {
    const source = filteredOrders || [];
    const revenue = source.reduce((sum, order) => sum + (Number(order.revenue) || 0) + (Number(order.deliveryPrice) || 0), 0);
    const awaitingPayment = source.filter(order => {
      const status = String(order.paymentStatus || '').toLowerCase();
      return !isPaidTochkaStatus(status) && !String(order.status || '').toLowerCase().includes('оплачен');
    }).length;
    const inDelivery = source.filter(order => {
      const status = String(order.status || '').toLowerCase();
      return status.includes('отгружен') || (Boolean(order.cdekNumber) && !status.includes('доставлен'));
    }).length;
    const delivered = source.filter(order => String(order.status || '').toLowerCase().includes('доставлен')).length;
    return { total: source.length, revenue, awaitingPayment, inDelivery, delivered };
  }, [filteredOrders]);

  return (
    <div className="yb-orders-space space-y-5 text-[#1F2937]">
      <div className="yb-orders-shift rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_12px_34px_rgba(31,41,55,0.04)] sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
              <Clock className="h-3.5 w-3.5" />
              Смена менеджера
            </div>
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-zinc-950 sm:text-[28px]">
              Работа по базе · {SHIFT_START_TIME}–{SHIFT_END_TIME}
            </h2>
            <p className="mt-1 max-w-3xl text-[12px] font-medium leading-5 text-zinc-500">
              Менеджер отмечается в начале дня, поднимает 100 клиентов из базы. ФОТ за смену {formatCurrency(SHIFT_BASE_PAY)} засчитывается только после выполнения нормы.
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

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(180px,220px)] lg:items-stretch">
          <div className="rounded-xl border border-[#E6E9EF] bg-[#F8FAFC] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9CA3AF]">Менеджер в смене</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-[#6B7280]">
              Логин: {auth.currentUser?.email || 'не определён'}
            </p>
            <div className="relative mt-2">
              <select
                value={managerShiftState.manager}
                onChange={(e) => setSelectedShiftManager(e.target.value)}
                disabled={managerShiftState.isProfileBound}
                className={cn(
                  'h-11 w-full appearance-none rounded-[8px] border border-[#E6E9EF] bg-white px-3 pr-9 text-[13px] font-semibold text-[#1F2937] outline-none focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/10',
                  managerShiftState.isProfileBound && 'cursor-not-allowed bg-emerald-50 text-emerald-800'
                )}
              >
                {shiftManagers.map(manager => <option key={manager} value={manager}>{manager}</option>)}
              </select>
              <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#9CA3AF]" />
            </div>
            {!managerShiftState.isProfileBound && (
              <button
                type="button"
                onClick={bindCurrentLoginToManager}
                disabled={profileSaving || !auth.currentUser?.uid}
                className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-[#7D7DE6]/25 bg-white px-3 text-[11px] font-semibold text-[#5B5BE0] transition-colors hover:bg-violet-50 disabled:opacity-50"
              >
                {profileSaving ? 'Привязываю…' : 'Привязать этот логин'}
              </button>
            )}
            <button
              type="button"
              onClick={startManagerShift}
              disabled={shiftSaving || managerShiftState.active || !managerShiftState.isProfileBound}
              className={cn(
                'mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold transition-colors',
                managerShiftState.active
                  ? 'border border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-50'
              )}
            >
              {managerShiftState.active ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {shiftSaving ? 'Запускаю…' : managerShiftState.active ? 'Смена начата' : 'Начать смену'}
            </button>
          </div>

          <div className="rounded-xl border border-[#E6E9EF] bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9CA3AF]">Подъём базы сегодня</p>
                <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-zinc-950">
                  {managerShiftState.contactsCount}<span className="text-[13px] text-zinc-400">/{SHIFT_TARGET_CONTACTS} клиентов</span>
                </p>
              </div>
              <span className={cn(
                'rounded-full px-3 py-1 text-[11px] font-semibold',
                managerShiftState.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              )}>
                {managerShiftState.completed ? 'Норма выполнена' : `Осталось ${managerShiftState.remaining}`}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E6E9EF]">
              <div
                className="h-full rounded-full bg-[#7D7DE6] transition-all"
                style={{ width: `${managerShiftState.progress}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] font-medium text-[#9CA3AF]">
              <span>Считаются кнопки “Написал” и сохранённые касания за сегодня</span>
              <span>{managerShiftState.progress}%</span>
            </div>
          </div>

          <div className="rounded-xl border border-[#E6E9EF] bg-[#F8FAFC] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9CA3AF]">ФОТ смены</p>
            <p className={cn('mt-2 text-[24px] font-semibold tracking-[-0.03em]', managerShiftState.earned > 0 ? 'text-emerald-600' : 'text-zinc-950')}>
              {formatCurrency(managerShiftState.earned)}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-4 text-[#6B7280]">
              {managerShiftState.earned > 0
                ? 'Засчитано: смена начата и 100 клиентов поднято.'
                : managerShiftState.active
                  ? 'Пока не засчитано: нужна норма 100 клиентов.'
                  : 'Начните смену, затем поднимайте клиентов из базы.'}
            </p>
          </div>
        </div>
        {shiftError && (
          <div className="mt-3 rounded-[8px] border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
            {shiftError}
          </div>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: 'Всего заказов',
            value: String(orderWorkspaceSummary.total),
            hint: 'в текущей выборке',
            icon: ShoppingBag,
            tone: 'bg-violet-50 text-violet-700',
          },
          {
            label: 'Сумма заказов',
            value: formatCurrency(orderWorkspaceSummary.revenue),
            hint: 'товары и доставка',
            icon: Wallet,
            tone: 'bg-emerald-50 text-emerald-700',
          },
          {
            label: 'Ждут оплаты',
            value: String(orderWorkspaceSummary.awaitingPayment),
            hint: 'нужно проверить',
            icon: CreditCard,
            tone: 'bg-amber-50 text-amber-700',
          },
          {
            label: 'Логистика',
            value: `${orderWorkspaceSummary.inDelivery} / ${orderWorkspaceSummary.delivered}`,
            hint: 'в пути / доставлено',
            icon: Truck,
            tone: 'bg-sky-50 text-sky-700',
          },
        ].map(metric => (
          <article key={metric.label} className="yb-orders-metric rounded-2xl border border-zinc-200/80 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-zinc-500">{metric.label}</p>
                <p className="mt-2 truncate text-[20px] font-semibold tracking-[-0.03em] text-zinc-950 sm:text-[24px]">
                  {metric.value}
                </p>
              </div>
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', metric.tone)}>
                <metric.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-[10px] font-medium text-zinc-400">{metric.hint}</p>
          </article>
        ))}
      </section>

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

                <div className="grid min-w-0 grid-cols-2 gap-y-3 border-b border-[#E6E9EF] py-3 sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-[#E6E9EF]">
                  <div className="min-w-0 pr-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сумма плана</p>
                    <p className="mt-1 text-[12px] font-medium text-[#1F2937] sm:truncate" title={formatCurrency(manager.revenuePlan)}>{formatCurrency(manager.revenuePlan)}</p>
                  </div>
                  <div className="min-w-0 border-l border-[#E6E9EF] pl-3 sm:border-l-0 sm:px-3">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продаж в мес.</p>
                    <p className="mt-1 text-[12px] font-medium text-[#1F2937]">{manager.monthPlan} шт.</p>
                  </div>
                  <div className="min-w-0 border-t border-[#E6E9EF] pr-3 pt-3 sm:border-t-0 sm:px-3 sm:pt-0">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продаж в день</p>
                    <p className="mt-1 text-[12px] font-medium text-[#1F2937] sm:truncate" title={formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}>{formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}</p>
                  </div>
                  <div className="min-w-0 border-l border-t border-[#E6E9EF] pl-3 pt-3 sm:border-l-0 sm:border-t-0 sm:pt-0">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">База по базе</p>
                    <p className="mt-1 text-[12px] font-medium text-[#1F2937]">{manager.basePlan.toLocaleString('ru-RU')} шт.</p>
                  </div>
                </div>

                <div className="mt-3 grid min-w-0 grid-cols-2 overflow-hidden rounded-[8px] border border-[#E6E9EF] sm:grid-cols-5">
                  <div className="min-w-0 border-b border-r border-[#E6E9EF] p-3 sm:border-b-0 sm:p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сегодня</p>
                    <p className="mt-1 text-[13px] font-medium text-[#1F2937] sm:truncate" title={formatCurrency(manager.todayRevenue)}>{formatCurrency(manager.todayRevenue)}</p>
                    <p className="text-[9px] text-[#9CA3AF]">план {formatCurrency(manager.revenuePlan / Math.max(1, manager.monthPlan))}</p>
                  </div>
                  <div className="min-w-0 border-b border-[#E6E9EF] p-3 sm:border-b-0 sm:border-r sm:p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Продажи мес.</p>
                    <p className="mt-1 text-[14px] font-medium text-[#1F2937]">{manager.monthSales}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {manager.remainingSales}</p>
                  </div>
                  <div className="min-w-0 border-b border-r border-[#E6E9EF] p-3 sm:border-b-0 sm:p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">Сумма мес.</p>
                    <p className="mt-1 text-[13px] font-medium text-[#2EBA7F] sm:truncate" title={formatCurrency(manager.monthRevenue)}>{formatCurrency(manager.monthRevenue)}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {formatCurrency(manager.remainingRevenue)}</p>
                  </div>
                  <div className="min-w-0 border-b border-[#E6E9EF] p-3 sm:border-b-0 sm:border-r sm:p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">База</p>
                    <p className="mt-1 text-[14px] font-medium text-[#1F2937]">{manager.baseWorked}</p>
                    <p className="text-[9px] text-[#9CA3AF]">осталось {manager.remainingBase}</p>
                  </div>
                  <div className="col-span-2 min-w-0 p-3 sm:col-span-1 sm:p-2">
                    <p className="text-[10px] font-medium text-[#9CA3AF]">К оплате</p>
                    <p className="mt-1 text-[13px] font-medium text-[#F5A623] sm:truncate" title={formatCurrency(manager.dueExtra)}>{formatCurrency(manager.dueExtra)}</p>
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

        <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(300px,.9fr)_minmax(390px,1.15fr)_minmax(360px,1fr)]">
          <section className="overflow-visible rounded-[10px] border border-[#E6E9EF] bg-white p-4">
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">1</div>
              <div className="min-w-0">
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Клиент и заказ</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Основная информация</p>
              </div>
            </div>
            <div className="min-w-0 space-y-3">
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
                  <label className="relative block">
                    <Instagram className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                    <input
                      type="text"
                      placeholder="Instagram клиента (необязательно)"
                      value={newOrder.clientInsta || ''}
                      onChange={(e) => setNewOrder({...newOrder, clientInsta: e.target.value})}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData('text');
                        if (!/instagram\.com|^@/i.test(pasted.trim())) return;
                        e.preventDefault();
                        setNewOrder({...newOrder, clientInsta: normalizeInstagramUsername(pasted)});
                      }}
                      onBlur={() => setNewOrder(prev => ({...prev, clientInsta: normalizeInstagramUsername(prev.clientInsta)}))}
                      className={cn(newOrderFieldClass, "pl-10")}
                      autoComplete="off"
                    />
                    {normalizeInstagramUsername(newOrder.clientInsta) && (
                      <a
                        href={getInstagramProfileUrl(newOrder.clientInsta)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[#7D7DE6] hover:underline"
                      >
                        открыть
                      </a>
                    )}
                  </label>
                  {String(newOrder.source || '').toLowerCase().includes('блогер') && <div className="relative">
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
                  </div>}
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                {renderNewOrderSelect('Источник', newOrder.source || '', mergeOptions(handbookSources, SOURCE_OPTIONS), (v) => setNewOrder({...newOrder, source: v}), 'Источник')}
              </div>

              <div className="min-w-0 space-y-3">
                {renderNewOrderSelect('Менеджер', newOrder.manager || '', handbookManagers, (v) => setNewOrder({...newOrder, manager: v}), 'Менеджер')}
              </div>

              <div className="mt-4 border-t border-[#E6E9EF] pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Расчёт заказа</span>
                  <span className="text-[10px] font-medium text-[#7D7DE6]">с учётом доставки</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-2.5">
                    <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-[#9CA3AF]">Изделия</p>
                    <p className="mt-1.5 text-[14px] font-medium tabular-nums text-[#1F2937]">{Number(newOrder.revenue || 0).toLocaleString('ru-RU')} ₽</p>
                  </div>
                  <label className="rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-2.5">
                    <span className="text-[8px] font-medium uppercase tracking-[0.1em] text-[#9CA3AF]">Доставка</span>
                    <span className="relative mt-1 block">
                      <input
                        type="number"
                        value={Number.isNaN(newOrder.deliveryPrice) ? '' : newOrder.deliveryPrice || ''}
                        onChange={(e) => updateNewOrderDeliveryPrice(parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full bg-transparent pr-4 text-[14px] font-medium tabular-nums text-[#1F2937] outline-none"
                      />
                      <span className="absolute right-0 top-0 text-[14px] text-[#9CA3AF]">₽</span>
                    </span>
                  </label>
                  <div className="rounded-[8px] border border-emerald-100 bg-emerald-50/70 p-2.5">
                    <p className="text-[8px] font-medium uppercase tracking-[0.1em] text-[#2EBA7F]">К оплате</p>
                    <p className="mt-1.5 text-[14px] font-medium tabular-nums text-[#2EBA7F]">{Number(newOrder.paidAmount || 0).toLocaleString('ru-RU')} ₽</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white p-4">
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">2</div>
              <div className="min-w-0">
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Изделие</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Информация об изделии</p>
              </div>
            </div>
            <div className="space-y-3">
              {newOrderItems.map((item, index) => (
                <div key={index} className="rounded-[8px] border border-[#E6E9EF] bg-[#F8FAFC]/70 p-3">
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
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {renderNewOrderSelect('Цвет', newOrderItemColors[index] || '', handbookColors, (v) => updateNewOrderItemColor(index, v), 'Цвет')}
                    {renderNewOrderSelect('Размер', newOrderItemSizes[index] || '', handbookSizes, (v) => updateNewOrderItemSize(index, v), 'Размер')}
                    {renderNewOrderSelect('Рост', newOrderItemHeights[index] || '', handbookHeights, (v) => updateNewOrderItemHeight(index, v), 'Рост')}
                  </div>
                  <div className="mt-3 flex min-w-0 items-end gap-2">
                    <label className="block min-w-0 flex-1">
                      <span className={newOrderLabelClass}>Цена</span>
                      <span className="relative block min-w-0">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-black text-zinc-300">₽</span>
                        <input
                          type="number"
                          placeholder="Цена изделия"
                          value={newOrderItemPrices[index] || ''}
                          onChange={(e) => updateNewOrderItemPrice(index, parseFloat(e.target.value) || 0)}
                          className={cn(newOrderFieldClass, "pl-10 text-right")}
                        />
                      </span>
                    </label>
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

          <section className="overflow-visible rounded-[10px] border border-[#E6E9EF] bg-white p-4">
            <div className="mb-3 flex min-w-0 items-center gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#7D7DE6]/12 text-[13px] font-medium text-[#7D7DE6]">3</div>
              <div className="min-w-0">
                <h4 className="text-[14px] font-medium leading-5 text-[#1F2937]">Доставка</h4>
                <p className="text-[11px] font-medium leading-[14px] text-[#9CA3AF]">Адрес клиента и накладная</p>
              </div>
            </div>

            <div className="space-y-3">
              {renderNewOrderSelect('Способ доставки', newOrder.deliveryMethod || '', mergeOptions(handbookDeliveries, DELIVERY_OPTIONS), (value) => {
                setNewOrder({...newOrder, deliveryMethod: value});
                setNewOrderFormError('');
              }, 'Выберите доставку')}

              {isNewOrderCdek ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={newOrderLabelClass}>Получение</span>
                      <select
                        value={newCdekDeliveryType}
                        onChange={(event) => {
                          const value = event.target.value as 'pvz' | 'door';
                          setNewCdekDeliveryType(value);
                          setNewCdekTariffCode(value === 'door' ? '139' : '138');
                          setNewCdekPoint('');
                          setNewCdekPointQuery('');
                        }}
                        className={newOrderSelectClass}
                      >
                        <option value="pvz">До ПВЗ</option>
                        <option value="door">Курьером</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={newOrderLabelClass}>Тариф</span>
                      <select
                        value={newCdekTariffCode}
                        onChange={(event) => setNewCdekTariffCode(event.target.value)}
                        className={newOrderSelectClass}
                      >
                        {CDEK_TARIFFS.map(item => (
                          <option key={item.code} value={item.code}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="relative">
                    <span className={newOrderLabelClass}><MapPin className="h-4 w-4" /> Город СДЭК</span>
                    <input
                      value={newCdekCityQuery}
                      onChange={(event) => {
                        setNewCdekCityQuery(event.target.value);
                        setNewCdekCityCode('');
                        setNewCdekPoint('');
                        setNewCdekPointQuery('');
                        setNewOrder(prev => ({ ...prev, clientCity: event.target.value }));
                      }}
                      placeholder="Начните вводить город"
                      className={newOrderFieldClass}
                    />
                    {(newCdekLoadingCities || newCdekCities.length > 0) && (
                      <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[#E6E9EF] bg-white shadow-xl">
                        {newCdekLoadingCities && <p className="px-3 py-2 text-[11px] text-[#9CA3AF]">Ищу город...</p>}
                        {newCdekCities.map(city => (
                          <button
                            key={city.code}
                            type="button"
                            onMouseDown={() => {
                              const label = `${city.city}${city.region ? `, ${city.region}` : ''}`;
                              setNewCdekCityCode(String(city.code));
                              setNewCdekCityQuery(label);
                              setNewOrder(prev => ({ ...prev, clientCity: label }));
                              setNewCdekCities([]);
                            }}
                            className="block w-full px-3 py-2 text-left text-[12px] font-medium text-[#1F2937] hover:bg-[#F6F7F9]"
                          >
                            {city.city}{city.region ? `, ${city.region}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {newCdekDeliveryType === 'pvz' ? (
                    <div className="relative">
                      <span className={newOrderLabelClass}>ПВЗ СДЭК</span>
                      <input
                        value={newCdekPointQuery}
                        onChange={(event) => {
                          setNewCdekPoint('');
                          setNewCdekPointQuery(event.target.value);
                          setNewCdekShowPoints(true);
                        }}
                        onFocus={() => setNewCdekShowPoints(true)}
                        onBlur={() => window.setTimeout(() => setNewCdekShowPoints(false), 150)}
                        disabled={!newCdekCityCode || newCdekLoadingPoints}
                        placeholder={!newCdekCityCode ? 'Сначала выберите город' : newCdekLoadingPoints ? 'Загружаю ПВЗ...' : 'ПВЗ или улица'}
                        className={newOrderFieldClass}
                      />
                      {newCdekShowPoints && newCdekCityCode && !newCdekLoadingPoints && (
                        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-[8px] border border-[#E6E9EF] bg-white shadow-xl">
                          {newCdekFilteredPoints.map(point => {
                            const label = `${point.name || point.code} · ${point.address || point.location?.address || point.code}`;
                            return (
                              <button
                                key={point.code}
                                type="button"
                                onMouseDown={() => {
                                  setNewCdekPoint(point.code);
                                  setNewCdekPointQuery(label);
                                  setNewOrder(prev => ({ ...prev, clientAddress: label }));
                                  setNewCdekShowPoints(false);
                                }}
                                className="block w-full px-3 py-2 text-left text-[11px] font-medium text-[#1F2937] hover:bg-[#F6F7F9]"
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="block">
                      <span className={newOrderLabelClass}>Адрес доставки</span>
                      <input
                        value={newOrder.clientAddress || ''}
                        onChange={(event) => setNewOrder({...newOrder, clientAddress: event.target.value})}
                        placeholder="Улица, дом, квартира"
                        className={newOrderFieldClass}
                      />
                    </label>
                  )}

                  <div className="grid grid-cols-4 gap-2">
                    {[
                      ['Вес, г', newCdekWeight, setNewCdekWeight],
                      ['Длина', newCdekLength, setNewCdekLength],
                      ['Ширина', newCdekWidth, setNewCdekWidth],
                      ['Высота', newCdekHeight, setNewCdekHeight],
                    ].map(([label, value, setter]) => (
                      <label key={String(label)} className="block min-w-0">
                        <span className="mb-1 block truncate text-[8px] font-medium uppercase tracking-[0.1em] text-[#9CA3AF]">{String(label)}</span>
                        <input
                          type="number"
                          value={String(value)}
                          onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
                          className={cn(newOrderFieldClass, "px-2 text-center")}
                        />
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={calculateNewCdekDelivery}
                    disabled={newCdekCalculating || !newCdekCityCode}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[6px] border border-[#D7D7F5] bg-[#F5F5FF] px-3 text-[11px] font-medium text-[#6262D9] transition-colors hover:bg-[#ECECFF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {newCdekCalculating ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                    {newCdekCalculating
                      ? 'СДЭК рассчитывает...'
                      : Number(newOrder.deliveryPrice) > 0
                        ? `Пересчитать доставку · ${Number(newOrder.deliveryPrice).toLocaleString('ru-RU')} ₽`
                        : 'Рассчитать доставку СДЭК'}
                  </button>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={newOrderLabelClass}>Город</span>
                    <input
                      value={newOrder.clientCity || ''}
                      onChange={(event) => setNewOrder({...newOrder, clientCity: event.target.value})}
                      placeholder="Город клиента"
                      className={newOrderFieldClass}
                    />
                  </label>
                  <label className="block">
                    <span className={newOrderLabelClass}>Адрес</span>
                    <input
                      value={newOrder.clientAddress || ''}
                      onChange={(event) => setNewOrder({...newOrder, clientAddress: event.target.value})}
                      placeholder="Адрес доставки"
                      className={newOrderFieldClass}
                    />
                  </label>
                </div>
              )}

              {renderNewOrderSelect('Тип оплаты', newOrder.paymentType || '', INVOICE_PAYMENT_OPTIONS, updateNewOrderPaymentType, 'Выберите тип оплаты')}
            </div>
          </section>

        </div>

          <div className="mt-4 border-t border-[#E6E9EF] pt-4">
            {newOrderMissingFields.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-[8px] border border-amber-100 bg-amber-50 px-3 py-2.5 text-[11px] font-medium leading-5 text-amber-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p><b>Счёт пока недоступен.</b> Заполните: {newOrderMissingFields.join(', ')}.</p>
              </div>
            )}
            {newOrderFormError && (
              <div className="mb-3 flex items-start gap-2 rounded-[8px] border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] font-medium text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>{newOrderFormError}</p>
              </div>
            )}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <button
                type="button"
                onClick={resetNewOrderForm}
                disabled={newOrderSubmitting}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[#E6E9EF] bg-white px-4 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F6F7F9] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Очистить форму
                <RefreshCcw className="h-4 w-4" />
              </button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={saveNewOrderDraft}
                  disabled={newOrderSubmitting}
                  className="inline-flex h-10 items-center justify-center rounded-[6px] border border-[#E6E9EF] bg-white px-5 text-[11px] font-medium text-[#1F2937] transition-colors hover:bg-[#F6F7F9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Сохранить черновик
                </button>
                <button
                  type="button"
                  onClick={createNewOrder}
                  disabled={newOrderSubmitting || newOrderMissingFields.length > 0}
                  title={newOrderMissingFields.length ? `Заполните: ${newOrderMissingFields.join(', ')}` : 'Создать заказ, накладную и счёт'}
                  className="inline-flex h-10 w-full items-center justify-center gap-3 rounded-[6px] bg-[#7D7DE6] px-8 text-[11px] font-medium uppercase tracking-[0.12em] text-white shadow-sm transition-all hover:bg-[#6F6FE0] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[#D7D7F5] disabled:shadow-none sm:w-auto"
                >
                  {newOrderSubmitting ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  {isNewOrderCdek ? 'Создать заказ, накладную и счёт' : 'Создать заказ и счёт'}
                </button>
              </div>
            </div>
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
                if (tochkaConfigured || isYandexSplitPayment(orderSnapshot.paymentType)) {
                  setIsCreatingQr(true);
                  try {
                    const amount = getOrderPaymentDue({
                      revenue: orderSnapshot.revenue || 0,
                      deliveryPrice: orderSnapshot.deliveryPrice || 0,
                      paidAmount: orderSnapshot.paidAmount || 0,
                    });
                    if (amount <= 0) throw new Error('Остаток к оплате 0 ₽');
                    const res = await fetch(getPaymentCreateEndpoint(orderSnapshot.paymentType), {
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

        {/* Итог заказа — появляется после создания */}
        <AnimatePresence>
          {createdOrderId && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 overflow-hidden rounded-[12px] border border-emerald-100 bg-white"
            >
              <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={17} /></div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Заказ создан</p>
                    <p className="mt-0.5 text-[12px] font-medium text-[#1F2937]">№ {createdOrderId} · документы и оплата готовы к отправке</p>
                  </div>
                </div>
                <button onClick={() => { setCreatedOrderId(null); setCreatedPaymentUrl(null); setCreatedShareText(''); setCreatedDocumentStatus(''); setCreatedShowQr(false); }} className="grid h-8 w-8 place-items-center rounded-full text-zinc-300 hover:bg-white hover:text-zinc-500">
                  <X size={14} />
                </button>
              </div>

              <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
                <div className="rounded-[9px] border border-[#E6E9EF] bg-[#F8FAFC] px-3 py-2.5">
                  <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Документ клиента</p>
                  <p className="mt-1 text-[12px] font-medium text-[#1F2937]">Заказ + адрес + накладная СДЭК</p>
                </div>
                <div className="rounded-[9px] border border-[#E6E9EF] bg-[#F8FAFC] px-3 py-2.5">
                  <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Онлайн-оплата</p>
                  <p className="mt-1 flex items-center gap-2 text-[12px] font-medium text-[#1F2937]">
                    {isCreatingQr && <RefreshCcw size={12} className="animate-spin text-[#7D7DE6]" />}
                    {createdPaymentUrl ? 'Ссылка создана' : isCreatingQr ? 'Создаём ссылку…' : 'Ссылка недоступна'}
                  </p>
                </div>
                {createdPaymentUrl && (
                  <button
                    type="button"
                    onClick={() => setCreatedShowQr(value => !value)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[10px] font-medium text-[#6B7280] hover:bg-[#F8FAFC]"
                  >
                    <QrCodeIcon size={14} /> {createdShowQr ? 'Скрыть QR' : 'Показать QR'}
                  </button>
                )}
              </div>

              {createdShowQr && createdPaymentUrl && (
                <div className="mx-4 mb-4 flex items-center gap-4 rounded-[10px] border border-[#E6E9EF] bg-[#F8FAFC] p-3">
                  <div ref={createdQrRef} className="shrink-0 rounded-[8px] border border-zinc-200 bg-white p-2">
                    <QRCodeSVG value={createdPaymentUrl} size={96} />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-[#1F2937]">QR-код оплаты</p>
                    <p className="mt-1 text-[10px] leading-4 text-[#9CA3AF]">Можно показать клиенту с экрана или отправить ссылку кнопкой ниже.</p>
                  </div>
                </div>
              )}

              <div className="grid gap-2 border-t border-[#E6E9EF] p-4 sm:grid-cols-2 xl:grid-cols-4">
                <button
                  type="button"
                  onClick={async () => {
                    setCreatedDocumentLoading(true);
                    setCreatedDocumentStatus('Формируем комплект документов…');
                    try {
                      await shareCustomerOrderPdfById(createdOrderId, setCreatedDocumentStatus, createdShareText);
                      setCreatedDocumentStatus('Комплект документов готов');
                    } catch (e: any) {
                      setCreatedDocumentStatus(e.message || 'Не удалось сформировать документы');
                    } finally {
                      setCreatedDocumentLoading(false);
                    }
                  }}
                  disabled={createdDocumentLoading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#1F2937] px-4 text-[11px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
                >
                  {createdDocumentLoading ? <RefreshCcw size={15} className="animate-spin" /> : <FileText size={15} />}
                  {createdDocumentLoading ? 'Готовим документ…' : 'Поделиться документом'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setCreatedDocumentLoading(true);
                    setCreatedDocumentStatus('Готовим PDF для скачивания…');
                    try {
                      await downloadCustomerOrderPdfById(createdOrderId, setCreatedDocumentStatus);
                      setCreatedDocumentStatus('PDF скачан');
                    } catch (e: any) {
                      setCreatedDocumentStatus(e.message || 'Не удалось скачать документ');
                    } finally {
                      setCreatedDocumentLoading(false);
                    }
                  }}
                  disabled={createdDocumentLoading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[11px] font-medium text-[#1F2937] transition-colors hover:bg-[#F8FAFC] disabled:opacity-60"
                >
                  <Download size={15} /> Скачать PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setCreatedDocumentLoading(true);
                    setCreatedDocumentStatus('Готовим документ к печати…');
                    try {
                      await printCustomerOrderPdfById(createdOrderId, setCreatedDocumentStatus);
                      setCreatedDocumentStatus('Открыто окно печати');
                    } catch (e: any) {
                      setCreatedDocumentStatus(e.message || 'Не удалось распечатать документ');
                    } finally {
                      setCreatedDocumentLoading(false);
                    }
                  }}
                  disabled={createdDocumentLoading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#E6E9EF] bg-white px-4 text-[11px] font-medium text-[#1F2937] transition-colors hover:bg-[#F8FAFC] disabled:opacity-60"
                >
                  <Printer size={15} /> Распечатать
                </button>
                <button
                  type="button"
                  onClick={() => createdPaymentUrl && shareOrder(createdShareText, createdPaymentUrl).catch(() => navigator.clipboard.writeText(createdShareText))}
                  disabled={!createdPaymentUrl || isCreatingQr}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#7D7DE6] px-4 text-[11px] font-medium text-white transition-colors hover:bg-[#6F6FE0] disabled:bg-[#D7D7F5]"
                >
                  <Send size={15} /> Отправить ссылку оплаты
                </button>
              </div>
              {(createdDocumentStatus || (!isCreatingQr && !createdPaymentUrl && createdPaymentError)) && (
                <p className="border-t border-[#E6E9EF] px-4 py-2.5 text-[10px] font-medium text-[#6B7280]">
                  {createdDocumentStatus || createdPaymentError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Orders List Table */}
      <div className={cn(softCardClass, "yb-orders-list overflow-hidden rounded-2xl border-zinc-200/80")}>
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-[16px] font-semibold leading-5 text-zinc-950">Все заказы</h3>
              <p className="mt-1 text-[11px] text-zinc-400">{filteredOrders.length} записей · нажмите «Открыть» для полной карточки</p>
            </div>
            <div className="hidden h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 sm:flex">
              <Calendar className="h-3.5 w-3.5 text-[#9CA3AF]" />
              <select
                value={ordersFilterMonth}
                onChange={(e) => setOrdersFilterMonth(parseInt(e.target.value))}
                className="cursor-pointer bg-transparent text-[11px] font-medium text-zinc-700 outline-none"
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
                placeholder="Найти заказ, клиента или товар..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50/70 pl-9 pr-3 text-[11px] font-medium text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-500/10 sm:w-72"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-zinc-200/80 bg-zinc-50/50 px-5 py-3">
          {[
            { label: 'Все', value: '' },
            { label: 'Предоплата', value: PREPAYMENT_FILTER_VALUE },
            { label: 'Упакован', value: 'Упакован' },
            ...mergeOptions(handbookStatuses, STATUS_OPTIONS)
              .filter(status => !['предоплата', 'упакован'].includes(status.trim().toLowerCase()))
              .map(status => ({ label: status, value: status })),
          ].map(({ label, value }) => {
            const active = orderStatusFilter === value;
            return (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => setOrderStatusFilter(value)}
                className={cn(
                  'h-8 shrink-0 rounded-full border px-3 text-[10px] font-medium transition-colors',
                  active
                    ? value === PREPAYMENT_FILTER_VALUE
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                )}
              >
                {label}
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
                <th className="w-[270px] border-none px-5 py-3">СДЭК / Адрес</th>
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
                      onTogglePin={() => toggleOrderPin(order)}
                      onSelectChange={(checked) => toggleOrderSelection(rowKey, checked)}
                      updateOrderData={updateOrderData}
                      handbookStatuses={handbookStatuses}
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
              onTogglePin={() => toggleOrderPin(order)}
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
