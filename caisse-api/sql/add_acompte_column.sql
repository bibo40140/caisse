-- Migration: Ajout de la colonne acompte dans la table ventes
-- Cette colonne permet de stocker le montant des acomptes déduits lors d'une vente

ALTER TABLE ventes 
ADD COLUMN IF NOT EXISTS acompte numeric(12,2) DEFAULT 0;

-- Commentaire pour documentation
COMMENT ON COLUMN ventes.acompte IS 'Montant des acomptes déduits du total de la vente';
