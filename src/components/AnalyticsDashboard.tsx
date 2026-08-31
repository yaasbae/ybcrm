import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import Papa from 'papaparse';
import {
  RefreshCcw, AlertCircle, Download,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  isOverdueOrder,
  isPrepaymentOrder,
  isRefundOrCancelledOrder,
  OVERDUE_FILTER_VALUE,
  PREPAYMENT_FILTER_VALUE,
  REFUND_OR_CANCELLED_FILTER_VALUE,
} from '../lib/orderFilters';
import { matchesOrderSearch } from '../lib/orderSearch';
import { normalizeOrderStatus } from '../lib/orderStatuses';
import { getConfirmedPaidAmount, getOutstandingPaymentAmount } from '../lib/orderPayments';
import { emitPushEvent } from '../lib/pushNotifications';
import { logAuditEvent } from '../lib/auditLog';
import { isClientPurchaseOrder, normalizeClientPhone } from '../lib/clientMerge';
import { getExchangeOrderId } from '../lib/orderExchange';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, collection, updateDoc, query, getDoc } from 'firebase/firestore';
const AnalyticsTab = lazy(() => import('./tabs/AnalyticsTab').then(m => ({ default: m.AnalyticsTab })));
const OrdersTab = lazy(() => import('./tabs/OrdersTab').then(m => ({ default: m.OrdersTab })));
const ClientsTab = lazy(() => import('./tabs/ClientsTab').then(m => ({ default: m.ClientsTab })));
const MarketingTab = lazy(() => import('./tabs/MarketingTab').then(m => ({ default: m.MarketingTab })));

const TabFallback = () => <div className="flex items-center justify-center min-h-[40vh]"><RefreshCcw className="w-6 h-6 text-zinc-300 animate-spin" /></div>;

interface AnalyticsDashboardProps {
  sheetId: string;
  initialTab?: 'analytics' | 'clients' | 'marketing' | 'orders';
  onBack: () => void;
  onNavigate: (view: 'calculator' | 'analytics' | 'orders' | 'clients' | 'marketing' | 'order-form' | 'products' | 'ai-agent' | 'finance', clientData?: any) => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}

