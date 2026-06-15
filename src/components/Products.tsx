import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Plus, X, Camera, Save, 
  ChevronLeft, Trash2, Calendar, 
  Layers, Ruler, Maximize2, Weight, 
  Type, Hash, Image as ImageIcon, Star,
  Download, Edit2, Palette, Calculator, Info, Link as LinkIcon, Instagram, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
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

  const productStats = useMemo(() => {
    const costTotal = products.reduce((sum, product) => sum + (Number(product.costPrice) || 0), 0);
    const priceTotal = products.reduce((sum, product) => sum + (Number(product.sellingPrice) || 0), 0);
    const withLinks = products.filter(product => product.postUrl || (product.posts || []).some(post => post.url)).length;
    return {
      count: products.length,
      costTotal,
      priceTotal,
      margin: priceTotal - costTotal,
      withLinks,
    };
  }, [products]);

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

  const recalcCostPrice = (ue: any): number => {
    const fabricTotal = (ue.fabric?.main || 0) + (ue.fabric?.lining || 0) + (ue.fabric?.padding || 0);
    const accessoriesTotal = Object.values(ue.accessories || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) as number;
    const sewingTotal = (ue.sewing || 0) + (ue.outsourcedSewing || 0);
    return fabricTotal + accessoriesTotal + sewingTotal;
  };

  const updateFabricDetail = (field: 'main' | 'lining' | 'padding', key: 'qty' | 'unit' | 'unitPrice', value: number | string) => {
    setNewProduct(prev => {
      const ue: any = { ...(prev.unitEconomics || {}) };
      const fd = { ...(ue.fabricDetails || {}) };
      fd[field] = { qty: 0, unit: 'м', unitPrice: 0, ...(fd[field] || {}), [key]: value };
      const fabric = { ...(ue.fabric || {}) };
      fabric[field] = (fd[field].qty || 0) * (fd[field].unitPrice || 0);
      ue.fabricDetails = fd;
      ue.fabric = fabric;
      return { ...prev, unitEconomics: ue, costPrice: recalcCostPrice(ue) };
    });
  };

  const updateAccessoryDetail = (field: string, key: 'qty' | 'unitPrice', value: number) => {
    setNewProduct(prev => {
      const ue: any = { ...(prev.unitEconomics || {}) };
      const ad = { ...(ue.accessoriesDetails || {}) };
      ad[field] = { qty: 0, unitPrice: 0, ...(ad[field] || {}), [key]: value };
      const accessories = { ...(ue.accessories || {}) };
      accessories[field] = (ad[field].qty || 0) * (ad[field].unitPrice || 0);
      ue.accessoriesDetails = ad;
      ue.accessories = accessories;
      return { ...prev, unitEconomics: ue, costPrice: recalcCostPrice(ue) };
    });
  };

  const updateCostField = (section: string, value: number) => {
    setNewProduct(prev => {
      const ue: any = { ...(prev.unitEconomics || {}), [section]: value };
      return { ...prev, unitEconomics: ue, costPrice: recalcCostPrice(ue) };
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
    <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-8 space-y-8 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <button 
              onClick={onBack}
              className="mt-1 rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100"
            >
              <ChevronLeft size={20} strokeWidth={1.8} />
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Продукция</h1>
              <p className="text-sm text-slate-500">Управление ассортиментом и складскими данными</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <button
              onClick={() => setIsHandbookOpen(!isHandbookOpen)}
              className={cn(
                "inline-flex h-12 items-center gap-2 rounded-xl border px-4 text-xs font-bold uppercase tracking-widest shadow-sm transition-all",
                isHandbookOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <BookOpen className="h-4 w-4" strokeWidth={1.8} /> Справочник
            </button>
            <button
              onClick={handleExportExcel}
              disabled={products.length === 0}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 text-xs font-bold uppercase tracking-widest text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
            >
              <Download className="h-4 w-4" strokeWidth={1.8} /> Экспорт
            </button>
            <button
              onClick={() => {
                setPendingProductId(Date.now().toString());
                setPhotoUploadStatus({});
                setIsAdding(true);
              }}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white shadow-lg transition-all hover:bg-slate-800 active:scale-95"
            >
              <Plus className="h-5 w-5" strokeWidth={1.9} /> Добавить товар
            </button>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="space-y-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Товаров в складе</span>
              <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
                <Package size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{productStats.count}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Активная номенклатура</p>
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Себестоимость</span>
              <div className="rounded-lg bg-red-50 p-2 text-red-500">
                <Calculator size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(productStats.costTotal)}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-500">Сумма затрат</p>
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Цена продажи</span>
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-500">
                <Star size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(productStats.priceTotal)}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">По карточкам товара</p>
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-100 border-l-4 border-l-slate-900 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Потенц. маржа</span>
              <div className="rounded-lg bg-slate-900 p-2 text-white">
                <LinkIcon size={16} />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(productStats.margin)}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{productStats.withLinks} товаров со ссылками</p>
          </div>
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
                      <select
                        value={newProduct.height}
                        onChange={(e) => setNewProduct({...newProduct, height: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      >
                        <option value="">Выберите рост...</option>
                        {['150-155', '160-165', '170-175', '180-185'].map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {newProduct.height && !['150-155', '160-165', '170-175', '180-185'].includes(newProduct.height) && (
                          <option value={newProduct.height}>{newProduct.height}</option>
                        )}
                      </select>
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

                      <div className="p-5 space-y-5">
                        {/* Ткань */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Ткань</span>
                            <span className="text-[11px] font-bold text-indigo-600">
                              {((newProduct.unitEconomics?.fabric?.main || 0) + (newProduct.unitEconomics?.fabric?.lining || 0) + (newProduct.unitEconomics?.fabric?.padding || 0)).toLocaleString()} ₽
                            </span>
                          </div>
                          {([
                            {id: 'main' as const, label: 'Основная', defaultUnit: 'м'},
                            {id: 'lining' as const, label: 'Подкладка', defaultUnit: 'м'},
                            {id: 'padding' as const, label: 'Утеплитель', defaultUnit: 'кг'},
                          ]).map(f => {
                            const det = newProduct.unitEconomics?.fabricDetails?.[f.id] || { qty: '', unit: f.defaultUnit, unitPrice: '' };
                            const total = (Number(det.qty) || 0) * (Number(det.unitPrice) || 0);
                            return (
                              <div key={f.id} className="bg-indigo-50/40 rounded-2xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-slate-600">{f.label}</span>
                                  <span className="text-[11px] font-bold text-indigo-600">{total > 0 ? `${total.toLocaleString()} ₽` : '—'}</span>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="number"
                                    placeholder="Кол-во"
                                    value={det.qty}
                                    onChange={e => updateFabricDetail(f.id, 'qty', Number(e.target.value))}
                                    className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                  />
                                  <select
                                    value={det.unit || f.defaultUnit}
                                    onChange={e => updateFabricDetail(f.id, 'unit', e.target.value)}
                                    className="w-14 px-1 py-2 bg-white border border-slate-100 rounded-xl text-xs font-bold text-slate-500 focus:outline-none transition-all text-center"
                                  >
                                    <option value="м">м</option>
                                    <option value="кг">кг</option>
                                  </select>
                                  <span className="text-slate-300 text-sm shrink-0">×</span>
                                  <input
                                    type="number"
                                    placeholder="₽/ед"
                                    value={det.unitPrice}
                                    onChange={e => updateFabricDetail(f.id, 'unitPrice', Number(e.target.value))}
                                    className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Фурнитура и нанесение */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Фурнитура и нанесение</span>
                            <span className="text-[11px] font-bold text-amber-600">
                              {(Object.values(newProduct.unitEconomics?.accessories || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) as number).toLocaleString()} ₽
                            </span>
                          </div>
                          {([
                            {id: 'lock', label: 'Замок', unit: 'шт'},
                            {id: 'application', label: 'Нанесение', unit: 'шт'},
                            {id: 'embroidery', label: 'Вышивка', unit: 'шт'},
                            {id: 'eyelets', label: 'Люверсы', unit: 'шт'},
                            {id: 'fixators', label: 'Фиксаторы', unit: 'шт'},
                            {id: 'waistElastic', label: 'Резинка пояс', unit: 'м'},
                            {id: 'hatElastic', label: 'Резинка шапка', unit: 'м'},
                            {id: 'label', label: 'Этикетка', unit: 'шт'},
                            {id: 'compositionTag', label: 'Бирка составник', unit: 'шт'},
                          ]).map(f => {
                            const det = newProduct.unitEconomics?.accessoriesDetails?.[f.id] || { qty: '', unitPrice: '' };
                            const total = (Number(det.qty) || 0) * (Number(det.unitPrice) || 0);
                            return (
                              <div key={f.id} className="bg-amber-50/40 rounded-2xl p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-slate-600">{f.label}</span>
                                  <span className="text-[11px] font-bold text-amber-600">{total > 0 ? `${total.toLocaleString()} ₽` : '—'}</span>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="number"
                                    placeholder="Кол-во"
                                    value={det.qty}
                                    onChange={e => updateAccessoryDetail(f.id, 'qty', Number(e.target.value))}
                                    className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
                                  />
                                  <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap shrink-0">{f.unit} ×</span>
                                  <input
                                    type="number"
                                    placeholder={`₽/${f.unit}`}
                                    value={det.unitPrice}
                                    onChange={e => updateAccessoryDetail(f.id, 'unitPrice', Number(e.target.value))}
                                    className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Пошив */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Пошив</span>
                            <span className="text-[11px] font-bold text-emerald-600">
                              {((newProduct.unitEconomics?.sewing || 0) + (newProduct.unitEconomics?.outsourcedSewing || 0)).toLocaleString()} ₽
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-emerald-50/40 rounded-2xl p-3 space-y-2">
                              <span className="text-[11px] font-bold text-slate-600 block">Прямой пошив</span>
                              <input
                                type="number"
                                placeholder="₽"
                                value={newProduct.unitEconomics?.sewing || ''}
                                onChange={e => updateCostField('sewing', Number(e.target.value))}
                                className="w-full px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                              />
                            </div>
                            <div className="bg-emerald-50/40 rounded-2xl p-3 space-y-2">
                              <span className="text-[11px] font-bold text-slate-600 block">Аутсорс</span>
                              <input
                                type="number"
                                placeholder="₽"
                                value={newProduct.unitEconomics?.outsourcedSewing || ''}
                                onChange={e => updateCostField('outsourcedSewing', Number(e.target.value))}
                                className="w-full px-3 py-2 bg-white border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
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
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-50 p-6">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900">Складская таблица</h3>
              <p className="mt-1 text-xs font-bold text-slate-400">Фото, характеристики, себестоимость и цена продажи</p>
            </div>
            <Download
              size={16}
              className={cn("text-slate-400", products.length > 0 ? "cursor-pointer hover:text-slate-600" : "opacity-40")}
              onClick={products.length > 0 ? handleExportExcel : undefined}
            />
          </div>
          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[1320px] table-fixed text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="w-[76px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Фото</th>
                  <th className="w-[238px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Наименование</th>
                  <th className="w-[128px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Цвет</th>
                  <th className="w-[105px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Размеры</th>
                  <th className="w-[92px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Рост</th>
                  <th className="w-[120px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Обхваты</th>
                  <th className="w-[80px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Вес</th>
                  <th className="w-[142px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Нанесение</th>
                  <th className="w-[94px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Лекало</th>
                  <th className="w-[118px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Себест.</th>
                  <th className="w-[110px] px-5 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Цена</th>
                  <th className="w-[120px] px-5 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">Действия</th>
                </tr>
              </thead>
              <tbody>
                {products.length > 0 ? (
                  products.map((product) => (
                    <motion.tr
                      key={product.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group h-[56px] border-b border-[#EEF1F5] transition-colors hover:bg-[#F9FAFB]"
                    >
                      <td className="px-5 py-2">
                        <div className="h-11 w-11 overflow-hidden rounded-[8px] border border-[#E6E9EF] bg-[#F6F7F9]">
                          <img 
                            src={product.photos[0] || 'https://picsum.photos/seed/product/400/400'} 
                            alt={product.name} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-semibold leading-5 text-[#1F2937]" title={product.name}>{product.name}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]" title={product.color || undefined}>{product.color || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]">{product.sizeGrid || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]">{product.height || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]" title={product.girths || undefined}>{product.girths || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]">{product.weight || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[14px] font-medium leading-5 text-[#6B7280]" title={product.applicationType || undefined}>{product.applicationType || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="block truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">{product.patternNumber || '—'}</span>
                      </td>
                      <td className="px-5 py-2">
                        <div className="flex flex-col">
                          <span className="text-[14px] font-semibold leading-5 text-[#F06B6B]">{product.costPrice ? `${product.costPrice.toLocaleString()} ₽` : '—'}</span>
                          {product.unitEconomics?.scenarioName && (
                            <span className="block max-w-[88px] truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]" title={product.unitEconomics.scenarioName}>
                              {product.unitEconomics.scenarioName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2">
                        <span className="text-[14px] font-semibold leading-5 text-[#2EBA7F]">{product.sellingPrice ? `${product.sellingPrice.toLocaleString()} ₽` : '—'}</span>
                      </td>
                      <td className="px-5 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => {
                              const url = `${window.location.origin}/product/${product.id}`;
                              navigator.clipboard.writeText(url);
                              alert("Ссылка на товар скопирована!");
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6B7280] transition-colors hover:bg-[#F6F7F9] hover:text-[#1F2937]"
                            title="Копировать ссылку"
                          >
                            <LinkIcon size={14} />
                          </button>
                          <button 
                            onClick={() => handleEditProduct(product)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#7D7DE6] text-white transition-colors hover:bg-[#7070D8]"
                            title="Редактировать"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(product.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#FFF1F1] text-[#F06B6B] transition-colors hover:bg-[#FFE4E4]"
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
                    <td colSpan={12} className="px-4 py-20 text-center">
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
