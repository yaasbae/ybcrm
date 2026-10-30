const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const validCheckoutProof=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
/** Only a possession proof for this checkout can request this minimal receipt. */
export function purchaseReceipt(orderId:string,createdAt:number,order:Record<string,any>,now=Date.now()){
 if(!Number.isFinite(createdAt)||createdAt>now+60000||createdAt<now-7*86400000||order.orderId!==orderId||order.createdBy!=='storefront')return null;
 const total=Number(order.totalAmount),paid=Number(order.paidAmount);
 if(!Number.isFinite(total)||total<=0||!Number.isFinite(paid)||paid<total)return {paid:false};
 const ids=Array.isArray(order.itemProductIds)?order.itemProductIds:[],prices=Array.isArray(order.itemPrices)?order.itemPrices:[],quantities=Array.isArray(order.itemQuantities)?order.itemQuantities:[];
 const items=ids.slice(0,30).flatMap((id:unknown,index:number)=>{
  const quantity=Number(quantities[index]),lineTotal=Number(prices[index]);
  return typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id)&&Number.isInteger(quantity)&&quantity>0&&quantity<=20&&Number.isFinite(lineTotal)&&lineTotal>0?[{id,quantity,price:Math.round(lineTotal/quantity*100)/100}]:[];
 });
 if(!items.length||items.length!==ids.length)return null;
 const shipping=Number(order.deliveryPrice)||0;
 if(!Number.isFinite(shipping)||shipping<0)return null;
 return {paid:true,transactionId:orderId,items,shipping};
}
