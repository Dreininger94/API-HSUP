const express = require('express');
const { google } = require('googleapis');
const axios = require('axios'); // Ajouter axios pour les requêtes HTTP
const app = express();
app.use(express.json());

// Variables d'environnement
const SHEET_ID = process.env.SHEET_ID; // ID de la feuille Google Sheets
const LOG_SHEET_NAME = 'Logs'; // Nom de l'onglet pour les logs
const DATA_SHEET_NAME = 'Data'; // Nom de l'onglet pour les données

// Authentification Google Sheets
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Fonction pour extraire les informations utilisateur, machine et compteur de copies depuis l'UUID
function extractUserMachineFromUUID(uuid) {
    try {
        // Vérifier que l'UUID commence par "User-" et contient "Machine-" et "Copy-"
        if (!uuid.startsWith("User-") || !uuid.includes("Machine-") || !uuid.includes("Copy-")) {
            console.error("Erreur : UUID mal formé", uuid);
            return ["Unknown", "Unknown", 0]; // Valeurs par défaut en cas d'erreur
        }

        // Extraire l'utilisateur (après "User-" jusqu'à "Machine-")
        const userStart = "User-".length;
        const userEnd = uuid.indexOf("-Machine-");
        const user = uuid.substring(userStart, userEnd);

        // Extraire la machine (après "Machine-" jusqu'à "Copy-")
        const machineStart = uuid.indexOf("-Machine-") + "-Machine-".length;
        const machineEnd = uuid.indexOf("-Copy-");
        const machine = uuid.substring(machineStart, machineEnd);

        // Extraire le compteur de copies (après "Copy-")
        const copyStart = uuid.indexOf("-Copy-") + "-Copy-".length;
        const copy = parseInt(uuid.substring(copyStart), 10);

        // Retourner les valeurs extraites
        return [user, machine, isNaN(copy) ? 0 : copy];
    } catch (error) {
        console.error("Erreur dans extractUserMachineFromUUID :", error.message);
        return ["Unknown", "Unknown", 0]; // Valeurs par défaut en cas d'erreur
    }
}

// Fonction pour ajuster au fuseau horaire de Paris
function adjustToParisTime(date) {
    const parisTimeZone = 'Europe/Paris';
    return new Date(date.toLocaleString('en-US', { timeZone: parisTimeZone }));
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

// Route pour /api/getdate
app.post('/api/getdate', async (req, res) => {
    try {
        const { serial, uuid } = req.body;

        // Vérifier que les champs requis sont présents
        if (!serial || !uuid) {
            return res.status(400).json({ status: 'Error', message: 'Numéro de série ou UUID manquant' });
        }

        // Authentifier avec Google Sheets
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Lire les données depuis la feuille Google Sheets
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${DATA_SHEET_NAME}!A:B`, // Colonne A : Numéros de série, Colonne B : Dates
        });

        const rows = response.data.values || [];
        let foundDate = null;

        // Rechercher le numéro de série dans la feuille
        for (const row of rows) {
            const sheetSerial = row[0];
            const sheetDate = row[1];
            if (sheetSerial === serial) {
                foundDate = sheetDate;
                break;
            }
        }

        // Si le numéro de série est trouvé, renvoyer la date
        if (foundDate) {
            // Récupérer les informations géographiques
            const geoInfo = await getGeoInfo(req.ip);

            // Écrire les logs dans une autre feuille
            await logToGoogleSheet(serial, foundDate, req.ip, geoInfo.country, geoInfo.city, true, uuid);

            return res.json({ status: 'Success', date: foundDate });
        } else {
            // Si le numéro de série n'est pas trouvé, écrire un log d'échec
            const geoInfo = await getGeoInfo(req.ip);
            await logToGoogleSheet(serial, null, req.ip, geoInfo.country, geoInfo.city, false, uuid);

            return res.status(404).json({ status: 'None', message: 'Aucune date trouvée pour ce numéro de série' });
        }
    } catch (error) {
        console.error('Erreur sur /api/getdate:', error.message);
        return res.status(500).json({ status: 'Error', message: 'Erreur serveur' });
    }
});

// Fonction pour écrire les logs dans Google Sheets
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
            country,                    // Pays (récupéré dynamiquement)
            city,                       // Ville (récupérée dynamiquement)
            serial,                     // Numéro de série
            success ? date : 'Échec',   // Résultat (date ou "Échec")
            success ? 'Succès' : 'Échec'// Statut (Succès ou Échec)
        ];

        console.log('Appending data to Google Sheet:', logData);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
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

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});