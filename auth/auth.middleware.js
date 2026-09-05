
function getAuthToken() {
  const sessionKeys = [
    'verifcar_technician_user',
    'verifcar_user',
    'verifcar_admin_user',
    'verifcar_reception_user'
  ];

  for (const key of sessionKeys) {
    const sessionData = localStorage.getItem(key);
    if (sessionData) {
      try {
        const parsed = JSON.parse(sessionData);
        if (parsed.token) return parsed.token;
        if (parsed.accessToken) return parsed.accessToken;
      } catch (e) {
        if (sessionData.length > 20) return sessionData;
      }
    }
  }

  return localStorage.getItem('token') || '';
}

// دالة حفظ الكيلومتراج مفتاح conformite مطابق للباك إند
async function saveKilometrageModule(e) {
  e.preventDefault();
  const payload = {
    inspection_id: currentInspectionId,
    kilometrage_affiche: document.getElementById('kilometrage_affiche').value,
    conformite: document.getElementById('conforme').value === "1",
    notes: document.getElementById('km_notes').value
  };
  await sendData('/inspection/kilometrage', payload);
}

// إرسال البيانات وإضافة ترويسة Authorization
async function sendData(endpoint, payload) {
  const token = getAuthToken();

  if (!token) {
    alert("Erreur: Utilisateur non authentifié. Veuillez vous re-connecter.");
    window.location.href = '../Auth/index.html';
    return;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok && (result.success || result.message)) {
      alert(result.message || 'Données enregistrées avec succès !');
    } else {
      alert('Erreur: ' + (result.error || result.message || 'Erreur lors de l\'enregistrement'));
    }
  } catch (err) {
    alert('Impossible de contacter le serveur');
    console.error(err);
  }
}