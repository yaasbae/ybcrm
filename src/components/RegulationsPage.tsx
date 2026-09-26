import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Contact,
  Factory,
  Home,
  Search,
  ShoppingBag,
  Truck,
  UserRoundCheck,
} from 'lucide-react';
import { cn } from '../lib/utils';

type RegulationBlock = {
  title: string;
  description?: string;
  steps: string[];
  note?: string;
};

type RegulationArticle = {
  id: string;
  group: string;
  title: string;
  summary: string;
  icon: React.ElementType;
  accent: string;
  blocks: RegulationBlock[];
};

const ARTICLES: RegulationArticle[] = [
  {
    id: 'manager',
    group: 'Роли',
    title: 'Работа менеджера',
    summary: 'Ежедневный цикл: обращения, клиенты, заказы, оплаты и следующий контакт.',
    icon: UserRoundCheck,
    accent: 'bg-violet-50 text-violet-700',
    blocks: [
      {
        title: 'Начало рабочего дня',
        description: 'Сначала разберите то, что уже требует внимания, затем переходите к новым обращениям.',
        steps: [
          'Откройте «Заказы» и нажмите «Начать смену».',
          'Проверьте заказы, которые ждут оплаты, доплаты или следующего действия.',
          'Откройте «Клиенты» и найдите контакты без свежего касания.',
          'Проверьте новые сообщения во вкладке «Соцсети».',
        ],
      },
      {
        title: 'Работа с новым обращением',
        steps: [
          'Найдите клиента по телефону или имени, чтобы не создавать дубль.',
          'Уточните изделие, цвет, размер, рост, способ доставки и оплаты.',
          'Зафиксируйте договорённость и следующий шаг в карточке клиента.',
          'Когда клиент готов покупать, создайте заказ и проверьте все поля перед отправкой счёта.',
        ],
        note: 'Не переносите договорённости только в личные сообщения: история должна оставаться в CRM.',
      },
      {
        title: 'Контроль заказа',
        steps: [
          'После отправки ссылки убедитесь, что оплата подтверждена в CRM.',
          'Меняйте статус только по фактическому этапу заказа.',
          'Перед передачей в производство проверьте состав заказа и параметры изделия.',
          'После отправки внесите данные доставки и сообщите клиенту трек-номер.',
        ],
      },
      {
        title: 'Завершение дня',
        steps: [
          'У каждого активного клиента должен быть понятный следующий шаг.',
          'Проверьте, что нет новых сообщений без ответа и оплат без обработки.',
          'Не оставляйте заказы в промежуточном статусе без пояснения в истории.',
        ],
      },
    ],
  },
  {
    id: 'home',
    group: 'Вкладки CRM',
    title: 'Главная',
    summary: 'Быстрый обзор плана продаж, маркетинга, производства и активности.',
    icon: Home,
    accent: 'bg-slate-100 text-slate-700',
    blocks: [
      {
        title: 'Для чего нужна',
        steps: [
          'Оценить выполнение плана продаж за выбранный месяц.',
          'Увидеть общую картину по маркетингу и производству.',
          'Проверить календарь активности перед началом операционной работы.',
        ],
        note: 'Главная показывает сводку. Исправлять первичные данные нужно в профильной вкладке.',
      },
    ],
  },
  {
    id: 'clients',
    group: 'Вкладки CRM',
    title: 'Клиенты',
    summary: 'Карточки клиентов, контакты, касания, рассылки и история заказов.',
    icon: Contact,
    accent: 'bg-sky-50 text-sky-700',
    blocks: [
      {
        title: 'Как работать',
        steps: [
          'Перед созданием клиента выполните поиск по телефону и имени.',
          'Проверьте контакты и историю заказов перед новым сообщением.',
          'После звонка или переписки зафиксируйте результат касания.',
          'Запишите конкретный следующий шаг, если вопрос не закрыт.',
        ],
      },
      {
        title: 'Минимум в карточке',
        steps: [
          'Актуальные имя и способ связи.',
          'История договорённостей без лишних персональных данных.',
          'Связанные заказы и последний результат общения.',
        ],
      },
    ],
  },
  {
    id: 'orders',
    group: 'Вкладки CRM',
    title: 'Заказы',
    summary: 'Продажи, состав заказа, счета, оплаты, производство и доставка.',
    icon: ShoppingBag,
    accent: 'bg-emerald-50 text-emerald-700',
    blocks: [
      {
        title: 'Создание заказа',
        steps: [
          'Выберите существующего клиента или заполните контактные данные.',
          'Укажите изделие и все параметры, согласованные с клиентом.',
          'Проверьте сумму, тип оплаты и способ доставки.',
          'Создайте заказ и только после проверки отправьте клиенту ссылку или QR-код.',
        ],
      },
      {
        title: 'Статусы и оплата',
        steps: [
          'Не отмечайте оплату вручную без подтверждения операции.',
          'После предоплаты контролируйте сумму и срок доплаты.',
          'Не переводите заказ дальше, пока обязательные данные не заполнены.',
          'При изменении заказа проверьте, не изменились ли сумма, производство и доставка.',
        ],
        note: 'Повторное нажатие на создание счёта или накладной используйте только после проверки текущего состояния.',
      },
    ],
  },
  {
    id: 'production',
    group: 'Вкладки CRM',
    title: 'Производство',
    summary: 'Передача изделия в работу и контроль фактического этапа изготовления.',
    icon: Factory,
    accent: 'bg-amber-50 text-amber-700',
    blocks: [
      {
        title: 'Правила передачи',
        steps: [
          'Передавайте заказ только с заполненными параметрами изделия.',
          'Проверьте, что цвет, размер, рост, нанесение и комментарий не противоречат друг другу.',
          'Меняйте этап по факту выполнения, а не заранее.',
          'Если есть проблема, зафиксируйте её в CRM и сообщите ответственному.',
        ],
      },
    ],
  },
  {
    id: 'stock',
    group: 'Вкладки CRM',
    title: 'Склад и справочник',
    summary: 'Карточки продукции и единые значения для заполнения заказов.',
    icon: Boxes,
    accent: 'bg-orange-50 text-orange-700',
    blocks: [
      {
        title: 'Склад',
        steps: [
          'Проверяйте карточку товара перед обещанием наличия клиенту.',
          'Заполняйте характеристики и остатки в одной карточке, не создавая дублей.',
          'Ссылку на товар копируйте из карточки продукции.',
        ],
      },
      {
        title: 'Справочник',
        steps: [
          'Добавляйте новое значение только после проверки, что такого варианта ещё нет.',
          'Используйте единое написание цветов, размеров, источников и способов оплаты.',
          'Не удаляйте используемое значение без согласования: оно может быть связано со старыми заказами.',
        ],
      },
    ],
  },
  {
    id: 'delivery',
    group: 'Вкладки CRM',
    title: 'СДЭК и отправка',
    summary: 'Создание накладной, проверка получателя и передача трек-номера.',
    icon: Truck,
    accent: 'bg-blue-50 text-blue-700',
    blocks: [
      {
        title: 'Перед созданием накладной',
        steps: [
          'Сверьте ФИО, телефон, город и выбранный способ получения.',
          'Проверьте состав отправления, вес и объявленную стоимость.',
          'Создавайте повторную накладную только если предыдущая действительно не подходит.',
          'После создания сохраните трек-номер в заказе и отправьте его клиенту.',
        ],
      },
    ],
  },
  {
    id: 'analytics',
    group: 'Контроль',
    title: 'Аналитика и финансы',
    summary: 'Проверка результатов и поиск расхождений в исходных данных.',
    icon: BarChart3,
    accent: 'bg-rose-50 text-rose-700',
    blocks: [
      {
        title: 'Как использовать',
        steps: [
          'Всегда проверяйте выбранный месяц перед чтением показателей.',
          'Если цифра выглядит неверно, найдите исходные заказы и оплаты.',
          'Не исправляйте итоговую цифру вручную вместо первичной записи.',
          'Финансовые расхождения передавайте владельцу с номером заказа и описанием проблемы.',
        ],
      },
    ],
  },
];

