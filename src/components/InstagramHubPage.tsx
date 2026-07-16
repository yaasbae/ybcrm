import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  ExternalLink,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  Users,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/utils';
import { InstagramInboxPage } from './InstagramInboxPage';

type Tab = 'overview' | 'content' | 'comments' | 'dialogs';
type Profile = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  account_type?: string;
  warning?: string;
};
type Insight = {
  name: string;
  title: string;
  description: string;
  period: string;
  values: Array<{ value: number; endTime: string }>;
  totalValue: number | null;
};
type Media = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
  like_count?: number;
};
type MediaInsight = { mediaId: string; metrics: Insight[]; error?: string };
type Comment = {
  id: string;
  text?: string;
  timestamp?: string;
  like_count?: number;
  hidden?: boolean;
  from?: { id?: string; username?: string };
  replies?: { data?: Comment[] };
};
type CommentGroup = {
  media: { id: string; caption?: string; mediaType?: string; thumbnailUrl?: string; permalink?: string; timestamp?: string };
  comments: Comment[];
  error?: string;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

const metricLabels: Record<string, string> = {
  reach: 'Охват',
  profile_views: 'Просмотры профиля',
  accounts_engaged: 'Вовлечённые аккаунты',
  total_interactions: 'Взаимодействия',
  follower_count: 'Новые подписчики',
  website_clicks: 'Переходы на сайт',
  profile_links_taps: 'Нажатия на ссылки',
  views: 'Просмотры',
};

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('ru-RU', { notation: Number(value || 0) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function insightValue(metric?: Insight) {
  if (!metric) return 0;
  if (typeof metric.totalValue === 'number') return metric.totalValue;
  return metric.values.reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function Issue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{children}</span>
    </div>
  );
}

export const InstagramHubPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [unavailable, setUnavailable] = useState<Array<{ metric: string; error: string }>>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaInsights, setMediaInsights] = useState<MediaInsight[]>([]);
  const [comments, setComments] = useState<CommentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [error, setError] = useState('');
  const [commentError, setCommentError] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [workingComment, setWorkingComment] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadHub = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    const [profileResult, insightResult, mediaResult] = await Promise.allSettled([
      api<{ profile: Profile }>('/api/instagram/profile'),
      api<{ metrics: Insight[]; unavailable: Array<{ metric: string; error: string }> }>('/api/instagram/insights?days=30'),
      api<{ media: Media[]; insights: MediaInsight[] }>('/api/instagram/media?limit=24'),
    ]);
    const failures: string[] = [];
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value.profile);
    else failures.push(`Профиль: ${profileResult.reason?.message || 'ошибка'}`);
    if (insightResult.status === 'fulfilled') {
      setInsights(insightResult.value.metrics || []);
      setUnavailable(insightResult.value.unavailable || []);
    } else failures.push(`Аналитика: ${insightResult.reason?.message || 'ошибка'}`);
    if (mediaResult.status === 'fulfilled') {
      setMedia(mediaResult.value.media || []);
      setMediaInsights(mediaResult.value.insights || []);
    } else failures.push(`Публикации: ${mediaResult.reason?.message || 'ошибка'}`);
    setError(failures.join(' · '));
    setLastUpdated(new Date());
    setLoading(false);
  };

  const loadComments = async (quiet = false) => {
    if (!quiet) setCommentsLoading(true);
    setCommentError('');
    try {
      const data = await api<{ groups: CommentGroup[] }>('/api/instagram/comments?mediaLimit=24');
      setComments(data.groups || []);
    } catch (e: any) {
      setCommentError(e.message);
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    loadHub();
    const timer = window.setInterval(() => loadHub(true), 5 * 60 * 1000);
    const onFocus = () => loadHub(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (tab === 'comments' && !comments.length && !commentsLoading) loadComments();
  }, [tab]);

  const metrics = useMemo(() => Object.fromEntries(insights.map((item) => [item.name, item])), [insights]);
  const chartData = useMemo(() => {
    const rows = new Map<string, any>();
    ['reach', 'profile_views'].forEach((name) => {
      metrics[name]?.values.forEach((item) => {
        const key = item.endTime || String(rows.size);
        const current = rows.get(key) || { key, date: item.endTime ? new Date(item.endTime).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '' };
        current[name] = Number(item.value || 0);
        rows.set(key, current);
      });
    });
    return [...rows.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [metrics]);
  const allComments = useMemo(() => comments.flatMap((group) => group.comments.map((comment) => ({ comment, media: group.media }))), [comments]);
  const commentGroupErrors = comments.filter((group) => group.error);

  const sendReply = async (commentId: string) => {
    const message = String(replyDrafts[commentId] || '').trim();
    if (!message) return;
    setWorkingComment(commentId);
    setCommentError('');
    try {
      await api(`/api/instagram/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ message }) });
      setReplyDrafts((current) => ({ ...current, [commentId]: '' }));
      await loadComments(true);
    } catch (e: any) {
      setCommentError(e.message);
    } finally {
      setWorkingComment('');
    }
  };

  const toggleHidden = async (comment: Comment) => {
    setWorkingComment(comment.id);
    setCommentError('');
    try {
      await api(`/api/instagram/comments/${comment.id}/visibility`, { method: 'POST', body: JSON.stringify({ hidden: !comment.hidden }) });
      setComments((current) => current.map((group) => ({
        ...group,
        comments: group.comments.map((item) => item.id === comment.id ? { ...item, hidden: !item.hidden } : item),
      })));
    } catch (e: any) {
      setCommentError(e.message);
    } finally {
      setWorkingComment('');
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Обзор', icon: BarChart3 },
    { id: 'content', label: 'Контент', icon: Instagram },
    { id: 'comments', label: 'Комментарии', icon: MessageSquareText },
    { id: 'dialogs', label: 'Диалоги', icon: MessageCircle },
  ];

  return (
    <div className="mx-auto w-full max-w-[1880px] px-3 pb-8 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#8B5CF6] via-[#E83E8C] to-[#F59E0B] text-white shadow-sm">
            <Instagram className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9CA3AF]">Instagram Graph</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-[24px] font-semibold leading-8 text-[#1F2937]">Instagram</h1>
              {profile?.username && <span className="text-sm font-medium text-[#7D7DE6]">@{profile.username}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="hidden text-xs text-[#9CA3AF] sm:inline">Обновлено {lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={() => tab === 'comments' ? loadComments() : loadHub()} disabled={loading || commentsLoading} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#E6E9EF] bg-white px-4 text-xs font-semibold text-[#1F2937] transition-colors hover:bg-[#F6F7F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6] disabled:opacity-50">
            <RefreshCw className={cn('h-4 w-4', (loading || commentsLoading) && 'animate-spin')} /> Обновить
          </button>
        </div>
      </header>

      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[#E6E9EF] bg-white p-1.5" aria-label="Разделы Instagram">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} onClick={() => setTab(item.id)} className={cn('flex h-10 min-w-max cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7D7DE6]', tab === item.id ? 'bg-[#1F2937] text-white' : 'text-[#6B7280] hover:bg-[#F6F7F9] hover:text-[#1F2937]')}><Icon className="h-4 w-4" />{item.label}</button>;
        })}
      </nav>

      {error && <div className="mb-4"><Issue>{error}</Issue></div>}

      {tab === 'overview' && (
        <div className="space-y-4">
          {loading && !profile ? <div className="grid h-64 place-items-center rounded-xl border border-[#E6E9EF] bg-white"><Loader2 className="h-6 w-6 animate-spin text-[#7D7DE6]" /></div> : (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: 'Подписчики', value: profile?.followers_count, icon: Users, color: 'text-[#7D7DE6]', bg: 'bg-[#F1F2FB]' },
                  { label: 'Охват за 30 дней', value: insightValue(metrics.reach), icon: Eye, color: 'text-[#2EBA7F]', bg: 'bg-emerald-50' },
                  { label: 'Взаимодействия', value: insightValue(metrics.total_interactions), icon: Heart, color: 'text-[#E83E8C]', bg: 'bg-pink-50' },
                  { label: 'Просмотры профиля', value: insightValue(metrics.profile_views), icon: BarChart3, color: 'text-[#F59E0B]', bg: 'bg-amber-50' },
                ].map((item) => {
                  const Icon = item.icon;
                  return <article key={item.label} className="rounded-xl border border-[#E6E9EF] bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[#6B7280]">{item.label}</p><span className={cn('grid h-9 w-9 place-items-center rounded-lg', item.bg, item.color)}><Icon className="h-4 w-4" /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight text-[#1F2937]">{formatNumber(item.value)}</p></article>;
                })}
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)]">
                <article className="min-h-[360px] rounded-xl border border-[#E6E9EF] bg-white p-4 sm:p-5">
                  <div><h2 className="text-base font-semibold text-[#1F2937]">Динамика за 30 дней</h2><p className="mt-1 text-xs text-[#9CA3AF]">Данные напрямую из Instagram Insights</p></div>
                  {chartData.length ? <div className="mt-5 h-[270px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid stroke="#EEF0F4" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} minTickGap={28} /><YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ border: '1px solid #E6E9EF', borderRadius: 10, fontSize: 12 }} /><Line type="monotone" dataKey="reach" name="Охват" stroke="#7D7DE6" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="profile_views" name="Просмотры профиля" stroke="#E83E8C" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div> : <div className="grid h-[270px] place-items-center text-center text-sm text-[#9CA3AF]">Meta не вернула дневную динамику для доступных метрик.</div>}
                </article>
                <article className="rounded-xl border border-[#E6E9EF] bg-white p-5">
                  <div className="flex items-center gap-3">
                    {profile?.profile_picture_url ? <img src={profile.profile_picture_url} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-full bg-[#FCE8F1] text-[#E83E8C]"><Instagram className="h-6 w-6" /></span>}
                    <div className="min-w-0"><h2 className="truncate text-base font-semibold text-[#1F2937]">{profile?.name || profile?.username || 'Instagram'}</h2><p className="truncate text-xs text-[#9CA3AF]">{profile?.account_type || 'Business / Creator'}</p></div>
                  </div>
                  {profile?.biography && <p className="mt-4 whitespace-pre-wrap text-sm leading-5 text-[#6B7280]">{profile.biography}</p>}
                  <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[#EEF0F4] pt-4"><div><dt className="text-[11px] text-[#9CA3AF]">Публикации</dt><dd className="mt-1 text-lg font-semibold text-[#1F2937]">{formatNumber(profile?.media_count)}</dd></div><div><dt className="text-[11px] text-[#9CA3AF]">Подписки</dt><dd className="mt-1 text-lg font-semibold text-[#1F2937]">{formatNumber(profile?.follows_count)}</dd></div></dl>
                  {profile?.website && <a href={profile.website} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 break-all text-xs font-semibold text-[#7D7DE6] hover:underline">{profile.website}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>}
                </article>
              </section>
              {unavailable.length > 0 && <Issue>Instagram не отдал часть метрик ({unavailable.map((item) => metricLabels[item.metric] || item.metric).join(', ')}). Это нормально для метрик, которым не хватает аудитории или которые недоступны этому типу аккаунта.</Issue>}
            </>
          )}
        </div>
      )}

      {tab === 'content' && (
        <section className="rounded-xl border border-[#E6E9EF] bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-base font-semibold text-[#1F2937]">Публикации</h2><p className="mt-1 text-xs text-[#9CA3AF]">{media.length} последних публикаций и доступные метрики</p></div></div>
          {loading && !media.length ? <div className="grid h-56 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#7D7DE6]" /></div> : null}
          {!loading && !media.length ? <div className="grid h-56 place-items-center text-sm text-[#9CA3AF]">Instagram не вернул публикации.</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {media.map((item) => {
              const itemMetrics = Object.fromEntries((mediaInsights.find((row) => row.mediaId === item.id)?.metrics || []).map((metric) => [metric.name, metric]));
              return <article key={item.id} className="overflow-hidden rounded-xl border border-[#E6E9EF] bg-white transition-shadow hover:shadow-md"><div className="aspect-square bg-[#F6F7F9]">{item.thumbnail_url || item.media_url ? <img src={item.thumbnail_url || item.media_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[#9CA3AF]"><Instagram className="h-8 w-8" /></div>}</div><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="rounded-md bg-[#F1F2FB] px-2 py-1 text-[10px] font-semibold text-[#7D7DE6]">{item.media_product_type || item.media_type || 'POST'}</span><time className="text-[10px] text-[#9CA3AF]">{formatDate(item.timestamp)}</time></div><p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-[#4B5563]">{item.caption || 'Без подписи'}</p><div className="mt-3 flex items-center gap-4 border-t border-[#EEF0F4] pt-3 text-xs text-[#6B7280]"><span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{formatNumber(item.like_count ?? insightValue(itemMetrics.likes))}</span><span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{formatNumber(item.comments_count ?? insightValue(itemMetrics.comments))}</span><span className="ml-auto flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{formatNumber(insightValue(itemMetrics.reach || itemMetrics.views))}</span></div>{item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#7D7DE6] hover:underline">Открыть в Instagram <ExternalLink className="h-3 w-3" /></a>}</div></article>;
            })}
          </div>
        </section>
      )}

      {tab === 'comments' && (
        <section className="rounded-xl border border-[#E6E9EF] bg-white p-4 sm:p-5">
          <div className="mb-4"><h2 className="text-base font-semibold text-[#1F2937]">Все комментарии</h2><p className="mt-1 text-xs text-[#9CA3AF]">Комментарии к последним публикациям, ответы и модерация</p></div>
          {commentError && <div className="mb-4"><Issue>{commentError}</Issue></div>}
          {commentGroupErrors.length > 0 && <div className="mb-4"><Issue>Для {commentGroupErrors.length} публикаций Meta не разрешила прочитать комментарии. Проверь разрешение instagram_business_manage_comments.</Issue></div>}
          {commentsLoading ? <div className="grid h-56 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#7D7DE6]" /></div> : null}
          {!commentsLoading && !allComments.length ? <div className="grid h-56 place-items-center text-center text-sm text-[#9CA3AF]">В последних публикациях комментариев нет либо Meta не дала к ним доступ.</div> : null}
          <div className="space-y-3">
            {allComments.map(({ comment, media: commentMedia }) => <article key={comment.id} className={cn('rounded-xl border p-4', comment.hidden ? 'border-[#E6E9EF] bg-[#F6F7F9] opacity-70' : 'border-[#E6E9EF] bg-white')}><div className="flex gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#F6F7F9]">{commentMedia.thumbnailUrl ? <img src={commentMedia.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Instagram className="m-3 h-6 w-6 text-[#9CA3AF]" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-sm text-[#1F2937]">@{comment.from?.username || 'instagram_user'}</b><time className="ml-2 text-[10px] text-[#9CA3AF]">{formatDate(comment.timestamp)}</time></div>{commentMedia.permalink && <a href={commentMedia.permalink} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[#7D7DE6] hover:underline">Публикация</a>}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[#4B5563]">{comment.text || 'Без текста'}</p>{comment.replies?.data?.length ? <div className="mt-3 space-y-2 border-l-2 border-[#E6E9EF] pl-3">{comment.replies.data.map((reply) => <div key={reply.id}><b className="text-xs text-[#1F2937]">@{reply.from?.username || profile?.username || 'ответ'}</b><p className="mt-0.5 text-xs leading-5 text-[#6B7280]">{reply.text}</p></div>)}</div> : null}<div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={replyDrafts[comment.id] || ''} onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') sendReply(comment.id); }} placeholder="Ответить на комментарий..." className="h-10 min-w-0 flex-1 rounded-lg border border-[#E6E9EF] px-3 text-xs outline-none focus:border-[#7D7DE6] focus:ring-2 focus:ring-[#7D7DE6]/15" /><button onClick={() => sendReply(comment.id)} disabled={!replyDrafts[comment.id]?.trim() || workingComment === comment.id} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#1F2937] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{workingComment === comment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Ответить</button><button onClick={() => toggleHidden(comment)} disabled={workingComment === comment.id} className="h-10 cursor-pointer rounded-lg border border-[#E6E9EF] px-3 text-xs font-semibold text-[#6B7280] hover:bg-[#F6F7F9] disabled:opacity-40">{comment.hidden ? 'Показать' : 'Скрыть'}</button></div></div></div></article>)}
          </div>
        </section>
      )}

      {tab === 'dialogs' && <InstagramInboxPage embedded />}
    </div>
  );
};
