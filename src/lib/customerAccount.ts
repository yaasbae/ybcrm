/** Customer-only sessions. Never creates Firebase Auth / CRM employee identities. */
import {createHash,randomBytes,createPublicKey,verify} from 'node:crypto';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const text=(v:unknown,max=250)=>typeof v==='string'?v.trim().slice(0,max):'';
const number=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:0;};
const failure=(status:number,message:string,code='')=>Object.assign(new Error(message),{status,code});
export function customerOrder(id:string,data:Record<string,any>,amounts:(data:Record<string,any>)=>{total:number;paid:number}){
  const items=Array.isArray(data.items)?data.items.slice(0,100):[];
  const date=typeof data.date==='string'?text(data.date,30):'';
  const money=amounts(data);
  return {id:text(id,120),number:text(data.orderId,120)||text(id,120),date,status:text(data.status,80),total:number(money.total),paid:number(money.paid),delivery:number(data.deliveryPrice),tracking:text(data.cdekNumber||data.cdekOrderNumber,80),items:items.map((row:any,i:number)=>({productId:text(data.itemProductIds?.[i]||row?.productId,160),name:typeof row==='string'?text(row):text(row?.name||row?.product||row?.title)||'Изделие',size:text(data.itemSizes?.[i]||row?.size,80),color:text(data.itemColors?.[i]||row?.color,80),quantity:Math.max(1,number(data.itemQuantities?.[i]||row?.quantity||row?.qty)||1),total:number(data.itemPrices?.[i]??row?.lineTotal??(number(row?.price)*Math.max(1,number(row?.quantity)||1)))}))};
}
export function normalizedPhone(value:unknown){const digits=text(value,40).replace(/\D/g,'');return /^\d{10,15}$/.test(digits)?(digits.length===11&&digits.startsWith('8')?'7'+digits.slice(1):digits):'';}
export async function verifyTelegramToken(token:string,nonce:string,clientId:string,now=Date.now(),fetcher=fetch){
  if(token.length>12000||!/^[a-f0-9]{64}$/.test(nonce))throw failure(401,'Повторите вход через Telegram');
  const parts=token.split('.');if(parts.length!==3)throw failure(401,'Некорректный вход');
  let header:any,claims:any;try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString());claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());}catch{throw failure(401,'Некорректный вход');}
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!=='https://oauth.telegram.org'||claims.aud!==clientId||typeof claims.exp!=='number'||claims.exp<=now/1000||typeof claims.iat!=='number'||claims.iat>now/1000+60||claims.iat<now/1000-600||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.phone_number_verified!==true||!normalizedPhone(claims.phone_number))throw failure(401,'Подтвердите телефон в Telegram');
  const response=await fetcher('https://oauth.telegram.org/.well-known/jwks.json',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw failure(503,'Telegram временно недоступен');
  const keys=await response.json() as any;const key=keys.keys?.find((k:any)=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw failure(401,'Не удалось подтвердить вход');
  return {phone:normalizedPhone(claims.phone_number),telegramId:claims.sub};
}
export async function verifyVkCode(body:Record<string,unknown>,fetcher=fetch){
  const code=text(body.code,4096),deviceId=text(body.deviceId,256),verifier=text(body.verifier,256),state=text(body.state,256);
  const redirectUri=text(body.redirectUri,200);
  // VK treats the code and device_id as opaque values; validate size and controls,
  // then let VK verify their authenticity during the exchange.
  if(!code||!deviceId||/[\u0000-\u001f\u007f]/.test(code+deviceId)||
    !/^[a-zA-Z0-9_-]{43,128}$/.test(verifier)||!/^[a-zA-Z0-9_-]{32,256}$/.test(state)||
    !['https://yaasbae.store/','https://www.yaasbae.store/'].includes(redirectUri))throw failure(400,'Некорректный вход VK','vk_request_invalid');
  const exchange=new URL('https://id.vk.ru/oauth2/auth');
  for(const [key,value] of Object.entries({grant_type:'authorization_code',redirect_uri:redirectUri,client_id:'54876412',code_verifier:verifier,state,device_id:deviceId}))exchange.searchParams.set(key,value);
  const response=await fetcher(exchange,{method:'POST',body:new URLSearchParams({code}),signal:AbortSignal.timeout(10000)});
  const token:any=await response.json();
  if(!response.ok||token.error||token.state!==state||!token.access_token||!token.user_id){
    console.warn('[storefront-account] VK exchange rejected',{status:response.status,providerError:typeof token.error==='string'?token.error.slice(0,60):''});
    throw failure(401,'Не удалось подтвердить VK ID','vk_exchange_rejected');
  }
  const profileUrl=new URL('https://id.vk.ru/oauth2/user_info');profileUrl.searchParams.set('client_id','54876412');
  const profileResponse=await fetcher(profileUrl,{method:'POST',body:new URLSearchParams({access_token:token.access_token}),signal:AbortSignal.timeout(10000)});
  const profile:any=await profileResponse.json();
  const phone=normalizedPhone(profile?.user?.phone);
  if(!profileResponse.ok||String(profile?.user?.user_id)!==String(token.user_id)){
    console.warn('[storefront-account] VK profile rejected',{status:profileResponse.status,phonePresent:Boolean(phone),userMatches:String(profile?.user?.user_id)===String(token.user_id)});
    throw failure(401,'Не удалось подтвердить профиль VK ID','vk_profile_rejected');
  }
  const identityName=[text(profile?.user?.first_name,60),text(profile?.user?.last_name,60)].filter(Boolean).join(' ');
  return {phone,vkId:String(token.user_id),identityName};
}
export async function verifyYandexCode(body:Record<string,unknown>,fetcher=fetch){
  const code=text(body.code,4096),verifier=text(body.verifier,256),state=text(body.state,256);
  const redirectUri=text(body.redirectUri,200);
  if(!/^[a-zA-Z0-9_-]{4,4096}$/.test(code)||!/^[a-zA-Z0-9_-]{43,128}$/.test(verifier)||
    !/^[a-zA-Z0-9_-]{32,256}$/.test(state)||
    !['https://yaasbae.store/account/yandex','https://www.yaasbae.store/account/yandex'].includes(redirectUri))
    throw failure(400,'Некорректный вход Яндекс');
  const exchange=await fetcher('https://oauth.yandex.ru/token',{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code,client_id:'3b81620356be4f3a860d6cabef82b382',code_verifier:verifier}),
    signal:AbortSignal.timeout(10000)});
  const token:any=await exchange.json();
  if(!exchange.ok||token.error||!token.access_token)throw failure(401,'Не удалось подтвердить Яндекс ID');
  const profileResponse=await fetcher('https://login.yandex.ru/info?format=json',{
    headers:{Authorization:`OAuth ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  const profile:any=await profileResponse.json();
  const phone=normalizedPhone(profile?.default_phone?.number);
  if(!profileResponse.ok||String(profile?.client_id)!=='3b81620356be4f3a860d6cabef82b382'||
    !profile?.id||!phone)throw failure(401,'Разрешите Яндекс ID передать номер телефона');
  const identityName=[text(profile?.first_name,60),text(profile?.last_name,60)].filter(Boolean).join(' ')||text(profile?.real_name,120);
  return {phone,yandexId:String(profile.id),identityName};
}
type Dependencies={db:any;secret:string;trusted:(req:any)=>boolean;amounts:(data:Record<string,any>)=>{total:number;paid:number};enabled:boolean;telegramClientId?:string;now?:()=>number};
export function registerCustomerAccount(app:any,deps:Dependencies){
  app.post('/api/storefront/account',async(req:any,res:any)=>{
    res.setHeader('Cache-Control','private, no-store');
    const now=deps.now?.()??Date.now();
    try{
      if(!deps.secret||!deps.trusted(req))throw failure(401,'Нет доступа');
      const body=req.body||{};
      if(!['telegram-config','telegram-login','vk-login','yandex-login','session','save-profile','logout'].includes(body.action))throw failure(400,'Некорректный запрос');
      if(!deps.db||!deps.enabled)throw failure(503,'Вход в кабинет ещё не подключён. Попробуйте позже.');
      if(body.action==='telegram-config')return res.json({clientId:deps.telegramClientId||''});
      if(body.action==='telegram-login'){
        if(!deps.telegramClientId)throw failure(503,'Telegram ещё не подключён');
        const identity=await verifyTelegramToken(text(body.idToken,12000),text(body.nonce,64),deps.telegramClientId,now);
        const token=randomBytes(32).toString('hex');
        await deps.db.runTransaction(async(tx:any)=>{
          const replay=deps.db.collection('storefront_account_codes').doc(hash(text(body.idToken,12000)));
          const previous=await tx.get(replay);if(previous.exists)throw failure(401,'Повторите вход через Telegram');
          tx.set(replay,{used:true,expiresAt:new Date(now+3600000)});
          tx.set(deps.db.collection('storefront_account_sessions').doc(hash(token)),{...identity,expires:now+604800000,expiresAt:new Date(now+604800000)});
        });
        return res.json({sessionToken:token});
      }
      if(body.action==='vk-login'){
        const identity=await verifyVkCode(body);
        const token=randomBytes(32).toString('hex');
        await deps.db.collection('storefront_account_sessions').doc(hash(token)).create({
          ...identity,expires:now+604800000,expiresAt:new Date(now+604800000)
        });
        return res.json({sessionToken:token});
      }
      if(body.action==='yandex-login'){
        const identity=await verifyYandexCode(body);
        const token=randomBytes(32).toString('hex');
        await deps.db.collection('storefront_account_sessions').doc(hash(token)).create({
          ...identity,expires:now+604800000,expiresAt:new Date(now+604800000)
        });
        return res.json({sessionToken:token});
      }
      const token=text(body.sessionToken,64);
      if(!/^[a-f0-9]{64}$/.test(token))throw failure(401,'Войдите в кабинет');
      const ref=deps.db.collection('storefront_account_sessions').doc(hash(token));
      const snapshot=await ref.get(),session=snapshot.data();
      if(body.action==='logout'){await ref.delete();return res.json({ok:true});}
      if(!snapshot.exists||!session||session.expires<=now)throw failure(401,'Войдите в кабинет');
      const identityKey=session.vkId?`vk:${session.vkId}`:session.yandexId?`yandex:${session.yandexId}`:session.telegramId?`telegram:${session.telegramId}`:'';
      if(!identityKey)throw failure(401,'Войдите в кабинет');
      const customerRef=deps.db.collection('storefront_customer_profiles').doc(hash(identityKey));
      if(body.action==='save-profile'){
        const firstName=text(body.firstName,60),lastName=text(body.lastName,60),contactPhone=normalizedPhone(body.phone),email=text(body.email,160);
        if(!firstName||!lastName||!contactPhone||typeof body.firstName!=='string'||typeof body.lastName!=='string'||firstName!==body.firstName.trim()||lastName!==body.lastName.trim()||
          (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw failure(400,'Проверьте личные данные');
        await customerRef.set({firstName,lastName,contactPhone,email,updatedAt:new Date(now).toISOString()},{merge:true});
        return res.json({ok:true});
      }
      const customerSnapshot=await customerRef.get();
      const saved=customerSnapshot.exists?customerSnapshot.data():null;
      const selfProfile=saved?{firstName:text(saved.firstName,60),lastName:text(saved.lastName,60),phone:normalizedPhone(saved.contactPhone),email:text(saved.email,160)}:null;
      const phone=normalizedPhone(session.phone);
      // A verified VK identity can open a cabinet without exposing any CRM
      // records. Orders and discounts require a separately verified phone.
      if(!phone)return res.json({phone:'',identityName:text(session.identityName,120),selfProfile,discount:null,profile:null,orders:[],updatedAt:new Date(now).toISOString()});
      // Only an exact verified owner query; never read the entire orders collection.
      const orders=await deps.db.collection('orders_new').where('clientPhone','in',[phone,'+'+phone,...(phone.startsWith('7')&&phone.length===11?['8'+phone.slice(1)]:[])]).limit(201).get();
      if(orders.docs.length>200)throw failure(503,'История большая. Обратитесь в магазин для полной выписки.');
      const contacts=await deps.db.collection('contacts').get();
      const matches=contacts.docs.filter((d:any)=>[d.data().phone,d.data().phoneNumber,d.data().clientPhone].some((value:unknown)=>normalizedPhone(value)===phone));
      const contact=matches.length===1?matches[0].data():null;
      const rawDiscount=contact?Number(contact.currentDiscount):NaN;
      const discount=Number.isFinite(rawDiscount)&&rawDiscount>=0&&rawDiscount<=100?rawDiscount:null;
      const profile=contact?{name:text(contact.fullName||contact.name,120),email:text(contact.email,160),city:text(contact.city,120),loyaltyCardId:text(contact.loyaltyCardId,80),totalSpent:number(contact.totalSpent),ordersCount:number(contact.ordersCount)}:null;
      return res.json({phone,identityName:text(session.identityName,120),selfProfile,discount,profile,orders:orders.docs.filter((d:any)=>normalizedPhone(d.data().clientPhone)===phone&&d.data().status!=='Черновик').map((d:any)=>customerOrder(d.id,d.data(),deps.amounts)).sort((a:any,b:any)=>b.date.localeCompare(a.date)),updatedAt:new Date(now).toISOString()});
    }catch(error:any){const status=[400,401,429,503].includes(error?.status)?error.status:503;if(status===503)console.warn('[storefront-account] unavailable',{action:String(req.body?.action||'').slice(0,30),name:String(error?.name||'Error').slice(0,60),code:String(error?.code||'').slice(0,60)});return res.status(status).json({error:status===503?'Кабинет временно недоступен. Попробуйте позже.':error.message,...(String(error?.code||'').startsWith('vk_')?{code:error.code}:{})});}
  });
}
