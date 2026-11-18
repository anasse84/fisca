---
id_source: cmwfqslq2010x07ad2sj4uip2
category: preference
importance: 4
tags: ["fisca", "ui-mercury", "contrast", "wcag", "brand-indigo", "dark-theme", "pilot-decision"]
whenToUse: "When styling any Fisca UI component (ui-mercury, web-saas, pos-pwa, marketing-astro) that uses brand colours, badges, buttons or focus states, especially in dark theme"
date_creation: 2026-11-14T01:44:02Z
titre: "Mercury : --brand-indigo jamais pour du texte (contraste 4,3:1 en sombre)"
---
# Mercury : --brand-indigo jamais pour du texte (contraste 4,3:1 en sombre)

## Contenu intégral (inchangé)

Fisca pilot decision (Mercury design system): keep the spec colour --brand-indigo unchanged. In dark theme it measures only about 4.3:1 on the background, so it must NEVER be used for running text, including white text on an indigo background. Use it only for icons, borders and focus rings. Text must use a compliant text token (--text-primary or --text-secondary, at least 4.5:1), and the deviation is logged in section 04 of FISCA_STATE_AND_HANDOFF.
