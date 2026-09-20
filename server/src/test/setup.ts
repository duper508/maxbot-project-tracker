import { resetDatabase } from "../db/index.js";

export async function setupTestDatabase(): Promise<void> {
  await resetDatabase(":memory:");
}
