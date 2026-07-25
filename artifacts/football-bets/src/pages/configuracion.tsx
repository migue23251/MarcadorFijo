import { useState, useEffect, useRef } from "react";
import { 
  useGetMe, 
  getGetMeQueryKey, 
  useUpdateMe,
  useGetGeminiKeyStatus, 
  getGetGeminiKeyStatusQueryKey,
  useSaveGeminiKey,
  useDeleteGeminiKey,
  useGetGeminiModel,
  getGetGeminiModelQueryKey,
  useSaveGeminiModel,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Key, User, ShieldCheck, Check, Loader2, Trash2, Cpu } from "lucide-react";

const GEMINI_MODELS = [
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    description: "Rápido y eficiente. Recomendado para uso diario.",
    badge: "Recomendado",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Mayor capacidad de razonamiento con buena velocidad.",
    badge: "Nuevo",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Máxima inteligencia para análisis complejos. Más lento.",
    badge: "Pro",
  },
  {
    id: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    description: "Modelo Pro de generación anterior. Alta calidad.",
    badge: null,
  },
  {
    id: "gemini-1.5-flash",
    label: "Gemini 1.5 Flash",
    description: "Flash de generación anterior. Muy económico.",
    badge: null,
  },
];

export default function Configuracion() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: keyStatus } = useGetGeminiKeyStatus({ query: { queryKey: getGetGeminiKeyStatusQueryKey() } });
  const { data: modelConfig } = useGetGeminiModel({ query: { queryKey: getGetGeminiModelQueryKey() } });

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">Gestiona tus credenciales y perfil operativo.</p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Gemini API Key Section */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">API Key de Gemini</h2>
              <p className="text-sm text-muted-foreground">Requerida para el motor de análisis del Radar.</p>
            </div>
          </div>
          <div className="p-6">
            <GeminiKeyForm hasKey={keyStatus?.hasKey} />
          </div>
        </section>

        {/* Gemini Model Section */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-md">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Modelo de IA</h2>
              <p className="text-sm text-muted-foreground">Selecciona el modelo de Gemini para el Radar y los análisis.</p>
            </div>
          </div>
          <div className="p-6">
            <GeminiModelSelector currentModel={modelConfig?.model} queryClient={queryClient} toast={toast} />
          </div>
        </section>

        {/* Subscription Status */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-md">
              <ShieldCheck className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Estado de Suscripción</h2>
              <p className="text-sm text-muted-foreground">Acceso a la plataforma.</p>
            </div>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Estado actual:</span>
              {me?.activeSubscription ? (
                <span className="px-3 py-1 bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded-full text-sm font-bold flex items-center gap-2">
                  <Check className="w-4 h-4" /> Activa
                </span>
              ) : (
                <span className="px-3 py-1 bg-red-500/20 text-red-500 border border-red-500/30 rounded-full text-sm font-bold">
                  Inactiva
                </span>
              )}
            </div>
            {me?.subscriptionExpiresAt && (
              <div className="text-sm">
                <span className="font-medium">Expira el: </span> 
                {new Date(me.subscriptionExpiresAt).toLocaleDateString()}
              </div>
            )}
            {!me?.activeSubscription && (
              <p className="text-sm text-muted-foreground bg-secondary p-3 rounded-md border border-border">
                Para activar tu suscripción, contacta al administrador del sistema.
              </p>
            )}
          </div>
        </section>

        {/* Profile Section */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/20 flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-md">
              <User className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Mi Perfil</h2>
              <p className="text-sm text-muted-foreground">Datos de operador.</p>
            </div>
          </div>
          <div className="p-6">
            <ProfileForm email={user?.primaryEmailAddress?.emailAddress} currentName={me?.name} />
          </div>
        </section>

      </div>
    </div>
  );
}

function GeminiModelSelector({ currentModel, queryClient, toast }: {
  currentModel?: string;
  queryClient: ReturnType<typeof import("@tanstack/react-query").useQueryClient>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const saveModel = useSaveGeminiModel();
  const [selected, setSelected] = useState(currentModel ?? "gemini-2.0-flash");

  useEffect(() => {
    if (currentModel) setSelected(currentModel);
  }, [currentModel]);

  const handleSave = () => {
    saveModel.mutate({ data: { model: selected } }, {
      onSuccess: () => {
        toast({ title: "Modelo actualizado", description: `Ahora usas ${selected}.` });
        queryClient.invalidateQueries({ queryKey: getGetGeminiModelQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "No se pudo guardar el modelo.", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {GEMINI_MODELS.map(m => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            className={`text-left p-4 rounded-lg border transition-all duration-150 ${
              selected === m.id
                ? "border-primary/60 bg-primary/10"
                : "border-border bg-secondary/30 hover:border-primary/30"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-sm font-semibold ${selected === m.id ? "text-primary" : "text-foreground"}`}>
                {m.label}
              </span>
              <div className="flex items-center gap-2">
                {m.badge && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                    {m.badge}
                  </span>
                )}
                {selected === m.id && <Check className="w-4 h-4 text-primary shrink-0" />}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{m.description}</p>
          </button>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saveModel.isPending || selected === currentModel}
        className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {saveModel.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Guardar modelo
      </button>
    </div>
  );
}

function GeminiKeyForm({ hasKey }: { hasKey?: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const saveKey = useSaveGeminiKey();
  const deleteKey = useDeleteGeminiKey();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    saveKey.mutate({ data: { apiKey } }, {
      onSuccess: () => {
        toast({ title: "API Key guardada", description: "El motor de análisis está listo." });
        setApiKey("");
        queryClient.invalidateQueries({ queryKey: getGetGeminiKeyStatusQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "No se pudo guardar la clave.", variant: "destructive" })
    });
  };

  const handleDelete = () => {
    deleteKey.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "API Key eliminada" });
        queryClient.invalidateQueries({ queryKey: getGetGeminiKeyStatusQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-4">
      {hasKey && (
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-md mb-6">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-sm tracking-widest text-primary">••••••••••••••••</span>
          </div>
          <button 
            onClick={handleDelete}
            disabled={deleteKey.isPending}
            className="p-2 text-destructive hover:bg-destructive/10 rounded transition-colors"
            title="Eliminar Key"
          >
            {deleteKey.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="flex gap-3">
        <input 
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={hasKey ? "Actualizar API Key..." : "Ingresa tu Gemini API Key..."}
          className="flex-1 bg-background border border-border px-4 py-2 rounded-md text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
        />
        <button 
          type="submit" 
          disabled={!apiKey.trim() || saveKey.isPending}
          className="px-6 py-2 bg-secondary text-secondary-foreground font-semibold rounded-md hover:bg-secondary/80 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saveKey.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Guardar
        </button>
      </form>
      <p className="text-xs text-muted-foreground">La clave se almacena de forma segura y solo se usa para el análisis de partidos.</p>
    </div>
  );
}

function ProfileForm({ email, currentName }: { email?: string, currentName?: string | null }) {
  const [name, setName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();

  // Guard initial value sync
  const initRef = useRef(false);
  useEffect(() => {
    if (currentName && !initRef.current) {
      setName(currentName);
      initRef.current = true;
    }
  }, [currentName]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMe.mutate({ data: { name } }, {
      onSuccess: () => {
        toast({ title: "Perfil actualizado" });
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      }
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-md">
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email (Cuenta Clerk)</label>
        <div className="px-4 py-2 bg-secondary/50 border border-border rounded-md text-sm text-muted-foreground">
          {email || "Cargando..."}
        </div>
      </div>
      
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nombre de Operador</label>
        <input 
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
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