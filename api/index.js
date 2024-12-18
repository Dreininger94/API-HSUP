const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Permettre toutes les origines
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Permettre les méthodes
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Permettre les en-têtes
  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // Répondre aux requêtes prévol (OPTIONS)
  }
  next();
});
app.use((req, res, next) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  res.setHeader('Content-Security-Policy', "default-src 'self' https:");
  next();
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // Réponse immédiate aux requêtes OPTIONS
  }
  next();
});

// L'URL de votre Google Sheet publié en CSV
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTayTaljYkULe2IjTfrRjvKP7tR8BClz7aEiCyMFNRC8x594c_YGCuHoLgeaVXYmkqhQNQA1Baewypk/pub?output=csv';
// Ne pas utiliser le cache de Google Sheets
const urlWithCacheBuster = `${SHEET_URL}&nocache=${Date.now()}`;
const response = await axios.get(urlWithCacheBuster);


// Fonction pour récupérer les données de la Google Sheet
async function fetchData() {
  try {
    console.log('Fetching data from:', SHEET_URL); // Log : URL de la Google Sheet
    const response = await axios.get(SHEET_URL);
    console.log('Data fetched successfully:', response.data); // Log : Données brutes récupérées

    const rows = response.data.split('\n').map(row => row.split(','));
    console.log('Parsed rows:', rows); // Log : Données après parsing

    return rows.reduce((acc, [serial, date]) => {
      acc[serial.trim()] = date.trim();
      return acc;
    }, {});
  } catch (error) {
    console.error('Erreur lors de la récupération des données:', error.response?.status, error.response?.data);
    throw error;
  }
}

// Route pour gérer les requêtes favicon.ico et éviter les erreurs dans les logs
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // Réponse vide avec statut 204 (No Content)
});

// Route racine pour vérifier que l'API fonctionne
app.get('/', (req, res) => {
  console.log('Route / hit'); // Log : Route /
  res.json({ message: "Bienvenue sur l'API SerialDate" });
});

// Route GET pour tester l'API
app.get('/api', (req, res) => {
  console.log('Route /api hit'); // Log : Route /api
  res.json({ message: "L'API fonctionne correctement" });
});

app.post('/test', (req, res) => {
  console.log('Test route hit');
  res.json({ message: 'Test route working', body: req.body });
});


// Route POST pour récupérer une date basée sur un numéro de série

app.post('/api/getDate', async (req, res) => {
  console.log('Request received at /api/getDate with body:', req.body); // Log : Corps de la requête
  console.log('Request received with body:', req.body); // Log du corps de la requête
  try {
    const { serial } = req.body;

    if (!serial) {
      console.log('Numéro de série manquant'); // Log : Pas de numéro de série
      return res.status(400).json({ status: 'Error', message: 'Numéro de série manquant' });
    }

    const data = await fetchData();
    console.log('Fetched data:', data); // Log : Données récupérées depuis Google Sheet
    const date = data[serial];

    if (date) {
      console.log('Date found for serial:', serial, '->', date); // Log : Date trouvée
      res.json({ status: 'Success', date });
    } else {
      console.log('No date found for serial:', serial); // Log : Pas de date trouvée
      res.json({ status: 'None', message: 'Aucune date trouvée pour ce numéro de série' });
    }
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
  }
});

// Exportation de l'application pour Vercel
module.exports = app;

// Démarrage du serveur pour un environnement de développement local
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
}
