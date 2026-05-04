import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { ShoppingBag, ChevronLeft, Ruler, Palette, Info, Package } from 'lucide-react';
import { cn } from '../lib/utils';

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
  sellingPrice?: number;
}

export const PublicProductView: React.FC<{ productId: string }> = ({ productId }) => {
  const [product, setProduct] = useState<ProductItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const docRef = doc(db, 'products', productId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setProduct({ ...docSnap.data(), id: docSnap.id } as ProductItem);
        }
      } catch (error) {
        console.error("Error fetching product:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [productId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FBFBFD] p-4 text-center">
        <Package size={48} className="text-slate-200 mb-4" />
        <h1 className="text-2xl font-bold text-slate-900">Товар не найден</h1>
        <p className="text-slate-500 mt-2">Возможно, ссылка устарела или товар был удален.</p>
        <button 
          onClick={() => window.location.href = '/'}
          className="mt-6 px-8 py-3 bg-slate-900 text-white rounded-full font-bold text-sm uppercase tracking-widest"
        >
          На главную
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFBFD] font-sans text-[#1D1D1F]">
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          
          {/* Photos Section */}
          <div className="space-y-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="aspect-square rounded-[2.5rem] overflow-hidden bg-white border border-slate-100 shadow-sm"
            >
              <img 
                src={product.photos[activePhoto] || 'https://picsum.photos/seed/product/800/800'} 
                alt={product.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            
            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
              {product.photos.map((photo, index) => (
                <button
                  key={index}
                  onClick={() => setActivePhoto(index)}
                  className={cn(
                    "w-20 h-20 rounded-2xl overflow-hidden border-2 transition-all shrink-0",
                    activePhoto === index ? "border-blue-500 scale-105 shadow-md" : "border-transparent opacity-60 hover:opacity-100"
                  )}
                >
                  <img src={photo} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>

          {/* Info Section */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  {product.releaseYear} Collection
                </span>
                <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold uppercase tracking-widest">
                  ID: {product.patternNumber || product.id.substring(0, 8)}
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                {product.name}
              </h1>
              <p className="text-3xl font-bold text-blue-600">
                {product.sellingPrice?.toLocaleString()} ₽
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Palette size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Цвет</span>
                </div>
                <p className="text-sm font-bold">{product.color || '—'}</p>
              </div>
              <div className="p-5 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Ruler size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Размеры</span>
                </div>
                <p className="text-sm font-bold">{product.sizeGrid || '—'}</p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-2 text-slate-900">
                <Info size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Характеристики</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <div className="flex justify-between items-center py-2 border-b border-zinc-50">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Рост</span>
                  <span className="text-xs font-semibold">{product.height || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-50">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Вес изделия</span>
                  <span className="text-xs font-semibold">{product.weight || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-50">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Обхваты</span>
                  <span className="text-xs font-semibold">{product.girths || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-50">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Нанесение</span>
                  <span className="text-xs font-semibold">{product.applicationType || '—'}</span>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button 
                onClick={() => window.open(`https://www.instagram.com/ybcrm/`, '_blank')}
                className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-semibold text-xs uppercase tracking-widest hover:bg-zinc-800 transition-all shadow-lg flex items-center justify-center gap-3 active:scale-[0.98]"
              >
                <ShoppingBag size={18} />
                Заказать в Instagram
              </button>
              <p className="text-center text-[9px] text-zinc-400 mt-4 font-medium uppercase tracking-widest">
                Напишите нам в Директ для оформления заказа
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="py-12 border-t border-slate-100 mt-12">
        <div className="max-w-6xl mx-auto px-4 text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <div className="w-6 h-6 bg-slate-900 rounded flex items-center justify-center text-white font-bold text-[10px]">Y.</div>
            <span className="text-xs font-bold tracking-tight">YBCRM</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">
            © {new Date().getFullYear()} YBCRM BRAND. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};
