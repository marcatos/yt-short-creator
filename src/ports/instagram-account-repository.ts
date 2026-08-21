import type { InstagramAccount } from "@/src/domain/entities";

export interface InstagramAccountRepository {
  get(): Promise<InstagramAccount | null>;
  save(account: InstagramAccount): Promise<void>;
  delete(): Promise<void>;
}
