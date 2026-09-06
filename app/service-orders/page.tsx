import { redirect } from "next/navigation";

/**
 * Canonical service-order workspace lives under /admin.
 * Keep this legacy route as a redirect so existing bookmarks/links continue to work
 * without maintaining a second implementation of the service-order module.
 */
export default function ServiceOrdersRedirect() {
  redirect("/admin/service-orders");
}
