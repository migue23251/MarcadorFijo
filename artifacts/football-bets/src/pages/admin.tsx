import { 
  useGetMe, 
  getGetMeQueryKey, 
  useListUsers, 
  getListUsersQueryKey,
  useUpdateUserSubscription,
  UserProfile
} from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, Loader2 } from "lucide-react";

export default function Admin() {
  const { data: me, isLoading: meLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  
  if (meLoading) return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (me?.role !== "admin") return <Redirect to="/dashboard" />;

  return <AdminPanel />;
}

function AdminPanel() {
  const { data: users, isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
          </div>
          <p className="text-muted-foreground">Gestión de usuarios y accesos.</p>
        </div>
        <div className="bg-card px-4 py-2 rounded-md border border-border flex items-center gap-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">{users?.length || 0} Operadores</span>
        </div>
      </header>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase tracking-wider bg-secondary/50 border-b border-border">
              <tr>
                <th className="px-6 py-4 font-semibold">Operador</th>
                <th className="px-6 py-4 font-semibold">Rol</th>
                <th className="px-6 py-4 font-semibold text-right">Suscripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                    Cargando usuarios...
                  </td>
                </tr>
              ) : !users || users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                    No hay usuarios registrados.
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <UserRow key={user.clerkId} user={user} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

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
    <tr className="hover:bg-secondary/20 transition-colors">
      <td className="px-6 py-4">
        <div className="flex flex-col">
          <span className="font-bold text-foreground">{user.name || "Sin nombre"}</span>
          <span className="text-xs text-muted-foreground font-mono mt-0.5">{user.email}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
          user.role === "admin" 
            ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" 
            : "bg-secondary text-muted-foreground border border-border"
        }`}>
          {user.role}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <button 
          onClick={handleToggle}
          disabled={isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 ${
            user.activeSubscription ? 'bg-emerald-500' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              user.activeSubscription ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </td>
    </tr>
  );
}