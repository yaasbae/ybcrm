import React, { useState, useEffect } from 'react';
import { 
  Bot, MessageSquare, Settings, Zap, 
  ShieldCheck, Database, Instagram, 
  ArrowRight, Save, Play, Pause,
  Terminal, UserCheck, Sparkles, Loader2,
  Package, Users, Search, Filter, Calendar,
  ChevronRight, ArrowLeft, Clock, Star,
  Trash2, Plus, X, Edit3, CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, query, orderBy, limit, onSnapshot, getDocs, where, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';

interface AISalesAgentProps {
  onBack?: () => void;
}

export const AISalesAgent: React.FC<AISalesAgentProps> = ({ onBack }) => {
  const [isActive, setIsActive] = useState(false);
  const [prompt, setPrompt] = useState(
    "Ты — профессиональный ИИ-продавец бренда премиальной одежды YBCRM. Твой стиль: уверенный, вежливый, вдохновляющий. Ты общаешься как эксперт в моде."
  );
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [accessToProducts, setAccessToProducts] = useState(true);
  const [collectContacts, setCollectContacts] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge' | 'catalog' | 'contacts' | 'kb_dialogs' | 'test'>('settings');
  const [kbDialogs, setKbDialogs] = useState<any[]>([]);
  const [isKbModalOpen, setIsKbModalOpen] = useState(false);
  const [editingKbItem, setEditingKbItem] = useState<any | null>(null);
  const [kbForm, setKbForm] = useState({
    userMessage: "",
    aiResponse: "",
    category: "размер",
    tag: "",
    active: true
  });
  const [contacts, setContacts] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [contactHistory, setContactHistory] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [filterTime, setFilterTime] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'chatting' | 'ordered'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResponse, setTestResponse] = useState<{ text: string, image?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({
    productId: "",
    quantity: 1,
    notes: ""
  });

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'ai_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setPrompt(data.aiPrompt || prompt);
          setKnowledgeBase(data.knowledgeBase || "");
          setIsActive(data.isActive || false);
          setClaudeKey(data.claudeKey || "");
          setAccessToProducts(data.accessToProducts !== undefined ? data.accessToProducts : true);
          setCollectContacts(data.collectContacts !== undefined ? data.collectContacts : true);
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();

    // Real-time logs
    const qLogs = query(collection(db, 'ai_logs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubscribeLogs = onSnapshot(qLogs, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLogs(logsData);
    });

    // Real-time products for preview
    const qProducts = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribeProducts = onSnapshot(qProducts, (snapshot) => {
      setProducts(snapshot.docs.map(doc => doc.data()));
    });

    // Real-time contacts
    const qContacts = query(collection(db, 'contacts'), orderBy('lastMessageAt', 'desc'));
    const unsubscribeContacts = onSnapshot(qContacts, (snapshot) => {
      setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Real-time Knowledge Base Dialogs
    const qKb = query(collection(db, 'dialog_knowledge_base'), orderBy('createdAt', 'desc'));
    const unsubscribeKb = onSnapshot(qKb, (snapshot) => {
      setKbDialogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeLogs();
      unsubscribeProducts();
      unsubscribeContacts();
      unsubscribeKb();
    };
  }, []);

  useEffect(() => {
    if (selectedContact) {
      const loadHistory = async () => {
        setIsHistoryLoading(true);
        try {
          const q = query(
            collection(db, 'ai_logs'), 
            where('userId', '==', selectedContact.userId), 
            orderBy('timestamp', 'asc')
          );
          const snap = await getDocs(q);
          setContactHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
          console.error("Error loading history:", e);
        } finally {
          setIsHistoryLoading(false);
        }
      };
      loadHistory();
    }
  }, [selectedContact]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'ai_config'), {
        aiPrompt: prompt,
        knowledgeBase: knowledgeBase,
        isActive: isActive,
        claudeKey: claudeKey,
        accessToProducts: accessToProducts,
        collectContacts: collectContacts,
        updatedAt: new Date().toISOString()
      });
      alert("Настройки успешно сохранены!");
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Ошибка при сохранении настроек.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestChat = async () => {
    if (!testInput.trim()) return;
    setIsTesting(true);
    setTestResponse(null);
    try {
      const response = await fetch('/api/chat/manychat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_input: testInput, user_id: 'test_dashboard' })
      });
      const data = await response.json();
      
      if (data.content && data.content.messages) {
        const textMsg = data.content.messages.find((m: any) => m.type === 'text');
        const imgMsg = data.content.messages.find((m: any) => m.type === 'image');
        setTestResponse({
          text: textMsg?.text || "Нет текстового ответа",
          image: imgMsg?.url
        });
      }
    } catch (error) {
      console.error("Test chat error:", error);
      setTestResponse({ text: "Ошибка при тестировании чата. Проверьте консоль." });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveKb = async () => {
    try {
      if (editingKbItem?.id) {
        await updateDoc(doc(db, 'dialog_knowledge_base', editingKbItem.id), {
          ...kbForm,
          updatedAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'dialog_knowledge_base'), {
          ...kbForm,
          createdAt: new Date().toISOString()
        });
      }
      setIsKbModalOpen(false);
      setEditingKbItem(null);
    } catch (e) {
      console.error("Error saving KB dialog:", e);
      alert("Ошибка при сохранении примера");
    }
  };

  const handleAddToKb = (input: string, response: string) => {
    setKbForm({
      userMessage: input,
      aiResponse: response,
      category: "размер",
      tag: "",
      active: true
    });
    setEditingKbItem(null);
    setIsKbModalOpen(true);
  };

  const handleDeleteKb = async (id: string) => {
    if (confirm("Удалить этот пример из базы?")) {
      try {
        await deleteDoc(doc(db, 'dialog_knowledge_base', id));
      } catch (e) {
        console.error("Error deleting KB dialog:", e);
      }
    }
  };

  const handleToggleKbActive = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'dialog_knowledge_base', id), {
        active: !currentStatus
      });
    } catch (e) {
      console.error("Error toggling KB status:", e);
    }
  };

  const stats = [
    { label: 'Всего контактов', value: contacts.length.toString(), icon: Users, color: 'text-slate-600' },
    { label: 'Обучающих примеров', value: kbDialogs.length.toString(), icon: Star, color: 'text-amber-500' },
    { label: 'Товаров в каталоге', value: products.length.toString(), icon: Package, color: 'text-emerald-500' },
  ];

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {onBack && (
            <button 
              onClick={onBack}
              className="p-3 bg-white border border-slate-100 rounded-2xl text-slate-400 hover:text-slate-900 hover:border-slate-200 transition-all shadow-sm group"
            >
              <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            </button>
          )}
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <div className="p-2 bg-slate-900 text-white rounded-2xl shadow-lg shadow-slate-200">
                <Bot size={28} />
              </div>
              ИИ-Продажник Claude
            </h1>
            <p className="text-slate-500 mt-1 font-medium">Автоматизация продаж в Instagram Direct через ManyChat</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm">
          <div className={cn(
            "px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 transition-colors",
            isActive ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
          )}>
            <div className={cn("w-2 h-2 rounded-full animate-pulse", isActive ? "bg-emerald-500" : "bg-slate-300")} />
            {isActive ? 'Активен' : 'Пауза'}
          </div>
          <button 
            onClick={() => setIsActive(!isActive)}
            className={cn(
              "p-2 rounded-xl transition-all shadow-md",
              isActive ? "bg-rose-500 text-white shadow-rose-200 hover:bg-rose-600" : "bg-slate-900 text-white shadow-slate-200 hover:bg-slate-800"
            )}
          >
            {isActive ? <Pause size={20} /> : <Play size={20} />}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-3 rounded-2xl bg-slate-50", stat.color)}>
                <stat.icon size={24} />
              </div>
              <span className="text-2xl font-black text-slate-900">{stat.value}</span>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Settings Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Settings className="text-blue-600" size={20} />
                <h2 className="text-lg font-bold text-slate-900">Настройка ИИ</h2>
              </div>
              
              <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl">
                <button
                  onClick={() => setActiveTab('settings')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'settings' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Настройки
                </button>
                <button
                  onClick={() => setActiveTab('knowledge')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'knowledge' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  База
                </button>
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'catalog' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Каталог ({products.length})
                </button>
                <button
                  onClick={() => setActiveTab('contacts')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'contacts' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Контакты ({contacts.length})
                </button>
                <button
                  onClick={() => setActiveTab('kb_dialogs')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'kb_dialogs' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Примеры ({kbDialogs.length})
                </button>
                <button
                  onClick={() => setActiveTab('test')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === 'test' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Тест
                </button>
              </div>
            </div>
            
            <div className="space-y-6">
              {activeTab === 'settings' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl">
                      <div className="p-2 bg-slate-900 rounded-xl">
                        <Bot size={16} className="text-white" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">Claude (Anthropic)</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">claude-sonnet-4-6</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                        API Ключ Anthropic
                      </label>
                      <input
                        type="password"
                        value={claudeKey}
                        onChange={(e) => setClaudeKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-slate-900/5 transition-all font-mono"
                      />
                    </div>
                  </div>

                  <div className="relative">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                      Системный промпт (Инструкции)
                    </label>
                    <textarea 
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="w-full h-40 px-6 py-4 bg-slate-50 border border-slate-100 rounded-[2rem] text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all resize-none leading-relaxed text-slate-700"
                      placeholder="Опишите, как ИИ должен общаться с клиентами..."
                    />
                  </div>
                </div>
              )}

              {activeTab === 'knowledge' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="relative">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                      База знаний (описание коллекции, FAQ, материалы)
                    </label>
                    <textarea 
                      value={knowledgeBase}
                      onChange={(e) => setKnowledgeBase(e.target.value)}
                      className="w-full h-80 px-6 py-4 bg-slate-50 border border-slate-100 rounded-[2rem] text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all resize-none leading-relaxed text-slate-700"
                      placeholder="Вставьте сюда подробную информацию о бренде и товарах..."
                    />
                  </div>
                </div>
              )}

              {activeTab === 'catalog' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Товары, видимые для ИИ</h3>
                      <div className="flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[9px] font-bold">
                        <Database size={10} /> СИНХРОНИЗИРОВАНО
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {products.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                          <Package size={32} className="mx-auto mb-2 opacity-20" />
                          <p className="text-xs font-medium">Каталог пуст. Добавьте товары во вкладке "Продукция"</p>
                        </div>
                      ) : (
                        products.map((p, i) => (
                          <div key={i} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden">
                                <img src={p.photos?.[0] || 'https://picsum.photos/seed/product/100/100'} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900">{p.name}</p>
                                <p className="text-[10px] text-slate-400 font-medium">{p.color} • {p.sizeGrid}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-blue-600">{p.sellingPrice} ₽</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 italic text-center">
                    ИИ автоматически получает эти данные при каждом запросе. Изменения во вкладке "Продукция" применяются мгновенно.
                  </p>
                </div>
              )}

              {activeTab === 'contacts' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {selectedContact ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <button 
                          onClick={() => setSelectedContact(null)}
                          className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
                        >
                          <ArrowLeft size={16} /> Назад к списку
                        </button>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black text-slate-900">@{selectedContact.userId}</span>
                          <div className={cn(
                            "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100"
                          )}>
                            {selectedContact.status || 'NEW'}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-2 space-y-6">
                          <div className="bg-slate-50 rounded-[2rem] border border-slate-100 p-6 flex flex-col h-[500px]">
                            <div className="flex items-center gap-3 mb-6">
                              <Clock size={16} className="text-slate-400" />
                              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">История переписки</h3>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                              {isHistoryLoading ? (
                                <div className="flex items-center justify-center h-full">
                                  <Loader2 size={24} className="animate-spin text-slate-300" />
                                </div>
                              ) : contactHistory.length === 0 ? (
                                <div className="text-center py-20 text-slate-400">
                                  <MessageSquare size={32} className="mx-auto mb-2 opacity-20" />
                                  <p className="text-xs font-medium">История сообщений не найдена</p>
                                </div>
                              ) : (
                                contactHistory.map((msg, i) => (
                                  <div key={msg.id || i} className="space-y-2">
                                    <div className="flex items-start gap-4">
                                      <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0">
                                        <div className="text-[10px] font-black">U</div>
                                      </div>
                                      <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm max-w-[80%]">
                                        <p className="text-sm text-slate-700">{msg.input}</p>
                                        <p className="text-[9px] text-slate-400 mt-1">
                                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                      </div>
                                    </div>

                                    {msg.response && (
                                      <div className="flex flex-col items-end gap-2 max-w-[80%]">
                                        <div className="flex items-start gap-4 justify-end w-full">
                                          <div className="bg-slate-900 px-4 py-3 rounded-2xl rounded-tr-none text-white shadow-md shadow-slate-100 w-full">
                                            <p className="text-sm whitespace-pre-wrap">{msg.response}</p>
                                            <p className="text-[9px] text-slate-400 mt-1">
                                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                          </div>
                                          <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                                            <Bot size={14} className="text-white" />
                                          </div>
                                        </div>
                                        <button 
                                          onClick={() => handleAddToKb(msg.input, msg.response)}
                                          className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-900 transition-colors"
                                        >
                                          <Star size={10} /> В базу знаний
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-6">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Детали клиента</h3>
                            
                            <div className="space-y-4">
                              <div className="p-4 bg-slate-50 rounded-2xl space-y-1">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Первое сообщение</p>
                                <p className="text-xs font-medium text-slate-700">
                                  {new Date(selectedContact.firstMessageAt).toLocaleDateString('ru-RU')} в {new Date(selectedContact.firstMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <div className="p-4 bg-slate-50 rounded-2xl space-y-1">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Последняя активность</p>
                                <p className="text-xs font-medium text-slate-700">
                                  {new Date(selectedContact.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <div className="p-4 bg-slate-50 rounded-2xl space-y-1">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Всего сообщений</p>
                                <p className="text-xs font-medium text-slate-700">{selectedContact.messagesCount || 0}</p>
                              </div>
                              {selectedContact.lastProduct && (
                                <div className="p-4 bg-blue-50 rounded-2xl space-y-1 border border-blue-100">
                                  <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Интересовался товаром</p>
                                  <p className="text-xs font-bold text-blue-600">{selectedContact.lastProduct}</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="bg-slate-900 p-6 rounded-[2rem] text-white space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Действия</h3>
                            <button className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all">
                              Назначить статус
                            </button>
                            <button 
                              onClick={() => {
                                setOrderForm({ productId: products[0]?.id || "", quantity: 1, notes: "" });
                                setIsOrderModalOpen(true);
                              }}
                              className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all"
                            >
                              Создать заказ
                            </button>
                            <button className="w-full py-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-xl text-xs font-bold transition-all">
                              Заблокировать
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex flex-wrap gap-4 items-center">
                        <div className="relative flex-1 min-w-[200px]">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                          <input 
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Поиск по ID или имени..."
                            className="w-full bg-white border border-slate-100 rounded-2xl pl-12 pr-6 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium"
                          />
                        </div>
                        
                        <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
                          {[
                            { id: 'all', label: 'Все' },
                            { id: 'new', label: 'Новые' },
                            { id: 'chatting', label: 'В работе' },
                            { id: 'ordered', label: 'Заказы' }
                          ].map(s => (
                            <button
                              key={s.id}
                              onClick={() => setFilterStatus(s.id as any)}
                              className={cn(
                                "px-3 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all",
                                filterStatus === s.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                              )}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {contacts.filter(c => {
                          const query = searchQuery.toLowerCase();
                          if (searchQuery && 
                             !c.userId.toLowerCase().includes(query) && 
                             !(c.fullName && c.fullName.toLowerCase().includes(query))
                          ) return false;
                          
                          if (filterStatus !== 'all' && (c.status || 'new') !== filterStatus) return false;
                          
                          return true;
                        }).map((contact, i) => (
                          <div 
                            key={contact.id || i}
                            onClick={() => setSelectedContact(contact)}
                            className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all cursor-pointer group relative overflow-hidden"
                          >
                            <div className="flex items-start gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center font-black text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all">
                                {(contact.fullName || contact.userId).charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-black text-slate-900 truncate">
                                  {contact.fullName || "Загрузка..."}
                                </h3>
                                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-tight truncate">@{contact.userId}</p>
                              </div>
                            </div>
                            
                            <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                {new Date(contact.lastMessageAt).toLocaleDateString('ru-RU')}
                              </div>
                              <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {contacts.length === 0 && (
                        <div className="bg-white p-16 text-center space-y-4 rounded-[2rem] border border-slate-100">
                          <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto text-slate-300">
                            <Users size={40} />
                          </div>
                          <h3 className="text-lg font-bold text-slate-400 uppercase tracking-widest">Список пуст</h3>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'kb_dialogs' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">База знаний диалогов</h2>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Примеры идеальных ответов для ИИ</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = '.json';
                          input.onchange = async (e: any) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async (re) => {
                              try {
                                const data = JSON.parse(re.target?.result as string);
                                if (Array.isArray(data)) {
                                  for (const item of data) {
                                    await addDoc(collection(db, 'dialog_knowledge_base'), {
                                      userMessage: item.userMessage || item.q,
                                      aiResponse: item.aiResponse || item.a,
                                      category: item.category || "размер",
                                      tag: item.tag || "",
                                      active: true,
                                      createdAt: new Date().toISOString()
                                    });
                                  }
                                  alert(`Загружено ${data.length} примеров`);
                                }
                              } catch (err) {
                                alert("Ошибка при чтении файла. Проверьте формат JSON.");
                              }
                            };
                            reader.readAsText(file);
                          };
                          input.click();
                        }}
                        className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                      >
                        <Database size={16} /> Импорт (JSON)
                      </button>
                      <button 
                        onClick={() => {
                          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(kbDialogs, null, 2));
                          const downloadAnchorNode = document.createElement('a');
                          downloadAnchorNode.setAttribute("href", dataStr);
                          downloadAnchorNode.setAttribute("download", "kb_dialogs_export.json");
                          document.body.appendChild(downloadAnchorNode);
                          downloadAnchorNode.click();
                          downloadAnchorNode.remove();
                        }}
                        className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                      >
                        Экспорт
                      </button>
                      <button 
                        onClick={() => {
                          setKbForm({ userMessage: "", aiResponse: "", category: "размер", tag: "", active: true });
                          setEditingKbItem(null);
                          setIsKbModalOpen(true);
                        }}
                        className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                      >
                        <Plus size={16} /> Добавить пример
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {kbDialogs.length === 0 ? (
                      <div className="bg-white p-20 rounded-[2.5rem] border border-slate-100 text-center space-y-4">
                        <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto text-slate-300">
                          <Star size={40} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-400">База примеров пуста</h3>
                        <p className="text-xs text-slate-400 max-w-xs mx-auto">Добавляйте лучшие диалоги из истории переписки, чтобы бот учился отвечать еще лучше</p>
                      </div>
                    ) : (
                      kbDialogs.map((kb, i) => (
                        <div 
                          key={kb.id || i}
                          className={cn(
                            "group bg-white p-6 rounded-[2rem] border transition-all space-y-4",
                            kb.active ? "border-slate-100 hover:border-blue-100" : "border-slate-50 opacity-60 grayscale hover:grayscale-0 hover:opacity-100"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="px-3 py-1 rounded-full bg-slate-100 text-[8px] font-black uppercase text-slate-500 tracking-widest">
                                {kb.category}
                              </span>
                              {kb.tag && (
                                <span className="px-3 py-1 rounded-full bg-blue-50 text-[8px] font-black uppercase text-blue-500 tracking-widest">
                                  #{kb.tag}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleToggleKbActive(kb.id, kb.active)}
                                className={cn(
                                  "p-2 rounded-xl transition-all",
                                  kb.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                                )}
                              >
                                <CheckCircle2 size={16} />
                              </button>
                              <button 
                                onClick={() => {
                                  setKbForm({
                                    userMessage: kb.userMessage,
                                    aiResponse: kb.aiResponse,
                                    category: kb.category,
                                    tag: kb.tag || "",
                                    active: kb.active
                                  });
                                  setEditingKbItem(kb);
                                  setIsKbModalOpen(true);
                                }}
                                className="p-2 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-900 rounded-xl transition-all"
                              >
                                <Edit3 size={16} />
                              </button>
                              <button 
                                onClick={() => handleDeleteKb(kb.id)}
                                className="p-2 bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Вопрос клиента</p>
                              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                                <p className="text-xs font-medium text-slate-700">"{kb.userMessage}"</p>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Идеальный ответ</p>
                              <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                                <p className="text-xs font-bold text-blue-700 leading-relaxed">"{kb.aiResponse}"</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'test' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-slate-50 rounded-[2rem] p-8 border border-slate-100 space-y-6">
                    <div className="space-y-4">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Симуляция запроса от клиента
                      </label>
                      <div className="flex gap-3">
                        <input 
                          type="text"
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleTestChat()}
                          placeholder="Например: Сколько стоит черное худи?"
                          className="flex-1 bg-white border border-slate-100 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                        />
                        <button 
                          onClick={handleTestChat}
                          disabled={isTesting || !testInput.trim()}
                          className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-100 disabled:opacity-50"
                        >
                          {isTesting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                        </button>
                      </div>
                    </div>

                    {testResponse && (
                      <div className="space-y-4 animate-in zoom-in-95 duration-300">
                        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Bot size={16} className="text-slate-900" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ответ ИИ</span>
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed">{testResponse.text}</p>
                          
                          {testResponse.image && (
                            <div className="mt-4 rounded-2xl overflow-hidden border border-slate-100 max-w-xs">
                              <img src={testResponse.image} alt="Product" className="w-full h-auto" />
                              <div className="bg-slate-50 p-2 text-center">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Прикрепленное фото</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 italic text-center">
                    Этот тест использует ваши текущие настройки и каталог. Он симулирует реальный запрос из ManyChat.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setAccessToProducts(!accessToProducts)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors",
                    accessToProducts ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400"
                  )}
                >
                  <Database size={12} /> Доступ к товарам: {accessToProducts ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
                <button 
                  onClick={() => setCollectContacts(!collectContacts)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors",
                    collectContacts ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                  )}
                >
                  <UserCheck size={12} /> Сбор контактов: {collectContacts ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              </div>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
              </button>
            </div>
          </div>

          {/* Integration Guide */}
          <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-12 opacity-10 rotate-12">
              <Instagram size={120} />
            </div>
            
            <div className="relative z-10 space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-xl">
                  <ShieldCheck size={20} className="text-blue-400" />
                </div>
                <h2 className="text-lg font-bold">Настройка ManyChat</h2>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">1</div>
                  <p className="text-sm text-slate-300">Создайте блок <span className="text-white font-bold">External Request</span> в вашем ManyChat Flow.</p>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">2</div>
                  <div className="space-y-2 flex-1">
                    <p className="text-sm text-slate-300">Установите URL для POST запроса (используйте адрес из <span className="text-white font-bold">Publish</span>):</p>
                    <div className="bg-black/40 p-3 rounded-xl font-mono text-[10px] text-blue-300 break-all border border-white/5 flex items-center justify-between gap-2">
                      <span className="truncate">
                        {window.location.origin.includes('ais-dev') ? 'https://ais-pre-...' : window.location.origin}/api/chat/manychat
                      </span>
                      <button 
                        onClick={() => {
                          const url = `${window.location.origin.includes('ais-dev') ? window.location.origin.replace('ais-dev', 'ais-pre') : window.location.origin}/api/chat/manychat`;
                          navigator.clipboard.writeText(url);
                          alert("Ссылка скопирована!");
                        }}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0"
                      >
                        <Save size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">Адрес {window.location.origin.includes('ais-dev') ? 'ais-dev-...' : window.location.origin} работать в ManyChat не будет, так как он приватный.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold shrink-0 mt-1">3</div>
                  <p className="text-sm text-slate-300">Передайте <span className="text-white font-bold">last_input</span> и <span className="text-white font-bold">user_id</span> в теле запроса.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar / Logs */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Логи диалогов</h3>
              </div>
              <span className="px-2 py-1 bg-slate-50 text-[9px] font-bold text-slate-400 rounded-md">LIVE</span>
            </div>
            
            <div className="space-y-4 flex-1 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 space-y-2">
                  <MessageSquare size={24} className="opacity-20" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">Нет диалогов</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={log.id || i} className="p-4 bg-slate-50 rounded-2xl space-y-2 border border-slate-100/50">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-blue-600">@{log.userId || 'user'}</span>
                      <span className="text-[9px] text-slate-400">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2 italic">"{log.input}"</p>
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        log.status === 'error' ? "bg-rose-500" : "bg-emerald-500"
                      )} />
                      <span className="text-[9px] font-bold text-slate-400 uppercase">
                        {log.status === 'error' ? 'Ошибка' : 'Ответ отправлен'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <button className="w-full mt-6 py-3 border-2 border-dashed border-slate-200 rounded-xl text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:border-blue-300 hover:text-blue-500 transition-all">
              Посмотреть все диалоги
            </button>
          </div>
        </div>
      </div>

      {/* KB Modal */}
      {isKbModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="p-8 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  {editingKbItem ? 'Редактировать пример' : 'Добавить в базу знаний'}
                </h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Обучение ИИ на лучших ответах</p>
              </div>
              <button 
                onClick={() => setIsKbModalOpen(false)}
                className="p-3 bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-500 rounded-2xl transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Категория</label>
                  <select 
                    value={kbForm.category}
                    onChange={(e) => setKbForm({ ...kbForm, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium appearance-none"
                  >
                    <option value="размер">Размер</option>
                    <option value="доставка">Доставка</option>
                    <option value="цена">Цена</option>
                    <option value="характеристики">Характеристики</option>
                    <option value="возражения">Возражения</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Тег (необязательно)</label>
                  <input 
                    type="text"
                    value={kbForm.tag}
                    onChange={(e) => setKbForm({ ...kbForm, tag: e.target.value })}
                    placeholder="например: скидки"
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Вопрос клиента</label>
                <textarea 
                  value={kbForm.userMessage}
                  onChange={(e) => setKbForm({ ...kbForm, userMessage: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium min-h-[100px] resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-900 uppercase tracking-widest ml-1">Идеальный ответ</label>
                <textarea 
                  value={kbForm.aiResponse}
                  onChange={(e) => setKbForm({ ...kbForm, aiResponse: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-slate-900/5 transition-all font-bold text-slate-700 min-h-[150px] resize-none"
                />
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setIsKbModalOpen(false)}
                className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all"
              >
                Отмена
              </button>
              <button 
                onClick={handleSaveKb}
                className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-100 flex items-center justify-center gap-2"
              >
                <Save size={18} />
                {editingKbItem ? 'Сохранить изменения' : 'Добавить в базу'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* Order Modal */}
      {isOrderModalOpen && selectedContact && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div>
                <h3 className="text-xl font-black">Новый заказ</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Клиент: @{selectedContact.userId}</p>
              </div>
              <button onClick={() => setIsOrderModalOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Star className="text-blue-600" size={20} />
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-tight">Персональная скидка</span>
                </div>
                <span className="text-xl font-black text-slate-900">-{selectedContact.currentDiscount || 5}%</span>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Выберите товар</label>
                <select 
                  value={orderForm.productId}
                  onChange={(e) => setOrderForm({ ...orderForm, productId: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.sellingPrice} ₽</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Количество</label>
                  <input 
                    type="number"
                    min="1"
                    value={Number.isNaN(orderForm.quantity) ? '' : orderForm.quantity}
                    onChange={(e) => setOrderForm({ ...orderForm, quantity: parseInt(e.target.value) || 1 })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Итого со скидкой</label>
                  <div className="bg-slate-900 text-white rounded-2xl px-4 py-3 text-sm font-black flex items-center justify-center">
                    {Math.round((products.find(p => p.id === orderForm.productId)?.sellingPrice || 0) * orderForm.quantity * (1 - (selectedContact.currentDiscount || 5) / 100))} ₽
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Заметка к заказу</label>
                <textarea 
                  value={orderForm.notes}
                  onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-medium min-h-[80px] resize-none"
                  placeholder="Размер, цвет или адрес доставки..."
                />
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button onClick={() => setIsOrderModalOpen(false)} className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all">
                Отмена
              </button>
              <button 
                onClick={async () => {
                  try {
                    const price = Math.round((products.find(p => p.id === orderForm.productId)?.sellingPrice || 0) * orderForm.quantity * (1 - (selectedContact.currentDiscount || 5) / 100));
                    await addDoc(collection(db, 'orders'), {
                      ...orderForm,
                      userId: selectedContact.userId,
                      finalPrice: price,
                      discountApplied: selectedContact.currentDiscount || 5,
                      createdAt: new Date().toISOString(),
                      status: 'new'
                    });
                    setIsOrderModalOpen(false);
                    alert("Заказ успешно создан!");
                  } catch (e) {
                    alert("Ошибка при создании заказа");
                  }
                }}
                className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-100"
              >
                Оформить заказ
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
