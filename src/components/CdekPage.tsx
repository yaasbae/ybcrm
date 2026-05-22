import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Loader2, MapPin, Package, Save, Search, Send, Truck } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';

type CityOption = {
  code: number;
  city: string;
  region?: string;
};

type DeliveryPoint = {
  code: string;
  name?: string;
  address?: string;
  location?: { address?: string };
};

type CdekSettings = {
  configured: boolean;
  clientIdPreview?: string;
  isTest: boolean;
  senderCityCode: number;
  senderCity: string;
  senderAddress: string;
  senderName: string;
  senderPhone: string;
  shipmentPoint: string;
};

const defaultSettings: CdekSettings = {
  configured: false,
  isTest: false,
  senderCityCode: 424,
  senderCity: 'Казань',
  senderAddress: '',
  senderName: '',
  senderPhone: '',
  shipmentPoint: '',
};

const defaultShipment = {
  orderId: '',
  recipientName: '',
  recipientPhone: '',
  itemName: '',
  itemCost: '19900',
  codAmount: '0',
  tariffCode: '136',
  deliveryType: 'pvz',
  toCityCode: '',
  toCity: '',
  deliveryPoint: '',
  toAddress: '',
  weight: '700',
  length: '30',
  width: '20',
  height: '10',
  comment: '',
};

