import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, Link, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import Home from '@/pages/home';
import Dashboard from '@/pages/dashboard';
import Historial from '@/pages/historial';
import Configuracion from '@/pages/configuracion';
import Admin from '@/pages/admin';
import NotFound from '@/pages/not-found';
import { Shell } from '@/components/layout/shell';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const rawClerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof rawClerkPubKey === "string" &&
  /^pk_(test|live)_[A-Za-z0-9_-]+$/.test(rawClerkPubKey);

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#22c55e",
    colorForeground: "#f0f6fc",
    colorMutedForeground: "#8b949e",
    colorDanger: "#f85149",
    colorBackground: "#0d1117",
    colorInput: "#161b22",
    colorInputForeground: "#f0f6fc",
    colorNeutral: "#30363d",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#161b22] border border-[#30363d] rounded-md w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#f0f6fc]",
    headerSubtitle: "text-[#8b949e]",
    socialButtonsBlockButtonText: "text-[#f0f6fc]",
    formFieldLabel: "text-[#f0f6fc]",
    footerActionLink: "text-[#22c55e] hover:text-[#22c55e]/80",
    footerActionText: "text-[#8b949e]",
    dividerText: "text-[#8b949e]",
    identityPreviewEditButton: "text-[#22c55e]",
    formFieldSuccessText: "text-[#22c55e]",
    alertText: "text-[#f0f6fc]",
    logoBox: "mb-6 flex justify-center",
    logoImage: "h-12",
    socialButtonsBlockButton: "border-[#30363d] bg-[#0d1117] hover:bg-[#21262d]",
    formButtonPrimary: "bg-[#22c55e] text-[#0d1117] hover:bg-[#22c55e]/90 font-semibold",
    formFieldInput: "bg-[#0d1117] border-[#30363d] text-[#f0f6fc]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#30363d]",
    alert: "bg-[#21262d] border-[#30363d]",
    otpCodeFieldInput: "bg-[#0d1117] border-[#30363d]",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function SignInPage() {
  return (
    <div className="flex h-[100dvh] overflow-y-auto items-center justify-center bg-background px-4 py-8">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex h-[100dvh] overflow-y-auto items-center justify-center bg-background px-4 py-8">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function AuthUnavailablePage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-2xl">
        <img
          src={`${basePath}/logo.svg`}
          alt="MarcadorFijo"
          className="mx-auto mb-5 h-12 w-12"
        />
        <h1 className="text-2xl font-bold">
          {isSignUp ? "Registro temporalmente no disponible" : "Acceso temporalmente no disponible"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          La autenticación de MarcadorFijo todavía no está configurada en este entorno.
          {isSignUp
            ? " El registro se habilitará cuando se configure una clave válida de Clerk."
            : " El acceso se habilitará cuando se configure una clave válida de Clerk."}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Shell>
          <Component />
        </Shell>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/historial" component={() => <ProtectedRoute component={Historial} />} />
      <Route path="/configuracion" component={() => <ProtectedRoute component={Configuracion} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Acceso MarcadorFijo",
            subtitle: "Inicia sesión en tu terminal",
          },
        },
        signUp: {
          start: {
            title: "Crear terminal",
            subtitle: "Regístrate en MarcadorFijo",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  if (!hasUsableClerkKey) {
    return (
      <WouterRouter base={basePath}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/sign-in/*?" component={() => <AuthUnavailablePage mode="sign-in" />} />
          <Route path="/sign-up/*?" component={() => <AuthUnavailablePage mode="sign-up" />} />
          <Route component={Home} />
        </Switch>
      </WouterRouter>
    );
  }

  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;