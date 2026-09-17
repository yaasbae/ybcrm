const INCIDENT_CATEGORIES = new Set(["crm_error", "user_question", "improvement", "integration", "data_issue", "other"]);
const INCIDENT_PRIORITIES = new Set(["low", "normal", "high", "critical"]);

export function redactIncidentText(value: unknown) {
  return String(value || "")
    .slice(0, 4_000)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email скрыт]")
    .replace(/(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон скрыт]");
}

export function parseIncidentTriage(raw: string) {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(clean) as Record<string, unknown>;
  const category = INCIDENT_CATEGORIES.has(String(parsed.category)) ? String(parsed.category) : "other";
  const priority = INCIDENT_PRIORITIES.has(String(parsed.priority)) ? String(parsed.priority) : "normal";
  return {
    category,
    priority,
    summary: String(parsed.summary || "Обращение требует проверки").slice(0, 500),
    likelyCause: String(parsed.likelyCause || "Причина пока не определена").slice(0, 1_000),
    nextQuestion: String(parsed.nextQuestion || "").slice(0, 500),
    recommendedAction: String(parsed.recommendedAction || "Проверить обращение вручную").slice(0, 1_000),
  };
}
