import { z } from "zod";
import type { AxiosInstance } from "axios";
import type { Config } from "../utils/config.js";
import { badRequest } from "../utils/errors.js";
import type { FirebaseService } from "./firebase.service.js";

export const InstagramStatsSchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
});

export class InstagramService {
  constructor(
    private readonly config: Config,
    private readonly http: AxiosInstance,
    private readonly firebase: FirebaseService,
  ) {}

  async stats(input: z.infer<typeof InstagramStatsSchema> = {}) {
    InstagramStatsSchema.parse(input);
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
    const fields = [
      "followers_count",
      "media_count",
      "media.limit(25){id,caption,media_type,timestamp,permalink,like_count,comments_count}",
    ].join(",");

    const { data } = await this.http.get(base, {
      params: {
        fields,
        access_token: accessToken,
      },
    });

    return {
      apiMode,
      followers: data.followers_count || 0,
      publications: data.media_count || 0,
      reels: (data.media?.data || []).filter((item: any) => item.media_type === "VIDEO").length,
      views: 0,
      reach: 0,
      media: data.media?.data || [],
    };
  }
}
