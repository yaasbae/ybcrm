import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Instagram,
  KeyRound,
  Loader2,
  MessageCircle,
  PlugZap,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  WalletCards,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn } from '../lib/utils';

type AppView = 'broadcast' | 'bot' | 'cdek' | 'content' | 'finance';

type Props = {
  onNavigate?: (view: AppView) => void;
};

type ApiState = 'connected' | 'partial' | 'missing' | 'checking';

type CdekSettings = {
  configured?: boolean;
  clientIdPreview?: string;
  isTest?: boolean;
  senderCityCode?: number;
  senderCity?: string;
  senderAddress?: string;
  senderName?: string;
  senderPhone?: string;
  shipmentPoint?: string;
};

type InstagramStatus = {
  configured?: boolean;
  connected?: boolean;
  authMode?: string;
  apiMode?: 'instagram_login' | 'facebook_login';
  appIdPreview?: string;
  tokenPreview?: string;
  redirectUri?: string;
  scopes?: string;
  pageName?: string;
  instagramUserId?: string;
  instagramUsername?: string;
  followersCount?: number;
  mediaCount?: number;
  tokenExpiresAt?: string;
  connectedAt?: string;
  lastCheckAt?: string;
};

type YandexPayStatus = {
  configured?: boolean;
  merchantId?: string;
  merchantIdPreview?: string;
  apiKeySet?: boolean;
  sandbox?: boolean;
  callbackUrl?: string;
};

type CloudBillingSummary = {
  configured?: boolean;
  billingAccountOpen?: boolean;
  currency?: string;
  currentPeriod?: { from?: string; through?: string; expense?: number; openingBalance?: number; balanceBeforeLatestPayment?: number };
  previousPeriod?: { from?: string; through?: string; expense?: number };
  latestPayment?: { reportedAt?: string; status?: string };
  verifiedAt?: string;
  stale?: boolean;
  schedule?: { monthlyChargeDay?: number; nextMonthlyChargeDate?: string; thresholdAmount?: number; rule?: string };
  sync?: { automatic?: boolean; note?: string };
  error?: string;
};

const inputClass =
  'h-11 w-full rounded-[8px] border border-[#E6E9EF] bg-white px-3 text-[13px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6] focus:ring-4 focus:ring-[#7D7DE6]/10 placeholder:text-[#9CA3AF]';

const textareaClass =
  'min-h-[96px] w-full resize-y rounded-[8px] border border-[#E6E9EF] bg-white px-3 py-3 font-mono text-[11px] font-medium text-[#1F2937] outline-none transition focus:border-[#7D7DE6] focus:ring-4 focus:ring-[#7D7DE6]/10 placeholder:text-[#9CA3AF]';

const labelClass = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]';

function statusCopy(state: ApiState) {
  if (state === 'connected') return { text: 'Подключено', color: 'text-[#2EBA7F]', bg: 'bg-emerald-50', icon: CheckCircle2 };
  if (state === 'partial') return { text: 'Частично', color: 'text-[#F5A623]', bg: 'bg-orange-50', icon: AlertCircle };
  if (state === 'checking') return { text: 'Проверка', color: 'text-[#6B7280]', bg: 'bg-[#F6F7F9]', icon: Loader2 };
  return { text: 'Не подключено', color: 'text-[#F06B6B]', bg: 'bg-red-50', icon: AlertCircle };
}

function StatusPill({ state }: { state: ApiState }) {
  const meta = statusCopy(state);
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]', meta.bg, meta.color)}>
      <Icon className={cn('h-3.5 w-3.5', state === 'checking' && 'animate-spin')} />
      {meta.text}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function ApiCard({
  title,
  subtitle,
  icon: Icon,
  state,
  children,
  accent = 'bg-[#1F2937]',
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  state: ApiState;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[#E6E9EF] bg-white shadow-[0_12px_32px_rgba(31,41,55,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E6E9EF] px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-white shadow-[0_10px_20px_rgba(31,41,55,0.10)]', accent)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold leading-6 text-[#1F2937]">{title}</h2>
            <p className="mt-1 text-[12px] font-medium leading-5 text-[#6B7280]">{subtitle}</p>
          </div>
        </div>
        <StatusPill state={state} />
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'dark',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'dark' | 'light' | 'blue';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-4 text-[12px] font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45',
        tone === 'dark' && 'bg-[#1F2937] text-white hover:bg-[#111827]',
        tone === 'light' && 'border border-[#E6E9EF] bg-white text-[#1F2937] hover:bg-[#F6F7F9]',
        tone === 'blue' && 'bg-[#7D7DE6] text-white hover:bg-[#6f6fd8]',
      )}
    >
      {children}
    </button>
  );
}

async function readApiJson(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 180) || `Сервер вернул не JSON (${res.status})`);
  }
}

