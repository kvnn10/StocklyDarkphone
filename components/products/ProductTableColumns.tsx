"use client";
import { SafeImage } from "@/components/ui/safe-image";
import Link from "next/link";
import { Product } from "@/types";
import { Column, ColumnDef } from "@tanstack/react-table";
import { CopyableText, AvatarInlineLink, PersonNameEmailCell, TABLE_CATALOG_LINK_CLASS, ClientDate } from "@/components/shared";
import ProductsDropDown from "@/components/products/ProductActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QRCodeHover } from "@/components/ui/qr-code-hover";
import { ProductStockFromQuantityBadge, productStockAvailableTextClass } from "@/lib/ui/semantic-badges";
import { getDisplayCommittedQuantity } from "@/lib/products/enrich-product-committed-quantity";
import { useStockByProduct } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { ArrowUpDown, MapPin, Package } from "lucide-react";
import { IoMdArrowDown, IoMdArrowUp } from "react-icons/io";

function detailHref(base: string, segment: string, id: string): string { const prefix = base ? `${base}/` : "/"; return `${prefix}${segment}/${id}`; }
type SortableHeaderProps = { column: Column<Product, unknown>; label: string };
const SortableHeader: React.FC<SortableHeaderProps> = ({ column, label }) => { const isSorted = column.getIsSorted(); const SortingIcon = isSorted === "asc" ? IoMdArrowUp : isSorted === "desc" ? IoMdArrowDown : ArrowUpDown; return <DropdownMenu><DropdownMenuTrigger asChild><div className={`flex items-center select-none cursor-pointer gap-1 py-2 text-sm font-normal text-gray-700 dark:text-white ${isSorted && "text-primary"}`}>{label}<SortingIcon className="h-4 w-4" /></div></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => column.toggleSorting(false)}>Ascendente</DropdownMenuItem><DropdownMenuItem onClick={() => column.toggleSorting(true)}>Descendente</DropdownMenuItem></DropdownMenuContent></DropdownMenu>; };

function ProductWarehouseCell({ productId }: { productId: string }) {
 const { data: allocations = [], isLoading } = useStockByProduct(productId);
 if (isLoading) return <span className="text-xs text-muted-foreground">Cargando…</span>;
 if (allocations.length === 0) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0"/>Sin bodega asignada</div>;
 return <div className="flex min-w-[145px] flex-col gap-1">{allocations.map((allocation) => { const available = Math.max(0, Number(allocation.quantity ?? 0) - Number(allocation.reservedQuantity ?? 0)); return <div key={allocation.id} className="flex items-center gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5 shrink-0 text-rose-400"/><span className="truncate" title={allocation.warehouse?.name ?? allocation.warehouseId}>{allocation.warehouse?.name ?? "Bodega"}</span><span className="ml-auto whitespace-nowrap font-semibold text-white/80">{available}</span></div>; })}</div>;
}

