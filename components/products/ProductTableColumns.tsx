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
import { cn } from "@/lib/utils";
import { ArrowUpDown } from "lucide-react";
import { IoMdArrowDown, IoMdArrowUp } from "react-icons/io";

function detailHref(base: string, segment: string, id: string): string {
  const prefix = base ? `${base}/` : "/";
  return `${prefix}${segment}/${id}`;
}

type SortableHeaderProps = { column: Column<Product, unknown>; label: string };

const SortableHeader: React.FC<SortableHeaderProps> = ({ column, label }) => {
  const isSorted = column.getIsSorted();
  const SortingIcon = isSorted === "asc" ? IoMdArrowUp : isSorted === "desc" ? IoMdArrowDown : ArrowUpDown;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="" asChild>
        <div className={`flex items-center select-none cursor-pointer gap-1 py-2 text-sm font-normal text-gray-700 dark:text-white ${isSorted && "text-primary"}`} aria-label={`Ordenar por ${label}`}>
          {label}<SortingIcon className="h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        <DropdownMenuItem onClick={() => column.toggleSorting(false)}><IoMdArrowUp className="mr-2 h-4 w-4" />Ascendente</DropdownMenuItem>
        <DropdownMenuItem onClick={() => column.toggleSorting(true)}><IoMdArrowDown className="mr-2 h-4 w-4" />Descendente</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export type CreateProductColumnsOptions = { forSupplier?: boolean };

export function createProductColumns(detailBase: string = "", options?: CreateProductColumnsOptions): ColumnDef<Product>[] {
  const forSupplier = options?.forSupplier === true;
  return [
    {
      id: "product", accessorKey: "name",
      header: ({ column }) => <SortableHeader column={column} label="Producto y SKU" />,
      cell: ({ row }) => {
        const product = row.original;
        return <div className="flex items-center gap-3 min-w-0 max-w-[220px]">
          {product.imageUrl ? <SafeImage src={product.imageUrl} alt={product.name} width={48} height={48} className="h-12 w-12 shrink-0 object-cover rounded-lg border border-rose-400/30" unoptimized={product.imageUrl.includes("ik.imagekit.io")} /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-700"><span className="text-[10px] text-gray-500 dark:text-gray-300">Sin imagen</span></div>}
          <div className="flex min-w-0 flex-col">
            <Link href={detailHref(detailBase, "products", product.id)} prefetch className={cn("truncate", TABLE_CATALOG_LINK_CLASS)} title={product.name}><CopyableText value={product.name}>{product.name}</CopyableText></Link>
            <CopyableText value={product.sku} className="truncate text-muted-foreground">{product.sku}</CopyableText>
          </div>
        </div>;
      },
    },
    {
      accessorKey: "quantity", header: ({ column }) => <SortableHeader column={column} label="QR y stock" />,
      cell: ({ row }) => {
        const quantity = row.original.quantity; const reserved = getDisplayCommittedQuantity(row.original); const available = quantity - reserved;
        return <div className="flex items-center gap-2"><QRCodeHover data={JSON.stringify({ id: row.original.id, name: row.original.name, sku: row.original.sku, price: row.original.price, quantity: row.original.quantity, status: row.original.status, category: row.original.category, supplier: row.original.supplier })} qrCodeUrl={row.original.qrCodeUrl} title={row.original.name} size={200} iconOnly /><div className="flex flex-col justify-center gap-0.5 min-w-0"><span className={`text-xs font-medium ${productStockAvailableTextClass(available)}`}>{available}</span>{reserved > 0 ? <span className="text-xs text-muted-foreground">{reserved} reservados</span> : null}</div></div>;
      },
    },
    { accessorKey: "status", header: ({ column }) => <SortableHeader column={column} label="Estado" />, cell: ({ row }) => <ProductStockFromQuantityBadge available={row.original.quantity - getDisplayCommittedQuantity(row.original)} /> },
    { accessorKey: "price", header: ({ column }) => <SortableHeader column={column} label="Precio" />, cell: ({ getValue }) => `$${getValue<number>().toFixed(2)}` },
    {
      accessorKey: "createdAt", id: "dates", header: ({ column }) => <SortableHeader column={column} label="Creación / vencimiento" />,
      cell: ({ row }) => {
        const product = row.original; const createdAt = product.createdAt; const expirationDate = product.expirationDate;
        let expireClass = "text-muted-foreground";
        if (expirationDate) { const expDate = new Date(expirationDate); const today = new Date(); const daysUntilExpiry = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)); if (daysUntilExpiry < 0) expireClass = "text-red-600 dark:text-red-400"; else if (daysUntilExpiry <= 7) expireClass = "text-orange-600 dark:text-orange-400"; }
        return <div className="flex flex-col gap-0.5 text-xs text-muted-foreground"><span className="text-xs">Creado: {createdAt ? <ClientDate date={createdAt} semantic="created" className="text-xs" /> : <span>—</span>}</span><span className={cn("text-xs", expireClass)}>Vence: {expirationDate ? <ClientDate date={expirationDate} semantic="expiration" className="text-xs" /> : <span>—</span>}</span></div>;
      },
    },
    {
      accessorKey: "category", header: "Categoría", cell: ({ row }) => { const product = row.original; const categoryName = typeof product.category === "object" && product.category ? product.category.name : (product.category as string | undefined) || "Desconocida"; return product.categoryId ? <Link href={detailHref(detailBase, "categories", product.categoryId)} className={TABLE_CATALOG_LINK_CLASS}>{categoryName}</Link> : <span>{categoryName}</span>; },
    },
    ...(forSupplier ? [{ id: "productOwner", header: "Propietario del producto", cell: ({ row }: { row: { original: Product } }) => { const product = row.original; const name = product.productOwnerName ?? product.userId ?? "—"; return <PersonNameEmailCell seed={product.userId} name={name} email={product.productOwnerEmail} image={product.productOwnerImage} avatarSize={28} />; } } as ColumnDef<Product>] : [{ accessorKey: "supplier", header: "Proveedor", cell: ({ row }: { row: { original: Product } }) => { const product = row.original; const supplierName = typeof product.supplier === "object" && product.supplier ? product.supplier.name : (product.supplier as string | undefined) || "Desconocido"; return product.supplierId ? <AvatarInlineLink seed={product.supplierId} label={supplierName} href={detailHref(detailBase, "suppliers", product.supplierId)} size={24} linkClassName={TABLE_CATALOG_LINK_CLASS} /> : <span>{supplierName}</span>; } } as ColumnDef<Product>]),
    { id: "actions", header: "Acciones", cell: ({ row }) => <ProductsDropDown row={row} detailBase={detailBase} /> },
  ];
}

export const columns = createProductColumns("");
