import { createContext, useCallback, useContext, useEffect, useState, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { api, onAuthLost, type Status, type UserProfile } from "./api";
import { Avatar, Badge, Btn, LiveIndicator, Spinner, ToastProvider, useSync, useSyncStatus } from "./ui";
import { Icon, Logo, type IconName } from "./icons";
import CommandPalette from "./components/CommandPalette";
import { BlurFade, DotPattern } from "./components/magic";
import { resetSync } from "./sync";
import Login from "./pages/Login";
import SignIn from "./pages/SignIn";
import NotificationBell from "./components/NotificationBell";

// Route-level code splitting: the sign-in screen no longer ships the whole app,
// and owner-only admin pages download only when an owner opens them.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Files = lazy(() => import("./pages/Files"));
const Notepad = lazy(() => import("./pages/Notepad"));
const Links = lazy(() => import("./pages/Links"));
const Shares = lazy(() => import("./pages/Shares"));
const Groups = lazy(() => import("./pages/Groups"));
const Trash = lazy(() => import("./pages/Trash"));
const Gallery = lazy(() => import("./pages/Gallery"));
const Transfer = lazy(() => import("./pages/Transfer"));
const Covert = lazy(() => import("./pages/Covert"));
const Certs = lazy(() => import("./pages/Certs"));
const Profile = lazy(() => import("./pages/Profile"));
const Help = lazy(() => import("./pages/Help"));
const SharePage = lazy(() => import("./pages/SharePage"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Analytics = lazy(() => import("./pages/admin/Analytics"));
const Devices = lazy(() => import("./pages/admin/Devices"));
const Logs = lazy(() => import("./pages/admin/Logs"));
const Storage = lazy(() => import("./pages/admin/Storage"));
const Security = lazy(() => import("./pages/admin/Security"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const Users = lazy(() => import("./pages/admin/Users"));
const Cluster = lazy(() => import("./pages/admin/Cluster"));
const AdminGroups = lazy(() => import("./pages/admin/Groups"));
const Backups = lazy(() => import("./pages/admin/Backups"));

type AuthState = {
  ready: boolean;
  status: Status | null;
  /** True when this device has a valid session (even before an account is chosen). */
  authed: boolean;
  user: UserProfile | null;
  mustChangePassword: boolean;
  refresh: () => Promise<void>;
  /** Forget this device entirely (it registers again, with the PIN when one is required). */
  logout: () => Promise<void>;
  /** Leave the account but stay paired. */
  switchAccount: () => Promise<void>;
};
const EMPTY: AuthState = {
  ready: false,
  status: null,
  authed: false,
  user: null,
  mustChangePassword: false,
  refresh: async () => {},
  logout: async () => {},
  switchAccount: async () => {},
};
const AuthCtx = createContext<AuthState>(EMPTY);
export const useAuth = () => useContext(AuthCtx);

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/files", label: "Files", icon: "folder" },
  { to: "/notepad", label: "Notepad", icon: "note" },
  { to: "/links", label: "Links", icon: "link" },
  { to: "/shares", label: "Share links", icon: "share" },
  { to: "/groups", label: "Groups", icon: "users" },
  { to: "/trash", label: "Trash", icon: "trash" },
  { to: "/gallery", label: "Gallery", icon: "image" },
  { to: "/transfer", label: "Device Transfer", icon: "transfer" },
  { to: "/covert", label: "Covert Tools", icon: "shield" },
  { to: "/certs", label: "Certificates", icon: "key" },
  { to: "/help", label: "Help", icon: "help" },
];
const ADMIN_NAV: NavItem[] = [
  { to: "/admin/analytics", label: "Analytics", icon: "chart" },
  { to: "/admin/devices", label: "Devices", icon: "smartphone" },
  { to: "/admin/logs", label: "Activity", icon: "history" },
  { to: "/admin/storage", label: "Storage", icon: "drive" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/groups", label: "Groups", icon: "users" },
  { to: "/admin/security", label: "Security", icon: "shieldCheck" },
  { to: "/admin/cluster", label: "Cluster", icon: "globe" },
  { to: "/admin/backups", label: "Backups", icon: "database" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

function navClass(isActive: boolean) {
  return `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all ${
    isActive ? "bg-indigo-500/15 text-white shadow-[inset_2px_0_0_0_#6366f1]" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
  }`;
}

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-slate-500">
      <Spinner size={22} /> Loading…
    </div>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const { user, switchAccount, logout } = useAuth();
  return (
    <div className="anim-pop absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-xl border border-[#2a3247] bg-[#0f131b] p-1.5 shadow-2xl">
      <div className="flex items-center gap-2 px-2 py-2">
        <Avatar user={user} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{user?.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            {user?.username ? `@${user.username}` : "no username"} · {user?.role}
          </div>
        </div>
        {user?.role === "owner" && <Badge tone="info">owner</Badge>}
      </div>
      <div className="my-1 h-px bg-[#1c2334]" />
      <NavLink
        to="/profile"
        onClick={onClose}
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
      >
        <Icon name="user" size={15} /> Profile &amp; password
      </NavLink>
      <button
        onClick={() => {
          onClose();
          void switchAccount();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
      >
        <Icon name="switchUser" size={15} /> Switch account
      </button>
      <button
        onClick={() => {
          onClose();
          void logout();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-300 transition hover:bg-red-500/10 hover:text-red-300"
      >
        <Icon name="logout" size={15} /> Sign out of this device
      </button>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { status, user, switchAccount, logout } = useAuth();
  const loc = useLocation();
  const syncStatus = useSyncStatus();
  const isOwner = user?.role === "owner";
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);

  const pageLabel =
    [...NAV, ...(isOwner ? ADMIN_NAV : [])].find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ?? "Dashboard";

  useEffect(() => {
    document.title = `${pageLabel} · ${status?.appName ?? "FYRDrop"}`;
  }, [pageLabel, status?.appName]);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
  }, [loc.pathname]);

  const mobileItems = [...NAV, ...(isOwner ? ADMIN_NAV : [])];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#1c2334] bg-[#0d1119]/80 p-4 backdrop-blur lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo size={34} />
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight text-white">{status?.appName ?? "FYRDrop"}</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">secure share hub</div>
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("fyrdrop:search"))}
          className="mb-3 flex items-center gap-2 rounded-xl border border-[#2a3247] bg-white/[0.02] px-3 py-2 text-xs text-slate-400 transition hover:border-indigo-500/40 hover:text-slate-200"
        >
          <Icon name="search" size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-[#2a3247] px-1 py-0.5 text-[9px]">Ctrl K</kbd>
        </button>
        <div className="-mt-1 mb-3 flex justify-end">
          <NotificationBell />
        </div>
        <nav className="space-y-0.5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => navClass(isActive)}>
              <span className="w-4 text-center opacity-80"><Icon name={n.icon} size={17} /></span> {n.label}
            </NavLink>
          ))}
        </nav>
        {isOwner && (
          <>
            <div className="mb-1.5 mt-5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Admin</div>
            <nav className="space-y-0.5">
              {ADMIN_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => navClass(isActive)}>
                  <span className="w-4 text-center opacity-80"><Icon name={n.icon} size={17} /></span> {n.label}
                </NavLink>
              ))}
            </nav>
          </>
        )}
        <div className="mt-auto space-y-2">
          <LiveIndicator status={syncStatus} />
          <div className="relative flex items-center gap-2 rounded-xl border border-[#2a3247] p-2">
            <Avatar user={user} size={32} />
            <button onClick={() => setMenu((m) => !m)} className="min-w-0 flex-1 text-left" aria-expanded={menu} aria-haspopup="menu">
              <div className="truncate text-sm font-medium text-white">{user?.name ?? "No profile"}</div>
              <div className="truncate text-[11px] text-slate-500">{user?.username ? `@${user.username}` : "account"}</div>
            </button>
            <button
              onClick={() => setMenu((m) => !m)}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
              aria-label="Account menu"
            >
              <Icon name="chevronDown" size={15} />
            </button>
            {menu && <AccountMenu onClose={() => setMenu(false)} />}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[#1c2334] bg-[#0b0e14]/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/5" aria-label="Open menu">
            <Icon name="menu" size={20} />
          </button>
          <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
            <Logo size={22} />
            <span className="truncate">{status?.appName ?? "FYRDrop"}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <LiveIndicator status={syncStatus} />
            <NotificationBell compact />
            <NavLink to="/profile" aria-label="Profile">
              <Avatar user={user} size={28} />
            </NavLink>
          </div>
        </header>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <aside className="anim-pop absolute left-0 top-0 flex h-full w-72 flex-col border-r border-[#232a3a] bg-[#0b0e14] p-4">
              <div className="mb-5 flex items-center justify-between px-1">
                <span className="flex items-center gap-2 font-semibold text-white">
                  <Logo size={26} /> {status?.appName ?? "FYRDrop"}
                </span>
                <button onClick={() => setDrawer(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5" aria-label="Close menu">
                  <Icon name="x" size={18} />
                </button>
              </div>
              <nav className="space-y-0.5 overflow-y-auto">
                {mobileItems.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => navClass(isActive)}>
                    <span className="w-4 text-center opacity-80"><Icon name={n.icon} size={17} /></span> {n.label}
                  </NavLink>
                ))}
              </nav>
              <div className="mt-auto space-y-1 border-t border-[#1c2334] pt-3">
                <div className="flex items-center gap-2 px-1 pb-1">
                  <Avatar user={user} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white">{user?.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{user?.username ? `@${user.username}` : ""}</div>
                  </div>
                </div>
                <button onClick={() => void switchAccount()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-300 hover:bg-white/5">
                  <Icon name="switchUser" size={15} /> Switch account
                </button>
                <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-300 hover:bg-red-500/10 hover:text-red-300">
                  <Icon name="logout" size={15} /> Sign out of this device
                </button>
              </div>
            </aside>
          </div>
        )}

        <main key={loc.pathname} className="anim-page min-w-0 w-full flex-1 px-4 py-6 sm:px-6 sm:py-7 xl:px-9 2xl:px-12">
          <Suspense fallback={<RouteFallback />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

function AuthedApp() {
  const { refresh } = useAuth();
  useSync(() => void refresh());
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<BlurFade><Dashboard /></BlurFade>} />
        <Route path="/files" element={<Files />} />
        <Route path="/notepad" element={<Notepad />} />
        <Route path="/links" element={<Links />} />
        <Route path="/shares" element={<Shares />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/covert" element={<Covert />} />
        <Route path="/certs" element={<Certs />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/help" element={<Help />} />
        <Route path="/admin/analytics" element={<Analytics />} />
        <Route path="/admin/devices" element={<Devices />} />
        <Route path="/admin/logs" element={<Logs />} />
        <Route path="/admin/connections" element={<Navigate to="/admin/devices" replace />} />
        <Route path="/admin/storage" element={<Storage />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/groups" element={<AdminGroups />} />
        <Route path="/admin/security" element={<Security />} />
        <Route path="/admin/cluster" element={<Cluster />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/backups" element={<Backups />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function NotProvisioned() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <DotPattern />
      <div className="glass relative w-full max-w-md rounded-2xl p-8 text-center">
        <div className="mb-3 flex justify-center text-amber-300"><Icon name="alert" size={32} /></div>
        <h1 className="text-xl font-semibold text-white">The server isn't initialised</h1>
        <p className="mt-2 text-sm text-slate-400">
          Start FYRDrop once so it can create the owner account, then reload this page.
        </p>
        <Btn className="mt-5" onClick={() => window.location.reload()}>
          <Icon name="refresh" size={15} /> Reload
        </Btn>
      </div>
    </div>
  );
}

function Root() {
  const [state, setState] = useState<AuthState>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setState((s) => ({ ...s, authed: true, user: me.user, mustChangePassword: me.mustChangePassword }));
    } catch {
      setState((s) => ({ ...s, authed: false, user: null, mustChangePassword: false }));
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    resetSync();
    // The owner may have turned the instance PIN on or off since this page loaded.
    const status = await api.status().catch(() => null);
    setState((s) => ({ ...s, status: status ?? s.status, authed: false, user: null, mustChangePassword: false }));
  }, []);

  const switchAccount = useCallback(async () => {
    try {
      await api.switchAccount();
    } catch {
      /* already signed out - refresh() settles the state */
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    onAuthLost((reason) => {
      if (reason === "pin") void logout();
      else void refresh();
    });
    (async () => {
      const status = await api.status().catch(() => null);
      if (!status || status.needsSetup) {
        setState({ ...EMPTY, ready: true, status, refresh, logout, switchAccount });
        return;
      }
      try {
        const me = await api.me();
        setState({ ready: true, status, authed: true, user: me.user, mustChangePassword: me.mustChangePassword, refresh, logout, switchAccount });
      } catch {
        setState({ ...EMPTY, ready: true, status, refresh, logout, switchAccount });
      }
    })();
    // Boot only: refresh/logout/switchAccount are stable useCallback identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = state.status?.appName ? `${state.status.appName} · secure share hub` : "FYRDrop";
  }, [state.status?.appName]);

  if (!state.ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  const ctx: AuthState = { ...state, refresh, logout, switchAccount };

  return (
    <AuthCtx.Provider value={ctx}>
      <BrowserRouter>
        <CommandPalette />
        <Routes>
          {["/s/:token", "/q/:token"].map((path) => (
            <Route
              key={path}
              path={path}
              element={
                <Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner size={28} /></div>}>
                  <SharePage />
                </Suspense>
              }
            />
          ))}
          <Route
            path="/reset-password"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner size={28} /></div>}>
                <ResetPassword />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              state.status?.needsSetup ? (
                <NotProvisioned />
              ) : !state.authed ? (
                <Login />
              ) : !state.user || state.mustChangePassword ? (
                <SignIn />
              ) : (
                <AuthedApp />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}
