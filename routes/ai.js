const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

// 1. إعداد الـ Client (تأكدي من كتابة apiKey بحرف K كبير)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/generate-summary', async (req, res) => {
    try {
        const inspectionData = req.body;

        const prompt = `
Vous êtes un expert automobile senior chez VERIFCAR. 
Analysez les données d'inspection suivantes et rédigez une conclusion claire et professionnelle en 3 à 4 phrases (en Français) :

Données du véhicule:
- Modèle: ${inspectionData.brand || ''} ${inspectionData.model || ''} (${inspectionData.year || ''})
- Kilométrage: ${inspectionData.kilometrage_affiche || 'N/A'} KM
- Défauts Carrosserie: ${JSON.stringify(inspectionData.elements_ext_json || {})}
- État Structure: Longerons (${inspectionData.longerons_status || 'Conforme'}), Châssis (${inspectionData.chassis_status || 'Conforme'})
- Conclusion actuelle: ${inspectionData.conclusion_structure || 'Aucune'}

Consignes:
1. Donnez un résumé global de l'état du véhicule.
2. Mentionnez s'il y a eu des chocs majeurs ou si la structure est saine.
3. Donnez un conseil rapide à l'acheteur.
        `;

        // 2. استدعاء النموذج
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        res.json({ success: true, summary: response.text });
    } catch (error) {
        console.error("Erreur AI:", error);
        res.status(500).json({ success: false, message: "Erreur lors de la génération du résumé." });
    }
});

module.exports = router;