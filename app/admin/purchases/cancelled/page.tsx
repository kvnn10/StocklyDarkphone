"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContentWrapper } from "@/components/shared";

type CancelledPurchase = {
  id: string;
  purchaseNumber: string;
  supplierName: string;
  warehouseName?: string;
  supplierInvoice?: string | null;
  total: number;
  createdAt: string;
  cancelledAt?: string | null;
  reason?: string | null;
  notes?: string | null;
  items: Array<{ productName: string; variantName?: string | null; sku?: string | null; orderedQuantity: number; receivedQuantity: number; returnedQuantity?: number; unitCost: number }>;
};

const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
const date = (value?: string | null) => value ? new Date(value).toLocaleString("es-CO") : "—";

export default function CancelledPurchasesPage() {
  const [purchases, setPurchases] = useState<CancelledPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<CancelledPurchase | null>(null);

  const load = async () => {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/purchases/cancelled?refresh=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial de anulaciones");
      setPurchases(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el historial de anulaciones");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return <PageContentWrapper><div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link href="/admin/purchases"><Button variant="outline" size="icon" title="Volver a compras"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div><h1 className="text-2xl font-semibold tracking-tight">Compras anuladas</h1><p className="text-sm text-muted-foreground">Historial de compras anuladas con trazabilidad y observación.</p></div>
      </div>
      <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Actualizar</Button>
    </div>

    {message && <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</div>}

    <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="border-b p-5 flex items-center justify-between"><div><h2 className="font-semibold">Historial de anulaciones</h2><p className="text-xs text-muted-foreground mt-1">{purchases.length} compra(s) anulada(s)</p></div></div>
      {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando historial...</div> : purchases.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No hay compras anuladas.</div> : <div className="divide-y">
        {purchases.map(p => <div key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[280px] flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.purchaseNumber} · {p.supplierName}</span><span className="rounded-full border px-2 py-0.5 text-xs">Anulada</span></div>
            <div className="text-sm text-muted-foreground mt-1">Creada: {date(p.createdAt)} · {p.warehouseName || "—"} · {p.items.length} producto(s)</div>
            <div className="text-sm mt-2"><span className="font-medium">Anulada:</span> {date(p.cancelledAt)}</div>
            <div className="text-sm mt-1"><span className="font-medium">Observación:</span> {p.reason || "Sin observación registrada"}</div>
          </div>
          <div className="flex items-center gap-3"><span className="font-semibold">{money(p.total)}</span><Button variant="outline" size="icon" title="Ver detalle de la anulación" onClick={() => setDetail(p)}><Eye className="h-4 w-4" /></Button></div>
        </div>)}
      </div>}
    </section>

    {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-xl border bg-card p-5 shadow-xl space-y-5">
      <div className="flex items-start justify-between"><div><h3 className="text-xl font-semibold">{detail.purchaseNumber} · Anulada</h3><p className="text-sm text-muted-foreground">{detail.supplierName} · {detail.warehouseName || "—"}</p></div><Button variant="ghost" size="icon" onClick={() => setDetail(null)}><X className="h-4 w-4" /></Button></div>
      <div className="grid gap-3 md:grid-cols-3 text-sm"><div><span className="text-muted-foreground">Compra registrada</span><div>{date(detail.createdAt)}</div></div><div><span className="text-muted-foreground">Anulación</span><div>{date(detail.cancelledAt)}</div></div><div><span className="text-muted-foreground">Total original</span><div className="font-semibold">{money(detail.total)}</div></div></div>
      <div className="rounded-lg border bg-muted/30 p-4"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Motivo / observación</div><div className="mt-1 text-sm">{detail.reason || "Sin observación registrada"}</div></div>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Producto</th><th className="p-3">Pedido</th><th className="p-3">Recibido</th><th className="p-3">Revertido</th><th className="p-3">Costo</th></tr></thead><tbody>{detail.items.map((item, index) => <tr key={`${item.sku}-${index}`} className="border-b last:border-0"><td className="p-3">{item.productName}{item.variantName ? <div className="text-xs font-medium">Variante: {item.variantName}</div> : null}<div className="text-xs text-muted-foreground">{item.sku || "—"}</div></td><td className="p-3">{item.orderedQuantity}</td><td className="p-3">{item.receivedQuantity}</td><td className="p-3">{item.receivedQuantity - (item.returnedQuantity || 0)}</td><td className="p-3">{money(item.unitCost)}</td></tr>)}</tbody></table></div>
      <div className="flex justify-end"><Button variant="outline" onClick={() => setDetail(null)}>Cerrar</Button></div>
    </div></div>}
  </div></PageContentWrapper>;
}
