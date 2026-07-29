import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Users, Search, Plus, X, RefreshCcw, Award,
  DollarSign, MapPin, Phone, Instagram, ExternalLink,
  Hash, TrendingUp, Upload, CheckCircle, MessageCircle,
  Clock, ChevronDown, Send, Tag, AlertCircle, Mail
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from '../../firebase';
import { doc, updateDoc, onSnapshot, setDoc, writeBatch, collection, getDocs, orderBy, query, addDoc, where, serverTimestamp, limit } from 'firebase/firestore';
import { OrderData } from '../AnalyticsDashboard';

interface ClientsTabProps {
  stats: any;
  data: OrderData[];
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  onNavigate: (view: any, clientData?: any) => void;
  handbookLabels?: string[];
}

type BroadcastEntry = { sentAt: string; status: 'sent' | 'error' | 'no_tg'; message: string; broadcastId: string };
type ContactStatus = 'в работе' | 'написали' | 'ответил' | 'не ответил' | 'отказ' | 'перезвонить';
type ClientView = 'queue' | 'in_work' | 'contacted' | 'answered' | 'snoozed' | 'all';
type ContactAgeFilter = 'all' | '0-5' | '6-15' | '16-30' | '31-60' | '61-90' | '91-120' | '120+';

const CONTACT_AGE_FILTERS: Array<{ key: ContactAgeFilter; label: string; min: number; max?: number }> = [
  { key: 'all', label: 'Все даты', min: 0 },
  { key: '0-5', label: '0–5 дней', min: 0, max: 5 },
  { key: '6-15', label: '6–15 дней', min: 6, max: 15 },
  { key: '16-30', label: '16–30 дней', min: 16, max: 30 },
  { key: '31-60', label: '31–60 дней', min: 31, max: 60 },
  { key: '61-90', label: '61–90 дней', min: 61, max: 90 },
  { key: '91-120', label: '91–120 дней', min: 91, max: 120 },
  { key: '120+', label: 'Старше 120', min: 121 },
];

function normalizePhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

