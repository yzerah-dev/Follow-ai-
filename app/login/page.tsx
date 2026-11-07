import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { LoginForm } from "./login-form";
import { env } from "@/lib/env";

export const metadata = { title: "Connexion" };

export default async function LoginPage() {
  if (await getContext()) redirect("/");
  const demo = env().DEMO_TOOLS;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5">
            <div className="lea-gradient flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white">F</div>
            <span className="text-lg font-semibold tracking-tight">LÉA.AI</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Bon retour</h1>
          <p className="mt-1.5 text-sm text-subtle">Connectez-vous pour retrouver le travail préparé par LÉA.</p>
          <LoginForm />
          {demo ? (
            <div className="mt-8 rounded-lg border border-warning/20 bg-warning-soft p-3.5 text-[13px] text-warning">
              <p className="font-semibold">Environnement de démonstration</p>
              <p className="mt-1">
                alice@demo.follow.ai (propriétaire) · bruno@demo.follow.ai (commercial) · diane@demo.follow.ai (lecture seule) · chloe@demo.follow.ai (autre entreprise)
              </p>
              <p className="mt-1">
                Mot de passe : <code className="font-mono">demo-follow-ai</code>
              </p>
            </div>
          ) : null}
        </div>
      </section>
      <section className="relative hidden overflow-hidden bg-[#0f1222] lg:block">
        <div className="lea-gradient absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-40 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="text-[13px] font-medium uppercase tracking-widest text-indigo-300">Votre équipe commerciale augmentée</p>
          <p className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            LÉA analyse vos factures, prépare vos offres et vos messages. Vous validez, elle avance.
          </p>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-3 text-[13px] text-indigo-100/80">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">Réassorts détectés</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">Offres & supports</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">Relances maîtrisées</div>
          </div>
        </div>
      </section>
    </main>
  );
}
