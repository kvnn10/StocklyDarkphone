import { MongoClient, type Collection, ObjectId } from "mongodb";

export type NotificationChannel = "in_app" | "whatsapp" | "telegram";
export type NotificationPriority = "low" | "normal" | "high" | "critical";
export type NotificationStatus = "pending" | "read" | "dismissed";
export type DeliveryState = "pending" | "sent" | "skipped" | "failed";
export type NotificationDelivery = Partial<Record<NotificationChannel, DeliveryState>> & { attempts?: number; lastAttemptAt?: Date; lastError?: string };
export type Notification = { id: string; userId: string; type: string; title: string; message: string; priority: NotificationPriority; channels: NotificationChannel[]; status: NotificationStatus; data?: Record<string, unknown>; idempotencyKey?: string; createdAt: Date; readAt?: Date; delivery?: NotificationDelivery };
type NotificationDoc = Notification & { _id?: unknown };
type PreferenceDoc = { userId: string; channels: NotificationChannel[]; mutedTypes: string[]; updatedAt: Date };
const globalForAutomation = globalThis as typeof globalThis & { __stocklyAutomationClient?: MongoClient; __stocklyAutomationReady?: Promise<Collection<NotificationDoc>> };
async function collection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!globalForAutomation.__stocklyAutomationClient) globalForAutomation.__stocklyAutomationClient = new MongoClient(process.env.DATABASE_URL);
  const client = globalForAutomation.__stocklyAutomationClient;
  if (!globalForAutomation.__stocklyAutomationReady) globalForAutomation.__stocklyAutomationReady = client.connect().then(async (connected) => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "").split("?")[0];
    if (!dbName) throw new Error("DATABASE_URL must include a database name");
    const col = connected.db(dbName).collection<NotificationDoc>("automation_notifications");
    await col.createIndex({ userId: 1, createdAt: -1 });
    await col.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });
    return col;
  });
  return globalForAutomation.__stocklyAutomationReady;
}
async function preferences(userId: string) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = globalForAutomation.__stocklyAutomationClient ??= new MongoClient(process.env.DATABASE_URL);
  await client.connect();
  const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "").split("?")[0];
  return client.db(dbName).collection<PreferenceDoc>("automation_notification_preferences").findOne({ userId }, { projection: { _id: 0 } });
}
function id() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
export async function enqueueNotification(input: Omit<Notification, "id" | "status" | "createdAt" | "delivery">) {
  const col = await collection();
  const pref = await preferences(input.userId);
  const muted = Boolean(pref?.mutedTypes.includes(input.type));
  const selected = pref ? input.channels.filter((channel) => pref.channels.includes(channel)) : input.channels;
  const notification: Notification = { ...input, channels: selected, id: id(), status: muted || selected.length === 0 ? "dismissed" : "pending", createdAt: new Date(), delivery: {} };
  if (input.idempotencyKey) {
    const result = await col.findOneAndUpdate({ idempotencyKey: input.idempotencyKey }, { $setOnInsert: notification }, { upsert: true, returnDocument: "after" });
    return result?.value ?? notification;
  }
  await col.insertOne(notification);
  return notification;
}
export async function listNotifications(userId: string, limit = 50) { const col = await collection(); return col.find({ userId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).project({ _id: 0 }).toArray(); }
export async function markNotificationRead(userId: string, notificationId: string) { const col = await collection(); const result = await col.findOneAndUpdate({ id: notificationId, userId, status: "pending" }, { $set: { status: "read", readAt: new Date() } }, { returnDocument: "after", projection: { _id: 0 } }); return result?.value ?? null; }
export async function getNotificationPreferences(userId: string) { return preferences(userId); }
export async function setNotificationPreferences(userId: string, channels: NotificationChannel[], mutedTypes: string[] = []) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = globalForAutomation.__stocklyAutomationClient ??= new MongoClient(process.env.DATABASE_URL); await client.connect();
  const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "").split("?")[0];
  const value = { userId, channels: [...new Set(channels)], mutedTypes: [...new Set(mutedTypes)], updatedAt: new Date() };
  await client.db(dbName).collection<PreferenceDoc>("automation_notification_preferences").updateOne({ userId }, { $set: value }, { upsert: true }); return value;
}
export async function claimPendingNotifications(limit = 50) {
  const col = await collection();
  return col.find({ status: "pending", $or: [{ "delivery.whatsapp": { $exists: false } }, { "delivery.telegram": { $exists: false } }] }).sort({ createdAt: 1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
}
export async function updateNotificationDelivery(idValue: string, delivery: NotificationDelivery) { const col = await collection(); const result = await col.findOneAndUpdate({ id: idValue }, { $set: { delivery } }, { returnDocument: "after", projection: { _id: 0 } }); return result?.value ?? null; }
export function notificationObjectId(value: string) { return ObjectId.isValid(value) ? new ObjectId(value) : null; }
