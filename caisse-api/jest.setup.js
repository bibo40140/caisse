// Fichier de configuration exécuté avant chaque test
// Charge les variables d'environnement depuis .env.test

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charge .env.test
config({ path: join(__dirname, '.env.test') });