export const CdekPage: React.FC = () => {
  const [settings, setSettings] = useState<CdekSettings>(defaultSettings);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [shipment, setShipment] = useState(defaultShipment);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/cdek/status')
      .then(r => r.json())
      .then(data => setSettings({ ...defaultSettings, ...data }))
      .catch(() => setSettingsStatus('Не удалось загрузить настройки СДЭК'));
  }, []);

  useEffect(() => {
    if (cityQuery.trim().length < 2) {
      setCities([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoadingCities(true);
      try {
        const res = await fetch(`/api/cdek/cities?q=${encodeURIComponent(cityQuery.trim())}`);
        const data = await res.json();
        setCities(Array.isArray(data) ? data : []);
      } catch {
        setCities([]);
      } finally {
        setLoadingCities(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cityQuery]);

  const selectedCityCode = Number(shipment.toCityCode || 0);

  useEffect(() => {
    if (!selectedCityCode || shipment.deliveryType !== 'pvz') {
      setDeliveryPoints([]);
      return;
    }
    const loadPoints = async () => {
      setLoadingPoints(true);
      try {
        const res = await fetch(`/api/cdek/deliverypoints?city_code=${selectedCityCode}`);
        const data = await res.json();
        setDeliveryPoints(Array.isArray(data) ? data : []);
      } catch {
        setDeliveryPoints([]);
      } finally {
        setLoadingPoints(false);
      }
    };
    loadPoints();
  }, [selectedCityCode, shipment.deliveryType]);

  const isPvz = shipment.deliveryType === 'pvz';
  const itemCostNumber = Number(shipment.itemCost || 0);
  const codNumber = Number(shipment.codAmount || 0);
  const canSubmit = Boolean(settings.configured && shipment.recipientName && shipment.recipientPhone && (shipment.deliveryPoint || shipment.toAddress));

  const tariffHint = useMemo(() => {
    if (shipment.tariffCode === '136') return 'Посылка склад-ПВЗ';
    if (shipment.tariffCode === '137') return 'Посылка склад-дверь';
    if (shipment.tariffCode === '138') return 'Посылка дверь-дверь';
    if (shipment.tariffCode === '139') return 'Посылка дверь-ПВЗ';
    return 'Код тарифа СДЭК';
  }, [shipment.tariffCode]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsStatus('');
    try {
      const res = await fetch('/api/cdek/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          isTest: settings.isTest,
          senderCityCode: settings.senderCityCode,
          senderCity: settings.senderCity,
          senderAddress: settings.senderAddress,
          senderName: settings.senderName,
          senderPhone: settings.senderPhone,
          shipmentPoint: settings.shipmentPoint,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Ошибка сохранения');
      setSettings(prev => ({ ...prev, configured: data.configured }));
      setClientSecret('');
      setSettingsStatus('Настройки СДЭК сохранены');
    } catch (e: any) {
      setSettingsStatus(e.message || 'Ошибка сохранения СДЭК');
    } finally {
      setSavingSettings(false);
    }
  };

  const createShipment = async () => {
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/cdek/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shipment),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details?.message || data.error || 'СДЭК не принял заказ');
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'Ошибка создания отправления');
    } finally {
      setSubmitting(false);
    }
  };

  const selectCity = (city: CityOption) => {
    setShipment(prev => ({ ...prev, toCityCode: String(city.code), toCity: city.city, deliveryPoint: '' }));
    setCityQuery(`${city.city}${city.region ? `, ${city.region}` : ''}`);
    setCities([]);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-black uppercase tracking-[0.22em] text-zinc-900">СДЭК</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Создание отправлений из CRM</p>
        </div>
        <div className={cn(
          "px-3 py-2 rounded-xl border text-[9px] font-black uppercase tracking-widest flex items-center gap-2",
          settings.configured ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-500 border-red-100"
        )}>
          {settings.configured ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {settings.configured ? 'Настроен' : 'Нужны ключи'}
        </div>
      </motion.div>

      <section className="bg-white border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
          <Truck className="w-4 h-4 text-zinc-500" />
          <h2 className="text-[11px] font-black uppercase tracking-widest text-zinc-700">Настройки API</h2>
        </div>
        <div className="p-4 grid md:grid-cols-3 gap-3">
          <Field label="Account / client_id">
            <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder={settings.configured ? 'Оставьте пустым, если не менять' : 'client_id'} className="field" />
            {settings.clientIdPreview && !clientId && (
              <p className="mt-1 px-1 text-[9px] font-bold text-emerald-600">Сохранен: {settings.clientIdPreview}</p>
            )}
          </Field>
          <Field label="Secure password">
            <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={settings.configured ? 'Оставьте пустым, если не менять' : 'client_secret'} type="password" className="field" />
            {settings.configured && !clientSecret && (
              <p className="mt-1 px-1 text-[9px] font-bold text-emerald-600">Пароль сохранен, повторно вводить не нужно</p>
            )}
          </Field>
          <Field label="Режим">
            <select value={settings.isTest ? 'test' : 'prod'} onChange={e => setSettings(prev => ({ ...prev, isTest: e.target.value === 'test' }))} className="field">
              <option value="prod">Боевой API</option>
              <option value="test">Тестовый API</option>
            </select>
          </Field>
          <Field label="Город отправителя, код">
            <input value={settings.senderCityCode || ''} onChange={e => setSettings(prev => ({ ...prev, senderCityCode: Number(e.target.value) }))} className="field" />
          </Field>
          <Field label="Город отправителя">
            <input value={settings.senderCity} onChange={e => setSettings(prev => ({ ...prev, senderCity: e.target.value }))} placeholder="Казань" className="field" />
          </Field>
          <Field label="Код ПВЗ отправки">
            <input value={settings.shipmentPoint} onChange={e => setSettings(prev => ({ ...prev, shipmentPoint: e.target.value }))} placeholder="Если отправка от ПВЗ" className="field" />
          </Field>
          <Field label="Отправитель">
            <input value={settings.senderName} onChange={e => setSettings(prev => ({ ...prev, senderName: e.target.value }))} placeholder="YBCRM / ИП" className="field" />
          </Field>
          <Field label="Телефон отправителя">
            <input value={settings.senderPhone} onChange={e => setSettings(prev => ({ ...prev, senderPhone: e.target.value }))} placeholder="+7..." className="field" />
          </Field>
          <Field label="Адрес отправителя">
            <input value={settings.senderAddress} onChange={e => setSettings(prev => ({ ...prev, senderAddress: e.target.value }))} placeholder="Если отправка от адреса" className="field" />
          </Field>
          <div className="md:col-span-3 flex items-center gap-3">
            <button onClick={saveSettings} disabled={savingSettings} className="h-11 px-5 rounded-xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Сохранить
            </button>
            {settingsStatus && <p className="text-[10px] font-bold text-zinc-500">{settingsStatus}</p>}
          </div>
        </div>
      </section>

      <section className="bg-white border border-zinc-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
          <Package className="w-4 h-4 text-zinc-500" />
          <h2 className="text-[11px] font-black uppercase tracking-widest text-zinc-700">Новое отправление</h2>
        </div>
        <div className="p-4 grid md:grid-cols-4 gap-3">
          <Field label="ID заказа">
            <input value={shipment.orderId} onChange={e => setShipment(prev => ({ ...prev, orderId: e.target.value }))} placeholder="8999" className="field" />
          </Field>
          <Field label="Модель">
            <input value={shipment.itemName} onChange={e => setShipment(prev => ({ ...prev, itemName: e.target.value }))} placeholder="Бомбер макси FLAME" className="field" />
          </Field>
          <Field label="Стоимость">
            <input value={shipment.itemCost} onChange={e => setShipment(prev => ({ ...prev, itemCost: e.target.value }))} className="field" />
          </Field>
          <Field label="Наложенный платеж">
            <input value={shipment.codAmount} onChange={e => setShipment(prev => ({ ...prev, codAmount: e.target.value }))} className="field" />
          </Field>

          <Field label="ФИО получателя">
            <input value={shipment.recipientName} onChange={e => setShipment(prev => ({ ...prev, recipientName: e.target.value }))} className="field" />
          </Field>
          <Field label="Телефон получателя">
            <input value={shipment.recipientPhone} onChange={e => setShipment(prev => ({ ...prev, recipientPhone: e.target.value }))} placeholder="+791..." className="field" />
          </Field>
          <Field label="Тариф">
            <select value={shipment.tariffCode} onChange={e => setShipment(prev => ({ ...prev, tariffCode: e.target.value }))} className="field">
              <option value="136">136 склад-ПВЗ</option>
              <option value="137">137 склад-дверь</option>
              <option value="138">138 дверь-дверь</option>
              <option value="139">139 дверь-ПВЗ</option>
            </select>
          </Field>
          <Field label="Тип доставки">
            <select value={shipment.deliveryType} onChange={e => setShipment(prev => ({ ...prev, deliveryType: e.target.value, deliveryPoint: '', toAddress: '' }))} className="field">
              <option value="pvz">До ПВЗ</option>
              <option value="door">Курьером до двери</option>
            </select>
          </Field>

          <div className="md:col-span-2 relative">
            <Field label="Город получателя">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-300" />
                <input value={cityQuery} onChange={e => setCityQuery(e.target.value)} placeholder="Начните вводить город" className="field pl-9" />
              </div>
            </Field>
            {cities.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-zinc-100 rounded-xl shadow-xl overflow-hidden">
                {cities.map(city => (
                  <button key={city.code} onClick={() => selectCity(city)} className="w-full px-3 py-2 text-left hover:bg-zinc-50 transition-colors">
                    <p className="text-[11px] font-black text-zinc-800">{city.city}</p>
                    <p className="text-[9px] font-bold text-zinc-400">{city.region || 'Россия'} · код {city.code}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Field label="Код города">
            <input value={shipment.toCityCode} onChange={e => setShipment(prev => ({ ...prev, toCityCode: e.target.value }))} className="field" />
          </Field>
          <Field label={isPvz ? 'ПВЗ СДЭК' : 'Адрес доставки'}>
            {isPvz ? (
              <select value={shipment.deliveryPoint} onChange={e => setShipment(prev => ({ ...prev, deliveryPoint: e.target.value }))} className="field">
                <option value="">{loadingPoints ? 'Загрузка ПВЗ...' : 'Выберите ПВЗ'}</option>
                {deliveryPoints.map(point => (
                  <option key={point.code} value={point.code}>
                    {point.code} · {point.address || point.location?.address || point.name}
                  </option>
                ))}
              </select>
            ) : (
              <input value={shipment.toAddress} onChange={e => setShipment(prev => ({ ...prev, toAddress: e.target.value }))} placeholder="Улица, дом, квартира" className="field" />
            )}
          </Field>

          <Field label="Вес, г">
            <input value={shipment.weight} onChange={e => setShipment(prev => ({ ...prev, weight: e.target.value }))} className="field" />
          </Field>
          <Field label="Длина, см">
            <input value={shipment.length} onChange={e => setShipment(prev => ({ ...prev, length: e.target.value }))} className="field" />
          </Field>
          <Field label="Ширина, см">
            <input value={shipment.width} onChange={e => setShipment(prev => ({ ...prev, width: e.target.value }))} className="field" />
          </Field>
          <Field label="Высота, см">
            <input value={shipment.height} onChange={e => setShipment(prev => ({ ...prev, height: e.target.value }))} className="field" />
          </Field>

          <div className="md:col-span-4">
            <Field label="Комментарий">
              <textarea value={shipment.comment} onChange={e => setShipment(prev => ({ ...prev, comment: e.target.value }))} className="field min-h-20 resize-none" />
            </Field>
          </div>

          <div className="md:col-span-4 flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
            <button onClick={createShipment} disabled={!canSubmit || submitting} className="h-12 px-6 rounded-xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Отправить в СДЭК
            </button>
            <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
              {tariffHint} · {formatCurrency(itemCostNumber)} · наложенный {formatCurrency(codNumber)}
            </div>
          </div>
        </div>
      </section>

      {(result || error) && (
        <section className={cn(
          "border rounded-2xl p-4",
          result ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"
        )}>
          {result ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                <p className="text-[11px] font-black uppercase tracking-widest">Заказ СДЭК создан</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-[11px] font-bold text-emerald-900">
                <p>UUID: {result.cdekUuid || 'пока не вернулся'}</p>
                <p>Номер СДЭК: {result.cdekNumber || 'будет позже в статусе'}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[11px] font-black">{error}</p>
            </div>
          )}
        </section>
      )}

      {loadingCities && <p className="text-[9px] font-bold text-zinc-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Ищу город СДЭК</p>}
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
        <MapPin className="w-3 h-3 text-zinc-300" />
        {label}
      </span>
      {children}
    </label>
  );
}
