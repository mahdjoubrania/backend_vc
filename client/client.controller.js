const db = require('../config/db');

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
    console.error('Error in createClient:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
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
    console.error('Error in searchClient:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
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
    console.error('Error in updateClient:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};

// 5. Supprimer un client
exports.deleteClient = async (req, res) => {
  const { clientId } = req.params;
  try {
    await db.query('DELETE FROM clients WHERE id = ?', [clientId]);
    res.json({ message: 'Client supprimé' });
  } catch (err) {
    console.error('Error in deleteClient:', err);
    res.status(500).json({ message: 'Erreur serveur. Veuillez réessayer plus tard.' });
  }
};


exports.getAllClients = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone,
        COALESCE(rdv.rdv_count, 0) as rdv_count,
        COALESCE(veh.raw_vehicles, JSON_ARRAY()) as raw_vehicles
      FROM clients c
      LEFT JOIN (
        SELECT client_id, COUNT(*) as rdv_count
        FROM appointments
        GROUP BY client_id
      ) rdv ON rdv.client_id = c.id
      LEFT JOIN (
        SELECT client_id,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', id, 
              'make', COALESCE(make, ''), 
              'model', COALESCE(model, ''), 
              'license_plate', COALESCE(license_plate, ''), 
              'vin_number', COALESCE(vin_number, '')
            )
          ) as raw_vehicles
        FROM vehicules
        GROUP BY client_id
      ) veh ON veh.client_id = c.id
      ORDER BY c.id DESC
    `);

    const clients = rows.map(c => {
    
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