export const IntegrationsPage: React.FC<Props> = ({ onNavigate }) => {
  const [cloudBillingState, setCloudBillingState] = useState<ApiState>('checking');
  const [cloudBilling, setCloudBilling] = useState<CloudBillingSummary>({});
  const [tochkaState, setTochkaState] = useState<ApiState>('checking');
  const [tochkaToken, setTochkaToken] = useState('');
  const [tochkaMerchantId, setTochkaMerchantId] = useState('');
  const [tochkaAccountId, setTochkaAccountId] = useState('');
  const [tochkaLegalId, setTochkaLegalId] = useState('');
  const [tochkaResult, setTochkaResult] = useState('');
  const [savingTochka, setSavingTochka] = useState(false);
  const [checkingTochkaJwt, setCheckingTochkaJwt] = useState(false);
  const [tochkaJwtDiagnostics, setTochkaJwtDiagnostics] = useState<any | null>(null);
  const [checkingTochkaAccounts, setCheckingTochkaAccounts] = useState(false);
  const [tochkaAccountsDiagnostics, setTochkaAccountsDiagnostics] = useState<any | null>(null);

  const [yandexPayState, setYandexPayState] = useState<ApiState>('checking');
  const [yandexPayStatus, setYandexPayStatus] = useState<YandexPayStatus>({});
  const [yandexPayMerchantId, setYandexPayMerchantId] = useState('');
  const [yandexPayApiKey, setYandexPayApiKey] = useState('');
  const [yandexPaySandbox, setYandexPaySandbox] = useState(false);
  const [yandexPayResult, setYandexPayResult] = useState('');
  const [savingYandexPay, setSavingYandexPay] = useState(false);
  const [checkingYandexPay, setCheckingYandexPay] = useState(false);

  const [cdekState, setCdekState] = useState<ApiState>('checking');
  const [cdek, setCdek] = useState<CdekSettings>({});
  const [cdekClientId, setCdekClientId] = useState('');
  const [cdekClientSecret, setCdekClientSecret] = useState('');
  const [cdekResult, setCdekResult] = useState('');
  const [savingCdek, setSavingCdek] = useState(false);

  const [tgState, setTgState] = useState<ApiState>('checking');
  const [tgText, setTgText] = useState('');
  const [instagramState, setInstagramState] = useState<ApiState>('checking');
  const [instagramStatus, setInstagramStatus] = useState<InstagramStatus>({});
  const [instagramAccessToken, setInstagramAccessToken] = useState('');
  const [instagramAppId, setInstagramAppId] = useState('');
  const [instagramAppSecret, setInstagramAppSecret] = useState('');
  const [instagramRedirectUri, setInstagramRedirectUri] = useState('');
  const [instagramScopes, setInstagramScopes] = useState('');
  const [instagramResult, setInstagramResult] = useState('');
  const [savingInstagram, setSavingInstagram] = useState(false);
  const [checkingInstagram, setCheckingInstagram] = useState(false);
  const [geminiState, setGeminiState] = useState<ApiState>('checking');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiResult, setGeminiResult] = useState('');
  const [savingGemini, setSavingGemini] = useState(false);

  const chatwootState: ApiState = useMemo(() => {
    const token = import.meta.env.VITE_CHATWOOT_WEBSITE_TOKEN;
    const base = import.meta.env.VITE_CHATWOOT_BASE_URL;
    return token && base ? 'connected' : 'missing';
  }, []);

  const loadStatuses = async () => {
    setCloudBillingState('checking');
    setTochkaState('checking');
    setYandexPayState('checking');
    setCdekState('checking');
    setTgState('checking');
    setInstagramState('checking');
    setGeminiState('checking');

    auth.currentUser?.getIdToken()
      .then(token => fetch('/api/google-cloud-billing/summary', {
        headers: { Authorization: `Bearer ${token}` },
      }))
      .then(async response => {
        if (!response) throw new Error('Нужен вход владельца');
        const data = await readApiJson(response);
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить расходы');
        setCloudBilling(data);
        setCloudBillingState(data.billingAccountOpen ? (data.stale ? 'partial' : 'connected') : 'missing');
      })
      .catch(error => {
        setCloudBilling({ error: error.message || 'Не удалось загрузить расходы' });
        setCloudBillingState('missing');
      });

    fetch('/api/tochka/status')
      .then(r => r.json())
      .then(d => setTochkaState(d.configured ? 'connected' : 'missing'))
      .catch(() => setTochkaState('missing'));

    fetch('/api/yandex-pay/status')
      .then(readApiJson)
      .then(d => {
        setYandexPayStatus(d || {});
        setYandexPayMerchantId(d.merchantId || '');
        setYandexPaySandbox(Boolean(d.sandbox));
        setYandexPayState(d.configured ? 'connected' : d.merchantId ? 'partial' : 'missing');
      })
      .catch(() => setYandexPayState('missing'));

    fetch('/api/cdek/status')
      .then(r => r.json())
      .then(d => {
        setCdek(d || {});
        setCdekState(d.configured ? 'connected' : 'missing');
      })
      .catch(() => setCdekState('missing'));

    fetch('/api/tg/auth/status')
      .then(r => r.json())
      .then(d => {
        const accounts = Number(d.accountsCount || d.count || d.accounts?.length || 0);
        const connected = Boolean(d.connected || d.authorized || accounts > 0);
        setTgState(connected ? 'connected' : 'missing');
        setTgText(accounts ? `${accounts} аккаунт(ов) в рассылке` : connected ? 'Telegram подключен' : 'Нужны session-файлы или авторизация');
      })
      .catch(() => {
        setTgState('missing');
        setTgText('Не удалось проверить Telegram');
      });

    fetch('/api/instagram/status')
      .then(r => r.json())
      .then(d => {
        setInstagramStatus(d || {});
        setInstagramState(d.connected ? 'connected' : d.configured ? 'partial' : 'missing');
        setInstagramRedirectUri(d.redirectUri || '');
        setInstagramScopes(d.scopes || '');
      })
      .catch(() => setInstagramState('missing'));

    getDoc(doc(db, 'settings', 'ai_config'))
      .then(snap => setGeminiState(snap.exists() && snap.data()?.geminiKey ? 'connected' : 'missing'))
      .catch(() => setGeminiState('missing'));
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  const saveTochka = async () => {
    if (!tochkaToken.trim() && tochkaState !== 'connected') {
      setTochkaResult('Сначала вставь JWT токен Точки.');
      return;
    }
    setSavingTochka(true);
    setTochkaResult('');
    try {
      const res = await fetch('/api/tochka/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwtToken: tochkaToken.trim(),
          merchantId: tochkaMerchantId.trim(),
          accountId: tochkaAccountId.trim(),
          legalId: tochkaLegalId.trim(),
          paymentMode: ['sbp'],
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить Точку');
      setTochkaState('connected');
      setTochkaResult(`Сохранено. Код клиента: ${data.customerCode || 'получен'}`);
      setTochkaToken('');
      setTochkaMerchantId('');
      setTochkaAccountId('');
    } catch (e: any) {
      setTochkaResult(e.message || 'Ошибка сохранения Точки');
    } finally {
      setSavingTochka(false);
    }
  };

  const checkTochkaJwt = async () => {
    setCheckingTochkaJwt(true);
    setTochkaResult('');
    try {
      const res = await fetch('/api/tochka/jwt-diagnostics');
      const data = await readApiJson(res);
      setTochkaJwtDiagnostics(data);
      if (!res.ok) throw new Error(data.error || 'Не удалось проверить JWT Точки');
      const failed = Array.isArray(data.tests) ? data.tests.filter((item: any) => !item.ok && !item.optional).length : 0;
      const optional = Array.isArray(data.tests) ? data.tests.filter((item: any) => !item.ok && item.optional).length : 0;
      setTochkaResult(failed
        ? `JWT проверен, есть ${failed} ошибка(и).`
        : optional
          ? `JWT проверен: СБП готово, ${optional} acquiring-проверка(и) недоступны.`
          : 'JWT проверен: базовые доступы работают.'
      );
    } catch (e: any) {
      setTochkaResult(e.message || 'Ошибка проверки JWT Точки');
    } finally {
      setCheckingTochkaJwt(false);
    }
  };

  const checkTochkaAccounts = async () => {
    setCheckingTochkaAccounts(true);
    setTochkaResult('');
    try {
      const res = await fetch('/api/tochka/accounts-diagnostics');
      const data = await readApiJson(res);
      setTochkaAccountsDiagnostics(data);
      if (!res.ok) throw new Error(data.error || 'Не удалось проверить счета Точки');
      const success = Array.isArray(data.tests) ? data.tests.filter((item: any) => item.ok).length : 0;
      setTochkaResult(success
        ? `Счета Точки проверены: доступно ${success} метод(а).`
        : 'Счета Точки проверены: доступов к счетам пока нет.'
      );
    } catch (e: any) {
      setTochkaResult(e.message || 'Ошибка проверки счетов Точки');
    } finally {
      setCheckingTochkaAccounts(false);
    }
  };

  const saveYandexPay = async () => {
    if (!yandexPayMerchantId.trim()) {
      setYandexPayResult('Укажите Merchant ID Яндекс Пэй.');
      return;
    }
    if (!yandexPayApiKey.trim() && !yandexPayStatus.apiKeySet) {
      setYandexPayResult('Выпустите и вставьте Merchant API key.');
      return;
    }
    setSavingYandexPay(true);
    setYandexPayResult('');
    try {
      const res = await fetch('/api/yandex-pay/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: yandexPayMerchantId.trim(),
          apiKey: yandexPayApiKey.trim(),
          sandbox: yandexPaySandbox,
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить Яндекс Пэй');
      setYandexPayStatus(data || {});
      setYandexPayState('connected');
      setYandexPayApiKey('');
      setYandexPayResult('Настройки сохранены. Сплит доступен в типах оплаты заказа.');
    } catch (e: any) {
      setYandexPayResult(e.message || 'Ошибка сохранения Яндекс Пэй');
    } finally {
      setSavingYandexPay(false);
    }
  };

  const checkYandexPay = async () => {
    setCheckingYandexPay(true);
    setYandexPayResult('');
    try {
      const res = await fetch('/api/yandex-pay/test', { method: 'POST' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось проверить Яндекс Пэй');
      setYandexPayState('connected');
      setYandexPayResult(data.message || 'Подключение Яндекс Пэй работает.');
    } catch (e: any) {
      setYandexPayResult(e.message || 'Ошибка проверки Яндекс Пэй');
    } finally {
      setCheckingYandexPay(false);
    }
  };

  const copyYandexCallback = async () => {
    const callbackUrl = yandexPayStatus.callbackUrl || `${window.location.origin}/api/yandex-pay/v1/webhook`;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setYandexPayResult('Callback URL скопирован. Вставьте его в кабинете Яндекс Пэй.');
    } catch {
      setYandexPayResult(`Скопируйте Callback URL: ${callbackUrl}`);
    }
  };

  const saveCdek = async () => {
    setSavingCdek(true);
    setCdekResult('');
    try {
      const res = await fetch('/api/cdek/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: cdekClientId.trim(),
          clientSecret: cdekClientSecret.trim(),
          isTest: Boolean(cdek.isTest),
          senderCityCode: cdek.senderCityCode || 424,
          senderCity: cdek.senderCity || '',
          senderAddress: cdek.senderAddress || '',
          senderName: cdek.senderName || '',
          senderPhone: cdek.senderPhone || '',
          shipmentPoint: cdek.shipmentPoint || '',
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.message || data.error || 'Не удалось сохранить СДЭК');
      setCdekState('connected');
      setCdekClientSecret('');
      setCdekResult('Настройки СДЭК сохранены.');
      loadStatuses();
    } catch (e: any) {
      setCdekResult(e.message || 'Ошибка сохранения СДЭК');
    } finally {
      setSavingCdek(false);
    }
  };

  const saveGemini = async () => {
    if (!geminiKey.trim()) return;
    setSavingGemini(true);
    setGeminiResult('');
    try {
      await setDoc(doc(db, 'settings', 'ai_config'), { geminiKey: geminiKey.trim() }, { merge: true });
      setGeminiKey('');
      setGeminiState('connected');
      setGeminiResult('Gemini API ключ сохранен.');
    } catch (e: any) {
      setGeminiResult(e.message || 'Ошибка сохранения Gemini');
    } finally {
      setSavingGemini(false);
    }
  };

  const saveInstagramApp = async () => {
    if (!instagramAppId.trim() || (!instagramAppSecret.trim() && !instagramStatus.configured)) {
      setInstagramResult('Вставь Meta App ID и App Secret.');
      return;
    }
    setSavingInstagram(true);
    setInstagramResult('');
    try {
      const res = await fetch('/api/instagram/save-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: instagramAppId.trim(),
          appSecret: instagramAppSecret.trim(),
          redirectUri: instagramRedirectUri.trim(),
          scopes: instagramScopes.trim(),
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить Meta App');
      setInstagramAppId('');
      setInstagramAppSecret('');
      setInstagramStatus(data || {});
      setInstagramState(data.connected ? 'connected' : 'partial');
      setInstagramRedirectUri(data.redirectUri || instagramRedirectUri);
      setInstagramScopes(data.scopes || instagramScopes);
      setInstagramResult('Meta App сохранен. Теперь нажми “Подключить Instagram”.');
    } catch (e: any) {
      setInstagramResult(e.message || 'Ошибка сохранения Instagram');
    } finally {
      setSavingInstagram(false);
    }
  };

  const saveInstagramToken = async () => {
    if (!instagramAccessToken.trim()) {
      setInstagramResult('Вставь Instagram Access Token.');
      return;
    }
    setSavingInstagram(true);
    setInstagramResult('');
    try {
      const res = await fetch('/api/instagram/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: instagramAccessToken.trim() }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить Instagram token');
      setInstagramAccessToken('');
      setInstagramStatus(data || {});
      setInstagramState(data.connected ? 'connected' : 'partial');
      setInstagramResult(`Instagram token сохранен: @${data.instagramUsername || data.account?.username || 'аккаунт'}`);
      loadStatuses();
    } catch (e: any) {
      setInstagramResult(e.message || 'Ошибка сохранения Instagram token');
    } finally {
      setSavingInstagram(false);
    }
  };

  const connectInstagram = async () => {
    setInstagramResult('');
    try {
      const res = await fetch('/api/instagram/oauth/start');
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось начать подключение Instagram');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setInstagramResult('Открыл авторизацию Meta. После подтверждения вернись сюда и нажми “Проверить”.');
    } catch (e: any) {
      setInstagramResult(e.message || 'Ошибка подключения Instagram');
    }
  };

  const testInstagram = async () => {
    setCheckingInstagram(true);
    setInstagramResult('');
    try {
      const res = await fetch('/api/instagram/test', { method: 'POST' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось проверить Instagram');
      setInstagramResult(`Instagram работает: @${data.account?.username || instagramStatus.instagramUsername || 'аккаунт'}`);
      loadStatuses();
    } catch (e: any) {
      setInstagramResult(e.message || 'Ошибка проверки Instagram');
    } finally {
      setCheckingInstagram(false);
    }
  };

  const disconnectInstagram = async () => {
    setInstagramResult('');
    try {
      const res = await fetch('/api/instagram/disconnect', { method: 'POST' });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Не удалось отключить Instagram');
      setInstagramResult('Instagram отключен. Meta App остался сохранен.');
      loadStatuses();
    } catch (e: any) {
      setInstagramResult(e.message || 'Ошибка отключения Instagram');
    }
  };

  return (
    <div className="mx-auto max-w-[1760px] px-4 py-8 sm:px-6 xl:px-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9CA3AF]">Центр подключений</p>
          <h1 className="mt-2 text-[34px] font-semibold leading-[40px] tracking-[-0.02em] text-[#1F2937]">API и интеграции</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-5 text-[#6B7280]">
            Все внешние сервисы CRM в одном месте: оплата, доставка, рассылки, бот, чат и AI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={loadStatuses} tone="light">
            <PlugZap className="h-4 w-4" />
            Проверить статусы
          </ActionButton>
          <ActionButton onClick={() => onNavigate?.('finance')} tone="dark">
            <WalletCards className="h-4 w-4" />
            Финансы
          </ActionButton>
        </div>
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ApiCard
          title="Расходы Google Cloud"
          subtitle="Отдельная сводка по хостингу CRM: начисления, период и ближайшее автоматическое списание."
          icon={CalendarClock}
          state={cloudBillingState}
          accent="bg-[#4285F4]"
        >
          {cloudBilling.error ? (
            <p className="rounded-[8px] bg-red-50 px-3 py-2 text-[12px] font-semibold text-[#F06B6B]">{cloudBilling.error}</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <p className={labelClass}>Текущий период</p>
                  <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">
                    {(cloudBilling.currentPeriod?.expense ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {cloudBilling.currency || 'TRY'}
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B7280]">
                    {cloudBilling.currentPeriod?.from || '—'} — {cloudBilling.currentPeriod?.through || '—'}
                  </p>
                </div>
                <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <p className={labelClass}>Прошлый месяц</p>
                  <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">
                    {(cloudBilling.previousPeriod?.expense ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {cloudBilling.currency || 'TRY'}
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B7280]">Август 2026</p>
                </div>
                <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <p className={labelClass}>До оплаты сегодня</p>
                  <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">
                    {(cloudBilling.currentPeriod?.balanceBeforeLatestPayment ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {cloudBilling.currency || 'TRY'}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-[#F5A623]">Оплата ожидает отражения в истории</p>
                </div>
              </div>

              <div className="rounded-[10px] border border-[#DCE8FF] bg-[#F3F7FF] p-4">
                <div className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[#4285F4]" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#1F2937]">График оплаты</p>
                    <p className="mt-1 text-[12px] leading-5 text-[#6B7280]">
                      Следующая месячная дата: <b>{cloudBilling.schedule?.nextMonthlyChargeDate || '—'}</b>. Google может списать раньше, если баланс достигнет порога <b>{cloudBilling.schedule?.thresholdAmount || 500} {cloudBilling.currency || 'TRY'}</b>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280]">
                <span>Проверено: {cloudBilling.verifiedAt ? new Date(cloudBilling.verifiedAt).toLocaleString('ru-RU') : '—'}</span>
                <span className={cn('font-semibold', cloudBilling.sync?.automatic ? 'text-[#2EBA7F]' : 'text-[#F5A623]')}>
                  {cloudBilling.sync?.automatic ? 'Автообновление включено' : 'Снимок из истории платежей'}
                </span>
              </div>
            </div>
          )}
        </ApiCard>

        <ApiCard
          title="Точка Банк"
          subtitle="Рабочее подключение через JWT / API token. QR, счета и финансы используют только этот токен."
          icon={WalletCards}
          state={tochkaState}
          accent="bg-[#1F2937]"
        >
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={labelClass}>Старый способ</p>
                  <h3 className="mt-1 text-[18px] font-semibold text-[#1F2937]">JWT / API token</h3>
                </div>
                <StatusPill state={tochkaState} />
              </div>
              <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
                <div className="space-y-3">
                  <Field label="JWT токен">
                    <textarea value={tochkaToken} onChange={e => setTochkaToken(e.target.value)} placeholder="eyJhbGciOi..." className={textareaClass} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Merchant ID">
                      <input value={tochkaMerchantId} onChange={e => setTochkaMerchantId(e.target.value)} placeholder="MF..." className={inputClass} />
                    </Field>
                    <Field label="Account ID">
                      <input value={tochkaAccountId} onChange={e => setTochkaAccountId(e.target.value)} placeholder="4080.../БИК" className={inputClass} />
                    </Field>
                    <Field label="Legal ID">
                      <input value={tochkaLegalId} onChange={e => setTochkaLegalId(e.target.value)} placeholder="если Точка требует legalId" className={inputClass} />
                    </Field>
                  </div>
                  {tochkaResult && (
                    <p className={cn('text-[12px] font-semibold', tochkaResult.toLowerCase().includes('ошиб') || tochkaResult.includes('Сначала') ? 'text-[#F06B6B]' : 'text-[#2EBA7F]')}>
                      {tochkaResult}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton onClick={saveTochka} disabled={savingTochka || (!tochkaToken.trim() && tochkaState !== 'connected')} tone="light">
                      {savingTochka ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Сохранить старый токен
                    </ActionButton>
                    <ActionButton onClick={checkTochkaJwt} disabled={checkingTochkaJwt || tochkaState === 'missing'} tone="blue">
                      {checkingTochkaJwt ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Проверить JWT
                    </ActionButton>
                    <ActionButton onClick={checkTochkaAccounts} disabled={checkingTochkaAccounts || tochkaState === 'missing'} tone="dark">
                      {checkingTochkaAccounts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                      Проверить счета
                    </ActionButton>
                  </div>
                </div>
                <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <p className={labelClass}>Единый способ</p>
                  <p className="mt-2 text-[13px] font-semibold leading-5 text-[#1F2937]">
                    JWT сейчас главный ключ Точки: через него создаются QR-счета, проверяются оплаты, читаются счета и финансы.
                  </p>
                </div>
              </div>
              {tochkaJwtDiagnostics && (
                <div className="mt-4 rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <p className={labelClass}>customerCode</p>
                      <p className="mt-1 truncate text-[13px] font-semibold text-[#1F2937]">{tochkaJwtDiagnostics.customerCode || 'не найден'}</p>
                    </div>
                    <div>
                      <p className={labelClass}>Срок</p>
                      <p className={cn('mt-1 text-[13px] font-semibold', tochkaJwtDiagnostics.expired ? 'text-[#F06B6B]' : 'text-[#1F2937]')}>
                        {tochkaJwtDiagnostics.expiresAt ? new Date(tochkaJwtDiagnostics.expiresAt).toLocaleString('ru-RU') : 'без exp'}
                      </p>
                    </div>
                    <div>
                      <p className={labelClass}>Merchant</p>
                      <p className="mt-1 text-[13px] font-semibold text-[#1F2937]">{tochkaJwtDiagnostics.merchantConfigured ? 'задан' : 'не задан'}</p>
                    </div>
                    <div>
                      <p className={labelClass}>Account</p>
                      <p className="mt-1 text-[13px] font-semibold text-[#1F2937]">{tochkaJwtDiagnostics.accountConfigured ? 'задан' : 'не задан'}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {(tochkaJwtDiagnostics.tests || []).map((test: any) => (
                      <div key={test.key || test.name} className="flex items-start justify-between gap-3 rounded-[8px] border border-[#E6E9EF] bg-white px-3 py-2">
                        <div>
                          <p className="text-[12px] font-semibold text-[#1F2937]">{test.name}</p>
                          <p className="mt-0.5 text-[11px] font-medium text-[#6B7280]">
                            {test.message}
                            {typeof test.count === 'number' ? ` · найдено: ${test.count}` : ''}
                            {test.status ? ` · HTTP ${test.status}` : ''}
                          </p>
                        </div>
                        <span className={cn(
                          'shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                          test.ok
                            ? 'bg-emerald-50 text-[#2EBA7F]'
                            : test.optional
                              ? 'bg-orange-50 text-[#F5A623]'
                              : 'bg-red-50 text-[#F06B6B]'
                        )}>
                          {test.ok ? 'OK' : test.optional ? 'Опц.' : 'Ошибка'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] font-medium leading-5 text-[#6B7280]">
                    Диагностика не создает счет и не делает возврат. Реальный QR проверяется через создание счета в заказе.
                  </p>
                </div>
              )}
              {tochkaAccountsDiagnostics && (
                <div className="mt-4 rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className={labelClass}>Счета Точки</p>
                      <p className="mt-1 text-[13px] font-semibold text-[#1F2937]">
                        customerCode: {tochkaAccountsDiagnostics.customerCode || 'не найден'} · account: {tochkaAccountsDiagnostics.accountIdConfigured ? 'задан' : 'не задан'}
                      </p>
                    </div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">
                      {tochkaAccountsDiagnostics.period?.dateFrom} - {tochkaAccountsDiagnostics.period?.dateTo}
                    </p>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {(tochkaAccountsDiagnostics.tests || []).map((test: any) => (
                      <div key={test.key || test.name} className="rounded-[8px] border border-[#E6E9EF] bg-white px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[12px] font-semibold text-[#1F2937]">{test.name}</p>
                            <p className="mt-0.5 text-[11px] font-medium text-[#6B7280]">
                              {test.message}
                              {typeof test.count === 'number' ? ` · найдено: ${test.count}` : ''}
                              {test.status ? ` · HTTP ${test.status}` : ''}
                            </p>
                          </div>
                          <span className={cn(
                            'shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                            test.ok
                              ? 'bg-emerald-50 text-[#2EBA7F]'
                              : test.skipped
                                ? 'bg-slate-100 text-[#6B7280]'
                                : 'bg-red-50 text-[#F06B6B]'
                          )}>
                            {test.ok ? 'OK' : test.skipped ? 'Пропуск' : 'Ошибка'}
                          </span>
                        </div>
                        {test.ok && test.sample && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded-[8px] bg-[#F6F7F9] p-2 text-[10px] font-medium text-[#6B7280]">
                            {test.sample}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] font-medium leading-5 text-[#6B7280]">
                    Это только чтение: реквизиты, остаток и выписки. Если везде 403/404, значит Точка выдала права в кабинете, но текущий JWT не имеет доступа к этим методам или у API другой путь.
                  </p>
                </div>
              )}
            </div>
          </div>
        </ApiCard>

        <ApiCard
          title="Яндекс Пэй / Сплит"
          subtitle="Оплата заказа частями через Merchant API. После сохранения Сплит появится в типах оплаты заказа."
          icon={WalletCards}
          state={yandexPayState}
          accent="bg-[#FFCC00] text-[#111827]"
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Merchant ID">
                <input
                  value={yandexPayMerchantId}
                  onChange={e => setYandexPayMerchantId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <Field label="Merchant API key">
                <input
                  value={yandexPayApiKey}
                  onChange={e => setYandexPayApiKey(e.target.value)}
                  placeholder={yandexPayStatus.apiKeySet ? 'Ключ сохранён — оставьте пустым, если не менять' : 'Вставьте выпущенный API key'}
                  type="password"
                  className={inputClass}
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className={labelClass}>Callback URL</p>
                  <p className="mt-2 break-all font-mono text-[12px] font-semibold leading-5 text-[#1F2937]">
                    {yandexPayStatus.callbackUrl || `${window.location.origin}/api/yandex-pay/v1/webhook`}
                  </p>
                </div>
                <ActionButton onClick={copyYandexCallback} tone="light">
                  <Copy className="h-4 w-4" />
                  Копировать
                </ActionButton>
              </div>
            </div>

            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-[10px] border border-[#E6E9EF] bg-white px-4 py-3">
              <span>
                <span className="block text-[13px] font-semibold text-[#1F2937]">Тестовые данные</span>
                <span className="mt-0.5 block text-[11px] font-medium leading-4 text-[#6B7280]">Включайте только для sandbox-ключа Яндекса.</span>
              </span>
              <input
                type="checkbox"
                checked={yandexPaySandbox}
                onChange={e => setYandexPaySandbox(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[#7D7DE6]"
              />
            </label>

            {yandexPayResult && (
              <p className={cn(
                'rounded-[8px] px-3 py-2 text-[12px] font-semibold leading-5',
                yandexPayResult.toLowerCase().includes('ошиб') || yandexPayResult.toLowerCase().includes('отклонил') || yandexPayResult.includes('Выпустите') || yandexPayResult.includes('Укажите')
                  ? 'bg-red-50 text-[#F06B6B]'
                  : 'bg-emerald-50 text-[#2EBA7F]'
              )}>
                {yandexPayResult}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={saveYandexPay} disabled={savingYandexPay} tone="blue">
                {savingYandexPay ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить Яндекс Пэй
              </ActionButton>
              <ActionButton onClick={checkYandexPay} disabled={checkingYandexPay || yandexPayState !== 'connected'} tone="light">
                {checkingYandexPay ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Проверить ключ
              </ActionButton>
            </div>

            <p className="text-[11px] font-medium leading-5 text-[#6B7280]">
              API key хранится на серверной стороне CRM и обратно в браузер не возвращается. Для боевого приёма платежей оставьте «Тестовые данные» выключенными.
            </p>
          </div>
        </ApiCard>

        <ApiCard
          title="СДЭК"
          subtitle="Ключи доставки, отправитель, ПВЗ, создание накладных."
          icon={Truck}
          state={cdekState}
          accent="bg-[#7D7DE6]"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Client ID">
              <input value={cdekClientId} onChange={e => setCdekClientId(e.target.value)} placeholder={cdek.clientIdPreview || 'client_id'} className={inputClass} />
            </Field>
            <Field label="Client Secret">
              <input value={cdekClientSecret} onChange={e => setCdekClientSecret(e.target.value)} placeholder={cdek.configured ? 'оставь пустым, если не менять' : 'client_secret'} type="password" className={inputClass} />
            </Field>
            <Field label="Город отправителя">
              <input value={cdek.senderCity || ''} onChange={e => setCdek(prev => ({ ...prev, senderCity: e.target.value }))} placeholder="Казань" className={inputClass} />
            </Field>
            <Field label="Код города">
              <input value={cdek.senderCityCode || ''} onChange={e => setCdek(prev => ({ ...prev, senderCityCode: Number(e.target.value) || 0 }))} placeholder="424" className={inputClass} />
            </Field>
            <Field label="Отправитель">
              <input value={cdek.senderName || ''} onChange={e => setCdek(prev => ({ ...prev, senderName: e.target.value }))} placeholder="ФИО / бренд" className={inputClass} />
            </Field>
            <Field label="Телефон">
              <input value={cdek.senderPhone || ''} onChange={e => setCdek(prev => ({ ...prev, senderPhone: e.target.value }))} placeholder="+7..." className={inputClass} />
            </Field>
          </div>
          {cdekResult && <p className={cn('mt-3 text-[12px] font-semibold', cdekResult.includes('Ошибка') || cdekResult.includes('Не удалось') ? 'text-[#F06B6B]' : 'text-[#2EBA7F]')}>{cdekResult}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={saveCdek} disabled={savingCdek} tone="blue">
              {savingCdek ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить СДЭК
            </ActionButton>
            <ActionButton onClick={() => onNavigate?.('cdek')} tone="light">
              Открыть СДЭК
              <ChevronRight className="h-4 w-4" />
            </ActionButton>
          </div>
        </ApiCard>

        <ApiCard
          title="Telegram рассылки"
          subtitle={tgText || 'Аккаунты, session-файлы, интервалы и отправка по базе клиентов.'}
          icon={Send}
          state={tgState}
          accent="bg-[#2F7DF6]"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Аккаунты</p>
              <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">{tgState === 'connected' ? 'Готово' : 'Нужны'}</p>
            </div>
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Рассылка v1/v2</p>
              <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">В CRM</p>
            </div>
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Интервалы</p>
              <p className="mt-2 text-[22px] font-semibold text-[#1F2937]">Настр.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => onNavigate?.('broadcast')} tone="dark">
              <Send className="h-4 w-4" />
              Открыть рассылку
            </ActionButton>
            <ActionButton
              onClick={() => {
                window.history.pushState({}, '', '/broadcast/settings');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              tone="light"
            >
              Настройки аккаунтов
              <ExternalLink className="h-4 w-4" />
            </ActionButton>
          </div>
        </ApiCard>

        <ApiCard
          title="Telegram бот"
          subtitle="Меню, каталог, фото, условия пресейла и связь с менеджером."
          icon={Bot}
          state="partial"
          accent="bg-[#1F2937]"
        >
          <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
            <p className={labelClass}>Где настраивать</p>
            <p className="mt-2 text-[13px] leading-5 text-[#6B7280]">
              Кнопки меню, тексты, фото и каталог остаются на странице бота. Здесь показан общий вход в подключение.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => onNavigate?.('bot')} tone="dark">
              <Bot className="h-4 w-4" />
              Открыть бота
            </ActionButton>
          </div>
        </ApiCard>

        <ApiCard
          title="Chatwoot"
          subtitle="Виджет чата и входящие сообщения клиентов."
          icon={MessageCircle}
          state={chatwootState}
          accent="bg-[#2EBA7F]"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Base URL</p>
              <p className="mt-2 truncate text-[13px] font-semibold text-[#1F2937]">{import.meta.env.VITE_CHATWOOT_BASE_URL || 'Не задан'}</p>
            </div>
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Website token</p>
              <p className="mt-2 text-[13px] font-semibold text-[#1F2937]">{import.meta.env.VITE_CHATWOOT_WEBSITE_TOKEN ? 'Задан в env' : 'Не задан'}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[#6B7280]">
            Токены Chatwoot лучше хранить в переменных окружения деплоя. Через браузер их не сохраняю специально.
          </p>
        </ApiCard>

        <ApiCard
          title="Instagram Graph"
          subtitle="Подключение охватов, Reels и статистики Instagram к CRM."
          icon={Instagram}
          state={instagramState}
          accent="bg-[#E4408F]"
        >
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className={labelClass}>Подключение</p>
                  <h3 className="mt-1 text-[18px] font-semibold text-[#1F2937]">Instagram Login Token</h3>
                  <p className="mt-1 text-[12px] leading-5 text-[#6B7280]">
                    Рекомендуемый вариант — токен IGAA… с прямым входом через Instagram. CRM также сохранит поддержку старого EAA… токена.
                  </p>
                </div>
                <span className="rounded-[8px] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">
                  {instagramState === 'connected'
                    ? (instagramStatus.apiMode === 'instagram_login' ? 'Instagram Login' : 'Facebook Login')
                    : 'Нужен Access Token'}
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <Field label="Access Token">
                  <input
                    value={instagramAccessToken}
                    onChange={e => setInstagramAccessToken(e.target.value)}
                    placeholder={instagramStatus.tokenPreview || 'IGAA... / EAA... вставь полностью'}
                    type="password"
                    className={inputClass}
                  />
                </Field>
                <ActionButton onClick={saveInstagramToken} disabled={savingInstagram || !instagramAccessToken.trim()} tone="dark">
                  {savingInstagram ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Сохранить токен
                </ActionButton>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#6B7280]">
                Для IGAA…: instagram_business_basic, instagram_business_manage_messages, instagram_business_manage_comments,
                instagram_business_manage_insights и instagram_business_content_publish.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                <p className={labelClass}>Instagram</p>
                <p className="mt-2 truncate text-[16px] font-semibold text-[#1F2937]">
                  {instagramStatus.instagramUsername ? `@${instagramStatus.instagramUsername}` : 'Не подключен'}
                </p>
              </div>
              <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                <p className={labelClass}>Аудитория / посты</p>
                <p className="mt-2 text-[16px] font-semibold text-[#1F2937]">
                  {(instagramStatus.followersCount || 0).toLocaleString('ru-RU')} / {(instagramStatus.mediaCount || 0).toLocaleString('ru-RU')}
                </p>
              </div>
              <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
                <p className={labelClass}>Токен</p>
                <p className="mt-2 truncate text-[16px] font-semibold text-[#1F2937]">
                  {instagramStatus.tokenPreview || 'Не сохранен'}
                </p>
              </div>
            </div>

            {instagramResult && (
              <p className={cn('text-[12px] font-semibold', instagramResult.toLowerCase().includes('ошиб') || instagramResult.toLowerCase().includes('invalid') || instagramResult.includes('Вставь') || instagramResult.includes('Не удалось') ? 'text-[#F06B6B]' : 'text-[#2EBA7F]')}>
                {instagramResult}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={testInstagram} disabled={checkingInstagram || instagramState !== 'connected'} tone="light">
                {checkingInstagram ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Проверить
              </ActionButton>
              <ActionButton onClick={disconnectInstagram} disabled={instagramState !== 'connected'} tone="light">
                Отключить
              </ActionButton>
            </div>
          </div>
        </ApiCard>

        <ApiCard
          title="AI / Gemini"
          subtitle="Генерация вариантов сообщений, подсказки и контентные задачи."
          icon={Sparkles}
          state={geminiState}
          accent="bg-[#7D7DE6]"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Gemini API Key">
              <input value={geminiKey} onChange={e => setGeminiKey(e.target.value)} placeholder="AIzaSy..." type="password" className={inputClass} />
            </Field>
            <ActionButton onClick={saveGemini} disabled={savingGemini || !geminiKey.trim()} tone="blue">
              {savingGemini ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Сохранить
            </ActionButton>
          </div>
          {geminiResult && <p className={cn('mt-3 text-[12px] font-semibold', geminiResult.includes('Ошибка') ? 'text-[#F06B6B]' : 'text-[#2EBA7F]')}>{geminiResult}</p>}
        </ApiCard>

        <ApiCard
          title="Google / Firebase"
          subtitle="Авторизация, Firestore, справочники, заказы и хранение данных CRM."
          icon={ShieldCheck}
          state="connected"
          accent="bg-[#1F2937]"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Auth</p>
              <p className="mt-2 text-[16px] font-semibold text-[#1F2937]">Работает</p>
            </div>
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Firestore</p>
              <p className="mt-2 text-[16px] font-semibold text-[#1F2937]">CRM база</p>
            </div>
            <div className="rounded-[10px] border border-[#E6E9EF] bg-[#F6F7F9] p-4">
              <p className={labelClass}>Таблицы</p>
              <p className="mt-2 text-[16px] font-semibold text-[#1F2937]">Только импорт/выгрузка</p>
            </div>
          </div>
        </ApiCard>
      </div>
    </div>
  );
};
