const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const db = require('../config/db');
const verifyToken = require('../middleware/auth.middleware');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// دالة مساعدة لمعالجة الضغط العالي وإعادة المحاولة تلقائياً (Exponential Backoff)
async function generateContentWithRetry(promptConfig, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        ...promptConfig
      });
    } catch (error) {
      console.warn(`[Attempt ${i + 1}/${maxRetries}] AI Error:`, error.message);
      
      // إذا كان سيرفر غوغل مشغولاً (503) أو تم تجاوز الحد، قم بالانتظار وإعادة المحاولة
      if ((error.status === 503 || error.code === 503) && i < maxRetries - 1) {
        const delay = (i + 1) * 2000;
        console.warn(`AI Server busy (503). Retrying in ${delay / 1000}s...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
}

router.post('/generate-summary', verifyToken, async (req, res) => {
    try {
        const data = req.body;
        const inspectionId = data.inspection_id || data.id;

        if (!inspectionId) {
            return res.status(400).json({ success: false, message: "ID d'inspection manquant" });
        }

        // 1. التحقق أولاً إن كان التلخيص محفوظاً في قاعدة البيانات (Cache)
        const [existing] = await db.query(
            `SELECT carrosserie_summary, structure_summary, suspension_summary, moteur_summary, scanner_summary, conclusion_generale 
             FROM inspection_ai_summaries WHERE inspection_id = ?`, 
            [inspectionId]
        );

        if (existing.length > 0 && existing[0].carrosserie_summary) {
            return res.json({
                success: true,
                from_cache: true,
                data: existing[0]
            });
        }

        // 2. إعداد الـ Prompt للذكاء الاصطناعي
        const promptText = `
Vous êtes un expert automobile senior chez VERIFCAR.
RÈGLE STRICTE ET OBLIGATOIRE : Votre rôle est strictement TECHNIQUE et OBJECTIF. Ne donnez JAMAIS d'avis d'achat ou de recommandation d'achat. Contentez-vous de décrire l'état constaté du véhicule sans inciter à l'achat ou au refus.

Générez un objet JSON contenant des résumés STRICTEMENT BILINGUES.

RÈGLE DE FORMAT OBLIGATOIRE POUR CHAQUE CHAMP (sans aucune exception) :
Chaque champ doit contenir EXACTEMENT une phrase en français, suivie de " / ", suivie de la traduction EXACTE de cette même phrase en arabe, dans une seule et même chaîne de texte.
Format exact à respecter : "Phrase en français ici. / الترجمة العربية للجملة هنا."
Ne réponds JAMAIS avec une seule langue (ni français seul, ni arabe seul) — les deux langues doivent TOUJOURS apparaître ensemble dans le même champ, max 2 phrases par langue.

Champs à générer :

1. carrosserie_summary: Analyse de l'état structurel externe (Longerons: ${data.longerons_status || 'Conforme'}, Traverses: ${data.traverses_status || 'Conforme'}, Optique: ${data.optique_status || 'Conforme'}, Vitres: ${data.vitre_status || 'Conforme'}, Conclusion: ${data.conclusion_structure || 'Aucun accident détecté'}).
2. structure_summary: État de la structure (${data.longerons_status || 'OK'}, ${data.chassis_status || 'OK'}).
3. suspension_summary: Pneus/Soubassement (Corrosion: ${data.corrosion_soubassement ? 'Oui' : 'Non'}).
4. moteur_summary: Bilan Moteur (Huile: ${data.niveau_huile || 'N/A'}, Fuite: ${data.fuite_huile ? 'Oui' : 'Non'}, Bruit: ${data.bruit_moteur ? 'Oui' : 'Non'}).
5. scanner_summary: Diagnostique Scanner (Calculateur: ${data.calculateur_status || 'OK'}, Codes DTC: ${data.dtc_codes || 'Aucun'}, Voyants: ${data.voyants_allumes || 'Aucun'}).
6. conclusion_generale: Résumé factuel de l'état général.
`;

        let resultJson;

        try {
            // 3. الطلب مع آلية Retry وتطبيق responseSchema
            const response = await generateContentWithRetry({
                contents: promptText,
                config: { 
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            carrosserie_summary: { type: "STRING" },
                            structure_summary: { type: "STRING" },
                            suspension_summary: { type: "STRING" },
                            moteur_summary: { type: "STRING" },
                            scanner_summary: { type: "STRING" },
                            conclusion_generale: { type: "STRING" }
                        },
                        required: [
                            "carrosserie_summary", 
                            "structure_summary", 
                            "suspension_summary", 
                            "moteur_summary", 
                            "scanner_summary", 
                            "conclusion_generale"
                        ]
                    }
                }
            });

            // تنظيف النص قبل التحليل
            const rawText = response.text || '';
            const cleanJsonText = rawText.replace(/```json\s*|```/g, '').trim();
            resultJson = JSON.parse(cleanJsonText);

        } catch (aiError) {
            console.error("AI Generation Failed, using fallback response:", aiError.message);
            
            // استجابة احتياطية تلقائية في حال تعذر الاتصال بـ Gemini
            resultJson = buildDataDrivenFallback(data);
        }

        // 4. حفظ النتائج في قاعدة البيانات
        await db.query(
            `INSERT INTO inspection_ai_summaries 
                (inspection_id, carrosserie_summary, structure_summary, suspension_summary, moteur_summary, scanner_summary, conclusion_generale)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                carrosserie_summary = VALUES(carrosserie_summary),
                structure_summary = VALUES(structure_summary),
                suspension_summary = VALUES(suspension_summary),
                moteur_summary = VALUES(moteur_summary),
                scanner_summary = VALUES(scanner_summary),
                conclusion_generale = VALUES(conclusion_generale)`,
            [
                inspectionId,
                resultJson.carrosserie_summary,
                resultJson.structure_summary,
                resultJson.suspension_summary,
                resultJson.moteur_summary,
                resultJson.scanner_summary,
                resultJson.conclusion_generale
            ]
        );

        res.json({ success: true, from_cache: false, data: resultJson });

    } catch (error) {
        console.error("Erreur AI Server:", error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur serveur lors de la génération du résumé.",
            error: error.message 
        });
    }
});

// دالة احتياطية تبني نصوص وصفية حقيقية من بيانات الفحص الفعلية
// (تُستخدم فقط لو فشل الاتصال بـ Gemini، عشان النص يبقى مفيد ودقيق)
function buildDataDrivenFallback(data) {
    // --- 1. الهيكل والتصادم (Structure) ---
    const structElements = [
        { key: 'longerons', fr: 'Longerons' },
        { key: 'traverses', fr: 'Traverses' },
        { key: 'passage_roues', fr: 'Passage de roues' },
        { key: 'fond_coffre', fr: 'Fond coffre' },
        { key: 'chassis', fr: 'Châssis' },
        { key: 'optique', fr: 'Optique' },
        { key: 'vitre', fr: 'Vitre' }
    ];
    const structDefauts = structElements
        .filter(el => data[el.key + '_status'] === 'Défaut')
        .map(el => data[el.key + '_obs'] ? `${el.fr} (${data[el.key + '_obs']})` : el.fr);

    const carrosserie_summary = structDefauts.length > 0
        ? `Défauts structurels détectés sur : ${structDefauts.join(', ')}. / تم رصد أعطال هيكلية في: ${structDefauts.join('، ')}.`
        : `Aucun défaut structurel détecté sur les éléments contrôlés. / لم يُرصد أي خلل هيكلي.`;

    const structure_summary = `Conclusion structurelle : ${data.conclusion_structure || 'Aucun accident détecté'}. / الخلاصة الهيكلية: ${data.conclusion_structure || 'لم يتم كشف أي حادث'}.`;

    // --- 2. التعليق والإطارات (Suspension) ---
    const tirePositions = [
        { key: 'avg', fr: 'Avant Gauche' },
        { key: 'avd', fr: 'Avant Droit' },
        { key: 'arg', fr: 'Arrière Gauche' },
        { key: 'ard', fr: 'Arrière Droit' }
    ];
    const tireDefauts = tirePositions.filter(p => data['usure_pneu_' + p.key] === 'Défaut').map(p => p.fr);
    const janteDefauts = tirePositions.filter(p => data['jante_' + p.key] === 'Défaut').map(p => p.fr);

    let suspensionParts = [];
    if (tireDefauts.length > 0) suspensionParts.push(`pneus défectueux (${tireDefauts.join(', ')})`);
    if (janteDefauts.length > 0) suspensionParts.push(`jantes défectueuses (${janteDefauts.join(', ')})`);
    if (data.corrosion_soubassement) suspensionParts.push('corrosion du soubassement');
    if (data.traces_choc) suspensionParts.push('traces de choc sous véhicule');

    const suspension_summary = suspensionParts.length > 0
        ? `Anomalies détectées : ${suspensionParts.join(', ')}. / تم رصد: ${suspensionParts.join('، ')}.`
        : `Suspension et pneumatiques conformes, aucune anomalie détectée. / نظام التعليق والإطارات سليمة.`;

    // --- 3. المحرك (Moteur) ---
    let moteurParts = [];
    if (data.fuite_huile) moteurParts.push('fuite d\'huile détectée');
    if (data.fuite_liquide_refroidissement) moteurParts.push('fuite de liquide de refroidissement détectée');
    if (data.bruit_moteur) moteurParts.push('bruit moteur anormal');
    if (data.fumee_echappement && data.fumee_echappement.toUpperCase() !== 'AUCUNE') moteurParts.push(`fumée d'échappement (${data.fumee_echappement})`);

    const moteur_summary = moteurParts.length > 0
        ? `Niveau d'huile ${data.niveau_huile || 'non spécifié'}. Anomalies : ${moteurParts.join(', ')}. / مستوى الزيت ${data.niveau_huile || 'غير محدد'}. ملاحظات: ${moteurParts.join('، ')}.`
        : `Niveau d'huile ${data.niveau_huile || 'non spécifié'}, aucune fuite ni bruit anormal détecté. / مستوى الزيت ${data.niveau_huile || 'غير محدد'}، بدون أي تسريب أو صوت غير طبيعي.`;

    // --- 4. السكانر (Scanner) ---
    const scanner_summary = (data.dtc_codes && data.dtc_codes.trim() !== '')
        ? `Calculateur: ${data.calculateur_status || 'OK'}. Codes DTC détectés : ${data.dtc_codes}. / حالة الكمبيوتر: ${data.calculateur_status || 'سليم'}. أكواد أعطال مسجلة: ${data.dtc_codes}.`
        : `Calculateur: ${data.calculateur_status || 'OK'}, aucun code défaut détecté. / حالة الكمبيوتر: ${data.calculateur_status || 'سليم'}، بدون أي كود عطل.`;

    // --- 5. الخلاصة العامة ---
    const totalDefauts = structDefauts.length + tireDefauts.length + janteDefauts.length + moteurParts.length + (data.dtc_codes ? 1 : 0);
    const conclusion_generale = totalDefauts > 0
        ? `Véhicule présentant ${totalDefauts} point(s) d'attention répartis sur les différents systèmes contrôlés. Voir détails par section. / السيارة فيها ${totalDefauts} نقطة تحتاج انتباه موزعة على الأنظمة المفحوصة، راجع التفاصيل بكل قسم.`
        : `Aucune anomalie majeure détectée sur l'ensemble des systèmes contrôlés. / لا توجد ملاحظات جوهرية على كل الأنظمة المفحوصة.`;

    return { carrosserie_summary, structure_summary, suspension_summary, moteur_summary, scanner_summary, conclusion_generale };
}

module.exports = router;