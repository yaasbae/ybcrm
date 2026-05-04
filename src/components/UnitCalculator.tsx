import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Edit2,
  Plus,
  TrendingUp, 
  DollarSign, 
  Package, 
  ShoppingBag,
  PieChart as PieChartIcon,
  ChevronRight,
  Calculator as CalcIcon,
  RotateCcw,
  Copy,
  Check,
  Link as LinkIcon,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  X
} from "lucide-react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid,
  Legend
} from "recharts";
import { UnitEconomics } from "../types";
import { INITIAL_DATA } from "../constants";
import { calculateUnitEconomics } from "../lib/calculations";
import { formatCurrency, formatPercent, cn } from "../lib/utils";
import { Input, Label, Card, CardHeader, CardTitle, CardContent } from "./ui/Base";
import { db, OperationType, handleFirestoreError } from '../firebase';
import { collection, onSnapshot, doc, setDoc, query, orderBy } from 'firebase/firestore';

const COLORS = ["#141414", "#4a4a4a", "#8e9299", "#d1d1d1", "#f5f5f5", "#333333"];
const STORAGE_KEY = "unit_economics_data";

interface UnitCalculatorProps {
  onNavigateToAnalytics?: (sheetId: string) => void;
  onBack?: () => void;
}

export default function UnitCalculator({ onNavigateToAnalytics, onBack }: UnitCalculatorProps) {
  const [appProducts, setAppProducts] = useState<any[]>([]);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [applyingToProductId, setApplyingToProductId] = useState<string>("");

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      }));
      setAppProducts(productsData);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });

    return () => unsubscribe();
  }, []);

  const [products, setProducts] = useState<UnitEconomics[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : INITIAL_DATA;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return INITIAL_DATA;
    }
  });
  const [selectedId, setSelectedId] = useState<string>(products[0]?.id || INITIAL_DATA[0].id);
  const [scenarios, setScenarios] = useState<UnitEconomics[]>(() => {
    try {
      const saved = localStorage.getItem("unit_economics_scenarios");
      return saved ? JSON.parse(saved) : [];
    } catch {
      localStorage.removeItem("unit_economics_scenarios");
      return [];
    }
  });
  const [copied, setCopied] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({
    fabric: false,
    accessories: false,
    packaging: false,
    fixedCosts: false,
    adsMetrics: false,
    percents: false,
    summary: true
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  }, [products]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId) || products[0],
    [products, selectedId]
  );

  const results = useMemo(
    () => calculateUnitEconomics(selectedProduct),
    [selectedProduct]
  );

  const updateProduct = (id: string, updates: Partial<UnitEconomics>) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  };

  const updateNestedField = (block: string, field: string, value: number) => {
    const updatedBlock = { 
      ...(selectedProduct[block as keyof UnitEconomics] as any || {}), 
      [field]: value 
    };
    updateProduct(selectedId, { [block]: updatedBlock });
  };

  const getBlockTotal = (block: string) => {
    const data = selectedProduct[block as keyof UnitEconomics];
    if (!data || typeof data !== 'object') return 0;
    return Object.values(data).reduce((acc: number, val: any) => acc + (typeof val === 'number' ? val : 0), 0);
  };

  const getPercentagesTotal = () => {
    const sumPercents = selectedProduct.managerPercent + 
                        selectedProduct.acquiringPercent + 
                        selectedProduct.advertisingPercent + 
                        selectedProduct.salesTaxPercent + 
                        selectedProduct.loanPercent;
    return (selectedProduct.sellingPrice * sumPercents) / 100;
  };

  const toggleBlock = (block: string) => {
    setExpandedBlocks(prev => ({ ...prev, [block]: !prev[block] }));
  };

  const resetData = () => {
    setProducts(INITIAL_DATA);
    setSelectedId(INITIAL_DATA[0].id);
    setIsResetModalOpen(false);
  };

  const saveScenario = () => {
    if (newScenarioName.trim()) {
      setScenarios(prev => {
        let updated;
        const existingIndex = prev.findIndex(s => s.id === selectedProduct.sourceScenarioId);
        
        if (existingIndex !== -1) {
          // Update existing scenario
          updated = [...prev];
          updated[existingIndex] = { 
            ...selectedProduct, 
            id: prev[existingIndex].id, // Keep the original scenario ID
            name: newScenarioName.trim() 
          };
        } else {
          // Create new scenario
          const newScenario = { 
            ...selectedProduct, 
            id: Date.now().toString(), 
            name: newScenarioName.trim(),
            sourceScenarioId: undefined // New scenario doesn't have a source yet
          };
          updated = [...prev, newScenario];
        }
        
        localStorage.setItem("unit_economics_scenarios", JSON.stringify(updated));
        return updated;
      });
      setIsSaveModalOpen(false);
      setNewScenarioName("");
    }
  };

  const loadScenario = (scenario: UnitEconomics) => {
    const newProduct = { 
      ...scenario, 
      id: Date.now().toString(), 
      sourceScenarioId: scenario.id // Track which scenario this came from
    };
    setProducts(prev => [...prev, newProduct]);
    setSelectedId(newProduct.id);
  };

  const deleteScenario = (id: string) => {
    setScenarios(prev => {
      const updated = prev.filter(s => s.id !== id);
      localStorage.setItem("unit_economics_scenarios", JSON.stringify(updated));
      return updated;
    });
  };

  const updateScenarioField = (id: string, field: string, value: any) => {
    setScenarios(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, [field]: value } : s);
      localStorage.setItem("unit_economics_scenarios", JSON.stringify(updated));
      return updated;
    });
  };

  const applyToProduct = async () => {
    if (!applyingToProductId) return;
    
    const product = appProducts.find(p => p.id === applyingToProductId);
    if (!product) return;

    try {
      const updatedProduct = {
        ...product,
        costPrice: results.totalCostsPerItem,
        sellingPrice: selectedProduct.sellingPrice,
        unitEconomics: selectedProduct
      };

      await setDoc(doc(db, 'products', applyingToProductId), updatedProduct);
      setIsApplyModalOpen(false);
      setApplyingToProductId("");
      alert(`Данные успешно применены к товару "${product.name}"`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `products/${applyingToProductId}`);
    }
  };

  const copyResults = () => {
    const text = `
Сценарий: ${selectedProduct.name}
Цена: ${formatCurrency(selectedProduct.sellingPrice)}
Прибыль/ед: ${formatCurrency(results.profitPerItem)}
Маржа: ${formatPercent(results.netProfitMargin)}
Общая прибыль: ${formatCurrency(results.plannedProfit)}
    `.trim();
    
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chartData = [
    { name: "Материалы", value: results.effectiveMaterialsCost },
    { name: "Пошив", value: selectedProduct.sewing + selectedProduct.outsourcedSewing },
    { name: "Упаковка", value: results.effectivePackagingCost },
    { name: "Реклама (за продажу)", value: selectedProduct.adsMetrics?.costPerSale || 0 },
    { name: "Сборы и налоги", value: results.managerCost + results.acquiringCost + results.advertisingCost + results.salesTaxCost + results.loanCost },
    { name: "Постоянные затраты", value: selectedProduct.plannedQuantity > 0 ? (selectedProduct.productionCosts + results.totalMonthlyFixedCosts) / selectedProduct.plannedQuantity : 0 },
  ].filter(d => d.value > 0);

  const breakEvenQuantity = useMemo(() => {
    const variableCostsPerItem = results.effectiveMaterialsCost + 
                                selectedProduct.sewing + 
                                selectedProduct.outsourcedSewing + 
                                results.effectivePackagingCost + 
                                (selectedProduct.sellingPrice * (selectedProduct.managerPercent + selectedProduct.acquiringPercent + selectedProduct.advertisingPercent + selectedProduct.salesTaxPercent + selectedProduct.loanPercent) / 100);
    
    const contributionMargin = selectedProduct.sellingPrice - variableCostsPerItem;
    const totalFixed = selectedProduct.productionCosts + results.totalMonthlyFixedCosts;
    return contributionMargin > 0 ? Math.ceil(totalFixed / contributionMargin) : Infinity;
  }, [selectedProduct, results.totalMonthlyFixedCosts]);

  const sensitivityData = useMemo(() => {
    const basePrice = selectedProduct.sellingPrice;
    const steps = [-20, -10, 0, 10, 20];
    return steps.map(step => {
      const price = basePrice * (1 + step / 100);
      const res = calculateUnitEconomics({ ...selectedProduct, sellingPrice: price });
      return {
        name: `${step > 0 ? '+' : ''}${step}%`,
        price: price,
        profit: res.profitPerItem,
      };
    });
  }, [selectedProduct]);

  return (
    <div className="min-h-screen bg-[#FBFBFD] text-[#1D1D1F] font-sans selection:bg-blue-100 p-4 md:py-6 md:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {onBack && (
              <button 
                onClick={onBack}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <ArrowLeft className="w-6 h-6 text-slate-500" />
              </button>
            )}
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Юнит-экономика</h1>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Расчет прибыльности изделий</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setIsResetModalOpen(true)}
              className="flex items-center gap-2 bg-white border border-slate-200 text-[#141414] px-3 py-1.5 rounded-full font-semibold uppercase text-[9px] tracking-tight hover:bg-slate-50 transition-colors"
            >
              <RotateCcw size={12} /> Сброс
            </button>
            <button
              onClick={() => {
                setNewScenarioName(selectedProduct.name);
                setIsSaveModalOpen(true);
              }}
              className="flex items-center gap-2 bg-slate-900 text-white px-3 py-1.5 rounded-full font-semibold uppercase text-[9px] tracking-tight hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Check size={12} /> Сохранить сценарий
            </button>
            <button
              onClick={() => setIsApplyModalOpen(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-full font-semibold uppercase text-[9px] tracking-tight hover:bg-blue-700 transition-colors shadow-sm"
            >
              <LinkIcon size={12} /> Применить к товару
            </button>
          </div>
        </div>

        {/* Key Metrics Dashboard */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-white border-none shadow-sm p-4 flex flex-col justify-between h-24">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">Прибыль / ед</span>
              <DollarSign size={14} className="text-blue-500" />
            </div>
            <div>
              <span className="text-xl font-semibold tracking-tighter text-slate-900 block">
                {formatCurrency(results.profitPerItem)}
              </span>
              <span className={cn(
                "text-[9px] font-semibold px-2 py-0.5 rounded-full",
                results.netProfitMargin > 20 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              )}>
                {formatPercent(results.netProfitMargin)} маржа
              </span>
            </div>
          </Card>

          <Card className="bg-white border-none shadow-sm p-4 flex flex-col justify-between h-24">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">Точка безубыточности</span>
              <RotateCcw size={14} className="text-rose-500" />
            </div>
            <div>
              <span className="text-xl font-semibold tracking-tighter text-slate-900 block">
                {breakEvenQuantity === Infinity ? "—" : `${breakEvenQuantity} шт`}
              </span>
              <span className="text-[9px] font-semibold text-slate-500">
                в месяц (план: {selectedProduct.plannedQuantity})
              </span>
            </div>
          </Card>

          <Card className="bg-white border-none shadow-sm p-4 flex flex-col justify-between h-24">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium uppercase tracking-widest text-slate-400">Max на 1 продажу</span>
              <TrendingUp size={14} className="text-purple-500" />
            </div>
            <div>
              <span className="text-xl font-semibold tracking-tighter text-slate-900 block">
                {formatCurrency(results.maxAdCostPerSale)}
              </span>
              <span className="text-[9px] font-semibold text-slate-500">
                лимит рекламы
              </span>
            </div>
          </Card>

          <Card className="bg-slate-900 text-white border-none shadow-sm p-4 flex flex-col justify-between h-24">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-medium uppercase tracking-widest opacity-50">План. прибыль / мес</span>
              <ShoppingBag size={14} className="text-blue-400" />
            </div>
            <div>
              <span className="text-xl font-semibold tracking-tighter text-white block">
                {formatCurrency(results.plannedProfit)}
              </span>
              <span className="text-[9px] font-semibold text-blue-400">
                {formatCurrency(results.plannedRevenue)} выручка
              </span>
            </div>
          </Card>
        </div>

        <main className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Editor Section */}
            <div className="lg:col-span-8 space-y-6">
              {/* 1. Основные данные */}
              <Card className="border-none shadow-sm">
                  <CardHeader className="border-b border-slate-50 pb-3">
                    <div className="flex items-center gap-2 text-slate-900">
                      <CalcIcon size={16} className="text-blue-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Основные данные</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-[9px] uppercase text-slate-400 font-semibold tracking-wider">Название изделия</Label>
                      <div className="relative">
                        <select
                          value={selectedProduct.name}
                          onChange={(e) => updateProduct(selectedId, { name: e.target.value })}
                          className="w-full bg-slate-50 border-none rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500/20 appearance-none cursor-pointer"
                        >
                          <option value="">Выберите из списка...</option>
                          {appProducts.map((p: any) => (
                            <option key={p.id} value={p.name}>
                              {p.name} {p.color ? `(${p.color})` : ''}
                            </option>
                          ))}
                          {!appProducts.some(p => p.name === selectedProduct.name) && selectedProduct.name && (
                            <option value={selectedProduct.name}>{selectedProduct.name}</option>
                          )}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                          <ChevronDown size={14} />
                        </div>
                      </div>
                      <Input
                        placeholder="Или введите вручную..."
                        value={selectedProduct.name}
                        onChange={(e) => updateProduct(selectedId, { name: e.target.value })}
                        className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20 mt-2"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Цена продажи (₽)</Label>
                      <Input
                        type="number"
                        value={Number.isNaN(selectedProduct.sellingPrice) || selectedProduct.sellingPrice === undefined || selectedProduct.sellingPrice === null ? "" : selectedProduct.sellingPrice}
                        onChange={(e) => updateProduct(selectedId, { sellingPrice: Number(e.target.value) })}
                        className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Материалы (₽)</Label>
                        <Input
                          type="number"
                          value={Number.isNaN(selectedProduct.costOfMaterials) || selectedProduct.costOfMaterials === undefined || selectedProduct.costOfMaterials === null ? "" : selectedProduct.costOfMaterials}
                          onChange={(e) => updateProduct(selectedId, { costOfMaterials: Number(e.target.value) })}
                          className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Упаковка (₽)</Label>
                        <Input
                          type="number"
                          value={Number.isNaN(selectedProduct.packaging) || selectedProduct.packaging === undefined || selectedProduct.packaging === null ? "" : selectedProduct.packaging}
                          onChange={(e) => updateProduct(selectedId, { packaging: Number(e.target.value) })}
                          className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Фикс. произв. (₽)</Label>
                        <Input
                          type="number"
                          value={Number.isNaN(selectedProduct.productionCosts) || selectedProduct.productionCosts === undefined || selectedProduct.productionCosts === null ? "" : selectedProduct.productionCosts}
                          onChange={(e) => updateProduct(selectedId, { productionCosts: Number(e.target.value) })}
                          className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Пошив (внутр)</Label>
                        <Input
                          type="number"
                          value={Number.isNaN(selectedProduct.sewing) || selectedProduct.sewing === undefined || selectedProduct.sewing === null ? "" : selectedProduct.sewing}
                          onChange={(e) => updateProduct(selectedId, { sewing: Number(e.target.value) })}
                          className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Пошив (найм)</Label>
                        <Input
                          type="number"
                          value={Number.isNaN(selectedProduct.outsourcedSewing) || selectedProduct.outsourcedSewing === undefined || selectedProduct.outsourcedSewing === null ? "" : selectedProduct.outsourcedSewing}
                          onChange={(e) => updateProduct(selectedId, { outsourcedSewing: Number(e.target.value) })}
                          className="bg-slate-50 border-none focus:ring-1 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 2. Ткань */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('fabric')}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50"
                  >
                    <div className="flex items-center gap-2 text-zinc-900">
                      <Package size={14} className="text-indigo-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Ткань</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-[8px] uppercase text-zinc-400 font-semibold">Итого</p>
                        <p className="text-[10px] font-semibold text-indigo-600">{formatCurrency(getBlockTotal('fabric'))}</p>
                      </div>
                      {expandedBlocks.fabric ? <ChevronUp size={12} className="text-zinc-300" /> : <ChevronDown size={12} className="text-zinc-300" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.fabric && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-3 pb-3 space-y-2">
                          {[
                            { id: 'main', label: 'Основная' },
                            { id: 'lining', label: 'Подклад' },
                            { id: 'padding', label: 'Синтепон' }
                          ].map(field => (
                            <div key={field.id} className="flex items-center justify-between gap-4">
                              <Label className="text-[9px] uppercase text-zinc-500 font-semibold">{field.label}</Label>
                              <Input 
                                type="number"
                                value={Number.isNaN(selectedProduct.fabric?.[field.id as keyof typeof selectedProduct.fabric]) ? "" : selectedProduct.fabric?.[field.id as keyof typeof selectedProduct.fabric] ?? ""}
                                onChange={e => updateNestedField('fabric', field.id, Number(e.target.value))}
                                className="w-20 h-7 text-[11px] bg-zinc-50 border-none"
                              />
                            </div>
                          ))}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 3. Фурнитура */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('accessories')}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50"
                  >
                    <div className="flex items-center gap-2 text-zinc-900">
                      <Plus size={14} className="text-amber-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Фурнитура</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-[8px] uppercase text-zinc-400 font-semibold">Итого</p>
                        <p className="text-[10px] font-semibold text-amber-600">{formatCurrency(getBlockTotal('accessories'))}</p>
                      </div>
                      {expandedBlocks.accessories ? <ChevronUp size={12} className="text-zinc-300" /> : <ChevronDown size={12} className="text-zinc-300" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.accessories && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-3 pb-3 space-y-2">
                          {[
                            { id: 'lock', label: 'Замок' },
                            { id: 'eyelets', label: 'Люверсы' },
                            { id: 'fixators', label: 'Фиксаторы' },
                            { id: 'application', label: 'Нанесение' },
                            { id: 'waistElastic', label: 'Резинка пояс' },
                            { id: 'embroidery', label: 'Вышивка' },
                            { id: 'hatElastic', label: 'Резинка шляпная' }
                          ].map(field => (
                            <div key={field.id} className="flex items-center justify-between gap-4">
                              <Label className="text-[9px] uppercase text-zinc-500 font-semibold">{field.label}</Label>
                              <Input 
                                type="number"
                                value={Number.isNaN(selectedProduct.accessories?.[field.id as keyof typeof selectedProduct.accessories]) ? "" : selectedProduct.accessories?.[field.id as keyof typeof selectedProduct.accessories] ?? ""}
                                onChange={e => updateNestedField('accessories', field.id, Number(e.target.value))}
                                className="w-20 h-7 text-[11px] bg-zinc-50 border-none"
                              />
                            </div>
                          ))}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 4. Упаковка */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('packaging')}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50"
                  >
                    <div className="flex items-center gap-2 text-zinc-900">
                      <ShoppingBag size={14} className="text-emerald-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Упаковка</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-[8px] uppercase text-zinc-400 font-semibold">Итого</p>
                        <p className="text-[10px] font-semibold text-emerald-600">{formatCurrency(getBlockTotal('packagingDetails'))}</p>
                      </div>
                      {expandedBlocks.packaging ? <ChevronUp size={12} className="text-zinc-300" /> : <ChevronDown size={12} className="text-zinc-300" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.packaging && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-3 pb-3 space-y-2">
                          {[
                            { id: 'postcard', label: 'Открытка' },
                            { id: 'label', label: 'Этикетка' },
                            { id: 'box', label: 'Коробка' },
                            { id: 'case', label: 'Чехол' },
                            { id: 'sticker', label: 'Наклейка' },
                            { id: 'smallSticker', label: 'Стикер' },
                            { id: 'shuber', label: 'Шубер' },
                            { id: 'zipBag', label: 'Пакет зип' }
                          ].map(field => (
                            <div key={field.id} className="flex items-center justify-between gap-4">
                              <Label className="text-[9px] uppercase text-zinc-500 font-semibold">{field.label}</Label>
                              <Input 
                                type="number"
                                value={Number.isNaN(selectedProduct.packagingDetails?.[field.id as keyof typeof selectedProduct.packagingDetails]) ? "" : selectedProduct.packagingDetails?.[field.id as keyof typeof selectedProduct.packagingDetails] || ""}
                                onChange={e => updateNestedField('packagingDetails', field.id, Number(e.target.value))}
                                className="w-20 h-7 text-[11px] bg-zinc-50 border-none"
                              />
                            </div>
                          ))}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 5. Проценты */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('percents')}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50"
                  >
                    <div className="flex items-center gap-2 text-zinc-900">
                      <TrendingUp size={14} className="text-purple-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Проценты</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-[8px] uppercase text-zinc-400 font-semibold">Итого</p>
                        <p className="text-[10px] font-semibold text-purple-600">{formatCurrency(getPercentagesTotal())}</p>
                      </div>
                      {expandedBlocks.percents ? <ChevronUp size={12} className="text-zinc-300" /> : <ChevronDown size={12} className="text-zinc-300" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.percents && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-3 pb-3 space-y-2">
                          {[
                            { id: 'managerPercent', label: '% менеджера' },
                            { id: 'acquiringPercent', label: '% Эквайринг' },
                            { id: 'advertisingPercent', label: '% Реклама' },
                            { id: 'salesTaxPercent', label: '% Налоги' },
                            { id: 'loanPercent', label: '% Кредит' }
                          ].map(field => (
                            <div key={field.id} className="flex items-center justify-between gap-4">
                              <Label className="text-[9px] uppercase text-zinc-500 font-semibold">{field.label}</Label>
                              <Input 
                                type="number"
                                step="0.1"
                                value={Number.isNaN(selectedProduct[field.id as keyof UnitEconomics] as number) || selectedProduct[field.id as keyof UnitEconomics] as number === undefined || selectedProduct[field.id as keyof UnitEconomics] as number === null ? "" : selectedProduct[field.id as keyof UnitEconomics] as number}
                                onChange={e => updateProduct(selectedId, { [field.id]: Number(e.target.value) })}
                                className="w-20 h-7 text-[11px] bg-zinc-50 border-none"
                              />
                            </div>
                          ))}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 6. Постоянные затраты (в месяц) */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('fixedCosts')}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 transition-colors border-b border-slate-50"
                  >
                    <div className="flex items-center gap-2 text-zinc-900">
                      <RotateCcw size={14} className="text-rose-500" />
                      <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Постоянные затраты (мес)</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-[8px] uppercase text-zinc-400 font-semibold">Итого</p>
                        <p className="text-[10px] font-semibold text-rose-600">{formatCurrency(getBlockTotal('fixedCosts'))}</p>
                      </div>
                      {expandedBlocks.fixedCosts ? <ChevronUp size={12} className="text-zinc-300" /> : <ChevronDown size={12} className="text-zinc-300" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.fixedCosts && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-3 pb-3 space-y-2">
                          {[
                            { id: 'salary', label: 'ЗП' },
                            { id: 'rent', label: 'Аренда' },
                            { id: 'internet', label: 'Интернет' },
                            { id: 'water', label: 'Вода' },
                            { id: 'other', label: 'Прочее' }
                          ].map(field => (
                            <div key={field.id} className="flex items-center justify-between gap-4">
                              <Label className="text-[9px] uppercase text-zinc-500 font-semibold">{field.label}</Label>
                              <Input 
                                type="number"
                                value={Number.isNaN(selectedProduct.fixedCosts?.[field.id as keyof typeof selectedProduct.fixedCosts]) ? "" : selectedProduct.fixedCosts?.[field.id as keyof typeof selectedProduct.fixedCosts] || ""}
                                onChange={e => updateNestedField('fixedCosts', field.id, Number(e.target.value))}
                                className="w-20 h-7 text-[11px] bg-zinc-50 border-none"
                              />
                            </div>
                          ))}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 7. Реклама и охваты */}
                <Card className="border-none shadow-sm overflow-hidden">
                  <button 
                    onClick={() => toggleBlock('adsMetrics')}
                    className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors border-b border-slate-50"
                  >
                    <div className="flex items-center gap-2 text-slate-900">
                      <LinkIcon size={18} className="text-sky-500" />
                      <CardTitle className="text-xs font-bold uppercase tracking-widest">Реклама и охваты</CardTitle>
                    </div>
                    <div className="flex items-center gap-3">
                      {expandedBlocks.adsMetrics ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.adsMetrics && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-6 space-y-3">
                          <div className="flex items-center justify-between gap-4">
                            <Label className="text-[10px] uppercase text-slate-500 font-medium">План продаж (мес)</Label>
                            <Input 
                              type="number"
                              value={Number.isNaN(selectedProduct.plannedQuantity) || selectedProduct.plannedQuantity === undefined || selectedProduct.plannedQuantity === null ? "" : selectedProduct.plannedQuantity}
                              onChange={(e) => updateProduct(selectedId, { plannedQuantity: Number(e.target.value) })}
                              className="w-24 h-8 text-xs bg-slate-50 border-none"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <Label className="text-[10px] uppercase text-slate-500 font-medium">Стоимость 1 продажи</Label>
                            <Input 
                              type="number"
                              value={Number.isNaN(selectedProduct.adsMetrics?.costPerSale) ? "" : selectedProduct.adsMetrics?.costPerSale || ""}
                              onChange={e => updateNestedField('adsMetrics', 'costPerSale', Number(e.target.value))}
                              className="w-24 h-8 text-xs bg-slate-50 border-none"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <Label className="text-[10px] uppercase text-slate-500 font-medium">Просмотры в Инсте (мес)</Label>
                            <Input 
                              type="number"
                              value={Number.isNaN(selectedProduct.adsMetrics?.views) ? "" : selectedProduct.adsMetrics?.views || ""}
                              onChange={e => updateNestedField('adsMetrics', 'views', Number(e.target.value))}
                              className="w-24 h-8 text-xs bg-slate-50 border-none"
                            />
                          </div>
                          {selectedProduct.adsMetrics?.views && selectedProduct.plannedQuantity > 0 && (
                            <div className="pt-2 border-t border-slate-50">
                              <p className="text-[9px] uppercase text-slate-400 font-bold">Конверсия в продажу</p>
                              <p className="text-xs font-mono font-bold">
                                {((selectedProduct.plannedQuantity / selectedProduct.adsMetrics.views) * 100).toFixed(3)}%
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>

                {/* 8. Итоговая сводка по блокам */}
                <Card className="border-none shadow-sm overflow-hidden bg-slate-900 text-white">
                  <button 
                    onClick={() => toggleBlock('summary')}
                    className="w-full flex items-center justify-between p-6 hover:bg-slate-800 transition-colors border-b border-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <PieChartIcon size={18} className="text-blue-400" />
                      <CardTitle className="text-xs font-bold uppercase tracking-widest">Сводка по затратам</CardTitle>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[9px] uppercase text-slate-400 font-bold">Себестоимость</p>
                        <p className="text-xs font-bold text-blue-400">{formatCurrency(results.totalCostsPerItem)}</p>
                      </div>
                      {expandedBlocks.summary ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expandedBlocks.summary && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CardContent className="pt-6 space-y-4">
                          <div className="space-y-2">
                            <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                              <span>Категория</span>
                              <span>Сумма</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Ткань</span>
                                <span className="text-xs font-mono">{formatCurrency(getBlockTotal('fabric'))}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Фурнитура</span>
                                <span className="text-xs font-mono">{formatCurrency(getBlockTotal('accessories'))}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Упаковка</span>
                                <span className="text-xs font-mono">{formatCurrency(getBlockTotal('packagingDetails'))}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Пошив</span>
                                <span className="text-xs font-mono">{formatCurrency(selectedProduct.sewing + selectedProduct.outsourcedSewing)}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">% менеджера</span>
                                <span className="text-xs font-mono">{formatCurrency(results.managerCost)}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Налоги и эквайринг</span>
                                <span className="text-xs font-mono">{formatCurrency(results.acquiringCost + results.advertisingCost + results.salesTaxCost + results.loanCost)}</span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800">
                                <span className="text-xs text-slate-300">Реклама (за ед)</span>
                                <span className="text-xs font-mono">{formatCurrency(selectedProduct.adsMetrics?.costPerSale || 0)}</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-xs text-slate-300">Фикс. затраты (на ед)</span>
                                <span className="text-xs font-mono">{formatCurrency((selectedProduct.productionCosts + results.totalMonthlyFixedCosts) / (selectedProduct.plannedQuantity || 1))}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
            </div>
          </div>

            {/* Results Section */}
            <div className="lg:col-span-4 space-y-6">
              <Card className="border-none shadow-sm">
                <CardHeader className="border-b border-zinc-50 py-3">
                  <div className="flex items-center gap-2">
                    <PieChartIcon size={14} className="text-zinc-400" />
                    <CardTitle className="text-[10px] font-semibold uppercase tracking-widest">Структура затрат</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-3 pb-3">
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-6 space-y-2">
                    {chartData.map((entry, index) => {
                      const percentage = (entry.value / results.totalCostsPerItem) * 100;
                      return (
                        <div key={entry.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-2 h-2 rounded-full" 
                              style={{ backgroundColor: COLORS[index % COLORS.length] }} 
                            />
                            <span className="text-[10px] text-slate-500 font-medium">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-slate-400">{formatCurrency(entry.value)}</span>
                            <span className="text-[10px] font-bold text-slate-900 w-8 text-right">{percentage.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-blue-50/50 border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Точка безубыточности (в месяц)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black tracking-tighter text-blue-700">
                      {breakEvenQuantity === Infinity ? "—" : breakEvenQuantity}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-blue-600/60 font-bold">единиц</span>
                  </div>
                  <p className="text-[9px] mt-2 text-blue-600/60 leading-relaxed uppercase font-medium">
                    Нужно продать в месяц для покрытия всех фикс. затрат ({formatCurrency(selectedProduct.productionCosts + results.totalMonthlyFixedCosts)})
                  </p>
                </CardContent>
              </Card>

              {/* Annual Summary */}
              <Card className="border-none shadow-sm bg-emerald-50/50">
                <CardHeader className="border-b border-emerald-100/50 pb-4">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <CalcIcon size={16} />
                    <CardTitle className="text-[10px] font-bold uppercase tracking-widest">Годовая сводка</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[9px] uppercase tracking-widest opacity-50 font-bold block mb-1">Выручка в год</span>
                      <span className="text-lg font-bold tracking-tight text-emerald-800">
                        {formatCurrency(results.annualRevenue)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-widest opacity-50 font-bold block mb-1">Продаж в год</span>
                      <span className="text-lg font-bold tracking-tight text-emerald-800">
                        {selectedProduct.plannedQuantity * 12} шт
                      </span>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-emerald-100/50">
                    <div className="flex justify-between items-end">
                      <div>
                        <span className="text-[9px] uppercase tracking-widest opacity-50 font-bold block mb-1">Валовая прибыль (год)</span>
                        <span className="text-xl font-black tracking-tighter text-emerald-900">
                          {formatCurrency(results.annualGrossProfit)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-emerald-100/50">
                    <div className="flex justify-between items-end">
                      <div>
                        <span className="text-[9px] uppercase tracking-widest opacity-50 font-bold block mb-1">Чистая прибыль (год)</span>
                        <span className="text-2xl font-black tracking-tighter text-emerald-600">
                          {formatCurrency(results.annualNetProfit)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-none shadow-sm">
              <CardHeader className="border-b border-slate-50">
                <div className="flex items-center gap-2">
                  <TrendingUp size={18} className="text-slate-400" />
                  <CardTitle className="text-[10px] font-bold uppercase tracking-widest">Чувствительность цены</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="h-[250px] pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sensitivityData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} tickFormatter={(v) => `${v/1000}к`} />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value)}
                      cursor={{ fill: '#f5f5f5' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                      {sensitivityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.profit > 0 ? '#141414' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-center mt-4 opacity-40 uppercase tracking-widest">Граница прибыльности: черные столбцы — выгодно, красные — убыток</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-50 border-none shadow-sm">
              <CardHeader>
                <CardTitle className="uppercase tracking-widest text-[10px] opacity-60 font-mono">Стратегический анализ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-white rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold uppercase mb-1">Рентабельность</h4>
                  <p className="text-xs opacity-70 leading-relaxed">
                    {results.netProfitMargin > 50 
                      ? "Отличная маржа. У вас есть значительный запас для маркетинговых расходов или ценовой конкуренции."
                      : results.netProfitMargin > 20
                      ? "Хорошая маржа. Сосредоточьтесь на оптимизации объема производства для увеличения общей прибыли."
                      : "Низкая маржа. Рассмотрите возможность снижения затрат на материалы или повышения цены для улучшения устойчивости бизнеса."}
                  </p>
                </div>
                <div className="p-4 bg-white rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold uppercase mb-1">Влияние фикс. затрат</h4>
                  <p className="text-xs opacity-70 leading-relaxed">
                    {selectedProduct.productionCosts > 0 
                      ? `Постоянные затраты добавляют ${formatCurrency(selectedProduct.productionCosts / selectedProduct.plannedQuantity)} к себестоимости каждой единицы. Увеличение объема до ${selectedProduct.plannedQuantity * 2} ед. снизит эту нагрузку до ${formatCurrency(selectedProduct.productionCosts / (selectedProduct.plannedQuantity * 2))}.`
                      : "Постоянные производственные затраты не заданы. Ваша прибыльность полностью зависит от маржи на единицу товара."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Saved Scenarios at the bottom */}
          {scenarios.length > 0 && (
            <Card className="border-none shadow-sm overflow-hidden">
              <CardHeader className="border-b border-slate-50 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-900">
                    <Package size={18} className="text-amber-500" />
                    <CardTitle className="text-xs font-bold uppercase tracking-widest">Сравнение сценариев (Итоговые показатели)</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="text-[10px] uppercase text-slate-400 font-bold border-b border-slate-50 bg-slate-50/30">
                        <th className="py-4 px-6">Название (клик для загрузки)</th>
                        <th className="py-4 px-4">Цена (₽)</th>
                        <th className="py-4 px-4">Себест. (₽)</th>
                        <th className="py-4 px-4">Прибыль/ед (₽)</th>
                        <th className="py-4 px-4">Маржа (%)</th>
                        <th className="py-4 px-4">Прибыль/мес (₽)</th>
                        <th className="py-4 px-6 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario) => {
                        const res = calculateUnitEconomics(scenario);
                        return (
                          <tr key={scenario.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                            <td className="py-3 px-6">
                              <button 
                                onClick={() => loadScenario(scenario)}
                                className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors text-left flex items-center gap-2"
                              >
                                <RefreshCw size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                {scenario.name}
                              </button>
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-600">{formatCurrency(scenario.sellingPrice)}</td>
                            <td className="py-3 px-4 text-sm text-slate-600">{formatCurrency(res.totalCostsPerItem)}</td>
                            <td className="py-3 px-4 text-sm font-bold text-slate-900">{formatCurrency(res.profitPerItem)}</td>
                            <td className="py-3 px-4 text-sm font-bold text-emerald-600">{res.netProfitMargin.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-sm font-bold text-blue-600">{formatCurrency(res.annualNetProfit / 12)}</td>
                            <td className="py-3 px-6 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button 
                                  onClick={() => {
                                    const newName = prompt("Введите новое название сценария:", scenario.name);
                                    if (newName && newName.trim()) {
                                      updateScenarioField(scenario.id, 'name', newName.trim());
                                    }
                                  }}
                                  className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-xl transition-colors"
                                  title="Переименовать"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => deleteScenario(scenario.id)}
                                  className="p-2 hover:bg-rose-50 text-rose-600 rounded-xl transition-colors"
                                  title="Удалить"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        <footer className="mt-16 pt-8 border-t border-slate-200 flex flex-col md:flex-row justify-between gap-4 opacity-40 text-[10px] uppercase tracking-[0.2em] font-mono">
          <span>© 2026 Система расчета юнит-экономики</span>
          <div className="flex gap-8">
            <span>Хранение данных: Локальное хранилище активно</span>
            <span>Алгоритм: Линейное распределение затрат</span>
          </div>
        </footer>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {isSaveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold tracking-tight">Сохранить сценарий</h3>
                  <button 
                    onClick={() => setIsSaveModalOpen(false)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-widest">Название сценария</Label>
                    <Input
                      autoFocus
                      value={newScenarioName}
                      onChange={(e) => setNewScenarioName(e.target.value)}
                      placeholder="Например: Оптимизация пошива"
                      className="bg-slate-50 border-none h-12 text-base"
                      onKeyDown={(e) => e.key === 'Enter' && saveScenario()}
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => setIsSaveModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={saveScenario}
                      disabled={!newScenarioName.trim()}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {scenarios.some(s => s.id === selectedProduct.sourceScenarioId) ? "Обновить" : "Сохранить"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isResetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8">
                <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center mb-6">
                  <AlertCircle className="text-rose-600" size={24} />
                </div>
                <h3 className="text-xl font-bold tracking-tight mb-2">Сбросить данные?</h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">
                  Все текущие изменения будут удалены и заменены значениями по умолчанию. Это действие нельзя отменить.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsResetModalOpen(false)}
                    className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={resetData}
                    className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                  >
                    Сбросить
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isApplyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold tracking-tight">Применить к товару</h3>
                  <button 
                    onClick={() => setIsApplyModalOpen(false)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">
                  Выберите товар из каталога, чтобы обновить его себестоимость и цену продажи на основе текущего расчета.
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase text-slate-400 font-bold tracking-widest">Выберите товар</Label>
                    <select
                      value={applyingToProductId}
                      onChange={(e) => setApplyingToProductId(e.target.value)}
                      className="w-full bg-slate-50 border-none h-12 rounded-xl px-4 text-base focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer"
                    >
                      <option value="">Выберите из списка...</option>
                      {appProducts.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.color ? `(${p.color})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => setIsApplyModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={applyToProduct}
                      disabled={!applyingToProductId}
                      className="flex-1 px-6 py-3 rounded-2xl font-bold uppercase text-[10px] tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg shadow-blue-100"
                    >
                      Применить
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

