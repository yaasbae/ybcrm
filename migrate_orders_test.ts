import { initializeApp } from "firebase/app";
import { getFirestore, collection, writeBatch, doc } from "firebase/firestore";
import fs from "fs";
import Papa from "papaparse";

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

function parseDate(dateStr: string) {
    if (!dateStr) return new Date();
    dateStr = String(dateStr).trim().toLowerCase();
    if (dateStr === 'сегодня') return new Date();
    if (dateStr === 'вчера') return new Date(Date.now() - 86400000);
    const parts = dateStr.replace(/,/g, '.').split('.');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month, day);
        }
    }
    return new Date();
}

async function run() {
    console.log("Fetching CSV from Google Sheets...");
    const response = await fetch('https://docs.google.com/spreadsheets/d/1xTDxiOMqJR-KBnLdbikKp2--ZBQBDkII-xMCoO2lSbM/export?format=csv');
    const csvText = await response.text();
    
    console.log("Parsing CSV...");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    
    let batch = writeBatch(db);
    let count = 0;
    let total = 0;
    
    // Create a lowercase map for rows to avoid case issues in headers
    
    for (const rawRow of parsed.data) {
        const row: any = {};
        for (const k of Object.keys(rawRow as any)) {
            row[k.toLowerCase().trim().replace(/\s+/g, ' ')] = (rawRow as any)[k];
        }

        const getVal = (cols: string[]) => {
            for (let c of cols) {
                if (row[c] !== undefined) return String(row[c]).replace(/\r/g, '').replace(/\n/g, ' ').trim();
            }
            return "";
        };

        const rawOrderId = getVal(['номер заказа', '№ заказа', 'номер']);
        if (!rawOrderId || !rawOrderId.startsWith('#')) continue;
        const orderId = rawOrderId.replace('#', '').trim();

        const date = parseDate(getVal(['дата заявки', 'дата']));
        const status = getVal(['статус заказа', 'статус']);
        const source = getVal(['откуда продажа (как узнали)', 'какая продажа', 'источник']);
        
        let clientName = getVal(['фио заказчика', 'фио', 'покупатель', 'клиент']);
        let phone = getVal(['телефон заказчика', 'телефон']).replace(/[^0-9]/g, '');
        if (phone.length === 10) phone = '7' + phone;
        else if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.substring(1);
        else if (phone.length > 11 && phone.startsWith('77')) phone = phone.substring(1);

        let insta = getVal(['соц.сети', 'инстаграм', 'ник', 'соцсети']);
        if (insta.toLowerCase() === "undefined" || insta === "—" || insta === "-") insta = "";
        if (insta.includes('instagram.com/')) {
            const parts = insta.split('instagram.com/');
            if (parts.length > 1) insta = parts[1].split('/')[0].split('?')[0];
        }
        insta = insta.replace('@', '');

        const address = getVal(['адрес доставки', 'адрес']) || "";
        let city = address.includes(',') ? address.split(',')[0].trim() : address.trim();
        if (city.toLowerCase().startsWith('г.')) city = city.substring(2).trim();
        else if (city.toLowerCase().includes('г.')) {
            const splitRes = city.split('г.');
            if (splitRes.length > 1 && splitRes[1]) {
                city = splitRes[1].trim();
            }
        }

        const item = getVal(['заказ наименование', 'наименование', 'товар']);
        const deliveryMethod = getVal(['метод доставки', 'тк', 'доставка']);

        let cleanRevenue = getVal(['сумма заказа', 'сумма']).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const revenue = Math.abs(parseFloat(cleanRevenue) || 0);

        let cleanDelivery = getVal(['цена доставки']).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const deliveryPrice = Math.abs(parseFloat(cleanDelivery) || 0);

        let cleanPayment = getVal(['фактические поступления', 'оплата']).replace(/\s/g, '').replace(',', '.').replace('₽', '').replace('(', '-').replace(')', '');
        const paidAmount = Math.abs(parseFloat(cleanPayment) || 0);

        let deadlineDate = new Date(date);
        deadlineDate.setDate(deadlineDate.getDate() + 14);

        const isShipped = status.toLowerCase() === 'отправлен' || status.toLowerCase() === 'готов';
        const isOverdue = !isShipped && new Date() > deadlineDate;

        const isBlogger = source.toLowerCase().includes('блогер') || source.toLowerCase().includes('перезаказ');

        const orderData = {
           orderId,
           date: date.toISOString(),
           revenue,
           deliveryPrice,
           paidAmount,
           clientName,
           clientPhone: phone,
           clientInsta: insta,
           clientCity: city,
           status,
           source,
           item,
           deliveryMethod,
           year: date.getFullYear(),
           month: date.getMonth(),
           isBlogger,
           isOverdue,
           isShipped,
           deadline: deadlineDate.toISOString(),
           manager: getVal(['мен-р', 'менеджер']),
           updatedAt: new Date().toISOString()
        };
        
        const docRef = doc(collection(db, 'orders'), orderId);
        batch.set(docRef, orderData);
        if(count === 0) console.log(orderData); count++;
        total++;
        
        if (count === 400) {
            await batch.commit();
            console.log(`Committed ${total} orders...`);
            batch = writeBatch(db);
            count = 0;
        }
    }
    
    if (count > 0) {
        await batch.commit();
        console.log(`Committed ${total} orders total. Done.`);
    }
}

run().catch(console.error);
