import { useState, useRef, useEffect } from "react";
import {
  useGetMe,
  getGetMeQueryKey,
  useUpdateMe,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { User, ShieldCheck, Loader2, Cpu, DollarSign, Check, Crown, TrendingDown } from "lucide-react";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

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

        {/* Subscription Status + Pricing */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Suscripción</h2>
              <p className="text-sm text-muted-foreground">Planes y estado de acceso al motor de análisis.</p>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <SubscriptionStatus
              active={me?.activeSubscription}
              expiresAt={me?.subscriptionExpiresAt ?? null}
              plan={me?.subscriptionPlan}
            />
            <PricingCards
              active={me?.activeSubscription}
              currentPlan={me?.subscriptionPlan}
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
              currentCurrency={me?.currency ?? "COP"}
              email={me?.email ?? user?.primaryEmailAddress?.emailAddress ?? ""}
              queryClient={queryClient}
              toast={toast}
            />
          </div>
        </section>

        {/* Currency */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <DollarSign className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Moneda</h2>
              <p className="text-sm text-muted-foreground">Divisa en la que se muestran tus montos y retornos.</p>
            </div>
          </div>
          <div className="p-6">
            <CurrencyForm
              currentCurrency={me?.currency ?? "COP"}
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
// Pricing plans
// ---------------------------------------------------------------------------

const PLANS = [
  {
    id: "mensual",
    label: "Mensual",
    price: "$39.900",
    period: "/ mes",
    perMonth: "$39.900",
    savings: null,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo"],
  },
  {
    id: "trimestral",
    label: "Trimestral",
    price: "$99.900",
    period: "/ 3 meses",
    perMonth: "$33.300/mes",
    savings: 17,
    popular: true,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario"],
  },
  {
    id: "semestral",
    label: "Semestral",
    price: "$179.900",
    period: "/ 6 meses",
    perMonth: "$29.983/mes",
    savings: 25,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario"],
  },
  {
    id: "anual",
    label: "Anual",
    price: "$299.900",
    period: "/ año",
    perMonth: "$24.992/mes",
    savings: 37,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario", "Acceso anticipado a nuevas funciones"],
  },
];

// ---------------------------------------------------------------------------
// Subscription status
// ---------------------------------------------------------------------------

function SubscriptionStatus({
  active,
  expiresAt,
  plan,
}: {
  active?: boolean;
  expiresAt: string | null;
  plan?: string;
}) {
  if (active === undefined) {
    return <div className="h-8 w-40 bg-secondary/50 rounded animate-pulse" />;
  }

  const planLabel = PLANS.find(p => p.id === plan)?.label;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`px-4 py-1.5 rounded-full text-sm font-semibold border flex items-center gap-1.5 ${
          active
            ? "bg-primary/10 text-primary border-primary/30"
            : "bg-destructive/10 text-destructive border-destructive/30"
        }`}
      >
        {active ? (
          <><Crown className="w-3.5 h-3.5" /> {planLabel ?? "Activa"}</>
        ) : (
          "✗ Sin suscripción"
        )}
      </span>
      {active && expiresAt && (
        <span className="text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full border border-border">
          Vence el {new Date(expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
        </span>
      )}
      {!active && (
        <span className="text-xs text-muted-foreground">
          Elige un plan a continuación para activar tu acceso.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing cards
// ---------------------------------------------------------------------------

function PricingCards({
  active,
  currentPlan,
  expiresAt,
}: {
  active?: boolean;
  currentPlan?: string;
  expiresAt: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Planes disponibles</span>
        <span className="text-xs text-muted-foreground">(COP · pago único por período)</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const isCurrent = active && currentPlan === plan.id;
          return (
            <div
              key={plan.id}
              className={`relative rounded-xl border p-5 flex flex-col gap-3 transition-all ${
                isCurrent
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : plan.popular && !active
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-secondary/20 hover:border-primary/30"
              }`}
            >
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {isCurrent && (
                  <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                    PLAN ACTUAL
                  </span>
                )}
                {plan.popular && !isCurrent && (
                  <span className="px-2 py-0.5 bg-primary/20 text-primary text-[10px] font-bold rounded-full border border-primary/30">
                    MÁS POPULAR
                  </span>
                )}
                {plan.savings && !isCurrent && (
                  <span className="px-2 py-0.5 bg-emerald-500/15 text-emerald-400 text-[10px] font-bold rounded-full border border-emerald-500/25">
                    Ahorra {plan.savings}%
                  </span>
                )}
              </div>

              {/* Plan name + price */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{plan.label}</p>
                <p className="text-2xl font-black text-foreground">{plan.price}</p>
                <p className="text-xs text-muted-foreground">{plan.period}</p>
                {plan.savings && (
                  <p className="text-xs text-primary/70 mt-0.5">{plan.perMonth}</p>
                )}
              </div>

              {/* Expiry for active plan */}
              {isCurrent && expiresAt && (
                <div className="text-xs text-muted-foreground bg-secondary/50 rounded-md px-2.5 py-1.5 border border-border">
                  Vence {new Date(expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              )}

              {/* Features */}
              <ul className="space-y-1.5 mt-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground pt-1">
        Para activar o cambiar tu plan, contacta al administrador.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile form
// ---------------------------------------------------------------------------

function ProfileForm({
  currentName,
  currentCurrency,
  email,
  queryClient,
  toast,
}: {
  currentName: string;
  currentCurrency: string;
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
      { data: { name, currency: currentCurrency } },
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

// ---------------------------------------------------------------------------
// Currency form
// ---------------------------------------------------------------------------

function CurrencyForm({
  currentCurrency,
  queryClient,
  toast,
}: {
  currentCurrency: string;
  queryClient: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [currency, setCurrency] = useState(currentCurrency);
  const updateMe = useUpdateMe();
  const initRef = useRef(false);

  useEffect(() => {
    if (currentCurrency && !initRef.current) {
      setCurrency(currentCurrency);
      initRef.current = true;
    }
  }, [currentCurrency]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMe.mutate(
      { data: { currency } },
      {
        onSuccess: () => {
          toast({ title: "Moneda actualizada" });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
      },
    );
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-md">
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Moneda de operación
        </label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="w-full bg-background border border-border px-4 py-2 rounded-md text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all appearance-none cursor-pointer"
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground pt-1">
          Afecta cómo se muestran los montos en el Historial y al registrar apuestas.
        </p>
      </div>

      <button
        type="submit"
        disabled={updateMe.isPending || currency === currentCurrency}
        className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {updateMe.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Guardar Moneda
      </button>
    </form>
  );
}
