/**
 * TanStack Query options for SSR-passed initialData (REQ-0021).
 * Use on first render so hooks are not isPending when server data exists.
 */
export function withInitialData<T>(
  initialData?: T,
  options?: {
    /**
     * Force a client refetch whenever a page mounts with SSR data.
     * Useful for highly mutable lists where a soft navigation can carry an
     * older RSC snapshot even though the server/API has already changed.
     */
    refetchOnMount?: "always" | ((query: { isStale: () => boolean }) => boolean);
  },
) {
  if (initialData === undefined) return {};
  return {
    initialData,
    initialDataUpdatedAt: Date.now(),
    // Keep the existing stale-aware behavior by default. Individual high-churn
    // queries can opt into an unconditional mount refetch when needed.
    refetchOnMount:
      options?.refetchOnMount ??
      ((query: { isStale: () => boolean }) => query.isStale()),
  } as const;
}
