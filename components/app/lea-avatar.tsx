/**
 * Illustration de LÉA (personnage stylisé, ne représente aucune personne réelle).
 * Pour utiliser un visuel sous licence : déposer `public/lea.png` et passer `src="/lea.png"`.
 */
export function LeaAvatar({ size = 48, src, className }: { size?: number; src?: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="LÉA, votre commerciale IA" width={size} height={size} className={`rounded-full object-cover ${className ?? ""}`} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="LÉA, votre commerciale IA" className={className}>
      <defs>
        <linearGradient id="lea-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#efe7ff" />
          <stop offset="1" stopColor="#cdb8ff" />
        </linearGradient>
        <clipPath id="lea-clip">
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath="url(#lea-clip)">
        <rect width="120" height="120" fill="url(#lea-bg)" />
        {/* cheveux (arrière) */}
        <path d="M30 62c0-24 13-40 31-40s30 15 30 38c0 14-3 26-6 34H36c-4-9-6-19-6-32z" fill="#3b2a26" />
        {/* cou */}
        <path d="M52 80h16v14H52z" fill="#e8b49a" />
        {/* veste */}
        <path d="M18 120c2-18 14-28 30-31l12 16 12-16c16 3 28 13 30 31z" fill="#1f1b3a" />
        <path d="M48 89l12 16 12-16-4-3-8 9-8-9z" fill="#ffffff" />
        {/* visage */}
        <ellipse cx="60" cy="58" rx="19" ry="23" fill="#f1c4ab" />
        {/* mèche */}
        <path d="M40 54c3-17 14-25 27-24 9 1 14 7 15 14-9-1-21-4-29-12-2 9-7 16-13 22z" fill="#4a352f" />
        {/* yeux & sourire */}
        <ellipse cx="52.5" cy="59" rx="2.2" ry="2.6" fill="#2b1e1b" />
        <ellipse cx="67.5" cy="59" rx="2.2" ry="2.6" fill="#2b1e1b" />
        <path d="M53 69c4 4 10 4 14 0" stroke="#b5574d" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <ellipse cx="47" cy="66" rx="3.5" ry="2" fill="#f2a493" opacity=".55" />
        <ellipse cx="73" cy="66" rx="3.5" ry="2" fill="#f2a493" opacity=".55" />
      </g>
    </svg>
  );
}
