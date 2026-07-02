import { z } from "zod";

export const EmptySchema = {};

export const OrdersListToolSchema = {
  date_from: z.string().optional().describe("Дата начала YYYY-MM-DD"),
  date_to: z.string().optional().describe("Дата конца YYYY-MM-DD"),
  status: z.string().optional().describe("Статус заказа"),
  manager: z.string().optional().describe("Менеджер"),
  blogger: z.string().optional().describe("Блогер"),
  page: z.number().int().positive().optional().describe("Страница"),
};

export const OrderGetToolSchema = {
  id: z.string().min(1).describe("ID документа или номер заказа"),
};

export const OrderUpdateToolSchema = {
  id: z.string().min(1).describe("ID документа или номер заказа"),
  status: z.string().min(1).describe("Новый статус"),
};

export const OrderCreateToolSchema = {
  orderId: z.string().optional().describe("Номер заказа, если нужен свой"),
  date: z.string().optional().describe("Дата заказа YYYY-MM-DD или DD.MM.YYYY"),
  clientName: z.string().optional().describe("ФИО клиента"),
  phone: z.string().optional().describe("Телефон клиента"),
  instagram: z.string().optional().describe("Instagram клиента"),
  city: z.string().optional().describe("Город клиента"),
  manager: z.string().optional().describe("Менеджер"),
  blogger: z.string().optional().describe("Блогер"),
  source: z.string().optional().describe("Источник"),
  delivery: z.string().optional().describe("Доставка"),
  deliveryPrice: z.number().optional().describe("Стоимость доставки"),
  paymentType: z.string().optional().describe("Предоплата 50%, Полная оплата или Оплата с примеркой"),
  paidAmount: z.number().optional().describe("Сумма к оплате/счета, если нужна вручную"),
  revenue: z.number().optional().describe("Стоимость изделий без доставки"),
  status: z.string().optional().describe("Статус заказа"),
  items: z.array(z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      price: z.number().optional(),
      quantity: z.number().optional(),
      color: z.string().optional(),
      size: z.string().optional(),
      height: z.string().optional(),
      label: z.string().optional(),
    }),
  ])).optional().describe("Позиции заказа"),
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
