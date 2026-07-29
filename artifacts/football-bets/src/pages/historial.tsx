import { useState } from "react";
import { createPortal } from "react-dom";
import {
  useListBets,
  getListBetsQueryKey,
  useGetBetStats,
  getGetBetStatsQueryKey,
  useUpdateBet,
  useGetCachedAnalysis,
  useGetMe,
  getGetMeQueryKey,
  ListBetsStatus,
  Bet,
  BetFinalStats,
  MatchAnalysis,
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/currency";
import {
  Check,
  X,
  Clock,
  TrendingUp,
  Percent,
  Hash,
  Target,
  History,
  ScanSearch,
  AlertCircle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const PAGE_SIZE = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable final result label based on the market type.
 * finalScore is always stored as "home-away" goals (e.g. "2-1").
 * finalStats contains corners/cards when available (corner or card markets).
 */
function getFinalResultLabel(
  market: string,
  finalScore: string | null | undefined,
  finalStats?: BetFinalStats | null,
): string | null {
  if (!finalScore || finalScore === "—") return null;

  const m = market.toLowerCase();

  const parts = finalScore.split("-");
  if (parts.length !== 2) return finalScore;
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away)) return finalScore;

  // Córners — usar finalStats si están disponibles
  if (m.includes("córner") || m.includes("corner") || m.includes("esquina")) {
    if (finalStats && finalStats.totalCorners !== undefined) {
      return `${finalStats.homeCorners}–${finalStats.awayCorners} córners (${finalStats.totalCorners} total) · Goles ${home}–${away}`;
    }
    return `Goles: ${home}–${away}`;
  }

  // Tarjetas — usar finalStats si están disponibles
  if (
    m.includes("tarjeta") || m.includes("card") ||
    m.includes("amarilla") || m.includes("roja") || m.includes("booking")
  ) {
    if (finalStats && finalStats.totalCards !== undefined) {
      const parts: string[] = [];
      if (finalStats.totalCards !== undefined)
        parts.push(`${finalStats.totalCards} tarjetas`);
      if ((finalStats.homeYellowCards ?? 0) + (finalStats.awayYellowCards ?? 0) > 0)
        parts.push(`🟨 ${(finalStats.homeYellowCards ?? 0) + (finalStats.awayYellowCards ?? 0)}`);
      if ((finalStats.homeRedCards ?? 0) + (finalStats.awayRedCards ?? 0) > 0)
        parts.push(`🟥 ${(finalStats.homeRedCards ?? 0) + (finalStats.awayRedCards ?? 0)}`);
      return `${parts.join(" · ")} · Goles ${home}–${away}`;
    }
    return `Goles: ${home}–${away}`;
  }

  // Over / Under goles → mostrar total de goles
  if (
    m.includes("over") || m.includes("under") ||
    m.includes("más") || m.includes("menos") ||
    m.includes("total gol") || m.includes("goles")
  ) {
    const total = home + away;
    return `${total} ${total === 1 ? "gol" : "goles"} (${home}–${away})`;
  }

  // BTTS / Ambos Anotan
  if (
    m.includes("btts") || m.includes("ambos") ||
    m.includes("both teams") || m.includes("anotan") || m.includes("gg/ng")
  ) {
    const bothScored = home > 0 && away > 0;
    return bothScored
      ? `Ambos anotaron (${home}–${away})`
      : `No anotaron ambos (${home}–${away})`;
  }

  // 1X2, hándicap asiático/europeo y cualquier otro → mostrar score
  return `${home}–${away}`;
}

