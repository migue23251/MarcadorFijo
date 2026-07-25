import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4 text-center px-4 max-w-md">
        <AlertCircle className="w-16 h-16 text-destructive" />
        <h1 className="text-4xl font-bold tracking-tighter text-foreground">404</h1>
        <p className="text-xl font-medium text-muted-foreground">Sistema no encontrado</p>
        <p className="text-sm text-muted-foreground mb-4">
          La ruta operativa que buscas no existe o está fuera de servicio.
        </p>
        <Link 
          href="/" 
          className="px-6 py-2 bg-primary text-primary-foreground font-semibold rounded hover:bg-primary/90 transition-colors"
        >
          Volver a la base
        </Link>
      </div>
    </div>
  );
}