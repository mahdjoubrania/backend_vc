const db = require('../config/db');

// 6. Enregistrer un véhicule
exports.createVehicle = async (req, res) => {
  const { clientId, make, model, year, licensePlate, vinNumber, color } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO vehicules (client_id, make, model, license_plate, vin_number) VALUES (?, ?, ?, ?, ?)',
      [clientId, make, model || '', licensePlate, vinNumber || null]
    );
    res.status(201).json({ message: 'Véhicule enregistré', vehicleId: result.insertId });
  } catch (err) {
    console.error('Error in createVehicle:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 7. Obtenir les véhicules d'un client
exports.getClientVehicles = async (req, res) => {
  const { clientId } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM vehicules WHERE client_id = ?', [clientId]);
    res.json(rows);
  } catch (err) {
    console.error('Error in getClientVehicles:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 8. Modifier un véhicule
exports.updateVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  const { make, model, year, licensePlate, vinNumber, color } = req.body;
  try {
    await db.query('UPDATE vehicules SET make = COALESCE(?, make), model = COALESCE(?, model), license_plate = COALESCE(?, license_plate), vin_number = COALESCE(?, vin_number) WHERE id = ?', [make, model, licensePlate, vinNumber, vehicleId]);
    res.json({ message: 'Véhicule mis à jour' });
  } catch (err) {
    console.error('Error in updateVehicle:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 9. Supprimer un véhicule
exports.deleteVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  try {
    // Un véhicule déjà contrôlé ne peut pas être supprimé (cela effaçait en cascade RDV + rapports,
    // y compris ceux d'autres clients ayant possédé le même véhicule)
    const [used] = await db.query('SELECT COUNT(*) AS n FROM appointments WHERE vehicle_id = ?', [vehicleId]);
    if (used[0].n > 0) {
      return res.status(409).json({ message: `Suppression impossible : ce véhicule figure dans ${used[0].n} rendez-vous (historique et rapports conservés).` });
    }
    const [r] = await db.query('DELETE FROM vehicules WHERE id = ?', [vehicleId]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Véhicule introuvable.' });
    res.json({ message: 'Véhicule supprimé' });
  } catch (err) {
    console.error('Error in deleteVehicle:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 10. Transférer la propriété du véhicule
exports.transferVehicleOwner = async (req, res) => {
  const { vehicleId } = req.params;
  const { newClientId } = req.body;
  try {
    await db.query('UPDATE vehicules SET client_id = ? WHERE id = ?', [newClientId, vehicleId]);
    res.json({ message: 'Propriétaire transféré' });
  } catch (err) {
    console.error('Error in transferVehicleOwner:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};