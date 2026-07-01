import { z } from "zod";

export const EmptySchema = {};

export const OrdersListToolSchema = {
  date_from: z.string().optional().describe("Дата начала YYYY-MM-DD"),
  date_to: z.string().optional().describe("Дата конца YYYY-MM-DD"),
  status: z.string().optional().describe("Статус заказа"),
  manager: z.string().optional().describe("Менеджер"),
  page: z.number().int().positive().optional().describe("Страница"),
};

export const OrderGetToolSchema = {
  id: z.string().min(1).describe("ID документа или номер заказа"),
};

export const OrderUpdateToolSchema = {
  id: z.string().min(1).describe("ID документа или номер заказа"),
  status: z.string().min(1).describe("Новый статус"),
};

export const ClientsSearchToolSchema = {
  query: z.string().min(2).describe("Телефон, имя, Instagram или номер заказа"),
};

export const InstagramStatsToolSchema = {
  since: z.string().optional().describe("Начало периода YYYY-MM-DD"),
  until: z.string().optional().describe("Конец периода YYYY-MM-DD"),
};

export const TaskCreateToolSchema = {
  manager: z.string().min(1).describe("Кому поставить задачу"),
  title: z.string().min(1).describe("Название задачи"),
  description: z.string().optional().describe("Описание"),
  dueDate: z.string().optional().describe("Срок YYYY-MM-DD"),
};
