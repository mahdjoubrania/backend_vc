const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const db = require('../config/db');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// دالة مساعدة لمعالجة الضغط العالي وإعادة المحاولة تلقائياً (Exponential Backoff)
async function generateContentWithRetry(promptConfig, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // تجربة النموذج السريع والإقتصادي أولاً
      return await ai.models.generateContent({
        model: 'gemini-1.5-flash',
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

router.post('/generate-summary', async (req, res) => {
    try {
        const data = req.body;
        const inspectionId = data.inspection_id || data.id;

        if (!inspectionId) {
            return res.status(400).json({ success: false, message: "ID d'inspection manquant" });
        }

        // 1. التحقق أولاً إن كان التلخيص محفوطاً في قاعدة البيانات (Cache)
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

        // 2. إعداد الـ Prompt للذكاء الاصطناعي مع فرض الحيادية التامة
        const promptText = `
Vous êtes un expert automobile senior chez VERIFCAR.
RÈGLE STRICTE ET OBLIGATOIRE : Votre rôle est strictement TECHNIQUE et OBJECTIF. Ne donnez JAMAIS d'avis d'achat ou de recommandation d'achat (Exemple d'interdiction : "VERIFCAR vous recommande cet achat", "توصي فيريفكار بالشراء"). Contentez-vous de décrire l'état constaté du véhicule sans inciter à l'achat ou au refus.

Générez un objet JSON contenant les résumés bilingues (Français / Arabe, max 2 phrases par champ) :

1. carrosserie_summary: Analyse des éléments extérieurs (${JSON.stringify(data.elements_ext_json || {})}).
2. structure_summary: État de la structure (${data.longerons_status || 'OK'}, ${data.chassis_status || 'OK'}).
3. suspension_summary: Pneus/Soubassement (Corrosion: ${data.corrosion_soubassement ? 'Oui' : 'Non'}).
4. moteur_summary: Bilan Moteur (Huile: ${data.niveau_huile || 'N/A'}, Fuite: ${data.fuite_huile ? 'Oui' : 'Non'}, Bruit: ${data.bruit_moteur ? 'Oui' : 'Non'}).
5. scanner_summary: Diagnostique Scanner (Calculateur: ${data.calculateur_status || 'OK'}, Codes DTC: ${data.dtc_codes || 'Aucun'}, Voyants: ${data.voyants_allumes || 'Aucun'}).
6. conclusion_generale: Résumé factuel de l'état général (Exemple : "Véhicule en bon état général sur le plan structural et mécanique, avec légers défauts de peinture. / سيارة بحالة générale جيدة من الناحية الهيكلية والميكانيكية مع وجود عيوب طفيفة في الطلاء.").

Format JSON strict :
{
  "carrosserie_summary": "texte FR / نص عربي",
  "structure_summary": "texte FR / نص عربي",
  "suspension_summary": "texte FR / نص عربي",
  "moteur_summary": "texte FR / نص عربي",
  "scanner_summary": "texte FR / نص عربي",
  "conclusion_generale": "texte FR / نص عربي"
}
`;

// ... باقي الكود ...
        // 3. الطلب مع آلية Retry
        const response = await generateContentWithRetry({
            contents: promptText,
            config: { responseMimeType: "application/json" }
        });

        const resultJson = JSON.parse(response.text);

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
            message: "الخدمة الذكية متوقفة مؤقتاً بسبب الضغط من المصدر.",
            error: error.message 
        });
    }
});

module.exports = router;