export interface OrderData {
  orderId: string;
  firestoreId?: string;
  isFirebase?: boolean;
  date: Date;
  activityAt?: Date;
  exchangeAt?: string;
  exchangeOriginalOrderId?: string;
  exchangeCdekStatus?: 'pending' | 'created' | 'error';
  exchangeCdekError?: string;
  revenue: number;
  deliveryPrice: number;
  paidAmount: number;
  clientPhone: string;
  rawClientPhone?: string;
  clientName: string;
  clientInsta: string;
  clientCity: string;
  clientAddress?: string;
  status: string;
  source: string;
  item: string;
  items?: string[];
  itemPrices?: number[];
  itemCosts?: number[];
  retailItemPrices?: number[];
  bloggerProductCost?: number;
  bloggerDeliveryCost?: number;
  bloggerTotalCost?: number;
  itemColors?: string[];
  itemSizes?: string[];
  itemHeights?: string[];
  itemSewn?: boolean[];
  deliveryMethod: string;
  year: number;
  month: number;
  isBlogger: boolean;
  isRecommended: boolean;
  isPinned?: boolean;
  deadlineDate: Date;
  isShipped: boolean;
  isLate: boolean;
  isOverdue: boolean;
  rawRow: string[];
  height?: string;
  label?: string;
  manager?: string;
  blogger?: string;
  paymentUrl?: string;
  paymentProvider?: 'tochka' | 'yandex_split' | string;
  finalPaymentUrl?: string;
  finalPaymentProvider?: 'tochka' | 'yandex_split' | string;
  finalPaymentId?: string;
  finalPaymentAmount?: number;
  finalPaymentStatus?: string;
  finalPaymentPaidAt?: string;
  paymentAmount?: number;
  paymentId?: string;
  paymentPaidAt?: string;
  refundAmount?: number;
  refundStatus?: string;
  refundId?: string;
  refundPaymentId?: string;
  refundReason?: string;
  refundedAt?: string;
  tochkaPaymentFoundAt?: string;
  tochkaPaymentData?: string;
  paymentStatus?: string;
  initialPaymentAmount?: number;
  paymentAccountingVersion?: number;
  paymentType?: string;
  invoiceType?: 'prepayment' | 'full' | 'fitting';
  notes?: string;
  cdekUuid?: string;
  cdekNumber?: string;
  cdekStatus?: string;
  cdekPayload?: {
    deliveryType?: string;
    toCityCode?: string | number;
    toCity?: string;
    deliveryPoint?: string;
    deliveryPointAddress?: string;
    toAddress?: string;
    weight?: string | number;
    length?: string | number;
    width?: string | number;
    height?: string | number;
    tariffCode?: string | number;
    shipmentDate?: string;
    externalOrderNumber?: string;
    itemCost?: number;
    declaredCost?: number;
    codAmount?: number;
    deliveryCost?: number;
  };
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = (props) => {
  return (
    <ErrorBoundary>
      <AnalyticsDashboardInner {...props} />
    </ErrorBoundary>
  );
};

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'red', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          <h2>Something went wrong in AnalyticsDashboard.</h2>
          {this.state.error && this.state.error.message}
          <br/>
          {this.state.error && this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

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

const getLocalDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const manualReturnOperations = [
  { date: new Date(2026, 0, 26), amount: 17900, description: 'Екатерина Сергеевна А.' },
  { date: new Date(2026, 0, 26), amount: 15000, description: 'Екатерина Сергеевна А.' },
  { date: new Date(2026, 0, 13), amount: 5900, description: 'Кристина Валерьевна О.' },
  { date: new Date(2026, 2, 31), amount: 13550, description: 'Галия Гафуровна Н.' },
  { date: new Date(2026, 2, 11), amount: 11250, description: 'Олеся Владимировна Н.' },
  { date: new Date(2026, 2, 6), amount: 11900, description: 'Кристина Сергеевна А.' },
  { date: new Date(2026, 2, 6), amount: 10000, description: 'Кристина Сергеевна А.' },
  { date: new Date(2026, 3, 29), amount: 8450, description: 'Екатерина Владимировна К.' },
  { date: new Date(2026, 3, 20), amount: 11900, description: 'Мария Васильевна А.' },
  { date: new Date(2026, 3, 15), amount: 11900, description: 'Динара Рауфовна А.' },
  { date: new Date(2026, 3, 13), amount: 10900, description: 'Наиля Рашитовна А.' },
  { date: new Date(2026, 3, 13), amount: 10000, description: 'Наиля Рашитовна А.' },
  { date: new Date(2026, 3, 2), amount: 17250, description: 'Нарина Минасовна В.' },
  { date: new Date(2026, 4, 27), amount: 16250, description: 'Ольга Захарова Д.' },
  { date: new Date(2026, 4, 22), amount: 9950, description: 'Виктория Сергеевна Г.' },
  { date: new Date(2026, 4, 15), amount: 20550, description: 'Эльвира Махмуджановна П.' },
  { date: new Date(2026, 4, 12), amount: 6000, description: 'Екатерина Николаевна Ф.' },
  { date: new Date(2026, 4, 12), amount: 4400, description: 'Екатерина Николаевна Ф.' },
  { date: new Date(2026, 4, 11), amount: 15600, description: 'Светлана Николаевна Ч.' },
  { date: new Date(2026, 4, 9), amount: 18900, description: 'Зиля Вазиховна Г.' },
];

const getManualReturnKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}`;

const AnalyticsDashboardInner: React.FC<AnalyticsDashboardProps> = ({
  initialTab = 'analytics',
  onBack,
  onNavigate,
  selectedMonth,
  setSelectedMonth
}) => {
  const [activeTab, setActiveTab] = useState<'analytics' | 'clients' | 'marketing' | 'orders'>(initialTab ?? 'analytics');
  const [data, setData] = useState<OrderData[]>([]);
  const [firebaseOrders, setFirebaseOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState<string>('Загрузка заказов CRM...');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [ordersFilterMonth, setOrdersFilterMonth] = useState<number>(-1);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('');
  const [orderBloggerFilter, setOrderBloggerFilter] = useState<string>('');
  const [slaFilterMonth, setSlaFilterMonth] = useState<number>(-1);
  const [searchTerm, setSearchTerm] = useState("");
  const [displayCount, setDisplayCount] = useState(50);

  const [handbookProducts, setHandbookProducts] = useState<string[]>([]);
  const [handbookColors, setHandbookColors] = useState<string[]>([]);
  const [handbookSizes, setHandbookSizes] = useState<string[]>([]);
  const [handbookHeights, setHandbookHeights] = useState<string[]>([]);
  const [handbookCompositions, setHandbookCompositions] = useState<string[]>([]);
  const [handbookStatuses, setHandbookStatuses] = useState<string[]>([]);
  const [handbookSources, setHandbookSources] = useState<string[]>([]);
  const [handbookLabels, setHandbookLabels] = useState<string[]>([]);
  const [handbookDeliveries, setHandbookDeliveries] = useState<string[]>([]);
  const [handbookPaymentTypes, setHandbookPaymentTypes] = useState<string[]>([]);
  const [handbookManagers, setHandbookManagers] = useState<string[]>([]);
  const [handbookBloggers, setHandbookBloggers] = useState<string[]>([]);
  const [newOrder, setNewOrder] = useState<Partial<OrderData>>({
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
    status: 'Новый',
    revenue: 0,
    paidAmount: 0,
    deliveryMethod: '',
    paymentType: 'Предоплата 50%',
    invoiceType: 'prepayment',
    source: '',
    height: '',
    label: '',
    manager: '',
    blogger: '',
    rawRow: Array(30).fill('')
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'handbook'), (snap) => {
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
        setHandbookManagers(Array.from(new Set([...(Array.isArray(d.managers) ? d.managers : []), 'Менеджер 1', 'Менеджер 2', 'Собственник'])));
        if (d.bloggers) setHandbookBloggers(d.bloggers);
      } else {
        console.warn('[handbook] Документ settings/handbook не найден — выпадающие списки будут пустыми');
      }
    }, (error) => {
      console.error('[handbook] Не удалось прочитать справочник settings/handbook:', error);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab as any);
      setSearchTerm("");
    }
  }, [initialTab]);


  const updateOrderData = async (orderId: string, field: keyof OrderData | string, value: any) => {
    const order = data.find(o => o.orderId === orderId);
    if (order?.isFirebase) {
      try {
        let finalValue = value;
        if (field === 'isRecommended') finalValue = !order.isRecommended;
        if (field === 'clientPhone') finalValue = normalizeClientPhone(value);

        const ordersNewPatch: Record<string, any> = {};
        const firestoreId = order.firestoreId || orderId;
        const isNewExchange = field === 'status'
          && normalizeOrderStatus(String(finalValue || '')).toLowerCase() === 'обмен'
          && normalizeOrderStatus(String(order.status || '')).toLowerCase() !== 'обмен';

        if (isNewExchange) {
          const now = new Date();
          const exchangedOrderId = getExchangeOrderId(order.orderId);
          const exchangePatch = {
            status: 'Обмен',
            orderId: exchangedOrderId,
            exchangeOriginalOrderId: order.exchangeOriginalOrderId || order.orderId,
            exchangeAt: now.toISOString(),
            activityAt: now.toISOString(),
            exchangeCdekStatus: 'pending',
            exchangeCdekError: '',
            updatedAt: now.toISOString(),
          };
          await updateDoc(doc(db, 'orders_new', firestoreId), exchangePatch);
          void logAuditEvent({
            action: 'order_exchange_started',
            entityType: 'order',
            entityId: exchangedOrderId,
            before: order,
            after: { ...order, ...exchangePatch },
            metadata: { previousOrderId: order.orderId, shipmentDate: getLocalDateKey(now) },
          });
          void emitPushEvent('order_status_changed', `order-exchange:${exchangedOrderId}:${now.getTime()}`, {
            orderId: exchangedOrderId,
            clientName: order.clientName,
            previousStatus: String(order.status || ''),
            status: 'Обмен',
          });

          const saved = order.cdekPayload || {};
          const deliveryType = String(saved.deliveryType || '').trim()
            || (/курьер|до двери/i.test(String(order.deliveryMethod || '')) ? 'door' : 'pvz');
          const deliveryPoint = String(saved.deliveryPoint || order.clientAddress?.match(/^([A-ZА-Я]{2,8}\d{1,5})(?:\s|,|·)/i)?.[1] || '').trim();
          const toAddress = String(saved.toAddress || order.clientAddress || '').trim();
          try {
            const response = await fetch('/api/cdek/create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: exchangedOrderId,
                recipientName: order.clientName,
                recipientPhone: order.clientPhone,
                itemName: (order.items?.length ? order.items.join(', ') : order.item) || `Заказ ${exchangedOrderId}`,
                itemCost: Number(saved.itemCost ?? order.revenue) || 0,
                declaredCost: Number(saved.declaredCost) || 0,
                codAmount: Number(saved.codAmount) || 0,
                deliveryCost: Number(saved.deliveryCost ?? order.deliveryPrice) || 0,
                tariffCode: Number(saved.tariffCode || (deliveryType === 'door' ? 139 : 138)),
                deliveryType,
                toCityCode: Number(saved.toCityCode || 0),
                toCity: String(saved.toCity || order.clientCity || ''),
                deliveryPoint,
                deliveryPointAddress: String(saved.deliveryPointAddress || (deliveryType === 'pvz' ? order.clientAddress || '' : '')),
                toAddress,
                weight: Number(saved.weight || 700),
                length: Number(saved.length || 30),
                width: Number(saved.width || 20),
                height: Number(saved.height || 10),
                comment: `Обмен по заказу ${order.orderId}. Адрес доставки без изменений.`,
                recreate: true,
                exchange: true,
                shipmentDate: getLocalDateKey(now),
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result?.error || result?.message || 'СДЭК не принял новую накладную');
            await updateDoc(doc(db, 'orders_new', firestoreId), {
              exchangeCdekStatus: 'created',
              exchangeCdekError: '',
              updatedAt: new Date().toISOString(),
            });
          } catch (exchangeError: any) {
            const message = exchangeError?.message || 'Не удалось пересоздать накладную СДЭК';
            await updateDoc(doc(db, 'orders_new', firestoreId), {
              exchangeCdekStatus: 'error',
              exchangeCdekError: message,
              updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
            window.alert(`Заказ ${exchangedOrderId} поднят как обмен, но накладная СДЭК не создана: ${message}`);
          }
          return;
        }

        if (typeof field === 'string' && field.startsWith('rawRow[')) {
          const index = parseInt(field.match(/\[(\d+)\]/)![1], 10);
          const rawRow = [...(order.rawRow || Array(30).fill(''))];
          rawRow[index] = finalValue;
          ordersNewPatch.rawRow = rawRow;
        } else {
          ordersNewPatch[field] = finalValue;
          if (field === 'blogger') {
            const hasBlogger = Boolean(String(finalValue || '').trim());
            const sourceLooksBlogger = String(order.source || '').toLowerCase().includes('блогер');
            ordersNewPatch.isBlogger = hasBlogger || sourceLooksBlogger;
          }
        }

        const before = order;
        const after = {
          ...order,
          ...ordersNewPatch,
        };
        await updateDoc(doc(db, 'orders_new', firestoreId), {
          ...ordersNewPatch,
          updatedAt: new Date().toISOString(),
        });
        void logAuditEvent({
          action: 'order_updated',
          entityType: 'order',
          entityId: orderId,
          before,
          after,
          metadata: { field },
        });
        if (field === 'manager' && String(finalValue || '').trim() && String(order.manager || '') !== String(finalValue || '')) {
          void emitPushEvent('manager_assigned', `manager-assigned:${orderId}:${String(finalValue)}`, {
            orderId,
            clientName: order.clientName,
            manager: String(finalValue),
          });
        }
        if (field === 'status' && String(order.status || '') !== String(finalValue || '')) {
          void emitPushEvent('order_status_changed', `order-status:${orderId}:${String(finalValue)}:${Date.now()}`, {
            orderId,
            clientName: order.clientName,
            previousStatus: String(order.status || ''),
            status: String(finalValue || ''),
          });
        }
      } catch (err) {
        console.error("Firebase update failed", err);
      }
    } else {
      setData(prevData => prevData.map(existingOrder => (
        existingOrder.orderId === orderId
          ? { ...existingOrder, [field]: field === 'isRecommended' ? !existingOrder.isRecommended : value }
          : existingOrder
      )));
    }
  };

  const deleteOrder = async (orderId: string): Promise<boolean> => {
    try {
      const existingOrder = data.find(order => order.orderId === orderId);
      const orderRef = doc(db, 'orders_new', existingOrder?.firestoreId || orderId);
      const beforeSnap = await getDoc(orderRef).catch(() => null);
      const before = beforeSnap?.exists() ? beforeSnap.data() : data.find(order => order.orderId === orderId);
      const deletedAt = new Date().toISOString();
      const patch = {
        deleted: true,
        deletedAt,
        updatedAt: deletedAt,
      };
      await setDoc(orderRef, patch, { merge: true });
      void logAuditEvent({
        action: 'order_deleted',
        entityType: 'order',
        entityId: orderId,
        before,
        after: { ...(before || {}), ...patch },
        metadata: { softDelete: true },
      });
      return true;
    } catch (err) {
      console.error("Delete failed", err);
      return false;
    }
  };

  const handleCreateOrder = async (orderDraft: Partial<OrderData> = newOrder): Promise<string | null> => {
    if (!orderDraft.orderId || !orderDraft.clientName) {
      alert('Укажите ID заказа и ФИО клиента');
      return null;
    }

    const rawRow = [...(orderDraft.rawRow || Array(30).fill(''))];
    while (rawRow.length < 30) rawRow.push('');
    rawRow[14] = String(orderDraft.revenue || '');
    rawRow[15] = String(orderDraft.deliveryPrice || '');
    rawRow[16] = String(orderDraft.paidAmount || '');

    const newOrderItems = Array.isArray(orderDraft.items)
      ? orderDraft.items.map(item => String(item || '').trim()).filter(Boolean)
      : String(orderDraft.item || '').split(',').map(item => item.trim()).filter(Boolean);
    const newOrderItemText = newOrderItems.join(', ');
    const newOrderItemPrices = Array.isArray(orderDraft.itemPrices)
      ? orderDraft.itemPrices.map(price => Number(price) || 0)
      : [];
    const newOrderItemColors = Array.isArray(orderDraft.itemColors)
      ? newOrderItems.map((_, index) => String(orderDraft.itemColors?.[index] || '').trim())
      : newOrderItems.map((_, index) => index === 0 ? String(rawRow[1] || '').trim() : '');
    const newOrderItemSizes = Array.isArray(orderDraft.itemSizes)
      ? newOrderItems.map((_, index) => String(orderDraft.itemSizes?.[index] || '').trim())
      : newOrderItems.map((_, index) => index === 0 ? String(rawRow[8] || '').trim() : '');
    const newOrderItemHeights = Array.isArray(orderDraft.itemHeights)
      ? newOrderItems.map((_, index) => String(orderDraft.itemHeights?.[index] || '').trim())
      : newOrderItems.map((_, index) => index === 0 ? String(orderDraft.height || '').trim() : '');
    if (newOrderItemColors[0]) rawRow[1] = newOrderItemColors[0];
    if (newOrderItemSizes[0]) rawRow[8] = newOrderItemSizes[0];
    const itemPricesTotal = newOrderItemPrices.reduce((sum, price) => sum + price, 0);
    const totalRevenue = itemPricesTotal > 0 ? itemPricesTotal : (orderDraft.revenue || 0);
    const invoiceType = orderDraft.invoiceType || 'prepayment';
    const fullInvoiceAmount = totalRevenue + (orderDraft.deliveryPrice || 0);
    const invoiceAmount = invoiceType === 'fitting'
      ? 2000
      : invoiceType === 'full'
        ? fullInvoiceAmount
        : fullInvoiceAmount * 0.5;

    const orderDate = orderDraft.date || new Date();
    const bloggerName = String(orderDraft.blogger || '').trim();
    const isBloggerOrder = Boolean(bloggerName) || String(orderDraft.source || '').toLowerCase().includes('блогер');
    const orderToCreate: OrderData = {
      orderId: orderDraft.orderId || '',
      date: orderDate,
      revenue: totalRevenue,
      deliveryPrice: orderDraft.deliveryPrice || 0,
      paidAmount: orderDraft.paidAmount || invoiceAmount,
      initialPaymentAmount: orderDraft.initialPaymentAmount || orderDraft.paidAmount || invoiceAmount,
      paymentAccountingVersion: 2,
      clientPhone: normalizeClientPhone(orderDraft.clientPhone),
      clientName: orderDraft.clientName || '',
      clientInsta: orderDraft.clientInsta || '',
      clientCity: orderDraft.clientCity || '',
      clientAddress: orderDraft.clientAddress || '',
      status: orderDraft.status || 'Новый',
      source: orderDraft.source || '',
      item: orderDraft.item || newOrderItemText,
      items: newOrderItems,
      itemPrices: newOrderItemPrices,
      itemColors: newOrderItemColors,
      itemSizes: newOrderItemSizes,
      itemHeights: newOrderItemHeights,
      itemSewn: newOrderItems.map(() => false),
      deliveryMethod: orderDraft.deliveryMethod || '',
      paymentType: orderDraft.paymentType || '',
      invoiceType,
      year: orderDate.getFullYear(),
      month: orderDate.getMonth(),
      isBlogger: isBloggerOrder,
      isRecommended: false,
      deadlineDate: addBusinessDays(orderDate, 7),
      isShipped: false,
      isLate: false,
      isOverdue: false,
      rawRow,
      height: orderDraft.height || '',
      label: orderDraft.label || '',
      manager: orderDraft.manager || '',
      blogger: bloggerName,
      ...(orderDraft.cdekPayload ? { cdekPayload: orderDraft.cdekPayload } : {}),
      isFirebase: true
    };

    try {
      const orderRef = doc(db, 'orders_new', orderToCreate.orderId);
      const beforeSnap = await getDoc(orderRef).catch(() => null);
      const before = beforeSnap?.exists() ? beforeSnap.data() : null;
      const now = new Date().toISOString();
      const savedOrder = {
        ...orderToCreate,
        date: orderToCreate.date.toISOString(),
        deadlineDate: orderToCreate.deadlineDate.toISOString(),
        createdAt: before && typeof before === 'object' && 'createdAt' in before ? (before as any).createdAt : now,
        updatedAt: now,
        deleted: false,
      };
      await setDoc(orderRef, savedOrder, { merge: true });
      const normalizedPhone = normalizeClientPhone(orderToCreate.clientPhone);
      const contactId = normalizedPhone || `order-${orderToCreate.orderId}`;
      const contactRef = doc(db, 'contacts', contactId);
      const existingContact = await getDoc(contactRef).catch(() => null);
      await setDoc(contactRef, {
        userId: contactId,
        fullName: orderToCreate.clientName,
        phone: normalizedPhone,
        insta: String(orderToCreate.clientInsta || '').replace(/^@/, '').trim(),
        city: orderToCreate.clientCity || '',
        address: orderToCreate.clientAddress || '',
        source: orderToCreate.source || 'Заказ CRM',
        createdAt: existingContact?.exists() ? existingContact.data()?.createdAt || now : now,
        updatedAt: now,
        lastOrderId: orderToCreate.orderId,
        lastOrderAt: orderToCreate.date.toISOString(),
      }, { merge: true });
      void logAuditEvent({
        action: before ? 'order_upserted' : 'order_created',
        entityType: 'order',
        entityId: orderToCreate.orderId,
        before,
        after: savedOrder,
        metadata: { source: 'crm_order_form' },
      });
      const createdId = orderToCreate.orderId;
      if (orderToCreate.status !== 'Черновик') {
        void emitPushEvent('order_created', `order-created:${createdId}`, {
          orderId: createdId,
          clientName: orderToCreate.clientName,
          manager: orderToCreate.manager,
          amount: orderToCreate.revenue + orderToCreate.deliveryPrice,
        });
      }
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
        status: 'Новый',
        revenue: 0,
        paidAmount: 0,
        deliveryMethod: '',
        paymentType: 'Предоплата 50%',
        invoiceType: 'prepayment',
        source: '',
        height: '',
        label: '',
        manager: '',
        blogger: '',
        rawRow: Array(30).fill('')
      });
      return createdId;
    } catch (err) {
      console.error(err);
      alert('Ошибка: ' + (err as any).message);
      return null;
    }
  };

  const fetchData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else {
      setLoading(true);
      setLoadingStep('Загрузка заказов CRM...');
    }

    try {
      setData(firebaseOrders.slice().sort((a, b) => b.date.getTime() - a.date.getTime()));
      setError(null);
      setSheetWarning(null);
    } catch (err: any) {
      console.error('[orders_new] Не удалось обновить локальный список заказов:', err);
      setError(null);
      setSheetWarning('Не удалось обновить локальный список заказов. Данные из таблицы больше не подтягиваются.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setTimeout(() => setLastUpdated(new Date()), 0);
    }
  };

  useEffect(() => {
    const initFetch = async () => {
      await fetchData();
    };
    initFetch();
    return () => {
    };
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'orders_new'));
    const unsub = onSnapshot(q, (snapshot) => {
      const fbOrders: OrderData[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        if (d.deleted === true) return;
        const orderDate = d.date ? new Date(d.date) : new Date();
        const storedDeadlineDate = d.deadlineDate || d.shipmentDate
          ? new Date(d.deadlineDate || d.shipmentDate)
          : null;
        const deadlineDate = storedDeadlineDate && Number.isFinite(storedDeadlineDate.getTime())
          ? storedDeadlineDate
          : addBusinessDays(orderDate, 7);
        const status = normalizeOrderStatus(d.status || 'Новый');
        const normalizedStatus = status.toLowerCase();
        const hasBlogger = Boolean(String(d.blogger || '').trim()) || String(d.source || '').toLowerCase().includes('блогер');
        const isShipped = Boolean(d.isShipped)
          || normalizedStatus === 'отправлен'
          || normalizedStatus === 'готов'
          || normalizedStatus.includes('отгруж')
          || normalizedStatus.includes('достав')
          || normalizedStatus.includes('получ');
        const isOverdue = !isShipped && !isRefundOrCancelledOrder({ status }) && new Date() > deadlineDate;
        fbOrders.push({
          ...d,
          firestoreId: docSnap.id,
          rawClientPhone: String(d.clientPhone || ''),
          clientPhone: normalizeClientPhone(d.clientPhone),
          status,
          isFirebase: true,
          date: orderDate,
          activityAt: d.activityAt ? new Date(d.activityAt) : undefined,
          deadlineDate,
          isBlogger: Boolean(d.isBlogger) || hasBlogger,
          isShipped,
          isOverdue,
          isLate: isOverdue
        } as OrderData);
      });
      setFirebaseOrders(fbOrders);
    }, (error) => {
      console.error('[orders_new] Не удалось прочитать заказы из Firestore:', error);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setData(firebaseOrders.slice().sort((a, b) => b.date.getTime() - a.date.getTime()));
    setLoading(false);
    setLastUpdated(new Date());
  }, [firebaseOrders]);

  useEffect(() => {
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(() => fetchData(true), 60000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, firebaseOrders]);

  const exportToCsv = () => {
    if (data.length === 0) return;

    const csvData = data.map(o => ({
      'Дата': o.date ? o.date.toLocaleDateString('ru-RU') : '',
      'ID заказа': o.orderId || '',
      'Клиент': o.clientName || '',
      'Телефон': o.clientPhone || '',
      'Статус': o.status || '',
      'Доставка': o.deliveryMethod || '',
      'Стоимость 100%': Number(o.revenue) || 0,
      'Стоимость доставки': Number(o.deliveryPrice) || 0,
      'Подтверждено оплачено': getConfirmedPaidAmount(o),
      'Остаток к оплате': getOutstandingPaymentAmount(o),
      'Изделия': Array.isArray(o.items) && o.items.length ? o.items.join(', ') : o.item || '',
      'Цены изделий': Array.isArray(o.itemPrices) ? o.itemPrices.join(', ') : '',
      'Цвета': Array.isArray(o.itemColors) ? o.itemColors.join(', ') : String(o.rawRow?.[1] || ''),
      'Размеры': Array.isArray(o.itemSizes) ? o.itemSizes.join(', ') : String(o.rawRow?.[8] || ''),
      'Рост': Array.isArray(o.itemHeights) ? o.itemHeights.join(', ') : o.height || '',
      'Источник': o.source || '',
      'Блогер': o.blogger || '',
      'Менеджер': o.manager || '',
      'Срок': o.deadlineDate ? o.deadlineDate.toLocaleDateString('ru-RU') : '',
      'Заметки': o.notes || '',
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `orders_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = useMemo(() => {
    if (data.length === 0) {
      return {
        totalOrders: 0,
        uniqueClients: 0,
        totalRevenue: 0,
        topClients: [],
        topProducts: [],
        chartData: [],
        bestMonths: [],
        bloggersByMonth: [],
        bloggersList: [],
        ltvByYear: {},
        growthText: "в процессе накопления данных",
        bloggerOrdersCount: 0,
        bloggerRevenue: 0,
        uniqueOrders: [],
        returnsCount: 0,
        exchangesCount: 0,
        totalActualPayments: 0,
        totalDueExtraPayments: 0,
        salesCount: 0,
        currentMonthDailyRows: [],
        dailyRowsByMonth: {},
        uniqueSizes: [],
        uniqueDeliveries: ['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS'],
        uniquePromotions: [],
        productsInTable: [],
        uniqueColors: [],
        uniqueSources: ['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный'],
        uniqueCategories: [],
        slaStats: {
          totalOrders: 0,
          shipped: 0,
          inProgress: 0,
          onTime: 0,
          overdue: 0,
          onTimeRate: 0
        }
      };
    }

    const ordersMap = new Map<string, OrderData>();
    data.forEach(row => {
      const existing = ordersMap.get(row.orderId);
      if (existing) {
        if (existing.isFirebase || row.isFirebase) {
          const firebaseOrder = row.isFirebase ? row : existing;
          const sheetOrder = row.isFirebase ? existing : row;
          ordersMap.set(row.orderId, {
            ...sheetOrder,
            ...firebaseOrder,
            rawRow: firebaseOrder.rawRow?.length ? firebaseOrder.rawRow : sheetOrder.rawRow,
          });
          return;
        }
        existing.revenue += row.revenue;
        existing.deliveryPrice += row.deliveryPrice;
        existing.paidAmount += row.paidAmount;
        if (!existing.clientName && row.clientName) existing.clientName = row.clientName;
        if (!existing.clientPhone && row.clientPhone) existing.clientPhone = row.clientPhone;
        if (!existing.clientInsta && row.clientInsta) existing.clientInsta = row.clientInsta;
        if (!existing.status && row.status) existing.status = row.status;
        if (!existing.source && row.source) existing.source = row.source;
        if ((!existing.items || existing.items.length === 0) && row.items?.length) existing.items = row.items;
      } else {
        ordersMap.set(row.orderId, { ...row });
      }
    });

    const uniqueOrders = Array.from(ordersMap.values());
    const totalOrders = uniqueOrders.length;

    const clientMap = new Map<string, { name: string, phone: string, insta: string, city: string, total: number, count: number }>();
    uniqueOrders.forEach(o => {
      const normalizedPhone = normalizeClientPhone(o.clientPhone);
      const normalizedName = String(o.clientName || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
      const clientKey = normalizedPhone ? `phone:${normalizedPhone}` : normalizedName ? `name:${normalizedName}` : "Unknown";
      if (clientKey === "Unknown") return;
      const current = clientMap.get(clientKey) || { name: o.clientName, phone: normalizedPhone, insta: o.clientInsta, city: o.clientCity, total: 0, count: 0 };
      const isPurchase = isClientPurchaseOrder(o);
      clientMap.set(clientKey, {
        name: o.clientName || current.name,
        phone: normalizedPhone || current.phone,
        insta: o.clientInsta || current.insta,
        city: o.clientCity || current.city,
        total: current.total + (isPurchase ? Number(o.revenue) || 0 : 0),
        count: current.count + (isPurchase ? 1 : 0)
      });
    });

    const topClients = Array.from(clientMap.values()).sort((a, b) => b.total - a.total);

    const bloggerMap = new Map<string, { name: string, phone: string, insta: string, city: string, count: number, orders: string[] }>();
    uniqueOrders.forEach(o => {
      if (!o.isBlogger) return;
      const key = o.clientPhone || o.clientName || "Unknown";
      if (key === "Unknown") return;
      const current = bloggerMap.get(key) || { name: o.clientName, phone: o.clientPhone, insta: o.clientInsta, city: o.clientCity, count: 0, orders: [] };
      bloggerMap.set(key, { ...current, count: current.count + 1, orders: [...current.orders, o.orderId] });
    });

    const bloggersList = Array.from(bloggerMap.values());
    const uniqueClients = clientMap.size;
    const isSalesOrder = (o: OrderData) => {
      if (o.isBlogger) return false;
      const status = String(o.status || '').toLowerCase();
      return (Number(o.revenue) || 0) > 0 && !status.includes('возврат') && !status.includes('отмена');
    };
    const salesOrders = uniqueOrders.filter(isSalesOrder);
    const manualReturnAmount = manualReturnOperations.reduce((sum, item) => sum + item.amount, 0);
    const totalRevenue = salesOrders.reduce((acc, curr) => acc + curr.revenue, 0) - manualReturnAmount;

    const productMap = new Map<string, { name: string, total: number, count: number }>();
    data.forEach(row => {
      const rowItems = (Array.isArray(row.items) && row.items.length ? row.items : String(row.item || '').split(/\s*,\s*|\n/))
        .map(item => String(item || '').trim())
        .filter(Boolean);
      rowItems.forEach(item => {
      if (!item || item.length < 3) return;
      const name = item.split('(')[0].trim();
      if (name.length < 3) return;
      const current = productMap.get(name) || { name, total: 0, count: 0 };
      productMap.set(name, { name, total: current.total + row.revenue, count: current.count + 1 });
      });
    });

    const topProducts = Array.from(productMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

    const salesByPeriod: any = {};
    uniqueOrders.forEach(o => {
      const key = `${o.year}-${o.month + 1}`;
      if (!salesByPeriod[key]) salesByPeriod[key] = {
        revenue: 0, count: 0, returns: 0, bloggers: new Set(),
        paidAmount: 0, salesCount: 0, dueExtra: 0, delivery: 0
      };
      salesByPeriod[key].count += 1;
      const isReturn = o.status?.toLowerCase().includes('возврат');
      const isCancelled = o.status?.toLowerCase().includes('отмена');
      if (isReturn || isCancelled) salesByPeriod[key].returns += 1;
      if (isReturn || isCancelled) {
        salesByPeriod[key].orderReturnsAmount = (salesByPeriod[key].orderReturnsAmount || 0)
          + (Number(o.refundAmount) || getConfirmedPaidAmount(o) || Number(o.revenue) || 0);
      }
      if (isSalesOrder(o)) {
        salesByPeriod[key].revenue += o.revenue;
        salesByPeriod[key].paidAmount += getConfirmedPaidAmount(o);
        salesByPeriod[key].delivery += o.deliveryPrice;
        salesByPeriod[key].salesCount += 1;
        salesByPeriod[key].dueExtra += getOutstandingPaymentAmount(o);
      }
      if (o.blogger) salesByPeriod[key].bloggers.add(o.blogger);
      else if (o.source?.toLowerCase().includes('блогер')) salesByPeriod[key].bloggers.add(o.source);
    });

    manualReturnOperations.forEach(operation => {
      const key = getManualReturnKey(operation.date);
      if (!salesByPeriod[key]) salesByPeriod[key] = {
        revenue: 0, count: 0, returns: 0, bloggers: new Set(),
        paidAmount: 0, salesCount: 0, dueExtra: 0, delivery: 0,
        manualReturnsAmount: 0, manualReturnsCount: 0
      };
      salesByPeriod[key].returns += 1;
      salesByPeriod[key].manualReturnsAmount = (salesByPeriod[key].manualReturnsAmount || 0) + operation.amount;
      salesByPeriod[key].manualReturnsCount = (salesByPeriod[key].manualReturnsCount || 0) + 1;
    });

    const chartData = Object.entries(salesByPeriod).map(([key, val]: any) => {
      const [year, month] = key.split('-');
      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const monthIndex = parseInt(month, 10) - 1;
      const monthName = monthNames[monthIndex] || '???';
      const manualReturnsAmount = Number(val.manualReturnsAmount) || 0;
      const orderReturnsAmount = Number(val.orderReturnsAmount) || 0;
      const returnsAmount = manualReturnsAmount + orderReturnsAmount;
      return {
        period: `${monthName} ${year}`,
        shortPeriod: `${monthName.substring(0, 3)} ${year.substring(2)}`,
        monthName,
        revenue: val.revenue - returnsAmount,
        orders: val.count,
        totalOrders: val.count,
        sales: val.salesCount,
        paid: val.paidAmount,
        dueExtra: val.dueExtra,
        returns: val.returns,
        returnsAmount,
        orderReturnsAmount,
        manualReturnsCount: Number(val.manualReturnsCount) || 0,
        bloggers: val.bloggers.size,
        year: parseInt(year, 10),
        month: parseInt(month, 10)
      };
    }).sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    type DailySalesRow = {
      day: number;
      dateLabel: string;
      orders: number;
      sales: number;
      salesAmount: number;
      paid: number;
      dueExtra: number;
      returnsAmount: number;
      delivery: number;
    };
    const dailyMaps = new Map<number, Map<number, DailySalesRow>>();
    for (let month = 0; month < 12; month += 1) {
      const monthMap = new Map<number, DailySalesRow>();
      const daysInMonth = new Date(currentYear, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(currentYear, month, day);
        monthMap.set(day, {
          day,
          dateLabel: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
          orders: 0,
          sales: 0,
          salesAmount: 0,
          paid: 0,
          dueExtra: 0,
          returnsAmount: 0,
          delivery: 0,
        });
      }
      dailyMaps.set(month, monthMap);
    }

    uniqueOrders.forEach((order) => {
      const date = order.date instanceof Date ? order.date : new Date(order.date);
      if (!date || Number.isNaN(date.getTime()) || date.getFullYear() !== currentYear) return;
      const dayRow = dailyMaps.get(date.getMonth())?.get(date.getDate());
      if (!dayRow) return;
      const revenue = Number(order.revenue) || 0;
      const paid = getConfirmedPaidAmount(order);
      const delivery = Number(order.deliveryPrice) || 0;
      dayRow.orders += 1;
      const status = String(order.status || '').toLowerCase();
      if (status.includes('возврат') || status.includes('отмена')) {
        dayRow.returnsAmount += Number(order.refundAmount) || paid || revenue;
        return;
      }
      if (isSalesOrder(order)) {
        dayRow.sales += 1;
        dayRow.salesAmount += revenue;
        dayRow.paid += paid;
        dayRow.delivery += delivery;
        dayRow.dueExtra += getOutstandingPaymentAmount(order);
      }
    });

    manualReturnOperations.forEach((operation) => {
      if (operation.date.getFullYear() !== currentYear) return;
      const dayRow = dailyMaps.get(operation.date.getMonth())?.get(operation.date.getDate());
      if (!dayRow) return;
      dayRow.returnsAmount += operation.amount;
    });

    const dailyRowsByMonth = Object.fromEntries(Array.from(dailyMaps.entries()).map(([month, monthMap]) => [
      month,
      Array.from(monthMap.values())
        .map(row => ({
          ...row,
          net: row.paid - row.returnsAmount,
          isToday: month === currentMonth && row.day === today.getDate(),
          hasActivity: row.orders > 0 || row.salesAmount > 0 || row.paid > 0 || row.dueExtra > 0 || row.returnsAmount > 0,
        }))
        .filter(row => row.hasActivity)
        .sort((a, b) => a.day - b.day),
    ]));
    const currentMonthDailyRows = dailyRowsByMonth[currentMonth] || [];

    const bestMonths = [...chartData].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const bloggersByMonth = chartData.map(d => ({ name: d.period, count: d.bloggers }));

    const ltvByYear: any = {};
    const years = Array.from(new Set(uniqueOrders.map(o => o.year))).sort();
    years.forEach(year => {
      const yearData = uniqueOrders.filter(o => o.year === year);
      const yearRevenue = yearData.reduce((acc, curr) => acc + curr.revenue, 0);
      const yearClients = new Set(yearData.map(o => o.clientPhone)).size;
      ltvByYear[year] = yearClients > 0 ? yearRevenue / yearClients : 0;
    });

    let growthText = "в процессе накопления данных";
    if (chartData.length >= 13) {
      const currentMonth = chartData[chartData.length - 1];
      const lastYearMonth = chartData.find(d => d.year === currentMonth.year - 1 && d.month === currentMonth.month);
      if (lastYearMonth && lastYearMonth.revenue > 0) {
        const growth = ((currentMonth.revenue - lastYearMonth.revenue) / lastYearMonth.revenue) * 100;
        growthText = `${growth > 0 ? 'рост' : 'падение'} выручки на ${Math.abs(growth).toFixed(1)}%`;
      }
    }

    const bloggerOrders = uniqueOrders.filter(o => o.isBlogger);
    const bloggerOrdersCount = bloggerOrders.length;
    const bloggerRevenue = bloggerOrders.reduce((acc, curr) => acc + curr.revenue, 0);

    const uniqueSizes = Array.from(new Set(data.map(o => String(o.rawRow?.[12] || '').trim()).filter(v => v !== ''))).sort();
    const uniqueDeliveries = Array.from(new Set(['СДЭК', 'Почта РФ', 'Боксберри', 'Самовывоз', 'Курьер', 'DBS', ...data.map(o => String(o.deliveryMethod || '').trim()).filter(v => v !== '')])).sort();
    const uniquePromotions = Array.from(new Set(data.map(o => String(o.rawRow?.[10] || '').trim()).filter(v => v !== ''))).sort();
    const productsInTable = Array.from(new Set(data.flatMap(o => (Array.isArray(o.items) && o.items.length ? o.items : String(o.item || '').split(/\s*,\s*|\n/)).map(item => String(item || '').trim()).filter(v => v !== '')))).sort();
    const uniqueColors = Array.from(new Set(data.map(o => String(o.rawRow?.[1] || '').trim()).filter(v => v !== ''))).sort();
    const uniqueSources = Array.from(new Set(['Instagram', 'WhatsApp', 'ТГ', 'Блогер', 'Контент', 'Сарафан', 'Повторный', ...data.map(o => String(o.source || '').trim()).filter(v => v !== '')])).sort();
    const uniqueCategories = Array.from(new Set(data.map(o => String(o.rawRow?.[2] || '').trim()).filter(v => v !== ''))).sort();

    return {
      totalOrders,
      uniqueClients,
      totalRevenue,
      topClients,
      topProducts,
      chartData,
      bestMonths,
      bloggersByMonth,
      bloggersList,
      ltvByYear,
      growthText,
      bloggerOrdersCount,
      bloggerRevenue,
      uniqueOrders: Array.from(ordersMap.values()),
      returnsCount: uniqueOrders.filter(isRefundOrCancelledOrder).length + manualReturnOperations.length,
      exchangesCount: uniqueOrders.filter(o => o.status?.toLowerCase().includes('обмен')).length,
      totalActualPayments: salesOrders.reduce((sum, o) => sum + getConfirmedPaidAmount(o), 0) - manualReturnAmount,
      totalDueExtraPayments: salesOrders.reduce((sum, o) => sum + getOutstandingPaymentAmount(o), 0),
      salesCount: salesOrders.length,
      currentMonthDailyRows,
      dailyRowsByMonth,
      uniqueSizes,
      uniqueDeliveries,
      uniquePromotions,
      productsInTable,
      uniqueColors,
      uniqueSources,
      uniqueCategories,
      slaStats: (() => {
        const activeOrders = uniqueOrders.filter(o => !isRefundOrCancelledOrder(o));
        return {
          totalOrders: activeOrders.length,
          shipped: activeOrders.filter(o => o.isShipped).length,
          inProgress: activeOrders.filter(o => !o.isShipped).length,
          onTime: activeOrders.filter(o => !o.isShipped && !isOverdueOrder(o)).length,
          overdue: activeOrders.filter(isOverdueOrder).length,
          onTimeRate: activeOrders.length > 0
            ? (activeOrders.filter(o => !isOverdueOrder(o)).length / activeOrders.length) * 100
            : 0
        };
      })()
    };
  }, [data]);

  const filteredOrders = useMemo(() => {
    if (!stats?.uniqueOrders) return [];
    const hasSearch = Boolean(searchTerm.trim());
    return stats.uniqueOrders
      .slice()
      .sort((a: OrderData, b: OrderData) => {
        const activityDifference = (b.activityAt?.getTime() || 0) - (a.activityAt?.getTime() || 0);
        if (activityDifference) return activityDifference;
        const pinDifference = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        return pinDifference || b.date.getTime() - a.date.getTime();
      })
      .filter((o: OrderData) => {
        const matchesMonth = hasSearch || ordersFilterMonth === -1 || o.month === ordersFilterMonth;
        const matchesStatus = hasSearch || !orderStatusFilter
          || (orderStatusFilter === PREPAYMENT_FILTER_VALUE
            ? isPrepaymentOrder(o)
            : orderStatusFilter === OVERDUE_FILTER_VALUE
              ? isOverdueOrder(o)
              : orderStatusFilter === REFUND_OR_CANCELLED_FILTER_VALUE
                ? isRefundOrCancelledOrder(o)
              : normalizeOrderStatus(o.status).toLowerCase() === normalizeOrderStatus(orderStatusFilter).toLowerCase());
        const matchesBlogger = hasSearch || !orderBloggerFilter || String(o.blogger || '').trim() === orderBloggerFilter;
        const matchesSearch = matchesOrderSearch(o, searchTerm);
        return matchesMonth && matchesStatus && matchesBlogger && matchesSearch;
      });
  }, [stats?.uniqueOrders, searchTerm, ordersFilterMonth, orderStatusFilter, orderBloggerFilter]);

  const pagedOrders = useMemo(() => {
    return filteredOrders;
  }, [filteredOrders]);

  const filteredSlaStats = useMemo(() => {
    if (!stats) return null;
    const periodOrders = slaFilterMonth === -1 ? stats.uniqueOrders : stats.uniqueOrders.filter((o: OrderData) => o.month === slaFilterMonth);
    const filtered = periodOrders.filter((o: OrderData) => !isRefundOrCancelledOrder(o));
    const totalOrders = filtered.length;
    const shipped = filtered.filter((o: OrderData) => o.isShipped).length;
    const inProgress = filtered.filter((o: OrderData) => !o.isShipped).length;
    const onTime = filtered.filter((o: OrderData) => !o.isShipped && !isOverdueOrder(o)).length;
    const overdue = filtered.filter(isOverdueOrder).length;
    const lostRevenue = filtered
      .filter(isOverdueOrder)
      .reduce((sum: number, o: OrderData) => sum + getOutstandingPaymentAmount(o), 0);
    return {
      totalOrders, shipped, inProgress, onTime, overdue,
      onTimeRate: totalOrders > 0 ? (filtered.filter((o: OrderData) => !isOverdueOrder(o)).length / totalOrders) * 100 : 0,
      lostRevenue
    };
  }, [stats, slaFilterMonth]);

  // ── Loading / error states ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] space-y-4">
        <RefreshCcw className="w-12 h-12 text-blue-500 animate-spin" />
        <p className="text-gray-500 font-medium">{loadingStep}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] space-y-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={onBack} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
          Вернуться назад
        </button>
      </div>
    );
  }

  if (!stats && !loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] space-y-4">
        <AlertCircle className="w-12 h-12 text-amber-500" />
        <p className="text-slate-600 font-medium">Данные не найдены или таблица пуста</p>
        <button onClick={onBack} className="px-4 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors text-sm">
          Вернуться назад
        </button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 px-4 py-4 font-sans text-zinc-900 sm:px-6">
      {sheetWarning && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-700">
          <span>{sheetWarning}</span>
          <button
            type="button"
            onClick={() => fetchData(true)}
            className="shrink-0 rounded-md bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-amber-700 hover:bg-amber-100"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors text-zinc-400"
          title="Обновить данные"
        >
          <RefreshCcw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
        </button>
        <button
          onClick={exportToCsv}
          className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors text-zinc-400"
          title="Скачать CSV"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <Suspense fallback={<TabFallback />}>
        {activeTab === 'analytics' && (
          <AnalyticsTab
            stats={stats}
            onGoToOrders={() => setActiveTab('orders')}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            data={data}
            stats={stats}
            filteredOrders={filteredOrders}
            pagedOrders={pagedOrders}
            displayCount={displayCount}
            setDisplayCount={setDisplayCount}
            ordersFilterMonth={ordersFilterMonth}
            setOrdersFilterMonth={setOrdersFilterMonth}
            orderStatusFilter={orderStatusFilter}
            setOrderStatusFilter={setOrderStatusFilter}
            orderBloggerFilter={orderBloggerFilter}
            setOrderBloggerFilter={setOrderBloggerFilter}
            slaFilterMonth={slaFilterMonth}
            setSlaFilterMonth={setSlaFilterMonth}
            filteredSlaStats={filteredSlaStats}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            updateOrderData={updateOrderData}
            deleteOrder={deleteOrder}
            newOrder={newOrder}
            setNewOrder={setNewOrder}
            handleCreateOrder={handleCreateOrder}
            handbookProducts={handbookProducts}
            handbookColors={handbookColors}
            handbookSizes={handbookSizes}
            handbookHeights={handbookHeights}
            handbookCompositions={handbookCompositions}
            handbookStatuses={handbookStatuses}
            handbookSources={handbookSources}
            handbookLabels={handbookLabels}
            handbookDeliveries={handbookDeliveries}
            handbookPaymentTypes={handbookPaymentTypes}
            handbookManagers={handbookManagers}
            handbookBloggers={handbookBloggers}
            exportToCsv={exportToCsv}
            refreshing={refreshing}
            lastUpdated={lastUpdated}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
            fetchData={fetchData}
          />
        )}

        {activeTab === 'clients' && (
          <ClientsTab
            stats={stats}
            data={data}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            onNavigate={onNavigate}
            handbookLabels={handbookLabels}
          />
        )}

        {activeTab === 'marketing' && (
          <MarketingTab
            stats={stats}
            data={data}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedMonth={selectedMonth}
          />
        )}
      </Suspense>
    </div>
  );
};