const groupOrder = ['Роли', 'Вкладки CRM', 'Контроль'];

export const RegulationsPage: React.FC = () => {
  const [activeId, setActiveId] = useState('manager');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase('ru');

  const filteredArticles = useMemo(() => {
    if (!query) return ARTICLES;
    return ARTICLES.filter((article) => [
      article.title,
      article.summary,
      article.group,
      ...article.blocks.flatMap((block) => [block.title, block.description || '', block.note || '', ...block.steps]),
    ].join(' ').toLocaleLowerCase('ru').includes(query));
  }, [query]);

  const selectedArticle = ARTICLES.find((article) => article.id === activeId) || ARTICLES[0];
  const activeArticle = query && filteredArticles.length > 0 && !filteredArticles.some((article) => article.id === activeId)
    ? filteredArticles[0]
    : selectedArticle;
  const groupedArticles = groupOrder
    .map((group) => ({ group, articles: filteredArticles.filter((article) => article.group === group) }))
    .filter(({ articles }) => articles.length > 0);

  const openArticle = (articleId: string) => {
    setActiveId(articleId);
    if (window.innerWidth < 1024) {
      window.requestAnimationFrame(() => document.getElementById('regulation-article')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-3xl border border-[#E6E9EF] bg-white shadow-[0_16px_50px_rgba(31,41,55,0.06)]">
        <header className="border-b border-[#E6E9EF] bg-gradient-to-br from-white via-white to-violet-50/70 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1F2937] text-white shadow-sm">
                <BookOpen size={20} />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-600">База знаний YBCRM</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#1F2937] sm:text-3xl">Регламенты работы</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#6B7280]">Пошаговые инструкции по ролям и вкладкам CRM. Начните с регламента своей работы, затем откройте нужный раздел.</p>
            </div>
            <label className="relative block w-full md:max-w-sm">
              <span className="sr-only">Поиск по регламентам</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти инструкцию..."
                className="h-12 w-full rounded-2xl border border-[#DDE2EA] bg-white pl-11 pr-4 text-sm text-[#1F2937] outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </label>
          </div>
        </header>

        <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-[#E6E9EF] bg-[#F8F9FB] p-4 lg:border-b-0 lg:border-r lg:p-5" aria-label="Разделы регламентов">
            {groupedArticles.length > 0 ? (
              <div className="space-y-5">
                {groupedArticles.map(({ group, articles }) => (
                  <div key={group}>
                    <p className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#98A2B3]">{group}</p>
                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
                      {articles.map((article) => {
                        const Icon = article.icon;
                        const isActive = article.id === activeArticle.id;
                        return (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() => openArticle(article.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                              'group flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
                              isActive
                                ? 'border-[#D8D5FF] bg-white text-[#1F2937] shadow-sm'
                                : 'border-transparent text-[#667085] hover:border-[#E6E9EF] hover:bg-white',
                            )}
                          >
                            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', article.accent)}><Icon size={17} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-semibold">{article.title}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-[#98A2B3]">{article.summary}</span>
                            </span>
                            <ChevronRight size={14} className={cn('shrink-0 transition-transform', isActive ? 'text-violet-500' : 'text-[#D0D5DD] group-hover:translate-x-0.5')} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#D0D5DD] bg-white p-5 text-center">
                <Search className="mx-auto h-5 w-5 text-[#98A2B3]" />
                <p className="mt-2 text-xs font-semibold text-[#667085]">Ничего не найдено</p>
                <button type="button" onClick={() => setSearch('')} className="mt-3 text-[11px] font-semibold text-violet-600 hover:text-violet-800">Сбросить поиск</button>
              </div>
            )}
          </aside>

          <article id="regulation-article" className="min-w-0 scroll-mt-20 p-5 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start gap-4">
                <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', activeArticle.accent)}><activeArticle.icon size={22} /></span>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#98A2B3]">{activeArticle.group}</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#1F2937] sm:text-2xl">{activeArticle.title}</h2>
                  <p className="mt-2 break-words text-sm leading-6 text-[#667085]">{activeArticle.summary}</p>
                </div>
              </div>

              <div className="mt-8 space-y-5">
                {activeArticle.blocks.map((block, blockIndex) => (
                  <section key={block.title} className="rounded-3xl border border-[#E6E9EF] bg-white p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1F2937] text-[11px] font-semibold text-white">{blockIndex + 1}</span>
                      <h3 className="text-sm font-semibold text-[#1F2937]">{block.title}</h3>
                    </div>
                    {block.description && <p className="mt-3 text-[13px] leading-6 text-[#667085]">{block.description}</p>}
                    <ol className="mt-4 space-y-3">
                      {block.steps.map((step) => (
                        <li key={step} className="flex gap-3 text-[13px] leading-5 text-[#475467]">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          <span className="min-w-0 break-words">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {block.note && (
                      <div className="mt-5 flex gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <p>{block.note}</p>
                      </div>
                    )}
                  </section>
                ))}
              </div>

              <footer className="mt-6 flex items-start gap-3 rounded-3xl bg-[#1F2937] p-5 text-white sm:p-6">
                <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                <div>
                  <p className="text-sm font-semibold">Главное правило CRM</p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-300">Данные должны отражать реальную ситуацию: актуальный статус, подтверждённую оплату и понятный следующий шаг. Если сомневаетесь — не меняйте финансовые данные и уточните у ответственного.</p>
                </div>
              </footer>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
};