export const ClientsTab: React.FC<ClientsTabProps> = ({
  stats,
  data,
  searchTerm,
  setSearchTerm,
  onNavigate,
  handbookLabels = [],
}) => {
  const [selectedLoyaltyClient, setSelectedLoyaltyClient] = useState<any | null>(null);
  const [loyaltyDetails, setLoyaltyDetails] = useState<any | null>(null);
  const [localLoyaltyDetails, setLocalLoyaltyDetails] = useState<any | null>(null);
  const [isLoyaltyLoading, setIsLoyaltyLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [fbClients, setFbClients] = useState<any[]>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [clientPage, setClientPage] = useState(100);
  const PAGE_SIZE = 100;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [clientView, setClientView] = useState<ClientView>('queue');
  const [quickSavingPhone, setQuickSavingPhone] = useState<string | null>(null);
  const [quickSavedPhone, setQuickSavedPhone] = useState<string | null>(null);

  // Communication tracking
  const [contactHistory, setContactHistory] = useState<any[]>([]);
  const [contactHistoryLoading, setContactHistoryLoading] = useState(false);
  const [newContactNote, setNewContactNote] = useState('');
  const [newContactStatus, setNewContactStatus] = useState<ContactStatus>('написали');
  const [newContactTag, setNewContactTag] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [activePanel, setActivePanel] = useState<'info' | 'contacts'>('info');

  // Contact filter
  const [contactFilter, setContactFilter] = useState<ContactAgeFilter>('all');

  // Add client
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [addClientForm, setAddClientForm] = useState({ fullName: '', phone: '', insta: '', email: '', city: '' });
  const [addClientSaving, setAddClientSaving] = useState(false);

  // Inline quick contact form
  const [inlineExpandedPhone, setInlineExpandedPhone] = useState<string | null>(null);
  const [inlineNote, setInlineNote] = useState('');
  const [inlineStatus, setInlineStatus] = useState<ContactStatus>('написали');
  const [inlineTag, setInlineTag] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineEmailPhone, setInlineEmailPhone] = useState<string | null>(null);
  const [inlineEmailValue, setInlineEmailValue] = useState('');
  const [inlineEmailSaving, setInlineEmailSaving] = useState(false);
  const [broadcastMap, setBroadcastMap] = useState<Map<string, BroadcastEntry[]>>(new Map());

  const handleInlineSave = async (client: any) => {
    if (!inlineNote.trim()) return;
    const phone = client.phone || client.userId;
    if (!phone) return;
    const manager = auth.currentUser;
    setInlineSaving(true);
    try {
      const entry = {
        clientPhone: phone,
        clientName: client.fullName || client.name,
        managerId: manager?.uid || 'unknown',
        managerName: manager?.displayName || manager?.email || 'Менеджер',
        managerPhoto: manager?.photoURL || null,
        date: new Date().toISOString(),
        status: inlineStatus,
        tag: inlineTag.trim() || null,
        note: inlineNote.trim(),
      };
      await addDoc(collection(db, 'manager_contacts'), entry);
      await updateDoc(doc(db, 'contacts', phone), {
        lastContactAt: entry.date,
        lastContactStatus: inlineStatus,
        lastContactManager: entry.managerName,
        lastContactTag: inlineTag.trim() || null,
        lastContactNote: inlineNote.trim(),
      }).catch(() => {});
      // Update local fbClients state
      setFbClients(prev => prev.map(c =>
        (c.phone || c.userId) === phone
          ? { ...c, lastContactAt: entry.date, lastContactStatus: inlineStatus, lastContactManager: entry.managerName, lastContactTag: inlineTag.trim() || null, lastContactNote: inlineNote.trim() }
          : c
      ));
      setInlineNote('');
      setInlineTag('');
      setInlineStatus('написали');
      setInlineExpandedPhone(null);
    } finally {
      setInlineSaving(false);
    }
  };

  const handleEmailSave = async (client: any) => {
    const email = inlineEmailValue.trim();
    if (!email) return;
    const phone = client.phone || client.userId;
    setInlineEmailSaving(true);
    try {
      await updateDoc(doc(db, 'contacts', phone), { email });
      setFbClients(prev => prev.map(c =>
        (c.phone || c.userId) === phone ? { ...c, email } : c
      ));
      setInlineEmailPhone(null);
      setInlineEmailValue('');
    } catch (e) {
      console.error(e);
    } finally {
      setInlineEmailSaving(false);
    }
  };

  const handleAddClient = async () => {
    if (!addClientForm.fullName.trim() || !addClientForm.phone.trim()) return;
    setAddClientSaving(true);
    try {
      let phone = addClientForm.phone.replace(/[^0-9]/g, '');
      if (phone.length === 10) phone = '7' + phone;
      else if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.slice(1);
      const newClient = {
        fullName: addClientForm.fullName.trim(),
        phone,
        userId: phone,
        insta: addClientForm.insta.replace('@', '').trim(),
        email: addClientForm.email.trim(),
        city: addClientForm.city.trim(),
        totalSpent: 0,
        ordersCount: 0,
        createdAt: new Date().toISOString(),
        loyaltyCardId: `NDT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        currentDiscount: 5,
      };
      await setDoc(doc(db, 'contacts', phone), newClient, { merge: true });
      setFbClients(prev => [newClient, ...prev]);
      setIsAddClientOpen(false);
      setAddClientForm({ fullName: '', phone: '', insta: '', email: '', city: '' });
    } catch (e) {
      alert('Ошибка при добавлении клиента');
    } finally {
      setAddClientSaving(false);
    }
  };

  const CLIENT_DB_SHEET_ID = '12saPOd88Lcc3VVIUP4hBdsuKX8p-nE6GKE02VcY6n2w';

  useEffect(() => {
    const q = query(collection(db, 'broadcasts'), orderBy('sentAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const map = new Map<string, BroadcastEntry[]>();
      snap.docs.forEach(d => {
        const b = d.data() as any;
        if (!b.log?.length) return;
        b.log.forEach((entry: any) => {
          const phone = normalizePhone(entry.phone || '');
          if (!phone) return;
          const list = map.get(phone) || [];
          list.push({
            sentAt: b.sentAt || '',
            status: entry.status || 'sent',
            message: (b.message || b.messageVariants?.[0] || '').slice(0, 60),
            broadcastId: d.id,
          });
          map.set(phone, list);
        });
      });
      setBroadcastMap(map);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setFbLoading(true);
    const q = query(collection(db, 'contacts'), orderBy('totalSpent', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setFbClients(snap.docs.map(d => ({ ...d.data(), firestoreId: d.id })));
      setFbLoading(false);
    }, () => setFbLoading(false));
    return () => unsubscribe();
  }, [importDone]);

  const saveQuickContact = async (client: any, status: ContactStatus, note: string) => {
    const phone = client.phone || client.userId || client.firestoreId;
    if (!phone) return;
    const manager = auth.currentUser;
    const entry = {
      clientPhone: phone,
      clientName: client.fullName || client.name || 'Клиент',
      managerId: manager?.uid || 'unknown',
      managerName: manager?.displayName || manager?.email || 'Менеджер',
      managerPhoto: manager?.photoURL || null,
      date: new Date().toISOString(),
      status,
      tag: client.lastContactTag || null,
      note,
    };

    const contactRef = doc(db, 'contacts', String(client.firestoreId || phone));
    const historyRef = doc(collection(db, 'manager_contacts'));
    const batch = writeBatch(db);
    batch.set(historyRef, entry);
    batch.set(contactRef, {
      lastContactAt: entry.date,
      lastContactStatus: status,
      lastContactManager: entry.managerName,
      lastContactNote: note,
    }, { merge: true });
    await batch.commit();
  };

  const openInstagram = (client: any) => {
    const username = String(client.insta || '').replace(/^@/, '').trim();
    if (!username) return;
    window.open(`https://instagram.com/${encodeURIComponent(username)}`, '_blank', 'noopener,noreferrer');
    if (!client.lastContactAt) {
      void saveQuickContact(client, 'в работе', 'Менеджер открыл Instagram клиента').catch(console.error);
    }
  };

  const markAsContacted = async (client: any) => {
    const phone = String(client.phone || client.userId || client.firestoreId || '');
    if (!phone || quickSavingPhone) return;
    setQuickSavingPhone(phone);
    try {
      await saveQuickContact(client, 'написали', 'Сообщение отправлено клиенту');
      setQuickSavedPhone(phone);
      window.setTimeout(() => setQuickSavedPhone(current => current === phone ? null : current), 1800);
    } catch (error: any) {
      console.error(error);
      const denied = String(error?.code || error?.message || '').includes('permission-denied');
      alert(denied
        ? 'Firebase отклонил запись истории касаний. Права доступа обновляются — повторите через минуту.'
        : `Не удалось сохранить касание${error?.code ? ` (${error.code})` : ''}. Повторите ещё раз.`);
    } finally {
      setQuickSavingPhone(null);
    }
  };

  const handleImportAll = async () => {
    if (!window.confirm('Загрузить клиентов из новой таблицы и импортировать в Firebase?')) return;
    setIsImporting(true);
    setImportDone(false);
    try {
      // Fetch client database sheet
      const url = `/api/sheet/export?sheetId=${encodeURIComponent(CLIENT_DB_SHEET_ID)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Не удалось загрузить таблицу клиентов');
      const csv = await res.text();

      // Parse CSV: ID,ФИО,Телефон,Email,Instagram,Адрес,Номера заказов,Кол-во,Сумма (руб)
      const lines = csv.split('\n').slice(1); // skip header
      const clients: any[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        // Handle quoted fields
        const cols: string[] = [];
        let cur = '';
        let inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; continue; }
          if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        cols.push(cur.trim());

        const rawPhone = (cols[2] || '').replace(/[^0-9]/g, '');
        let phone = rawPhone;
        if (phone.length === 10) phone = '7' + phone;
        else if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.slice(1);

        // Extract @handle from instagram field (take part before first semicolon)
        const rawInsta = (cols[4] || '').split(';')[0].trim().replace('@', '');

        const rawSum = (cols[8] || '').replace(/\s/g, '').replace(',', '.');
        const totalSpent = parseFloat(rawSum) || 0;
        const ordersCount = parseInt(cols[7]) || 0;

        const city = (cols[5] || '').split(',')[0].trim();

        clients.push({
          userId: phone || cols[1],
          fullName: cols[1] || '',
          phone,
          email: cols[3] || '',
          insta: rawInsta,
          city,
          address: cols[5] || '',
          orderNumbers: cols[6] || '',
          totalSpent,
          ordersCount,
          loyaltyCardId: `OCT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          currentDiscount: 5,
          lastMessageAt: new Date().toISOString(),
          status: 'active',
        });
      }

      // Write to Firebase in batches of 400
      const batchSize = 400;
      for (let i = 0; i < clients.length; i += batchSize) {
        const batch = writeBatch(db);
        clients.slice(i, i + batchSize).forEach((client) => {
          if (!client.userId) return;
          batch.set(doc(db, 'contacts', client.userId), client, { merge: true });
        });
        await batch.commit();
      }

      setImportDone(true);
      alert(`Успешно импортировано ${clients.length} клиентов!`);
    } catch (err: any) {
      alert('Ошибка импорта: ' + err.message);
    } finally {
      setIsImporting(false);
    }
  };

  // Load contact history when client changes
  useEffect(() => {
    if (!selectedLoyaltyClient) {
      setContactHistory([]);
      setActivePanel('info');
      return;
    }
    const phone = selectedLoyaltyClient.phone || selectedLoyaltyClient.name;
    if (!phone) return;
    setContactHistoryLoading(true);
    const unsubscribe = onSnapshot(query(
      collection(db, 'manager_contacts'),
      where('clientPhone', '==', phone)
    ), (snap) => {
      setContactHistory(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      );
      setContactHistoryLoading(false);
    }, () => setContactHistoryLoading(false));
    return () => unsubscribe();
  }, [selectedLoyaltyClient]);

  const handleAddContact = async () => {
    if (!newContactNote.trim()) return;
    const phone = selectedLoyaltyClient.phone || selectedLoyaltyClient.name;
    const manager = auth.currentUser;
    setIsSendingContact(true);
    try {
      const entry = {
        clientPhone: phone,
        clientName: selectedLoyaltyClient.name || selectedLoyaltyClient.fullName,
        managerId: manager?.uid || 'unknown',
        managerName: manager?.displayName || manager?.email || 'Менеджер',
        managerPhoto: manager?.photoURL || null,
        date: new Date().toISOString(),
        status: newContactStatus,
        tag: newContactTag.trim() || null,
        note: newContactNote.trim(),
      };
      const ref = await addDoc(collection(db, 'manager_contacts'), entry);
      setContactHistory(prev => [{ id: ref.id, ...entry }, ...prev]);
      // Update lastContactAt on client doc
      const userId = phone;
      await updateDoc(doc(db, 'contacts', userId), {
        lastContactAt: entry.date,
        lastContactStatus: newContactStatus,
        lastContactManager: entry.managerName,
        lastContactTag: newContactTag.trim() || null,
        lastContactNote: newContactNote.trim(),
      }).catch(() => {});
      setNewContactNote('');
      setNewContactTag('');
      setNewContactStatus('написали');
      setShowContactForm(false);
    } finally {
      setIsSendingContact(false);
    }
  };

  const clientOrders = useMemo(() => {
    if (!selectedLoyaltyClient) return [];
    const phone = selectedLoyaltyClient.phone;
    return data.filter(o => o.clientPhone === phone).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [selectedLoyaltyClient, data]);

  useEffect(() => {
    if (!selectedLoyaltyClient) {
      setLoyaltyDetails(null);
      return;
    }

    setIsLoyaltyLoading(true);
    const userId = selectedLoyaltyClient.phone || selectedLoyaltyClient.name;
    const docRef = doc(db, 'contacts', userId);

    const unsubscribe = onSnapshot(docRef, async (snap) => {
      if (snap.exists()) {
        const snapData = snap.data();
        setLoyaltyDetails(snapData);
        setLocalLoyaltyDetails(snapData);
        setIsLoyaltyLoading(false);
      } else {
        const newLoyalty = {
          userId: userId,
          fullName: selectedLoyaltyClient.name,
          loyaltyCardId: `OCT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          currentDiscount: 5,
          totalSpent: selectedLoyaltyClient.total,
          ordersCount: selectedLoyaltyClient.count,
          lastMessageAt: new Date().toISOString(),
          status: 'chatting'
        };
        await setDoc(docRef, newLoyalty);
        setLoyaltyDetails(newLoyalty);
        setLocalLoyaltyDetails(newLoyalty);
        setIsLoyaltyLoading(false);
      }
    });

    return () => unsubscribe();
  }, [selectedLoyaltyClient]);

  const getClientBroadcasts = (client: any): BroadcastEntry[] => {
    const phone = normalizePhone(client.phone || client.userId || '');
    return (broadcastMap.get(phone) || []).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  };

  const baseClients = useMemo(() => {
    const source = fbClients.length > 0
      ? fbClients
      : (stats.topClients || []).map((c: any) => ({
          fullName: c.name,
          phone: c.phone,
          insta: c.insta,
          city: c.city,
          totalSpent: c.total,
          ordersCount: c.count,
        }));
    return source;
  }, [fbClients, stats.topClients]);

  const getContactDays = (client: any) => {
    if (!client.lastContactAt) return null;
    const time = new Date(client.lastContactAt).getTime();
    if (Number.isNaN(time)) return null;
    return Math.max(0, Math.floor((Date.now() - time) / 86400000));
  };

  const matchesContactAge = (client: any, filter: ContactAgeFilter) => {
    if (filter === 'all') return true;
    const days = getContactDays(client);
    if (days === null) return false;
    const range = CONTACT_AGE_FILTERS.find(item => item.key === filter);
    return Boolean(range && days >= range.min && (range.max === undefined || days <= range.max));
  };

  const formatContactDate = (value?: string) => {
    if (!value) return 'даты нет';
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return 'даты нет';
    return new Date(value).toLocaleDateString('ru-RU');
  };

  const getContactSummary = (client: any) => {
    const days = getContactDays(client);
    const broadcasts = getClientBroadcasts(client);
    return {
      days,
      date: formatContactDate(client.lastContactAt),
      status: client.lastContactStatus || 'не было касания',
      manager: client.lastContactManager || 'менеджер не указан',
      tag: client.lastContactTag || client.tag || '',
      note: client.lastContactNote || '',
      broadcast: broadcasts[0],
    };
  };

  const filteredClients = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return baseClients.filter((client: any) => {
      const matchesSearch = !q ||
        (client.fullName || client.name || '').toLowerCase().includes(q) ||
        String(client.phone || '').includes(q) ||
        (client.insta || '').toLowerCase().includes(q) ||
        (client.email || '').toLowerCase().includes(q) ||
        (client.city || '').toLowerCase().includes(q);

      if (!matchesSearch) return false;
      const status = String(client.lastContactStatus || '').toLowerCase();
      if (clientView === 'queue' && client.lastContactAt) return false;
      if (clientView === 'in_work' && status !== 'в работе') return false;
      if (clientView === 'contacted' && (!client.lastContactAt || status === 'в работе')) return false;
      if (clientView === 'answered' && status !== 'ответил') return false;
      if (clientView === 'snoozed' && status !== 'перезвонить') return false;
      return matchesContactAge(client, contactFilter);
    });
  }, [baseClients, clientView, contactFilter, searchTerm]);

  const visibleClients = filteredClients.slice(0, clientPage);

  useEffect(() => {
    setClientPage(PAGE_SIZE);
  }, [clientView, contactFilter, searchTerm]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || clientPage >= filteredClients.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setClientPage(page => Math.min(page + PAGE_SIZE, filteredClients.length));
      }
    }, { rootMargin: '400px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [clientPage, filteredClients.length]);

  const clientStats = useMemo(() => {
    const contacted = baseClients.filter((client: any) => client.lastContactAt).length;
    const revenue = baseClients.reduce((sum: number, client: any) => sum + Number(client.totalSpent ?? client.total ?? 0), 0);
    const orders = baseClients.reduce((sum: number, client: any) => sum + Number(client.ordersCount ?? client.count ?? 0), 0);
    const needsContact = baseClients.filter((client: any) => {
      const days = getContactDays(client);
      return !client.lastContactAt || (days !== null && days >= 30);
    }).length;

    return {
      total: baseClients.length || stats.uniqueClients || 0,
      contacted,
      revenue,
      orders,
      needsContact,
    };
  }, [baseClients, stats.uniqueClients]);

  const clientViews: Array<{ key: ClientView; label: string; count: number }> = [
    { key: 'queue', label: 'Очередь', count: baseClients.filter((c: any) => !c.lastContactAt).length },
    { key: 'in_work', label: 'В работе', count: baseClients.filter((c: any) => c.lastContactStatus === 'в работе').length },
    { key: 'contacted', label: 'Уже писали', count: baseClients.filter((c: any) => c.lastContactAt && c.lastContactStatus !== 'в работе').length },
    { key: 'answered', label: 'Ответили', count: baseClients.filter((c: any) => c.lastContactStatus === 'ответил').length },
    { key: 'snoozed', label: 'Отложены', count: baseClients.filter((c: any) => c.lastContactStatus === 'перезвонить').length },
    { key: 'all', label: 'Все', count: baseClients.length },
  ];

  return (
    <>
      <section className="space-y-4">
        <div className="rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
          <div className="flex flex-col gap-4 border-b border-[#E6E9EF] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#1F2937] text-white shadow-[0_10px_24px_rgba(31,41,55,0.18)]">
                <Users size={19} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9CA3AF]">Клиенты</p>
                <h2 className="text-[24px] font-medium leading-tight text-[#1F2937]">Клиентская база</h2>
                <p className="mt-1 text-[13px] text-[#6B7280]">Контакты, касания, рассылки и история заказов</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 sm:w-[280px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  type="text"
                  placeholder="Поиск по имени, телефону, Instagram..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-11 w-full rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] pl-9 pr-3 text-[14px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6] focus:bg-white focus:ring-2 focus:ring-[#7D7DE6]/15"
                />
              </div>
              <button
                onClick={() => setIsAddClientOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#7D7DE6] px-4 text-[13px] font-semibold text-white shadow-[0_10px_22px_rgba(125,125,230,0.22)] transition hover:bg-[#6969d7]"
              >
                <Plus size={16} /> Новый клиент
              </button>
              <button
                onClick={handleImportAll}
                disabled={isImporting}
                className={cn(
                  "inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border px-4 text-[13px] font-semibold transition",
                  importDone
                    ? "border-[#2EBA7F]/25 bg-[#2EBA7F]/10 text-[#0A9B62]"
                    : "border-[#E6E9EF] bg-white text-[#6B7280] hover:text-[#1F2937]"
                )}
              >
                {isImporting ? (
                  <><RefreshCcw size={15} className="animate-spin" /> Импорт...</>
                ) : importDone ? (
                  <><CheckCircle size={15} /> Импортировано</>
                ) : (
                  <><Upload size={15} /> Импорт</>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-[#E6E9EF] md:grid-cols-4 md:divide-y-0">
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Всего клиентов</p>
              <p className="mt-2 text-[28px] font-semibold text-[#1F2937]">{clientStats.total}</p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Заказов</p>
              <p className="mt-2 text-[28px] font-semibold text-[#1F2937]">{clientStats.orders}</p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Выручка</p>
              <p className="mt-2 text-[24px] font-semibold text-[#2EBA7F]">{formatCurrency(clientStats.revenue)}</p>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Нужен контакт</p>
              <p className="mt-2 text-[28px] font-semibold text-[#F5A623]">{clientStats.needsContact}</p>
            </div>
          </div>

          <div className="border-t border-[#E6E9EF] p-3">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {clientViews.map(view => (
                <button
                  key={view.key}
                  onClick={() => {
                    setClientView(view.key);
                    setContactFilter('all');
                  }}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] border px-4 text-[12px] font-semibold transition",
                    clientView === view.key
                      ? "border-[#1F2937] bg-[#1F2937] text-white"
                      : "border-[#E6E9EF] bg-white text-[#6B7280] hover:border-[#CBD5E1] hover:text-[#1F2937]"
                  )}
                >
                  {view.label}
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px]",
                    clientView === view.key ? "bg-white/15 text-white" : "bg-[#F1F3F6] text-[#9CA3AF]"
                  )}>{view.count}</span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <p className="text-[12px] text-[#9CA3AF]">Статус меняется для всех менеджеров сразу</p>
              {clientView === 'contacted' && (
                <div className="mt-3 border-t border-[#EEF0F4] pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">
                    Когда писали
                  </p>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {CONTACT_AGE_FILTERS.map(filter => {
                      const count = baseClients.filter((client: any) =>
                        client.lastContactAt &&
                        client.lastContactStatus !== 'в работе' &&
                        matchesContactAge(client, filter.key)
                      ).length;
                      return (
                        <button
                          key={filter.key}
                          onClick={() => setContactFilter(filter.key)}
                          className={cn(
                            "inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] border px-3 text-[11px] font-semibold transition",
                            contactFilter === filter.key
                              ? "border-[#7D7DE6] bg-[#F0EFFF] text-[#6666D9]"
                              : "border-[#E6E9EF] bg-white text-[#6B7280] hover:border-[#C9C9F5]"
                          )}
                        >
                          {filter.label}
                          <span className="text-[10px] text-[#9CA3AF]">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.04)]">
          <div className="flex flex-col gap-3 border-b border-[#E6E9EF] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9CA3AF]">Список клиентов</p>
              <h3 className="mt-1 text-[20px] font-medium text-[#1F2937]">{filteredClients.length} контактов</h3>
            </div>
            <p className="text-[13px] text-[#9CA3AF]">Открывай строку для карточки клиента, заказа и касаний</p>
          </div>

          {fbLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] font-medium text-[#9CA3AF]">
              <RefreshCcw size={16} className="animate-spin" /> Загрузка клиентов...
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1320px] table-fixed">
                  <thead>
                    <tr className="border-b border-[#E6E9EF] bg-[#F6F7F9] text-left">
                      <th className="w-[70px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">#</th>
                      <th className="w-[280px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Клиент</th>
                      <th className="w-[220px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Контакты</th>
                      <th className="w-[160px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Город</th>
                      <th className="w-[380px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Касание</th>
                      <th className="w-[140px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Заказы</th>
                      <th className="w-[170px] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClients.map((client: any, i: number) => {
                      const phone = client.phone || client.userId;
                      const contact = getContactSummary(client);
                      const isInlineActive = inlineExpandedPhone === phone;
                      return (
                        <tr
                          key={`${phone || client.fullName || i}-${i}`}
                          onClick={() => setSelectedLoyaltyClient({ ...client, name: client.fullName || client.name })}
                          className="group cursor-pointer border-b border-[#EEF1F5] align-top transition hover:bg-[#F6F7F9]"
                        >
                          <td className="px-4 py-4 text-[13px] font-medium text-[#9CA3AF]">{i + 1}</td>
                          <td className="px-4 py-4">
                            <p className="truncate text-[15px] font-semibold text-[#1F2937]">{client.fullName || client.name || 'Неизвестно'}</p>
                            <p className="mt-1 text-[13px] font-medium text-[#9CA3AF]">+{phone || 'нет телефона'}</p>
                          </td>
                          <td className="px-4 py-4">
                            <div className="space-y-1">
                              {client.insta ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openInstagram(client);
                                  }}
                                  className="inline-flex min-h-9 max-w-full items-center gap-1.5 truncate rounded-[8px] bg-[#7D7DE6]/10 px-2.5 text-[13px] font-semibold text-[#6868D8] transition hover:bg-[#7D7DE6]/15"
                                >
                                  <Instagram size={14} />@{client.insta.replace('@', '')}
                                  <ExternalLink size={12} />
                                </button>
                              ) : (
                                <span className="text-[13px] text-[#CBD5E1]">Instagram не указан</span>
                              )}
                              {client.email ? (
                                <p className="truncate text-[12px] text-[#6B7280]">{client.email}</p>
                              ) : inlineEmailPhone === phone ? (
                                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="email"
                                    value={inlineEmailValue}
                                    onChange={e => setInlineEmailValue(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleEmailSave(client)}
                                    autoFocus
                                    placeholder="email"
                                    className="h-8 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-2 text-[12px] outline-none focus:border-[#7D7DE6]"
                                  />
                                  <button
                                    onClick={() => handleEmailSave(client)}
                                    disabled={inlineEmailSaving || !inlineEmailValue.trim()}
                                    className="h-8 rounded-[8px] bg-[#1F2937] px-2 text-[10px] font-semibold text-white disabled:opacity-40"
                                  >
                                    OK
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEmailPhone(phone);
                                    setInlineEmailValue('');
                                  }}
                                  className="text-[12px] font-semibold text-[#7D7DE6]"
                                >
                                  + email
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-[13px] font-medium text-[#6B7280]">{client.city || '-'}</td>
                          <td className="px-4 py-4">
                            <div className="space-y-3" onClick={e => e.stopPropagation()}>
                              <span className={cn(
                                "inline-flex rounded-[6px] px-2 py-1 text-[11px] font-semibold",
                                contact.days === null ? "bg-[#F6F7F9] text-[#9CA3AF]" :
                                contact.days >= 30 ? "bg-[#F06B6B]/10 text-[#F06B6B]" :
                                contact.days >= 14 ? "bg-[#F5A623]/10 text-[#F5A623]" :
                                "bg-[#2EBA7F]/10 text-[#0A9B62]"
                              )}>
                                {contact.days === null ? 'Не писали' : contact.days === 0 ? 'сегодня' : `${contact.days} дн.`}
                              </span>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-medium text-[#6B7280]">
                                <span>статус: <b className="font-semibold text-[#1F2937]">{contact.status}</b></span>
                                <span>дата: <b className="font-semibold text-[#1F2937]">{contact.date}</b></span>
                                <span className="truncate">менеджер: <b className="font-semibold text-[#1F2937]">{contact.manager}</b></span>
                                <span className="truncate">метка: <b className="font-semibold text-[#1F2937]">{contact.tag || 'нет'}</b></span>
                              </div>
                              {contact.note && (
                                <p className="line-clamp-2 rounded-[8px] bg-[#F6F7F9] px-2 py-1.5 text-[12px] font-medium text-[#1F2937]">
                                  {contact.note}
                                </p>
                              )}
                              {contact.broadcast && (
                                <p className="text-[11px] font-medium text-[#9CA3AF]">
                                  рассылка: {new Date(contact.broadcast.sentAt).toLocaleDateString('ru-RU')} · {contact.broadcast.status}
                                </p>
                              )}
                              {client.insta && contact.status !== 'написали' && contact.status !== 'ответил' && (
                                <button
                                  type="button"
                                  onClick={() => void markAsContacted(client)}
                                  disabled={quickSavingPhone === String(phone)}
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#2EBA7F] px-3 text-[11px] font-semibold text-white transition hover:bg-[#25A870]"
                                >
                                  {quickSavingPhone === String(phone)
                                    ? <RefreshCcw size={14} className="animate-spin" />
                                    : <CheckCircle size={14} />}
                                  {quickSavedPhone === String(phone) ? 'Сохранено' : 'Написал'}
                                </button>
                              )}
                              <div className="grid gap-2 md:grid-cols-[110px_120px_1fr_auto]">
                                <select
                                  value={isInlineActive ? inlineStatus : 'написали'}
                                  onFocus={() => setInlineExpandedPhone(phone)}
                                  onChange={e => {
                                    setInlineExpandedPhone(phone);
                                    setInlineStatus(e.target.value as typeof inlineStatus);
                                  }}
                                  className="h-9 rounded-[8px] border border-[#E6E9EF] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#7D7DE6]"
                                >
                                  <option value="написали">написали</option>
                                  <option value="ответил">ответил</option>
                                  <option value="не ответил">не ответил</option>
                                  <option value="отказ">отказ</option>
                                  <option value="перезвонить">перезвонить</option>
                                </select>
                                <select
                                  value={isInlineActive ? inlineTag : ''}
                                  onFocus={() => setInlineExpandedPhone(phone)}
                                  onChange={e => {
                                    setInlineExpandedPhone(phone);
                                    setInlineTag(e.target.value);
                                  }}
                                  className="h-9 rounded-[8px] border border-[#E6E9EF] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#7D7DE6]"
                                >
                                  <option value="">метка</option>
                                  {handbookLabels.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                                <input
                                  type="text"
                                  value={isInlineActive ? inlineNote : ''}
                                  onFocus={() => setInlineExpandedPhone(phone)}
                                  onChange={e => {
                                    setInlineExpandedPhone(phone);
                                    setInlineNote(e.target.value);
                                  }}
                                  onKeyDown={e => e.key === 'Enter' && isInlineActive && handleInlineSave(client)}
                                  placeholder="Новое касание..."
                                  className="h-9 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[12px] font-medium outline-none focus:border-[#7D7DE6]"
                                />
                                <button
                                  onClick={() => handleInlineSave(client)}
                                  disabled={!isInlineActive || inlineSaving || !inlineNote.trim()}
                                  className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] bg-[#1F2937] px-3 text-[11px] font-semibold text-white disabled:opacity-35"
                                >
                                  {inlineSaving && isInlineActive ? <RefreshCcw size={13} className="animate-spin" /> : <Send size={13} />}
                                  OK
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-[15px] font-semibold text-[#1F2937]">{client.ordersCount ?? client.count ?? 0}</td>
                          <td className="px-4 py-4 text-[15px] font-semibold text-[#2EBA7F]">{formatCurrency(client.totalSpent ?? client.total ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-[#E6E9EF] lg:hidden">
                {visibleClients.map((client: any, i: number) => {
                  const phone = client.phone || client.userId;
                  const contact = getContactSummary(client);
                  const isInlineActive = inlineExpandedPhone === phone;
                  return (
                    <div
                      key={`${phone || client.fullName || i}-mobile`}
                      onClick={() => setSelectedLoyaltyClient({ ...client, name: client.fullName || client.name })}
                      className="p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9CA3AF]">#{i + 1}</p>
                          <h4 className="mt-1 text-[17px] font-semibold text-[#1F2937]">{client.fullName || client.name || 'Неизвестно'}</h4>
                          <p className="mt-1 text-[14px] font-medium text-[#9CA3AF]">+{phone || 'нет телефона'}</p>
                        </div>
                        <p className="shrink-0 text-right text-[16px] font-semibold text-[#2EBA7F]">{formatCurrency(client.totalSpent ?? client.total ?? 0)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2" onClick={e => e.stopPropagation()}>
                        {client.insta ? (
                          <button
                            type="button"
                            onClick={() => openInstagram(client)}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-[#7D7DE6] px-3 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(125,125,230,0.18)]"
                          >
                            <Instagram size={17} /> Открыть Instagram
                          </button>
                        ) : (
                          <div className="inline-flex h-12 items-center justify-center rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] px-3 text-[12px] font-medium text-[#9CA3AF]">
                            Instagram не указан
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void markAsContacted(client)}
                          disabled={!client.insta || contact.status === 'написали' || contact.status === 'ответил' || quickSavingPhone === String(phone)}
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-[#2EBA7F]/30 bg-[#2EBA7F]/10 px-3 text-[13px] font-semibold text-[#0A9B62] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {quickSavingPhone === String(phone)
                            ? <RefreshCcw size={17} className="animate-spin" />
                            : <CheckCircle size={17} />}
                          {quickSavedPhone === String(phone) ? 'Сохранено' : 'Написал'}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-[8px] border border-[#E6E9EF] p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9CA3AF]">Заказы</p>
                          <p className="mt-1 text-[18px] font-semibold text-[#1F2937]">{client.ordersCount ?? client.count ?? 0}</p>
                        </div>
                        <div className="rounded-[8px] border border-[#E6E9EF] p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9CA3AF]">Касание</p>
                          <p className="mt-1 text-[14px] font-semibold text-[#1F2937]">{contact.days === null ? 'Не писали' : contact.days === 0 ? 'сегодня' : `${contact.days} дн.`}</p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9] p-3" onClick={e => e.stopPropagation()}>
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-medium text-[#6B7280]">
                          <span>статус: <b className="text-[#1F2937]">{contact.status}</b></span>
                          <span>дата: <b className="text-[#1F2937]">{contact.date}</b></span>
                          <span className="col-span-2 truncate">менеджер: <b className="text-[#1F2937]">{contact.manager}</b></span>
                          {contact.tag && <span className="col-span-2 truncate">метка: <b className="text-[#1F2937]">{contact.tag}</b></span>}
                        </div>
                        {contact.note && <p className="mt-2 line-clamp-2 text-[12px] font-medium text-[#1F2937]">{contact.note}</p>}
                        <div className="mt-3 grid gap-2">
                          <select
                            value={isInlineActive ? inlineStatus : 'написали'}
                            onFocus={() => setInlineExpandedPhone(phone)}
                            onChange={e => {
                              setInlineExpandedPhone(phone);
                              setInlineStatus(e.target.value as typeof inlineStatus);
                            }}
                            className="h-10 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-medium outline-none focus:border-[#7D7DE6]"
                          >
                            <option value="написали">написали</option>
                            <option value="ответил">ответил</option>
                            <option value="не ответил">не ответил</option>
                            <option value="отказ">отказ</option>
                            <option value="перезвонить">перезвонить</option>
                          </select>
                          <input
                            type="text"
                            value={isInlineActive ? inlineNote : ''}
                            onFocus={() => setInlineExpandedPhone(phone)}
                            onChange={e => {
                              setInlineExpandedPhone(phone);
                              setInlineNote(e.target.value);
                            }}
                            placeholder="Новое касание..."
                            className="h-10 rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-medium outline-none focus:border-[#7D7DE6]"
                          />
                          <button
                            onClick={() => handleInlineSave(client)}
                            disabled={!isInlineActive || inlineSaving || !inlineNote.trim()}
                            className="h-10 rounded-[8px] bg-[#1F2937] text-[12px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-35"
                          >
                            Сохранить касание
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-semibold text-[#6B7280]">
                        {client.city && <span className="rounded-[6px] bg-[#F6F7F9] px-2 py-1">{client.city}</span>}
                        {client.insta && <span className="rounded-[6px] bg-[#F6F7F9] px-2 py-1">@{client.insta.replace('@', '')}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {visibleClients.length === 0 && (
                <div className="px-4 py-12 text-center text-[14px] font-medium text-[#9CA3AF]">
                  Клиенты не найдены
                </div>
              )}
            </>
          )}

          <div ref={loadMoreRef} className="border-t border-[#E6E9EF] p-4 text-center text-[12px] font-medium text-[#9CA3AF]">
            {clientPage < filteredClients.length
              ? `Показано ${visibleClients.length} из ${filteredClients.length} · следующие загрузятся автоматически`
              : filteredClients.length > 0 ? `Показаны все ${filteredClients.length}` : ''}
          </div>
        </div>
      </section>

      {/* Client Detail Overlay */}
      <AnimatePresence>
        {selectedLoyaltyClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLoyaltyClient(null)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-zinc-50 shadow-2xl z-[201] overflow-y-auto border-l border-zinc-200"
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-white text-xs font-black">
                      {selectedLoyaltyClient.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h2 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest leading-tight">Карточка клиента</h2>
                      <p className="text-[8px] text-zinc-400 font-bold tracking-tight uppercase mt-0.5">ID: {selectedLoyaltyClient.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNavigate('order-form', {
                        ...selectedLoyaltyClient,
                        ...loyaltyDetails
                      })}
                      className="tg-btn px-3 py-1.5 text-[9px]"
                    >
                      <Plus size={12} />
                      Заказ
                    </button>
                    <button
                      onClick={() => setSelectedLoyaltyClient(null)}
                      className="p-1.5 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Panel tabs */}
                <div className="flex gap-1 mb-4 bg-zinc-100 p-1 rounded-xl">
                  {([
                    { id: 'info', label: 'Клиент', icon: Users },
                    { id: 'contacts', label: `Касания${contactHistory.length ? ` (${contactHistory.length})` : ''}`, icon: MessageCircle },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActivePanel(tab.id)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                        activePanel === tab.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600"
                      )}
                    >
                      <tab.icon size={10} />
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Contacts Panel */}
                {activePanel === 'contacts' && (
                  <div className="space-y-3 pb-6">
                    {/* Last contact badge */}
                    {loyaltyDetails?.lastContactAt && (() => {
                      const days = Math.floor((Date.now() - new Date(loyaltyDetails.lastContactAt).getTime()) / 86400000);
                      return (
                        <div className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-xl text-[9px] font-bold",
                          days > 30 ? "bg-red-50 text-red-600 border border-red-100" :
                          days > 14 ? "bg-amber-50 text-amber-600 border border-amber-100" :
                          "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        )}>
                          <Clock size={11} />
                          <span>Последнее касание: {days === 0 ? 'сегодня' : `${days} дн. назад`}</span>
                          {days > 14 && <AlertCircle size={11} className="ml-auto" />}
                        </div>
                      );
                    })()}

                    {/* Add contact button */}
                    <button
                      onClick={() => setShowContactForm(v => !v)}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors"
                    >
                      <Plus size={11} />
                      Записать касание
                      <ChevronDown size={10} className={cn("ml-auto transition-transform", showContactForm && "rotate-180")} />
                    </button>

                    <AnimatePresence>
                      {showContactForm && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="tg-card p-3 space-y-2.5">
                            {/* Status selector */}
                            <div className="space-y-1">
                              <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Результат</label>
                              <div className="flex gap-1 flex-wrap">
                                {(['написали', 'ответил', 'не ответил', 'отказ', 'перезвонить'] as const).map(s => (
                                  <button
                                    key={s}
                                    onClick={() => setNewContactStatus(s)}
                                    className={cn(
                                      "px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-tighter transition-all",
                                      newContactStatus === s
                                        ? s === 'ответил' ? "bg-emerald-500 text-white"
                                          : s === 'не ответил' ? "bg-amber-500 text-white"
                                          : s === 'отказ' ? "bg-red-500 text-white"
                                          : "bg-zinc-900 text-white"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                                    )}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Tag */}
                            <div className="relative">
                              <Tag size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                              <input
                                type="text"
                                value={newContactTag}
                                onChange={e => setNewContactTag(e.target.value)}
                                placeholder="Тег (необязательно)"
                                className="tg-input pl-8 py-1.5 text-[10px]"
                              />
                            </div>

                            {/* Note */}
                            <textarea
                              value={newContactNote}
                              onChange={e => setNewContactNote(e.target.value)}
                              placeholder="Заметка о контакте..."
                              rows={3}
                              className="tg-input py-2 text-[10px] resize-none w-full"
                            />

                            <button
                              onClick={handleAddContact}
                              disabled={isSendingContact || !newContactNote.trim()}
                              className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors disabled:opacity-40"
                            >
                              {isSendingContact ? <RefreshCcw size={11} className="animate-spin" /> : <Send size={11} />}
                              Сохранить
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* History */}
                    {contactHistoryLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCcw size={16} className="animate-spin text-zinc-300" />
                      </div>
                    ) : contactHistory.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-zinc-200 rounded-xl opacity-40 italic text-[9px] uppercase font-bold tracking-widest">
                        Касаний пока нет
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {contactHistory.map((entry) => {
                          const entryDays = Math.floor((Date.now() - new Date(entry.date).getTime()) / 86400000);
                          const statusColor =
                            entry.status === 'ответил' ? 'text-emerald-600 bg-emerald-50' :
                            entry.status === 'не ответил' ? 'text-amber-600 bg-amber-50' :
                            entry.status === 'отказ' ? 'text-red-600 bg-red-50' :
                            entry.status === 'перезвонить' ? 'text-blue-600 bg-blue-50' :
                            'text-zinc-600 bg-zinc-100';
                          return (
                            <div key={entry.id} className="tg-card p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {entry.managerPhoto ? (
                                    <img src={entry.managerPhoto} className="w-5 h-5 rounded-full shrink-0" alt="" />
                                  ) : (
                                    <div className="w-5 h-5 bg-zinc-200 rounded-full shrink-0 flex items-center justify-center text-[7px] font-black text-zinc-500">
                                      {entry.managerName?.charAt(0) || 'М'}
                                    </div>
                                  )}
                                  <span className="text-[9px] font-bold text-zinc-900 truncate">{entry.managerName}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={cn("text-[7px] font-black uppercase px-1.5 py-0.5 rounded tracking-tighter", statusColor)}>
                                    {entry.status}
                                  </span>
                                  <span className={cn(
                                    "text-[7px] font-bold",
                                    entryDays > 30 ? "text-red-400" : entryDays > 14 ? "text-amber-400" : "text-zinc-400"
                                  )}>
                                    {entryDays === 0 ? 'сегодня' : `${entryDays}д`}
                                  </span>
                                </div>
                              </div>
                              {entry.tag && (
                                <span className="inline-flex items-center gap-1 text-[7px] font-black text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
                                  <Tag size={7} />
                                  {entry.tag}
                                </span>
                              )}
                              <p className="text-[10px] text-zinc-700 leading-relaxed">{entry.note}</p>
                              <p className="text-[8px] text-zinc-300 font-medium">
                                {new Date(entry.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activePanel === 'info' && isLoyaltyLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center space-y-3">
                    <RefreshCcw className="w-8 h-8 text-zinc-300 animate-spin" />
                    <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest italic">Загрузка данных...</p>
                  </div>
                ) : activePanel === 'info' && localLoyaltyDetails ? (
                  <div className="space-y-4">
                    {/* Basic Info Form */}
                    <div className="tg-card p-4 space-y-3">
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">ФИО клиента</label>
                          <div className="relative">
                            <Users size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                            <input
                              type="text"
                              value={localLoyaltyDetails.fullName || ''}
                              onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, fullName: e.target.value })}
                              className="tg-input pl-8 py-2"
                              placeholder="Введите полное имя"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Email</label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-zinc-300">@</span>
                            <input
                              type="email"
                              value={localLoyaltyDetails.email || ''}
                              onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, email: e.target.value })}
                              className="tg-input pl-8 py-2 font-mono"
                              placeholder="client@example.com"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Телефон</label>
                            <div className="relative">
                              <Phone size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                              <input
                                type="text"
                                value={localLoyaltyDetails.phone || localLoyaltyDetails.userId || ''}
                                readOnly
                                className="tg-input pl-8 py-2 bg-zinc-100 text-zinc-400 cursor-not-allowed border-none"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Скидка (%)</label>
                            <div className="relative">
                              <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                              <input
                                type="number"
                                value={localLoyaltyDetails.currentDiscount || 0}
                                onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, currentDiscount: parseInt(e.target.value) || 0 })}
                                className="tg-input pl-8 py-2 font-black"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Город</label>
                            <div className="relative">
                              <MapPin size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                              <input
                                type="text"
                                value={localLoyaltyDetails.city || selectedLoyaltyClient.city || ''}
                                onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, city: e.target.value })}
                                className="tg-input pl-8 py-2"
                                placeholder="Город"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Источник</label>
                            <div className="relative">
                              <TrendingUp size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                              <select
                                value={localLoyaltyDetails.saleSource || ''}
                                onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, saleSource: e.target.value })}
                                className="tg-input pl-8 py-2 appearance-none"
                              >
                                <option value="">Не указан</option>
                                <option>Наш клиент</option>
                                <option>Рилс</option>
                                <option>Рекомендация</option>
                                <option>Таргет</option>
                                <option>Онлайн примерка</option>
                                <option>Блогер</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Адрес доставки</label>
                          <div className="relative">
                            <MapPin size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                            <input
                              type="text"
                              value={localLoyaltyDetails.address || selectedLoyaltyClient.city || ''}
                              onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, address: e.target.value })}
                              className="tg-input pl-8 py-2"
                              placeholder="Город, улица, дом"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-1">Соцсети / Instagram</label>
                          <div className="relative">
                            <Instagram size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-300" />
                            <input
                              type="text"
                              value={localLoyaltyDetails.insta || selectedLoyaltyClient.insta || ''}
                              onChange={(e) => setLocalLoyaltyDetails({ ...localLoyaltyDetails, insta: e.target.value })}
                              className="tg-input pl-8 py-2"
                              placeholder="@username"
                            />
                            {(localLoyaltyDetails.insta || selectedLoyaltyClient.insta) && (
                              <a
                                href={`https://instagram.com/${(localLoyaltyDetails.insta || selectedLoyaltyClient.insta).replace('@', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-900 transition-colors"
                              >
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={async () => {
                            setIsSaving(true);
                            const userId = selectedLoyaltyClient.phone || selectedLoyaltyClient.name;
                            await updateDoc(doc(db, 'contacts', userId), localLoyaltyDetails);
                            setIsSaving(false);
                          }}
                          disabled={isSaving}
                          className="tg-btn w-full mt-4 py-2.5 uppercase tracking-widest font-black"
                        >
                          {isSaving ? (
                            <>
                              <RefreshCcw size={12} className="animate-spin" />
                              Сохранение...
                            </>
                          ) : (
                            <>
                              <Award size={12} />
                              Сохранить изменения
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Stats - Compact */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="tg-card bg-zinc-900 p-4 text-white">
                        <p className="text-[7px] font-black text-zinc-400 uppercase tracking-widest mb-1">Всего потрачено</p>
                        <p className="text-sm font-black tracking-tight">{formatCurrency(loyaltyDetails?.totalSpent ?? selectedLoyaltyClient.total ?? selectedLoyaltyClient.totalSpent ?? 0)}</p>
                      </div>
                      <div className="tg-card p-4 border-zinc-200">
                        <p className="text-[7px] font-black text-zinc-400 uppercase tracking-widest mb-1">Количество заказов</p>
                        <p className="text-sm font-black tracking-tight text-zinc-900">{loyaltyDetails?.ordersCount ?? selectedLoyaltyClient.count ?? selectedLoyaltyClient.ordersCount ?? 0}</p>
                      </div>
                    </div>

                    {/* Orders List - High Density */}
                    <div className="space-y-2">
                      <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">История заказов</h3>
                      <div className="space-y-1.5 font-sans">
                        {clientOrders.length > 0 ? (
                          clientOrders.map((order, idx) => (
                            <div key={idx} className="tg-card p-2 flex items-center justify-between hover:border-zinc-300 transition-colors">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-zinc-50 rounded">
                                  <Hash size={10} className="text-zinc-400" />
                                </div>
                                <div className="leading-tight">
                                  <p className="text-[10px] font-bold text-zinc-900">#{order.orderId}</p>
                                  <p className="text-[8px] text-zinc-400 font-medium">{order.date.toLocaleDateString('ru-RU')}</p>
                                </div>
                              </div>
                              <div className="text-right leading-tight">
                                <p className="text-[10px] font-black text-zinc-900">{formatCurrency(order.revenue)}</p>
                                <span className="text-[7px] font-black uppercase text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded tracking-tighter">
                                  {order.status || 'В работе'}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-6 border border-dashed border-zinc-200 rounded-xl opacity-40 italic text-[9px] uppercase font-bold tracking-widest">Заказов пока нет</div>
                        )}
                      </div>
                    </div>

                    {/* Broadcast History */}
                    {(() => {
                      const broadcasts = getClientBroadcasts(selectedLoyaltyClient);
                      if (!broadcasts.length) return null;
                      return (
                        <div className="space-y-2 pb-6">
                          <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">
                            Рассылки ({broadcasts.length})
                          </h3>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {broadcasts.map((entry, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 bg-white rounded-xl border border-zinc-100">
                                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black
                                  ${entry.status === 'sent' ? 'bg-emerald-100 text-emerald-600'
                                  : entry.status === 'no_tg' ? 'bg-slate-100 text-slate-400'
                                  : 'bg-red-100 text-red-500'}`}>
                                  {entry.status === 'sent' ? '✓' : entry.status === 'no_tg' ? '∅' : '✗'}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] text-zinc-400 font-medium">
                                    {entry.sentAt ? new Date(entry.sentAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                                  </p>
                                  <p className="text-[10px] text-zinc-600 truncate">{entry.message || '—'}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Модал добавления клиента */}
      <AnimatePresence>
        {isAddClientOpen && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-widest">Новый клиент</h3>
                <button onClick={() => setIsAddClientOpen(false)} className="p-1 text-zinc-400 hover:text-zinc-900">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: 'ФИО *', key: 'fullName', placeholder: 'Иванова Мария Ивановна', type: 'text' },
                  { label: 'Телефон *', key: 'phone', placeholder: '79161234567', type: 'tel' },
                  { label: 'Instagram', key: 'insta', placeholder: '@username', type: 'text' },
                  { label: 'Email', key: 'email', placeholder: 'email@example.com', type: 'email' },
                  { label: 'Город', key: 'city', placeholder: 'Москва', type: 'text' },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest ml-1">{field.label}</label>
                    <input
                      type={field.type}
                      value={(addClientForm as any)[field.key]}
                      onChange={e => setAddClientForm({ ...addClientForm, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                    />
                  </div>
                ))}
              </div>
              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex gap-2">
                <button onClick={() => setIsAddClientOpen(false)} className="flex-1 py-2.5 bg-white border border-zinc-200 text-zinc-500 rounded-xl text-[10px] font-black uppercase tracking-widest">
                  Отмена
                </button>
                <button
                  onClick={handleAddClient}
                  disabled={addClientSaving || !addClientForm.fullName.trim() || !addClientForm.phone.trim()}
                  className="flex-[2] py-2.5 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {addClientSaving ? <RefreshCcw size={12} className="animate-spin" /> : <Plus size={12} />}
                  Добавить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
