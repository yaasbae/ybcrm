import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Save, ShoppingCart, User,
  MapPin, CreditCard, Instagram, Plus,
  Trash2, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronUp, Image as ImageIcon, X,
  QrCode, Copy, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { QRCodeSVG } from 'qrcode.react';
import { cn, formatCurrency } from '../lib/utils';
import { db, OperationType, handleFirestoreError, storage } from '../firebase';
import { collection, onSnapshot, doc, setDoc, query, orderBy, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface OrderFormProps {
  onBack: () => void;
  sheetId: string;
  initialClient?: any;
}

interface ProductItem {
  id: string;
  name: string;
  productId?: string;
}

export const OrderForm: React.FC<OrderFormProps> = ({ onBack, sheetId, initialClient }) => {
  const [loading, setLoading] = useState(false);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [tochkaEnabled, setTochkaEnabled] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [appProducts, setAppProducts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showPhoneDropdown, setShowPhoneDropdown] = useState(false);

  // Check if Tochka Bank is configured
  useEffect(() => {
    fetch('/api/tochka/status')
      .then(r => r.json())
      .then(d => setTochkaEnabled(!!d.configured))
      .catch(() => {});
  }, []);

  // Fetch contacts for search
  useEffect(() => {
    const q = query(collection(db, 'contacts'), orderBy('fullName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setContacts(snapshot.docs.map(doc => doc.data()));
    });
    return () => unsubscribe();
  }, []);

  // Pre-fill from initialClient
  useEffect(() => {
    if (initialClient) {
      if (initialClient.fullName || initialClient.name) setClientName(initialClient.fullName || initialClient.name);
      if (initialClient.phone) setPhone(initialClient.phone);
      if (initialClient.email) setEmail(initialClient.email);
      if (initialClient.address) setAddress(initialClient.address);
      if (initialClient.city) setCity(initialClient.city);
      if (initialClient.insta) setSocialLink(initialClient.insta);
      if (initialClient.saleSource) setSaleSource(initialClient.saleSource);
    }
  }, [initialClient]);

  // Fetch products from Firestore
  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => doc.data());
      setAppProducts(productsData);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });

    return () => unsubscribe();
  }, []);

  // Fetch suggestions from Google Sheets (справочник tab)
  useEffect(() => {
    const fetchSuggestions = async () => {
      setFetchingSuggestions(true);
      try {
        // Using gid=1235690567 for the 'справочник' sheet
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=1235690567`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csvText = await response.text();

        Papa.parse(csvText, {
          complete: (results) => {
            const names = new Set<string>();
            // Column G is index 6
            results.data.slice(1).forEach((row: any) => {
              if (row[6]) {
                const productName = String(row[6]).trim();
                if (productName && productName !== "Наименование") {
                  names.add(productName);
                }
              }
            });
            setSuggestions(Array.from(names).sort());
          }
        });
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      } finally {
        setFetchingSuggestions(false);
      }
    };

    fetchSuggestions();
  }, [sheetId]);

  // Combined suggestions (Google Sheets + Local Products)
  const allSuggestions = useMemo(() => {
    const productSuggestions = appProducts.map(p => ({
      name: p.name,
      display: `${p.name}${p.color ? ` (${p.color})` : ''}`
    }));
    
    const sheetSuggestions = suggestions.map(s => ({
      name: s,
      display: s
    }));

    // Merge and remove duplicates by name
    const seen = new Set();
    const combined = [...productSuggestions, ...sheetSuggestions].filter(item => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });

    return combined.sort((a, b) => a.name.localeCompare(b.name));
  }, [suggestions, appProducts]);

  // Form State
  const [orderNumber, setOrderNumber] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [shipmentDate, setShipmentDate] = useState('');
  const [manager, setManager] = useState('');
  const [products, setProducts] = useState<ProductItem[]>([{ id: '1', name: '' }]);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [height, setHeight] = useState('');
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [paymentType, setPaymentType] = useState('Предоплата');
  const [prepaymentAmount, setPrepaymentAmount] = useState('0');
  const [price, setPrice] = useState('');
  const [shipping, setShipping] = useState('');
  const [socialSource, setSocialSource] = useState('Instagram');
  const [socialLink, setSocialLink] = useState('');
  const [saleSource, setSaleSource] = useState('Наш клиент');

  const [productImage, setProductImage] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const addProduct = () => {
    setProducts([...products, { id: Date.now().toString(), name: '' }]);
  };

  const removeProduct = (id: string) => {
    if (products.length > 1) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  const updateProduct = (id: string, field: keyof ProductItem, value: string) => {
    setProducts(products.map(p => p.id === id ? { ...p, [field]: value } : p));
    
    // If name is updated, try to find the product and auto-fill other fields
    if (field === 'name') {
      const found = appProducts.find(ap => ap.name === value);
      if (found) {
        setProducts(prev => prev.map(p => p.id === id ? { ...p, productId: found.id } : p));
        if (found.color) setColor(found.color);
        if (found.photos && found.photos.length > 0 && !found.photos[0].includes('picsum.photos/seed/product')) {
          setProductImage(found.photos[0]);
        }
        if (found.height) {
          // Try to match height if it's one of the options
          const heightOptions = ['160-165', '170-175', '180-185'];
          if (heightOptions.includes(found.height)) {
            setHeight(found.height);
          } else {
            // If it's a custom height, we might need to add it or just set it
            setHeight(found.height);
          }
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const id = Date.now().toString();
      
      // Upload image to Firebase Storage if it's base64
      let finalImageUrl = productImage;
      if (productImage && productImage.startsWith('data:image')) {
        try {
          const response = await fetch(productImage);
          const blob = await response.blob();
          const fileName = `order_${id}_photo.jpg`;
          const storageRef = ref(storage, `orders/${id}/${fileName}`);
          await uploadBytes(storageRef, blob);
          finalImageUrl = await getDownloadURL(storageRef);
        } catch (uploadErr) {
          console.error('Order image upload error:', uploadErr);
        }
      }

      // Prepare data for Google Sheets
      const currentPrice = parseFloat(price) || 0;
      const currentPrepayment = parseFloat(prepaymentAmount) || 0;
      const remainingAmount = currentPrice - currentPrepayment;

      const formData = {
        orderNumber,
        manager,
        products: products.map(p => p.name).join(', '),
        productIds: products.map(p => p.productId).filter(Boolean),
        size,
        height,
        clientName,
        email,
        phone,
        city,
        address,
        color,
        trackingNumber,
        shippingCost,
        paymentType,
        price: currentPrice,
        prepaymentAmount: currentPrepayment,
        remainingAmount: remainingAmount,
        paymentStatus: currentPrepayment >= currentPrice ? 'paid' : (currentPrepayment > 0 ? 'prepaid' : 'pending'),
        shipping,
        socialSource,
        socialLink,
        saleSource,
        productImage: finalImageUrl,
        orderDate,
        shipmentDate,
        status: 'Новый',
        date: new Date().toLocaleDateString('ru-RU')
      };

      const orderData = {
        ...formData,
        id
      };

      await setDoc(doc(db, 'orders', id), orderData);

      // Also write to orders_new so it appears in the order list
      const orderNewData = {
        orderId: id,
        isFirebase: true,
        date: new Date().toISOString(),
        deadlineDate: shipmentDate ? new Date(shipmentDate).toISOString() : new Date().toISOString(),
        revenue: currentPrice,
        deliveryPrice: parseFloat(shippingCost) || 0,
        paidAmount: currentPrepayment,
        clientName,
        clientPhone: phone,
        clientInsta: socialLink,
        clientCity: city,
        status: 'Новый',
        source: saleSource,
        item: products.map(p => p.name).join(', '),
        deliveryMethod: shipping,
        year: new Date().getFullYear(),
        month: new Date().getMonth(),
        isBlogger: false,
        isRecommended: false,
        isShipped: false,
        isLate: false,
        isOverdue: false,
        rawRow: [color, '', '', '', '', '', '', '', size, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        height,
        manager,
        orderNumber,
        productImage: finalImageUrl,
        orderDate,
        shipmentDate,
      };
      await setDoc(doc(db, 'orders_new', id), orderNewData);

      // Update CRM (contacts)
      if (phone || clientName) {
        const contactId = phone || clientName;
        const contactRef = doc(db, 'contacts', contactId);
        const contactSnap = await getDoc(contactRef);
        
        const contactData = {
          userId: contactId,
          fullName: clientName,
          phone: phone,
          email: email,
          city: city,
          address: address,
          insta: socialLink,
          saleSource: saleSource,
          updatedAt: new Date().toISOString()
        };

        if (contactSnap.exists()) {
          const currentData = contactSnap.data();
          await updateDoc(contactRef, {
            ...contactData,
            totalSpent: (currentData.totalSpent || 0) + (parseFloat(price) || 0),
            ordersCount: (currentData.ordersCount || 0) + 1
          });
        } else {
          await setDoc(contactRef, {
            ...contactData,
            loyaltyCardId: `NDT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            currentDiscount: 5,
            totalSpent: parseFloat(price) || 0,
            ordersCount: 1,
            firstMessageAt: new Date().toISOString()
          });
        }
      }

      setSuccess(true);
      setSavedOrderId(id);
      if (!tochkaEnabled) {
        setTimeout(() => onBack(), 2000);
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'orders');
      setError('Ошибка при сохранении заказа в базу данных.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQr = async () => {
    if (!savedOrderId) return;
    setIsCreatingQr(true);
    setQrError(null);
    try {
      const res = await fetch('/api/tochka/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: savedOrderId,
          amount: parseFloat(price) || 0,
          description: `Заказ #${orderNumber} ${products.map(p => p.name).join(', ')}`,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания QR');
      setQrUrl(data.paymentUrl);
    } catch (e: any) {
      setQrError(e.message);
    } finally {
      setIsCreatingQr(false);
    }
  };

  const handleCopyLink = () => {
    if (qrUrl) {
      navigator.clipboard.writeText(qrUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#FBFBFD] text-[#1D1D1F] font-sans selection:bg-blue-100 p-4 md:py-6 md:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-6 h-6 text-slate-500" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Новый заказ</h1>
              <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Заполнение данных для таблицы</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Order Info */}
          <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <span className="text-[6px] font-bold text-zinc-300 block mb-1">[YB-F-SEC-ORD]</span>
            <div className="flex items-center gap-2 text-blue-500 mb-1">
              <ShoppingCart className="w-4 h-4" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">Информация о заказе</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 relative group">
                <span className="absolute -top-2 left-0 text-[5px] font-bold text-zinc-300 opacity-50 hidden group-hover:block">[YB-F-ORDNUM]</span>
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Номер заказа</label>
                <input 
                  required
                  value={orderNumber}
                  onChange={e => setOrderNumber(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Дата заказа</label>
                <input 
                  type="date"
                  required
                  value={orderDate}
                  onChange={e => setOrderDate(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 relative group">
                <span className="absolute -top-2 left-0 text-[5px] font-bold text-zinc-300 opacity-50 hidden group-hover:block">[YB-F-MGR]</span>
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Менеджер</label>
                <input 
                  required
                  value={manager}
                  onChange={e => setManager(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Дата отгрузки</label>
                <input 
                  type="date"
                  required
                  value={shipmentDate}
                  onChange={e => setShipmentDate(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
            </div>

              <div className="space-y-4">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">
                  Изделия {fetchingSuggestions && <span className="animate-pulse text-[9px] lowercase">(загрузка подсказок...)</span>}
                </label>
                {products.map((product, index) => (
                  <div key={product.id} className="flex gap-3">
                    <div className="flex-1 relative">
                      <input 
                        required
                        list={`suggestions-${product.id}`}
                        value={product.name}
                        onChange={e => updateProduct(product.id, 'name', e.target.value)}
                        className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                      />
                      <datalist id={`suggestions-${product.id}`}>
                        {allSuggestions.map(item => (
                          <option key={item.name} value={item.name}>
                            {item.display}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    {products.length > 1 && (
                      <button 
                        type="button"
                        onClick={() => removeProduct(product.id)}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button 
                  type="button"
                  onClick={addProduct}
                  className="flex items-center gap-2 text-[10px] font-semibold text-blue-500 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors uppercase tracking-wider"
                >
                  <Plus className="w-3 h-3" /> Добавить позицию
                </button>
              </div>


              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Цвет</label>
                  <input 
                    value={color}
                    onChange={e => setColor(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Фото изделия</label>
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer flex items-center gap-2 bg-zinc-50 hover:bg-zinc-100 px-3 py-2 rounded-xl transition-all text-xs font-semibold text-zinc-600">
                      <ImageIcon className="w-4 h-4" />
                      {productImage ? 'Изменить' : 'Загрузить'}
                      <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </label>
                    {productImage && (
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-zinc-200">
                        <img src={productImage} alt="Preview" className="w-full h-full object-cover" />
                        <button 
                          type="button"
                          onClick={() => setProductImage(null)}
                          className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-md"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="relative">
                    <select 
                      value={size}
                      onChange={e => setSize(e.target.value)}
                      className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none appearance-none cursor-pointer"
                    >
                      <option value="">Выберите размер</option>
                      <option>over</option>
                      <option>over 100</option>
                      <option>over 200</option>
                      <option>over xs-s</option>
                      <option>over m-l</option>
                      <option>xs</option>
                      <option>s</option>
                      <option>m</option>
                      <option>l</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                      <Plus className="w-3 h-3 rotate-45" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <select 
                      value={height}
                      onChange={e => setHeight(e.target.value)}
                      className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none appearance-none cursor-pointer"
                    >
                      <option value="">Выберите рост</option>
                      <option>160-165</option>
                      <option>170-175</option>
                      <option>180-185</option>
                      {height && !['160-165', '170-175', '180-185'].includes(height) && (
                        <option value={height}>{height}</option>
                      )}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                      <Plus className="w-3 h-3 rotate-45" />
                    </div>
                  </div>
                </div>
              </div>
          </section>

          {/* Client Info */}
          <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <span className="text-[6px] font-bold text-zinc-300 block mb-1">[YB-F-SEC-CLIENT]</span>
            <div className="flex items-center gap-2 text-emerald-500 mb-1">
              <User className="w-4 h-4" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">Данные клиента</h2>
            </div>
            
            {/* ФИО с autocomplete */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">
                ФИО {contacts.length > 0 && <span className="text-[9px] lowercase font-medium text-zinc-300">({contacts.length} клиентов)</span>}
              </label>
              <div className="relative">
                <input
                  required
                  value={clientName}
                  onChange={e => { setClientName(e.target.value); setShowClientDropdown(true); }}
                  onFocus={() => setShowClientDropdown(true)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                  placeholder="Начните вводить имя..."
                />
                {showClientDropdown && clientName.length >= 1 && (() => {
                  const matches = contacts.filter(c =>
                    (c.fullName || c.name || '').toLowerCase().includes(clientName.toLowerCase())
                  ).slice(0, 6);
                  return matches.length > 0 ? (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-100 rounded-xl shadow-xl overflow-hidden">
                      {matches.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => {
                            setClientName(c.fullName || c.name || '');
                            if (c.phone) setPhone(c.phone);
                            if (c.email) setEmail(c.email);
                            if (c.address) setAddress(c.address);
                            if (c.city) setCity(c.city);
                            if (c.insta) setSocialLink(c.insta);
                            if (c.saleSource) setSaleSource(c.saleSource);
                            setShowClientDropdown(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-emerald-50 text-left border-b border-zinc-50 last:border-0 transition-colors"
                        >
                          <span className="text-sm font-medium text-zinc-900">{c.fullName || c.name}</span>
                          <span className="text-[10px] text-zinc-400 font-mono">{c.phone ? `+${c.phone}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                />
              </div>
              {/* Телефон с autocomplete */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Телефон</label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setShowPhoneDropdown(true); }}
                    onFocus={() => setShowPhoneDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPhoneDropdown(false), 150)}
                    className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 transition-all outline-none"
                    placeholder="+7..."
                  />
                  {showPhoneDropdown && phone.length >= 3 && (() => {
                    const matches = contacts.filter(c =>
                      (c.phone || '').includes(phone.replace(/[^0-9]/g, ''))
                    ).slice(0, 5);
                    return matches.length > 0 ? (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-zinc-100 rounded-xl shadow-xl overflow-hidden">
                        {matches.map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onMouseDown={() => {
                              setPhone(c.phone || '');
                              setClientName(c.fullName || c.name || '');
                              if (c.email) setEmail(c.email);
                              if (c.address) setAddress(c.address);
                              if (c.city) setCity(c.city);
                              if (c.insta) setSocialLink(c.insta);
                              setShowPhoneDropdown(false);
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-emerald-50 text-left border-b border-zinc-50 last:border-0 transition-colors"
                          >
                            <span className="text-[10px] text-zinc-400 font-mono">+{c.phone}</span>
                            <span className="text-sm font-medium text-zinc-900">{c.fullName || c.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-orange-500 mt-2 mb-1">
              <MapPin className="w-4 h-4" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">Доставка</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Трек-номер</label>
                <input 
                  value={trackingNumber}
                  onChange={e => setTrackingNumber(e.target.value)}
                  placeholder="Введите трек-номер..."
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Стоимость логистики (₽)</label>
                <input 
                  type="number"
                  value={shippingCost}
                  onChange={e => setShippingCost(e.target.value)}
                  placeholder="0"
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Город</label>
                <input 
                  value={city}
                  autoComplete="off"
                  onChange={e => setCity(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Адрес</label>
                <input 
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none"
                />
              </div>
            </div>
          </section>

          {/* Payment Info */}
          <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <span className="text-[6px] font-bold text-zinc-300 block mb-1">[YB-F-SEC-PAY]</span>
            <div className="flex items-center gap-2 text-purple-500 mb-1">
              <CreditCard className="w-4 h-4" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">Оплата и соцсети</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Тип оплаты</label>
                <div className="relative">
                  <select 
                    value={paymentType}
                    onChange={e => setPaymentType(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option>Предоплата</option>
                    <option>Полная оплата</option>
                    <option>Оплата с примеркой</option>
                    <option>Долями</option>
                    <option>Сплитами</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <Plus className="w-3 h-3 rotate-45" />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest ml-1">Откуда пришла продажа</label>
                <div className="relative">
                  <select 
                    value={saleSource}
                    onChange={e => setSaleSource(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option>Наш клиент</option>
                    <option>Рилс</option>
                    <option>Рекомендация</option>
                    <option>Таргет</option>
                    <option>Онлайн примерка</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <Plus className="w-3 h-3 rotate-45" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Общая стоимость (₽)</label>
                <input 
                  required
                  type="number"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900 transition-all outline-none font-bold"
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1 flex justify-between">
                  Предоплата (₽)
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPrepaymentAmount((parseFloat(price)||0).toString())} className="text-[8px] bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200">100%</button>
                    <button type="button" onClick={() => setPrepaymentAmount(((parseFloat(price)||0)*0.5).toString())} className="text-[8px] bg-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-200">50%</button>
                  </div>
                </label>
                <input 
                  type="number"
                  value={prepaymentAmount}
                  onChange={e => setPrepaymentAmount(e.target.value)}
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900 transition-all outline-none font-bold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Остаток к оплате</label>
                <div className="w-full bg-white border border-slate-100 rounded-xl px-4 py-3 text-sm font-black text-slate-900 flex items-center h-[46px]">
                  {formatCurrency(Math.max(0, (parseFloat(price)||0) - (parseFloat(prepaymentAmount)||0)))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1 flex items-center justify-between">
                  Доставка (₽)
                </label>
                <input 
                  type="number"
                  value={shipping}
                  onChange={e => setShipping(e.target.value)}
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-1">Тип оплаты</label>
                <select 
                  value={paymentType}
                  onChange={e => setPaymentType(e.target.value)}
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-slate-900 transition-all outline-none cursor-pointer"
                >
                  <option>Предоплата</option>
                  <option>Полная оплата</option>
                  <option>Наложенный платеж</option>
                  <option>При получении</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Соцсети</label>
                <div className="relative">
                  <select 
                    value={socialSource}
                    onChange={e => setSocialSource(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option>Instagram</option>
                    <option>VK</option>
                    <option>Telegram</option>
                    <option>Max</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                    <Plus className="w-3 h-3 rotate-45" />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest ml-1">Ссылка на профиль</label>
                <input 
                  value={socialLink}
                  onChange={e => setSocialLink(e.target.value)}
                  className="w-full bg-zinc-50 border-none rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                />
              </div>
            </div>
          </section>

          {/* Submit Button */}
          <div className="pt-2 relative group">
            <span className="absolute -top-2 left-0 text-[5px] font-bold text-zinc-300 opacity-50 hidden group-hover:block">[YB-F-BTN-SAVE]</span>
            <button
              disabled={loading || success}
              className={cn(
                "w-full py-4 rounded-2xl font-semibold uppercase text-xs tracking-widest transition-all flex items-center justify-center gap-3 shadow-lg",
                success ? "bg-emerald-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.98]"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Отправка...
                </>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Заказ сохранен!
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Сохранить заказ
                </>
              )}
            </button>
            
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 text-sm font-medium border border-red-100"
                >
                  <AlertCircle className="w-5 h-5" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tochka Bank QR section — appears after order saved */}
            <AnimatePresence>
              {success && tochkaEnabled && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 p-5 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-4"
                >
                  <div className="flex items-center gap-2 text-violet-600">
                    <QrCode className="w-4 h-4" />
                    <span className="text-[11px] font-semibold uppercase tracking-widest">Точка Банк · QR-оплата</span>
                  </div>

                  {!qrUrl ? (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Сумма: <span className="font-bold text-zinc-900">{formatCurrency(parseFloat(price) || 0)}</span>
                      </p>
                      <button
                        type="button"
                        onClick={handleCreateQr}
                        disabled={isCreatingQr}
                        className="w-full py-3 rounded-xl bg-violet-600 text-white text-xs font-semibold uppercase tracking-widest hover:bg-violet-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      >
                        {isCreatingQr ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Создание QR...</>
                        ) : (
                          <><QrCode className="w-4 h-4" /> Создать QR-ссылку</>
                        )}
                      </button>
                      {qrError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />{qrError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-center">
                        <div className="p-3 bg-white border border-slate-200 rounded-xl inline-block">
                          <QRCodeSVG value={qrUrl} size={180} />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-zinc-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copied ? 'Скопировано!' : 'Копировать ссылку'}
                        </button>
                        <a
                          href={qrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors flex items-center justify-center gap-2"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Открыть ссылку
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={onBack}
                        className="w-full py-3 rounded-xl bg-slate-900 text-white text-xs font-semibold uppercase tracking-widest hover:bg-slate-800 transition-colors"
                      >
                        Готово · Вернуться к заказам
                      </button>
                    </div>
                  )}

                  {!qrUrl && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="w-full py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                      Пропустить и вернуться
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </form>

        <footer className="text-center pb-12">
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em]">
            YBCRM • Система управления заказами
          </p>
        </footer>
      </div>
    </div>
  );
};
