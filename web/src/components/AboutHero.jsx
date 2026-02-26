/**
 * Hero component for About page — EVA branding, gradient, tagline.
 */
import EvaLogo from './EvaLogo';

export default function AboutHero({ title, tagline }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 to-red-700 dark:from-red-600 dark:to-red-800 text-white shadow-xl shadow-red-500/25 dark:shadow-red-900/30">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />
      {/* Soft glow accent */}
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-red-400/20 blur-2xl" />

      <div className="relative px-6 py-12 sm:px-10 sm:py-16 text-center">
        {/* EVA logo by HaliSoft */}
        <div className="mx-auto mb-6 flex justify-center">
          <div className="flex flex-col items-center gap-1">
            <EvaLogo size="lg" variant="icon" />
            <span className="text-xs text-red-100 font-medium">by HaliSoft</span>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-xl mx-auto text-red-50 text-sm sm:text-base leading-relaxed">
          {tagline}
        </p>

        {/* Decorative line */}
        <div className="mt-8 mx-auto h-px w-24 rounded-full bg-white/30" />
      </div>
    </section>
  );
}
