import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  creditBalance: number;
  xp: number;
  level: number;
  currentStreak: number;
  reputationScore: number;
  referralCode: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  adminPin: string | null; // ephemeral — not persisted; set after admin PIN verify

  // Actions
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  updateCreditBalance: (balance: number) => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  logout: () => void;
  setHasHydrated: (value: boolean) => void;
  setAdminPin: (pin: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      hasHydrated: false,
      adminPin: null,

      setUser: (user) =>
        set({ user, isAuthenticated: true }),

      setAccessToken: (token) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', token);
        }
        set({ accessToken: token });
      },

      updateCreditBalance: (balance) =>
        set((state) => ({
          user: state.user ? { ...state.user, creditBalance: balance } : null,
        })),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      logout: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
        }
        set({ user: null, accessToken: null, isAuthenticated: false, adminPin: null });
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      },

      setHasHydrated: (value) => set({ hasHydrated: value }),
      setAdminPin: (pin) => set({ adminPin: pin }),
    }),
    {
      name: 'engganyo-auth',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : ({} as Storage),
      ),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
        // adminPin is intentionally NOT persisted — ephemeral per session
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
        }
      },
    },
  ),
);
