import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { Task } from "../types/domain.js";
import type { FirebaseService } from "./firebase.service.js";

export const TaskCreateSchema = z.object({
  manager: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
});

export class TasksService {
  constructor(private readonly firebase: FirebaseService) {}

  async create(input: z.infer<typeof TaskCreateSchema>): Promise<Task> {
    const task = TaskCreateSchema.parse(input);
    const ref = await this.firebase.db().collection("tasks").add({
      ...task,
      status: "new",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      id: ref.id,
      ...task,
      status: "new",
      createdAt: new Date().toISOString(),
    };
  }
}
