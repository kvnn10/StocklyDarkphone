import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { setNotificationPreferences } from "@/lib/automation/notifications";

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, "notifications", "create");
  if (auth.response) return auth.response;
  if (!auth.session || (auth.session.role !== "admin" && auth.session.role !== "gerente")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "Telegram no está configurado: falta TELEGRAM_BOT_TOKEN." }, { status: 503 });

  let body: { chatId?: string } = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const chatId = String(body.chatId ?? process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!chatId) return NextResponse.json({ error: "Indica un Chat ID de Telegram." }, { status: 400 });

  const message = [
    "🔔 Stockly — Prueba de Telegram",
    "",
    "La integración de Telegram está funcionando correctamente.",
    "DarkPhone Stockly puede enviar notificaciones.",
  ].join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !data?.ok) {
      return NextResponse.json({ error: data?.description ?? `Telegram HTTP ${response.status}` }, { status: 502 });
    }

    await prisma.user.update({ where: { id: auth.session.id }, data: { telegramChatId: chatId } });
    await setNotificationPreferences(auth.session.id, ["in_app", "telegram"]);

    return NextResponse.json({ ok: true, chatId });
  } catch (error) {
    console.error("telegram test failed", error);
    return NextResponse.json({ error: "No se pudo completar la configuración de Telegram." }, { status: 502 });
  }
}
