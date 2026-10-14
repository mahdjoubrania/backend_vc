-- =========================================================
-- VérifCar — Réservations en ligne (site public)
-- À exécuter UNE FOIS sur la base (local puis Railway).
-- Ne modifie aucune table existante.
-- =========================================================

CREATE TABLE IF NOT EXISTS online_bookings (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  reference        VARCHAR(20)  NOT NULL,               -- ex. VC-261013-K7QZ (affiché au client)
  full_name        VARCHAR(100) NOT NULL,
  phone            VARCHAR(20)  NOT NULL,               -- format local 0XXXXXXXXX
  vehicle          VARCHAR(100) NOT NULL,               -- marque / modèle saisis par le client
  vin              VARCHAR(17)  NOT NULL,               -- N° de châssis (17 caractères, vérifié par le serveur)
  plate            VARCHAR(40)  NULL,                   -- immatriculation / année (optionnel)
  service_id       VARCHAR(30)  NOT NULL,               -- complete, scanner, moteur, ...
  service_label    VARCHAR(100) NOT NULL,               -- libellé FR enregistré dans appointments.service_type
  appointment_date DATETIME     NOT NULL,               -- heure d'Alger
  transaction_ref  VARCHAR(40)  NOT NULL,               -- N° de transaction BaridiMob
  message          TEXT         NULL,
  lang             CHAR(2)      NOT NULL DEFAULT 'fr',
  status           ENUM('PENDING_REVIEW','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
  reject_reason    VARCHAR(255) NULL,
  reviewed_by      INT          NULL,                   -- users.id de la réception / admin
  reviewed_at      DATETIME     NULL,
  appointment_id   INT          NULL,                   -- RDV créé à l'acceptation
  client_ip        VARCHAR(45)  NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_bookings_reference (reference),
  UNIQUE KEY uq_online_bookings_tx (transaction_ref),   -- un reçu = une seule réservation
  KEY idx_online_bookings_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reçu de paiement (séparé pour garder la liste des demandes légère)
CREATE TABLE IF NOT EXISTS booking_receipts (
  booking_id  INT          NOT NULL PRIMARY KEY,
  mime_type   VARCHAR(40)  NOT NULL,                    -- image/jpeg, image/png, image/webp, application/pdf
  size_bytes  INT          NOT NULL,
  data        MEDIUMBLOB   NOT NULL,                    -- 5 Mo max (contrôlé par le serveur)
  CONSTRAINT fk_booking_receipts_booking
    FOREIGN KEY (booking_id) REFERENCES online_bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- SI vous avez DÉJÀ exécuté la version précédente de ce fichier
-- (table online_bookings créée sans la colonne vin), exécutez seulement :
--
--   ALTER TABLE online_bookings ADD COLUMN vin VARCHAR(17) NOT NULL DEFAULT '' AFTER vehicle;
-- ---------------------------------------------------------
