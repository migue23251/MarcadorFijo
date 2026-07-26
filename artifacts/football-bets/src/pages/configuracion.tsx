import { useState, useRef, useEffect } from "react";
import {
  useGetMe,
  getGetMeQueryKey,
  useUpdateMe,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { User, ShieldCheck, Loader2, Cpu } from "lucide-react";

export default function Configuracion() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">Gestiona tu perfil operativo.</p>
      </header>

      <div className="grid grid-cols-1 gap-8">

        {/* AI Engine Info */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
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
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium">Motor IA</p>
                <p className="text-xs text-muted-foreground">Modelo de lenguaje para análisis y predicciones</p>
              </div>
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full border border-primary/20">
                Groq · Llama 3.3 70B
              </span>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium">Fuente de cuotas</p>
                <p className="text-xs text-muted-foreground">Cuotas en tiempo real de bookmakers europeos</p>
              </div>
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full border border-primary/20">
                The Odds API
              </span>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">Datos de partidos</p>
                <p className="text-xs text-muted-foreground">Fixtures, marcadores en vivo y estadísticas</p>
              </div>
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full border border-primary/20">
                API-Football
              </span>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Los análisis se cachean durante 24 h para optimizar el uso de tokens. Un mismo partido no se analiza dos veces en el mismo día.
            </p>
          </div>
        </section>

        {/* Subscription Status */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Estado de Suscripción</h2>
              <p className="text-sm text-muted-foreground">Acceso al Radar y al motor de análisis.</p>
            </div>
          </div>
          <div className="p-6">
            <SubscriptionStatus
              active={me?.activeSubscription}
              expiresAt={me?.subscriptionExpiresAt ?? null}
            />
          </div>
        </section>

        {/* Profile */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Perfil</h2>
              <p className="text-sm text-muted-foreground">Tu identidad de operador.</p>
            </div>
          </div>
          <div className="p-6">
            <ProfileForm
              currentName={me?.name ?? user?.fullName ?? ""}
              email={me?.email ?? user?.primaryEmailAddress?.emailAddress ?? ""}
              queryClient={queryClient}
              toast={toast}
            />
          </div>
        </section>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscription status
// ---------------------------------------------------------------------------

function SubscriptionStatus({
  active,
  expiresAt,
}: {
  active?: boolean;
  expiresAt: string | null;
}) {
  if (active === undefined) {
    return <div className="h-8 w-40 bg-secondary/50 rounded animate-pulse" />;
  }

  return (
    <div className="flex items-center gap-4">
      <span
        className={`px-4 py-1.5 rounded-full text-sm font-semibold border ${
          active
            ? "bg-primary/10 text-primary border-primary/30"
            : "bg-destructive/10 text-destructive border-destructive/30"
        }`}
      >
        {active ? "✓ Activa" : "✗ Sin suscripción"}
      </span>
      {active && expiresAt && (
        <span className="text-xs text-muted-foreground">
          Válida hasta {new Date(expiresAt).toLocaleDateString("es-ES")}
        </span>
      )}
      {!active && (
        <span className="text-xs text-muted-foreground">
          Contacta con el administrador para activar tu acceso.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile form
// ---------------------------------------------------------------------------

function ProfileForm({
  currentName,
  email,
  queryClient,
  toast,
}: {
  currentName: string;
  email: string;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [name, setName] = useState(currentName);
  const updateMe = useUpdateMe();
  const initRef = useRef(false);

  useEffect(() => {
    if (currentName && !initRef.current) {
      setName(currentName);
      initRef.current = true;
    }
  }, [currentName]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMe.mutate(
      { data: { name } },
      {
        onSuccess: () => {
          toast({ title: "Perfil actualizado" });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
      },
    );
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-md">
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Email (Cuenta Clerk)
        </label>
        <div className="px-4 py-2 bg-secondary/50 border border-border rounded-md text-sm text-muted-foreground">
          {email || "Cargando..."}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Nombre de Operador
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: John Doe"
          className="w-full bg-background border border-border px-4 py-2 rounded-md text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
        />
      </div>

      <button
        type="submit"
        disabled={updateMe.isPending || name === currentName}
        className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {updateMe.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Actualizar Perfil
      </button>
    </form>
  );
}
