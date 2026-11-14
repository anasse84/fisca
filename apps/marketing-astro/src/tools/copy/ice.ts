import type { L4 } from '../../content/silos/types.ts';
import type { ToolPageCopy } from './page-types.ts';
import { t } from './common.ts';

export const ICE_EXISTENCE_NOTICE: L4 = t(
  'La clé modulo 97 est un contrôle de cohérence, pas une preuve d’existence : un ICE qui la respecte n’est pas prouvé exister. L’existence d’une entreprise et de son ICE se vérifie dans le référentiel officiel.',
  'The modulo 97 key is a consistency check, not proof of existence: an ICE that satisfies it is not proven to exist. The existence of a company and of its ICE is verified in the official register.',
  'مفتاح modulo 97 فحص اتساق وليس دليلا على الوجود: فالـICE الذي يحترمه لا يثبت وجوده. ويُتحقق من وجود المقاولة ومن ICE الخاص بها في المرجع الرسمي.',
  'مفتاح modulo 97 هو غير تحقق د التناسق ماشي دليل على الوجود: ICE اللي كيحترمو ما كيتثبتش بلي كاين. والتحقق من وجود الشركة وICE ديالها كيتدار فالمرجع الرسمي.',
);

export const ICE_PAGE: ToolPageCopy = {
  title: t(
    'Audit et réparation d’ICE Excel en masse (clé modulo 97)',
    'Bulk ICE audit and repair for Excel files (modulo 97 key)',
    'تدقيق وإصلاح أرقام ICE في Excel دفعة واحدة (مفتاح modulo 97)',
    'تدقيق وإصلاح ICE ف Excel دفعة وحدة (مفتاح modulo 97)',
  ),
  description: t(
    'Déposez un fichier .csv ou .xlsx : l’outil contrôle la clé modulo 97 des ICE à 15 chiffres, répare ceux de 13 ou 14 chiffres dont Excel a supprimé les zéros initiaux, et exporte un CSV corrigé. Tout reste dans votre navigateur.',
    'Drop a .csv or .xlsx file: the tool checks the modulo 97 key of 15-digit ICE numbers, repairs 13- or 14-digit ones whose leading zeros Excel removed, and exports a corrected CSV. Everything stays in your browser.',
    'أسقط ملف .csv أو .xlsx: تفحص الأداة مفتاح modulo 97 لأرقام ICE ذات 15 رقما، وتصلح التي بـ13 أو 14 رقما بعد أن حذف Excel الأصفار الأولى، وتصدّر ملف CSV مصححا. كل شيء يبقى في متصفحك.',
    'حط ملف .csv ولا .xlsx: الأداة كتفحص مفتاح modulo 97 د ICE د 15 رقم، وكتصلح اللي فيهم 13 ولا 14 رقم منين Excel مسح ليهم الصيفرات د البداية، وكتصدر CSV مصحح. كلشي كيبقى فالمتصفح.',
  ),
  heading: t(
    'Auditeur et réparateur d’ICE pour fichiers Excel',
    'ICE auditor and repairer for Excel files',
    'مدقق ومصلح أرقام ICE لملفات Excel',
    'مدقق ومصلح ICE لملفات Excel',
  ),
  lead: t(
    'Excel supprime les zéros initiaux d’un ICE enregistré comme nombre : 001534290000057 devient 1534290000057. Cet outil retrouve les ICE tronqués dont la clé modulo 97 redevient cohérente, et signale les autres sans les inventer.',
    'Excel drops the leading zeros of an ICE stored as a number: 001534290000057 becomes 1534290000057. This tool recovers the truncated ICE numbers whose modulo 97 key becomes consistent again, and flags the others without making anything up.',
    'يحذف Excel الأصفار الأولى من ICE المخزَّن كرقم: يصبح 001534290000057 هو 1534290000057. تسترجع هذه الأداة أرقام ICE المبتورة التي يعود مفتاح modulo 97 فيها متسقا، وتشير إلى الباقي دون اختلاق أي شيء.',
    'Excel كيمسح الصيفرات د البداية د ICE منين كيتسجل بحال رقم: 001534290000057 كيولي 1534290000057. هاد الأداة كترجع ICE المقطوعين اللي مفتاح modulo 97 ديالهم كيرجع متناسق، وكتشير للباقي بلا ما تخترع شي حاجة.',
  ),
  summary: t(
    'ICE à 15 chiffres : divisibilité par 97. ICE de 13 ou 14 chiffres : zéros initiaux rétablis seulement si la clé redevient cohérente. Résultat par ligne et export CSV.',
    '15-digit ICE: divisibility by 97. 13- or 14-digit ICE: leading zeros restored only if the key becomes consistent again. Per-row result and CSV export.',
    'ICE بـ15 رقما: قابلية القسمة على 97. ICE بـ13 أو 14 رقما: تُستعاد الأصفار الأولى فقط إذا عاد المفتاح متسقا. نتيجة لكل سطر وتصدير CSV.',
    'ICE د 15 رقم: القسمة على 97. ICE د 13 ولا 14 رقم: كيرجعو الصيفرات غير إلا رجع المفتاح متناسق. نتيجة فكل سطر وتصدير CSV.',
  ),
  steps: {
    fr: [
      { name: 'Déposer le fichier', text: 'Déposez un fichier .csv ou .xlsx (20 Mo au maximum) dans la zone de dépôt, ou choisissez-le au clavier. Il est lu dans votre navigateur.' },
      { name: 'Choisir la colonne', text: 'L’outil propose la colonne qui ressemble à des ICE ; changez-la si besoin et indiquez si la première ligne contient des en-têtes.' },
      { name: 'Lire le résultat par ligne', text: 'Chaque ligne est classée : valide, réparée (zéros initiaux rétablis), invalide ou vide, avec la raison pour les invalides.' },
      { name: 'Exporter le CSV corrigé', text: 'Téléchargez un CSV qui garde vos colonnes et ajoute l’ICE corrigé et son statut. Importez-le dans Excel en forçant la colonne ICE au format texte.' },
    ],
    en: [
      { name: 'Drop the file', text: 'Drop a .csv or .xlsx file (20 MB at most) onto the drop zone, or pick it with the keyboard. It is read in your browser.' },
      { name: 'Choose the column', text: 'The tool suggests the column that looks like ICE numbers; change it if needed and say whether the first row holds headers.' },
      { name: 'Read the result row by row', text: 'Each row is classified: valid, repaired (leading zeros restored), invalid or empty, with the reason for invalid ones.' },
      { name: 'Export the corrected CSV', text: 'Download a CSV that keeps your columns and adds the corrected ICE and its status. Import it into Excel with the ICE column forced to text.' },
    ],
    ar: [
      { name: 'إسقاط الملف', text: 'أسقط ملف .csv أو .xlsx (20 ميغابايت كحد أقصى) في منطقة الإسقاط أو اخترْه بلوحة المفاتيح. تتم قراءته داخل متصفحك.' },
      { name: 'اختيار العمود', text: 'تقترح الأداة العمود الذي يشبه أرقام ICE؛ غيّره عند الحاجة وحدد هل يحتوي السطر الأول على عناوين.' },
      { name: 'قراءة النتيجة سطرا سطرا', text: 'يُصنَّف كل سطر: صالح أو مُصلَح (استُعيدت الأصفار الأولى) أو غير صالح أو فارغ، مع سبب عدم الصلاحية.' },
      { name: 'تصدير CSV المصحح', text: 'نزّل ملف CSV يحتفظ بأعمدتك ويضيف ICE المصحح وحالته. استورده في Excel مع فرض تنسيق النص على عمود ICE.' },
    ],
    ary: [
      { name: 'حط الملف', text: 'حط ملف .csv ولا .xlsx (20 ميغا بحد أقصى) فمنطقة الإسقاط، ولا ختارو بالكلافيي. كيتقرا فالمتصفح ديالك.' },
      { name: 'ختار العمود', text: 'الأداة كتقترح العمود اللي كيشبه ICE؛ بدلو إلا بغيتي وقول واش السطر الأول فيه العناوين.' },
      { name: 'قرا النتيجة سطر سطر', text: 'كل سطر كيتصنف: صالح، مصلح (رجعو الصيفرات د البداية)، ماشي صالح ولا خاوي، مع السبب د اللي ماشي صالحين.' },
      { name: 'صدر CSV المصحح', text: 'نزل CSV كيحتافظ بالأعمدة ديالك وكيزيد ICE المصحح والحالة ديالو. دخلو لـExcel وفرض على عمود ICE تنسيق النص.' },
    ],
  },
  faqs: {
    fr: [
      { question: 'Pourquoi Excel supprime-t-il des zéros dans mes ICE ?', answer: 'Un ICE enregistré comme nombre perd ses zéros initiaux : 001534290000057 devient 1534290000057 (13 chiffres). Une cellule au format texte les conserve. L’outil rétablit les zéros seulement quand la clé modulo 97 redevient cohérente.' },
      { question: 'Un ICE qui passe le contrôle existe-t-il vraiment ?', answer: 'Non, ce n’est pas prouvé. La divisibilité par 97 est un contrôle de cohérence établi par constat sur des numéros réels, sans texte officiel publié à ce jour. L’existence d’un ICE se vérifie dans le référentiel officiel.' },
      { question: 'Mon fichier est-il envoyé quelque part ?', answer: 'Non. Le fichier est lu et analysé dans votre navigateur ; rien n’est transmis, aucun cookie n’est posé et aucun script tiers n’est chargé.' },
    ],
    en: [
      { question: 'Why does Excel remove zeros from my ICE numbers?', answer: 'An ICE stored as a number loses its leading zeros: 001534290000057 becomes 1534290000057 (13 digits). A text-formatted cell keeps them. The tool restores zeros only when the modulo 97 key becomes consistent again.' },
      { question: 'Does an ICE that passes the check really exist?', answer: 'No, that is not proven. Divisibility by 97 is a consistency check established by observing real numbers, with no official text published to date. The existence of an ICE is verified in the official register.' },
      { question: 'Is my file sent anywhere?', answer: 'No. The file is read and analysed in your browser; nothing is transmitted, no cookie is set and no third-party script is loaded.' },
    ],
    ar: [
      { question: 'لماذا يحذف Excel أصفارا من أرقام ICE عندي؟', answer: 'ICE المخزَّن كرقم يفقد أصفاره الأولى: يصبح 001534290000057 هو 1534290000057 (13 رقما). وتحتفظ بها الخلية المنسقة كنص. تعيد الأداة الأصفار فقط عندما يعود مفتاح modulo 97 متسقا.' },
      { question: 'هل يوجد فعلا ICE الذي يجتاز الفحص؟', answer: 'لا، هذا غير مثبت. القابلية للقسمة على 97 فحص اتساق استُخلص بملاحظة أرقام حقيقية دون نص رسمي منشور إلى اليوم. ويُتحقق من وجود ICE في المرجع الرسمي.' },
      { question: 'هل يُرسل ملفي إلى أي مكان؟', answer: 'لا. يُقرأ الملف ويُحلَّل داخل متصفحك؛ لا شيء يُنقل ولا كوكيز تُوضع ولا سكربت خارجي يُحمَّل.' },
    ],
    ary: [
      { question: 'علاش Excel كيمسح الصيفرات من ICE ديالي؟', answer: 'ICE منين كيتسجل بحال رقم كيضيع ليه الصيفرات د البداية: 001534290000057 كيولي 1534290000057 (13 رقم). الخلية بتنسيق نص كتحتافظ بيهم. الأداة كترجع الصيفرات غير إلا رجع مفتاح modulo 97 متناسق.' },
      { question: 'واش ICE اللي كيدوز الفحص كاين بصح؟', answer: 'لا، ما كيتثبتش. القسمة على 97 هي تحقق د التناسق تستنتج من ملاحظة أرقام حقيقية بلا نص رسمي منشور حتى لدابا. والتحقق من وجود ICE كيتدار فالمرجع الرسمي.' },
      { question: 'واش الملف ديالي كيتصيفط لشي بلاصة؟', answer: 'لا. الملف كيتقرا وكيتحلل فالمتصفح ديالك؛ ما كيتنقل والو، ما كيتحط حتى كوكيز وما كيتحمل حتى سكريبت د برا.' },
    ],
  },
  sections: {
    fr: [
      {
        heading: 'Ce que l’outil contrôle',
        paragraphs: ['Pour chaque ligne de la colonne choisie, l’outil applique les mêmes règles, dans cet ordre.'],
        bullets: [
          'ICE de 15 chiffres : la clé est cohérente si les 15 chiffres, lus comme un entier, sont divisibles par 97. Une racine de 9 zéros est refusée.',
          'ICE de 13 ou 14 chiffres : les zéros initiaux sont rétablis jusqu’à 15 chiffres, et le résultat n’est retenu que si la clé redevient cohérente. Sinon la ligne reste invalide : rien n’est deviné.',
          'Notation scientifique (1,53429E+12) : les derniers chiffres ont été perdus par Excel, aucune réparation n’est possible, la ligne est signalée.',
          'Les espaces, points, tirets et soulignés sont ignorés ; les chiffres arabes orientaux sont acceptés.',
        ],
      },
      {
        heading: 'Limites et points à valider',
        paragraphs: [
          'La clé modulo 97 est un contrôle de cohérence établi par constat sur des numéros réels : aucune publication officielle de l’algorithme n’a été trouvée. Elle ne prouve pas qu’un ICE existe ; l’existence se vérifie dans le référentiel officiel.',
          'Un ICE tronqué peut, par coïncidence (environ une chance sur 97), redevenir cohérent avec de mauvais zéros : relisez les lignes réparées avant de les reprendre dans votre comptabilité.',
          'Lecture : première feuille d’un .xlsx (ZIP64 et fichiers chiffrés non pris en charge), ou CSV (séparateur détecté, UTF-8 ou Windows-1252). L’export est toujours un CSV. Excel supprimera de nouveau les zéros si vous rouvrez le CSV par un double-clic : utilisez Données > À partir d’un fichier texte et forcez la colonne ICE au format texte.',
        ],
      },
    ],
    en: [
      {
        heading: 'What the tool checks',
        paragraphs: ['For each row of the chosen column, the tool applies the same rules, in this order.'],
        bullets: [
          '15-digit ICE: the key is consistent if the 15 digits, read as an integer, are divisible by 97. An enterprise root of nine zeros is rejected.',
          '13- or 14-digit ICE: leading zeros are restored up to 15 digits, and the result is kept only if the key becomes consistent again. Otherwise the row stays invalid: nothing is guessed.',
          'Scientific notation (1.53429E+12): Excel lost the last digits, no repair is possible, the row is flagged.',
          'Spaces, dots, hyphens and underscores are ignored; Eastern Arabic digits are accepted.',
        ],
      },
      {
        heading: 'Limits and points to validate',
        paragraphs: [
          'The modulo 97 key is a consistency check established by observing real numbers: no official publication of the algorithm was found. It does not prove that an ICE exists; existence is verified in the official register.',
          'A truncated ICE can, by coincidence (about one chance in 97), become consistent again with the wrong zeros: review repaired rows before carrying them into your books.',
          'Reading: first sheet of an .xlsx (ZIP64 and encrypted files are not supported), or CSV (delimiter detected, UTF-8 or Windows-1252). The export is always a CSV. Excel will drop the zeros again if you reopen the CSV by double-clicking: use Data > From Text and force the ICE column to text.',
        ],
      },
    ],
    ar: [
      {
        heading: 'ما الذي تفحصه الأداة',
        paragraphs: ['تطبق الأداة على كل سطر من العمود المختار القواعد نفسها بهذا الترتيب.'],
        bullets: [
          'ICE بـ15 رقما: يكون المفتاح متسقا إذا كانت الأرقام الخمسة عشر مقروءة كعدد صحيح قابلة للقسمة على 97. ويُرفض الجذر المكوّن من تسعة أصفار.',
          'ICE بـ13 أو 14 رقما: تُستعاد الأصفار الأولى حتى 15 رقما ولا يُحتفظ بالنتيجة إلا إذا عاد المفتاح متسقا. وإلا يبقى السطر غير صالح: لا شيء يُخمَّن.',
          'الترميز العلمي (1,53429E+12): فقد Excel الأرقام الأخيرة ولا إصلاح ممكن، ويُشار إلى السطر.',
          'تُهمل المسافات والنقاط والشرطات والشرطات السفلية؛ وتُقبل الأرقام العربية الشرقية.',
        ],
      },
      {
        heading: 'الحدود ونقاط التحقق',
        paragraphs: [
          'مفتاح modulo 97 فحص اتساق استُخلص بملاحظة أرقام حقيقية: لم يوجد أي نشر رسمي للخوارزمية. وهو لا يثبت وجود ICE؛ ويُتحقق من الوجود في المرجع الرسمي.',
          'قد يعود ICE مبتور متسقا بالصدفة (بنحو فرصة من 97) مع أصفار خاطئة: راجع الأسطر المُصلَحة قبل نقلها إلى محاسبتك.',
          'القراءة: الورقة الأولى من ملف .xlsx (لا يُدعم ZIP64 ولا الملفات المشفرة)، أو CSV (يُكتشف الفاصل، UTF-8 أو Windows-1252). التصدير دائما بصيغة CSV. سيحذف Excel الأصفار مجددا إن فتحت الملف بنقرة مزدوجة: استعمل «بيانات > من نص» وفرض تنسيق النص على عمود ICE.',
        ],
      },
    ],
    ary: [
      {
        heading: 'شنو كتفحص الأداة',
        paragraphs: ['الأداة كتطبق على كل سطر فالعمود اللي ختاريتي نفس القواعد بهاد الترتيب.'],
        bullets: [
          'ICE د 15 رقم: المفتاح متناسق إلا كانو 15 رقم مقروءين بحال عدد صحيح كيتقسمو على 97. والجذر د تسع صيفرات كيترفض.',
          'ICE د 13 ولا 14 رقم: كيرجعو الصيفرات د البداية حتى ل 15 رقم وما كيتحبسش النتيجة إلا إلا رجع المفتاح متناسق. وإلا كيبقى السطر ماشي صالح: ما كيتخمن والو.',
          'الترميز العلمي (1,53429E+12): Excel ضيع الأرقام لخرانين وما ممكنش إصلاح، والسطر كيتشار ليه.',
          'المسافات والنقاط والشرطات كيتهملو؛ والأرقام العربية الشرقية مقبولة.',
        ],
      },
      {
        heading: 'الحدود ونقط خاصها تتحقق',
        paragraphs: [
          'مفتاح modulo 97 هو تحقق د التناسق تستنتج من ملاحظة أرقام حقيقية: ما لقينا حتى نشر رسمي للخوارزمية. وما كيثبتش بلي ICE كاين؛ والوجود كيتحقق منو فالمرجع الرسمي.',
          'ICE مقطوع ممكن بالصدفة (تقريبا فرصة من 97) يرجع متناسق بصيفرات غالطين: عاود قرا السطور المصلحة قبل ما تدخلهم للمحاسبة ديالك.',
          'القراءة: الورقة الأولى د ملف .xlsx (ZIP64 والملفات المشفرة ما مدعومينش)، ولا CSV (الفاصل كيتكتاشف، UTF-8 ولا Windows-1252). التصدير ديما CSV. Excel غادي يمسح الصيفرات مرة خرى إلا حليتي الملف بدبل كليك: استعمل «بيانات > من نص» وفرض تنسيق النص على عمود ICE.',
        ],
      },
    ],
  },
};
