const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const db = require('../config/db'); // تأكد من مسار ملف قاعدة البيانات عندك

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/generate-summary', async (req, res) => {
    try {
        const data = req.body;
        const inspectionId = data.inspection_id || data.id;

        if (!inspectionId) {
            return res.status(400).json({ success: false, message: "ID d'inspection manquant" });
        }

        // 1. التحقق أولاً إن كان التلخيص محفوطاً في جدول الذكاء الاصطناعي
        const [existing] = await db.query(
            `SELECT carrosserie_summary, structure_summary, suspension_summary, conclusion_generale 
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

        // 2. إذا لم يكن متوفراً، طلب التلخيص من Gemini
        const prompt = `
Vous êtes un expert automobile senior chez VERIFCAR.
Générez un objet JSON contenant 4 résumés bilingues (Français et Arabe ensemble, max 2 phrases par langue) :

1. carrosserie_summary: Analyse des éléments extérieurs (Défauts: ${JSON.stringify(data.elements_ext_json || {})}).
2. structure_summary: État de la structure (Longerons: ${data.longerons_status || 'Conforme'}, Châssis: ${data.chassis_status || 'Conforme'}).
3. suspension_summary: État des pneus, jantes et soubassement (Corrosion: ${data.corrosion_soubassement ? 'Oui' : 'Non'}, Choc dessous: ${data.traces_choc ? 'Oui' : 'Non'}).
4. conclusion_generale: Bilan global et conseil pour l'acheteur.

Format JSON strict :
{
  "carrosserie_summary": "texte FR / نص عربي",
  "structure_summary": "texte FR / نص عربي",
  "suspension_summary": "texte FR / نص عربي",
  "conclusion_generale": "texte FR / نص عربي"
}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        const resultJson = JSON.parse(response.text);

        // 3. حفظ الملخصات في الجدول الجديد (UPSERT)
        await db.query(
            `INSERT INTO inspection_ai_summaries 
                (inspection_id, carrosserie_summary, structure_summary, suspension_summary, conclusion_generale)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                carrosserie_summary = VALUES(carrosserie_summary),
                structure_summary = VALUES(structure_summary),
                suspension_summary = VALUES(suspension_summary),
                conclusion_generale = VALUES(conclusion_generale)`,
            [
                inspectionId,
                resultJson.carrosserie_summary,
                resultJson.structure_summary,
                resultJson.suspension_summary,
                resultJson.conclusion_generale
            ]
        );

        res.json({ success: true, from_cache: false, data: resultJson });

    } catch (error) {
        console.error("Erreur AI Server:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;