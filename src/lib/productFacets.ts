/** Public, explicitly entered product attributes. Never infer fit or a promotion from a name. */
export type ProductLength = '' | 'mini' | 'midi' | 'maxi';
import { productSale } from './productSale';
export const lengthLabels: Record<string,string> = {mini:'Мини',midi:'Мидл',maxi:'Макси'};
export function productCatalogAttributes(raw: unknown) {
 const row=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 const text=(key:string,max:number)=>typeof row[key]==='string'?(row[key] as string).trim().slice(0,max):'';
 const length=text('productLength',20);
 const old=typeof row.oldPrice==='number'&&Number.isFinite(row.oldPrice)&&row.oldPrice>0&&row.oldPrice<=1e9?Math.round(row.oldPrice*100)/100:0;
 const sale=productSale(Number(row.sellingPrice),row.discountAmount,row.saleBadgeText,row.saleBadgeColor);
 return {height:text('height',300),modelName:text('modelName',120),productLength:(['mini','midi','maxi'].includes(length)?length:'') as ProductLength,isNew:row.isNew===true,...(old?{oldPrice:old}:{}),...(sale.discountAmount?{discountAmount:sale.discountAmount,saleBadgeText:sale.saleBadgeText,saleBadgeColor:sale.saleBadgeColor}:{})};
}
export type FacetProduct = {
 id:string;price:number;oldPrice?:number;category?:string;color?:string;sizes?:string[];height?:string;
 seasonality?:string;composition?:string;materials?:{id:string;name:string;composition:string}[];
 modelName?:string;productLength?:ProductLength;isNew?:boolean;
};
export const facetGroups=[
 {key:'category',label:'Категория'},{key:'height',label:'Рост'},{key:'size',label:'Размер'},
 {key:'color',label:'Цвет'},{key:'season',label:'Сезон'},{key:'insulation',label:'Утеплитель'},
 {key:'composition',label:'Состав'},{key:'model',label:'Модель'},{key:'length',label:'Длина'},
 {key:'offer',label:'Скидки и новинки'},
] as const;
export type FacetKey=typeof facetGroups[number]['key'];
export type FacetSelection=Partial<Record<FacetKey,string[]>>;
const keyOf=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
const split=(value:string)=>value.split(/[,;|\n]+/).map(v=>v.trim()).filter(Boolean);
export function facetValues(p:FacetProduct,key:FacetKey):string[]{
 switch(key){
  case 'category':return p.category?[p.category]:[];
  case 'size':return p.sizes||[];
  case 'height':return split(p.height||'').map(v=>v.replace(/[–—]/g,'-').replace(/\s*-\s*/g,'-').replace(/\s*(?:см|cm)\s*$/i,'').trim());
  case 'color':return p.color?[p.color]:[];
  case 'season':return split(p.seasonality||'');
  case 'insulation':return (p.materials||[]).filter(m=>m.id==='insulation'||keyOf(m.name)==='утеплитель').map(m=>m.composition.trim()).filter(Boolean);
  case 'composition':return [...new Set(split((p.composition||'').replace(/\d+(?:[.,]\d+)?\s*%/g,'')).map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean))];
  case 'model':return p.modelName?[p.modelName]:[];
  case 'length':return p.productLength&&lengthLabels[p.productLength]?[lengthLabels[p.productLength]]:[];
  case 'offer':return [...(p.isNew?['Новинки']:[]),...(Number.isFinite(p.oldPrice)&&(p.oldPrice||0)>p.price?['Со скидкой']:[])];
 }
}
export function matchesFacets(product:FacetProduct,selection:FacetSelection,except?:FacetKey){
 return facetGroups.every(({key})=>key===except||!selection[key]?.length||selection[key]!.some(v=>facetValues(product,key).some(candidate=>keyOf(candidate)===keyOf(v))));
}
export function catalogFacetOptions(products:FacetProduct[],selection:FacetSelection={}){
 return facetGroups.map(group=>{
  const values=new Map<string,{value:string;count:number}>();
  for(const product of products)for(const value of facetValues(product,group.key)){
   const k=keyOf(value);if(k&&!values.has(k))values.set(k,{value:value.trim(),count:0});
  }
  for(const product of products.filter(p=>matchesFacets(p,selection,group.key))){
   for(const k of new Set(facetValues(product,group.key).map(keyOf))){const option=values.get(k);if(option)option.count++;}
  }
  return {...group,options:[...values.values()].sort((a,b)=>group.key==='length'?Object.values(lengthLabels).indexOf(a.value)-Object.values(lengthLabels).indexOf(b.value):a.value.localeCompare(b.value,'ru',{numeric:true}))};
 });
}
export function toggleFacet(selection:FacetSelection,key:FacetKey,value:string):FacetSelection{
 const current=selection[key]||[];
 return {...selection,[key]:current.includes(value)?current.filter(v=>v!==value):[...current,value]};
}
