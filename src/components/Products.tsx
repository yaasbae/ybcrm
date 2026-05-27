import React, { useState, useEffect } from 'react';
import { 
  Package, Plus, X, Camera, Save, 
  ChevronLeft, Trash2, Calendar, 
  Layers, Ruler, Maximize2, Weight, 
  Type, Hash, Image as ImageIcon, Star,
  Download, Edit2, Palette, Calculator, Info, Link as LinkIcon, Instagram, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import imageCompression from 'browser-image-compression';
import { db, OperationType, handleFirestoreError, storage } from '../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { UnitEconomics } from '../types';

interface ProductItem {
  id: string;
  photos: string[];
  name: string;
  color: string;
  sizeGrid: string;
  girths: string;
  height: string;
  weight: string;
  applicationType: string;
  patternNumber: string;
  releaseYear: string;
  costPrice?: number;
  sellingPrice?: number;
  unitEconomics?: any;
  composition?: string;
  sizeDetails?: string;
  description?: string;
  countryOfOrigin?: string;
  postUrl?: string;
  posts?: { name: string; url: string }[];
}

interface ProductsProps {
  onBack: () => void;
}

export const Products: React.FC<ProductsProps> = ({ onBack }) => {
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scenarios, setScenarios] = useState<UnitEconomics[]>([]);
  const [handbookProducts, setHandbookProducts] = useState<string[]>([]);
  const [isHandbookOpen, setIsHandbookOpen] = useState(false);

  useEffect(() => {
    // Fetch handbook products from Firestore
    const unsubHandbook = onSnapshot(doc(db, 'settings', 'handbook'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.productNames) {
          setHandbookProducts(data.productNames);
        }
      } else {
        const initialProducts = [
          "Бомбер макси FLAME", "Бомбер мидл FLAME", "Бомбер мини FLAME", "Бомбер мидл Карго", "Бомбер макси Карго",
          "Джоггеры зима FLAME90x", "Джоггеры лето FLAME90x", "Олимпийка лето FLAME90x", "Костюм лето FLAME90x",
          "Костюм лето FLAME90x мини", "Олимпийка лето FLAME90x мини", "Шорты лето FLAME90x", "Костюм начес FLAME",
          "Костюм петля FLAME", "Мужской Костюм петля FLAME", "Джоггеры начес FLAME замок", "Джоггеры петля FLAME",
          "Джоггеры начес FLAME", "Джоггеры петля FLAME с кнопкой", "Худи Zip начес FLAME", "Толстовка начес FLAME1986BORN",
          "Свитшот Base мидл", "Комбез Buns mini", "Джоггеры начес Base", "Джоггеры петля Base", "Джоггеры жен Кнопка начес",
          "Джоггеры жен Кнопка петля", "Джоггеры Карго футер петля", "Джоггеры Карго футер начес", "Комплект Титс",
          "Шорты Титс", "ТолстовкаТитс", "Футболка Мидл вискоза", "Футболка Мидл кулирка", "Шорты GRID футер",
          "Топ Buster", "Топ Base вискоза", "Топ Base кулирка", "Топ+Стринги Base вискоза", "Топ+Стринги Base кулирка",
          "Стринги Base кулирка", "Лифчик Sport кулирка", "Трусы Sport кулирка", "Комлект Sport кулирка",
          "Топ Бандо СН", "Топ Бандо", "Кроп-Топ Горло СН", "Кроп-Топ Горло- Манжет", "Кроп-Топ Горло-Манжет",
          "Кроп-топ без Горло-Манжет", "Кроп-топ без Горло", "Кроп-Топ СОС", "Футболка со Сборкой", "Футболка Over Укороченая",
          "Кроп-Топ манжет модал", "Кроп-Топ Тигр", "Купальник слитный", "Майка на завзяках", "Топ КШК", "Тренч Карго",
          "Эко-Кожа Джогеры", "Юбка кожа", "Джинсы Cowl girl", "Свитер Grungenim", "Шапка Grungenim", "Мужские шорты",
          "Чиносы Мужские кнопка", "Чиносы Мужские", "Джоггеры Мужские футер начеса", "Джоггеры Мужские футер петля",
          "Лонг мужской горло 1/2 рук", "Комплект Дабл флис", "Топ Дабл флис", "Комбез лапша мини", "Комбез лапша лонг",
          "Укороченый лонг длиный рукав", "Худи карго начес", "Худи карго петля", "Худи укороч петля", "Шорты Flared",
          "Паттерн брюки", "Джоггеры Duspo", "Костюм Duspo", "Шорты Duspo", "Топ люрекс", "Брюки люрекс", "Топ Бандо велюр",
          "Комбез бархат", "Костюм петля ISIDA мини", "Толстовка Zip петля ISIDA макси", "Паттерн рубашка", "Паттерн шорты",
          "Олимпийка дюспо ISIDA мини", "Джоггеры дюспо flame", "Худи Zip петля ISIDA макси", "Duspo 2.0 Джоггеры",
          "Duspo 2.0 Олимпийка мини", "Duspo 2.0 Олимпийка макси", "Butterfly Брюки", "Butterfly Шорты", "Butterfly Рубашка",
          "Худи Zip петля ISIDA мини", "Джоггеры петля ISIDA", "Костюм петля Hope", "Джоггеры петля Hope", "Худи петля Hope мини",
          "Костюм велюр Solis", "Брюки велюр Solis", "Комбез Buns long", "Бомбер мини ISIDA", "Бомбер мидл ISIDA",
          "Костюм Tyche Canvas", "Худи Zip начес Base", "Худи Zip петля Base", "Костюм велюр ISIDA мини",
          "Костюм петля ISIDA макси", "Брюки Tyche Canvas", "Худи Zip петля FLAME", "Толстовка петля FLAME1986BORN"
        ];
        setHandbookProducts(initialProducts);
        setDoc(doc(db, 'settings', 'handbook'), { productNames: initialProducts });
      }
    });

    return () => unsubHandbook();
  }, []);

  const saveHandbook = async (newProducts: string[]) => {
    setHandbookProducts(newProducts);
    try {
      await setDoc(doc(db, 'settings', 'handbook'), { productNames: newProducts }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/handbook');
    }
  };

  useEffect(() => {
    try {
      const savedScenarios = localStorage.getItem("unit_economics_scenarios");
      if (savedScenarios) setScenarios(JSON.parse(savedScenarios));
    } catch {
      localStorage.removeItem("unit_economics_scenarios");
    }
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as ProductItem[];
      setProducts(productsData);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });

    return () => unsubscribe();
  }, []);

  type PhotoUploadStatus = 'uploading' | 'done' | 'error';
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [photoUploadStatus, setPhotoUploadStatus] = useState<Record<number, PhotoUploadStatus>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState<Partial<ProductItem>>({
    name: '',
    color: '',
    sizeGrid: '',
    girths: '',
    height: '',
    weight: '',
    applicationType: '',
    patternNumber: '',
    releaseYear: new Date().getFullYear().toString(),
    photos: [],
    costPrice: 0,
    sellingPrice: 0,
    composition: '',
    sizeDetails: '',
    description: '',
    countryOfOrigin: '',
    postUrl: '',
    posts: []
  });

  const handleAddProduct = async () => {
    if (!newProduct.name) return;

    const stillUploading = Object.values(photoUploadStatus).some(s => s === 'uploading');
    if (stillUploading) {
      setError('Подождите, фото ещё загружаются...');
      return;
    }

    setLoading(true);
    try {
      const id = pendingProductId || editingId || Date.now().toString();

      // Удаляем из Storage фото, которые убрали при редактировании
      if (editingId) {
        const oldProduct = products.find(p => p.id === editingId);
        if (oldProduct) {
          const removedPhotos = oldProduct.photos.filter(p => !newProduct.photos?.includes(p));
          await Promise.all(removedPhotos.map(async (photoUrl) => {
            const isStorageUrl = photoUrl.includes('firebasestorage.googleapis.com');
            const containsId = photoUrl.includes(id) || photoUrl.includes(encodeURIComponent(`products/${id}`));
            if (isStorageUrl && containsId) {
              try {
                await deleteObject(ref(storage, photoUrl));
              } catch (delErr) {
                console.warn('Storage cleanup info (safe to ignore if file already gone):', delErr);
              }
            }
          }));
        }
      }

      // Фото уже загружены в Storage, фильтруем возможные base64 фаллбэки
      const finalPhotos = (newProduct.photos || []).filter(p => !p.startsWith('data:image'));

      const productData = {
        id,
        photos: finalPhotos.length > 0 ? finalPhotos : ['https://picsum.photos/seed/product/400/400'],
        name: newProduct.name || '',
        color: newProduct.color || '',
        sizeGrid: newProduct.sizeGrid || '',
        girths: newProduct.girths || '',
        height: newProduct.height || '',
        weight: newProduct.weight || '',
        applicationType: newProduct.applicationType || '',
        patternNumber: newProduct.patternNumber || '',
        releaseYear: newProduct.releaseYear || '',
        costPrice: Number(newProduct.costPrice) || 0,
        sellingPrice: Number(newProduct.sellingPrice) || 0,
        unitEconomics: newProduct.unitEconomics || null,
        composition: newProduct.composition || '',
        sizeDetails: newProduct.sizeDetails || '',
        description: newProduct.description || '',
        countryOfOrigin: newProduct.countryOfOrigin || '',
        postUrl: newProduct.postUrl || '',
        posts: newProduct.posts || []
      };

      await setDoc(doc(db, 'products', id), productData);

      setIsAdding(false);
      setEditingId(null);
      setPendingProductId(null);
      setPhotoUploadStatus({});
      setNewProduct({
        name: '',
        color: '',
        sizeGrid: '',
        girths: '',
        height: '',
        weight: '',
        applicationType: '',
        patternNumber: '',
        releaseYear: new Date().getFullYear().toString(),
        photos: [],
        costPrice: 0,
        sellingPrice: 0,
        composition: '',
        sizeDetails: '',
        description: '',
        countryOfOrigin: '',
        postUrl: '',
        posts: []
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'products');
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    try {
      const headers = [
        'Наименование', 'Цвет', 'Размерная сетка', 'Обхваты', 'Рост', 
        'Вес', 'Вид нанесения', 'Номер лекала', 'Год выпуска',
        'Состав', 'Описание размеров', 'Описание товара', 'Страна'
      ];
      
      const rows = products.map(p => [
        p.name, p.color, p.sizeGrid, p.girths, p.height,
        p.weight, p.applicationType, p.patternNumber, p.releaseYear,
        p.composition, p.sizeDetails, p.description, p.countryOfOrigin
      ].map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(','));

      const csvContent = [headers.join(','), ...rows].join('\n');
      
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `products_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  const handleEditProduct = (product: ProductItem) => {
    setNewProduct({
      ...product,
      posts: product.posts || []
    });
    setEditingId(product.id);
    setPendingProductId(product.id);
    setPhotoUploadStatus({});
    setIsAdding(true);
  };

  const updateCostField = (section: string, field: string, value: number) => {
    setNewProduct(prev => {
      const ue: any = { ...(prev.unitEconomics || {}) };
      if (field === '') {
        ue[section] = value;
      } else {
        ue[section] = { ...(ue[section] || {}), [field]: value };
      }
      const fabricTotal = (ue.fabric?.main || 0) + (ue.fabric?.lining || 0) + (ue.fabric?.padding || 0);
      const accessoriesTotal = Object.values(ue.accessories || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) as number;
      const sewingTotal = (ue.sewing || 0) + (ue.outsourcedSewing || 0);
      return { ...prev, unitEconomics: ue, costPrice: fabricTotal + accessoriesTotal + sewingTotal };
    });
  };

  const applyScenario = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (scenario) {
      // Calculate total materials cost
      const fabricCost = (scenario.fabric?.main || 0) + (scenario.fabric?.lining || 0) + (scenario.fabric?.padding || 0);
      const accessoriesCost = Object.values(scenario.accessories || {}).reduce((a, b) => a + b, 0);
      const packagingCost = Object.values(scenario.packagingDetails || {}).reduce((a, b) => a + b, 0);
      
      const totalCost = fabricCost + accessoriesCost + packagingCost + (scenario.sewing || 0) + (scenario.outsourcedSewing || 0);

      setNewProduct(prev => ({
        ...prev,
        costPrice: totalCost,
        sellingPrice: scenario.sellingPrice,
        unitEconomics: {
          fabric: scenario.fabric,
          accessories: scenario.accessories,
          packagingDetails: scenario.packagingDetails,
          sewing: scenario.sewing,
          outsourcedSewing: scenario.outsourcedSewing,
          scenarioName: scenario.name,
          scenarioId: scenario.id
        }
      }));
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите удалить этот товар и все его данные, включая фото?')) return;
    
    try {
      // 1. Delete all photos from storage
      const storageRef = ref(storage, `products/${id}`);
      try {
        const result = await listAll(storageRef);
        await Promise.all(result.items.map(item => deleteObject(item)));
      } catch (storageErr) {
        console.warn('Storage cleanup failed or folder empty:', storageErr);
      }

      // 2. Delete document from Firestore
      await deleteDoc(doc(db, 'products', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `products/${id}`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !pendingProductId) return;

    const currentPhotos = newProduct.photos || [];
    const remainingSlots = 5 - currentPhotos.length;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    let currentIndex = currentPhotos.length;

    for (const file of filesToProcess) {
      const thisIndex = currentIndex++;
      try {
        const options = {
          maxSizeMB: 2.0,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          initialQuality: 0.85,
          fileType: 'image/jpeg' as const
        };

        const compressedFile = await imageCompression(file, options);

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result as string;

          // Немедленно показываем превью из base64
          setNewProduct(prev => ({
            ...prev,
            photos: [...(prev.photos || []), base64].slice(0, 5)
          }));
          setPhotoUploadStatus(prev => ({ ...prev, [thisIndex]: 'uploading' }));

          // Фоновая загрузка в Firebase Storage
          try {
            const blob = await fetch(base64).then(r => r.blob());
            const storageRef = ref(storage, `products/${pendingProductId}/photo_${thisIndex}_${Date.now()}.jpg`);
            await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
            const url = await getDownloadURL(storageRef);

            // Заменяем base64 на Storage URL
            setNewProduct(prev => {
              const photos = [...(prev.photos || [])];
              const idx = photos.indexOf(base64);
              if (idx !== -1) photos[idx] = url;
              return { ...prev, photos };
            });
            setPhotoUploadStatus(prev => ({ ...prev, [thisIndex]: 'done' }));
          } catch (uploadErr) {
            console.error('Background upload error:', uploadErr);
            setPhotoUploadStatus(prev => ({ ...prev, [thisIndex]: 'error' }));
          }
        };
        reader.readAsDataURL(compressedFile);
      } catch (err) {
        console.error('Compression error:', err);
        setError(`Ошибка при обработке файла ${file.name}`);
      }
    }
  };

  const removePhoto = (index: number) => {
    const url = (newProduct.photos || [])[index];
    if (url?.includes('firebasestorage.googleapis.com')) {
      deleteObject(ref(storage, url)).catch(() => {});
    }
    setNewProduct(prev => ({
      ...prev,
      photos: (prev.photos || []).filter((_, i) => i !== index)
    }));
    setPhotoUploadStatus(prev => {
      const updated: Record<number, PhotoUploadStatus> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const n = Number(k);
        if (n < index) updated[n] = v;
        else if (n > index) updated[n - 1] = v;
      });
      return updated;
    });
  };

  const handleCancelForm = () => {
    // Для новых товаров — удалить загруженные фото из Storage в фоне
    if (!editingId && pendingProductId) {
      const uploaded = (newProduct.photos || []).filter(p =>
        p.includes('firebasestorage.googleapis.com') && p.includes(pendingProductId)
      );
      uploaded.forEach(url => deleteObject(ref(storage, url)).catch(() => {}));
    }
    setIsAdding(false);
    setEditingId(null);
    setPendingProductId(null);
    setPhotoUploadStatus({});
    setNewProduct({
      name: '',
      color: '',
      sizeGrid: '',
      girths: '',
      height: '',
      weight: '',
      applicationType: '',
      patternNumber: '',
      releaseYear: new Date().getFullYear().toString(),
      photos: [],
      costPrice: 0,
      sellingPrice: 0,
      composition: '',
      sizeDetails: '',
      description: '',
      countryOfOrigin: '',
      postUrl: '',
      posts: []
    });
  };

  return (
    <div className="min-h-screen bg-[#FBFBFD] text-[#1D1D1F] font-sans">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors font-medium"
          >
            <ChevronLeft size={20} />
            <span>Назад</span>
          </button>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setIsHandbookOpen(!isHandbookOpen)}
              className={cn(
                "px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 border shadow-sm transition-all",
                isHandbookOpen ? "bg-zinc-800 text-white border-transparent" : "bg-white text-slate-600 border-slate-100 hover:bg-slate-50"
              )}
            >
              <BookOpen className="w-4 h-4" /> Справочник
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleExportExcel}
              disabled={products.length === 0}
              className="bg-white text-slate-600 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 border border-slate-100 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Экспорт
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setPendingProductId(Date.now().toString());
                setPhotoUploadStatus({});
                setIsAdding(true);
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-blue-200"
            >
              <Plus className="w-4 h-4" /> Добавить товар
            </motion.button>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">Продукция</h1>
          <p className="text-xl text-slate-500 font-medium">Управление ассортиментом и складскими данными</p>
        </div>

        {/* Handbook Section */}
        <AnimatePresence>
          {isHandbookOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-500 rounded-2xl shadow-lg shadow-blue-500/20">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.2em] leading-none mb-1.5">Номенклатура изделий</h3>
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Управляйте списком для быстрого выбора</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsHandbookOpen(false)}
                    className="p-2 hover:bg-slate-50 rounded-xl transition-colors text-slate-300"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Plus size={14} className="text-emerald-500" /> Добавить в справочник
                    </label>
                    <input 
                      type="text"
                      placeholder="Введите название и нажмите Enter..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value) {
                          const newVal = e.currentTarget.value;
                          if (!handbookProducts.includes(newVal)) {
                            saveHandbook([newVal, ...handbookProducts]);
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                      className="w-full px-5 py-4 bg-zinc-50 border border-zinc-100 rounded-2xl text-sm font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all placeholder:text-zinc-300"
                    />
                  </div>

                  <div className="space-y-4">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Edit2 size={14} className="text-blue-500" /> Список наименований ({handbookProducts.length})
                    </label>
                    <div className="max-h-[300px] overflow-y-auto pr-3 space-y-2 scrollbar-thin scrollbar-thumb-zinc-200">
                      {handbookProducts.map((p, idx) => (
                        <div key={idx} className="group flex items-center gap-3 bg-zinc-50/50 hover:bg-zinc-50 p-3 rounded-2xl border border-zinc-100 transition-all">
                          <div className="w-6 h-6 flex items-center justify-center bg-white rounded-lg text-[10px] font-black text-zinc-300 group-hover:text-blue-500 border border-zinc-100 transition-colors">
                            {idx + 1}
                          </div>
                          <input 
                            type="text"
                            value={p}
                            onChange={(e) => {
                              const newProducts = [...handbookProducts];
                              newProducts[idx] = e.target.value;
                              setHandbookProducts(newProducts);
                            }}
                            onBlur={() => saveHandbook(handbookProducts)}
                            className="flex-1 bg-transparent text-[13px] font-bold text-zinc-700 focus:text-zinc-900 outline-none"
                          />
                          <button 
                            onClick={() => saveHandbook(handbookProducts.filter((_, i) => i !== idx))}
                            className="p-2 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-white rounded-xl shadow-sm"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      {handbookProducts.length === 0 && (
                        <div className="text-center py-12 bg-zinc-50/50 rounded-3xl border border-dashed border-zinc-200">
                           <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Справочник пуст</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 text-red-600">
                <X size={18} className="shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add Product Form Modal */}
        <AnimatePresence>
          {isAdding && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                      <Package size={20} />
                    </div>
                    <h2 className="text-xl font-semibold">{editingId ? 'Редактировать товар' : 'Новый товар'}</h2>
                  </div>
                  <button
                    onClick={handleCancelForm}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-8 overflow-y-auto space-y-8">
                  {/* Photo Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Фото товара (до 5 шт)</label>
                      <span className="text-[10px] font-bold text-slate-400">{(newProduct.photos || []).length} / 5</span>
                    </div>
                    
                    <div className="flex flex-wrap gap-4">
                      {(newProduct.photos || []).map((photo, index) => {
                        const status = photoUploadStatus[index];
                        return (
                          <div key={index} className="w-24 h-24 bg-slate-100 rounded-2xl relative overflow-hidden group">
                            <img
                              src={photo}
                              alt={`Preview ${index}`}
                              className={cn("w-full h-full object-cover transition-opacity", status === 'uploading' ? "opacity-50" : "opacity-100")}
                              referrerPolicy="no-referrer"
                            />
                            {status === 'uploading' && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              </div>
                            )}
                            {status === 'error' && (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                                <X size={14} className="text-red-500" />
                              </div>
                            )}
                            <button
                              onClick={() => removePhoto(index)}
                              className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                      
                      {(newProduct.photos || []).length < 5 && (
                        <div className="w-24 h-24 bg-slate-100 rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-slate-200 relative overflow-hidden group hover:border-blue-400 transition-colors">
                          <Camera className="text-slate-300" size={24} />
                          <span className="text-[8px] font-bold text-slate-400 uppercase mt-1">Добавить</span>
                          <input 
                            type="file" 
                            accept="image/*"
                            multiple
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={handleFileChange}
                          />
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">Добавьте фото по одному или выберите несколько сразу.</p>
                      <input 
                        type="text" 
                        placeholder="Вставить ссылку на фото (URL)"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value;
                            if (val && (newProduct.photos || []).length < 5) {
                              setNewProduct(prev => ({
                                ...prev,
                                photos: [...(prev.photos || []), val]
                              }));
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Main Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Type size={14} /> Наименование
                      </label>
                      <input 
                        type="text" 
                        list="handbook-list"
                        placeholder="Напр: Худи Oversize"
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold"
                      />
                      <datalist id="handbook-list">
                        {handbookProducts.map(p => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Maximize2 size={14} /> Описание размеров
                      </label>
                      <input 
                        type="text" 
                        placeholder="Ширина 60, Высота 75"
                        value={newProduct.sizeDetails}
                        onChange={(e) => setNewProduct({...newProduct, sizeDetails: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Palette size={14} /> Цвет
                      </label>
                      <input 
                        type="text" 
                        placeholder="Черный / Белый"
                        value={newProduct.color}
                        onChange={(e) => setNewProduct({...newProduct, color: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={14} /> Состав
                      </label>
                      <input 
                        type="text" 
                        placeholder="100% хлопок"
                        value={newProduct.composition}
                        onChange={(e) => setNewProduct({...newProduct, composition: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Maximize2 size={14} /> Страна
                      </label>
                      <input 
                        type="text" 
                        placeholder="Россия / Турция"
                        value={newProduct.countryOfOrigin}
                        onChange={(e) => setNewProduct({...newProduct, countryOfOrigin: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-4 md:col-span-2 border-t border-slate-100 pt-6 mt-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <Instagram size={14} className="text-pink-500" /> Ссылки по цветам (Multi-posts)
                        </label>
                        <button 
                          onClick={() => {
                            setNewProduct(prev => ({
                              ...prev,
                              posts: [...(prev.posts || []), { name: '', url: '' }]
                            }));
                          }}
                          className="text-[10px] font-bold text-blue-600 uppercase tracking-wider hover:text-blue-700 underline"
                        >
                          + Добавить вариант
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        {(newProduct.posts || []).map((post, index) => (
                          <div key={index} className="flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="flex-1 space-y-2">
                              <input 
                                type="text" 
                                placeholder="Название (напр: Чёрный Isida)"
                                value={post.name}
                                onChange={(e) => {
                                  const updatedPosts = [...(newProduct.posts || [])];
                                  updatedPosts[index].name = e.target.value;
                                  setNewProduct({ ...newProduct, posts: updatedPosts });
                                }}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              />
                              <input 
                                type="text" 
                                placeholder="URL ссылки на пост"
                                value={post.url}
                                onChange={(e) => {
                                  const updatedPosts = [...(newProduct.posts || [])];
                                  updatedPosts[index].url = e.target.value;
                                  setNewProduct({ ...newProduct, posts: updatedPosts });
                                }}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              />
                            </div>
                            <button 
                              onClick={() => {
                                const updatedPosts = (newProduct.posts || []).filter((_, i) => i !== index);
                                setNewProduct({ ...newProduct, posts: updatedPosts });
                              }}
                              className="p-2 mt-1 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                        {(newProduct.posts || []).length === 0 && (
                          <p className="text-xs text-slate-400 italic">Нажмите «Добавить вариант», если хотите указать ссылки на посты для разных цветов товара.</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Instagram size={14} className="text-pink-500" /> Основная ссылка (Все_фото)
                      </label>
                      <input 
                        type="text" 
                        placeholder="https://www.instagram.com/p/..."
                        value={newProduct.postUrl}
                        onChange={(e) => setNewProduct({...newProduct, postUrl: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Info size={14} /> Описание товара
                      </label>
                      <textarea 
                        rows={3}
                        placeholder="Опишите преимущества товара..."
                        value={newProduct.description}
                        onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={14} /> Размерная сетка
                      </label>
                      <input 
                        type="text" 
                        placeholder="S, M, L, XL"
                        value={newProduct.sizeGrid}
                        onChange={(e) => setNewProduct({...newProduct, sizeGrid: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Maximize2 size={14} /> Обхваты
                      </label>
                      <input 
                        type="text" 
                        placeholder="Грудь 120, Талия 110"
                        value={newProduct.girths}
                        onChange={(e) => setNewProduct({...newProduct, girths: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Ruler size={14} /> Рост
                      </label>
                      <input 
                        type="text" 
                        placeholder="170-185 см"
                        value={newProduct.height}
                        onChange={(e) => setNewProduct({...newProduct, height: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Weight size={14} /> Вес
                      </label>
                      <input 
                        type="text" 
                        placeholder="850 гр"
                        value={newProduct.weight}
                        onChange={(e) => setNewProduct({...newProduct, weight: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Star size={14} /> Вид нанесения
                      </label>
                      <input 
                        type="text" 
                        placeholder="Шелкография / Вышивка"
                        value={newProduct.applicationType}
                        onChange={(e) => setNewProduct({...newProduct, applicationType: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Hash size={14} /> Номер лекала
                      </label>
                      <input 
                        type="text" 
                        placeholder="L-2024-05"
                        value={newProduct.patternNumber}
                        onChange={(e) => setNewProduct({...newProduct, patternNumber: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Calendar size={14} /> Год выпуска
                      </label>
                      <input 
                        type="text" 
                        placeholder="2024"
                        value={newProduct.releaseYear}
                        onChange={(e) => setNewProduct({...newProduct, releaseYear: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Calculator size={14} /> Сценарий юнит-экономики
                      </label>
                      <select 
                        value={newProduct.unitEconomics?.scenarioId || ''}
                        onChange={(e) => applyScenario(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      >
                        <option value="">Выберите сценарий...</option>
                        {scenarios.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {newProduct.unitEconomics?.scenarioName && (
                        <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider px-1">
                          Применен сценарий: {newProduct.unitEconomics.scenarioName}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Star size={14} className="text-rose-500" /> Себестоимость (₽)
                      </label>
                      <input 
                        type="number" 
                        placeholder="0"
                        value={Number.isNaN(newProduct.costPrice) || newProduct.costPrice === undefined || newProduct.costPrice === null ? "" : newProduct.costPrice}
                        onChange={(e) => setNewProduct({...newProduct, costPrice: Number(e.target.value)})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-rose-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Star size={14} className="text-emerald-500" /> Цена продажи (₽)
                      </label>
                      <input 
                        type="number" 
                        placeholder="0"
                        value={Number.isNaN(newProduct.sellingPrice) || newProduct.sellingPrice === undefined || newProduct.sellingPrice === null ? "" : newProduct.sellingPrice}
                        onChange={(e) => setNewProduct({...newProduct, sellingPrice: Number(e.target.value)})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-emerald-600"
                      />
                    </div>

                    {/* Cost Breakdown Block */}
                    <div className="md:col-span-2 rounded-[2rem] border border-slate-100 overflow-hidden">
                      {/* Header */}
                      <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Calculator size={15} className="text-blue-500" />
                          <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">Расчёт себестоимости</span>
                        </div>
                        <span className="text-sm font-black text-rose-600">
                          Итого: {(newProduct.costPrice || 0).toLocaleString()} ₽
                        </span>
                      </div>

                      <div className="p-6 space-y-6">
                        {/* Ткань */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Ткань</span>
                            <span className="text-[11px] font-bold text-indigo-600">
                              {((newProduct.unitEconomics?.fabric?.main || 0) + (newProduct.unitEconomics?.fabric?.lining || 0) + (newProduct.unitEconomics?.fabric?.padding || 0)).toLocaleString()} ₽
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {([{id: 'main', label: 'Основная'}, {id: 'lining', label: 'Подкладка'}, {id: 'padding', label: 'Утеплитель'}] as const).map(f => (
                              <div key={f.id} className="space-y-1">
                                <label className="text-[9px] font-bold text-slate-400 uppercase">{f.label}</label>
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={newProduct.unitEconomics?.fabric?.[f.id] || ''}
                                  onChange={e => updateCostField('fabric', f.id, Number(e.target.value))}
                                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Фурнитура и нанесение */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Фурнитура и нанесение</span>
                            <span className="text-[11px] font-bold text-amber-600">
                              {(Object.values(newProduct.unitEconomics?.accessories || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) as number).toLocaleString()} ₽
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {([
                              {id: 'lock', label: 'Замок'},
                              {id: 'application', label: 'Нанесение'},
                              {id: 'embroidery', label: 'Вышивка'},
                              {id: 'eyelets', label: 'Люверсы'},
                              {id: 'fixators', label: 'Фиксаторы'},
                              {id: 'waistElastic', label: 'Резинка пояс'},
                              {id: 'hatElastic', label: 'Резинка шапка'},
                            ] as const).map(f => (
                              <div key={f.id} className="space-y-1">
                                <label className="text-[9px] font-bold text-slate-400 uppercase">{f.label}</label>
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={newProduct.unitEconomics?.accessories?.[f.id] || ''}
                                  onChange={e => updateCostField('accessories', f.id, Number(e.target.value))}
                                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-300 transition-all"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Пошив */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Пошив</span>
                            <span className="text-[11px] font-bold text-emerald-600">
                              {((newProduct.unitEconomics?.sewing || 0) + (newProduct.unitEconomics?.outsourcedSewing || 0)).toLocaleString()} ₽
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Прямой пошив</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={newProduct.unitEconomics?.sewing || ''}
                                onChange={e => updateCostField('sewing', '', Number(e.target.value))}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Аутсорс</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={newProduct.unitEconomics?.outsourcedSewing || ''}
                                onChange={e => updateCostField('outsourcedSewing', '', Number(e.target.value))}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex gap-3">
                  <button
                    onClick={handleCancelForm}
                    className="flex-1 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    Отмена
                  </button>
                  {(() => {
                    const hasUploadingPhotos = Object.values(photoUploadStatus).some(s => s === 'uploading');
                    return (
                      <button
                        onClick={handleAddProduct}
                        disabled={!newProduct.name || hasUploadingPhotos}
                        className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:shadow-none"
                      >
                        {hasUploadingPhotos ? 'Загрузка фото...' : editingId ? 'Обновить товар' : 'Сохранить товар'}
                      </button>
                    );
                  })()}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Products List - Responsive View */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-16">Фото</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Наименование</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Цвет</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Размеры</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Рост</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Обхваты</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Вес</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Нанесение</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Лекало</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Себест.</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Цена</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {products.length > 0 ? (
                  products.map((product) => (
                    <motion.tr
                      key={product.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors group h-[40px]"
                    >
                      <td className="px-4 py-1">
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                          <img 
                            src={product.photos[0] || 'https://picsum.photos/seed/product/400/400'} 
                            alt={product.name} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-sm font-semibold text-slate-900 truncate block max-w-[150px]">{product.name}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium">{product.color || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium">{product.sizeGrid || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium">{product.height || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium truncate block max-w-[100px]">{product.girths || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium">{product.weight || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs text-slate-500 font-medium">{product.applicationType || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{product.patternNumber || '—'}</span>
                      </td>
                      <td className="px-4 py-1">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-rose-500">{product.costPrice ? `${product.costPrice.toLocaleString()} ₽` : '—'}</span>
                          {product.unitEconomics?.scenarioName && (
                            <span className="text-[8px] text-slate-400 uppercase font-bold truncate max-w-[80px]" title={product.unitEconomics.scenarioName}>
                              {product.unitEconomics.scenarioName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-1">
                        <span className="text-xs font-bold text-emerald-600">{product.sellingPrice ? `${product.sellingPrice.toLocaleString()} ₽` : '—'}</span>
                      </td>
                      <td className="px-4 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button 
                            onClick={() => {
                              const url = `${window.location.origin}/product/${product.id}`;
                              navigator.clipboard.writeText(url);
                              alert("Ссылка на товар скопирована!");
                            }}
                            className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"
                            title="Копировать ссылку"
                          >
                            <LinkIcon size={14} />
                          </button>
                          <button 
                            onClick={() => handleEditProduct(product)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Редактировать"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="text-slate-200" size={32} />
                        <p className="text-slate-400 text-sm font-medium">Список товаров пуст</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden divide-y divide-slate-50">
            {products.length > 0 ? (
              products.map((product) => (
                <div key={product.id} className="p-4 space-y-4">
                  <div className="flex gap-4">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 shrink-0">
                      <img 
                        src={product.photos[0] || 'https://picsum.photos/seed/product/400/400'} 
                        alt={product.name} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-slate-900 truncate">{product.name}</h3>
                        <div className="flex gap-1">
                          <button 
                            onClick={() => {
                              const url = `${window.location.origin}/product/${product.id}`;
                              navigator.clipboard.writeText(url);
                              alert("Ссылка на товар скопирована!");
                            }}
                            className="p-2 text-slate-400 bg-slate-50 rounded-xl"
                          >
                            <LinkIcon size={14} />
                          </button>
                          <button 
                            onClick={() => handleEditProduct(product)}
                            className="p-2 text-blue-500 bg-blue-50 rounded-xl"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-2 text-red-500 bg-red-50 rounded-xl"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                        {product.patternNumber || 'Без лекала'} • {product.releaseYear}
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Цвет</span>
                      <span className="text-xs font-medium text-slate-700">{product.color || '—'}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Размеры</span>
                      <span className="text-xs font-medium text-slate-700">{product.sizeGrid || '—'}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Рост</span>
                      <span className="text-xs font-medium text-slate-700">{product.height || '—'}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Вес</span>
                      <span className="text-xs font-medium text-slate-700">{product.weight || '—'}</span>
                    </div>
                    <div className="bg-rose-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-rose-400 uppercase block mb-0.5">Себест.</span>
                      <span className="text-xs font-bold text-rose-600">{product.costPrice ? `${product.costPrice.toLocaleString()} ₽` : '—'}</span>
                      {product.unitEconomics?.scenarioName && (
                        <span className="text-[8px] text-rose-400 font-bold uppercase block mt-0.5 truncate">{product.unitEconomics.scenarioName}</span>
                      )}
                    </div>
                    <div className="bg-emerald-50 p-2 rounded-xl">
                      <span className="text-[9px] font-bold text-emerald-400 uppercase block mb-0.5">Цена</span>
                      <span className="text-xs font-bold text-emerald-600">{product.sellingPrice ? `${product.sellingPrice.toLocaleString()} ₽` : '—'}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-20 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Package className="text-slate-200" size={32} />
                  <p className="text-slate-400 text-sm font-medium">Список товаров пуст</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
