import ServiceOrderDetail from "@/components/admin/ServiceOrderDetail";
import ServiceOrderPhotoEvidence from "@/components/admin/ServiceOrderPhotoEvidence";
import ServicePartWarrantyPanel from "@/components/admin/ServicePartWarrantyPanel";
import WarrantyHistory from "@/components/admin/WarrantyHistory";

export default async function ServiceOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <ServiceOrderDetail orderId={id} />
      <ServicePartWarrantyPanel orderId={id} />
      <WarrantyHistory orderId={id} />
      <div className="px-2 pb-8 sm:px-4">
        <ServiceOrderPhotoEvidence orderId={id} />
      </div>
    </>
  );
}
