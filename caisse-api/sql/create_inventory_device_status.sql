-- Table pour tracker le statut de chaque device dans une session d'inventaire
-- Permet de savoir qui a terminé ses comptages avant la clôture

CREATE TABLE IF NOT EXISTS inventory_device_status (
  session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'counting', -- 'counting', 'finished'
  last_activity TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP,
  PRIMARY KEY (session_id, device_id),
  FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_device_status_session 
  ON inventory_device_status(session_id);

CREATE INDEX IF NOT EXISTS idx_inventory_device_status_tenant 
  ON inventory_device_status(tenant_id);

-- Nettoyer les anciennes données (plus de 30 jours)
DELETE FROM inventory_device_status 
WHERE last_activity < NOW() - INTERVAL '30 days';
