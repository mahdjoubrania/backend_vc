const db = require('../config/db');
const bcrypt = require('bcryptjs');

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
    res.status(500).json({ message: err.message });
  }
};

// 7. Obtenir les véhicules d'un client
exports.getClientVehicles = async (req, res) => {
  const { clientId } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM vehicules WHERE client_id = ?', [clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    res.status(500).json({ message: err.message });
  }
};

// 9. Supprimer un véhicule
exports.deleteVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  try {
    await db.query('DELETE FROM vehicules WHERE id = ?', [vehicleId]);
    res.json({ message: 'Véhicule supprimé' });
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    res.status(500).json({ message: err.message });
  }
};