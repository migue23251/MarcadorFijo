import { Link } from "wouter";
import { Radar, Target, TrendingUp, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function Home() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col selection:bg-primary/30">
      <header className="fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-4 md:px-8 border-b border-border bg-background/80 backdrop-blur-md z-50">
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

      <main className="flex-1 flex flex-col pt-16">
        {/* Hero Section */}
        <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-20 text-center border-b border-border overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.15)_0%,transparent_70%)] pointer-events-none" />
          
          <div className="relative z-10 max-w-3xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Inteligencia para Apuestas
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
              El radar de los <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">apostadores serios.</span>
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

        {/* Features Section */}
        <section className="py-24 px-4 bg-background">
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
      </main>

      <footer className="border-t border-border py-8 px-4 bg-card">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 opacity-50">
            <img src={`${basePath}/logo.svg`} alt="MarcadorFijo" className="w-5 h-5 grayscale" />
            <span className="text-sm font-semibold tracking-tight">MarcadorFijo</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} MarcadorFijo. Para uso exclusivo de profesionales.
          </p>
        </div>
      </footer>
    </div>
  );
}