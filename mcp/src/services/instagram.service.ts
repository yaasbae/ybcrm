import { z } from "zod";
import type { AxiosInstance } from "axios";
import type { Config } from "../utils/config.js";
import { badRequest } from "../utils/errors.js";
import type { FirebaseService } from "./firebase.service.js";

export const InstagramStatsSchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export class InstagramService {
  constructor(
    private readonly config: Config,
    private readonly http: AxiosInstance,
    private readonly firebase: FirebaseService,
  ) {}

  async stats(input: z.infer<typeof InstagramStatsSchema> = {}) {
    const parsed = InstagramStatsSchema.parse(input);
    const since = parsed.dateFrom || parsed.since;
    const until = parsed.dateTo || parsed.until;
    let accessToken = this.config.metaAccessToken || "";
    let igUserId = this.config.metaIgUserId || "";
    let apiMode: "instagram_login" | "facebook_login" = /^IG/i.test(accessToken)
      ? "instagram_login"
      : "facebook_login";

    // Production keeps the token in the same Firestore settings document as
    // the CRM. The standalone MCP service must read it there instead of
    // requiring a second copy of the secret in Cloud Run.
    if (!accessToken || !igUserId) {
      const settings = await this.firebase.db().collection("settings").doc("instagram_graph").get();
      const data = settings.exists ? settings.data() || {} : {};
      accessToken = String(data.accessToken || data.pageAccessToken || accessToken || "");
      igUserId = String(data.instagramUserId || igUserId || "");
      apiMode = data.apiMode === "instagram_login" || data.source === "instagram_token" || /^IG/i.test(accessToken)
        ? "instagram_login"
        : "facebook_login";
      if (apiMode === "facebook_login") {
        accessToken = String(data.pageAccessToken || data.accessToken || accessToken);
      }
    }

    if (!accessToken || !igUserId) {
      throw badRequest("META_ACCESS_TOKEN и META_IG_USER_ID не настроены");
    }

    const graphHost = apiMode === "instagram_login" ? "https://graph.instagram.com" : "https://graph.facebook.com";
    const base = `${graphHost}/${this.config.metaGraphVersion}/${igUserId}`;
    const [{ data: profile }, { data: mediaResponse }] = await Promise.all([
      this.http.get(base, {
        params: {
          fields: "followers_count,media_count",
          access_token: accessToken,
        },
      }),
      this.http.get(`${base}/media`, {
        params: {
          fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count",
          limit: 100,
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
          access_token: accessToken,
        },
      }),
    ]);

    const media = (mediaResponse?.data || []).filter((item: any) => {
      const timestamp = String(item.timestamp || "").slice(0, 10);
      if (since && timestamp && timestamp < since) return false;
      if (until && timestamp && timestamp > until) return false;
      return true;
    });

    let insights: Record<string, number | null> = {
      views: null,
      reach: null,
      totalInteractions: null,
      accountsEngaged: null,
    };
    let insightsError: { source: string; code?: string | number; message: string } | null = null;
    try {
      const { data: insightResponse } = await this.http.get(`${base}/insights`, {
        params: {
          metric: "views,reach,total_interactions,accounts_engaged",
          period: "day",
          metric_type: "total_value",
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
          access_token: accessToken,
        },
      });
      const values = Object.fromEntries(
        (insightResponse?.data || []).map((metric: any) => {
          const value = metric.total_value?.value
            ?? metric.values?.reduce((sum: number, row: any) => sum + Number(row.value || 0), 0)
            ?? null;
          return [metric.name, value];
        }),
      );
      insights = {
        views: values.views ?? null,
        reach: values.reach ?? null,
        totalInteractions: values.total_interactions ?? null,
        accountsEngaged: values.accounts_engaged ?? null,
      };
    } catch (error: any) {
      insightsError = {
        source: "instagram",
        code: error?.response?.data?.error?.code,
        message: String(error?.response?.data?.error?.message || error?.message || "Instagram Insights недоступен"),
      };
    }

    return {
      apiMode,
      requestedPeriod: { dateFrom: since || null, dateTo: until || null },
      appliedPeriod: { dateFrom: since || null, dateTo: until || null },
      followers: profile.followers_count || 0,
      publications: profile.media_count || 0,
      reels: media.filter((item: any) => item.media_type === "VIDEO" || item.media_product_type === "REELS").length,
      ...insights,
      insightsError,
      media,
    };
  }
}
