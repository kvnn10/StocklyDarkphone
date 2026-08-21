/**
 * User Management List
 */

"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useUsers, useDashboard } from "@/hooks/queries";
import {
  isDataSlotLoading,
  isDataSlotUnsettled,
  queryKeys,
  useSyncSsrQueryData,
} from "@/lib/react-query";
import { PaginationType } from "@/components/shared/PaginationSelector";
import { PageSectionHeader } from "@/components/shared";
import { createUserManagementColumns } from "./UserManagementTableColumns";
import UserManagementFilters from "./UserManagementFilters";
import { UserManagementTable } from "./UserManagementTable";
import CreateUserDialog from "./CreateUserDialog";
import { StatisticsCard } from "@/components/home/StatisticsCard";
import { Users, Shield, Truck, UserCircle } from "lucide-react";
import { useAuth } from "@/contexts";
import type { UserForAdmin, DashboardStats } from "@/types";

export type UserManagementListProps = {
  detailHrefBase?: string;
  /** SSR-passed users for first-render hydration (REQ-0021) */
  initialUsers?: UserForAdmin[];
  /** SSR dashboard stats for role stat cards (REQ-0125 — CategoryList parity) */
  initialStats?: DashboardStats;
};

export default function UserManagementList({
  detailHrefBase,
  initialUsers,
  initialStats,
}: UserManagementListProps = {}) {
  const isMountedRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const usersQuery = useUsers(initialUsers);
  const dashboardQuery = useDashboard(initialStats);
  const { user } = useAuth();

  useSyncSsrQueryData(queryKeys.userManagement.lists(), initialUsers);
  useSyncSsrQueryData(
    queryKeys.dashboard.overview(user?.id ?? ""),
    user?.id && initialStats !== undefined ? initialStats : undefined,
  );

  const allUsers = usersQuery.data ?? initialUsers ?? [];
  const dashboard = dashboardQuery.data ?? null;
  const roleBreakdown = dashboard?.userRoleBreakdown;

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      queueMicrotask(() => setIsMounted(true));
    }
  }, []);

  const [searchTerm, setSearchTerm] = useState("");
  const [pagination, setPagination] = useState<PaginationType>({
    pageIndex: 0,
    pageSize: 8,
  });
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const columns = useMemo(
    () =>
      createUserManagementColumns(
        detailHrefBase ?? "/admin/user-management",
        user?.id ?? null,
      ),
    [detailHrefBase, user?.id],
  );

  // REQ-0125: dashboard role cards unsettled; patched table rows use loading only
  const cardsDataLoading = isDataSlotUnsettled(dashboardQuery, initialStats);
  const tableDataLoading = isDataSlotLoading(usersQuery, initialUsers);

  const roleCounts = useMemo(() => {
    const total = dashboard?.counts?.users ?? allUsers.length;
    const admin =
      roleBreakdown?.admin ??
      allUsers.filter((u) => u.role === "admin").length;
    const supplier =
      roleBreakdown?.supplier ??
      allUsers.filter((u) => u.role === "supplier").length;
    const client =
      roleBreakdown?.client ??
      allUsers.filter((u) => u.role === "client").length;
    return { total, admin, supplier, client };
  }, [allUsers, dashboard?.counts?.users, roleBreakdown]);

  return (
    <div className="flex flex-col poppins">
      <PageSectionHeader
        as="h2"
        icon={Users}
        tone="violet"
        title="Gestión de usuarios"
        description="Gestiona usuarios y roles. Consulta y actualiza el nombre, rol y perfil."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 pb-6 items-stretch">
        <StatisticsCard
          title="Total de usuarios"
          value={roleCounts.total}
          description="Todos los usuarios registrados"
          icon={Users}
          variant="violet"
          valueLoading={cardsDataLoading}
          badgeValuesLoading={cardsDataLoading}
        />
        <StatisticsCard
          title="Administradores"
          value={roleCounts.admin}
          description="Usuarios con rol de administrador"
          icon={Shield}
          variant="blue"
          valueLoading={cardsDataLoading}
          badgeValuesLoading={cardsDataLoading}
        />
        <StatisticsCard
          title="Proveedores"
          value={roleCounts.supplier}
          description="Usuarios con rol de proveedor"
          icon={Truck}
          variant="emerald"
          valueLoading={cardsDataLoading}
          badgeValuesLoading={cardsDataLoading}
        />
        <StatisticsCard
          title="Clientes"
          value={roleCounts.client}
          description="Usuarios con rol de cliente"
          icon={UserCircle}
          variant="amber"
          valueLoading={cardsDataLoading}
          badgeValuesLoading={cardsDataLoading}
        />
      </div>

      <div className="pb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex-1">
          <UserManagementFilters
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedRoles={selectedRoles}
            setSelectedRoles={setSelectedRoles}
            setPagination={setPagination}
          />
        </div>
        {isMounted && (
          <div className="shrink-0">
            <CreateUserDialog />
          </div>
        )}
      </div>

      <UserManagementTable
        data={allUsers}
        columns={columns}
        isLoading={tableDataLoading}
        searchTerm={searchTerm}
        pagination={pagination}
        setPagination={setPagination}
        selectedRoles={selectedRoles}
      />
    </div>
  );
}
