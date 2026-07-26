import { useMemo, useState } from "react";
import { 
  useGetMe, 
  getGetMeQueryKey, 
  useListUsers, 
  getListUsersQueryKey,
  useUpdateUserSubscription,
  useGetAdminSettings,
  getGetAdminSettingsQueryKey,
  useUpdateAdminSettings,
  UserProfile
} from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, Loader2, RefreshCw, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Cpu, ChevronLeft, ChevronRight, Search, UserRound, UserRoundCog } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function Admin() {
  const { data: me, isLoading: meLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  
  if (meLoading) return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (me?.role !== "admin") return <Redirect to="/dashboard" />;

  return <AdminPanel />;
}

interface VerificationSummary {
  date: string;
  totalPending: number;
  fixturesFound: number;
  resolved: number;
  won: number;
  lost: number;
  voided: number;
  notMatched: number;
}

function ResultVerificationPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<VerificationSummary | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/verificar-resultados", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Error desconocido");
      setSummary(data.summary);
      toast({ title: "Verificación completada", description: `${data.summary.resolved} apuestas resueltas.` });
    } catch (err: any) {
      toast({ title: "Error en la verificación", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            Verificación de Resultados
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Consulta los marcadores finales del día en API-Football y liquida todas las apuestas pendientes.
            El cron lo ejecuta automáticamente a las 23:30 UTC.
          </p>
        </div>
        <button
          onClick={handleVerify}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? "Verificando…" : "Verificar ahora"}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            { label: "Ganadas", value: summary.won, icon: CheckCircle2, color: "text-emerald-500" },
            { label: "Perdidas", value: summary.lost, icon: XCircle, color: "text-red-500" },
            { label: "Anuladas", value: summary.voided, icon: AlertTriangle, color: "text-yellow-500" },
            { label: "Sin partido", value: summary.notMatched, icon: HelpCircle, color: "text-muted-foreground" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-secondary/40 rounded-lg p-3 flex flex-col gap-1">
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${color}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
              <span className="text-2xl font-bold text-foreground">{value}</span>
            </div>
          ))}
          <p className="col-span-2 sm:col-span-4 text-xs text-muted-foreground">
            Fecha: {summary.date} · {summary.totalPending} apuestas pendientes · {summary.fixturesFound} partidos encontrados en API-Football
          </p>
        </div>
      )}
    </div>
  );
}

