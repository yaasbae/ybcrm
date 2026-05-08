import React, { Component, ReactNode, ErrorInfo, useState, useEffect, lazy, Suspense } from "react";
const UnitCalculator = lazy(() => import("./components/UnitCalculator"));
const AnalyticsDashboard = lazy(() => import("./components/AnalyticsDashboard").then(m => ({ default: m.AnalyticsDashboard })));
const OrdersPage = lazy(() => import("./components/OrdersPage").then(m => ({ default: m.OrdersPage })));
const ClientsPage = lazy(() => import("./components/ClientsPage").then(m => ({ default: m.ClientsPage })));
const MarketingPage = lazy(() => import("./components/MarketingPage").then(m => ({ default: m.MarketingPage })));
const Home = lazy(() => import("./components/Home").then(m => ({ default: m.Home })));
const OrderForm = lazy(() => import("./components/OrderForm").then(m => ({ default: m.OrderForm })));
const Products = lazy(() => import("./components/Products").then(m => ({ default: m.Products })));
const AISalesAgent = lazy(() => import("./components/AISalesAgent").then(m => ({ default: m.AISalesAgent })));
const PublicProductView = lazy(() => import("./components/PublicProductView").then(m => ({ default: m.PublicProductView })));
const FinanceDashboard = lazy(() => import("./components/FinanceDashboard").then(m => ({ default: m.FinanceDashboard })));
const HandbookPage = lazy(() => import("./components/HandbookPage").then(m => ({ default: m.HandbookPage })));
const BroadcastPage = lazy(() => import("./components/BroadcastPage").then(m => ({ default: m.BroadcastPage })));
const BotPage = lazy(() => import("./components/BotPage").then(m => ({ default: m.BotPage })));
const ContentPage = lazy(() => import("./components/ContentPage").then(m => ({ default: m.ContentPage })));
const PaymentPage = lazy(() => import("./components/PaymentPage").then(m => ({ default: m.PaymentPage })));
import { auth, signInWithGoogle, signInWithEmail, logOut } from "./firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { cn } from "./lib/utils";
import {
  LogIn, LogOut, User as UserIcon, AlertCircle,
  DollarSign, Calculator, LayoutDashboard, Package, Bot, ShoppingBag,
  UserCircle, Star, Calendar as CalendarIcon, BookOpen, Send, Sparkles
} from "lucide-react";
import { motion } from "motion/react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD] p-4 text-center font-sans">
          <div className="max-w-md space-y-6">
            <h1 className="text-3xl font-semibold tracking-tight">Системная ошибка</h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              Произошла непредвиденная ошибка в системе. Мы уже работаем над исправлением.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-slate-900 text-white px-8 py-3 rounded-full font-medium text-sm hover:bg-slate-800 transition-colors shadow-sm"
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [view, setView] = useState<'home' | 'calculator' | 'analytics' | 'orders' | 'clients' | 'marketing' | 'order-form' | 'products' | 'ai-agent' | 'public-product' | 'public-payment' | 'finance' | 'handbook' | 'broadcast' | 'bot' | 'content'>('home');
  const [publicProductId, setPublicProductId] = useState<string | null>(null);
  const [publicPaymentOrderId, setPublicPaymentOrderId] = useState<string | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<string>('1xTDxiOMqJR-KBnLdbikKp2--ZBQBDkII-xMCoO2lSbM');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [initialClient, setInitialClient] = useState<any>(null);
  const [theme, setTheme] = useState<'grey' | 'pink'>('grey');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    // Check for public product link in URL
    const path = window.location.pathname;
    if (path.startsWith('/product/')) {
      const id = path.split('/product/')[1];
      if (id) {
        setPublicProductId(id);
        setView('public-product');
      }
    }
    if (path.startsWith('/pay/')) {
      const id = path.split('/pay/')[1];
      if (id) {
        setPublicPaymentOrderId(id);
        setView('public-payment');
      }
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleNavigate = (newView: 'calculator' | 'analytics' | 'orders' | 'clients' | 'marketing' | 'order-form' | 'products' | 'ai-agent' | 'finance' | 'handbook' | 'broadcast' | 'bot' | 'content', clientData?: any) => {
    if (clientData) setInitialClient(clientData);
    else setInitialClient(null);
    setView(newView);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBFBFD]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
      </div>
    );
  }

  // Bypass auth for public product links
  if (view === 'public-product' && publicProductId) {
    return (
      <ErrorBoundary>
        <main className="min-h-screen">
          <PublicProductView productId={publicProductId} />
        </main>
      </ErrorBoundary>
    );
  }

  // Bypass auth for public payment page
  if (view === 'public-payment' && publicPaymentOrderId) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" /></div>}>
          <PaymentPage orderId={publicPaymentOrderId} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4 font-sans">
        <div className="max-w-[340px] w-full bg-white p-8 rounded-2xl border border-zinc-100 shadow-xl space-y-6 text-center">
          <div className="w-14 h-14 bg-zinc-900 rounded-xl flex items-center justify-center mx-auto text-white">
            <UserIcon size={28} />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight uppercase">YBCRM</h1>
            <p className="text-zinc-400 font-medium text-[10px] uppercase tracking-wider">Система управления брендом</p>
          </div>
          
          <div className="space-y-3">
            {/* Email/Password form */}
            <div className="space-y-2">
              <input
                type="email"
                placeholder="Email (например manager@ybcrm.ru)"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all"
              />
              <input
                type="password"
                placeholder="Пароль"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && emailInput && passwordInput) {
                    setEmailLoading(true);
                    setAuthError(null);
                    try {
                      await signInWithEmail(emailInput, passwordInput);
                    } catch (err: any) {
                      setAuthError("Неверный email или пароль.");
                    } finally {
                      setEmailLoading(false);
                    }
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all"
              />
              <button
                onClick={async () => {
                  if (!emailInput || !passwordInput) return;
                  setEmailLoading(true);
                  setAuthError(null);
                  try {
                    await signInWithEmail(emailInput, passwordInput);
                  } catch (err: any) {
                    setAuthError("Неверный email или пароль.");
                  } finally {
                    setEmailLoading(false);
                  }
                }}
                disabled={emailLoading || !emailInput || !passwordInput}
                className="w-full bg-zinc-900 text-white py-3 rounded-xl font-semibold text-[11px] uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-40"
              >
                <LogIn size={16} />
                {emailLoading ? 'Вход...' : 'Войти'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-zinc-100" />
              <span className="text-[9px] text-zinc-300 font-bold uppercase tracking-widest">или</span>
              <div className="flex-1 h-px bg-zinc-100" />
            </div>

            <button
              onClick={async () => {
                try {
                  setAuthError(null);
                  await signInWithGoogle();
                } catch (err: any) {
                  console.error("Auth error:", err);
                  if (err.message?.includes('missing initial state') || err.code === 'auth/internal-error') {
                    setAuthError("Ошибка безопасности браузера. Откройте сайт в новой вкладке.");
                  } else {
                    setAuthError("Не удалось войти через Google.");
                  }
                }
              }}
              className="w-full bg-white border border-zinc-200 text-zinc-700 py-2.5 rounded-xl font-semibold text-[11px] uppercase tracking-widest hover:bg-zinc-50 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Google
            </button>

            {authError && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-left">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-[10px] text-red-600 font-bold leading-tight uppercase tracking-tight">{authError}</p>
              </div>
            )}
          </div>

          <p className="text-[9px] text-zinc-300 font-medium uppercase tracking-[0.2em] pt-2">© 2026 YBCRM BRAND</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen font-sans" style={{ backgroundColor: 'var(--bg)' }}>
        <header className="sticky top-0 z-[100] h-12" style={{ backgroundColor: 'var(--card-bg)', borderBottom: '1px solid var(--card-border)' }}>
          <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 cursor-pointer shrink-0" onClick={() => setView('home')}>
                <div className="w-7 h-7 bg-zinc-900 rounded-lg flex items-center justify-center text-white font-semibold text-[10px]">Y.</div>
                <span className="hidden md:inline text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--text)' }}>YBCRM</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Theme Toggle */}
              <div className="flex items-center gap-1 p-1 rounded-lg border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--card-border)' }}>
                <button 
                  onClick={() => setTheme('grey')}
                  className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${theme === 'grey' ? 'shadow-sm ring-1 ring-zinc-200' : 'hover:opacity-80'}`}
                  style={{ backgroundColor: theme === 'grey' ? 'var(--card-bg)' : 'transparent' }}
                  title="Grey Theme"
                >
                  <div className="w-3 h-3 rounded-full bg-zinc-400" />
                </button>
                <button 
                  onClick={() => setTheme('pink')}
                  className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${theme === 'pink' ? 'shadow-sm ring-1 ring-pink-200' : 'hover:opacity-80'}`}
                  style={{ backgroundColor: theme === 'pink' ? 'var(--card-bg)' : 'transparent' }}
                  title="Pink Theme"
                >
                  <div className="w-3 h-3 rounded-full bg-pink-500" />
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-2 px-2 py-0.5 rounded-full border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--card-border)' }}>
                {user.photoURL && <img src={user.photoURL} alt="User" className="w-4 h-4 rounded-full" />}
                <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{user.displayName || user.email}</span>
              </div>
              <button 
                onClick={logOut}
                className="p-1.5 hover:bg-red-50 text-zinc-400 hover:text-red-500 rounded-lg transition-colors"
                title="Выйти"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-48px)]">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" /></div>}>
          <div className="max-w-5xl mx-auto px-4 pt-6 space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">YBCRM Brand</h1>
                <div className="h-px w-8 bg-slate-100 hidden sm:block" />
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <CalendarIcon className="w-2.5 h-2.5" />
                <input 
                  type="month" 
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-transparent text-[9px] font-bold uppercase tracking-tighter focus:outline-none cursor-pointer hover:text-slate-900 transition-colors"
                />
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-5 sm:flex sm:flex-wrap gap-1 justify-center sm:justify-end bg-white p-1 rounded-xl border border-slate-100 shadow-sm"
            >
              {[
                { id: 'home',      label: 'Главная',  icon: LayoutDashboard },
                { id: 'calculator',label: 'Юнит',     icon: Calculator },
                { id: 'finance',   label: 'Финансы',  icon: DollarSign },
                { id: 'analytics', label: 'Аналит.',  icon: LayoutDashboard },
                { id: 'orders',    label: 'Заказы',   icon: ShoppingBag },
                { id: 'clients',   label: 'Клиент.',  icon: UserCircle },
                { id: 'marketing', label: 'Маркет.',  icon: Star },
                { id: 'products',  label: 'Склад',    icon: Package },
                { id: 'handbook',  label: 'Справ.',   icon: BookOpen },
                { id: 'broadcast', label: 'Рассыл.',  icon: Send },
                { id: 'bot',       label: 'Бот',       icon: Bot },
                { id: 'content',   label: 'Контент',   icon: Sparkles },
                { id: 'ai-agent',  label: 'ИИ',       icon: Bot, special: true },
              ].map((item, idx) => {
                const isActive = item.id === view;
                return (
                  <button
                    key={idx}
                    onClick={() => handleNavigate(item.id as any)}
                    className={cn(
                      "flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 h-9 sm:h-7 px-1 sm:px-2.5 rounded-lg text-[7px] sm:text-[9px] font-bold uppercase transition-all active:scale-95",
                      item.special
                        ? "bg-purple-600 text-white border-transparent hover:bg-purple-700"
                        : isActive
                          ? "bg-zinc-900 text-white border-transparent"
                          : "bg-zinc-50/50 sm:bg-transparent text-slate-600 hover:bg-zinc-50 border border-transparent sm:border-slate-100"
                    )}
                  >
                    <item.icon size={11} className={cn("shrink-0", (isActive || item.special) ? "text-white" : "text-slate-400")} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </motion.div>
          </div>

          {view === 'home' && (
            <Home 
              sheetId={activeSheetId} 
              onNavigate={handleNavigate}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}
          
          {view === 'calculator' && (
            <UnitCalculator
              onNavigateToAnalytics={(id) => {
                setActiveSheetId(id);
                setView('analytics');
              }}
              onBack={() => setView('home')}
            />
          )}

          {view === 'analytics' && (
            <AnalyticsDashboard
              sheetId={activeSheetId}
              initialTab="analytics"
              onBack={() => setView('home')}
              onNavigate={handleNavigate}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}

          {view === 'orders' && (
            <OrdersPage
              sheetId={activeSheetId}
              onBack={() => setView('home')}
              onNavigate={handleNavigate}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}

          {view === 'clients' && (
            <ClientsPage
              sheetId={activeSheetId}
              onBack={() => setView('home')}
              onNavigate={handleNavigate}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}

          {view === 'marketing' && (
            <MarketingPage
              sheetId={activeSheetId}
              onBack={() => setView('home')}
              onNavigate={handleNavigate}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}

          {view === 'order-form' && (
            <OrderForm 
              sheetId={activeSheetId}
              onBack={() => setView('home')}
              initialClient={initialClient}
            />
          )}

          {view === 'products' && (
            <Products 
              onBack={() => setView('home')}
            />
          )}

          {view === 'ai-agent' && (
            <AISalesAgent onBack={() => setView('home')} />
          )}

          {view === 'finance' && (
            <FinanceDashboard onBack={() => setView('home')} />
          )}

          {view === 'handbook' && (
            <HandbookPage />
          )}

          {view === 'broadcast' && (
            <BroadcastPage sheetId={activeSheetId} />
          )}

          {view === 'bot' && (
            <BotPage />
          )}

          {view === 'content' && (
            <ContentPage />
          )}

          {view === 'public-product' && publicProductId && (
            <PublicProductView productId={publicProductId} />
          )}
          </Suspense>
        </main>
      </div>
    </ErrorBoundary>
  );
}