function ProductMarginCell({ product }: { product: Product }) {
 const purchase = Number(product.purchasePrice ?? 0);
 const sale = Number(product.price ?? 0);
 if (sale <= 0 || purchase <= 0) return <span className="text-xs text-muted-foreground">—</span>;
 const profit = sale - purchase;
 const margin = (profit / sale) * 100;
 return <div className="flex min-w-[105px] flex-col gap-0.5"><span className={cn("text-xs font-semibold", profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{margin.toFixed(1)}%</span><span className="text-[11px] text-muted-foreground">Utilidad: ${profit.toFixed(2)}</span></div>;
}

export type CreateProductColumnsOptions = { forSupplier?: boolean };
export function createProductColumns(detailBase: string = "", options?: CreateProductColumnsOptions): ColumnDef<Product>[] {
 const forSupplier = options?.forSupplier === true;
 return [
  { id:"product", accessorKey:"name", header:({column})=><SortableHeader column={column} label="Producto y SKU"/>, cell:({row})=>{const p=row.original; return <div className="flex items-center gap-3 min-w-0 max-w-[220px]">{p.imageUrl?<SafeImage src={p.imageUrl} alt={p.name} width={48} height={48} className="h-12 w-12 shrink-0 object-cover rounded-lg border border-rose-400/30" unoptimized={p.imageUrl.includes("ik.imagekit.io")}/>:<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 border"><Package className="h-5 w-5 text-muted-foreground"/></div>}<div className="flex min-w-0 flex-col"><Link href={detailHref(detailBase,"products",p.id)} prefetch className={cn("truncate",TABLE_CATALOG_LINK_CLASS)} title={p.name}><CopyableText value={p.name}>{p.name}</CopyableText></Link><CopyableText value={p.sku} className="truncate text-muted-foreground">{p.sku}</CopyableText></div></div>; }},
  { accessorKey:"quantity", header:({column})=><SortableHeader column={column} label="Stock"/>, cell:({row})=>{const p=row.original; const total=Number(p.quantity)||0; const reserved=getDisplayCommittedQuantity(p); const available=Math.max(0,total-reserved); const sold=Math.max(0,Number(p.statistics?.totalQuantitySold)||0); return <div className="flex flex-col gap-1 min-w-[110px]"><div className="flex items-center gap-2"><QRCodeHover data={JSON.stringify({id:p.id,name:p.name,sku:p.sku,price:p.price,purchasePrice:p.purchasePrice,quantity:p.quantity,status:p.status,category:p.category,supplier:p.supplier})} qrCodeUrl={p.qrCodeUrl} title={p.name} size={200} iconOnly/><span className={`text-xs font-semibold ${productStockAvailableTextClass(available)}`}>{available} disponibles</span></div><div className="text-[11px] text-muted-foreground">Total: {total}</div><div className="text-[11px] text-amber-600 dark:text-amber-400">Reservado: {reserved}</div><div className="text-[11px] text-muted-foreground">Vendido: {sold}</div></div>; }},
  { id:"warehouse", header:"Ubicación", cell:({row})=><ProductWarehouseCell productId={row.original.id}/> },
  { accessorKey:"status", header:({column})=><SortableHeader column={column} label="Estado"/>, cell:({row})=><ProductStockFromQuantityBadge available={Math.max(0,(Number(row.original.quantity)||0)-getDisplayCommittedQuantity(row.original))}/> },
  ...(!forSupplier ? [{ accessorKey:"purchasePrice", header:({column})=><SortableHeader column={column} label="Precio compra"/>, cell:({getValue})=>`$${Number(getValue<number>() ?? 0).toFixed(2)}` } as ColumnDef<Product>] : []),
  { accessorKey:"price", header:({column})=><SortableHeader column={column} label="Precio venta"/>, cell:({getValue})=>`$${getValue<number>().toFixed(2)}` },
  ...(!forSupplier ? [{ id:"margin", header:"Margen / utilidad", accessorFn:(row)=>{const purchase=Number(row.purchasePrice ?? 0); const sale=Number(row.price ?? 0); return sale > 0 && purchase > 0 ? ((sale-purchase)/sale)*100 : 0;}, cell:({row})=><ProductMarginCell product={row.original}/> } as ColumnDef<Product>] : []),
  { accessorKey:"createdAt", id:"dates", header:({column})=><SortableHeader column={column} label="Creación / vencimiento"/>, cell:({row})=>{const p=row.original; const exp=p.expirationDate; let cls="text-muted-foreground"; if(exp){const d=Math.ceil((new Date(exp).getTime()-Date.now())/86400000);if(d<0)cls="text-red-600 dark:text-red-400";else if(d<=7)cls="text-orange-600 dark:text-orange-400";} return <div className="flex flex-col gap-0.5 text-xs text-muted-foreground"><span>Creado: {p.createdAt?<ClientDate date={p.createdAt} semantic="created" className="text-xs"/>:"—"}</span><span className={cn("text-xs",cls)}>Vence: {exp?<ClientDate date={exp} semantic="expiration" className="text-xs"/>:"—"}</span></div>; }},
  { accessorKey:"category", header:"Categoría", cell:({row})=>{const p=row.original;const n=typeof p.category==="object"&&p.category?p.category.name:(p.category as string|undefined)||"Desconocida";return p.categoryId?<Link href={detailHref(detailBase,"categories",p.categoryId)} className={TABLE_CATALOG_LINK_CLASS}>{n}</Link>:<span>{n}</span>;}},
  ...(forSupplier?[{id:"productOwner",header:"Propietario del producto",cell:({row}:{row:{original:Product}})=>{const p=row.original;return <PersonNameEmailCell seed={p.userId} name={p.productOwnerName??p.userId??"—"} email={p.productOwnerEmail} image={p.productOwnerImage} avatarSize={28}/>;}} as ColumnDef<Product>]:[{accessorKey:"supplier",header:"Proveedor",cell:({row}:{row:{original:Product}})=>{const p=row.original;const n=typeof p.supplier==="object"&&p.supplier?p.supplier.name:(p.supplier as string|undefined)||"Desconocido";return p.supplierId?<AvatarInlineLink seed={p.supplierId} label={n} href={detailHref(detailBase,"suppliers",p.supplierId)} size={24} linkClassName={TABLE_CATALOG_LINK_CLASS}/>:<span>{n}</span>;}} as ColumnDef<Product>]),
  {id:"actions",header:"Acciones",cell:({row})=><ProductsDropDown row={row} detailBase={detailBase}/>} ]; }
export const columns=createProductColumns("");