export default function Historial() {
  const [statusFilter, setStatusFilter] = useState<ListBetsStatus | undefined>(undefined);
  const [page, setPage] = useState(1);

  // Reset to page 1 when filter changes
  const handleFilterChange = (f: ListBetsStatus | undefined) => {
    setStatusFilter(f);
    setPage(1);
  };

  const { data: stats } = useGetBetStats({ query: { queryKey: getGetBetStatsQueryKey() } });
  const { data: paged, isLoading } = useListBets(
    { status: statusFilter, page, limit: PAGE_SIZE },
    { query: { queryKey: getListBetsQueryKey({ status: statusFilter, page, limit: PAGE_SIZE }) } },
  );
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const currency = me?.currency ?? "COP";

  const bets = paged?.data ?? [];
  const totalPages = paged?.totalPages ?? 1;
  const total = paged?.total ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Historial Operativo</h1>
        <p className="text-muted-foreground">Registro de todas tus operaciones y rendimiento.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Total Apuestas"
          value={stats?.totalBets.toString() || "0"}
          icon={<Hash className="w-5 h-5 text-muted-foreground" />}
        />
        <StatCard
          title="Tasa de Acierto"
          value={`${stats?.winRate.toFixed(1) || "0.0"}%`}
          icon={<Target className="w-5 h-5 text-primary" />}
          trend={stats?.winRate && stats.winRate > 50 ? "up" : "down"}
        />
        <StatCard
          title="ROI"
          value={`${stats?.roi.toFixed(1) || "0.0"}%`}
          icon={<Percent className="w-5 h-5 text-emerald-500" />}
          trend={stats?.roi && stats.roi > 0 ? "up" : "down"}
        />
        <StatCard
          title="Ganadas / Perdidas"
          value={`${stats?.wonBets || 0} / ${stats?.lostBets || 0}`}
          icon={<TrendingUp className="w-5 h-5 text-muted-foreground" />}
        />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col min-h-[500px]">
        {/* Filters */}
        <div className="p-4 border-b border-border flex flex-wrap gap-2">
          <FilterButton active={statusFilter === undefined} onClick={() => handleFilterChange(undefined)}>Todas</FilterButton>
          <FilterButton active={statusFilter === "pending"} onClick={() => handleFilterChange("pending")}>Pendientes</FilterButton>
          <FilterButton active={statusFilter === "won"} onClick={() => handleFilterChange("won")}>Ganadas</FilterButton>
          <FilterButton active={statusFilter === "lost"} onClick={() => handleFilterChange("lost")}>Perdidas</FilterButton>
          <FilterButton active={statusFilter === "void"} onClick={() => handleFilterChange("void")}>Anuladas</FilterButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              Cargando historial...
            </div>
          ) : !bets || bets.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center h-full">
              <History className="w-12 h-12 text-muted-foreground opacity-50 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Sin operaciones</h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                Aún no has registrado ninguna apuesta en este estado. Usa el Radar para encontrar oportunidades.
              </p>
              <Link href="/dashboard" className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors">
                Ir al Radar
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Fecha/Partido</th>
                      <th className="px-4 py-3 font-semibold">Mercado/Selección</th>
                      <th className="px-4 py-3 font-semibold">Resultado</th>
                      <th className="px-4 py-3 font-semibold text-right">Cuota</th>
                      <th className="px-4 py-3 font-semibold text-right">Monto</th>
                      <th className="px-4 py-3 font-semibold text-center">Estado</th>
                      <th className="px-4 py-3 font-semibold text-right">Retorno</th>
                      <th className="px-4 py-3 font-semibold text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bets.map((bet) => (
                      <BetRow key={bet.id} bet={bet} currency={currency} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border">
                {bets.map((bet) => (
                  <BetCard key={bet.id} bet={bet} currency={currency} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
                  <span className="text-xs text-muted-foreground">
                    {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Primera página"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Página anterior"
                    >
                      ‹
                    </button>
                    <span className="px-3 py-1 text-xs font-semibold bg-primary/10 text-primary border border-primary/30 rounded">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Página siguiente"
                    >
                      ›
                    </button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Última página"
                    >
                      »
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  title,
  value,
  icon,
  trend,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: "up" | "down";
}) {
  return (
    <div className="bg-card border border-border p-4 sm:p-5 rounded-lg flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        {icon}
      </div>
      <div className="flex items-end gap-2">
        <span
          className={`text-2xl font-bold ${
            trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-foreground"
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Desktop BetRow (table row)
// ---------------------------------------------------------------------------

function BetRow({ bet, currency }: { bet: Bet; currency: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateBet = useUpdateBet();
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleStatusUpdate = (status: "won" | "lost") => {
    const returnAmount = status === "won" ? bet.stake * bet.odds : 0;
    updateBet.mutate(
      { betId: bet.id, data: { status, returnAmount } },
      {
        onSuccess: () => {
          toast({ title: "Apuesta actualizada" });
          queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
          queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        },
      },
    );
  };

  const statusColors = {
    pending: "bg-secondary text-muted-foreground border-border",
    won: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
    lost: "bg-red-500/20 text-red-500 border-red-500/30",
    void: "bg-amber-500/20 text-amber-500 border-amber-500/30",
  };

  const statusIcons = {
    pending: <Clock className="w-3 h-3 mr-1 inline" />,
    won: <Check className="w-3 h-3 mr-1 inline" />,
    lost: <X className="w-3 h-3 mr-1 inline" />,
    void: <AlertCircle className="w-3 h-3 mr-1 inline" />,
  };

  const rowColors = {
    pending: "",
    won: "bg-emerald-500/5",
    lost: "bg-red-500/5",
    void: "bg-amber-500/5",
  };

  const formattedDate = new Date(bet.kickoffTime).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <tr className={`hover:bg-secondary/20 transition-colors ${rowColors[bet.status]}`}>
        <td className="px-4 py-3">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground text-sm">
              {bet.homeTeam} vs {bet.awayTeam}
            </span>
            <span className="text-xs text-muted-foreground">
              {bet.league} • {formattedDate}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground text-sm">{bet.selection}</span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{bet.market}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          {bet.status !== "pending" ? (() => {
            const label = getFinalResultLabel(bet.market, bet.finalScore, bet.finalStats);
            return label ? (
              <span className="text-xs font-semibold text-foreground bg-secondary px-2 py-1 rounded">
                {label}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
          })() : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-sm">
            {bet.odds.toFixed(2)}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-medium text-foreground">{formatCurrency(bet.stake, currency)}</td>
        <td className="px-4 py-3 text-center">
          <span
            className={`px-2 py-1 text-xs font-semibold rounded-full border inline-flex items-center ${statusColors[bet.status]}`}
          >
            {statusIcons[bet.status]}
            {bet.status === "pending"
              ? "Pendiente"
              : bet.status === "won"
                ? "Ganada"
                : bet.status === "lost"
                  ? "Perdida"
                  : "Anulada"}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-bold">
          {bet.status === "won" ? (
            <span className="text-emerald-500">+{formatCurrency(bet.returnAmount ?? 0, currency)}</span>
          ) : bet.status === "lost" ? (
            <span className="text-red-500">-{formatCurrency(bet.stake, currency)}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setShowAnalysis(true)}
              className="p-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded border border-primary/30 transition-colors"
              title="Ver análisis del partido"
            >
              <ScanSearch className="w-4 h-4" />
            </button>
            {bet.status !== "pending" && (
              <span className="text-xs text-muted-foreground">Resuelta</span>
            )}
          </div>
        </td>
      </tr>
      {showAnalysis && (
        <AnalysisModal
          homeTeam={bet.homeTeam}
          awayTeam={bet.awayTeam}
          league={bet.league}
          fixtureId={bet.fixtureId}
          userSelection={bet.selection}
          userMarket={bet.market}
          onClose={() => setShowAnalysis(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mobile BetCard
// ---------------------------------------------------------------------------

function BetCard({ bet, currency }: { bet: Bet; currency: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateBet = useUpdateBet();
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleStatusUpdate = (status: "won" | "lost") => {
    const returnAmount = status === "won" ? bet.stake * bet.odds : 0;
    updateBet.mutate(
      { betId: bet.id, data: { status, returnAmount } },
      {
        onSuccess: () => {
          toast({ title: "Apuesta actualizada" });
          queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
          queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
        },
      },
    );
  };

  const statusConfig = {
    pending: { label: "Pendiente", classes: "bg-secondary text-muted-foreground border-border", icon: <Clock className="w-3 h-3 inline mr-1" /> },
    won:     { label: "Ganada",    classes: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30", icon: <Check className="w-3 h-3 inline mr-1" /> },
    lost:    { label: "Perdida",   classes: "bg-red-500/20 text-red-500 border-red-500/30", icon: <X className="w-3 h-3 inline mr-1" /> },
    void:    { label: "Anulada",   classes: "bg-amber-500/20 text-amber-500 border-amber-500/30", icon: <AlertCircle className="w-3 h-3 inline mr-1" /> },
  };

  const rowBg = { pending: "", won: "bg-emerald-500/5", lost: "bg-red-500/5", void: "bg-amber-500/5" };

  const formattedDate = new Date(bet.kickoffTime).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div className={`p-4 space-y-3 ${rowBg[bet.status]}`}>
        {/* Match + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">
              {bet.homeTeam} vs {bet.awayTeam}
            </p>
            <p className="text-xs text-muted-foreground">{bet.league} · {formattedDate}</p>
          </div>
          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border flex items-center shrink-0 ${statusConfig[bet.status].classes}`}>
            {statusConfig[bet.status].icon}
            {statusConfig[bet.status].label}
          </span>
        </div>

        {/* Market + odds + stake */}
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{bet.market}</p>
            <p className="font-semibold text-sm text-foreground">{bet.selection}</p>
            {bet.status !== "pending" && (() => {
              const label = getFinalResultLabel(bet.market, bet.finalScore, bet.finalStats);
              return label ? (
                <p className="text-xs font-medium text-primary/80 mt-0.5">✦ {label}</p>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-sm">@{bet.odds.toFixed(2)}</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(bet.stake, currency)}</span>
          </div>
        </div>

        {/* Return + actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
          <div className="text-sm font-bold">
            {bet.status === "won" ? (
              <span className="text-emerald-500">+{formatCurrency(bet.returnAmount ?? 0, currency)}</span>
            ) : bet.status === "lost" ? (
              <span className="text-red-500">-{formatCurrency(bet.stake, currency)}</span>
            ) : (
              <span className="text-muted-foreground text-xs">Pendiente de resultado</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAnalysis(true)}
              className="p-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded border border-primary/30 transition-colors"
              title="Ver análisis"
            >
              <ScanSearch className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {showAnalysis && (
        <AnalysisModal
          homeTeam={bet.homeTeam}
          awayTeam={bet.awayTeam}
          league={bet.league}
          fixtureId={bet.fixtureId}
          userSelection={bet.selection}
          userMarket={bet.market}
          onClose={() => setShowAnalysis(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Analysis Modal — rendered via portal so it works inside and outside tables
// ---------------------------------------------------------------------------

function AnalysisModal({
  homeTeam,
  awayTeam,
  league,
  fixtureId,
  userSelection,
  userMarket,
  onClose,
}: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  fixtureId?: number | null;
  userSelection: string;
  userMarket: string;
  onClose: () => void;
}) {
  const params = { homeTeam, awayTeam, league, ...(fixtureId ? { fixtureId } : {}) };
  const { data, isLoading, isError, error } = useGetCachedAnalysis(
    params,
    { query: { retry: false, queryKey: ["/api/matches/cached-analysis", fixtureId ?? homeTeam, awayTeam, league] } },
  );

  const is404 = isError && (error as any)?.status === 404;

  const confidenceConfig = {
    high: { label: "Alta", classes: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
    medium: { label: "Media", classes: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    low: { label: "Baja", classes: "bg-red-500/20 text-red-400 border-red-500/30" },
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg flex flex-col bg-card border-l border-border shadow-2xl overflow-hidden animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border bg-secondary/30 shrink-0">
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">{league}</p>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {homeTeam} <span className="text-muted-foreground font-normal">vs</span> {awayTeam}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Tu apuesta: <span className="text-foreground font-medium">{userSelection}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span className="opacity-60">{userMarket}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <p className="text-sm">Buscando análisis en caché…</p>
            </div>
          ) : is404 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
              <AlertCircle className="w-10 h-10 text-muted-foreground opacity-50" />
              <p className="text-sm font-semibold text-foreground">Sin análisis disponible hoy</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Nadie ha analizado este partido hoy todavía. Ve al Radar, busca el partido y pulsa «Analizar» — el análisis quedará disponible para todos.
              </p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
              <ShieldAlert className="w-10 h-10 text-red-500 opacity-70" />
              <p className="text-sm font-semibold text-foreground">Error al cargar el análisis</p>
              <p className="text-xs text-muted-foreground">Inténtalo de nuevo más tarde.</p>
            </div>
          ) : data ? (
            <AnalysisContent
              analysis={data}
              userSelection={userSelection}
              userMarket={userMarket}
              confidenceConfig={confidenceConfig}
            />
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

function AnalysisContent({
  analysis,
  userSelection,
  userMarket,
  confidenceConfig,
}: {
  analysis: MatchAnalysis;
  userSelection: string;
  userMarket: string;
  confidenceConfig: Record<string, { label: string; classes: string }>;
}) {
  return (
    <>
      {/* Summary */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Resumen del partido
        </h3>
        <p className="text-sm text-foreground leading-relaxed bg-secondary/30 rounded-lg p-4 border border-border">
          {analysis.summary}
        </p>
      </section>

      {/* Predictions */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Value bets identificadas
        </h3>
        <div className="space-y-3">
          {analysis.predictions.map((pred) => {
            const conf = confidenceConfig[pred.confidence] ?? confidenceConfig.low;
            const isUserBet =
              pred.selection.toLowerCase().includes(userSelection.toLowerCase()) ||
              pred.market.toLowerCase().includes(userMarket.toLowerCase());

            return (
              <div
                key={pred.id}
                className={`rounded-lg border p-4 space-y-2 transition-colors ${
                  isUserBet
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-secondary/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{pred.market}</span>
                      {isUserBet && (
                        <span className="text-[10px] font-bold bg-primary/20 text-primary border border-primary/30 rounded px-1.5 py-0.5 uppercase tracking-wide">
                          Tu apuesta
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm text-foreground mt-0.5">{pred.selection}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-sm">
                      {typeof pred.odds === "number" ? pred.odds.toFixed(2) : pred.odds}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${conf.classes}`}>
                      {conf.label}
                    </span>
                  </div>
                </div>
                {pred.reasoning && (
                  <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-2">
                    {pred.reasoning}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
