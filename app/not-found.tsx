import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-[13px] font-semibold text-primary">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page introuvable</h1>
      <p className="mt-1 text-sm text-subtle">Cette ressource n&apos;existe pas ou n&apos;est pas accessible avec votre compte.</p>
      <Link href="/" className="mt-4 text-sm font-medium text-primary hover:underline">
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
