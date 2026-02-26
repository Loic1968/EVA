import { useState } from 'react';
import AboutHero from '../components/AboutHero';

const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';

const content = {
  fr: {
    title: 'À propos d\'EVA',
    tagline: 'Votre jumeau numérique IA — direct, efficace, toujours à l\'écoute.',
    hero: {
      title: 'Qu\'est-ce qu\'EVA ?',
      text: 'EVA (Executive Virtual Assistant) est votre assistant IA personnel conçu comme un jumeau numérique. Elle apprend de vos documents, emails et conversations, mémorise vos préférences, et vous assiste en chat ou à la voix en temps réel. Développée par HaliSoft dans le contexte du financement commercial et du factoring.',
    },
    capabilities: [
      { icon: '◉', title: 'Memory Vault', desc: 'Archivage et indexation de vos documents, emails et calendrier. EVA peut chercher, résumer et citer.' },
      { icon: '🎤', title: 'Voice + Shadow', desc: 'Discussions vocales en temps réel et observation passive pour mieux comprendre votre contexte.' },
      { icon: '◇', title: 'Limited Proxy (P3)', desc: 'Rédige des brouillons (emails, messages) — vous validez avant envoi. Approuve-avant-envoi.' },
      { icon: '◆', title: 'Fine-Tuned Model (P4)', desc: 'Adapte son ton et style à votre profil de communication. Votre voix, votre style.' },
      { icon: '◈', title: 'Autonomous Proxy (P5)', desc: 'Délégation complète — EVA peut agir sans validation à chaque étape (mode autonome).' },
    ],
    phases: {
      title: 'Les phases EVA',
      p1: 'Memory Vault — Archive & indexation',
      p2: 'Voice + Shadow — Voix temps réel + observation',
      p3: 'Limited Proxy — Approuve-avant-envoi',
      p4: 'Fine-Tuned Model — Votre voix, votre style',
      p5: 'Autonomous Proxy — Délégation complète',
    },
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'EVA mémorise-t-elle nos discussions ?',
        a: 'Oui. EVA garde l\'historique de chaque conversation et apprend automatiquement : préférences, corrections, faits que vous partagez ("je suis Marie", "né à Lille"). Elle utilise aussi vos documents et emails (Memory Vault) pour répondre.',
      },
      {
        q: 'Comment EVA apprend-elle ?',
        a: 'En temps réel : quand vous dites "je préfère X" ou "note que Y", elle sauvegarde. Après chaque échange, un processus extrait faits et préférences pour les stocker. Vos retours (pouces bas, corrections) l\'aident à éviter les erreurs.',
      },
      {
        q: 'Qu\'est-ce que le Memory Vault ?',
        a: 'Votre base de connaissances : documents uploadés, emails (Gmail), événements calendrier. EVA les indexe et peut chercher, résumer et citer pour répondre à vos questions.',
      },
      {
        q: 'Mode autonome (P5) — c\'est quoi ?',
        a: 'Quand activé dans Paramètres, EVA peut exécuter des actions (brouillons, calendrier) sans demander validation à chaque fois. Par défaut, elle propose et vous approuvez avant envoi (P3).',
      },
      {
        q: 'EVA parle-t-elle français et anglais ?',
        a: 'Oui. Elle s\'adapte à la langue de vos messages et peut répondre en français ou en anglais selon votre préférence.',
      },
      {
        q: 'Où sont stockées mes données ?',
        a: 'Vos conversations, documents et préférences sont stockés sur nos serveurs sécurisés. Vous restez propriétaire de vos données. Consultez la politique de confidentialité pour plus de détails.',
      },
    ],
  },
  en: {
    title: 'About EVA',
    tagline: 'Your AI Digital Twin — direct, efficient, always listening.',
    hero: {
      title: 'What is EVA?',
      text: 'EVA (Executive Virtual Assistant) is your personal AI assistant designed as a digital twin. She learns from your documents, emails, and conversations, remembers your preferences, and assists you via chat or real-time voice. Built by HaliSoft in the context of trade finance and invoice factoring.',
    },
    capabilities: [
      { icon: '◉', title: 'Memory Vault', desc: 'Archive and index your documents, emails, and calendar. EVA can search, summarize, and cite.' },
      { icon: '🎤', title: 'Voice + Shadow', desc: 'Real-time voice conversations and passive observation to better understand your context.' },
      { icon: '◇', title: 'Limited Proxy (P3)', desc: 'Drafts emails and messages — you approve before sending. Approve-before-send.' },
      { icon: '◆', title: 'Fine-Tuned Model (P4)', desc: 'Adapts tone and style to your communication profile. Your voice, your style.' },
      { icon: '◈', title: 'Autonomous Proxy (P5)', desc: 'Full delegation — EVA can act without approval at each step (autonomous mode).' },
    ],
    phases: {
      title: 'EVA Phases',
      p1: 'Memory Vault — Archive & indexing',
      p2: 'Voice + Shadow — Real-time voice + observation',
      p3: 'Limited Proxy — Approve-before-send',
      p4: 'Fine-Tuned Model — Your voice, your style',
      p5: 'Autonomous Proxy — Full delegation',
    },
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'Does EVA remember our conversations?',
        a: 'Yes. EVA keeps the history of each conversation and learns automatically: preferences, corrections, and facts you share ("I\'m Marie", "born in Lille"). She also uses your documents and emails (Memory Vault) to answer.',
      },
      {
        q: 'How does EVA learn?',
        a: 'In real time: when you say "I prefer X" or "note that Y", she saves it. After each exchange, a process extracts facts and preferences for storage. Your feedback (thumbs down, corrections) helps her avoid mistakes.',
      },
      {
        q: 'What is the Memory Vault?',
        a: 'Your knowledge base: uploaded documents, emails (Gmail), calendar events. EVA indexes them and can search, summarize, and cite to answer your questions.',
      },
      {
        q: 'Autonomous mode (P5) — what is it?',
        a: 'When enabled in Settings, EVA can execute actions (drafts, calendar) without asking for approval each time. By default, she proposes and you approve before sending (P3).',
      },
      {
        q: 'Does EVA speak French and English?',
        a: 'Yes. She adapts to the language of your messages and can reply in French or English according to your preference.',
      },
      {
        q: 'Where is my data stored?',
        a: 'Your conversations, documents, and preferences are stored on our secure servers. You remain the owner of your data. See the privacy policy for more details.',
      },
    ],
  },
};

