import React, { useState, useMemo, useEffect } from 'react';
import {
  Users, Search, Plus, X, RefreshCcw, Award,
  DollarSign, MapPin, Phone, Instagram, ExternalLink,
  Hash, TrendingUp, Upload, CheckCircle, MessageCircle,
  Clock, ChevronDown, Send, Tag, AlertCircle, Mail
} from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from '../../firebase';
import { doc, updateDoc, onSnapshot, setDoc, writeBatch, collection, getDocs, orderBy, query, addDoc, where, serverTimestamp } from 'firebase/firestore';
import { OrderData } from '../AnalyticsDashboard';

interface ClientsTabProps {
  stats: any;
  data: OrderData[];
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  onNavigate: (view: any, clientData?: any) => void;
  handbookLabels?: string[];
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

  // Communication tracking
  const [contactHistory, setContactHistory] = useState<any[]>([]);
  const [contactHistoryLoading, setContactHistoryLoading] = useState(false);
  const [newContactNote, setNewContactNote] = useState('');
  const [newContactStatus, setNewContactStatus] = useState<'написали' | 'ответил' | 'не ответил' | 'отказ' | 'перезвонить'>('написали');
  const [newContactTag, setNewContactTag] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [activePanel, setActivePanel] = useState<'info' | 'contacts'>('info');

  // Contact filter
  const [contactFilter, setContactFilter] = useState<'all' | 'never' | 5 | 10 | 20 | 30 | 60 | 90>('all');

  // Add client
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [addClientForm, setAddClientForm] = useState({ fullName: '', phone: '', insta: '', email: '', city: '' });
  const [addClientSaving, setAddClientSaving] = useState(false);

