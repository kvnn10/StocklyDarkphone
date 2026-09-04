import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { enqueueNotification, listNotifications, markNotificationRead, getNotificationPreferences, setNotificationPreferences, type NotificationChannel, type NotificationPriority } from "@/lib/automation/notifications";

const channels: NotificationChannel[] = ["in_app", "whatsapp", "telegram"];
const priorities: NotificationPriority[] = ["low", "normal", "high", "critical"];

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "notifications", "read");
  if (auth.response) return auth.response;
  try {
    const userId = auth.session!.id;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    if (request.nextUrl.searchParams.get("preferences") === "1") {
      return NextResponse.json({ preferences: await getNotificationPreferences(userId) });
    }
    return NextResponse.json({ notifications: await listNotifications(userId, limit) });
  } catch (error) {
    console.error("notifications GET failed", error);
    return NextResponse.json({ error: "Unable to load notifications" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, "notifications", "create");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    if (typeof body.userId !== "string" || typeof body.type !== "string" || typeof body.title !== "string" || typeof body.message !== "string") {
      return NextResponse.json({ error: "userId, type, title and message are required" }, { status: 400 });
    }
    const priority = priorities.includes(body.priority) ? body.priority : "normal";
    const requestedChannels = Array.isArray(body.channels) ? body.channels.filter((c: unknown): c is NotificationChannel => typeof c === "string" && channels.includes(c as NotificationChannel)) : ["in_app"];
    if (!requestedChannels.length) return NextResponse.json({ error: "At least one valid channel is required" }, { status: 400 });
    const notification = await enqueueNotification({
      userId: body.userId,
      type: body.type,
      title: body.title,
      message: body.message,
      priority,
      channels: requestedChannels,
      data: body.data && typeof body.data === "object" ? body.data : undefined,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    console.error("notifications POST failed", error);
    return NextResponse.json({ error: "Unable to enqueue notification" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeRequest(request, "notifications", "update");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    if (body.action === "read" && typeof body.notificationId === "string") {
      const notification = await markNotificationRead(auth.session!.id, body.notificationId);
      return notification ? NextResponse.json({ notification }) : NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    if (body.action === "preferences") {
      const selected = Array.isArray(body.channels) ? body.channels.filter((c: unknown): c is NotificationChannel => typeof c === "string" && channels.includes(c as NotificationChannel)) : ["in_app"];
      const mutedTypes = Array.isArray(body.mutedTypes) ? body.mutedTypes.filter((v: unknown): v is string => typeof v === "string") : [];
      return NextResponse.json({ preferences: await setNotificationPreferences(auth.session!.id, selected, mutedTypes) });
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("notifications PATCH failed", error);
    return NextResponse.json({ error: "Unable to update notifications" }, { status: 500 });
  }
}
