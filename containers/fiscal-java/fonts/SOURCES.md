# Sources des polices embarquées dans l'image

Les archives ne sont pas commitées. Depuis le ticket T-P2A-06, les fichiers utiles sont vendorisés ici (extraits des archives ci-dessous, vérifiées par `SHA256SUMS` le 2026-11-13) : `Geist-Regular.ttf`, `Geist-Bold.ttf`, `IBMPlexSansArabic-Regular.ttf`, `IBMPlexSansArabic-Bold.ttf` et les licences `OFL-Geist.txt`, `LICENSE-IBMPlexSansArabic.txt`. Leurs empreintes sont dans `FILES.sha256` (vérifiées par le test `VendoredFontsTest`). Elles sont embarquées dans le jar puis intégrées (sous-ensemble) dans chaque PDF.

| Police | Licence | Version | Archive officielle | Fichier local (SHA256SUMS) |
|---|---|---|---|---|
| Geist (Vercel) | SIL OFL 1.1 | v1.9.2 | `https://github.com/vercel/geist-font/releases/download/v1.9.2/geist-font-v1.9.2.zip` | `geist-font-v1.9.2.zip` |
| IBM Plex Sans Arabic | SIL OFL 1.1 | 1.1.0 | `https://github.com/IBM/plex/releases/download/%40ibm/plex-sans-arabic%401.1.0/ibm-plex-sans-arabic.zip` | `ibm-plex-sans-arabic-1.1.0.zip` |

Empreintes calculées le 2026-11-13 sur les archives téléchargées depuis ces adresses (`sha256sum`). Chaque archive contient son fichier de licence OFL, copié dans l'image avec les polices.

Mise à jour : changer la version dans le Dockerfile, retélécharger, recalculer l'empreinte, mettre à jour `SHA256SUMS` et ce fichier dans la même Pull Request.

Note : la spécification Doc_08 cite Noto Sans Arabic pour l'arabe ; le ticket T-P2A-06 et le Dockerfile retiennent IBM Plex Sans Arabic (formes de présentation FE70 à FEFC présentes, nécessaires au texte mis en forme du PDF). Écart signalé, non tranché ici.
