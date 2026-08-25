const db = require('../config/db');
const bcrypt = require('bcryptjs');

// 2. Enregistrer un client
exports.createClient = async (req, res) => {
  const { fullName, phone } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO clients (full_name, phone) VALUES (?, ?)', 
      [fullName, phone]
    );
    res.status(201).json({ message: 'Client créé', clientId: result.insertId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Rechercher un client
exports.searchClient = async (req, res) => {
  const { query } = req.query;
  try {
    const [rows] = await db.query(
      'SELECT * FROM clients WHERE phone LIKE ? OR full_name LIKE ?', 
      [`%${query}%`, `%${query}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. Modifier un client
exports.updateClient = async (req, res) => {
  const { clientId } = req.params;
  const { fullName, phone } = req.body;
  try {
    await db.query(
      'UPDATE clients SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?', 
      [fullName, phone, clientId]
    );
    res.json({ message: 'Client mis à jour' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. Supprimer un client

exports.deleteClient = async (req, res) => {
  const { clientId } = req.params;
  try {
    await db.query('DELETE FROM clients WHERE id = ?', [clientId]);
    res.json({ message: 'Client supprimé' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.getAllClients = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone,
        COUNT(DISTINCT a.id) as rdv_count,
        JSON_ARRAYAGG(
          IF(v.id IS NOT NULL, 
            JSON_OBJECT(
              'id', v.id, 
              'make', COALESCE(v.make, ''), 
              'model', COALESCE(v.model, ''), 
              'license_plate', COALESCE(v.license_plate, ''), 
              'vin_number', COALESCE(v.vin_number, '')
            ), 
            NULL
          )
        ) as raw_vehicles
      FROM clients c
      LEFT JOIN appointments a ON a.client_id = c.id
      LEFT JOIN vehicules v ON v.client_id = c.id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    const clients = rows.map(c => {
      // تصفية القيم الفارغة من مصفوفة السيارات
      const vehicles = (c.raw_vehicles || []).filter(v => v !== null);
      const vehicles_info = vehicles.map(v => `${v.make} ${v.model} ${v.license_plate} ${v.vin_number}`).join(' ');

      return {
        id: c.id,
        full_name: c.full_name,
        phone: c.phone,
        rdv_count: c.rdv_count,
        vehicles: vehicles,
        vehicles_info: vehicles_info
      };
    });

    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des clients' });
  }
};