import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import Papa from 'papaparse';
import {
  RefreshCcw, AlertCircle, Download,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, collection, deleteDoc, updateDoc, query } from 'firebase/firestore';
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
  isFirebase?: boolean;
  date: Date;
  revenue: number;
  deliveryPrice: number;
  paidAmount: number;
  clientPhone: string;
  clientName: string;
  clientInsta: string;
  clientCity: string;
  status: string;
  source: string;
  item: string;
  deliveryMethod: string;
  year: number;
  month: number;
  isBlogger: boolean;
  isRecommended: boolean;
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
  paymentStatus?: string;
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

const AnalyticsDashboardInner: React.FC<AnalyticsDashboardProps> = ({
  sheetId: initialSheetId,
  initialTab = 'analytics',
  onBack,
  onNavigate,
  selectedMonth,
  setSelectedMonth
}) => {
  const [sheetId, setSheetId] = useState(initialSheetId);
  const [activeTab, setActiveTab] = useState<'analytics' | 'clients' | 'marketing' | 'orders'>(initialTab ?? 'analytics');
  const [data, setData] = useState<OrderData[]>([]);
  const [sheetOrders, setSheetOrders] = useState<OrderData[]>([]);
  const [firebaseOrders, setFirebaseOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState<string>('Инициализация...');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [ordersFilterMonth, setOrdersFilterMonth] = useState<number>(-1);
  const [slaFilterMonth, setSlaFilterMonth] = useState<number>(-1);
  const [searchTerm, setSearchTerm] = useState("");
  const [displayCount, setDisplayCount] = useState(50);

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
  const [newOrder, setNewOrder] = useState<Partial<OrderData>>({
    date: new Date(),
    orderId: '',
    clientName: '',
    clientPhone: '',
    item: '',
    status: 'Новый',
    revenue: 0,
    paidAmount: 0,
    deliveryMethod: '',
    source: '',
    height: '',
    label: '',
    manager: '',
    blogger: '',
    rawRow: Array(30).fill('')
  });

  // Sync prop with state if it changes
  useEffect(() => {
    setSheetId(initialSheetId);
  }, [initialSheetId]);

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
        await updateDoc(doc(db, 'orders_new', orderId), {
          [field]: finalValue
        });
      } catch (err) {
        console.error("Firebase update failed", err);
      }
    } else {
      setSheetOrders(prevData => {
        return prevData.map(order => {
          if (order.orderId === orderId) {
            if (field in order || (typeof field === 'string' && !field.startsWith('rawRow['))) {
              if (field === 'isRecommended') return { ...order, isRecommended: !order.isRecommended };
              return { ...order, [field]: value };
            }
            if (typeof field === 'string' && field.startsWith('rawRow[')) {
              const index = parseInt(field.match(/\[(\d+)\]/)![1]);
              const newRawRow = [...(order.rawRow || [])];
              newRawRow[index] = value;
              return { ...order, rawRow: newRawRow };
            }
          }
          return order;
        });
      });
    }
  };

  const deleteOrder = async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders_new', orderId));
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const handleCreateOrder = async (): Promise<string | null> => {
    if (!newOrder.orderId || !newOrder.clientName) {
      alert('Укажите ID заказа и ФИО клиента');
      return null;
    }

    const orderToCreate: OrderData = {
      orderId: newOrder.orderId || '',
      date: newOrder.date || new Date(),
      revenue: newOrder.revenue || 0,
      deliveryPrice: newOrder.deliveryPrice || 0,
      paidAmount: newOrder.paidAmount || 0,
      clientPhone: newOrder.clientPhone || '',
      clientName: newOrder.clientName || '',
      clientInsta: '',
      clientCity: '',
      status: newOrder.status || 'Новый',
      source: newOrder.source || '',
      item: newOrder.item || '',
      deliveryMethod: newOrder.deliveryMethod || '',
      year: (newOrder.date || new Date()).getFullYear(),
      month: (newOrder.date || new Date()).getMonth(),
      isBlogger: false,
      isRecommended: false,
      deadlineDate: new Date(),
      isShipped: false,
      isLate: false,
      isOverdue: false,
      rawRow: newOrder.rawRow || Array(30).fill(''),
      height: newOrder.height || '',
      label: newOrder.label || '',
      manager: newOrder.manager || '',
      blogger: newOrder.blogger || '',
      isFirebase: true
    };

    try {
      await setDoc(doc(db, 'orders_new', orderToCreate.orderId), {
        ...orderToCreate,
        date: orderToCreate.date.toISOString(),
        deadlineDate: orderToCreate.deadlineDate.toISOString()
      });
      const createdId = orderToCreate.orderId;
      setNewOrder({
        date: new Date(),
        orderId: '',
        clientName: '',
        clientPhone: '',
        item: '',
        status: 'Новый',
        revenue: 0,
        paidAmount: 0,
        deliveryMethod: '',
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
      setLoadingStep('Загрузка из таблицы...');
    }

    try {
      const finalSheetId = sheetId && sheetId !== 'your_sheet_id_here' ? sheetId : '1xTDxiOMqJR-KBnLdbikKp2--ZBQBDkII-xMCoO2lSbM';
      const url = `https://docs.google.com/spreadsheets/d/${finalSheetId}/export?format=csv`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch spreadsheet');
      const csvText = await response.text();

      const parsed = Papa.parse(csvText, { header: false, skipEmptyLines: true });
      const rows = parsed.data as string[][];

      if (rows.length < 1) {
        setSheetOrders([]);
        return;
      }

      const headerRow = rows[0];
      const headerMap: Record<string, number> = {};
      for (let j = 0; j < headerRow.length; j++) {
        const v = String(headerRow[j]).trim().toLowerCase().replace(/\s+/g, ' ');
        headerMap[v] = j;
      }

      const getVal = (rowArr: string[], colNames: string[], defaultIdx: number) => {
        for (const c of colNames) {
          const idx = headerMap[c.toLowerCase()];
          if (idx !== undefined && rowArr[idx] !== undefined) return String(rowArr[idx]).replace(/\r/g, '').replace(/\n/g, ' ').trim();
        }
        return rowArr[defaultIdx] !== undefined ? String(rowArr[defaultIdx]).replace(/\r/g, '').replace(/\n/g, ' ').trim() : "";
      };

      const parsedOrders: OrderData[] = [];
      let lastOrderId = "";
      let lastDate = new Date();
      let lastStatus = "";
      let lastSource = "";

      for (let i = 1; i < rows.length; i++) {
        const rawRow = rows[i];
        if (!rawRow || rawRow.length < 5) continue;

        let rawOrderId = getVal(rawRow, ['номер заказа', '№ заказа'], 0);
        if (rawOrderId && !rawOrderId.toLowerCase().includes('номер') && !rawOrderId.toLowerCase().includes('column')) {
          lastOrderId = rawOrderId.replace('#', '').trim();

          let dateStr = getVal(rawRow, ['дата заявки', 'дата'], 4).trim().toLowerCase();
          if (dateStr === 'сегодня') lastDate = new Date();
          else if (dateStr === 'вчера') lastDate = new Date(Date.now() - 86400000);
          else {
            const parts = dateStr.replace(/,/g, '.').split('.');
            if (parts.length === 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              let year = parseInt(parts[2], 10);
              if (year < 100) year += 2000;
              if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                lastDate = new Date(year, month, day);
              }
            }
          }
          lastStatus = getVal(rawRow, ['статус заказа', 'статус'], 6);
          lastSource = getVal(rawRow, ['откуда продажа (как узнали)', 'какая продажа', 'источник'], 17);
        }

        if (!lastOrderId) continue;

        let clientName = getVal(rawRow, ['фио заказчика', 'фио', 'покупатель', 'клиент'], 18);
        let phone = getVal(rawRow, ['телефон заказчика', 'телефон'], 19).replace(/[^0-9]/g, '');
        if (phone.length === 10) phone = '7' + phone;
        else if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.substring(1);
        else if (phone.length > 11 && phone.startsWith('77')) phone = phone.substring(1);

        let insta = getVal(rawRow, ['соц.сети', 'инстаграм', 'ник', 'соцсети'], 21);
        if (insta.toLowerCase() === "undefined" || insta === "—" || insta === "-") insta = "";
        if (insta.includes('instagram.com/')) {
          const parts = insta.split('instagram.com/');
          if (parts.length > 1) insta = parts[1].split('/')[0].split('?')[0];
        }
        insta = insta.replace('@', '');

        const address = getVal(rawRow, ['адрес доставки', 'адрес'], 22) || "";
        let city = address.includes(',') ? address.split(',')[0].trim() : address.trim();
        if (city.toLowerCase().startsWith('г.')) city = city.substring(2).trim();
        else if (city.toLowerCase().includes('г.')) {
          const splitRes = city.split('г.');
          if (splitRes.length > 1 && splitRes[1]) {
            city = splitRes[1].trim();
          }
        }

        const item = getVal(rawRow, ['заказ наименование', 'наименование', 'товар'], 7);
        const deliveryMethod = getVal(rawRow, ['метод доставки', 'тк', 'доставка'], 23);

        let cleanRevenue = getVal(rawRow, ['сумма заказа', 'сумма'], 14).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const revenue = Math.abs(parseFloat(cleanRevenue) || 0);

        let cleanDelivery = getVal(rawRow, ['цена доставки'], 15).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const deliveryPrice = Math.abs(parseFloat(cleanDelivery) || 0);

        let cleanPayment = getVal(rawRow, ['фактические поступления', 'оплата'], 16).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const paidAmount = Math.abs(parseFloat(cleanPayment) || 0);

        let deadlineDate = new Date(lastDate);
        deadlineDate.setDate(deadlineDate.getDate() + 14);

        const isShipped = lastStatus.toLowerCase() === 'отправлен' || lastStatus.toLowerCase() === 'готов';
        const isOverdue = !isShipped && new Date() > deadlineDate;
        const isBlogger = lastSource.toLowerCase().includes('блогер') || lastSource.toLowerCase().includes('перезаказ');

        while (rawRow.length < 30) rawRow.push("");

        parsedOrders.push({
          orderId: lastOrderId,
          date: lastDate,
          revenue,
          deliveryPrice,
          paidAmount,
          clientName,
          clientPhone: phone,
          clientInsta: insta,
          clientCity: city,
          status: lastStatus,
          source: lastSource,
          item,
          deliveryMethod,
          year: lastDate.getFullYear(),
          month: lastDate.getMonth(),
          isBlogger,
          isOverdue,
          isLate: isOverdue,
          isShipped,
          isRecommended: false,
          deadlineDate: deadlineDate,
          rawRow: rawRow
        });
      }

      parsedOrders.sort((a, b) => b.date.getTime() - a.date.getTime());
      setSheetOrders(parsedOrders);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError("Ошибка обработки данных: " + err.message);
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
  }, [sheetId]);

  useEffect(() => {
    const q = query(collection(db, 'orders_new'));
    const unsub = onSnapshot(q, (snapshot) => {
      const fbOrders: OrderData[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        fbOrders.push({
          ...d,
          isFirebase: true,
          date: d.date ? new Date(d.date) : new Date(),
          deadlineDate: d.deadlineDate ? new Date(d.deadlineDate) : new Date()
        } as OrderData);
      });
      setFirebaseOrders(fbOrders);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const combined = [...firebaseOrders, ...sheetOrders].sort((a, b) => b.date.getTime() - a.date.getTime());
    setData(combined);
  }, [firebaseOrders, sheetOrders]);

  useEffect(() => {
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(() => fetchData(true), 60000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, sheetId]);

  const exportToCsv = () => {
    if (data.length === 0) return;

    const columnLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];

    const csvData = data.map(o => {
      const row: any = {};
      columnLabels.forEach((label, idx) => {
        row[`Колонка ${label}`] = o.rawRow?.[idx] || '';
      });
      return row;
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `analytics_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = useMemo(() => {
    if (data.length === 0) return null;

    const ordersMap = new Map<string, OrderData>();
    data.forEach(row => {
      const existing = ordersMap.get(row.orderId);
      if (existing) {
        existing.revenue += row.revenue;
        existing.deliveryPrice += row.deliveryPrice;
        existing.paidAmount += row.paidAmount;
        if (!existing.clientName && row.clientName) existing.clientName = row.clientName;
        if (!existing.clientPhone && row.clientPhone) existing.clientPhone = row.clientPhone;
        if (!existing.clientInsta && row.clientInsta) existing.clientInsta = row.clientInsta;
        if (!existing.status && row.status) existing.status = row.status;
        if (!existing.source && row.source) existing.source = row.source;
      } else {
        ordersMap.set(row.orderId, { ...row });
      }
    });

    const uniqueOrders = Array.from(ordersMap.values());
    const totalOrders = uniqueOrders.length;

    const clientMap = new Map<string, { name: string, phone: string, insta: string, city: string, total: number, count: number }>();
    uniqueOrders.forEach(o => {
      const clientKey = o.clientPhone || o.clientName || "Unknown";
      if (clientKey === "Unknown") return;
      const current = clientMap.get(clientKey) || { name: o.clientName, phone: o.clientPhone, insta: o.clientInsta, city: o.clientCity, total: 0, count: 0 };
      clientMap.set(clientKey, {
        name: o.clientName || current.name,
        phone: o.clientPhone || current.phone,
        insta: o.clientInsta || current.insta,
        city: o.clientCity || current.city,
        total: current.total + o.revenue,
        count: current.count + 1
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
    const totalRevenue = uniqueOrders.reduce((acc, curr) => acc + curr.revenue, 0);

    const productMap = new Map<string, { name: string, total: number, count: number }>();
    data.forEach(row => {
      if (!row.item || row.item.length < 3) return;
      const name = row.item.split('\n')[0].split('(')[0].trim();
      if (name.length < 3) return;
      const current = productMap.get(name) || { name, total: 0, count: 0 };
      productMap.set(name, { name, total: current.total + row.revenue, count: current.count + 1 });
    });

    const topProducts = Array.from(productMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

    const salesByPeriod: any = {};
    uniqueOrders.forEach(o => {
      const key = `${o.year}-${o.month + 1}`;
      if (!salesByPeriod[key]) salesByPeriod[key] = {
        revenue: 0, count: 0, returns: 0, bloggers: new Set(),
        paidAmount: 0, salesCount: 0, dueExtra: 0, delivery: 0
      };
      salesByPeriod[key].revenue += o.revenue;
      salesByPeriod[key].count += 1;
      salesByPeriod[key].paidAmount += o.paidAmount;
      salesByPeriod[key].delivery += o.deliveryPrice;
      const isReturn = o.status?.toLowerCase().includes('возврат');
      const isCancelled = o.status?.toLowerCase().includes('отмена');
      if (isReturn) salesByPeriod[key].returns += 1;
      if (!isReturn && !isCancelled) salesByPeriod[key].salesCount += 1;
      salesByPeriod[key].dueExtra += Math.max(0, (o.revenue + o.deliveryPrice) - o.paidAmount);
      if (o.source?.toLowerCase().includes('блогер')) salesByPeriod[key].bloggers.add(o.source);
    });

    const chartData = Object.entries(salesByPeriod).map(([key, val]: any) => {
      const [year, month] = key.split('-');
      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const monthIndex = parseInt(month, 10) - 1;
      const monthName = monthNames[monthIndex] || '???';
      return {
        period: `${monthName} ${year}`,
        shortPeriod: `${monthName.substring(0, 3)} ${year.substring(2)}`,
        monthName,
        revenue: val.revenue,
        orders: val.count,
        sales: val.salesCount,
        paid: val.paidAmount,
        dueExtra: val.dueExtra,
        returns: val.returns,
        bloggers: val.bloggers.size,
        year: parseInt(year, 10),
        month: parseInt(month, 10)
      };
    }).sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

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
    const productsInTable = Array.from(new Set(data.map(o => String(o.item || '').trim()).filter(v => v !== ''))).sort();
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
      returnsCount: uniqueOrders.filter(o => o.status?.toLowerCase().includes('возврат')).length,
      exchangesCount: uniqueOrders.filter(o => o.status?.toLowerCase().includes('обмен')).length,
      totalActualPayments: uniqueOrders.reduce((sum, o) => sum + o.paidAmount, 0),
      totalDueExtraPayments: uniqueOrders.reduce((sum, o) => sum + Math.max(0, (o.revenue + o.deliveryPrice) - o.paidAmount), 0),
      salesCount: uniqueOrders.filter(o => !o.status?.toLowerCase().includes('возврат') && !o.status?.toLowerCase().includes('отмена')).length,
      uniqueSizes,
      uniqueDeliveries,
      uniquePromotions,
      productsInTable,
      uniqueColors,
      uniqueSources,
      uniqueCategories,
      slaStats: {
        totalOrders: uniqueOrders.length,
        shipped: uniqueOrders.filter(o => o.isShipped).length,
        inProgress: uniqueOrders.filter(o => !o.isShipped).length,
        onTime: uniqueOrders.filter(o => !o.isShipped && !o.isOverdue).length,
        overdue: uniqueOrders.filter(o => o.isOverdue).length,
        onTimeRate: uniqueOrders.length > 0 ? (uniqueOrders.filter(o => !o.isOverdue).length / uniqueOrders.length) * 100 : 0
      }
    };
  }, [data]);

  const filteredOrders = useMemo(() => {
    if (!stats?.uniqueOrders) return [];
    return stats.uniqueOrders
      .sort((a: OrderData, b: OrderData) => b.date.getTime() - a.date.getTime())
      .filter((o: OrderData) => {
        const matchesMonth = ordersFilterMonth === -1 || o.month === ordersFilterMonth;
        const search = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm ||
          o.orderId.toLowerCase().includes(search) ||
          o.clientName.toLowerCase().includes(search) ||
          (o.clientPhone && o.clientPhone.includes(search));
        return matchesMonth && matchesSearch;
      });
  }, [stats?.uniqueOrders, searchTerm, ordersFilterMonth]);

  const pagedOrders = useMemo(() => {
    return filteredOrders.slice(0, displayCount);
  }, [filteredOrders, displayCount]);

  const filteredSlaStats = useMemo(() => {
    if (!stats) return null;
    const filtered = slaFilterMonth === -1 ? stats.uniqueOrders : stats.uniqueOrders.filter((o: OrderData) => o.month === slaFilterMonth);
    const totalOrders = filtered.length;
    const shipped = filtered.filter((o: OrderData) => o.isShipped).length;
    const inProgress = filtered.filter((o: OrderData) => !o.isShipped).length;
    const onTime = filtered.filter((o: OrderData) => !o.isShipped && !o.isOverdue).length;
    const overdue = filtered.filter((o: OrderData) => o.isOverdue).length;
    const lostRevenue = filtered
      .filter((o: OrderData) => o.isOverdue && !o.isShipped)
      .reduce((sum: number, o: OrderData) => sum + Math.max(0, (o.revenue + o.deliveryPrice) - o.paidAmount), 0);
    return {
      totalOrders, shipped, inProgress, onTime, overdue,
      onTimeRate: totalOrders > 0 ? (filtered.filter((o: OrderData) => !o.isOverdue).length / totalOrders) * 100 : 0,
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
    <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 font-sans text-zinc-900">
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
            handbookSources={handbookSources}
            handbookLabels={handbookLabels}
            handbookDeliveries={handbookDeliveries}
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
