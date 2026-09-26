# Documentación de Pakta

Índice de toda la documentación del proyecto, organizada por categoría.

## 📦 Categorías

### `product` — Tesis y narrativa de producto
Documentos que explican **qué es Pakta, por qué existe y qué problema resuelve**. Lectura recomendada para stakeholders, jurado de hackathon o cualquiera que necesite entender el producto sin tocar código.

| Documento | Tags | Descripción |
|---|---|---|
| [`product/Pakta_Documento_Maestro.md`](product/Pakta_Documento_Maestro.md) | `tesis` `arquitectura` `exceptions` `threat-model` `roadmap` `referencias` | Documento maestro v1.0 — tesis completa, pipeline end-to-end, modelo de excepciones, landscape competitivo (AWS/Bitwave), business model y roadmap |
| [`product/Pacta_Brief_2_Paginas.pdf`](product/Pacta_Brief_2_Paginas.pdf) | `pitch` `brief` `resumen-ejecutivo` | Brief de 2 páginas con problema, solución y tesis condensada |

### `implementation` — Ejecución técnica y de equipo
Documentos operativos para el equipo de desarrollo: **cómo se construye** y **quién construye qué**.

| Documento | Tags | Descripción |
|---|---|---|
| [`implementation/Pakta_Plan_Implementacion.md`](implementation/Pakta_Plan_Implementacion.md) | `stack-tecnico` `arquitectura-de-servicios` `modelo-de-datos` `plan-de-ejecucion` `riesgos-tecnicos` | Stack técnico completo (frontend, backend, datos, AI, blockchain, infra), arquitectura de servicios del MVP y plan de ejecución por fases |
| [`implementation/Pakta_Division_Trabajo.md`](implementation/Pakta_Division_Trabajo.md) | `equipo` `roles` `web3` `agentic-ai` `contrato-de-datos` | División de trabajo para un equipo de 2 devs: Web3/Settlement vs Agentic/AI Workflows, contrato de datos compartido y orden de integración |
| [`implementation/Pakta_Arquitectura_Flujo.md`](implementation/Pakta_Arquitectura_Flujo.md) | `mermaid` `diagramas` `pipeline` `state-machine` `checkpoint` | Esquema y flujo técnico con diagramas Mermaid: pipeline end-to-end, máquina de estados del payable, secuencia del demo canónico, modelo de datos y stack — entregable de checkpoint de hackathon |
| [`implementation/Pakta_Escenarios_UX.md`](implementation/Pakta_Escenarios_UX.md) | `ux` `roles` `escenarios` `redesign` | Escenarios corporativos de adopción (con y sin crypto) y el mapa de pantallas por rol para cada uno — insumo para el rediseño de interfaces |
| [`implementation/Pakta_Dev2_Checklist.md`](implementation/Pakta_Dev2_Checklist.md) | `estado` `dev2` `ai` `api` `dashboard` | Bitácora operativa del trabajo de Dev 2 y del estado de las historias de ingestion, extracción, API y dashboard. |

### `assets` — Diagramas y material visual
Recursos visuales de referencia usados en la documentación y en pitches.

| Archivo | Tags | Descripción |
|---|---|---|
| [`assets/mermaid-diagram.png`](assets/mermaid-diagram.png) | `arquitectura` `diagrama` | Diagrama de arquitectura end-to-end: ingestion → agentic core → control engine → Stellar/Soroban → reconciliation |
| [`assets/pitch-slide-problema-solucion.png`](assets/pitch-slide-problema-solucion.png) | `pitch` `slide` `problema-solucion` | Slide de pitch con el planteamiento de problema y solución |
| [`implementation/assets/dev2-use-case-diagram.svg`](implementation/assets/dev2-use-case-diagram.svg) | `uml` `casos-de-uso` | Fuente editable del diagrama de casos de uso incluido en el documento de arquitectura. |

---

## 🧭 Cómo navegar según lo que necesitas

- **¿Quieres entender el producto?** → empieza por [`product/Pakta_Documento_Maestro.md`](product/Pakta_Documento_Maestro.md) (secciones 1-6) o el [brief de 2 páginas](product/Pacta_Brief_2_Paginas.pdf).
- **¿Vas a implementar el MVP?** → [`implementation/Pakta_Plan_Implementacion.md`](implementation/Pakta_Plan_Implementacion.md) para el stack y arquitectura de servicios.
- **¿Eres parte del equipo de 2 devs?** → [`implementation/Pakta_Division_Trabajo.md`](implementation/Pakta_Division_Trabajo.md) para saber qué paquetes posees y el contrato de datos compartido.
- **¿Vas a construir el settlement en Stellar/Soroban?** → [`implementation/Pakta_Plan_Implementacion.md`](implementation/Pakta_Plan_Implementacion.md) §2.5 para el vault y [`implementation/Pakta_Division_Trabajo.md`](implementation/Pakta_Division_Trabajo.md) §4 y §7 para historias, criterios y contrato de datos.
- **¿Necesitas un diagrama o imagen para una presentación?** → carpeta [`assets/`](assets/).
- **¿Necesitas el esquema/flujo técnico para un checkpoint o jurado?** → [`implementation/Pakta_Arquitectura_Flujo.md`](implementation/Pakta_Arquitectura_Flujo.md).
