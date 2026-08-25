const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'VerifCar REST API',
    version: '1.0.0',
    description: 'Documentation et test des API REST (Admin & Réception)'
  },
  paths: {
    // === AUTH ===
    '/api/auth/login': {
      post: {
        summary: 'Connexion utilisateur',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  role: { type: 'string', example: 'ADMIN' },
                  password: { type: 'string', example: '123456' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Connexion réussie' } }
      }
    },
    
    // === ADMIN - USERS ===
    '/api/admin/users': {
      get: {
        summary: '1. Récupérer tous les utilisateurs',
        tags: ['Admin Users'],
        responses: { 200: { description: 'Liste des utilisateurs' } }
      },
      post: {
        summary: '2. Créer un nouvel utilisateur',
        tags: ['Admin Users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string', example: 'Karim Ahmed' },
                  phone: { type: 'string', example: '0550123456' },
                  role: { type: 'string', example: 'RECEPTION' },
                  password: { type: 'string', example: '123456' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Utilisateur créé avec succès' } }
      }
    },
    '/api/admin/users/{userId}': {
      put: {
        summary: '3. Modifier un utilisateur',
        tags: ['Admin Users'],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string', example: 'Karim Ahmed' },
                  phone: { type: 'string', example: '0550123456' },
                  role: { type: 'string', example: 'RECEPTION' },
                  isActive: { type: 'integer', example: 1 }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Modifications enregistrées' } }
      },
      delete: {
        summary: '4. Désactiver un utilisateur',
        tags: ['Admin Users'],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        responses: { 200: { description: 'Compte désactivé' } }
      }
    },

    // === APPOINTMENTS & ANALYTICS ===
    '/api/admin/rdv-analytics': {
      get: {
        summary: 'Statistiques analytiques des RDV (Graphiques)',
        tags: ['Analytics & RDV'],
        responses: { 200: { description: 'Statistiques récupérées avec succès' } }
      }
    },
    '/api/admin/dashboard-summary': {
      get: {
        summary: 'Résumé du Tableau de bord Admin (Utilisateurs, Revenus, Tickets récents)',
        tags: ['Analytics & RDV'],
        responses: { 200: { description: 'Données du tableau de bord' } }
      }
    },
    '/api/admin/appointments/{id}/status': {
      put: {
        summary: 'Mettre à jour le statut d un RDV',
        tags: ['Analytics & RDV'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                    clientName: { type: 'string', example: 'Mohamed Ali' },
                  phone: { type: 'string', example: '0661234567' },
                  vin: { type: 'string', example: 'WVWZZZ1KZAW000000' },
                  make: { type: 'string', example: 'Volkswagen' },
                  model: { type: 'string', example: 'Golf 7' },
                  licensePlate: { type: 'string', example: '00123-120-16' },
                  appointmentDate: { type: 'string', example: '2026-08-20 10:00:00' },
                  totalAmount: { type: 'number', example: 15000 },
                  versement: { type: 'number', example: 5000 },
                  paymentStatus: { type: 'string', example: 'ADVANCE_PAID' },
                  status: { type: 'string', example: 'PENDING' },
                  typedeverification:{type: 'string', example: 'VÉRIFICATION COMPLÈTE' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Statut mis à jour' } }
      }
    },
    '/api/admin/appointments': {
      get: {
        summary: 'Récupérer la liste des RDV pour le calendrier',
        tags: ['Analytics & RDV'],
        responses: { 200: { description: 'Liste des RDV au format événements' } }
      },
      post: {
        summary: 'Créer un nouveau rendez-vous (Auto-check Client & Véhicule)',
        tags: ['Analytics & RDV'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  clientName: { type: 'string', example: 'Mohamed Ali' },
                  phone: { type: 'string', example: '0661234567' },
                  vin: { type: 'string', example: 'WVWZZZ1KZAW000000' },
                  make: { type: 'string', example: 'Volkswagen' },
                  model: { type: 'string', example: 'Golf 7' },
                  licensePlate: { type: 'string', example: '00123-120-16' },
                  appointmentDate: { type: 'string', example: '2026-08-20 10:00:00' },
                  totalAmount: { type: 'number', example: 15000 },
                  versement: { type: 'number', example: 5000 },
                  paymentStatus: { type: 'string', example: 'ADVANCE_PAID' },
                  status: { type: 'string', example: 'PENDING' },
                  typedeverification:{type: 'string', example: 'VÉRIFICATION COMPLÈTE' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Rendez-vous créé avec succès' } }
      }
    },

    // === RECEPTION (CLIENTS) ===
    '/api/auth/clients': {
      post: {
        summary: '[Réception] Enregistrer un client',
        tags: ['Réception - Clients'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string', example: 'Mohamed Ali' },
                  phone: { type: 'string', example: '0661234567' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Client créé' } }
      }
    },
    '/api/auth/clients/search': {
      get: {
        summary: '[Réception] Rechercher un client',
        tags: ['Réception - Clients'],
        parameters: [
          { name: 'query', in: 'query', required: true, schema: { type: 'string' }, example: 'rania' }
        ],
        responses: { 200: { description: 'Résultats de recherche' } }
      }
    },
    '/api/auth/clients/{clientId}': {
      put: {
        summary: '[Réception] Modifier un client',
        tags: ['Réception - Clients'],
        parameters: [
          { name: 'clientId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string', example: 'Mohamed Ali' },
                  phone: { type: 'string', example: '0661999888' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Client mis à jour' } }
      },
      delete: {
        summary: '[Réception] Supprimer un client',
        tags: ['Réception - Clients'],
        parameters: [
          { name: 'clientId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        responses: { 200: { description: 'Client supprimé' } }
      }
    },

    // === RECEPTION (VEHICULES) ===
    '/api/auth/vehicles': {
      post: {
        summary: '[Réception] Enregistrer un nouveau véhicule',
        tags: ['Réception - Véhicules'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  clientId: { type: 'integer', example: 1 },
                  make: { type: 'string', example: 'Volkswagen' },
                  model: { type: 'string', example: 'Golf 7' },
                  licensePlate: { type: 'string', example: '00123-120-16' },
                  vinNumber: { type: 'string', example: 'WVWZZZ1KZAW000000' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Véhicule enregistré' } }
      }
    },
    '/api/auth/clients/{clientId}/vehicles': {
      get: {
        summary: '[Réception] Obtenir les véhicules d\'un client',
        tags: ['Réception - Véhicules'],
        parameters: [
          { name: 'clientId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        responses: { 200: { description: 'Liste des véhicules du client' } }
      }
    },
    '/api/auth/vehicles/{vehicleId}': {
      put: {
        summary: '[Réception] Modifier un véhicule',
        tags: ['Réception - Véhicules'],
        parameters: [
          { name: 'vehicleId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  make: { type: 'string', example: 'Volkswagen' },
                  model: { type: 'string', example: 'Golf 7' },
                  licensePlate: { type: 'string', example: '00123-120-16' },
                  vinNumber: { type: 'string', example: 'WVWZZZ1KZAW000000' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Véhicule mis à jour' } }
      },
      delete: {
        summary: '[Réception] Supprimer un véhicule',
        tags: ['Réception - Véhicules'],
        parameters: [
          { name: 'vehicleId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        responses: { 200: { description: 'Véhicule supprimé' } }
      }
    },
    '/api/auth/vehicles/{vehicleId}/transfer': {
      put: {
        summary: '[Réception] Transférer le véhicule à un autre client (Changer de propriétaire)',
        tags: ['Réception - Véhicules'],
        parameters: [
          { name: 'vehicleId', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  newClientId: { type: 'integer', example: 2 }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Propriétaire transféré' } }
      }
    }
  }
};

module.exports = function (app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};