import { useState } from "react";
import { Link } from "wouter";
import {
  Radar,
  Target,
  TrendingUp,
  ShieldCheck,
  ScanSearch,
  BrainCircuit,
  Wallet,
  AlertTriangle,
  ChevronDown,
  Check,
  Zap,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/* ─── Mockup data (static, illustrative) ───────────────────────────────── */
const MOCK_MATCH = {
  home: { name: "Real Madrid", badge: "🤍", form: ["W", "W", "D", "W", "W"] },
  away: { name: "FC Barcelona", badge: "💙", form: ["W", "D", "W", "L", "W"] },
  competition: "La Liga · Jornada 28",
  date: "Sáb 2 Feb · 21:00",
};

const MOCK_ANALYSIS = {
  summary:
    "El Madrid presenta superioridad en presión alta y conversión de xG (+0.38). El Barça llega con Pedri tocado y baja en su pressing medio. Valor detectado en mercado de córners y hándicap asiático.",
  recommendation: "Real Madrid Hándicap –0.5",
  confidence: 78,
  odds: "1.87",
  ev: "+11.4%",
  probs: [
    { label: "Victoria Local", value: 52 },
    { label: "Empate", value: 24 },
    { label: "Victoria Visitante", value: 24 },
  ],
  stats: [
    { label: "xG Local (media 5J)", value: "2.31" },
    { label: "xG Visitante (media 5J)", value: "1.93" },
    { label: "H2H (últimos 5)", value: "3-1-1" },
    { label: "Cuota Fair Value", value: "1.69" },
  ],
};

const STEPS = [
  {
    icon: ScanSearch,
    step: "01",
    title: "Escanea tus torneos",
    desc: "Selecciona las ligas y competiciones que sigues. Cubrimos las principales ligas del mundo para que nunca te falte contexto.",
  },
  {
    icon: Target,
    step: "02",
    title: "Selecciona el partido",
    desc: "Elige el encuentro que quieres analizar y deja que los datos hablen. Rastreamos forma reciente, lesiones, H2H y métricas avanzadas en segundos.",
  },
  {
    icon: BrainCircuit,
    step: "03",
    title: "Analiza con IA",
    desc: "Nuestro motor de IA cruza cada variable y calcula el valor esperado real por mercado. Sin narrativas, solo señal cuantitativa y razonamiento explícito.",
  },
  {
    icon: Wallet,
    step: "04",
    title: "Gestiona tu Apuesta",
    desc: "Registra la apuesta, fija el stake y sigue tu ROI, Yield y tasa de acierto en tiempo real. Tu historial es tu ventaja compuesta.",
  },
];

/* ─── Pricing ───────────────────────────────────────────────────────────── */
const PLANS = [
  {
    id: "mensual",
    label: "Mensual",
    price: "$39.900",
    period: "/ mes",
    perMonth: 39900,
    savings: null,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo"],
  },
  {
    id: "trimestral",
    label: "Trimestral",
    price: "$99.900",
    period: "/ 3 meses",
    perMonth: 33300,
    savings: 17,
    popular: true,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario"],
  },
  {
    id: "semestral",
    label: "Semestral",
    price: "$179.900",
    period: "/ 6 meses",
    perMonth: 29983,
    savings: 25,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario"],
  },
  {
    id: "anual",
    label: "Anual",
    price: "$299.900",
    period: "/ año",
    perMonth: 24992,
    savings: 37,
    popular: false,
    features: ["Análisis IA ilimitados", "Gestión de bankroll", "Historial completo", "Soporte prioritario", "Acceso anticipado a nuevas funciones"],
  },
];

/* ─── FAQ ────────────────────────────────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: "¿Cómo funciona el análisis por IA?",
    a: "Introduces el partido que quieres analizar y nuestro motor de IA procesa en segundos la forma reciente de cada equipo, historial de enfrentamientos directos, bajas y lesiones, y métricas avanzadas como xG y presión alta. El resultado es un informe cuantitativo con probabilidades calculadas, valor esperado por mercado y una recomendación concreta — sin narrativas, solo datos.",
  },
  {
    q: "¿Tengo análisis gratuitos?",
    a: "Sí. Todos los planes incluyen un período de prueba para que puedas evaluar la calidad del análisis antes de comprometerte. Una vez activa tu suscripción, los análisis son ilimitados durante todo el período contratado.",
  },
  {
    q: "¿Qué medios de pago aceptan?",
    a: "Aceptamos tarjetas de crédito y débito (Visa, Mastercard, American Express), PSE, Nequi y Daviplata. Todos los pagos se procesan de forma segura. Los planes trimestrales, semestrales y anuales se cobran en un único pago al momento de la suscripción.",
  },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">{question}</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {answer}
        </div>
      )}
    </div>
  );
}

function FormBadge({ result }: { result: string }) {
  const colors: Record<string, string> = {
    W: "bg-primary/20 text-primary border border-primary/30",
    D: "bg-muted text-muted-foreground border border-border",
    L: "bg-destructive/15 text-destructive border border-destructive/30",
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold ${colors[result] ?? ""}`}
    >
      {result}
    </span>
  );
}

function ProbBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold text-foreground">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col selection:bg-primary/30">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 left-0 right-0 h-16 flex items-center justify-between px-4 md:px-8 border-b border-border bg-background/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2">
          <img src={`${basePath}/logo.svg`} alt="MarcadorFijo" className="w-8 h-8" />
          <span className="text-xl font-bold tracking-tight text-primary">MarcadorFijo</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2">
            Entrar
          </Link>
          <Link href="/sign-up" className="text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">
            Registrarse
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative flex flex-col items-center justify-center px-4 py-24 text-center border-b border-border overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.15)_0%,transparent_70%)] pointer-events-none" />

          <div className="relative z-10 max-w-3xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Inteligencia para Apuestas
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
              El radar de los <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
                apostadores serios.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
              Analiza partidos en tiempo real, encuentra valor en el mercado y gestiona tu bankroll como un profesional. Nada de juegos, solo rendimiento.
            </p>

            <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
              <Link href="/sign-up" className="w-full sm:w-auto px-8 py-3 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-all flex items-center justify-center gap-2 group">
                <Radar className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                Desplegar Radar
              </Link>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="py-24 px-4 bg-background border-b border-border">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-6 border border-border rounded-lg bg-card hover:border-primary/50 transition-colors">
                <Target className="w-10 h-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2 text-foreground">Análisis de Precisión</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Escaneo completo de métricas por partido usando modelos de IA avanzados para encontrar apuestas de alto valor en mercados desatendidos.
                </p>
              </div>
              <div className="p-6 border border-border rounded-lg bg-card hover:border-primary/50 transition-colors">
                <TrendingUp className="w-10 h-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2 text-foreground">Gestión de Bankroll</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Registro riguroso de cada movimiento. Calcula ROI, Yield y tasa de acierto en tiempo real como un terminal de trading.
                </p>
              </div>
              <div className="p-6 border border-border rounded-lg bg-card hover:border-primary/50 transition-colors">
                <ShieldCheck className="w-10 h-10 text-primary mb-4" />
                <h3 className="text-xl font-semibold mb-2 text-foreground">Disciplina Operativa</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  No es un casino. Es una herramienta para mantener la sangre fría, basar decisiones en datos y ejecutar con confianza.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Mockup Section ──────────────────────────────────────────────── */}
        <section className="relative py-24 px-4 bg-background border-b border-border overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_center,rgba(34,197,94,0.08)_0%,transparent_65%)] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto space-y-10">
            {/* Section header */}
            <div className="text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                Dashboard en Acción
              </span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                Así trabaja el motor de análisis
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto text-sm md:text-base">
                Una vista real del informe que genera la IA para cada partido. Sin ambigüedades, con razonamiento cuantitativo y recomendación accionable.
              </p>
            </div>

            {/* Dashboard mockup card */}
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-700 delay-150">

              {/* Window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-3 bg-muted/50 border-b border-border">
                <span className="w-3 h-3 rounded-full bg-destructive/60" />
                <span className="w-3 h-3 rounded-full bg-yellow-400/60" />
                <span className="w-3 h-3 rounded-full bg-primary/60" />
                <span className="ml-4 text-xs text-muted-foreground font-mono">
                  marcadorfijo.app / dashboard / análisis
                </span>
              </div>

              <div className="p-6 md:p-8 space-y-6">

                {/* Match header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      {MOCK_MATCH.competition}
                    </p>
                    <div className="flex items-center gap-3 text-xl font-bold text-foreground">
                      <span>{MOCK_MATCH.home.badge} {MOCK_MATCH.home.name}</span>
                      <span className="text-muted-foreground font-light text-sm">vs</span>
                      <span>{MOCK_MATCH.away.badge} {MOCK_MATCH.away.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{MOCK_MATCH.date}</p>
                  </div>
                  {/* Recommendation badge */}
                  <div className="flex-shrink-0 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-0.5">Recomendación IA</p>
                    <p className="text-sm font-bold text-foreground">{MOCK_ANALYSIS.recommendation}</p>
                    <p className="text-xs text-primary font-semibold mt-0.5">Cuota {MOCK_ANALYSIS.odds} · EV {MOCK_ANALYSIS.ev}</p>
                  </div>
                </div>

                {/* Two-col grid: form + stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Form */}
                  <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Forma Reciente (5J)</p>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium w-28 text-foreground">{MOCK_MATCH.home.name}</span>
                        <div className="flex gap-1">
                          {MOCK_MATCH.home.form.map((r, i) => <FormBadge key={i} result={r} />)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium w-28 text-foreground">{MOCK_MATCH.away.name}</span>
                        <div className="flex gap-1">
                          {MOCK_MATCH.away.form.map((r, i) => <FormBadge key={i} result={r} />)}
                        </div>
                      </div>
                    </div>
                    <div className="pt-1 space-y-2">
                      {MOCK_ANALYSIS.stats.map((s) => (
                        <div key={s.label} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="font-semibold text-foreground">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Probabilities + confidence */}
                  <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Probabilidades Calculadas</p>
                    <div className="space-y-3">
                      {MOCK_ANALYSIS.probs.map((p) => (
                        <ProbBar key={p.label} {...p} />
                      ))}
                    </div>
                    <div className="pt-2 flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-300"
                          style={{ width: `${MOCK_ANALYSIS.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-primary flex-shrink-0">
                        {MOCK_ANALYSIS.confidence}% confianza
                      </span>
                    </div>
                  </div>
                </div>

                {/* AI summary */}
                <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
                  <div className="flex items-center gap-2 text-primary">
                    <BrainCircuit className="w-4 h-4" />
                    <p className="text-xs font-semibold uppercase tracking-wider">Razonamiento IA</p>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {MOCK_ANALYSIS.summary}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How It Works ────────────────────────────────────────────────── */}
        <section className="py-24 px-4 bg-muted/30 border-b border-border">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                El Proceso
              </span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                Cómo funciona
              </h2>
              <p className="text-muted-foreground max-w-lg mx-auto text-sm md:text-base">
                Tres pasos para pasar de un partido en cartelera a una decisión fundamentada en datos.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {STEPS.map(({ icon: Icon, step, title, desc }, i) => (
                <div
                  key={step}
                  className={`relative p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-6 duration-700`}
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  {/* Step connector line (desktop) */}
                  {i < STEPS.length - 1 && (
                    <div className="hidden md:block absolute top-10 -right-3 w-6 h-px bg-border z-10" />
                  )}

                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-4xl font-black text-muted/40 leading-none select-none">{step}</span>
                  </div>

                  <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
              <Link
                href="/sign-up"
                className="px-8 py-3 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-all flex items-center gap-2 group"
              >
                <Radar className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                Empezar gratis
              </Link>
            </div>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────────── */}
        <section className="py-24 px-4 bg-background border-b border-border">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                Planes
              </span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                Elige tu frecuencia
              </h2>
              <p className="text-muted-foreground max-w-lg mx-auto text-sm md:text-base">
                Todos los planes incluyen acceso completo. A mayor plazo, mayor ahorro.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {PLANS.map(({ id, label, price, period, perMonth, savings, popular, features }, i) => (
                <div
                  key={id}
                  className={`relative flex flex-col rounded-xl border p-6 transition-all duration-300 animate-in fade-in slide-in-from-bottom-6 duration-700 ${
                    popular
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider shadow">
                        <Zap className="w-3 h-3" />
                        Más popular
                      </span>
                    </div>
                  )}

                  <div className="mb-4">
                    <p className="text-sm font-semibold text-muted-foreground mb-1">{label}</p>
                    <div className="flex items-end gap-1">
                      <span className="text-2xl font-black text-foreground">{price}</span>
                      <span className="text-xs text-muted-foreground mb-1">{period}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ≈ ${Math.round(perMonth / 100) * 100 === perMonth
                        ? perMonth.toLocaleString("es-CO")
                        : Math.round(perMonth).toLocaleString("es-CO")} COP / mes
                    </p>
                    {savings && (
                      <span className="mt-2 inline-block px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">
                        Ahorra {savings}%
                      </span>
                    )}
                  </div>

                  <ul className="flex-1 space-y-2 mb-6">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/sign-up"
                    className={`w-full py-2.5 rounded-md text-sm font-semibold text-center transition-all ${
                      popular
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border bg-background hover:border-primary hover:text-primary"
                    }`}
                  >
                    Empezar
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
        <section className="py-24 px-4 bg-muted/30 border-b border-border">
          <div className="max-w-2xl mx-auto space-y-10">
            <div className="text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-block px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                FAQ
              </span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                Preguntas frecuentes
              </h2>
            </div>

            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
              {FAQ_ITEMS.map(({ q, a }) => (
                <FaqItem key={q} question={q} answer={a} />
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card">
        {/* Responsible gambling banner — Colombia */}
        <div className="border-b border-border bg-destructive/5 px-4 py-3">
          <div className="max-w-5xl mx-auto flex items-start sm:items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5 sm:mt-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">+18 · Juego responsable.</span>{" "}
              Las apuestas implican riesgo de pérdida. Consulta información sobre juego responsable en{" "}
              <a
                href="https://www.coljuegos.gov.co"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Coljuegos
              </a>{" "}
              o{" "}
              <a
                href="https://www.jugadoresanonimos.org.co"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Jugadores Anónimos Colombia
              </a>
              .
            </p>
          </div>
        </div>

        {/* Main footer */}
        <div className="px-4 py-8">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Brand */}
            <div className="flex items-center gap-2 opacity-60">
              <img
                src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`}
                alt="MarcadorFijo"
                className="w-5 h-5 grayscale"
              />
              <span className="text-sm font-semibold tracking-tight">MarcadorFijo</span>
            </div>

            {/* Links */}
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {[
                { label: "Términos de Servicio", href: "#" },
                { label: "Política de Privacidad", href: "#" },
                { label: "Aviso Legal", href: "#" },
                { label: "Contacto", href: "#" },
              ].map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {label}
                </a>
              ))}
            </nav>

            {/* Copyright */}
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} MarcadorFijo. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
