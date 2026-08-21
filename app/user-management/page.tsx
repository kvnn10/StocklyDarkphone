import { redirect } from "next/navigation";

/**
 * Compatibility route: the admin user-management page lives at
 * /admin/user-management. Keep /user-management working for existing links.
 */
export default function UserManagementRedirectPage() {
  redirect("/admin/user-management");
}
