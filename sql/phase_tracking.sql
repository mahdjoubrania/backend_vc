-- =========================================================
-- VérifCar — Suivi des réservations + notification WhatsApp
-- À exécuter UNE FOIS (local puis Railway), APRÈS phase_pricing.sql
-- (si une colonne existe déjà, ignorez l'erreur "Duplicate column")
-- =========================================================

ALTER TABLE online_bookings
  ADD COLUMN notify_status VARCHAR(16)  NULL AFTER appointment_id,   -- SENT | FAILED | INVALID_PHONE
  ADD COLUMN notify_error  VARCHAR(255) NULL AFTER notify_status,
  ADD COLUMN notified_at   DATETIME     NULL AFTER notify_error;