function AnalysisEnginePanel() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-md">
          <Cpu className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Motor de Análisis</h2>
          <p className="text-sm text-muted-foreground">IA y fuente de datos de cuotas configuradas en el servidor.</p>
        </div>
      </div>
      <div className="p-6 space-y-3">
        {[
          { label: "Motor IA", desc: "Modelo de lenguaje para análisis y predicciones", value: "Groq · Llama 3.3 70B" },
          { label: "Fuente de cuotas", desc: "Cuotas en tiempo real de bookmakers europeos", value: "The Odds API" },
          { label: "Datos de partidos", desc: "Fixtures, marcadores en vivo y estadísticas", value: "API-Football" },
        ].map(({ label, desc, value }, i, arr) => (
          <div key={label} className={`flex items-center justify-between py-3 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
            <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full border border-primary/20">
              {value}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-2">
          Los análisis se cachean 24 h para optimizar el uso de tokens. Un mismo partido no se analiza dos veces en el mismo día.
        </p>
      </div>
    </div>
  );
}

function AdminPanel() {
  const { data: users, isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);

  const pageSize = 8;
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (users ?? []).filter((user) => {
      const matchesSearch =
        !normalizedSearch ||
        user.name?.toLowerCase().includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesSubscription =
        subscriptionFilter === "all" ||
        (subscriptionFilter === "active" ? user.isSubscriptionActive : !user.isSubscriptionActive);

      return matchesSearch && matchesRole && matchesSubscription;
    });
  }, [roleFilter, search, subscriptionFilter, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateRoleFilter = (value: "all" | "admin" | "user") => {
    setRoleFilter(value);
    setPage(1);
  };

  const updateSubscriptionFilter = (value: "all" | "active" | "inactive") => {
    setSubscriptionFilter(value);
    setPage(1);
  };

  const activeUsers = users?.filter((user) => user.isSubscriptionActive).length ?? 0;
  const adminUsers = users?.filter((user) => user.role === "admin").length ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-6 h-6 text-primary" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Panel de Administración</h1>
          </div>
          <p className="text-muted-foreground">Gestión de usuarios y accesos.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 self-start sm:self-auto">
          <AdminMetric icon={Users} value={users?.length ?? 0} label="Usuarios" />
          <AdminMetric icon={CheckCircle2} value={activeUsers} label="Activos" tone="success" />
          <AdminMetric icon={UserRoundCog} value={adminUsers} label="Admins" tone="purple" />
        </div>
      </header>

      <FreemiumSettingsPanel />
      <ResultVerificationPanel />
      <AnalysisEnginePanel />

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border bg-secondary/20 space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Directorio de usuarios</h2>
              <p className="text-sm text-muted-foreground">
                Busca y gestiona accesos sin recorrer toda la lista.
              </p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {filteredUsers.length} resultado{filteredUsers.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_190px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="Buscar por nombre o correo…"
                aria-label="Buscar usuarios"
                className="h-10 bg-background pl-9"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => updateRoleFilter(event.target.value as typeof roleFilter)}
              aria-label="Filtrar por rol"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Todos los roles</option>
              <option value="admin">Administradores</option>
              <option value="user">Operadores</option>
            </select>
            <select
              value={subscriptionFilter}
              onChange={(event) => updateSubscriptionFilter(event.target.value as typeof subscriptionFilter)}
              aria-label="Filtrar por suscripción"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">Todos los accesos</option>
              <option value="active">Suscripción activa</option>
              <option value="inactive">Sin suscripción activa</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Cargando usuarios...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center">
            <UserRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="font-medium text-foreground">No encontramos usuarios</p>
            <p className="mt-1 text-sm text-muted-foreground">Prueba con otra búsqueda o cambia los filtros.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {visibleUsers.map((user) => (
                <UserRow key={user.clerkId} user={user} />
              ))}
            </div>
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredUsers.length)} de {filteredUsers.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Anterior
                </button>
                <span className="min-w-16 text-center text-xs font-semibold text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Página siguiente"
                >
                  Siguiente
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AdminMetric({
  icon: Icon,
  value,
  label,
  tone = "neutral",
}: {
  icon: typeof Users;
  value: number;
  label: string;
  tone?: "neutral" | "success" | "purple";
}) {
  const toneClasses = {
    neutral: "text-muted-foreground",
    success: "text-emerald-500",
    purple: "text-purple-500",
  };

  return (
    <div className="min-w-[86px] rounded-lg border border-border bg-card px-3 py-2">
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${toneClasses[tone]}`}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-0.5 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function FreemiumSettingsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetAdminSettings({
    query: { queryKey: getGetAdminSettingsQueryKey() },
  });
  const updateSettings = useUpdateAdminSettings();

  const handleFreemiumChange = (freemiumEnabled: boolean) => {
    updateSettings.mutate(
      { data: { freemiumEnabled } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetAdminSettingsQueryKey(), updated);
          toast({
            title: "Configuración actualizada",
            description: updated.freemiumEnabled
              ? "El acceso freemium está habilitado."
              : "El acceso freemium está inhabilitado.",
          });
        },
        onError: () => {
          toast({
            title: "No se pudo actualizar",
            description: "Verifica la conexión e inténtalo de nuevo.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Acceso freemium</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Permite que los usuarios del plan gratuito utilicen el límite diario de análisis.
            El cambio se aplica inmediatamente a las nuevas solicitudes.
          </p>
        </div>
        <label className="inline-flex items-center gap-3 cursor-pointer shrink-0">
          <span className="text-sm font-semibold text-foreground">
            {isLoading ? "Cargando…" : settings?.freemiumEnabled ? "Habilitado" : "Inhabilitado"}
          </span>
          <Switch
            checked={settings?.freemiumEnabled ?? false}
            onCheckedChange={handleFreemiumChange}
            disabled={isLoading || updateSettings.isPending}
            aria-label="Habilitar o inhabilitar acceso freemium"
          />
        </label>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Desktop: table row
// ---------------------------------------------------------------------------

function UserRow({ user }: { user: UserProfile }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateSubscription = useUpdateUserSubscription();

  const handleToggle = () => {
    updateSubscription.mutate({
      userId: user.clerkId,
      data: { activeSubscription: !user.activeSubscription }
    }, {
      onSuccess: () => {
        toast({ title: "Suscripción actualizada", description: `Acceso ${!user.activeSubscription ? 'concedido' : 'revocado'} para ${user.email}` });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" });
      }
    });
  };

  const isPending = updateSubscription.isPending;

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-secondary/20">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {(user.name || user.email).slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">{user.name || "Sin nombre"}</span>
          <UserRoleBadge role={user.role} />
        </div>
        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <SubscriptionBadge active={user.isSubscriptionActive} />
        <span className="text-xs text-muted-foreground">{user.subscriptionPlan}</span>
      </div>
      <div className="shrink-0">
        <SubscriptionToggle active={user.activeSubscription} isPending={isPending} onToggle={handleToggle} />
      </div>
    </div>
  );
}

function UserRoleBadge({ role }: { role: UserProfile["role"] }) {
  return (
    <Badge
      variant="outline"
      className={role === "admin"
        ? "border-purple-500/30 bg-purple-500/10 px-1.5 py-0 text-[10px] uppercase tracking-wider text-purple-500"
        : "px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground"}
    >
      {role === "admin" ? "admin" : "operador"}
    </Badge>
  );
}

function SubscriptionBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant="outline"
      className={active
        ? "border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400"
        : "px-1.5 py-0 text-[10px] text-muted-foreground"}
    >
      {active ? "Activa" : "Inactiva"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Shared toggle button
// ---------------------------------------------------------------------------

function SubscriptionToggle({ active, isPending, onToggle }: {
  active: boolean;
  isPending: boolean;
  onToggle: () => void;
}) {
  return (
    <button 
      onClick={onToggle}
      disabled={isPending}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
        active ? 'bg-emerald-500' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          active ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