export default function About() {
  const [openFaq, setOpenFaq] = useState(null);
  const c = content[lang];

  return (
    <div className="space-y-10 max-w-3xl">
      <AboutHero title={c.title} tagline={c.tagline} />

      {/* What is EVA */}
      <section className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">{c.hero.title}</h2>
        <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">{c.hero.text}</p>
      </section>

      {/* Capabilities */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
          {lang === 'fr' ? 'Capacités' : 'Capabilities'}
        </h2>
        <div className="space-y-3">
          {c.capabilities.map((cap, i) => (
            <div
              key={i}
              className="flex gap-4 p-4 rounded-xl bg-white dark:bg-eva-panel border border-slate-200 dark:border-slate-700/40"
            >
              <span className="text-2xl shrink-0">{cap.icon}</span>
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white text-sm">{cap.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Phases */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">{c.phases.title}</h2>
        <div className="space-y-2">
          {[
            { phase: 'P1', label: c.phases.p1 },
            { phase: 'P2', label: c.phases.p2 },
            { phase: 'P3', label: c.phases.p3 },
            { phase: 'P4', label: c.phases.p4 },
            { phase: 'P5', label: c.phases.p5 },
          ].map(({ phase, label }) => (
            <div key={phase} className="flex gap-3 items-center text-sm">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 w-8 shrink-0">
                {phase}
              </span>
              <span className="text-slate-600 dark:text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">{c.faqTitle}</h2>
        <div className="space-y-2">
          {c.faq.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 dark:border-slate-700/40 overflow-hidden bg-white dark:bg-eva-panel"
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left text-sm font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
              >
                <span>{item.q}</span>
                <span className="text-slate-500 shrink-0 text-lg">{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && (
                <div className="px-4 pb-3 pt-0 text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <section className="text-center pt-4 pb-8">
        <p className="text-slate-500 dark:text-slate-500 text-xs">
          EVA — Executive Virtual Assistant • HaliSoft • Trade Finance & Invoice Factoring
        </p>
      </section>
    </div>
  );
}
