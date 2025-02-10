require('dotenv').config(); // Charger les variables d'environnement depuis .env
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios'); // Pour récupérer les informations géographiques
const app = express();
app.use(express.json());

// Variables d'environnement
const DATA_SHEET_ID = process.env.DATA_SHEET_ID; // ID de la feuille des numéros de série
const LOG_SHEET_ID = process.env.LOG_SHEET_ID;   // ID de la feuille des logs
const DATA_SHEET_NAME = 'Feuille 1';            // Nom de l'onglet pour les données
const LOG_SHEET_NAME = 'Feuille 1';             // Nom de l'onglet pour les logs

// Authentification Google Sheets
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Fonction pour extraire l'IP réelle du client
function getClientIp(req) {
    // Vérifier si l'en-tête 'x-forwarded-for' existe
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // L'en-tête 'x-forwarded-for' peut contenir plusieurs IPs (proxy chain)
        return forwardedFor.split(',')[0].trim(); // Prendre la première IP
    }

    // Sinon, utiliser req.ip ou req.connection.remoteAddress
    return req.ip || req.connection?.remoteAddress || 'Unknown';
}

// Route principale pour tester si l'API est en ligne
app.get('/', (req, res) => {
    res.send('API is running!');
});

// Route pour /api/getdate
app.post('/api/getdate', async (req, res) => {
    try {
        const { serial, uuid } = req.body;

        // Vérifier que les champs requis sont présents
        if (!serial || !uuid) {
            return res.status(400).json({ status: 'Error', message: 'Numéro de série ou UUID manquant' });
        }

        console.log('Requête reçue :', { serial, uuid });

        // Authentifier avec Google Sheets
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Lire les données depuis la feuille des numéros de série
        console.log('Tentative de lecture depuis DATA_SHEET_ID :', DATA_SHEET_ID);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: DATA_SHEET_ID,
            range: `${DATA_SHEET_NAME}!A:B`, // Colonne A : Numéros de série, Colonne B : Dates
        });

        const rows = response.data.values || [];
        console.log('Données lues depuis Google Sheets :', rows);

        let foundDate = null;
        for (const row of rows) {
            const sheetSerial = row[0];
            const sheetDate = row[1];
            console.log('Vérification du numéro de série :', sheetSerial, 'avec la date :', sheetDate);
            if (sheetSerial === serial) {
                foundDate = sheetDate;
                break;
            }
        }

        if (foundDate) {
            console.log('Numéro de série trouvé. Date associée :', foundDate);
            // Récupérer l'IP réelle du client
            const ip = getClientIp(req);
            const geoInfo = await getGeoInfo(ip);

            // Écrire les logs dans la feuille des logs
            console.log('Tentative d\'écriture dans LOG_SHEET_ID :', LOG_SHEET_ID);
            await logToGoogleSheet(serial, foundDate, ip, geoInfo.country, geoInfo.city, true, uuid);

            return res.json({ status: 'Success', date: foundDate });
        } else {
            console.log('Numéro de série non trouvé.');
            // Récupérer l'IP réelle du client
            const ip = getClientIp(req);
            const geoInfo = await getGeoInfo(ip);
            await logToGoogleSheet(serial, null, ip, geoInfo.country, geoInfo.city, false, uuid);

            return res.status(404).json({ status: 'None', message: 'Aucune date trouvée pour ce numéro de série' });
        }
    } catch (error) {
        console.error('Erreur sur /api/getdate:', error.message);
        console.error('Détails de l\'erreur :', error.stack);
        return res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
    }
});

// Fonction pour extraire les informations utilisateur, machine et compteur de copies depuis l'UUID
function extractUserMachineFromUUID(uuid) {
    try {
        // Extraire les informations en utilisant des mots-clés spécifiques
        const userMatch = uuid.match(/User-([^-\n]+)/);
        const machineMatch = uuid.match(/Machine-([^-\n]+)/);
        const copyMatch = uuid.match(/Copy-(\d+)/);

        // Récupérer les valeurs correspondantes
        const user = userMatch ? userMatch[1] : 'Unknown';
        const machine = machineMatch ? machineMatch[1] : 'Unknown';
        const copy = copyMatch ? parseInt(copyMatch[1], 10) : 0;

        // Retourner les valeurs extraites
        return [user, machine, isNaN(copy) ? 0 : copy];
    } catch (error) {
        console.error("Erreur dans extractUserMachineFromUUID :", error.message);
        return ["Unknown", "Unknown", 0]; // Valeurs par défaut en cas d'erreur
    }
}

// Fonction pour récupérer les informations géographiques à partir de l'IP
async function getGeoInfo(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        const data = response.data;

        if (data.status === 'success') {
            return {
                country: data.country || 'Unknown',
                city: data.city || 'Unknown',
            };
        } else {
            return {
                country: 'Unknown',
                city: 'Unknown',
            };
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des informations géographiques :', error.message);
        return {
            country: 'Unknown',
            city: 'Unknown',
        };
    }
}

// Fonction pour écrire les logs dans la feuille des logs
async function logToGoogleSheet(serial, date, ip, country, city, success, uuid) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Extraire les informations de l'UUID
        const [user, machine, copy] = extractUserMachineFromUUID(uuid);

        // Obtenir le timestamp actuel en UTC
        const timestampUTC = new Date();

        // Ajuster le timestamp vers le fuseau horaire de Paris
        const parisTime = adjustToParisTime(timestampUTC);

        // Découper le timestamp en composantes (année, mois, jour, heure)
        const year = parisTime.getFullYear();
        const month = parisTime.getMonth() + 1; // Les mois commencent à 0
        const day = parisTime.getDate();
        const hour = `${parisTime.getHours()}:${String(parisTime.getMinutes()).padStart(2, '0')}`;

        // Préparer les données à écrire
        const logData = [
            year,                       // Année
            month,                      // Mois
            day,                        // Jour
            hour,                       // Heure (Paris)
            user,                       // Utilisateur
            machine,                    // Machine
            copy,                       // Copie
            ip,                         // IP
            country,                    // Pays
            city,                       // Ville
            serial,                     // Numéro de série
            success ? date : 'Échec',   // Résultat (date ou "Échec")
            success ? 'Succès' : 'Échec'// Statut (Succès ou Échec)
        ];

        console.log('Appending data to Google Sheet:', logData);
        await sheets.spreadsheets.values.append({
            spreadsheetId: LOG_SHEET_ID,
            range: `${LOG_SHEET_NAME}!A:M`, // Ajustez selon vos colonnes
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

// Fonction pour ajuster au fuseau horaire de Paris
function adjustToParisTime(date) {
    const parisTimeZone = 'Europe/Paris';
    return new Date(date.toLocaleString('en-US', { timeZone: parisTimeZone }));
}

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});