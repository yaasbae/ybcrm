import React, { useEffect, useMemo, useState } from 'react';
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
  FileSignature,
  Home,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Search,
  Save,
  ShoppingBag,
  Trash2,
  Truck,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { createRegulationId, RegulationData, validateRegulation } from '../lib/regulations';
import { crmFetch } from '../lib/crmApi';

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

const toData = (article: RegulationArticle): RegulationData => ({
  id: article.id,
  group: article.group,
  title: article.title,
  summary: article.summary,
  blocks: article.blocks.map((block) => ({ ...block, steps: [...block.steps] })),
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character] || character));

function openPrintDocument(title: string, body: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Разрешите всплывающие окна для печати');
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px/1.55 Arial,sans-serif;color:#182230;max-width:820px;margin:40px auto;padding:0 28px}h1{font-size:25px;margin:0 0 8px}h2{font-size:17px;margin:28px 0 8px}p{margin:6px 0}li{margin:6px 0}.muted{color:#667085}.note{background:#fff7df;padding:12px 14px;border-radius:8px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:44px;margin-top:54px}.line{border-top:1px solid #667085;padding-top:6px;margin-top:42px;font-size:12px;color:#667085}@media print{body{margin:0;max-width:none}.page-break{break-before:page}}</style></head><body>${body}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`);
  printWindow.document.close();
}

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
    id: 'cdek-instruction',
    group: 'Интеграции',
    title: 'Инструкция по СДЭК',
    summary: 'Что нажимать при создании, изменении, удалении и возврате посылки.',
    icon: Truck,
    accent: 'bg-blue-50 text-blue-700',
    blocks: [
      {
        title: '1. Создание накладной',
        steps: [
          'Откройте заказ и до создания накладной проверьте ФИО, телефон, город, адрес или ПВЗ, состав заказа и вес.',
          'Проверьте блок оплаты. Если при получении клиент должен доплатить, включите наложенный платёж ровно на сумму остатка.',
          'Создайте накладную один раз и убедитесь, что в карточке появился номер СДЭК.',
          'Передайте клиенту трек-номер только после проверки данных накладной.',
        ],
        note: 'Не создавайте второй заказ или накладную с другим номером, если в первой допущена ошибка.',
      },
      {
        title: '2. Исправление до передачи посылки',
        steps: [
          'Нажмите «Изменить» в блоке СДЭК и исправьте нужные данные существующей накладной.',
          'Если заказ полностью отменён, нажмите «Удалить заказ». CRM сначала удалит накладную в СДЭК, затем сам заказ.',
          'Если СДЭК не подтвердил удаление накладной, заказ останется в CRM — передайте номер заказа администратору.',
          'После исправления снова откройте карточку и проверьте номер, адрес и сумму наложенного платежа.',
        ],
      },
      {
        title: '3. Изменение адреса или ПВЗ в пути',
        steps: [
          'Нажмите «Изменить», выберите новый город, адрес или ПВЗ.',
          'Нажмите отдельную кнопку «Изменить адрес или ПВЗ посылки в пути». Обычная кнопка сохранения для отправленной посылки не используется.',
          'CRM проверит фактический статус в СДЭК. Если изменение допустимо, запрос уйдёт в СДЭК.',
          'Обновите карточку и проверьте, что новый адрес принят. До подтверждения не обещайте клиенту изменение.',
        ],
      },
      {
        title: '4. Неоплаченная посылка',
        steps: [
          'До передачи посылки нажмите «Включить наложенный платёж» — CRM подставит неоплаченный остаток.',
          'Проверьте сумму в блоке СДЭК. Именно эту сумму СДЭК потребует при выдаче.',
          'Если клиент позже оплатил остаток через Точка Банк, нажмите «Снять наложенный платёж» и проверьте результат.',
          'Статус «не оплачен» внутри CRM сам по себе не запрещает СДЭК выдать посылку.',
        ],
        note: 'Чтобы неоплаченную посылку не выдали бесплатно, в накладной обязательно должен стоять наложенный платёж.',
      },
      {
        title: '5. Возврат и продление хранения',
        steps: [
          'Для окончательного возврата нажмите «Отказ и возврат посылки» и внимательно подтвердите действие.',
          'После принятия команды СДЭК начинает возврат отправителю. Отменой или временной паузой эта команда не является.',
          'Продление срока хранения оформляется отдельно через СДЭК и может быть платным.',
          'Продление хранения не заменяет наложенный платёж и не запрещает клиенту забрать посылку.',
        ],
      },
    ],
  },
  {
    id: 'cdek-regulation',
    group: 'Интеграции',
    title: 'Регламент CRM ↔ СДЭК',
    summary: 'Кто и что делает, какие операции разрешены и как не создать дубль или двойную оплату.',
    icon: ClipboardCheck,
    accent: 'bg-indigo-50 text-indigo-700',
    blocks: [
      {
        title: 'Главное правило',
        steps: [
          'Один заказ CRM соответствует одной действующей накладной СДЭК.',
          'Номер заказа CRM является номером ИМ в СДЭК. Менеджер не меняет его и не дописывает суффиксы вручную.',
          'Все операции выполняются из карточки заказа CRM, а не созданием дубликата в личном кабинете СДЭК.',
          'Перед опасной операцией CRM проверяет живой статус СДЭК и меняет свои данные только после успешного ответа.',
        ],
      },
      {
        title: 'Что разрешено по статусам',
        steps: [
          'Создана, но не передана СДЭК: можно изменить или удалить накладную.',
          'Принята СДЭК или в пути: удалить накладную нельзя; адрес или ПВЗ меняются только отдельной командой.',
          'В пути или готова к выдаче: отказ используется только для окончательного возврата отправителю.',
          'Получена, удалена или возвращена: любые изменения блокируются.',
        ],
      },
      {
        title: 'Ответственность за оплату',
        steps: [
          'Менеджер перед отправкой проверяет подтверждённую оплату и остаток в CRM.',
          'Если остаток платится при получении, менеджер включает наложенный платёж до передачи посылки.',
          'Если остаток оплачен онлайн, менеджер снимает наложенный платёж, чтобы исключить двойную оплату.',
          'Упаковщик перед передачей СДЭК сверяет номер заказа, получателя, адрес/ПВЗ и наличие наложенного платежа.',
        ],
      },
      {
        title: 'Удаление и возврат',
        steps: [
          'Неотправленный заказ удаляет менеджер: CRM автоматически удаляет связанную накладную в СДЭК.',
          'Отправленный заказ не удаляется. При необходимости используется «Отказ и возврат посылки».',
          'После запроса возврата заказ остаётся в CRM со статусом «Возврат» до завершения движения.',
          'Все удаления, изменения доставки, возвраты и изменения наложенного платежа фиксируются в аудите.',
        ],
      },
      {
        title: 'Если возникла ошибка или расхождение',
        steps: [
          'Не создавайте новую накладную и не меняйте номер заказа вручную.',
          'Обновите статус СДЭК в карточке заказа и повторите операцию один раз.',
          'Если ошибка осталась, отправьте администратору номер заказа, текст ошибки и что именно пытались сделать.',
          'До исправления расхождения ориентируйтесь на фактическое состояние отправления в СДЭК.',
        ],
        note: 'Запрещено обходить ошибку созданием заказа с похожим номером: это приводит к перепутанным накладным и отправлениям.',
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

const groupOrder = ['Роли', 'Вкладки CRM', 'Интеграции', 'Контроль'];
const blankBlock = (): RegulationBlock => ({ title: '', description: '', steps: [''], note: '' });

type RegulationsPageProps = { canEdit?: boolean };

export const RegulationsPage: React.FC<RegulationsPageProps> = ({ canEdit = false }) => {
  const [articles, setArticles] = useState<RegulationArticle[]>(ARTICLES);
  const [activeId, setActiveId] = useState('manager');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<RegulationData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [editorError, setEditorError] = useState('');
  const [contract, setContract] = useState<{ employeeName: string; position: string; employerName: string; date: string; agreementText: string } | null>(null);
  const query = search.trim().toLocaleLowerCase('ru');

  useEffect(() => {
    let active = true;
    crmFetch('/api/regulations').then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Не удалось загрузить изменения');
      return response.json();
    }).then((payload) => {
      if (!active || !Array.isArray(payload.articles)) return;
      const overrides = new Map<string, RegulationData>(payload.articles.map((item: RegulationData) => [item.id, item]));
      const builtIn = ARTICLES.map((article) => {
        const override = overrides.get(article.id);
        if (!override) return article;
        overrides.delete(article.id);
        return { ...article, ...override, icon: article.icon, accent: article.accent };
      });
      const custom = Array.from(overrides.values()).map((article) => ({ ...article, icon: BookOpen, accent: 'bg-violet-50 text-violet-700' }));
      setArticles([...builtIn, ...custom]);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Не удалось загрузить изменения'));
    return () => { active = false; };
  }, []);

  const filteredArticles = useMemo(() => {
    if (!query) return articles;
    return articles.filter((article) => [
      article.title,
      article.summary,
      article.group,
      ...article.blocks.flatMap((block) => [block.title, block.description || '', block.note || '', ...block.steps]),
    ].join(' ').toLocaleLowerCase('ru').includes(query));
  }, [articles, query]);

  const selectedArticle = articles.find((article) => article.id === activeId) || articles[0];
  const activeArticle = query && filteredArticles.length > 0 && !filteredArticles.some((article) => article.id === activeId)
    ? filteredArticles[0]
    : selectedArticle;
  const allGroups = [...groupOrder, ...articles.map((article) => article.group).filter((group) => !groupOrder.includes(group))];
  const groupedArticles = Array.from(new Set(allGroups))
    .map((group) => ({ group, articles: filteredArticles.filter((article) => article.group === group) }))
    .filter(({ articles }) => articles.length > 0);

  const openArticle = (articleId: string) => {
    setActiveId(articleId);
    if (window.innerWidth < 1024) {
      window.requestAnimationFrame(() => document.getElementById('regulation-article')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const startEdit = (article?: RegulationArticle) => {
    setEditor(article ? toData(article) : { id: '', group: 'Роли', title: '', summary: '', blocks: [blankBlock()] });
    setIsNew(!article);
    setEditorError('');
  };

  const updateBlock = (index: number, patch: Partial<RegulationBlock>) => {
    setEditor((current) => current ? { ...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block) } : current);
  };

  const saveRegulation = async () => {
    if (!editor || saving) return;
    const candidate = { ...editor, id: editor.id || createRegulationId(editor.title, articles.map((article) => article.id)) };
    const { regulation, errors } = validateRegulation(candidate);
    if (errors.length) return setEditorError(errors[0]);
    setSaving(true);
    setEditorError('');
    try {
      const response = await crmFetch(`/api/regulations/${encodeURIComponent(regulation.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(regulation),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить регламент');
      setArticles((current) => {
        const existing = current.find((article) => article.id === regulation.id);
        const saved = { ...payload.article, icon: existing?.icon || BookOpen, accent: existing?.accent || 'bg-violet-50 text-violet-700' } as RegulationArticle;
        return existing ? current.map((article) => article.id === saved.id ? saved : article) : [...current, saved];
      });
      setActiveId(regulation.id);
      setEditor(null);
      setNotice('Регламент сохранён');
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Не удалось сохранить регламент');
    } finally {
      setSaving(false);
    }
  };

  const printArticle = () => {
    const blocks = activeArticle.blocks.map((block, index) => `<section><h2>${index + 1}. ${escapeHtml(block.title)}</h2>${block.description ? `<p class="muted">${escapeHtml(block.description)}</p>` : ''}<ol>${block.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>${block.note ? `<p class="note"><b>Важно:</b> ${escapeHtml(block.note)}</p>` : ''}</section>`).join('');
    openPrintDocument(activeArticle.title, `<p class="muted">${escapeHtml(activeArticle.group)}</p><h1>${escapeHtml(activeArticle.title)}</h1><p>${escapeHtml(activeArticle.summary)}</p>${blocks}`);
  };

  const printContract = () => {
    if (!contract?.employeeName.trim() || !contract.position.trim()) return;
    const blocks = activeArticle.blocks.map((block) => `<h2>${escapeHtml(block.title)}</h2><ol>${block.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`).join('');
    openPrintDocument(`Соглашение — ${activeArticle.title}`, `<p class="muted">Дата: ${escapeHtml(contract.date)}</p><h1>Соглашение о соблюдении регламента</h1><p><b>${escapeHtml(contract.employerName || 'Работодатель')}</b>, с одной стороны, и <b>${escapeHtml(contract.employeeName)}</b>, должность: <b>${escapeHtml(contract.position)}</b>, с другой стороны, договорились применять в работе регламент «${escapeHtml(activeArticle.title)}».</p><p>${escapeHtml(contract.agreementText)}</p><div class="page-break"><h1>${escapeHtml(activeArticle.title)}</h1><p>${escapeHtml(activeArticle.summary)}</p>${blocks}</div><div class="signatures"><div class="line">Работодатель / подпись</div><div class="line">Сотрудник / подпись</div></div>`);
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
            <div className="flex w-full flex-col gap-2 md:max-w-sm">
              {canEdit && <button type="button" onClick={() => startEdit()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1F2937] px-4 text-sm font-semibold text-white hover:bg-black"><Plus size={16} />Добавить регламент</button>}
              <label className="relative block">
                <span className="sr-only">Поиск по регламентам</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти инструкцию..." className="h-12 w-full rounded-2xl border border-[#DDE2EA] bg-white pl-11 pr-4 text-sm text-[#1F2937] outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
            </div>
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
              {notice && <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs text-violet-800">{notice}</div>}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', activeArticle.accent)}><activeArticle.icon size={22} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#98A2B3]">{activeArticle.group}</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#1F2937] sm:text-2xl">{activeArticle.title}</h2>
                  <p className="mt-2 break-words text-sm leading-6 text-[#667085]">{activeArticle.summary}</p>
                </div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  {canEdit && <button type="button" onClick={() => startEdit(activeArticle)} className="flex min-h-10 items-center gap-2 rounded-xl border border-[#DDE2EA] px-3 text-xs font-semibold text-[#475467] hover:bg-slate-50"><Pencil size={15} />Редактировать</button>}
                  <button type="button" onClick={printArticle} className="flex min-h-10 items-center gap-2 rounded-xl border border-[#DDE2EA] px-3 text-xs font-semibold text-[#475467] hover:bg-slate-50"><Printer size={15} />Распечатать</button>
                  <button type="button" onClick={() => setContract({ employeeName: '', position: '', employerName: 'YAASBAE', date: new Date().toLocaleDateString('ru-RU'), agreementText: 'Сотрудник подтверждает, что ознакомился с правилами, обязуется соблюдать их в рабочей деятельности и своевременно сообщать ответственному о ситуациях, когда выполнение регламента невозможно.' })} className="flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700"><FileSignature size={15} />Соглашение</button>
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

      {editor && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="regulation-editor-title">
          <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4 sm:px-7">
              <div><p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600">Только для владельца</p><h2 id="regulation-editor-title" className="text-lg font-semibold">{isNew ? 'Новый регламент' : 'Редактирование регламента'}</h2></div>
              <button type="button" aria-label="Закрыть" onClick={() => setEditor(null)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-slate-100"><X size={19} /></button>
            </div>
            <div className="space-y-5 p-5 sm:p-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">Раздел<input value={editor.group} onChange={(event) => setEditor({ ...editor, group: event.target.value })} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal outline-none focus:border-violet-500" /></label>
                <label className="text-xs font-semibold text-slate-700">Название<input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} className="mt-2 h-11 w-full rounded-xl border px-3 text-sm font-normal outline-none focus:border-violet-500" /></label>
              </div>
              <label className="block text-xs font-semibold text-slate-700">Краткое описание<textarea value={editor.summary} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} rows={2} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" /></label>
              {editor.blocks.map((block, index) => (
                <section key={index} className="rounded-2xl border bg-slate-50 p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Блок {index + 1}</h3>{editor.blocks.length > 1 && <button type="button" onClick={() => setEditor({ ...editor, blocks: editor.blocks.filter((_, blockIndex) => blockIndex !== index) })} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={14} />Удалить</button>}</div>
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-slate-700">Заголовок<input value={block.title} onChange={(event) => updateBlock(index, { title: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal" /></label>
                    <label className="block text-xs font-semibold text-slate-700">Пояснение<textarea value={block.description || ''} onChange={(event) => updateBlock(index, { description: event.target.value })} rows={2} className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-semibold text-slate-700">Шаги — каждый с новой строки<textarea value={block.steps.join('\n')} onChange={(event) => updateBlock(index, { steps: event.target.value.split('\n') })} rows={5} className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal" /></label>
                    <label className="block text-xs font-semibold text-slate-700">Важное примечание<textarea value={block.note || ''} onChange={(event) => updateBlock(index, { note: event.target.value })} rows={2} className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal" /></label>
                  </div>
                </section>
              ))}
              <button type="button" onClick={() => setEditor({ ...editor, blocks: [...editor.blocks, blankBlock()] })} className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50"><Plus size={16} />Добавить блок</button>
              {editorError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{editorError}</p>}
            </div>
            <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-7"><button type="button" onClick={() => setEditor(null)} className="min-h-11 rounded-xl border px-5 text-sm font-semibold">Отмена</button><button type="button" disabled={saving} onClick={() => void saveRegulation()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
          </div>
        </div>
      )}

      {contract && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="contract-title">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600">На основе регламента</p><h2 id="contract-title" className="mt-1 text-lg font-semibold">Соглашение с сотрудником</h2><p className="mt-1 text-xs leading-5 text-slate-500">Сформируется документ с полным текстом «{activeArticle.title}» и местами для подписей.</p></div><button type="button" aria-label="Закрыть" onClick={() => setContract(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100"><X size={19} /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-slate-700">ФИО сотрудника<input autoFocus value={contract.employeeName} onChange={(event) => setContract({ ...contract, employeeName: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border px-3 text-sm font-normal" /></label>
              <label className="block text-xs font-semibold text-slate-700">Должность<input value={contract.position} onChange={(event) => setContract({ ...contract, position: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border px-3 text-sm font-normal" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-700">Работодатель<input value={contract.employerName} onChange={(event) => setContract({ ...contract, employerName: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border px-3 text-sm font-normal" /></label><label className="block text-xs font-semibold text-slate-700">Дата<input value={contract.date} onChange={(event) => setContract({ ...contract, date: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border px-3 text-sm font-normal" /></label></div>
              <label className="block text-xs font-semibold text-slate-700">Текст соглашения<textarea value={contract.agreementText} onChange={(event) => setContract({ ...contract, agreementText: event.target.value })} rows={4} className="mt-1.5 w-full rounded-xl border px-3 py-2 text-sm font-normal" /></label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setContract(null)} className="min-h-11 rounded-xl border px-5 text-sm font-semibold">Отмена</button><button type="button" disabled={!contract.employeeName.trim() || !contract.position.trim()} onClick={printContract} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-50"><Printer size={16} />Сформировать и печатать</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
