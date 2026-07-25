import { useState } from "react";
import { 
  useGetMe, 
  getGetMeQueryKey, 
  useGetGeminiKeyStatus, 
  getGetGeminiKeyStatusQueryKey,
  useRadarMatches,
  useAnalyzeMatch,
  useCreateBet,
  getListBetsQueryKey,
  getGetBetStatsQueryKey,
  Match,
  Prediction
} from "@workspace/api-client-react";
import { Radar, AlertTriangle, ChevronDown, Check, Loader2, Target, Info, Trophy } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import * as Dialog from "@radix-ui/react-dialog";

const AVAILABLE_LEAGUES = [
  { id: "premier_league",   label: "Premier League",    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "la_liga",          label: "La Liga",            flag: "🇪🇸" },
  { id: "bundesliga",       label: "Bundesliga",         flag: "🇩🇪" },
  { id: "serie_a",          label: "Serie A",            flag: "🇮🇹" },
  { id: "ligue_1",          label: "Ligue 1",            flag: "🇫🇷" },
  { id: "champions_league", label: "Champions League",   flag: "⭐" },
  { id: "europa_league",    label: "Europa League",      flag: "🟠" },
  { id: "eredivisie",       label: "Eredivisie",         flag: "🇳🇱" },
  { id: "primeira_liga",    label: "Primeira Liga",      flag: "🇵🇹" },
  { id: "super_lig",        label: "Süper Lig",          flag: "🇹🇷" },
  { id: "mls",              label: "MLS",                flag: "🇺🇸" },
  { id: "liga_mx",          label: "Liga MX",            flag: "🇲🇽" },
];

