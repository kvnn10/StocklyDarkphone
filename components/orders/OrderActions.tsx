/** Order actions for order table rows. */
"use client";
import React, { useState } from "react";
import { Order } from "@/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Eye, Edit, Trash2, Star, FilePlus2, FileText } from "lucide-react";
import Link from "next/link";
import { useDeleteOrder, useDeleteInvoice } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import { AlertDialogWrapper } from "@/components/dialogs";
interface OrderActionsProps { order: Order; onEdit?: (order: Order) => void; detailHrefBase?: string; onCreateInvoice?: (order: Order) => void; }
export default function OrderActions({ order, onEdit, detailHrefBase, onCreateInvoice }: OrderActionsProps) {
  const { user } = useAuth(); const deleteOrderMutation = useDeleteOrder(); const deleteInvoiceMutation = useDeleteInvoice();
  const isDeleting = deleteOrderMutation.isPending; const isDeletingInvoice = deleteInvoiceMutation.isPending;
  const disableOrderActions = user?.role === "supplier" || user?.role === "client"; const disableInvoiceMutations = disableOrderActions;
  const invoiceHrefBase = detailHrefBase?.startsWith("/admin") ? "/admin/invoices" : "/invoices";
  const linkedInvoice = order.invoiceForOrder ?? null; const [deleteInvoiceDialogOpen, setDeleteInvoiceDialogOpen] = useState(false);
  const handleCancelOrder = async () => { if (window.confirm(`¿Estás seguro de que deseas cancelar el pedido ${order.orderNumber}? Esta acción no se puede deshacer.`)) { try { await deleteOrderMutation.mutateAsync(order.id); } catch {} } };
  const handleEditOrder = () => { if (!onEdit) return; try { onEdit(order); } catch {} };
  const handleDeleteInvoice = async () => { if (!linkedInvoice) return; try { await deleteInvoiceMutation.mutateAsync(linkedInvoice.id); setDeleteInvoiceDialogOpen(false); } catch {} };
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menú</span><MoreVertical className="h-4 w-4 text-gray-600 dark:text-gray-300" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-white/5 backdrop-blur-md shadow-lg">
        <DropdownMenuItem asChild><Link href={detailHrefBase ? `${detailHrefBase}/${order.id}` : `/orders/${order.id}`} className="flex items-center gap-2"><Eye className="h-4 w-4" />Ver detalles</Link></DropdownMenuItem>
        {onEdit != null && order.status !== "cancelled" && <DropdownMenuItem onClick={handleEditOrder} disabled={disableOrderActions} className="flex items-center gap-2"><Edit className="h-4 w-4" />Editar</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {linkedInvoice ? <>
          <DropdownMenuItem asChild><Link href={`${invoiceHrefBase}/${linkedInvoice.id}`} className="flex items-center gap-2"><FileText className="h-4 w-4" />Ver factura</Link></DropdownMenuItem>
          {!disableInvoiceMutations && order.status !== "cancelled" && linkedInvoice.status !== "cancelled" && <>
            <DropdownMenuItem asChild><Link href={`${invoiceHrefBase}/${linkedInvoice.id}`} className="flex items-center gap-2"><Edit className="h-4 w-4" />Editar factura</Link></DropdownMenuItem>
            <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={() => setDeleteInvoiceDialogOpen(true)} disabled={isDeletingInvoice}><Trash2 className="h-4 w-4" />{isDeletingInvoice ? "Eliminando..." : "Eliminar factura"}</DropdownMenuItem>
          </>}
        </> : onCreateInvoice && !disableInvoiceMutations && order.status !== "cancelled" && <DropdownMenuItem onClick={() => onCreateInvoice(order)} className="flex items-center gap-2"><FilePlus2 className="h-4 w-4" />Crear factura</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {order.paymentStatus === "paid" ? <DropdownMenuItem asChild><Link href={detailHrefBase ? `${detailHrefBase}/${order.id}#reviews` : `/orders/${order.id}#reviews`} className="flex items-center gap-2"><Star className="h-4 w-4" />Escribir / editar reseña</Link></DropdownMenuItem> : <DropdownMenuItem disabled className="flex items-center gap-2 text-muted-foreground" title="Disponible después de pagar el pedido"><Star className="h-4 w-4" />Escribir / editar reseña</DropdownMenuItem>}
        {order.status !== "cancelled" && <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={handleCancelOrder} disabled={isDeleting || disableOrderActions}><Trash2 className="h-4 w-4" />{isDeleting ? "Cancelando..." : "Cancelar"}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    {linkedInvoice && <AlertDialogWrapper open={deleteInvoiceDialogOpen} onOpenChange={setDeleteInvoiceDialogOpen} title="Eliminar factura" description={`¿Estás seguro de que deseas eliminar la factura ${linkedInvoice.invoiceNumber} del pedido ${order.orderNumber}? Esta acción no se puede deshacer.`} actionLabel="Eliminar" actionLoadingLabel="Eliminando..." isLoading={isDeletingInvoice} onAction={handleDeleteInvoice} onCancel={() => setDeleteInvoiceDialogOpen(false)} />}
  </>;
}
