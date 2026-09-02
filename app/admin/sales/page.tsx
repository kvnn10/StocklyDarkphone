"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SalePaymentPanel from "@/components/admin/SalePaymentPanel";

type OrderRow = { id: string; orderNumber: string; total: number; paymentStatus?: string; status?: string; createdAt?: string };

export default function SalesPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/orders", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudieron cargar las ventas");
        setOrders(Array.isArray(result) ? result : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando ventas"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = orders.filter((order) => `${order.orderNumber} ${order.paymentStatus ?? ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 50);

  return (
    <main className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link href="/admin/orders" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"><ArrowLeft className="h-3 w-3" /> Ventas</Link>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><CreditCard className="h-6 w-6" /> Caja de ventas</h1>
        <p className="text-sm text-muted-foreground">Registra ventas completas o abonos y sincroniza Caja, Cartera e Invoice.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        <section className="rounded-2xl border bg-white/70 dark:bg-white/5 backdrop-blur-md p-4 space-y-3">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar número de venta..." /></div>
          {loading && <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando...</div>}
          {error && <div className="text-sm text-red-600 p-2">{error}</div>}
          {!loading && filtered.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No hay ventas para mostrar.</div>}
          <div className="space-y-2 max-h-[620px] overflow-auto">
            {filtered.map((order) => (
              <Button key={order.id} variant={selectedId === order.id ? "secondary" : "ghost"} className="w-full justify-between h-auto py-3 text-left" onClick={() => setSelectedId(order.id)}>
                <span><span className="block font-medium">{order.orderNumber}</span><span className="block text-xs text-muted-foreground">{order.paymentStatus ?? "unpaid"} · {new Date(order.createdAt ?? Date.now()).toLocaleDateString("es-CO")}</span></span>
                <span className="font-semibold">${Number(order.total).toLocaleString("es-CO")}</span>
              </Button>
            ))}
          </div>
        </section>

        {selectedId ? <SalePaymentPanel orderId={selectedId} /> : <section className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">Selecciona una venta para consultar su saldo y registrar un pago.</section>}
      </div>
    </main>
  );
}
