import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, ClipboardList, Package } from "lucide-react";
import { getSession } from "@/lib/auth-server";
import { prisma } from "@/prisma/client";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

const positiveTypes = new Set(["purchase_receipt", "purchase", "transfer_in", "adjustment_in"]);

export default async function KardexPage({ searchParams }: { searchParams?: Promise<{ productId?: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = searchParams ? await searchParams : {};
  const productId = params.productId;
  const validProductId = productId && /^[a-f0-9]{24}$/i.test(productId) ? productId : undefined;

  const [movements, products] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { userId: user.id, ...(validProductId ? { productId: validProductId } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.product.findMany({ where: { userId: user.id, deletedAt: null }, select: { id: true, name: true, sku: true, quantity: true, purchasePrice: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);

  const productIds = [...new Set(movements.map((m) => m.productId))];
  const warehouseIds = [...new Set(movements.map((m) => m.warehouseId))];
  const [movementProducts, warehouses] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds }, userId: user.id }, select: { id: true, name: true, sku: true } }),
    prisma.warehouse.findMany({ where: { id: { in: warehouseIds }, userId: user.id }, select: { id: true, name: true } }),
  ]);
  const productMap = new Map(movementProducts.map((p) => [p.id, p]));
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
  const selectedProduct = validProductId ? products.find((p) => p.id === validProductId) : null;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/products"><Button variant="ghost" size="icon" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <PageSectionHeader title="Kardex de inventario" description={selectedProduct ? `${selectedProduct.name} · ${selectedProduct.sku}` : "Trazabilidad de entradas, salidas y ajustes de inventario."} tone="sky" icon={ClipboardList} className="flex-1" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Package className="h-4 w-4" />Movimientos mostrados</div><p className="text-2xl font-bold">{movements.length}</p></div>
        <div className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-2 text-sm text-muted-foreground">Productos con movimientos</div><p className="text-2xl font-bold">{productIds.length}</p></div>
        <div className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-2 text-sm text-muted-foreground">Stock actual seleccionado</div><p className="text-2xl font-bold">{selectedProduct ? Number(selectedProduct.quantity) : "—"}</p></div>
      </div>

      {selectedProduct && <div className="rounded-2xl border bg-card/80 p-4 shadow-sm"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Producto:</span><Link className="font-semibold text-sky-600 hover:underline" href={`/admin/products/${selectedProduct.id}`}>{selectedProduct.name}</Link><span className="text-xs text-muted-foreground">Costo actual {money(Number(selectedProduct.purchasePrice))}</span><Link className="ml-auto text-sm text-muted-foreground hover:text-foreground" href="/admin/kardex">Ver todo el Kardex</Link></div></div>}

      <section className="overflow-hidden rounded-2xl border bg-card/80 shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Producto</TableHead><TableHead>Tipo</TableHead><TableHead>Motivo / referencia</TableHead><TableHead>Bodega</TableHead><TableHead className="text-right">Cambio</TableHead><TableHead className="text-right">Antes</TableHead><TableHead className="text-right">Después</TableHead></TableRow></TableHeader>
          <TableBody>
            {movements.length === 0 ? <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No hay movimientos registrados todavía.</TableCell></TableRow> : movements.map((m) => {
              const qty = Number(m.quantity); const positive = positiveTypes.has(m.type); const product = productMap.get(m.productId); const warehouse = warehouseMap.get(m.warehouseId);
              return <TableRow key={m.id}><TableCell>{new Date(m.createdAt).toLocaleString("es-CO")}</TableCell><TableCell><Link href={`/admin/products/${m.productId}`} className="font-medium text-sky-600 hover:underline">{product?.name ?? "Producto"}</Link><div className="text-[11px] text-muted-foreground">{product?.sku ?? "—"}</div></TableCell><TableCell><span className="inline-flex items-center gap-1.5">{positive ? <ArrowUpCircle className="h-4 w-4 text-emerald-500" /> : <ArrowDownCircle className="h-4 w-4 text-rose-500" />}{m.type}</span></TableCell><TableCell><div>{m.reason ?? "—"}</div><div className="text-[11px] text-muted-foreground">{m.referenceId ? `Ref: ${m.referenceId}` : m.notes ?? ""}</div></TableCell><TableCell>{warehouse?.name ?? "Bodega"}</TableCell><TableCell className={`text-right font-semibold ${positive ? "text-emerald-600" : "text-rose-600"}`}>{positive ? "+" : "−"}{qty}</TableCell><TableCell className="text-right">{Number(m.previousStock)}</TableCell><TableCell className="text-right font-semibold">{Number(m.newStock)}</TableCell></TableRow>;
            })}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
