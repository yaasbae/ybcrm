import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { formatCurrency } from '../lib/utils';
import { CheckCircle2, AlertCircle, Loader2, ShoppingBag, ExternalLink } from 'lucide-react';

interface PaymentPageProps {
  orderId: string;
}

export const PaymentPage: React.FC<PaymentPageProps> = ({ orderId }) => {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'orders', orderId))
      .then(snap => {
        if (!snap.exists()) { setError('Заказ не найден'); return; }
        setOrder(snap.data());
      })
      .catch(() => setError('Ошибка загрузки заказа'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD]">
      <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD]">
      <div className="text-center space-y-2">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
        <p className="text-sm text-zinc-500">{error}</p>
      </div>
    </div>
  );

  if (!order) return null;

  const price = order.price || order.revenue || 0;
  const paymentUrl = order.paymentUrl;

  if (paid) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD]">
      <div className="text-center space-y-4 px-6">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-zinc-900">Оплата прошла!</h2>
        <p className="text-sm text-zinc-500">Спасибо за заказ. Мы свяжемся с вами в ближайшее время.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FBFBFD] flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">

        {/* Brand */}
        <div className="text-center">
          <p className="text-[10px] font-black text-zinc-300 uppercase tracking-[0.3em]">YB STUDIO</p>
          <h1 className="text-2xl font-black text-zinc-900 tracking-tight mt-1">Оплата заказа</h1>
          {order.orderNumber && (
            <p className="text-[11px] text-zinc-400 font-mono mt-1">#{order.orderNumber}</p>
          )}
        </div>

        {/* Order Details */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <div className="flex items-center gap-2 text-blue-500 mb-3">
              <ShoppingBag className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Состав заказа</span>
            </div>
            {order.products && (
              <p className="text-sm font-bold text-zinc-900">{order.products}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {order.color && (
                <span className="text-[10px] bg-zinc-50 border border-zinc-100 rounded-lg px-2 py-1 font-medium text-zinc-600">
                  Цвет: {order.color}
                </span>
              )}
              {order.size && (
                <span className="text-[10px] bg-zinc-50 border border-zinc-100 rounded-lg px-2 py-1 font-medium text-zinc-600">
                  Размер: {order.size}
                </span>
              )}
              {order.height && (
                <span className="text-[10px] bg-zinc-50 border border-zinc-100 rounded-lg px-2 py-1 font-medium text-zinc-600">
                  Рост: {order.height}
                </span>
              )}
            </div>
          </div>

          {/* Client */}
          {order.clientName && (
            <div className="px-5 py-3 border-b border-slate-50">
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-0.5">Клиент</p>
              <p className="text-sm font-semibold text-zinc-900">{order.clientName}</p>
              {order.phone && <p className="text-[11px] text-zinc-400 font-mono">+{order.phone}</p>}
            </div>
          )}

          {/* Price */}
          <div className="px-5 py-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">К оплате</p>
              <p className="text-2xl font-black text-zinc-900">{formatCurrency(price)}</p>
            </div>
          </div>
        </div>

        {/* QR Code */}
        {paymentUrl ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center">Сканируй QR для оплаты</p>
            <div className="flex justify-center">
              <div className="p-3 border border-slate-200 rounded-xl bg-white inline-block">
                <QRCodeSVG value={paymentUrl} size={200} />
              </div>
            </div>
            <p className="text-[10px] text-zinc-400 text-center">или нажми кнопку ниже</p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center">
            <p className="text-xs text-amber-700 font-medium">QR-ссылка для этого заказа ещё не создана</p>
          </div>
        )}

        {/* Offer Agreement */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Договор публичной оферты</p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Оплачивая данный заказ, вы подтверждаете согласие с условиями договора публичной оферты YB Studio.
            Компания обязуется изготовить и доставить заказанное изделие в соответствии с выбранными характеристиками.
            Возврат возможен только при наличии производственного брака.
          </p>
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${agreed ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300 group-hover:border-emerald-400'}`}>
              {agreed && <CheckCircle2 className="w-3 h-3 text-white" />}
            </div>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="hidden" />
            <span className="text-xs text-zinc-700 leading-relaxed">
              Я ознакомился с условиями договора публичной оферты и принимаю их
            </span>
          </label>
        </div>

        {/* Pay Button */}
        {paymentUrl && (
          <a
            href={agreed ? paymentUrl : undefined}
            onClick={e => {
              if (!agreed) { e.preventDefault(); return; }
              setTimeout(() => setPaid(true), 3000);
            }}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg ${
              agreed
                ? 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98] shadow-emerald-500/20'
                : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
            }`}
          >
            <ExternalLink className="w-4 h-4" />
            Оплатить {formatCurrency(price)}
          </a>
        )}

        <p className="text-center text-[9px] text-zinc-300 font-medium pb-6">
          YB STUDIO · Безопасная оплата через Точка Банк
        </p>
      </div>
    </div>
  );
};
