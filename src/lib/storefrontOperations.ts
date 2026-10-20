/** In-process capability: HTTP headers and JSON can never grant this identity. */
export function createStorefrontOperations() {
  const requests = new WeakSet<object>();
  const handlers = new Map<string, (req: any, res: any) => unknown>();
  return {
    isInternal: (req: object) => requests.has(req),
    register(path: string, handler: (req: any, res: any) => unknown) {
      handlers.set(path, handler);
      return handler;
    },
    async invoke(path: string, body: Record<string, unknown>) {
      const handler = handlers.get(path);
      if (!handler) throw new Error('Неизвестная операция оформления');
      const req = { body, headers: {} };
      requests.add(req);
      let status = 200;
      let sent = false;
      let data: any;
      const res = {
        status(code: number) { status = code; return res; },
        json(value: unknown) { sent = true; data = value; return res; },
      };
      try {
        await handler(req, res);
        if (!sent) throw new Error('Операция оформления не вернула результат');
        if (status >= 400) throw Object.assign(new Error(data?.error || 'Ошибка оформления'), { statusCode: status, response: { status, data } });
        return { data };
      } finally { requests.delete(req); }
    },
  };
}
