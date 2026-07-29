import { useState, useRef, useCallback, useEffect } from "react";
import { 
  useGetMe, 
  getGetMeQueryKey, 
  useRadarMatches,
  useAnalyzeMatch,
  useGetCachedAnalysis,
  getGetCachedAnalysisQueryKey,
  useCreateBet,
  getListBetsQueryKey,
  getGetBetStatsQueryKey,
  Match,
  Prediction
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { Radar, AlertTriangle, ChevronDown, Check, Loader2, Target, Info, Trophy, Clock, RefreshCw, Activity, Crown, Zap, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import * as Dialog from "@radix-ui/react-dialog";

// ---------------------------------------------------------------------------
// Basketball types
// ---------------------------------------------------------------------------
interface BasketballMatch {
  id: string;
  apiId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  status: string;
  score: { home: number | null; away: number | null } | null;
}

const LIGAS_BALONCESTO = [
  { id: "nba",        label: "NBA",        flag: "🇺🇸" },
  { id: "euroleague", label: "EuroLeague", flag: "🇪🇺" },
];

const LIGAS = [
  { id: "premier_league",   label: "Premier League",   flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "la_liga",          label: "La Liga",           flag: "🇪🇸" },
  { id: "bundesliga",       label: "Bundesliga",        flag: "🇩🇪" },
  { id: "serie_a",          label: "Serie A",           flag: "🇮🇹" },
  { id: "ligue_1",          label: "Ligue 1",           flag: "🇫🇷" },
  { id: "eredivisie",       label: "Eredivisie",        flag: "🇳🇱" },
  { id: "primeira_liga",    label: "Primeira Liga",     flag: "🇵🇹" },
  { id: "super_lig",        label: "Süper Lig",         flag: "🇹🇷" },
  { id: "mls",              label: "MLS",               flag: "🇺🇸" },
  { id: "liga_mx",          label: "Liga MX",           flag: "🇲🇽" },
  { id: "liga_betplay",     label: "Liga BetPlay",      flag: "🇨🇴" },
  { id: "liga_profesional", label: "Liga Profesional",  flag: "🇦🇷" },
  { id: "brasileirao",      label: "Brasileirão",       flag: "🇧🇷" },
  { id: "ligapro_ecuador",  label: "LigaPro Ecuador",   flag: "🇪🇨" },
];

const COPAS = [
  // Nacionales
  { id: "fa_cup",           label: "FA Cup",            flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "copa_del_rey",     label: "Copa del Rey",      flag: "🇪🇸" },
  { id: "coppa_italia",     label: "Coppa Italia",      flag: "🇮🇹" },
  { id: "dfb_pokal",        label: "DFB-Pokal",         flag: "🇩🇪" },
  { id: "coupe_de_france",  label: "Coupe de France",   flag: "🇫🇷" },
  { id: "knvb_beker",       label: "KNVB Beker",        flag: "🇳🇱" },
  { id: "copa_do_brasil",   label: "Copa do Brasil",    flag: "🇧🇷" },
  { id: "copa_argentina",   label: "Copa Argentina",    flag: "🇦🇷" },
  { id: "copa_betplay",     label: "Copa BetPlay",      flag: "🇨🇴" },
  // Internacionales
  { id: "champions_league", label: "Champions League",  flag: "⭐" },
  { id: "europa_league",    label: "Europa League",     flag: "🟠" },
  { id: "conference_league",label: "Conference League", flag: "🔵" },
  { id: "libertadores",     label: "Copa Libertadores", flag: "🏆" },
  { id: "sudamericana",     label: "Copa Sudamericana", flag: "🌎" },
  // Selecciones
  { id: "mundial",          label: "Copa Mundial FIFA", flag: "🌍" },
];

function Badge({ children, variant = "default", className = "" }: { children: React.ReactNode, variant?: "default" | "success" | "warning" | "danger" | "outline" | "live" | "secondary", className?: string }) {
  const variants = {
    default:  "bg-primary/20 text-primary border border-primary/30",
    success:  "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30",
    warning:  "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30",
    danger:   "bg-red-500/20 text-red-500 border border-red-500/30",
    outline:  "bg-transparent text-muted-foreground border border-border",
    live:     "bg-red-500/90 text-white border border-red-400 animate-pulse",
    secondary: "bg-secondary text-secondary-foreground border border-border",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "live":      return <Badge variant="live"><span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" />En Vivo</span></Badge>;
    case "halftime":  return <Badge variant="warning">Descanso</Badge>;
    case "finished":  return <Badge variant="outline">Finalizado</Badge>;
    case "postponed": return <Badge variant="secondary">Pospuesto</Badge>;
    case "cancelled": return <Badge variant="danger">Cancelado</Badge>;
    default:          return null; // "scheduled" — no badge needed, kickoff time is shown
  }
}

function readLS<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}

type SelectOption = { id: string; label: string; flag: string };

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: SelectOption[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (lbl: string) =>
    onChange(selected.includes(lbl) ? selected.filter(s => s !== lbl) : [...selected, lbl]);

  const allSelected = selected.length === options.length;

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-secondary border border-border rounded-lg text-sm font-medium hover:border-primary/50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-muted-foreground">{label}:</span>
          <span className={`truncate ${selected.length > 0 ? "text-primary" : "text-muted-foreground"}`}>
            {selected.length === 0 ? "Todas" : selected.length === 1 ? selected[0] : `${selected.length} seleccionadas`}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/40">
            <span className="text-xs text-muted-foreground font-medium">{selected.length} / {options.length}</span>
            <button
              onClick={() => onChange(allSelected ? [] : options.map(o => o.label))}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              {allSelected ? "Limpiar todo" : "Seleccionar todo"}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.map(opt => {
              const checked = selected.includes(opt.label);
              return (
                <button
                  key={opt.id}
                  onClick={() => toggle(opt.label)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-secondary/60 ${checked ? "bg-primary/10" : ""}`}
                >
                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] transition-colors ${checked ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                    {checked && <Check className="w-3 h-3" />}
                  </span>
                  <span>{opt.flag}</span>
                  <span className={checked ? "text-foreground font-medium" : "text-muted-foreground"}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [conversionModalOpen, setConversionModalOpen] = useState(false);
  const [sport, setSport] = useState<"futbol" | "baloncesto">("futbol");

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const radarMutation = useRadarMatches();
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>(() => readLS("rb_leagues", []));
  const [selectedCups, setSelectedCups] = useState<string[]>(() => readLS("rb_cups", []));
  const [persistedResults, setPersistedResults] = useState<typeof radarMutation.data>(() => readLS("rb_radar", undefined));
  const radarRequestLockedRef = useRef(false);

  // Basketball radar state
  const [selectedBasketballLeagues, setSelectedBasketballLeagues] = useState<("nba" | "euroleague")[]>(() =>
    readLS<("nba" | "euroleague")[]>("rb_bball_leagues", [])
  );
  const nbaRadarMutation = useMutation({
    mutationFn: async (leagues: ("nba" | "euroleague")[]): Promise<BasketballMatch[]> => {
      const res = await fetch("/api/basketball/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagues }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err: any = new Error(data?.error ?? `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return res.json();
    },
  });
  const [persistedNbaResults, setPersistedNbaResults] = useState<BasketballMatch[] | undefined>(() =>
    readLS("rb_bball_radar", undefined)
  );
  const nbaRadarLockedRef = useRef(false);

  const toggleBasketballLeague = useCallback((id: "nba" | "euroleague") => {
    setSelectedBasketballLeagues(prev => {
      const next = prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id];
      try { localStorage.setItem("rb_bball_leagues", JSON.stringify(next)); } catch {}
      return next;
    });
    setPersistedNbaResults(undefined);
    nbaRadarMutation.reset();
  }, [nbaRadarMutation]);

  const handleNbaRadarScan = useCallback(() => {
    if (nbaRadarLockedRef.current || nbaRadarMutation.isPending) return;
    nbaRadarLockedRef.current = true;
    const leaguesToScan = selectedBasketballLeagues.length > 0
      ? selectedBasketballLeagues
      : (["nba", "euroleague"] as ("nba" | "euroleague")[]);
    nbaRadarMutation.mutate(leaguesToScan, {
      onSuccess: (data) => {
        setPersistedNbaResults(data);
        try { localStorage.setItem("rb_bball_radar", JSON.stringify(data)); } catch {}
      },
      onSettled: () => { nbaRadarLockedRef.current = false; },
    });
  }, [nbaRadarMutation, selectedBasketballLeagues]);

  useEffect(() => {
    try { localStorage.setItem("rb_leagues", JSON.stringify(selectedLeagues)); } catch {}
  }, [selectedLeagues]);

  useEffect(() => {
    try { localStorage.setItem("rb_cups", JSON.stringify(selectedCups)); } catch {}
  }, [selectedCups]);

  const handleAnalysisSuccess = useCallback((homeTeam: string, awayTeam: string) => {
    setPersistedResults(prev => {
      if (!prev) return prev;
      const updated = prev.map(league => ({
        ...league,
        matches: league.matches.map(m =>
          m.homeTeam === homeTeam && m.awayTeam === awayTeam
            ? { ...m, hasAnalysis: true }
            : m
        ),
      }));
      try { localStorage.setItem("rb_radar", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const handleRadarScan = useCallback(() => {
    if (radarRequestLockedRef.current || radarMutation.isPending) return;
    radarRequestLockedRef.current = true;
    const combined = [...selectedLeagues, ...selectedCups];
    radarMutation.mutate(
      { data: { leagues: combined.length > 0 ? combined : undefined } },
      {
        onSuccess: (data) => {
          setPersistedResults(data);
          try { localStorage.setItem("rb_radar", JSON.stringify(data)); } catch {}
        },
        onSettled: () => { radarRequestLockedRef.current = false; },
      },
    );
  }, [radarMutation, selectedLeagues, selectedCups]);

  const isActive = me?.activeSubscription;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de Operaciones</h1>
          <p className="text-muted-foreground">Partidos reales · Predicciones con AI.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-md border border-border">
            <span className="text-sm font-medium">Estado:</span>
            {isActive ? (
              <Badge variant="success">Suscripción Activa</Badge>
            ) : (
              <Badge variant="danger">Sin Suscripción</Badge>
            )}
          </div>
          {!isActive && me && (
            <button
              onClick={() => setConversionModalOpen(true)}
              className="flex items-center gap-2.5 bg-card px-4 py-2 rounded-md border border-primary/40 hover:border-primary/70 transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium">
                Análisis gratuitos hoy:{" "}
                <span className={me.dailyFreeAnalysesUsed >= 1 ? "text-destructive font-bold" : "text-primary font-bold"}>
                  {me.dailyFreeAnalysesUsed}/1
                </span>
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Pestañas de deporte */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit border border-border">
        <button
          onClick={() => setSport("futbol")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            sport === "futbol"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          ⚽ Fútbol
        </button>
        <button
          onClick={() => setSport("baloncesto")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            sport === "baloncesto"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          🏀 Baloncesto
        </button>
      </div>

      {sport === "baloncesto" && (
        <>
          {/* Selector de liga */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Liga a escanear</span>
            </div>
            <div className="flex gap-2">
              {LIGAS_BALONCESTO.map(liga => {
                const active = selectedBasketballLeagues.includes(liga.id as "nba" | "euroleague");
                return (
                  <button
                    key={liga.id}
                    onClick={() => toggleBasketballLeague(liga.id as "nba" | "euroleague")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      active
                        ? "bg-primary/10 border-primary/50 text-primary"
                        : "bg-secondary border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                    <span>{liga.flag}</span>
                    <span>{liga.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedBasketballLeagues.length === 0
                ? "Sin selección: el radar buscará en NBA y EuroLeague."
                : `Escaneando: ${selectedBasketballLeagues.map(id => LIGAS_BALONCESTO.find(l => l.id === id)?.label).join(" + ")}.`}
            </p>
          </div>

          {/* Radar Baloncesto */}
          <div className="relative rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-8 flex flex-col items-center justify-center min-h-[260px] text-center relative z-20">
              <button
                onClick={handleNbaRadarScan}
                disabled={nbaRadarMutation.isPending}
                className={`relative group flex flex-col items-center justify-center w-40 h-40 rounded-full transition-all duration-500 ${
                  nbaRadarMutation.isPending
                    ? "bg-primary/20 scale-105"
                    : "bg-primary/10 hover:bg-primary/20 hover:scale-105 cursor-pointer border border-primary/30"
                }`}
              >
                {nbaRadarMutation.isPending && <div className="radar-sweep" />}
                <Radar className={`w-12 h-12 mb-2 ${nbaRadarMutation.isPending ? "text-primary animate-pulse" : "text-primary group-hover:text-primary"}`} />
                <span className="font-bold tracking-widest uppercase text-xs text-primary">
                  {nbaRadarMutation.isPending ? "Buscando..." : "Desplegar Radar"}
                </span>
              </button>
              <p className="mt-4 text-xs text-muted-foreground">
                {selectedBasketballLeagues.map(id => LIGAS_BALONCESTO.find(l => l.id === id)?.flag).join(" ")}
                {" "}{selectedBasketballLeagues.map(id => LIGAS_BALONCESTO.find(l => l.id === id)?.label).join(" + ")} · Partidos de hoy
              </p>
              {!isActive && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Modo freemium · 1 análisis gratuito por día
                </p>
              )}
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-10" />
          </div>

          {/* Error state */}
          {nbaRadarMutation.isError && (() => {
            const errData = (nbaRadarMutation.error as any)?.data as { error?: string; code?: string } | undefined;
            const isFreemiumBlocked = errData?.code === "FREEMIUM_DISABLED";
            const rawMsg = typeof errData === 'object' ? errData?.error : undefined;
            const fallbackMsg = (nbaRadarMutation.error as Error)?.message ?? "";
            const isHtml = (s?: string) => s ? s.trimStart().startsWith("<") : false;
            const errorMsg = (rawMsg ?? (isHtml(fallbackMsg) ? "Error al conectar con el proveedor de datos. Verifica tu API key o intenta de nuevo más tarde." : fallbackMsg)) || "Error inesperado.";
            if (isFreemiumBlocked) {
              return (
                <div className="bg-card border border-primary/30 p-4 rounded-md flex items-start gap-3">
                  <Crown className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
                  <div className="text-sm flex-1">
                    <p className="font-semibold mb-1 text-foreground">Acceso gratuito desactivado</p>
                    <p className="text-muted-foreground mb-3">{errorMsg}</p>
                    <button onClick={() => setConversionModalOpen(true)} className="flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground rounded text-xs font-semibold hover:bg-primary/90 transition-colors">
                      <Zap className="w-3.5 h-3.5" /> Ver planes
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-md flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold mb-1">Error al desplegar el radar</p>
                  <p>{errorMsg}</p>
                </div>
              </div>
            );
          })()}

          {/* Results */}
          {(() => {
            const results = nbaRadarMutation.data ?? persistedNbaResults;
            if (!results) return null;
            const isStale = !nbaRadarMutation.isSuccess && !!persistedNbaResults;
            return (
              <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center gap-2 border-b border-border pb-2 flex-wrap">
                  <Target className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-semibold">
                    Partidos {selectedBasketballLeagues.map(id => LIGAS_BALONCESTO.find(l => l.id === id)?.label).join(" + ")} Detectados
                  </h2>
                  <Badge className="ml-2">{results.length} Partido{results.length !== 1 ? "s" : ""}</Badge>
                  {isStale && (
                    <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" /> Última búsqueda guardada — presiona Radar para actualizar
                    </span>
                  )}
                </div>
                {results.length === 0 ? (
                  <p className="text-muted-foreground text-center py-12 bg-card rounded-md border border-border">
                    No hay partidos de {selectedBasketballLeagues.map(id => LIGAS_BALONCESTO.find(l => l.id === id)?.label).join(" + ")} programados para hoy.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {results.map(match => <NbaMatchCard key={match.id} match={match} />)}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {sport === "futbol" && (
      <>

      {/* Selector de competiciones */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Competiciones a escanear</span>
          {(selectedLeagues.length > 0 || selectedCups.length > 0) && (
            <Badge variant="default">{selectedLeagues.length + selectedCups.length} seleccionada{selectedLeagues.length + selectedCups.length !== 1 ? "s" : ""}</Badge>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <MultiSelectDropdown
            label="Ligas"
            options={LIGAS}
            selected={selectedLeagues}
            onChange={setSelectedLeagues}
          />
          <MultiSelectDropdown
            label="Copas"
            options={COPAS}
            selected={selectedCups}
            onChange={setSelectedCups}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedLeagues.length === 0 && selectedCups.length === 0
            ? "Sin selección: el radar buscará en todas las competiciones disponibles."
            : `Escaneando: ${[...selectedLeagues, ...selectedCups].join(", ")}.`}
        </p>
      </div>

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-8 flex flex-col items-center justify-center min-h-[260px] text-center relative z-20">
          <button
            onClick={handleRadarScan}
            disabled={radarMutation.isPending}
            className={`relative group flex flex-col items-center justify-center w-40 h-40 rounded-full transition-all duration-500 ${
              radarMutation.isPending
                ? "bg-primary/20 scale-105"
                : "bg-primary/10 hover:bg-primary/20 hover:scale-105 cursor-pointer border border-primary/30"
            }`}
          >
            {radarMutation.isPending && <div className="radar-sweep" />}
            <Radar className={`w-12 h-12 mb-2 ${radarMutation.isPending ? "text-primary animate-pulse" : "text-primary group-hover:text-primary"}`} />
            <span className="font-bold tracking-widest uppercase text-xs text-primary">
              {radarMutation.isPending ? "Buscando..." : "Desplegar Radar"}
            </span>
          </button>

          {!isActive && (
            <p className="mt-6 text-xs text-muted-foreground">
              Modo freemium · 1 análisis gratuito por día
            </p>
          )}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-10" />
      </div>

      {radarMutation.isError && (() => {
        const errData = (radarMutation.error as any)?.data as { error?: string; retryAfter?: number; code?: string } | undefined;
        const is429 = (radarMutation.error as any)?.status === 429 || !!errData?.retryAfter;
        const isFreemiumBlocked = errData?.code === "FREEMIUM_DISABLED";
        const rawMsg = typeof errData === 'object' ? errData?.error : undefined;
        const fallbackMsg = (radarMutation.error as Error)?.message ?? "";
        const isHtml = (s?: string) => s ? s.trimStart().startsWith("<") : false;
        const errorMsg = (rawMsg ?? (isHtml(fallbackMsg) ? "Error al conectar con el proveedor de datos. Verifica tu API key o intenta de nuevo más tarde." : fallbackMsg)) || "Error inesperado. Inténtalo de nuevo.";

        if (isFreemiumBlocked) {
          return (
            <div className="bg-card border border-primary/30 p-4 rounded-md flex items-start gap-3">
              <Crown className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
              <div className="text-sm flex-1">
                <p className="font-semibold mb-1 text-foreground">Acceso gratuito desactivado</p>
                <p className="text-muted-foreground mb-3">{errorMsg}</p>
                <button
                  onClick={() => setConversionModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground rounded text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" /> Ver planes
                </button>
              </div>
            </div>
          );
        }

        return is429 ? (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-4 rounded-md flex items-start gap-3">
            <Clock className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-semibold mb-1">Límite de API alcanzado temporalmente</p>
              <p className="text-amber-300/80 mb-3">{errorMsg}</p>
              <button
                onClick={handleRadarScan}
                disabled={radarMutation.isPending}
                className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-md flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold mb-1">Error al desplegar el radar</p>
              <p>{errorMsg}</p>
            </div>
          </div>
        );
      })()}

      {(() => {
        const results = radarMutation.data ?? persistedResults;
        if (!results) return null;
        const isStale = !radarMutation.isSuccess && !!persistedResults;
        return (
          <div className="space-y-8 animate-in slide-in-from-bottom-8 duration-700">
            <div className="flex items-center gap-2 border-b border-border pb-2 flex-wrap">
              <Target className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">Objetivos Detectados</h2>
              <Badge className="ml-2">{results.reduce((acc, l) => acc + l.matches.length, 0)} Partidos</Badge>
              {isStale && (
                <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Última búsqueda guardada — presiona Radar para actualizar
                </span>
              )}
            </div>

            {results.length === 0 ? (
              <p className="text-muted-foreground text-center py-12 bg-card rounded-md border border-border">No se encontraron partidos hoy en las competiciones seleccionadas.</p>
            ) : (
              results.map((league, idx) => (
                <div key={league.league} className={`space-y-4 stagger-${(idx % 5) + 1}`}>
                  <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">{league.league}</h3>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {league.matches.map(match => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        leagueName={league.league}
                        onAnalysisSuccess={handleAnalysisSuccess}
                        onFreemiumBlocked={() => setConversionModalOpen(true)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })()}

      </>
      )}

      <SubscriptionConversionModal
        open={conversionModalOpen}
        onClose={() => setConversionModalOpen(false)}
        onNavigate={() => { setConversionModalOpen(false); setLocation("/configuracion"); }}
      />
    </div>
  );
}

/* ─── Subscription conversion modal ─────────────────────────────────────── */

const CONVERSION_PLANS = [
  { id: "mensual",    label: "Mensual",    price: "$39.900",  period: "/mes",      savings: null, popular: false },
  { id: "trimestral", label: "Trimestral", price: "$99.900",  period: "/3 meses",  savings: 17,   popular: true  },
  { id: "semestral",  label: "Semestral",  price: "$179.900", period: "/6 meses",  savings: 25,   popular: false },
  { id: "anual",      label: "Anual",      price: "$299.900", period: "/año",       savings: 37,   popular: false },
];

function SubscriptionConversionModal({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 animate-in fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-lg bg-card border border-border rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Crown className="w-5 h-5 text-primary" />
              </div>
              <div>
                <Dialog.Title className="text-base font-bold">Desbloquea análisis ilimitados</Dialog.Title>
                <p className="text-xs text-muted-foreground mt-0.5">Has agotado tu análisis gratuito de hoy.</p>
              </div>
            </div>
            <Dialog.Close className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Plan grid */}
          <div className="p-5 grid grid-cols-2 gap-3">
            {CONVERSION_PLANS.map(plan => (
              <div
                key={plan.id}
                className={`relative rounded-lg border p-4 flex flex-col gap-1 transition-colors ${
                  plan.popular
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-secondary/20"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full whitespace-nowrap">
                    MÁS POPULAR
                  </span>
                )}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{plan.label}</span>
                <span className="text-xl font-black text-foreground">{plan.price}</span>
                <span className="text-xs text-muted-foreground">{plan.period}</span>
                {plan.savings && (
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 w-fit mt-0.5">
                    Ahorra {plan.savings}%
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 flex flex-col sm:flex-row gap-3">
            <button
              onClick={onNavigate}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors text-sm"
            >
              <Zap className="w-4 h-4" />
              Ver planes y suscribirme
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Más tarde
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── NBA Match Card ─────────────────────────────────────────────────────── */

function NbaMatchCard({ match }: { match: BasketballMatch }) {
  const showScore = match.score && (match.status === "live" || match.status === "halftime" || match.status === "finished");

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col transition-all duration-300 hover:border-primary/50">
      <div className="p-4 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Status + time row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {match.status === "scheduled" && (
              <span className="text-xs font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
                {match.kickoffTime
                  ? (() => { const d = new Date(match.kickoffTime); return isNaN(d.getTime()) ? match.kickoffTime : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); })()
                  : "—"}
              </span>
            )}
            {match.status === "live" && <Badge variant="live"><span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" />En Vivo</span></Badge>}
            {match.status === "halftime" && <Badge variant="warning">Descanso</Badge>}
            {match.status === "finished" && <Badge variant="outline">Finalizado</Badge>}
            {match.status === "postponed" && <Badge variant="secondary">Pospuesto</Badge>}
            {match.status === "cancelled" && <Badge variant="danger">Cancelado</Badge>}
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20">NBA</span>
          </div>

          {/* Teams + score */}
          {showScore ? (
            <div className="flex items-center gap-3 mt-1">
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-foreground truncate">{match.homeTeam}</p>
                <p className="text-base font-bold text-foreground truncate">{match.awayTeam}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-black text-primary tabular-nums">{match.score?.home ?? "—"}</p>
                <p className="text-xl font-black text-primary tabular-nums">{match.score?.away ?? "—"}</p>
              </div>
            </div>
          ) : (
            <div className="mt-1 space-y-0.5">
              <p className="text-base font-bold text-foreground truncate">{match.homeTeam}</p>
              <p className="text-xs text-muted-foreground font-medium">vs</p>
              <p className="text-base font-bold text-foreground truncate">{match.awayTeam}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Football Match Card ────────────────────────────────────────────────── */

function MatchCard({ match, leagueName, onAnalysisSuccess, onFreemiumBlocked }: { match: Match, leagueName: string, onAnalysisSuccess: (homeTeam: string, awayTeam: string) => void, onFreemiumBlocked: () => void }) {
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [loadCached, setLoadCached] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  const analyzeMutation = useAnalyzeMatch();
  const analyzeRequestLockedRef = useRef(false);
  const queryClient = useQueryClient();

  const cachedAnalysisParams = { homeTeam: match.homeTeam, awayTeam: match.awayTeam, league: leagueName };
  const cachedAnalysisQuery = useGetCachedAnalysis(
    cachedAnalysisParams,
    {
      query: {
        queryKey: getGetCachedAnalysisQueryKey(cachedAnalysisParams),
        enabled: !!match.hasAnalysis && loadCached,
        retry: false,
        staleTime: Infinity,
      },
    }
  );

  // Si match.hasAnalysis acaba de volverse true (justo terminó el análisis),
  // cachedAnalysisQuery.data aún no existe porque loadCached=false.
  // Usamos analyzeMutation.data como fallback para no dejar el modal vacío.
  const analysis = match.hasAnalysis
    ? (cachedAnalysisQuery.data ?? analyzeMutation.data)
    : analyzeMutation.data;
  const isAnalyzing = match.hasAnalysis
    ? (cachedAnalysisQuery.isFetching && !analyzeMutation.data)
    : analyzeMutation.isPending;

  const isFinished = match.status === "finished" || match.status === "postponed" || match.status === "cancelled";
  const isStarted = match.status === "live" || match.status === "halftime";
  const cannotAnalyzeNew = isFinished || isStarted;

  const doAnalyze = useCallback(() => {
    if (analyzeMutation.isPending || analyzeRequestLockedRef.current) return;
    analyzeRequestLockedRef.current = true;
    analyzeMutation.mutate(
      { data: { homeTeam: match.homeTeam, awayTeam: match.awayTeam, league: leagueName, kickoffTime: match.kickoffTime } },
      {
        onSuccess: () => { onAnalysisSuccess(match.homeTeam, match.awayTeam); },
        onError: (err) => {
          const errData = (err as any)?.data as { code?: string } | undefined;
          if (errData?.code === "FREEMIUM_LIMIT_REACHED" || errData?.code === "FREEMIUM_DISABLED") {
            setAnalysisModalOpen(false);
            onFreemiumBlocked();
          }
        },
        onSettled: () => {
          analyzeRequestLockedRef.current = false;
          // Refresh freemium counter (dailyFreeAnalysesUsed may have changed)
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
      },
    );
  }, [analyzeMutation, match.homeTeam, match.awayTeam, match.kickoffTime, leagueName, onAnalysisSuccess, onFreemiumBlocked, queryClient]);

  const handleAnalyze = () => {
    setAnalysisModalOpen(true);
    if (analysis) return;
    if (match.hasAnalysis) { setLoadCached(true); return; }
    if (cannotAnalyzeNew) return;
    doAnalyze();
  };

  // Start countdown when API returns a 429 with retryAfter
  useEffect(() => {
    if (!analyzeMutation.isError) { setRetryCountdown(null); return; }
    const errData = (analyzeMutation.error as any)?.data as { retryAfter?: number } | undefined;
    const secs = errData?.retryAfter;
    if (!secs) return;
    setRetryCountdown(secs);
    const endMs = Date.now() + secs * 1000;
    const id = setInterval(() => {
      const left = Math.ceil((endMs - Date.now()) / 1000);
      setRetryCountdown(left > 0 ? left : 0);
      if (left <= 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeMutation.isError, analyzeMutation.error]);

  // Auto-retry once countdown reaches 0
  const doAnalyzeRef = useRef(doAnalyze);
  doAnalyzeRef.current = doAnalyze;
  useEffect(() => {
    if (retryCountdown !== 0) return;
    setRetryCountdown(null);
    analyzeMutation.reset();
    const t = setTimeout(() => doAnalyzeRef.current(), 50);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCountdown]);

  const showScore = match.score && (match.status === "live" || match.status === "halftime" || match.status === "finished");

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col transition-all duration-300 hover:border-primary/50">
        <div className="p-4 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Status + time row */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {match.status === "scheduled" && (
                <span className="text-xs font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
                  {match.kickoffTime
                    ? (() => { const d = new Date(match.kickoffTime); return isNaN(d.getTime()) ? match.kickoffTime : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); })()
                    : "—"}
                </span>
              )}
              <StatusBadge status={match.status} />
              {match.stadium && <span className="text-xs text-muted-foreground truncate hidden sm:block">{match.stadium}</span>}
              {match.hasAnalysis && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  En caché
                </span>
              )}
            </div>

            {/* Teams + score */}
            {showScore ? (
              <div className="flex items-center gap-3 mt-1">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-foreground truncate">{match.homeTeam}</p>
                  <p className="text-base font-bold text-foreground truncate">{match.awayTeam}</p>
                </div>
                <div className="flex flex-col items-center shrink-0">
                  <span className={`text-2xl font-black tabular-nums ${match.status === "live" || match.status === "halftime" ? "text-primary" : "text-foreground"}`}>
                    {match.score!.home ?? "—"}
                  </span>
                  <span className={`text-2xl font-black tabular-nums ${match.status === "live" || match.status === "halftime" ? "text-primary" : "text-foreground"}`}>
                    {match.score!.away ?? "—"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col mt-1">
                <span className="text-lg font-bold text-foreground truncate">{match.homeTeam}</span>
                <span className="text-sm text-muted-foreground">vs</span>
                <span className="text-lg font-bold text-foreground truncate">{match.awayTeam}</span>
              </div>
            )}
          </div>

          <div className="ml-2 flex flex-col items-end justify-center shrink-0">
            {cannotAnalyzeNew && !match.hasAnalysis ? (
              <span className="text-xs text-muted-foreground/50 px-3 py-2">
                {isFinished ? "Finalizado" : "En curso"}
              </span>
            ) : (
              <button
                onClick={handleAnalyze}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors border border-border"
              >
                {analysis || match.hasAnalysis ? (
                  <><ChevronDown className="w-4 h-4 text-emerald-400" /> Ver Análisis</>
                ) : (
                  <><Target className="w-4 h-4 text-primary" /> Analizar</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Analysis Modal */}
      <Dialog.Root open={analysisModalOpen} onOpenChange={setAnalysisModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 animate-in fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-xl bg-card border border-border rounded-xl shadow-2xl z-50 flex flex-col max-h-[85dvh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal header */}
            <div className="flex items-start justify-between gap-4 p-5 border-b border-border shrink-0">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-bold text-foreground truncate">
                  {match.homeTeam} <span className="text-muted-foreground font-normal">vs</span> {match.awayTeam}
                </Dialog.Title>
                <p className="text-xs text-muted-foreground mt-0.5">{leagueName}</p>
              </div>
              <Dialog.Close className="shrink-0 p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </Dialog.Close>
            </div>

            {/* Modal body — scrollable */}
            <div className="overflow-y-auto p-5 space-y-5">
              {/* Loading */}
              {isAnalyzing && (
                <div className="space-y-3 py-4">
                  <div className="flex items-center gap-2 text-sm text-primary mb-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analizando partido con IA...</span>
                  </div>
                  <div className="h-3 bg-muted animate-pulse rounded w-full"></div>
                  <div className="h-3 bg-muted animate-pulse rounded w-4/5"></div>
                  <div className="h-3 bg-muted animate-pulse rounded w-3/5"></div>
                  <div className="h-3 bg-muted animate-pulse rounded w-full mt-4"></div>
                  <div className="h-16 bg-muted animate-pulse rounded w-full mt-2"></div>
                  <div className="h-16 bg-muted animate-pulse rounded w-full mt-2"></div>
                </div>
              )}

              {/* Error */}
              {analyzeMutation.isError && !isAnalyzing && (() => {
                const errData = (analyzeMutation.error as any)?.data as { error?: string; retryAfter?: number } | undefined;
                const is429 = !!errData?.retryAfter;
                const errorMsg = errData?.error ?? (analyzeMutation.error as Error)?.message ?? "Error al analizar. Inténtalo de nuevo.";
                return is429 ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 p-4 rounded-md flex items-center gap-3 text-sm">
                    <Clock className="w-4 h-4 shrink-0 animate-pulse" />
                    <p>
                      {retryCountdown !== null && retryCountdown > 0
                        ? `Límite de API alcanzado — reintentando en ${retryCountdown}s...`
                        : "Reintentando análisis..."}
                    </p>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-md flex items-start gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>{errorMsg}</p>
                  </div>
                );
              })()}

              {/* Analysis results */}
              {analysis && !isAnalyzing && (
                <div className="space-y-5">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground italic bg-secondary/30 p-3 rounded-md border border-border/50">
                    <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                    <p>{analysis.summary}</p>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Mercados Detectados</h4>
                    {analysis.predictions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No se encontró valor claro en este evento.</p>
                    ) : (
                      analysis.predictions.map(pred => (
                        <PredictionRow key={pred.id} prediction={pred} match={match} leagueName={leagueName} />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function PredictionRow({ prediction, match, leagueName }: { prediction: Prediction, match: Match, leagueName: string }) {
  const [modalOpen, setModalOpen] = useState(false);

  const confidenceColor = {
    high: "success",
    medium: "warning",
    low: "danger"
  } as const;

  return (
    <div className="bg-background border border-border p-3 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-foreground text-sm">{prediction.market}</span>
          <span className="text-primary font-bold text-sm bg-primary/10 px-2 py-0.5 rounded">@{prediction.odds.toFixed(2)}</span>
          <Badge variant={confidenceColor[prediction.confidence]} className="uppercase text-[10px]">{prediction.confidence}</Badge>
        </div>
        <p className="text-sm font-medium text-foreground mb-1">{prediction.selection}</p>
        {prediction.reasoning && (
          <p className="text-xs text-muted-foreground line-clamp-2" title={prediction.reasoning}>{prediction.reasoning}</p>
        )}
      </div>

      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Trigger asChild>
          <button className="px-4 py-1.5 bg-primary text-primary-foreground font-semibold text-sm rounded hover:bg-primary/90 transition-colors shrink-0">
            Apostar
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 animate-in fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-md bg-card border border-border rounded-xl shadow-2xl z-50 p-4 sm:p-6 animate-in fade-in zoom-in-95 duration-200 max-h-[90dvh] overflow-y-auto">
            <BetModalContent
              prediction={prediction}
              match={match}
              leagueName={leagueName}
              onClose={() => setModalOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function BetModalContent({ prediction, match, leagueName, onClose }: { prediction: Prediction, match: Match, leagueName: string, onClose: () => void }) {
  const [stake, setStake] = useState<string>("10");
  const [odds, setOdds] = useState<string>(prediction.odds.toString());
  const [notes, setNotes] = useState<string>("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const currency = me?.currency ?? "COP";
  const createBet = useCreateBet();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const stakeNum = parseFloat(stake);
    const oddsNum = parseFloat(odds);
    if (isNaN(stakeNum) || stakeNum <= 0 || isNaN(oddsNum) || oddsNum <= 0) return;

    createBet.mutate({
      data: {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league: leagueName,
        kickoffTime: match.kickoffTime,
        market: prediction.market,
        selection: prediction.selection,
        odds: oddsNum,
        stake: stakeNum,
        fixtureId: match.apiFootballId ?? undefined,
        notes: notes || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Apuesta registrada", description: "Guardada en el historial." });
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        onClose();
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo registrar la apuesta.", variant: "destructive" });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Dialog.Title className="text-xl font-bold">Registrar Operación</Dialog.Title>

      <div className="bg-secondary/50 p-3 rounded-md border border-border/50">
        <p className="text-sm font-medium">{match.homeTeam} vs {match.awayTeam}</p>
        <p className="text-xs text-muted-foreground">{leagueName}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mercado</label>
          <div className="bg-background border border-border px-3 py-2 rounded text-sm text-muted-foreground truncate">{prediction.market}</div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Selección</label>
          <div className="bg-background border border-border px-3 py-2 rounded text-sm text-muted-foreground truncate">{prediction.selection}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuota</label>
          <input
            type="number" step="0.01" value={odds} onChange={e => setOdds(e.target.value)}
            className="w-full bg-background border border-border px-3 py-2 rounded text-sm text-primary font-bold focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monto ({currency})</label>
          <input
            type="number" step="1" value={stake} onChange={e => setStake(e.target.value)}
            className="w-full bg-background border border-border px-3 py-2 rounded text-sm font-bold focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notas (Opcional)</label>
        <input
          type="text" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Ej: Stake bajo, mercado volátil..."
          className="w-full bg-background border border-border px-3 py-2 rounded text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium hover:bg-secondary rounded transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={createBet.isPending} className="px-6 py-2 bg-primary text-primary-foreground text-sm font-bold rounded hover:bg-primary/90 transition-colors flex items-center gap-2">
          {createBet.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Confirmar
        </button>
      </div>
    </form>
  );
}
