"use client";

import { useMemo, useState } from "react";
import { BatteryCharging, CheckCircle2, Loader2, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Product = { id: string; name: string; sku: string; purchasePrice?: number };
type Supplier = { id: string; name: string; status?: boolean };
type Warehouse = { id: string; name: string; status?: boolean };
type Category = { id: string; name: string; status?: boolean };

type BatteryLine = {
  name: string;
  sku: string;
  quantity: number;
  unitCost: number;
};

const lines: BatteryLine[] = [
  { name: "Batería iPhone 12", sku: "BAT-DIAG-IP12", quantity: 10, unitCost: 33000 },
  { name: "Batería iPhone 12 Pro", sku: "BAT-DIAG-IP12P", quantity: 8, unitCost: 33000 },
  { name: "Batería iPhone 13", sku: "BAT-DIAG-IP13", quantity: 27, unitCost: 33000 },
  { name: "Batería iPhone 13 Pro Max", sku: "BAT-DIAG-IP13PM", quantity: 21, unitCost: 41000 },
  { name: "Batería iPhone 14 Pro Max", sku: "BAT-DIAG-IP14PM", quantity: 22, unitCost: 41000 },
  { name: "Batería iPhone 15 Pro Max", sku: "BAT-DIAG-IP15PM", quantity: 17, unitCost: 41000 },
];

const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export default function BatteryPurchaseQuickLoad() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transfer");

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0), []);
  const total = subtotal + 108000;
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const close = () => {
    if (!loading) {
      setOpen(false);
      setMessage("");
      setError("");
    }
  };

  const loadPurchase = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const [productsResponse, suppliersResponse, warehousesResponse, categoriesResponse] = await Promise.all([
        fetch("/api/products", { cache: "no-store" }),
        fetch("/api/suppliers", { cache: "no-store" }),
        fetch("/api/warehouses", { cache: "no-store" }),
        fetch("/api/categories", { cache: "no-store" }),
      ]);

      const [products, suppliers, warehouses, categories] = await Promise.all([
        productsResponse.json(),
        suppliersResponse.json(),
        warehousesResponse.json(),
        categoriesResponse.json(),
      ]);

      if (!productsResponse.ok || !Array.isArray(products)) throw new Error("No se pudieron cargar los productos.");
      if (!suppliersResponse.ok || !Array.isArray(suppliers)) throw new Error("No se pudieron cargar los proveedores.");
      if (!warehousesResponse.ok || !Array.isArray(warehouses)) throw new Error("No se pudieron cargar las bodegas.");
      if (!categoriesResponse.ok || !Array.isArray(categories)) throw new Error("No se pudieron cargar las categorías.");

      const supplier: Supplier | undefined = suppliers.find((item: Supplier) => item.status !== false && item.name.trim().toLowerCase() === "aliexpress") ?? suppliers.find((item: Supplier) => item.status !== false);
      const warehouse: Warehouse | undefined = warehouses.find((item: Warehouse) => item.status !== false && item.name.trim().toLowerCase() === "darkphone") ?? warehouses.find((item: Warehouse) => item.status !== false);
      const category: Category | undefined = categories.find((item: Category) => item.status !== false && item.name.trim().toLowerCase() === "baterías") ?? categories.find((item: Category) => item.status !== false && item.name.trim().toLowerCase() === "baterias");

      if (!supplier) throw new Error("No existe un proveedor activo para la compra.");
      if (!warehouse) throw new Error("No existe una bodega activa para la compra.");
      if (!category) throw new Error("No existe la categoría Baterías.");

      const productMap = new Map<string, Product>();
      for (const line of lines) {
        const existing = products.find((item: Product) => item.sku.trim().toUpperCase() === line.sku);
        if (existing) {
          productMap.set(line.sku, existing);
          continue;
        }

        const response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: line.name,
            sku: line.sku,
            purchasePrice: line.unitCost,
            price: 80000,
            quantity: 0,
            status: "Stock Out",
            categoryId: category.id,
            supplierId: supplier.id,
          }),
        });
        const created = await response.json();
        if (!response.ok) throw new Error(created?.error || `No se pudo crear ${line.name}.`);
        productMap.set(line.sku, created);
      }

      const items = lines.map((line) => ({
        productId: productMap.get(line.sku)!.id,
        variantId: null,
        quantity: line.quantity,
        unitCost: line.unitCost,
      }));

      const purchaseResponse = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          paymentMode: "paid",
          paymentMethod,
          discount: 0,
          tax: 0,
          shipping: 108000,
          notes: "Carga inicial de baterías Vormir — inversión real $3.961.000 COP.",
          items,
        }),
      });

      const purchase = await purchaseResponse.json();
      if (!purchaseResponse.ok) throw new Error(purchase?.error || "No se pudo registrar la compra.");

      setMessage(`Compra ${purchase.purchaseNumber} registrada. ${quantity} unidades agregadas al inventario por ${money(total)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la compra.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Carga rápida de compra de baterías"
        title="Cargar compra de baterías"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <BatteryCharging className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="battery-purchase-title">
          <div className="w-full max-w-3xl rounded-2xl border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /><h2 id="battery-purchase-title" className="text-lg font-semibold">Carga rápida — compra de baterías</h2></div>
                <p className="mt-1 text-sm text-muted-foreground">Crea las referencias que no existan y registra una sola compra conectada al inventario.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={close} disabled={loading}><X className="h-4 w-4" /></Button>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[1fr_90px_120px_120px] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"><span>Producto</span><span>Cant.</span><span>Costo</span><span>Venta</span></div>
              {lines.map((line) => <div key={line.sku} className="grid grid-cols-[1fr_90px_120px_120px] gap-3 border-b px-4 py-3 text-sm last:border-b-0"><span>{line.name}<span className="ml-2 text-xs text-muted-foreground">{line.sku}</span></span><span>{line.quantity}</span><span>{money(line.unitCost)}</span><span>{money(80000)}</span></div>)}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Unidades</div><div className="font-semibold">{quantity}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Subtotal</div><div className="font-semibold">{money(subtotal)}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Total real</div><div className="font-semibold">{money(total)}</div></div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm"><span className="font-medium">Costo adicional:</span> {money(108000)} (flete/gastos)</div>
              <label className="flex items-center gap-2 text-sm"><span>Pago</span><select className="h-9 rounded-md border bg-background px-3" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={loading}><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="other">Otro</option></select></label>
            </div>

            {message && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
            {error && <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={loading}>Cerrar</Button>
              <Button onClick={loadPurchase} disabled={loading || Boolean(message)}>{loading ? <><Loader2 className="h-4 w-4 animate-spin" />Registrando...</> : "Registrar compra"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
