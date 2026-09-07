const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/generate-summary', async (req, res) => {
    try {
        const data = req.body;

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
            model: 'gemini-1.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        const resultJson = JSON.parse(response.text);
        res.json({ success: true, data: resultJson });

    } catch (error) {
        console.error("Erreur AI Server:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;