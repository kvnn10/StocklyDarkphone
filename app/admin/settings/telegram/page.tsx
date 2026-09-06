"use client";

import { useState } from "react";
import { Bell, CheckCircle2, Send, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContentWrapper } from "@/components/shared";

export default function TelegramSettingsPage() {
  const [chatId, setChatId] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = async () => {
    setResult(null);
    if (!chatId.trim()) {
      setResult({ ok: false, text: "Indica el Chat ID de Telegram." });
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/automation/telegram-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatId.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo enviar la prueba.");
      setResult({ ok: true, text: "Mensaje enviado correctamente. Revisa Telegram." });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "No se pudo enviar la prueba." });
    } finally {
      setSending(false);
    }
  };

  return (
    <PageContentWrapper>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2"><Bell className="h-5 w-5" /><h1 className="text-2xl font-semibold tracking-tight">Telegram</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Prueba y valida el canal de Telegram de las automatizaciones de Stockly.</p>
        </div>

        <section className="rounded-xl border bg-card p-5 shadow-sm space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div><h2 className="font-semibold">Conexión segura</h2><p className="text-sm text-muted-foreground">El token del bot permanece en las variables de entorno de producción y nunca se muestra en pantalla.</p></div>
          </div>

          <div className="space-y-2">
            <label htmlFor="telegram-chat-id" className="text-sm font-medium">Chat ID</label>
            <Input id="telegram-chat-id" inputMode="numeric" value={chatId} onChange={e => setChatId(e.target.value)} placeholder="Ej. 415201566" />
            <p className="text-xs text-muted-foreground">Usa el Chat ID del usuario o grupo que recibirá las notificaciones.</p>
          </div>

          <Button onClick={sendTest} disabled={sending || !chatId.trim()}>
            <Send className="h-4 w-4" />{sending ? "Enviando…" : "Enviar mensaje de prueba"}
          </Button>

          {result && <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${result.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`} role="status">
            {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{result.text}</span>
          </div>}
        </section>
      </div>
    </PageContentWrapper>
  );
}