function Badge({ children, variant = "default", className = "" }: { children: React.ReactNode, variant?: "default" | "success" | "warning" | "danger" | "outline", className?: string }) {
  const variants = {
    default: "bg-primary/20 text-primary border border-primary/30",
    success: "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30",
    warning: "bg-yellow-500/20 text-yellow-500 border border-yellow-500/30",
    danger: "bg-red-500/20 text-red-500 border border-red-500/30",
    outline: "bg-transparent text-muted-foreground border border-border"
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: keyStatus } = useGetGeminiKeyStatus({ query: { queryKey: getGetGeminiKeyStatusQueryKey() } });

  const radarMutation = useRadarMatches();
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);

  const toggleLeague = (label: string) => {
    setSelectedLeagues(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const handleRadarScan = () => {
    radarMutation.mutate({
      data: { leagues: selectedLeagues.length > 0 ? selectedLeagues : undefined }
    });
  };

  const isActive = me?.activeSubscription;
  const hasKey = keyStatus?.hasKey;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de Operaciones</h1>
          <p className="text-muted-foreground">Analiza el mercado y detecta valor.</p>
        </div>
        <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-md border border-border">
          <span className="text-sm font-medium">Estado:</span>
          {isActive ? (
            <Badge variant="success">Suscripción Activa</Badge>
          ) : (
            <Badge variant="danger">Sin Suscripción</Badge>
          )}
        </div>
      </header>

      {!hasKey && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 p-4 rounded-md flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Falta API Key de Gemini</p>
            <p>Configura tu API Key de Gemini en <Link href="/configuracion" className="underline font-medium hover:text-yellow-400">Configuración</Link> para usar el Radar.</p>
          </div>
        </div>
      )}

      {/* League selector */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Ligas a escanear</span>
          </div>
          <div className="flex items-center gap-2">
            {selectedLeagues.length > 0 && (
              <Badge variant="default">{selectedLeagues.length} seleccionada{selectedLeagues.length !== 1 ? "s" : ""}</Badge>
            )}
            <button
              onClick={() => setSelectedLeagues([])}
              className={`text-xs transition-colors ${selectedLeagues.length > 0 ? "text-primary hover:text-primary/80 cursor-pointer" : "text-muted-foreground/40 cursor-default"}`}
              disabled={selectedLeagues.length === 0}
            >
              Todas
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_LEAGUES.map(league => {
            const active = selectedLeagues.includes(league.label);
            return (
              <button
                key={league.id}
                onClick={() => toggleLeague(league.label)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 ${
                  active
                    ? "bg-primary/20 border-primary/60 text-primary"
                    : "bg-secondary border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span>{league.flag}</span>
                <span>{league.label}</span>
                {active && <Check className="w-3 h-3 ml-0.5" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedLeagues.length === 0
            ? "Sin selección: Gemini buscará en todas las ligas relevantes del día."
            : `El radar buscará partidos solo en: ${selectedLeagues.join(", ")}.`}
        </p>
      </div>

      <div className="relative rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-8 flex flex-col items-center justify-center min-h-[260px] text-center relative z-20">
          
          <button
            onClick={handleRadarScan}
            disabled={!isActive || !hasKey || radarMutation.isPending}
            className={`relative group flex flex-col items-center justify-center w-40 h-40 rounded-full transition-all duration-500 ${
              radarMutation.isPending ? "bg-primary/20 scale-105" : 
              (!isActive || !hasKey) ? "bg-muted cursor-not-allowed opacity-50" : 
              "bg-primary/10 hover:bg-primary/20 hover:scale-105 cursor-pointer border border-primary/30"
            }`}
          >
            {radarMutation.isPending && <div className="radar-sweep" />}
            <Radar className={`w-12 h-12 mb-2 ${radarMutation.isPending ? "text-primary animate-pulse" : "text-primary group-hover:text-primary"}`} />
            <span className="font-bold tracking-widest uppercase text-xs text-primary">
              {radarMutation.isPending ? "Buscando..." : "Desplegar Radar"}
            </span>
          </button>

          {!isActive && (
            <p className="mt-6 text-sm text-destructive font-medium">Suscripción requerida — Contacta al administrador</p>
          )}

        </div>
        
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none z-10" />
      </div>

      {radarMutation.isSuccess && radarMutation.data && (
        <div className="space-y-8 animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Target className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Objetivos Detectados</h2>
            <Badge className="ml-2">{radarMutation.data.reduce((acc, league) => acc + league.matches.length, 0)} Partidos</Badge>
          </div>

          {radarMutation.data.length === 0 ? (
            <p className="text-muted-foreground text-center py-12 bg-card rounded-md border border-border">No se encontraron partidos relevantes hoy.</p>
          ) : (
            radarMutation.data.map((league, idx) => (
              <div key={league.league} className={`space-y-4 stagger-${(idx % 5) + 1}`}>
                <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">{league.league}</h3>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {league.matches.map(match => (
                    <MatchCard key={match.id} match={match} leagueName={league.league} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, leagueName }: { match: Match, leagueName: string }) {
  const [expanded, setExpanded] = useState(false);
  const analyzeMutation = useAnalyzeMatch();

  const handleAnalyze = () => {
    if (!expanded && !analyzeMutation.data && !analyzeMutation.isPending) {
      analyzeMutation.mutate({
        data: {
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league: leagueName,
          kickoffTime: match.kickoffTime
        }
      });
    }
    setExpanded(!expanded);
  };

  const isAnalyzing = analyzeMutation.isPending;
  const analysis = analyzeMutation.data;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col transition-all duration-300 hover:border-primary/50">
      <div className="p-4 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-primary px-2 py-0.5 bg-primary/10 rounded-sm">
              {new Date(match.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {match.stadium && <span className="text-xs text-muted-foreground truncate">{match.stadium}</span>}
          </div>
          <div className="flex flex-col mt-2">
            <span className="text-lg font-bold text-foreground truncate">{match.homeTeam}</span>
            <span className="text-sm text-muted-foreground">vs</span>
            <span className="text-lg font-bold text-foreground truncate">{match.awayTeam}</span>
          </div>
        </div>
        
        <div className="ml-4 flex flex-col items-end justify-center">
          <button 
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors border border-border"
          >
            {isAnalyzing ? (
              <><Loader2 className="w-4 h-4 animate-spin text-primary" /> Analizando</>
            ) : analysis ? (
              <><ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} /> {expanded ? "Ocultar" : "Ver Análisis"}</>
            ) : (
              <><Target className="w-4 h-4 text-primary" /> Analizar</>
            )}
          </button>
        </div>
      </div>

      {expanded && (isAnalyzing || analysis) && (
        <div className="border-t border-border bg-black/20 p-4 animate-in slide-in-from-top-2 duration-300">
          {isAnalyzing && (
            <div className="space-y-3">
              <div className="h-4 bg-muted animate-pulse rounded w-3/4"></div>
              <div className="h-4 bg-muted animate-pulse rounded w-1/2"></div>
              <div className="h-4 bg-muted animate-pulse rounded w-full"></div>
            </div>
          )}
          
          {analysis && !isAnalyzing && (
            <div className="space-y-6">
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
      )}
    </div>
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
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-card border border-border rounded-xl shadow-2xl z-50 p-6 animate-in fade-in zoom-in-95 duration-200">
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
            type="number" 
            step="0.01" 
            value={odds} 
            onChange={e => setOdds(e.target.value)}
            className="w-full bg-background border border-border px-3 py-2 rounded text-sm text-primary font-bold focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monto (€)</label>
          <input 
            type="number" 
            step="1" 
            value={stake} 
            onChange={e => setStake(e.target.value)}
            className="w-full bg-background border border-border px-3 py-2 rounded text-sm font-bold focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notas (Opcional)</label>
        <input 
          type="text" 
          value={notes} 
          onChange={e => setNotes(e.target.value)}
          placeholder="Ej: Stake bajo, mercado volatil..."
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