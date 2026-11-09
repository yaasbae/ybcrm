import React, { useEffect, useState } from 'react';
import {lengthLabels, type ProductLength} from '../lib/productFacets';
import { productSale, type SaleBadgeColor } from '../lib/productSale';
import { formatMoneyInput, parseMoneyInput } from '../lib/moneyInput';
export type CatalogFields={modelName?:string;productLength?:ProductLength;oldPrice?:number;discountAmount?:number;saleBadgeText?:string;saleBadgeColor?:SaleBadgeColor;isNew?:boolean;storefrontCategory?:string;sellingPrice?:number};
function MoneyInput({ value, onChange, className, invalid, placeholder }: { value?: number; onChange: (value: number) => void; className: string; invalid?: boolean; placeholder: string }) {
 const [draft,setDraft]=useState(()=>formatMoneyInput(value));
 useEffect(()=>setDraft(formatMoneyInput(value)),[value]);
 const commit=()=>{const parsed=parseMoneyInput(draft);if(parsed===null){onChange(0);setDraft('');return;}if(Number.isFinite(parsed)){onChange(parsed);setDraft(formatMoneyInput(parsed));}};
 return <input className={className} type="text" inputMode="decimal" aria-invalid={invalid} placeholder={placeholder} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();e.currentTarget.blur();}}}/>;
}
export function ProductCatalogFields({value,onChange}:{value:CatalogFields;onChange:(patch:Partial<CatalogFields>)=>void}){
 const oldPriceInvalid=Boolean(value.oldPrice)&&(!Number.isFinite(value.oldPrice)||Number(value.oldPrice)<=Number(value.sellingPrice||0)||Number(value.oldPrice)>1e9);
 const discount=Number(value.discountAmount||0);
 const discountInvalid=discount<0||!Number.isFinite(discount)||discount>=Number(value.sellingPrice||0)&&discount>0||discount>1e9;
 const sale=productSale(Number(value.sellingPrice||0),discount,value.saleBadgeText,value.saleBadgeColor);
 const input='mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300';
 return <fieldset className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4"><legend className="px-1 text-sm font-semibold text-slate-800">Публикация товара на сайте</legend><p className="text-xs leading-5 text-slate-500">Это настройки сайта для этой корневой карточки склада. В разделе «Магазин» они показываются без редактирования.</p><div className="grid min-w-0 gap-4 sm:grid-cols-2">
 <label className="min-w-0 text-xs text-slate-600">Категория на сайте<input className={input} maxLength={100} placeholder="Например, костюмы" value={value.storefrontCategory||''} onChange={e=>onChange({storefrontCategory:e.target.value})}/></label>
 <label className="min-w-0 text-xs text-slate-600">Модель<input className={input} maxLength={120} placeholder="Например, ISIDA" value={value.modelName||''} onChange={e=>onChange({modelName:e.target.value})}/></label>
 <label className="min-w-0 text-xs text-slate-600">Длина<select className={input} value={value.productLength||''} onChange={e=>onChange({productLength:e.target.value as ProductLength})}><option value="">Не указана</option>{Object.entries(lengthLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label className="min-w-0 text-xs text-slate-600">Цена до скидки, ₽<MoneyInput className={input} invalid={oldPriceInvalid} placeholder="Например, 19 900" value={value.oldPrice} onChange={oldPrice=>onChange({oldPrice})}/><span className="mt-1 block text-[11px] leading-4 text-slate-500">Можно вводить 19 900 или 19.900. Старая цена должна быть выше текущей.</span>{oldPriceInvalid&&<span role="alert" className="mt-1 block text-xs text-red-700">Проверьте старую цену: она должна быть выше текущей и не больше 1 млрд ₽.</span>}</label>
 <label className="min-w-0 text-xs text-slate-600">Скидка, ₽<MoneyInput className={input} invalid={discountInvalid} placeholder="Например, 4 000" value={value.discountAmount} onChange={discountAmount=>onChange({discountAmount})}/>{discountInvalid&&<span role="alert" className="mt-1 block text-xs text-red-700">Скидка должна быть меньше цены продажи.</span>}</label>
 <label className="min-w-0 text-xs text-slate-600">Надпись акции<input className={input} maxLength={24} placeholder="Например, 11.11" value={value.saleBadgeText||''} onChange={e=>onChange({saleBadgeText:e.target.value})}/></label>
 <label className="min-w-0 text-xs text-slate-600">Цвет подложки<select className={input} value={value.saleBadgeColor||'black'} onChange={e=>onChange({saleBadgeColor:e.target.value as SaleBadgeColor})}><option value="red">Красная</option><option value="white">Белая</option><option value="pink">Розовая</option><option value="black">Чёрная</option><option value="transparent">Прозрачная</option></select></label>
 {sale.discountAmount>0&&<p className="text-xs text-slate-600">Обычная цена: {Number(value.sellingPrice||0).toLocaleString('ru-RU')} ₽ · Со скидкой: {sale.salePrice.toLocaleString('ru-RU')} ₽</p>}
 <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={value.isNew===true} onChange={e=>onChange({isNew:e.target.checked})}/>Новинка</label>
 </div></fieldset>;
}
