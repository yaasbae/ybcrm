import assert from "node:assert/strict";
import test from "node:test";
import { parseIncidentTriage, redactIncidentText } from "../src/lib/incidentTriage.ts";

test("masks email and Russian phone before external AI processing", () => {
  const value = redactIncidentText("Клиент test@example.com, телефон +7 (999) 123-45-67");
  assert.equal(value.includes("test@example.com"), false);
  assert.equal(value.includes("999"), false);
  assert.match(value, /email скрыт/);
  assert.match(value, /телефон скрыт/);
});

test("accepts fenced JSON and fails closed for unknown labels", () => {
  const result = parseIncidentTriage('```json\n{"category":"delete_everything","priority":"unlimited","summary":"Проверить"}\n```');
  assert.equal(result.category, "other");
  assert.equal(result.priority, "normal");
  assert.equal(result.summary, "Проверить");
});

test("limits untrusted AI output lengths", () => {
  const result = parseIncidentTriage(JSON.stringify({ summary: "x".repeat(2_000), likelyCause: "y".repeat(2_000) }));
  assert.equal(result.summary.length, 500);
  assert.equal(result.likelyCause.length, 1_000);
});
