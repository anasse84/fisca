---
id_source: cmwfqsgt6018207adpcax6ilg
category: preference
importance: 4
tags: ["fisca", "i18n", "labels", "ui-mercury", "web-saas", "pilot-decision", "no-fallback"]
whenToUse: "When creating or modifying any Fisca React component, screen or i18n key in ui-mercury, web-saas or pos-pwa"
date_creation: 2026-11-14T01:43:55Z
titre: "UI : aucun libellé de repli ni texte français par défaut (ui-mercury)"
---
# UI : aucun libellé de repli ni texte français par défaut (ui-mercury)

## Contenu intégral (inchangé)

Fisca pilot decision: no hardcoded fallback UI label anywhere, and no French default text in components. Shared components such as ui-mercury's AiCrafterCard, CommandPalette and SplitScreenReviewDrawer receive every visible string through required typed label props, with no default value. The web-saas layer feeds them from @fisca/i18n keys defined in all 6 languages (fr, ar, ary, zgh-Latn, zgh-Tfng, en). A missing key must fail the build or tests, never fall back to French.
