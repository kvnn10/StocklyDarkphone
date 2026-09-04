import { MongoClient, ObjectId } from "mongodb";
import { claimPendingNotifications, updateNotificationDelivery, type Notification, type NotificationChannel, type NotificationDelivery } from "@/lib/automation/notifications";
const globalForDispatch = globalThis as typeof globalThis & { __stocklyDispatchClient?: MongoClient };
async function db() { if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required"); const client = globalForDispatch.__stocklyDispatchClient ??= new MongoClient(process.env.DATABASE_URL); await client.connect(); const name = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "").split("?")[0]; return client.db(name); }
async function userFor(database: Awaited<ReturnType<typeof db>>, userId: string) { const id = ObjectId.isValid(userId) ? new ObjectId(userId) : null; return database.collection("User").findOne(id ? { _id: id } : { id: userId }, { projection: { phone: 1, whatsapp: 1, telegramChatId: 1 } }); }
async function sendWhatsApp(phone: string, body: string) {
  const url = process.env.WHATSAPP_API_URL; const token = process.env.WHATSAPP_API_TOKEN; const numberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!url || !token || !numberId || !phone) return "skipped" as const;
  const response = await fetch(`${url.replace(/\/$/, "")}/${numberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body } }) });
  if (!response.ok) throw new Error(`WhatsApp HTTP ${response.status}`); return "sent" as const;
}
async function sendTelegram(chatId: string, body: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN; if (!token || !chatId) return "skipped" as const;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: body }) });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`); return "sent" as const;
}
export async function dispatchPendingNotifications(limit = 50) {
  const database = await db(); const notifications = await claimPendingNotifications(limit); const summary = { processed: 0, sent: 0, skipped: 0, failed: 0 };
  for (const notification of notifications) {
    const user = await userFor(database, notification.userId); const delivery: NotificationDelivery = { ...(notification.delivery ?? {}), attempts: (notification.delivery?.attempts ?? 0) + 1, lastAttemptAt: new Date() };
    for (const channel of notification.channels as NotificationChannel[]) {
      if (channel === "in_app") { delivery.in_app = "sent"; continue; }
      if (delivery[channel] === "sent" || delivery[channel] === "skipped") continue;
      try {
        const state = channel === "whatsapp" ? await sendWhatsApp(String(user?.whatsapp ?? user?.phone ?? ""), notification.message) : await sendTelegram(String(user?.telegramChatId ?? ""), notification.message);
        delivery[channel] = state; state === "sent" ? summary.sent++ : summary.skipped++;
      } catch (error) { delivery[channel] = "failed"; delivery.lastError = error instanceof Error ? error.message : "Delivery failed"; summary.failed++; }
    }
    const terminal = notification.channels.every((channel) => ["sent", "skipped"].includes(String(delivery[channel])));
    await updateNotificationDelivery(notification.id, delivery); if (terminal) summary.processed++;
  }
  return summary;
}
