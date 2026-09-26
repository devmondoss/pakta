"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

type IllustrationName = "evidence" | "review" | "release";

const cards: { title: string; copy: string; illustration: IllustrationName; tilt: number }[] = [
  { title: "Toda la evidencia,\nen un solo lugar", copy: "PO, invoice, receipt y proveedor unidos antes de decidir.", illustration: "evidence", tilt: -3 },
  { title: "Una política que\nsí se puede explicar", copy: "Las reglas determinísticas toman la decisión, no una corazonada.", illustration: "review", tilt: 2.1 },
  { title: "Un cierre que\ndeja rastro", copy: "El settlement y la conciliación quedan registrados al cerrar el ciclo.", illustration: "release", tilt: -2.4 },
];

function LineIllustration({ name }: { name: IllustrationName }) {
  const draw = { initial: { pathLength: 0, opacity: 0 }, whileInView: { pathLength: 1, opacity: 1 } };
  const transition = { duration: 0.72, ease: "easeOut" as const };

  if (name === "evidence") {
    return <svg className="landing-illustration" viewBox="0 0 180 130" fill="none" aria-hidden="true">
      <motion.path {...draw} transition={transition} viewport={{ once: true }} d="M57 16h48l16 16v76H57zM105 16v18h16M70 52h38M70 65h38M70 78h25" />
      <motion.path {...draw} transition={{ ...transition, delay: 0.18 }} viewport={{ once: true }} d="M38 97c4-16 20-25 36-20 11 3 18 12 20 23M36 102c13 3 25 3 38 0" />
      <motion.path {...draw} transition={{ ...transition, delay: 0.32 }} viewport={{ once: true }} d="m82 98 7 7 17-21" />
      <circle cx="126" cy="91" r="4" className="landing-ink-fill" />
    </svg>;
  }

  if (name === "review") {
    return <svg className="landing-illustration" viewBox="0 0 180 130" fill="none" aria-hidden="true">
      <motion.path {...draw} transition={transition} viewport={{ once: true }} d="M63 26c-18 0-31 14-31 32s13 32 31 32c8 0 15-3 21-8l20 20 11-11-20-20c5-18-4-36-22-42-3-1-6-1-10-1Z" />
      <motion.path {...draw} transition={{ ...transition, delay: 0.14 }} viewport={{ once: true }} d="M50 59c8-14 22-19 37-13M49 67c9 10 24 11 37 2" />
      <motion.path {...draw} transition={{ ...transition, delay: 0.3 }} viewport={{ once: true }} d="m126 38 7 7 14-17M128 59l7 7 14-17M126 81l7 7 14-17" />
      <circle cx="55" cy="55" r="3" className="landing-ink-fill" /><circle cx="79" cy="55" r="3" className="landing-ink-fill" />
    </svg>;
  }

  return <svg className="landing-illustration" viewBox="0 0 180 130" fill="none" aria-hidden="true">
    <motion.path {...draw} transition={transition} viewport={{ once: true }} d="M44 52h92v55H44zM44 52l46 25 46-25M90 77v30" />
    <motion.path {...draw} transition={{ ...transition, delay: 0.16 }} viewport={{ once: true }} d="M69 43V29c0-12 9-21 21-21s21 9 21 21v14" />
    <motion.path {...draw} transition={{ ...transition, delay: 0.3 }} viewport={{ once: true }} d="m83 93 6 6 12-15" />
    <motion.path {...draw} transition={{ ...transition, delay: 0.42 }} viewport={{ once: true }} d="M30 107c7 9 18 14 32 14M150 107c-7 9-18 14-32 14" />
    <circle cx="90" cy="91" r="3" className="landing-ink-fill" />
  </svg>;
}

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion ? {} : { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 } };

  return (
    <main className="landing-shell">
      <section className="landing-hero" id="inicio">
        <nav className="landing-nav" aria-label="Navegación principal">
          <Link className="landing-wordmark" href="/" aria-label="Pakta, inicio">
            <Image src="/pakta-logo.png" alt="" width={24} height={24} priority aria-hidden="true" />
            pakta<span aria-hidden="true">••</span>
          </Link>
          <div className="landing-nav-links"><a href="#como-funciona">Cómo funciona</a><a href="#control">El control</a><a href="#proof">Ejemplo</a></div>
          <Link className="landing-nav-cta" href="/control-room">Abrir demo <ArrowUpRight size={14} /></Link>
        </nav>

        <div className="landing-hero-content">
          <motion.p className="landing-eyebrow" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>CONTROL DE PAGOS · CON EVIDENCIA</motion.p>
          <motion.h1 initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08 }}>Valida cada pago<br />antes de <span className="landing-selected-word">mover dinero</span>.</motion.h1>
          <motion.p className="landing-hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.18 }}>Pakta convierte documentos dispersos en una obligación verificable y trazable. Tu equipo opera rápido; el dinero solo sale cuando la respuesta es clara.</motion.p>
          <motion.div className="landing-action-row" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.28 }}><span>Une evidencia</span><i aria-hidden="true">→</i><span>Aplica política</span><i aria-hidden="true">→</i><Link href="/control-room">Ver corrida real <ArrowDownRight size={16} /></Link></motion.div>
        </div>

        <motion.div className="landing-card-stage" initial={reduceMotion ? false : { opacity: 0, y: 42 }} whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.75, delay: 0.15 }}>
          {cards.map((card, index) => <motion.article key={card.title} className={`landing-feature-card landing-feature-card-${index + 1}`} style={{ rotate: `${card.tilt}deg` } as React.CSSProperties} whileHover={reduceMotion ? undefined : { y: -9, rotate: `${card.tilt * 0.45}deg` }} transition={{ type: "spring", stiffness: 280, damping: 19 }}><p>PAKTA / 0{index + 1}</p><h2>{card.title}</h2><LineIllustration name={card.illustration} /><span>{card.copy}</span></motion.article>)}
        </motion.div>
      </section>

      <section className="landing-manifesto" id="control">
        <motion.div {...reveal} transition={{ duration: 0.55 }} viewport={{ once: true, amount: 0.3 }}><p>EL PROBLEMA</p><h2>Automatizar pagos sin contexto es solo automatizar el riesgo.</h2></motion.div>
        <motion.p {...reveal} transition={{ duration: 0.55, delay: 0.1 }} viewport={{ once: true, amount: 0.3 }}>Pakta une la evidencia, las reglas y la autorización en un Proof-of-Payable que una persona y un sistema pueden revisar antes de liquidar y conciliar.</motion.p>
      </section>

      <section className="landing-proof-section" id="proof">
        <div><p className="landing-section-label">EJEMPLO / UNA FACTURA</p><h2>Una decisión que<br />se puede seguir.</h2><p className="landing-body-copy">Nimbus Data Systems presenta una factura de USD 500. Pakta contrasta el PO, la recepción, la wallet y la política FIN-4.2; si todo coincide, genera el proof, liquida y concilia.</p><p className="landing-proof-note">Si una condición falla, no se libera dinero: Pakta muestra qué evidencia falta o no coincide.</p></div>
        <motion.div className="landing-proof-paper" {...reveal} transition={{ duration: 0.6 }} viewport={{ once: true, amount: 0.25 }}><div><span>EJEMPLO ILUSTRATIVO</span><strong>TODO COINCIDE</strong></div><b>USD 500.00</b><dl><dt>Factura</dt><dd>INV-TEC-2401</dd><dt>Checks</dt><dd>PO · receipt · wallet</dd><dt>Política</dt><dd>FIN-4.2 · cumplida</dd></dl><footer>proof → Stellar testnet → ERP conciliado <span>↗</span></footer></motion.div>
      </section>

      <section className="landing-process" id="como-funciona"><p className="landing-section-label">CÓMO FUNCIONA</p><h2>Cuatro pasos.<br />Sin cajas negras.</h2><div className="landing-process-grid">{[["01", "Conecta", "Recibimos PO, invoice, receipt y datos del proveedor."], ["02", "Comprueba", "Las reglas determinísticas verifican cada condición."], ["03", "Autoriza", "El proof deja clara la razón por la que se puede pagar."], ["04", "Liquida y cierra", "Stellar testnet confirma el settlement y el ERP queda conciliado."]].map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p><i>↘</i></article>)}</div></section>
      <section className="landing-closing"><p>PAKTA / CONTROL CON CRITERIO</p><h2>Menos fe.<br />Más <span>evidencia.</span></h2><Link href="/control-room">Entra a la demo <ArrowUpRight size={17} /></Link></section>
      <footer className="landing-footer"><span>PAKTA © 2026</span><span>Evidence before execution.</span><span>Hecho para pagos que deben poder explicarse.</span></footer>
    </main>
  );
}
