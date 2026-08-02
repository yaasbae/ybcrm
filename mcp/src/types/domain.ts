export type OrderStatus =
  | "Новый"
  | "В работе"
  | "Оплачен"
  | "Отгружен"
  | "Доставлен"
  | "Возврат"
  | "Отмена"
  | "Обмен"
  | string;

export interface OrderItem {
  name: string;
  price: number;
  quantity: number;
  color?: string;
  size?: string;
  height?: string;
  label?: string;
}

export interface Order {
  id: string;
  orderId: string;
  date?: string;
  status?: OrderStatus;
  clientName?: string;
  phone?: string;
  instagram?: string;
  manager?: string;
  blogger?: string;
  source?: string;
  delivery?: string;
  paymentType?: string;
  amountTotal: number;
  paidAmount: number;
  plannedInvoiceAmount?: number;
  initialPaymentStatus?: string;
  finalPaymentAmount?: number;
  finalPaymentStatus?: string;
  dueAmount: number;
  deliveryCost: number;
  items: OrderItem[];
  raw?: Record<string, unknown>;
}

export interface Client {
  id: string;
  name?: string;
  phone?: string;
  instagram?: string;
  city?: string;
  ordersCount?: number;
  totalAmount?: number;
  raw?: Record<string, unknown>;
}

export interface SalesAnalytics {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  averageCheck: number;
  ordersCount: number;
  conversion: number;
}

export interface FinanceSummary {
  revenue: number;
  profit: number;
  expenses: number;
  salaries: number;
  rent: number;
  balance: number;
}

export interface Task {
  id?: string;
  manager: string;
  title: string;
  description?: string;
  dueDate?: string;
  status?: string;
  createdAt?: string;
}
