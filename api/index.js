require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// Charger les clés depuis la variable d'environnement
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ID de la Google Sheet et du nom de l'onglet
const SHEET_ID = '1OCg5HXI0MhsFMGmDUkkomh3ti-ux5sk03rGiIEFYc1s';
const SHEET_NAME = 'Feuille 1';

// URL de votre Google Sheet publié en CSV
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTayTaljYkULe2IjTfrRjvKP7tR8BClz7aEiCyMFNRC8x594c_YGCuHoLgeaVXYmkqhQNQA1Baewypk/pub?output=csv';

// Fonction pour récupérer les données de la Google Sheet
async function fetchData() {
    try {
        console.log('Fetching data from:', SHEET_URL);
        const response = await axios.get(SHEET_URL);
        console.log('Data fetched successfully:', response.data);

        // Split rows and clean up data
        const rows = response.data
            .split('\n')
            .map(row => row.split(','))
            .filter(row => row[0]?.trim() && row[1]?.trim()); // Ignore empty or invalid rows

        console.log('Parsed rows:', rows);
        return rows.reduce((acc, [serial, date]) => {
            acc[serial?.trim()] = date?.trim();
            return acc;
        }, {});
    } catch (error) {
        console.error('Erreur lors de la récupération des données:', error.message);
        console.error('Détails de l\'erreur:', error.stack);
        throw error;
    }
}

// Fonction pour récupérer les informations géographiques de l'utilisateur
async function getClientInfo(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (ip === '::1' || ip.startsWith('127.')) {
        console.warn('Adresse IP locale détectée. Les informations géographiques seront marquées comme "Inconnu".');
        return { ip: 'localhost', country: 'Inconnu', city: 'Inconnu' };
    }
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}`);
        const data = await response.json();
        if (data.status === 'fail') {
            console.warn('Impossible de récupérer les informations géographiques:', data.message);
            return { ip, country: 'Inconnu', city: 'Inconnu' };
        }
        return {
            ip,
            country: data.country || 'Inconnu',
            city: data.city || 'Inconnu',
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des informations géographiques:', error);
        return { ip, country: 'Inconnu', city: 'Inconnu' };
    }
}

// Fonction pour écrire dans la Google Sheet
async function logToGoogleSheet(serial, date, clientInfo, success) {
    try {
        console.log('Authenticating with Google...');
        const authClient = await auth.getClient();
        console.log('Authenticated successfully.');

        console.log('Initializing Google Sheets API...');
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        console.log('Google Sheets API initialized.');

        const timestamp = new Date().toISOString();
        const logData = [
            timestamp,
            clientInfo.ip,
            clientInfo.country,
            clientInfo.city,
            serial,
            success ? date : 'Échec',
            success ? 'Succès' : 'Échec',
        ];

        console.log('Appending data to Google Sheet:', logData);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A:H`, // Ajustez selon vos colonnes
            valueInputOption: 'RAW',
            requestBody: {
                values: [logData],
            },
        });

        console.log('Log ajouté avec succès à la Google Sheet');
    } catch (error) {
        console.error('Erreur lors de l’écriture dans la Google Sheet:', error.message);
        console.error('Détails de l\'erreur:', error.stack); // Ajoutez les détails de l'erreur pour un diagnostic plus précis
    }
}

// Route POST pour récupérer une date basée sur un numéro de série
app.post('/api/getDate', async (req, res) => {
    console.log('Request received at /api/getDate with body:', req.body);

    try {
        const { serial } = req.body;

        if (!serial) {
            console.log('Numéro de série manquant');
            return res.status(400).json({ status: 'Error', message: 'Numéro de série manquant' });
        }

        // Récupérer les informations géographiques
        const clientInfo = await getClientInfo(req);
        console.log(`Request from ${clientInfo.ip} (${clientInfo.country}, ${clientInfo.city})`);

        // Récupérer les données depuis Google Sheets
        const data = await fetchData(); // Appel direct à fetchData sans cache
        const date = data[serial];

        // Écrire les logs dans Google Sheets
        await logToGoogleSheet(serial, date, clientInfo, !!date);

        if (date) {
            console.log('Date trouvée:', date);
            res.json({ status: 'Success', date });
        } else {
            console.log('Aucune date trouvée');
            res.json({ status: 'None', message: 'Aucune date trouvée pour ce numéro de série' });
        }
    } catch (error) {
        console.error('Erreur sur /api/getDate:', error.message);
        res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
    }
});

// Route racine pour vérifier que l'API fonctionne
app.get('/', (req, res) => {
    console.log('Route / hit'); // Log : Route /
    try {
        res.json({ message: "Bienvenue sur l'API SerialDate" });
    } catch (error) {
        console.error('Erreur sur la route /:', error.message);
        res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
    }
});

// Route GET pour tester l'API
app.get('/api', (req, res) => {
    console.log('Route /api hit'); // Log : Route /api
    res.json({ message: "L'API fonctionne correctement" });
});

// Exportation de l'application pour Vercel
module.exports = app;

// Démarrage du serveur pour un environnement de développement local
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
}