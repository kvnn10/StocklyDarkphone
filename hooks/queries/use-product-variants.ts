import { useQuery } from "@tanstack/react-query";

export type ProductVariantView = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: number;
  purchasePrice: number;
  quantity: number;
  reservedQuantity: number;
  status: string;
  attributes?: Record<string, unknown> | null;
  stocks: Array<{
    id: string;
    warehouseId: string;
    warehouseName: string;
    quantity: number;
    reservedQuantity: number;
  }>;
};

export function useProductVariants() {
  return useQuery<ProductVariantView[]>({
    queryKey: ["products", "variants", "all"],
    queryFn: async () => {
      const response = await fetch("/api/products/variants", { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudieron cargar las variantes");
      return response.json();
    },
    staleTime: 30_000,
  });
}
