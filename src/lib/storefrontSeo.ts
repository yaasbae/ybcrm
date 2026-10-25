export const SEO_ORIGIN = 'https://yaasbae.store';
export type SeoFields = { title: string; description: string; h1: string; imageAlt: string; body: string; focusQuery: string; noindex: boolean };
export type SeoRecord = { revision: number; draft: SeoFields; published?: SeoFields | null; publishedAt?: string; history?: { fields: SeoFields; at: string }[] };
export type SeoProduct = { id: string; name: string; color?: string; category?: string; description?: string; price?: number; photos?: string[]; availability?: string };
export type SeoTarget = { key: string; label: string; path: string; type: 'page' | 'product'; product?: SeoProduct };
export const emptySeo: SeoFields = { title: '', description: '', h1: '', imageAlt: '', body: '', focusQuery: '', noindex: false };
const limits = { title: 180, description: 400, h1: 180, imageAlt: 240, body: 6000, focusQuery: 120 } as const;
export function seoFields(value: unknown): SeoFields {
 const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
 return { ...Object.fromEntries(Object.entries(limits).map(([k,n])=>[k,typeof v[k]==='string' ? v[k].trim().slice(0,n) : ''])), noindex: v.noindex===true } as SeoFields;
}
export function validateSeoFields(value: SeoFields): string[] {
 return Object.entries(limits).filter(([k,n])=>typeof value[k as keyof SeoFields]!=='string'||String(value[k as keyof SeoFields]).length>n).map(([k,n])=>`${k}: максимум ${n} символов`);
}
export function seoTargets(products: SeoProduct[]): SeoTarget[] {
 return [{key:'home',label:'Главная',path:'/',type:'page'},{key:'catalog',label:'Каталог',path:'/catalog/',type:'page'},{key:'articles',label:'Истории',path:'/articles/',type:'page'}, ...products.filter(p=>/^[a-zA-Z0-9_-]{1,160}$/.test(p.id)).map(p=>({key:`product_${p.id}`,label:[p.name,p.color].filter(Boolean).join(' · '),path:`/product/?id=${encodeURIComponent(p.id)}`,type:'product' as const,product:p}))];
}
export function defaultSeo(target: SeoTarget): SeoFields {
 const p=target.product, label=p ? [p.name,p.color].filter(Boolean).join(' — ') : target.label;
 const title=p ? `${label} | YAASBAE` : target.key==='home' ? 'YAASBAE — женская одежда' : `${target.label} | YAASBAE`;
 const description=p ? `${label}. ${p.description?.replace(/<[^>]*>/g,'').replace(/\s+/g,' ')||'Фото, размеры и актуальная стоимость в магазине YAASBAE.'}`.slice(0,160) : target.key==='articles' ? 'Истории бренда YAASBAE, коллекции и съёмки.' : 'Женская одежда YAASBAE: коллекция, фотографии, размеры и актуальные цены в интернет-магазине.';
 return {...emptySeo,title,description,h1:p?.name||(target.key==='home'?'Женская одежда YAASBAE':target.label),imageAlt:label};
}
export function resolvedSeo(target: SeoTarget, override?: unknown): SeoFields {
 const base=defaultSeo(target), value=seoFields(override);
 return {...base,...Object.fromEntries(Object.keys(limits).map(k=>[k,value[k as keyof SeoFields]||base[k as keyof SeoFields]])),noindex:value.noindex};
}
export function publicSeoEntries(source: unknown, products?: SeoProduct[]): Record<string, SeoFields> {
 const doc=source&&typeof source==='object'?source as Record<string,unknown>:{};
 const entries=doc.entries&&typeof doc.entries==='object'?doc.entries as Record<string,unknown>:{};
 return Object.fromEntries(Object.entries(entries).filter(([k,v])=>/^(home|catalog|articles|product_[a-zA-Z0-9_-]{1,160})$/.test(k)&&(!products||!k.startsWith('product_')||products.some(p=>`product_${p.id}`===k))&&v&&typeof v==='object'&&(v as SeoRecord).published).map(([k,v])=>{const {focusQuery:_query,...fields}=seoFields((v as SeoRecord).published);return [k,{...fields,focusQuery:''}];}));
}
export function nextSeoRecord(current: SeoRecord|undefined, draft: SeoFields, expectedRevision: number, publish: boolean, now: string): SeoRecord {
 if((current?.revision||0)!==expectedRevision)throw new Error('SEO_CONFLICT');
 const issues=validateSeoFields(draft);if(issues.length)throw new Error(issues.join('. '));
 const fields=seoFields(draft);
 return {revision:expectedRevision+1,draft:fields,published:publish?fields:current?.published||null,publishedAt:publish?now:current?.publishedAt||'',history:publish&&current?.published?[{fields:seoFields(current.published),at:current.publishedAt||now},...(current.history||[])].slice(0,3):(current?.history||[]).slice(0,3)};
}
export function seoIssues(target: SeoTarget, fields: SeoFields, titles: string[]=[]): string[] {
 const issues:string[]=[];
 if(!fields.title)issues.push('Добавьте отдельный SEO-заголовок');else if(fields.title.length>70)issues.push('Заголовок длинный: сократите главную мысль');
 if(!fields.description)issues.push('Добавьте описание для поиска');else if(fields.description.length<70||fields.description.length>170)issues.push('Проверьте длину описания: ориентир 70–170 символов');
 if(!fields.h1)issues.push('Укажите основной заголовок страницы');
 if(target.type==='product'&&!fields.imageAlt)issues.push('Добавьте подпись к фотографии');
 if(target.type==='product'&&!fields.body&&!target.product?.description)issues.push('Товару нужно содержательное описание');
 if(fields.title&&titles.filter(t=>t.trim().toLowerCase()===fields.title.trim().toLowerCase()).length>1)issues.push('Такой SEO-заголовок повторяется у другой страницы');
 if(fields.focusQuery&&!`${fields.title} ${fields.description} ${fields.body}`.toLowerCase().includes(fields.focusQuery.toLowerCase()))issues.push('Проверьте, отвечает ли текст целевому запросу');
 if(fields.noindex)issues.push('Страница исключена из поиска');
 return issues;
}
export function seoRecords(source: unknown): Record<string,SeoRecord> {
 const doc=source&&typeof source==='object'?source as Record<string,unknown>:{};
 const entries=doc.entries&&typeof doc.entries==='object'?doc.entries as Record<string,unknown>:{};
 return Object.fromEntries(Object.entries(entries).filter(([k,v])=>/^(home|catalog|articles|product_[a-zA-Z0-9_-]{1,160})$/.test(k)&&v&&typeof v==='object').map(([key,value])=>{const r=value as SeoRecord;return [key,{revision:Number.isSafeInteger(r.revision)&&r.revision>=0?r.revision:0,draft:seoFields(r.draft),published:r.published?seoFields(r.published):null,publishedAt:typeof r.publishedAt==='string'?r.publishedAt.slice(0,40):'',history:Array.isArray(r.history)?r.history.slice(0,3).map(h=>({fields:seoFields(h.fields),at:typeof h.at==='string'?h.at.slice(0,40):''})):[]}];}));
}
export function productSeoSchema(product:SeoProduct,fields:SeoFields,url:string){
 const schema:Record<string,unknown>={'@context':'https://schema.org','@type':'Product',name:fields.h1||product.name,description:fields.body||product.description||fields.description,sku:product.id,brand:{'@type':'Brand',name:'YAASBAE'},image:product.photos||[],url};
 if(Number.isFinite(product.price)&&product.price!>0){const availability:Record<string,string>={in_stock:'https://schema.org/InStock',made_to_order:'https://schema.org/PreOrder'};schema.offers={'@type':'Offer',url,priceCurrency:'RUB',price:product.price,...(availability[product.availability||'']?{availability:availability[product.availability!]}:{})};}return schema;
}
