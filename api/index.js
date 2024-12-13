const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// L'URL de votre Google Sheet publié en CSV
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTayTaljYkULe2IjTfrRjvKP7tR8BClz7aEiCyMFNRC8x594c_YGCuHoLgeaVXYmkqhQNQA1Baewypk/pub?output=csv';
https://docs.google.com/spreadsheets/d/1iKbjNyN6jgTxwkhjz3avQ_CAuXGno8lcNyq9S_QAWq0/edit?usp=sharing
// Fonction pour récupérer les données de la Google Sheet
async function fetchData() {
  try {
    const response = await axios.get(SHEET_URL);
    const rows = response.data.split('\n').map(row => row.split(','));

    return rows.reduce((acc, [serial, date]) => {
      acc[serial.trim()] = date.trim();
      return acc;
    }, {});
  } catch (error) {
    console.error('Erreur lors de la récupération des données:', error);
    throw error;
  }
}

// Route racine pour vérifier que l'API fonctionne
app.get('/', (req, res) => {
  res.json({ message: "Bienvenue sur l'API SerialDate" });
});

// Route GET pour tester l'API
app.get('/api', (req, res) => {
  res.json({ message: "L'API fonctionne correctement" });
});

// Route POST pour récupérer une date basée sur un numéro de série
app.post('/api/getDate', async (req, res) => {
  try {
    const { serial } = req.body;

    if (!serial) {
      return res.status(400).json({ status: 'Error', message: 'Numéro de série manquant' });
    }

    const data = await fetchData();
    const date = data[serial];

    if (date) {
      res.json({ status: 'Success', date });
    } else {
      res.json({ status: 'None', message: 'Aucune date trouvée pour ce numéro de série' });
    }
  } catch (error) {
    console.error('Erreur serveur:', error);
    res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
  }
});

// Exportation de l'application pour Vercel
module.exports = app;

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


// Démarrage du serveur pour un environnement de développement local
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
}
