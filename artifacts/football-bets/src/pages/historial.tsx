import { useState } from "react";
import { 
  useListBets, 
  getListBetsQueryKey, 
  useGetBetStats, 
  getGetBetStatsQueryKey,
  useUpdateBet,
  ListBetsStatus,
  Bet
} from "@workspace/api-client-react";
import { Check, X, Clock, TrendingUp, Percent, Hash, Target, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function Historial() {
  const [statusFilter, setStatusFilter] = useState<ListBetsStatus | undefined>(undefined);
  
  const { data: stats } = useGetBetStats({ query: { queryKey: getGetBetStatsQueryKey() } });
  const { data: bets, isLoading } = useListBets(
    { status: statusFilter }, 
    { query: { queryKey: getListBetsQueryKey({ status: statusFilter }) } }
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Historial Operativo</h1>
        <p className="text-muted-foreground">Registro de todas tus operaciones y rendimiento.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <FilterButton active={statusFilter === undefined} onClick={() => setStatusFilter(undefined)}>Todas</FilterButton>
          <FilterButton active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>Pendientes</FilterButton>
          <FilterButton active={statusFilter === "won"} onClick={() => setStatusFilter("won")}>Ganadas</FilterButton>
          <FilterButton active={statusFilter === "lost"} onClick={() => setStatusFilter("lost")}>Perdidas</FilterButton>
        </div>

        {/* Table/List */}
        <div className="flex-1 p-0 overflow-x-auto">
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
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha/Partido</th>
                  <th className="px-4 py-3 font-semibold">Mercado/Selección</th>
                  <th className="px-4 py-3 font-semibold text-right">Cuota</th>
                  <th className="px-4 py-3 font-semibold text-right">Monto</th>
                  <th className="px-4 py-3 font-semibold text-center">Estado</th>
                  <th className="px-4 py-3 font-semibold text-right">Retorno</th>
                  <th className="px-4 py-3 font-semibold text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bets.map(bet => (
                  <BetRow key={bet.id} bet={bet} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: { title: string, value: string, icon: React.ReactNode, trend?: "up" | "down" }) {
  return (
    <div className="bg-card border border-border p-5 rounded-lg flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        {icon}
      </div>
      <div className="flex items-end gap-2">
        <span className={`text-2xl font-bold ${trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-foreground"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
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

function BetRow({ bet }: { bet: Bet }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateBet = useUpdateBet();

  const handleStatusUpdate = (status: "won" | "lost") => {
    let returnAmount = 0;
    if (status === "won") {
      returnAmount = bet.stake * bet.odds;
    }

    updateBet.mutate({
      betId: bet.id,
      data: {
        status,
        returnAmount
      }
    }, {
      onSuccess: () => {
        toast({ title: "Apuesta actualizada" });
        // Invalidate both so lists and stats update
        queryClient.invalidateQueries({ queryKey: ["/api/bets"] }); // invalidate all bet lists
        queryClient.invalidateQueries({ queryKey: getGetBetStatsQueryKey() });
      }
    });
  };

  const statusColors = {
    pending: "bg-secondary text-muted-foreground border-border",
    won: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
    lost: "bg-red-500/20 text-red-500 border-red-500/30",
  };

  const statusIcons = {
    pending: <Clock className="w-3 h-3 mr-1 inline" />,
    won: <Check className="w-3 h-3 mr-1 inline" />,
    lost: <X className="w-3 h-3 mr-1 inline" />
  };

  const rowColors = {
    pending: "",
    won: "bg-emerald-500/5",
    lost: "bg-red-500/5"
  };

  const formattedDate = new Date(bet.kickoffTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <tr className={`hover:bg-secondary/20 transition-colors ${rowColors[bet.status]}`}>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-foreground text-sm">{bet.homeTeam} vs {bet.awayTeam}</span>
          <span className="text-xs text-muted-foreground">{bet.league} • {formattedDate}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-foreground text-sm">{bet.selection}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{bet.market}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-sm">{bet.odds.toFixed(2)}</span>
      </td>
      <td className="px-4 py-3 text-right font-medium text-foreground">
        €{bet.stake.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-center">
        <span className={`px-2 py-1 text-xs font-semibold rounded-full border inline-flex items-center ${statusColors[bet.status]}`}>
          {statusIcons[bet.status]}
          {bet.status === "pending" ? "Pendiente" : bet.status === "won" ? "Ganada" : "Perdida"}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-bold">
        {bet.status === "won" ? (
          <span className="text-emerald-500">+€{bet.returnAmount?.toFixed(2)}</span>
        ) : bet.status === "lost" ? (
          <span className="text-red-500">-€{bet.stake.toFixed(2)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {bet.status === "pending" ? (
          <div className="flex items-center justify-center gap-2">
            <button 
              onClick={() => handleStatusUpdate("won")}
              disabled={updateBet.isPending}
              className="p-1.5 bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 rounded border border-emerald-500/30 transition-colors"
              title="Marcar como Ganada"
            >
              <Check className="w-4 h-4" />
            </button>
            <button 
              onClick={() => handleStatusUpdate("lost")}
              disabled={updateBet.isPending}
              className="p-1.5 bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded border border-red-500/30 transition-colors"
              title="Marcar como Perdida"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Resuelta</span>
        )}
      </td>
    </tr>
  );
}

// Ensure the icon is imported for the empty state
import { History } from "lucide-react";