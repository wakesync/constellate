// Auth state hook. The "session" is whether /me returns a user.
// On mock fallback, mock.isAuthed() is the source of truth.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { mock } from "./mock-api";
import type { User } from "./types";

export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery<User | null>({
    queryKey: ["me"],
    queryFn: async () => {
      // Cheap fast-path for mock-mode: skip network when not authed.
      if (!mock.isAuthed()) {
        try {
          return await api.me();
        } catch {
          return null;
        }
      }
      try {
        return await api.me();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });

  return {
    user: q.data ?? null,
    loading: q.isLoading,
    isAuthed: !!q.data,
    refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
    setUser: (u: User | null) => qc.setQueryData(["me"], u),
  };
}
