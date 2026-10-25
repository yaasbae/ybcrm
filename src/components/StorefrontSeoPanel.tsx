import React,{useEffect,useMemo,useState} from 'react';
import {collection,doc,onSnapshot,runTransaction} from 'firebase/firestore';
import {db} from '../firebase';
import {sanitizeStorefrontProduct} from '../lib/storefrontCommerce';
import {nextSeoRecord,seoRecords,seoTargets,type SeoFields,type SeoProduct,type SeoRecord} from '../lib/storefrontSeo';
import {StorefrontSeoEditor} from './StorefrontSeoEditor';
export function StorefrontSeoPanel(){
 const [records,setRecords]=useState<Record<string,SeoRecord>>({}),[products,setProducts]=useState<SeoProduct[]>([]),[loaded,setLoaded]=useState(false),[productsLoaded,setProductsLoaded]=useState(false),[error,setError]=useState('');
 useEffect(()=>onSnapshot(doc(db,'settings','storefrontSeo'),snapshot=>{setRecords(seoRecords(snapshot.data()));setLoaded(true);},()=>{setError('Нет доступа к SEO-настройкам или соединению с базой. Сохранение отключено. Нужны права администратора.');setLoaded(false);}),[]);
 useEffect(()=>onSnapshot(collection(db,'products'),snapshot=>{setProducts(snapshot.docs.map(p=>sanitizeStorefrontProduct(p.id,p.data())).filter((p):p is NonNullable<typeof p>=>Boolean(p)));setProductsLoaded(true);},()=>{setError('Не удалось загрузить товары. Сохранение отключено.');setProductsLoaded(false);}),[]);
 const targets=useMemo(()=>seoTargets(products),[products]);
 async function save(key:string,fields:SeoFields,revision:number,publish:boolean){
  if(!loaded||!productsLoaded||error)throw new Error('Сначала загрузите настройки и товары.');
  if(!targets.some(t=>t.key===key))throw new Error('Страница не найдена. Обновите список товаров.');
  try{return await runTransaction(db,async transaction=>{const ref=doc(db,'settings','storefrontSeo'),snapshot=await transaction.get(ref),source=snapshot.data()||{},current=seoRecords(source);const next=nextSeoRecord(current[key],fields,revision,publish,new Date().toISOString());if(source.entries&&(typeof source.entries!=='object'||Array.isArray(source.entries)))throw new Error('SEO_INVALID');const entries={...(source.entries||{}),[key]:next};const payload={version:1,entries,updatedAt:new Date().toISOString()};if(new TextEncoder().encode(JSON.stringify(payload)).length>800000)throw new Error('SEO_LIMIT');transaction.set(ref,payload,{merge:true});return next;});}
  catch(e){if(e instanceof Error&&e.message==='SEO_CONFLICT')throw new Error('Страницу уже изменил другой редактор. Обновите данные перед сохранением; ваш текст остаётся в форме.');if(e instanceof Error&&e.message==='SEO_LIMIT')throw new Error('Достигнут объём SEO-хранилища. Нужна архивация истории; правки остаются в форме.');throw new Error('Не удалось сохранить SEO. Проверьте права администратора и соединение. Правки остаются в форме.');}
 }
 return <StorefrontSeoEditor targets={targets} records={records} onSave={save} error={error} disabled={!loaded||!productsLoaded||Boolean(error)}/>;
}
