-- =========================================================
-- VérifCar — Tarifs, promotions et fidélité (gérés par l'ADMIN)
-- À exécuter UNE FOIS (local puis Railway), APRÈS phase_online_bookings.sql
-- =========================================================

-- 1) Catalogue des prestations et prix de base (DZD)
CREATE TABLE IF NOT EXISTS services (
  id          VARCHAR(30)  NOT NULL PRIMARY KEY,           -- complete, scanner, moteur, ...
  label_fr    VARCHAR(100) NOT NULL,
  label_ar    VARCHAR(100) NOT NULL,
  label_en    VARCHAR(100) NOT NULL,
  base_price  INT          NULL,                            -- NULL = pas encore fixé → non réservable en ligne
  active      TINYINT(1)   NOT NULL DEFAULT 1,              -- 0 = masqué du site
  sort_order  INT          NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO services (id, label_fr, label_ar, label_en, base_price, sort_order) VALUES
  ('complete',    'Inspection complète (6 modules)', 'فحص شامل (6 وحدات)',      'Full inspection (6 modules)', 18000, 1),
  ('scanner',     'Scanner Diagnostique',            'التشخيص بالسكانير',       'Diagnostic Scanner',          NULL,  2),
  ('moteur',      'Inspection Moteur',               'فحص المحرك',              'Engine inspection',           NULL,  3),
  ('suspension',  'Inspection Suspension',           'فحص نظام التعليق والعجلات', 'Suspension inspection',     NULL,  4),
  ('tole',        'Inspection Tôle',                 'فحص الهيكل والطلاء',      'Bodywork inspection',         NULL,  5),
  ('kilometrage', 'Inspection Kilométrage',          'فحص العدّاد',             'Mileage inspection',          NULL,  6);

-- 2) Promotions (sur une prestation ou sur toutes), avec dates optionnelles
CREATE TABLE IF NOT EXISTS promotions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  service_id  VARCHAR(30)  NULL,                            -- NULL = toutes les prestations
  percent     DECIMAL(5,2) NOT NULL,                        -- 0 < percent <= 90
  label       VARCHAR(100) NOT NULL,                        -- ex. "Offre de lancement"
  starts_on   DATE         NULL,                            -- NULL = immédiat
  ends_on     DATE         NULL,                            -- NULL = sans fin (inclus)
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_promotions_service (service_id, active),
  CONSTRAINT fk_promotions_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offre actuelle : -50 % sur l'inspection complète (18 000 → 9 000 DA)
INSERT INTO promotions (service_id, percent, label)
SELECT 'complete', 50, 'Offre de lancement'
WHERE NOT EXISTS (SELECT 1 FROM promotions);

-- 3) Règle de fidélité automatique (une seule ligne)
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id             TINYINT      NOT NULL PRIMARY KEY DEFAULT 1,
  enabled        TINYINT(1)   NOT NULL DEFAULT 1,
  min_completed  INT          NOT NULL DEFAULT 2,           -- nb d'inspections TERMINÉES pour devenir fidèle
  percent        DECIMAL(5,2) NOT NULL DEFAULT 10,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO loyalty_settings (id, enabled, min_completed, percent) VALUES (1, 1, 2, 10);

-- 4) Fidélité manuelle par client : NULL = règle automatique ; 0 = exclu ; >0 = % forcé
--    (si la colonne existe déjà, ignorez l'erreur "Duplicate column")
ALTER TABLE clients ADD COLUMN loyalty_percent DECIMAL(5,2) NULL;

-- 5) Montant calculé pour chaque réservation en ligne
ALTER TABLE online_bookings
  ADD COLUMN base_price       INT          NULL AFTER service_label,
  ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER base_price,
  ADD COLUMN discount_source  VARCHAR(10)  NULL AFTER discount_percent,   -- PROMO | LOYALTY
  ADD COLUMN discount_label   VARCHAR(100) NULL AFTER discount_source,
  ADD COLUMN amount_due       INT          NULL AFTER discount_label;
