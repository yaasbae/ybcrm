import admin from "firebase-admin";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../utils/config.js";
import type { Logger } from "../utils/logger.js";

export class FirebaseService {
  private dbInstance?: Firestore;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  db(): Firestore {
    if (this.dbInstance) return this.dbInstance;

    if (!admin.apps.length) {
      if (this.config.firebaseServiceAccountJson) {
        admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(this.config.firebaseServiceAccountJson)),
          projectId: this.config.firebaseProjectId,
        });
      } else {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: this.config.firebaseProjectId,
        });
      }
    }

    this.dbInstance = getFirestore(admin.app(), this.config.firebaseDatabaseId);
    this.logger.info("Firebase Admin подключен", {
      projectId: this.config.firebaseProjectId,
      databaseId: this.config.firebaseDatabaseId,
    });

    return this.dbInstance;
  }
}
