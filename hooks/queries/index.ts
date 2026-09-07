/**
 * Query hooks exports
 * Centralized export point for all TanStack Query hooks
 */

// Product hooks
export {
  useProducts,
  useProduct,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "./use-products";
export { useProductVariants } from "./use-product-variants";

// Category hooks
export { useCategories, useCategory, useCreateCategory, useUpdateCategory, useDeleteCategory } from "./use-categories";

// Supplier hooks
export { useSuppliers, useSupplier, useCreateSupplier, useUpdateSupplier, useDeleteSupplier } from "./use-suppliers";

// Warehouse hooks
export { useWarehouses, useWarehouse, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse } from "./use-warehouses";

// Email preferences hooks
export { useEmailPreferences, useUpdateEmailPreferences } from "./use-email-preferences";

// Order hooks
export { useOrders, useOrder, useClientOrders, useCreateOrder, useUpdateOrder, useDeleteOrder } from "./use-orders";

// Notification hooks
export { useNotifications, useUnreadNotificationCount, useNotification, useUpdateNotification, useMarkAllNotificationsAsRead, useDeleteNotification } from "./use-notifications";

// Invoice hooks
export { useInvoices, useInvoice, useClientInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice, useSendInvoice } from "./use-invoices";

// History (Import History) hooks
export { useHistory, useHistoryItem } from "./use-history";

// Support Tickets hooks
export { useSupportTickets, type SupportTicketViewFilter, useSupportTicket, useSupportTicketOwnerProducts, useSupportTicketReplies, useCreateSupportTicket, useCreateSupportTicketReply, useUpdateSupportTicket, useDeleteSupportTicket } from "./use-support-tickets";

// Product Reviews hooks
export { useProductReviews, useProductReview, useReviewsByProduct, useReviewEligibility, useCreateProductReview, useUpdateProductReview, useDeleteProductReview } from "./use-product-reviews";

// Dashboard (admin overview) hooks
export { useDashboard } from "./use-dashboard";
export { useAdminCounts } from "./use-admin-counts";
export { useUsers, useUser, useUpdateUser, useCreateUser, useDeleteUser } from "./use-user-management";
export { useClientPortal } from "./use-client-portal";
export { useSupplierPortal } from "./use-supplier-portal";
export { useStockAllocations, useWarehouseStockSummary, useStockByProduct, prefetchStockByProduct, useStockByWarehouse, useCreateStockAllocation, useUpdateStockAllocation, useDeleteStockAllocation, useCreateStockTransfer } from "./use-stock-allocation";
export { useOrderLineStockValidation } from "../use-order-line-stock-validation";
export { useSystemConfigs, useUpdateSystemConfigs } from "./use-system-config";
export { useAuditLogs } from "./use-audit-logs";
export { useForecastingSummary } from "./use-forecasting";
export { useSupplierPortalDashboard, useClientPortalDashboard, useClientCatalogOverview, useClientBrowseMeta, useClientBrowseProducts } from "./use-portal";
export { useSession, useLogin, useRegister, useLogout } from "./use-auth";
export { useCreateCheckout } from "./use-payments";
export { useGetShippingRates, useGenerateShippingLabel, useAddTrackingNumber } from "./use-shipping";
