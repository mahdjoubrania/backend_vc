const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/generate-summary', async (req, res) => {
    try {
        const data = req.body;

        const prompt = `
Vous êtes un expert automobile senior chez VERIFCAR.
Analyse les données suivantes et génère un objet JSON valide contenant 4 résumés courts et clairs (en Français, max 2 phrases par résumé) :

1. carrosserie_summary: Analyse des éléments extérieurs (Défauts détectés: ${JSON.stringify(data.elements_ext_json || {})}). Si aucun défaut, indiquez que la carrosserie est excellente.
2. structure_summary: État de la structure (Longerons: ${data.longerons_status || 'Conforme'}, Châssis: ${data.chassis_status || 'Conforme'}, Conclusion: ${data.conclusion_structure || 'Aucun accident'}).
3. suspension_summary: État des pneus, jantes et soubassement (Corrosion: ${data.corrosion_soubassement ? 'Oui' : 'Non'}, Choc dessous: ${data.traces_choc ? 'Oui' : 'Non'}).
4. conclusion_generale: Résumé global et conseil rapide pour l'acheteur.

Format de réponse attendu (JSON uniquement) :
{
  "carrosserie_summary": "...",
  "structure_summary": "...",
  "suspension_summary": "...",
  "conclusion_generale": "..."
}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        const resultJson = JSON.parse(response.text);
        res.json({ success: true, data: resultJson });

    } catch (error) {
        console.error("Erreur AI:", error);
        res.status(500).json({ success: false, message: "Erreur de génération" });
    }
});

module.exports = router;