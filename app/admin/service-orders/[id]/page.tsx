import ServiceOrderDetail from "@/components/admin/ServiceOrderDetail";

export default async function ServiceOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceOrderDetail orderId={id} />;
}