  // Inline quick contact form
  const [inlineExpandedPhone, setInlineExpandedPhone] = useState<string | null>(null);
  const [inlineNote, setInlineNote] = useState('');
  const [inlineStatus, setInlineStatus] = useState<'написали' | 'ответил' | 'не ответил' | 'отказ' | 'перезвонить'>('написали');
  const [inlineTag, setInlineTag] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineEmailPhone, setInlineEmailPhone] = useState<string | null>(null);
  const [inlineEmailValue, setInlineEmailValue] = useState('');
  const [inlineEmailSaving, setInlineEmailSaving] = useState(false);

  const handleInlineSave = async (client: any) => {
    if (!inlineNote.trim()) return;
    const phone = client.phone || client.userId;
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
      }).catch(() => {});
      // Update local fbClients state
      setFbClients(prev => prev.map(c =>
        (c.phone || c.userId) === phone
          ? { ...c, lastContactAt: entry.date, lastContactStatus: inlineStatus }
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
    setFbLoading(true);
    getDocs(query(collection(db, 'contacts'), orderBy('totalSpent', 'desc')))
      .then(snap => {
        setFbClients(snap.docs.map(d => d.data()));
      })
      .catch(() => {})
      .finally(() => setFbLoading(false));
  }, [importDone]);

  const handleImportAll = async () => {
    if (!window.confirm('Загрузить клиентов из новой таблицы и импортировать в Firebase?')) return;
    setIsImporting(true);
    setImportDone(false);
    try {
      // Fetch client database sheet
      const url = `https://docs.google.com/spreadsheets/d/${CLIENT_DB_SHEET_ID}/export?format=csv`;
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
    getDocs(query(
      collection(db, 'manager_contacts'),
      where('clientPhone', '==', phone),
      orderBy('date', 'desc')
    )).then(snap => {
      setContactHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {}).finally(() => setContactHistoryLoading(false));
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

  return (
    <>
      <div className="tg-card overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex flex-col gap-2">
          {/* Top row: title + import + search */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-[10px] font-semibold text-zinc-900 uppercase tracking-widest">Клиентская база</h3>
              <p className="text-[8px] text-zinc-400 font-medium uppercase tracking-wider">Всего: <span className="text-zinc-900">{fbClients.length || stats.uniqueClients}</span></p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAddClientOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-blue-500 text-white hover:bg-blue-600 transition-all"
              >
                <Plus size={11} /> Клиент
              </button>
              <button
                onClick={handleImportAll}
                disabled={isImporting}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  importDone ? "bg-emerald-500 text-white" : "bg-zinc-900 text-white hover:bg-zinc-700"
                )}
              >
                {isImporting ? (
                  <><RefreshCcw size={11} className="animate-spin" /> Импорт...</>
                ) : importDone ? (
                  <><CheckCircle size={11} /> Импортировано</>
                ) : (
                  <><Upload size={11} /> В Firebase</>
                )}
              </button>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-300" />
                <input
                  type="text"
                  placeholder="Поиск..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 pr-3 py-1.5 bg-zinc-50 border border-zinc-100 rounded-lg text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-200 transition-all w-36 sm:w-48"
                />
              </div>
            </div>
          </div>
          {/* Filter row */}
          <div className="flex flex-wrap gap-1">
            {([
              { key: 'all',   label: 'Все' },
              { key: 'never', label: 'Не писали' },
              { key: 5,       label: '5 дн' },
              { key: 10,      label: '10 дн' },
              { key: 20,      label: '20 дн' },
              { key: 30,      label: '30 дн' },
              { key: 60,      label: '60 дн' },
              { key: 90,      label: '90 дн' },
            ] as const).map(f => (
              <button
                key={String(f.key)}
                onClick={() => setContactFilter(f.key)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  contactFilter === f.key
                    ? f.key === 'never' ? "bg-zinc-900 text-white"
                      : f.key === 90 ? "bg-red-500 text-white"
                      : f.key === 60 ? "bg-orange-500 text-white"
                      : f.key === 30 ? "bg-amber-500 text-white"
                      : "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-zinc-100">
          {fbLoading ? (
            <div className="px-3 py-8 text-center text-[10px] text-zinc-400">
              <RefreshCcw size={14} className="animate-spin inline mr-2" />Загрузка клиентов...
            </div>
          ) : (fbClients.length > 0 ? fbClients : stats.topClients.map((c: any) => ({ fullName: c.name, phone: c.phone, insta: c.insta, city: c.city, totalSpent: c.total, ordersCount: c.count })))
            .filter((c: any) => {
              // Search filter
              const q = searchTerm.toLowerCase();
              const matchesSearch = !searchTerm ||
                (c.fullName || c.name)?.toLowerCase().includes(q) ||
                c.phone?.includes(q) ||
                c.insta?.toLowerCase().includes(q);
              if (!matchesSearch) return false;

              // Contact time filter
              if (contactFilter === 'all') return true;
              if (contactFilter === 'never') return !c.lastContactAt;
              const days = c.lastContactAt
                ? Math.floor((Date.now() - new Date(c.lastContactAt).getTime()) / 86400000)
                : null;
              return days !== null && days >= contactFilter;
            })
            .slice(0, searchTerm ? undefined : clientPage)
            .map((client: any, i: number) => (
              <div key={i} className="border-b border-zinc-50 last:border-b-0">
                {/* Main client row */}
                <div
                  onClick={() => setSelectedLoyaltyClient({ ...client, name: client.fullName || client.name })}
                  className="px-3 py-3 flex items-start justify-between gap-2 cursor-pointer active:bg-zinc-50 transition-colors"
                >
                  {/* Left: number + info */}
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span className="text-[9px] text-zinc-300 font-mono mt-0.5 shrink-0 w-4">{i + 1}</span>
                    <div className="flex flex-col gap-1 min-w-0">
                      {/* Name */}
                      <span className="text-[12px] font-semibold text-zinc-900 leading-tight">{client.fullName || client.name || 'Неизвестно'}</span>
                      {/* Phone */}
                      <span className="text-[11px] text-zinc-500 font-mono">+{client.phone}</span>
                      {/* Instagram */}
                      {client.insta && (
                        <a
                          href={`https://instagram.com/${client.insta.replace('@', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-pink-400 hover:text-pink-600 w-fit"
                        >
                          <Instagram size={12} />@{client.insta.replace('@', '')}
                        </a>
                      )}
                      {/* Email */}
                      {client.email && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 font-mono">
                          <Mail size={10} />{client.email}
                        </span>
                      )}
                      {/* Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {client.lastContactAt && (() => {
                          const days = Math.floor((Date.now() - new Date(client.lastContactAt).getTime()) / 86400000);
                          return (
                            <span className={cn(
                              "inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded",
                              days > 30 ? "bg-red-50 text-red-500" :
                              days > 14 ? "bg-amber-50 text-amber-500" :
                              "bg-emerald-50 text-emerald-500"
                            )}>
                              <Clock size={8} />
                              {days === 0 ? 'сегодня' : `${days}д`}
                            </span>
                          );
                        })()}
                        {client.lastContactStatus && (
                          <span className={cn(
                            "text-[9px] font-black px-1.5 py-0.5 rounded",
                            client.lastContactStatus === 'ответил' ? "bg-emerald-50 text-emerald-600" :
                            client.lastContactStatus === 'не ответил' ? "bg-amber-50 text-amber-600" :
                            client.lastContactStatus === 'отказ' ? "bg-red-50 text-red-600" :
                            "bg-zinc-100 text-zinc-500"
                          )}>
                            {client.lastContactStatus}
                          </span>
                        )}
                        {client.city && (
                          <span className="text-[9px] text-zinc-400 italic">{client.city}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Right: sum + orders */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[12px] font-bold text-zinc-900 tracking-tight whitespace-nowrap">{formatCurrency(client.totalSpent ?? client.total ?? 0)}</span>
                    {(client.ordersCount ?? client.count) ? (
                      <span className="text-[9px] text-zinc-400">{client.ordersCount ?? client.count} заказов</span>
                    ) : null}
                  </div>
                </div>

                {/* Inline email row */}
                {!client.email && (
                  <div className="px-3 pb-1" onClick={e => e.stopPropagation()}>
                    {inlineEmailPhone === (client.phone || client.userId) ? (
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={inlineEmailValue}
                          onChange={e => setInlineEmailValue(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleEmailSave(client)}
                          autoFocus
                          placeholder="email@example.com"
                          className="flex-1 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => handleEmailSave(client)}
                          disabled={inlineEmailSaving || !inlineEmailValue.trim()}
                          className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-[10px] font-black disabled:opacity-40"
                        >
                          {inlineEmailSaving ? <RefreshCcw size={10} className="animate-spin" /> : 'OK'}
                        </button>
                        <button onClick={() => setInlineEmailPhone(null)} className="px-2 py-1.5 text-zinc-400 hover:text-zinc-700">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setInlineEmailPhone(client.phone || client.userId); setInlineEmailValue(''); }}
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Mail size={9} /> + добавить email
                      </button>
                    )}
                  </div>
                )}

                {/* Inline contact row */}
                <div className="px-3 pb-3 space-y-2" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-zinc-400 px-2 py-1.5 bg-zinc-50 border border-zinc-100 rounded-lg shrink-0">
                      <Clock size={9} className="text-zinc-300" />
                      {client.lastContactAt
                        ? new Date(client.lastContactAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : 'Не писали'}
                    </span>
                    <select
                      value={inlineExpandedPhone === (client.phone || client.userId) ? inlineTag : ''}
                      onChange={e => {
                        setInlineExpandedPhone(client.phone || client.userId);
                        setInlineTag(e.target.value);
                      }}
                      onClick={() => setInlineExpandedPhone(client.phone || client.userId)}
                      className="flex-1 px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[10px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-300"
                    >
                      <option value="">— Метка —</option>
                      {handbookLabels.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inlineExpandedPhone === (client.phone || client.userId) ? inlineNote : ''}
                      onChange={e => {
                        setInlineExpandedPhone(client.phone || client.userId);
                        setInlineNote(e.target.value);
                      }}
                      onFocus={() => setInlineExpandedPhone(client.phone || client.userId)}
                      placeholder="Заметка о касании..."
                      onKeyDown={e => e.key === 'Enter' && inlineExpandedPhone === (client.phone || client.userId) && handleInlineSave(client)}
                      className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-zinc-300 focus:bg-white"
                    />
                    {inlineExpandedPhone === (client.phone || client.userId) && inlineNote.trim() && (
                      <button
                        onClick={() => handleInlineSave(client)}
                        disabled={inlineSaving}
                        className="flex items-center gap-1 px-3 py-2 bg-zinc-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-colors disabled:opacity-40 shrink-0"
                      >
                        {inlineSaving ? <RefreshCcw size={10} className="animate-spin" /> : <Send size={10} />}
                        Сохр.
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
        {(() => {
          const total = fbClients.length || stats.topClients.length;
          return clientPage < total ? (
            <div className="p-3 border-t border-zinc-100 text-center">
              <button
                onClick={() => setClientPage(p => p + PAGE_SIZE)}
                className="text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-900 transition-colors px-4 py-2 bg-zinc-50 hover:bg-zinc-100 rounded-lg border border-zinc-100"
              >
                Показать ещё {Math.min(PAGE_SIZE, total - clientPage)} из {total - clientPage} оставшихся
              </button>
            </div>
          ) : null;
        })()}
      </div>

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
                    <div className="space-y-2 pb-6">
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
