export type SiteIntegrations = {metrikaId:string;ga4Id:string;yandexVerification:string;googleVerification:string};
export const integrationPatterns = {
  metrikaId:/^[1-9]\d{0,11}$/,
  ga4Id:/^G-[A-Z0-9]{6,20}$/,
  yandexVerification:/^[a-zA-Z0-9_-]{8,128}$/,
  googleVerification:/^[a-zA-Z0-9_-]{10,160}$/,
};
export function siteIntegrations(raw:unknown):SiteIntegrations {
  const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  return Object.fromEntries(Object.entries(integrationPatterns).map(([key,pattern])=>{
    const text=typeof value[key]==='string'?value[key].trim():'';
    return [key,pattern.test(text)?text:''];
  })) as SiteIntegrations;
}
export function checkoutAttribution(raw:unknown){
 if(!raw||typeof raw!=='object')return undefined;
 const v=raw as Record<string,unknown>,out:Record<string,string>={};
 for(const key of ['source','medium','campaign'])if(typeof v[key]==='string'&&/^[a-zA-Z0-9._~-]{1,80}$/.test(v[key]))out[key]=v[key];
 if(typeof v.referrer==='string')try{const url=new URL(v.referrer);if(/^https?:$/.test(url.protocol))out.referrer=url.origin;}catch{}
 if(typeof v.landingPath==='string')try{const url=new URL(v.landingPath,'https://yaasbae.store');if(url.origin==='https://yaasbae.store'&&/^\/(?:|catalog\/?|product\/?|fit\/?|articles\/?|articles\/read\/?)$/.test(url.pathname)){out.landingPath=url.pathname;const key=url.pathname.startsWith('/product')?'id':url.pathname.startsWith('/articles/read')?'slug':'';const value=url.searchParams.get(key)||'';if(key&&/^[a-zA-Z0-9_-]{1,160}$/.test(value))out.landingPath+='?'+key+'='+value;}}catch{}
 return Object.keys(out).length?out:undefined;
}
