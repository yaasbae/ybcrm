import axios from "axios";
import axiosRetry from "axios-retry";

export function createHttpClient() {
  const client = axios.create({
    timeout: 20_000,
    headers: {
      "User-Agent": "ybcrm-mcp/1.0",
    },
  });

  axiosRetry(client, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429,
  });

  return client;
}
