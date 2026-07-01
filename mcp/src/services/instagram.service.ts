import { z } from "zod";
import type { AxiosInstance } from "axios";
import type { Config } from "../utils/config.js";
import { badRequest } from "../utils/errors.js";

export const InstagramStatsSchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
});

export class InstagramService {
  constructor(
    private readonly config: Config,
    private readonly http: AxiosInstance,
  ) {}

  async stats(input: z.infer<typeof InstagramStatsSchema> = {}) {
    InstagramStatsSchema.parse(input);
    if (!this.config.metaAccessToken || !this.config.metaIgUserId) {
      throw badRequest("META_ACCESS_TOKEN и META_IG_USER_ID не настроены");
    }

    const base = `https://graph.facebook.com/${this.config.metaGraphVersion}/${this.config.metaIgUserId}`;
    const fields = [
      "followers_count",
      "media_count",
      "media.limit(25){id,caption,media_type,timestamp,permalink,like_count,comments_count}",
    ].join(",");

    const { data } = await this.http.get(base, {
      params: {
        fields,
        access_token: this.config.metaAccessToken,
      },
    });

    return {
      followers: data.followers_count || 0,
      publications: data.media_count || 0,
      reels: (data.media?.data || []).filter((item: any) => item.media_type === "VIDEO").length,
      views: 0,
      reach: 0,
      media: data.media?.data || [],
    };
  }
}
