"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRightLeft, Boxes, ClipboardCheck, History, Package, Plus, ShoppingCart, Warehouse } from "lucide-react";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Product = { id:string; name:string; sku?:string; quantity?:number|string; price?:number };
type WarehouseRow = { id:string; name:string; status?:boolean };
type Movement = { id:string; productId:string; type:string; quantity:string; createdAt:string; reason?:string|null };
const money=(n:number)=>`$${Number(n||0).toLocaleString("es-CO")}`;
const movementLabel:Record<string,string>={entry:"Entrada",exit:"Salida",adjustment:"Ajuste",transfer_in:"Transferencia entrada",transfer_out:"Transferencia salida"};

export default function InventoryHub(){
 const [products,setProducts]=useState<Product[]>([]),[warehouses,setWarehouses]=useState<WarehouseRow[]>([]),[movements,setMovements]=useState<Movement[]>([]),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;(async()=>{try{const [p,w,m]=await Promise.all([fetch("/api/products",{cache:"no-store"}),fetch("/api/warehouses",{cache:"no-store"}),fetch("/api/inventory-movements?limit=8",{cache:"no-store"})]);const [pd,wd,md]=await Promise.all([p.json(),w.json(),m.json()]);if(live){setProducts(Array.isArray(pd)?pd:[]);setWarehouses(Array.isArray(wd)?wd.filter((x:WarehouseRow)=>x.status!==false):[]);setMovements(Array.isArray(md)?md:[])}}finally{if(live)setLoading(false)}})();return()=>{live=false}},[]);
 const low=useMemo(()=>products.filter(p=>Number(p.quantity??0)<=2).sort((a,b)=>Number(a.quantity??0)-Number(b.quantity??0),),[products]);
 const total=useMemo(()=>products.reduce((s,p)=>s+Number(p.quantity??0),0),[products]);
 const value=useMemo(()=>products.reduce((s,p)=>s+Number(p.quantity??0)*Number(p.price??0),0),[products]);
 return <main className="space-y-6 p-2 sm:p-4">
  <PageSectionHeader as="h1" tone="sky" icon={Boxes} title="Inventario" description="Control central de existencias, bodegas, movimientos y compras." />
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
   <Metric title="Productos" value={products.length} icon={Package}/><Metric title="Unidades" value={total} icon={Boxes}/><Metric title="Valor potencial" value={money(value)} icon={ShoppingCart}/><Metric title="Bodegas activas" value={warehouses.length} icon={Warehouse}/>
  </div>
  <div className="grid gap-4 lg:grid-cols-3">
   <Card className="lg:col-span-2"><CardHeader><CardTitle>Acciones rápidas</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <Quick href="/products" icon={Plus} label="Nuevo producto"/><Quick href="/products" icon={Package} label="Ver inventario"/><Quick href="/warehouses" icon={Warehouse} label="Bodegas"/><Quick href="/stock-distribution" icon={ArrowRightLeft} label="Distribuir stock"/><Quick href="/inventory-movements" icon={History} label="Movimientos"/><Quick href="/purchase-orders" icon={ShoppingCart} label="Compras"/>
   </CardContent></Card>
   <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5"/>Stock bajo</CardTitle></CardHeader><CardContent>{loading?<p className="text-sm text-muted-foreground">Cargando…</p>:low.length===0?<p className="text-sm text-muted-foreground">No hay productos con 2 unidades o menos.</p>:<div className="space-y-2">{low.slice(0,7).map(p=><Link key={p.id} href={`/products/${p.id}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50"><span className="min-w-0 truncate text-sm">{p.name}</span><span className="ml-3 shrink-0 font-semibold text-amber-600">{Number(p.quantity??0)}</span></Link>)}</div>}</CardContent></Card>
  </div>
  <Card><CardHeader><CardTitle>Últimos movimientos</CardTitle></CardHeader><CardContent>{loading?<p className="text-sm text-muted-foreground">Cargando…</p>:movements.length===0?<p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>:<div className="space-y-2">{movements.map(m=><div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><div><p className="font-medium">{movementLabel[m.type]||m.type}</p><p className="text-xs text-muted-foreground">{m.reason||"Movimiento de inventario"} · {new Date(m.createdAt).toLocaleString("es-CO")}</p></div><span className="font-semibold">{m.type==="exit"?"-":"+"}{m.quantity}</span></div>)}</div>}</CardContent></Card>
  <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Conteo físico</p><p className="text-sm text-muted-foreground">Ajusta existencias por bodega dejando trazabilidad.</p></div><Button asChild variant="outline"><Link href="/inventory-movements"><ClipboardCheck className="mr-2 h-4 w-4"/>Gestionar movimientos y conteos</Link></Button></CardContent></Card>
 </main>
}
function Metric({title,value,icon:Icon}:{title:string;value:string|number;icon:typeof Boxes}){return <Card><CardContent className="p-4"><Icon className="h-5 w-5 text-muted-foreground"/><p className="mt-3 text-xs text-muted-foreground">{title}</p><p className="text-xl font-semibold">{value}</p></CardContent></Card>}
function Quick({href,icon:Icon,label}:{href:string;icon:typeof Boxes;label:string}){return <Button asChild variant="outline" className="h-auto min-h-20 flex-col gap-2 rounded-xl"><Link href={href}><Icon className="h-5 w-5"/><span className="text-xs">{label}</span></Link></Button>}
